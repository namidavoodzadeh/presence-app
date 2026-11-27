// V3 communication items (CPO spec 15 Nov, docs/engine/COMM-SPEC-DIGEST.md 4.1, 4.3, 4.5; contract docs/engine/COMM-CONTRACT.md).
// The owner's own items only: nothing here reads anyone else's. Behind the owner-only switch (PRESENCE_COMM_ITEMS plus the account ids in
// PRESENCE_COMM_OWNER_IDS; off and empty by default). No model call: an item the person typed or said in Talk is stored as they wrote it.
//   GET    /comm/items          the person's items: This week on top, then the kinds in the You order; empty kinds are absent
//   POST   /comm/items          { kind, wording, scope?, when?, expires_in_days?, topic?, source? }  add one (typed or said in Talk)
//   PATCH  /comm/items/:id      { kind?, wording?, scope?, when?, status?, expires_in_days?, topic?, still_true? }  change kind, re-word, re-scope, set aside, confirm
//   DELETE /comm/items/:id      delete one (the same undo window as every other kenning)
//   GET    /comm/suggestions    carry-over (spec 4.7): the next few kinds the background pass suggests for old kennings, strongest first (3), words and kind only
//   POST   /comm/suggestions/:id { action: "accept" | "dismiss" }  "That's me" writes the kind (scope stays exactly who has the grant today); dismiss keeps it under Other
// A new item lives in the existing `beliefs` row (migration 0069 columns). The old required columns get fixed compatibility values (type, kind,
// area), so no old reader breaks. Law 2: every item has one receipt, the person's own words with the day they said them. Law 8: a wording that
// shows risk stores nothing and answers with resources. Law 3: the person decides every status; the server never shares anything by itself.
// NOT built here: field-level encryption of lands_hard and this_week (docs/engine/COMM-MODEL-DESIGN.md), so the switch stays off for real people.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Ctx, route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";
import { RESOURCES } from "../engine/safety.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import { requireAiConsent } from "./lib/ai_consent.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import {
  COMM_KIND_COPY,
  COMM_KIND_ORDER,
  COMM_KINDS,
  COMM_STATUSES,
  COMM_TOPICS,
  type CommItem,
  commItemProblems,
  type CommKind,
  type CommScopeType,
  type CommSource,
  type CommStatus,
  defaultStatus,
  isExpired,
  ONE_PERSON_AT_A_TIME,
  SENSITIVE_KINDS,
  stillTrueDue,
  THIS_WEEK_CHOICES_DAYS,
  thisWeekExpiry,
} from "../engine/comm.ts";
import { checkBeforeSuggesting } from "../engine/comm_checks.ts";
import {
  type CarryOverRow,
  confirmedItem,
  type ExistingKenning,
  nextToConfirm,
  PLACEHOLDER,
} from "../engine/comm_carryover.ts";
import { type EligibilityItem, eligibleItems } from "./lib/card_eligibility.ts";
import { readEligibility } from "./lib/card_eligibility_reader.ts";

export const MAX_COMM_WORDING = 400;
/** The fixed values the old required columns take on a new item; the old model never reads them for these rows. */
const COMPAT = {
  type: "something I believe is true",
  kind: "everyday",
  area: "relationships",
  domains: [] as string[],
  birth_mood: "neutral",
} as const;
const UNDO_MS = 5000;
const COLUMNS =
  "id,owner,statement,own_wording,status,created_at,confirmed_at,comm_kind,comm_scope_type,comm_scope_value,comm_when,comm_expires_at,comm_last_confirmed_at,comm_status,comm_topic,comm_source,comm_hidden_from_map,card_eligibility_wording_hash,card_eligibility_sensitive";

export function requireCommAccess(ctx: Pick<Ctx, "env" | "caller">) {
  if (!ctx.env.commItems) throw new ApiError("forbidden", "", { reason: "feature_off" });
  if (!ctx.caller || !(ctx.env.commOwnerIds ?? []).includes(ctx.caller.id)) {
    throw new ApiError("forbidden", "", { reason: "owner_only" });
  }
}

