// Issue #5. Acceptance test written in C4 from packages/01 (routes.md "Not ready" 3, flows/invite.md) and
// next/api/CONTRACT.md §6 "People and invites" only. The invite gives before it asks: one item the inviter chose.
//
// API the tests expect:
// - `POST /invites {relationship?, gift?: {item_id}}`. `relationship` is `partner | friend | family`; any other value is
//   `400 {error: "invalid", field: "relationship"}`. `gift.item_id` must be the caller's own active communication item
//   (`status: confirmed`, `comm_status: active`) of an invite kind (`how_i_mean`, `feels_like_care`, `bring_up`) whose
//   scope is not one person (`comm_scope_type` `everyone` or `type`); anything else (someone else's item, an unknown id,
//   another kind, `private_only`, set aside, deleted, an old kenning with no kind, a person scope) is
//   `403 {error: "forbidden", reason: "not_giftable"}` and no invite is made. The invite keeps the item id and a copy of
//   its words at that moment. A body of `{}` (every caller before this change) still makes an invite, with no gift.
// - `GET /invites/:code` answers exactly `{inviter: {name, initial}, expires_at, gift: {kind, wording} | null,
//   way_in}`: `way_in` is `invited_by_partner` for `relationship: partner`, `invited_by_friend` for friend or family.
//   `gift.wording` is the copy kept at invite time. Nothing else about the inviter.
// - `POST /invites/:code/accept` also writes the per-person grant for the gift (`share_items` row: owner = inviter,
//   other = joiner, belief_id = the item) and the inviter's `relationship` on the link (`link_prefs` row owner = inviter,
//   other = joiner). Nothing is shared and no relationship is written before the accept; nothing else is shared after.
// - If the item is set aside (`comm_status: set_aside`) before the accept, `GET` shows `gift: null` and the accept
//   writes no grant (the link is still made).
//
// How the test runs (no implementation read): the real handlers registered by `next/api/index.ts` run with a caller
// client whose `from()` is `tests/fake_supabase.ts` and whose `rpc()` runs the real database functions (`peek_invite`,
// `accept_invite`, and any the builder adds) on PGlite with every migration in `supabase/migrations/` applied, as the
// signed-in caller, the way `tests/invite_single_use_test.ts` runs them. The gift item is seeded in both stores. The
// invite row `POST /invites` writes through `from("invites")` is copied, every column as written (except the fake's
// non-uuid `id` and `created_at`), into PGlite before the joiner reads it, so the columns the handler writes must exist in
// the migrations and the database functions must read them. Column names are the builder's choice.
// Left out (package gaps, see the issue): `way_in` without a relationship (only checked to be one of the two values);
// the wording stored on the grant.
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
interface RouteLike {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: (ctx: unknown) => Promise<Response>;
}
interface FakeClientLike {
  from: (table: string) => unknown;
}

const LEA = "00000000-0000-4000-8000-000000000091"; // the inviter
const JO = "00000000-0000-4000-8000-000000000092"; // the invited person
const SAM = "00000000-0000-4000-8000-000000000093"; // someone else
const ITEM = "00000000-0000-4000-8000-0000000000b1";
const WORDING = "When I go quiet, I'm thinking, not upset.";

async function repoRoot(): Promise<URL> {
  let dir = new URL("./", import.meta.url);
  for (let i = 0; i < 8; i++) {
    try {
      await Deno.stat(new URL("AGENTS.md", dir));
      return dir;
    } catch { dir = new URL("../", dir); }
  }
  throw new Error("repository root (AGENTS.md) not found above " + import.meta.url);
}

/** A communication item as POST /comm/items stores it (CONTRACT v1.85, v1.91, v1.93), for both stores. */
function item(id: string, owner: string, over: Row = {}): Row {
  const wording = (over.statement as string | undefined) ?? WORDING;
  return {
    id, owner, label: "How I mean things", statement: wording, own_wording: wording,
    type: "something I believe is true", kind: "everyday", area: "relationships", status: "confirmed", rating: "very",
    source: "own", comm_kind: "how_i_mean", comm_scope_type: "everyone", comm_scope_value: null, comm_status: "active",
    comm_source: "typed", comm_native: true, confirmed_at: "2026-11-20T10:00:00.000Z", created_at: "2026-11-20T10:00:00.000Z",
    ...over,
  };
}

