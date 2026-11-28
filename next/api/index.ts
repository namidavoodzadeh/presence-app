// Presence App v1 — the `api` Edge Function (CONTRACT.md v1). One handler, hosted on Supabase (entrypoint hosted.ts) and on the
// Mac (`deno task api`, port 8820, same database). JSON in, JSON out; every error is {error, ref}.
//
// This file holds the request handler and the $0 endpoints (preview login, me, conversations, never, spend). The route table and
// the shared object builders live in lib/; Talk is in talk.ts; Map, Bridge, Mirror and Your data live in their own modules.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { loadEnv } from "./lib/env.ts";
import { ApiError, errorReply, json, recordClientRefs, recordError } from "./lib/errors.ts";
import { anonClient, authenticate, dbError, serviceClient, type Caller } from "./lib/db.ts";
import { apiPath, route, routes, type Params } from "./lib/router.ts";
import { secretEquals } from "./lib/secret.ts";
import { cardsFor, conversationObject, conversationWithCounts, DEFAULT_SETTINGS, loadConversation, meObject, meObjectFromRow, messageObject, pendingReply, PERSONAS } from "./lib/objects.ts";
import "./talk.ts";
import "./map.ts";
import "./bridge.ts";
import "./bridge_engine.ts";
import "./bridge_eval.ts";
import "./mirror.ts";
import "./push.ts";
import "./auth.ts";
import "./feedback.ts";
import "./import_ai.ts";
import "./practice_partner.ts";
import "./checkin.ts";
import "./cards.ts";
import "./home.ts";
import "./kennings.ts";
import "./comm_items.ts";
import "./comm_map.ts";
import "./comm_talk.ts";
import "./kenning_map.ts";
import "./share_items.ts";
import "./reading.ts";
import "./checkin_session.ts";
import "./diagnostics.ts";
import { purgeMapIfDue } from "./data.ts";
import { loadPlan } from "./entitlements.ts";

export { apiPath, cardsFor, conversationObject, DEFAULT_SETTINGS, messageObject, PERSONAS };
export type { Ctx } from "./lib/router.ts";

const INSTANCE = crypto.randomUUID().slice(0, 8);
let requestCount = 0;

