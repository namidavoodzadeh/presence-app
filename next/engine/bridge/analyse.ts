// Analyse (BRIDGE-ENGINE §3.1): one model call, then code checks. A quote that is not an exact substring of the
// message is a failed check; one repair call names it. Activated ids outside the sender's endorsed beliefs are dropped.

import type { Belief, CheckResult, ModelExchange } from "../types.ts";
import type { ModelClient, ModelMessage } from "../model/client.ts";
import { extractJson } from "../model/client.ts";
import { clinicalHits, isExactSubstring, words } from "../words.ts";
import { kindHolds, kindViolations } from "./validate.ts";
import { FRICTION_KINDS, POINT_KINDS } from "./types.ts";
import { FEELINGS } from "../types.ts";
import type { Feeling } from "../types.ts";
import type { Activated, Analysis, BridgeSafety, Friction, FrictionKind, Point, PointKind, ReceiverBelief, Relationship, SafetyQuote } from "./types.ts";

import { BRIDGE_ANALYSE, BRIDGE_REPAIR } from "../prompt_text.ts";
export const ANALYSE_PROMPT = BRIDGE_ANALYSE;
export const REPAIR_PROMPT = BRIDGE_REPAIR;
export const ANALYSE_MAX_TOKENS = 1500;

export function beliefList(beliefs: Belief[]): string {
  const endorsed = beliefs.filter((b) => b.status === "endorsed");
  if (!endorsed.length) return "(none confirmed yet)";
  return endorsed.map((b) => `- ${b.id} "${b.label}": ${b.statement} (${b.receipts.length} receipt${b.receipts.length === 1 ? "" : "s"})`).join("\n");
}

/** E27 (2c): the receiver's shared beliefs, wording only. Never a receipt: the receiver's own words stay theirs (law 10). */
export function receiverList(shared: ReceiverBelief[]): string {
  if (!shared.length) return "(none shared)";
  return shared.map((b) => `- ${b.id} "${b.label}": ${b.statement}`).join("\n");
}

export function analysePackage(message: string, relationship: Relationship, beliefs: Belief[], receiverShared: ReceiverBelief[] = []): string {
  return `# MESSAGE (to the sender's ${relationship})\n${message}\n\n# THE SENDER'S CONFIRMED BELIEFS\n${beliefList(beliefs)}` +
    `\n\n# BELIEFS THE RECEIVER CHOSE TO SHARE WITH THE SENDER\n${receiverList(receiverShared)}`;
}

function readTouches(raw: unknown): Activated[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((a) => a && typeof a === "object" && typeof (a as Record<string, unknown>).beliefId === "string")
    .map((a) => ({ beliefId: String((a as Record<string, unknown>).beliefId), why: String((a as Record<string, unknown>).why ?? ""),
      ...(typeof (a as Record<string, unknown>).quote === "string" ? { quote: String((a as Record<string, unknown>).quote) } : {}) }));
}

