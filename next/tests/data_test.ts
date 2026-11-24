// $0 tests for Your data (CONTRACT §7 Data): the refusal rules, what a withdrawn bridge shows the other side, the file name,
// the routes, and the deleted-profile marks on Person and on sign-in.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { deleteRefusal, exportFilename, MAP_PURPOSES, MAP_UNDO_MS, mapDeletePending, mapDeleteState, withdrawalSeen } from "../api/data.ts";
import { routes } from "../api/lib/router.ts";
import type { Ctx } from "../api/lib/router.ts";
import { ApiError } from "../api/lib/errors.ts";
import { personObject } from "../api/lib/objects.ts";
import "../api/index.ts";

Deno.test("delete refusals: example accounts keep their seeded map; the owner's preview account cannot be deleted; a real account can do both", () => {
  assertEquals(deleteRefusal({ isExample: true, isPreview: true }, "map"), "example_account");
  assertEquals(deleteRefusal({ isExample: true, isPreview: true }, "account"), "preview_account");
  assertEquals(deleteRefusal({ isExample: false, isPreview: true }, "map"), null);          // Nami may clear his own map
  assertEquals(deleteRefusal({ isExample: false, isPreview: true }, "account"), "preview_account");
  assertEquals(deleteRefusal({ isExample: false, isPreview: false }, "map"), null);
  assertEquals(deleteRefusal({ isExample: false, isPreview: false }, "account"), null);
});

Deno.test("a withdrawal on leaving is shown only where the other side saw the bridge: sealed bubble seen, or delivered", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  assertEquals(withdrawalSeen({ heads_up_seen_at: null, deliver_at: "2026-10-28T12:00:00Z" }, now), false);   // sealed, never shown
  assertEquals(withdrawalSeen({ heads_up_seen_at: "2026-10-27T11:00:00Z", deliver_at: "2026-10-28T12:00:00Z" }, now), true);
  assertEquals(withdrawalSeen({ heads_up_seen_at: null, deliver_at: "2026-10-27T11:59:00Z" }, now), true);    // delivered, unopened
});

Deno.test("export file name carries the day; the Talk purposes are the traces that go with the map", () => {
  assertEquals(exportFilename(new Date("2026-10-27T14:50:00Z")), "presence-2026-10-27.json");
  assertEquals([...MAP_PURPOSES], ["turn", "repair", "finish"]);
});

Deno.test("DELETE /map: a 5-second undo window; pending while it is open, due once it closed, nothing without a mark (Q63)", () => {
  const now = Date.parse("2026-10-27T14:00:00.000Z");
  assertEquals(MAP_UNDO_MS, 5000);                                                           // the design's Undo toast
  assertEquals(mapDeleteState(null, now), "none");
  assertEquals(mapDeleteState(undefined, now), "none");
  assertEquals(mapDeleteState("2026-10-27T14:00:04.999Z", now), "pending");                  // undo still possible
  assertEquals(mapDeleteState("2026-10-27T14:00:00.000Z", now), "due");                      // the window closes at its time, not after
  assertEquals(mapDeleteState("2026-10-27T13:59:00.000Z", now), "due");
  assertEquals(mapDeleteState("not a time", now), "due");                                    // a bad mark never holds the map hostage
  assertEquals(mapDeletePending({ mapDeleteAt: "2026-10-27T14:00:03.000Z" }, now), true);
  assertEquals(mapDeletePending({ mapDeleteAt: "2026-10-27T13:59:59.000Z" }, now), false);
  assertEquals(mapDeletePending({ mapDeleteAt: null }, now), false);
});

Deno.test("the Data routes are registered and need a bearer", () => {
  for (const [method, path] of [["GET", "/export"], ["DELETE", "/map"], ["POST", "/map/undo"], ["DELETE", "/account"]] as const) {
    const r = routes.find((x) => x.method === method && x.pattern.test(path));
    assert(r, `${method} ${path}`);
    assertEquals(r.auth, true);
  }
});

function accountRoute() {
  const match = routes.find((r) => r.method === "DELETE" && r.pattern.test("/account"));
  if (!match) throw new Error("DELETE /account is not registered");
  return match;
}

function ctxFor(service: unknown, caller: Record<string, unknown>): Ctx {
  const req = new Request("https://example.invalid/account", { method: "DELETE" });
  return {
    env: {} as never,
    req,
    url: new URL(req.url),
    params: {},
    caller: caller as never,
    service: service as never,
    tz: "UTC",
    body: () => Promise.resolve({}),
  };
}