function itemOf(b: Row, now: Date) {
  const last = (b.comm_last_confirmed_at as string | null) ?? null;
  return {
    id: b.id,
    kind: b.comm_kind,
    wording: b.own_wording ?? b.statement,
    scope: { type: b.comm_scope_type, value: b.comm_scope_value ?? null },
    when: b.comm_when ?? null,
    expires_at: b.comm_expires_at ?? null,
    last_confirmed_at: last,
    status: b.comm_status,
    topic: b.comm_topic ?? null,
    still_true_due: stillTrueDue(last, now),
    // v1.91: how the words came to be ("typed" or "talk_said"); null on an old kenning carried over (the date alone is its receipt). `dated_at` is the day they were typed or said.
    source: (b.comm_source as string | null | undefined) ?? null,
    dated_at: String(b.confirmed_at ?? b.created_at),
  };
}

/** The one server read for every card entry point and the Ask me preset picker.  The app must not re-implement this rule. */
function eligibilityItemOf(b: Row): EligibilityItem {
  const scopeType = String(b.comm_scope_type ?? "unset");
  const scope = b.comm_status === "private_only"
    ? "private"
    : scopeType === "everyone"
    ? "everyone"
    : scopeType === "type" && b.comm_scope_value === "family"
    ? "family"
    : scopeType === "type" && b.comm_scope_value === "friends"
    ? "friends"
    : scopeType === "type" && b.comm_scope_value === "coworker"
    ? "coworker"
    : scopeType === "person"
    ? "person"
    : "unset";
  const rating = String(b.rating ?? "");
  const status = b.comm_status === "set_aside"
    ? "set_aside"
    : b.status === "retired"
    ? "retired"
    : rating === "not"
    ? "not_me"
    : b.status === "confirmed" && rating === "partly"
    ? "partly"
    : b.comm_source === "typed" && b.status === "confirmed"
    ? "edited"
    : b.status === "confirmed"
    ? "confirmed"
    : "suggested";
  return {
    id: String(b.id),
    wording: String(b.own_wording ?? b.statement),
    kind: String(b.comm_kind),
    topic: b.comm_topic as string | null,
    scope,
    status,
    hiddenFromMap: b.comm_hidden_from_map === true,
  };
}

route("GET", "/comm/eligible-items", async (ctx) => {
  requireCommAccess(ctx);
  const surface = ctx.url.searchParams.get("surface");
  if (surface !== "card" && surface !== "ask") throw new ApiError("invalid", "", { field: "surface" });
  const { data, error } = await ctx.caller!.db.from("beliefs")
    .select(COLUMNS + ",rating").eq("owner", ctx.caller!.id).not("comm_kind", "is", null).order("created_at");
  if (error) dbError(error, "beliefs.comm_eligible");
  const rows = (data ?? []) as unknown as Row[];
  const read = await Promise.all(rows.map((row) => readEligibility(ctx, row, eligibilityItemOf(row))));
  const items = eligibleItems(read, surface);
  // The exact same eligible ids feed picker, Surprise me, pre-selection and each story/photo preview.
  return json({
    surface,
    items,
    question: surface === "ask" ? "Describe a time it happened." : null,
    adults_only: surface === "ask",
  });
});

function asScope(v: unknown): { type: CommScopeType; value: string | null } {
  if (v === undefined || v === null) return { type: "everyone", value: null };
  if (typeof v !== "object") throw new ApiError("invalid", "", { field: "scope" });
  const s = v as Record<string, unknown>;
  if (s.type !== "everyone" && s.type !== "type" && s.type !== "person") {
    throw new ApiError("invalid", "", { field: "scope" });
  }
  const value = s.value === undefined || s.value === null
    ? null
    : typeof s.value === "string"
    ? s.value
    : undefined;
  if (value === undefined) throw new ApiError("invalid", "", { field: "scope" });
  return { type: s.type, value };
}
function asWording(v: unknown): string {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!t || t.length > MAX_COMM_WORDING) throw new ApiError("invalid", "", { field: "wording" });
  return t;
}
function asDays(v: unknown): number {
  if (v === undefined || v === null) return 14;
  if (typeof v !== "number" || !THIS_WEEK_CHOICES_DAYS.includes(v)) {
    throw new ApiError("invalid", "", { field: "expires_in_days" });
  }
  return v;
}
function asWhen(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.trim().length > 120) throw new ApiError("invalid", "", { field: "when" });
  return v.replace(/\s+/g, " ").trim();
}

