// Google sign-in, server half (STAGING first): envelope, verified email only, email only (claims scrubbed, fail
// closed), one person one account, code exchange never blocks sign-in, delete revokes. Fakes only, no network.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { completeGoogleSignIn, type GoogleIdentity, googleInput, type GoogleSignInDeps } from "../api/auth.ts";
import { ApiError } from "../api/lib/errors.ts";
import { exchangeGoogleCode, GOOGLE_PROFILE_CLAIMS, revokeGoogleToken, scrubbedClaims } from "../api/lib/google_auth.ts";

const ID = "22222222-2222-4222-8222-222222222222";
const verified = (id: string, email: string | null = "ava@example.com", confirmed = true): GoogleIdentity => ({
  user: { id, email: email ?? undefined, email_confirmed_at: confirmed ? "2026-11-14T00:00:00Z" : undefined },
  session: { access_token: `access-${id}`, refresh_token: `refresh-${id}`, expires_at: 1_800_000_000 },
});

function memoryDeps(identity: GoogleIdentity | Error, rows = new Map<string, Record<string, unknown>>()) {
  const log: string[] = [];
  const stored: string[] = [];
  const deps: GoogleSignInDeps = {
    verify: (token, nonce) => { log.push(`verify:${token}:${nonce}`); return identity instanceof Error ? Promise.reject(identity) : Promise.resolve(identity); },
    scrubProfileClaims: (id) => { log.push(`scrub:${id}`); return Promise.resolve(); },
    profile: (id) => Promise.resolve(rows.get(id) ?? null),
    createProfile: (row) => {
      const id = String(row.id);
      if (rows.has(id)) return Promise.resolve("exists");
      rows.set(id, { ...row, settings: {} });
      log.push(`create:${id}`);
      return Promise.resolve("created");
    },
    exchangeCode: (code) => Promise.resolve(code === "good-code" ? "google-refresh" : null),
    storeGoogleToken: (_id, token) => { stored.push(token); return Promise.resolve(); },
  };
  return { deps, rows, log, stored };
}

Deno.test("Google sign-in needs an id token, a raw nonce and the adult confirmation", async () => {
  for (const [body, field] of [
    [{ nonce: "n", adult_confirmed: true }, "id_token"],
    [{ id_token: "t", adult_confirmed: true }, "nonce"],
    [{ id_token: "t", nonce: "n" }, "adult_confirmed"],
    [{ id_token: "t", nonce: "n", adult_confirmed: true, server_auth_code: 7 }, "server_auth_code"],
  ] as const) {
    const error = await assertRejects(() => Promise.resolve().then(() => googleInput(body)), ApiError);
    assertEquals(error.extra.field, field);
  }
});

Deno.test("a verified Google email creates one google profile named by the person, never by Google", async () => {
  const { deps, rows, log } = memoryDeps(verified(ID));
  const input = googleInput({ id_token: " tok ", nonce: " n ", adult_confirmed: true, name: "Ava From Google" });
  const result = await completeGoogleSignIn(input, deps);
  assertEquals(log.slice(0, 2), ["verify:tok:n", `scrub:${ID}`]);
  assertEquals(result.created, true);
  assertEquals(result.access_token, `access-${ID}`);
  assertEquals(rows.get(ID)?.auth_provider, "google");
  assertEquals(rows.get(ID)?.name, "You");
  assert(!JSON.stringify(rows.get(ID)).includes("Ava From Google"));
});

Deno.test("an unverified or missing email is refused, and the claims are scrubbed even then", async () => {
  for (const identity of [verified(ID, "ava@example.com", false), verified(ID, null)]) {
    const { deps, rows, log } = memoryDeps(identity);
    const error = await assertRejects(() => completeGoogleSignIn(googleInput({ id_token: "t", nonce: "n", adult_confirmed: true }), deps), ApiError);
    assertEquals(error.code, "unauthorized");
    assert(log.includes(`scrub:${ID}`));
    assertEquals(rows.size, 0);
  }
});

