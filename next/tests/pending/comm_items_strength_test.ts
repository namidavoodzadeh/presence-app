// Issue #4. Acceptance test written in C4 from packages/01 (routes.md "Not ready" 2, flows/talk.md "The suggestion and
// Who sees this") and next/api/CONTRACT.md (v1.85 note, §1.4 Belief fields) only.
//
// API the tests expect:
// - `POST /comm/items` takes one more optional field, `strength: "very" | "partly"`, default `"very"`.
//   The kept item is still one `beliefs` row (v1.85); its `rating` is the strength (`"very"` or `"partly"`, §1.4) and its
//   `status` stays `"confirmed"` either way (§1.4: partly|very ⇒ confirmed). Nothing else about the item changes.
// - Any other value of `strength` (including "not", which would set an item aside) is `400 {error: "invalid",
//   field: "strength"}` and stores nothing, as every other bad field on this route is refused by its name.
// - A body without `strength` (every caller before this change) answers exactly as today: 201, rating "very".
// - The route is registered in `next/api` (loaded through `next/api/index.ts`) and runs on `tests/fake_supabase.ts`
//   behind `commItems` / `commOwnerIds`, as in `tests/comm_items_api_test.ts`.
// Left out on purpose: whether the reply's `item` echoes `strength` (the package never reads it back).
// The issue's "Done when" also needs the field in `contract/openapi.yaml`; that is checked by review, not here.
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
const PROFILE: Row = { id: ME, name: "Sam", tz: "UTC", created_at: "2026-11-01T00:00:00.000Z" };
const ENV: Row = { isHosted: false, releaseBuild: false, requireAiConsent: false, commItems: true, commOwnerIds: [ME] };

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
  const fake = await import(new URL("next/tests/fake_supabase.ts", root).href) as {
    fakeClient: (t: Tables) => unknown;
  };
  return async function call(t: Tables, method: string, path: string, body: Row = {}) {
    const r = router.routes.find((x) => x.method === method && x.pattern.test(path));
    assert(r, `${method} ${path} is not registered in next/api`);
    const m = r.pattern.exec(path)!;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const db = fake.fakeClient(t);
    const url = new URL(`https://x.invalid${path}`);
    const res = await r.handler({
      env: { ...ENV },
      req: new Request(url, { method }), url, params,
      caller: { id: ME, db, persona: null, isExample: false, isPreview: false, profile: PROFILE },
      service: db, tz: "UTC", body: () => Promise.resolve(structuredClone(body)),
    }).catch((e: unknown) => {
      if (e instanceof errors.ApiError) return errors.errorReply(e.code, "test", e.message, e.extra);
      throw e;
    });
    return { status: res.status, body: await res.json() as Row };
  };
}

const WORDING = "When I go quiet, I'm thinking, not upset.";

Deno.test("#4 strength partly: the kept item is stored as Partly (rating partly, still confirmed)", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  const r = await call(t, "POST", "/comm/items", { kind: "how_i_mean", wording: WORDING, source: "talk_said", strength: "partly" });
  assertEquals(r.status, 201, JSON.stringify(r.body));
  assertEquals(r.body.state, "created");
  assertEquals(t.beliefs.length, 1);
  assertEquals([t.beliefs[0].rating, t.beliefs[0].status], ["partly", "confirmed"]);
  assertEquals((t.receipts ?? []).length, 1, "one receipt of the person's words, as for any kept item");
});

Deno.test("#4 strength very: stored as That's me (rating very)", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  const r = await call(t, "POST", "/comm/items", { kind: "how_i_mean", wording: WORDING, source: "talk_said", strength: "very" });
  assertEquals(r.status, 201, JSON.stringify(r.body));
  assertEquals([t.beliefs[0].rating, t.beliefs[0].status], ["very", "confirmed"]);
});

Deno.test("#4 no strength: an older caller still works and the item is That's me", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  const typed = await call(t, "POST", "/comm/items", { kind: "how_i_mean", wording: WORDING });
  assertEquals(typed.status, 201, JSON.stringify(typed.body));
  assertEquals(typed.body.state, "created");
  const said = await call(t, "POST", "/comm/items", {
    kind: "feels_like_care", wording: "A text to say they got home makes me feel looked after.", source: "talk_said",
    scope: { type: "everyone" },
  });
  assertEquals(said.status, 201, JSON.stringify(said.body));
  assertEquals(t.beliefs.map((b) => [b.rating, b.status]), [["very", "confirmed"], ["very", "confirmed"]]);
});

Deno.test("#4 any other strength is 400 invalid on the field strength, and nothing is stored", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  for (const strength of ["not", "Partly", "VERY", "somewhat", "", 1, true, ["partly"], { value: "partly" }]) {
    const r = await call(t, "POST", "/comm/items", { kind: "how_i_mean", wording: WORDING, source: "talk_said", strength });
    assertEquals([r.status, r.body.error, r.body.field], [400, "invalid", "strength"], JSON.stringify(strength));
  }
  assertEquals(t.beliefs ?? [], []);
  assertEquals(t.receipts ?? [], []);
});

Deno.test("#4 a Partly item is listed in You like any other kept item", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  const r = await call(t, "POST", "/comm/items", { kind: "how_i_mean", wording: WORDING, strength: "partly" });
  assertEquals(r.status, 201, JSON.stringify(r.body));
  const id = (r.body.item as Row).id;
  const list = await call(t, "GET", "/comm/items");
  assertEquals(list.status, 200);
  const groups = list.body.groups as { kind: string; items: Row[] }[];
  assertEquals(groups.map((g) => g.kind), ["how_i_mean"]);
  assertEquals(groups[0].items.map((i) => [i.id, i.wording]), [[id, WORDING]]);
});
