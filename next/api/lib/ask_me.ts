// Ask me, engine logic (staging, pure, no DB, no route; HQ dec-mirror-ask-me-13nov; guards: docs/design/app-v3/PSY-CGO-14nov.md s1).
// Answers are anonymous: no name, no identity field (`device` is an opaque flood-limit key, never shown). Law 12: an answer never
// reaches the owner word for word. Deterministic matching on word overlap, so the same answers always give the same cards.
// The screen below is the deterministic FLOOR (risk first, then drop rules). The model step (ask_me_step.ts) decides what passes it;
// the model-written card text comes later. Nothing here writes card text, and a card carries no answer text.
import { keywordRisk, stops } from "../../engine/safety.ts";
import { safetyEntries } from "../../engine/safety_entry.ts";
import type { ModelClient } from "../../engine/model/client.ts";

export interface Answer { id: string; text: string; device?: string }
export interface Kenning { id: string; wording: string }
/** What may leave the engine toward the owner: no answer ids, no counts of 1, no times, no order information. */
export interface OwnerCard { kind: "single" | "merged"; lead: string }
export interface AskCard { answer_ids: string[]; count: number; basis: "merged" | "single"; hold_reason?: string }

const STOP = new Set("a an the and or but of to in on at is are was were be been it its i he she they you we my your his her their this that for with as not no so very really just".split(" "));
export const tokens = (s: string): Set<string> =>
  new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
export const overlap = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
};
export const FOLD_AT = 0.6, MERGE_AT = 0.5, MIN_TOKENS = 2;
export const MIN_ANSWERS_BEFORE_CARDS = 3, LINK_DAYS = 7;

// ---- 1. Filter and safety screen (PSY 1) --------------------------------------------------------------------------------
export type Screen = "risk_stop" | "dropped" | "flagged" | "ok";
const DROP: [string, RegExp][] = [
  ["body_or_looks", /\b(fat|ugly|skinny|hot|sexy|body\s+(?:shape|type|image|odor)|(?:your|her|his|their)\s+body|weight|looks?|face|hair|pretty|handsome|boobs?|butt|chubby|overweight|thin)\b/i],
  ["sexual", /\b(sex|sexual|sexy|naked|nude|horny|porn|hook(?:ed)?\s*up|slept\s+with|virgin|kink)\b/i],
  ["diagnosis_or_mental_state", /\b(depress\w*|anxi\w*|bipolar|adhd|autis\w*|ocd|ptsd|narcissist\w*|psycho\w*|borderline|schizo\w*|disorder|trauma\w*|mental(?:ly)?\s+(?:ill|health)|crazy|insane|unstable|toxic|gaslight\w*|manipulat\w*)\b/i],
  ["private_about_someone", /\b(pregnan\w*|abortion|divorc\w*|affair|cheat(?:ed|ing|s)?|debt|bankrupt\w*|broke|salary|owes?|fired|arrested|lawsuit|secret|came\s+out|(?:your|my|his|her|their)\s+ex)\b/i],
  ["accusation", /\b(stole|steal(?:s|ing)?|lied|lies|liar|abus\w*|assault\w*|harass\w*|bully|bullied|bullies|cheated|scam\w*|fraud\w*|blamed|used\s+me|betray\w*|guilty|criminal)\b/i],
  ["threat", /\b(kill|hurt\s+you|beat\s+you|regret|watch\s+your|i\s*(?:'ll|will)\s+(?:get|find|ruin|expose|destroy)|expose\s+you|you(?:'ll|\s+will)\s+pay|coming\s+for\s+you)\b/i],
  ["insult", /\b(idiot|stupid|dumb|loser|pathetic|worthless|useless|annoying|selfish|fake|bitch|bastard|jerk|asshole|trash|garbage|hate\s+you|disgusting|moron|freak|weird|cringe|clingy|needy|arrogant|rude|lazy)\b/i],
];
// PSY 14 Nov (2): sensitive words are a FLAG, not a verdict. A flagged answer goes to the "moment without the rest" step; with no such step
// supplied it is dropped whole (the safe direction). "party" alone is not a flag, only the political sense ("political party", "party leader").
const FLAG: [string, RegExp][] = [
  ["faith_politics_sex_health", /\b(god|allah|church|mosque|prayer|pray(?:ed|s)?|religio\w*|atheist|muslim|christian|jewish|vote[sd]?|voting|election|trump|democrat|republican|liberal|conservative|(?:political|labou?r|green|tory)\s+party|party\s+(?:leader|member|line|vote)|gay|lesbian|bisexual|trans|queer|orientation|cancer|illness|sick|disease|diagnos\w*|medication|pills?|therapy|rehab)\b/i],
];
// A moment says what the person did or said: a time/occasion marker or a past action (regular '-ed' or a common irregular past form).
const MOMENT = /\b(when|after|before|while|whenever|once|last\s+\w+|the\s+time|that\s+(?:day|night|week)|yesterday|did|said|says|told|asked|went|stayed|left|came|offered|called|sent|helped|listened|answered|laughed|walked|waited|brought|showed|kept|stopped|started|\w+ed|made|gave|sat|took|got|put|met|held|found|ran|drove|wrote|taught|bought|paid|lent|stood|spoke|knew|saw|heard|lit|fed|won|let|sang|read|chose|caught|brought)\b/i;

