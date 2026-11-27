// Configuration for the `api` function. Hosted: Edge Function secrets and the auto-injected SUPABASE_* vars.
// On the Mac (`deno serve`, port 8820): the same names from the environment, else the owner's secrets files,
// whose keys and values may sit on alternate lines. No value is ever logged.

export interface ApiEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  previewPassword: string;
  previewDeviceSecret: string | null;
  anthropicKey: string | null;
  anthropicWorkspace: string | null;
  apnsKeyId: string | null;
  apnsTeamId: string | null;
  apnsPrivateKey: string | null;
  pushDrainSecret: string | null;
  appleTeamId: string | null;
  appleKeyId: string | null;
  applePrivateKey: string | null;
  appleClientId: string | null;
  /** Google sign-in (staging first): the Web client id and secret, for the server-code exchange. Null = no-op. */
  googleWebClientId?: string | null;
  googleWebClientSecret?: string | null;
  testerToken: string | null;
  liveVoicePhase1?: boolean;
  /** QA-B336 semantic safety check on Talk, Bridge and Bridge insight. Off unless PRESENCE_SAFETY_SEMANTIC is "true": no
   *  staging or hosted cut carries it before QA passes QA-B336 (COO 00:20Z 15 Nov). */
  safetySemantic?: boolean;
  /** K-0003: the three-label Haiku classifier (spec safety-stop.md B, C) behind requireSafetyPass. Off unless PRESENCE_SAFETY_CLASSIFIER is "true"
   *  (and the semantic switch is on); until then the QA-B336 reader decides, exactly as before. */
  safetyClassifier?: boolean;
  partnerEntitlements?: boolean;
  importFromAi?: boolean;
  importHosted?: boolean;
  importOwnerId?: string;
  checkIn?: boolean;
  practicePartner?: boolean;
  practicePartnerOwnerId?: string;
  /** V3 communication items (/comm/items). Off unless PRESENCE_COMM_ITEMS is "true"; then only the account ids in PRESENCE_COMM_OWNER_IDS (comma list, empty = nobody). */
  commItems?: boolean;
  commOwnerIds?: string[];
  /** Private Talk listener guide. Off unless PRESENCE_TALK_GUIDE is "true"; it uses the same owner list as communication items. */
  talkGuide?: boolean;
  /** CONTRACT §7 AI consent (§11.4 L6): the model-call gate. Off unless PRESENCE_REQUIRE_AI_CONSENT is "true" (off in preview, on in release). */
  requireAiConsent?: boolean;
  isHosted: boolean;
  releaseBuild: boolean;
}

export function enabledSwitch(value: string | undefined): boolean {
  return value === "true";
}

// The one owner account authorized for Import. This is an account identifier,
// not a persona/name check, so partner/example accounts cannot acquire access by changing profile data.
export const IMPORT_PREVIEW_OWNER_ID = "0fbbae71-cd59-4e6b-b303-323e9e3344cf";

function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  let pending: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) {
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (value) {
        values[m[1]] = value;
        pending = null;
      } else pending = m[1];
      continue;
    }
    if (pending) {
      values[pending] = line.replace(/^["']|["']$/g, "");
      pending = null;
    }
  }
  return values;
}

async function readFileValues(path: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await Deno.readTextFile(path));
  } catch {
    return {};
  }
}

/** Rotation (ROTATION.md): the server-side key, named by choice and never by surprise. Order: PRESENCE_SERVICE_KEY (our own secret, holds an sb_secret_ key),
 *  then the named entry of the platform's SUPABASE_SECRET_KEYS map (only when PRESENCE_SERVICE_KEY_NAME is set), then the legacy service-role JWT.
 *  Unsetting the first two is the whole rollback. Never throws: an unreadable map is ignored. */
export function pickServiceKey(own: string, mapJson: string, mapName: string, legacy: string): string {
  if (own.trim()) return own.trim();
  if (mapName.trim() && mapJson.trim()) {
    try {
      const v = (JSON.parse(mapJson) as Record<string, unknown>)[mapName.trim()];
      if (typeof v === "string" && v) return v;
    } catch { /* fall through to the legacy key */ }
  }
  return legacy;
}

let cached: ApiEnv | null = null;

