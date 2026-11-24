// E25 (CEO 2026-11-06 priority, "Bridge is the most important thing"): Park it, the week's list, done and
// reschedule — the check-in API app's A-Q62/A-Q68 screens (P1a-P1c) wait on (CONTRACT §6A). The weekly slot and
// the shared session queue stay a later item; this slice is writer-only, reusing TQ3's safety decision
// (engine/checkin/park.ts's decidePark) and storage (0020_parked_notes.sql) unchanged. Behind `PRESENCE_CHECK_IN`.
//
// park.ts's own comment says the caller runs "the existing Bridge screen" before deciding; the keyword floor
// alone cannot read a third-person description ("my partner threatened me"), so a note the floor clears still
// goes through the same model-based analyse() Bridge's own insight route uses, read only for its safety field.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AnthropicClient, type ModelClient } from "../engine/model/client.ts";
import { analyse } from "../engine/bridge/analyse.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import { decidePark } from "../engine/checkin/park.ts";
import { RELATIONSHIPS } from "../engine/bridge/types.ts";
import type { Relationship } from "../engine/bridge/types.ts";
import { type Ctx, route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import { type LedgerScope, PostgresLedger, recordEngineCall } from "./lib/ledger.ts";
import type { ModelExchange } from "../engine/types.ts";
import type { Row } from "./lib/objects.ts";
import { datedAt, homeRow, nextOccurrence, parseDated, parseSchedule, reminderDue, type Schedule, todayIn } from "../engine/checkin/schedule.ts";
import { secretEquals } from "./lib/secret.ts";
import { closeCardFromNote } from "./cards.ts";

const MAX_TEXT = 4000;
const STATE_RANK: Record<string, number> = { parked: 0, later: 1, talked: 2 };
const CHECKIN_MODEL = "claude-haiku-5-5"; // same model class as /bridge/insight's safety-only reads

/** Test seam, as bridge_engine.ts: a $0 check swaps the model for a recorded one. */
export const hooks: { client: ((ctx: Ctx, ledger: PostgresLedger) => ModelClient) | null } = { client: null };

function clientFor(ctx: Ctx, ledger: PostgresLedger): ModelClient {
  if (hooks.client) return hooks.client(ctx, ledger);
  if (!ctx.env.anthropicKey || !ctx.env.anthropicWorkspace) {
    throw new ApiError("unreachable", "Can't reach Presence right now.", {
      detail: "anthropic key or workspace not configured",
    });
  }
  return new AnthropicClient({
    config: { key: ctx.env.anthropicKey, workspace: ctx.env.anthropicWorkspace },
    ledger,
    defaultModel: CHECKIN_MODEL,
    fallbackModel: null,
    thinking: "disabled",
    timeoutMs: 30_000,
  });
}

function scopeFor(ctx: Ctx): LedgerScope {
  return { person: ctx.caller!.id, ownerPreview: ctx.caller!.isPreview, conversationId: null, feature: "bridge" };
}

async function trace(ctx: Ctx, scope: LedgerScope, ledger: PostgresLedger, exchanges: ModelExchange[]) {
  const ids = [...ledger.ids.values()];
  for (let i = 0; i < exchanges.length; i++) {
    await recordEngineCall(ctx.service, scope, exchanges[i], ids[i] ?? null, null);
  }
}

function refused(ledger: PostgresLedger, exchanges: ModelExchange[]): void {
  if (exchanges.length && exchanges.every((e) => e.error && !e.rawResponse)) {
    if (exchanges.some((e) => e.error?.startsWith("budget_unavailable"))) throw ledger.refusalError("bridge");
    const transport = exchanges.every((e) => /^(?:network|timeout)/.test(e.error ?? ""));
    throw new ApiError(
      transport ? "unreachable" : "engine_failed",
      "Presence couldn't park this one just now.",
      { detail: exchanges.at(-1)?.error },
    );
  }
}

function me(ctx: Ctx) {
  return { db: ctx.caller!.db, id: ctx.caller!.id };
}

function requireCheckIn(ctx: Ctx) {
  if (!ctx.env.checkIn) throw new ApiError("forbidden", "", { reason: "feature_off" });
}

async function requireActiveLink(db: SupabaseClient, mine: string, other: string): Promise<void> {
  // E37: "Just you" has no other person, so nothing that needs a link (notes, accept, decline) can name it.
  if (other === SELF) throw new ApiError("invalid", "", { field: "person_id", reason: "just_you" });
  const a = mine < other ? mine : other, b = mine < other ? other : mine;
  const { data, error } = await db.from("links").select("status,blocked_by").eq("person_a", a).eq("person_b", b)
    .maybeSingle();
  if (error) dbError(error, "links");
  if (!data) throw new ApiError("not_found", "", { where: "link" });
  // QA-B415: a blocked person receives the same neutral absence here as on
  // Bridge routes, never a response that reveals the block or blocker.
  if (data.status === "blocked" && data.blocked_by !== mine) {
    throw new ApiError("not_found", "", { where: "link" });
  }
  if (data.status !== "active") throw new ApiError("forbidden", "", { reason: data.status });
}

/** The relationship label for the safety-analysis prompt only (never shown); "friend" when none is set, same fallback as Bridge's own senderFor. */
async function relationshipFor(db: SupabaseClient, owner: string, personId: string): Promise<Relationship> {
  const { data: pref } = await db.from("link_prefs").select("relationship").eq("owner", owner).eq(
    "other",
    personId,
  ).maybeSingle();
  return (RELATIONSHIPS as readonly string[]).includes(String(pref?.relationship))
    ? pref!.relationship as Relationship
    : "friend";
}

/**
 * Law 8 for any text a person writes into a check-in: the keyword floor, then the same model-based read Bridge uses (safety field
 * only). A risk or threat result stores nothing; the caller returns resources (risk) or a plain decline. Shared by parked notes and
 * the shared-session appreciation so the two cannot drift.
 */
export async function safetyDecision(ctx: Ctx, writerId: string, personId: string, text: string) {
  const floor = await requireSafetyPass(ctx, text, "checkin");
  // PSY 16 Nov 2c: an unreadable reading is neither a risk nor a pass. decidePark would park it, so it never reaches decidePark.
  if (floor.routed === "unavailable") return { state: "unavailable" as const, store: null, writer: null, shared: null };
  let safety = floor.routed;
  if (safety === "none") {
    const relationship = await relationshipFor(ctx.caller!.db, writerId, personId);
    const scope = scopeFor(ctx), ledger = new PostgresLedger(ctx.service, scope);
    const a = await analyse(clientFor(ctx, ledger), text, relationship, []);
    await trace(ctx, scope, ledger, a.exchanges);
    refused(ledger, a.exchanges);
    if (a.analysis) safety = a.analysis.safety;
    // an unreadable analysis (parse failure after repair) leaves safety "none": the keyword floor is still the backstop.
  }
  return decidePark(true, { writerId, partnerId: personId, text }, { safety });
}

export { requireActiveLink, requireCheckIn };

function noteObject(row: Row, personId: string) {
  return {
    origin: row.origin ?? "note",
    id: row.id,
    person_id: personId,
    text: row.text,
    state: row.state,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source: row.source ?? null,
  };
}

route("POST", "/checkin/:person_id/notes", async (ctx) => {
  requireCheckIn(ctx);
  const { db, id: writerId } = me(ctx);
  const personId = ctx.params.person_id;
  await requireActiveLink(db, writerId, personId);
  const b = await ctx.body();
  if (typeof b.text !== "string" || !b.text.trim() || b.text.length > MAX_TEXT) {
    throw new ApiError("invalid", "", { field: "text" });
  }
  const text = b.text;
  const origin = b.origin === undefined ? "note" : b.origin;
  if (origin !== "note" && origin !== "bridged" && origin !== "topic") throw new ApiError("invalid", "", { field: "origin" });
  const originRef = b.origin_ref === undefined || b.origin_ref === null ? null : b.origin_ref;
  if (originRef !== null && (typeof originRef !== "string" || !/^[0-9a-f-]{36}$/i.test(originRef))) {
    throw new ApiError("invalid", "", { field: "origin_ref" });
  }
  let source = b.source === undefined || b.source === null ? null : b.source;
  if (source !== null && (typeof source !== "object" || Array.isArray(source) ||
      !["note", "conversation", "card"].includes((source as Row).kind as string) ||
      typeof (source as Row).id !== "string" || !(source as Row).id)) {
    throw new ApiError("invalid", "", { field: "source" });
  }
  const decision = await safetyDecision(ctx, writerId, personId, text);
  if (decision.state === "unavailable") return json(unreadBody({ note: null }));
  if (decision.state === "safety") {
    return json({
      state: "risk",
      note: null,
      line: decision.writer!.line,
      resources: decision.writer!.resources,
    });
  }
  if (decision.state === "declined") {
    return json({ state: "declined", note: null, line: null, resources: null });
  }
  // A private note is its own editable source. Give it an id before insertion so the nullable source field records
  // that fact; existing rows remain null and must never be backfilled by matching their text.
  const id = crypto.randomUUID();
  if (source === null && origin === "note") source = { kind: "note", id };
  const { data, error } = await db.from("parked_notes").insert({ id, writer: writerId, partner: personId, text, origin, origin_ref: originRef, source })
    .select("*").single();
  if (error) dbError(error, "parked_notes.insert");
  return json({ state: "parked", note: noteObject(data as Row, personId), line: null, resources: null });
});

/** E33: check-ins other people have started with me that I have not accepted yet. Day, time and who; no note text, no count (law 10). */
route("GET", "/checkin/invites", async (ctx) => {
  requireCheckIn(ctx);
  const { id } = me(ctx);
  const { data, error } = await ctx.service.from("check_ins").select("*").eq("person", id).eq("status", "invited");
  if (error) dbError(error, "check_ins.invites");
  const now = Date.now();
  return json({
    invites: ((data ?? []) as Row[]).map((r) => ({
      check_in_id: r.id,
      person_id: r.owner,
      day: r.day,
      time: r.time,
      tz: r.tz,
      next_at: new Date(nextOccurrence(asSchedule(r), now)).toISOString(),
    })),
  });
});

route("GET", "/checkin/:person_id", async (ctx) => {
  requireCheckIn(ctx);
  const { db, id: writerId } = me(ctx);
  if (ctx.params.person_id === SELF) {
    const mine = await loadSchedule(db, writerId, null);
    return json({ notes: [], schedule: mine ? scheduleObject(mine) : null, dated: (await loadDated(db, writerId, null)).map(datedObject), parked: 0 });
  }
  const personId = ctx.params.person_id;
  await requireActiveLink(db, writerId, personId);
  // Speed (CEO 12 Nov): after the link check, the three reads go out together.
  const [{ data, error }, sched, dated] = await Promise.all([
    db.from("parked_notes").select("*").eq("writer", writerId).eq("partner", personId),
    loadSchedule(db, writerId, personId),
    loadDated(db, writerId, personId),
  ]);
  if (error) dbError(error, "parked_notes.select");
  const rows = (data ?? []) as Row[];
  rows.sort((x, y) => {
    const rank = (STATE_RANK[String(x.state)] ?? 9) - (STATE_RANK[String(y.state)] ?? 9);
    if (rank !== 0) return rank;
    const xt = String(x.created_at), yt = String(y.created_at);
    // Within "talked" the most recent comes first (a short recent history); otherwise oldest first.
    return x.state === "talked" ? (xt < yt ? 1 : xt > yt ? -1 : 0) : (xt < yt ? -1 : xt > yt ? 1 : 0);
  });
  return json({
    notes: rows.map((r) => noteObject(r, personId)),
    schedule: sched ? scheduleObject(sched) : null,
    dated: dated.map(datedObject),
    parked: rows.filter((r) => r.state === "parked").length,
  });
});

route("PATCH", "/checkin/notes/:id", async (ctx) => {
  requireCheckIn(ctx);
  const { db, id: writerId } = me(ctx);
  const b = await ctx.body();
  const editing = b.text !== undefined;
  if (editing && b.state !== undefined) throw new ApiError("invalid", "", { field: "state" });
  if (!editing && b.state !== "talked" && b.state !== "later") throw new ApiError("invalid", "", { field: "state" });
  if (editing && (typeof b.text !== "string" || !b.text.trim() || b.text.length > MAX_TEXT)) {
    throw new ApiError("invalid", "", { field: "text" });
  }
  const { data: existing, error: e0 } = await db.from("parked_notes").select("*").eq("id", ctx.params.id)
    .eq("writer", writerId).maybeSingle();
  if (e0) dbError(e0, "parked_notes.select.one");
  if (!existing) throw new ApiError("not_found", "", { where: "note" });
  if (editing) {
    // v1.73: the writer rewords their own note. Same law 8 screen as POST; a stop or decline changes nothing. A parked
    // bridge's words are the bridge's, so they are not edited here. origin, origin_ref, state and created_at stay as they were.
    if (existing.origin === "bridged") throw new ApiError("conflict", "", { reason: "bridged" });
    const decision = await safetyDecision(ctx, writerId, String(existing.partner), b.text as string);
    if (decision.state === "safety") {
      return json({ state: "risk", note: null, line: decision.writer!.line, resources: decision.writer!.resources });
    }
    if (decision.state === "declined") return json({ state: "declined", note: null, line: null, resources: null });
    const upd = await db.from("parked_notes").update({ text: b.text, updated_at: new Date().toISOString() })
      .eq("id", ctx.params.id).eq("writer", writerId).select("*").single();
    if (upd.error) dbError(upd.error, "parked_notes.edit");
    return json({ state: "ok", note: noteObject(upd.data as Row, String(existing.partner)), line: null, resources: null });
  }
  const { data, error } = await db.from("parked_notes")
    .update({ state: b.state, updated_at: new Date().toISOString() }).eq("id", ctx.params.id).select("*")
    .single();
  if (error) dbError(error, "parked_notes.update");
  // v1.65 (Q-APP-V3-22): a parked bridge's note marked talked closes its card at the check-in too; v1.68: only when the
  // writer brought it into the open session (closeCardFromNote checks; a note not brought stays writer-only).
  if (b.state === "talked" && existing.origin === "bridged" && existing.origin_ref) {
    await closeCardFromNote(ctx.service, writerId, String(existing.partner), String(existing.origin_ref), String(existing.id));
  }
  return json({ note: noteObject(data as Row, String(existing.partner)) });
});

/**
 * V25 board 13 "Let go": the writer takes one of their own notes off the list for good. A hard delete, any state.
 * Writer only (404 for anyone else, so the route does not say whether the note exists). A parked bridge's note also pulls
 * the bridge back if nobody has opened it, as E39 does; the receiver sees nothing and is told nothing.
 */
route("DELETE", "/checkin/notes/:id", async (ctx) => {
  requireCheckIn(ctx);
  const { db, id: writerId } = me(ctx);
  const { data: existing, error: e0 } = await db.from("parked_notes").select("*").eq("id", ctx.params.id).eq("writer", writerId).maybeSingle();
  if (e0) dbError(e0, "parked_notes.select.one");
  if (!existing) throw new ApiError("not_found", "", { where: "note" });
  if (existing.state === "parked" && existing.origin === "bridged" && existing.origin_ref) {
    const w = await db.from("bridges").update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
      .eq("id", existing.origin_ref).eq("sender", writerId).eq("status", "scheduled").is("opened_at", null);
    if (w.error) dbError(w.error, "bridges.letgo.withdraw");
  }
  const { error } = await db.from("parked_notes").delete().eq("id", ctx.params.id).eq("writer", writerId);
  if (error) dbError(error, "parked_notes.letgo.delete");
  return json({ deleted: true });
});

// ------------------------------------------------------------------ E32: the weekly schedule

/** E37: the person id `self` is the "Just you" check-in: no other person, so no link, no invite, no reminder, no parked notes. */
export const SELF = "self";

async function loadSchedule(db: SupabaseClient, owner: string, person: string | null): Promise<Row | null> {
  const q = db.from("check_ins").select("*").eq("owner", owner);
  const { data, error } = await (person === null ? q.is("person", null) : q.eq("person", person)).maybeSingle();
  if (error) dbError(error, "check_ins.select");
  return (data as Row | null) ?? null;
}

export function asSchedule(r: Row): Schedule {
  const repeats = (r.repeats ?? "weekly") as Schedule["repeats"];
  return { repeats, ...(repeats === "fortnightly" && r.anchor ? { anchor: String(r.anchor) } : {}), day: r.day as Schedule["day"], time: String(r.time), tz: String(r.tz), remind_other: r.remind_other !== false };
}

/** E36: one-date check-ins (`{on, time}`), kept beside the person's one repeating check-in. */
function datedObject(r: Row) {
  return { id: r.id, person_id: r.person ?? null, on: String(r.on_date), time: String(r.time), tz: String(r.tz), remind_other: r.remind_other !== false,
    status: r.status ?? "invited", accepted_at: r.accepted_at ?? null, next_at: new Date(datedAt({ on: String(r.on_date), time: String(r.time), tz: String(r.tz) })).toISOString() };
}

/** The dated check-ins still to come for one person (null person: the caller's own), soonest first. */
async function loadDated(db: SupabaseClient, owner: string, person: string | null, now = Date.now()): Promise<Row[]> {
  let q = db.from("check_in_dates").select("*").eq("owner", owner);
  q = person === null ? q.is("person", null) : q.eq("person", person);
  const { data, error } = await q;
  if (error) dbError(error, "check_in_dates.select");
  return ((data ?? []) as Row[]).filter((r) => datedAt({ on: String(r.on_date), time: String(r.time), tz: String(r.tz) }) > now)
    .sort((a, b) => (datedObject(a).next_at < datedObject(b).next_at ? -1 : 1));
}

function scheduleObject(r: Row, now = Date.now()) {
  const s = asSchedule(r);
  return {
    id: r.id,
    person_id: r.person ?? null,
    repeats: s.repeats,
    day: s.day,
    time: s.time,
    tz: s.tz,
    remind_other: s.remind_other,
    status: r.status ?? "invited",
    accepted_at: r.accepted_at ?? null,
    moved_at: r.moved_at ?? null,
    moved_by: r.moved_by ?? null,
    next_at: new Date(nextOccurrence(s, now)).toISOString(),
  };
}

route("PUT", "/checkin/:person_id/schedule", async (ctx) => {
  requireCheckIn(ctx);
  const { db, id: owner } = me(ctx);
  const self = ctx.params.person_id === SELF;
  const personId = self ? null : ctx.params.person_id;
  if (personId !== null) await requireActiveLink(db, owner, personId);
  const body = await ctx.body();
  const existing = await loadSchedule(db, owner, personId);
  if (body.on !== undefined) {
    // E36: the one-date form. It sits beside the person's repeating check-in (one repeating plus any number of dated ones).
    const d = parseDated(body, ctx.tz, Date.now());
    if ("invalid" in d) throw new ApiError("invalid", "", { field: d.invalid });
    const row = { owner, person: personId, on_date: d.on, time: d.time, tz: d.tz, remind_other: d.remind_other,
      status: self || (existing as Row | null)?.status === "active" ? "active" : "invited" };
    let write;
    if (personId !== null) write = db.from("check_in_dates").upsert(row, { onConflict: "owner,person,on_date" });
    else {
      // A null person never matches a unique key, so the "Just you" date is replaced by hand.
      const { data: have } = await db.from("check_in_dates").select("id").eq("owner", owner).is("person", null).eq("on_date", d.on).maybeSingle();
      write = have ? db.from("check_in_dates").update(row).eq("id", (have as Row).id) : db.from("check_in_dates").insert(row);
    }
    const { data: dated, error: de } = await write.select("*").single();
    if (de) dbError(de, "check_in_dates.upsert");
    return json({ dated: datedObject(dated as Row) });
  }
  const s = parseSchedule(body, ctx.tz);
  if ("invalid" in s) throw new ApiError("invalid", "", { field: s.invalid });
  // A new check-in is an invite; a re-PUT of an existing one keeps its status (accepted stays accepted).
  // A fortnightly repeat counts from the day it was set; setting it again keeps that day.
  const anchor = s.repeats === "fortnightly" ? (existing?.repeats === "fortnightly" && existing.anchor ? String(existing.anchor) : todayIn(s.tz, Date.now())) : null;
  // E40: a new day, time, zone or repeat on an ACCEPTED check-in is a move (who and when are kept); a remind-only change or an edit before acceptance is not.
  const moved = existing && existing.status === "active" && personId !== null &&
    (existing.day !== s.day || existing.time !== s.time || existing.tz !== s.tz || (existing.repeats ?? "weekly") !== s.repeats);
  const row = {
    owner, person: personId, repeats: s.repeats, anchor, day: s.day, time: s.time, tz: s.tz, remind_other: s.remind_other,
    updated_at: new Date().toISOString(), ...(existing ? {} : { status: self ? "active" : "invited" }),
    ...(moved ? { moved_at: new Date().toISOString(), moved_by: owner } : {}),
  };
  const { data, error } = await (personId !== null
    ? db.from("check_ins").upsert(row, { onConflict: "owner,person" })
    : existing ? db.from("check_ins").update(row).eq("id", existing.id) : db.from("check_ins").insert(row)).select("*").single();
  if (error) dbError(error, "check_ins.upsert");
  if (moved) await moveParkedBridges(db, owner, personId!, nextOccurrence(asSchedule(existing as Row), Date.now()), nextOccurrence(asSchedule(data as Row), Date.now()));
  return json({ schedule: scheduleObject(data as Row) });
});

route("DELETE", "/checkin/:person_id/schedule", async (ctx) => {
  requireCheckIn(ctx);
  const { db, id: owner } = me(ctx);
  const self = ctx.params.person_id === SELF;
  const del = db.from("check_ins").delete().eq("owner", owner);
  const { error } = await (self ? del.is("person", null) : del.eq("person", ctx.params.person_id));
  if (error) dbError(error, "check_ins.delete");
  // The row is gone for the other person too (their invite or incoming list reads the same row); nothing is sent to them.
  // E39: what the writer parked for this person comes back as drafts in this reply, once, unless a dated check-in is
  // still to come (the notes still have somewhere to go). Talked and kept-for-later notes stay as they were.
  const drafts = self || (await loadDated(db, owner, ctx.params.person_id)).length ? [] : await returnParked(db, owner, ctx.params.person_id);
  return json({ deleted: true, drafts });
});

/** E39: the writer's parked notes for one person, handed back as drafts; parked bridges that have not been opened are withdrawn (the receiver sees nothing). */
async function returnParked(db: SupabaseClient, writer: string, partner: string) {
  const { data, error } = await db.from("parked_notes").select("*").eq("writer", writer).eq("partner", partner).eq("state", "parked");
  if (error) dbError(error, "parked_notes.return.select");
  const notes = ((data ?? []) as Row[]).sort((a, b) => (String(a.created_at) < String(b.created_at) ? -1 : 1));
  const drafts = [];
  for (const n of notes) {
    if (n.origin === "bridged" && n.origin_ref) {
      const w = await db.from("bridges").update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
        .eq("id", n.origin_ref).eq("sender", writer).eq("status", "scheduled").is("opened_at", null);
      if (w.error) dbError(w.error, "bridges.return.withdraw");
    }
    const gone = await db.from("parked_notes").delete().eq("id", n.id).eq("writer", writer);
    if (gone.error) dbError(gone.error, "parked_notes.return.delete");
    drafts.push({ id: n.id, person_id: partner, origin: n.origin ?? "note", text: n.text, created_at: n.created_at });
  }
  return drafts;
}

/** E36: take one dated check-in off the list. Only its owner can. */
route("DELETE", "/checkin/dated/:id", async (ctx) => {
  requireCheckIn(ctx);
  const { db, id: owner } = me(ctx);
  const { error } = await db.from("check_in_dates").delete().eq("owner", owner).eq("id", ctx.params.id);
  if (error) dbError(error, "check_in_dates.delete");
  return json({ deleted: true });
});

/** The Bridge home rows: one per person with a schedule. Numbers only; no note text leaves this route. */
route("GET", "/checkin", async (ctx) => {
  requireCheckIn(ctx);
  const { db, id: owner } = me(ctx);
  // Speed (CEO 12 Nov): the four reads are independent, so they go out together; errors are checked in the old order.
  const [{ data, error }, { data: notes, error: e2 }, { data: dd, error: e3 }, { data: inc, error: e4 }] = await Promise.all([
    db.from("check_ins").select("*").eq("owner", owner),
    db.from("parked_notes").select("*").eq("writer", owner).eq("state", "parked"),
    db.from("check_in_dates").select("*").eq("owner", owner),
    ctx.service.from("check_ins").select("*").eq("person", owner).eq("status", "active"),
  ]);
  if (error) dbError(error, "check_ins.select.all");
  if (e2) dbError(e2, "parked_notes.select.count");
  if (e3) dbError(e3, "check_in_dates.select.all");
  if (e4) dbError(e4, "check_ins.incoming");
  const now = Date.now();
  const rows = ((data ?? []) as Row[]).map((r) => ({
    check_in_id: r.id,
    person_id: r.person ?? null,
    remind_other: r.remind_other !== false,
    status: r.status ?? "invited",
    accepted_at: r.accepted_at ?? null,
    moved_at: r.moved_at ?? null,
    moved_by: r.moved_by ?? null,
    ...homeRow(asSchedule(r), r.person ? ((notes ?? []) as Row[]).filter((n) => n.partner === r.person).length : 0, now),
  }));
  rows.sort((a, b) => (a.next_at < b.next_at ? -1 : a.next_at > b.next_at ? 1 : 0));
  // E36: the Dated list: one-date check-ins still to come, soonest first, beside the repeating rows.
  const dated = ((dd ?? []) as Row[]).filter((r) => datedAt({ on: String(r.on_date), time: String(r.time), tz: String(r.tz) }) > now).map(datedObject)
    .sort((a, b) => (a.next_at < b.next_at ? -1 : a.next_at > b.next_at ? 1 : 0));
  // E40: check-ins other people started with me that I have accepted (the accepted ones; waiting ones are on /checkin/invites).
  const incoming = ((inc ?? []) as Row[]).map((r) => ({
    check_in_id: r.id, person_id: r.owner, repeats: r.repeats ?? "weekly", day: r.day, time: r.time, tz: r.tz,
    next_at: new Date(nextOccurrence(asSchedule(r), now)).toISOString(),
    accepted_at: r.accepted_at ?? null, moved_at: r.moved_at ?? null, moved_by: r.moved_by ?? null,
  })).sort((a, b) => (a.next_at < b.next_at ? -1 : a.next_at > b.next_at ? 1 : 0));
  return json({ check_ins: rows, dated, incoming });
});

/** The invitee says yes: the check-in starts. Only the person it names can accept; the inviter cannot. Idempotent. */
route("POST", "/checkin/:person_id/accept", async (ctx) => {
  requireCheckIn(ctx);
  const { db, id } = me(ctx);
  const inviter = ctx.params.person_id;
  await requireActiveLink(db, id, inviter);
  const { data: ci, error } = await ctx.service.from("check_ins").select("*").eq("owner", inviter).eq("person", id).maybeSingle();
  if (error) dbError(error, "check_ins.accept.select");
  // E36: dated check-ins from the same person are answered with it.
  const { data: dates, error: de } = await ctx.service.from("check_in_dates").select("id").eq("owner", inviter).eq("person", id);
  if (de) dbError(de, "check_in_dates.accept.select");
  if (!ci && !(dates ?? []).length) throw new ApiError("not_found", "", { where: "check_in" });
  if ((dates ?? []).length) {
    const du = await ctx.service.from("check_in_dates").update({ status: "active", accepted_at: new Date().toISOString() }).eq("owner", inviter).eq("person", id).eq("status", "invited");
    if (du.error) dbError(du.error, "check_in_dates.accept");
  }
  if (!ci) return json({ check_in: null, dated_accepted: (dates ?? []).length });
  let row = ci as Row;
  if (row.status !== "active") {
    const up = await ctx.service.from("check_ins").update({ status: "active", accepted_at: new Date().toISOString() })
      .eq("owner", inviter).eq("person", id).select("*").single();
    if (up.error) dbError(up.error, "check_ins.accept");
    row = up.data as Row;
  }
  return json({ check_in: { check_in_id: row.id, person_id: inviter, status: row.status, ...homeRow(asSchedule(row), 0, Date.now()) } });
});

/** The invitee says no thanks. The invite goes; the inviter's parked notes stay. */
route("POST", "/checkin/:person_id/decline", async (ctx) => {
  requireCheckIn(ctx);
  const { id } = me(ctx);
  const { error } = await ctx.service.from("check_ins").delete().eq("owner", ctx.params.person_id).eq("person", id).eq("status", "invited");
  if (error) dbError(error, "check_ins.decline");
  const dd = await ctx.service.from("check_in_dates").delete().eq("owner", ctx.params.person_id).eq("person", id).eq("status", "invited");
  if (dd.error) dbError(dd.error, "check_in_dates.decline");
  return json({ declined: true });
});

/**
 * Bridge "Next check-in" (E32 POST, E33 PATCH): the sender's accepted check-in with this person, as the next time it falls.
 * No check-in is `no_check_in`; one the other person has not accepted yet is `not_accepted`.
 */
export async function nextCheckInAt(db: SupabaseClient, owner: string, person: string, now = Date.now()): Promise<string> {
  // E38: the soonest ACCEPTED check-in with this person, the repeating one or a dated one still to come.
  const { data: ci, error } = await db.from("check_ins").select("*").eq("owner", owner).eq("person", person).maybeSingle();
  if (error) dbError(error, "check_ins.select");
  const dated = await loadDated(db, owner, person, now);
  if (!ci && !dated.length) throw new ApiError("invalid", "", { field: "deliver_at", reason: "no_check_in" });
  const times: number[] = [];
  if (ci && (ci as Row).status === "active") times.push(nextOccurrence(asSchedule(ci as Row), now));
  for (const d of dated) if (d.status === "active") times.push(datedAt({ on: String(d.on_date), time: String(d.time), tz: String(d.tz) }));
  if (!times.length) throw new ApiError("invalid", "", { field: "deliver_at", reason: "not_accepted" });
  return new Date(Math.min(...times)).toISOString();
}

/** Park a scheduled bridge's words on the sender's own check-in list, once (origin bridged, origin_ref = the bridge). */
export async function parkBridge(db: SupabaseClient, writer: string, partner: string, bridgeId: string, text: string): Promise<void> {
  const { data: have, error } = await db.from("parked_notes").select("id").eq("writer", writer).eq("origin", "bridged").eq("origin_ref", bridgeId);
  if (error) dbError(error, "parked_notes.have");
  if ((have ?? []).length) return;
  const ins = await db.from("parked_notes").insert({ writer, partner, text, state: "parked", origin: "bridged", origin_ref: bridgeId });
  if (ins.error) dbError(ins.error, "parked_notes.park_bridge");
}

/**
 * E41: for the SENDER's own thread rows. Which of these bridges (sender = owner, receiver = person) wait on a check-in, and on which
 * one: `bridge id -> check_in id`. A bridge is parked while its note (origin bridged) is still `parked`; the check-in is the one whose
 * coming time is the bridge's `deliver_at` (the repeating one, else a dated one), falling back to the repeating one, then a dated one.
 * The receiver's rows never call this (law 10: the receiver is told nothing before the check-in).
 */
export async function parkedOnCheckIns(db: SupabaseClient, owner: string, person: string, bridges: Row[], now = Date.now()): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!bridges.length) return out;
  const { data: notes, error } = await db.from("parked_notes").select("origin_ref").eq("writer", owner).eq("partner", person).eq("origin", "bridged").eq("state", "parked");
  if (error) dbError(error, "parked_notes.thread");
  const parked = new Set(((notes ?? []) as Row[]).map((n) => String(n.origin_ref)));
  const mine = bridges.filter((b) => parked.has(String(b.id)));
  if (!mine.length) return out;
  const [ci, dated] = await Promise.all([loadSchedule(db, owner, person), loadDated(db, owner, person, now)]);
  for (const b of mine) {
    const at = new Date(String(b.deliver_at)).getTime();
    let id: unknown = ci && nextOccurrence(asSchedule(ci), at - 1) === at ? ci.id : undefined;
    id ??= dated.find((d) => datedAt({ on: String(d.on_date), time: String(d.time), tz: String(d.tz) }) === at)?.id;
    id ??= ci?.id ?? dated[0]?.id;
    if (id) out.set(String(b.id), String(id));
  }
  return out;
}