function timed(response: Response, started: number, authMs: number, guardMs: number, routeMs: number, first: boolean): Response {
  const headers = new Headers(response.headers), total = performance.now() - started;
  headers.set("server-timing", `total;dur=${total.toFixed(1)}, auth;dur=${authMs.toFixed(1)}, guard;dur=${guardMs.toFixed(1)}, route;dur=${routeMs.toFixed(1)}`);
  headers.set("x-presence-instance", INSTANCE); headers.set("x-presence-first-request", String(first));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handler(req: Request): Promise<Response> {
  const started = performance.now(), first = requestCount++ === 0;
  let authMs = 0, guardMs = 0, routeMs = 0;
  const env = await loadEnv();
  const service = serviceClient(env);
  const url = new URL(req.url);
  const path = apiPath(url);
  let caller: Caller | null = null;
  let where = `${req.method} ${path}`;
  try {
    const match = routes.find((r) => r.method === req.method && r.pattern.test(path));
    if (!match) throw new ApiError("not_found", "", { path });
    const m = path.match(match.pattern)!;
    const params: Params = {};
    match.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
    if (match.auth) { const mark = performance.now(); caller = await authenticate(env, req); authMs = performance.now() - mark; }
    where = `${req.method} ${match.pattern.source}`;
    // "Delete my map" whose 5-second undo window has closed: the map goes now, before this route reads anything (CONTRACT §7 Data).
    const guardStarted = performance.now();
    if (caller) await purgeMapIfDue(caller, service);
    // A Ref the phone made when Presence never answered (S05) rides on the next request; kept with source "client" (A-Q8).
    if (req.headers.has("x-client-ref")) await recordClientRefs(service, caller?.id ?? null, where, req.headers.get("x-client-ref"));
    guardMs = performance.now() - guardStarted;
    let parsed: Record<string, unknown> | null = null;
    const body = async () => {
      if (parsed) return parsed;
      try { parsed = (await req.json()) as Record<string, unknown>; } catch { parsed = {}; }
      if (!parsed || typeof parsed !== "object") throw new ApiError("invalid", "", { field: "body" });
      return parsed;
    };
    const tz = req.headers.get("x-presence-tz") || "UTC";
    const routeStarted = performance.now(), response = await match.handler({ env, req, url, params, caller, service, tz, body });
    routeMs = performance.now() - routeStarted;
    return timed(response, started, authMs, guardMs, routeMs, first);
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError("internal", "", { detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    const { detail, ...extra } = err.extra;
    const ref = await recordError(service, caller?.id ?? null, where, err.code, [err.message, detail ? String(detail) : ""].filter(Boolean).join(" | "));
    return timed(errorReply(err.code, ref, err.message, extra), started, authMs, guardMs, routeMs, first);
  }
}

// ------------------------------------------------------------------ preview

route("POST", "/preview/login", async ({ env, body, service, req }) => {
  // Hosted serves real devices over the open internet with the anon key shipped in every build, so a password the
  // server already holds (below) is not a secret a caller supplies; nothing may sign in here without a device
  // secret that is never in the app bundle, provisioned by hand onto Nami's and QA's own devices only. The release
  // build never sets PRESENCE_RELEASE, so this stays reachable in test builds only.
  if (env.releaseBuild) throw new ApiError("not_found", "", { path: "/preview/login" });
  if (env.isHosted) {
    const got = req.headers.get("x-presence-preview-secret") ?? "";
    if (!env.previewDeviceSecret || !got || !(await secretEquals(got, env.previewDeviceSecret))) {
      throw new ApiError("unauthorized", "", { reason: "preview_secret_required" });
    }
  }
  const b = await body();
  const persona = String(b.persona ?? "").toLowerCase();
  // Nami's own account carries his real talks, not a cast; preview/login never reaches it, on hosted or the Mac.
  if (persona === "nami") throw new ApiError("forbidden", "", { reason: "preview_login_restricted" });
  if (!(PERSONAS as readonly string[]).includes(persona)) throw new ApiError("invalid", "", { field: "persona" });
  if (!env.previewPassword) throw new ApiError("internal", "", { detail: "preview password not configured" });
  const auth = anonClient(env);
  const { data, error } = await auth.auth.signInWithPassword({ email: `${persona}@preview.presence.app`, password: env.previewPassword });
  if (error || !data.session) throw new ApiError("unauthorized", "Preview account not available.", { detail: error?.message ?? "no session" });
  const { data: profile, error: profileError } = await service.from("profiles").select("*").eq("id", data.session.user.id).single();
  if (profileError) dbError(profileError, "profiles");
  const learned = await learnZone(service, data.session.user.id, req.headers.get("x-presence-tz") || "UTC", profile.tz as string | null);
  if (learned && !profile.tz) profile.tz = learned;
  const me = meObjectFromRow(profile);
  return json({
    access_token: data.session.access_token, refresh_token: data.session.refresh_token,
    expires_at: new Date((data.session.expires_at ?? 0) * 1000).toISOString(), me,
  });
}, false);

route("GET", "/preview/spend", async ({ env, req, service }) => {
  // Release build never reaches this, authenticated or not (CONTRACT.md's release switch); checked before
  // authenticate() so an unauthenticated caller on a release build still gets 404, not 401.
  if (env.releaseBuild) throw new ApiError("not_found", "", { path: "/preview/spend" });
  const caller = await authenticate(env, req);
  requirePreview(caller);
  const { data, error } = await service.rpc("ledger_snapshot");
  if (error) dbError(error, "ledger_snapshot");
  return json(data);
}, false);

function requirePreview(caller: Caller) {
  if (!caller.isPreview) throw new ApiError("forbidden", "", { reason: "preview_only" });
}

// ------------------------------------------------------------------ me

/** An IANA zone the runtime knows ("Asia/Tehran"); anything else is refused. */
export function validZone(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim() || v.length > 64) return null;
  const zone = v.trim();
  if (zone !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(zone)) return null;     // an IANA name, never a bare offset ("+03:30")
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone; } catch { return null; }
}

/** The person's zone (R3 Q7, CDO build review 1): learned from the app's X-Presence-TZ header when the profile has none yet; PATCH /me sets it outright. */
async function learnZone(db: SupabaseClient, id: string, headerTz: string, knownTz?: string | null): Promise<string | null> {
  const zone = headerTz && headerTz !== "UTC" ? validZone(headerTz) : null;
  if (!zone) return knownTz ?? null;
  let current = knownTz;
  if (knownTz === undefined) current = (await db.from("profiles").select("tz").eq("id", id).maybeSingle()).data?.tz ?? null;
  if (!current) {
    const { error } = await db.from("profiles").update({ tz: zone }).eq("id", id);
    if (error) dbError(error, "profiles.update.tz");
    return zone;
  }
  return current;
}

route("GET", "/me", async ({ caller, service, env, tz }) => {
  const learned = await learnZone(caller!.db, caller!.id, tz, caller!.profile.tz as string | null);
  if (learned && !caller!.profile.tz) caller!.profile.tz = learned;
  // The id is the verified caller's, never only whatever the profile read carried (#131).
  return json({ me: meObjectFromRow({ ...caller!.profile, id: caller!.id }), plan: await loadPlan(service, caller!.id, env.partnerEntitlements === true) });
});

route("PATCH", "/me", async ({ caller, body }) => {
  const b = await body();
  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string") {
    const name = b.name.trim().slice(0, 40);
    if (!name) throw new ApiError("invalid", "", { field: "name" });
    patch.name = name;
  }
  if (b.tz !== undefined) {
    if (b.tz === null) patch.tz = null;
    else { const zone = validZone(b.tz); if (!zone) throw new ApiError("invalid", "", { field: "tz" }); patch.tz = zone; }
  }
  if (b.settings && typeof b.settings === "object") {
    const current = (await meObject(caller!.db, caller!.id)).settings as Record<string, unknown>;
    const next = { ...current, ...(b.settings as Record<string, unknown>) };
    if ((b.settings as Record<string, unknown>).notify && typeof (b.settings as Record<string, unknown>).notify === "object") {
      next.notify = { ...(current.notify as Record<string, unknown>), ...((b.settings as Record<string, Record<string, unknown>>).notify) };
    }
    patch.settings = next;
  }
  if (!Object.keys(patch).length) throw new ApiError("invalid", "", { field: "body" });
  const { error } = await caller!.db.from("profiles").update(patch).eq("id", caller!.id);
  if (error) dbError(error, "profiles.update");
  return json({ me: await meObject(caller!.db, caller!.id) });
});

