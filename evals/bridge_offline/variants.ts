// Laboratory-only candidate rules for K-0163.  They are applied by the
// offline evaluator after the normal engine analysis, never by a route.

import { words } from "../../next/engine/words.ts";
import type { Analysis, Friction } from "../../next/engine/bridge/types.ts";
import type { Belief } from "../../next/engine/types.ts";

export type VariantName =
  | "baseline"
  | "k0107-belief-link"
  | "link-mid"
  | "vague-strict"
  | "you-blame-strict"
  | "combo";

const K0107_INSTRUCTION =
  "\n\nLAB VARIANT K-0107: Link a belief only when the message is about the same situation or need as that belief; never for logistics, plans, or thanks; when unsure, leave activated empty.";
const LINK_MID_INSTRUCTION =
  "\n\nLAB VARIANT link-mid: Show at most one sender-belief link. Show it only when a concrete subject in the message is also present in that belief's statement or receipt; do not link merely because both are complaints, requests, or feelings. Keep the link empty for logistics, plans, thanks, or a vague thematic resemblance.";
// These examples are invented solely to explain the candidate boundary.  They
// are not gold cases or paraphrases of the fixed draft set.
const VAGUE_STRICT_INSTRUCTION =
  '\n\nLAB VARIANT vague-strict: Mark an unclear ask only when the writer is asking the other person to take action but gives no concrete action, time, or object. For example, "Could you do something about this?" can be unclear; "Could you put the parcel by the door before six?" is already specific. Do not mark a plain feeling, a fact, a logistics update, or a warm note as an unclear ask.';
const YOU_BLAME_STRICT_INSTRUCTION =
  '\n\nLAB VARIANT you-blame-strict: Mark blame only for a negative claim about what the other person does or is. Do not mark a direct request, a neutral fact, a question, or the writer\'s own feeling as blame. For example, "You ignore every message" is blame; "Can you answer by noon?" is not.';

export function instructionFor(variant: VariantName): string {
  switch (variant) {
    case "k0107-belief-link":
      return K0107_INSTRUCTION;
    case "link-mid":
      return LINK_MID_INSTRUCTION;
    case "vague-strict":
      return VAGUE_STRICT_INSTRUCTION;
    case "you-blame-strict":
      return YOU_BLAME_STRICT_INSTRUCTION;
    case "combo":
      return LINK_MID_INSTRUCTION + VAGUE_STRICT_INSTRUCTION +
        YOU_BLAME_STRICT_INSTRUCTION;
    case "baseline":
      return "";
  }
}

const TOPIC_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "always",
  "around",
  "being",
  "could",
  "does",
  "dont",
  "every",
  "feel",
  "from",
  "have",
  "here",
  "into",
  "just",
  "know",
  "like",
  "make",
  "more",
  "much",
  "need",
  "never",
  "only",
  "other",
  "really",
  "said",
  "some",
  "something",
  "that",
  "them",
  "then",
  "there",
  "they",
  "this",
  "thing",
  "think",
  "time",
  "want",
  "when",
  "with",
  "would",
  "your",
  "youre",
]);

function stem(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 4) return word.slice(0, -1);
  return word;
}

function topicWords(text: string): Set<string> {
  return new Set(
    words(text).map(stem).filter((word) =>
      word.length > 2 && !TOPIC_STOP_WORDS.has(word)
    ),
  );
}

function hasConcreteTopic(message: string, belief: Belief): boolean {
  const messageTopics = topicWords(message);
  if (!messageTopics.size) return false;
  const evidence = [
    belief.label,
    belief.statement,
    ...belief.receipts.map((receipt) => receipt.quote),
  ].join(" ");
  return [...topicWords(evidence)].some((word) => messageTopics.has(word));
}

/** A middle ground between the baseline and K-0107's quote-overlap gate. */
export function gateMidLinks(
  analysis: Analysis,
  message: string,
  beliefs: Belief[],
): Analysis {
  const endorsed = new Map(
    beliefs.filter((belief) => belief.status === "endorsed").map((
      belief,
    ) => [belief.id, belief]),
  );
  const kept = analysis.activated.filter((link) => {
    const belief = endorsed.get(link.beliefId);
    return Boolean(belief && hasConcreteTopic(message, belief));
  });
  return { ...analysis, activated: kept.slice(0, 1) };
}

const OTHER_PERSON_ASK =
  /\b(?:can|could|would|will)\s+you\b|\b(?:i\s+)?(?:need|want)\s+you\s+to\b|^\s*(?:please\s+)?(?:tell|give|send|call|stop|start|leave|take|put|bring|do)\b/i;
const SPECIFIC_ASK =
  /\b(?:today|tonight|tomorrow|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|by\s+\d|at\s+\d|before\s+\d|after\s+\d|the\s+\w+|my\s+\w+|your\s+\w+)\b/i;

function isStrictVagueAsk(message: string): boolean {
  return OTHER_PERSON_ASK.test(message) && !SPECIFIC_ASK.test(message);
}

const YOU_BLAME_CLAIM =
  /\byou\s+(?:always|never|only|just|keep|dont|don't|do not|ignore|forget|cancel|leave|make|turn|decide|expect|assume|care|listen|show|say|are|were|re)\b/i;

function isStrictYouBlame(message: string): boolean {
  return YOU_BLAME_CLAIM.test(message) &&
    !/\b(?:can|could|would|will)\s+you\b/i.test(message);
}

function filterFrictions(
  analysis: Analysis,
  message: string,
  kinds: Set<Friction["kind"]>,
): Analysis {
  return {
    ...analysis,
    frictions: analysis.frictions.filter((friction) => {
      if (!kinds.has(friction.kind)) return true;
      if (friction.kind === "vague_ask") return isStrictVagueAsk(message);
      if (friction.kind === "you_blame") return isStrictYouBlame(message);
      return true;
    }),
  };
}

export function applyVariant(
  variant: VariantName,
  analysis: Analysis,
  message: string,
  beliefs: Belief[],
  k0107Gate: (analysis: Analysis, beliefs: Belief[]) => Analysis,
): Analysis {
  switch (variant) {
    case "baseline":
      return analysis;
    case "k0107-belief-link":
      return k0107Gate(analysis, beliefs);
    case "link-mid":
      return gateMidLinks(analysis, message, beliefs);
    case "vague-strict":
      return filterFrictions(analysis, message, new Set(["vague_ask"]));
    case "you-blame-strict":
      return filterFrictions(analysis, message, new Set(["you_blame"]));
    case "combo":
      return filterFrictions(
        gateMidLinks(analysis, message, beliefs),
        message,
        new Set(["vague_ask", "you_blame"]),
      );
  }
}
