// One Talk turn: package → one conversation call → code checks → one repair → what the app shows.
// The product never ends a conversation on a failed check (owner's director 10:45 10-27, rule 1): after the one repair a failing
// card or field is dropped and logged as a warning; an unusable question becomes the thread line. Only a model call that returned
// nothing at all marks the turn failed, and even then the thread line is shown.

import { DOMAINS, SENSITIVE_DOMAINS } from "../types.ts";
import type { AnswerKind, Belief, CardShown, CheckResult, Domain, ModelExchange, Person, PersonMap, Session, ShownTurn } from "../types.ts";
import type { ModelClient, ModelMessage, ModelStreamObserver } from "../model/client.ts";
import { extractJson } from "../model/client.ts";
import { keywordRisk, RESOURCES, stops } from "../safety.ts";
import type { RiskResult } from "../safety.ts";
import { classReadings, layeredRisk, semanticCheckDetail, semanticOff, semanticRisk } from "../safety_semantic.ts";
import type { SemanticRisk } from "../safety_semantic.ts";
import { candidateClasses, settleClear } from "../safety_classes.ts";
import { contextPackage } from "./context.ts";
import { failureText, ratingTalkHits, readTurnReply, runChecks, stripRatingTalk } from "./checks.ts";
import { advicePatternHit, countQuestions, questionWordHits } from "../words.ts";
import type { ProposedBelief, TurnReply } from "./checks.ts";
import type { GuideBrief } from "./guide.ts";

import { TALK_REPAIR, TALK_TURN } from "../prompt_text.ts";
export const TURN_PROMPT = TALK_TURN;
export const REPAIR_PROMPT = TALK_REPAIR;

export const SHOW_THRESHOLD = 0.7;
export const EARLY_GUESS_TURN = 3;
export const MAX_OUTPUT_TOKENS = 2500; // smoke 143353Z: 1200 cut long replies mid-JSON
/** Shown as the turn when the question itself is unusable after repair (rule 1); the conversation carries on. */
export const THREAD_LINE = "I lost my thread for a moment. Could you say a little more?";

export interface TurnOptions {
  /** The client for the semantic safety check (QA-B336); the turn client when absent. The request names its own model. */
  safetyClient?: ModelClient;
  /** False skips the semantic safety check (the API's PRESENCE_SAFETY_SEMANTIC switch); absent or true runs it. */
  semanticCheck?: boolean;
  /** The words were already read by the safety entry (an edit reads before it changes anything). That reading is the reading: a stop
   *  stands as the floor stop (no later reading may clear it), a clear is taken as the semantic result, and nothing is read twice. */
  prior?: { stop: boolean; risk: RiskResult["risk"]; reason: string };
  /** A validated, one-turn-lag private hint. Only the owner API path supplies it. */
  guideBrief?: GuideBrief | null;
}

export interface TurnTrace {
  turn: number;
  person: string;
  floor: RiskResult;
  exchanges: ModelExchange[];        // the turn call and, if any, the repair call
  parsed: TurnReply | null;
  checks: CheckResult[];
  repaired: boolean;
  shown: ShownTurn;
  hypotheses: ProposedBelief[];      // beliefs kept after checks (shown or withheld under 0.7)
  warnings: string[];                // rule 1: what was dropped or replaced after the one repair, never a stop
  fallback: boolean;                 // the question shown is the thread line, not the model's
  failed: string | null;             // only a model call that returned nothing (transport, refusal); the thread line is still shown
  cents: number;
  ms: number;
}

export interface TurnState {
  person: Person;
  map: PersonMap;
  session: Session;
  previous: Session[];
  /** Hypotheses proposed this session, keyed by id, so Finish can consolidate them. */
  hypotheses: Map<string, Belief>;
  /** Ids for new hypotheses; the API supplies UUIDs so a hypothesis can become a belief row under the same id. Default: h1, h2, … */
  idFor?: () => string;
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}`;
}

function conversationMessages(state: TurnState, latest: string, brief: GuideBrief | null | undefined): ModelMessage[] {
  const messages: ModelMessage[] = [];
  // Keep the first message stable while a session grows. The old package embedded the whole session here, so this early
  // block changed on every call and prevented the append-only conversation breakpoint from finding its prior prefix.
  const pkg = contextPackage(state.person, state.map, state.session, state.previous, { includeSession: false, guideBrief: brief });
  messages.push({ role: "user", content: `${pkg}\n\n# CONVERSATION\nThe person's turns follow. Answer the latest one.` });
  messages.push({ role: "assistant", content: "Ready. I will answer the latest turn with one JSON object." });
  // Earlier replies are shown back as the JSON they were, not as prose: run 040846Z showed the model drifting to a plain-text
  // answer by turn 5–8 when its own history read as prose (c1 t8, c3 t5).
  for (const t of state.session.turns) {
    messages.push({ role: "user", content: t.person });
    messages.push({ role: "assistant", content: historyJson(t.shown) });
  }
  // Keep this byte-identical when it becomes an earlier turn on the next call; otherwise the provider cannot match the
  // append-only prefix it wrote for this turn. Turn number is implied by message order and shown-card state is in historyJson.
  messages.push({ role: "user", content: latest });
  return messages;
}

