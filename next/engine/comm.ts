// V3 communication model (CPO spec 15 Nov, docs/engine/COMM-SPEC-DIGEST.md sections 4.1, 4.4, 4.5). Pure data and rules, no I/O, no AI.
// Behind the owner-only switch; nothing here is read by a shipped surface until the planner lands.

export const COMM_KINDS = [
  "how_i_mean", "feels_like_care", "bring_up", "lands_hard", "gets_heated", "coming_back", "matters", "other", "this_week",
] as const;
export type CommKind = typeof COMM_KINDS[number];
export const COMM_STATUSES = ["active", "set_aside", "private_only"] as const;
export type CommStatus = typeof COMM_STATUSES[number];
export const COMM_SCOPE_TYPES = ["everyone", "type", "person"] as const;
export type CommScopeType = typeof COMM_SCOPE_TYPES[number];
export const COMM_RELATIONSHIP_TYPES = ["partner", "family", "friends", "coworker"] as const;
export const COMM_TOPICS = ["relationships", "work", "family", "body", "money", "meaning", "politics", "morality"] as const;

/** Order You shows the kinds in (CPO table). This week is its own line at the top, not a kind section. */
export const COMM_KIND_ORDER: readonly CommKind[] = [
  "how_i_mean", "feels_like_care", "bring_up", "lands_hard", "gets_heated", "coming_back", "matters", "other",
];
/** The heading on You and the sentence starter Talk and manual add use. Quoted from the spec; [Name] is filled by the app. */
export const COMM_KIND_COPY: Record<CommKind, { heading: string; starter: string }> = {
  how_i_mean: { heading: "How I mean things", starter: "When I…, it means…" },
  feels_like_care: { heading: "What feels like care", starter: "I feel looked after when…" },
  bring_up: { heading: "How to bring something up with me", starter: "It helps me hear it when…" },
  lands_hard: { heading: "What lands hard", starter: "It's hard for me to hear…" },
  gets_heated: { heading: "When it gets heated", starter: "When it gets tense, I…" },
  coming_back: { heading: "Coming back after", starter: "After a hard moment, it helps when…" },
  matters: { heading: "What matters to me", starter: "What matters to me is…" },
  other: { heading: "Other things about me", starter: "" },
  this_week: { heading: "This week", starter: "This week…" },
};

/** The two kinds that get field-level encryption (COMM-MODEL-DESIGN.md) and are private until the person shares them. */
export const SENSITIVE_KINDS: readonly CommKind[] = ["lands_hard", "this_week"];
/** Package 01 routes.md "Not ready" 7 (issue #9): until field-level encryption exists for them, Talk never offers an item of these kinds. */
export const NOT_OFFERED_IN_TALK: readonly CommKind[] = SENSITIVE_KINDS;
/** Kinds that may only ever be shared with one person at a time (spec: "One person at a time"). */
export const ONE_PERSON_AT_A_TIME: readonly CommKind[] = ["lands_hard", "gets_heated", "coming_back", "this_week"];
export const THIS_WEEK_DEFAULT_DAYS = 14;
export const THIS_WEEK_CHOICES_DAYS: readonly number[] = [7, 14, 30];
export const STILL_TRUE_AFTER_DAYS = 183; // "After 6 months"; never a push

export interface CommItem {
  kind: CommKind;
  scopeType: CommScopeType;
  /** relationship type when scopeType is 'type'; a person id when 'person'; null for 'everyone'. */
  scopeValue: string | null;
  status: CommStatus;
  expiresAt?: string | null;       // ISO; This week only
  topic?: string | null;           // What matters to me only
  when?: string | null;
}

/** The rule failures for one item, as short codes (empty = valid). Mirrors migration 0069's checks so the API refuses before the database does. */
export function commItemProblems(it: CommItem): string[] {
  const p: string[] = [];
  if (!COMM_KINDS.includes(it.kind)) p.push("kind");
  if (!COMM_STATUSES.includes(it.status)) p.push("status");
  if (it.scopeType === "everyone") { if (it.scopeValue !== null) p.push("scope_value_with_everyone"); }
  else if (it.scopeType === "type") { if (!it.scopeValue || !(COMM_RELATIONSHIP_TYPES as readonly string[]).includes(it.scopeValue)) p.push("scope_type_value"); }
  else if (it.scopeType === "person") { if (!it.scopeValue) p.push("scope_person_missing"); }
  else p.push("scope_type");
  if (it.kind === "this_week") { if (!it.expiresAt) p.push("this_week_needs_expiry"); } else if (it.expiresAt) p.push("expiry_only_this_week");
  if (it.topic && it.kind !== "matters") p.push("topic_only_matters");
  if (it.topic && !(COMM_TOPICS as readonly string[]).includes(it.topic)) p.push("topic");
  if (it.when && it.when.length > 120) p.push("when_too_long");
  // One person at a time: these kinds are never shared with everyone or a whole type.
  if (ONE_PERSON_AT_A_TIME.includes(it.kind) && it.status === "active" && it.scopeType !== "person") p.push("one_person_at_a_time");
  return p;
}

