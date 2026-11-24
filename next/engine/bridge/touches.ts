// E27 (2b, 2c): the belief touches on both sides of a draft, built in code from the analysis. No extra model call.
// From you: the sender's confirmed beliefs the draft comes from, each with one receipt in their own words and its date
// (law 2: no receipt, no touch). From them: the receiver's shared beliefs the wording may land on, wording only; their
// receipts are never read here, so they can never be shown (law 10).

import type { Belief } from "../types.ts";
import { words } from "../words.ts";
import { locate } from "./insight.ts";
import type { Analysis, ReceiverBelief } from "./types.ts";

export const MAX_TOUCHES = 3;

export interface FromYou { beliefId: string; label: string; wording: string; receipt: string; date: string; start: number | null; end: number | null }
export interface FromThem { beliefId: string; label: string; wording: string; why: string; start: number | null; end: number | null }
export interface BeliefTouches { fromYou: FromYou[]; fromThem: FromThem[] }

const SMALL = new Set(["i", "you", "me", "my", "the", "a", "an", "and", "or", "to", "of", "in", "on", "it", "is", "be", "that", "when", "we", "for", "with", "just", "so", "at", "do", "don't"]);

/** The receipt closest to the draft's words (most shared content words), the latest one on a tie. Deterministic. */
export function pickReceipt(belief: Belief, draft: string): Belief["receipts"][number] | null {
  if (!belief.receipts.length) return null;
  const mine = new Set(words(draft).filter((w) => !SMALL.has(w)));
  const scored = belief.receipts.map((r) => ({ r, n: words(r.quote).filter((w) => mine.has(w)).length }));
  scored.sort((a, b) => b.n - a.n || b.r.date.localeCompare(a.r.date));
  return scored[0].r;
}

/** Confirmed means the person's own say (law 3): status endorsed, which a Very me or Partly rating gives, imports included.
 *  No receipt-count or confidence floor: those were why rated imports never counted (E26, E27). */
export function beliefTouches(draft: string, analysis: Analysis, senderBeliefs: Belief[], receiverShared: ReceiverBelief[]): BeliefTouches {
  const endorsed = new Map(senderBeliefs.filter((b) => b.status === "endorsed").map((b) => [b.id, b]));
  const shared = new Map(receiverShared.map((b) => [b.id, b]));
  const fromYou: FromYou[] = [], fromThem: FromThem[] = [];
  const seen = new Set<string>();
  for (const a of analysis.activated) {
    const b = endorsed.get(a.beliefId);
    if (!b || seen.has(b.id)) continue;
    const r = pickReceipt(b, draft);
    if (!r) continue;
    seen.add(b.id);
    const span = a.quote ? locate(draft, a.quote) : null;
    fromYou.push({ beliefId: b.id, label: b.label, wording: b.statement, receipt: r.quote, date: r.date, start: span?.start ?? null, end: span?.end ?? null });
    if (fromYou.length === MAX_TOUCHES) break;
  }
  for (const a of analysis.landsOn ?? []) {
    const b = shared.get(a.beliefId);
    if (!b || seen.has(`r:${b.id}`)) continue;
    seen.add(`r:${b.id}`);
    const span = a.quote ? locate(draft, a.quote) : null;
    fromThem.push({ beliefId: b.id, label: b.label, wording: b.statement, why: a.why, start: span?.start ?? null, end: span?.end ?? null });
    if (fromThem.length === MAX_TOUCHES) break;
  }
  return { fromYou, fromThem };
}