export function readAnalysis(value: unknown): { analysis: Analysis | null; problems: string[] } {
  const problems: string[] = [];
  if (!value || typeof value !== "object") return { analysis: null, problems: ["reply is not a JSON object"] };
  const v = value as Record<string, unknown>;
  const points: Point[] = [];
  for (const [i, raw] of (Array.isArray(v.points) ? v.points : []).entries()) {
    const p = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
    const kind = typeof p.kind === "string" && (POINT_KINDS as readonly string[]).includes(p.kind) ? p.kind as PointKind : null;
    if (!kind || typeof p.quote !== "string" || !p.quote.trim()) { problems.push(`points[${i}] is incomplete`); continue; }
    points.push({ kind, quote: p.quote });
  }
  const frictions: Friction[] = [];
  for (const [i, raw] of (Array.isArray(v.frictions) ? v.frictions : []).entries()) {
    const f = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
    const kind = typeof f.kind === "string" && (FRICTION_KINDS as readonly string[]).includes(f.kind) ? f.kind as FrictionKind : null;
    if (!kind || typeof f.quote !== "string" || !f.quote.trim()) { problems.push(`frictions[${i}] is incomplete or has an unknown kind (${String(f.kind)})`); continue; }
    frictions.push({ kind, quote: f.quote });
  }
  const activated = readTouches(v.activated);
  const landsOn = readTouches(v.lands_on ?? v.landsOn);
  const feelingRaw = (v.feeling && typeof v.feeling === "object") ? v.feeling as Record<string, unknown> : {};
  const intensity = typeof feelingRaw.intensity === "number" ? Math.max(1, Math.min(5, Math.round(feelingRaw.intensity))) : 3;
  const feeling = { name: typeof feelingRaw.name === "string" ? feelingRaw.name.trim() : "", intensity };
  if (!feeling.name) problems.push("feeling.name missing");
  const safetyRaw = (v.safety && typeof v.safety === "object") ? v.safety as Record<string, unknown> : { level: v.safety };
  const level = String(safetyRaw.level ?? "").trim().toLowerCase();
  // Spec E: safety_flag true = risk the gate passed; treated as CHECK, which holds the message like a stop.
  const flagged = safetyRaw.safety_flag === true || v.safety_flag === true;
  const safety: BridgeSafety = level === "risk" || (flagged && level === "none") ? "risk" : level === "threat_or_abuse" || level === "abuse" || level === "threat" ? "threat_or_abuse" : "none";
  if (!["none", "risk", "threat_or_abuse", "abuse", "threat"].includes(level)) problems.push(`safety.level missing or unknown (${level || "empty"})`);
  const safetyQuotes: SafetyQuote[] = [];
  if (safety === "threat_or_abuse") {
    for (const raw of (Array.isArray(safetyRaw.quotes) ? safetyRaw.quotes : [])) {
      const q = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
      const kind = q.kind === "threat" || q.kind === "abuse" ? q.kind : level === "threat" ? "threat" : level === "abuse" ? "abuse" : null;
      if (kind && typeof q.quote === "string" && q.quote.trim()) safetyQuotes.push({ kind, quote: q.quote });
    }
  }
  if (points.length === 0 && safety === "none") problems.push("no points found");
  if (problems.length && (points.length === 0 || !feeling.name)) return { analysis: null, problems };
  return { analysis: { points, feeling, frictions, activated, landsOn, safety, safetyReason: String(safetyRaw.reason ?? ""), safetyQuotes, tone: toneOf(v.tone, feeling.name) }, problems };
}

/** The seven-word tone (engine item 6): the model's word when it is one of the seven, else read from the feeling's name. */
export function toneOf(tone: unknown, feelingName: string): Feeling {
  if (typeof tone === "string" && (FEELINGS as readonly string[]).includes(tone.trim().toLowerCase())) return tone.trim().toLowerCase() as Feeling;
  const n = feelingName.toLowerCase();
  if (/\b(angry|anger|furious|mad|fed up|frustrat|irritat|resent|annoy|livid)/.test(n)) return "angry";
  if (/\b(lonely|left out|alone|unseen|invisible|ignored|afterthought|forgotten)/.test(n)) return "lonely";
  if (/\b(sad|hurt|disappoint|let down|tired|worn|heavy|low|grief|ashamed|small)/.test(n)) return "sad";
  if (/\b(confus|lost|unsure|torn|puzzl|mixed)/.test(n)) return "confused";
  if (/\b(excit|eager|thrill|keen|can't wait)/.test(n)) return "excited";
  if (/\b(happy|glad|grateful|relieved|warm|pleased|proud)/.test(n)) return "happy";
  return "neutral";
}

export interface AnalysisChecks { checks: CheckResult[]; analysis: Analysis; needsRepair: boolean }

// K-0107's candidate is deliberately an exported, inert helper.  Production
// callers keep the analysis unchanged; an offline evaluator can apply this
// candidate beside its baseline without making a route or feature decision.
const LINK_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "i", "in", "is", "it", "me", "my",
  "of", "on", "or", "our", "so", "that", "the", "their", "them", "this", "to", "was", "we", "were", "with", "you", "your",
]);

function subjectWords(text: string): Set<string> {
  return new Set(words(text).filter((word) => word.length > 2 && !LINK_STOP_WORDS.has(word)));
}

