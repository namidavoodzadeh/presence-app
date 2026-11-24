// The Bridge pipeline (NEXT-ENGINE §3): analyse → plan → rewrite → verify (critic + code), one retry with the
// failures named, then could_not_bridge. Safety floor before any call; "nothing to change" is a valid result.

import type { CheckResult, ModelExchange } from "../types.ts";
import type { ModelClient, ModelMessage } from "../model/client.ts";
import { extractJson } from "../model/client.ts";
import { keywordRisk, RESOURCES } from "../safety.ts";
import { classReadings, semanticCheckDetail, semanticOff, semanticRisk } from "../safety_semantic.ts";
import type { SemanticRisk } from "../safety_semantic.ts";
import { candidateClasses, settleClear } from "../safety_classes.ts";
import { analyse } from "./analyse.ts";
import { DECLINE_LINE, makePlan } from "./plan.ts";
import { AIMED_AT_RECEIVER, buildInsight, INSIGHT_COPY } from "./insight.ts";
import { blockingFailures, maxBridgedWords, onlyFlaggedAsks, sameText, verifyCode } from "./verify.ts";
import { words } from "../words.ts";
import { FRICTION_KINDS } from "./types.ts";
import { beliefTouches } from "./touches.ts";
import { FEELINGS } from "../types.ts";
import type { Feeling } from "../types.ts";
import type { Analysis, BridgeResult, BridgeSafety, BridgeTrace, Change, Critic, Draft, Plan, Rewrite, RewriteAttempt, Sender } from "./types.ts";

import { BRIDGE_REWRITE, BRIDGE_VERIFY } from "../prompt_text.ts";
export const REWRITE_PROMPT = BRIDGE_REWRITE;
export const VERIFY_PROMPT = BRIDGE_VERIFY;
export const REWRITE_MAX_TOKENS = 1200;
export const VERIFY_MAX_TOKENS = 800;
export const SAFETY_LINE = RESOURCES.message;
export const NOTHING_TO_CHANGE_LINE = "Nothing to change. It says what you mean.";
/** The sender's text stands, and the one thing the plan found is an ask the words do not state: the fixed vague_ask note is the line. */
export const ASK_UNRESOLVED_LINE: string = INSIGHT_COPY.vague_ask;

/** The keyword floor routed for Bridge: harm aimed at the receiver is a threat; any other risk is a stop with resources. */
export function floorSafety(message: string): { risk: string; reason: string; routed: BridgeSafety } {
  const floor = keywordRisk(message);
  if (floor.risk === "none") return { ...floor, routed: "none" };
  if (floor.risk === "others" && AIMED_AT_RECEIVER.test(message)) return { ...floor, routed: "threat_or_abuse" };
  return { ...floor, routed: "risk" };
}

function emptyResult(draft: Draft): BridgeResult {
  return { draftId: draft.id, status: "could_not_bridge", original: draft.message, bridged: null, contextNote: null, changes: [], usedBeliefs: [],
    nothingToChange: false, askUnresolved: false, receiverAware: false, line: null, resources: null };
}

/** The frictions whose replacement takes away the words that carried the feeling. */
export const CARRIES_FEELING = new Set<string>(["heat", "sarcasm", "contempt", "mind_reading", "you_blame", "character"]);

/** Word targets for the two tighter alternatives: a step and two steps under the budget, never under the length floor
 *  (E27 g17: "a few words shorter" came back still over a 12-word budget on all three versions). */
export function alternativeTargets(originalWords: number): [number, number] {
  const max = maxBridgedWords(originalWords);
  const step = Math.max(2, Math.round(max * 0.1));
  const floor = Math.max(1, Math.ceil(originalWords * 0.6));
  return [Math.max(floor, max - step), Math.max(floor, max - 2 * step)];
}

