// V3 communication model, spec 4.3: the checks an item passes before a suggestion is shown. Deterministic, no AI, only ever adds a refusal.
// The order is fixed: safety floor, never-inferred, control of another person, about the other person, a rule that forbids raising something,
// the character-label / clinical words, then the confidence rule. The first failing check decides; later ones do not run.
import { keywordRisk, stops } from "./safety.ts";
import { type CommKind, type CommSource, isOwnStatement, neverInferredReason } from "./comm.ts";

export type CheckVerdict =
  | { ok: true }
  | { ok: false; action: "safety_route"; reason: string }                 // stop; resources shown; nothing kept (law 8)
  | { ok: false; action: "drop"; reason: string }                         // not kept, nothing offered
  | { ok: false; action: "offer_request"; reason: string; offer: string }       // not kept as written; the offer is the person's to accept (law 3)
  // Not kept as written. The planner writes the I-statement from the person's own words (a model call), or the person keeps a private note.
  | { ok: false; action: "offer_i_statement"; reason: string; offer: null }
  | { ok: false; action: "keep_listening"; reason: string };              // below the confidence bar for a drawn suggestion

/** Confidence bar for a suggestion drawn from drafts, Mirror, import or carry-over (law 9 as amended). What the person says in Talk is offered at once. */
export const COMM_CONFIDENCE_BAR = 0.7;

