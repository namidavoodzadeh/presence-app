// V3 communication model, spec 4.7 carry-over: one background pass suggests a kind for each existing kenning. The person confirms a few at a time;
// unconfirmed items sit under Other and stay shared exactly as before. Sharing never widens. Words, dates, receipts, rating and sharing are kept exactly.
// This file is the rules and the Batch API request/response shapes. It makes no call: the job runner (not built) sends `buildBatchRequests` to the
// Batch API (50% off, non-live) and feeds the result lines to `planCarryOver`. Behind the owner-only switch. 0 AI cents to write and test.
import { keywordRisk, stops } from "./safety.ts";
import { checkBeforeSuggesting, COMM_CONFIDENCE_BAR } from "./comm_checks.ts";
import { COMM_KINDS, COMM_TOPICS, type CommItem, type CommKind, commItemProblems, NEVER_INFERRED_KINDS } from "./comm.ts";

/** What the pass reads of an existing kenning. The wording is the person's own and is never changed. */
export interface ExistingKenning {
  id: string;
  wording: string;
  /** The old topic (one of the old eight), kept only as the tag on a What-matters item. */
  oldTopic?: string | null;
  /** People the owner has granted this kenning to today (per-item grants). Sharing never widens beyond these. */
  grantedTo: readonly string[];
  /** Already carried over (comm_kind set) rows are skipped. */
  commKind?: CommKind | null;
}

/** The kinds the pass may suggest. lands_hard and this_week are never inferred (4.5); the rest are open to a suggestion the person confirms. */
export const CARRY_OVER_KINDS: readonly CommKind[] = COMM_KINDS.filter((k) => !NEVER_INFERRED_KINDS.includes(k));

// ---------------------------------------------------------------- the Batch API request
/** Cheapest model first; the job may use it only after the carry-over gold set passes (gate recorded in the job record, not decided here). */
export const CARRY_OVER_MODEL = "claude-haiku-5-5";
export const CARRY_OVER_MAX_TOKENS = 120;

/** Stable system prompt (prompt-cached across the whole batch). Closed list in, one JSON object out; no names, receipts or dates ever sent. */
export const CARRY_OVER_SYSTEM = [
  "You sort one sentence a person wrote about themselves into one kind of communication note. You never add words.",
  "Kinds: how_i_mean (what my words or silences mean), feels_like_care (what makes me feel looked after), bring_up (how to raise something with me),",
  "gets_heated (what I do when it gets tense), coming_back (what helps after a hard moment), matters (something I value or believe), other (anything else).",
  "Use matters for a belief or value. Use other whenever the sentence fits no kind well or is about someone else.",
  "If the sentence names a topic, topic is one of: relationships, work, family, body, money, meaning, politics, morality; otherwise null. Topic is only for matters.",
  'Reply with one JSON object and nothing else: {"kind":"<kind>","confidence":<0 to 1>,"topic":<topic or null>}.',
].join(" ");

export interface BatchRequest {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    system: { type: "text"; text: string; cache_control: { type: "ephemeral" } }[];
    messages: { role: "user"; content: string }[];
  };
}

/** Items whose wording trips the safety floor are never sent to a model; they stay under Other and the pass notes them. */
export function sendable(k: ExistingKenning): boolean {
  return !k.commKind && k.wording.trim().length > 0 && !stops(keywordRisk(k.wording));
}

/** One request per sendable kenning. custom_id is the kenning id only; the user message is the person's wording only. */
export function buildBatchRequests(items: readonly ExistingKenning[], model: string = CARRY_OVER_MODEL): BatchRequest[] {
  return items.filter(sendable).map((k) => ({
    custom_id: k.id,
    params: {
      model,
      max_tokens: CARRY_OVER_MAX_TOKENS,
      system: [{ type: "text", text: CARRY_OVER_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: k.wording.trim() }],
    },
  }));
}

export interface ModelAnswer { kind: CommKind; confidence: number; topic: string | null }

/** Parse one answer's text. Anything off the closed list is null (the item stays under Other); the model's words are never kept. */
export function parseModelAnswer(text: string): ModelAnswer | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let o: unknown;
  try { o = JSON.parse(m[0]); } catch { return null; }
  if (typeof o !== "object" || o === null) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.kind !== "string" || !(CARRY_OVER_KINDS as readonly string[]).includes(r.kind)) return null;
  const c = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const topic = typeof r.topic === "string" && (COMM_TOPICS as readonly string[]).includes(r.topic) ? r.topic : null;
  return { kind: r.kind as CommKind, confidence: c, topic };
}

