// V3 communication model, spec 4.1/4.4/4.5 (docs/engine/COMM-SPEC-DIGEST.md): migration 0069 on PGlite and the pure rules in engine/comm.ts. $0.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import {
  COMM_KIND_COPY, COMM_KIND_ORDER, COMM_KINDS, commItemProblems, defaultStatus, isExpired, itemsVisibleTo, MIRROR_SUGGESTABLE_KINDS,
  neverInferredReason, NEVER_ON_CARDS, SENSITIVE_KINDS, stillTrueDue, thisWeekExpiry, type CommItem, type StoredComm, type Surface,
} from "../engine/comm.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const MIG = new URL("../../supabase/migrations/0069_comm_items.sql", import.meta.url);

async function db(): Promise<PGlite> {
  const pg = new PGlite();
  // Only the columns 0069 does not touch; the real table is 0001's (kind, level, area and status stay as they are).
  await pg.exec(`create schema if not exists public;
    create table public.beliefs (id uuid primary key default gen_random_uuid(), owner uuid not null, label text not null default 'x',
      kind text not null default 'everyday', level text, status text not null default 'confirmed');
    insert into public.beliefs (owner, label, level) values (gen_random_uuid(), 'Family comes first', 'L3');`);
  await pg.exec(await Deno.readTextFile(MIG));
  return pg;
}
const ins = (pg: PGlite, cols: Record<string, string | null>) => {
  const k = Object.keys(cols);
  return pg.query(`insert into public.beliefs (owner, ${k.join(",")}) values (gen_random_uuid(), ${k.map((_, i) => `$${i + 1}`).join(",")})`, k.map((c) => cols[c]));
};
const ok = { comm_kind: "how_i_mean", comm_scope_type: "everyone", comm_status: "active" };

