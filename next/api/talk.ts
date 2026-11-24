// Talk (CONTRACT §4): /talk/turn, /talk/consent, /talk/edit, DELETE /talk/messages/:id, /talk/finish on the `next/` Talk engine.
// One turn = load the person's state from the database → talkTurn (one model call, one repair) → the person's row gets its
// feeling, shown cards become belief rows with receipts, the reply becomes the presence row → the Reply object. Every model
// exchange is reserved and settled in usage_ledger and traced in engine_calls. Nothing here raises past the router: a refused
// budget is 429 daily_limit; an exhausted model retry is persisted as the safe thread-line with the person's words saved.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DOMAINS } from "../engine/types.ts";
import type { AnswerKind, Belief, Domain, ModelExchange, PersonMap, Rating } from "../engine/types.ts";
import { AnthropicClient } from "../engine/model/client.ts";
import type { ModelClient, ModelStreamObserver } from "../engine/model/client.ts";
import { talkTurn } from "../engine/talk/turn.ts";
import { SHOW_THRESHOLD } from "../engine/talk/turn.ts";
import type { TurnTrace } from "../engine/talk/turn.ts";
import type { ProposedBelief } from "../engine/talk/checks.ts";
import { longestSharedRun, ratingTalkHits, REFLECTION_COPY_LIMIT } from "../engine/talk/checks.ts";
import { finishSession } from "../engine/talk/finish.ts";
import { countQuestions, isExactSubstring, questionWordHits, words } from "../engine/words.ts";
import { route, type Ctx } from "./lib/router.ts";
import { ApiError, json, recordError } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import { redactTalkExchange } from "../engine/talk/redact.ts";
import { PostgresLedger, recordEngineCall, type LedgerScope } from "./lib/ledger.ts";
import { AREA_FOR_DOMAIN, areaFor, CONSENT_LABEL, DOMAIN_FOR_AREA, engineRating, statusForRating, type Area } from "./lib/map.ts";
import { beliefsFor, cardsFor, conversationWithCounts, loadConversation, messageObject, type Row } from "./lib/objects.ts";
import { loadState, persistBeliefs } from "./lib/state.ts";
import { isOpenerRequest, openerBody, readAbout } from "./lib/talk_opener.ts";
import type { OpenerSource } from "./lib/talk_opener.ts";
import { finishFailureDisposition, turnFailureDisposition } from "./lib/talk_recovery.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import { afterReply } from "./bridge_engine.ts";
import { guideBrief, GUIDE_MODEL, guideAvoidTopics } from "../engine/talk/guide.ts";
import type { GuideBrief } from "../engine/talk/guide.ts";
import { comfortForTurn, gapsForGuide, median } from "../engine/talk/comfort.ts";
import { rankGuideGaps } from "../engine/talk/gaps.ts";
import type { CommKind } from "../engine/comm.ts";

export const TALK_MODEL = "claude-sonnet-5-5";          // COO decision (APP-V1-BUILD §3): Talk turn and Finish on Sonnet 5.5
export const TALK_THINKING = "between_tools" as const;   // the run of record 072112Z
export const TALK_CALL_TIMEOUT_MS = 12_000;              // two attempts plus persistence stay inside the 30 s client contract
/** Finish writes a whole session's cards and summary (900-1,900 output tokens, 6.6-11.7 s on staging) so it gets its own cap, one attempt;
 *  25 s plus persistence stays inside the 30 s client contract. Turns keep TALK_CALL_TIMEOUT_MS. */
export const TALK_FINISH_TIMEOUT_MS = 25_000;
export const MAX_TEXT = 4000;
export const TITLE_TURNS = 3;
export const CONSENT_TEXT = { sure: "Sure", not_now: "Not now", never: "Never" } as const;

function isDomain(x: unknown): x is Domain { return typeof x === "string" && (DOMAINS as readonly string[]).includes(x); }

/** Test seam: a $0 check (api/check_talk.ts) swaps the model for a recorded one; hosted code never sets it. */
export const hooks: { client: ((ctx: Ctx, ledger: PostgresLedger, timeoutMs?: number) => ModelClient) | null } = { client: null };

export function clientFor(ctx: Ctx, ledger: PostgresLedger, timeoutMs: number = TALK_CALL_TIMEOUT_MS): ModelClient {
  if (hooks.client) return hooks.client(ctx, ledger, timeoutMs);
  if (!ctx.env.anthropicKey || !ctx.env.anthropicWorkspace) throw new ApiError("unreachable", "Can't reach Presence right now.", { detail: "anthropic key or workspace not configured" });
  return new AnthropicClient({ config: { key: ctx.env.anthropicKey, workspace: ctx.env.anthropicWorkspace }, ledger, defaultModel: TALK_MODEL, thinking: TALK_THINKING, timeoutMs });
}

export function scopeFor(ctx: Ctx, conversationId: string): LedgerScope {
  // The owner's phone is the only client in this preview: every preview persona is the owner's own use (+500¢ a day past the shared cap).
  return { person: ctx.caller!.id, ownerPreview: ctx.caller!.isPreview, conversationId, feature: "talk" };
}

/** K-0062 is separately default-off: communication work may be on while the private guide remains in the lab. */
export function ownerTalkGuide(ctx: Ctx): boolean {
  return !!ctx.caller && ctx.env.talkGuide === true && (ctx.env.commOwnerIds ?? []).includes(ctx.caller.id);
}

/** The private brief belongs only to this conversation; failures deliberately leave the prior brief untouched. */
export async function storeGuideBrief(db: SupabaseClient, conversationId: string, owner: string, brief: unknown): Promise<void> {
  await db.from("conversations").update({ guide_brief: brief }).eq("id", conversationId).eq("owner", owner);
}

