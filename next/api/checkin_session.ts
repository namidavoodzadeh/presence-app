// Shared check-in session (V2.5 board 28; CPO d-coo-cpo-b2b3-10nov GO; contract v1.53; migration 0050; behind PRESENCE_CHECK_IN).
// Two linked people, in an active check-in, open one short session. The CPO's conditions, and where each is enforced:
//   - Each person's saved things become visible to the other only inside the session, and only notes the writer kept through
//     "Still matters?" (parked_notes.state 'later'; the writer's own PATCH) and then chose to bring. Law 10: consent is the
//     act of bringing, per item, revocable until the session ends. A note that was never kept is never eligible.
//   - The law 8 floor already ran on every note when it was parked; it runs again on every appreciation (same helper as notes).
//   - One appreciation each first (phase "appreciations"); only when both are in does the session open its second phase
//     ("items"), where each person brings up to two. Nobody reads the other's appreciation before writing their own.
//   - Either person can end it. Ending (or expiry after 4 hours) DELETES the session, both appreciations, every brought
//     reference and the brought notes marked 'Talked about it'; notes still kept ('Next week') or not brought roll over. Nothing about the session (counts, who brought what, what was skipped) is kept or shown afterwards. The only
//     lasting marks are each person's own 'We talked about it' on their own notes (PATCH /checkin/notes/:id).
// Not a chat: no free replies, no read receipts, no push per item or at all (both people are together in the check-in; the other
// side reads GET /checkin/:person/session). Never reads either person's map or beliefs. No model reads anything here except the
// safety read on the appreciation text, as for notes.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { route } from "./lib/router.ts";
import type { Ctx } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";
import { requireActiveLink, requireCheckIn, safetyDecision } from "./checkin.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { COMM_KIND_COPY, COMM_KIND_ORDER, commRelationshipType, itemsVisibleTo, type CommKind, type StoredComm } from "../engine/comm.ts";

export const MAX_APPRECIATION = 600;
export const MAX_BROUGHT = 2;
export const SESSION_HOURS = 4;

function me(ctx: Ctx) {
  return { service: ctx.service, db: ctx.caller!.db, id: ctx.caller!.id };
}

function pair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/** Every accepted check-in (repeating or dated) between the two people, in either direction. */
async function activeCheckIns(service: SupabaseClient, x: string, y: string): Promise<Row[]> {
  const out: Row[] = [];
  for (const [owner, person] of [[x, y], [y, x]]) {
    const ci = await service.from("check_ins").select("*").eq("owner", owner).eq("person", person).maybeSingle();
    if (ci.error) dbError(ci.error, "check_ins.session");
    if (ci.data && (ci.data as Row).status === "active") out.push({ ...(ci.data as Row), repeating: true });
    const dd = await service.from("check_in_dates").select("*").eq("owner", owner).eq("person", person);
    if (dd.error) dbError(dd.error, "check_in_dates.session");
    out.push(...((dd.data ?? []) as Row[]).filter((r) => r.status === "active").map((r) => ({ ...r, repeating: false })));
  }
  return out;
}

/**
 * P8 turn order (CPO 12 Nov (3)): the person who accepted the check-in invite goes first, the same on both phones. With
 * check-ins both ways, the one accepted earliest decides (a repeating one before a dated one on a tie, then the smaller id),
 * so the answer never depends on who opened the session or which phone asks.
 */
export function firstSpeaker(rows: Row[]): string | null {
  const key = (r: Row) => String(r.accepted_at ?? r.created_at ?? "");
  const sorted = [...rows].filter((r) => r.person).sort((p, q) =>
    key(p).localeCompare(key(q)) || Number(q.repeating) - Number(p.repeating) || String(p.person).localeCompare(String(q.person))
  );
  return sorted.length ? String(sorted[0].person) : null;
}

async function endSession(service: SupabaseClient, id: string): Promise<void> {
  // Board 28 roll-over (CPO (A), 11 Nov): ending or expiring deletes only the appreciations (parts) and the notes brought
  // here that their writer marked 'Talked about it'. A brought note still 'later' (Next week) and every note not brought
  // stay as their writer's saved notes and roll over to the next check-in. Nothing is deleted that its writer didn't close.
  const brought = await service.from("checkin_session_items").select("writer,note_id").eq("session", id);
  if (brought.error) dbError(brought.error, "checkin_session_items.end");
  for (const it of (brought.data ?? []) as Row[]) {
    const d = await service.from("parked_notes").delete().eq("id", String(it.note_id)).eq("writer", String(it.writer)).eq("state", "talked");
    if (d.error) dbError(d.error, "parked_notes.end");
  }
  // Children go with it (on delete cascade); the explicit deletes make the rows-gone guarantee independent of the schema.
  for (const t of ["checkin_session_items", "checkin_session_parts"]) {
    const r = await service.from(t).delete().eq("session", id);
    if (r.error) dbError(r.error, `${t}.delete`);
  }
  const r = await service.from("checkin_sessions").delete().eq("id", id);
  if (r.error) dbError(r.error, "checkin_sessions.delete");
}