/** What the app showed for an earlier turn, as a compact JSON object in the reply's own shape. */
export function historyJson(shown: ShownTurn): string {
  if (shown.state === "safety") return JSON.stringify({ state: "safety", reflection: "", question: "", beliefs: [] });
  const beliefs: { label: string; statement: string; rating: string | null; earlyGuess?: boolean }[] =
    shown.cards.map((c) => ({ label: c.label, statement: c.statement, rating: c.rating ?? null }));
  if (shown.earlyGuess) beliefs.push({ label: shown.earlyGuess.label, statement: shown.earlyGuess.statement,
    rating: shown.earlyGuess.rating ?? null, earlyGuess: true });
  return JSON.stringify({ reflection: shown.reflection ?? "", question: shown.question ?? "",
    ...(shown.state === "permission" ? { move: { kind: "ask_permission" }, permission_domain: shown.permissionDomain } : {}),
    beliefs });
}

/**
 * Wraps the stream observer so no delta reaches the route before the semantic safety reading is back, readable and clear.
 * The latest accumulated text is replayed once on release; later deltas pass straight through. A stop or an unavailable
 * reading never releases (the route then sends only the final safety/unavailable event). Provider-side signals pass unchanged.
 */
export function holdUntilSafetyRead(stream: ModelStreamObserver | undefined, pending: Promise<SemanticRisk>): ModelStreamObserver | undefined {
  if (!stream?.onDelta) return stream;
  const forward = stream.onDelta;
  let released = false;
  let latest: [string, string, number] | null = null;
  void pending.then((read) => {
    if (!read.ok || stops(read)) return;
    released = true;
    if (latest) void Promise.resolve(forward(...latest)).catch(() => {});
  }, () => {});
  return {
    ...stream,
    onDelta(delta, accumulated, elapsedMs) {
      if (!released) { latest = [delta, accumulated, elapsedMs]; return; }
      return forward(delta, accumulated, elapsedMs);
    },
  };
}