function guideAfterReply(ctx: Ctx, conversation: Row, meRow: Row, reply: Record<string, unknown>, turnIndex: number): void {
  if (!ownerTalkGuide(ctx) || reply.state === "safety" || reply.state === "unavailable") return;
  const owner = ctx.caller!.id, cid = String(conversation.id);
  afterReply("talk guide", async () => {
    const db = ctx.service;
    const [beliefsQ, commQ, turnsQ, priorQ, profileQ] = await Promise.all([
      db.from("beliefs").select("id,label,statement,type,confirmed_at").eq("owner", owner).eq("status", "confirmed"),
      db.from("beliefs").select("comm_kind,rating,comm_last_confirmed_at,confirmed_at").eq("owner", owner).eq("status", "confirmed").not("comm_kind", "is", null),
      db.from("messages").select("role,text,turn").eq("conversation_id", cid).eq("superseded", false).is("deleted_at", null).order("turn"),
      db.from("conversations").select("id,summary,next_time").eq("owner", owner).eq("status", "finished").neq("id", cid).order("finished_at", { ascending: false }).limit(2),
      db.from("profiles").select("talk_guide_avoids").eq("id", owner).maybeSingle(),
    ]);
    if (beliefsQ.error || commQ.error || turnsQ.error || priorQ.error || profileQ.error) return;
    const turns = turnsQ.data ?? [];
    const personTurns = turns.filter((r) => r.role === "me");
    const priorSessions = priorQ.data ?? [];
    const priorIds = priorSessions.map((r) => String(r.id));
    const priorTurnsQ = priorIds.length ? await db.from("messages").select("text,conversation_id,turn").in("conversation_id", priorIds)
      .eq("role", "me").eq("superseded", false).is("deleted_at", null).order("turn") : { data: [], error: null };
    if (priorTurnsQ.error) return;
    const priorLengths = (priorTurnsQ.data ?? []).map((r) => String(r.text ?? "").length);
    const personalMedian = median(priorLengths);
    const priorWasShort = personTurns.length > 1 && personalMedian !== null && String(personTurns.at(-2)?.text ?? "").length < personalMedian * 0.4;
    const comfort = comfortForTurn({ text: String(meRow.text ?? ""), alreadyFollowOnly: conversation.guide_comfort === "follow_only" }, {
      priorAnswerLengths: priorLengths, priorWasShort,
    });
    const confirmed = (commQ.data ?? []).flatMap((r) => typeof r.comm_kind === "string" ? [{ kind: r.comm_kind as CommKind,
      rating: r.rating === "partly" ? "partly" as const : "very_me" as const,
      confirmedAt: (r.comm_last_confirmed_at ?? r.confirmed_at) as string | null }] : []);
    const recentSteeredTurns = Array.isArray(conversation.guide_steered_turns) ? conversation.guide_steered_turns.filter((x): x is boolean => typeof x === "boolean") : [];
    const offered = gapsForGuide({ comfort: comfort.state, personTurn: turnIndex, recentSteeredTurns, gaps: rankGuideGaps({ confirmed }) });
    const ledger = new PostgresLedger(ctx.service, scopeFor(ctx, cid));
    const client = hooks.client ? hooks.client(ctx, ledger) : new AnthropicClient({ config: { key: ctx.env.anthropicKey!, workspace: ctx.env.anthropicWorkspace! }, ledger, defaultModel: GUIDE_MODEL, thinking: "disabled", timeoutMs: 12_000 });
    const priorAvoid = Array.isArray(profileQ.data?.talk_guide_avoids) ? profileQ.data.talk_guide_avoids.filter((x): x is string => typeof x === "string") : [];
    const trace = await guideBrief(client, { map: beliefsQ.data ?? [], commItems: commQ.data ?? [], sessionTurns: turns.map((r) =>
      ({ role: r.role === "me" ? "person" as const : "listener" as const, text: String(r.text ?? "") })),
      lastSession: priorSessions[0] ? { summary: priorSessions[0].summary ?? null, nextTime: priorSessions[0].next_time ?? null } : null,
      gaps: offered, comfort: comfort.state, priorAvoid });
    await traceExchanges(ctx, scopeFor(ctx, cid), ledger, [trace.exchange]);
    const previousBrief = conversation.guide_brief as GuideBrief | null;
    const steered = !!previousBrief?.gap && String((reply.move as Record<string, unknown> | undefined)?.gap ?? "").includes(previousBrief.gap.kind);
    const statePatch: Record<string, unknown> = { guide_comfort: comfort.state, guide_steered_turns: [...recentSteeredTurns, steered].slice(-3) };
    if (trace.brief) statePatch.guide_brief = trace.brief;
    await db.from("conversations").update(statePatch).eq("id", cid).eq("owner", owner);
    // The person's declined sentence is never copied into this cross-session field. Only the guide's bounded,
    // already-screened topic label may carry forward.
    const avoids = comfort.avoidTopic ? guideAvoidTopics(trace.brief?.avoid ?? []) : [];
    if (avoids.length) await db.from("profiles").update({ talk_guide_avoids: [...new Set([...priorAvoid, ...avoids])].slice(-8) }).eq("id", owner);
  });
}

export async function traceExchanges(ctx: Ctx, scope: LedgerScope, ledger: PostgresLedger, exchanges: TurnTrace["exchanges"], ref: string | null = null) {
  const ids = [...ledger.ids.values()];
  for (let i = 0; i < exchanges.length; i++) await recordEngineCall(ctx.service, scope, await redactTalkExchange(exchanges[i]), ids[i] ?? null, ref);
}

