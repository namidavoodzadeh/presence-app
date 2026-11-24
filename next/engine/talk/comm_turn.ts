// V3 communication model, spec 4.2: the model's part of a Talk turn on the question bank. The planner (engine/comm_planner.ts) decides WHICH kind
// comes next and holds the bank's question; the model only (1) reflects what the person just said in a line, (2) may re-phrase the bank's question
// around the moment they told, and (3) drafts at most one item from their answer in their own words. Everything the model returns is checked here;
// anything that fails falls back to the bank's own words or to nothing, so the model cannot reorder, widen or invent. No call is made in this file
// and it is not wired into api/talk.ts yet (needs the owner-only switch, a staging gold run of about 150 cents and a QA window).
import type { ModelRequest } from "../model/client.ts";
import { keywordRisk, RESOURCES, stops } from "../safety.ts";
import { type CheckVerdict, checkBeforeSuggesting, COMM_NEVER_ON_SCREEN, talkQuestionProblems } from "../comm_checks.ts";
import type { CommKind } from "../comm.ts";
import type { Plan } from "../comm_planner.ts";

export const COMM_TURN_MODEL = "claude-haiku-5-5";   // only after its gold run passes (the staging run records it); Sonnet is the fallback
export const COMM_TURN_MAX_TOKENS = 220;
export const MAX_REFLECTION_WORDS = 20;
export const MAX_ITEM_CHARS = 400;

/** Stable (prompt-cached) system text. The bank question is data in the user message, not instructions the model may rewrite freely. */
export const COMM_TURN_SYSTEM = [
  "You are the listener inside Presence. You describe how a person says they communicate with people close to them; you never advise, judge or diagnose.",
  "You get the person's last answer, the kind of thing it was about, and the next question from a fixed list.",
  'Reply with one JSON object and nothing else: {"reflection":"...","question":"...","item":"..."}.',
  "reflection: one short line (at most 20 words, no question mark) in the person's own terms that shows you heard them. Name only what they said.",
  "question: the next question. Keep the listed question's meaning. You may fit its words to the moment they just told (name the place or the time they used) but never add a second question, a 'why', a guess about the other person, a childhood or family-origin question, or a feeling or mood word. At most 20 words, one question mark.",
  "item: the answer said as one sentence in the person's own first-person words, using only words and ideas they gave (at most 40 words). Use null when they did not say something that fits the kind, or when the sentence would be about someone else.",
  "Never use: trigger, pattern, style, toxic, attachment, flooding, avoidant, anxious, love language, red flag.",
].join(" ");

type Ask = Extract<Plan, { done: false }>;
export interface CommTurnInput {
  /** The next question the planner chose. */
  plan: Ask;
  /** The kind the person's last answer was about (the question asked before this turn); null at the very first turn. */
  answeredKind: CommKind | null;
  /** The person's last answer, as they said it. */
  answer: string;
  sessionNumber: number;
}

/** Law 8 first: an answer that shows risk makes no model call and extracts nothing; the caller shows resources. */
export function commTurnPrecheck(answer: string): { stop: true; resources: typeof RESOURCES } | { stop: false } {
  return stops(keywordRisk(answer)) ? { stop: true, resources: RESOURCES } : { stop: false };
}

export function buildCommTurnRequest(i: CommTurnInput, model: string = COMM_TURN_MODEL): ModelRequest {
  const user = JSON.stringify({ answer: i.answer.trim(), answered_kind: i.answeredKind, next_kind: i.plan.kind, next_question: i.plan.question });
  return { purpose: "talk_comm_turn", system: COMM_TURN_SYSTEM, messages: [{ role: "user", content: user }], maxTokens: COMM_TURN_MAX_TOKENS, model, thinking: "disabled", effort: null };
}

export interface CommTurnOutput {
  reflection: string;
  question: string;
  questionFrom: "model" | "bank";
  /** At most one drafted item; present only when it passed every check. The person still decides (That's me / Not now / edit). */
  item: { kind: CommKind; wording: string } | null;
  /** Why no item, when the model drafted one that was kept out (closed codes, for the trace; the checks' verdict decides what the person sees). */
  itemRefused: string | null;
  verdict: CheckVerdict | null;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const tokens = (s: string) => s.toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9']+/g) ?? [];
const NEVER = new RegExp(String.raw`\b(?:${COMM_NEVER_ON_SCREEN.map((w) => w.replace(/ /g, "\\s+")).join("|")})\b`, "i");
// First-person function words that may differ between what was said and how the item is written.
const GLUE = new Set(["i", "i'm", "i've", "i'd", "i'll", "me", "my", "myself", "a", "an", "the", "to", "and", "it", "is", "it's", "that", "when", "so", "of", "in", "on", "for", "with", "be", "am", "do", "don't", "does", "can", "can't", "usually", "often", "just"]);

/** Share of the item's content words that the person actually said (law 2: the item is theirs, not the model's). */
export function groundedShare(item: string, answer: string): number {
  const said = new Set(tokens(answer));
  const content = tokens(item).filter((t) => !GLUE.has(t));
  if (!content.length) return 0;
  return content.filter((t) => said.has(t) || said.has(t.replace(/(?:ing|ed|es|s)$/, ""))).length / content.length;
}
export const MIN_GROUNDED = 0.75;

export function finishCommTurn(raw: string, i: CommTurnInput): CommTurnOutput {
  let o: Record<string, unknown> = {};
  try { const m = /\{[\s\S]*\}/.exec(raw); if (m) { const p = JSON.parse(m[0]); if (p && typeof p === "object") o = p as Record<string, unknown>; } } catch { /* falls back below */ }
  const out: CommTurnOutput = { reflection: "", question: i.plan.question, questionFrom: "bank", item: null, itemRefused: null, verdict: null };
  // The reflection: short, no question, nothing the law keeps off the screen. Otherwise none (a turn without one is fine).
  const refl = typeof o.reflection === "string" ? o.reflection.replace(/\s+/g, " ").trim() : "";
  if (refl && words(refl).length <= MAX_REFLECTION_WORDS && !refl.includes("?") && !NEVER.test(refl) && !stops(keywordRisk(refl)) && !/\b(?:should|try|you need|you must|healthy|unhealthy|toxic|fix|improve|wrong|better)\b/i.test(refl)) out.reflection = refl;
  // The question: the model's wording only when it passes the same rules as the bank; otherwise the bank's own words, exactly.
  const q = typeof o.question === "string" ? o.question.replace(/\s+/g, " ").trim() : "";
  if (q && q !== i.plan.question && !talkQuestionProblems(q, i.plan.kind, { sessionNumber: i.sessionNumber, raisedByPerson: false, opener: i.plan.kind === "lands_hard" ? false : true }).length) {
    out.question = q; out.questionFrom = "model";
  }
  // The item: only for a kind the person was just asked about, grounded in their own words, through the 4.3 checks as something they said.
  const item = typeof o.item === "string" ? o.item.replace(/\s+/g, " ").trim() : "";
  if (item && i.answeredKind) {
    if (item.length > MAX_ITEM_CHARS || words(item).length > 40) out.itemRefused = "too_long";
    else if (groundedShare(item, i.answer) < MIN_GROUNDED) out.itemRefused = "not_their_words";
    else {
      const v = checkBeforeSuggesting({ text: item, kind: i.answeredKind, source: "talk_said" });
      out.verdict = v;
      if (v.ok) out.item = { kind: i.answeredKind, wording: item }; else out.itemRefused = v.action;
    }
  }
  return out;
}
