import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type AppleIdentity, appleInput, type AppleSignInDeps, completeAppleSignIn } from "../api/auth.ts";
import { ApiError } from "../api/lib/errors.ts";

const identity = (id: string): AppleIdentity => ({
  user: { id },
  session: { access_token: `access-${id}`, refresh_token: `refresh-${id}`, expires_at: 1_800_000_000 },
});

function memoryDeps(ids: Record<string, string>, rows = new Map<string, Record<string, unknown>>()) {
  const calls: { token: string; nonce: string }[] = [];
  const deps: AppleSignInDeps = {
    verify: (token, nonce) => {
      calls.push({ token, nonce });
      const id = ids[token];
      if (!id) return Promise.reject(new Error("invalid Apple token"));
      return Promise.resolve(identity(id));
    },
    profile: (id) => Promise.resolve(rows.get(id) ?? null),
    createProfile: (row) => {
      const id = String(row.id);
      if (rows.has(id)) return Promise.resolve("exists");
      rows.set(id, { ...row, settings: {} });
      return Promise.resolve("created");
    },
  };
  return { deps, rows, calls };
}

Deno.test("Apple sign-in requires an identity token, raw nonce and the O02 adult confirmation", async () => {
  for (
    const [body, field] of [
      [{ nonce: "n", adult_confirmed: true }, "identity_token"],
      [{ identity_token: "t", adult_confirmed: true }, "nonce"],
      [{ identity_token: "t", nonce: "n", adult_confirmed: false }, "adult_confirmed"],
    ] as const
  ) {
    const error = await assertRejects(() => Promise.resolve().then(() => appleInput(body)), ApiError);
    assertEquals(error.extra.field, field);
  }
});

Deno.test("a verified Apple credential creates one real profile and returns a Supabase session", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const { deps, rows, calls } = memoryDeps({ token: id });
  const input = appleInput({
    identity_token: " token ",
    nonce: " raw-nonce ",
    name: "  Ava   Stone  ",
    adult_confirmed: true,
  });
  const result = await completeAppleSignIn(input, deps);

  assertEquals(calls, [{ token: "token", nonce: "raw-nonce" }]);
  assertEquals(result.created, true);
  assertEquals(result.access_token, `access-${id}`);
  assertEquals(result.expires_at, "2027-01-15T08:00:00.000Z");
  assertEquals((result.me.person as Record<string, unknown>).name, "Ava Stone");
  assertEquals(rows.get(id)?.is_preview, false);
  assertEquals(rows.get(id)?.is_example, false);
  assertEquals(rows.get(id)?.auth_provider, "apple");
  assert(typeof rows.get(id)?.adult_confirmed_at === "string");
});

Deno.test("later Apple sign-in links to the same account without overwriting its profile", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const existing = new Map([[id, {
    id,
    name: "Chosen name",
    settings: { read_aloud: true },
    auth_provider: "apple",
  }]]);
  const { deps, rows } = memoryDeps({ again: id }, existing);
  const result = await completeAppleSignIn(
    appleInput({ identity_token: "again", nonce: "n", name: "Apple's old name", adult_confirmed: true }),
    deps,
  );
  assertEquals(result.created, false);
  assertEquals((result.me.person as Record<string, unknown>).name, "Chosen name");
  assertEquals(rows.get(id)?.settings, { read_aloud: true });
});

Deno.test("two verified Apple subjects create two real accounts that the existing invite RPC can pair", async () => {
  const a = "33333333-3333-4333-8333-333333333333";
  const b = "44444444-4444-4444-8444-444444444444";
  const { deps, rows } = memoryDeps({ a, b });
  await completeAppleSignIn(
    appleInput({ identity_token: "a", nonce: "na", name: "A", adult_confirmed: true }),
    deps,
  );
  await completeAppleSignIn(
    appleInput({ identity_token: "b", nonce: "nb", name: "B", adult_confirmed: true }),
    deps,
  );
  assertEquals([...rows.keys()].sort(), [a, b]);

  const schema = await Deno.readTextFile(
    new URL("../../supabase/migrations/0001_app_v1.sql", import.meta.url),
  );
  const acceptInviteStart = schema.indexOf("create or replace function public.accept_invite");
  const acceptInvite = schema.slice(acceptInviteStart, schema.indexOf("grant execute", acceptInviteStart));
  assert(acceptInvite.includes("insert into links (person_a, person_b, invite_id)"));
  assert(!acceptInvite.includes("is_example"));
  assert(!acceptInvite.includes("is_preview"));
});

Deno.test("invalid Apple verification and a deleted Presence profile never produce a session", async () => {
  const invalid = memoryDeps({}).deps;
  const input = appleInput({ identity_token: "bad", nonce: "n", adult_confirmed: true });
  await assertRejects(() => completeAppleSignIn(input, invalid), ApiError, "Apple couldn't verify");

  const id = "55555555-5555-4555-8555-555555555555";
  const deleted = new Map([[id, { id, name: "Deleted account", deleted_at: "2026-10-29T00:00:00Z" }]]);
  await assertRejects(
    () =>
      completeAppleSignIn(
        appleInput({ identity_token: "deleted", nonce: "n", adult_confirmed: true }),
        memoryDeps({ deleted: id }, deleted).deps,
      ),
    ApiError,
    "Sign in to continue",
  );
});

