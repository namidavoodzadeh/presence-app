// Talk listener guide §4. Pure guard rules, kept separate from prompts and model output.
import type { GuideGap } from "./gaps.ts";

export const COMFORT_STATES = ["ok", "easing", "follow_only"] as const;
export type ComfortState = typeof COMFORT_STATES[number];

export interface ComfortTurn {
  text: string;
  /** The topic detected by the guide; this module only consumes the flag. */
  topicChanged?: boolean;
  /** The existing safety path or sensitive-content screen stopped this turn. */
  safetyOrSensitive?: boolean;
  /** A preceding explicit decline makes follow-only sticky for this session. */
  alreadyFollowOnly?: boolean;
}

export interface ComfortHistory {
  /** Person-answer character counts from at most the prior two sessions. */
  priorAnswerLengths: readonly number[];
  /** The immediately preceding answer was short against the same personal median. */
  priorWasShort?: boolean;
}

export interface ComfortResult {
  state: ComfortState;
  explicitDecline: boolean;
  deflected: boolean;
  /** Persist this topic in avoid for later sessions when it is known. */
  avoidTopic: boolean;
}

const DEFLECTION =
  /\b(?:i\s+don['’]t\s+know|rather\s+not|not\s+sure|anyway|doesn['’]t\s+matter|can\s+we\s+talk\s+about\s+something\s+else)\b/i;
const DECLINE =
  /\b(?:rather\s+not|i\s+(?:do\s+not|don['’]t)\s+want\s+to\s+(?:talk|go)\b|not\s+talk(?:ing)?\s+about\s+(?:that|this)|please\s+(?:don['’]t|do\s+not)\s+ask)\b/i;

export function median(lengths: readonly number[]): number | null {
  if (!lengths.length) return null;
  const ordered = [...lengths].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

/** Computes the state for one person turn. Safety and an explicit decline always win. */
export function comfortForTurn(turn: ComfortTurn, history: ComfortHistory): ComfortResult {
  const text = turn.text.trim();
  const explicitDecline = DECLINE.test(text);
  const deflected = DEFLECTION.test(text) || !!turn.topicChanged;
  if (turn.alreadyFollowOnly || turn.safetyOrSensitive || explicitDecline) {
    return { state: "follow_only", explicitDecline, deflected, avoidTopic: explicitDecline };
  }
  const personalMedian = median(history.priorAnswerLengths);
  const short = personalMedian !== null && text.length < personalMedian * 0.4;
  return {
    state: deflected || (short && !!history.priorWasShort) ? "easing" : "ok",
    explicitDecline: false,
    deflected,
    avoidTopic: false,
  };
}

/** No gap enters a brief unless the guide is comfortable, out of the opening, and within steer budget. */
export function gapsForGuide(input: {
  comfort: ComfortState;
  personTurn: number;
  recentSteeredTurns: readonly boolean[];
  gaps: readonly GuideGap[];
}): GuideGap[] {
  if (input.comfort !== "ok" || input.personTurn <= 2 || !canSteer(input.recentSteeredTurns)) return [];
  return [...input.gaps];
}

/** A new steered turn is allowed only when neither of the preceding two was steered. */
export function canSteer(recentSteeredTurns: readonly boolean[]): boolean {
  return !recentSteeredTurns.slice(-2).some(Boolean);
}
