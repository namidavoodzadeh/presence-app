// Issue #8. Acceptance test written in C4 from packages/01 (routes.md "Not ready" 6, compliance.md, flows/privacy.md)
// and next/api/CONTRACT.md §11.4 only: give, withdraw, version moved on.
//
// API the tests expect (CONTRACT §11.4):
// - `GET /me` answers `ai_consent: { required_version: string, providers: ["anthropic"], given: {version, providers, at} | null }`.
//   `given` is null when there is no record, when the record is withdrawn, or when its version is behind `required_version`.
// - `POST /consent/ai {version, providers: ["anthropic"]}` → 200 `{ai_consent}` with `given.version === version`.
//   A version the server does not know → 400 `{error: "invalid"}`, nothing stored.
// - `DELETE /consent/ai` → 200 `{ai_consent: {…, given: null}}`; it sets `withdrawn_at`, deletes nothing.
// - Table `ai_consent (owner, version, providers, at, withdrawn_at, client_ref)`. Rows are never updated in place except
//   `withdrawn_at`; a new consent adds a row, so the history stays whole.
// - All three routes are registered in `next/api` (loaded through `next/api/index.ts`) and run on `tests/fake_supabase.ts`.
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";

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
  return async function call(t: Tables, method: string, path: string, body: Row = {}, env: Row = {}) {
    const r = router.routes.find((x) => x.method === method && x.pattern.test(path));
    assert(r, `${method} ${path} is not registered in next/api`);
    const db = fake.fakeClient(t);
    const url = new URL(`https://x.invalid${path}`);
    const res = await r.handler({
      env: { isHosted: false, releaseBuild: false, requireAiConsent: true, ...env },
      req: new Request(url, { method }), url, params: {},
      caller: { id: ME, db, persona: null, isExample: false, isPreview: false, profile: PROFILE },
      service: db, tz: "UTC", body: () => Promise.resolve(body),
    }).catch((e: unknown) => {
      if (e instanceof errors.ApiError) return errors.errorReply(e.code, "test", e.message, e.extra);
      throw e;
    });
    return { status: res.status, body: await res.json() as Row };
  };
}

type Consent = { required_version: string; providers: string[]; given: { version: string; providers: string[]; at: string } | null };
const consentOf = (b: Row) => b.ai_consent as Consent;

Deno.test("#8 GET /me names Anthropic and has no consent before one is given", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  const me = await call(t, "GET", "/me");
  assertEquals(me.status, 200);
  const c = consentOf(me.body);
  assert(typeof c.required_version === "string" && c.required_version.length > 0);
  assertEquals(c.providers, ["anthropic"]);
  assertEquals(c.given, null);
});

Deno.test("#8 give: POST /consent/ai stores the current version and GET /me shows it given", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  const version = consentOf((await call(t, "GET", "/me")).body).required_version;
  const give = await call(t, "POST", "/consent/ai", { version, providers: ["anthropic"] });
  assertEquals(give.status, 200);
  assertEquals(consentOf(give.body).given?.version, version);
  assertEquals(consentOf(give.body).given?.providers, ["anthropic"]);
  assertEquals((t.ai_consent ?? []).length, 1);
  assertEquals(t.ai_consent[0].owner, ME);
  assertEquals(t.ai_consent[0].version, version);
  const me = consentOf((await call(t, "GET", "/me")).body);
  assertEquals(me.given?.version, version);
});

Deno.test("#8 give: an unknown version is 400 invalid and stores nothing", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  const r = await call(t, "POST", "/consent/ai", { version: "1999-01-not-a-version", providers: ["anthropic"] });
  assertEquals(r.status, 400);
  assertEquals(r.body.error, "invalid");
  assertEquals(t.ai_consent ?? [], []);
});

Deno.test("#8 withdraw: DELETE /consent/ai sets withdrawn_at, keeps the row, and GET /me shows none given", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  const version = consentOf((await call(t, "GET", "/me")).body).required_version;
  await call(t, "POST", "/consent/ai", { version, providers: ["anthropic"] });
  const w = await call(t, "DELETE", "/consent/ai");
  assertEquals(w.status, 200);
  assertEquals(consentOf(w.body).given, null);
  assertEquals(t.ai_consent.length, 1, "the record is kept as history");
  assertNotEquals(t.ai_consent[0].withdrawn_at ?? null, null);
  assertEquals(consentOf((await call(t, "GET", "/me")).body).given, null);
});

Deno.test("#8 give again after withdrawing adds a row; the withdrawn one stays", async () => {
  const call = await api();
  const t: Tables = { profiles: [{ ...PROFILE }] };
  const version = consentOf((await call(t, "GET", "/me")).body).required_version;
  await call(t, "POST", "/consent/ai", { version, providers: ["anthropic"] });
  await call(t, "DELETE", "/consent/ai");
  const again = await call(t, "POST", "/consent/ai", { version, providers: ["anthropic"] });
  assertEquals(consentOf(again.body).given?.version, version);
  assertEquals(t.ai_consent.length, 2);
  assertEquals(t.ai_consent.filter((r) => (r.withdrawn_at ?? null) === null).length, 1);
});

Deno.test("#8 version moved on: a record for an older version is not given, and the screen shows again", async () => {
  const call = await api();
  const t: Tables = {
    profiles: [{ ...PROFILE }],
    ai_consent: [{
      id: "00000000-0000-4000-8000-00000000c001", owner: ME, version: "2000-01", providers: ["anthropic"],
      at: "2026-01-01T00:00:00.000Z", withdrawn_at: null, client_ref: null,
    }],
  };
  const c = consentOf((await call(t, "GET", "/me")).body);
  assertNotEquals(c.required_version, "2000-01");
  assertEquals(c.given, null);
  const give = await call(t, "POST", "/consent/ai", { version: c.required_version, providers: ["anthropic"] });
  assertEquals(consentOf(give.body).given?.version, c.required_version);
  assertEquals(t.ai_consent.length, 2, "the old record stays as history");
  assertEquals(t.ai_consent[0].version, "2000-01");
});
