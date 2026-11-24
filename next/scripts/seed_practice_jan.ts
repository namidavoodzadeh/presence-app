// E27 (4), CEO 09:55 PT 07 Nov: Jan, a practice person for the owner account only (the E24 (C) pattern). A fictional partner
// with a seeded map of 12 fictional beliefs across Foundations and the domains, 6 of them shared with the owner through
// link_prefs (share_on plus the two shared areas, the receiver's own consent, law 10), including the ones the golden drafts
// land on. Jan is `is_example` (so a practiced Bridge to Jan gets the canned partner replies, never a model call) and
// `is_practice` (so /bridge/run reads Jan's shared beliefs, wording only, for "from them"). Every person, belief and quote
// here is invented.
//
// Idempotent: it checks first and does nothing when Jan's map, link and share are already there; a partial or stale map is
// replaced (Jan's own rows only; the owner's rows are never touched beyond the one link_prefs row for Jan).
// Tested against the fixture database (tests/seed_practice_jan_test.ts). The hosted step (Jan's auth user through the Admin
// API, then this seed for the owner's account) runs only after QA has verified the E27 candidate.
//   deno run --allow-net --allow-read --allow-env next/scripts/seed_practice_jan.ts --hosted --owner <owner id>   (hosted step)
//   without both flags it refuses and prints the hosted command.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { IMPORT_PREVIEW_OWNER_ID } from "../api/lib/env.ts";

type Row = Record<string, unknown>;

export const JAN = { name: "Jan", relationship: "partner", color: "#3E7C6B", persona: "jan" } as const;
/** The areas Jan shares with the owner; every belief in them is shared, every other belief stays private. */
export const JAN_SHARED_AREAS = ["relationships", "family"] as const;
export const JAN_CONVERSATION_TITLE = "Example: Jan";

const TYPE_FOR_LEVEL: Record<string, string> = {
  L0: "something I believe is true",
  L1: "a rule I live by",
  L2: "something I do to cope",
  L3: "a view or taste",
  L4: "how I tend to react",
};
const KIND_FOR_TYPE: Record<string, string> = {
  "something I believe is true": "foundation",
  "a rule I live by": "rule",
  "something I do to cope": "rule",
  "a view or taste": "everyday",
  "how I tend to react": "everyday",
};
const DOMAIN_FOR_AREA: Record<string, string> = {
  relationships: "close_relationships",
  family: "family",
  work: "work",
  money: "money",
  body: "body_health",
  meaning: "meaning",
  morality: "morality",
};

/** Jan's map: label, statement (Jan's own wording), level, area, and the one receipt in Jan's own fictional words. */
export const JAN_BELIEFS = [
  { label: "Direct asks", statement: "Being asked directly matters to me more than hints.", level: "L0", area: "relationships", receipt: "Just ask me straight out, I'd rather that than have to guess." },
  { label: "Hearing it early", statement: "When plans change I need to hear it early.", level: "L1", area: "relationships", receipt: "If the plan changes, tell me as soon as you know, not at the door." },
  { label: "Quiet under blame", statement: "When something sounds like blame, I go quiet.", level: "L4", area: "relationships", receipt: "When it sounds like I did something wrong I just shut down." },
  { label: "Time alone", statement: "I need time alone to recharge, and it isn't about anyone else.", level: "L3", area: "relationships", receipt: "An hour on my own and I'm back, it's not about you." },
  { label: "Warning first", statement: "I need some warning before guests come.", level: "L1", area: "family", receipt: "Give me a day's notice before people come over and I'm fine." },
  { label: "Advice as care", statement: "Giving advice is how I show I care.", level: "L0", area: "family", receipt: "When I tell my sister what to do it's because I love her." },
  { label: "Right the first time", statement: "Part of me feels I have to get things right the first time.", level: "L0", area: "meaning", receipt: "I redo things three times before anyone sees them." },
  { label: "Lists keep me calm", statement: "When work piles up I make lists to stay calm.", level: "L2", area: "work", receipt: "Busy week, so I wrote four lists before nine." },
  { label: "Saving first", statement: "I'd rather save than spend on things we don't need.", level: "L3", area: "money", receipt: "I'd rather put it away than buy another gadget." },
  { label: "Short when tired", statement: "When I'm tired I get short with people.", level: "L4", area: "body", receipt: "After a long shift I snap at whoever's closest." },
  { label: "Keeping my word", statement: "If I say I'll do something, I do it.", level: "L1", area: "morality", receipt: "I said I'd help him move, so I went, flu or not." },
  { label: "Being useful", statement: "I feel most at ease when I'm being useful.", level: "L0", area: "work", receipt: "Give me a job at a party and I relax." },
] as const;

