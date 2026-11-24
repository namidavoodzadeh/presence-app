// Token-based APNs sender (CONTRACT §12). Pushes are content-free wake-up hints; product state stays in Postgres.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Ctx, route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { ApiEnv } from "./lib/env.ts";
import { secretEquals } from "./lib/secret.ts";

export const APNS_TOPICS = ["com.namidavoodzadeh.presence", "com.namidavoodzadeh.presence.qa"] as const;
export type PushKind = "bridge_ready" | "bridge_reminder" | "talk_reply_ready" | "checkin_reminder";
export interface PushEvent {
  id: string;
  owner: string;
  device_id: string;
  kind: PushKind;
  subject_id: string;
  route_target_id: string;
  due_at: string;
  attempts: number;
  token: string;
  environment: "sandbox" | "production";
  bundle_id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64,}$/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function base64url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function pkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!body) throw new Error("APNs private key is empty");
  const raw = atob(body), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

let cachedJwt: { token: string; madeAt: number; keyId: string; teamId: string } | null = null;

export async function apnsJwt(
  env: Pick<ApiEnv, "apnsKeyId" | "apnsTeamId" | "apnsPrivateKey">,
  now = Date.now(),
): Promise<string> {
  if (!env.apnsKeyId || !env.apnsTeamId || !env.apnsPrivateKey) {
    throw new Error("APNs secrets are not configured");
  }
  if (
    cachedJwt && cachedJwt.keyId === env.apnsKeyId && cachedJwt.teamId === env.apnsTeamId &&
    now - cachedJwt.madeAt < 45 * 60_000
  ) return cachedJwt.token;
  const header = base64url(utf8(JSON.stringify({ alg: "ES256", kid: env.apnsKeyId })));
  const claims = base64url(utf8(JSON.stringify({ iss: env.apnsTeamId, iat: Math.floor(now / 1000) })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8(env.apnsPrivateKey).buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      utf8(unsigned).buffer as ArrayBuffer,
    ),
  );
  cachedJwt = {
    token: `${unsigned}.${base64url(signature)}`,
    madeAt: now,
    keyId: env.apnsKeyId,
    teamId: env.apnsTeamId,
  };
  return cachedJwt.token;
}

export function pushPayload(
  event: Pick<PushEvent, "id" | "kind" | "route_target_id"> & { subject_id?: string },
): Record<string, unknown> {
  const checkin = event.kind === "checkin_reminder";
  const bridge = event.kind !== "talk_reply_ready" && !checkin;
  const loc = event.kind === "bridge_ready"
    ? "PUSH_BRIDGE_READY"
    : event.kind === "bridge_reminder"
    ? "PUSH_BRIDGE_REMINDER"
    : checkin
    ? "PUSH_CHECKIN_REMINDER"
    : "PUSH_TALK_REPLY_READY";
  return {
    aps: {
      alert: { "title-loc-key": "PRESENCE_TITLE", "loc-key": loc },
      sound: event.kind === "bridge_ready" ? "arrived.caf" : "default",
      category: checkin ? "CHECKIN_REMINDER" : bridge ? "BRIDGE_READY" : "TALK_REPLY_READY",
      "thread-id": checkin ? "presence.checkin" : bridge ? "presence.bridge" : "presence.talk",
    },
    presence: {
      v: 1,
      event: event.kind,
      event_id: event.id,
      route: checkin ? "checkin" : bridge ? "bridge_thread" : "conversation",
      target_id: event.route_target_id,
      // The card itself (a bridge's id) so the app opens that card, not only the sender's thread. A uuid; no words.
      ...(bridge && event.subject_id ? { card_id: event.subject_id } : {}),
    },
  };
}

export function apnsHost(environment: PushEvent["environment"]): string {
  return environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
}

export function apnsHeaders(event: PushEvent, jwt: string): Record<string, string> {
  const expiry = Math.floor((new Date(event.due_at).getTime() + 24 * 3600_000) / 1000);
  return {
    authorization: `bearer ${jwt}`,
    "apns-topic": event.bundle_id,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "apns-collapse-id": event.kind === "talk_reply_ready"
      ? `talk:${event.subject_id}`
      : event.kind === "checkin_reminder"
      ? `checkin:${event.subject_id}`
      : `bridge:${event.subject_id}`,
    "apns-expiration": String(expiry),
    "content-type": "application/json",
  };
}

export interface ApnsResult {
  status: number;
  reason: string | null;
  apnsId: string | null;
}

export async function sendApns(
  event: PushEvent,
  env: ApiEnv,
  fetcher: typeof fetch = fetch,
): Promise<ApnsResult> {
  if (!APNS_TOPICS.includes(event.bundle_id as typeof APNS_TOPICS[number])) {
    throw new Error("unapproved APNs topic");
  }
  const jwt = await apnsJwt(env);
  const response = await fetcher(`${apnsHost(event.environment)}/3/device/${event.token}`, {
    method: "POST",
    headers: apnsHeaders(event, jwt),
    body: JSON.stringify(pushPayload(event)),
  });
  let reason: string | null = null;
  if (response.status !== 200) {
    try {
      const body = await response.json() as { reason?: unknown };
      reason = typeof body.reason === "string" ? body.reason.slice(0, 80) : null;
    } catch { /* APNs can close without JSON */ }
  }
  return { status: response.status, reason, apnsId: response.headers.get("apns-id") };
}

