// Apple's REST authentication API: code exchange and token revocation (SD6b, system design work plan #6). A stored
// Apple refresh token lets DELETE /account revoke access at Apple's end, not just locally — App Store review requires
// this for Sign in with Apple accounts. Every function here is a no-op — never throws, never blocks its caller — when
// APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY aren't configured, which is every environment until Nami creates the
// Apple key (ANSWERS, COO 2026-11-06 17:15 Tehran, Q9). No hosted secret is required to land this: the no-op path is
// what every build runs today.

const AUD = "https://appleid.apple.com";
const TOKEN_URL = `${AUD}/auth/token`;
const REVOKE_URL = `${AUD}/auth/revoke`;
const CLIENT_SECRET_TTL_S = 15 * 60; // short-lived; Apple allows up to 6 months but there is no reason to hold one that long

function base64urlEncode(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function pkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!body) throw new Error("Apple private key is empty");
  const raw = atob(body), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export interface AppleAuthEnv {
  appleTeamId: string | null;
  appleKeyId: string | null;
  applePrivateKey: string | null;
  appleClientId: string | null;
}

export function appleConfigured(env: AppleAuthEnv): boolean {
  return Boolean(env.appleTeamId && env.appleKeyId && env.applePrivateKey && env.appleClientId);
}

/** Apple's "client secret" is a short-lived ES256 JWT, not a static value (same shape as push.ts's APNs JWT). */
export async function appleClientSecret(env: AppleAuthEnv, now = Date.now()): Promise<string | null> {
  if (!appleConfigured(env)) return null;
  const iat = Math.floor(now / 1000);
  const header = base64urlEncode(utf8(JSON.stringify({ alg: "ES256", kid: env.appleKeyId })));
  const claims = base64urlEncode(utf8(JSON.stringify({
    iss: env.appleTeamId,
    iat,
    exp: iat + CLIENT_SECRET_TTL_S,
    aud: AUD,
    sub: env.appleClientId,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8(env.applePrivateKey!).buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(unsigned).buffer as ArrayBuffer),
  );
  return `${unsigned}.${base64urlEncode(signature)}`;
}

export interface AppleTokenResponse {
  refresh_token?: string;
  access_token?: string;
  [key: string]: unknown;
}

/** Exchange a one-time authorization code for Apple's refresh token. Returns null — never throws — when Apple's
 *  credentials aren't configured yet, or when Apple's own call fails; a failed exchange never blocks sign-in. */
export async function exchangeAppleCode(
  env: AppleAuthEnv,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const secret = await appleClientSecret(env);
  if (!secret) return null;
  try {
    const response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.appleClientId!,
        client_secret: secret,
        code,
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as AppleTokenResponse;
    return typeof data.refresh_token === "string" ? data.refresh_token : null;
  } catch {
    return null;
  }
}

/** Revoke a stored refresh token at Apple. Returns false on any failure — missing credentials, a non-200 reply, a
 *  network error — and never throws: the caller logs a Ref and deletes the account regardless (deletion is never
 *  blocked by a third party being unreachable). */
export async function revokeAppleToken(
  env: AppleAuthEnv,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const secret = await appleClientSecret(env);
  if (!secret) return false;
  try {
    const response = await fetcher(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.appleClientId!,
        client_secret: secret,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ---- Encryption at rest for the stored refresh token (law 10) --------------------------------------------------
// Keyed off the service-role key already held only by the server, so no new secret needs provisioning before Nami
// creates the Apple key; once a real key exists, rotating the service-role key naturally rotates this too.

async function tokenKey(serviceRoleKey: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    utf8(`presence-apple-token:${serviceRoleKey}`).buffer as ArrayBuffer,
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptAppleToken(serviceRoleKey: string, token: string): Promise<string> {
  const key = await tokenKey(serviceRoleKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8(token).buffer as ArrayBuffer),
  );
  return `${base64urlEncode(iv)}.${base64urlEncode(cipher)}`;
}

/** Null on any failure (corrupt value, wrong key after rotation) rather than throwing: a revoke that can't decrypt
 *  its stored token is treated the same as having none — it never blocks DELETE /account. */
export async function decryptAppleToken(serviceRoleKey: string, stored: string): Promise<string | null> {
  const [ivPart, cipherPart] = stored.split(".");
  if (!ivPart || !cipherPart) return null;
  try {
    const key = await tokenKey(serviceRoleKey);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64urlDecode(ivPart).buffer as ArrayBuffer },
      key,
      base64urlDecode(cipherPart).buffer as ArrayBuffer,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
