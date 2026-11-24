// J1 (d-all-journey-test-16nov Step 4): the three staging journey fixtures and their reset, against the real migrations in PGlite.
// The SQL under test is what `seed_staging_journeys.py --dry-run` prints, with each <persona> placeholder swapped for an auth user id,
// so the test runs the script's own statements and nothing is copied here.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const script = new URL("../scripts/seed_staging_journeys.py", import.meta.url).pathname;
const PERSONAS = ["journeyday1", "journeyweek1", "journeymonth1", "journeywk-rae", "journeymo-teo", "journeymo-ada", "journeymo-noa", "journeywk-sol", "journeymo-ines"];

async function db() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create schema extensions; create function extensions.digest(b bytea, t text) returns bytea language sql as $$ select b $$;
    create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
    create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
    create schema net; create function net.http_post(url text, body jsonb default null, headers jsonb default null, params jsonb default null, timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  for (const n of [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort()) {
    await pg.exec((await Deno.readTextFile(new URL(n, dir))).replace(/create extension[^;]*;/gi, ""));
  }
  return pg;
}

async function printed(...args: string[]): Promise<string> {
  const out = await new Deno.Command("python3", { args: ["-I", script, "--dry-run", ...args], stdout: "piped", stderr: "piped" }).output();
  assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout);
}

function withIds(sql: string, ids: Record<string, string>): string {
  return sql.replace(/<([a-z0-9-]+)>/g, (m, p) => ids[p] ?? m);
}

async function users(pg: PGlite) {
  const ids: Record<string, string> = {};
  for (const p of PERSONAS) {
    ids[p] = crypto.randomUUID();
    await pg.query("insert into auth.users(id) values ($1)", [ids[p]]);
  }
  return ids;
}

// every table with a column that points at profiles, and the rows it holds for the fixture ids
async function footprint(pg: PGlite, ids: Record<string, string>): Promise<Record<string, number>> {
  const fks = await pg.query(`select c.conrelid::regclass::text as tbl, a.attname as col from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.conrelid <> 'public.profiles'::regclass order by 1, 2`);
  const all = Object.values(ids);
  const out: Record<string, number> = {};
  for (const r of fks.rows as { tbl: string; col: string }[]) {
    const n = await pg.query(`select count(*)::int as n from ${r.tbl} where ${r.col} = any($1::uuid[])`, [all]);
    out[`${r.tbl}.${r.col}`] = (n.rows[0] as { n: number }).n;
  }
  return out;
}

async function count(pg: PGlite, sql: string, args: unknown[] = []): Promise<number> {
  return ((await pg.query(sql, args)).rows[0] as { n: number }).n;
}

