// Contract v1.66 (migration 0057): kenning voice (CPO 12 Nov 20:45Z (1), option A) and own kennings (Q-ENG-OWN-KENNING, F4b).
// own_wording is set only by the person (an edit, or the exact offered text confirmed on Y5); offered_wording is Talk's
// first-person offer on a guess, through the statement's checks; POST /beliefs makes a typed line a confirmed kenning with one
// receipt, after the law 8 floor. Fake database and PGlite, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { routes } from "../api/lib/router.ts";
import "../api/map.ts";
import "../api/kennings.ts";
import "../api/share_items.ts";
import { runChecks, isFirstPerson, ownWordingProblem, readTurnReply } from "../engine/talk/checks.ts";
import { beliefFromRow } from "../api/lib/state.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const ME = "00000000-0000-4000-8000-0000000000c1", JAN = "00000000-0000-4000-8000-0000000000c2";
type R = Record<string, unknown>;

function world(): FakeTables {
  const [a, b] = ME < JAN ? [ME, JAN] : [JAN, ME];
  return {
    profiles: [{ id: ME, name: "Maya" }, { id: JAN, name: "Jan" }],
    links: [{ person_a: a, person_b: b, status: "active", created_at: "2026-10-01T00:00:00Z" }],
    beliefs: [
      { id: "g1", owner: ME, label: "Quiet thinking", statement: "Part of you goes quiet while you think.", offered_wording: "I go quiet when I'm thinking.",
        own_wording: null, type: "how I tend to react", kind: "everyday", area: "relationships", domains: ["close_relationships"], status: "guess",
        rating: null, source: "talk", created_at: "2026-11-10T00:00:00Z" },
      { id: "g2", owner: ME, label: "Say it's fine", statement: "You may say it's fine when it isn't.", offered_wording: "I say it's fine when it isn't.",
        own_wording: null, type: "something I do to cope", kind: "rule", area: "relationships", domains: ["close_relationships"], status: "guess",
        rating: null, source: "talk", created_at: "2026-11-11T00:00:00Z" },
    ],
    receipts: [], belief_links: [], outside_perspectives: [], share_items: [],
  };
}

async function call(tables: FakeTables, method: string, path: string, body: R = {}) {
  const r = routes.find((x) => x.method === method && x.pattern.test(path));
  assert(r, `no route ${method} ${path}`);
  const m = path.match(r.pattern)!;
  const params: Record<string, string> = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
  const base = fakeClient(tables);
  // The shared fake has no .or() or .upsert(): every link row here is mine, and each grant is written once.
  // deno-lint-ignore no-explicit-any
  const db = { from: (n: string) => { const q = base.from(n) as any; q.or = () => q; q.upsert = (v: R) => q.insert(v); return q; } };
  const res = await r.handler({
    env: {} as never, req: new Request("https://presence.invalid" + path, { method }), url: new URL("https://presence.invalid" + path),
    params, caller: { id: ME, isPreview: false, db, profile: {} }, service: db, tz: "UTC", body: () => Promise.resolve(body),
  } as never).catch((e: unknown) => e as { code: string; extra?: R });
  if (!(res instanceof Response)) return { status: 0, json: { error: (res as { code: string }).code, ...((res as { extra?: R }).extra ?? {}) } as R };
  return { status: res.status, json: await res.json() as R };
}

Deno.test("v1.66 checks: a first-person offer passes the statement's checks or is dropped, never repaired", () => {
  assert(isFirstPerson("I go quiet when I'm thinking.") && isFirstPerson("My plans come last") && isFirstPerson("I’m the one who waits"));
  assert(!isFirstPerson("Part of you goes quiet.") && !isFirstPerson("Ideas matter"));
  assertEquals(ownWordingProblem("Part of you goes quiet.", "q", ["q"]), "not first person");
  assertEquals(ownWordingProblem("I feel like a failure at home.", "q", ["q"]), "failure");
  assertEquals(ownWordingProblem("I always end up waiting for them", "I always end up waiting for them", ["I always end up waiting for them, honestly"]), "the quote");
  // Staging, 12 Nov: "I'd rather keep the peace than make a fuss about it." offered back as "I'd rather keep the peace than make a fuss."
  assertEquals(ownWordingProblem("I'd rather keep the peace than make a fuss.", "keep the peace", ["It's always me. I'd rather keep the peace than make a fuss about it."]), "the quote");
  assertEquals(ownWordingProblem("I wait for them.", "x", ["earlier I said I wait for them a lot", "now"]), "the quote", "any turn, not only the latest");
  assertEquals(ownWordingProblem("I go quiet when I'm thinking.", "I just go quiet", ["I just go quiet and think"]), null);

  const latest = "When they talk over me I just go quiet and think about it later.";
  const belief = (own: unknown) => ({ id: null, label: "Quiet thinking", statement: "Part of you goes quiet while you think it through.", own_wording: own,
    type: "how I tend to react", level: "L4", domains: ["close_relationships"], confidence: 0.8, receipt: "I just go quiet", links: [] });
  const raw = (own: unknown) => ({ risk: { level: "none" }, reflection: "They talk over you and you go quiet.", question: "What happens next?",
    move: { kind: "follow", why: "x", gap: "self: x" }, beliefs: [belief(own)] });
  const map = { beliefs: [], consent: {}, openThreads: [] };
  const run = (own: unknown) => {
    const { reply } = readTurnReply(raw(own));
    assert(reply);
    return runChecks(reply, [latest], map as never);
  };
  const ok = run("I go quiet when people talk over me.");
  assertEquals(ok.beliefs[0].ownWording, "I go quiet when people talk over me.");
  const second = run("Part of you goes quiet.");
  assertEquals(second.beliefs.length, 1, "the belief itself is kept");
  assertEquals(second.beliefs[0].ownWording, null, "a non-first-person offer is dropped");
  assertEquals(second.needsRepair, false, "a dropped offer never costs a repair call");
  assertEquals(run(null).beliefs[0].ownWording, null);
});