// ------------------------------------------------------------------ conversations ($0 reads and edits; turns live in talk.ts)

/** A paused conversation finishes by itself 24 h after paused_at (computed at read, no job). */
async function autoFinish(db: SupabaseClient, owner: string) {
  const cutoff = new Date(Date.now() - 24 * 3600e3).toISOString();
  await db.from("conversations").update({ status: "finished", finished_at: new Date().toISOString() })
    .eq("owner", owner).eq("status", "paused").lt("paused_at", cutoff);
}

route("GET", "/conversations", async ({ caller, tz }) => {
  const db = caller!.db;
  await autoFinish(db, caller!.id);
  const { data, error } = await db.from("conversations").select("*").is("deleted_at", null).order("last_active_at", { ascending: false }).limit(200);
  if (error) dbError(error, "conversations");
  const ids = (data ?? []).map((c) => c.id as string);
  const counts = new Map<string, number>(), turns = new Map<string, number>(), unrated = new Map<string, number>();
  if (ids.length) {
    // Speed (CEO 12 Nov): the two count reads go out together.
    const [{ data: bs }, { data: ms }] = await Promise.all([
      db.from("beliefs").select("conversation_id,status").in("conversation_id", ids).neq("status", "deleted"),
      db.from("messages").select("conversation_id,role,turn").in("conversation_id", ids).eq("superseded", false).is("deleted_at", null),
    ]);
    for (const b of bs ?? []) {
      if (b.status === "confirmed") counts.set(b.conversation_id, (counts.get(b.conversation_id) ?? 0) + 1);
      if (b.status === "guess") unrated.set(b.conversation_id, (unrated.get(b.conversation_id) ?? 0) + 1);
    }
    for (const m of ms ?? []) if (m.role === "me") turns.set(m.conversation_id, Math.max(turns.get(m.conversation_id) ?? 0, m.turn as number));
  }
  const conversations = (data ?? []).map((c) => conversationObject(c, tz, { beliefs_added: counts.get(c.id) ?? 0, turns: turns.get(c.id) ?? 0, unrated: unrated.get(c.id) ?? 0 }));
  const active = conversations.find((c) => c.status === "active" || c.status === "paused") ?? null;
  return json({ conversations, active, pending_reply: await pendingReply(db, active?.id as string | undefined) });
});