/** The open session between two people, or null. An expired one is deleted on sight and reads as none. */
async function openBetween(service: SupabaseClient, x: string, y: string): Promise<Row | null> {
  const [a, b] = pair(x, y);
  const { data, error } = await service.from("checkin_sessions").select("*").eq("person_a", a).eq("person_b", b).maybeSingle();
  if (error) dbError(error, "checkin_sessions.select");
  if (!data) return null;
  if (Date.parse(String((data as Row).expires_at)) <= Date.now()) {
    await endSession(service, String((data as Row).id));
    return null;
  }
  return data as Row;
}

/** A session by id that the caller is part of; anything else is the same 404 (the route never says a session exists). */
async function memberSession(ctx: Ctx, sessionId: string): Promise<{ s: Row; other: string }> {
  const { service, id } = me(ctx);
  const { data, error } = await service.from("checkin_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) dbError(error, "checkin_sessions.one");
  const s = data as Row | null;
  if (!s || (s.person_a !== id && s.person_b !== id)) throw new ApiError("not_found", "", { where: "session" });
  if (Date.parse(String(s.expires_at)) <= Date.now()) {
    await endSession(service, sessionId);
    throw new ApiError("not_found", "", { where: "session" });
  }
  const other = String(s.person_a === id ? s.person_b : s.person_a);
  await requireActiveLink(ctx.caller!.db, id, other);
  return { s, other };
}

/** What the other person has shared that the check-in may show (spec 4.4, surface "checkin": feels_like_care, bring_up,
 *  coming_back, this_week; never lands_hard, gets_heated, matters or other). One filter, `itemsVisibleTo`, decides; this only
 *  loads the rows and shapes them as words by kind, with no id, no date and no count. Behind the owner-only switch: off, or a
 *  caller not on the owner list, gives []. Read live at every view; nothing about it is stored in the session. */
async function sharedByOther(ctx: Ctx, other: string): Promise<Array<{ kind: CommKind; heading: string; wording: string; when: string | null }>> {
  const { service, id } = me(ctx);
  if (!ctx.env.commItems || !(ctx.env.commOwnerIds ?? []).includes(id)) return [];
  const [itemsQ, prefQ] = await Promise.all([
    service.from("beliefs")
      .select("id,own_wording,statement,comm_kind,comm_scope_type,comm_scope_value,comm_when,comm_expires_at,comm_status,comm_topic,created_at,confirmed_at")
      .eq("owner", other).eq("status", "confirmed").not("comm_kind", "is", null),
    // How the other person labels me (link_prefs is per owner): a type-scoped item is for that type of relationship.
    service.from("link_prefs").select("relationship").eq("owner", other).eq("other", id).maybeSingle(),
  ]);
  if (itemsQ.error) dbError(itemsQ.error, "beliefs.checkin_shared");
  if (prefQ.error) dbError(prefQ.error, "link_prefs.checkin_shared");
  const rows = ((itemsQ.data ?? []) as Row[]).filter((b) => b.comm_kind);
  const stored: Array<StoredComm & { wording: string; when_: string | null; at: string }> = rows.map((b) => ({
    id: String(b.id), kind: b.comm_kind as CommKind, scopeType: b.comm_scope_type as StoredComm["scopeType"], scopeValue: (b.comm_scope_value as string | null) ?? null,
    status: b.comm_status as StoredComm["status"], expiresAt: (b.comm_expires_at as string | null) ?? null, topic: (b.comm_topic as string | null) ?? null,
    when: (b.comm_when as string | null) ?? null, wording: String(b.own_wording ?? b.statement), when_: (b.comm_when as string | null) ?? null,
    at: String(b.confirmed_at ?? b.created_at ?? ""),
  }));
  const visible = itemsVisibleTo(stored, {
    surface: "checkin", own: false, readerId: id,
    readerRelationship: commRelationshipType(((prefQ.data ?? null) as Row | null)?.relationship as string | undefined), now: new Date(),
  });
  const order: CommKind[] = ["this_week", ...COMM_KIND_ORDER];
  return visible
    .sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || (x.at < y.at ? 1 : -1))   // kind order, newest first inside a kind
    .map((i) => ({ kind: i.kind, heading: COMM_KIND_COPY[i.kind].heading, wording: i.wording, when: i.when_ }));
}