Deno.test("v1.66 state: offered_wording reads into the engine's belief and back", () => {
  const b = beliefFromRow({ id: "g1", label: "x", statement: "Part of you x.", offered_wording: "I x.", type: "a view or taste", status: "guess", domains: ["self"] }, [], []);
  assertEquals(b.offeredWording, "I x.");
});

Deno.test("v1.66 kennings: suggestions carry the offer; confirming without the offered text keeps own_wording null (1b)", async () => {
  const t = world();
  let k = (await call(t, "GET", "/kennings")).json;
  const s = (k.suggested as R[]).find((x) => x.belief_id === "g1")!;
  assertEquals(s.offered_wording, "I go quiet when I'm thinking.");
  assertEquals(s.own_wording, null);
  assertEquals(s.wording, "Part of you goes quiet while you think.", "wording stays the statement");

  // A Talk review card or any surface that showed the statement confirms with the rating only.
  await call(t, "PATCH", "/beliefs/g2", { rating: "very" });
  // The Y5 card showed the offer; 'That's me' sends that exact text with the rating.
  const r = await call(t, "PATCH", "/beliefs/g1", { rating: "very", own_wording: "I go quiet when I'm thinking." });
  assertEquals(r.status, 200);
  const belief = r.json.belief as R;
  assertEquals(belief.own_wording, "I go quiet when I'm thinking.");
  assertEquals(belief.statement, "Part of you goes quiet while you think.", "statement is never rewritten (1c, 1e)");
  assertEquals(belief.offered_wording, null, "the offer is only on a guess");

  k = (await call(t, "GET", "/kennings")).json;
  const items = ((k.groups as R[])[0].items as R[]);
  const byId = Object.fromEntries(items.map((i) => [i.belief_id, i]));
  assertEquals(byId.g1.own_wording, "I go quiet when I'm thinking.");
  assertEquals(byId.g2.own_wording, null, "confirmed from the statement: own_wording stays null");
  assertEquals(byId.g2.offered_wording, null, "an unconfirmed offer is never shown on a kenning");
});

Deno.test("v1.66 edit: 'Edit the words' writes own_wording, never statement; null clears; bad input is 400", async () => {
  const t = world();
  await call(t, "PATCH", "/beliefs/g2", { rating: "partly" });
  const r = await call(t, "PATCH", "/beliefs/g2", { own_wording: "  I say   it's fine when it isn't  " });
  assertEquals((r.json.belief as R).own_wording, "I say it's fine when it isn't");
  assertEquals((r.json.belief as R).statement, "You may say it's fine when it isn't.");
  assertEquals((await call(t, "PATCH", "/beliefs/g2", { own_wording: "" })).json.error, "invalid");
  assertEquals((await call(t, "PATCH", "/beliefs/g2", { own_wording: "x".repeat(401) })).json.error, "invalid");
  assertEquals(((await call(t, "PATCH", "/beliefs/g2", { own_wording: null })).json.belief as R).own_wording, null);
});

Deno.test("v1.66 share: the list and a default grant use own_wording when set, else the statement", async () => {
  const t = world();
  await call(t, "PATCH", "/beliefs/g1", { rating: "very", own_wording: "I go quiet when I'm thinking." });
  await call(t, "PATCH", "/beliefs/g2", { rating: "very" });
  const list = (await call(t, "GET", `/links/${JAN}/share`)).json;
  const w = Object.fromEntries((list.items as R[]).map((i) => [i.belief_id, i.wording]));
  assertEquals(w.g1, "I go quiet when I'm thinking.");
  assertEquals(w.g2, "You may say it's fine when it isn't.");
  const put = await call(t, "PUT", `/links/${JAN}/share/items/g1`, { shared: true });
  assertEquals((put.json.item as R).shared_wording, "I go quiet when I'm thinking.");
});