async function insertRow(pg: PGlite, table: string, row: Row) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => {
    const v = row[c];
    return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
  });
  await pg.query(
    `insert into public.${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    vals,
  );
}

async function world(items: Row[]) {
  const root = await repoRoot();
  const router = await import(new URL("next/api/lib/router.ts", root).href) as { routes: RouteLike[] };
  await import(new URL("next/api/index.ts", root).href);
  const errors = await import(new URL("next/api/lib/errors.ts", root).href) as {
    ApiError: new (...a: never[]) => Error & { code: string; extra: Record<string, unknown> };
    errorReply: (code: string, ref: string, message: string, extra?: Record<string, unknown>) => Response;
  };
  const fake = await import(new URL("next/tests/fake_supabase.ts", root).href) as {
    fakeClient: (t: Tables) => FakeClientLike;
  };

  // The database functions, on PGlite with every migration (the same bootstrap as tests/invite_single_use_test.ts).
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create schema extensions; create function extensions.digest(b bytea, t text) returns bytea language sql as $$ select b $$;
    create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
    create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
    create schema net; create function net.http_post(url text, body jsonb default null, headers jsonb default null, params jsonb default null, timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  const dir = new URL("supabase/migrations/", root);
  const names = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  for (const n of names) await pg.exec((await Deno.readTextFile(new URL(n, dir))).replace(/create extension[^;]*;/gi, ""));
  await pg.exec("grant usage on schema public, auth to authenticated;");
  const people: [string, string][] = [[LEA, "Lea"], [JO, "Jo"], [SAM, "Sam"]];
  for (const [id, name] of people) {
    await pg.query("insert into auth.users(id) values ($1)", [id]);
    await pg.query("insert into profiles(id, name) values ($1, $2)", [id, name]);
  }
  for (const it of items) await insertRow(pg, "beliefs", it);

  const t: Tables = {
    profiles: people.map(([id, name]) => ({ id, name, initial: name[0], tz: "UTC" })),
    beliefs: items.map((it) => ({ ...it })),
    links: [], link_prefs: [], share_items: [],
  };

  // One query at a time, each as its caller (null = the service role).
  let lock: Promise<unknown> = Promise.resolve();
  function sql<T>(who: string | null, text: string, params: unknown[] = []) {
    const run = async () => {
      await pg.exec("reset role");
      await pg.query("select set_config('app.uid', $1, false)", [who ?? ""]);
      if (who) await pg.exec("set role authenticated");
      try { return await pg.query<T>(text, params); } finally { await pg.exec("reset role"); }
    };
    const p = lock.then(run, run);
    lock = p.catch(() => undefined);
    return p;
  }
  function client(who: string | null) {
    const base = fake.fakeClient(t);
    return {
      from: (table: string) => base.from(table),
      rpc: async (fn: string, args: Row = {}) => {
        assert(/^[a-z_][a-z0-9_]*$/.test(fn), "rpc name " + fn);
        const keys = Object.keys(args);
        try {
          const r = await sql<{ v: unknown }>(
            who, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as v`, keys.map((k) => args[k]),
          );
          return { data: r.rows[0]?.v ?? null, error: null };
        } catch (e) {
          const err = e as { message?: string; code?: string };
          return { data: null, error: { message: err.message ?? String(e), code: err.code ?? "P0001" } };
        }
      },
    };
  }

  async function call(who: string, method: string, path: string, body: Row = {}) {
    const r = router.routes.find((x) => x.method === method && x.pattern.test(path));
    assert(r, `${method} ${path} is not registered in next/api`);
    const m = r.pattern.exec(path)!;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const db = client(who);
    const url = new URL(`https://x.invalid${path}`);
    const profile = t.profiles.find((p) => p.id === who);
    const res = await r.handler({
      env: { isHosted: false, releaseBuild: false, requireAiConsent: false, commItems: true, commOwnerIds: [LEA, JO, SAM] },
      req: new Request(url, { method }), url, params,
      caller: { id: who, db, persona: null, isExample: false, isPreview: false, profile },
      service: client(null), tz: "UTC", body: () => Promise.resolve(structuredClone(body)),
    }).catch((e: unknown) => {
      if (e instanceof errors.ApiError) return errors.errorReply(e.code, "test", e.message, e.extra);
      throw e;
    });
    return { status: res.status, body: await res.json() as Row };
  }

  /** Lea makes an invite; the row it wrote through from("invites") is copied into the database as written. */
  async function invite(body: Row) {
    const before = (t.invites ?? []).length;
    const r = await call(LEA, "POST", "/invites", body);
    assertEquals(r.status, 200, JSON.stringify(r.body));
    const code = r.body.code as string;
    assert(typeof code === "string" && code.length > 0, "POST /invites answers a code");
    const written = (t.invites ?? []).slice(before);
    for (const row of written) {
      const { id: _id, created_at: _at, ...rest } = row;
      await insertRow(pg, "invites", rest);
    }
    const inDb = await sql<{ n: number }>(null, "select count(*)::int as n from invites where upper(code) = upper($1)", [code]);
    assertEquals(inDb.rows[0].n, 1, "the invite row exists for the database functions");
    return code;
  }

  const grants = async () =>
    (await sql<Row>(null, "select owner::text, other::text, belief_id::text from share_items order by created_at")).rows;
  const relationships = async () =>
    (await sql<Row>(null, "select owner::text, other::text, relationship from link_prefs where relationship is not null")).rows;
  const links = async () => (await sql<Row>(null, "select person_a::text, person_b::text, status from links")).rows;
  async function setAside(id: string) {
    for (const b of t.beliefs) if (b.id === id) b.comm_status = "set_aside";
    await sql(null, "update beliefs set comm_status = 'set_aside' where id = $1", [id]);
  }
  async function reword(id: string, wording: string) {
    for (const b of t.beliefs) if (b.id === id) Object.assign(b, { statement: wording, own_wording: wording });
    await sql(null, "update beliefs set statement = $2, own_wording = $2 where id = $1", [id, wording]);
  }
  return { t, pg, call, invite, grants, relationships, links, setAside, reword };
}

