// Real-account authentication. Apple proves the credential to Supabase Auth; Presence never accepts an Apple subject or email
// from the client and never stores the identity token. The returned Supabase session is the bearer used by every other route.

import type { Session, SupabaseClient, User } from "npm:@supabase/supabase-js@2";
import { anonClient, dbError } from "./lib/db.ts";
import { ApiError, json } from "./lib/errors.ts";
import { meObjectFromRow } from "./lib/objects.ts";
import { route } from "./lib/router.ts";
import type { ApiEnv } from "./lib/env.ts";
import { encryptAppleToken, exchangeAppleCode } from "./lib/apple_auth.ts";
import { exchangeGoogleCode } from "./lib/google_auth.ts";

const TERMS_VERSION = "2026-10-29";
const TOKEN_LIMIT = 16_384;
const NONCE_LIMIT = 512;
const AUTH_CODE_LIMIT = 2_048;

export interface AppleInput {
  identity_token: string;
  nonce: string;
  name: string | null;
  adult_confirmed: true;
  /** SD6b: the one-time code Apple's native sign-in sheet also returns, exchanged for a refresh token so
   *  DELETE /account can later revoke it at Apple. Optional: an older app build or a re-sign-in with no fresh
   *  code omits it, and a missing Apple key on the server makes the exchange itself a no-op either way. */
  authorization_code: string | null;
}

export interface AppleIdentity {
  user: Pick<User, "id">;
  session: Pick<Session, "access_token" | "refresh_token" | "expires_at">;
}

export interface AppleSignInDeps {
  verify: (identityToken: string, rawNonce: string) => Promise<AppleIdentity>;
  profile: (userId: string) => Promise<Record<string, unknown> | null>;
  createProfile: (row: Record<string, unknown>) => Promise<"created" | "exists">;
  /** SD6b, both optional: a build with no Apple key configured, or a test that doesn't care about token storage,
   *  omits them and the exchange step is skipped entirely — never a failure, just nothing stored. */
  exchangeCode?: (authorizationCode: string) => Promise<string | null>;
  storeAppleToken?: (userId: string, refreshToken: string) => Promise<void>;
}

function cleanName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ApiError("invalid", "", { field: "name" });
  const name = value.replace(/\s+/g, " ").trim().slice(0, 40);
  return name || null;
}

/** Validate only the request envelope. Token claims are deliberately not decoded or trusted here. */
export function appleInput(body: Record<string, unknown>): AppleInput {
  const identityToken = typeof body.identity_token === "string" ? body.identity_token.trim() : "";
  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
  if (!identityToken || identityToken.length > TOKEN_LIMIT) {
    throw new ApiError("invalid", "", { field: "identity_token" });
  }
  if (!nonce || nonce.length > NONCE_LIMIT) throw new ApiError("invalid", "", { field: "nonce" });
  if (body.adult_confirmed !== true) throw new ApiError("invalid", "", { field: "adult_confirmed" });
  const rawCode = body.authorization_code;
  if (rawCode !== undefined && rawCode !== null && typeof rawCode !== "string") {
    throw new ApiError("invalid", "", { field: "authorization_code" });
  }
  const authorizationCode = typeof rawCode === "string" ? rawCode.trim() : "";
  if (authorizationCode.length > AUTH_CODE_LIMIT) throw new ApiError("invalid", "", { field: "authorization_code" });
  return {
    identity_token: identityToken,
    nonce,
    name: cleanName(body.name),
    adult_confirmed: true,
    authorization_code: authorizationCode || null,
  };
}

/**
 * Complete a verified Apple sign-in. A retry or a later sign-in never overwrites the person's chosen name or settings.
 * `createProfile` returns `exists` for the concurrent-first-login race; the winner's row is then loaded.
 */