/** The verdicts of the 4.3 checks that keep an item out, as a reply with nothing stored. */
function refusal(v: Exclude<ReturnType<typeof checkBeforeSuggesting>, { ok: true }>): Response {
  if (v.action === "safety_route") return json({ item: null, state: "safety", resources: RESOURCES });
  if (v.action === "offer_request") return json({ item: null, state: "offer_request", offer: v.offer });
  if (v.action === "offer_i_statement") return json({ item: null, state: "offer_i_statement" });
  return json({ item: null, state: "not_kept" });
}

async function load(db: SupabaseClient, owner: string, id: string, columns: string = COLUMNS): Promise<Row> {
  const { data, error } = await db.from("beliefs").select(columns).eq("id", id).eq("owner", owner).neq(
    "status",
    "deleted",
  ).maybeSingle();
  if (error) dbError(error, "beliefs.comm");
  const row = data as unknown as Row | null;
  if (!row || !row.comm_kind) throw new ApiError("not_found", "", { where: "comm_item" });
  return row;
}

route("GET", "/comm/items", async (ctx) => {
  requireCommAccess(ctx);
  const now = new Date();
  const { data, error } = await ctx.caller!.db.from("beliefs").select(COLUMNS).eq("owner", ctx.caller!.id).eq(
    "status",
    "confirmed",
  )
    .not("comm_kind", "is", null).order("created_at");
  if (error) dbError(error, "beliefs.comm_list");
  const live = ((data ?? []) as Row[]).filter((b) =>
    !isExpired({ expiresAt: b.comm_expires_at as string | null }, now)
  );
  const byKind = (k: CommKind) =>
    live.filter((b) => b.comm_kind === k).sort((a, c) =>
      String(c.confirmed_at ?? c.created_at).localeCompare(String(a.confirmed_at ?? a.created_at))
    ).map((b) => itemOf(b, now));
  return json({
    this_week: byKind("this_week"),
    groups: COMM_KIND_ORDER.map((k) => ({
      kind: k,
      heading: COMM_KIND_COPY[k].heading,
      starter: COMM_KIND_COPY[k].starter,
      items: byKind(k),
    })).filter((g) => g.items.length),
  });
});

async function commWordsGate(ctx: Ctx, words: string): Promise<Response | null> {
  const g = await requireSafetyPass(ctx, words, "comm_items");
  if (g.routed === "unavailable") return json(unreadBody({ item: null }));
  if (g.stop) return json({ state: "safety", item: null, resources: RESOURCES });
  return null;
}

route("POST", "/comm/items", async (ctx) => {
  requireCommAccess(ctx);
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  if (!(COMM_KINDS as readonly unknown[]).includes(b.kind)) {
    throw new ApiError("invalid", "", { field: "kind" });
  }
  const kind = b.kind as CommKind;
  // Only the person's own statement may write an item here; inference (draft, Mirror, import, carry-over) has its own paths (4.5).
  const source = (b.source ?? "typed") as CommSource;
  if (source !== "typed" && source !== "talk_said") throw new ApiError("invalid", "", { field: "source" });
  const wording = asWording(b.wording);
  // The safety read is a model call only with the semantic switch on; then it waits for AI consent (package 01 routes.md, Not ready 6).
  if (ctx.env.safetySemantic === true) await requireAiConsent(ctx);
  const held = await commWordsGate(ctx, wording); // K-0002: the one safety gate, before anything is checked or stored
  if (held) return held;
  const scope = asScope(b.scope), when = asWhen(b.when);
  if (b.topic !== undefined && b.topic !== null && !(COMM_TOPICS as readonly unknown[]).includes(b.topic)) {
    throw new ApiError("invalid", "", { field: "topic" });
  }
  const topic = (b.topic as string | null | undefined) ?? null;
  const verdict = checkBeforeSuggesting({ text: wording, kind, source });
  if (!verdict.ok) return refusal(verdict);
  const now = new Date();
  const status: CommStatus = b.status === undefined
    ? defaultStatus(kind)
    : (COMM_STATUSES as readonly unknown[]).includes(b.status)
    ? b.status as CommStatus
    : (() => {
      throw new ApiError("invalid", "", { field: "status" });
    })();
  const item: CommItem = {
    kind,
    scopeType: scope.type,
    scopeValue: scope.value,
    status,
    when,
    topic,
    expiresAt: kind === "this_week" ? thisWeekExpiry(now, asDays(b.expires_in_days)) : null,
  };
  const problems = commItemProblems(item);
  if (problems.length) throw new ApiError("invalid", "", { field: "item", problems });
  const at = now.toISOString();
  const { data: row, error } = await db.from("beliefs").insert({
    owner,
    label: COMM_KIND_COPY[kind].heading,
    statement: wording,
    own_wording: wording,
    ...COMPAT,
    ...(topic ? { area: topic } : {}),
    status: "confirmed",
    rating: "very",
    confidence: 1,
    source: "own",
    rated_at: at,
    confirmed_at: at,
    comm_kind: kind,
    comm_scope_type: scope.type,
    comm_scope_value: scope.value,
    comm_when: when,
    comm_expires_at: item.expiresAt,
    comm_last_confirmed_at: at,
    comm_status: status,
    comm_topic: topic,
    comm_source: source,
    comm_native: true,
  }).select(COLUMNS).single();
  if (error) dbError(error, "beliefs.comm_insert");
  const { error: e2 } = await db.from("receipts").insert({
    owner,
    belief_id: row.id,
    quote: wording,
    said_at: at,
  });
  if (e2) {
    await db.from("beliefs").delete().eq("id", row.id).eq("owner", owner); // no receipt, no item (law 2)
    dbError(e2, "receipts.comm_insert");
  }
  return json({ item: itemOf(row as Row, now), state: "created" }, 201);
});