// ---------------------------------------------------------------- POST /invites

Deno.test("#5 POST /invites {relationship, gift}: an eligible item makes the invite, and the invite keeps a copy of its words", async () => {
  const w = await world([item(ITEM, LEA)]);
  const code = await w.invite({ relationship: "partner", gift: { item_id: ITEM } });
  // The inviter re-words the item after sharing the link: the invite still carries the words as they were.
  await w.reword(ITEM, "When I go quiet, I'm thinking it over.");
  const peek = await w.call(JO, "GET", `/invites/${code}`);
  assertEquals(peek.status, 200, JSON.stringify(peek.body));
  assertEquals(peek.body.gift, { kind: "how_i_mean", wording: WORDING });
});

Deno.test("#5 POST /invites: each invite kind, scoped to everyone or to a type, is giftable", async () => {
  const items = [
    item("00000000-0000-4000-8000-0000000000c1", LEA, { comm_kind: "how_i_mean" }),
    item("00000000-0000-4000-8000-0000000000c2", LEA, {
      comm_kind: "feels_like_care", label: "What feels like care", statement: "A text to say they got home feels like care.",
      comm_scope_type: "type", comm_scope_value: "partner",
    }),
    item("00000000-0000-4000-8000-0000000000c3", LEA, {
      comm_kind: "bring_up", label: "How to bring something up with me", statement: "Ask me first when it's about money.",
    }),
  ];
  const w = await world(items);
  for (const it of items) {
    const code = await w.invite({ relationship: "friend", gift: { item_id: it.id } });
    const peek = await w.call(JO, "GET", `/invites/${code}`);
    assertEquals(peek.body.gift, { kind: it.comm_kind, wording: it.statement }, String(it.comm_kind));
  }
});

Deno.test("#5 POST /invites: an item that may not be the gift is 403 not_giftable and makes no invite", async () => {
  const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  const bad: [string, Row][] = [
    ["someone else's item", item(id(1), SAM)],
    ["a kind the invite may not carry (lands_hard)", item(id(2), LEA, { comm_kind: "lands_hard", comm_status: "private_only" })],
    ["a kind the invite may not carry (matters)", item(id(3), LEA, { comm_kind: "matters" })],
    ["a kind the invite may not carry (gets_heated)", item(id(4), LEA, { comm_kind: "gets_heated", comm_scope_type: "person", comm_scope_value: SAM })],
    ["kept only for me", item(id(5), LEA, { comm_status: "private_only" })],
    ["set aside", item(id(6), LEA, { comm_status: "set_aside" })],
    ["deleted", item(id(7), LEA, { status: "deleted" })],
    ["scoped to one person", item(id(8), LEA, { comm_scope_type: "person", comm_scope_value: SAM })],
    ["an old kenning with no kind", item(id(9), LEA, {
      comm_kind: null, comm_scope_type: null, comm_scope_value: null, comm_status: null, comm_source: null, comm_native: false,
    })],
  ];
  const w = await world(bad.map(([, it]) => it));
  for (const [why, it] of [...bad, ["an unknown id", { id: id(99) }] as [string, Row]]) {
    const r = await w.call(LEA, "POST", "/invites", { relationship: "friend", gift: { item_id: it.id } });
    assertEquals([r.status, r.body.error, r.body.reason], [403, "forbidden", "not_giftable"], why);
  }
  assertEquals(w.t.invites ?? [], [], "no invite was made");
  assertEquals((await w.pg.query("select 1 from invites")).rows.length, 0);
});

