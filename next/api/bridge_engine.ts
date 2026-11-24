// Bridge, the engine half (CONTRACT §6 Writing; engine items 6–8): insight (one Haiku call: spans and tone), run (Sonnet:
// analyse → plan → rewrite → verify, with changes, points kept, outcome and the bridged tone), reword one part, and
// "say why it matters". Receiver-aware rewriting is off: nothing here reads the receiver's map. Threats are not carried.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Belief, Feeling, ModelExchange } from "../engine/types.ts";
import { AnthropicClient, extractJson } from "../engine/model/client.ts";
import type { ModelClient } from "../engine/model/client.ts";
import { analyse, toneOf } from "../engine/bridge/analyse.ts";
import { ASK_UNRESOLVED_LINE, bridgeDraft, floorSafety } from "../engine/bridge/bridge.ts";
import { AIMED_AT_RECEIVER, buildInsight, flaggedSpans, INSIGHT_COPY, locate, refusal } from "../engine/bridge/insight.ts";
import { buildHighlights, CHECKED_LINE, type Highlight, summaryLine } from "../engine/bridge/highlights.ts";
import { DECLINE_LINE } from "../engine/bridge/plan.ts";
import { RELATIONSHIPS } from "../engine/bridge/types.ts";
import type { BridgeTrace, Draft, ReceiverBelief, Relationship, Sender } from "../engine/bridge/types.ts";
import { BRIDGE_REWORD, BRIDGE_WHY } from "../engine/prompt_text.ts";
import { RESOURCES } from "../engine/safety.ts";
import { classReadings, semanticRisk } from "../engine/safety_semantic.ts";
import type { SemanticRisk } from "../engine/safety_semantic.ts";
import { candidateClasses, settleClear } from "../engine/safety_classes.ts";
import { redactTalkExchange } from "../engine/talk/redact.ts";
import { cardWordHits, clinicalHits, words } from "../engine/words.ts";
import { route, type Ctx } from "./lib/router.ts";
import { ApiError, json, recordError } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import { pickFromMe } from "../engine/comm_fit.ts";
import { isExpired } from "../engine/comm.ts";
import { PostgresLedger, recordEngineCall, type LedgerScope } from "./lib/ledger.ts";
import { loadPairContext } from "./pair_context.ts";
import { runWritePipeline, type WriteInput } from "../engine/bridge/write_pipeline.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";

export const INSIGHT_MODEL = "claude-haiku-5-5";        // APP-V1-BUILD §3: insight on Haiku, small and fast
export const RUN_MODEL = "claude-sonnet-5-5";           // Bridge it on Sonnet (8/12 vs Haiku's 1/6)
export const MIN_INSIGHT_CHARS = 12;
export const MAX_TEXT = 4000;

/** Test seam, as in talk.ts: a $0 check swaps both models for recorded ones. */
export const hooks: { client: ((ctx: Ctx, ledger: PostgresLedger, model: "insight" | "run") => ModelClient) | null } = { client: null };

export function clientFor(ctx: Ctx, ledger: PostgresLedger, which: "insight" | "run"): ModelClient {
  if (hooks.client) return hooks.client(ctx, ledger, which);
  if (!ctx.env.anthropicKey || !ctx.env.anthropicWorkspace) throw new ApiError("unreachable", "Can't reach Presence right now.", { detail: "anthropic key or workspace not configured" });
  const config = { key: ctx.env.anthropicKey, workspace: ctx.env.anthropicWorkspace };
  return which === "insight"
    ? new AnthropicClient({ config, ledger, defaultModel: INSIGHT_MODEL, fallbackModel: null, thinking: "disabled", timeoutMs: 30_000 })
    : new AnthropicClient({ config, ledger, defaultModel: RUN_MODEL, thinking: "between_tools", timeoutMs: 55_000 });
}

export function scopeFor(ctx: Ctx): LedgerScope { return { person: ctx.caller!.id, ownerPreview: ctx.caller!.isPreview, conversationId: null, feature: "bridge" }; }

/**
 * The safety reader's system prompt is fixed code, identified by the release on
 * the ledger row. Keeping its 7 KiB source in every trace needlessly serialises
 * it again after a response. The person's message and model response retain
 * the normal redacted length-and-hash receipts.
 */
export async function traceExchange(exchange: ModelExchange, redact = false): Promise<ModelExchange> {
  const safe = redact ? await redactTalkExchange(exchange) : exchange;
  if (safe.purpose !== "safety") return safe;
  return { ...safe, request: { ...safe.request, system: "[fixed safety reader prompt; see release source]" } };
}

export async function trace(ctx: Ctx, scope: LedgerScope, ledger: PostgresLedger, exchanges: ModelExchange[], ref: string | null = null, redact = false) {
  const ids = [...ledger.ids.values()];
  for (let i = 0; i < exchanges.length; i++) await recordEngineCall(ctx.service, scope, await traceExchange(exchanges[i], redact), ids[i] ?? null, ref);
}

/** Deferred trace writes still running (test seam: `await drainAfterReply()` before reading the ledger). */
const afterReplyPending = new Set<Promise<unknown>>();
export async function drainAfterReply(): Promise<void> { while (afterReplyPending.size) await Promise.allSettled([...afterReplyPending]); }

/**
 * QA-B298 option (b): the trace is diagnostics, so it leaves the critical path. The reply returns first; the write runs
 * after it (EdgeRuntime.waitUntil on the hosted runtime, so the isolate is kept alive until it ends). The ledger ids are
 * read now, while the calls are fresh. A failed write is logged, never raised: it can't change what the person sees.
 */
