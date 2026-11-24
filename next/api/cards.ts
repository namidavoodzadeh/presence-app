// Bridge history as cards (Nami's decision, 8 Nov 12:04 PT): a person's page is cards, never a chat thread. Each sent
// message is a card with one state both people share (open, kept, talked, resolved), with who set it and when.
// `GET /cards/:person` lists the cards between me and one person, latest first, closed ones apart; `PATCH /cards/:bridge_id`
// sets the state (either person). Cards between people who have an active check-in belong to it. Reads are service-side
// (the receiver has no policy on bridges, §1.7) and apply the receiver's rules by hand: nothing before delivery, words only once opened.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";

export const CARD_STATES = ["open", "kept", "talked", "resolved"] as const;
const CLOSED = new Set(["talked", "resolved"]);

async function requireActiveLink(db: SupabaseClient, mine: string, other: string): Promise<void> {
  const a = mine < other ? mine : other, b = mine < other ? other : mine;
  const { data, error } = await db.from("links").select("status").eq("person_a", a).eq("person_b", b).maybeSingle();
  if (error) dbError(error, "links");
  if (!data) throw new ApiError("not_found", "", { where: "link" });
  if (data.status !== "active") throw new ApiError("forbidden", "", { reason: data.status });
}

/** The active check-in between two people, whichever of them started it; an invite does not count (E33). */
async function activeCheckIn(db: SupabaseClient, a: string, b: string): Promise<string | null> {
  // Speed (CEO 12 Nov): both directions are read together; a's own check-in still wins when both are active.
  const both = await Promise.all([[a, b], [b, a]].map(([owner, person]) =>
    db.from("check_ins").select("id,status").eq("owner", owner).eq("person", person).maybeSingle()
  ));
  for (const { data, error } of both) {
    if (error) dbError(error, "check_ins.cards");
    if (data && (data as Row).status === "active") return String((data as Row).id);
  }
  return null;
}

/** True while the two people have a check-in session open (not expired): they are in the check-in together right now. */
async function sessionOpen(db: SupabaseClient, x: string, y: string): Promise<boolean> {
  return (await openSessionId(db, x, y)) !== null;
}

/** The id of the open (unexpired) check-in session between the two people, or null. */
async function openSessionId(db: SupabaseClient, x: string, y: string): Promise<string | null> {
  const a = x < y ? x : y, b = x < y ? y : x;
  const { data, error } = await db.from("checkin_sessions").select("id,expires_at").eq("person_a", a).eq("person_b", b).maybeSingle();
  if (error) dbError(error, "checkin_sessions.cards");
  return data && Date.parse(String((data as Row).expires_at)) > Date.now() ? String((data as Row).id) : null;
}

function cardObject(b: Row, viewer: string, st: Row | undefined, checkInId: string | null, now: number) {
  const mine = b.sender === viewer;
  const delivered = new Date(String(b.deliver_at)).getTime() <= now;
  return {
    bridge_id: b.id,
    direction: mine ? "sent" : "received",
    // The sender always has their own words; the receiver gets them only after opening (law 12 spirit: nothing arrives before its time).
    text: mine || b.opened_at ? b.final : null,
    delivered,
    opened_at: mine || b.opened_at ? (b.opened_at ?? null) : null,
    deliver_at: b.deliver_at,
    created_at: b.created_at,
    state: (st?.state as string) ?? "open",
    state_by: st ? (st.set_by === viewer ? "me" : "them") : null,
    state_at: st?.set_at ?? null,
    check_in_id: checkInId,
    // Q-APP-V3-17: closed (talked or resolved) at a check-in, fixed when it was marked; the Talked about tag 'At the check-in'.
    closed_in_check_in: CLOSED.has(String(st?.state ?? "open")) && st?.closed_in_check_in === true,
    shown: false,
  };
}

route("GET", "/cards/:person", async (ctx) => {
  const db = ctx.service, viewer = ctx.caller!.id, other = ctx.params.person;
  await requireActiveLink(ctx.caller!.db, viewer, other);
  const now = Date.now();
  const out: Row[] = [];
  // Speed (CEO 12 Nov): the two bridge reads and the check-in read go out together; errors are checked in the old order.
  const [sent, got, checkInId] = await Promise.all([
    db.from("bridges").select("*").eq("sender", viewer).eq("receiver", other).eq("status", "scheduled").is("sender_deleted_at", null),
    db.from("bridges").select("*").eq("sender", other).eq("receiver", viewer).eq("status", "scheduled").is("receiver_deleted_at", null),
    activeCheckIn(db, viewer, other),
  ]);
  if (sent.error) dbError(sent.error, "bridges.cards.sent");
  out.push(...((sent.data ?? []) as Row[]));
  if (got.error) dbError(got.error, "bridges.cards.received");
  out.push(...((got.data ?? []) as Row[]).filter((b) => new Date(String(b.deliver_at)).getTime() <= now));
  const ids = out.map((b) => String(b.id));
  const { data: states, error } = ids.length ? await db.from("bridge_cards").select("*").in("bridge_id", ids) : { data: [], error: null };
  if (error) dbError(error, "bridge_cards.select");
  const byId = new Map<string, Row>(((states ?? []) as Row[]).map((s) => [String(s.bridge_id), s]));
  const cards = out
    .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))
    .map((b) => cardObject(b, viewer, byId.get(String(b.id)), checkInId, now));
  const open = cards.filter((c) => !CLOSED.has(c.state));
  const closed = cards.filter((c) => CLOSED.has(c.state)).sort((x, y) => String(y.state_at).localeCompare(String(x.state_at)));
  open.forEach((c, i) => c.shown = i === 0 || c.state === "kept");
  return json({ person_id: other, check_in_id: checkInId, cards: open, closed });
});