/** Risk first (nothing stored), then the drop rules; an answer with no moment is dropped (label only). */
// The shared floor misses harm named against a third person ("hurt your wife"); an Ask me answer is stopped on it too.
const HARM_TO_OTHER = /\b(?:kill|hurt|harm|beat|hit|stab|shoot)(?:ing)?\s+(?:your|my|his|her|their|him|them|someone|somebody|the)\b/i;
// PSY hostile set G (14 Nov): risk said in other words, by a writer about themselves or the owner, or a sign someone is in danger. Only adds stops.
const ASK_ME_RISK = /\b(?:won'?t|will\s+not)\s+be\s+around(?:\s+much)?(?:\s+(?:longer|any\s*more))?\b|\b(?:see|saw|sees)\s+(?:no|the)\s+point\s+(?:of|in)\s+(?:waking|living|going\s+on|being\s+here|carrying\s+on)|\bflinch\w*\s+when\b[^.]*\b(?:lifted|raised)\s+(?:your|his|her|their)\s+(?:hand|fist|arm)|\b(?:scared|afraid|frightened|terrified)\s+to\s+(?:go|come|be)\s+home\b/i;
export function screenAnswer(text: string): { verdict: Screen; reason: string } {
  const r = keywordRisk(text);
  if (stops(r)) return { verdict: "risk_stop", reason: r.reason };
  if (HARM_TO_OTHER.test(text)) return { verdict: "risk_stop", reason: "harm to another person" };
  if (ASK_ME_RISK.test(text)) return { verdict: "risk_stop", reason: "risk in other words" };
  for (const [reason, re] of DROP) if (re.test(text)) return { verdict: "dropped", reason };
  if (tokens(text).size < MIN_TOKENS || !MOMENT.test(text)) return { verdict: "dropped", reason: "no_moment" };
  for (const [reason, re] of FLAG) if (re.test(text)) return { verdict: "flagged", reason };
  return { verdict: "ok", reason: "" };
}

// ---- 2a. Generalising: identifying detail makes a single answer wait ----------------------------------------------------
const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december";
const IDENT = new RegExp(
  String.raw`["“”'‘’][^"“”]{3,}["“”]|\d|\b(?:${DAYS})\b|\b(?:yesterday|tonight|this\s+morning|last\s+(?:night|week|month|year)|at\s+the\s+\w+|in\s+the\s+(?:kitchen|car|office|restaurant|bar|park|gym|hotel|airport)|at\s+(?:work|school|home|dinner|lunch|the\s+party))\b`, "i");
/** True when the answer carries a time, place, quoted speech, a mid-sentence name, or a digit. */
export function hasIdentifyingDetail(text: string): boolean {
  if (IDENT.test(text)) return true;
  const words = text.trim().split(/\s+/).slice(1); // a name past the first word
  return words.some((w) => /^[A-Z][a-z]{2,}$/.test(w.replace(/[^\p{L}]/gu, "")) && !/^(I|I'm|I'll)$/.test(w));
}

// ---- 4 (addendum). Hard-to-read single answers: the owner let someone down or hurt someone ----------------------------------
const HARD = /\b(let\s+(?:me|us|them|him|her|someone)\s+down|let\s+down|hurt\s+(?:me|us|them|him|her|someone)|snapped|shouted|yelled|ignored|forgot|cancel(?:l)?ed|walked\s+out|left\s+me|dismissed|interrupted|embarrass\w*|disappoint\w*|upset\s+(?:me|us|them|him|her)|made\s+(?:me|us|them|him|her)\s+(?:cry|feel))\b/i;
export const isHardToRead = (text: string): boolean => HARD.test(text);
import { isHarshSelfStatement } from "./harsh_self.ts";
export { isHarshSelfStatement };

// ---- 1e. flood limits and report ----------------------------------------------------------------------------------------------
/** One answer per device per ask: the first stays, later ones from the same device are dropped. No device = no limit applied. */
export function oneAnswerPerDevice(answers: Answer[]): Answer[] {
  const seen = new Set<string>();
  return answers.filter((a) => { if (!a.device) return true; if (seen.has(a.device)) return false; seen.add(a.device); return true; });
}
/** Report (1j): drops every answer from that device on that ask. The owner is told nothing about who. */
export const reportDevice = (answers: Answer[], device: string): Answer[] => answers.filter((a) => a.device !== device);
export function linkOpen(o: { createdAt: number; now: number; closedByOwner?: boolean }): boolean {
  return !o.closedByOwner && o.now - o.createdAt < LINK_DAYS * 86400_000;
}

// ---- folds and merges -------------------------------------------------------------------------------------------------------
/** (a) An answer matching a confirmed kenning folds in as an endorsement on it; it makes no card. */
export function foldIntoConfirmed(answers: Answer[], confirmed: Kenning[]): { folded: Map<string, string[]>; rest: Answer[] } {
  const folded = new Map<string, string[]>(), rest: Answer[] = [];
  const ks = confirmed.map((k) => ({ id: k.id, t: tokens(k.wording) }));
  for (const a of answers) {
    const t = tokens(a.text);
    let best: { id: string; s: number } | null = null;
    if (t.size >= MIN_TOKENS) for (const k of ks) { const s = overlap(t, k.t); if (s >= FOLD_AT && (!best || s > best.s)) best = { id: k.id, s }; }
    if (best) folded.set(best.id, [...(folded.get(best.id) ?? []), a.id]); else rest.push(a);
  }
  return { folded, rest };
}

/** (b) Overlapping answers merge into one group (single linkage). */
export function mergeOverlapping(answers: Answer[]): Answer[][] {
  const usable = answers.filter((a) => tokens(a.text).size >= MIN_TOKENS);
  const t = usable.map((a) => tokens(a.text)), parent = usable.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) if (overlap(t[i], t[j]) >= MERGE_AT) parent[find(j)] = find(i);
  const groups = new Map<number, Answer[]>();
  usable.forEach((a, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), a]));
  return [...groups.values()];
}