export function traceAfterReply(ctx: Ctx, scope: LedgerScope, ledger: PostgresLedger, exchanges: ModelExchange[], redact = false): void {
  const ids = [...ledger.ids.values()];
  afterReply("bridge trace write", async () => {
    for (let i = 0; i < exchanges.length; i++) await recordEngineCall(ctx.service, scope, await traceExchange(exchanges[i], redact), ids[i] ?? null, null);
  });
}

/** Run a write after the reply is built; keep the isolate alive for it on the hosted runtime; log, never raise, on failure. */
export function afterReply(what: string, work: () => Promise<void>): void {
  const job = work().catch((e) => console.error(`${what} failed`, e instanceof Error ? e.message : "unknown"));
  afterReplyPending.add(job);
  void job.finally(() => afterReplyPending.delete(job));
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(job);
}

/** QA-B240: what an insight reply depends on. Same key = same draft, same map, same mode: the saved reply is still right. */
export async function insightKey(text: string, relationship: string, beliefs: Belief[], wording: boolean): Promise<string> {
  const map = beliefs.map((b) => [b.id, b.status, b.label, b.statement]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  const bytes = new TextEncoder().encode(JSON.stringify([text, relationship, wording, map]));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** The saved reply for this exact draft, or null. `seq` is the caller's, never stored. */
export async function savedInsight(db: SupabaseClient, owner: string, other: string, key: string, seq: number | null): Promise<Record<string, unknown> | null> {
  const { data } = await db.from("drafts").select("insight, insight_key").eq("owner", owner).eq("other", other).maybeSingle();
  const saved = data?.insight_key === key ? data.insight as Record<string, unknown> | null : null;
  return saved && saved.state === "insight" ? { ...saved, seq, saved: true } : null;
}

/** Save a finished reply on the draft row, only if the row still holds this very text (no draft is ever created here, DV-16). */
export function saveInsightAfterReply(ctx: Ctx, owner: string, other: string, text: string, key: string, reply: Record<string, unknown>): void {
  if (reply.state !== "insight" || reply.outcome === "could_not_bridge") return;
  const { seq: _seq, saved: _saved, ...stored } = reply;
  afterReply("bridge insight save", async () => {
    await ctx.service.from("drafts").update({ insight: stored, insight_key: key, insight_at: new Date().toISOString() }).eq("owner", owner).eq("other", other).eq("text", text);
  });
}

/** `unreadSafe`: the route has the unavailable state (the safety check is on and the route reads its answer, PSY 16 Nov 2c-2d). A full
 *  provider outage then is that state, shown with the help line, never an error before the route can answer; only the cap still throws. */
export function refused(ledger: PostgresLedger, exchanges: ModelExchange[], unreadSafe = false): never | void {
  if (exchanges.length && exchanges.every((e) => e.error && !e.rawResponse)) {
    if (exchanges.some((e) => e.error?.startsWith("budget_unavailable"))) throw ledger.refusalError("bridge");
    if (unreadSafe) return;
    const transport = exchanges.every((e) => /^(?:network|timeout)/.test(e.error ?? ""));
    throw new ApiError(transport ? "unreachable" : "engine_failed", "Presence couldn't read this one just now.", { detail: exchanges.at(-1)?.error });
  }
}

export function textOf(b: Record<string, unknown>, field = "text"): string {
  const t = typeof b[field] === "string" ? (b[field] as string) : "";
  if (!t.trim()) throw new ApiError("invalid", "", { field });
  if (t.length > MAX_TEXT) throw new ApiError("invalid", "", { field, max: MAX_TEXT });
  return t;
}

/** The only Bridge context door.  The map is the sender's own map; everything about
 * the receiver comes from the pair loader and is grant-, scope- and consent-checked. */
async function senderFromPairContext(db: SupabaseClient, owner: string, personId: string): Promise<{ sender: Sender; relationship: Relationship; writeInput: Omit<WriteInput, "draft"> }> {
  // Keep these sequential: an RLS/database rejection must be the one returned
  // to the route, never a second unhandled query rejection.
  const pair = await loadPairContext(db, owner, personId, undefined, undefined, true);
  const [sent, priorWrite] = await Promise.all([
    db.from("bridges").select("final").eq("sender", owner).eq("receiver", personId).neq("status", "withdrawn").order("created_at", { ascending: false }).limit(3),
    db.from("drafts").select("owner").eq("owner", owner).eq("other", personId).maybeSingle(),
  ]);
  const shared: ReceiverBelief[] = (pair.receiver?.items ?? []).map((x) => ({ id: x.id, label: x.words, statement: x.words, sharedItem: true }));
  const relationship = (RELATIONSHIPS as readonly string[]).includes(pair.relationship) ? pair.relationship as Relationship : "friend";
  if (!pair.sender.map) throw new ApiError("engine_failed", "Presence couldn't read this one just now.", { detail: "pair sender map missing" });
  const ownItems = Object.values(pair.sender.itemsByKind).flat().map((x) => ({ id: x.id, kind: x.kind ?? "other", words: x.words }));
  const receiverItems = (pair.receiver?.items ?? []).map((x) => ({ id: x.id, kind: x.kind ?? "other", words: x.words }));
  return { relationship, sender: { personaId: owner, firstName: pair.sender.name || "I", map: pair.sender.map, earlierMessages: ((sent.data ?? []) as { final?: string }[]).map((b) => String(b.final ?? "")),
    receiverShared: shared.map((x) => x.statement), receiverBeliefs: shared, receiverFirstName: pair.receiver?.name ?? "" },
    writeInput: { sender: { name: pair.sender.name || "I", items: ownItems }, receiver: { name: pair.receiver?.name ?? "", items: receiverItems }, firstSession: !priorWrite.data, softeningOnly: pair.receiver?.softeningOnly.forSoftening().map((x) => ({ id: x.id, kind: x.kind ?? "lands_hard", words: x.words })) ?? [] } };
}

/** V3's owner switch: no non-owner takes the new receiver-aware Write path. */
export function ownerWriteV3(ctx: Ctx): boolean {
  return ctx.env.commItems === true && !!ctx.caller && (ctx.env.commOwnerIds ?? []).includes(ctx.caller.id);
}

function pointObjects(points: { kind: string; quote: string }[], missing: string[] = []) {
  return points.map((p) => ({ kind: p.kind, quote: p.quote, kept: !missing.some((m) => m.toLowerCase().includes(p.quote.toLowerCase()) || p.quote.toLowerCase().includes(m.toLowerCase())) }));
}

/** B05 review action for an ask the sender's words do not state (QA-B6). */
export function bridgeReviewHint(askUnresolved: boolean): {
  ask_unresolved: boolean;
  next_step: "add_ask" | null;
} {
  return { ask_unresolved: askUnresolved, next_step: askUnresolved ? "add_ask" : null };
}

// ------------------------------------------------------------------ POST /bridge/insight

const INSIGHT_BODY_FIELDS = new Set(["person_id", "text", "seq", "with_wording", "refresh"]);

/**
 * CPO d-cpo-bridge-insight-spec-06nov: the draft and the relationship (read server-side from the link) only. No
 * receiver field of any kind is accepted, named or not; an unknown key refuses the whole call rather than being
 * silently ignored. Exported so a Tier 1 test can check it without a database.
 */
export function requireOnlyInsightFields(b: Record<string, unknown>): void {
  for (const key of Object.keys(b)) {
    if (!INSIGHT_BODY_FIELDS.has(key)) throw new ApiError("invalid", "", { field: key });
  }
  insightSeq(b);
  withWording(b);
  if (b.refresh !== undefined && b.refresh !== null && typeof b.refresh !== "boolean") throw new ApiError("invalid", "", { field: "refresh" });
}

/** E35: opt in to Bridge's wording and the highlights in the same reply (one call for the window). Absent = false. */
export function withWording(b: Record<string, unknown>): boolean {
  if (b.with_wording === undefined || b.with_wording === null) return false;
  if (typeof b.with_wording !== "boolean") throw new ApiError("invalid", "", { field: "with_wording" });
  return b.with_wording;
}

/** DV-16: the app's draft counter, echoed back so a reply for an older draft is dropped on the phone. Not stored. */
export function insightSeq(b: Record<string, unknown>): number | null {
  if (b.seq === undefined || b.seq === null) return null;
  if (typeof b.seq !== "number" || !Number.isInteger(b.seq) || b.seq < 0 || b.seq > 2_147_483_647) throw new ApiError("invalid", "", { field: "seq" });
  return b.seq;
}

/** The underlined parts of a draft: each friction, and each confirmed belief the draft touches (shared by the plain and the with-wording reply). */
export function insightSpans(text: string, insight: ReturnType<typeof buildInsight>, analysis: NonNullable<Awaited<ReturnType<typeof analyse>>["analysis"]>, beliefs: Belief[]): Record<string, unknown>[] {
  const spans: Record<string, unknown>[] = insight.frictions.map((f) => ({ kind: "friction", start: f.start, end: f.end, friction_kind: f.kind, note: f.howItLands, belief_id: null, label: null }));
  const endorsed = new Map(beliefs.filter((x) => x.status === "endorsed").map((x) => [x.id, x]));
  for (const t of analysis.activated) {
    const belief = endorsed.get(t.beliefId);
    const span = belief && t.quote ? locate(text, t.quote) : null;
    if (!belief || !span) continue;
    spans.push({ kind: "belief", start: span.start, end: span.end, friction_kind: null, note: `This touches ${belief.label} on your map.`, belief_id: belief.id, label: belief.label });
  }
  spans.sort((x, y) => Number(x.start) - Number(y.start));
  return spans;
}

/**
 * v1.91 (app Q-APP-P4-1 (2)): when the receiver shared nothing, the live insight reply carries `from_me`, at most one of the SENDER'S OWN
 * "How I mean things" items that fits the draft (`{item_id, wording}`, chosen here by shared words, no model; shared with this person or not,
 * since only the sender sees it), else null. Only with the comm owner switch on for the caller, so every other reply is byte for byte as before.
 * Safety, declined and unavailable replies never carry it. The reply that is saved for an unchanged draft is stored without it and gets it fresh each time.
 */
export async function withFromMe(ctx: Ctx, reply: Record<string, unknown>, text: string, receiverSharedNothing: boolean): Promise<Record<string, unknown>> {
  if (!ctx.env.commItems || !ctx.caller || !(ctx.env.commOwnerIds ?? []).includes(ctx.caller.id) || reply.state !== "insight") return reply;
  if (!receiverSharedNothing) return { ...reply, from_me: null };
  const { data, error } = await ctx.caller.db.from("beliefs").select("id,own_wording,statement,comm_status,comm_expires_at,confirmed_at,created_at")
    .eq("owner", ctx.caller.id).eq("status", "confirmed").eq("comm_kind", "how_i_mean").in("comm_status", ["active", "private_only"]);
  if (error) dbError(error, "beliefs.from_me");
  const now = new Date();
  const items = ((data ?? []) as unknown as Record<string, unknown>[]).filter((b) => !isExpired({ expiresAt: b.comm_expires_at as string | null }, now))
    .map((b) => ({ id: String(b.id), wording: String(b.own_wording ?? b.statement ?? ""), datedAt: String(b.confirmed_at ?? b.created_at ?? "") }));
  const hit = pickFromMe(text, items);
  return { ...reply, from_me: hit ? { item_id: hit.id, wording: hit.wording } : null };
}

route("POST", "/bridge/insight", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  requireOnlyInsightFields(b);
  if (typeof b.person_id !== "string") throw new ApiError("invalid", "", { field: "person_id" });
  const text = textOf(b);
  const seq = insightSeq(b);
  const empty = { seq, state: "insight", tone: "neutral" as Feeling, spans: [], points: [], line: null, resources: null, ref: null };
  if (text.trim().length < MIN_INSIGHT_CHARS) return json(empty);
  let floor = floorSafety(text);
  // PSY 15 Nov ruling 2 (as in Talk and Bridge): a candidate floor row clears only with two keys, two parallel readings read alone
  // before the analysis; with the semantic check off by config nothing clears.
  let classReading: SemanticRisk | null = null;
  if (floor.routed !== "none" && ctx.env.safetySemantic === true && candidateClasses(text, floor).length) {
    const both = await classReadings(clientFor(ctx, new PostgresLedger(ctx.service, scopeFor(ctx)), "insight"), text);
    classReading = both[0];
    const cleared = settleClear(text, floor, both);
    if (cleared) { floor = { risk: "none", reason: `cleared: ${cleared}`, routed: "none" }; }
  }
  if (floor.routed === "risk") return json({ ...empty, state: "risk", line: RESOURCES.message, resources: RESOURCES });
  if (floor.routed === "threat_or_abuse") { return json({ ...empty, state: "declined", line: DECLINE_LINE, ...refusal(flaggedSpans(text, null, floor)) }); }
  const scope = scopeFor(ctx), ledger = new PostgresLedger(ctx.service, scope);
  // K-0152: V3 previously read every draft twice: first its required semantic
  // reader, then helperStop's independent classifier. Reuse the mandatory
  // semantic result below before a pair read or Write. It is the stronger
  // existing reader and still fails closed; this only removes duplicate work.
  const insightClient = clientFor(ctx, ledger, "insight");
  const semantic = classReading ?? await semanticRisk(insightClient, text);
  const semanticExchanges = semantic.exchange ? [semantic.exchange] : [];
  traceAfterReply(ctx, scope, ledger, semanticExchanges, true);
  refused(ledger, semanticExchanges, true);
  if (!semantic.ok) {
    return json({ ...empty, ...unreadBody(), error_code: "insight_unavailable", ref: null });
  }
  if (semantic.risk !== "none") {
    if (semantic.risk === "others" && AIMED_AT_RECEIVER.test(text)) return json({ ...empty, state: "declined", line: DECLINE_LINE, ...refusal(flaggedSpans(text, null, { routed: "threat_or_abuse" })) });
    return json({ ...empty, state: "risk", line: RESOURCES.message, resources: RESOURCES });
  }
  const { sender, relationship, writeInput } = await senderFromPairContext(db, owner, b.person_id);
  if (ownerWriteV3(ctx)) {
    // V3 replaces both former Write branches for the owner. Its route contract
    // is intentionally quiet: no valid note is represented by tier 0.
    const read = clientFor(ctx, ledger, "insight"), write = clientFor(ctx, ledger, "run");
    const v3 = await runWritePipeline({ ...writeInput, draft: text }, { mode: "real", clients: { read, write, verify: read } });
    return json({ ...empty, tier: v3.tier, note: v3.note ?? null, suggested_change: v3.suggestedChange ?? null, item_id: v3.itemId ?? null, purpose: v3.purpose ?? null });
  }
  // QA-B240: an unchanged, already-analysed draft returns its saved reply; `refresh: true` recomputes with today's map.
  const wording = withWording(b), key = await insightKey(text, relationship, sender.map.beliefs, wording);
  const nothingShared = (sender.receiverBeliefs ?? []).length === 0;
  if (b.refresh !== true) { const saved = await savedInsight(db, owner, b.person_id, key, seq); if (saved) return json(await withFromMe(ctx, saved, text, nothingShared)); }
  if (wording) {
    // E35: ONE call returns the insight and Bridge's wording. The full pipeline runs on the run model; its own analysis is the insight.
    const reply = await liveWordingReply(clientFor(ctx, ledger, "run"), text, seq, relationship, sender, {
      after: (exchanges) => { traceAfterReply(ctx, scope, ledger, exchanges, true); refused(ledger, exchanges, true); return Promise.resolve(); },
      failure: (detail) => recordError(ctx.service, owner, "bridge/insight", "could_not_bridge", detail),
      semanticCheck: true,
    });
    saveInsightAfterReply(ctx, owner, b.person_id, text, key, reply);
    return json(await withFromMe(ctx, reply, text, nothingShared));
  }
  // K-0152: hosted v92 logged CPU Time exceeded (HTTP 546, surfaced as 503) while a
  // held-out safety probe ran the semantic reader and the 1,500-token analysis together.
  // Read safety first: a stop or an unreadable read must not also spend CPU analysing
  // the same words. This is still add-only and fail-closed; a clear is the only route
  // that reaches analysis.
  const a = await analyse(insightClient, text, relationship, sender.map.beliefs);
  traceAfterReply(ctx, scope, ledger, a.exchanges, true);
  refused(ledger, a.exchanges, true);
  if (!a.analysis) {
    // E26 P0 (06 Nov, CEO, Nami's report): analyse() already retried once internally (the repair call above); both
    // attempts failed. Never a blank "insight" with nothing in it — a distinct state the app shows Retry for.
    const ref = await recordError(ctx.service, owner, "bridge/insight", "unreadable", a.failed ?? "no analysis");
    return json({ ...empty, state: "unavailable", error_code: "insight_unavailable", ref });
  }
  const analysis = a.analysis;
  if (analysis.safety === "risk") return json({ ...empty, state: "risk", line: RESOURCES.message, resources: RESOURCES });
  if (analysis.safety === "threat_or_abuse") { return json({ ...empty, state: "declined", line: DECLINE_LINE, ...refusal(flaggedSpans(text, analysis, null)) }); }
  const insight = buildInsight(text, analysis, sender.map.beliefs, "none");
  const spans = insightSpans(text, insight, analysis, sender.map.beliefs);
  // Card A: "Presence hears:" at most 3 points, one line each (CPO spec). Card C's 2-and-confirmed cap already
  // lives in buildInsight, so insight.touches needs no further trimming here.
  const reply = { seq, state: "insight", tone: analysis.tone ?? toneOf(undefined, analysis.feeling.name), spans, points: pointObjects(analysis.points).slice(0, 3),
    // E26 P0 item 4: no friction found keeps a calm line (never a blank "what might get in the way"), never the
    // softer Bridged version sent or applied here — that stays POST /bridge/run, one tap away.
    touches: insight.touches.map((t) => ({ belief_id: t.beliefId, label: t.label, statement: t.gentleStatement })), line: insight.line, resources: null, ref: null };
  saveInsightAfterReply(ctx, owner, b.person_id, text, key, reply);
  return json(await withFromMe(ctx, reply, text, nothingShared));
});

/**
 * E35 (app Q-B4 option a): the live insight reply plus `bridged`, `highlights[]`, `summary` and `words_changed` (the v1.42
 * shapes, UTF-16 offsets into `text`). Same states as the plain reply. The floor ran before this; a safety reading from the
 * model stops it with no wording and no highlights (law 8). `bridged` is null when Bridge has no wording to offer.
 */
export async function liveWordingReply(client: ModelClient, text: string, seq: number | null, relationship: Relationship, sender: Sender, hooks: RunHooks): Promise<Record<string, unknown>> {
  let captured: BridgeTrace | null = null;
  const out = await runReply(client, text, relationship, sender, { ...hooks, trace: (t) => { captured = t; hooks.trace?.(t); } });
  const empty = { seq, state: "insight", tone: "neutral" as Feeling, spans: [], points: [], line: null, resources: null, ref: null,
    bridged: null, highlights: [] as Highlight[], summary: null, words_changed: false };
  if (out.outcome === "wont_carry") return { ...empty, state: "declined", line: DECLINE_LINE, spans: out.spans, headline: out.headline, counts: out.counts };
  if (out.outcome === "unavailable") return { ...empty, ...unreadBody(), error_code: "insight_unavailable", ref: null };
  if (out.safety === "risk") return { ...empty, state: "risk", line: RESOURCES.message, resources: RESOURCES };
  const t = captured as BridgeTrace | null;
  if (!t?.analysis) return { ...empty, state: "unavailable", error_code: "insight_unavailable", ref: out.ref };
  const insight = t.insight ?? buildInsight(text, t.analysis, sender.map.beliefs, "none");
  const bridged = out.outcome === "ok" && out.words_changed === true ? out.bridged : null;
  return { seq, state: "insight", tone: (out.tone as { original: Feeling }).original, spans: insightSpans(text, insight, t.analysis, sender.map.beliefs),
    points: pointObjects(t.analysis.points).slice(0, 3), touches: insight.touches.map((x) => ({ belief_id: x.beliefId, label: x.label, statement: x.gentleStatement })),
    line: insight.line, resources: null, ref: null, bridged, highlights: out.highlights, summary: out.summary, words_changed: bridged !== null,
    outcome: out.outcome === "could_not_bridge" ? "could_not_bridge" : out.outcome };
}

// ------------------------------------------------------------------ POST /bridge/run

/**
 * v1.51: ONE from_them entry per reply may carry the receiver's own shared item, word for word, as the owner approved it
 * for this sender (a per-item grant, v1.52), labelled "From what <Name> shared:". Only a grant-backed belief qualifies
 * (`sharedItem`); a belief read through the old area share, a private wording or a receipt never does. The grants were read
 * from the live table for this very call, so a revoked share is simply not in `receiverBeliefs`. Only the item id is kept.
 */
export function attachSharedQuote(out: Record<string, unknown>, sender: Sender): void {
  const granted = new Map((sender.receiverBeliefs ?? []).filter((b) => b.sharedItem).map((b) => [b.id, b.statement]));
  const highlights = out.highlights as Highlight[] | undefined;
  const name = (sender.receiverFirstName ?? "").trim();
  if (granted.size && highlights?.length && name) {
    // v1.61: a note about the receiver needs the quote most (the source rule below drops it without one), so it goes first.
    const order = [...highlights.filter((h) => h.about === "receiver"), ...highlights.filter((h) => h.about !== "receiver")];
    quote: for (const h of order) {
      for (const e of h.from_them) {
        const quote = granted.get(e.belief_id);
        if (quote === undefined) continue;
        e.item_id = e.belief_id; e.quote = quote; e.quote_label = `From what ${name} shared:`;
        break quote; // at most one quoted entry per reply
      }
    }
  }
  if (highlights) out.highlights = applySourceRule(highlights);
}

/**
 * v1.61 (app Q-APP-V3-4; COO Q-APP-V3-3 source rule, PSY C1): a note that describes the receiver (`about: "receiver"`)
 * is written only when it carries one item the receiver shared, word for word; without it the note is dropped, so the
 * phone never has to infer which notes to hide. Notes about the sender's own wording (`about: "wording"`) need no source.
 */
export function applySourceRule(highlights: Highlight[]): Highlight[] {
  return highlights.filter((h) => h.about !== "receiver" || h.from_them.some((e) => e.quote !== null));
}

/** A belief the receiver shared with the sender through link_prefs (law 10 consent): wording only, never its receipts. */
export type SharedBelief = ReceiverBelief;

export interface RunHooks {
  /** After the model calls, before the reply is built: the route writes the trace and refuses a fully failed call. */
  after: (exchanges: ModelExchange[]) => Promise<void>;
  /** A could_not_bridge failure detail; returns the Ref to show. */
  failure: (detail: string) => Promise<string | null>;
  /** Eval only: the whole trace, for the golden gate's analysis-level score. */
  trace?: (t: BridgeTrace) => void;
  /** The semantic safety check (QA-B336): runs only when true (the route passes ctx.env.safetySemantic). */
  semanticCheck?: boolean;
}

/** The /bridge/run reply for one draft, shared by the route and the eval route (E27 golden gate) so the gate measures
 *  exactly the code the phone reaches. The receiver's shared beliefs ride on `sender.receiverBeliefs` (E27 (2c)). */
export async function runReply(client: ModelClient, text: string, relationship: Relationship, sender: Sender, hooks: RunHooks): Promise<Record<string, unknown>> {
  const started = performance.now();
  const draft: Draft = { id: crypto.randomUUID(), senderId: sender.personaId, relationship, message: text, hiddenIntent: "", expected: { frictions: [], safety: "none", nothingToChange: false } };
  const t = await bridgeDraft(client, draft, sender, { semanticCheck: hooks.semanticCheck === true });
  await hooks.after(t.exchanges);
  hooks.trace?.(t);
  const toneOriginal: Feeling = t.analysis?.tone ?? (t.analysis ? toneOf(undefined, t.analysis.feeling.name) : "neutral");
  const win = t.attempts.find((a) => a.pass);
  const toneBridged: Feeling = win?.rewrite?.tone ?? toneOriginal;
  // E27 (3), v1.42: highlights[] and summary on every reply that read the draft; none on a safety stop (law 8).
  const frictions = t.insight?.frictions ?? [], touches = t.touches ?? null;
  const confirmed = new Set(sender.map.beliefs.filter((b) => b.status === "endorsed").map((b) => b.id));
  const touched = !!touches && (touches.fromYou.length > 0 || touches.fromThem.length > 0);
  const read = t.analysis && t.analysis.safety === "none";
  const base = { changes: [] as Record<string, unknown>[], points: pointObjects(t.analysis?.points ?? []), points_line: null as string | null,
    tone: { original: toneOriginal, bridged: toneBridged }, context_note: null as string | null, line: null as string | null, resources: null as typeof RESOURCES | null,
    safety: "none" as string, ...bridgeReviewHint(t.result.askUnresolved), ref: null as string | null, latency_ms: 0,
    highlights: read ? buildHighlights(text, frictions, [], null, touches, confirmed) : [] as Highlight[], summary: read ? summaryLine(frictions, touches) : null as string | null,
    words_changed: false };
  let out: Record<string, unknown>;
  if (t.unreadable) {
    // PSY 16 Nov 2c: nothing rewritten, nothing kept; the person sees the one line and 'Try again'. Not a risk, not a pass.
    out = { outcome: "unavailable", bridged: null, ...base, ...unreadBody(), safety: "unavailable" };
  }
  else if (t.result.status === "declined_abuse") {
    // S15b (CPO 16:00 10-27): only threats and abuse are refused; the flagged parts come back as spans so the app can underline them. The
    // words never leave the sender's phone for the receiver: nothing is stored here but the ledger and the trace.
    out = { outcome: "wont_carry", bridged: null, ...base, line: DECLINE_LINE, ...refusal(flaggedSpans(text, t.analysis, t.floor)) };
  }
  else if (t.result.status === "declined_safety") out = { outcome: "could_not_bridge", bridged: null, ...base, line: RESOURCES.message, resources: RESOURCES, safety: "risk" };
  else if (t.result.status === "ok" && t.result.nothingToChange && !t.result.askUnresolved && touched) {
    // E27 (3): the wording has nothing to change, but the draft touches beliefs on either map: that is insight, not
    // "already clear". The words stand (words_changed false); the highlights carry the touches.
    out = { outcome: "ok", bridged: text, ...base, tone: { original: toneOriginal, bridged: toneOriginal } };
  }
  else if (t.result.status === "ok" && t.result.nothingToChange) {
    // The text stands. When the one planned friction was an ask the words did not state, the line is the ask note and
    // ask_unresolved is true, so B05 can say so instead of "reads clearly" (COO 15:15 10-27, run 2 b07). Otherwise (E27 (3))
    // nothing was found on either side, and the line says what was checked.
    out = { outcome: "nothing_to_change", bridged: text, ...base, line: t.result.askUnresolved ? ASK_UNRESOLVED_LINE : CHECKED_LINE, tone: { original: toneOriginal, bridged: toneOriginal } };
  }
  else if (t.result.status === "ok" && t.result.bridged) {
    const bridged = t.result.bridged;
    const changes = t.result.changes.map((c) => {
      const o = locate(text, c.from), n = locate(bridged, c.to);
      return { start: n?.start ?? null, end: n?.end ?? null, original: c.from, original_start: o?.start ?? null, original_end: o?.end ?? null, to: c.to, kind: c.kind,
        why: c.kind === "context" ? "A line on what this lands on for you." : INSIGHT_COPY[c.kind] };
    });
    const n = base.points.length;
    out = { outcome: "ok", bridged, ...base, changes, points_line: n === 0 ? null : n === 1 ? "Keeps your point" : `Keeps all ${n} of your points`, context_note: t.result.contextNote ?? null,
      highlights: buildHighlights(text, frictions, t.result.changes, bridged, touches, confirmed), words_changed: true };
  } else {
    const missing = t.attempts.flatMap((a) => a.critic?.read?.pointsMissing ?? []);
    const criticFailures = t.attempts.flatMap((a) => {
      const c = a.critic?.read;
      if (!c || c.pass) return [];
      return [...c.pointsMissing.map((x) => `critic points missing: ${x}`), ...c.added.map((x) => `critic added: ${x}`),
        ...c.receiverInnerLife.map((x) => `critic receiver inner life: ${x}`), ...(c.voice < 3 ? [`critic voice: ${c.voice}/5`] : []),
        ...(!c.feelingPreserved ? ["critic feeling not preserved"] : []), ...(c.notes ? [`critic note: ${c.notes}`] : [])];
    });
    const codeFailures = t.attempts.flatMap((a) => a.codeChecks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`));
    const ref = await hooks.failure([...codeFailures, ...criticFailures].join(" | ").slice(0, 1500));
    out = { outcome: "could_not_bridge", bridged: null, ...base, points: pointObjects(t.analysis?.points ?? [], missing), line: "Couldn't bridge this one.", ref };
  }
  out.latency_ms = Math.round(performance.now() - started);
  attachSharedQuote(out, sender);
  return out;
}

route("POST", "/bridge/run", async (ctx) => {
  const started = performance.now();
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  if (typeof b.person_id !== "string") throw new ApiError("invalid", "", { field: "person_id" });
  const text = textOf(b);
  // The V3 pipeline replaces the old run path, so it must carry the safety
  // stop itself before any pair read or model call (law 8).
  if (ownerWriteV3(ctx)) {
    const stopped = await helperStop(ctx, text);
    if (stopped) return stopped;
  }
  const { sender, relationship, writeInput } = await senderFromPairContext(db, owner, b.person_id);
  const scope = scopeFor(ctx), ledger = new PostgresLedger(ctx.service, scope);
  if (ownerWriteV3(ctx)) {
    const read = clientFor(ctx, ledger, "insight"), write = clientFor(ctx, ledger, "run");
    const v3 = await runWritePipeline({ ...writeInput, draft: text }, { mode: "real", clients: { read, write, verify: read } });
    return json({ outcome: v3.tier ? "ok" : "nothing_to_change", tier: v3.tier, note: v3.note ?? null, bridged: v3.suggestedChange ?? null, words_changed: v3.suggestedChange !== null, item_id: v3.itemId ?? null, purpose: v3.purpose ?? null, latency_ms: Math.round(performance.now() - started) });
  }
  const out = await runReply(clientFor(ctx, ledger, "run"), text, relationship, sender, {
    after: async (exchanges) => { await trace(ctx, scope, ledger, exchanges); refused(ledger, exchanges, true); },
    failure: (detail) => recordError(ctx.service, owner, "bridge/run", "could_not_bridge", detail),
    semanticCheck: true,
  });
  out.latency_ms = Math.round(performance.now() - started);   // from the request, as before: the map load counts
  return json(out);
});

// ------------------------------------------------------------------ POST /bridge/reword-part

function readLine(exchange: ModelExchange, field: string): string | null {
  if (exchange.error && !exchange.rawResponse) return null;
  try { const v = extractJson(exchange.rawResponse) as Record<string, unknown>; return typeof v[field] === "string" ? (v[field] as string).trim() : null; } catch { return null; }
}

/** The one line the sender will send or append: no clinical or evaluative word they did not write, nothing about the receiver's mind, no question. */
function lineProblems(line: string, allowed: string, maxWords: number): string[] {
  const out: string[] = [];
  const bad = [...cardWordHits(line), ...clinicalHits(line)].filter((w) => !allowed.toLowerCase().includes(w));
  if (bad.length) out.push(`words: ${bad.join(", ")}`);
  if (/\byou (?:don't|do not|never|always|think|feel|meant|want|just)\b/i.test(line) && !/\byou (?:don't|do not|never|always|think|feel|meant|want|just)\b/i.test(allowed)) out.push("a claim about the receiver");
  if (words(line).length > maxWords) out.push(`${words(line).length} words`);
  if (!line.trim()) out.push("empty");
  return out;
}

/** QA-B336 (QA 03:50Z): the helper routes send the draft to a model, so the draft goes through the one safety entry first (fails closed).
 *  Returns the stop reply, or null to go on. The marked part is inside `text`, so one read covers both. Nothing is sent to a model on a stop. */
async function helperStop(ctx: Ctx, text: string): Promise<Response | null> {
  const g = await requireSafetyPass(ctx, text, "bridge_engine", [], null, true);
  if (!g.stop) return null;
  if (g.routed === "unavailable") return json({ ...unreadBody(), ref: null });
  if (g.routed === "threat_or_abuse") return json({ state: "declined", line: DECLINE_LINE, ...refusal(flaggedSpans(text, null, { routed: g.routed })), ref: null });
  return json({ state: "risk", line: RESOURCES.message, resources: RESOURCES, ref: null });
}

route("POST", "/bridge/reword-part", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  if (typeof b.person_id !== "string") throw new ApiError("invalid", "", { field: "person_id" });
  const text = textOf(b);
  const start = Number(b.start), end = Number(b.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) throw new ApiError("invalid", "", { field: "start" });
  const part = text.slice(start, end);
  const stopped = await helperStop(ctx, text);
  if (stopped) return stopped;
  const { sender, relationship } = await senderFromPairContext(db, owner, b.person_id);
  const kind = typeof b.friction_kind === "string" ? b.friction_kind : null;
  const scope = scopeFor(ctx), ledger = new PostgresLedger(ctx.service, scope);
  const client = clientFor(ctx, ledger, "insight");
  const pkg = `# MESSAGE (from ${sender.firstName} to their ${relationship})\n${text}\n\n# MARKED PART (characters ${start}–${end})\n${part}\n\n# FRICTION\n${kind ?? "(not named)"}`;
  let exchange = await client.complete({ purpose: "reword", system: BRIDGE_REWORD, messages: [{ role: "user", content: pkg }], maxTokens: 300 });
  const exchanges = [exchange];
  let to = readLine(exchange, "to");
  let problems = to === null ? ["unreadable"] : lineProblems(to, part, Math.max(12, words(part).length * 2 + 4));
  if (problems.length) {
    exchange = await client.complete({ purpose: "reword_repair", system: BRIDGE_REWORD, maxTokens: 300, messages: [{ role: "user", content: pkg }, { role: "assistant", content: exchange.rawResponse || "(empty)" },
      { role: "user", content: `That failed: ${problems.join("; ")}. Answer again with ONE JSON object {"to":"…"}: only the marked part, said plainly, nothing added.` }] });
    exchanges.push(exchange);
    to = readLine(exchange, "to");
    problems = to === null ? ["unreadable"] : lineProblems(to, part, Math.max(12, words(part).length * 2 + 4));
  }
  await trace(ctx, scope, ledger, exchanges);
  refused(ledger, exchanges);
  if (problems.length || to === null) {
    const ref = await recordError(ctx.service, owner, "bridge/reword-part", "no_reword", problems.join("; "));
    return json({ text, replaced: null, tone: null, line: "Couldn't find other words for that part.", ref });
  }
  const rewritten = text.slice(0, start) + to + text.slice(end);
  return json({ text: rewritten, replaced: { start, end: start + to.length, original: part, to }, tone: null, ref: null });
});

// ------------------------------------------------------------------ POST /bridge/why-it-matters

route("POST", "/bridge/why-it-matters", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  if (typeof b.person_id !== "string") throw new ApiError("invalid", "", { field: "person_id" });
  if (typeof b.belief_id !== "string") throw new ApiError("invalid", "", { field: "belief_id" });
  const text = textOf(b);
  const stopped = await helperStop(ctx, text);
  if (stopped) return stopped;
  const { data: row, error } = await db.from("beliefs").select("*").eq("id", b.belief_id).eq("owner", owner).eq("status", "confirmed").maybeSingle();
  if (error) dbError(error, "beliefs");
  if (!row) throw new ApiError("not_found", "", { where: "belief" });
  const { data: rs } = await db.from("receipts").select("quote").eq("belief_id", row.id).order("said_at").limit(4);
  const { sender, relationship } = await senderFromPairContext(db, owner, b.person_id);
  const belief: Belief | undefined = sender.map.beliefs.find((x) => x.id === row.id);
  const scope = scopeFor(ctx), ledger = new PostgresLedger(ctx.service, scope);
  const client = clientFor(ctx, ledger, "insight");
  const pkg = `# MESSAGE (from ${sender.firstName} to their ${relationship})\n${text}\n\n# THE BELIEF IT TOUCHES\n"${row.label}": ${row.statement}\n\n# ${sender.firstName.toUpperCase()}'S OWN WORDS IT RESTS ON\n${(rs ?? []).map((r) => `- "${r.quote}"`).join("\n") || "- (none recorded)"}`;
  const allowed = `${text} ${(rs ?? []).map((r) => r.quote).join(" ")} ${belief?.statement ?? ""}`;
  let exchange = await client.complete({ purpose: "why", system: BRIDGE_WHY, messages: [{ role: "user", content: pkg }], maxTokens: 300 });
  const exchanges = [exchange];
  let line = readLine(exchange, "line");
  let problems = line === null ? ["unreadable"] : lineProblems(line, allowed, 40);
  if (problems.length) {
    exchange = await client.complete({ purpose: "why_repair", system: BRIDGE_WHY, maxTokens: 300, messages: [{ role: "user", content: pkg }, { role: "assistant", content: exchange.rawResponse || "(empty)" },
      { role: "user", content: `That failed: ${problems.join("; ")}. Answer again with ONE JSON object {"line":"…"}: one first-person sentence from the belief and the sender's own words, nothing about the receiver.` }] });
    exchanges.push(exchange);
    line = readLine(exchange, "line");
    problems = line === null ? ["unreadable"] : lineProblems(line, allowed, 40);
  }
  await trace(ctx, scope, ledger, exchanges);
  refused(ledger, exchanges);
  if (problems.length || line === null) {
    const ref = await recordError(ctx.service, owner, "bridge/why-it-matters", "no_line", problems.join("; "));
    return json({ line: null, belief_id: row.id, ref });
  }
  return json({ line, belief_id: row.id, ref: null });
});