const RELATION = String.raw`(?:he|she|they|my (?:partner|wife|husband|boyfriend|girlfriend|mum|mom|mother|dad|father|boss|ex|friend|sister|brother|manager|colleague))`;
const THIRD = String.raw`(?:${RELATION}|[A-Z][a-z]{2,})`;
// 4.3 "asking to control another person beyond how you talk to each other": where they go, who they see, their money or phone.
const CONTROL: RegExp[] = [
  new RegExp(String.raw`\b${THIRD}\s+(?:must not|mustn't|can't|cannot|shouldn't|should not|isn't allowed to|is not allowed to|has to|have to|must|needs to ask)\s+(?:go|see|meet|visit|spend|text|call|talk to|speak to|message|use|check|have|leave|work|wear)\b`, "i"),
  /\b(?:not allowed to|isn't allowed to|forbid(?:den)?|ban(?:ned)?)\b.*\b(?:go out|see (?:her|him|them|friends|family)|friends|phone|money|account|passwords?|location)\b/i,
  /\b(?:i|we)\s+(?:need|want|have|get)\s+(?:to\s+)?(?:know|check|read|see|track|control|approve)\s+(?:where|who|every|all|their|his|her)\b.*\b(?:go|goes|phone|texts?|messages?|money|spend|location|with)\b/i,
  /\b(?:share|give me|hand over)\s+(?:your|their|his|her)\s+(?:location|password|phone|passcode|bank|account)\b/i,
  /\b(?:ask|tell)s?\s+(?:me|us)\s+before\s+(?:she|he|they)\s+(?:goes?|spends?|sees?|meets?|leaves?)\b/i,
];
// A statement about the other person ("Jan never listens"): no first-person subject, a named or pronoun subject, a claim about them.
// A relation or pronoun takes any claim; a bare capitalised word (a name, or just the start of a sentence) only a behaviour claim, so "Texting is hard" passes.
const OTHER_CLAIM = new RegExp(String.raw`^\s*(?:(?:${RELATION})\s+(?:\w+\s+)?(?:never|always|doesn't|does not|won't|refuses|is|are|isn't|thinks|only|just|keeps|can't|cannot|doesnt)\b|[A-Z][a-z]{2,}\s+(?:never|always|doesn't|does not|won't|refuses|keeps|doesnt)\b)`, "i");
// A first-person SUBJECT ("I go quiet", "we"): "me" and "my" do not count, because "She always interrupts me" is still about her.
const FIRST_PERSON = /\b(?:i|i'm|i’m|i've|i'd|i'll|we|we're|we've)\b/i;
// A rule that would forbid raising something at all.
const FORBID_RAISING = /\b(?:never|don't|do not|must not|mustn't|can't|cannot|not ever)\s+(?:ever\s+)?(?:bring(?:s|ing)?\s+up|mention|talk(?:ing)?\s+about|ask(?:ing)?\s+about|raise|discuss|say anything about|speak about)\s+(.+?)[.!?]*\s*$/i;
// 7 (law 7) and the CPO "never on screen" list: no item text carries these as labels for a person.
export const COMM_NEVER_ON_SCREEN = [
  "flooding", "flooded", "pursuer", "withdrawer", "avoidant", "anxious", "attachment", "rejection sensitivity", "love language", "love languages",
  "four horsemen", "contempt", "toxic", "red flag", "trigger", "triggered", "style", "pattern",
] as const;
const CLINICAL = new RegExp(String.raw`\b(?:${COMM_NEVER_ON_SCREEN.map((w) => w.replace(/ /g, "\\s+")).join("|")})\b`, "i");
// 4.2 the planner never asks about childhood, origins, diagnoses or mood words.
const ORIGINS = /\b(?:child(?:hood)?|growing up|grew up|parents?|trauma|diagnos\w*|depress\w*|anxiety|bipolar|adhd|ptsd|disorder|therapy|therapist|mood)\b/i;

export interface ItemCheckInput { text: string; kind: CommKind; source: CommSource; confidence?: number }

export function requestOffer(forbidden: string): string {
  const what = forbidden.replace(/^(?:my|the)\s+/i, (m) => m.toLowerCase()).replace(/\s+/g, " ").trim();
  return `It's hard for me to talk about ${what}; ask me first.`;
}

export function checkBeforeSuggesting(i: ItemCheckInput): CheckVerdict {
  const text = i.text.trim();
  if (!text) return { ok: false, action: "drop", reason: "empty" };
  // 1. Law 8: a stop shows resources and keeps nothing. The model's own flag is added by the caller (combinedRisk); the floor is here.
  const risk = keywordRisk(text);
  if (stops(risk)) return { ok: false, action: "safety_route", reason: risk.reason };
  // 2. 4.5: never inferred from any source.
  const ni = neverInferredReason(i.kind, i.source);
  if (ni) return { ok: false, action: "drop", reason: ni };
  // 3. 4.3: control of another person beyond how you talk to each other goes to the safety route (law 8 addition).
  for (const re of CONTROL) if (re.test(text)) return { ok: false, action: "safety_route", reason: "asks to control another person" };
  // 4. A rule that would forbid raising something at all is offered back as a request.
  const f = FORBID_RAISING.exec(text);
  if (f) return { ok: false, action: "offer_request", reason: "forbids raising something", offer: requestOffer(f[1]) };
  // 5. 4.3 / law 11 and the PSY rule 3: an item describes the person, never the other. No first-person subject and a claim about someone else.
  if (!FIRST_PERSON.test(text) && OTHER_CLAIM.test(text)) {
    return { ok: false, action: "offer_i_statement", reason: "about the other person", offer: null };
  }
  // 6. Law 7 and the CPO never-on-screen list.
  const word = CLINICAL.exec(text);
  if (word) return { ok: false, action: "drop", reason: `never on screen: ${word[0].toLowerCase()}` };
  // 7. Law 9 as amended: confidence matters only for a suggestion the engine draws; what the person said in Talk is offered at once.
  if (!isOwnStatement(i.source) && (i.confidence ?? 0) < COMM_CONFIDENCE_BAR) return { ok: false, action: "keep_listening", reason: "below 0.7" };
  return { ok: true };
}

// ---------------------------------------------------------------- 4.2 the Talk question rules
export const TALK_QUESTION_MAX_WORDS = 20;
const WHY = /\bwhy\b/i;
const OTHER_FAULT = /\b(?:their|his|her)\s+(?:fault|problem|character|intentions?|issues?)\b|\bwhat'?s wrong with (?:them|him|her)\b|\bwho(?:'s| is) (?:to blame|the problem)\b/i;

/** Problems with a planned Talk question (empty = the question may be asked). */
export function talkQuestionProblems(q: string, kind: CommKind, opts: { sessionNumber: number; raisedByPerson?: boolean; opener?: boolean }): string[] {
  const p: string[] = [];
  const words = q.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) p.push("empty");
  if (words > TALK_QUESTION_MAX_WORDS) p.push("over_20_words");
  if ((q.match(/\?/g) ?? []).length !== 1 || !/\?\s*$/.test(q.trim())) p.push("not_one_question");
  if (WHY.test(q)) p.push("why");
  if (OTHER_FAULT.test(q)) p.push("about_other_character");
  if (ORIGINS.test(q)) p.push("origins_or_clinical");
  if (CLINICAL.test(q)) p.push("never_on_screen_word");
  if (keywordRisk(q).risk !== "none") p.push("risk_phrase");
  if (kind === "lands_hard" && opts.opener) p.push("lands_hard_never_an_opener");   // bank: offered only inside a moment the person tells
  if ((kind === "gets_heated" || kind === "coming_back") && opts.sessionNumber < 2 && !opts.raisedByPerson) p.push("waits_for_session_2");
  return p;
}