// ---- wording (PSY 2c, 3b; merged wording pending Nami, this is the default) ----------------------------------------------------
export const MERGED_LINE = "This came up in more than one answer.";
export const SINGLE_LEAD = "Someone noticed:";
/** Ask me strings as constants, byte for byte from docs/design/app-v3/KM-WORDS-CPO-14nov.md (KM-W6, KM-W8) and PSY-CGO-14nov.md. PENDING NAMI entries use the PSY wording.
 *  The CPO's 03:45Z `spec_cpo_ask_me` text is on HQ only and not on disk: see Q-ENG-ASKME-3; nothing below is guessed from it. */
export const ASK_ME_STRINGS = {
  merged_line: MERGED_LINE,                                   // PENDING NAMI: PSY wording
  single_lead: SINGLE_LEAD,
  endorsement_mark: (n: number) => `Came up in ${n} answers`, // PENDING NAMI: PSY 3b
  share_instruction: "Your link is copied. In Instagram, tap the sticker button, choose Link, then paste.",  // KM-W6
  share_copy_link: "Copy link", share_open_instagram: "Open Instagram",
  share_no_instagram: "Instagram isn't on this phone. Save the card instead?", share_save_image: "Save image",
  card_preset: "ask me",                                      // KM-W8
  card_question_example: "What's something you've seen me do when I'm stressed?",
  card_call_line: "Make yours on Kenember",
  // CPO spec_cpo_ask_me (HQ d-cpo-kenning-map-14nov, 14 Nov 03:45Z), byte for byte from
  // docs/design/app-v3/CPO-ASKME-STRINGS-14nov.md. [Name] is the owner's first name, filled in by the caller.
  // X2 friend's answer page (web)
  x2_above_box: "No name is asked for. [Name] gets a short card in Kenember's words, never yours. [Name] may still guess who was there.",
  x2_placeholder: "Describe a time it happened.",
  x2_tick: "OK for [Name] to share what they take from this, in their own words.",
  x2_send: "Send", x2_not_now: "Not now",
  x2_adults: "For adults, 18 and over.",
  x2_nudge: "Could you describe a time it happened?", x2_nudge_edit: "Edit", x2_nudge_send_anyway: "Send anyway",
  x2_after_send: "Thanks. Sent.",
  x2_already_answered: "You've already answered this one.",
  x2_link_closed: "This question is closed.",
  x2_owner_in_danger: "If [Name] is in danger now, call your local emergency number.",
  // Y6 owner's Mirror ask
  y6_honest_line: "Not every answer becomes a card.",
  y6_close: "Close this question",
  notification: "New in Mirror",
  // Y7/Y8 arrival
  arrival_later: "Later", arrival_open: "Open",
  card_fits: "Fits", card_not_sure: "Not sure", card_not_me: "Not me", card_report: "Report",
  // endorsement mark switch (PENDING NAMI, PSY wording until cpo-2026-11-14-law12)
  marks_switch: "Show answer marks",
} as const;
/** A count of 1 is never shown; below 2 there is no mark. Never on a harsh self-statement; the person can turn it off. */
export function endorsementMark(n: number, o: { kenningWording: string; markOff?: boolean }): string | null {
  if (n < 2 || o.markOff || isHarshSelfStatement(o.kenningWording)) return null;
  return ASK_ME_STRINGS.endorsement_mark(n);
}

