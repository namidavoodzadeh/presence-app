// Migration 0054 (contract v1.62, Q-ENG-INVITE1): an invite code links one person and new codes last 7 days.
// Runs every migration in order on PGlite, then calls accept_invite / peek_invite as real signed-in callers.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const dir = new URL("../../supabase/migrations/", import.meta.url);

async function db() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create schema extensions; create function extensions.digest(b bytea, t text) returns bytea language sql as $$ select b $$;
    create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
    create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
    create schema net; create function net.http_post(url text, body jsonb default null, headers jsonb default null, params jsonb default null, timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  const names = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  for (const n of names) await pg.exec((await Deno.readTextFile(new URL(n, dir))).replace(/create extension[^;]*;/gi, ""));
  await pg.exec("grant usage on schema public, auth to authenticated;");
  const [owner, jo, stranger] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const [id, name] of [[owner, "Lea"], [jo, "Jo"], [stranger, "Sam"]]) {
    await pg.query("insert into auth.users(id) values ($1)", [id]);
    await pg.query("insert into profiles(id, name) values ($1, $2)", [id, name]);
  }
  const as = async (who: string) => {
    await pg.exec("reset role");
    await pg.query("select set_config('app.uid', $1, false)", [who]);
    await pg.exec("set role authenticated");
  };
  return { pg, owner, jo, stranger, as };
}

Deno.test("a new invite lasts 7 days; an existing row keeps its own date", async () => {
  const { pg, owner } = await db();
  const r = await pg.query<{ days: number }>(
    "insert into invites(code, owner) values ('NEW777', $1) returning extract(epoch from expires_at - created_at) / 86400 as days",
    [owner],
  );
  assert(Math.abs(Number(r.rows[0].days) - 7) < 0.01, `default is ${r.rows[0].days} days`);
  await pg.query("insert into invites(code, owner, expires_at) values ('OLD030', $1, now() + interval '30 days')", [owner]);
  const old = await pg.query<{ days: number }>("select extract(epoch from expires_at - now()) / 86400 as days from invites where code = 'OLD030'");
  assert(Number(old.rows[0].days) > 29, "an explicit (older) date is untouched");
});

Deno.test("a code links one person: a second person gets not_found on peek and accept, as if expired", async () => {
  const { pg, owner, jo, stranger, as } = await db();
  await pg.query("insert into invites(code, owner) values ('K7PM3Q', $1)", [owner]);

  await as(stranger);
  const peek = await pg.query<{ v: { name: string } }>("select peek_invite('K7PM3Q') as v");
  assertEquals(peek.rows[0].v.name, "Lea"); // unused: peek still answers

  await as(jo);
  const ok = await pg.query<{ v: { person: string } }>("select accept_invite('K7PM3Q') as v");
  assertEquals(ok.rows[0].v.person, owner);

  await as(stranger);
  await assertRejects(() => pg.query("select peek_invite('K7PM3Q')"), Error, "not_found");
  await assertRejects(() => pg.query("select accept_invite('K7PM3Q')"), Error, "not_found");

  await pg.exec("reset role");
  const links = await pg.query("select 1 from links where person_a = $1 or person_b = $1", [stranger]);
  assertEquals(links.rows.length, 0, "the stranger got no link");
  const all = await pg.query("select 1 from links where invite_id = (select id from invites where code = 'K7PM3Q')");
  assertEquals(all.rows.length, 1);
});

Deno.test("the joiner retrying their own accept still reads conflict, and the owner still reads invalid", async () => {
  const { pg, owner, jo, as } = await db();
  await pg.query("insert into invites(code, owner) values ('RETRY1', $1)", [owner]);
  await as(jo);
  await pg.query("select accept_invite('RETRY1')");
  await assertRejects(() => pg.query("select accept_invite('RETRY1')"), Error, "conflict");
  await as(owner);
  await assertRejects(() => pg.query("select accept_invite('RETRY1')"), Error, "invalid");
});

Deno.test("a used code stays used after the joiner's account is gone (accepted_by set null)", async () => {
  const { pg, owner, jo, stranger, as } = await db();
  await pg.query("insert into invites(code, owner) values ('GONE99', $1)", [owner]);
  await as(jo);
  await pg.query("select accept_invite('GONE99')");
  await pg.exec("reset role");
  await pg.query("delete from links where person_a = $1 or person_b = $1", [jo]);
  await pg.query("update invites set accepted_by = null where code = 'GONE99'"); // what on delete set null leaves
  await as(stranger);
  await assertRejects(() => pg.query("select accept_invite('GONE99')"), Error, "not_found");
  await assertRejects(() => pg.query("select peek_invite('GONE99')"), Error, "not_found");
});

Deno.test("revoked and expired codes are refused as before", async () => {
  const { pg, owner, jo, as } = await db();
  await pg.query("insert into invites(code, owner, revoked) values ('REV111', $1, true)", [owner]);
  await pg.query("insert into invites(code, owner, expires_at) values ('EXP111', $1, now() - interval '1 minute')", [owner]);
  await as(jo);
  for (const c of ["REV111", "EXP111"]) {
    await assertRejects(() => pg.query(`select accept_invite('${c}')`), Error, "not_found");
    await assertRejects(() => pg.query(`select peek_invite('${c}')`), Error, "not_found");
  }
});