Deno.test("a failed claim scrub fails the sign-in closed: no profile, no session", async () => {
  const { deps, rows } = memoryDeps(verified(ID));
  deps.scrubProfileClaims = () => Promise.reject(new Error("rpc down"));
  const error = await assertRejects(() => completeGoogleSignIn(googleInput({ id_token: "t", nonce: "n", adult_confirmed: true }), deps), ApiError);
  assertEquals(error.code, "internal");
  assertEquals(rows.size, 0);
});

Deno.test("a Google token Supabase rejects is unauthorized", async () => {
  const { deps } = memoryDeps(new Error("bad audience"));
  const error = await assertRejects(() => completeGoogleSignIn(googleInput({ id_token: "t", nonce: "n", adult_confirmed: true }), deps), ApiError);
  assertEquals(error.code, "unauthorized");
});

Deno.test("one person one account: an existing account (same verified email, linked by Auth) signs in, unchanged", async () => {
  const rows = new Map([[ID, { id: ID, name: "Ava", auth_provider: "apple", settings: {} }]]);
  const { deps } = memoryDeps(verified(ID), rows);
  const result = await completeGoogleSignIn(googleInput({ id_token: "t", nonce: "n", adult_confirmed: true }), deps);
  assertEquals(result.created, false);
  assertEquals(rows.get(ID)?.auth_provider, "apple");
  assertEquals(rows.get(ID)?.name, "Ava");
});

Deno.test("a deleted account cannot sign back in with Google", async () => {
  const rows = new Map([[ID, { id: ID, name: "Deleted account", deleted_at: "2026-11-01T00:00:00Z", settings: {} }]]);
  const { deps } = memoryDeps(verified(ID), rows);
  const error = await assertRejects(() => completeGoogleSignIn(googleInput({ id_token: "t", nonce: "n", adult_confirmed: true }), deps), ApiError);
  assertEquals(error.code, "unauthorized");
});

Deno.test("the server code is exchanged and stored; a failed exchange never fails the sign-in", async () => {
  const ok = memoryDeps(verified(ID));
  await completeGoogleSignIn(googleInput({ id_token: "t", nonce: "n", adult_confirmed: true, server_auth_code: "good-code" }), ok.deps);
  assertEquals(ok.stored, ["google-refresh"]);
  const bad = memoryDeps(verified(ID));
  bad.deps.exchangeCode = () => Promise.reject(new Error("google down"));
  const result = await completeGoogleSignIn(googleInput({ id_token: "t", nonce: "n", adult_confirmed: true, server_auth_code: "x" }), bad.deps);
  assertEquals(result.created, true);
  assertEquals(bad.stored, []);
});

Deno.test("google_auth: exchange is a no-op unconfigured, posts the form when configured; revoke reports Google's answer", async () => {
  let calls = 0;
  const never = (() => { calls++; return Promise.resolve(new Response("{}")); }) as typeof fetch;
  assertEquals(await exchangeGoogleCode({ googleWebClientId: null, googleWebClientSecret: null }, "c", never), null);
  assertEquals(calls, 0);
  let sent = "";
  const google = ((url: string, init?: RequestInit) => {
    sent = `${url} ${init?.body}`;
    return Promise.resolve(new Response(JSON.stringify({ refresh_token: "r1", id_token: "x" }), { status: 200 }));
  }) as typeof fetch;
  assertEquals(await exchangeGoogleCode({ googleWebClientId: "web-id", googleWebClientSecret: "web-secret" }, "code-1", google), "r1");
  assert(sent.startsWith("https://oauth2.googleapis.com/token "));
  assert(sent.includes("grant_type=authorization_code") && sent.includes("client_id=web-id") && sent.includes("code=code-1"));
  const status = (s: number) => (() => Promise.resolve(new Response("", { status: s }))) as typeof fetch;
  assertEquals(await revokeGoogleToken("r1", status(200)), true);
  assertEquals(await revokeGoogleToken("r1", status(400)), false);
  assertEquals(await revokeGoogleToken("r1", (() => Promise.reject(new Error("offline"))) as typeof fetch), false);
  assertEquals(await revokeGoogleToken("", status(200)), false);
});