route("PATCH", "/comm/items/:id", async (ctx) => {
  requireCommAccess(ctx);
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  // `*`: the pending carry-over suggestion (0071) is read only to clear it when the person changes the kind, and must not be required before 0071.
  const cur = await load(db, owner, ctx.params.id, "*");
  const b = await ctx.body();
  const now = new Date(), at = now.toISOString();
  const patch: Row = {};
  // v1.91: Change kind is a PATCH. The person's own statement either way, so the checks run as for a typed item (4.3, with the new kind).
  let kind = cur.comm_kind as CommKind;
  const kindChanged = b.kind !== undefined && b.kind !== kind;
  if (b.kind !== undefined) {
    if (!(COMM_KINDS as readonly unknown[]).includes(b.kind)) {
      throw new ApiError("invalid", "", { field: "kind" });
    }
    kind = b.kind as CommKind;
  }
  let wording: string | null = null;
  if (b.wording !== undefined) {
    wording = asWording(b.wording);
    const held = await commWordsGate(ctx, wording);
    if (held) return held;
    patch.statement = wording;
    patch.own_wording = wording;
  }
  if (wording !== null || kindChanged) {
    // A re-worded item passes the same checks as a new one; a kind change re-checks today's words under the new kind. Nothing changes on a refusal.
    const v = checkBeforeSuggesting({
      text: wording ?? String(cur.own_wording ?? cur.statement),
      kind,
      source: "typed",
    });
    if (!v.ok) return refusal(v);
  }
  if (wording !== null) {
    // The words are now ones the person typed today: the receipt line reads "Typed" with today's date, as the new receipt row does.
    patch.comm_source = "typed";
    patch.confirmed_at = at;
  }
  let scopeType = cur.comm_scope_type as CommScopeType,
    scopeValue = (cur.comm_scope_value as string | null) ?? null;
  if (b.scope !== undefined) {
    const s = asScope(b.scope);
    scopeType = s.type;
    scopeValue = s.value;
    patch.comm_scope_type = s.type;
    patch.comm_scope_value = s.value;
  }
  if (b.when !== undefined) patch.comm_when = asWhen(b.when);
  let status = cur.comm_status as CommStatus;
  if (b.status !== undefined) {
    if (!(COMM_STATUSES as readonly unknown[]).includes(b.status)) {
      throw new ApiError("invalid", "", { field: "status" });
    }
    status = b.status as CommStatus;
    patch.comm_status = status;
  } else if (
    kindChanged && status === "active" &&
    (SENSITIVE_KINDS.includes(kind) || (ONE_PERSON_AT_A_TIME.includes(kind) && scopeType !== "person"))
  ) {
    // Changing kind never widens who reads it (law 3, 10): into a sensitive kind, or one that is shared with one person at a time, an active item goes private until the person says otherwise.
    status = "private_only";
    patch.comm_status = status;
  }
  let expiresAt = (cur.comm_expires_at as string | null) ?? null;
  if (b.expires_in_days !== undefined && kind !== "this_week") {
    throw new ApiError("invalid", "", { field: "expires_in_days" });
  }
  if (kind === "this_week" && (b.expires_in_days !== undefined || (kindChanged && !expiresAt))) {
    expiresAt = thisWeekExpiry(now, asDays(b.expires_in_days));
    patch.comm_expires_at = expiresAt;
  } else if (kindChanged && kind !== "this_week" && expiresAt) {
    expiresAt = null;
    patch.comm_expires_at = null;
  }
  if (b.still_true === true) patch.comm_last_confirmed_at = at;
  else if (b.still_true !== undefined) throw new ApiError("invalid", "", { field: "still_true" });
  let topic = b.topic !== undefined
    ? ((b.topic === null || (COMM_TOPICS as readonly unknown[]).includes(b.topic))
      ? (b.topic as string | null)
      : (() => {
        throw new ApiError("invalid", "", { field: "topic" });
      })())
    : ((cur.comm_topic as string | null) ?? null);
  if (b.topic !== undefined) {
    patch.comm_topic = topic;
    patch.area = topic ?? COMPAT.area;
  } else if (kindChanged && kind !== "matters" && topic) {
    topic = null;
    patch.comm_topic = null;
    patch.area = COMPAT.area;
  }
  if (kindChanged) {
    patch.comm_kind = kind;
    patch.label = COMM_KIND_COPY[kind].heading;
    // The person has answered a pending carry-over suggestion by choosing; it is cleared and does not come back. Choosing is also a confirmation of the item.
    if (cur.comm_suggestion) patch.comm_suggestion = null;
    if (b.still_true === undefined) patch.comm_last_confirmed_at = at;
  }
  if (!Object.keys(patch).length) throw new ApiError("invalid", "", { field: "body" });
  const problems = commItemProblems({
    kind,
    scopeType,
    scopeValue,
    status,
    expiresAt,
    topic,
    when: (patch.comm_when ?? cur.comm_when) as string | null,
  });
  if (problems.length) throw new ApiError("invalid", "", { field: "item", problems });
  const { data: row, error } = await db.from("beliefs").update(patch).eq("id", cur.id).eq("owner", owner)
    .select(COLUMNS).single();
  if (error) dbError(error, "beliefs.comm_update");
  // A new wording is a new thing the person said: one more receipt with today's date; the old receipts stay (law 2).
  if (wording) {
    const { error: e2 } = await db.from("receipts").insert({
      owner,
      belief_id: cur.id,
      quote: wording,
      said_at: at,
    });
    if (e2) dbError(e2, "receipts.comm_update");
  }
  // PSY 19 Nov: a published Ask depends on its source's status and scope.  Close intake silently when the source
  // is set aside or narrowed; contributions already received remain untouched in their existing Mirror rows.
  const changedSource = eligibilityItemOf(row as Row);
  if (
    changedSource.status === "set_aside" || changedSource.status === "retired" ||
    ["person", "private", "unset"].includes(changedSource.scope)
  ) {
    const { error: closeError } = await db.from("mirror_links").update({ enabled: false, paused: true })
      .eq("owner", owner).eq("ask_source_item_id", cur.id);
    if (closeError) dbError(closeError, "mirror_links.ask_source_close");
  }
  return json({ item: itemOf(row as Row, now) });
});

