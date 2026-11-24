// Code checks on one Talk reply (NEXT-ENGINE §2.3). The model writes; code decides what is shown.

import { BELIEF_TYPES, DOMAINS, FEELINGS, LEVELS, SENSITIVE_DOMAINS, TYPE_FOR_LEVEL } from "../types.ts";
import type { BeliefType, CheckResult, Domain, Feeling, Level, LinkType, Move, PersonMap, Risk } from "../types.ts";
import { cleanKeyword } from "../keyword.ts";
import { advicePatternHit, cardWordHits, countQuestions, isExactSubstring, normalise, questionWordHits, words } from "../words.ts";

export interface ProposedBelief {
  id: string | null;
  label: string;
  statement: string;
  /** Q-ENG-KENNING-VOICE (A): the same belief in the person's first-person voice, offered on the Y5 card only. Null when the
   *  model gave none or it failed its checks (never repaired: dropping it leaves the statement, which passed). */
  ownWording?: string | null;
  /** Map v2: one plain word naming the kenning for its map station. Null when missing or not one plain word (never repaired). */
  keyword?: string | null;
  type: BeliefType;
  level: Level;
  domains: Domain[];
  confidence: number;
  receipt: string;
  links: { to: string; type: LinkType }[];
}

export interface TurnReply {
  risk: { level: Risk; reason: string };
  /** Spec E: risk the gate passed; treated as CHECK (held like a stop). */
  safetyFlag?: boolean;
  reflection: string;
  question: string;
  move: { kind: Move; why: string; gap: string };
  permissionDomain: Domain | null;
  beliefs: ProposedBelief[];
  feeling?: Feeling;    // "neutral" when the model gave none or an unknown word
  title?: string | null; // engine item 4: a short plain title offered on the first turns; code cleans it (cleanTitle)
}

const MOVES = new Set(["follow", "deepen", "contrast", "clarify", "bridge", "ask_permission", "close"]);

/** Shape the raw JSON into a TurnReply; a malformed reply is a failed check, never a crash. */
export function readTurnReply(value: unknown): { reply: TurnReply | null; problems: string[] } {
  const problems: string[] = [];
  if (!value || typeof value !== "object") return { reply: null, problems: ["reply is not a JSON object"] };
  const v = value as Record<string, unknown>;
  const risk = (v.risk && typeof v.risk === "object") ? v.risk as Record<string, unknown> : {};
  const move = (v.move && typeof v.move === "object") ? v.move as Record<string, unknown> : {};
  const reflection = typeof v.reflection === "string" ? v.reflection.trim() : "";
  const question = typeof v.question === "string" ? v.question.trim() : "";
  if (!reflection) problems.push("reflection missing");
  if (!question) problems.push("question missing");
  const kind = typeof move.kind === "string" && MOVES.has(move.kind) ? move.kind as Move : null;
  if (!kind) problems.push(`move.kind missing or unknown (${String(move.kind)})`);
  const beliefs: ProposedBelief[] = [];
  const rawBeliefs = Array.isArray(v.beliefs) ? v.beliefs : [];
  rawBeliefs.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") { problems.push(`beliefs[${i}] is not an object`); return; }
    const b = raw as Record<string, unknown>;
    const level = typeof b.level === "string" && (LEVELS as readonly string[]).includes(b.level) ? b.level as Level : null;
    let type = typeof b.type === "string" && (BELIEF_TYPES as readonly string[]).includes(b.type) ? b.type as BeliefType : null;
    if (!type && level) type = TYPE_FOR_LEVEL[level];
    const domains = (Array.isArray(b.domains) ? b.domains : []).filter((d): d is Domain => typeof d === "string" && (DOMAINS as readonly string[]).includes(d));
    const confidence = typeof b.confidence === "number" ? Math.max(0, Math.min(1, b.confidence)) : NaN;
    const links = (Array.isArray(b.links) ? b.links : []).filter((l) => l && typeof l === "object" && typeof (l as Record<string, unknown>).to === "string")
      .map((l) => ({ to: String((l as Record<string, unknown>).to), type: String((l as Record<string, unknown>).type) as LinkType }))
      .filter((l) => ["supports", "under", "tension"].includes(l.type));
    if (!level || !type || !domains.length || Number.isNaN(confidence) || typeof b.receipt !== "string" || typeof b.statement !== "string" || typeof b.label !== "string") {
      problems.push(`beliefs[${i}] is incomplete (level/type/domains/confidence/receipt/statement/label)`);
      return;
    }
    const own = typeof b.own_wording === "string" ? b.own_wording.replace(/\s+/g, " ").trim() : "";
    beliefs.push({ id: typeof b.id === "string" && b.id ? b.id : null, label: b.label.trim(), statement: b.statement.trim(),
      ownWording: own || null, keyword: cleanKeyword(b.keyword, { texts: [String(b.receipt ?? "")] }), type, level, domains, confidence, receipt: b.receipt, links });
  });
  const permission = typeof v.permission_domain === "string" && (DOMAINS as readonly string[]).includes(v.permission_domain)
    ? v.permission_domain as Domain : null;
  if (problems.length && !(reflection && question && kind)) return { reply: null, problems };
  return {
    reply: {
      risk: { level: (["none", "self", "others"].includes(String(risk.level)) ? risk.level : "none") as Risk, reason: String(risk.reason ?? "") },
      safetyFlag: v.safety_flag === true,
      reflection, question,
      move: { kind: kind!, why: String(move.why ?? ""), gap: String(move.gap ?? "") },
      permissionDomain: permission, beliefs,
      feeling: typeof v.feeling === "string" && (FEELINGS as readonly string[]).includes(v.feeling) ? v.feeling as Feeling : "neutral",
      title: cleanTitle(v.title),
    },
    problems,
  };
}

