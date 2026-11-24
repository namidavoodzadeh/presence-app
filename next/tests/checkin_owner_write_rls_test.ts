// Migration 0047: the owner can write their own check_ins and check_in_dates rows under row level security; nobody else's.
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
  await pg.exec("grant usage on schema public, auth to authenticated; grant all on public.check_ins, public.check_in_dates to authenticated; grant select on auth.users to authenticated;");
  return pg;
}

Deno.test("owner writes their own check-in rows under RLS, never another owner's", async () => {
  const pg = await db();
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  for (const id of [a, b]) {
    await pg.query("insert into auth.users(id) values ($1)", [id]);
    await pg.query("insert into profiles(id, name) values ($1, 'Person')", [id]);
  }
  await pg.exec("set role authenticated");
  await pg.query("select set_config('app.uid', $1, false)", [a]);
  await pg.query("insert into check_ins(owner, person, day, time, tz) values ($1,$2,'sunday','19:00','UTC')", [a, b]);
  await pg.query("update check_ins set time = '20:00' where owner = $1", [a]);
  assertEquals((await pg.query<{ time: string }>("select time from check_ins where owner = $1", [a])).rows[0].time, "20:00");
  await pg.query("insert into check_in_dates(owner, person, on_date, time, tz) values ($1,$2,'2026-12-01','19:00','UTC')", [a, b]);
  await pg.query("update check_in_dates set time = '20:00' where owner = $1", [a]);
  // Another owner's row is refused.
  await assertRejects(() => pg.query("insert into check_ins(owner, person, day, time, tz) values ($1,$2,'monday','19:00','UTC')", [b, a]), Error, "row-level security");
  await assertRejects(() => pg.query("insert into check_in_dates(owner, person, on_date, time, tz) values ($1,$2,'2026-12-02','19:00','UTC')", [b, a]), Error, "row-level security");
  assert(true);
});
