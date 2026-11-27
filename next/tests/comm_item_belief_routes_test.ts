// Issue #10. Acceptance test written in C4 from packages/01 (routes.md rows `talk` PATCH /beliefs/:id and `kenning`
// GET /beliefs/:id, "Engine to confirm"; flows/talk.md markingPartly; flows/you.md "A kenning") and
// next/api/CONTRACT.md §5 (`GET /beliefs/:id`, `PATCH /beliefs/:id`), §1.4 and the v1.85 note only.
//
// API the tests expect (CONTRACT, unchanged shapes):
// - On an item created through `POST /comm/items`, `PATCH /beliefs/:id {rating: "partly"}` answers 200 `{belief}` with
//   `belief.rating: "partly"` and `belief.status: "confirmed"` (§1.4), and stores `rating: "partly"` on the row. The item
//   stays the same communication item: kind, words, status and scope unchanged, still listed by `GET /comm/items`.
// - `GET /beliefs/:id` on such an item answers 200 `{belief, connected, receipts}` where `receipts[0]` has the item's
//   words as `quote` and a date as `said_at` (the receipt `POST /comm/items` wrote, law 2). That is what the kenning card
//   shows.
// - Both answer 404 for an id that is not the caller's (flows/you.md: a 404 closes the card).
// - The routes are registered in `next/api` (loaded through `next/api/index.ts`) and run on `tests/fake_supabase.ts`
//   behind `commItems` / `commOwnerIds` for the item's creation.
import { assert, assertEquals } from "jsr:@std/assert@1";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
interface RouteLike {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: (ctx: unknown) => Promise<Response>;
}

const ME = "00000000-0000-4000-8000-0000000000a1";
const JAN = "00000000-0000-4000-8000-0000000000a2";
const PROFILES: Row[] = [
  { id: ME, name: "Sam", tz: "UTC", created_at: "2026-11-01T00:00:00.000Z" },
  { id: JAN, name: "Jan", tz: "UTC", created_at: "2026-11-01T00:00:00.000Z" },
];
const ENV: Row = { isHosted: false, releaseBuild: false, requireAiConsent: false, commItems: true, commOwnerIds: [ME, JAN] };
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

async function api() {
  const root = await repoRoot();
  const router = await import(new URL("next/api/lib/router.ts", root).href) as { routes: RouteLike[] };
  await import(new URL("next/api/index.ts", root).href);
  const errors = await import(new URL("next/api/lib/errors.ts", root).href) as {
    ApiError: new (...a: never[]) => Error & { code: string; extra: Record<string, unknown> };
    errorReply: (code: string, ref: string, message: string, extra?: Record<string, unknown>) => Response;
  };
  const fake = await import(new URL("next/tests/fake_supabase.ts", root).href) as { fakeClient: (t: Tables) => unknown };
  return async function call(t: Tables, method: string, path: string, body: Row = {}, who = ME) {
    const r = router.routes.find((x) => x.method === method && x.pattern.test(path));
    assert(r, `${method} ${path} is not registered in next/api`);
    const m = r.pattern.exec(path)!;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const db = fake.fakeClient(t);
    const url = new URL(`https://x.invalid${path}`);
    const res = await r.handler({
      env: { ...ENV },
      req: new Request(url, { method }), url, params,
      caller: { id: who, db, persona: null, isExample: false, isPreview: false, profile: PROFILES.find((p) => p.id === who) },
      service: db, tz: "UTC", body: () => Promise.resolve(structuredClone(body)),
    }).catch((e: unknown) => {
      if (e instanceof errors.ApiError) return errors.errorReply(e.code, "test", e.message, e.extra);
      throw e;
    });
    return { status: res.status, body: await res.json() as Row };
  };
}

async function kept(call: Awaited<ReturnType<typeof api>>, t: Tables) {
  const r = await call(t, "POST", "/comm/items", { kind: "how_i_mean", wording: WORDING, source: "talk_said", scope: { type: "everyone" } });
  assertEquals(r.status, 201, JSON.stringify(r.body));
  const id = (r.body.item as Row).id as string;
  assert(typeof id === "string" && id.length > 0);
  return id;
}

Deno.test("#10 PATCH /beliefs/:id {rating: partly} on a communication item marks it Partly and keeps it the same item", async () => {
  const call = await api();
  const t: Tables = { profiles: PROFILES.map((p) => ({ ...p })) };
  const id = await kept(call, t);
  const before = { ...t.beliefs[0] };
  const r = await call(t, "PATCH", `/beliefs/${id}`, { rating: "partly" });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  const belief = r.body.belief as Row;
  assertEquals([belief.rating, belief.status], ["partly", "confirmed"]);
  const row = t.beliefs.find((b) => b.id === id)!;
  assertEquals([row.rating, row.status], ["partly", "confirmed"]);
  for (const k of ["comm_kind", "comm_status", "comm_scope_type", "comm_scope_value", "statement", "own_wording", "owner"]) {
    assertEquals(row[k], before[k], `${k} is unchanged`);
  }
  const list = await call(t, "GET", "/comm/items");
  assertEquals(list.status, 200);
  const groups = list.body.groups as { kind: string; items: Row[] }[];
  assertEquals(groups.map((g) => g.kind), ["how_i_mean"]);
  assertEquals(groups[0].items.map((i) => [i.id, i.wording]), [[id, WORDING]], "still listed in You with its words");
});

Deno.test("#10 GET /beliefs/:id on a communication item returns its receipt: the words and the date", async () => {
  const call = await api();
  const t: Tables = { profiles: PROFILES.map((p) => ({ ...p })) };
  const id = await kept(call, t);
  const r = await call(t, "GET", `/beliefs/${id}`);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals((r.body.belief as Row).belief_id, id, "the Belief shape names its id belief_id (CONTRACT §2 Card)");
  const receipts = r.body.receipts as Row[];
  assert(Array.isArray(receipts) && receipts.length >= 1, "at least one receipt: " + JSON.stringify(r.body.receipts));
  assertEquals(receipts[0].quote, WORDING);
  assert(typeof receipts[0].said_at === "string" && !Number.isNaN(Date.parse(receipts[0].said_at as string)), "said_at is a date");
});

Deno.test("#10 the receipt is still there after Partly (the kenning card after markingPartly)", async () => {
  const call = await api();
  const t: Tables = { profiles: PROFILES.map((p) => ({ ...p })) };
  const id = await kept(call, t);
  assertEquals((await call(t, "PATCH", `/beliefs/${id}`, { rating: "partly" })).status, 200);
  const r = await call(t, "GET", `/beliefs/${id}`);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals((r.body.belief as Row).rating, "partly");
  assertEquals((r.body.receipts as Row[])[0]?.quote, WORDING);
});

Deno.test("#10 both calls are 404 for someone else's communication item, and change nothing", async () => {
  const call = await api();
  const t: Tables = { profiles: PROFILES.map((p) => ({ ...p })) };
  const id = await kept(call, t);
  assertEquals((await call(t, "GET", `/beliefs/${id}`, {}, JAN)).status, 404);
  assertEquals((await call(t, "PATCH", `/beliefs/${id}`, { rating: "partly" }, JAN)).status, 404);
  assertEquals(t.beliefs[0].rating, "very");
  assertEquals((await call(t, "GET", "/beliefs/00000000-0000-4000-8000-00000000dead")).status, 404);
});