/**
 * E41: when the repeating check-in moves, every bridge parked on it (not yet delivered or opened) moves with it:
 * `deliver_at` goes from the old coming time to the new one. Nothing is sent to the receiver.
 */
async function moveParkedBridges(db: SupabaseClient, owner: string, person: string, oldAt: number, newAt: number, now = Date.now()): Promise<void> {
  if (oldAt === newAt || oldAt <= now) return;
  const { data: notes, error } = await db.from("parked_notes").select("origin_ref").eq("writer", owner).eq("partner", person).eq("origin", "bridged").eq("state", "parked");
  if (error) dbError(error, "parked_notes.move");
  for (const n of (notes ?? []) as Row[]) {
    const up = await db.from("bridges").update({ deliver_at: new Date(newAt).toISOString() })
      .eq("id", n.origin_ref).eq("sender", owner).eq("receiver", person).eq("status", "scheduled").eq("deliver_at", new Date(oldAt).toISOString()).is("opened_at", null);
    if (up.error) dbError(up.error, "bridges.move");
  }
}

/** Take a bridge off the check-in list if it is still waiting there. Notes already talked about or kept for later stay. */
export async function unparkBridge(db: SupabaseClient, writer: string, bridgeId: string): Promise<void> {
  const { error } = await db.from("parked_notes").delete().eq("writer", writer).eq("origin", "bridged").eq("origin_ref", bridgeId).eq("state", "parked");
  if (error) dbError(error, "parked_notes.unpark_bridge");
}