export function rewritePackage(original: string, plan: Plan, sender: Sender, feeling?: Analysis["feeling"]): string {
  const rows = plan.transformations.map((t, i) => `${i + 1}. ${t.kind}: "${t.quote}" → ${t.instruction}`).join("\n");
  const voice = sender.earlierMessages.length ? sender.earlierMessages.map((m) => `- ${m}`).join("\n") : "- (only the original)";
  const context = plan.contextBelief
    ? `${plan.contextBelief.id} "${plan.contextBelief.label}": ${plan.contextBelief.statement}\n  in their words: ${plan.contextBelief.receipts.map((r) => `"${r}"`).join("; ")}`
    : "(none; contextNote must be null)";
  // E27: the rewriter names the feeling the analysis read, the one the critic checks, instead of guessing a stronger or other one.
  // Code says whether to name it: only when a planned transformation takes away the words that carried it. A demand or an ask
  // leaves the sender's own words to carry it (g07, g02: a feeling sentence there broke the word budget on every short demand).
  const name = plan.transformations.some((t) => CARRIES_FEELING.has(t.kind));
  const felt = feeling ? `\n\n# FEELING (the sender's, as read; the critic checks this one)\n${feeling.name}, intensity ${feeling.intensity} of 5\n${name
    ? "The plan takes away words that carried it: name it once, briefly, in the first person, unless the sender's own feeling words stay elsewhere in the message (then add no feeling sentence)."
    : "The plan leaves the words that carry it: add no feeling sentence."}` : "";
  const n = words(original).length;
  const [a1, a2] = alternativeTargets(n);
  const budget = `\n\n# LENGTH\nThe original has ${n} words; "bridged" has at most ${maxBridgedWords(n)} (code counts them; the context line is not counted). Make the alternatives about ${a1} and about ${a2} words.`;
  return `# ORIGINAL (from ${sender.firstName} to their ${plan.relationship})\n${original}${felt}${budget}\n\n# REGISTER\n${plan.register}\n\n# PLAN\n${rows}\n\n# VOICE SAMPLE (earlier messages by ${sender.firstName})\n${voice}\n\n# CONFIRMED BELIEF THIS TOUCHES (the sender's own; cite it only in contextNote)\n${context}`;
}

/** The critic sees the plan (A50, owner's director 10:45 10-27): a planned transformation keeps the point and changes its form, so it is
 *  not a lost point. Run 042013Z (Sonnet) rejected b01–b06 for the very change the plan ordered. */
/** The critic's verdict on the attempt before this one, so a retry is judged by the same standard (E27: on g08 the critic
 *  rejected a kept "Thanks" as mock thanks, then rejected the next attempt for dropping it). */
export type EarlierVerdict = { bridged: string; critic: Critic };

export function verifyPackage(original: string, analysis: Analysis, rewrite: Rewrite, plan: Plan, earlier?: EarlierVerdict | null): string {
  const points = analysis.points.map((p, i) => `${i + 1}. ${p.kind}: "${p.quote}"`).join("\n");
  const rows = plan.transformations.length
    ? plan.transformations.map((t, i) => `${i + 1}. ${t.kind}: "${t.quote}" → ${t.instruction}`).join("\n")
    : "(none: the rewrite was asked to change nothing)";
  const cited = rewrite.contextNote && plan.contextBelief
    ? `\n(cites the sender's confirmed belief ${plan.contextBelief.id} "${plan.contextBelief.label}": ${plan.contextBelief.statement}; in their words: ${plan.contextBelief.receipts.map((r) => `"${r}"`).join("; ")})`
    : rewrite.contextNote ? "\n(no belief was given for it: the whole line is added)" : "";
  return `# ORIGINAL\n${original}\n\n# POINTS FOUND IN IT\n${points}\n\n# FEELING\n${analysis.feeling.name}, intensity ${analysis.feeling.intensity}\n\n# RELATIONSHIP\n${plan.relationship}\n\n# PLAN (the transformations the rewriter was told to make; each keeps the point and changes its form)\n${rows}\n\n# REWRITE\n${rewrite.bridged}\n\n# CONTEXT LINE (separate from the rewrite; allowed; not an addition)\n${rewrite.contextNote ?? "(none)"}${cited}${earlierBlock(earlier)}`;
}

