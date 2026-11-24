// Two clients per request: the person's (anon key + their bearer, so RLS applies) and the service one
// (ledger, engine_calls, errors, preview login). The service-role key never leaves the function.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ApiEnv } from "./env.ts";
import { ApiError } from "./errors.ts";

export interface Caller {
  id: string;
  db: SupabaseClient;          // RLS-scoped
  persona: string | null;      // preview persona slug, if a preview account
  isExample: boolean;
  isPreview: boolean;
  profile: Record<string, unknown>; // profile read during auth; reused by read routes
  mapDeleteAt: string | null;  // "Delete my map" was tapped; the undo window closes at this time (CONTRACT §7 Data, Q63)
  mapPurged: boolean;          // this request found the window closed and purged the map first
}

export function serviceClient(env: ApiEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function anonClient(env: ApiEnv, bearer?: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {},
  });
}

/** Read the claimed subject so the RLS profile fetch can overlap auth validation. The claim is never trusted on its own. */
export function bearerSubject(bearer: string): string | null {
  try {
    const part = bearer.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const sub = JSON.parse(atob(base64)).sub;
    return typeof sub === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sub) ? sub : null;
  } catch { return null; }
}

/** Resolve the bearer to a person. 401 without a valid session. */
export async function authenticate(env: ApiEnv, req: Request): Promise<Caller> {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) throw new ApiError("unauthorized", "Sign in to continue.");
  const claimedId = bearerSubject(bearer);
  if (!claimedId) throw new ApiError("unauthorized", "Sign in to continue.");
  const db = anonClient(env, bearer);
  const [{ data, error }, profileResult] = await Promise.all([
    db.auth.getUser(bearer),
    db.from("profiles").select("*").eq("id", claimedId).maybeSingle(),
  ]);
  if (error || !data.user || data.user.id !== claimedId) throw new ApiError("unauthorized", "Sign in to continue.");
  if (profileResult.error) dbError(profileResult.error, "profiles");
  const profile = (profileResult.data ?? { id: data.user.id }) as Record<string, unknown>;
  if (profile?.deleted_at) throw new ApiError("unauthorized", "Sign in to continue.", { detail: "deleted account" });   // DELETE /account happened
  return { id: data.user.id, db, persona: (profile.persona as string | null) ?? null, isExample: profile.is_example === true, isPreview: profile.is_preview === true,
    profile, mapDeleteAt: (profile.map_delete_at as string | null) ?? null, mapPurged: false };
}

/** Throw the ApiError that matches a PostgREST/PL error, so router code stays short. */
export function dbError(error: { code?: string; message?: string; details?: string } | null, where: string): never {
  const msg = error?.message ?? "";
  if (/sealed/.test(msg)) throw new ApiError("sealed", "It opens at its time.", { deliver_at: error?.details ?? null });
  if (/not_found/.test(msg) || error?.code === "PGRST116") throw new ApiError("not_found", "", { where });
  if (/conflict/.test(msg) || error?.code === "23505") throw new ApiError("conflict", "", { where });
  if (/invalid/.test(msg) || error?.code === "22P02" || error?.code === "23514") throw new ApiError("invalid", "", { where });
  if (/fetch failed|ECONN|ENOTFOUND|timeout/i.test(msg)) throw new ApiError("unreachable", "Can't reach Presence right now.");
  throw new ApiError("internal", "", { where, detail: msg });
}