function text(b: Record<string, unknown>, field = "text"): string {
  const t = typeof b[field] === "string" ? (b[field] as string).trim() : "";
  if (!t) throw new ApiError("invalid", "", { field });
  if (t.length > MAX_TEXT) throw new ApiError("invalid", "", { field, max: MAX_TEXT });
  return t;
}

async function profileName(db: SupabaseClient, id: string): Promise<string> {
  const { data } = await db.from("profiles").select("name").eq("id", id).maybeSingle();
  return String(data?.name ?? "");
}

/** The last visible turn number of a conversation (superseded and deleted rows do not count), or 0. */
async function lastTurn(db: SupabaseClient, conversationId: string): Promise<{ turn: number; pending: Row | null }> {
  const { data } = await db.from("messages").select("*").eq("conversation_id", conversationId).eq("superseded", false).is("deleted_at", null)
    .order("turn", { ascending: false }).order("role").limit(2);
  const rows = data ?? [];
  const last = rows[0];
  if (!last) return { turn: 0, pending: null };
  const pending = last.role === "me" && !rows.some((r) => r.turn === last.turn && r.role === "presence") ? last : null;
  return { turn: last.turn as number, pending };
}

interface TurnOutcome { conversation: Row | null; meRow: Row | null; reply: Record<string, unknown>; latency_ms: number; trace: TurnTrace; forming: FormingPayload[] }

/** One engine turn for a stored `me` row: the model call, the ledger, the trace, the belief rows, the presence row. */
async function runTurn(
  ctx: Ctx,
  conversation: Row,
  meRow: Row,
  turnIndex: number,
  mode: string | null,
  stream?: ModelStreamObserver,
  /** An edit read its words before changing anything: that reading is the one reading (a stop stands, a clear is not read again). */
  prior?: { stop: boolean; risk: "none" | "self" | "others"; reason: string },
): Promise<TurnOutcome> {
  const started = performance.now();
  const db = ctx.caller!.db, owner = ctx.caller!.id, cid = conversation.id as string;
  let about: Row | null = null;
  if (conversation.belief_id) {
    const { data } = await db.from("beliefs").select("id,label,statement").eq("id", conversation.belief_id as string).maybeSingle();
    about = data ?? null;
  }
  const loaded = await loadState(db, { id: owner, name: await profileName(db, owner) }, conversation, { upToTurn: turnIndex, aboutBelief: about });
  if (!loaded.meRows.some((m) => m.id === meRow.id)) { loaded.meRows.push(meRow); loaded.meIdByTurn.set(turnIndex, meRow.id as string); }
  const scope = scopeFor(ctx, cid);
  const ledger = new PostgresLedger(ctx.service, scope);
  const client = clientFor(ctx, ledger);

  const answerKind = (meRow.answer_kind === "chip" || meRow.answer_kind === "consent")
    ? meRow.answer_kind as AnswerKind
    : "told";
  const brief = ownerTalkGuide(ctx) && conversation.guide_brief && typeof conversation.guide_brief === "object"
    ? conversation.guide_brief as GuideBrief : null;
  const trace = await talkTurn(client, loaded.state, String(meRow.text), turnIndex, stream, answerKind,
    { semanticCheck: ctx.env.safetySemantic === true, guideBrief: brief, ...(prior ? { prior } : {}) });
  await traceExchanges(ctx, scope, ledger, trace.exchanges);

  if (turnFailureDisposition(trace) === "budget") {
    const e = ledger.refusalError("talk");
    throw new ApiError(e.code, e.message, { ...e.extra, saved: true, message_id: meRow.id });
  }

  // PSY 16 Nov 2c-2h: the safety reading could not answer. The person's words are removed (typed words stay in the field, saved
  // nowhere else), a conversation they started with this turn goes with them, nothing is mapped, and risk_turn is untouched.
  if (trace.shown.state === "unavailable") {
    await ctx.service.from("messages").delete().eq("id", meRow.id);
    const { count } = await ctx.service.from("messages").select("*", { count: "exact", head: true }).eq("conversation_id", cid);
    let kept: Row | null = conversation;
    if ((count ?? 0) === 0) { await ctx.service.from("conversations").delete().eq("id", cid); kept = null; }
    return { conversation: kept, meRow: null, reply: unreadBody(), latency_ms: Math.round(performance.now() - started), trace, forming: [] };
  }

  const shown = trace.shown;
  const pausedBefore = conversation.risk_turn !== null && conversation.risk_turn !== undefined;
  const convPatch: Row = { last_active_at: new Date().toISOString(), status: "active", paused_at: null, finished_at: null };
  if (mode) convPatch.mode = mode;
  if (shown.state === "safety" && !pausedBefore) convPatch.risk_turn = turnIndex;
  if (pausedBefore) { shown.cards = []; shown.earlyGuess = undefined; }       // law 8: mapping stays paused after a risk stop

  // The person's row: its feeling (never the reply's).
  const feeling = shown.state === "safety" ? null : (shown.feeling ?? trace.parsed?.feeling ?? "neutral");
  const { data: me, error: meErr } = await db.from("messages").update({ feeling }).eq("id", meRow.id).select("*").single();
  if (meErr) dbError(meErr, "messages.update");

  // Beliefs: shown cards (and the early guess) become rows; map beliefs that gained a receipt are updated; hypotheses are kept.
  let cardRows: Row[] = [], earlyRow: Row | null = null;
  if (!pausedBefore && shown.state !== "safety") {
    const shownNow = new Set([...shown.cards.map((c) => c.beliefId), ...(shown.earlyGuess ? [shown.earlyGuess.beliefId] : [])]);
    const hyps = [...loaded.state.hypotheses.values()];
    const toPersist: Belief[] = [...loaded.state.map.beliefs, ...hyps.filter((h) => loaded.rows.has(h.id) || shownNow.has(h.id))];
    await persistBeliefs(db, owner, loaded, toPersist, { conversationId: cid });
    convPatch.hypotheses = hyps;
    const ids = [...shownNow];
    if (ids.length) {
      const { data: rows } = await db.from("beliefs").select("*").in("id", ids);
      cardRows = shown.cards.map((c) => (rows ?? []).find((r) => r.id === c.beliefId)).filter((r): r is Row => !!r);
      earlyRow = shown.earlyGuess ? (rows ?? []).find((r) => r.id === shown.earlyGuess!.beliefId) ?? null : null;
    }
  }
  const title = trace.parsed?.title;
  if (title && turnIndex <= TITLE_TURNS && !conversation.title_by_person) convPatch.title = title;

  // The reply (CONTRACT §2 Reply) and the presence row that carries it.
  const consentDomain = shown.state === "permission" ? shown.permissionDomain ?? null : null;
  const ref = trace.fallback ? await recordError(ctx.service, owner, "talk/turn", "thread_line", trace.warnings.join(" | ")) : null;
  const presenceId = crypto.randomUUID();
  const reply: Record<string, unknown> = {
    message_id: presenceId, turn: turnIndex,
    state: shown.state === "permission" ? "consent" : shown.state,
    reflection: shown.reflection ?? "", question: shown.question ?? "",
    move: { kind: trace.parsed?.move.kind ?? (shown.state === "safety" ? "close" : "clarify") },
    consent: consentDomain ? { area: areaFor([consentDomain]), label: CONSENT_LABEL[consentDomain], domain: consentDomain } : null,
    cards: await cardsFor(db, cardRows),
    early_guess: earlyRow ? (await cardsFor(db, [earlyRow]))[0] ?? null : null,
    feeling, safety: shown.safety ?? null, ref,
  };
  const spoken = [shown.reflection ?? "", shown.question ?? ""].filter(Boolean).join(" ").trim();
  const { error: pErr } = await db.from("messages").insert({ id: presenceId, owner, conversation_id: cid, role: "presence", turn: turnIndex, text: spoken, reply, ref });
  if (pErr) dbError(pErr, "messages.insert");
  const { data: conv, error: cErr } = await db.from("conversations").update(convPatch).eq("id", cid).select("*").single();
  if (cErr) dbError(cErr, "conversations.update");
  if (trace.warnings.length) console.warn(`talk/turn ${cid} t${turnIndex}: ${trace.warnings.join(" | ")}`);
  const forming = formingEvents(trace.hypotheses, loaded.state.map);
  guideAfterReply(ctx, conv, me, reply, turnIndex);
  return { conversation: conv, meRow: me, reply, latency_ms: Math.round(performance.now() - started), trace, forming };
}

