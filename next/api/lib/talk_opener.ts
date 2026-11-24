// Contract v1.54 (app Q-V25-ON4): the onboarding / invite opener for POST /talk/turn.
// Text is empty and `source` is "onboarding" or "invite": the reply is one opening question, built from a fixed set of
// wordings. No model call, no listener call, no conversation and no message row (so nothing to extract, law 1/2), and no
// person words to read, so the safety floor has nothing to act on; any non-empty text takes the ordinary path with its floor.
// One moment, never why, never childhood (CPO).
import { ApiError } from "./errors.ts";

export const OPENER_SOURCES = ["onboarding", "invite"] as const;
export const OPENER_RELATIONSHIPS = ["partner", "friend", "family", "coworker", "other"] as const;
export type OpenerSource = typeof OPENER_SOURCES[number];
export const MAX_NAME = 40;

export interface OpenerAbout { name: string; relationship: string | null }

export function isOpenerRequest(b: Record<string, unknown>): boolean {
  const empty = b.text === undefined || b.text === null || (typeof b.text === "string" && b.text.trim() === "");
  return empty && (OPENER_SOURCES as readonly string[]).includes(b.source as string);
}

/** `about` is optional; when present `name` is required text (control characters stripped, at most 40) and relationship one of the five. */
export function readAbout(raw: unknown): OpenerAbout | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ApiError("invalid", "", { field: "about" });
  const a = raw as Record<string, unknown>;
  // deno-lint-ignore no-control-regex
  const name = typeof a.name === "string" ? a.name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > MAX_NAME) throw new ApiError("invalid", "", { field: "about.name", max: MAX_NAME });
  let relationship: string | null = null;
  if (a.relationship !== undefined && a.relationship !== null) {
    if (!(OPENER_RELATIONSHIPS as readonly string[]).includes(a.relationship as string)) throw new ApiError("invalid", "", { field: "about.relationship" });
    relationship = a.relationship as string;
  }
  return { name, relationship };
}

/** The one question. Describes nothing, rates nothing, asks for one recent moment. */
export function openerQuestion(source: OpenerSource, about: OpenerAbout | null): string {
  if (!about) {
    return source === "invite"
      ? "What's one moment from this week that's still with you?"
      : "What's one moment from today that's still with you?";
  }
  const n = about.name;
  switch (about.relationship) {
    case "partner": return `What's one recent moment between you and ${n} that stayed with you?`;
    case "family": return `What's one recent moment with ${n} that stayed with you?`;
    case "coworker": return `What's one recent moment with ${n} at work that stayed with you?`;
    case "friend": return `What's one recent moment with ${n} that stayed with you?`;
    default: return `What's one recent moment with ${n} that stayed with you?`;
  }
}

/** The reply body. `conversation` and `message` are null: nothing was stored. */
export function openerBody(source: OpenerSource, about: OpenerAbout | null) {
  return {
    conversation: null,
    message: null,
    opener: true,
    reply: {
      message_id: null, turn: 0, state: "turn", reflection: "", question: openerQuestion(source, about),
      move: { kind: "open" }, consent: null, cards: [], early_guess: null, feeling: null, safety: null, ref: null,
    },
    latency_ms: 0,
  };
}