/**
 * The scheduler's call (every 10 minutes, same secret as the push drain): for each check-in whose time is within
 * the hour and which reminds the other person, queue one content-free `checkin_reminder` push to the other person's
 * devices. Safe to call repeatedly: one event per device per occurrence. Says nothing but that a check-in is due.
 */
export async function queueCheckInReminders(service: SupabaseClient, now = Date.now()): Promise<{ queued: number }> {
  const { data, error } = await service.from("check_ins").select("*").eq("remind_other", true).eq("status", "active");
  if (error) dbError(error, "check_ins.due");
  const { data: dd, error: de } = await service.from("check_in_dates").select("*").eq("remind_other", true).eq("status", "active");
  if (de) dbError(de, "check_in_dates.due");
  let queued = 0;
  // E36: a dated check-in is due once, within the hour before its time.
  const dueRows: Array<{ r: Row; at: number | null }> = [
    ...((data ?? []) as Row[]).map((r) => ({ r, at: reminderDue(asSchedule(r), now) })),
    ...((dd ?? []) as Row[]).map((r) => {
      const at = datedAt({ on: String(r.on_date), time: String(r.time), tz: String(r.tz) });
      return { r, at: at > now && at - now <= 60 * 60_000 ? at : null };
    }),
  ];
  for (const { r, at } of dueRows) {
    if (at === null || !r.person) continue;
    const other = String(r.person);
    const { data: prof } = await service.from("profiles").select("settings").eq("id", other).maybeSingle();
    const notify = (prof as Row | null)?.settings as { notify?: { talk_reminders?: boolean } } | undefined;
    if (notify?.notify?.talk_reminders === false) continue;
    // Both sides must still be linked and active.
    const a = String(r.owner) < other ? String(r.owner) : other, b = String(r.owner) < other ? other : String(r.owner);
    const { data: link } = await service.from("links").select("status").eq("person_a", a).eq("person_b", b).maybeSingle();
    if ((link as Row | null)?.status !== "active") continue;
    const { data: devices } = await service.from("device_tokens").select("id").eq("owner", other).eq("enabled", true);
    const dueIso = new Date(at - 60 * 60_000 > now ? at - 60 * 60_000 : now).toISOString();
    for (const d of (devices ?? []) as Row[]) {
      const { data: have } = await service.from("push_events").select("id").eq("kind", "checkin_reminder")
        .eq("subject_id", r.id).eq("device_id", d.id).eq("route_target_id", r.owner).eq("occurrence", new Date(at).toISOString());
      if ((have ?? []).length) continue;
      const ins = await service.from("push_events").upsert({
        owner: other, device_id: d.id, kind: "checkin_reminder", subject_id: r.id, route_target_id: r.owner,
        due_at: dueIso, next_attempt_at: dueIso, state: "pending", occurrence: new Date(at).toISOString(),
      }, { onConflict: "owner,kind,subject_id,device_id" });
      if (ins.error) dbError(ins.error, "push_events.checkin");
      queued++;
    }
  }
  return { queued };
}

route("POST", "/internal/checkin/remind", async (ctx) => {
  const supplied = ctx.req.headers.get("x-presence-push-secret") ?? "";
  if (!ctx.env.pushDrainSecret || !(await secretEquals(supplied, ctx.env.pushDrainSecret))) {
    return json({ error: "not_found" }, 404);
  }
  if (!ctx.env.checkIn) return json({ queued: 0 });
  return json(await queueCheckInReminders(ctx.service));
}, false);