/** What the caller may see right now. The other person's words appear only in phase "items", and only what they brought. */
async function view(ctx: Ctx, s: Row, other: string) {
  const { service, id } = me(ctx);
  const sid = String(s.id);
  const [partsQ, itemsQ] = await Promise.all([
    service.from("checkin_session_parts").select("*").eq("session", sid),
    service.from("checkin_session_items").select("*").eq("session", sid),
  ]);
  if (partsQ.error) dbError(partsQ.error, "checkin_session_parts.select");
  if (itemsQ.error) dbError(itemsQ.error, "checkin_session_items.select");
  const parts = (partsQ.data ?? []) as Row[], items = (itemsQ.data ?? []) as Row[];
  const mine = parts.find((p) => p.person === id), theirs = parts.find((p) => p.person === other);
  // A part is in once it has a written appreciation or the text-free 'said' mark (P8, said aloud).
  const given = (p: Row | undefined) => Boolean(p?.appreciation || p?.said_at);
  const phase = given(mine) && given(theirs) ? "items" : "appreciations";
  const first = s.first ? String(s.first) : firstSpeaker(await activeCheckIns(service, id, other));

  // Notes are read live: a note the writer let go of, or that is no longer kept, simply stops being offered or shown.
  const noteIds = items.map((i) => String(i.note_id));
  const ownQ = await service.from("parked_notes").select("id,text,state,created_at,updated_at").eq("writer", id).eq("partner", other);
  if (ownQ.error) dbError(ownQ.error, "parked_notes.session.mine");
  const own = (ownQ.data ?? []) as Row[];
  const myBrought = new Set(items.filter((i) => i.writer === id).map((i) => String(i.note_id)));
  const broughtMine = own.filter((n) => myBrought.has(String(n.id)) && (n.state === "later" || n.state === "talked"));
  const eligible = own.filter((n) => n.state === "later" && !myBrought.has(String(n.id)));

  let theirBrought: Row[] = [];
  if (phase === "items") {
    const theirIds = noteIds.filter((n) => items.some((i) => String(i.note_id) === n && i.writer === other));
    if (theirIds.length) {
      const q = await service.from("parked_notes").select("id,text,state,created_at,updated_at").eq("writer", other).eq("partner", id).in("id", theirIds);
      if (q.error) dbError(q.error, "parked_notes.session.theirs");
      theirBrought = ((q.data ?? []) as Row[]).filter((n) => n.state === "later" || n.state === "talked");
    }
  }
  theirBrought.sort((x, y) => (String(x.created_at) < String(y.created_at) ? -1 : 1));
  // v1.67 (Q-ENG-THEIRS-STATE, app3 Q27): the writer's own mark on a brought note, no words and no time. A brought note is
  // 'later' already (kept through "Still matters?"), so 'later' here means marked Next week AFTER it was brought (its
  // updated_at is past the bring); 'parked' means brought and not marked yet; 'talked' is Talked about it.
  const broughtAt = new Map(items.map((i) => [String(i.note_id), new Date(String(i.created_at ?? 0)).getTime()]));
  const markOf = (n: Row): "parked" | "talked" | "later" => {
    if (n.state === "talked") return "talked";
    const at = broughtAt.get(String(n.id)) ?? 0, upd = new Date(String(n.updated_at ?? 0)).getTime();
    return upd > at ? "later" : "parked";
  };
  return {
    id: sid,
    person_id: other,
    phase,
    opened_by_me: s.opened_by === id,
    // Who speaks first (user id): the person who accepted the check-in invite. Turns alternate from there.
    first,
    expires_at: s.expires_at,
    mine: {
      appreciation: (mine?.appreciation as string | null) ?? null,
      said: Boolean(mine?.said_at),
      brought: broughtMine.map((n) => ({ note_id: n.id, text: n.text, state: markOf(n) })),
      // What I could bring: only my own notes I kept through "Still matters?". Never a note I did not keep.
      eligible: phase === "items" ? eligible.map((n) => ({ note_id: n.id, text: n.text })) : [],
      can_bring_more: phase === "items" && broughtMine.length < MAX_BROUGHT && !mine?.done_bringing_at,
      // v1.64 (app3 Q24): I chose "Nothing else" or have brought two. Text-free, so both phones move turns on one fact.
      done_bringing: doneBringing(mine, broughtMine.length),
    },
    // Their words show only once both appreciations are in; a note is shown by its words alone (no id, no date, no count).
    theirs: {
      appreciation: phase === "items" ? (theirs?.appreciation as string | null) ?? null : null,
      // Only whether their mark is in, so both phones can move from 'Jan's turn' to 'Your turn'. No words, no time.
      said: Boolean(theirs?.said_at),
      brought: theirBrought.map((n) => ({ text: n.text, state: markOf(n) })),
      // Only whether they are done bringing (chose "Nothing else" or brought two); never what they could still bring.
      done_bringing: phase === "items" && doneBringing(theirs, theirBrought.length),
      // v1.88 (V3 4.4): what they have shared with me that a check-in may show, as words by kind. Items phase only, like
      // their notes; [] when the owner switch is off. Never lands_hard, gets_heated, matters, other, private or expired items.
      shared: phase === "items" ? await sharedByOther(ctx, other) : [],
    },
  };
}

