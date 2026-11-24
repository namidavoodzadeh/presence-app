// CONTRACT §1.2–§1.4 and §2 Belief: type → kind, domains → area, the patch the map sculpture draws, and the Belief object.
// Pure functions; no database.

import type { BeliefType, Domain, Feeling, Level, Rating } from "../../engine/types.ts";

export type Kind = "foundation" | "rule" | "everyday";
export const AREAS = ["relationships", "work", "body", "money", "meaning", "family", "politics", "morality"] as const;
export type Area = typeof AREAS[number];

export const KIND_FOR_TYPE: Record<BeliefType, Kind> = {
  "something I believe is true": "foundation",
  "a rule I live by": "rule",
  "something I do to cope": "rule",
  "a view or taste": "everyday",
  "how I tend to react": "everyday",
};
export const LEVEL_FOR_TYPE: Record<BeliefType, Level> = {
  "something I believe is true": "L0", "a rule I live by": "L1", "something I do to cope": "L2", "a view or taste": "L3", "how I tend to react": "L4",
};
export const SIZE_FOR_KIND: Record<Kind, number> = { foundation: 1.5, rule: 1.0, everyday: 0.6 };
export const HEIGHT_FOR_KIND: Record<Kind, "crown" | "middle" | "lower_edge"> = { foundation: "crown", rule: "middle", everyday: "lower_edge" };
export const AREA_DIRECTION: Record<Area, number> = { relationships: 90, work: 12, body: 300, money: 242, meaning: 200, family: 150, politics: 285, morality: 175 };
export const AREA_FOR_DOMAIN: Partial<Record<Domain, Area>> = {
  close_relationships: "relationships", work: "work", body_health: "body", money: "money", meaning: "meaning", family: "family",
  politics: "politics", society: "politics", morality: "morality",
};
export const DOMAIN_FOR_AREA: Record<Area, Domain> = {
  relationships: "close_relationships", work: "work", body: "body_health", money: "money", meaning: "meaning", family: "family", politics: "politics", morality: "morality",
};
/** The topic as the consent ask names it (T08 chips, Y06 rows). */
export const CONSENT_LABEL: Record<Domain, string> = {
  self: "how you see yourself", close_relationships: "your relationships", family: "your family", work: "work", money: "money",
  society: "the wider world", politics: "politics", morality: "right and wrong", meaning: "what matters to you", body_health: "your health",
};

/** §1.3: `self` beside another domain takes the other's area; `self` alone is `meaning` (Q53 pending). */
export function areaFor(domains: readonly Domain[]): Area {
  for (const d of domains) { const a = AREA_FOR_DOMAIN[d]; if (a) return a; }
  return "meaning";
}

export function kindFor(type: BeliefType): Kind { return KIND_FOR_TYPE[type]; }

export type DbRating = "not" | "partly" | "very";
export function engineRating(r: unknown): Rating | undefined {
  return r === "very" ? "very_me" : r === "partly" ? "partly" : r === "not" ? "not_me" : undefined;
}
export function dbRating(r: Rating): DbRating { return r === "very_me" ? "very" : r === "partly" ? "partly" : "not"; }
/** `not` ⇒ set_aside; `partly`|`very` ⇒ confirmed (§1.4). */
export function statusForRating(r: DbRating): "confirmed" | "set_aside" { return r === "not" ? "set_aside" : "confirmed"; }

/** The 12 Foundation slots (docs/design/foundation-slots-20261105.md, COO Q4 1-2). Plain words, law 7. */
export const FOUNDATION_LENSES = ["me", "others", "world"] as const;
export type FoundationLens = typeof FOUNDATION_LENSES[number];

export interface FoundationSlot {
  id: string;
  lens: FoundationLens;
  label: string;
}

export const FOUNDATION_SLOTS: readonly FoundationSlot[] = [
  { id: "worth", lens: "me", label: "worth" },
  { id: "competence", lens: "me", label: "competence" },
  { id: "lovability", lens: "me", label: "lovability" },
  { id: "control", lens: "me", label: "control" },
  { id: "safety", lens: "others", label: "safety" },
  { id: "reliability", lens: "others", label: "reliability" },
  { id: "intentions", lens: "others", label: "intentions" },
  { id: "fairness", lens: "world", label: "fairness" },
  { id: "future", lens: "world", label: "future" },
  { id: "rules", lens: "me", label: "my main rule" },
  { id: "coping", lens: "me", label: "my main strategy" },
  { id: "reactions", lens: "me", label: "my typical reaction" },
] as const;

/** self → me; close relationships and family → others; the wider world → world; otherwise defaults to me. */
export const LENS_FOR_DOMAIN: Record<Domain, FoundationLens> = {
  self: "me",
  close_relationships: "others",
  family: "others",
  work: "me",
  money: "me",
  body_health: "me",
  society: "world",
  politics: "world",
  morality: "world",
  meaning: "world",
};

export function lensForDomain(domain: Domain): FoundationLens {
  return LENS_FOR_DOMAIN[domain] ?? "me";
}

export function lensForArea(area: Area): FoundationLens {
  return lensForDomain(DOMAIN_FOR_AREA[area]);
}

const OTHERS_WORDS =
  /\b(he|she|they|him|her|them|his|hers|their|theirs|mom|mum|mother|dad|father|parent|sister|brother|sibling|friend|partner|husband|wife|boyfriend|girlfriend|spouse|boss|coworker|colleague|coach|teacher|neighbou?r)\b/i;
const WORLD_WORDS = /\b(world|society|societal|everyone|everybody|the system|institutions?|humanity|people in general)\b/i;
const ME_WORDS = /\b(i|me|my|mine|myself)\b/i;

/**
 * A tested lookup over an import guess's free-text `about` label (COO Q4 2026-11-05: "no new field,
 * derive it"). Checked in this order because "my mother" names another person despite containing "my".
 */
export function lensForAbout(about: string | null | undefined): FoundationLens | null {
  const text = (about ?? "").trim();
  if (!text) return null;
  if (OTHERS_WORDS.test(text)) return "others";
  if (WORLD_WORDS.test(text)) return "world";
  if (ME_WORDS.test(text)) return "me";
  return null;
}

export interface Patch {
  kind: Kind; area: Area; direction_deg: number; height: string; size: number; mood: Feeling; pale: boolean; sheen: boolean;
}
export function patchFor(row: { kind: string; area: string; birth_mood?: string | null; rating?: string | null; seen_by_others?: boolean | null }): Patch {
  const kind = row.kind as Kind, area = row.area as Area;
  return { kind, area, direction_deg: AREA_DIRECTION[area] ?? 200, height: HEIGHT_FOR_KIND[kind] ?? "middle", size: SIZE_FOR_KIND[kind] ?? 1,
    mood: (row.birth_mood ?? "neutral") as Feeling, pale: row.rating === "partly", sheen: row.seen_by_others === true };
}