/** K-0107 laboratory candidate; callers must opt in explicitly. */
export function gateActivatedLinks(analysis: Analysis, beliefs: Belief[]): Analysis {
  const hasFriction = analysis.frictions.length > 0;
  const hasComplaintOrFeeling = analysis.points.some((point) => point.kind === "complaint" || point.kind === "feeling");
  if (!hasFriction && !hasComplaintOrFeeling) return { ...analysis, activated: [] };
  const endorsed = new Map(beliefs.filter((belief) => belief.status === "endorsed").map((belief) => [belief.id, belief]));
  return {
    ...analysis,
    activated: analysis.activated.filter((link) => {
      const belief = endorsed.get(link.beliefId);
      if (!belief || !link.quote) return false;
      const quoteWords = subjectWords(link.quote);
      if (!quoteWords.size) return false;
      const evidenceWords = subjectWords([belief.label, belief.statement, ...belief.receipts.map((receipt) => receipt.quote)].join(" "));
      return [...quoteWords].some((word) => evidenceWords.has(word));
    }),
  };
}

/** Code checks: exact quotes, known endorsed ids, shared receiver ids only, no clinical words in what the sender might see. */
export function checkAnalysis(analysis: Analysis, message: string, beliefs: Belief[], receiverShared: ReceiverBelief[] = []): AnalysisChecks {
  const checks: CheckResult[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const badPoints = analysis.points.filter((p) => !isExactSubstring(p.quote, message));
  add("point_quotes_exact", badPoints.length === 0, badPoints.length ? `not in the message: ${badPoints.map((p) => JSON.stringify(p.quote)).join(", ")}` : `${analysis.points.length} point(s), all exact quotes`);
  const badFrictions = analysis.frictions.filter((f) => !isExactSubstring(f.quote, message));
  add("friction_quotes_exact", badFrictions.length === 0, badFrictions.length ? `not in the message: ${badFrictions.map((f) => JSON.stringify(f.quote)).join(", ")}` : `${analysis.frictions.length} friction(s), all exact quotes`);
  // E27 stability (CEO 13:15 PT): each friction's kind has its sign in its own words, or the rewrite is asked for a change
  // it cannot make. A violation asks for the one repair call; one that survives it is dropped (analyse below).
  // A safety stop reads nothing further from the message (law 8), so its frictions are never checked or repaired.
  const wrongKind = analysis.safety === "none" ? kindViolations(analysis.frictions, message) : [];
  add("friction_kinds_hold", wrongKind.length === 0, wrongKind.length ? wrongKind.join("; ") : `${analysis.frictions.length} friction(s), each kind in its words`);
  const endorsed = new Set(beliefs.filter((b) => b.status === "endorsed").map((b) => b.id));
  const dropped = analysis.activated.filter((a) => !endorsed.has(a.beliefId));
  const kept = analysis.activated.filter((a) => endorsed.has(a.beliefId));
  add("activated_endorsed_only", true, dropped.length ? `dropped ${dropped.map((a) => a.beliefId).join(", ")} (not the sender's endorsed beliefs)` : `${kept.length} activated, all endorsed`);
  // Consent (law 10): a receiver id outside what they shared is dropped, never trusted.
  const shared = new Set(receiverShared.map((b) => b.id));
  const landsOn = (analysis.landsOn ?? []).filter((a) => shared.has(a.beliefId));
  const unshared = (analysis.landsOn ?? []).length - landsOn.length;
  add("lands_on_shared_only", true, unshared ? `dropped ${unshared} receiver id(s) not shared with the sender` : `${landsOn.length} lands_on, all shared`);
  const clinical = clinicalHits(`${analysis.feeling.name} ${[...analysis.activated, ...landsOn].map((a) => a.why).join(" ")}`);
  add("no_clinical_words", clinical.length === 0, clinical.length ? clinical.join(", ") : "clean");
  // The threat or abuse quotes are underlines, never a verdict: an inexact one is dropped (no repair call for it), the decision stands either way.
  const exactSafety = analysis.safetyQuotes.filter((q) => isExactSubstring(q.quote, message));
  if (analysis.safetyQuotes.length) add("safety_quotes_exact", true, `${exactSafety.length} of ${analysis.safetyQuotes.length} threat/abuse quote(s) exact; the rest dropped`);
  return { checks, analysis: { ...analysis, activated: kept, landsOn, safetyQuotes: exactSafety }, needsRepair: badPoints.length > 0 || badFrictions.length > 0 || wrongKind.length > 0 || clinical.length > 0 };
}

export interface AnalyseOutcome {
  analysis: Analysis | null;
  checks: CheckResult[];
  exchanges: ModelExchange[];
  repaired: boolean;
  failed: string | null;
}

export async function analyse(client: ModelClient, message: string, relationship: Relationship, beliefs: Belief[], receiverShared: ReceiverBelief[] = []): Promise<AnalyseOutcome> {
  const messages: ModelMessage[] = [{ role: "user", content: analysePackage(message, relationship, beliefs, receiverShared) }];
  const first = await client.complete({ purpose: "analyse", system: ANALYSE_PROMPT, messages, maxTokens: ANALYSE_MAX_TOKENS });
  const out: AnalyseOutcome = { analysis: null, checks: [], exchanges: [first], repaired: false, failed: null };
  let e = evaluate(first, message, beliefs, receiverShared);
  out.checks = e.checks;
  if (!e.analysis || e.needsRepair) {
    const failures = e.analysis ? e.checks.filter((c) => !c.ok).map((c) => `- ${c.name}: ${c.detail}`).join("\n") : `- json: ${e.parseError}`;
    const second = await client.complete({ purpose: "analyse_repair", system: ANALYSE_PROMPT, maxTokens: ANALYSE_MAX_TOKENS,
      messages: [...messages, { role: "assistant", content: first.rawResponse || "(empty)" }, { role: "user", content: REPAIR_PROMPT.replace("{{failures}}", failures) }] });
    out.exchanges.push(second);
    out.repaired = true;
    const again = evaluate(second, message, beliefs, receiverShared);
    out.checks = [...e.checks.map((c) => ({ ...c, name: `first:${c.name}` })), ...again.checks];
    if (again.analysis) e = again;
  }
  if (!e.analysis) { out.failed = `no readable analysis: ${e.parseError ?? "unknown"}`; return out; }
  if (e.needsRepair) {
    // After repair, inexact quotes and kinds with no sign in their words are dropped rather than trusted; the trace shows which.
    const a = e.analysis;
    const exact = a.frictions.filter((f) => isExactSubstring(f.quote, message));
    out.analysis = { ...a, points: a.points.filter((p) => isExactSubstring(p.quote, message)), frictions: a.safety === "none" ? exact.filter((f) => kindHolds(f.kind, f.quote, message)) : exact };
    out.checks.push({ name: "inexact_quotes_dropped", ok: true, detail: `${a.points.length - out.analysis.points.length} point(s), ${a.frictions.length - exact.length} friction(s) dropped after repair` });
    const wrong = exact.length - out.analysis.frictions.length;
    if (wrong) out.checks.push({ name: "wrong_kinds_dropped", ok: true, detail: `${wrong} friction(s) whose kind had no sign in its words dropped after repair` });
    if (out.analysis.points.length === 0 && out.analysis.safety === "none") out.failed = "no exact point quote survived repair";
  } else out.analysis = e.analysis;
  return out;
}

interface Evaluated { analysis: Analysis | null; checks: CheckResult[]; needsRepair: boolean; parseError?: string }

function evaluate(exchange: ModelExchange, message: string, beliefs: Belief[], receiverShared: ReceiverBelief[]): Evaluated {
  if (exchange.error && !exchange.rawResponse) return { analysis: null, checks: [{ name: "model_call", ok: false, detail: exchange.error }], needsRepair: true, parseError: exchange.error };
  if (exchange.usage.outputTokens > 0 && exchange.usage.outputTokens >= exchange.request.maxTokens) {
    const detail = `reply cut off at ${exchange.request.maxTokens} output tokens`;
    return { analysis: null, checks: [{ name: "not_truncated", ok: false, detail }], needsRepair: true, parseError: detail };
  }
  let parsed: unknown;
  try { parsed = extractJson(exchange.rawResponse); }
  catch (err) { return { analysis: null, checks: [{ name: "valid_json", ok: false, detail: String(err) }], needsRepair: true, parseError: String(err) }; }
  const read = readAnalysis(parsed);
  const checks: CheckResult[] = [{ name: "valid_json", ok: true, detail: "parsed" }];
  for (const p of read.problems) checks.push({ name: "shape", ok: false, detail: p });
  if (!read.analysis) return { analysis: null, checks, needsRepair: true, parseError: read.problems.join("; ") };
  const c = checkAnalysis(read.analysis, message, beliefs, receiverShared);
  return { analysis: c.analysis, checks: [...checks, ...c.checks], needsRepair: c.needsRepair || read.problems.length > 0 };
}