async function finishEvent(db: SupabaseClient, event: PushEvent, result: ApnsResult) {
  const permanentToken = result.status === 410 ||
    (result.status === 400 && result.reason === "BadDeviceToken");
  if (result.status === 200) {
    const { error } = await db.from("push_events").update({
      state: "sent",
      sent_at: new Date().toISOString(),
      apns_id: result.apnsId,
      last_status: 200,
      last_reason: null,
    }).eq("id", event.id);
    if (error) dbError(error, "push_events.sent");
    return "sent";
  }
  if (permanentToken) {
    await db.from("device_tokens").update({ enabled: false, invalidated_at: new Date().toISOString() }).eq(
      "id",
      event.device_id,
    );
    await db.from("push_events").update({
      state: "cancelled",
      cancelled_at: new Date().toISOString(),
      last_status: result.status,
      last_reason: result.reason,
    }).eq("device_id", event.device_id).in("state", ["pending", "retry", "sending"]);
    return "disabled";
  }
  if ([429, 500, 503].includes(result.status)) {
    const expiry = new Date(event.due_at).getTime() + 24 * 3600_000;
    const jitter = 0.8 + crypto.getRandomValues(new Uint16Array(1))[0] / 65535 * 0.4;
    const wait = Math.min(3600, 30 * 2 ** Math.min(event.attempts - 1, 7)) * jitter * 1000;
    const retryAt = Date.now() + wait;
    const patch = retryAt < expiry
      ? {
        state: "retry",
        next_attempt_at: new Date(retryAt).toISOString(),
        last_status: result.status,
        last_reason: result.reason,
      }
      : { state: "failed", last_status: result.status, last_reason: result.reason };
    const { error } = await db.from("push_events").update(patch).eq("id", event.id);
    if (error) dbError(error, "push_events.retry");
    return patch.state === "retry" ? "retried" : "failed";
  }
  const { error } = await db.from("push_events").update({
    state: "failed",
    last_status: result.status,
    last_reason: result.reason,
  }).eq("id", event.id);
  if (error) dbError(error, "push_events.failed");
  return "failed";
}

export async function drainPushes(
  ctx: Pick<Ctx, "service" | "env">,
  limit: number,
  fetcher: typeof fetch = fetch,
) {
  const { data, error } = await ctx.service.rpc("claim_push_events", {
    p_limit: Math.min(Math.max(limit, 1), 100),
  });
  if (error) dbError(error, "claim_push_events");
  const events = (data ?? []) as PushEvent[];
  const counts = { claimed: events.length, sent: 0, retried: 0, disabled: 0, failed: 0 };
  for (const event of events) {
    try {
      const result = await sendApns(event, ctx.env, fetcher);
      const outcome = await finishEvent(ctx.service, event, result);
      counts[outcome as "sent" | "retried" | "disabled" | "failed"]++;
    } catch {
      const outcome = await finishEvent(ctx.service, event, {
        status: 503,
        reason: "TransportError",
        apnsId: null,
      });
      counts[outcome as "retried" | "failed"]++;
    }
  }
  return counts;
}

route("PUT", "/devices/apns", async ({ caller, service, body }) => {
  const b = await body();
  const installation = String(b.installation_id ?? ""), token = String(b.token ?? "");
  const environment = String(b.environment ?? ""),
    bundle = String(b.bundle_id ?? ""),
    locale = String(b.locale ?? "en-US");
  if (!UUID.test(installation)) throw new ApiError("invalid", "", { field: "installation_id" });
  if (!TOKEN.test(token)) throw new ApiError("invalid", "", { field: "token" });
  if (!(["sandbox", "production"] as string[]).includes(environment)) {
    throw new ApiError("invalid", "", { field: "environment" });
  }
  if (!APNS_TOPICS.includes(bundle as typeof APNS_TOPICS[number])) {
    throw new ApiError("invalid", "", { field: "bundle_id" });
  }
  if (!LOCALE.test(locale) || locale.length > 35) throw new ApiError("invalid", "", { field: "locale" });
  const { data, error } = await service.rpc("register_apns_device", {
    p_owner: caller!.id,
    p_installation_id: installation,
    p_token: token,
    p_environment: environment,
    p_bundle_id: bundle,
    p_locale: locale,
  });
  if (error) dbError(error, "register_apns_device");
  return json({ device: data });
});

route("DELETE", "/devices/apns/:installation_id", async ({ caller, service, params }) => {
  if (!UUID.test(params.installation_id)) throw new ApiError("invalid", "", { field: "installation_id" });
  const { error } = await service.rpc("remove_apns_device", {
    p_owner: caller!.id,
    p_installation_id: params.installation_id,
  });
  if (error) dbError(error, "remove_apns_device");
  return json({ removed: true, installation_id: params.installation_id });
});

route("POST", "/internal/push/drain", async (ctx) => {
  const supplied = ctx.req.headers.get("x-presence-push-secret") ?? "";
  if (!ctx.env.pushDrainSecret || !(await secretEquals(supplied, ctx.env.pushDrainSecret))) {
    return json({ error: "not_found" }, 404);
  }
  const b = await ctx.body();
  return json(await drainPushes(ctx, Number.isInteger(b.limit) ? Number(b.limit) : 100));
}, false);