Deno.test("v1.66 POST /beliefs: the typed line becomes a confirmed own kenning with one dated receipt, no model call", async () => {
  const t = world();
  const r = await call(t, "POST", "/beliefs", { statement: "  Quiet means I'm thinking. ", relationship: "family" });
  assertEquals(r.status, 201);
  assertEquals(r.json.state, "created");
  const b = r.json.belief as R;
  assertEquals([b.statement, b.own_wording, b.source, b.status, b.rating], ["Quiet means I'm thinking.", "Quiet means I'm thinking.", "own", "confirmed", "very"]);
  assertEquals([b.type, b.kind, b.area], ["something I believe is true", "foundation", "family"]);
  assertEquals(b.offered_wording, null);
  assertEquals(t.receipts.length, 1);
  assertEquals(t.receipts[0].quote, "Quiet means I'm thinking.");
  assertEquals(t.receipts[0].belief_id, b.belief_id);
  assert(String(t.receipts[0].said_at).startsWith(new Date().toISOString().slice(0, 10)), "today's date (law 2)");
  assertEquals((b.receipts as R[]).length, 1);
  // It is a kenning like any other: on You, offerable to Jan.
  const k = (await call(t, "GET", "/kennings")).json;
  assert(JSON.stringify(k.groups).includes(String(b.belief_id)));
  assertEquals((await call(t, "POST", "/beliefs", { statement: "I'm the one who plans.", relationship: "coworker" })).json.belief && true, true);
  assertEquals(((await call(t, "POST", "/beliefs", { statement: "I'm the one who plans." })).json.belief as R).area, "relationships");
});

Deno.test("v1.66 POST /beliefs: law 8 floor stores nothing and answers with resources; bad input is 400", async () => {
  const t = world();
  const r = await call(t, "POST", "/beliefs", { statement: "I want to kill myself." });
  assertEquals(r.status, 200);
  assertEquals(r.json.state, "safety");
  assertEquals(r.json.belief, null);
  assert(r.json.resources);
  assertEquals(t.beliefs.length, 2, "nothing stored");
  assertEquals(t.receipts.length, 0);
  assertEquals((await call(t, "POST", "/beliefs", {})).json.field, "statement");
  assertEquals((await call(t, "POST", "/beliefs", { statement: "   " })).json.field, "statement");
  assertEquals((await call(t, "POST", "/beliefs", { statement: "x".repeat(401) })).json.field, "statement");
  assertEquals((await call(t, "POST", "/beliefs", { statement: "I plan.", relationship: "boss" })).json.field, "relationship");
  assertEquals(t.beliefs.length, 2);
});

Deno.test("migration 0057: own_wording and offered_wording columns, source 'own' accepted, other sources still refused", async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create schema extensions; create function extensions.digest(b bytea, t text) returns bytea language sql as $$ select b $$;
    create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
    create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
    create schema net; create function net.http_post(url text, body jsonb default null, headers jsonb default null, params jsonb default null, timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const names = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  for (const n of names) await pg.exec((await Deno.readTextFile(new URL(n, dir))).replace(/create extension[^;]*;/gi, ""));
  const id = crypto.randomUUID();
  await pg.query("insert into auth.users(id) values ($1)", [id]);
  await pg.query("insert into profiles(id, name) values ($1, 'Maya')", [id]);
  const ins = (source: string, own: string | null) => pg.query(
    `insert into beliefs(owner, label, statement, own_wording, type, kind, level, area, domains, status, rating, source)
     values ($1, 'In my words', 'Quiet means I''m thinking.', $3, 'something I believe is true', 'foundation', 'L0', 'relationships', '{close_relationships}', 'confirmed', 'very', $2) returning own_wording, offered_wording`,
    [id, source, own]);
  const row = (await ins("own", "Quiet means I'm thinking.")).rows[0] as R;
  assertEquals(row.own_wording, "Quiet means I'm thinking.");
  assertEquals(row.offered_wording, null);
  await ins("talk", null);
  let refused = false;
  try { await ins("typed", null); } catch { refused = true; }
  assert(refused, "an unknown source is still refused");
  refused = false;
  try { await ins("own", ""); } catch { refused = true; }
  assert(refused, "an empty own_wording is refused");

  // The staging backfill (CPO (1f)): first-person kennings only, text unchanged; idempotent.
  const add = (statement: string, status = "confirmed", rating: string | null = "very") => pg.query(
    `insert into beliefs(owner, label, statement, type, kind, level, area, domains, status, rating, source)
     values ($1, 'x', $2, 'a view or taste', 'everyday', 'L3', 'relationships', '{self}', $3, $4, 'talk')`, [id, statement, status, rating]);
  for (const st of ["I go quiet when I'm thinking.", "My plans come last.", "I’m the one who waits.", "Part of you feels unseen.",
    "If plans change, part of you waits.", "Ideas matter to you.", "Keeping the peace"]) await add(st);
  await add("I keep score.", "guess", null);
  await add("I say it's fine.", "set_aside", "not");
  const sql = await Deno.readTextFile(new URL("../scripts/backfill_own_wording_0057.sql", import.meta.url));
  await pg.exec(sql);
  await pg.exec(sql);
  const got = (await pg.query("select statement from beliefs where source = 'talk' and own_wording = statement order by statement")).rows
    .map((r) => (r as R).statement);
  assertEquals(got, ["I go quiet when I'm thinking.", "I’m the one who waits.", "My plans come last."]);
});