async function turnReply(ctx: Ctx, out: TurnOutcome, extra: Record<string, unknown> = {}) {
  return json(await turnBody(ctx, out, extra));
}

async function turnBody(ctx: Ctx, out: TurnOutcome, extra: Record<string, unknown> = {}) {
  return {
    conversation: out.conversation ? await conversationWithCounts(ctx.caller!.db, out.conversation, ctx.tz) : null,
    message: out.meRow ? messageObject(out.meRow) : null,
    reply: out.reply,
    latency_ms: out.latency_ms,
    ...extra,
  };
}

interface PreparedTurn { conversation: Row; meRow: Row; index: number; mode: string }

/** No `conversation_id`: resume the one open conversation (409 `conflict`, CONTRACT §"conversation_id: null"), else start one. */
async function startOrResumeConversation(ctx: Ctx, b: Record<string, unknown>, owner: string, mode: string): Promise<Row> {
  const db = ctx.caller!.db;
  const { data: open } = await db.from("conversations").select("*").eq("owner", owner)
    .in("status", ["active", "paused"]).is("deleted_at", null)
    .order("last_active_at", { ascending: false }).limit(1).maybeSingle();
  if (open) {
    throw new ApiError("conflict", "", { active: await conversationWithCounts(db, open, ctx.tz) });
  }
  const belief = typeof b.belief_id === "string" && b.belief_id ? b.belief_id : null;
  // S15b Talk it through: refused words become the first turn and remain under the ordinary spend caps.
  const source = b.source === "bridge_refused" ? "bridge_refused" : "talk";
  const { data, error } = await db.from("conversations").insert({ owner, mode, belief_id: belief, source })
    .select("*").single();
  if (error) dbError(error, "conversations.insert");
  return data;
}

async function prepareTurn(ctx: Ctx, b: Record<string, unknown>): Promise<PreparedTurn> {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const said = text(b);
  if (b.starter !== undefined && typeof b.starter !== "boolean") throw new ApiError("invalid", "", { field: "starter" });
  const answerKind: AnswerKind = b.starter === true ? "chip" : "told";
  const mode = b.mode === "text" ? "text" : "voice";
  let conversation: Row;
  if (typeof b.conversation_id === "string" && b.conversation_id) {
    try {
      conversation = await loadConversation(db, b.conversation_id);
    } catch (e) {
      // QA-B36/E74P: a conversation_id the server has no row for (never created, or already gone) must
      // never stop the person's words from being heard. Treat it exactly like no conversation_id: resume
      // the open conversation if one exists, else start a fresh one. Any other failure still throws.
      if (!(e instanceof ApiError && e.code === "not_found")) throw e;
      conversation = await startOrResumeConversation(ctx, b, owner, mode);
    }
  } else {
    conversation = await startOrResumeConversation(ctx, b, owner, mode);
  }
  const { turn, pending } = await lastTurn(db, conversation.id as string);
  let meRow: Row, index: number;
  if (pending && String(pending.text).trim() === said && (pending.answer_kind ?? "told") === answerKind) {
    meRow = pending;
    index = pending.turn as number;
  } else {
    if (pending) await db.from("messages").update({ superseded: true }).eq("id", pending.id);
    index = pending ? pending.turn as number : turn + 1;
    const { data, error } = await db.from("messages").insert({
      owner,
      conversation_id: conversation.id,
      role: "me",
      turn: index,
      text: said,
      answer_kind: answerKind,
    }).select("*").single();
    if (error) dbError(error, "messages.insert");
    meRow = data;
  }
  return { conversation, meRow, index, mode };
}