route("GET", "/conversations/:id", async ({ caller, params, url, tz }) => {
  const db = caller!.db;
  const c = await loadConversation(db, params.id);
  let q = db.from("messages").select("*").eq("conversation_id", c.id).is("deleted_at", null).order("turn").order("role");
  if (url.searchParams.get("include_superseded") !== "true") q = q.eq("superseded", false);
  // Speed (CEO 12 Nov): the four reads after the conversation itself go out together.
  const [{ data: ms, error }, { data: guesses }, conversation, pending] = await Promise.all([
    q,
    db.from("beliefs").select("*").eq("conversation_id", c.id).eq("status", "guess").order("created_at"),
    conversationWithCounts(db, c, tz),
    pendingReply(db, c.id as string),
  ]);
  if (error) dbError(error, "messages");
  return json({
    conversation,
    messages: (ms ?? []).map(messageObject),
    pending_reply: pending,
    unrated: await cardsFor(db, guesses ?? []),
  });
});

route("PATCH", "/conversations/:id", async ({ caller, params, body, tz }) => {
  const db = caller!.db;
  const c = await loadConversation(db, params.id);
  const b = await body();
  const patch: Record<string, unknown> = {};
  if (typeof b.title === "string") { patch.title = b.title.trim().slice(0, 80); patch.title_by_person = true; }
  if (b.status === "paused") { if (c.status !== "active") throw new ApiError("conflict", "", { status: c.status }); patch.status = "paused"; patch.paused_at = new Date().toISOString(); }
  if (b.status === "active") { if (c.status !== "paused") throw new ApiError("conflict", "", { status: c.status }); patch.status = "active"; patch.paused_at = null; }
  if (!Object.keys(patch).length) throw new ApiError("invalid", "", { field: "body" });
  const { data, error } = await db.from("conversations").update(patch).eq("id", c.id).select("*").single();
  if (error) dbError(error, "conversations.update");
  return json({ conversation: await conversationWithCounts(db, data, tz) });
});

/** Beliefs whose every receipt comes from this conversation: they leave the map with it (law 2). */
async function beliefsOnlyHere(db: SupabaseClient, conversationId: string) {
  const { data: here } = await db.from("receipts").select("belief_id").eq("conversation_id", conversationId);
  const ids = [...new Set((here ?? []).map((r) => r.belief_id as string))];
  if (!ids.length) return [];
  const { data: elsewhere } = await db.from("receipts").select("belief_id").in("belief_id", ids).neq("conversation_id", conversationId);
  const keep = new Set((elsewhere ?? []).map((r) => r.belief_id as string));
  const only = ids.filter((id) => !keep.has(id));
  if (!only.length) return [];
  const { data: bs } = await db.from("beliefs").select("id,label").in("id", only).neq("status", "deleted");
  return (bs ?? []).map((b) => ({ belief_id: b.id, label: b.label }));
}