/**
 * v1.65 (app Q-APP-V3-22): the check-in run-through marks a parked bridge's note talked through `PATCH /checkin/notes/:id`,
 * never `PATCH /cards`. That note's card closes with it, as `PATCH /cards {state: talked, at_check_in: true}` would, so one
 * writer tags it 'At the check-in'. Quiet: any check that fails (not this writer's bridge with this partner, withdrawn or
 * deleted on their side, sealed for a receiver, link not active) leaves the card alone and says nothing; a card already
 * closed keeps its first close. Service-side, as every card write.
 * v1.68 guard (CPO 12 Nov 22:40Z (2), board 28 bring rule): only a note the writer BROUGHT into the open session between the
 * two closes the card. A kept note that was not brought stays writer-only: marking it talked changes the writer's own list
 * and nothing on the receiver's side (no card, mark, count or trace).
 */
export async function closeCardFromNote(db: SupabaseClient, writer: string, partner: string, bridgeId: string, noteId: string): Promise<void> {
  const sid = await openSessionId(db, writer, partner);
  if (!sid) return;
  const it = await db.from("checkin_session_items").select("note_id").eq("session", sid).eq("note_id", noteId).eq("writer", writer).maybeSingle();
  if (it.error) dbError(it.error, "checkin_session_items.note_card");
  if (!it.data) return;
  const { data: br, error } = await db.from("bridges").select("*").eq("id", bridgeId).maybeSingle();
  if (error) dbError(error, "bridges.note_card");
  const row = br as Row | null;
  if (!row || row.status !== "scheduled") return;
  const mine = row.sender === writer;
  if (!(mine ? row.receiver === partner : row.receiver === writer && row.sender === partner)) return;
  if (mine ? row.sender_deleted_at : row.receiver_deleted_at) return;
  if (!mine && new Date(String(row.deliver_at)).getTime() > Date.now()) return;
  const a = writer < partner ? writer : partner, b = writer < partner ? partner : writer;
  const [link, st] = await Promise.all([
    db.from("links").select("status").eq("person_a", a).eq("person_b", b).maybeSingle(),
    db.from("bridge_cards").select("*").eq("bridge_id", bridgeId).maybeSingle(),
  ]);
  if (link.error) dbError(link.error, "links.note_card");
  if (st.error) dbError(st.error, "bridge_cards.note_card");
  if ((link.data as Row | null)?.status !== "active") return;
  if (CLOSED.has(String((st.data as Row | null)?.state ?? "open"))) return;
  const up = await db.from("bridge_cards").upsert({
    bridge_id: bridgeId, state: "talked", set_by: writer, set_at: new Date().toISOString(), closed_in_check_in: true, // brought into the open session: closed there
  }, { onConflict: "bridge_id" });
  if (up.error) dbError(up.error, "bridge_cards.note_card");
}

route("PATCH", "/cards/:bridge_id", async (ctx) => {
  const db = ctx.service, viewer = ctx.caller!.id;
  const b = await ctx.body();
  if (typeof b.state !== "string" || !(CARD_STATES as readonly string[]).includes(b.state)) throw new ApiError("invalid", "", { field: "state" });
  const { data: br, error } = await db.from("bridges").select("*").eq("id", ctx.params.bridge_id).maybeSingle();
  if (error) dbError(error, "bridges.card");
  const row = br as Row | null;
  const party = row && (row.sender === viewer || row.receiver === viewer);
  const gone = row && (row.status !== "scheduled" || (row.sender === viewer ? row.sender_deleted_at : row.receiver_deleted_at));
  if (!row || !party || gone) throw new ApiError("not_found", "", { where: "card" });
  await requireActiveLink(ctx.caller!.db, viewer, String(row.sender === viewer ? row.receiver : row.sender));
  // The receiver cannot touch a card before its time: they do not know it exists.
  if (row.receiver === viewer && new Date(String(row.deliver_at)).getTime() > Date.now()) throw new ApiError("forbidden", "", { reason: "sealed" });
  if (b.at_check_in !== undefined && typeof b.at_check_in !== "boolean") throw new ApiError("invalid", "", { field: "at_check_in" });
  const other = String(row.sender === viewer ? row.receiver : row.sender);
  const checkInId = await activeCheckIn(db, viewer, other);
  // Q-APP-V3-17: closed at the check-in when a check-in session is open between them, or when the app marks it from the
  // check-in screen (`at_check_in: true`) while they have an accepted check-in. Fixed at this write; a later open clears it.
  const atCheckIn = CLOSED.has(b.state) && ((await sessionOpen(db, viewer, other)) || (b.at_check_in === true && checkInId !== null));
  const now = new Date().toISOString();
  const up = await db.from("bridge_cards").upsert({ bridge_id: row.id, state: b.state, set_by: viewer, set_at: now, closed_in_check_in: atCheckIn }, { onConflict: "bridge_id" }).select("*").single();
  if (up.error) dbError(up.error, "bridge_cards.upsert");
  return json({ card: cardObject(row, viewer, up.data as Row, checkInId, Date.now()) });
});