function earlierBlock(earlier?: EarlierVerdict | null): string {
  if (!earlier) return "";
  const list = (xs: string[]) => xs.length ? xs.map((x) => `"${x}"`).join("; ") : "none";
  return `\n\n# YOUR VERDICT ON THE EARLIER ATTEMPT (judge this one by the same standard)\nearlier rewrite: ${earlier.bridged}\nmissing: ${list(earlier.critic.pointsMissing)}\nadded: ${list(earlier.critic.added)}\nreceiver inner life: ${list(earlier.critic.receiverInnerLife)}\nnote: ${earlier.critic.notes || "none"}\nWhat you called added there is not missing here when this attempt leaves it out; what you called missing there is not added here when this attempt puts it back.`;
}

function readChanges(raw: unknown, problems: string[], at: string): Change[] {
  const changes: Change[] = [];
  for (const [i, item] of (Array.isArray(raw) ? raw : []).entries()) {
    const c = (item && typeof item === "object") ? item as Record<string, unknown> : {};
    const kind = typeof c.kind === "string" && ((FRICTION_KINDS as readonly string[]).includes(c.kind) || c.kind === "context") ? c.kind as Change["kind"] : null;
    if (!kind || typeof c.from !== "string" || typeof c.to !== "string") { problems.push(`${at}[${i}] is incomplete`); continue; }
    changes.push({ kind, from: c.from, to: c.to });
  }
  return changes;
}

/** Most versions the rewriter may return in one reply: its main one plus tighter alternatives (E27: on short drafts most rejected
 *  attempts were one to three words over the budget, which the model cannot count; code counts, and picks). */
export const MAX_REWRITE_VERSIONS = 3;

export function readRewrite(value: unknown): { rewrite: Rewrite | null; problems: string[]; versions: Rewrite[] } {
  if (!value || typeof value !== "object") return { rewrite: null, problems: ["reply is not a JSON object"], versions: [] };
  const v = value as Record<string, unknown>;
  const problems: string[] = [];
  const bridged = typeof v.bridged === "string" ? v.bridged.trim() : "";
  if (!bridged) problems.push("bridged missing");
  const contextNote = typeof v.contextNote === "string" && v.contextNote.trim() ? v.contextNote.trim() : null;
  const changes = readChanges(v.changes, problems, "changes");
  if (!bridged) return { rewrite: null, problems, versions: [] };
  const tone = typeof v.tone === "string" && (FEELINGS as readonly string[]).includes(v.tone.trim().toLowerCase()) ? v.tone.trim().toLowerCase() as Feeling : undefined;
  const rewrite: Rewrite = { bridged, contextNote, changes, ...(tone ? { tone } : {}) };
  const versions: Rewrite[] = [rewrite];
  // Alternatives share the main version's context line and tone; a malformed one is skipped, never repaired.
  for (const [i, raw] of (Array.isArray(v.alternatives) ? v.alternatives : []).entries()) {
    if (versions.length >= MAX_REWRITE_VERSIONS) break;
    const a = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
    const text = typeof a.bridged === "string" ? a.bridged.trim() : "";
    const own: string[] = [];
    const alt = readChanges(a.changes, own, `alternatives[${i}].changes`);
    if (!text || own.length || versions.some((x) => sameText(x.bridged, text))) continue;
    versions.push({ bridged: text, contextNote, changes: alt, ...(tone ? { tone } : {}) });
  }
  return { rewrite, problems, versions };
}

/** Code picks the version the critic sees: the first that passes every blocking code check and changed the text; else the first.
 *  A main version left word for word (an ask the words cannot resolve) stands: an alternative there could only invent the ask. */
export function pickVersion(original: string, versions: Rewrite[], plan: Plan, sender: Sender): { index: number; rewrite: Rewrite; checks: CheckResult[] } {
  const all = versions.map((rewrite, index) => ({ index, rewrite, checks: verifyCode(original, rewrite, plan, sender) }));
  if (sameText(original, all[0].rewrite.bridged)) return all[0];
  return all.find((x) => blockingFailures(x.checks).length === 0 && !sameText(original, x.rewrite.bridged)) ?? all[0];
}

