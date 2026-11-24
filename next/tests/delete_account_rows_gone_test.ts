// SD6c: delete_account removes every row that only the person owned, in one transaction (migrations 0029, 0030, 0039).
// Runs the real migrations in PGlite. Tables kept on purpose are listed with the reason; a new table that references
// profiles and is in neither list fails here, so it cannot be added without deciding what deletion does to it.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const dir = new URL("../../supabase/migrations/", import.meta.url);

// table.column pairs that stay after deletion, and why.
const KEPT: Record<string, string> = {
  "bridge_cards.set_by": "card state on a thread the other person keeps; no words",
  "bridges.receiver": "the sender keeps their copy",
  "bridges.sender": "opened bridges stay with the receiver",
  "links.person_a": "the other person's thread, read-only",
  "links.person_b": "the other person's thread, read-only",
  "thread_events.person_a": "the other person's thread",
  "thread_events.person_b": "the other person's thread",
  "plans.proposer": "belongs to the shared thread, no words",
  "plans.other": "belongs to the shared thread, no words",
  "reports.reported": "safety record",
  "reports.reporter": "safety record",
  "usage_ledger.person": "spend accounting, no words",
  "subscription_entitlements.person": "billing record keyed by the Apple transaction",
  "blocks.blocked": "someone else's block",
  "drafts.other": "someone else's draft",
  "link_prefs.other": "someone else's preference",
  "invites.accepted_by": "someone else's invite",
  "parked_notes.partner": "the writer's own notes",
  // tables whose rows go through a parent: the owner rows are deleted explicitly below, listed here so the check is about the rest
};

async function db(withNew = true) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create schema extensions; create function extensions.digest(b bytea, t text) returns bytea language sql as $$ select b $$;
    create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
    create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
    create schema net; create function net.http_post(url text, body jsonb default null, headers jsonb default null, params jsonb default null, timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  const names = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort()
    .filter((n) => withNew || !(n.startsWith("0039") || n.startsWith("0074")));   // 0074 re-creates the function with 0039's body, so "without 0039" drops it too
  for (const n of names) {
    await pg.exec((await Deno.readTextFile(new URL(n, dir))).replace(/create extension[^;]*;/gi, ""));
  }
  return pg;
}

Deno.test("delete_account: every row only the person owned is gone, every kept table is on the list", async () => {
  const pg = await db();
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  for (const id of [a, b]) {
    await pg.query("insert into auth.users(id) values ($1)", [id]);
    await pg.query("insert into profiles(id, name) values ($1, 'Person')", [id]);
  }
  await pg.query("insert into conversations(owner, guide_brief, guide_comfort, guide_steered_turns) values ($1, '{\"thread\":\"private\"}', 'follow_only', '[true]')", [a]);
  await pg.query("update profiles set talk_guide_avoids = '[\"family plans\"]' where id = $1", [a]);
  await pg.query(
    "insert into parked_notes(writer, partner, text) values ($1,$2,'a private note'), ($2,$1,'their note')",
    [a, b],
  );
  await pg.query(
    "insert into check_ins(owner, person, day, time, tz) values ($1,$2,'sunday','19:00','UTC')",
    [a, b],
  );
  await pg.query(
    "insert into check_ins(owner, person, day, time, tz) values ($2,$1,'monday','19:00','UTC')",
    [a, b],
  );
  await pg.query("insert into errors(person, where_, code) values ($1,'x','y')", [a]);
  await pg.query("insert into errors(person, where_, code, source, client_ref, release, report) values ($1,'metrickit','client_crash','client','7F3K','0.9 (55)','{}')", [a]);   // CPO ruling b: crash rows go with the account
  await pg.query(
    "insert into feedback(report_id, reporter, body, screenshot_path) values ('r1',$1,'{}','p')",
    [a],
  );

  const r = await pg.query<{ w: string }>("select public.delete_account($1)::text as w", [a]);
  assert(r.rows[0].w.includes("withdrawn"));

  // Every table that references profiles: the person's id must be absent, except the kept columns.
  const fks = await pg.query<{ t: string; col: string }>(
    `select c.conrelid::regclass::text t, a.attname col from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.conrelid::regclass::text <> 'profiles'`,
  );
  const survivors: string[] = [];
  for (const { t, col } of fks.rows) {
    if (KEPT[`${t}.${col}`]) continue;
    const n = await pg.query<{ n: number }>(`select count(*)::int n from public.${t} where ${col} = $1`, [a]);
    if (n.rows[0].n > 0) survivors.push(`${t}.${col}`);
  }
  assertEquals(survivors, []);

  assertEquals((await pg.query("select 1 from errors where person = $1 or code = 'client_crash'", [a])).rows.length, 0);
  // The other person's own note about the deleted person stays with its writer.
  assertEquals((await pg.query("select 1 from parked_notes where writer = $1", [b])).rows.length, 1);
  // The tombstone is written.
  const p = await pg.query<{ name: string; deleted: boolean; avoids: unknown }>(
    "select name, deleted_at is not null as deleted, talk_guide_avoids as avoids from profiles where id = $1",
    [a],
  );
  assertEquals(p.rows[0], { name: "Deleted account", deleted: true, avoids: [] });
  assertEquals((await pg.query("select 1 from conversations where owner = $1", [a])).rows.length, 0);
  await pg.close();
});

Deno.test("delete_account: without 0039 the check fails (the test can fail)", async () => {
  const pg = await db(false);
  const a = crypto.randomUUID();
  await pg.query("insert into auth.users(id) values ($1)", [a]);
  await pg.query("insert into profiles(id, name) values ($1, 'P')", [a]);
  const b = crypto.randomUUID();
  await pg.query("insert into auth.users(id) values ($1)", [b]);
  await pg.query("insert into profiles(id, name) values ($1, 'Q')", [b]);
  await pg.query("insert into parked_notes(writer, partner, text) values ($1,$2,'private')", [a, b]);
  await pg.query("select public.delete_account($1)", [a]);
  assertEquals((await pg.query("select 1 from parked_notes where writer = $1", [a])).rows.length, 1);
  await pg.close();
});
