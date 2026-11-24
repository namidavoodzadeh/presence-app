// SD6b (system design work plan #6, Q9): Apple code exchange, token revocation and the encryption that sits between
// them, all behind fakes — no real Apple endpoint is ever called here.
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  type AppleAuthEnv,
  appleClientSecret,
  appleConfigured,
  decryptAppleToken,
  encryptAppleToken,
  exchangeAppleCode,
  revokeAppleToken,
} from "../api/lib/apple_auth.ts";

const UNCONFIGURED: AppleAuthEnv = {
  appleTeamId: null,
  appleKeyId: null,
  applePrivateKey: null,
  appleClientId: null,
};

function pemFromPkcs8(bytes: ArrayBuffer): string {
  let raw = "";
  for (const byte of new Uint8Array(bytes)) raw += String.fromCharCode(byte);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(raw)}\n-----END PRIVATE KEY-----`;
}

async function fakeAppleKeyPair(): Promise<{ env: AppleAuthEnv; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    env: {
      appleTeamId: "TEAM123456",
      appleKeyId: "KEY123456",
      applePrivateKey: pemFromPkcs8(pkcs8),
      appleClientId: "com.namidavoodzadeh.presence",
    },
    publicKey: pair.publicKey,
  };
}

Deno.test("Apple auth is a no-op everywhere credentials aren't configured — the state of every build today", async () => {
  assertEquals(appleConfigured(UNCONFIGURED), false);
  assertEquals(await appleClientSecret(UNCONFIGURED), null);
  assertEquals(await exchangeAppleCode(UNCONFIGURED, "some-code"), null);
  assertEquals(await revokeAppleToken(UNCONFIGURED, "some-refresh-token"), false);
});

Deno.test("a missing single field (client id, team id, key id or private key) is still unconfigured", async () => {
  const { env } = await fakeAppleKeyPair();
  for (const field of ["appleTeamId", "appleKeyId", "applePrivateKey", "appleClientId"] as const) {
    assertEquals(appleConfigured({ ...env, [field]: null }), false);
  }
  assertEquals(appleConfigured(env), true);
});

Deno.test("the client secret is a real ES256 JWT with Apple's required claims, verifiable with the matching public key", async () => {
  const { env, publicKey } = await fakeAppleKeyPair();
  const now = Date.UTC(2026, 10, 7, 12, 0, 0);
  const jwt = await appleClientSecret(env, now);
  assert(jwt);
  const [headerB64, claimsB64, sigB64] = jwt!.split(".");
  const pad = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const header = JSON.parse(atob(pad(headerB64)));
  const claims = JSON.parse(atob(pad(claimsB64)));
  assertEquals(header, { alg: "ES256", kid: "KEY123456" });
  assertEquals(claims.iss, "TEAM123456");
  assertEquals(claims.sub, "com.namidavoodzadeh.presence");
  assertEquals(claims.aud, "https://appleid.apple.com");
  assertEquals(claims.iat, Math.floor(now / 1000));
  assert(claims.exp > claims.iat && claims.exp - claims.iat <= 15 * 60);

  const sig = Uint8Array.from(atob(pad(sigB64)), (c) => c.charCodeAt(0));
  const signed = new TextEncoder().encode(`${headerB64}.${claimsB64}`);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, sig, signed);
  assert(ok);
});

Deno.test("exchanging a code posts to Apple's token endpoint and returns only the refresh token", async () => {
  const { env } = await fakeAppleKeyPair();
  const calls: { url: string; body: string }[] = [];
  const fetcher = ((url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return Promise.resolve(
      new Response(JSON.stringify({ refresh_token: "r-123", access_token: "a-123" }), { status: 200 }),
    );
  }) as typeof fetch;
  const token = await exchangeAppleCode(env, "the-code", fetcher);
  assertEquals(token, "r-123");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://appleid.apple.com/auth/token");
  const body = new URLSearchParams(calls[0].body);
  assertEquals(body.get("code"), "the-code");
  assertEquals(body.get("grant_type"), "authorization_code");
  assertEquals(body.get("client_id"), "com.namidavoodzadeh.presence");
  assert(body.get("client_secret"));
});

Deno.test("a failed or malformed exchange returns null, never throws", async () => {
  const { env } = await fakeAppleKeyPair();
  const failing = (() => Promise.resolve(new Response("", { status: 400 }))) as typeof fetch;
  assertEquals(await exchangeAppleCode(env, "x", failing), null);

  const noToken =
    (() =>
      Promise.resolve(new Response(JSON.stringify({ access_token: "a" }), { status: 200 }))) as typeof fetch;
  assertEquals(await exchangeAppleCode(env, "x", noToken), null);

  const throwing = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
  assertEquals(await exchangeAppleCode(env, "x", throwing), null);
});

Deno.test("revoking posts token_type_hint=refresh_token and reports success only on a 200", async () => {
  const { env } = await fakeAppleKeyPair();
  const calls: { url: string; body: string }[] = [];
  const ok = ((url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return Promise.resolve(new Response("", { status: 200 }));
  }) as typeof fetch;
  assertEquals(await revokeAppleToken(env, "r-123", ok), true);
  assertEquals(calls[0].url, "https://appleid.apple.com/auth/revoke");
  const body = new URLSearchParams(calls[0].body);
  assertEquals(body.get("token"), "r-123");
  assertEquals(body.get("token_type_hint"), "refresh_token");

  const rejected = (() => Promise.resolve(new Response("", { status: 400 }))) as typeof fetch;
  assertEquals(await revokeAppleToken(env, "r-123", rejected), false);

  const thrown = (() => Promise.reject(new Error("timeout"))) as unknown as typeof fetch;
  assertEquals(await revokeAppleToken(env, "r-123", thrown), false);
});

Deno.test("an encrypted Apple token round-trips and is unreadable without the exact key", async () => {
  const stored = await encryptAppleToken("service-role-key-abc", "a-real-refresh-token");
  assertNotEquals(stored, "a-real-refresh-token");
  assert(!stored.includes("a-real-refresh-token"));
  assertEquals(await decryptAppleToken("service-role-key-abc", stored), "a-real-refresh-token");
  assertEquals(await decryptAppleToken("a-different-service-role-key", stored), null);
});

Deno.test("decrypting garbage or a malformed value returns null, never throws", async () => {
  assertEquals(await decryptAppleToken("service-role-key-abc", "not-encrypted-at-all"), null);
  assertEquals(await decryptAppleToken("service-role-key-abc", "AAAA.BBBB"), null);
});