/** v1.64: done once the person chose "Nothing else" (a text-free mark on their own part row) or has two brought. */
function doneBringing(part: Row | undefined, brought: number): boolean {
  return Boolean(part?.done_bringing_at) || brought >= MAX_BROUGHT;
}

route("POST", "/checkin/:person_id/session", async (ctx) => {
  requireCheckIn(ctx);
  const { service, db, id } = me(ctx);
  const other = ctx.params.person_id;
  await requireActiveLink(db, id, other);
  const checkIns = await activeCheckIns(service, id, other);
  if (!checkIns.length) throw new ApiError("conflict", "", { reason: "no_check_in" });
  // One at a time: opening again while one is open returns it (idempotent), so a double tap or the other person's tap is safe.
  let s = await openBetween(service, id, other);
  if (!s) {
    const [a, b] = pair(id, other);
    const ins = await service.from("checkin_sessions").insert({
      person_a: a, person_b: b, opened_by: id, first: firstSpeaker(checkIns), expires_at: new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString(),
    }).select("*").single();
    if (ins.error) dbError(ins.error, "checkin_sessions.insert");
    s = ins.data as Row;
    const p = await service.from("checkin_session_parts").insert([{ session: s.id, person: id }, { session: s.id, person: other }]);
    if (p.error) dbError(p.error, "checkin_session_parts.insert");
  }
  return json({ session: await view(ctx, s, other) });
});

route("GET", "/checkin/:person_id/session", async (ctx) => {
  requireCheckIn(ctx);
  const { service, db, id } = me(ctx);
  const other = ctx.params.person_id;
  await requireActiveLink(db, id, other);
  const s = await openBetween(service, id, other);
  return json({ session: s ? await view(ctx, s, other) : null });
});

route("PUT", "/checkin/session/:id/appreciation", async (ctx) => {
  requireCheckIn(ctx);
  const { service, id } = me(ctx);
  const { s, other } = await memberSession(ctx, ctx.params.id);
  const b = await ctx.body();
  if (typeof b.text !== "string" || !b.text.trim() || b.text.length > MAX_APPRECIATION) {
    throw new ApiError("invalid", "", { field: "text", max: MAX_APPRECIATION });
  }
  const mine = await service.from("checkin_session_parts").select("*").eq("session", String(s.id)).eq("person", id).maybeSingle();
  if (mine.error) dbError(mine.error, "checkin_session_parts.mine");
  if (mine.data && ((mine.data as Row).appreciation || (mine.data as Row).said_at)) throw new ApiError("conflict", "", { reason: "already_given" });
  // Law 8 before anything is stored: a stop stores nothing, and only the writer sees resources.
  const decision = await safetyDecision(ctx, id, other, b.text);
  if (decision.state === "unavailable") return json(unreadBody({ session: null }));
  if (decision.state === "safety") {
    return json({ state: "risk", session: null, line: decision.writer!.line, resources: decision.writer!.resources });
  }
  if (decision.state === "declined") return json({ state: "declined", session: null, line: null, resources: null });
  const up = await service.from("checkin_session_parts").update({ appreciation: b.text.trim(), appreciated_at: new Date().toISOString() })
    .eq("session", String(s.id)).eq("person", id);
  if (up.error) dbError(up.error, "checkin_session_parts.update");
  return json({ state: "ok", session: await view(ctx, s, other), line: null, resources: null });
});

