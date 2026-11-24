// One conservative eligibility decision for every surface that can put a communication item on a card.
// The caller supplies an item's own words, never a tag alone.  Keyword matches only add exclusions; callers may
// also pass a reader's positive finding when a semantic/content reader has found a sensitive meaning the floor missed.
import { isHarshSelfStatement } from "./harsh_self.ts";

export type CardSurface = "card" | "ask";
export type EligibilityScope =
  | "everyone"
  | "family"
  | "friends"
  | "coworker"
  | "person"
  | "private"
  | "unset";
export type EligibilityStatus =
  | "confirmed"
  | "partly"
  | "edited"
  | "suggested"
  | "imported_unrated"
  | "set_aside"
  | "not_me"
  | "retired";
export interface EligibilityItem {
  id: string;
  wording: string;
  kind: string;
  topic?: string | null;
  scope: EligibilityScope;
  status: EligibilityStatus;
  hiddenFromMap?: boolean;
  /** A semantic reader's finding. It can exclude, never make an item eligible. */
  readerSensitive?: boolean;
}

const CARD_KINDS = new Set(["lands_hard", "gets_heated", "coming_back", "this_week"]);
const CARD_TOPICS = new Set(["politics", "faith", "body", "money"]);
const ASK_TOPICS = new Set([...CARD_TOPICS, "morality"]);
// This is a floor, deliberately not a definition of sensitive content. It only adds exclusions to a reader's answer.
const SENSITIVE_WORDS =
  /\b(?:diagnos\w*|medicat\w*|prescription|therapy|therapist|mental health|depress\w*|anxiety|bipolar|adhd|ptsd|autis\w*|health|illness|sick|cancer|surgery|hospital|doctor|symptom|alcohol|drugs?|cocaine|heroin|weed|drunk|sober|smok\w*|vape\w*|sex(?:ual)?|gay|lesbian|bisexual|bi\b|queer|trans(?:gender)?|nonbinary|coming out|pregnan\w*|fertility|immigr\w*|visa|asylum|lawyer|court|lawsuit|arrest\w*|abuse|assault|violence|violent|hit me|hurt me|workplace secret|confidential at work|child|kid|son|daughter|baby|toddler|teen|debt|salary|rent|broke)\b/i;
// A proper name is deliberately conservative.  It is only used beside the content reader: a title-cased word after
// sentence position, or a possessive named person, is enough to keep a public card out.
const NAMED_PERSON =
  /(?:\b(?:my|with|to|for|from|and)\s+)([A-Z][a-z]{1,})\b|\b[A-Z][a-z]{1,}\s+(?:said|told|asked|did|was|is)\b/;

export const ASK_MOMENT_QUESTION = "Describe a time it happened.";

export function contentExcluded(words: string, readerSensitive = false): boolean {
  return readerSensitive || SENSITIVE_WORDS.test(words) || NAMED_PERSON.test(words);
}

export function eligibilityReason(item: EligibilityItem, surface: CardSurface): string | null {
  if (item.hiddenFromMap) return "hidden_from_map";
  if (surface === "card" && ["set_aside", "not_me", "suggested", "imported_unrated", "retired"].includes(item.status)) return "card_status";
  if (CARD_KINDS.has(item.kind)) return "excluded_kind";
  if ((surface === "ask" ? ASK_TOPICS : CARD_TOPICS).has(item.topic ?? "")) return "excluded_topic";
  if (contentExcluded(item.wording, item.readerSensitive)) return "excluded_content";
  if (isHarshSelfStatement(item.wording)) return "harsh_self";
  if (item.scope === "person" || item.scope === "private" || item.scope === "unset") return "narrow_scope";
  if (surface === "ask") {
    if (item.kind !== "how_i_mean") return "ask_kind";
    if (!(item.status === "confirmed" || item.status === "partly" || item.status === "edited")) {
      return "ask_status";
    }
    if (!(item.scope === "everyone" || item.scope === "family" || item.scope === "friends")) {
      return "ask_scope";
    }
  }
  return null;
}

export const isEligibleFor = (item: EligibilityItem, surface: CardSurface): boolean =>
  eligibilityReason(item, surface) === null;

/** All card entry points use this projection: picker, Surprise me, pre-selection, story and photo preview. */
export function eligibleItems(items: readonly EligibilityItem[], surface: CardSurface): EligibilityItem[] {
  return items.filter((item) => isEligibleFor(item, surface));
}

/** Canonical server payload shapes. Every card path is projected from the same eligible set. */
export function cardChoices(items: readonly EligibilityItem[]) {
  const eligible = eligibleItems(items, "card");
  return { picker: eligible, surprise: eligible, preselected: eligible, preview: eligible };
}

export function askChoices(items: readonly EligibilityItem[]) {
  return { presets: eligibleItems(items, "ask"), question: ASK_MOMENT_QUESTION, adultsOnly: true };
}

/** An Ask source change closes only new intake. Existing answers are intentionally not represented or removed here. */
export function askStaysOpen(source: EligibilityItem): boolean {
  return source.status !== "set_aside" && source.status !== "retired" &&
    source.scope !== "person" && source.scope !== "private" && source.scope !== "unset";
}
