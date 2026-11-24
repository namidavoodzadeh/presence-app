// Migration 0048: the writer can park their own note under row level security; nobody can park one as another writer.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const dir = new URL("../../supabase/migrations/", import.meta.url);

Deno.test("writer parks their own note under RLS, never as another writer", async () => {
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
  await pg.exec("grant usage on schema public, auth to authenticated; grant all on public.parked_notes to authenticated; grant select on auth.users to authenticated;");
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  for (const id of [a, b]) {
    await pg.query("insert into auth.users(id) values ($1)", [id]);
    await pg.query("insert into profiles(id, name) values ($1, 'Person')", [id]);
  }
  await pg.exec("set role authenticated");
  await pg.query("select set_config('app.uid', $1, false)", [a]);
  await pg.query("insert into parked_notes(writer, partner, text) values ($1,$2,'a note')", [a, b]);
  assertEquals((await pg.query("select id from parked_notes where writer = $1", [a])).rows.length, 1);
  await assertRejects(() => pg.query("insert into parked_notes(writer, partner, text) values ($1,$2,'forged')", [b, a]), Error, "row-level security");
  await pg.query("delete from parked_notes where writer = $1", [a]);
  assertEquals((await pg.query("select id from parked_notes")).rows.length, 0);
});