// P8 said aloud (CPO 12 Nov (2)): the text-free 'said' mark. No body, nothing typed, stored beyond the session, screened or
// counted (there are no words, so there is nothing for the safety read). The first speaker marks first; the other person's
// Done waits for it, so both phones agree on whose turn it is. A written appreciation (V2.5) still works and counts the same.
route("PUT", "/checkin/session/:id/said", async (ctx) => {
  requireCheckIn(ctx);
  const { service, id } = me(ctx);
  const { s, other } = await memberSession(ctx, ctx.params.id);
  const sid = String(s.id);
  const q = await service.from("checkin_session_parts").select("*").eq("session", sid);
  if (q.error) dbError(q.error, "checkin_session_parts.said");
  const parts = (q.data ?? []) as Row[];
  const mine = parts.find((p) => p.person === id), theirs = parts.find((p) => p.person === other);
  if (mine?.appreciation || mine?.said_at) throw new ApiError("conflict", "", { reason: "already_given" });
  const first = s.first ? String(s.first) : firstSpeaker(await activeCheckIns(service, id, other));
  if (first === other && !(theirs?.appreciation || theirs?.said_at)) throw new ApiError("conflict", "", { reason: "not_your_turn" });
  const up = await service.from("checkin_session_parts").update({ said_at: new Date().toISOString() }).eq("session", sid).eq("person", id);
  if (up.error) dbError(up.error, "checkin_session_parts.said.update");
  return json({ session: await view(ctx, s, other) });
});

route("PUT", "/checkin/session/:id/items/:note_id", async (ctx) => {
  requireCheckIn(ctx);
  const { service, id } = me(ctx);
  const { s, other } = await memberSession(ctx, ctx.params.id);
  const b = await ctx.body();
  if (typeof b.bring !== "boolean") throw new ApiError("invalid", "", { field: "bring" });
  const sid = String(s.id), noteId = ctx.params.note_id;
  if (!b.bring) {
    // Taking an item back works at once, and the other person sees nothing change except that it is gone.
    const d = await service.from("checkin_session_items").delete().eq("session", sid).eq("writer", id).eq("note_id", noteId);
    if (d.error) dbError(d.error, "checkin_session_items.delete");
    return json({ session: await view(ctx, s, other) });
  }
  const v = await view(ctx, s, other);
  if (v.phase !== "items") throw new ApiError("conflict", "", { reason: "appreciation_first" });
  if (v.mine.brought.some((n) => n.note_id === noteId)) return json({ session: v }); // already brought: idempotent
  // Only my own note, kept through "Still matters?" (state later). Anything else is the same 404 as an unknown id.
  if (!v.mine.eligible.some((n) => n.note_id === noteId)) throw new ApiError("not_found", "", { where: "note" });
  if (v.mine.brought.length >= MAX_BROUGHT) throw new ApiError("conflict", "", { reason: "limit", max: MAX_BROUGHT });
  if (v.mine.done_bringing) throw new ApiError("conflict", "", { reason: "done_bringing" });
  const ins = await service.from("checkin_session_items").insert({ session: sid, writer: id, note_id: noteId });
  if (ins.error) dbError(ins.error, "checkin_session_items.insert");
  return json({ session: await view(ctx, s, other) });
});

// v1.64 "Nothing else" (app3 Q24, P8 alternating turns): a text-free mark that I bring nothing more, so the other phone can
// tell "still choosing" from "done". No body, no words, no count; stored on my own part row, deleted with the session.
// Taking an item back still works afterwards (consent stays revocable, law 10); bringing a new one does not.
route("PUT", "/checkin/session/:id/done_bringing", async (ctx) => {
  requireCheckIn(ctx);
  const { service, id } = me(ctx);
  const { s, other } = await memberSession(ctx, ctx.params.id);
  const v = await view(ctx, s, other);
  if (v.phase !== "items") throw new ApiError("conflict", "", { reason: "appreciation_first" });
  if (v.mine.done_bringing) return json({ session: v }); // idempotent
  const up = await service.from("checkin_session_parts").update({ done_bringing_at: new Date().toISOString() })
    .eq("session", String(s.id)).eq("person", id);
  if (up.error) dbError(up.error, "checkin_session_parts.done_bringing");
  return json({ session: await view(ctx, s, other) });
});

route("POST", "/checkin/session/:id/close", async (ctx) => {
  requireCheckIn(ctx);
  const { s } = await memberSession(ctx, ctx.params.id);
  await endSession(ctx.service, String(s.id));
  return json({ closed: true });
});
