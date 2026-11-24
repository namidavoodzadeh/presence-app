// "Send mine, with insight" (BRIDGE-INSIGHT §2–3): built from the same analysis as the rewrite path, no extra call.
// Spans are character offsets into the draft; a span that does not match is rejected by the guard.

import type { Belief } from "../types.ts";
import { RESOURCES } from "../safety.ts";
import { DECLINE_LINE } from "./plan.ts";
import { INSIGHT_COPY_JSON } from "../prompt_text.ts";
import type {
  Analysis,
  BridgeSafety,
  FlaggedSpan,
  FrictionKind,
  InsightFriction,
  InsightResult,
} from "./types.ts";

/** Harm aimed at the receiver: the keyword floor's threat, located so S15b can underline it before any call. */
export const AIMED_AT_RECEIVER =
  /\b(?:(?:i|we)(?:'m|'re|'ll| am| are| will)?\s+(?:(?:going|gonna|about|ready)\s+to\s+|will\s+|'ll\s+)?)?(?:kill|hurt|harm|shoot|stab|strangle|hit|beat|punch|slap|choke|attack)(?:s|ed|ing)?\s+(?:you|your)\b[^.!?]*/i;

/**
 * The parts of a message that make Bridge refuse it (S15b, CPO 16:00 10-27): the model's exact threat/abuse quotes and the floor's own
 * match, as character spans with kind threat | abuse, merged where they overlap, in text order. Insults are not here: they are bridged.
 */
export function flaggedSpans(
  text: string,
  analysis: Analysis | null,
  floor: { routed: BridgeSafety } | null,
): FlaggedSpan[] {
  const raw: FlaggedSpan[] = [];
  for (const q of analysis?.safetyQuotes ?? []) {
    const s = locate(text, q.quote);
    if (s) raw.push({ ...s, kind: q.kind });
  }
  if (floor?.routed === "threat_or_abuse") {
    const m = AIMED_AT_RECEIVER.exec(text);
    if (m) raw.push({ start: m.index, end: m.index + m[0].trimEnd().length, kind: "threat" });
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: FlaggedSpan[] = [];
  for (const s of raw) {
    const last = out.at(-1);
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      if (s.kind === "threat") last.kind = "threat";
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/** S15b counts per kind (CDO 16:23 10-27): the app picks its headline from these; the engine's own headline is the fallback. */
export function refusalCounts(spans: FlaggedSpan[]): { threat: number; abuse: number } {
  const threat = spans.filter((s) => s.kind === "threat").length;
  return { threat, abuse: spans.length - threat };
}

/**
 * S15b headline, the CDO's final copy (16:23 10-27): one part reads as threatening / abusive; two parts of one kind "Two parts read as
 * threatening." / "...abusive."; both kinds, or three or more of one kind, "Parts of this read as threatening[ and abusive]."; null
 * when no part could be located. The app follows it with "Bridge won't reword or send it."
 */
export function refusalHeadline(spans: FlaggedSpan[]): string | null {
  const { threat, abuse } = refusalCounts(spans);
  if (spans.length === 0) return null;
  if (threat && abuse) return "Parts of this read as threatening and abusive.";
  const word = threat ? "threatening" : "abusive";
  if (spans.length === 1) return `One part reads as ${word}.`;
  if (spans.length === 2) return `Two parts read as ${word}.`;
  return `Parts of this read as ${word}.`;
}

/** spans, headline and counts together, for every reply that refuses a text (S15b). */
export function refusal(
  spans: FlaggedSpan[],
): { spans: FlaggedSpan[]; headline: string | null; counts: { threat: number; abuse: number } } {
  return { spans, headline: refusalHeadline(spans), counts: refusalCounts(spans) };
}

export const INSIGHT_COPY: Record<FrictionKind, string> = (() => {
  const raw = JSON.parse(INSIGHT_COPY_JSON) as Record<string, string>;
  const { _note: _, ...lines } = raw;
  return lines as Record<FrictionKind, string>;
})();

/** Find the quote in the draft: raw first, then case-insensitive, then with whitespace runs folded. Null if absent. */
export function locate(draft: string, quote: string): { start: number; end: number } | null {
  let at = draft.indexOf(quote);
  if (at < 0) at = draft.toLowerCase().indexOf(quote.toLowerCase());
  if (at >= 0) return { start: at, end: at + quote.length };
  const re = new RegExp(
    quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"),
    "i",
  );
  const m = re.exec(draft);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export function buildInsight(
  draft: string,
  analysis: Analysis | null,
  beliefs: Belief[],
  safety: BridgeSafety,
): InsightResult {
  const empty: InsightResult = {
    state: "insight",
    points: [],
    frictions: [],
    touches: [],
    safety,
    line: null,
    resources: null,
  };
  if (safety === "risk") return { ...empty, state: "risk", line: RESOURCES.message, resources: RESOURCES };
  if (safety === "threat_or_abuse") return { ...empty, state: "declined", line: DECLINE_LINE };
  if (!analysis) return empty;
  const frictions: InsightFriction[] = [];
  for (const f of analysis.frictions) {
    const span = locate(draft, f.quote);
    if (!span) continue; // the guard: no span, no highlight
    frictions.push({
      kind: f.kind,
      quote: draft.slice(span.start, span.end),
      start: span.start,
      end: span.end,
      howItLands: INSIGHT_COPY[f.kind],
    });
  }
  // Card C (E26 P0 06 Nov, CEO: beliefs Nami rated Very me/Partly, including imported "From your AI" ones, count as
  // confirmed): a touch needs status "endorsed", the person's own rating (law 3), nothing more. The earlier extra
  // `confidence >= 0.7` gate (CPO d-cpo-bridge-insight-spec-06nov) was law 9's live-conversation screen threshold,
  // wrongly re-applied to beliefs already confirmed; it silently dropped every rated import, whose engine-assigned
  // confidence never reaches 0.7 (importConfidence caps at 0.5) regardless of the person's own rating. At most 2,
  // in the model's activation order (its own relevance ranking).
  const endorsed = new Map(beliefs.filter((b) => b.status === "endorsed").map((b) => [b.id, b]));
  const touches = analysis.activated.map((a) => endorsed.get(a.beliefId)).filter((b): b is Belief => !!b)
    .slice(0, 2).map((b) => ({ beliefId: b.id, label: b.label, gentleStatement: b.statement }));
  // No friction found: a calm line, never a blank "what might get in the way" (E26 P0 item 4). The softer Bridged
  // version stays one tap away (POST /bridge/run), never sent here and never auto-applied.
  const line = frictions.length === 0 ? NOTHING_IN_THE_WAY : null;
  return { ...empty, points: analysis.points.slice(0, 3), frictions, touches, line };
}

export const NOTHING_IN_THE_WAY = "Nothing here is likely to get in the way";