export async function talkTurn(
  client: ModelClient,
  state: TurnState,
  personSaid: string,
  turnIndex?: number,
  stream?: ModelStreamObserver,
  answerKind: AnswerKind = "told",
  options: TurnOptions = {},
): Promise<TurnTrace> {
  const started = performance.now();
  // Continues from the last turn's index, not the count: a deleted turn leaves a gap the next turn must not reuse. An edit
  // re-answers at the edited turn's own number (turnIndex).
  const index = turnIndex ?? (state.session.turns.at(-1)?.index ?? 0) + 1;
  const trace: TurnTrace = {
    turn: index, person: personSaid,
    floor: options.prior ? (options.prior.stop ? { risk: options.prior.risk, reason: options.prior.reason } : { risk: "none", reason: options.prior.reason }) : keywordRisk(personSaid),
    exchanges: [], parsed: null, checks: [],
    repaired: false, shown: { state: "turn", cards: [] }, hypotheses: [], warnings: [], fallback: false, failed: null, cents: 0, ms: 0,
  };

  // PSY 15 Nov ruling 2: a floor stop from a candidate row in one of five classes clears only with two keys: the class's written
  // condition (safety_classes.ts) and the semantic check naming that class on two parallel readings (the API takes no temperature;
  // Q-ENG-B336-TEMP0). They run alone, before the turn call, so nothing is sent on for mapping until it clears; unavailable, a stop
  // or another class on either reading keeps the stop.
  let classReading: SemanticRisk | null = null;
  let classCheck: CheckResult | null = null;
  if (!options.prior && stops(trace.floor) && options.semanticCheck !== false && candidateClasses(personSaid, trace.floor).length) {
    const both = await classReadings(options.safetyClient ?? client, personSaid, stream?.signal ? { signal: stream.signal } : {});
    for (const r of both) if (r.exchange) trace.exchanges.push(r.exchange);
    classReading = both[0];
    const cleared = settleClear(personSaid, trace.floor, both);
    classCheck = { name: "safety_class", ok: true, detail: cleared ? `floor row cleared by two keys: ${cleared}` : `floor stop stands: ${both.map(semanticCheckDetail).join(" | ")}` };
    if (cleared) { trace.floor = { risk: "none", reason: `cleared: ${cleared}` }; }
  }

  // Safety floor before any call: risk stops mapping and nothing is extracted from the turn.
  if (stops(trace.floor)) {
    if (classCheck) trace.checks.push(classCheck);
    trace.cents = trace.exchanges.reduce((n, e) => n + e.usage.cents, 0);
    trace.shown = { state: "safety", cards: [], safety: RESOURCES };
    trace.checks.push({ name: "safety_floor", ok: true, detail: `stopped before the call: ${trace.floor.reason}` });
    state.session.turns.push({ index, person: personSaid, answerKind, shown: trace.shown });
    trace.ms = performance.now() - started;
    return trace;
  }

  // QA-B336: the semantic safety check runs beside the turn call (its wall-clock cost hides behind the longer call). It can
  // add a stop, never clear one, and fails closed: unavailable is recorded as such and the reply's own risk field decides.
  const semanticPending = options.prior ? Promise.resolve({ ...semanticOff(), ok: true, reason: `read before the turn: ${options.prior.reason}`.slice(0, 200) })
    : options.semanticCheck === false ? Promise.resolve(semanticOff())
    : classReading ? Promise.resolve({ ...classReading, exchange: null })   // already read (and its exchange kept) above
    : semanticRisk(options.safetyClient ?? client, personSaid, stream?.signal ? { signal: stream.signal } : {});
  const messages = conversationMessages(state, personSaid, options.guideBrief);
  const system = options.guideBrief
    ? TURN_PROMPT + "\n\nThe brief is a private hint. Follow the person first. Use the brief's thread or gap only when it fits what they just said; never ask it as a separate topic; never mention it."
    : TURN_PROMPT;
  // COO 07:20Z 16 Nov (PSY 4b): nothing is shown before the safety read returns. With the check on, the streamed text is held
  // (the route sees no delta) until the reading came back readable and clear; a stop or an unreadable reading never releases it.
  const first = await client.complete(
    { purpose: "turn", system, messages, maxTokens: MAX_OUTPUT_TOKENS },
    options.semanticCheck === true ? holdUntilSafetyRead(stream, semanticPending) : stream,
  );
  trace.exchanges.push(first);
  let outcome = evaluate(first, state, personSaid);
  trace.checks = outcome.checks;
  trace.parsed = outcome.reply;

  if (outcome.needsRepair || !outcome.reply) {
    const failures = outcome.reply ? failureText(outcome.checks) : `- json: ${outcome.parseError}`;
    const repairMessages: ModelMessage[] = [...messages,
      { role: "assistant", content: first.rawResponse || "(empty)" },
      { role: "user", content: REPAIR_PROMPT.replace("{{failures}}", failures) }];
    const second = await client.complete(
      { purpose: "repair", system, messages: repairMessages, maxTokens: MAX_OUTPUT_TOKENS },
      stream?.signal ? { signal: stream.signal } : undefined,
    );
    trace.exchanges.push(second);
    trace.repaired = true;
    const again = evaluate(second, state, personSaid);
    trace.checks = [...outcome.checks.map((c) => ({ ...c, name: `first:${c.name}` })), ...again.checks];
    if (again.reply && !blocking(again.checks)) { outcome = again; trace.parsed = again.reply; }
    else if (outcome.reply && !blocking(outcome.checks)) {
      // The repair broke a law-level check the first reply passed (040846Z c2 t1: the repair said "wrong"); the first reply is shown.
      trace.checks.push({ name: "repair_kept_first", ok: true, detail: "the repaired reply failed a law-level check the first reply passed; the first reply is shown" });
    } else if (again.reply) { outcome = again; trace.parsed = again.reply; }
    else { trace.parsed = outcome.reply; }
  }

  const semantic = await semanticPending;
  if (semantic.exchange) trace.exchanges.push(semantic.exchange);
  if (classCheck) trace.checks.push(classCheck);
  trace.checks.push({ name: "safety_semantic", ok: semantic.ok, detail: semanticCheckDetail(semantic) });
  trace.cents = trace.exchanges.reduce((n, e) => n + e.usage.cents, 0);
  // QA-B336 (COO 02:20Z): fail closed. With the check switched on (the API passes semanticCheck: true; an absent option keeps the harness's older fall-through), an unavailable or unreadable reading stops (resources), never passes.
  if (semantic.ok && stops(semantic)) {
    trace.shown = { state: "safety", cards: [], safety: RESOURCES };
    state.session.turns.push({ index, person: personSaid, answerKind, shown: trace.shown });
    trace.ms = performance.now() - started;
    return trace;
  }
  // PSY 16 Nov 2b-2c: an unavailable reading is its own state. Nothing is shown, mapped or kept (the turn is not pushed onto the
  // session; the API removes the stored words), unless the turn call's own risk field said stop: one reading saying stop and the
  // other unavailable is the usual stop with resources.
  if (options.semanticCheck === true && !semantic.ok) {
    const ownStop = outcome.reply ? outcome.reply.risk.level !== "none" : false;
    if (ownStop) {
      trace.shown = { state: "safety", cards: [], safety: RESOURCES };
      state.session.turns.push({ index, person: personSaid, answerKind, shown: trace.shown });
    } else {
      trace.shown = { state: "unavailable", cards: [] };
      trace.hypotheses = [];
    }
    trace.ms = performance.now() - started;
    return trace;
  }
  const reply = outcome.reply;
  if (!reply) {
    // Nothing readable from either call. The thread line is shown so the conversation goes on (rule 1); a call that returned
    // nothing at all (transport, refusal) is also marked failed so the harness can decide whether it would repeat.
    const last = trace.exchanges.filter((e) => e.purpose !== "safety").at(-1)!;
    const noReply = last.error && !last.rawResponse;
    if (noReply) trace.failed = `no reply from the model: ${last.error}`;
    trace.warnings.push(`no readable reply after repair (${outcome.parseError ?? "unknown"}); the thread line is shown`);
    trace.fallback = true;
    trace.shown = { state: "turn", reflection: "", question: THREAD_LINE, cards: [] };
    state.session.turns.push({ index, person: personSaid, answerKind, shown: trace.shown });
    trace.ms = performance.now() - started;
    return trace;
  }

  // Model risk field: can add a stop, never clear one (the floor and the semantic check already said none or unavailable).
  const risk = layeredRisk(trace.floor, semantic, reply.risk.level === "none" && reply.safetyFlag ? "self" : reply.risk.level, reply.safetyFlag ? "safety_flag" : reply.risk.reason);
  trace.checks.push({ name: "safety_model", ok: true, detail: `model risk ${reply.risk.level}: ${reply.risk.reason}` });
  if (stops(risk)) {
    trace.shown = { state: "safety", cards: [], safety: RESOURCES };
    state.session.turns.push({ index, person: personSaid, answerKind, shown: trace.shown });
    trace.ms = performance.now() - started;
    return trace;
  }

  // Rule 1: salvage what passed. A failing belief was already withheld by the checks; a belief in a Never domain is dropped here.
  const never = DOMAINS.filter((d) => state.map.consent[d] === "declined");
  const usable = salvage(reply, outcome.checks, personTurns(state, personSaid), never);
  trace.warnings.push(...usable.warnings);
  for (const c of trace.checks.filter((c) => !c.ok && c.name.startsWith("label_short:"))) {
    trace.warnings.push(`${c.detail}; card dropped after one rename attempt`);
  }
  trace.fallback = usable.fallback;
  const beliefsToKeep = outcome.beliefs.filter((b) => {
    const hit = b.domains.filter((d) => never.includes(d));
    if (hit.length) trace.warnings.push(`belief "${b.label}" dropped: it touches a Never domain (${hit.join(", ")})`);
    if (hit.length) return false;
    if (answerKind === "chip" && b.level !== "L4") {
      const existing = b.id ? state.hypotheses.get(b.id) ?? state.map.beliefs.find((m) => m.id === b.id) : undefined;
      if (!existing?.receipts.some((r) => (r.answerKind ?? "told") !== "chip")) {
        trace.warnings.push(`belief "${b.label}" withheld: a chip choice alone cannot support ${b.level}`);
        return false;
      }
    }
    return true;
  });

  // Beliefs: keep the hypotheses; show cards at 0.7 or more (law 9).
  const cards: CardShown[] = [];
  for (const b of beliefsToKeep) {
    const id = b.id ?? (state.idFor ? state.idFor() : newId("h"));
    const existing = state.hypotheses.get(id) ?? state.map.beliefs.find((m) => m.id === id);
    const receipt = { quote: b.receipt, sessionId: state.session.id, turn: index, date: state.session.date, answerKind };
    if (existing) {
      if (!existing.receipts.some((r) => r.quote === b.receipt)) existing.receipts.push(receipt);
      existing.confidence = Math.max(existing.confidence, b.confidence);
      // A first-person offer is kept for a guess only; a belief already rated is never re-offered in other words (law 3).
      if (existing.status === "inferred" && !existing.offeredWording && b.ownWording) existing.offeredWording = b.ownWording;
      if (!existing.keyword && b.keyword) existing.keyword = b.keyword;   // a keyword is made once, with the kenning
      for (const l of b.links) if (!existing.links.some((x) => x.to === l.to && x.type === l.type)) existing.links.push(l);
    } else {
      state.hypotheses.set(id, { id, label: b.label, statement: b.statement, offeredWording: b.ownWording ?? null, keyword: b.keyword ?? null, type: b.type, level: b.level, domains: b.domains,
        confidence: b.confidence, receipts: [receipt], links: b.links, status: "inferred", birthMood: reply.feeling ?? "neutral" });
    }
    trace.hypotheses.push({ ...b, id });
    // Shown once: a card already on screen, or already offered as the early guess, is never offered again.
    const shownBefore = state.session.turns.some((t) => t.shown.cards.some((c) => c.beliefId === id) || t.shown.earlyGuess?.beliefId === id);
    if (b.confidence >= SHOW_THRESHOLD && !shownBefore) {
      cards.push({ beliefId: id, label: b.label, statement: b.statement, type: b.type, birthMood: (existing?.birthMood ?? reply.feeling ?? "neutral") });
    }
  }

  const shown: ShownTurn = { state: "turn", reflection: usable.reflection, question: usable.question, cards, feeling: reply.feeling ?? "neutral" };
  if (usable.permissionDomain) {
    shown.state = "permission";
    shown.permissionDomain = usable.permissionDomain;
  }
  // Early guess: nothing shown by turn 3 → offer the strongest hypothesis as "Is this you?".
  const anyShown = cards.length > 0 || state.session.turns.some((t) => t.shown.cards.length > 0 || t.shown.earlyGuess);
  if (!anyShown && index >= EARLY_GUESS_TURN) {
    const strongest = [...state.hypotheses.values()].sort((a, b) => b.confidence - a.confidence)[0];
    if (strongest) shown.earlyGuess = { beliefId: strongest.id, label: strongest.label, statement: strongest.statement, type: strongest.type, birthMood: strongest.birthMood };
  }
  trace.shown = shown;
  state.session.turns.push({ index, person: personSaid, answerKind, shown });
  trace.ms = performance.now() - started;
  return trace;
}