route("DELETE", "/comm/items/:id", async (ctx) => {
  requireCommAccess(ctx);
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const cur = await load(db, owner, ctx.params.id);
  const { error } = await db.from("beliefs").update({
    status: "deleted",
    previous_status: cur.status,
    deleted_at: new Date().toISOString(),
  }).eq("id", cur.id).eq("owner", owner);
  if (error) dbError(error, "beliefs.comm_delete");
  // Deleting/retiring the source is also a source change: close intake, retain all received answers, notify nobody.
  const { error: closeError } = await db.from("mirror_links").update({ enabled: false, paused: true })
    .eq("owner", owner).eq("ask_source_item_id", cur.id);
  if (closeError) dbError(closeError, "mirror_links.ask_source_delete");
  return json({ deleted: cur.id, undo_until: new Date(Date.now() + UNDO_MS).toISOString() });
});

// ---------------------------------------------------------------- carry-over suggestions (spec 4.7)
const SUGG_COLUMNS = COLUMNS + ",comm_suggestion";
type Sugg = { kind: CommKind; confidence: number; topic: string | null };
const suggOf = (b: Row): Sugg | null => {
  const s = b.comm_suggestion as Partial<Sugg> | null | undefined;
  return s && typeof s.kind === "string" && typeof s.confidence === "number"
    ? { kind: s.kind, confidence: s.confidence, topic: s.topic ?? null }
    : null;
};