Deno.test("account deletion hard-removes a real Apple identity while keeping only its anonymised bridge tombstone", async () => {
  const data = await Deno.readTextFile(new URL("../api/data.ts", import.meta.url));
  assert(data.includes('deleteRefusal(caller!, "account")'));
  assert(data.includes("service.auth.admin.deleteUser(id)"));
  assert(!data.includes("service.auth.admin.deleteUser(id, true)"));
  // SD6: the destructive table writes now run in one Postgres transaction (migration 0029), called through a single RPC.
  assert(data.includes('service.rpc("delete_account"'));
  const txn = await Deno.readTextFile(
    new URL("../../supabase/migrations/0029_account_delete_transaction.sql", import.meta.url),
  );
  assert(txn.includes("delete from push_events") && txn.includes("delete from device_tokens"));
  const migration = await Deno.readTextFile(
    new URL("../../supabase/migrations/0014_apple_accounts.sql", import.meta.url),
  );
  assert(migration.includes("auth_provider in ('apple', 'preview', 'legacy')"));
  assert(migration.includes("drop constraint if exists profiles_id_fkey"));
  assert(migration.includes("presence_cleanup_profile_after_auth_delete"));
  assert(migration.includes("deleted_at is null"));
});

Deno.test("SD6b: Apple revoke runs before the delete_account transaction, and never blocks it on failure", async () => {
  const data = await Deno.readTextFile(new URL("../api/data.ts", import.meta.url));
  const revokeAt = data.indexOf("revokeAppleToken(");
  const rpcAt = data.indexOf('service.rpc("delete_account"');
  assert(revokeAt > 0 && rpcAt > 0);
  assert(revokeAt < rpcAt, "the Apple revoke call must appear before the delete_account RPC in route source order");
  assert(data.includes("decryptAppleToken(env.serviceRoleKey"));
  assert(data.includes('recordError(service, id, "account.apple_revoke"'));
  // The revoke failure path is a log, not a throw back to the caller: no rethrow of the ApiError type after it.
  const revokeBlock = data.slice(revokeAt - 400, rpcAt);
  assert(!revokeBlock.includes("throw new ApiError"));
});

Deno.test("SD6b: migration 0030 adds the encrypted-token column and clears it as part of the tombstone", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../supabase/migrations/0030_apple_token_revocation.sql", import.meta.url),
  );
  assert(migration.includes("add column if not exists apple_refresh_token_enc text"));
  assert(migration.includes("apple_refresh_token_enc = null"));
  assert(migration.includes("deleted_at = now()"));
});

Deno.test("SD6b: a sign-in with an authorization_code exchanges it and stores the result, without touching the session", async () => {
  const id = "66666666-6666-4666-8666-666666666666";
  const { deps, rows } = memoryDeps({ token: id });
  const exchangeCalls: string[] = [];
  const storeCalls: { userId: string; refreshToken: string }[] = [];
  const result = await completeAppleSignIn(
    appleInput({
      identity_token: "token",
      nonce: "n",
      adult_confirmed: true,
      authorization_code: "the-code",
    }),
    {
      ...deps,
      exchangeCode: (code) => {
        exchangeCalls.push(code);
        return Promise.resolve("refresh-xyz");
      },
      storeAppleToken: (userId, refreshToken) => {
        storeCalls.push({ userId, refreshToken });
        return Promise.resolve();
      },
    },
  );
  assertEquals(exchangeCalls, ["the-code"]);
  assertEquals(storeCalls, [{ userId: id, refreshToken: "refresh-xyz" }]);
  assertEquals(result.access_token, `access-${id}`);
  assertEquals(rows.get(id)?.id, id);
});

Deno.test("SD6b: no authorization_code, or no exchange/store deps, skips the exchange step entirely — not an error", async () => {
  const id = "77777777-7777-4777-8777-777777777777";
  // No authorization_code at all: deps that would record a call are never touched.
  {
    const { deps } = memoryDeps({ token: id });
    let called = false;
    const result = await completeAppleSignIn(
      appleInput({ identity_token: "token", nonce: "n", adult_confirmed: true }),
      { ...deps, exchangeCode: () => { called = true; return Promise.resolve("x"); }, storeAppleToken: () => Promise.resolve() },
    );
    assertEquals(called, false);
    assertEquals(result.created, true);
  }
  // A code is present but the build has no exchange/store deps wired (e.g. an unconfigured environment's depsFor
  // still provides them, so this models a caller that genuinely omits them): still a normal sign-in.
  {
    const id2 = "88888888-8888-4888-8888-888888888888";
    const { deps } = memoryDeps({ token2: id2 });
    const result = await completeAppleSignIn(
      appleInput({ identity_token: "token2", nonce: "n", adult_confirmed: true, authorization_code: "the-code" }),
      deps,
    );
    assertEquals(result.created, true);
  }
});

Deno.test("SD6b: a throwing exchange or store never fails the sign-in that already succeeded", async () => {
  const id = "99999999-9999-4999-8999-999999999999";
  const { deps } = memoryDeps({ token: id });
  const result = await completeAppleSignIn(
    appleInput({ identity_token: "token", nonce: "n", adult_confirmed: true, authorization_code: "the-code" }),
    {
      ...deps,
      exchangeCode: () => Promise.reject(new Error("apple is down")),
      storeAppleToken: () => Promise.reject(new Error("should never be reached")),
    },
  );
  assertEquals(result.created, true);
  assertEquals(result.access_token, `access-${id}`);
});