/** A complete JSON string field from a partial model reply; incomplete or malformed input yields null. */
export function streamedJsonString(raw: string, field: string): string | null {
  const match = new RegExp(`"${field}"\\s*:`).exec(raw);
  if (!match) return null;
  let at = match.index + match[0].length;
  while (/\s/.test(raw[at] ?? "")) at++;
  if (raw[at] !== '"') return null;
  const start = at++;
  let escaped = false;
  for (; at < raw.length; at++) {
    const c = raw[at];
    if (escaped) escaped = false;
    else if (c === "\\") escaped = true;
    else if (c === '"') {
      try {
        return JSON.parse(raw.slice(start, at + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const GROUNDING_STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from", "had", "has", "have",
  "i", "in", "is", "it", "me", "my", "of", "on", "or", "that", "the", "this", "to", "was", "were",
  "with", "you", "your",
]);

function groundedInLatest(reflection: string, latest: string): boolean {
  const said = new Set(words(latest).filter((w) => !GROUNDING_STOP.has(w)));
  const reflected = [...new Set(words(reflection).filter((w) => !GROUNDING_STOP.has(w)))];
  return reflected.length > 0 && reflected.some((w) => said.has(w));
}

/** Only an independently safe reflection may leave the server before the full Talk object is checked. */
export function guardedStreamReflection(raw: string, latest: string): string | null {
  const risk = /"risk"\s*:\s*\{[\s\S]*?"level"\s*:\s*"(none|self|others)"/.exec(raw)?.[1];
  if (risk !== "none") return null;
  const reflection = streamedJsonString(raw, "reflection")?.trim() ?? "";
  if (!reflection || countQuestions(reflection, [latest]) !== 0) return null;
  if (questionWordHits(reflection).length || ratingTalkHits(reflection).length) return null;
  if (longestSharedRun(reflection, latest) > REFLECTION_COPY_LIMIT) return null;
  if (!groundedInLatest(reflection, latest)) return null;
  return reflection;
}

export function sentenceChunks(text: string): string[] {
  return (text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map((part) => part.trim()).filter(Boolean);
}

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Once `accepted` has started the HTTP 200 stream, errors must travel as SSE. Keep that event identical to the
 * ordinary router error body and store the same code against its Ref; only the private diagnostic `detail` stays
 * server-side.
 */
export async function streamErrorPayload(
  service: SupabaseClient,
  person: string,
  error: unknown,
): Promise<Record<string, unknown>> {
  const err = error instanceof ApiError
    ? error
    : new ApiError("internal", "", {
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  const { detail, ...extra } = err.extra;
  const ref = await recordError(
    service,
    person,
    "POST /talk/turn?stream=1",
    err.code,
    [err.message, detail ? String(detail) : ""].filter(Boolean).join(" | "),
  );
  return { error: err.code, ref, message: err.message || undefined, ...extra };
}

export interface FormingPayload {
  id: string;
  area: Area | null;
  area_confidence: number;
  confidence: number;
  state: "forming" | "card_up";
  conviction?: number;
  existing_belief_id?: string;
}

/** CONTRACT §4 "forming": one event per hypothesis kept after checks, with no label, statement or receipt (no belief
 * words leave the server here; law 9 only lets wording reach the screen at 0.7 confidence, inside the ordinary `reply`
 * cards). Drives the Talk spheres animation while a belief is still taking shape. `existing_belief_id`/`conviction` are
 * present only when the hypothesis resolved to a belief already on the person's map (same belief, new receipt); a
 * brand-new hypothesis has neither, since it has no prior conviction to report. */
export function formingEvents(hypotheses: ProposedBelief[], map: PersonMap): FormingPayload[] {
  return hypotheses.map((h) => {
    const id = h.id; // turn.ts always resolves a hypothesis's id (its own or a fresh one) before it reaches trace.hypotheses
    if (!id) throw new Error("forming event: hypothesis id unresolved");
    const existing = map.beliefs.find((b) => b.id === id);
    const chosen = h.domains.length ? areaFor(h.domains) : null;
    const agreeing = h.domains.filter((d) => AREA_FOR_DOMAIN[d] === chosen).length;
    const area_confidence = chosen ? agreeing / h.domains.length : 0;
    const event: FormingPayload = {
      id, area: chosen, area_confidence,
      confidence: h.confidence, state: h.confidence >= SHOW_THRESHOLD ? "card_up" : "forming",
    };
    if (existing) { event.existing_belief_id = id; event.conviction = existing.confidence; }
    return event;
  });
}

function streamTurn(ctx: Ctx, prepared: PreparedTurn): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const requestStarted = performance.now();
  let closed = false;
  let sequence = 0;
  let earlyReflection: string | null = null;
  let firstTokenMs: number | null = null;
  let firstSentenceMs: number | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed || abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          closed = true;
        }
      };
      send("accepted", {
        conversation_id: prepared.conversation.id,
        message_id: prepared.meRow.id,
      });
      const signal = AbortSignal.any([abort.signal, ctx.req.signal]);
      const observer: ModelStreamObserver = {
        signal,
        onFirstToken(ms) {
          firstTokenMs ??= Math.round(ms);
        },
        onDelta(_delta, accumulated) {
          if (earlyReflection) return;
          const guarded = guardedStreamReflection(accumulated, String(prepared.meRow.text));
          if (!guarded) return;
          earlyReflection = guarded;
          for (const chunk of sentenceChunks(guarded)) {
            firstSentenceMs ??= Math.round(performance.now() - requestStarted);
            send("speech", { seq: sequence++, text: chunk, kind: "reflection" });
          }
        },
      };
      void (async () => {
        try {
          const out = await runTurn(
            ctx,
            prepared.conversation,
            prepared.meRow,
            prepared.index,
            prepared.mode,
            observer,
          );
          const reply = out.reply;
          if (!signal.aborted) {
            if (reply.state !== "safety" && reply.state !== "unavailable") {
              for (const forming of out.forming) send("forming", forming);
            }
            if (reply.state === "unavailable") {
              send("unavailable", { reply });
            } else if (reply.state === "safety") {
              send("safety", { reply });
            } else if (out.trace.fallback) {
              send("fallback", { reply });
            } else {
              const reflection = String(reply.reflection ?? "");
              if (!earlyReflection) {
                for (const chunk of sentenceChunks(reflection)) {
                  firstSentenceMs ??= Math.round(performance.now() - requestStarted);
                  send("speech", { seq: sequence++, text: chunk, kind: "reflection" });
                }
              }
              for (const chunk of sentenceChunks(String(reply.question ?? ""))) {
                firstSentenceMs ??= Math.round(performance.now() - requestStarted);
                send("speech", { seq: sequence++, text: chunk, kind: "question" });
              }
            }
            send("reply", await turnBody(ctx, out));
            send("done", {
              first_token_ms: firstTokenMs,
              first_sentence_ms: firstSentenceMs,
              latency_ms: out.latency_ms,
              cancelled: false,
            });
          }
        } catch (error) {
          if (!signal.aborted) {
            send("error", await streamErrorPayload(ctx.service, ctx.caller!.id, error));
          }
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch { /* consumer already sent barge-in */ }
          }
        }
      })();
    },
    cancel() {
      closed = true;
      abort.abort("barge-in");
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-presence-contract": "1",
    },
  });
}

// ------------------------------------------------------------------ POST /talk/turn

route("POST", "/talk/turn", async (ctx) => {
  const streaming = ctx.url.searchParams.get("stream") === "1";
  if (streaming && !ctx.env.liveVoicePhase1) {
    throw new ApiError("not_found", "", { feature: "live_voice_phase1" });
  }
  const b = await ctx.body();
  if (isOpenerRequest(b)) return json(openerBody(b.source as OpenerSource, readAbout(b.about)));  // v1.54: no model call, nothing stored
  const prepared = await prepareTurn(ctx, b);
  if (streaming) return streamTurn(ctx, prepared);
  return turnReply(
    ctx,
    await runTurn(ctx, prepared.conversation, prepared.meRow, prepared.index, prepared.mode),
  );
});

// ------------------------------------------------------------------ POST /talk/consent

route("POST", "/talk/consent", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  const answer = String(b.answer ?? "");
  if (!(answer in CONSENT_TEXT)) throw new ApiError("invalid", "", { field: "answer" });
  const domain: Domain | null = isDomain(b.domain) ? b.domain : isDomain(b.area) ? b.area : (DOMAIN_FOR_AREA[b.area as Area] ?? null);
  if (!domain) throw new ApiError("invalid", "", { field: "area" });
  if (typeof b.conversation_id !== "string") throw new ApiError("invalid", "", { field: "conversation_id" });
  const conversation = await loadConversation(db, b.conversation_id);
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 60) : CONSENT_LABEL[domain];
  const state = answer === "sure" ? "allowed" : answer;
  await db.from("consent").delete().eq("owner", owner).eq("area", domain);
  const { data: consent, error } = await db.from("consent").insert({ owner, area: domain, label, state, conversation_id: conversation.id }).select("id").single();
  if (error) dbError(error, "consent.insert");
  const { turn } = await lastTurn(db, conversation.id as string);
  const index = turn + 1;
  const { data: meRow, error: mErr } = await db.from("messages").insert({ owner, conversation_id: conversation.id, role: "me", turn: index, text: CONSENT_TEXT[answer as keyof typeof CONSENT_TEXT], answer_kind: "consent" }).select("*").single();
  if (mErr) dbError(mErr, "messages.insert");
  return turnReply(ctx, await runTurn(ctx, conversation, meRow, index, null), { never_id: answer === "never" ? consent.id : null });
});