export async function loadEnv(): Promise<ApiEnv> {
  if (cached) return cached;
  const get = (k: string) => {
    try {
      return Deno.env.get(k) ?? "";
    } catch {
      return "";
    }
  };
  let url = get("SUPABASE_URL"), anon = get("SUPABASE_ANON_KEY"), service = pickServiceKey(get("PRESENCE_SERVICE_KEY"), get("SUPABASE_SECRET_KEYS"), get("PRESENCE_SERVICE_KEY_NAME"), get("SUPABASE_SERVICE_ROLE_KEY"));
  let preview = get("PRESENCE_PREVIEW_PASSWORD"),
    anthropic = get("ANTHROPIC_API_KEY"),
    workspace = get("ANTHROPIC_WORKSPACE_ID");
  // Never read from a secrets file shipped anywhere near the app bundle: this is the hosted Edge Function's own
  // secret, set directly in the Supabase project, checked against a header a device must carry (never compiled in).
  const previewDeviceSecret = get("PRESENCE_PREVIEW_DEVICE_SECRET") || null;
  const apnsKeyId = get("APNS_KEY_ID"),
    apnsTeamId = get("APNS_TEAM_ID"),
    apnsPrivateKey = get("APNS_PRIVATE_KEY");
  const pushDrainSecret = get("PUSH_DRAIN_SECRET");
  // SD6b (system design work plan #6, Q9): code exchange and revoke at Apple. Nami's key does not exist yet, so these
  // stay empty and every Apple-auth-env function that depends on them is a no-op (ANSWERS, COO 2026-11-06 17:15 Tehran).
  const appleTeamId = get("APPLE_TEAM_ID"), appleKeyId = get("APPLE_KEY_ID"), applePrivateKey = get("APPLE_PRIVATE_KEY");
  const appleClientId = get("APPLE_CLIENT_ID") || "com.namidavoodzadeh.presence";
  const googleWebClientId = get("GOOGLE_WEB_CLIENT_ID"), googleWebClientSecret = get("GOOGLE_WEB_CLIENT_SECRET");
  const testerToken = get("PRESENCE_TESTER_TOKEN");
  const liveVoicePhase1 = get("PRESENCE_LIVE_VOICE_PHASE1") === "true";
  const safetySemantic = enabledSwitch(get("PRESENCE_SAFETY_SEMANTIC"));
  const safetyClassifier = enabledSwitch(get("PRESENCE_SAFETY_CLASSIFIER"));
  const partnerEntitlements = enabledSwitch(get("PRESENCE_PARTNER_ENTITLEMENTS"));
  // True only on the hosted runtime (Supabase Edge Function or Deno Deploy), never on the Mac (`deno serve`).
  const isHosted = Boolean(get("SB_EXECUTION_ID") || get("DENO_DEPLOYMENT_ID") || get("DENO_REGION"));
  const importHosted = isHosted;
  const releaseBuild = get("PRESENCE_RELEASE") === "true";
  // Revised E13 opens the hosted route for exactly importOwnerId, but the switch itself stays the usual
  // default-off pattern (QA merge note): an unset PRESENCE_IMPORT_FROM_AI must never turn Import on.
  const importFromAi = get("PRESENCE_IMPORT_FROM_AI") === "true";
  const importOwnerId = get("PRESENCE_IMPORT_OWNER_ID") || IMPORT_PREVIEW_OWNER_ID;
  const checkIn = get("PRESENCE_CHECK_IN") === "true";
  // E15 (CEO, support for app AR(2)): a practice-partner Bridge contact, owner-only, off by default until the
  // owner's fixed-id profile is seeded on the hosted server (see docs/design note in practice_partner.ts).
  const practicePartner = get("PRESENCE_PRACTICE_PARTNER") === "true";
  const practicePartnerOwnerId = get("PRESENCE_PRACTICE_PARTNER_OWNER_ID") || IMPORT_PREVIEW_OWNER_ID;
  const commItems = enabledSwitch(get("PRESENCE_COMM_ITEMS"));
  const commOwnerIds = (get("PRESENCE_COMM_OWNER_IDS") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const talkGuide = enabledSwitch(get("PRESENCE_TALK_GUIDE"));
  const requireAiConsent = enabledSwitch(get("PRESENCE_REQUIRE_AI_CONSENT"));
  if (!url || !anon || !service || !preview || !anthropic || !workspace) {
    const home = get("HOME");
    const root = get("PRESENCE_HOME_ROOT") || `${home}/Library/Application Support/PresenceHome`;
    const s = await readFileValues(`${root}/secrets/staging.env`);
    const p = await readFileValues(`${root}/secrets/presence-preview.env`);
    const a = await readFileValues(`${root}/.env.anthropic.local`);
    url ||= s.SUPABASE_URL ?? "";
    anon ||= s.SUPABASE_ANON_KEY ?? "";
    service ||= pickServiceKey(s.PRESENCE_SERVICE_KEY ?? "", "", "", s.SUPABASE_SERVICE_ROLE_KEY ?? "");
    preview ||= p.PRESENCE_PREVIEW_PASSWORD ?? "";
    anthropic ||= a.ANTHROPIC_API_KEY ?? "";
    workspace ||= a.ANTHROPIC_WORKSPACE_ID ?? "";
  }
  if (!url || !anon || !service) {
    throw new Error("api env: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  cached = {
    supabaseUrl: url,
    anonKey: anon,
    serviceRoleKey: service,
    previewPassword: preview,
    previewDeviceSecret,
    anthropicKey: anthropic || null,
    anthropicWorkspace: workspace || null,
    apnsKeyId: apnsKeyId || null,
    apnsTeamId: apnsTeamId || null,
    apnsPrivateKey: apnsPrivateKey || null,
    pushDrainSecret: pushDrainSecret || null,
    appleTeamId: appleTeamId || null,
    appleKeyId: appleKeyId || null,
    applePrivateKey: applePrivateKey || null,
    appleClientId: appleClientId || null,
    googleWebClientId: googleWebClientId || null,
    googleWebClientSecret: googleWebClientSecret || null,
    testerToken: testerToken || null,
    liveVoicePhase1,
    safetySemantic,
    safetyClassifier,
    partnerEntitlements,
    importFromAi,
    importHosted,
    importOwnerId,
    checkIn,
    practicePartner,
    practicePartnerOwnerId,
    commItems,
    commOwnerIds,
    talkGuide,
    requireAiConsent,
    isHosted,
    releaseBuild,
  };
  return cached;
}