Deno.test("day1 is a bare account; week1 and month1 hold what the COO named", async () => {
  const pg = await db();
  const ids = await users(pg);
  await pg.exec(withIds(await printed("all"), ids));
  const own = (p: string) => ids[p];
  // day1: first launch only
  for (const t of ["conversations", "beliefs", "bridges", "drafts", "check_ins", "parked_notes"]) {
    const col = t === "bridges" ? "sender" : t === "check_ins" || t === "drafts" || t === "conversations" || t === "beliefs" ? "owner" : "writer";
    assertEquals(await count(pg, `select count(*)::int n from ${t} where ${col} = $1`, [own("journeyday1")]), 0, `day1 ${t}`);
  }
  assertEquals(await count(pg, "select count(*)::int n from links where person_a = $1 or person_b = $1", [own("journeyday1")]), 0);
  // week1: one person joined (one more removed), a few kennings each with a receipt, one bridge each way
  assertEquals(await count(pg, "select count(*)::int n from links where (person_a = $1 or person_b = $1) and status = 'active'", [own("journeyweek1")]), 1);
  assertEquals(await count(pg, "select count(*)::int n from beliefs where owner = $1 and status = 'confirmed'", [own("journeyweek1")]), 4);
  assertEquals(await count(pg, "select count(*)::int n from receipts where owner = $1", [own("journeyweek1")]), 5); // four kennings and the set-aside one
  assertEquals(await count(pg, "select count(*)::int n from bridges where sender = $1 and receiver = $2", [own("journeyweek1"), own("journeywk-rae")]), 1);
  assertEquals(await count(pg, "select count(*)::int n from bridges where sender = $2 and receiver = $1", [own("journeyweek1"), own("journeywk-rae")]), 2); // the ready one and the sealed one
  // month1: three people, many kennings, check-ins, a draft, a scheduled row, a parked note, older history
  const m = own("journeymonth1");
  assertEquals(await count(pg, "select count(*)::int n from links where (person_a = $1 or person_b = $1) and status = 'active'", [m]), 3);
  assert(await count(pg, "select count(*)::int n from beliefs where owner = $1 and status = 'confirmed'", [m]) >= 12);
  assertEquals(await count(pg, "select count(*)::int n from beliefs a where a.owner = $1 and not exists (select 1 from receipts r where r.belief_id = a.id)", [m]), 0, "every kenning has a receipt");
  assertEquals(await count(pg, "select count(*)::int n from check_ins where owner = $1 and status = 'active'", [m]), 2);
  assert(await count(pg, "select count(*)::int n from check_in_dates where owner = $1", [m]) >= 1);
  assertEquals(await count(pg, "select count(*)::int n from drafts where owner = $1", [m]), 1);
  assertEquals(await count(pg, "select count(*)::int n from bridges where sender = $1 and status = 'scheduled' and deliver_at > now()", [m]), 1);
  assertEquals(await count(pg, "select count(*)::int n from parked_notes where writer = $1", [m]), 1);
  assert(await count(pg, "select count(*)::int n from conversations where owner = $1 and started_at < now() - interval '14 days'", [m]) >= 2);
  assert(await count(pg, "select count(*)::int n from beliefs where owner = $1 and comm_kind is not null", [m]) >= 1);
  // every fixture account is flagged test and fictional
  assertEquals(await count(pg, "select count(*)::int n from profiles where id = any($1::uuid[]) and account_kind = 'test' and not is_example", [Object.values(ids)]), 9);
});

Deno.test("PSY 4d: week1 and month1 each hold a sealed unopened card, a set-aside item and a removed person; day1 holds none", async () => {
  const pg = await db();
  const ids = await users(pg);
  await pg.exec(withIds(await printed("all"), ids));
  for (const [p, sealedFrom, gone] of [["journeyweek1", "journeywk-rae", "journeywk-sol"], ["journeymonth1", "journeymo-ada", "journeymo-ines"]]) {
    const o = ids[p];
    // sealed: to the owner, not yet due, never opened, the heads-up bubble on; the sender's side is untouched
    assertEquals(await count(pg, "select count(*)::int n from bridges where receiver = $1 and sender = $2 and status = 'scheduled' and opened_at is null and deliver_at > now() + interval '1 day' and heads_up", [o, ids[sealedFrom]]), 1, `${p} sealed card`);
    // set aside: Not me, kept and marked, with its receipt and its own words, off the confirmed map
    assertEquals(await count(pg, "select count(*)::int n from beliefs where owner = $1 and status = 'set_aside' and rating = 'not' and set_aside_at is not null and confirmed_at is null", [o]), 1, `${p} set-aside`);
    assertEquals(await count(pg, "select count(*)::int n from beliefs b where b.owner = $1 and b.status = 'set_aside' and exists (select 1 from receipts r where r.belief_id = b.id)", [o]), 1, `${p} set-aside receipt`);
    // removed: the link is removed, the removal event is the owner's and hidden from the removed person, the withdrawn bridge is silent
    assertEquals(await count(pg, "select count(*)::int n from links where status = 'removed' and (person_a = $1 and person_b = $2 or person_a = $2 and person_b = $1)", [o, ids[gone]]), 1, `${p} removed link`);
    assertEquals(await count(pg, "select count(*)::int n from thread_events where type = 'removed' and person_a = $1 and person_b = $2 and not visible_to_b", [o, ids[gone]]), 1, `${p} removal hidden from the removed person`);
    assertEquals(await count(pg, "select count(*)::int n from bridges where sender = $1 and receiver = $2 and status = 'withdrawn' and withdrawn_at is not null", [o, ids[gone]]), 1, `${p} withdrawn bridge`);
    assertEquals(await count(pg, "select count(*)::int n from thread_events where type = 'withdrew' and (person_a = $1 or person_b = $1)", [o]), 0, `${p} no withdrew event: the removal was silent`);
  }
  for (const t of ["beliefs", "bridges", "thread_events"]) {
    const col = t === "bridges" ? "sender" : t === "thread_events" ? "person_a" : "owner";
    assertEquals(await count(pg, `select count(*)::int n from ${t} where ${col} = $1`, [ids.journeyday1]), 0, `day1 ${t}`);
  }
});