export function readCritic(value: unknown): Critic | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const list = (x: unknown) => Array.isArray(x) ? x.map(String).filter((s) => s.trim()) : typeof x === "string" && x.trim() ? [x] : [];
  const pointsMissing = list(v.pointsMissing), added = list(v.added), receiverInnerLife = list(v.receiverInnerLife);
  const voice = typeof v.voice === "number" ? Math.max(1, Math.min(5, Math.round(v.voice))) : 3;
  const feelingPreserved = v.feelingPreserved !== false && String(v.feelingPreserved).toLowerCase() !== "false";
  // Code decides: the lists and scores rule, whatever the critic put in "pass", both ways. E27 g17, g18: empty lists, voice 3
  // and the feeling kept came back with "pass": false and a note that the voice was flat; the prompt's own rule says that passes.
  const pass = pointsMissing.length === 0 && added.length === 0 && receiverInnerLife.length === 0 && voice >= 3 && feelingPreserved;
  return { pass, pointsMissing, added, receiverInnerLife, voice, feelingPreserved, notes: String(v.notes ?? "") };
}

function readOrNull<T>(exchange: ModelExchange, reader: (v: unknown) => T): { value: T | null; error: string | null } {
  if (exchange.error && !exchange.rawResponse) return { value: null, error: exchange.error };
  if (exchange.usage.outputTokens > 0 && exchange.usage.outputTokens >= exchange.request.maxTokens) return { value: null, error: `reply cut off at ${exchange.request.maxTokens} output tokens` };
  try { return { value: reader(extractJson(exchange.rawResponse)), error: null }; } catch (err) { return { value: null, error: String(err) }; }
}

export interface BridgeOptions {
  /** The client for the semantic safety check (QA-B336); the run client when absent. The request names its own model. */
  safetyClient?: ModelClient;
  /** False skips the semantic safety check (the API's PRESENCE_SAFETY_SEMANTIC switch); absent or true runs it. */
  semanticCheck?: boolean;
}