export async function completeAppleSignIn(input: AppleInput, deps: AppleSignInDeps) {
  let identity: AppleIdentity;
  try {
    identity = await deps.verify(input.identity_token, input.nonce);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("unauthorized", "Apple couldn't verify this sign-in.", {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const userId = identity.user.id;
  if (!userId) throw new ApiError("unauthorized", "Apple couldn't verify this sign-in.");

  let profile = await deps.profile(userId);
  if (profile?.deleted_at) {
    throw new ApiError("unauthorized", "Sign in to continue.", { detail: "deleted account" });
  }
  let created = false;
  if (!profile) {
    const outcome = await deps.createProfile({
      id: userId,
      name: input.name ?? "You",
      is_example: false,
      is_preview: false,
      auth_provider: "apple",
      adult_confirmed_at: new Date().toISOString(),
      terms_version: TERMS_VERSION,
    });
    created = outcome === "created";
    profile = await deps.profile(userId);
  }
  if (!profile) throw new ApiError("internal", "", { detail: "profile missing after Apple sign-in" });

  // SD6b: never lets a code-exchange hiccup — Apple's key not yet configured, Apple's own call failing — touch the
  // sign-in that already succeeded. Swallowed deliberately; nothing here is in the response or on the Ref path.
  if (input.authorization_code && deps.exchangeCode && deps.storeAppleToken) {
    try {
      const refreshToken = await deps.exchangeCode(input.authorization_code);
      if (refreshToken) await deps.storeAppleToken(userId, refreshToken);
    } catch { /* sign-in already succeeded; a missed token store just means DELETE /account can't revoke later */ }
  }

  const expiresAt = identity.session.expires_at
    ? new Date(identity.session.expires_at * 1000).toISOString()
    : null;
  return {
    access_token: identity.session.access_token,
    refresh_token: identity.session.refresh_token,
    expires_at: expiresAt,
    created,
    me: meObjectFromRow(profile),
  };
}

async function verifyWithSupabase(env: ApiEnv, identityToken: string, nonce: string): Promise<AppleIdentity> {
  const auth = anonClient(env);
  const { data, error } = await auth.auth.signInWithIdToken({
    provider: "apple",
    token: identityToken,
    nonce,
  });
  if (error || !data.user || !data.session) {
    throw new ApiError("unauthorized", "Apple couldn't verify this sign-in.", {
      detail: error?.message ?? "no session",
    });
  }
  return { user: data.user, session: data.session };
}

function depsFor(env: ApiEnv, service: SupabaseClient): AppleSignInDeps {
  return {
    verify: (token, nonce) => verifyWithSupabase(env, token, nonce),
    profile: async (id) => {
      const { data, error } = await service.from("profiles").select("*").eq("id", id).maybeSingle();
      if (error) dbError(error, "profiles.apple");
      return data;
    },
    createProfile: async (row) => {
      const { error } = await service.from("profiles").insert(row);
      if (!error) return "created";
      if (error.code === "23505") return "exists";
      dbError(error, "profiles.apple.insert");
    },
    exchangeCode: (code) =>
      exchangeAppleCode({
        appleTeamId: env.appleTeamId,
        appleKeyId: env.appleKeyId,
        applePrivateKey: env.applePrivateKey,
        appleClientId: env.appleClientId,
      }, code),
    storeAppleToken: async (userId, refreshToken) => {
      const enc = await encryptAppleToken(env.serviceRoleKey, refreshToken);
      const { error } = await service.from("profiles").update({ apple_refresh_token_enc: enc }).eq("id", userId);
      if (error) dbError(error, "profiles.apple_token");
    },
  };
}

route("POST", "/auth/apple", async ({ env, service, body }) => {
  const input = appleInput(await body());
  return json(await completeAppleSignIn(input, depsFor(env, service)));
}, false);


// ------------------------------------------------------------------ POST /auth/google (STAGING first)
// d-ceo-cdo-coo-google-signin-14nov, CPO-S-1. Same shape as Apple: Supabase Auth checks the Google ID token and nonce;
// Presence never trusts a Google subject, email or name from the client. Rules: keep only the email (never Google's
// name or photo: the profile claims Supabase copies from the token are scrubbed after every sign-in, and the sign-in
// fails closed if the scrub fails); a verified email only; one person one account (Supabase links a verified Google
// email to the account that already has it, so that person signs in to it, never a silent second account); delete
// revokes our Google grant (data.ts). No `name` is read from the body: the person names themselves in the app.

export interface GoogleInput {
  id_token: string;
  nonce: string;
  adult_confirmed: true;
  /** The one-time server auth code the iOS sheet returns; exchanged for a refresh token so delete can revoke it. */
  server_auth_code: string | null;
}

export interface GoogleIdentity extends AppleIdentity {
  user: Pick<User, "id" | "email" | "email_confirmed_at">;
}

export interface GoogleSignInDeps {
  verify: (idToken: string, rawNonce: string) => Promise<GoogleIdentity>;
  /** Removes Google's name and photo claims from the auth user and its Google identity (migration 0063). */
  scrubProfileClaims: (userId: string) => Promise<void>;
  /** Trades the first session for a fresh one, so the access token the phone keeps is minted from the scrubbed
   *  metadata (the first JWT's user_metadata still carries Google's name and photo). */
  reissue?: (refreshToken: string) => Promise<AppleIdentity["session"]>;
  profile: (userId: string) => Promise<Record<string, unknown> | null>;
  createProfile: (row: Record<string, unknown>) => Promise<"created" | "exists">;
  exchangeCode?: (serverAuthCode: string) => Promise<string | null>;
  storeGoogleToken?: (userId: string, refreshToken: string) => Promise<void>;
}

export function googleInput(body: Record<string, unknown>): GoogleInput {
  const idToken = typeof body.id_token === "string" ? body.id_token.trim() : "";
  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
  if (!idToken || idToken.length > TOKEN_LIMIT) throw new ApiError("invalid", "", { field: "id_token" });
  if (!nonce || nonce.length > NONCE_LIMIT) throw new ApiError("invalid", "", { field: "nonce" });
  if (body.adult_confirmed !== true) throw new ApiError("invalid", "", { field: "adult_confirmed" });
  const rawCode = body.server_auth_code;
  if (rawCode !== undefined && rawCode !== null && typeof rawCode !== "string") {
    throw new ApiError("invalid", "", { field: "server_auth_code" });
  }
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (code.length > AUTH_CODE_LIMIT) throw new ApiError("invalid", "", { field: "server_auth_code" });
  return { id_token: idToken, nonce, adult_confirmed: true, server_auth_code: code || null };
}

const GOOGLE_REFUSED = "Google couldn't verify this sign-in.";

export async function completeGoogleSignIn(input: GoogleInput, deps: GoogleSignInDeps) {
  let identity: GoogleIdentity;
  try {
    identity = await deps.verify(input.id_token, input.nonce);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("unauthorized", GOOGLE_REFUSED, { detail: error instanceof Error ? error.message : String(error) });
  }
  const userId = identity.user.id;
  if (!userId) throw new ApiError("unauthorized", GOOGLE_REFUSED);
  // Scrub first, whatever happens next: Supabase has already written the token's claims by now.
  try {
    await deps.scrubProfileClaims(userId);
  } catch (error) {
    throw new ApiError("internal", "", { detail: `google claim scrub failed: ${error instanceof Error ? error.message : String(error)}` });
  }
  let session = identity.session;
  if (deps.reissue) {
    try {
      session = await deps.reissue(identity.session.refresh_token);
    } catch (error) {
      throw new ApiError("internal", "", { detail: `google session reissue failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  if (!identity.user.email || !identity.user.email_confirmed_at) {
    throw new ApiError("unauthorized", GOOGLE_REFUSED, { detail: "email missing or not verified" });
  }

  let profile = await deps.profile(userId);
  if (profile?.deleted_at) throw new ApiError("unauthorized", "Sign in to continue.", { detail: "deleted account" });
  let created = false;
  if (!profile) {
    const outcome = await deps.createProfile({
      id: userId,
      name: "You",
      is_example: false,
      is_preview: false,
      auth_provider: "google",
      adult_confirmed_at: new Date().toISOString(),
      terms_version: TERMS_VERSION,
    });
    created = outcome === "created";
    profile = await deps.profile(userId);
  }
  if (!profile) throw new ApiError("internal", "", { detail: "profile missing after Google sign-in" });

  // As Apple: a failed exchange never touches the sign-in that already succeeded; it only means delete can't revoke.
  if (input.server_auth_code && deps.exchangeCode && deps.storeGoogleToken) {
    try {
      const refreshToken = await deps.exchangeCode(input.server_auth_code);
      if (refreshToken) await deps.storeGoogleToken(userId, refreshToken);
    } catch { /* sign-in already succeeded */ }
  }

  const expiresAt = session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: expiresAt,
    created,
    me: meObjectFromRow(profile),
  };
}

async function verifyGoogleWithSupabase(env: ApiEnv, idToken: string, nonce: string): Promise<GoogleIdentity> {
  const auth = anonClient(env);
  const { data, error } = await auth.auth.signInWithIdToken({ provider: "google", token: idToken, nonce });
  if (error || !data.user || !data.session) {
    throw new ApiError("unauthorized", GOOGLE_REFUSED, { detail: error?.message ?? "no session" });
  }
  return { user: data.user, session: data.session };
}

function googleDepsFor(env: ApiEnv, service: SupabaseClient): GoogleSignInDeps {
  const apple = depsFor(env, service);
  return {
    verify: (token, nonce) => verifyGoogleWithSupabase(env, token, nonce),
    scrubProfileClaims: async (userId) => {
      const { error } = await service.rpc("scrub_google_profile", { p_user: userId });
      if (error) throw new Error(error.message);
    },
    reissue: async (refreshToken) => {
      const { data, error } = await anonClient(env).auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) throw new Error(error?.message ?? "no session");
      return data.session;
    },
    profile: apple.profile,
    createProfile: apple.createProfile,
    exchangeCode: (code) => exchangeGoogleCode({ googleWebClientId: env.googleWebClientId ?? null, googleWebClientSecret: env.googleWebClientSecret ?? null }, code),
    storeGoogleToken: async (userId, refreshToken) => {
      const enc = await encryptAppleToken(env.serviceRoleKey, refreshToken);
      const { error } = await service.from("profiles").update({ google_refresh_token_enc: enc }).eq("id", userId);
      if (error) dbError(error, "profiles.google_token");
    },
  };
}

route("POST", "/auth/google", async ({ env, service, body }) => {
  const input = googleInput(await body());
  return json(await completeGoogleSignIn(input, googleDepsFor(env, service)));
}, false);