route("GET", "/conversations/:id/delete-preview", async ({ caller, params }) => {
  const c = await loadConversation(caller!.db, params.id);
  const only = await beliefsOnlyHere(caller!.db, c.id as string);
  const n = only.length;
  const line = n === 0 ? "Delete this conversation?" : `${n} belief${n === 1 ? "" : "s"} came only from this conversation and will leave your map.`;
  return json({ beliefs_only_here: only, count: n, line });
});

route("DELETE", "/conversations/:id", async ({ caller, params }) => {
  const db = caller!.db;
  const c = await loadConversation(db, params.id);
  const only = await beliefsOnlyHere(db, c.id as string);
  const now = new Date().toISOString();
  const { error } = await db.from("conversations").update({ deleted_at: now, status: c.status === "active" || c.status === "paused" ? "finished" : c.status }).eq("id", c.id);
  if (error) dbError(error, "conversations.delete");
  if (only.length) {
    const { error: e2 } = await db.from("beliefs").update({ previous_status: null, status: "deleted", deleted_at: now }).in("id", only.map((b) => b.belief_id));
    if (e2) dbError(e2, "beliefs.delete");
  }
  return json({ deleted: c.id, beliefs_removed: only.map((b) => b.belief_id), undo_until: new Date(Date.now() + 5000).toISOString() });
});

route("POST", "/conversations/:id/restore", async ({ caller, params, tz }) => {
  const db = caller!.db;
  const { data: c, error } = await db.from("conversations").select("*").eq("id", params.id).not("deleted_at", "is", null).maybeSingle();
  if (error) dbError(error, "conversations");
  if (!c) throw new ApiError("not_found", "", { where: "conversation" });
  const { data: bs } = await db.from("beliefs").select("id").eq("conversation_id", c.id).eq("status", "deleted").gte("deleted_at", c.deleted_at);
  await db.from("conversations").update({ deleted_at: null }).eq("id", c.id);
  if (bs?.length) await db.from("beliefs").update({ status: "confirmed", deleted_at: null }).in("id", bs.map((b) => b.id)).not("rating", "is", null);
  if (bs?.length) await db.from("beliefs").update({ status: "guess", deleted_at: null }).in("id", bs.map((b) => b.id)).is("rating", null);
  return json({ conversation: conversationObject({ ...c, deleted_at: null }, tz), beliefs_restored: (bs ?? []).map((b) => b.id) });
});

// ------------------------------------------------------------------ never topics (Y06)

route("GET", "/never", async ({ caller }) => {
  const { data, error } = await caller!.db.from("consent").select("id,area,label,created_at").eq("state", "never").order("created_at");
  if (error) dbError(error, "consent");
  return json({ topics: (data ?? []).map((t) => ({ id: t.id, area: t.area, label: t.label, since: t.created_at })) });
});

route("DELETE", "/never/:id", async ({ caller, params }) => {
  const { data, error } = await caller!.db.from("consent").delete().eq("id", params.id).eq("state", "never").select("id");
  if (error) dbError(error, "consent.delete");
  if (!data?.length) throw new ApiError("not_found", "", { where: "never" });
  return json({ deleted: params.id });
});

// ------------------------------------------------------------------ health (no auth; nothing private)

route("GET", "/health", () => Promise.resolve(json({ ok: true, contract: 1, at: new Date().toISOString() })), false);

// Two ways to run this on the Mac (docs/PORTS.md):
//   PORT=8820 deno run … api/index.ts            → serves itself on PORT (the 8820 fallback)
//   deno serve --watch --port 8821 … api/index.ts → `deno serve` takes the default export and reloads on code changes (8821);
//                                                   import.meta.main is true there too, so the self-serve runs only with PORT set.
if (import.meta.main && Deno.env.get("PORT")) {
  Deno.serve({ port: Number(Deno.env.get("PORT")), hostname: Deno.env.get("HOST") ?? "0.0.0.0" }, handler);
}
export default { fetch: handler };
