// P0 (CEO 00:40 ET 6 Nov): POST /preview/login returned a session for ANY persona with no secret from the
// caller, and the owner's real account ("nami") was reachable through it. This pins the fix: on the hosted
// runtime the route refuses without a matching device secret, "nami" is never a reachable persona (hosted or
// Mac), and a release build never reaches the route at all.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { ApiEnv } from "../api/lib/env.ts";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import type { Ctx } from "../api/lib/router.ts";
import "../api/index.ts";

function baseEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    supabaseUrl: "https://example.invalid",
    anonKey: "anon",
    serviceRoleKey: "service",
    previewPassword: "preview-pw",
    previewDeviceSecret: null,
    anthropicKey: null,
    anthropicWorkspace: null,
    apnsKeyId: null,
    apnsTeamId: null,
    apnsPrivateKey: null,
    pushDrainSecret: null,
    appleTeamId: null,
    appleKeyId: null,
    applePrivateKey: null,
    appleClientId: null,
    testerToken: null,
    isHosted: false,
    releaseBuild: false,
    ...overrides,
  };
}

function previewLoginRoute() {
  const match = routes.find((r) => r.method === "POST" && r.pattern.test("/preview/login"));
  if (!match) throw new Error("POST /preview/login is not registered");
  return match;
}

function previewRoute(method: string, path: string) {
  const match = routes.find((r) => r.method === method && r.pattern.test(path));
  if (!match) throw new Error(`${method} ${path} is not registered`);
  return match;
}

function ctxFor(
  env: ApiEnv,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  path = "/preview/login",
  method = "POST",
): Ctx {
  const req = new Request(`https://example.invalid${path}`, { method, headers });
  return {
    env,
    req,
    url: new URL(req.url),
    params: {},
    caller: null,
    service: {} as never, // unreached: every case here throws before a database call
    tz: "UTC",
    body: () => Promise.resolve(body),
  };
}

Deno.test("hosted preview login refuses with no secret configured on the server", async () => {
  const env = baseEnv({ isHosted: true, previewDeviceSecret: null });
  const error = await assertRejects(
    () => previewLoginRoute().handler(ctxFor(env, { persona: "lea" })),
    ApiError,
  );
  assertEquals(error.code, "unauthorized");
  assertEquals(error.extra.reason, "preview_secret_required");
});

Deno.test("hosted preview login refuses a wrong device secret", async () => {
  const env = baseEnv({ isHosted: true, previewDeviceSecret: "correct-secret" });
  const error = await assertRejects(
    () =>
      previewLoginRoute().handler(
        ctxFor(env, { persona: "lea" }, { "x-presence-preview-secret": "wrong-secret" }),
      ),
    ApiError,
  );
  assertEquals(error.code, "unauthorized");
  assertEquals(error.extra.reason, "preview_secret_required");
});

Deno.test("hosted preview login refuses a missing secret header even when one is configured", async () => {
  const env = baseEnv({ isHosted: true, previewDeviceSecret: "correct-secret" });
  const error = await assertRejects(
    () => previewLoginRoute().handler(ctxFor(env, { persona: "lea" })),
    ApiError,
  );
  assertEquals(error.code, "unauthorized");
  assertEquals(error.extra.reason, "preview_secret_required");
});

Deno.test("the Mac dev server (not hosted) needs no device secret", async () => {
  const env = baseEnv({ isHosted: false, previewDeviceSecret: null });
  // Passes the secret gate and reaches the real sign-in call, which fails against the fake Supabase URL;
  // any error other than preview_secret_required proves the gate did not fire.
  const error = await assertRejects(
    () => previewLoginRoute().handler(ctxFor(env, { persona: "lea" })),
    ApiError,
  );
  if (error.extra.reason === "preview_secret_required") {
    throw new Error("the Mac dev server must not require a device secret");
  }
});

Deno.test("persona nami is never reachable through preview login, hosted or Mac", async () => {
  for (const isHosted of [false, true]) {
    const env = baseEnv({ isHosted, previewDeviceSecret: isHosted ? "s" : null });
    const headers: Record<string, string> = isHosted ? { "x-presence-preview-secret": "s" } : {};
    const error = await assertRejects(
      () => previewLoginRoute().handler(ctxFor(env, { persona: "nami" }, headers)),
      ApiError,
    );
    assertEquals(error.code, "forbidden");
    assertEquals(error.extra.reason, "preview_login_restricted");
  }
});

Deno.test("a release build never reaches preview login, secret or not", async () => {
  const env = baseEnv({ isHosted: true, releaseBuild: true, previewDeviceSecret: "s" });
  const error = await assertRejects(
    () => previewLoginRoute().handler(ctxFor(env, { persona: "lea" }, { "x-presence-preview-secret": "s" })),
    ApiError,
  );
  assertEquals(error.code, "not_found");
});

// CONTRACT.md's release switch: GET /preview/spend and POST /preview/mirror-sample answer 404 under
// PRESENCE_RELEASE=true too, same as /preview/login, checked before authenticate() so an unauthenticated
// caller on a release build still gets 404, not 401.
Deno.test("a release build never reaches preview spend, authenticated or not", async () => {
  const env = baseEnv({ releaseBuild: true });
  const error = await assertRejects(
    () => previewRoute("GET", "/preview/spend").handler(ctxFor(env, {}, {}, "/preview/spend", "GET")),
    ApiError,
  );
  assertEquals(error.code, "not_found");
});

Deno.test("a release build never reaches the preview mirror sample, authenticated or not", async () => {
  const env = baseEnv({ releaseBuild: true });
  const error = await assertRejects(
    () => previewRoute("POST", "/preview/mirror-sample").handler(ctxFor(env, {}, {}, "/preview/mirror-sample")),
    ApiError,
  );
  assertEquals(error.code, "not_found");
});
