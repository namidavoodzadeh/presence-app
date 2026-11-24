// Talk coverage director (CPO spec d-coo-talk-coverage-05nov, item 1-4; thesis "Blueprint and director," PRODUCT_THESIS.md §Main
// flows). Code, not the model, scores which of the eight areas (CONTRACT §1.3) has the thinnest rated evidence, and hands the
// writer nothing but a plain area word: never the word coverage, gap, import, guess or an AI's name (spec item 5).

import type { Belief, Domain, Level } from "../types.ts";
import { FOUNDATION_SLOTS, type FoundationLens, lensForArea, lensForDomain } from "../../api/lib/map.ts";

export const AREAS = ["relationships", "work", "body", "money", "meaning", "family", "politics", "morality"] as const;
export type Area = typeof AREAS[number];

const AREA_FOR_DOMAIN: Partial<Record<Domain, Area>> = {
  close_relationships: "relationships",
  work: "work",
  body_health: "body",
  money: "money",
  meaning: "meaning",
  family: "family",
  politics: "politics",
  society: "politics",
  morality: "morality",
};

/** CONTRACT §1.3: `self` beside another domain takes the other's area; `self` alone folds to `meaning`. */
export function areaFor(domains: readonly Domain[]): Area {
  for (const d of domains) {
    const a = AREA_FOR_DOMAIN[d];
    if (a) return a;
  }
  return "meaning";
}

export type CoverageBucket = "empty" | "thin" | "no_core" | "foundation_gap" | "covered";

export interface AreaCoverage {
  area: Area;
  ratedCount: number;
  hasL0: boolean;
  foundationGap: boolean;
  bucket: CoverageBucket;
}

function bucketFor(ratedCount: number, hasL0: boolean, foundationGap: boolean): CoverageBucket {
  if (ratedCount === 0) return "empty";
  if (ratedCount <= 2) return "thin";
  if (!hasL0) return "no_core";
  if (foundationGap) return "foundation_gap";
  return "covered";
}

/** The 12 Foundation slots (docs/design/foundation-slots-20261105.md §1) grouped by the level their own
 *  belief type carries: "my main rule"/"my main strategy"/"my typical reaction" are L1/L2/L4; the other nine
 *  (worth, competence, lovability, control, safety, reliability, intentions, fairness, future) are all L0. */
const LEVEL_FOR_SLOT: Record<string, Level> = {
  worth: "L0", competence: "L0", lovability: "L0", control: "L0",
  safety: "L0", reliability: "L0", intentions: "L0",
  fairness: "L0", future: "L0",
  rules: "L1", coping: "L2", reactions: "L4",
};

export interface FoundationSlotCoverage {
  id: string;
  lens: FoundationLens;
  filled: boolean;
}

/** docs/design/foundation-slots-20261105.md §2: "no new field", so a slot's fill state is read off RATED beliefs
 *  (law 3) whose level matches the slot and whose domain's lens (`lensForDomain`) matches the slot's lens. Several
 *  slots share a (level, lens) pair (the four "me" L0 slots, for instance), so one rated belief can fill more than
 *  one slot at a time; that is the deliberate, documented simplification until a slot gets its own field. */
export function foundationCoverage(beliefs: readonly Belief[]): FoundationSlotCoverage[] {
  return FOUNDATION_SLOTS.map((slot) => {
    const level = LEVEL_FOR_SLOT[slot.id];
    const filled = beliefs.some((b) =>
      (b.status === "endorsed" || b.status === "disputed") &&
      b.level === level &&
      b.domains.some((d) => lensForDomain(d) === slot.lens)
    );
    return { id: slot.id, lens: slot.lens, filled };
  });
}

/** Spec item 4: an area whose lens still has an empty foundation slot is not done, even once it has an L0 core. */
function areaHasEmptyFoundationSlot(area: Area, slots: readonly FoundationSlotCoverage[]): boolean {
  const lens = lensForArea(area);
  return slots.some((s) => s.lens === lens && !s.filled);
}

/** Coverage counts only RATED beliefs (spec item 1: "waiting guesses never count"). A belief the person has not yet
 *  rated — inferred, still in the tray, still a waiting import guess — can never make an area look covered. */
export function areaCoverage(beliefs: readonly Belief[]): AreaCoverage[] {
  const slots = foundationCoverage(beliefs);
  return AREAS.map((area) => {
    const rated = beliefs.filter((b) =>
      (b.status === "endorsed" || b.status === "disputed") && areaFor(b.domains) === area
    );
    const hasL0 = rated.some((b) => b.level === "L0");
    const foundationGap = areaHasEmptyFoundationSlot(area, slots);
    return { area, ratedCount: rated.length, hasL0, foundationGap, bucket: bucketFor(rated.length, hasL0, foundationGap) };
  });
}

const BUCKET_RANK: Record<CoverageBucket, number> = { empty: 0, thin: 1, no_core: 2, foundation_gap: 3, covered: 4 };
const LENS_RANK: Record<FoundationLens, number> = { me: 0, others: 1, world: 2 };

/** Gap order (spec items 1 and 4): an area with zero rated beliefs leads, then one with one or two, then one with
 *  three or more but no L0 core, then one whose foundation slots still have a gap (me and others lenses first); a
 *  fully covered area never leads and is left off the end. */
export function gapOrder(coverage: readonly AreaCoverage[]): Area[] {
  return [...coverage]
    .filter((c) => c.bucket !== "covered")
    .sort((a, b) => {
      const rank = BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
      if (rank !== 0) return rank;
      if (a.bucket !== "foundation_gap") return 0;
      return LENS_RANK[lensForArea(a.area)] - LENS_RANK[lensForArea(b.area)];
    })
    .map((c) => c.area);
}

export type TurnKind = "opener" | "natural" | "mid_thread";

export interface CoverageTargetInput {
  turnKind: TurnKind;
  /** The session is carrying something heavy right now (spec item 2: heavy load turns coverage off). */
  heavyLoad: boolean;
  /** The area the person is already talking about; it always wins over a coverage pick. */
  ownTopicArea?: Area | null;
  beliefs: readonly Belief[];
}

/** Spec item 2: the coverage term only speaks at the session opener and natural turns; mid-thread, relevance and
 *  cost win instead; the person's own topic always wins over a coverage pick; heavy load turns coverage off entirely. */
export function coverageTarget(input: CoverageTargetInput): Area | null {
  if (input.heavyLoad) return null;
  if (input.ownTopicArea) return input.ownTopicArea;
  if (input.turnKind === "mid_thread") return null;
  return gapOrder(areaCoverage(input.beliefs))[0] ?? null;
}

/** Spec item 3: a gap opener into body never reaches past routines, energy, rest or movement. */
export const BODY_GAP_TOPICS = ["routines", "energy", "rest", "movement"] as const;

/** The only thing the writer is told about a coverage target (spec item 5: "the writer gets only target, move, load
 *  and the last two turns"): a plain area word, never the word coverage, gap, import, guess or an AI's name. */
export function writerTargetLine(area: Area | null): string {
  return area ? `Target area: ${area}` : "";
}

const BANNED_WRITER_WORDS = ["import", "guess", "your ai", "an ai", "gap"];

/** Spec item 5: whatever the writer is handed must never name the mechanism behind a coverage pick. */
export function writerInputLeaksMechanism(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_WRITER_WORDS.some((w) => lower.includes(w));
}
