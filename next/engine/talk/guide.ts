// Private, deferred Talk guide (talk-listener-guide.md §2). It produces only a bounded hint;
// the listener does not read it until K-0062 wires that separate owner-only path.
import { extractJson, type ModelClient } from "../model/client.ts";
import { TALK_GUIDE } from "../prompt_text.ts";
import { cardWordHits, clinicalHits } from "../words.ts";
import type { ModelExchange } from "../types.ts";
import type { GuideGap } from "./gaps.ts";

export const GUIDE_MODEL = "claude-haiku-5-5";
export const GUIDE_MAX_TOKENS = 240;
export interface GuideBrief { thread: string; gap: { kind: GuideGap["kind"]; angle: string } | null; avoid: string[]; why: string }
export interface GuideInput {
  map: unknown[]; commItems: unknown[]; sessionTurns: Array<{ role: "person" | "listener"; text: string }>;
  lastSession: { summary: string | null; nextTime: string | null } | null;
  gaps: readonly GuideGap[]; comfort: "ok" | "easing" | "follow_only"; priorAvoid?: readonly string[];
}
export interface GuideTrace { brief: GuideBrief | null; exchange: ModelExchange; reason: string | null }

const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text || text.length > max || cardWordHits(text).length || clinicalHits(text).length) return null;
  return text;
};

/** A cross-session avoid is a guide-written topic, never the person's declined sentence. */
export function guideAvoidTopics(values: readonly string[]): string[] {
  return values.filter((value) => value.trim().split(/\s+/).length <= 6 && clean(value, 80) !== null);
}

/** Parse strictly: a malformed or disallowed private hint is dropped whole. */
export function readGuideBrief(value: unknown, offered: readonly GuideGap[], comfort: GuideInput["comfort"]): { brief: GuideBrief | null; reason: string | null } {
  if (!value || typeof value !== "object") return { brief: null, reason: "not_an_object" };
  const raw = value as Record<string, unknown>;
  const thread = clean(raw.thread, 180);
  const why = clean(raw.why, 300);
  const avoid = Array.isArray(raw.avoid) && raw.avoid.length <= 8
    ? raw.avoid.map((x) => clean(x, 80)).filter((x): x is string => !!x) : null;
  if (!thread || thread.split(/\s+/).length > 15 || !why || !avoid || avoid.length !== (Array.isArray(raw.avoid) ? raw.avoid.length : -1)) return { brief: null, reason: "text_limits_or_banned_words" };
  if (raw.gap === null) return { brief: { thread, gap: null, avoid, why }, reason: null };
  if (!raw.gap || typeof raw.gap !== "object" || comfort !== "ok") return { brief: null, reason: "gap_not_permitted" };
  const gap = raw.gap as Record<string, unknown>;
  const kind = typeof gap.kind === "string" ? gap.kind : "";
  const angle = clean(gap.angle, 180);
  if (!angle || angle.includes("?") || !offered.some((g) => g.kind === kind)) return { brief: null, reason: "gap_not_offered_or_invalid" };
  return { brief: { thread, gap: { kind: kind as GuideGap["kind"], angle }, avoid, why }, reason: null };
}

export function guidePackage(input: GuideInput): string {
  return JSON.stringify({ confirmed_map: input.map, communication_items: input.commItems, this_session: input.sessionTurns,
    last_session: input.lastSession, offered_gaps: input.gaps, comfort: input.comfort, avoid_from_prior_sessions: input.priorAvoid ?? [] });
}

export async function guideBrief(client: ModelClient, input: GuideInput): Promise<GuideTrace> {
  const exchange = await client.complete({ purpose: "talk_guide", model: GUIDE_MODEL, thinking: "disabled", system: TALK_GUIDE,
    messages: [{ role: "user", content: guidePackage(input) }], maxTokens: GUIDE_MAX_TOKENS });
  if (exchange.error || !exchange.rawResponse) return { brief: null, exchange, reason: exchange.error ?? "empty_response" };
  try {
    const checked = readGuideBrief(extractJson(exchange.rawResponse), input.gaps, input.comfort);
    return { ...checked, exchange };
  } catch { return { brief: null, exchange, reason: "invalid_json" }; }
}
