// Verify (BRIDGE-ENGINE §3.4): the code half. The critic is a separate model call in bridge.ts; these checks
// run on every rewrite before it can be shown. A failing rewrite is never shown.

import type { CheckResult } from "../types.ts";
import { CLINICAL, EVALUATIVE, words } from "../words.ts";
import type { Plan, Rewrite, Sender } from "./types.ts";

const NVC = /\bi\s+(?:feel|felt)\b.{0,80}\bwhen\b.{0,120}\bbecause\s+i\s+need\b/is;
const APOLOGY = /\b(?:i(?:'m| am) sorry|forgive me|my apologies|i apologi[sz]e)\b/i;
const CONCESSION =
  /\b(?:you(?:'re| are) right|i understand (?:that )?you(?:'re| are)|i know you(?:'re| are) busy|i know you (?:didn't|did not) mean|i get that you)\b/i;
const SOFTENER = /\b(?:please|could you|would you mind|if it's not too much|no pressure|no worries)\b/i;
const COMPLIMENT =
  /\b(?:i appreciate|i'm grateful|i am grateful|thank you for|you(?:'re| are) (?:great|wonderful|amazing))\b/i;
const RECEIVER_INNER =
  /\byou\s+(?:(?:clearly|obviously|just|only|really|don't|do not|never)\s+){0,2}(?:think|feel|want|care|meant|mean|believe|intend|like|enjoy|prefer)\b/i;
const FIRST_PERSON = /\b(?:I|me|my|mine|we|us|our|ours|I'm|I've|I'd|I'll)\b/;

export const LENGTH_MIN = 0.6;
/**
 * The upper bound by the original's length (BRIDGE-ENGINE §3.4; CDO D8 counterweight as the COO set it 2026-10-27 21:50):
 *  - 60 words or fewer: 1.8 (A60: a plain restatement of an absolute or a sarcasm needs a few more words, and the design's
 *    own example goes from 19 to 33 words, 1.74, because the Say-why-it-matters line is added);
 *  - above 60 words: 1.25: a long message has room already, so growth is capped and the review screen does not scroll twice as far.
 * The earlier middle band (30 to 60 words at 1.4) is gone. The critic's add-nothing judgement stays the guard against padding at every length.
 */
export const LENGTH_MAX = 1.8;
export const LENGTH_MAX_LONG = 1.25;
export const LONG_ORIGINAL_WORDS = 60;
export function lengthMax(originalWords: number): number {
  return originalWords > LONG_ORIGINAL_WORDS ? LENGTH_MAX_LONG : LENGTH_MAX;
}
/** Short originals have little room: a rewrite within this many words of the original also passes. */
export const LENGTH_SLACK_WORDS = 5;
/** The most words length_ratio lets "bridged" have, told to the writer so it does not learn the limit by failing it. */
export function maxBridgedWords(originalWords: number): number {
  return Math.max(Math.floor(originalWords * lengthMax(originalWords) + 1e-9), originalWords + LENGTH_SLACK_WORDS);
}

function fold(text: string): string {
  return text.toLowerCase().replace(/[’]/g, "'");
}

/** Same words, same order: case, curly quotes, whitespace and a trailing full stop do not count as a change. */
export function sameText(a: string, b: string): boolean {
  const norm = (t: string) => fold(t).replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
  return norm(a) === norm(b);
}

/** An absolute is replaced by the event, stated as what happened ("When dinner moved twice this week without a heads-up"),
 *  never by a present-tense label on the person ("You're bailing", "You're not showing up") (COO 15:15 10-27, run 2 b04). */
const PRESENT_LABEL = /^\W*you(?:'re| are)\s+(?:(?:not|still|just|always|never|only|clearly)\s+)?\w+ing\b/i;
export function absoluteAsLabel(to: string): boolean {
  return PRESENT_LABEL.test(to.trim());
}

const KEEPS_WORDS = new Set<string>(["demand", "vague_ask", "blame_stack"]);
/** The phrase, case and curly quotes aside, as whole words of the text. */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = fold(phrase).replace(/^\W+|\W+$/g, "").replace(/\s+/g, " ");
  if (!p) return false;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${esc}(?:\\W|$)`).test(fold(text).replace(/\s+/g, " "));
}

export function verifyCode(original: string, rewrite: Rewrite, plan: Plan, sender: Sender): CheckResult[] {
  const checks: CheckResult[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const bridged = rewrite.bridged;
  const ow = words(original).length, bw = words(bridged).length;
  const ratio = bw / Math.max(1, ow);
  const max = lengthMax(ow);
  const lengthOk = (ratio >= LENGTH_MIN && ratio <= max) || Math.abs(bw - ow) <= LENGTH_SLACK_WORDS;
  const band = ow > LONG_ORIGINAL_WORDS
    ? `over ${LONG_ORIGINAL_WORDS} words`
    : `up to ${LONG_ORIGINAL_WORDS} words`;
  add(
    "length_ratio",
    lengthOk,
    `${bw}/${ow} words = ${
      ratio.toFixed(2)
    } (${LENGTH_MIN}–${max} for ${band}, or within ${LENGTH_SLACK_WORDS} words)${lengthOk ? "" : `: write at most ${maxBridgedWords(ow)} words`}`,
  );
  add(
    "first_person_kept",
    !FIRST_PERSON.test(original) || FIRST_PERSON.test(bridged),
    FIRST_PERSON.test(bridged) ? "first person present" : "the rewrite lost the first person",
  );
  add(
    "no_nvc_template",
    !NVC.test(bridged) || NVC.test(original),
    NVC.test(bridged) && !NVC.test(original) ? "I feel X when you Y because I need Z" : "no template",
  );
  const apology = APOLOGY.exec(bridged);
  add(
    "no_added_apology",
    !apology || APOLOGY.test(original),
    apology && !APOLOGY.test(original) ? `added "${apology[0]}"` : "none added",
  );
  const concession = CONCESSION.exec(bridged);
  add(
    "no_added_concession",
    !concession || CONCESSION.test(original),
    concession && !CONCESSION.test(original) ? `added "${concession[0]}"` : "none added",
  );
  const softener = SOFTENER.exec(bridged);
  add(
    "no_added_softener",
    !softener || SOFTENER.test(original),
    softener && !SOFTENER.test(original) ? `added "${softener[0]}"` : "none added",
  );
  const compliment = COMPLIMENT.exec(bridged);
  add(
    "no_added_compliment",
    !compliment || COMPLIMENT.test(original),
    compliment && !COMPLIMENT.test(original) ? `added "${compliment[0]}"` : "none added",
  );
  // The sender's own words outside every planned friction are theirs ("Whatever, do what you want" keeps "you want");
  // the same words inside a flagged quote ("you clearly don't care") are what the plan removes, so they still fail.
  // A vague ask quotes the whole draft and removes none of its words (g11, every gate miss on 7-8 Nov), so it flags nothing here.
  const flagged = plan.transformations.filter((t) => t.kind !== "vague_ask").map((t) => fold(t.quote));
  const inner = [...`${bridged} ${rewrite.contextNote ?? ""}`.matchAll(new RegExp(RECEIVER_INNER.source, "gi"))]
    .find((m) => !fold(original).includes(fold(m[0])) || flagged.some((q) => q.includes(fold(m[0])))) ?? null;
  add(
    "no_receiver_inner_life",
    !inner,
    inner ? `states the receiver's inner life: "${inner[0]}"` : "nothing about the receiver's inner life",
  );
  // Evaluative and clinical words: the sender's own (in the original or the cited belief) are theirs; anything else is added.
  const allowed = new Set([...words(original), ...words(plan.contextBelief?.statement ?? "")]);
  const banned = new Set<string>([...EVALUATIVE, ...CLINICAL]);
  const added = [
    ...new Set(
      words(`${bridged} ${rewrite.contextNote ?? ""}`).filter((w) => banned.has(w) && !allowed.has(w)),
    ),
  ];
  add(
    "no_added_evaluative_or_clinical",
    added.length === 0,
    added.length ? `added: ${added.join(", ")}` : "clean",
  );
  const leaked = sender.receiverShared.filter((t) =>
    t.trim() && fold(`${bridged} ${rewrite.contextNote ?? ""}`).includes(fold(t.trim()))
  );
  add(
    "no_receiver_belief_text",
    leaked.length === 0,
    leaked.length
      ? `receiver's shared belief text appears: ${leaked.map((t) => JSON.stringify(t)).join(", ")}`
      : `${sender.receiverShared.length} receiver belief(s) checked, none appear`,
  );
  const contextOk = rewrite.contextNote === null ||
    (plan.contextBelief !== null &&
      sender.map.beliefs.some((b) => b.id === plan.contextBelief!.id && b.status === "endorsed"));
  add(
    "context_note_cited",
    contextOk,
    rewrite.contextNote === null
      ? "no context line"
      : contextOk
      ? `cites ${plan.contextBelief!.id}, endorsed, the sender's own`
      : "a context line with no endorsed belief behind it",
  );
  const badFrom = rewrite.changes.filter((c) => !fold(original).includes(fold(c.from)));
  add(
    "changes_quote_original",
    badFrom.length === 0,
    badFrom.length
      ? `"from" not in the original: ${badFrom.map((c) => JSON.stringify(c.from)).join(", ")}`
      : `${rewrite.changes.length} change(s) quote the original`,
  );
  const planned = new Set(plan.transformations.map((t) => t.kind));
  const applied = new Set(rewrite.changes.map((c) => c.kind));
  const missing = [...planned].filter((k) => !applied.has(k));
  add(
    "plan_applied",
    missing.length === 0,
    missing.length
      ? `no change recorded for: ${missing.join(", ")}`
      : "every planned transformation has a change",
  );
  const unresolvedAsk = rewrite.changes.filter((c) => c.kind === "vague_ask" && c.from === c.to);
  if (unresolvedAsk.length) {
    add("vague_ask_flagged", true, "the ask stays unstated; the sender is asked what they want them to do");
  }
  const inventedAgain = rewrite.changes.filter((c) =>
    c.kind === "absolute" && /\bagain\b/i.test(c.to) && !/\bagain\b/i.test(original)
  );
  add(
    "no_invented_again",
    inventedAgain.length === 0,
    inventedAgain.length
      ? `an absolute replacement invented "again": ${
        inventedAgain.map((c) => JSON.stringify(c.to)).join(", ")
      }`
      : "no repeat word invented",
  );
  // E27: the critic passed g12's "…and I'm worn out. I feel worn out.": a phrase said more often than the original says it is
  // the feeling named twice or a point padded; one of the versions without it is used instead.
  const repeated = repeatedPhrases(original, bridged);
  add(
    "no_repeated_phrase",
    repeated.length === 0,
    repeated.length ? `said twice: ${repeated.map((r) => `"${r}"`).join(", ")}` : "nothing said twice",
  );
  // E27: the critic passed g18's "You get weird when my family visits" while its own note said the label stayed. A flagged
  // heat word, label, claim or absolute still there word for word is a transformation not made. A demand keeps its ask's
  // words, a vague ask may stand, and a blame stack keeps the sender's list, so those three are not checked here.
  const kept = plan.transformations.filter((t) => !KEEPS_WORDS.has(t.kind) && containsPhrase(bridged, t.quote));
  // A bare-adjective label ("You're so selfish", "You get weird") goes as a word too: g18 passed the critic as "things feel
  // weird between us". Only that narrow shape: a label that carries its behaviour keeps the behaviour's words.
  for (const t of plan.transformations) {
    const label = t.kind === "character" ? bareLabel(t.quote) : null;
    if (label && containsPhrase(bridged, label) && !containsPhrase(original.replace(t.quote, " "), label)) kept.push({ ...t, quote: label });
  }
  add(
    "friction_words_gone",
    kept.length === 0,
    kept.length
      ? `still there word for word: ${kept.map((t) => `${t.kind} ${JSON.stringify(t.quote)}`).join(", ")}`
      : "no flagged wording kept",
  );
  const labels = rewrite.changes.filter((c) => c.kind === "absolute" && absoluteAsLabel(c.to));
  add(
    "absolute_stated_as_event",
    labels.length === 0,
    labels.length
      ? `an absolute became a present-tense label on the person, not the event that happened: ${
        labels.map((c) => JSON.stringify(c.to)).join(", ")
      }`
      : `${rewrite.changes.filter((c) => c.kind === "absolute").length} absolute change(s) state the event`,
  );
  // ok requires a changed text (COO 15:15 10-27, run 2 b07): the same words under "ok" was the run 1 failure. bridge.ts turns an
  // unchanged text whose only planned frictions are flagged asks into nothing_to_change with the ask note; any other unchanged text fails.
  add(
    "text_changed",
    !sameText(original, bridged),
    sameText(original, bridged)
      ? "the bridged text is the original, word for word"
      : "the bridged text differs from the original",
  );
  return checks;
}

/** The label word of a bare-adjective label on the person ("You're so selfish" → "selfish", "You get weird" → "weird"); else null. */
export function bareLabel(quote: string): string | null {
  const m = /^\W*you(?:'re|’re| are| get| seem| act)(?: so| really| very| such| being| always| totally)*\s+([a-z][a-z-]*)\W*$/i.exec(quote.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Function words: a two-word phrase with one of these ("to me", "me before") may repeat by chance in plain speech. */
const FUNCTION_WORDS = new Set(["i", "i'm", "i've", "i'd", "i'll", "you", "you're", "me", "my", "we", "us", "our", "it", "it's", "the", "a", "an", "to", "and", "or", "but", "of", "in", "on", "at", "for", "with", "that", "this", "is", "was", "be", "so", "not", "do", "don't", "when", "if", "about", "what", "there"]);

/** Two-word phrases of two content words that the rewrite says more times than the original does. */
export function repeatedPhrases(original: string, bridged: string): string[] {
  const count = (text: string) => {
    const w = words(text), m = new Map<string, number>();
    for (let i = 0; i + 1 < w.length; i++) {
      if (FUNCTION_WORDS.has(w[i]) || FUNCTION_WORDS.has(w[i + 1])) continue;
      const k = `${w[i]} ${w[i + 1]}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const before = count(original);
  return [...count(bridged)].filter(([k, n]) => n >= 2 && n > (before.get(k) ?? 0)).map(([k]) => k);
}

/** True when the rewrite left the text as it was and every planned transformation was a vague_ask the words could not resolve. */
export function onlyFlaggedAsks(original: string, rewrite: Rewrite, plan: Plan): boolean {
  if (!sameText(original, rewrite.bridged)) return false;
  if (plan.transformations.length === 0 || !plan.transformations.every((t) => t.kind === "vague_ask")) {
    return false;
  }
  return rewrite.changes.every((c) => c.kind !== "vague_ask" || sameText(c.from, c.to));
}

export function blockingFailures(checks: CheckResult[]): CheckResult[] {
  return checks.filter((c) => !c.ok && c.name !== "plan_applied" && c.name !== "text_changed");
}
