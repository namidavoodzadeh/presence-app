// AI consent (CONTRACT §7 "AI consent", from §11.4 L6; App Store 5.1.2(i); package 01 routes.md "Not ready" 6).
// The person agrees, by version, that their words go to the named AI provider before any is sent. One record per agreement in
// `ai_consent`; a withdrawal only sets `withdrawn_at`, a new agreement adds a row, so the history of what was agreed stays whole.
// The gate: with PRESENCE_REQUIRE_AI_CONSENT on, every route in MODEL_ROUTES checks for a current consent before its first model
// call (and before the ledger reserve) and answers 403 `ai_consent_required` without one. Off (preview), nothing is gated.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Ctx } from "./router.ts";
import { ApiError } from "./errors.ts";
import { dbError } from "./db.ts";

/** The consent text's version. A change of wording or of the provider list moves it on, and the app asks again. */
export const REQUIRED_VERSION = "2027-01";
/** The only versions POST /consent/ai accepts: the current one. */
export const KNOWN_VERSIONS: readonly string[] = [REQUIRED_VERSION];
/** Every third party that receives a person's words. Voice is on-device, so Anthropic alone (§9). */
export const AI_PROVIDERS: readonly string[] = ["anthropic"];

/**
 * Every route that can send a person's words to a model, "METHOD /path" as registered. Each one calls requireAiConsent before its
 * first model call; tests/ai_consent_gate_test.ts holds the same list and drives every entry, so a new model route is added to both.
 */
export const MODEL_ROUTES: readonly string[] = [
  "POST /talk/turn",
  "POST /talk/finish",
  "POST /bridge/insight",
  "POST /bridge/run",
  "POST /bridge/reword-part",
  "POST /bridge/why-it-matters",
  "POST /preview/mirror-sample",
  "POST /comm/talk/turn",
  "POST /comm/items",
];

export interface AiConsentGiven { version: string; providers: string[]; at: string }
export interface AiConsent { required_version: string; providers: string[]; given: AiConsentGiven | null }

type Row = Record<string, unknown>;

/** The person's current record: the latest one not withdrawn, or null. A record for an older version is not current. */
async function currentRow(db: SupabaseClient, owner: string): Promise<Row | null> {
  const { data, error } = await db.from("ai_consent").select("*").eq("owner", owner).is("withdrawn_at", null);
  if (error) dbError(error, "ai_consent");
  const rows = ((data ?? []) as Row[]).slice().sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return rows[0] ?? null;
}

function givenOf(row: Row | null): AiConsentGiven | null {
  if (!row || row.version !== REQUIRED_VERSION) return null;
  return { version: String(row.version), providers: [...((row.providers as string[] | null) ?? [])], at: String(row.at) };
}

export async function aiConsentObject(db: SupabaseClient, owner: string): Promise<AiConsent> {
  return { required_version: REQUIRED_VERSION, providers: [...AI_PROVIDERS], given: givenOf(await currentRow(db, owner)) };
}

/** POST /consent/ai: a new row at the current version, unless that exact consent is already current. */
export async function giveAiConsent(db: SupabaseClient, owner: string, version: unknown, providers: unknown, clientRef: string | null): Promise<AiConsent> {
  if (typeof version !== "string" || !KNOWN_VERSIONS.includes(version)) throw new ApiError("invalid", "", { field: "version" });
  const list = Array.isArray(providers) ? providers : null;
  if (!list || list.length !== AI_PROVIDERS.length || !AI_PROVIDERS.every((p) => list.includes(p))) {
    throw new ApiError("invalid", "", { field: "providers" });
  }
  const current = givenOf(await currentRow(db, owner));
  if (!current || current.version !== version) {
    const { error } = await db.from("ai_consent").insert({
      owner, version, providers: [...AI_PROVIDERS], at: new Date().toISOString(), withdrawn_at: null, client_ref: clientRef,
    });
    if (error) dbError(error, "ai_consent.insert");
  }
  return aiConsentObject(db, owner);
}

/** DELETE /consent/ai: every open record gets `withdrawn_at`; nothing is deleted. */
export async function withdrawAiConsent(db: SupabaseClient, owner: string): Promise<AiConsent> {
  const { error } = await db.from("ai_consent").update({ withdrawn_at: new Date().toISOString() }).eq("owner", owner).is("withdrawn_at", null);
  if (error) dbError(error, "ai_consent.withdraw");
  return aiConsentObject(db, owner);
}

/** True when the gate applies on this deployment (PRESENCE_REQUIRE_AI_CONSENT). */
export function aiConsentRequired(ctx: Pick<Ctx, "env">): boolean {
  return ctx.env.requireAiConsent === true;
}

/** False only when the gate applies and the caller has no current consent (for a route that must keep words before refusing). */
export async function hasAiConsent(ctx: Ctx): Promise<boolean> {
  if (!aiConsentRequired(ctx)) return true;
  return !!ctx.caller && givenOf(await currentRow(ctx.caller.db, ctx.caller.id)) !== null;
}

/** The refusal requireAiConsent throws, for a route that checked hasAiConsent itself. */
export function aiConsentRefusal(extra: Record<string, unknown> = {}): ApiError {
  return new ApiError("forbidden", "", { reason: "ai_consent_required", required_version: REQUIRED_VERSION, ...extra });
}

/**
 * The model-call gate. Call it before the first model call of a route (and before its ledger reserve). Without a current consent
 * it throws 403 `forbidden`, `reason: "ai_consent_required"`, `required_version`, plus `extra` (Talk adds `saved` and `message_id`).
 * `who` defaults to the authenticated caller; a route that authenticates itself passes its own.
 */
export async function requireAiConsent(ctx: Ctx, extra: Record<string, unknown> = {}, who?: { id: string; db: SupabaseClient }): Promise<void> {
  if (!aiConsentRequired(ctx)) return;
  const person = who ?? (ctx.caller ? { id: ctx.caller.id, db: ctx.caller.db } : null);
  const given = person ? givenOf(await currentRow(person.db, person.id)) : null;
  if (!given) throw aiConsentRefusal(extra);
}