Deno.test("0069: an old row survives untouched, with every new column null; level stays stored", async () => {
  const pg = await db();
  const r = (await pg.query<Record<string, unknown>>("select * from public.beliefs")).rows[0];
  assertEquals([r.label, r.level, r.kind, r.comm_kind, r.comm_scope_type, r.comm_status, r.comm_expires_at], ["Family comes first", "L3", "everyday", null, null, null, null]);
  await pg.close();
});
Deno.test("0069: the nine kinds, the three statuses and the scope shapes are accepted; anything else is refused by name", async () => {
  const pg = await db();
  for (const kind of COMM_KINDS) {
    const exp = kind === "this_week" ? "2026-11-30T00:00:00Z" : null;
    await ins(pg, { comm_kind: kind, comm_scope_type: "everyone", comm_status: "private_only", comm_expires_at: exp });
  }
  await ins(pg, { ...ok, comm_scope_type: "type", comm_scope_value: "partner" });
  await ins(pg, { ...ok, comm_scope_type: "person", comm_scope_value: "7b0d6f0e-0000-4000-8000-000000000001", comm_when: "By text" });
  for (const bad of [
    { ...ok, comm_kind: "style" }, { ...ok, comm_status: "deleted" }, { ...ok, comm_scope_type: "group" },
    { ...ok, comm_scope_type: "type", comm_scope_value: "boss" }, { ...ok, comm_scope_type: "type" },
    { ...ok, comm_scope_type: "person" }, { ...ok, comm_scope_value: "partner" },
    { comm_kind: "how_i_mean" },                                              // a kind without scope and status
    { comm_scope_type: "everyone", comm_status: "active" },                   // a scope without a kind
    { ...ok, comm_when: "x".repeat(121) },
  ]) await assertRejects(() => ins(pg, bad as Record<string, string>), Error, undefined, JSON.stringify(bad));
  await pg.close();
});
Deno.test("0069: This week needs an expiry and nothing else may have one; the topic tag is only for What matters to me", async () => {
  const pg = await db();
  await assertRejects(() => ins(pg, { ...ok, comm_kind: "this_week" }), Error, "beliefs_comm_expiry");
  await assertRejects(() => ins(pg, { ...ok, comm_expires_at: "2026-12-01T00:00:00Z" }), Error, "beliefs_comm_expiry");
  await ins(pg, { ...ok, comm_kind: "matters", comm_topic: "money" });
  await assertRejects(() => ins(pg, { ...ok, comm_topic: "money" }), Error, "beliefs_comm_topic_only_matters");
  await assertRejects(() => ins(pg, { ...ok, comm_kind: "matters", comm_topic: "faith" }), Error);
  await pg.close();
});
Deno.test("0069: the rollback lines drop every new column and leave the old row exactly as it was", async () => {
  const pg = await db();
  const sql = await Deno.readTextFile(MIG);
  const down = sql.split("-- Rollback (nothing else touched):")[1].split("\n").map((l) => l.replace(/^--\s?/, "")).join("\n");
  await pg.exec(down);
  const cols = (await pg.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='beliefs' order by 1")).rows.map((r) => r.column_name);
  assertEquals(cols, ["id", "kind", "label", "level", "owner", "status"]);
  assertEquals((await pg.query<{ level: string }>("select level from public.beliefs")).rows[0].level, "L3");
  await pg.close();
});

// ---------------------------------------------------------------- rules in engine/comm.ts
const item = (o: Partial<CommItem> = {}): CommItem => ({ kind: "how_i_mean", scopeType: "everyone", scopeValue: null, status: "active", ...o });

Deno.test("commItemProblems mirrors the migration's checks and adds one person at a time", () => {
  assertEquals(commItemProblems(item()), []);
  assertEquals(commItemProblems(item({ kind: "this_week", scopeType: "person", scopeValue: "p1", expiresAt: "2026-11-30T00:00:00Z" })), []);
  assertEquals(commItemProblems(item({ kind: "this_week", scopeType: "person", scopeValue: "p1" })), ["this_week_needs_expiry"]);
  assertEquals(commItemProblems(item({ expiresAt: "2026-11-30T00:00:00Z" })), ["expiry_only_this_week"]);
  assertEquals(commItemProblems(item({ topic: "work" })), ["topic_only_matters"]);
  assertEquals(commItemProblems(item({ scopeType: "type", scopeValue: "boss" })), ["scope_type_value"]);
  assertEquals(commItemProblems(item({ scopeType: "person" })), ["scope_person_missing"]);
  for (const kind of ["lands_hard", "gets_heated", "coming_back"] as const) {
    assertEquals(commItemProblems(item({ kind, scopeType: "everyone" })), ["one_person_at_a_time"], kind);
    assertEquals(commItemProblems(item({ kind, scopeType: "type", scopeValue: "partner" })), ["one_person_at_a_time"], kind);
    assertEquals(commItemProblems(item({ kind, scopeType: "everyone", status: "private_only" })), [], kind);   // private is fine
    assertEquals(commItemProblems(item({ kind, scopeType: "person", scopeValue: "p1" })), [], kind);
  }
});
Deno.test("kinds: nine, in the CPO order with This week as its own line; every kind has a heading; sensitive and private defaults", () => {
  assertEquals(COMM_KINDS.length, 9);
  assertEquals(COMM_KIND_ORDER.includes("this_week"), false);
  assertEquals(COMM_KIND_ORDER[0], "how_i_mean");
  assertEquals(COMM_KIND_COPY.lands_hard.heading, "What lands hard");
  for (const k of COMM_KINDS) assert(COMM_KIND_COPY[k].heading.length > 0, k);
  assertEquals(SENSITIVE_KINDS, ["lands_hard", "this_week"]);
  for (const k of ["other", "lands_hard", "gets_heated", "coming_back", "this_week"] as const) assertEquals(defaultStatus(k), "private_only", k);
  for (const k of ["how_i_mean", "feels_like_care", "bring_up", "matters"] as const) assertEquals(defaultStatus(k), "active", k);
});
Deno.test("This week: 2 weeks by default, 1 week or 1 month by choice, any other length falls back; expiry and 'still true' are dated", () => {
  assertEquals(thisWeekExpiry(NOW), "2026-11-30T12:00:00.000Z");
  assertEquals(thisWeekExpiry(NOW, 7), "2026-11-23T12:00:00.000Z");
  assertEquals(thisWeekExpiry(NOW, 30), "2026-12-16T12:00:00.000Z");
  assertEquals(thisWeekExpiry(NOW, 90), "2026-11-30T12:00:00.000Z");
  assert(isExpired({ expiresAt: "2026-11-16T12:00:00Z" }, NOW));
  assert(!isExpired({ expiresAt: "2026-11-16T12:00:01Z" }, NOW));
  assert(!isExpired({}, NOW));
  assert(!stillTrueDue("2026-06-01T00:00:00Z", NOW));
  assert(stillTrueDue("2026-05-01T00:00:00Z", NOW));
  assert(!stillTrueDue(null, NOW));
});

const stored = (id: string, o: Partial<StoredComm> = {}): StoredComm => ({ ...item(), id, ...o });
const all: StoredComm[] = [
  ...COMM_KINDS.map((k) => stored(k, { kind: k, scopeType: "person", scopeValue: "jan", ...(k === "this_week" ? { expiresAt: "2026-11-30T00:00:00Z" } : {}) })),
];
const ids = (xs: StoredComm[]) => xs.map((x) => x.id).sort();
const seen = (surface: Surface, extra: Partial<Parameters<typeof itemsVisibleTo>[1]> = {}) =>
  ids(itemsVisibleTo(all, { surface, own: false, readerId: "jan", now: NOW, ...extra }));

Deno.test("4.4 per surface: what a reader other than the owner may see", () => {
  assertEquals(seen("write_notes"), ["bring_up", "feels_like_care", "lands_hard", "matters", "this_week"]);
  assertEquals(seen("write_notes", { disagreement: true }), ["bring_up", "feels_like_care", "gets_heated", "lands_hard", "matters", "this_week"]);
  assertEquals(seen("what_may_mean"), ["how_i_mean", "this_week"]);
  assertEquals(seen("checkin"), ["bring_up", "coming_back", "feels_like_care", "this_week"]);
  assertEquals(seen("mirror_ask_me"), []);
  assertEquals(seen("invite"), ["bring_up", "feels_like_care", "how_i_mean"]);
  assertEquals(seen("share_card"), ["bring_up", "feels_like_care", "how_i_mean", "matters"]);
  assertEquals(seen("you"), []);
  assertEquals(seen("talk_planner"), []);
});
Deno.test("4.4: never lands_hard on a check-in, an invite or a card; never anything one-person-scoped to someone else", () => {
  for (const s of ["checkin", "invite", "share_card", "what_may_mean"] as const) assert(!seen(s).includes("lands_hard"), s);
  for (const k of NEVER_ON_CARDS) for (const s of ["invite", "share_card"] as const) assert(!seen(s).includes(k), `${s} ${k}`);
  assertEquals(seen("write_notes", { readerId: "someone-else" }), []);              // all were scoped to jan
  assertEquals(seen("write_notes", { readerId: undefined }), []);
});
Deno.test("4.4: scope everyone and relationship type; private_only, set aside and expired items are never read by others", () => {
  const xs: StoredComm[] = [
    stored("all", { kind: "bring_up" }),
    stored("partners", { kind: "bring_up", scopeType: "type", scopeValue: "partner" }),
    stored("priv", { kind: "bring_up", status: "private_only" }),
    stored("aside", { kind: "bring_up", status: "set_aside" }),
    stored("old", { kind: "this_week", scopeType: "person", scopeValue: "jan", expiresAt: "2026-11-16T12:00:00Z" }),
    stored("fresh", { kind: "this_week", scopeType: "person", scopeValue: "jan", expiresAt: "2026-11-17T12:00:00Z" }),
  ];
  const view = (rel?: string) => ids(itemsVisibleTo(xs, { surface: "checkin", own: false, readerId: "jan", readerRelationship: rel, now: NOW }));
  assertEquals(view("partner"), ["all", "fresh", "partners"]);
  assertEquals(view("friends"), ["all", "fresh"]);
  assertEquals(view(), ["all", "fresh"]);
});
Deno.test("4.4: a card leaves off politics and body topics; the owner's own surfaces read their own set", () => {
  const xs: StoredComm[] = [stored("a", { kind: "matters", topic: "money" }), stored("b", { kind: "matters", topic: "politics" }), stored("c", { kind: "matters", topic: "body" }), stored("d", { kind: "matters" })];
  assertEquals(ids(itemsVisibleTo(xs, { surface: "share_card", own: false, readerId: "x", now: NOW })), ["a", "d"]);
  assertEquals(ids(itemsVisibleTo(all, { surface: "you", own: true, now: NOW })), ids(all));                    // You reads everything the owner owns
  assertEquals(ids(itemsVisibleTo(all, { surface: "mirror_ask_me", own: true, now: NOW })), ["how_i_mean"]);   // Ask me: the asker's own how_i_mean
  assertEquals(ids(itemsVisibleTo(all, { surface: "talk_planner", own: true, now: NOW })), ["lands_hard", "this_week"]);
});
Deno.test("4.4: a tagged What matters to me item reaches Write only for a draft on the same topic", () => {
  const xs: StoredComm[] = [stored("money", { kind: "matters", topic: "money" }), stored("untagged", { kind: "matters" })];
  const v = (draftTopic?: string) => ids(itemsVisibleTo(xs, { surface: "write_notes", own: false, readerId: "x", draftTopic, now: NOW }));
  assertEquals(v("money"), ["money", "untagged"]);
  assertEquals(v("work"), ["untagged"]);
  assertEquals(v(), ["untagged"]);
});
Deno.test("4.5 never inferred: lands_hard and This week only when said; Mirror may suggest only three kinds", () => {
  for (const k of ["lands_hard", "this_week"] as const) {
    assertEquals(neverInferredReason(k, "talk_said"), null, k);
    assertEquals(neverInferredReason(k, "typed"), null, k);
    for (const s of ["draft", "mirror", "import", "carry_over"] as const) assertEquals(neverInferredReason(k, s), `kind_${k}_only_when_said`, `${k} ${s}`);
  }
  assertEquals(MIRROR_SUGGESTABLE_KINDS, ["how_i_mean", "gets_heated", "feels_like_care"]);
  for (const k of COMM_KINDS) {
    const r = neverInferredReason(k, "mirror");
    assertEquals(r === null, MIRROR_SUGGESTABLE_KINDS.includes(k), k);
  }
  assertEquals(neverInferredReason("matters", "carry_over"), null);
});

// ---------------------------------------------------------------- 0070: This week is deleted at expiry
Deno.test("0070: the expiry function deletes only expired This week rows, with their receipts, and returns a count; a second run is harmless; rollback drops it", async () => {
  const pg = await db();
  await pg.exec(`create table public.receipts (id uuid primary key default gen_random_uuid(), belief_id uuid not null references public.beliefs(id) on delete cascade, quote text);`);
  await pg.exec("create role anon; create role authenticated;");   // Supabase's roles; PGlite has none
  await pg.exec(await Deno.readTextFile(new URL("../../supabase/migrations/0070_comm_expire_this_week.sql", import.meta.url)));
  const mk = async (label: string, kind: string, at: string | null) => (await pg.query<{ id: string }>(
    `insert into public.beliefs (owner, label, comm_kind, comm_scope_type, comm_status, comm_expires_at) values (gen_random_uuid(), $1, $2, 'everyone', 'private_only', $3) returning id`,
    [label, kind, at])).rows[0].id;
  const gone = await mk("old week", "this_week", "2026-11-16T11:00:00Z");
  const edge = await mk("exactly now", "this_week", "2026-11-16T12:00:00Z");
  const keep = await mk("next week", "this_week", "2026-11-23T12:00:00Z");
  const other = await mk("a different kind", "other", null);
  for (const b of [gone, keep]) await pg.query("insert into public.receipts (belief_id, quote) values ($1, 'said it')", [b]);
  const n = (await pg.query<{ n: number }>("select public.comm_expire_this_week($1) as n", [NOW.toISOString()])).rows[0].n;
  assertEquals(n, 2);   // 'gone' and 'exactly now'
  const left = (await pg.query<{ id: string }>("select id from public.beliefs where comm_kind is not null order by label")).rows.map((r) => r.id);
  assert(left.includes(keep) && left.includes(other) && !left.includes(gone) && !left.includes(edge));
  assertEquals((await pg.query("select 1 from public.receipts")).rows.length, 1);   // the expired row's receipt went with it
  assertEquals((await pg.query<{ n: number }>("select public.comm_expire_this_week($1) as n", [NOW.toISOString()])).rows[0].n, 0);
  assertEquals((await pg.query("select 1 from public.beliefs where level = 'L3'")).rows.length, 1);   // the old row is never touched
  await pg.exec("drop function if exists public.comm_expire_this_week(timestamptz);");
  await assertRejects(() => pg.query("select public.comm_expire_this_week()"));
});