export async function bridgeDraft(client: ModelClient, draft: Draft, sender: Sender, options: BridgeOptions = {}): Promise<BridgeTrace> {
  const started = performance.now();
  const beliefs = sender.map.beliefs;
  const trace: BridgeTrace = { draft, sender: { personaId: sender.personaId, firstName: sender.firstName, beliefs }, floor: floorSafety(draft.message),
    exchanges: [], analysis: null, analysisChecks: [], analysisRepaired: false, plan: null, attempts: [], result: emptyResult(draft), insight: null, targets: [], cents: 0, ms: 0 };
  const done = () => { trace.cents = trace.exchanges.reduce((n, e) => n + e.usage.cents, 0); trace.ms = performance.now() - started; return trace; };

  // PSY 15 Nov ruling 2 (as in Talk): a candidate floor row in one of five classes clears only with two keys, the class's written
  // condition and the semantic check naming that class on two parallel readings, read alone before any analysis call.
  let classReading: SemanticRisk | null = null;
  if (trace.floor.routed !== "none" && options.semanticCheck !== false && candidateClasses(draft.message, trace.floor).length) {
    const both = await classReadings(options.safetyClient ?? client, draft.message);
    for (const r of both) if (r.exchange) trace.exchanges.push(r.exchange);
    classReading = both[0];
    const cleared = settleClear(draft.message, trace.floor, both);
    trace.analysisChecks.push({ name: "safety_class", ok: true, detail: cleared ? `floor row cleared by two keys: ${cleared}` : `floor stop stands: ${both.map(semanticCheckDetail).join(" | ")}` });
    if (cleared) { trace.floor = { risk: "none", reason: `cleared: ${cleared}`, routed: "none" }; }
  }

  // Safety floor before any call (law 8).
  if (trace.floor.routed !== "none") {
    trace.result = decline(draft, trace.floor.routed);
    trace.analysisChecks.push({ name: "safety_floor", ok: true, detail: `stopped before any call: ${trace.floor.reason} → ${trace.floor.routed}` });
    trace.insight = buildInsight(draft.message, null, beliefs, trace.floor.routed);
    return done();
  }

  // K-0152: the hosted v92 503s are Edge CPU-limit failures. A semantic stop or
  // unreadable result needs no analysis, so read it before the 1,500-token analysis
  // instead of running both calls at once. A clear is still analysed; safety can only
  // add a stop, never clear one.
  const semantic = options.semanticCheck === false ? semanticOff()
    : classReading ? { ...classReading, exchange: null }   // already read (and its exchange kept) above
    : await semanticRisk(options.safetyClient ?? client, draft.message);
  if (semantic.exchange) trace.exchanges.push(semantic.exchange);
  trace.analysisChecks = [{ name: "safety_semantic", ok: semantic.ok, detail: semanticCheckDetail(semantic) }];
  // QA-B336 (COO 02:20Z): fail closed. With the check switched on (the API passes semanticCheck: true; an absent option keeps the harness's older fall-through), an unavailable or unreadable reading stops (resources), never passes.
  const unreadable = options.semanticCheck === true && !semantic.ok;
  // PSY 16 Nov 2b-2c: an unavailable reading is its own state, never a pass. Do
  // not run analysis merely to convert an unreadable safety read into another state.
  if (unreadable) {
    trace.unreadable = true;
    trace.result = { ...emptyResult(draft), status: "could_not_bridge" };
    return done();
  }
  if (semantic.ok && semantic.risk !== "none") {
    const routed: BridgeSafety = semantic.risk === "others" && AIMED_AT_RECEIVER.test(draft.message) ? "threat_or_abuse" : "risk";
    trace.result = decline(draft, routed);
    trace.insight = buildInsight(draft.message, null, beliefs, routed);
    return done();
  }
  const a = await analyse(client, draft.message, draft.relationship, beliefs, sender.receiverBeliefs ?? []);
  trace.exchanges.push(...a.exchanges);
  trace.analysisChecks = [...a.checks, ...trace.analysisChecks];
  trace.analysisRepaired = a.repaired;
  if (!a.analysis) { trace.result = { ...emptyResult(draft), line: "Couldn't read this one just now." }; trace.result.status = "could_not_bridge"; trace.analysisChecks.push({ name: "analysis_failed", ok: false, detail: a.failed ?? "unknown" }); return done(); }
  // The model's safety field can add a stop, never clear one (the floor already said none).
  const analysis = a.analysis;
  trace.analysis = analysis;
  const plan = makePlan(analysis, beliefs, draft.relationship);
  trace.plan = plan;
  trace.insight = buildInsight(draft.message, analysis, beliefs, analysis.safety);
  trace.touches = analysis.safety === "none" ? beliefTouches(draft.message, analysis, beliefs, sender.receiverBeliefs ?? []) : null;
  if (plan.outcome === "declined_safety" || plan.outcome === "declined_abuse") { trace.result = decline(draft, analysis.safety); return done(); }
  if (plan.outcome === "nothing_to_change") {
    trace.result = { ...emptyResult(draft), status: "ok", bridged: draft.message, nothingToChange: true, usedBeliefs: [], line: NOTHING_TO_CHANGE_LINE };
    return done();
  }

  // Rewrite → verify, one retry with the failures named.
  const base: ModelMessage[] = [{ role: "user", content: rewritePackage(draft.message, plan, sender, analysis.feeling) }];
  let messages = base;
  let earlier: EarlierVerdict | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const purpose = attempt === 1 ? "rewrite" : "rewrite_retry";
    const exchange = await client.complete({ purpose, system: REWRITE_PROMPT, messages, maxTokens: REWRITE_MAX_TOKENS });
    trace.exchanges.push(exchange);
    const row: RewriteAttempt = { exchange, rewrite: null, codeChecks: [], critic: null, pass: false };
    trace.attempts.push(row);
    const read = readOrNull(exchange, readRewrite);
    const failures: string[] = [];
    if (!read.value || !read.value.rewrite) {
      row.codeChecks.push({ name: "valid_json", ok: false, detail: read.error ?? read.value?.problems.join("; ") ?? "unreadable" });
      failures.push(`- json: ${read.error ?? read.value?.problems.join("; ")}`);
    } else {
      const pick = pickVersion(draft.message, read.value.versions, plan, sender);
      row.rewrite = pick.rewrite;
      row.versions = read.value.versions.map((v) => v.bridged);
      const chosen = read.value.versions.length > 1
        ? [{ name: "version_chosen", ok: true, detail: `version ${pick.index + 1} of ${read.value.versions.length}, the first to pass the code checks` }]
        : [];
      row.codeChecks = [{ name: "valid_json", ok: true, detail: "parsed" }, ...chosen, ...read.value.problems.map((p) => ({ name: "shape", ok: false, detail: p })), ...pick.checks];
      const blocking = blockingFailures(row.codeChecks);
      failures.push(...blocking.map((c) => `- ${c.name}: ${c.detail}`));
      // The text came back as it was. If the only planned frictions were asks the words could not resolve, that is the honest
      // answer: nothing_to_change with the ask note, no critic call (a retry could only invent the ask). Any other unchanged
      // text is a failed attempt: "ok" requires a changed text (COO 15:15 10-27, run 2 b07).
      if (sameText(draft.message, row.rewrite.bridged)) {
        if (failures.length === 0 && onlyFlaggedAsks(draft.message, row.rewrite, plan)) {
          row.codeChecks.push({ name: "ask_unresolved", ok: true, detail: "the text stands; the sender is told it does not yet say what they want them to do" });
          row.pass = true;
          trace.result = { ...emptyResult(draft), status: "ok", bridged: draft.message, nothingToChange: true, askUnresolved: true, usedBeliefs: [], line: ASK_UNRESOLVED_LINE };
          return done();
        }
        failures.push("- text_changed: the bridged text is the original, word for word; apply the plan's transformations, or flag a vague_ask with to = from only when the sender's words give no ask");
      }
      // The critic runs even when code failed, so the trace shows both views; its result counts toward the retry text.
      const criticExchange = await client.complete({ purpose: attempt === 1 ? "verify" : "verify_retry", system: VERIFY_PROMPT, maxTokens: VERIFY_MAX_TOKENS,
        messages: [{ role: "user", content: verifyPackage(draft.message, analysis, row.rewrite, plan, earlier) }] });
      trace.exchanges.push(criticExchange);
      const critic = readOrNull(criticExchange, readCritic);
      row.critic = { exchange: criticExchange, read: critic.value ?? null };
      if (!critic.value) failures.push(`- critic: unreadable (${critic.error ?? "no JSON"})`);
      else if (!critic.value.pass) {
        if (critic.value.pointsMissing.length) failures.push(`- points missing: ${critic.value.pointsMissing.join("; ")}`);
        if (critic.value.added.length) failures.push(`- added by the rewrite (the sender did not write this): ${critic.value.added.join("; ")}`);
        if (critic.value.receiverInnerLife.length) failures.push(`- about the receiver's inner life: ${critic.value.receiverInnerLife.join("; ")}`);
        if (critic.value.voice < 3) failures.push(`- voice: ${critic.value.voice}/5, not the sender's`);
        if (!critic.value.feelingPreserved) failures.push("- the feeling was lost or softened by more than one step");
        if (critic.value.notes.trim()) failures.push(`- the critic's note: ${critic.value.notes.trim()}`);
      }
      if (critic.value) earlier = { bridged: row.rewrite.bridged, critic: critic.value };
    }
    row.pass = failures.length === 0;
    if (row.pass && row.rewrite) {
      trace.result = { ...emptyResult(draft), status: "ok", bridged: row.rewrite.bridged, contextNote: row.rewrite.contextNote, changes: row.rewrite.changes,
        usedBeliefs: row.rewrite.contextNote && plan.contextBelief ? [plan.contextBelief.id] : [] };
      return done();
    }
    messages = [...base, { role: "assistant", content: exchange.rawResponse || "(empty)" },
      { role: "user", content: `Your rewrite failed these checks:\n\n${failures.join("\n")}\n\nWrite it again: ONE JSON object in the same shape. Keep every point, keep the sender's voice, add nothing they did not write, say nothing about the receiver's inner life.` }];
  }
  trace.result = { ...emptyResult(draft), status: "could_not_bridge", line: "Couldn't find a version that keeps every point. Your words stand." };
  return done();
}