/** Defaults for a new item the person has just accepted: sensitive kinds and Other start private; the rest start active with the scope the person picked. */
export function defaultStatus(kind: CommKind): CommStatus {
  return kind === "other" || SENSITIVE_KINDS.includes(kind) || ONE_PERSON_AT_A_TIME.includes(kind) ? "private_only" : "active";
}
export function thisWeekExpiry(from: Date, days: number = THIS_WEEK_DEFAULT_DAYS): string {
  if (!THIS_WEEK_CHOICES_DAYS.includes(days)) days = THIS_WEEK_DEFAULT_DAYS;
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}
export const isExpired = (it: { expiresAt?: string | null }, now: Date): boolean => !!it.expiresAt && Date.parse(it.expiresAt) <= now.getTime();
export const stillTrueDue = (lastConfirmedAt: string | null | undefined, now: Date): boolean =>
  !!lastConfirmedAt && now.getTime() - Date.parse(lastConfirmedAt) >= STILL_TRUE_AFTER_DAYS * 86_400_000;

// ---------------------------------------------------------------- 4.4 what each surface reads
export const SURFACES = ["write_notes", "what_may_mean", "checkin", "mirror_ask_me", "invite", "you", "share_card", "talk_planner"] as const;
export type Surface = typeof SURFACES[number];

/** The kinds a surface may read, about a person other than the reader. The reader's own `you` / `talk_planner` / `write_notes.own` views are separate. */
const OTHERS_KINDS: Record<Exclude<Surface, "you" | "talk_planner">, readonly CommKind[]> = {
  // Notes read the receiver's shared items; gets_heated only when the draft is about a disagreement (checked by the caller via `disagreement`).
  write_notes: ["bring_up", "lands_hard", "this_week", "gets_heated", "matters", "feels_like_care"],
  what_may_mean: ["how_i_mean", "this_week"],
  checkin: ["feels_like_care", "bring_up", "coming_back", "this_week"],
  mirror_ask_me: [],      // reads only the asker's own how_i_mean (OWN_KINDS)
  invite: ["how_i_mean", "feels_like_care", "bring_up"],
  share_card: ["how_i_mean", "feels_like_care", "bring_up", "matters"],
};
/** Kinds a surface reads from the reader's own items. */
const OWN_KINDS: Partial<Record<Surface, readonly CommKind[]>> = {
  write_notes: ["how_i_mean"],
  mirror_ask_me: ["how_i_mean"],
  you: COMM_KINDS,
  talk_planner: ["lands_hard", "this_week"],   // the planner may see these two decrypted in memory for its one call (design doc 2)
};
/** Mirror and Ask me answers may suggest only these kinds (spec 4.4, law 12 amendment). */
export const MIRROR_SUGGESTABLE_KINDS: readonly CommKind[] = ["how_i_mean", "gets_heated", "feels_like_care"];
/** Kinds that never reach a share card or invite, whatever the person picks. */
export const NEVER_ON_CARDS: readonly CommKind[] = ["lands_hard", "gets_heated", "coming_back", "this_week", "other"];

export interface VisibleOpts {
  surface: Surface;
  /** The person reading is the owner of the item. */
  own: boolean;
  /** The reader's id, as it appears in a person-scope; also their relationship type to the owner for a type-scope. */
  readerId?: string;
  readerRelationship?: string;
  /** write_notes only: the draft is about a disagreement. */
  disagreement?: boolean;
  /** write_notes only: the old topic the draft is about, when known; a tagged What matters to me item is read only for the same topic. */
  draftTopic?: string;
  now: Date;
}
export interface StoredComm extends CommItem { id?: string }