// ------------------------------------------------------------------ receipts and hypotheses after an edit or a delete

async function loadMeRow(db: SupabaseClient, id: string): Promise<Row> {
  const { data, error } = await db.from("messages").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) dbError(error, "messages");
  if (!data) throw new ApiError("not_found", "", { where: "message" });
  if (data.role !== "me") throw new ApiError("invalid", "", { field: "message_id", detail: "only your own messages can be changed" });
  return data;
}

/** Receipts of one message after its words changed (or went): keep the quotes still in the text, drop the rest, and remove
 *  any belief left with no receipt (law 2). */
async function recheckReceipts(db: SupabaseClient, owner: string, messageId: string, newText: string | null): Promise<{ kept: number; removed: number; beliefsRemoved: string[] }> {
  const { data: rs } = await db.from("receipts").select("id,belief_id,quote").eq("message_id", messageId);
  const gone = (rs ?? []).filter((r) => newText === null || !isExactSubstring(String(r.quote), newText));
  const kept = (rs ?? []).length - gone.length;
  if (gone.length) await db.from("receipts").delete().in("id", gone.map((r) => r.id));
  const beliefIds = [...new Set(gone.map((r) => r.belief_id as string))];
  const beliefsRemoved: string[] = [];
  for (const id of beliefIds) {
    const { count } = await db.from("receipts").select("*", { count: "exact", head: true }).eq("belief_id", id);
    if ((count ?? 0) === 0) {
      const { data: b } = await db.from("beliefs").select("status").eq("id", id).maybeSingle();
      if (b && b.status !== "deleted") {
        await db.from("beliefs").update({ previous_status: b.status, status: "deleted", deleted_at: new Date().toISOString() }).eq("id", id).eq("owner", owner);
        beliefsRemoved.push(id);
      }
    }
  }
  return { kept, removed: gone.length, beliefsRemoved };
}