interface Evaluated { reply: TurnReply | null; checks: CheckResult[]; beliefs: ProposedBelief[]; needsRepair: boolean; parseError?: string }

function evaluate(exchange: ModelExchange, state: TurnState, latest: string): Evaluated {
  if (exchange.error && !exchange.rawResponse) {
    return { reply: null, checks: [{ name: "model_call", ok: false, detail: exchange.error }], beliefs: [], needsRepair: true, parseError: exchange.error };
  }
  if (exchange.usage.outputTokens > 0 && exchange.usage.outputTokens >= exchange.request.maxTokens) {
    const detail = `reply cut off at ${exchange.request.maxTokens} output tokens`;
    return { reply: null, checks: [{ name: "not_truncated", ok: false, detail }], beliefs: [], needsRepair: true, parseError: detail };
  }
  let parsed: unknown;
  try { parsed = extractJson(exchange.rawResponse); }
  catch (e) { return { reply: null, checks: [{ name: "valid_json", ok: false, detail: String(e) }], beliefs: [], needsRepair: true, parseError: String(e) }; }
  const read = readTurnReply(parsed);
  const checks: CheckResult[] = [{ name: "valid_json", ok: true, detail: "parsed" }];
  for (const p of read.problems) checks.push({ name: "shape", ok: false, detail: p });
  if (!read.reply) return { reply: null, checks, beliefs: [], needsRepair: true, parseError: read.problems.join("; ") };
  const personTurns = [...state.session.turns.map((t) => t.person), latest];
  const mapWithHypotheses: PersonMap = { ...state.map, beliefs: [...state.map.beliefs, ...state.hypotheses.values()] };
  const outcome = runChecks(read.reply, personTurns, mapWithHypotheses);
  return { reply: read.reply, checks: [...checks, ...outcome.checks], beliefs: outcome.beliefs, needsRepair: outcome.needsRepair };
}