/** May this surface read this item for this reader? Everything not listed is no. Expired and set-aside items are never read; for others, private_only is never read. */
export function surfaceMayRead(it: StoredComm, o: VisibleOpts): boolean {
  if (isExpired(it, o.now) || it.status === "set_aside") return false;
  if (o.own) {
    if (o.surface === "you") return true;
    return (OWN_KINDS[o.surface] ?? []).includes(it.kind);
  }
  if (o.surface === "you" || o.surface === "talk_planner") return false;     // nobody else's items on You or in the planner
  if (it.status !== "active") return false;                                  // private_only is the owner's alone
  if (!OTHERS_KINDS[o.surface].includes(it.kind)) return false;
  if (o.surface === "write_notes" && it.kind === "gets_heated" && !o.disagreement) return false;
  if (o.surface === "write_notes" && it.kind === "matters" && it.topic && it.topic !== o.draftTopic) return false;   // matched by tag
  if (o.surface === "invite" || o.surface === "share_card") if (NEVER_ON_CARDS.includes(it.kind)) return false;
  if (o.surface === "share_card" && it.kind === "matters" && it.topic && ["politics", "body"].includes(it.topic)) return false;   // faith has no tag in the closed topic list: the person leaves it off cards by not picking it
  // Scope: everyone, the reader's relationship type, or exactly the reader. A person-scope for anyone else is invisible.
  if (it.scopeType === "everyone") return true;
  if (it.scopeType === "type") return !!o.readerRelationship && it.scopeValue === o.readerRelationship;
  return !!o.readerId && it.scopeValue === o.readerId;
}
/** The comm relationship type for a link_prefs.relationship value (partner, friend, family, coworker). Anything unknown is undefined: a type-scoped item is then not visible (the conservative reading). */
export function commRelationshipType(rel: string | null | undefined): string | undefined {
  if (rel === "friend") return "friends";
  return (COMM_RELATIONSHIP_TYPES as readonly string[]).includes(String(rel)) ? String(rel) : undefined;
}
/** A grant the owner made through the older per-item share (share_items), read by a surface (4.4). A grant on an old kenning with no kind carries on unchanged (CARRY-2: old shares kept exactly); one on a kinded item is read only in the kinds the table gives that surface, never when set aside or expired. The grant is the scope: the person chose this reader, so no scope check here. */
export function grantMayRead(surface: Exclude<Surface, "you" | "talk_planner">, g: { kind?: string | null; status?: string | null; expiresAt?: string | null }, now: Date): boolean {
  if (!g.kind) return true;
  if (g.status === "set_aside" || isExpired({ expiresAt: g.expiresAt }, now)) return false;
  return (OTHERS_KINDS[surface] as readonly string[]).includes(g.kind);
}
export function itemsVisibleTo<T extends StoredComm>(items: readonly T[], o: VisibleOpts): T[] {
  return items.filter((i) => surfaceMayRead(i, o));
}

// ---------------------------------------------------------------- 4.5 never inferred
/** Kinds the engine may never write from inference, from any source: the person must say them (Talk answer, typed item). */
export const NEVER_INFERRED_KINDS: readonly CommKind[] = ["lands_hard", "this_week"];
/** What an extraction or carry-over may not produce at all, whatever the kind. Each is checked by `neverInferredReason`. */
export const NEVER_INFERRED_TOPICS = [
  "about_other_person", "attachment", "rejection_sensitivity", "mood", "mental_state", "diagnosis", "relationship_quality", "who_is_the_problem",
  "typing_signal",
] as const;
export type NeverInferred = typeof NEVER_INFERRED_TOPICS[number];

export type CommSource = "talk_said" | "typed" | "draft" | "mirror" | "import" | "carry_over";
/** `talk_said` and `typed` are the person's own statement; every other source is inference. */
export const isOwnStatement = (s: CommSource): boolean => s === "talk_said" || s === "typed";

/** The kind check of 4.5: an inferred source may not produce lands_hard or this_week. Returns a reason code or null. */
export function neverInferredReason(kind: CommKind, source: CommSource): string | null {
  if (NEVER_INFERRED_KINDS.includes(kind) && !isOwnStatement(source)) return `kind_${kind}_only_when_said`;
  if (source === "mirror" && !MIRROR_SUGGESTABLE_KINDS.includes(kind)) return `mirror_cannot_suggest_${kind}`;
  return null;
}
