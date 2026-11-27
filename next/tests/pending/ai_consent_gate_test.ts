// Issue #8. Acceptance test written in C4 from packages/01 (routes.md "Not ready" 6, flows/privacy.md) and
// next/api/CONTRACT.md §11.4 only. For each model route, a call without consent makes zero model calls and returns the
// documented refusal; the list of model routes is asserted so a new route cannot skip the gate.
//
// API the tests expect:
// - `next/api/lib/ai_consent.ts` exports `MODEL_ROUTES: readonly string[]`, every route that can send a person's words to
//   a model, as "METHOD /path" with the path as registered. It equals EXPECTED below; a new model route is added to both.
//   It also exports `REQUIRED_VERSION: string`, the version `GET /me` names as `required_version`.
// - ApiEnv gains `requireAiConsent: boolean` (PRESENCE_REQUIRE_AI_CONSENT). With it true and no current consent, a model
//   route answers 403 `{error: "forbidden", reason: "ai_consent_required", required_version}` and makes no model call.
//   `POST /talk/turn` also keeps the person's words: `saved: true` and `message_id` (as 429 does).
//   `POST /comm/talk/turn` with `text` does the same (`saved: true`, flows/talk.md "the words were kept").
// - `next/tests/model_route_scenarios.ts`, written by the builder (a fixture, not an assertion), exporting
//     export const MODEL_ROUTE_SCENARIOS: ModelRouteScenario[]
//     interface ModelRouteScenario {
//       route: string;            // one of MODEL_ROUTES
//       path: string;             // a concrete path for that route
//       body: Record<string, unknown>;
//       tables: () => Record<string, Record<string, unknown>[]>; // a fresh fake database WITHOUT any ai_consent row
//       env?: Record<string, unknown>;
//       install: (client: ModelClientLike) => void;   // put the test's model double where the route takes its client
//       uninstall: () => void;
//     }
//   One scenario per route in MODEL_ROUTES. The test proves each scenario reaches the model: with a current consent row
//   added at REQUIRED_VERSION, the same call makes at least one model call.
// - Model doubles reach other routes through the modules' `hooks.client` (talk.ts, bridge_engine.ts, mirror.ts, checkin.ts),
//   as the existing tests use them.
import { assert, assertEquals } from "jsr:@std/assert@1";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
interface ModelClientLike {
  complete(req: { purpose: string; system: string; messages: { role: string; content: string }[]; maxTokens: number; model?: string }): Promise<unknown>;
}
interface ModelRouteScenario {
  route: string;
  path: string;
  body: Row;
  tables: () => Tables;
  env?: Row;
  install: (client: ModelClientLike) => void;
  uninstall: () => void;
}
interface RouteLike {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: (ctx: unknown) => Promise<Response>;
}

const ME = "00000000-0000-4000-8000-0000000000a1";

/** CONTRACT §11.4's list, plus the two communication routes routes.md "Not ready" 6 adds. */
const EXPECTED = [
  "POST /bridge/insight",
  "POST /bridge/reword-part",
  "POST /bridge/run",
  "POST /bridge/why-it-matters",
  "POST /comm/items",
  "POST /comm/talk/turn",
  "POST /preview/mirror-sample",
  "POST /talk/finish",
  "POST /talk/turn",
];

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

/** A model double that counts calls and answers with a failure, so no route depends on what it says. */
class CountingModel implements ModelClientLike {
  calls = 0;
  complete(req: { purpose: string; system: string; messages: { role: string; content: string }[]; maxTokens: number; model?: string }) {
    this.calls++;
    return Promise.resolve({
      purpose: req.purpose,
      request: { model: req.model ?? "double", system: req.system, messages: req.messages, maxTokens: req.maxTokens },
      rawResponse: "",
      usage: { model: req.model ?? "double", inputTokens: 0, outputTokens: 0, cents: 0, ms: 1 },
      error: "test double",
    });
  }
}

