// V3 communication model, spec 4.2: the Talk planner's deterministic core. PSY's question bank (section 3 of the model) and the rules for which
// question comes next. No AI here: the model call (a later step) phrases the question from `Plan.bank` and the recent moment the person told;
// this module decides the kind, the order and what may not be asked, so the rule is testable for $0 and the model cannot reorder it.
import type { CommKind } from "./comm.ts";
import { talkQuestionProblems } from "./comm_checks.ts";

export interface BankEntry { kind: CommKind; open: string; follow?: string }
/** PSY's bank (one question per opener; see the care entry). `[Name]` is the other person's first name, never a pronoun; the planner leaves it out when no one is named. */
export const QUESTION_BANK: readonly BankEntry[] = [
  { kind: "how_i_mean", open: "When you go quiet with someone close, what's usually going on for you?", follow: "Is there something you do that people often read wrong?" },
  // PSY's text is "…even in a small way? What did they do?" (two questions); the planner asks the first and keeps the second as the follow-up (Q-ENG-COMM-BANK-1).
  { kind: "feels_like_care", open: "When did you last feel looked after, even in a small way?", follow: "What did they do?" },
  { kind: "bring_up", open: "Think of a time someone raised something hard with you and it went OK. How did they start?", follow: "Is there a way or a place that never works for you?" },
  { kind: "gets_heated", open: "When a talk with someone close gets tense, what do you need more: to keep going, or a pause?", follow: "What do you usually do in that moment?" },
  { kind: "coming_back", open: "After a hard moment with someone close, what helps you feel OK again?" },
  // Never an opener: offered only inside a moment the person tells (the planner marks it `afterMoment`).
  { kind: "lands_hard", open: "Is there a word or tone that makes you stop listening?" },
  { kind: "matters", open: "What's important to you about this?", follow: "What would it mean if that got ignored?" },
  { kind: "this_week", open: "Anything going on this week that the people close to you should know?" },
];

/** The order a first session walks the kinds, per way in (PSY table). Four turns, ends on care; the heated, coming-back and lands-hard kinds wait for session 2. */
export type WayIn = "invited_by_partner" | "invited_by_friend" | "own_download";
export const FIRST_SESSION: Record<WayIn, readonly CommKind[]> = {
  invited_by_partner: ["how_i_mean", "bring_up", "this_week", "feels_like_care"],
  invited_by_friend: ["how_i_mean", "bring_up", "feels_like_care"],       // the friend's one item came first; "Never on the heated kinds"
  own_download: ["how_i_mean", "bring_up", "feels_like_care"],              // H3 "Who's on your mind?" first, then Write with that person
};
/** The kind order after session 1: the easy, useful kinds first, then the sore ones only when the person raises them or from session 2. */
export const LATER_ORDER: readonly CommKind[] = ["how_i_mean", "feels_like_care", "bring_up", "gets_heated", "coming_back", "matters", "this_week"];

export interface PlanInput {
  sessionNumber: number;
  wayIn: WayIn;
  /** Turns already taken in this session (0-based count of questions asked). */
  turnsTaken: number;
  /** Kinds that already have an active item for this person: not asked again this session. */
  haveKinds: readonly CommKind[];
  /** Kinds asked already this session. */
  askedThisSession: readonly CommKind[];
  /** A kind the person brought up themselves in their last answer (a heated moment, a hard word). */
  raisedByPerson?: CommKind;
  /** The person told a moment with a hard word or tone in it, so lands hard may be offered as a card. */
  afterMoment?: boolean;
  /** The chosen name of the other person, when the person named one. */
  name?: string;
}
export type Plan =
  | { done: true; reason: "end_on_care" | "session_budget" | "nothing_left" }
  | { done: false; kind: CommKind; question: string; followUp?: string; entry: BankEntry };

/** The first session is about four turns and ends on care, never on conflict. */
export const FIRST_SESSION_TURNS = 4;
export const LATER_SESSION_TURNS = 6;

const fill = (q: string, name?: string): string => (name ? q.replace(/someone close/g, name) : q);

export function planNextQuestion(i: PlanInput): Plan {
  const first = i.sessionNumber <= 1;
  const budget = first ? FIRST_SESSION_TURNS : LATER_SESSION_TURNS;
  if (i.turnsTaken >= budget) return { done: true, reason: first && i.askedThisSession.at(-1) === "feels_like_care" ? "end_on_care" : "session_budget" };
  const entryFor = (k: CommKind): BankEntry | undefined => QUESTION_BANK.find((b) => b.kind === k);
  const fresh = (k: CommKind): boolean => !i.askedThisSession.includes(k) && !i.haveKinds.includes(k);
  const ask = (k: CommKind): Plan | null => {
    const e = entryFor(k);
    if (!e) return null;
    const q = fill(e.open, i.name);
    // The bank itself is held to the same rules; a failing question is never returned.
    if (talkQuestionProblems(q, k, { sessionNumber: i.sessionNumber, raisedByPerson: i.raisedByPerson === k, opener: !(k === "lands_hard" && i.afterMoment) }).length) return null;
    return { done: false, kind: k, question: q, followUp: e.follow, entry: e };
  };
  // 1. What the person raised themselves comes first (a heated or hard moment they chose to tell).
  if (i.raisedByPerson && i.raisedByPerson !== "lands_hard" && fresh(i.raisedByPerson)) { const p = ask(i.raisedByPerson); if (p) return p; }
  // 2. A hard word inside a told moment: offered as a card by lands hard's question, never as an opener, never in the first session's four.
  if (i.afterMoment && !first && fresh("lands_hard")) { const p = ask("lands_hard"); if (p) return p; }
  // 3. The planned order. The last turn of the first session is care, whatever else is left.
  if (first) {
    // Every way in's list already ends on care; if the last turn arrives with care still unasked (the person raised other things), care goes first.
    const lastTurn = i.turnsTaken === FIRST_SESSION_TURNS - 1;
    const order: readonly CommKind[] = lastTurn ? ["feels_like_care", ...FIRST_SESSION[i.wayIn]] : FIRST_SESSION[i.wayIn];
    for (const k of order) if (fresh(k)) { const p = ask(k); if (p) return p; }
    return { done: true, reason: "nothing_left" };
  }
  for (const k of LATER_ORDER) if (fresh(k)) { const p = ask(k); if (p) return p; }
  return { done: true, reason: "nothing_left" };
}

/** The bank held to its own rules, for a test and for any later edit: every question and follow-up must pass the 4.2 rules. */
export function bankProblems(): string[] {
  const out: string[] = [];
  for (const e of QUESTION_BANK) {
    for (const [label, q] of [["open", e.open], ["follow", e.follow]] as const) {
      if (!q) continue;
      const p = talkQuestionProblems(q, e.kind, { sessionNumber: 9, raisedByPerson: true, opener: false });
      if (p.length) out.push(`${e.kind}.${label}: ${p.join(",")}`);
    }
  }
  return out;
}
