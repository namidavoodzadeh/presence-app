// Google sign-in, server half (d-ceo-cdo-coo-google-signin-14nov, CPO-S-1; STAGING only until a hosted ask).
// Supabase Auth checks the Google ID token, as it does Apple's (auth.ts). This file holds the two Google REST
// calls we make ourselves and the claim scrub:
//   - exchange the one-time server auth code the iOS sheet returns for a refresh token, kept encrypted (the same
//     AES-GCM helper as Apple's), so DELETE /account can revoke our grant at Google;
//   - revoke that token;
//   - the profile claims Google puts in every ID token (the iOS SDK always asks for basic profile). Supabase copies
//     them into auth.users metadata and auth.identities; we keep only the email, so they are removed after every
//     sign-in (migration 0063, scrub_google_profile).
// Every call is a no-op (never throws, never blocks the caller) when the web client id or secret is not configured.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GoogleAuthEnv {
  googleWebClientId: string | null;
  googleWebClientSecret: string | null;
}

/** The claims we never keep: name and photo in every spelling Google or Supabase uses. */
export const GOOGLE_PROFILE_CLAIMS = [
  "name", "full_name", "given_name", "family_name", "nickname", "preferred_username", "picture", "avatar_url", "locale",
] as const;

export function googleConfigured(env: GoogleAuthEnv): boolean {
  return Boolean(env.googleWebClientId && env.googleWebClientSecret);
}

/** Copy of `meta` without the profile claims (the in-process twin of the SQL scrub, used by tests and the route). */
export function scrubbedClaims(meta: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (!(GOOGLE_PROFILE_CLAIMS as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}

/**
 * Exchange the iOS sheet's server auth code for a refresh token. Returns null when unconfigured, on any Google
 * error, or when Google sends no refresh token (a re-consent can omit it). Never throws.
 * The iOS server code is exchanged with an empty redirect_uri (no browser redirect is involved); confirm on staging.
 */
export async function exchangeGoogleCode(env: GoogleAuthEnv, code: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!googleConfigured(env) || !code) return null;
  try {
    const res = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.googleWebClientId!,
        client_secret: env.googleWebClientSecret!,
        grant_type: "authorization_code",
        redirect_uri: "",
      }).toString(),
    });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const data = await res.json() as { refresh_token?: unknown };
    return typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : null;
  } catch {
    return null;
  }
}

/** Revoke our grant at Google. True only on Google's 200. Never throws. Needs no client secret. */
export async function revokeGoogleToken(token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetcher(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}