// ---- the build ---------------------------------------------------------------------------------------------------------------------
export interface BuildOpts {
  /** 2b: no card until three answers have arrived, or the link has closed. */
  linkClosed?: boolean;
  /** Addendum 4: hold hard-to-read single answers until a second overlaps. Switch, ON until Nami chooses. */
  holdHardSingles?: boolean;
  /** 1i: themes the owner marked 'Not me' for this ask; never brought back. Answers are tokenised wordings of the declined card. */
  declined?: string[];
  /** PSY 14 Nov (2): "moment without the rest" step for flagged answers. Returns what the person did or said with the sensitive detail left out, or null
   *  to drop. Absent = flagged answers are dropped whole. The result is screened again and must come back "ok". */
  momentOnly?: (text: string) => string | null;
  /** QA-B336: ids of answers the one safety entry stopped (semantic reading, or no reading available: fail closed). Same stop as the floor's. */
  semanticStopped?: ReadonlySet<string>;
  /** PSY 14 Nov (1): the model step's result (ask_me_step.ts runAskMeStep), answer id -> the moment only, or null. When given, it decides
   *  every answer the floor let through ("ok" and "flagged"): a missing or null entry drops the answer, a moment replaces its text and must
   *  screen "ok" again. The floor still stops and drops first; the step can only drop more. momentOnly is then not used. */
  moments?: Map<string, string | null>;
}