export interface CheckOutcome {
  checks: CheckResult[];
  /** Beliefs that passed every per-belief check. Failing beliefs are named in `checks`. */
  beliefs: ProposedBelief[];
  /** True when the reply as a whole must be repaired (question/reflection/never-domain failures). */
  needsRepair: boolean;
}

export function runChecks(reply: TurnReply, personTurns: string[], map: PersonMap): CheckOutcome {
  const checks: CheckResult[] = [];
  const latest = personTurns[personTurns.length - 1] ?? "";
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // Exactly one question; the reflection asks nothing.
  const q = countQuestions(reply.question, personTurns);
  const qr = countQuestions(reply.reflection, personTurns);
  add("one_question", q === 1 && qr === 0,
    q === 1 ? (qr === 0 ? "one question mark, none in the reflection" : "the reflection contains a question mark")
      : `${q} question marks in the question`);

  // Not a quiz about beliefs (law 1; CPO spec d-coo-talk-coverage-05nov item 5: never "do you believe" or "is it true").
  const asksBelief = /\b(?:do|don't|would) you (?:believe|think|agree)\b/i.test(reply.question) ||
    /\bis (?:that|this) (?:a )?belief\b/i.test(reply.question) ||
    /\bis it true\b/i.test(reply.question);
  add("infer_not_ask", !asksBelief, asksBelief ? "the question asks the person whether they believe something" : "the question continues the story");

  // Gentle, non-clinical, non-prescriptive wording in what the app says.
  const said = `${reply.reflection} ${reply.question}`;
  const badWords = questionWordHits(said);
  const advice = advicePatternHit(reply.question);
  add("no_clinical_or_evaluative_words", badWords.length === 0 && !advice,
    badWords.length ? `found: ${badWords.join(", ")}` : advice ? `advice pattern: "${advice}"` : "clean");

  // The reflection is a reflection: it may reuse up to about twelve of the person's words in a row (owner's director 10:45 10-27, rule 2).
  const run = longestSharedRun(reply.reflection, latest);
  add("reflection_copy_limit", run <= REFLECTION_COPY_LIMIT, `longest copied run ${run} words (limit ${REFLECTION_COPY_LIMIT})`);

  // The reflection never talks about the cards or how they were rated (040846Z c1 t4: "You also said the card is very me").
  const ratingTalk = ratingTalkHits(reply.reflection);
  add("no_rating_talk", ratingTalk.length === 0, ratingTalk.length ? `the reflection mentions a card or rating: ${ratingTalk.map((x) => JSON.stringify(x)).join(", ")}` : "the reflection says nothing about cards or ratings");

  // "Never" respected: no permission ask and no belief in a declined domain, and no question into it.
  const never = DOMAINS.filter((d) => map.consent[d] === "declined");
  const neverHit = (reply.permissionDomain && never.includes(reply.permissionDomain)) ||
    reply.beliefs.some((b) => b.domains.some((d) => never.includes(d)));
  add("never_respected", !neverHit, neverHit ? `touches a Never domain (${never.join(", ")})` : never.length ? `Never domains untouched (${never.join(", ")})` : "no Never domains");

  // Permission: entering a sensitive or Not-now domain needs an ask_permission move.
  const needsAsk = reply.permissionDomain !== null && reply.move.kind !== "ask_permission";
  add("permission_move_matches", !needsAsk, needsAsk ? "permission_domain set without an ask_permission move" : "ok");

  // Per-belief checks.
  const kept: ProposedBelief[] = [];
  const disputed = new Set(map.beliefs.filter((b) => b.status === "disputed").map((b) => normalise(b.statement).toLowerCase()));
  const knownIds = new Set(map.beliefs.map((b) => b.id));
  reply.beliefs.forEach((b, i) => {
    const tag = `beliefs[${i}] "${b.label}"`;
    const exact = isExactSubstring(b.receipt, latest) || personTurns.some((t) => isExactSubstring(b.receipt, t));
    add(`receipt_exact:${i}`, exact, exact ? `receipt is an exact quote` : `${tag}: receipt is not a substring of what the person said: ${JSON.stringify(b.receipt)}`);
    const quoteAsStatement = normalise(b.statement).toLowerCase() === normalise(b.receipt).toLowerCase() ||
      (words(b.statement).length >= 4 && isExactSubstring(b.statement, latest));
    add(`statement_not_quote:${i}`, !quoteAsStatement, quoteAsStatement ? `${tag}: the statement is the quote` : "statement is the engine's own gentle sentence");
    const harsh = cardWordHits(`${b.label} ${b.statement}`);
    add(`card_words:${i}`, harsh.length === 0, harsh.length ? `${tag}: ${harsh.join(", ")}` : "clean");
    const labelIssue = labelProblem(b.label);
    const labelOk = labelIssue === null;
    add(`label_short:${i}`, labelOk, labelIssue ? `${tag}: ${labelIssue}` : "label is a one-to-four-word name");
    const reproposed = b.id === null && disputed.has(normalise(b.statement).toLowerCase());
    add(`not_disputed:${i}`, !reproposed, reproposed ? `${tag}: re-proposes a disputed belief` : "not a disputed belief");
    const idOk = b.id === null || knownIds.has(b.id);
    add(`known_id:${i}`, idOk, idOk ? "id resolves" : `${tag}: id ${b.id} is not on the map`);
    const linksOk = b.links.every((l) => knownIds.has(l.to));
    add(`links_resolve:${i}`, linksOk, linksOk ? "links resolve" : `${tag}: a link points at an unknown id`);
    if (b.ownWording) {
      // The first-person offer passes the statement's own checks (gentle words, not the quote) and must read as the person's
      // voice; anything else is dropped (the card shows the statement) and never triggers a repair.
      const why = ownWordingProblem(b.ownWording, b.receipt, personTurns);
      add(`own_wording:${i}`, true, why ? `${tag}: own_wording dropped (${why})` : "own_wording is a gentle first-person line");
      if (why) b.ownWording = null;
    }
    const sensitiveWithoutConsent = b.domains.some((d) => SENSITIVE_DOMAINS.includes(d) && map.consent[d] !== "ok");
    if (sensitiveWithoutConsent) add(`sensitive_withheld:${i}`, true, `${tag}: body_health without consent, card withheld`);
    if (exact && !quoteAsStatement && !harsh.length && labelOk && !reproposed && idOk && linksOk && !sensitiveWithoutConsent) kept.push(b);
  });

  const needsRepair = checks.some((c) => !c.ok && (c.name === "one_question" || c.name === "infer_not_ask" ||
    c.name === "no_clinical_or_evaluative_words" || c.name === "never_respected" || c.name === "permission_move_matches" ||
    c.name === "reflection_copy_limit" || c.name === "no_rating_talk" || c.name.startsWith("receipt_exact") || c.name.startsWith("card_words") ||
    c.name.startsWith("statement_not_quote") || c.name.startsWith("label_short")));
  return { checks, beliefs: kept, needsRepair };
}

/** First person: opens with I, I'm, I've, I'd, I'll, My, Me or Mine. */
export function isFirstPerson(text: string): boolean {
  return /^(i|i['’]m|i['’]ve|i['’]d|i['’]ll|my|me|mine)\b/i.test(text.trim());
}

/** Why a first-person offer is not shown, or null when it passes: the statement's checks plus the first-person voice. The quote
 *  test ignores end punctuation and reads every turn the person spoke: a first-person line is closer to their words than the
 *  statement is, and the quote stays the receipt, never the headline (law 5). */
export function ownWordingProblem(own: string, receipt: string, personTurns: string[]): string | null {
  if (own.length > 200) return "too long";
  if (!isFirstPerson(own)) return "not first person";
  const bare = (t: string) => normalise(t).replace(/[\s.!?,;:…]+$/u, "").toLowerCase();
  const o = bare(own);
  if (o === bare(receipt) || (words(own).length >= 4 && personTurns.some((t) => normalise(t).toLowerCase().includes(o)))) return "the quote";
  const harsh = cardWordHits(own);
  if (harsh.length) return harsh.join(", ");
  return null;
}

export const TITLE_WORDS = 4;
/** A conversation title (engine item 4): two to four plain words, no trailing punctuation, no banned, clinical or question words.
 *  Anything else is null and the conversation keeps its current title. */
export function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/^["'“‘]+|["'”’.!?,;:]+$/g, "").replace(/\s+/g, " ");
  if (!text) return null;
  const w = text.split(" ");
  if (w.length < 1 || w.length > TITLE_WORDS) return null;
  if (cardWordHits(text).length || /[?!]/.test(text) || /\b(?:you|your|i|me|my)\b/i.test(text) && w.length === 1) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const REFLECTION_COPY_LIMIT = 12;
export const LABEL_WORDS = 4;
const LABEL_END_FUNCTION = new Set(["a", "an", "the", "to", "of", "is", "are", "am", "was", "were", "be", "been", "being", "and", "or", "but",
  "when", "it", "in", "on", "at", "for", "with", "as", "that", "who", "my", "me", "i", "than", "so", "if", "not", "no", "from", "by", "into",
  "about", "after", "before", "because"]);
const LABEL_END_VERB = new Set(["do", "does", "did", "have", "has", "had", "make", "makes", "made", "mean", "means", "meant", "say", "says", "said",
  "feel", "feels", "felt", "become", "becomes", "became", "need", "needs", "needed", "want", "wants", "wanted", "seem", "seems", "seemed", "keep",
  "keeps", "kept", "get", "gets", "got", "go", "goes", "went", "count", "counts", "counted", "matter", "matters", "mattered", "show", "shows", "showed",
  "ask", "asks", "asked", "choose", "chooses", "chose", "change", "changes", "changed", "leave", "leaves", "left", "give", "gives", "gave", "take", "takes",
  "took", "hold", "holds", "held", "carry", "carries", "carried", "land", "lands", "landed", "happen", "happens", "happened", "bring", "brings", "brought"]);

/** Why a label is not a name (A-Q22). The model gets one rename attempt; code never manufactures a name by cutting a sentence. */
export function labelProblem(label: string): string | null {
  const w = label.trim().replace(/[,;:.!?-]+$/, "").split(/\s+/).filter(Boolean);
  if (w.length === 0) return "label is empty; return a one-to-three-word name";
  if (w.length > LABEL_WORDS) return `label has ${w.length} words; return a one-to-three-word name, never a cut-off phrase`;
  const last = w[w.length - 1].toLowerCase().replace(/[^a-z']/g, "");
  if (LABEL_END_FUNCTION.has(last)) return `label ends in the function word "${w[w.length - 1]}"; return a complete one-to-three-word name`;
  if (LABEL_END_VERB.has(last)) return `label ends in the verb "${w[w.length - 1]}"; return a complete one-to-three-word name`;
  return null;
}

/** The label as shown (A51(a), A-Q22): a complete name of up to four words. It stands or is rejected whole; it is never cut. */
export function shortLabel(label: string): string | null {
  if (labelProblem(label)) return null;
  return label.trim().replace(/[,;:.!?-]+$/, "").replace(/\s+/g, " ");
}

const RATING_TALK = [
  /\bvery me\b/i, /\bpartly\b/i, /\bnot me\b/i, /\b(?:the|that|this|a|each|last|first) cards?\b/i,
  /\byou (?:also )?(?:rated|marked|tapped|picked|chose|accepted|rejected|endorsed|disputed)\b/i, /\bis this you\b/i,
];

/** Sentences of a reflection that talk about cards or ratings. */
export function ratingTalkHits(reflection: string): string[] {
  return sentences(reflection).filter((x) => RATING_TALK.some((p) => p.test(x)));
}

/** The reflection without the sentences that talk about cards or ratings (may be empty). */
export function stripRatingTalk(reflection: string): string {
  return sentences(reflection).filter((x) => !RATING_TALK.some((p) => p.test(x))).join(" ").trim();
}

function sentences(text: string): string[] {
  return (normalise(text).match(/[^.!?]+[.!?]*/g) ?? []).map((x) => x.trim()).filter(Boolean);
}

export function longestSharedRun(a: string, b: string): number {
  const x = words(a), y = words(b);
  let best = 0;
  for (let i = 0; i < x.length; i++) for (let j = 0; j < y.length; j++) {
    let k = 0;
    while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
    if (k > best) best = k;
  }
  return best;
}

export const GUESS_ECHO_LIMIT = 3;
/** CPO spec d-coo-talk-coverage-05nov item 5: a gap-opener question never shares four or more consecutive words with
 *  a guess still waiting to be rated; that would paraphrase the guess, which law 1 forbids. */
export function echoesWaitingGuess(question: string, waitingGuessTexts: readonly string[]): boolean {
  return waitingGuessTexts.some((g) => longestSharedRun(question, g) > GUESS_ECHO_LIMIT);
}

export function failureText(checks: CheckResult[]): string {
  return checks.filter((c) => !c.ok).map((c) => `- ${c.name}: ${c.detail}`).join("\n");
}