Deno.test("reset returns each fixture to the same state, and removes what a run added", async () => {
  const pg = await db();
  const ids = await users(pg);
  await pg.exec(withIds(await printed("all"), ids));
  const fresh = await footprint(pg, ids);
  // a journey run adds its own rows on every fixture: a talk, a kenning with receipt, a bridge, a draft, a note, a check-in, a session
  for (const p of ["journeyday1", "journeyweek1", "journeymonth1"]) {
    const o = ids[p];
    const other = ids[p === "journeyday1" ? "journeyweek1" : p === "journeyweek1" ? "journeywk-rae" : "journeymo-ada"];
    const conv = (await pg.query("insert into conversations(owner, title) values ($1, 'run') returning id", [o])).rows[0] as { id: string };
    const msg = (await pg.query("insert into messages(conversation_id, owner, role, turn, text) values ($1,$2,'me',1,'a run line') returning id", [conv.id, o])).rows[0] as { id: string };
    const bel = (await pg.query("insert into beliefs(owner, label, statement, type, kind, area, conversation_id) values ($1,'x','run kenning','a rule I live by','rule','work',$2) returning id", [o, conv.id])).rows[0] as { id: string };
    await pg.query("insert into receipts(owner, belief_id, message_id, conversation_id, quote) values ($1,$2,$3,$4,'a run line')", [o, bel.id, msg.id, conv.id]);
    await pg.query("insert into bridges(sender, receiver, original, final, used, deliver_at) values ($1,$2,'run','run','mine', now())", [o, other]);
    await pg.query("insert into parked_notes(writer, partner, text) values ($1,$2,'run note')", [o, other]);
    await pg.query("insert into drafts(owner, other, text) values ($1,$2,'run draft') on conflict (owner, other) do update set text = 'run draft'", [o, other]);
    await pg.query("update profiles set name = 'Renamed in a run' where id = $1", [o]);
  }
  const dirty = await footprint(pg, ids);
  assert(JSON.stringify(dirty) !== JSON.stringify(fresh), "the run changed something");
  await pg.exec(withIds(await printed("--reset", "all"), ids));
  assertEquals(await footprint(pg, ids), fresh);
  assertEquals(await count(pg, "select count(*)::int n from profiles where id = $1 and name = 'Day One (test)'", [ids.journeyday1]), 1);
  // and a second reset is the same again
  await pg.exec(withIds(await printed("--reset", "all"), ids));
  assertEquals(await footprint(pg, ids), fresh);
});

Deno.test("a reset of one fixture leaves the other fixtures and every other account alone", async () => {
  const pg = await db();
  const ids = await users(pg);
  const real = crypto.randomUUID();
  await pg.query("insert into auth.users(id) values ($1)", [real]);
  await pg.query("insert into profiles(id, name) values ($1, 'A real person')", [real]);
  await pg.query("insert into conversations(owner, title) values ($1, 'private')", [real]);
  await pg.exec(withIds(await printed("all"), ids));
  await pg.query("insert into parked_notes(writer, partner, text) values ($1,$2,'run note')", [ids.journeymonth1, ids["journeymo-teo"]]);
  await pg.exec(withIds(await printed("--reset", "week1"), ids));
  assertEquals(await count(pg, "select count(*)::int n from parked_notes where writer = $1", [ids.journeymonth1]), 2, "month1 untouched (seed note + run note)");
  assertEquals(await count(pg, "select count(*)::int n from conversations where owner = $1", [real]), 1, "a real account is untouched");
});

Deno.test("the reset refuses an id that is not a journey test account", async () => {
  const pg = await db();
  const ids = await users(pg);
  await pg.exec(withIds(await printed("all"), ids));
  await pg.query("update profiles set account_kind = null where id = $1", [ids["journeywk-rae"]]);
  const sql = withIds(await printed("--reset", "week1"), ids);
  // the profile block of the printed run would re-flag it, so run the sweep alone
  const sweep = sql.slice(sql.indexOf("begin;\ndo $reset$"), sql.indexOf("commit;", sql.indexOf("$reset$;")) + 7);
  await assertRejects(() => pg.exec(sweep), Error, "not journey test accounts");
});
