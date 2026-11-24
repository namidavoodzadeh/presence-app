// E27 stability (CEO 13:15 PT 07 Nov): code validators after the analysis, instead of tuning prompts case by case. A
// friction's kind must have its sign in the words it quotes; a mislabelled friction gives the rewrite a change it cannot
// make (g11: "sarcasm" on the literal "do what you want" must vanish word for word, so both attempts fail). The analysis is
// retried once with the violations named (analyse.ts), then a friction that still fails is dropped. Kinds whose words have
// no reliable sign (character, contempt, demand, blame_stack) are not checked here; the critic judges those.

import { FRICTION_KINDS } from "./types.ts";
import type { FrictionKind } from "./types.ts";

const YOU = /\b(?:you|your|you're|youre|you've|you'll|you'd|yourself|ya|u)\b/i;

/** The sign each checked kind needs in its own quote. vague_ask quotes nothing of its own, so it is checked on the draft. */
const SIGNS: Partial<Record<FrictionKind, RegExp>> = {
  absolute: /\b(?:always|never|every|everything|everyone|everybody|each time|nothing|nobody|no one|all the time|constantly|forever|as usual|usual|usually|only|ever|anymore|any more|whole|not once|keeps?|again and again)\b/i,
  // Words that can mean their opposite (mock thanks or praise, sarcastic permission), or a question that is not asked.
  sarcasm: /\b(?:thanks|thank you|great|nice|wow|wonderful|perfect|brilliant|fantastic|lovely|amazing|awesome|sure|of course|obviously|clearly|congrat\w*|good job|good for you|well done|love (?:how|that|it)|how (?:nice|kind|thoughtful|lovely|sweet)|must be nice|genius|finally|as usual|really|so glad|appreciate\w*|oh|cool|fine|whatever|apparently|totally|surprise\w*|shock\w*|heaven forbid|god forbid|why (?:do|does|did|is|are|would|can't|won't|must|should|am)|how hard)\b|\?/i,
  heat: /\b(?:hate|hated|hating|sick of|fed up|furious|livid|can't stand|cannot stand|done with|sick and tired|tired of|disgust\w*|damn\w*|hell|fuck\w*|shit\w*|crap|bloody|pissed|ridiculous|unbelievable|exhaust\w*|enough|screw|rage|angry|mad at)\b|!/i,
};

/** you_blame and mind_reading are claims about the receiver: the sentence they sit in names them, or speaks to them as an
 *  order ("Stop telling me how to raise my kids"). Checked on the sentence, since the quote may leave the "you" out. */
const ABOUT_THEM: FrictionKind[] = ["you_blame", "mind_reading"];
const ORDER = /^\W*(?:stop|quit|don't|do not|never|just|keep|leave|get|go|give|tell|let|cut|drop)\b/i;
function sentenceOf(draft: string, quote: string): string {
  const at = draft.toLowerCase().indexOf(quote.toLowerCase());
  if (at < 0) return quote;
  const start = Math.max(...[".", "!", "?", "\n"].map((m) => draft.lastIndexOf(m, at - 1))) + 1;
  const ends = [".", "!", "?", "\n"].map((m) => draft.indexOf(m, at + quote.length)).filter((i) => i >= 0);
  return draft.slice(start, ends.length ? Math.min(...ends) : draft.length);
}

/** An explicit ask somewhere in the draft: a vague_ask on it is a mislabel. */
const ASK = /\b(?:can you|could you|would you|will you|please|i'd like|i would like|i need you to|i want you to|let's|let us|i'm asking|i am asking|would it be ok|would you mind)\b/i;

/** What the kind needs, for the repair call and the trace. */
const NEEDS: Record<string, string> = {
  absolute: "an absolute word (always, never, every, only, as usual…)",
  sarcasm: "words that can mean their opposite (mock thanks or praise, sarcastic permission) or a question that is not really asked",
  heat: "a heat word (hate, sick of, fed up, a swear word, an exclamation)",
  you_blame: "a claim about the receiver, so a sentence that names them",
  mind_reading: "a claim about the receiver's feeling or motive, so a sentence that names them",
  vague_ask: "a message with no explicit ask; this one asks (\"can you\", \"please\", \"I'd like\"…)",
};

/** True when the quoted words carry the kind's sign (or the kind is not one code checks). */
export function kindHolds(kind: FrictionKind, quote: string, draft: string): boolean {
  if (kind === "vague_ask") return !ASK.test(draft);
  if (ABOUT_THEM.includes(kind)) { const s = sentenceOf(draft, quote); return YOU.test(s) || ORDER.test(s); }
  const sign = SIGNS[kind];
  // Shouting (a word in three or more capitals) is heat too.
  if (kind === "heat" && /\b[A-Z]{3,}\b/.test(quote)) return true;
  return !sign || sign.test(quote);
}

/** One line per friction whose kind has no sign in its words; empty when every kind holds. */
export function kindViolations(frictions: { kind: FrictionKind; quote: string }[], draft: string): string[] {
  return frictions.filter((f) => !kindHolds(f.kind, f.quote, draft))
    .map((f) => `${f.kind} ${JSON.stringify(f.quote)}: that kind needs ${NEEDS[f.kind]}, and these words carry none; give the kind the words do carry, or leave it out`);
}

/** CEO 11:15 PT 07 Nov: the summary and the why lines name no friction kind and none of the old engine phrases. The sender's
 *  own words (in quotes, or in the draft) stand. The golden scorer keeps its own list; this is the engine's. */
const ENGINE_TERMS = [...new Set([...FRICTION_KINDS.flatMap((k) => [k, k.replace(/_/g, " ")]), "heat word", "claim about what they do", "no clear ask"])];
export function engineTermsIn(line: string, draft: string): string[] {
  const unquoted = line.replace(/“[^”]*”/g, " ").toLowerCase(), own = draft.toLowerCase();
  return ENGINE_TERMS.filter((t) => new RegExp(`\\b${t}s?\\b`).test(unquoted) && !own.includes(t));
}