Deno.test("SD6: DELETE /account runs every destructive step through one RPC call (one Postgres transaction), then the Auth user", () => {
  return (async () => {
    const calls: string[] = [];
    let deleteUserId: string | null = null;
    const service = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push(name);
        assertEquals(args, { p_id: "real-1" });
        return Promise.resolve({ data: { withdrawn: ["b1", "b2"], links_ended: 2 }, error: null });
      },
      auth: { admin: { deleteUser: (id: string) => { deleteUserId = id; return Promise.resolve({ error: null }); } } },
    };
    const res = await accountRoute().handler(
      ctxFor(service, { id: "real-1", isExample: false, isPreview: false }),
    );
    assertEquals(calls, ["delete_account"]);         // exactly one RPC call for every destructive step
    assertEquals(deleteUserId, "real-1");             // the Auth user goes only after the transaction committed
    assertEquals(await res.json(), { deleted: true, withdrawn: ["b1", "b2"], links_ended: 2 });
  })();
});

Deno.test("SD6: a refused delete (example or preview account) never calls the RPC or the Auth admin API", async () => {
  for (const caller of [{ id: "x", isExample: true, isPreview: false }, { id: "x", isExample: false, isPreview: true }]) {
    const service = {
      rpc: () => { throw new Error("must not be called"); },
      auth: { admin: { deleteUser: () => { throw new Error("must not be called"); } } },
    };
    const error = await assertRejects(() => accountRoute().handler(ctxFor(service, caller)), ApiError);
    assertEquals(error.code, "forbidden");
  }
});

Deno.test("SD6: an RPC failure (the transaction rolled back) surfaces as an error and never reaches the Auth delete", async () => {
  let deleteUserCalled = false;
  const service = {
    rpc: () => Promise.resolve({ data: null, error: { message: "constraint violated", code: "23503" } }),
    auth: { admin: { deleteUser: () => { deleteUserCalled = true; return Promise.resolve({ error: null }); } } },
  };
  await assertRejects(() => accountRoute().handler(ctxFor(service, { id: "real-1", isExample: false, isPreview: false })));
  assertEquals(deleteUserCalled, false);
});

Deno.test("Person carries deleted: true once the profile was deleted", () => {
  assertEquals(personObject({ id: "p", name: "Deleted account", deleted_at: "2026-10-27T12:00:00Z" }).deleted, true);
  assertEquals(personObject({ id: "p", name: "Lea" }).deleted, false);
});

// v1.74 Google sign-in: DELETE /account revokes our Google grant at Google, then clears the column, before the
// one-transaction delete; a revoke Google refuses is logged and never blocks the deletion.
async function googleDelete(revokeStatus: number) {
  const { encryptAppleToken } = await import("../api/lib/apple_auth.ts");
  const key = "test-service-role-key";
  const enc = await encryptAppleToken(key, "google-refresh-1");
  const steps: string[] = [];
  const revoked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    assertEquals(url, "https://oauth2.googleapis.com/revoke");
    revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
    steps.push("revoke");
    return Promise.resolve(new Response("", { status: revokeStatus }));
  }) as typeof fetch;
  const service = {
    from: (table: string) => ({
      update: (row: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          assertEquals([table, row, col, val], ["profiles", { google_refresh_token_enc: null }, "id", "real-g"]);
          steps.push("clear");
          return Promise.resolve({ error: null });
        },
      }),
      insert: (row: Record<string, unknown>) => {
        assertEquals(table, "errors");
        steps.push(`error:${row.code}`);
        return { select: () => ({ single: () => Promise.resolve({ data: { ref: "ABCD" }, error: null }) }) };
      },
    }),
    rpc: (name: string) => { steps.push(name); return Promise.resolve({ data: { withdrawn: [], links_ended: 0 }, error: null }); },
    auth: { admin: { deleteUser: () => { steps.push("auth"); return Promise.resolve({ error: null }); } } },
  };
  try {
    const ctx = ctxFor(service, { id: "real-g", isExample: false, isPreview: false, profile: { google_refresh_token_enc: enc } });
    (ctx as { env: unknown }).env = { serviceRoleKey: key };
    const res = await accountRoute().handler(ctx);
    assertEquals((await res.json()).deleted, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  return { steps, revoked };
}

Deno.test("v1.74: DELETE /account revokes the Google token, clears the column, then deletes", async () => {
  const { steps, revoked } = await googleDelete(200);
  assertEquals(revoked, ["google-refresh-1"]);
  assertEquals(steps, ["revoke", "clear", "delete_account", "auth"]);
});

Deno.test("v1.74: a Google revoke that fails is logged and the account is still deleted", async () => {
  const { steps } = await googleDelete(400);
  assertEquals(steps, ["revoke", "error:google_revoke_failed", "clear", "delete_account", "auth"]);
});
