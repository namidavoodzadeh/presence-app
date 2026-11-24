// E15 (CEO, support for app AR(2)): a server-side Bridge practice partner for the owner account only. A fictional
// linked person so the owner can send and receive a Bridge without a second real account. The reply text is a
// fixed, hand-written fixture, never a model call and never shaped by what the owner wrote (law 1: beliefs and
// replies come from told words, not from guessing at the owner from their own message; law 4: nothing evaluative).
// Deploy note: the fixed id below needs one real `auth.users` row (seeded once via the Supabase Admin API, the
// same way the preview personas are, never a raw SQL insert) before `PRESENCE_PRACTICE_PARTNER=true` is set on
// the hosted server; the migration only adds the `profiles.is_practice_partner` column. Until that row exists,
// the switch stays off and this code path is untested against a real database (it is proven here with a fake one).

export const PRACTICE_PARTNER_ID = "11111111-1111-4111-a111-111111111111";
export const PRACTICE_PARTNER_NAME = "Practice partner";

/**
 * Six fixed replies (no model call ever reads or writes them). Plain, never evaluative (law 4), never implying it
 * read or understood the content, since it never does: a canned line must read naturally no matter what the
 * owner practiced sending.
 */
export const PRACTICE_REPLIES: readonly string[] = [
  "Thanks for sending this. I read it and I'm glad you told me.",
  "I heard that. I don't have anything to add right now, but I'm listening.",
  "Got it, thank you for saying it this way.",
  "I see what you mean. I'm here when you want to talk more.",
  "That makes sense to me. Thanks for putting it into words.",
  "I'm taking this in. No reply needed from you right now.",
];

/** A stable pick from a seed (the bridge id), so one practiced bridge always gets the same reply. Never random. */
export function pickPracticeReply(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PRACTICE_REPLIES[hash % PRACTICE_REPLIES.length];
}

// E24 (CEO, practice people): the owner's existing example linked people (Lea · partner, Mom · family,
// Sam/Dara · friend, Ari · coworker — seed_preview.py's EXAMPLES, already is_example, already carrying a seeded
// map shared through link_prefs) can now also "reply" to a practiced Bridge, the same no-model-call, fixed-fixture
// way the single synthetic practice partner does. Six fixed lines per relationship, chosen by the link's own
// `link_prefs.relationship` (the owner's label for that person), never evaluative (law 4), never implying the
// text was read or understood (law 1): it reads naturally no matter what the owner practiced sending.
const EXAMPLE_REPLIES: Readonly<Record<string, readonly string[]>> = {
  partner: [
    "Thank you for telling me this.",
    "I hear you, and I'm glad you said it.",
    "This means a lot to hear from you.",
    "I'm sitting with this. Let's talk more soon.",
    "Thank you for trusting me with this.",
    "I heard you. I'm here.",
  ],
  family: [
    "Thanks for telling me, I'm glad you did.",
    "I hear you. We'll talk more soon.",
    "That means something to me, thank you.",
    "I'm glad you said this out loud.",
    "Thank you for sharing this with me.",
    "I'm here, and I heard you.",
  ],
  friend: [
    "Thanks for telling me this.",
    "I hear you, that means a lot.",
    "Glad you said it. I'm here.",
    "Thank you for trusting me with this.",
    "I heard you, let's talk more soon.",
    "That means a lot, thank you.",
  ],
  coworker: [
    "Thanks for sharing this with me.",
    "I hear you, and I appreciate you saying it.",
    "Noted, thank you for telling me.",
    "I heard this, and I'm glad you said it.",
    "Thanks for being direct with me.",
    "I appreciate you telling me this.",
  ],
};
/** An example person linked with no recorded relationship (or one outside the four above) still replies gently. */
const DEFAULT_EXAMPLE_REPLIES = EXAMPLE_REPLIES.friend;

/** Same stable-pick rule as `pickPracticeReply`, scoped to the relationship's own fixed set. */
export function pickExampleReply(seed: string, relationship: string): string {
  const pool = EXAMPLE_REPLIES[relationship] ?? DEFAULT_EXAMPLE_REPLIES;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}