/** The law-level reply checks decide which reply is preferred after a repair (the repaired one unless it broke a law-level check the
 *  first reply passed); nothing blocks the turn any more (rule 1) — salvage() drops or replaces what still fails. */
function blocking(checks: CheckResult[]): boolean {
  return checks.some((c) => !c.ok && !c.name.startsWith("first:") &&
    ["one_question", "infer_not_ask", "no_clinical_or_evaluative_words", "never_respected", "permission_move_matches", "shape"].includes(c.name));
}

function personTurns(state: TurnState, latest: string): string[] {
  return [...state.session.turns.map((t) => t.person), latest];
}

export interface Salvaged {
  reflection: string;
  question: string;
  permissionDomain: Domain | null;
  fallback: boolean;
  warnings: string[];
}

/**
 * Rule 1 (owner's director 10:45 10-27): after the one repair, keep the reflection and the question if they pass on their own,
 * drop what does not, and log each drop. An unusable question (two questions, a quiz, a banned word, advice, a permission ask
 * into a Never domain) becomes the thread line and the move is a plain clarify. A reflection that asks a question or carries a
 * banned word is dropped; one that talks about the cards or ratings loses those sentences. Nothing is invented beyond the one line.
 */
export function salvage(reply: TurnReply, checks: CheckResult[], personSaid: string[], never: Domain[]): Salvaged {
  const warnings: string[] = [];
  const failed = (name: string) => checks.some((c) => c.name === name && !c.ok);

  let question = reply.question;
  let permissionDomain = reply.move.kind === "ask_permission" ? reply.permissionDomain : null;
  if (reply.permissionDomain && reply.move.kind !== "ask_permission") warnings.push(`permission_domain ${reply.permissionDomain} ignored: the move was ${reply.move.kind}, not ask_permission`);
  const questionProblems: string[] = [];
  const marks = countQuestions(question, personSaid);
  if (marks !== 1) questionProblems.push(`${marks} question marks`);
  if (failed("infer_not_ask")) questionProblems.push("asks whether the person believes something");
  const bad = questionWordHits(question);
  if (bad.length) questionProblems.push(`banned words: ${bad.join(", ")}`);
  const advice = advicePatternHit(question);
  if (advice) questionProblems.push(`advice pattern "${advice}"`);
  if (permissionDomain && never.includes(permissionDomain)) questionProblems.push(`asks permission for a Never domain (${permissionDomain})`);
  let fallback = false;
  if (questionProblems.length) {
    warnings.push(`question replaced by the thread line: ${questionProblems.join("; ")}`);
    question = THREAD_LINE;
    permissionDomain = null;
    fallback = true;
  }

  let reflection = reply.reflection;
  const talk = ratingTalkHits(reflection);
  if (talk.length) {
    const stripped = stripRatingTalk(reflection);
    warnings.push(`reflection: ${talk.length} sentence(s) about cards or ratings dropped${stripped ? "" : "; nothing left, reflection empty"}`);
    reflection = stripped;
  }
  const reflectionProblems: string[] = [];
  if (countQuestions(reflection, personSaid) > 0) reflectionProblems.push("contains a question mark");
  const badR = questionWordHits(reflection);
  if (badR.length) reflectionProblems.push(`banned words: ${badR.join(", ")}`);
  if (reflectionProblems.length) {
    warnings.push(`reflection dropped: ${reflectionProblems.join("; ")}`);
    reflection = "";
  }
  return { reflection, question, permissionDomain, fallback, warnings };
}

/** The person answers a permission ask: Sure / Not now / Never. */
export function recordConsent(map: PersonMap, domain: Domain, answer: "ok" | "ask_later" | "declined"): void {
  map.consent[domain] = answer;
}

export function isSensitive(domain: Domain): boolean {
  return SENSITIVE_DOMAINS.includes(domain);
}