/** Hypotheses after a turn's words changed: receipts from later (now superseded) turns go; the turn's own receipts stay only
 *  when still in the text; a hypothesis with nothing left and no row is dropped. */
export function pruneHypotheses(hyps: Belief[], turn: number, newText: string | null, hasRow: (id: string) => boolean): Belief[] {
  const out: Belief[] = [];
  for (const h of hyps) {
    h.receipts = h.receipts.filter((r) => r.turn < turn || (r.turn === turn && newText !== null && isExactSubstring(r.quote, newText)));
    if (h.receipts.length || hasRow(h.id)) out.push(h);
  }
  return out;
}

// ------------------------------------------------------------------ POST /talk/edit

route("POST", "/talk/edit", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  if (typeof b.message_id !== "string") throw new ApiError("invalid", "", { field: "message_id" });
  const newText = text(b);
  const row = await loadMeRow(db, b.message_id);
  const conversation = await loadConversation(db, row.conversation_id as string);
  const turn = row.turn as number;
  // PSY 16 Nov 2c/4b: the edited words are read before anything changes, and that is the only reading (QA 16 Nov F1/F2): a stop
  // stands (no later reading may clear it), and a second reading that fails after the row changed can no longer leave a half-done edit.
  // Unreadable: nothing is edited, superseded or re-checked.
  const pre = await requireSafetyPass(ctx, newText, "talk");
  if (pre.routed === "unavailable") {
    return json({
      conversation: await conversationWithCounts(db, conversation, ctx.tz), message: messageObject(row), reply: unreadBody(), latency_ms: 0,
      superseded: [], receipts_updated: 0, beliefs_removed: [],
    });
  }
  const { data: edited, error } = await db.from("messages").update({ text: newText, edited_at: new Date().toISOString(), superseded: false }).eq("id", row.id).select("*").single();
  if (error) dbError(error, "messages.update");
  // Every reply from this turn on, and the person's later turns, leave the live branch (they stay as history).
  const { data: later } = await db.from("messages").select("id,turn,role").eq("conversation_id", conversation.id).eq("superseded", false).is("deleted_at", null).gte("turn", turn).neq("id", row.id);
  const superseded = (later ?? []).map((m) => m.id as string);
  if (superseded.length) await db.from("messages").update({ superseded: true }).in("id", superseded);
  const receipts = await recheckReceipts(db, owner, row.id as string, newText);
  const { data: rowIds } = await db.from("beliefs").select("id").eq("owner", owner).neq("status", "deleted");
  const has = new Set((rowIds ?? []).map((r) => r.id as string));
  const hyps = pruneHypotheses(((conversation.hypotheses as Belief[]) ?? []), turn, newText, (id) => has.has(id));
  const patch: Row = { hypotheses: hyps };
  if (typeof conversation.risk_turn === "number" && conversation.risk_turn >= turn) patch.risk_turn = null;
  const { data: conv, error: cErr } = await db.from("conversations").update(patch).eq("id", conversation.id).select("*").single();
  if (cErr) dbError(cErr, "conversations.update");
  return turnReply(ctx, await runTurn(ctx, conv, edited, turn, null, undefined, { stop: pre.stop, risk: pre.risk, reason: pre.reason }), { superseded, receipts_updated: receipts.kept, beliefs_removed: receipts.beliefsRemoved });
});

// ------------------------------------------------------------------ DELETE /talk/messages/:id

route("DELETE", "/talk/messages/:id", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const row = await loadMeRow(db, ctx.params.id);
  const conversation = await loadConversation(db, row.conversation_id as string);
  const turn = row.turn as number;
  await db.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", row.id);
  const { data: replies } = await db.from("messages").select("id").eq("conversation_id", conversation.id).eq("turn", turn).eq("role", "presence").eq("superseded", false);
  const superseded = (replies ?? []).map((m) => m.id as string);
  if (superseded.length) await db.from("messages").update({ superseded: true }).in("id", superseded);
  const receipts = await recheckReceipts(db, owner, row.id as string, null);
  const { data: rowIds } = await db.from("beliefs").select("id").eq("owner", owner).neq("status", "deleted");
  const has = new Set((rowIds ?? []).map((r) => r.id as string));
  const hyps = pruneHypotheses(((conversation.hypotheses as Belief[]) ?? []), turn, null, (id) => has.has(id));
  const patch: Row = { hypotheses: hyps };
  if (conversation.risk_turn === turn) patch.risk_turn = null;
  await db.from("conversations").update(patch).eq("id", conversation.id);
  return json({ deleted: row.id, receipts_removed: receipts.removed, beliefs_removed: receipts.beliefsRemoved, superseded });
});

// ------------------------------------------------------------------ POST /talk/finish

/** Finish calls booked for this conversation since the person last talked: 0 on a first Done, 1 or more on a retry. A failed lookup counts as
 *  a retry already spent (the old end-the-conversation path), never as a free extra model call. */
async function countFinishCallsSinceLastTurn(ctx: Ctx, conversationId: string, since: string | null): Promise<number> {
  let q = ctx.service.from("engine_calls").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("purpose", "finish");
  if (since) q = q.gte("created_at", since);
  const { count, error } = await q;
  return error || count === null ? 1 : count;
}