/** One line of a Batch API results file ({custom_id, result:{type, message:{content:[{text}]}}}) to [id, answer]. Errored, expired or canceled lines give null. */
export function parseBatchLine(line: string): { id: string; answer: ModelAnswer | null } | null {
  let o: { custom_id?: unknown; result?: { type?: unknown; message?: { content?: { type?: string; text?: string }[] } } };
  try { o = JSON.parse(line); } catch { return null; }
  if (typeof o.custom_id !== "string") return null;
  if (o.result?.type !== "succeeded") return { id: o.custom_id, answer: null };
  const text = (o.result.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { id: o.custom_id, answer: parseModelAnswer(text) };
}

// ---------------------------------------------------------------- the plan
/** What every existing kenning holds before the person confirms anything: under Other, private to the comm model, legacy grants untouched. */
export interface CommPlaceholder { kind: "other"; scopeType: "everyone"; scopeValue: null; status: "private_only"; topic: null }
export const PLACEHOLDER: CommPlaceholder = { kind: "other", scopeType: "everyone", scopeValue: null, status: "private_only", topic: null };

export interface Suggestion { kind: CommKind; confidence: number; topic: string | null }
export interface CarryOverRow {
  id: string;
  /** Written for every row at once: Other, private to the comm model. The legacy grants keep governing who sees the kenning today. */
  placeholder: CommPlaceholder;
  /** Offered to the person only when present; absent = nothing to confirm, the item stays under Other. */
  suggestion: Suggestion | null;
  /** Why there is no suggestion (closed codes), for the job record. Never shown. */
  skipped: string | null;
}

/** Combine the batch results with the checks of 4.3. Suggesting `other` is no suggestion. Nothing about the wording changes. */
export function planCarryOver(items: readonly ExistingKenning[], answers: ReadonlyMap<string, ModelAnswer | null>): CarryOverRow[] {
  const rows: CarryOverRow[] = [];
  for (const k of items) {
    if (k.commKind) continue;                                   // already carried over
    const row: CarryOverRow = { id: k.id, placeholder: PLACEHOLDER, suggestion: null, skipped: null };
    rows.push(row);
    if (!sendable(k)) { row.skipped = k.wording.trim() ? "safety_floor" : "empty"; continue; }
    const a = answers.get(k.id) ?? null;
    if (!a) { row.skipped = "no_answer"; continue; }
    if (a.kind === "other") { row.skipped = "model_chose_other"; continue; }
    // 4.3 with the source that makes the confidence bar apply. A refusal of any kind leaves the item under Other.
    const v = checkBeforeSuggesting({ text: k.wording, kind: a.kind, source: "carry_over", confidence: a.confidence });
    if (!v.ok) { row.skipped = `check_${v.action}`; continue; }
    // Old topics survive only as the tag on matters: the model's topic, else the stored one, only if it is on the closed list.
    const old = k.oldTopic && (COMM_TOPICS as readonly string[]).includes(k.oldTopic) ? k.oldTopic : null;
    row.suggestion = { kind: a.kind, confidence: a.confidence, topic: a.kind === "matters" ? (a.topic ?? old) : null };
  }
  return rows;
}

/** The next few suggestions to show, strongest first, then oldest kenning first (input order). Default 3 at a time; never a count or a progress bar. */
export function nextToConfirm(rows: readonly CarryOverRow[], n = 3): CarryOverRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.suggestion)
    .sort((a, b) => (b.r.suggestion!.confidence - a.r.suggestion!.confidence) || (a.i - b.i))
    .slice(0, Math.max(0, n))
    .map((x) => x.r);
}

/** What is written when the person says "That's me" on one suggestion. Sharing never widens: the scope is exactly who has the grant today. */
export function confirmedItem(k: ExistingKenning, s: Suggestion, now: Date): CommItem & { lastConfirmedAt: string } {
  const grantees = [...new Set(k.grantedTo)];
  const lastConfirmedAt = now.toISOString();
  const topic = s.kind === "matters" ? s.topic : null;
  // One grantee: that person only. None, or more than one: the comm model keeps it private and the legacy grants carry on unchanged,
  // because a single scope cannot say "these two people" and anything wider than the grants would widen.
  const one = grantees.length === 1;
  const item: CommItem = one
    ? { kind: s.kind, scopeType: "person", scopeValue: grantees[0], status: s.kind === "other" ? "private_only" : "active", topic }
    : { kind: s.kind, scopeType: "everyone", scopeValue: null, status: "private_only", topic };
  return { ...item, lastConfirmedAt };
}

/** Invariants the job checks on its own output before writing a row (empty = fine). */
export function carryOverProblems(items: readonly ExistingKenning[], rows: readonly CarryOverRow[]): string[] {
  const p: string[] = [];
  const byId = new Map(items.map((k) => [k.id, k]));
  for (const r of rows) {
    const k = byId.get(r.id);
    if (!k) { p.push(`${r.id}: unknown`); continue; }
    if (commItemProblems(r.placeholder).length) p.push(`${r.id}: placeholder invalid`);
    if (r.placeholder.status !== "private_only" || r.placeholder.kind !== "other") p.push(`${r.id}: placeholder widens`);
    if (r.suggestion) {
      if (NEVER_INFERRED_KINDS.includes(r.suggestion.kind)) p.push(`${r.id}: inferred ${r.suggestion.kind}`);
      if (r.suggestion.confidence < COMM_CONFIDENCE_BAR) p.push(`${r.id}: below the bar`);
      const c = confirmedItem(k, r.suggestion, new Date(0));
      if (commItemProblems(c).length) p.push(`${r.id}: confirmed item invalid ${commItemProblems(c).join(",")}`);
      if (c.scopeType === "person" && !k.grantedTo.includes(c.scopeValue ?? "")) p.push(`${r.id}: scope outside grants`);
    }
  }
  return p;
}