/** QA-B336: the one safety entry for every Ask me answer, before buildCards. Returns the ids to stop; an unavailable reading stops its
 *  answer (fail closed). With the switch off (`semantic: false`) it is the floor only, which buildCards already applies, so it returns none. */
export async function semanticStops(client: ModelClient | null, answers: Pick<Answer, "id" | "text">[], semantic: boolean): Promise<Set<string>> {
  const out = new Set<string>();
  if (!semantic) return out;
  const rs = await safetyEntries(client, answers.map((a) => a.text), { semantic: true });
  rs.forEach((r, i) => { if (r.stop) out.add(answers[i].id); });
  return out;
}
export interface BuildResult {
  cards: AskCard[];
  folds: { kenning_id: string; count: number; answer_ids: string[] }[];
  stopped: string[]; // answer ids that hit the safety stop: nothing stored, resources shown to the writer (route not built)
  waiting: boolean; // 2b: fewer than three answers and the link is open
}

export function buildCards(answers: Answer[], confirmed: Kenning[], opts: BuildOpts = {}): BuildResult {
  const hold = opts.holdHardSingles ?? true;
  const stopped: string[] = [];
  const passed: Answer[] = [];
  for (const a of oneAnswerPerDevice(answers)) {
    const s = screenAnswer(a.text);
    if (s.verdict === "risk_stop" || opts.semanticStopped?.has(a.id)) stopped.push(a.id);
    else if (opts.moments) {
      if (s.verdict !== "ok" && s.verdict !== "flagged") continue;
      const m = opts.moments.get(a.id);
      if (m && screenAnswer(m).verdict === "ok") passed.push({ ...a, text: m });
    }
    else if (s.verdict === "ok") passed.push(a);
    else if (s.verdict === "flagged" && opts.momentOnly) {
      const m = opts.momentOnly(a.text);
      if (m && screenAnswer(m).verdict === "ok") passed.push({ ...a, text: m });
    }
  }
  const arrived = oneAnswerPerDevice(answers).length; // 2b counts answers that arrived, not those that passed
  if (arrived < MIN_ANSWERS_BEFORE_CARDS && !opts.linkClosed) return { cards: [], folds: [], stopped, waiting: true };
  const declined = (opts.declined ?? []).map(tokens);
  const live = passed.filter((a) => { const t = tokens(a.text); return !declined.some((d) => overlap(t, d) >= MERGE_AT); });
  const { folded, rest } = foldIntoConfirmed(live, confirmed);
  const folds = [...folded].map(([kenning_id, ids]) => ({ kenning_id, count: ids.length, answer_ids: ids }));
  const cards: AskCard[] = [];
  for (const g of mergeOverlapping(rest)) {
    if (g.length >= 2) { cards.push({ answer_ids: g.map((a) => a.id), count: g.length, basis: "merged" }); continue; }
    const a = g[0];
    if (hasIdentifyingDetail(a.text) || (hold && isHardToRead(a.text))) continue; // waits for a second answer; dropped if none (link closed)
    cards.push({ answer_ids: [a.id], count: 1, basis: "single" });
  }
  return { cards, folds, stopped, waiting: false };
}

/** Mixed order with no times: a stable order keyed on a hash of the ids, never arrival order. */
export function mixOrder<T extends { answer_ids: string[] }>(cards: T[]): T[] {
  const h = (s: string) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
  return [...cards].sort((p, q) => h(p.answer_ids.join("|")) - h(q.answer_ids.join("|")));
}

/** The only shape toward the owner: no answer ids, no count, no time, no text from any answer. The sentence is the engine's, added later. */
export const toOwner = (c: AskCard): OwnerCard => c.basis === "merged" ? { kind: "merged", lead: MERGED_LINE } : { kind: "single", lead: SINGLE_LEAD };

/** At most three new cards per opening; the rest wait. */
export const OPENING_MAX = 3;