Deno.test("scrubbedClaims keeps the email and drops every name and photo claim", () => {
  const meta = Object.fromEntries([...GOOGLE_PROFILE_CLAIMS.map((k) => [k, "x"]), ["email", "ava@example.com"], ["email_verified", true], ["sub", "123"]]);
  assertEquals(scrubbedClaims(meta), { email: "ava@example.com", email_verified: true, sub: "123" });
});

Deno.test("migration 0063: scrub_google_profile removes name and photo from auth.users and the Google identity only", async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
    create table auth.identities(user_id uuid, provider text, identity_data jsonb);
    create table public.profiles(id uuid primary key, auth_provider text not null default 'legacy'
      constraint profiles_auth_provider_check check (auth_provider in ('apple', 'preview', 'legacy')));`);
  await pg.exec(await Deno.readTextFile(new URL("../../supabase/migrations/0063_google_signin.sql", import.meta.url)));
  const meta = JSON.stringify({ email: "ava@example.com", name: "Ava", full_name: "Ava Stone", picture: "https://p", avatar_url: "https://a", sub: "1" });
  await pg.query("insert into auth.users values ($1, $2::jsonb)", [ID, meta]);
  await pg.query("insert into auth.identities values ($1, 'google', $2::jsonb), ($1, 'apple', $2::jsonb)", [ID, meta]);
  await pg.query("select public.scrub_google_profile($1)", [ID]);
  const user = (await pg.query<{ m: Record<string, unknown> }>("select raw_user_meta_data m from auth.users")).rows[0].m;
  assertEquals(user, { email: "ava@example.com", sub: "1" });
  const ids = (await pg.query<{ provider: string; d: Record<string, unknown> }>("select provider, identity_data d from auth.identities order by provider")).rows;
  assertEquals(ids[1].d, { email: "ava@example.com", sub: "1" });
  assertEquals(ids[0].d.name, "Ava"); // the Apple identity is not Google's to scrub
  await pg.query("insert into public.profiles(id, auth_provider) values ($1, 'google')", [ID]);
  // Only the service role may call it.
  const grants = (await pg.query<{ r: string }>(
    "select grantee r from information_schema.routine_privileges where routine_name = 'scrub_google_profile' order by 1")).rows.map((r) => r.r);
  assert(grants.includes("service_role") && !grants.includes("anon") && !grants.includes("authenticated") && !grants.includes("PUBLIC"), grants.join(","));
});

Deno.test("the session is reissued after the scrub, so the phone keeps a token minted without Google's name; a failed reissue fails closed", async () => {
  const { deps, log, rows } = memoryDeps(verified(ID));
  deps.reissue = (rt) => { log.push(`reissue:${rt}`); return Promise.resolve({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_at: 1_800_000_100 }); };
  const result = await completeGoogleSignIn(googleInput({ id_token: "t", nonce: "n", adult_confirmed: true }), deps);
  assertEquals(log.slice(0, 3), ["verify:t:n", `scrub:${ID}`, `reissue:refresh-${ID}`]);
  assertEquals([result.access_token, result.refresh_token], ["fresh-access", "fresh-refresh"]);
  assertEquals(result.expires_at, new Date(1_800_000_100 * 1000).toISOString());

  const failing = memoryDeps(verified(ID), new Map());
  failing.deps.reissue = () => Promise.reject(new Error("refresh refused"));
  const error = await assertRejects(() => completeGoogleSignIn(googleInput({ id_token: "t", nonce: "n", adult_confirmed: true }), failing.deps), ApiError);
  assertEquals(error.code, "internal");
  assertEquals(failing.rows.size, 0);
  assert(rows.has(ID));
});