Deno.test("#5 POST /invites: an unknown relationship is 400 invalid on relationship; an empty body still makes an invite with no gift", async () => {
  const w = await world([item(ITEM, LEA)]);
  for (const relationship of ["coworker", "boss", "", 3]) {
    const r = await w.call(LEA, "POST", "/invites", { relationship, gift: { item_id: ITEM } });
    assertEquals([r.status, r.body.error, r.body.field], [400, "invalid", "relationship"], JSON.stringify(relationship));
  }
  assertEquals(w.t.invites ?? [], []);
  const code = await w.invite({});
  const peek = await w.call(JO, "GET", `/invites/${code}`);
  assertEquals(peek.status, 200, JSON.stringify(peek.body));
  assertEquals(peek.body.gift, null);
  assert(["invited_by_partner", "invited_by_friend"].includes(peek.body.way_in as string), String(peek.body.way_in));
});

// ---------------------------------------------------------------- GET /invites/:code

Deno.test("#5 GET /invites/:code adds the gift and the way in, and nothing else about the inviter", async () => {
  const other = item("00000000-0000-4000-8000-0000000000b2", LEA, {
    comm_kind: "feels_like_care", statement: "A long hug after work feels like care.",
  });
  const w = await world([item(ITEM, LEA), other]);
  const code = await w.invite({ relationship: "partner", gift: { item_id: ITEM } });
  const peek = await w.call(JO, "GET", `/invites/${code}`);
  assertEquals(peek.status, 200, JSON.stringify(peek.body));
  assertEquals(Object.keys(peek.body).sort(), ["expires_at", "gift", "inviter", "way_in"]);
  assertEquals(peek.body.inviter, { name: "Lea", initial: "L" });
  assertEquals(peek.body.gift, { kind: "how_i_mean", wording: WORDING });
  assertEquals(peek.body.way_in, "invited_by_partner");
  const text = JSON.stringify(peek.body);
  for (const leak of [ITEM, LEA, String(other.statement), "relationship"]) {
    assert(!text.includes(leak), `the reply carries nothing else about the inviter: ${leak}`);
  }
});

Deno.test("#5 GET /invites/:code: way_in is invited_by_partner for a partner, invited_by_friend for a friend or family", async () => {
  const w = await world([item(ITEM, LEA)]);
  for (const [relationship, wayIn] of [["partner", "invited_by_partner"], ["friend", "invited_by_friend"], ["family", "invited_by_friend"]]) {
    const code = await w.invite({ relationship, gift: { item_id: ITEM } });
    const peek = await w.call(JO, "GET", `/invites/${code}`);
    assertEquals(peek.body.way_in, wayIn, relationship);
  }
});

// ---------------------------------------------------------------- accept

Deno.test("#5 no grant before the accept: making and reading the invite share nothing and label no one", async () => {
  const w = await world([item(ITEM, LEA)]);
  const code = await w.invite({ relationship: "partner", gift: { item_id: ITEM } });
  assertEquals((await w.call(JO, "GET", `/invites/${code}`)).status, 200);
  assertEquals((await w.call(SAM, "GET", `/invites/${code}`)).status, 200);
  assertEquals(await w.grants(), []);
  assertEquals(await w.relationships(), []);
  assertEquals(await w.links(), []);
  assertEquals(w.t.share_items, [], "no grant through the API's own client either");
  assertEquals(w.t.link_prefs, []);
});

Deno.test("#5 POST /invites/:code/accept writes the grant for the gift and the inviter's relationship on the link, nothing else", async () => {
  const other = item("00000000-0000-4000-8000-0000000000b2", LEA, {
    comm_kind: "feels_like_care", statement: "A long hug after work feels like care.",
  });
  const w = await world([item(ITEM, LEA), other]);
  const code = await w.invite({ relationship: "family", gift: { item_id: ITEM } });
  const acc = await w.call(JO, "POST", `/invites/${code}/accept`);
  assertEquals(acc.status, 200, JSON.stringify(acc.body));
  assertEquals((await w.links()).length, 1, "the two are linked");
  assertEquals(await w.grants(), [{ owner: LEA, other: JO, belief_id: ITEM }], "one grant: the gift, from the inviter to the joiner");
  assertEquals(await w.relationships(), [{ owner: LEA, other: JO, relationship: "family" }]);
});

Deno.test("#5 the gift set aside before the accept: gift is null and the accept writes no grant", async () => {
  const w = await world([item(ITEM, LEA)]);
  const code = await w.invite({ relationship: "friend", gift: { item_id: ITEM } });
  // Positive control: before it is set aside, the invite carries it.
  assertNotEquals((await w.call(JO, "GET", `/invites/${code}`)).body.gift ?? null, null);
  await w.setAside(ITEM);
  const peek = await w.call(JO, "GET", `/invites/${code}`);
  assertEquals(peek.status, 200, JSON.stringify(peek.body));
  assertEquals(peek.body.gift, null);
  const acc = await w.call(JO, "POST", `/invites/${code}/accept`);
  assertEquals(acc.status, 200, JSON.stringify(acc.body));
  assertEquals((await w.links()).length, 1, "the link is still made");
  assertEquals(await w.grants(), []);
});