async function load() {
  const root = await repoRoot();
  const router = await import(new URL("next/api/lib/router.ts", root).href) as { routes: RouteLike[] };
  await import(new URL("next/api/index.ts", root).href);
  const gate = await import(new URL("next/api/lib/ai_consent.ts", root).href) as { MODEL_ROUTES: readonly string[] };
  const errors = await import(new URL("next/api/lib/errors.ts", root).href) as {
    ApiError: new (...a: never[]) => Error & { code: string; extra: Record<string, unknown> };
    errorReply: (code: string, ref: string, message: string, extra?: Record<string, unknown>) => Response;
  };
  const fake = await import(new URL("next/tests/fake_supabase.ts", root).href) as { fakeClient: (t: Tables) => unknown };
  const sc = await import(new URL("next/tests/model_route_scenarios.ts", root).href) as {
    MODEL_ROUTE_SCENARIOS: ModelRouteScenario[];
  };
  async function call(s: ModelRouteScenario, t: Tables, env: Row) {
    const method = s.route.split(" ")[0];
    const r = router.routes.find((x) => x.method === method && x.pattern.test(s.path));
    assert(r, `${s.route} (${s.path}) is not registered in next/api`);
    const m = r.pattern.exec(s.path)!;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const db = fake.fakeClient(t);
    const url = new URL(`https://x.invalid${s.path}`);
    const res = await r.handler({
      env: { isHosted: false, releaseBuild: false, ...(s.env ?? {}), ...env },
      req: new Request(url, { method }), url, params,
      caller: r.auth ? { id: ME, db, persona: null, isExample: false, isPreview: false, profile: { id: ME, name: "Sam" } } : null,
      service: db, tz: "UTC", body: () => Promise.resolve(structuredClone(s.body)),
    }).catch((e: unknown) => {
      if (e instanceof errors.ApiError) return errors.errorReply(e.code, "test", e.message, e.extra);
      throw e;
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as Row };
  }
  return { routes: router.routes, modelRoutes: gate.MODEL_ROUTES, scenarios: sc.MODEL_ROUTE_SCENARIOS, call };
}

Deno.test("#8 the list of model routes is exactly the expected one, and each is registered", async () => {
  const { routes, modelRoutes } = await load();
  assertEquals([...modelRoutes].sort(), EXPECTED);
  for (const r of modelRoutes) {
    const [method, path] = r.split(" ");
    const concrete = path.replace(/:([a-z_]+)/g, "x");
    assert(routes.some((x) => x.method === method && x.pattern.test(concrete)), `${r} is not registered`);
  }
});

Deno.test("#8 there is one scenario per model route", async () => {
  const { modelRoutes, scenarios } = await load();
  assertEquals(scenarios.map((s) => s.route).sort(), [...modelRoutes].sort());
});

Deno.test("#8 each scenario reaches the model when consent is current (the gate test below is not vacuous)", async () => {
  const { scenarios, call } = await load();
  const unreached: string[] = [];
  for (const s of scenarios) {
    const model = new CountingModel();
    s.install(model);
    try {
      const t = s.tables();
      assertEquals(t.ai_consent ?? [], [], `${s.route}: scenario tables must start with no consent row`);
      // Consent given at the required version: GET /me is the source of the version.
      const me = await import(new URL("next/api/lib/ai_consent.ts", await repoRoot()).href) as { REQUIRED_VERSION?: string };
      const version = me.REQUIRED_VERSION;
      assert(typeof version === "string", "next/api/lib/ai_consent.ts exports REQUIRED_VERSION");
      t.ai_consent = [{
        id: "00000000-0000-4000-8000-00000000c0a1", owner: ME, version, providers: ["anthropic"],
        at: "2026-11-25T00:00:00.000Z", withdrawn_at: null, client_ref: null,
      }];
      await call(s, t, { requireAiConsent: true });
      if (model.calls === 0) unreached.push(s.route);
    } finally { s.uninstall(); }
  }
  assertEquals(unreached, [], "scenarios that make no model call even with consent");
});

Deno.test("#8 without consent each model route makes zero model calls and returns the documented refusal", async () => {
  const { scenarios, call } = await load();
  const problems: string[] = [];
  for (const s of scenarios) {
    const model = new CountingModel();
    s.install(model);
    try {
      const { status, body } = await call(s, s.tables(), { requireAiConsent: true });
      if (model.calls !== 0) problems.push(`${s.route}: ${model.calls} model call(s) without consent`);
      if (status !== 403 || body.error !== "forbidden" || body.reason !== "ai_consent_required") {
        problems.push(`${s.route}: answered ${status} ${JSON.stringify(body)}, not 403 forbidden ai_consent_required`);
      }
      if (typeof body.required_version !== "string") problems.push(`${s.route}: no required_version in the refusal`);
      if ((s.route === "POST /talk/turn" || s.route === "POST /comm/talk/turn") && body.saved !== true) {
        problems.push(`${s.route}: the words were not kept (saved: true)`);
      }
    } finally { s.uninstall(); }
  }
  assertEquals(problems, []);
});

Deno.test("#8 a withdrawn consent is the same as none: zero model calls, the same refusal", async () => {
  const { scenarios, call } = await load();
  const me = await import(new URL("next/api/lib/ai_consent.ts", await repoRoot()).href) as { REQUIRED_VERSION: string };
  const problems: string[] = [];
  for (const s of scenarios) {
    const model = new CountingModel();
    s.install(model);
    try {
      const t = s.tables();
      t.ai_consent = [{
        id: "00000000-0000-4000-8000-00000000c0a2", owner: ME, version: me.REQUIRED_VERSION, providers: ["anthropic"],
        at: "2026-11-20T00:00:00.000Z", withdrawn_at: "2026-11-21T00:00:00.000Z", client_ref: null,
      }];
      const { status, body } = await call(s, t, { requireAiConsent: true });
      if (model.calls !== 0) problems.push(`${s.route}: ${model.calls} model call(s) after withdrawal`);
      if (status !== 403 || body.reason !== "ai_consent_required") problems.push(`${s.route}: answered ${status}`);
    } finally { s.uninstall(); }
  }
  assertEquals(problems, []);
});

Deno.test("#8 no registered route outside the list calls the model without consent", async () => {
  // Every other registered route, called with a body that carries words, must make no model call when consent is missing.
  const { routes, modelRoutes, call } = await load();
  const listed = (method: string, path: string) =>
    modelRoutes.some((r) => {
      const [m, p] = r.split(" ");
      return m === method && new RegExp("^" + p.replace(/:([a-z_]+)/g, "[^/]+") + "/?$").test(path);
    });
  const offenders: string[] = [];
  for (const r of routes) {
    // A concrete path for the route's pattern: each parameter becomes a fixed id.
    const path = r.pattern.source.replace(/^\^/, "").replace(/\/\?\$$/, "").replace(/\(\[\^\/\]\+\)/g, ME)
      .replace(/\\\//g, "/");
    if (!path.startsWith("/") || /[()[\]^$*+?]/.test(path)) continue;
    if (listed(r.method, path)) continue;
    const model = new CountingModel();
    const s: ModelRouteScenario = {
      route: `${r.method} ${path}`, path, tables: () => ({}),
      body: { text: "I go quiet when I'm tired and people think I'm upset.", person_id: ME, seq: 1 },
      install: () => {}, uninstall: () => {},
    };
    const root = await repoRoot();
    const hookModules = ["next/api/talk.ts", "next/api/bridge_engine.ts", "next/api/mirror.ts", "next/api/checkin.ts"];
    const hooks = await Promise.all(hookModules.map(async (m) =>
      (await import(new URL(m, root).href) as { hooks?: { client: unknown } }).hooks
    ));
    for (const h of hooks) if (h) h.client = () => model;
    try {
      await call(s, {}, { requireAiConsent: true }).catch(() => undefined);
    } finally {
      for (const h of hooks) if (h) h.client = null;
    }
    if (model.calls > 0) offenders.push(`${r.method} ${path}`);
  }
  assertEquals(offenders, [], "routes that call a model without consent and are not in MODEL_ROUTES");
});