route("POST", "/talk/finish", async (ctx) => {
  const started = performance.now();
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  if (typeof b.conversation_id !== "string") throw new ApiError("invalid", "", { field: "conversation_id" });
  const conversation = await loadConversation(db, b.conversation_id);
  if (conversation.status === "finished") throw new ApiError("conflict", "", { status: "finished" });
  const cid = conversation.id as string;
  const now = new Date().toISOString();

  // The person's ratings write straight to the map (law 3).
  for (const r of Array.isArray(b.ratings) ? b.ratings as Row[] : []) {
    if (!r || typeof r.belief_id !== "string" || !["not", "partly", "very"].includes(String(r.rating))) throw new ApiError("invalid", "", { field: "ratings" });
    const status = statusForRating(r.rating as "not" | "partly" | "very");
    const { data: cur } = await db.from("beliefs").select("status,rating").eq("id", r.belief_id).eq("owner", owner).maybeSingle();
    if (!cur) throw new ApiError("not_found", "", { where: "belief", id: r.belief_id });
    if (cur.rating === r.rating && cur.status === status) continue;         // a retried finish re-sends the same ratings; keep the first undo state
    const patch: Row = { rating: r.rating, status, rated_at: now, previous_status: cur.status, previous_rating: cur.rating };
    if (status === "confirmed") { patch.confirmed_at = now; patch.set_aside_at = null; } else patch.set_aside_at = now;
    const { error } = await db.from("beliefs").update(patch).eq("id", r.belief_id).eq("owner", owner);
    if (error) dbError(error, "beliefs.update");
  }

  let summary: string | null = null, ref: string | null = null, nextTime = "", openThreads: string[] = [];
  let hypothesesAfter: Belief[] | null = [];
  let stillWorking = false;
  if (conversation.risk_turn === null || conversation.risk_turn === undefined) {
    const loaded = await loadState(db, { id: owner, name: await profileName(db, owner) }, conversation);
    const ratings = new Map<string, Rating>();
    for (const h of loaded.state.hypotheses.values()) { const r = engineRating(loaded.rows.get(h.id)?.rating); if (r) ratings.set(h.id, r); }
    const scope = scopeFor(ctx, cid);
    const ledger = new PostgresLedger(ctx.service, scope);
    const client = clientFor(ctx, ledger, TALK_FINISH_TIMEOUT_MS);
    const priorFinishCalls = await countFinishCallsSinceLastTurn(ctx, cid, conversation.last_active_at as string | null);
    const finish = await finishSession(client, loaded.state, ratings);
    await traceExchanges(ctx, scope, ledger, [finish.exchange, finish.repairExchange].filter((x): x is ModelExchange => x !== null));
    if (finish.failed && finish.failed !== "empty session") {
      // The conversation still ends (the ratings are saved; unrated guesses go to To confirm); the summary is the only loss.
      if ([finish.exchange, finish.repairExchange].some((x) => x?.error?.startsWith("budget_unavailable"))) { const e = ledger.refusalError("talk"); throw new ApiError(e.code, e.message, { ...e.extra, saved: true }); }
      ref = await recordError(ctx.service, owner, "talk/finish", "finish_failed", finish.failed);
      hypothesesAfter = null;                                               // keep them for a later Finish or a continued talk
      // The first failed finish since the person last talked leaves the conversation open for one more try (v1.79); the second ends it as before.
      if (finishFailureDisposition({ failed: finish.failed, exchanges: [finish.exchange, finish.repairExchange], priorFinishCalls }) === "retry") stillWorking = true;
    } else if (!finish.failed) {
      await persistBeliefs(db, owner, loaded, loaded.state.map.beliefs, { conversationId: cid, ratingFor: (id) => ratings.get(id), minConfidence: 0.7 });
      summary = finish.summary || null; nextTime = finish.nextTime; openThreads = finish.openThreads;
    }
  }
  if (stillWorking) {
    // v1.79: nothing is marked finished and nothing is lost; the same request again is the one retry (ratings are already saved).
    const { data: open } = await db.from("beliefs").select("*").eq("conversation_id", cid).in("status", ["confirmed", "guess"]).order("created_at");
    return json({ conversation: await conversationWithCounts(db, conversation, ctx.tz), added: (open ?? []).filter((r) => r.status === "confirmed").length,
      to_confirm: (open ?? []).filter((r) => r.status === "guess").length, beliefs: await beliefsFor(db, open ?? []), summary: null, ref, still_working: true,
      latency_ms: Math.round(performance.now() - started) });
  }
  // A risk stop (law 8, A48(b)): no consolidation call; the cards rated before it are already on the map, nothing else is added.
  const patch: Row = { status: "finished", finished_at: now, paused_at: null, last_active_at: now, summary, next_time: nextTime || null, open_threads: openThreads };
  if (hypothesesAfter !== null) patch.hypotheses = hypothesesAfter;
  const { data: conv, error } = await db.from("conversations").update(patch).eq("id", cid).select("*").single();
  if (error) dbError(error, "conversations.update");
  const { data: rows } = await db.from("beliefs").select("*").eq("conversation_id", cid).in("status", ["confirmed", "guess"]).order("created_at");
  const added = (rows ?? []).filter((r) => r.status === "confirmed").length;
  const toConfirm = (rows ?? []).filter((r) => r.status === "guess").length;
  return json({ conversation: await conversationWithCounts(db, conv, ctx.tz), added, to_confirm: toConfirm, beliefs: await beliefsFor(db, rows ?? []), summary, ref,
    latency_ms: Math.round(performance.now() - started) });
});
