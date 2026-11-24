// Talk guide gap selection (Talk listener guide §3). This is deliberately data-only: the
// listener remains an open conversation and is never handed a question bank.
import { type CommKind, SENSITIVE_KINDS } from "../comm.ts";

export const GUIDE_GAP_KINDS = [
  "how_i_mean",
  "feels_like_care",
  "bring_up",
  "gets_heated",
  "coming_back",
  "matters",
] as const satisfies readonly CommKind[];
export type GuideGapKind = typeof GUIDE_GAP_KINDS[number];

const SIX_MONTHS_MS = 183 * 86_400_000;

export interface ConfirmedCommItem {
  kind: CommKind;
  /** Partly-confirmed entries remain useful, but are a quality gap. */
  rating?: "very_me" | "partly";
  /** ISO time at which the person last confirmed or edited the entry. */
  confirmedAt?: string | null;
}

export interface GapInput {
  confirmed: readonly ConfirmedCommItem[];
  /** Kinds that would have helped ground recent drafts, newest draft first. */
  recentDraftKinds?: readonly CommKind[];
  /** Areas the person explicitly declined or kept private, including prior sessions. */
  avoid?: readonly CommKind[];
  /** Kinds the person raised in this session. Sensitive kinds otherwise stay out. */
  raisedThisSession?: readonly CommKind[];
  now?: Date;
}

export interface GuideGap {
  kind: GuideGapKind;
  reason: "missing" | "partly" | "stale";
}

function isOld(at: string | null | undefined, now: Date): boolean {
  const time = at ? Date.parse(at) : Number.NaN;
  return !Number.isFinite(time) || now.getTime() - time >= SIX_MONTHS_MS;
}

/**
 * Computes only the gaps the guide is permitted to receive. Recent Bridge use is the
 * first ordering term; ties keep the quiet, predictable guide-kind order. Sensitive
 * kinds are excluded unless this session's person brought them up themselves.
 */
export function rankGuideGaps(input: GapInput): GuideGap[] {
  const now = input.now ?? new Date();
  const avoid = new Set(input.avoid ?? []);
  const raised = new Set(input.raisedThisSession ?? []);
  const bridgeRank = new Map<CommKind, number>();
  for (const [index, kind] of (input.recentDraftKinds ?? []).entries()) {
    if (!bridgeRank.has(kind)) bridgeRank.set(kind, index);
  }
  const candidates: Array<GuideGap & { bridgeRank: number; order: number }> = [];
  for (const [order, kind] of GUIDE_GAP_KINDS.entries()) {
    if (avoid.has(kind) || (SENSITIVE_KINDS.includes(kind) && !raised.has(kind))) continue;
    const items = input.confirmed.filter((item) => item.kind === kind);
    let reason: GuideGap["reason"] | null = null;
    if (!items.length) reason = "missing";
    else if (items.some((item) => item.rating === "partly")) reason = "partly";
    else if (items.some((item) => isOld(item.confirmedAt, now))) reason = "stale";
    if (reason) candidates.push({ kind, reason, bridgeRank: bridgeRank.get(kind) ?? Infinity, order });
  }
  return candidates.sort((a, b) => a.bridgeRank - b.bridgeRank || a.order - b.order)
    .map(({ kind, reason }) => ({ kind, reason }));
}