export function janSharedBeliefs(): string[] {
  return JAN_BELIEFS.filter((b) => (JAN_SHARED_AREAS as readonly string[]).includes(b.area)).map((b) => b.statement);
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, where: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${where}: ${error.message}`);
  return data;
}

/** True when Jan's profile flags, full map, link and both link_prefs rows already match the seed. */
async function janIsSeeded(db: SupabaseClient, owner: string, janId: string): Promise<boolean> {
  const profile = await must(db.from("profiles").select("*").eq("id", janId).maybeSingle(), "profiles.select") as Row | null;
  if (!profile || profile.is_example !== true || profile.is_practice !== true) return false;
  const beliefs = await must(db.from("beliefs").select("statement,status,area").eq("owner", janId), "beliefs.select") as Row[];
  const have = new Set(beliefs.filter((b) => b.status === "confirmed").map((b) => `${b.statement}|${b.area}`));
  if (beliefs.length !== JAN_BELIEFS.length || !JAN_BELIEFS.every((b) => have.has(`${b.statement}|${b.area}`))) return false;
  const receipts = await must(db.from("receipts").select("id").eq("owner", janId), "receipts.select") as Row[];
  if (receipts.length !== JAN_BELIEFS.length) return false;
  const [a, b] = [owner, janId].sort();
  const link = await must(db.from("links").select("status").eq("person_a", a).eq("person_b", b).maybeSingle(), "links.select") as Row | null;
  const mine = await must(db.from("link_prefs").select("relationship").eq("owner", owner).eq("other", janId).maybeSingle(), "link_prefs.select") as Row | null;
  const theirs = await must(db.from("link_prefs").select("relationship,share_on,share_areas,share_quotes").eq("owner", janId).eq("other", owner).maybeSingle(), "link_prefs.select") as Row | null;
  const areas = Array.isArray(theirs?.share_areas) ? [...theirs!.share_areas as string[]].sort().join(",") : "";
  return link?.status === "active" && mine?.relationship === JAN.relationship && theirs?.share_on === true &&
    theirs?.share_quotes === false && areas === [...JAN_SHARED_AREAS].sort().join(",");
}

async function upsert(db: SupabaseClient, table: string, match: Row, values: Row): Promise<void> {
  let q = db.from(table).select("*");
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v as string);
  const found = await must(q.maybeSingle(), `${table}.select`);
  if (found) {
    let u = db.from(table).update(values);
    for (const [k, v] of Object.entries(match)) u = u.eq(k, v as string);
    await must(u, `${table}.update`);
  } else await must(db.from(table).insert({ ...match, ...values }), `${table}.insert`);
}

/** Seeds Jan for `owner`. `janId` is Jan's profile id (on hosted, an auth user made through the Admin API first). */
export async function seedPracticeJan(db: SupabaseClient, owner: string, janId: string): Promise<{ seeded: boolean; already: boolean; beliefs: number; shared: number }> {
  const shared = janSharedBeliefs().length;
  if (await janIsSeeded(db, owner, janId)) return { seeded: false, already: true, beliefs: JAN_BELIEFS.length, shared };

  await upsert(db, "profiles", { id: janId }, { name: JAN.name, color: JAN.color, is_example: true, is_practice: true, is_preview: true, persona: JAN.persona });
  // Replace Jan's own map (only Jan's rows; receipts and links first, the conversation last).
  for (const t of ["belief_links", "receipts", "beliefs", "messages", "conversations"]) await must(db.from(t).delete().eq("owner", janId), `${t}.delete`);
  const seededAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const conv = await must(db.from("conversations").insert({
    owner: janId, title: JAN_CONVERSATION_TITLE, status: "finished", mode: "text", started_at: seededAt, last_active_at: seededAt,
    finished_at: seededAt, summary: "Seeded practice person (fictional).",
  }).select("id").single(), "conversations.insert") as Row;
  for (const [i, b] of JAN_BELIEFS.entries()) {
    const turn = i + 1;
    const at = new Date(Date.parse(seededAt) + turn * 60_000).toISOString();
    const type = TYPE_FOR_LEVEL[b.level];
    const msg = await must(db.from("messages").insert({ conversation_id: conv.id, owner: janId, role: "me", turn, text: b.receipt, feeling: "neutral", created_at: at })
      .select("id").single(), "messages.insert") as Row;
    const belief = await must(db.from("beliefs").insert({
      owner: janId, label: b.label, statement: b.statement, type, kind: KIND_FOR_TYPE[type], level: b.level, area: b.area,
      domains: [DOMAIN_FOR_AREA[b.area]], birth_mood: "neutral", status: "confirmed", rating: i % 4 === 3 ? "partly" : "very",
      confidence: 0.85, source: "talk", conversation_id: conv.id, rated_at: seededAt, confirmed_at: seededAt, created_at: at,
    }).select("id").single(), "beliefs.insert") as Row;
    await must(db.from("receipts").insert({ owner: janId, belief_id: belief.id, message_id: msg.id, conversation_id: conv.id, quote: b.receipt, said_at: seededAt }), "receipts.insert");
  }
  const [a, b] = [owner, janId].sort();
  await upsert(db, "links", { person_a: a, person_b: b }, { status: "active" });
  await upsert(db, "link_prefs", { owner, other: janId }, { relationship: JAN.relationship });
  await upsert(db, "link_prefs", { owner: janId, other: owner }, { relationship: JAN.relationship, share_on: true, share_areas: [...JAN_SHARED_AREAS], share_quotes: false });
  return { seeded: true, already: false, beliefs: JAN_BELIEFS.length, shared };
}

/** The hosted step (ANSWERS, CEO 10:08 PT 07 Nov: Nami's yes, after the golden gate is 20/20 and QA has verified the
 *  candidate): Jan's auth user through the Admin API when Jan has no profile yet (a random password, never printed or kept:
 *  nobody signs in as Jan), then the seed for the owner account only. */
async function hosted(): Promise<void> {
  const { loadEnv } = await import("../api/lib/env.ts");
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const env = await loadEnv();
  const service = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) as SupabaseClient;
  const found = await must(service.from("profiles").select("id").eq("persona", JAN.persona).eq("is_practice", true), "profiles.select") as Row[];
  let janId = found.length === 1 ? String(found[0].id) : "";
  if (found.length > 1) throw new Error(`${found.length} practice profiles with persona jan; expected at most one`);
  if (!janId) {
    const { data, error } = await service.auth.admin.createUser({ email: "practice-jan@preview.presence.app", password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true });
    if (error || !data.user) throw new Error(`createUser jan: ${error?.message}`);
    janId = data.user.id;
  }
  const r = await seedPracticeJan(service, IMPORT_PREVIEW_OWNER_ID, janId);
  console.log(JSON.stringify({ owner: IMPORT_PREVIEW_OWNER_ID, jan: janId, ...r }));
}

if (import.meta.main) {
  // Owner account only, and only when asked in so many words: `--hosted --owner <the owner id>`.
  const owner = Deno.args[Deno.args.indexOf("--owner") + 1];
  if (Deno.args.includes("--hosted") && owner === IMPORT_PREVIEW_OWNER_ID) {
    await hosted();
    Deno.exit(0);
  }
  console.log(
    `This script seeds Jan, a practice partner, for the owner account (${IMPORT_PREVIEW_OWNER_ID}). The hosted step runs only as\n` +
      `  deno run --allow-net --allow-read --allow-env next/scripts/seed_practice_jan.ts --hosted --owner ${IMPORT_PREVIEW_OWNER_ID}\n` +
      "after the golden gate is 20/20 and QA has verified the E27 candidate (ANSWERS, CEO 10:08 PT 07 Nov).",
  );
  Deno.exit(1);
}
