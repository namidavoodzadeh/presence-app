// Mirror (thesis v3 "Mirror"; APP-V1-BUILD §5 item 9): a contributor's moment becomes a de-identified observation, observations
// converge on a theme, the gate decides, the synthesis writes the card. Raw moment text never survives processing.

import type { BeliefType, Domain } from "../types.ts";

export const HOW_KNOWN = ["partner", "friend", "family", "coworker", "other"] as const;
export type HowKnown = typeof HOW_KNOWN[number];

export interface Observation {
  situation: string;
  behaviour: string;
  reaction: string;
  guess: string | null;       // the contributor's own reading, kept separate and weighted low
  domains: Domain[];
}

export interface Theme {
  key: string | null;         // an open theme's key, or null for a new one
  label: string;
  statement: string;
  type: BeliefType;
  confidence: number;
}

export interface MapMatch { beliefId: string; relation: "supports" | "contradicts"; confidence: number }

export interface Observed {
  kind: "moment" | "label" | "unclear";
  safety: { level: "none" | "concern" | "abuse"; reason: string };
  observation: Observation | null;
  theme: Theme | null;
  map: MapMatch | null;
}

/** One processed contribution as the gate sees it (no raw text). */
export interface GateInput {
  id: string;
  contributorKey: string;
  weight: number;
  themeKey: string | null;
  themeConfidence: number;
  observation: Observation;
  mapBeliefId: string | null;
  mapRelation: "supports" | "contradicts" | null;
  mapConfidence: number;
}

export interface GateDecision {
  variant: "new" | "support" | "tension";
  themeKey: string | null;    // for new
  beliefId: string | null;    // for support and tension: the belief on the map
  contributionIds: string[];
  people: number;
  moments: number;
  confidence: number;
}

export interface Synthesis {
  label: string;
  statement: string;
  type: BeliefType;
  domains: Domain[];
  summary: string;
}