function decline(draft: Draft, safety: BridgeSafety): BridgeResult {
  const r = emptyResult(draft);
  if (safety === "risk") return { ...r, status: "declined_safety", line: SAFETY_LINE, resources: RESOURCES };
  return { ...r, status: "declined_abuse", line: DECLINE_LINE };
}

/** Targets for one draft (NEXT-ENGINE §4), checked by code after the run. */
export function draftTargets(t: BridgeTrace): CheckResult[] {
  const out: CheckResult[] = [];
  const e = t.draft.expected;
  const wanted = e.safety === "risk" ? "declined_safety" : e.safety === "threat_or_abuse" ? "declined_abuse" : "ok";
  // A draft whose only expected friction is a vague_ask may end as nothing_to_change with the ask note: the words gave no ask to state.
  const askOnly = e.frictions.length > 0 && e.frictions.every((k) => k === "vague_ask");
  const stateOk = t.result.status === wanted && (!e.nothingToChange || t.result.nothingToChange) &&
    (e.nothingToChange || e.safety !== "none" || !t.result.nothingToChange || (askOnly && t.result.askUnresolved));
  const got = `${t.result.status}${t.result.nothingToChange ? (t.result.askUnresolved ? " (nothing to change: ask unresolved)" : " (nothing to change)") : ""}`;
  out.push({ name: "state_correct", ok: stateOk, detail: `expected ${wanted}${e.nothingToChange ? " (nothing to change)" : askOnly ? " (or nothing to change with the ask unresolved)" : ""}, got ${got}` });
  if (e.safety !== "none") {
    const noRewrite = t.attempts.length === 0 && !t.exchanges.some((x) => x.purpose.startsWith("rewrite"));
    out.push({ name: "safety_no_rewrite", ok: noRewrite && (e.safety !== "risk" || t.result.resources !== null), detail: noRewrite ? (e.safety === "risk" ? (t.result.resources ? "stopped, resources shown, no rewrite call" : "stopped but no resources") : "declined, no rewrite call") : "a rewrite call was made" });
    return out;
  }
  if (t.analysis) {
    const exact = t.analysisChecks.filter((c) => !c.name.startsWith("first:") && (c.name === "point_quotes_exact" || c.name === "friction_quotes_exact")).every((c) => c.ok);
    out.push({ name: "analysis_quotes_exact", ok: exact, detail: `${t.analysis.points.length} point(s), ${t.analysis.frictions.length} friction(s)${t.analysisRepaired ? ", analysis repaired once" : ""}` });
    const found = new Set(t.analysis.frictions.map((f) => f.kind));
    const missing = e.frictions.filter((k) => !found.has(k));
    out.push({ name: "expected_frictions_found", ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}; found: ${[...found].join(", ") || "none"}` : `found: ${[...found].join(", ") || "none (as expected)"}` });
  } else out.push({ name: "analysis_quotes_exact", ok: false, detail: "no analysis" });
  if (t.result.status === "ok" && !t.result.nothingToChange) {
    out.push({ name: "bridged_text_changed", ok: !sameText(t.draft.message, t.result.bridged ?? ""), detail: sameText(t.draft.message, t.result.bridged ?? "") ? "ok with the original text, word for word" : "the bridged text differs from the original" });
  }
  if (t.result.nothingToChange && t.result.askUnresolved) {
    out.push({ name: "ask_flagged_not_invented", ok: t.attempts.length > 0 && !t.exchanges.some((x) => x.purpose.startsWith("verify")), detail: "the text stands with the ask note; no critic call, no invented ask" });
  } else if (!e.nothingToChange) {
    const win = t.attempts.find((a) => a.pass);
    out.push({ name: "every_point_kept_verified", ok: !!win && !!win.critic?.read?.pass, detail: win ? `critic pass, voice ${win.critic?.read?.voice}/5, attempt ${t.attempts.indexOf(win) + 1}` : `no passing rewrite in ${t.attempts.length} attempt(s)` });
    out.push({ name: "nothing_added", ok: !!win && win.codeChecks.filter((c) => c.name.startsWith("no_")).every((c) => c.ok), detail: win ? win.codeChecks.filter((c) => c.name.startsWith("no_") && !c.ok).map((c) => c.detail).join("; ") || "no apology, concession, softener, compliment, receiver inner life, evaluative or clinical words, receiver text" : "no passing rewrite" });
  }
  if (t.insight) {
    out.push({ name: "insight_spans_exact", ok: t.insight.frictions.every((f) => t.draft.message.slice(f.start, f.end) === f.quote), detail: `${t.insight.frictions.length} highlighted span(s)` });
  }
  return out;
}