route("GET", "/comm/suggestions", async (ctx) => {
  requireCommAccess(ctx);
  const { data, error } = await ctx.caller!.db.from("beliefs").select(SUGG_COLUMNS).eq(
    "owner",
    ctx.caller!.id,
  ).eq("status", "confirmed")
    .eq("comm_kind", "other").not("comm_suggestion", "is", null).order("created_at");
  if (error) dbError(error, "beliefs.comm_suggestions");
  const rows: CarryOverRow[] = [];
  const wording = new Map<string, string>();
  for (const b of (data ?? []) as unknown as Row[]) {
    const s = suggOf(b);
    if (!s) continue;
    rows.push({ id: String(b.id), placeholder: PLACEHOLDER, suggestion: s, skipped: null });
    wording.set(String(b.id), String(b.own_wording ?? b.statement));
  }
  // Never a count, a total or a progress figure (spec 4.7): only the next few, with their words and the offered kind.
  return json({
    suggestions: nextToConfirm(rows, 3).map((r) => ({
      id: r.id,
      wording: wording.get(r.id),
      kind: r.suggestion!.kind,
      heading: COMM_KIND_COPY[r.suggestion!.kind].heading,
      topic: r.suggestion!.topic,
    })),
  });
});

route("POST", "/comm/suggestions/:id", async (ctx) => {
  requireCommAccess(ctx);
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  if (b.action !== "accept" && b.action !== "dismiss") throw new ApiError("invalid", "", { field: "action" });
  const { data, error } = await db.from("beliefs").select(SUGG_COLUMNS).eq("id", ctx.params.id).eq(
    "owner",
    owner,
  ).eq("status", "confirmed").maybeSingle();
  if (error) dbError(error, "beliefs.comm_suggestion");
  const cur = data as unknown as Row | null, sugg = cur ? suggOf(cur) : null;
  if (!cur || cur.comm_kind !== "other" || !sugg) {
    throw new ApiError("not_found", "", { where: "comm_suggestion" });
  }
  const now = new Date();
  if (b.action === "dismiss") {
    // The item stays under Other, private to the comm model, shared exactly as before; the suggestion is gone and never comes back.
    const { data: row, error: e } = await db.from("beliefs").update({ comm_suggestion: null }).eq(
      "id",
      cur.id,
    ).eq("owner", owner).select(COLUMNS).single();
    if (e) dbError(e, "beliefs.comm_suggestion_dismiss");
    return json({ item: itemOf(row as Row, now), state: "dismissed" });
  }
  const wording = String(cur.own_wording ?? cur.statement);
  // The same checks as the pass, again, on today's wording: a wording changed since the pass, or a rule since tightened, keeps it under Other.
  const v = checkBeforeSuggesting({
    text: wording,
    kind: sugg.kind,
    source: "carry_over",
    confidence: sugg.confidence,
  });
  if (!v.ok) return refusal(v);
  const { data: g, error: ge } = await db.from("share_items").select("other").eq("belief_id", cur.id).eq(
    "owner",
    owner,
  );
  if (ge) dbError(ge, "share_items.comm_suggestion");
  const k: ExistingKenning = {
    id: String(cur.id),
    wording,
    grantedTo: ((g ?? []) as unknown as Row[]).map((r) => String(r.other)),
  };
  const item = confirmedItem(k, sugg, now);
  const problems = commItemProblems(item);
  if (problems.length) throw new ApiError("invalid", "", { field: "item", problems });
  const patch: Row = {
    comm_kind: item.kind,
    comm_scope_type: item.scopeType,
    comm_scope_value: item.scopeValue,
    comm_status: item.status,
    comm_topic: item.topic,
    comm_last_confirmed_at: item.lastConfirmedAt,
    comm_suggestion: null,
    ...(item.topic ? { area: item.topic } : {}),
  };
  const { data: row, error: e } = await db.from("beliefs").update(patch).eq("id", cur.id).eq("owner", owner)
    .select(COLUMNS).single();
  if (e) dbError(e, "beliefs.comm_suggestion_accept");
  return json({ item: itemOf(row as Row, now), state: "accepted" });
});
