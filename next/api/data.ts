// Your data (CONTRACT §7 "Data", design Y05; thesis law 10: beliefs are special-category data, export or delete in one tap).
//   GET /export       one JSON file of everything that is the person's own: never engine_calls, never another person's map.
//   DELETE /map       marks the map for deletion with a 5-second undo window (the design's Undo rule, Q63); the map reads as empty
//                     meanwhile, POST /map/undo brings it back whole, and the first request after the window purges it: beliefs,
//                     conversations and the outside cards go; Bridge threads, the Mirror link and Never topics stay.
//   DELETE /account   the map, conversations and Mirror go; unopened bridges are withdrawn; opened bridges stay with the people
//                     who received them, under "Deleted account"; the links end; the auth user is soft-deleted.
// Both deletes are refused where one tap would lose seeded or the owner's test data (example accounts; the owner's preview
// account for the whole-account delete): a supervisor resets those by script.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { route } from "./lib/router.ts";
import { ApiError, json, recordError } from "./lib/errors.ts";
import { dbError, type Caller } from "./lib/db.ts";
import { beliefsFor, conversationObject, meObject, messageObject, perspectiveObject, type Row } from "./lib/objects.ts";
import { people, planObject, receiptsOn, receiverViews, senderBridge } from "./bridge.ts";
import { decryptAppleToken, revokeAppleToken } from "./lib/apple_auth.ts";
import { revokeGoogleToken } from "./lib/google_auth.ts";

export const DELETED_NAME = "Deleted account";
export const MAP_UNDO_MS = 5000;   // the design's Undo toast: 5 seconds
export const MAP_PURPOSES = ["turn", "repair", "finish"] as const;   // the Talk traces: they carry the conversation's words

export function exportFilename(now = new Date()): string { return `presence-${now.toISOString().slice(0, 10)}.json`; }

/** Why a delete is refused, or null. Example accounts never lose their seeded map; the owner's preview account cannot be deleted. */
export function deleteRefusal(caller: { isExample: boolean; isPreview: boolean }, what: "map" | "account"): string | null {
  if (what === "account") return caller.isExample || caller.isPreview ? "preview_account" : null;
  return caller.isExample ? "example_account" : null;
}

/** Where a map delete stands: nothing pending, pending (undo still possible), or due (the window closed; purge on this request). */
export function mapDeleteState(mapDeleteAt: string | null | undefined, nowMs: number): "none" | "pending" | "due" {
  if (!mapDeleteAt) return "none";
  const at = new Date(mapDeleteAt).getTime();
  if (!Number.isFinite(at)) return "due";                 // never keep a map hostage to a bad timestamp: treat it as closed
  return at > nowMs ? "pending" : "due";
}

/** True while the undo window is open: the map reads as empty and nothing has been removed yet. */
export function mapDeletePending(caller: Pick<Caller, "mapDeleteAt">, nowMs = Date.now()): boolean {
  return mapDeleteState(caller.mapDeleteAt, nowMs) === "pending";
}

/** A bridge withdrawn by its sender's leaving is shown as "withdrew" only where the other side already saw it: the sealed
 *  bubble (heads-up seen) or a delivered one; otherwise it simply never arrives. */
export function withdrawalSeen(b: { heads_up_seen_at?: unknown; deliver_at: unknown }, now: number): boolean {
  return !!b.heads_up_seen_at || new Date(String(b.deliver_at)).getTime() <= now;
}

const otherOf = (l: Row, mine: string) => (l.person_a === mine ? l.person_b : l.person_a) as string;

// ------------------------------------------------------------------ GET /export

route("GET", "/export", async ({ caller, tz }) => {
  const db = caller!.db, id = caller!.id;
  const me = await meObject(db, id);
  const [cs, ms, bs, bl, ls, prefs, sent, plans, ml, ps, nv] = await Promise.all([
    db.from("conversations").select("*").eq("owner", id).is("deleted_at", null).order("started_at"),
    db.from("messages").select("*").eq("owner", id).eq("superseded", false).is("deleted_at", null).order("turn").order("role"),
    db.from("beliefs").select("*").eq("owner", id).neq("status", "deleted").order("created_at"),
    db.from("belief_links").select("from_belief,to_belief,kind").eq("owner", id),
    db.from("links").select("*").or(`person_a.eq.${id},person_b.eq.${id}`).order("created_at"),
    db.from("link_prefs").select("*").eq("owner", id),
    db.from("bridges").select("*").eq("sender", id).is("sender_deleted_at", null).order("created_at"),
    db.from("plans").select("*").or(`proposer.eq.${id},other.eq.${id}`).order("created_at"),
    db.from("mirror_links").select("*").eq("owner", id).maybeSingle(),
    db.from("outside_perspectives").select("*").eq("owner", id).order("created_at"),
    db.from("consent").select("id,area,label,created_at").eq("owner", id).eq("state", "never").order("created_at"),
  ]);
  for (const [r, w] of [[cs, "conversations"], [ms, "messages"], [bs, "beliefs"], [bl, "belief_links"], [ls, "links"], [prefs, "link_prefs"], [sent, "bridges"], [plans, "plans"], [ml, "mirror_links"], [ps, "outside_perspectives"], [nv, "consent"]] as const) {
    if (r.error) dbError(r.error, w);
  }
  const messages = ms.data ?? [];
  const conversations = (cs.data ?? []).map((c) => ({
    ...conversationObject(c, tz), summary: c.summary ?? null, next_time: c.next_time ?? null,
    messages: messages.filter((m) => m.conversation_id === c.id).map(messageObject),
  }));
  const links = ls.data ?? [];
  const others = links.map((l) => otherOf(l, id));
  const persons = await people(db, [...others, id]);
  const peopleOut = links.map((l) => {
    const o = otherOf(l, id), p = (prefs.data ?? []).find((x) => x.other === o) ?? {};
    return { person: persons.get(o) ?? null, status: l.status, relationship: p.relationship ?? null, since: l.created_at,
      sharing: { on: p.share_on ?? false, areas: p.share_areas ?? [], quotes: p.share_quotes ?? false } };
  });
  const planFor = (bridgeId: unknown) => (plans.data ?? []).filter((p) => p.bridge_id === bridgeId && p.status !== "cancelled").at(-1) ?? null;
  const receipts = new Map<string, boolean>();
  for (const o of others) receipts.set(o, await receiptsOn(db, id, o));   // opened_at only when read receipts are on for both (Y03)
  const bridges_sent = (sent.data ?? []).map((b) => senderBridge(b, persons, planFor(b.id), receipts.get(String(b.receiver)) ?? true));
  const bridges_received: Row[] = [];
  for (const o of others) {
    for (const v of await receiverViews(db, o)) {
      if (v.opened_at) bridges_received.push({ ...v, from: persons.get(String(v.from)) ?? null, plan: planFor(v.id) ? planObject(planFor(v.id)!) : null });
    }
  }
  const link = ml.data;
  // v1.52: the items I chose to share, per person, in the wording I approved for them (a copy of my own choices).
  const { data: shareRows, error: shareErr } = await db.from("share_items").select("other,belief_id,wording,created_at").eq("owner", id).order("created_at");
  if (shareErr) dbError(shareErr, "share_items");
  const body = {
    exported_at: new Date().toISOString(),
    me,
    conversations,
    beliefs: await beliefsFor(db, bs.data ?? [], ps.data ?? []),
    links: (bl.data ?? []).map((l) => ({ from: l.from_belief, to: l.to_belief, kind: l.kind })),
    people: peopleOut,
    bridges_sent,
    bridges_received,
    plans: (plans.data ?? []).map(planObject),
    shared_items: ((shareRows ?? []) as Row[]).map((r) => ({ person: persons.get(String(r.other)) ?? null, belief_id: r.belief_id, wording: r.wording, since: r.created_at })),
    mirror: { link: link ? { on: link.enabled === true, who: link.who, paused: link.paused === true, since: link.created_at, question: typeof link.question === "string" ? link.question : null } : null,
      perspectives: (ps.data ?? []).map(perspectiveObject) },
    never: (nv.data ?? []).map((t) => ({ id: t.id, area: t.area, label: t.label, since: t.created_at })),
    settings: me.settings,
  };
  return json(body, 200, { "content-disposition": `attachment; filename="${exportFilename()}"` });
});

// ------------------------------------------------------------------ DELETE /map

/** The hard delete: everything the map is made of. Runs once the undo window has closed (purgeMapIfDue), never inside DELETE /map. */
export async function purgeMap(db: SupabaseClient, service: SupabaseClient, id: string) {
  const { data: cs, error: e0 } = await db.from("conversations").select("id").eq("owner", id);   // soft-deleted ones go too
  if (e0) dbError(e0, "conversations");
  const cids = (cs ?? []).map((c) => c.id as string);
  // The Talk traces carry the conversation's words: they go with it (law 10). Bridge and Mirror traces stay with the thread and the link.
  if (cids.length) await service.from("engine_calls").delete().eq("person", id).in("conversation_id", cids);
  await service.from("engine_calls").delete().eq("person", id).in("purpose", [...MAP_PURPOSES]);
  const { data: bs, error: e1 } = await db.from("beliefs").delete().eq("owner", id).select("id");          // receipts and links cascade
  if (e1) dbError(e1, "beliefs.delete");
  const { data: cd, error: e2 } = await db.from("conversations").delete().eq("owner", id).select("id");    // messages cascade
  if (e2) dbError(e2, "conversations.delete");
  const { data: ps, error: e3 } = await db.from("outside_perspectives").delete().eq("owner", id).select("id");
  if (e3) dbError(e3, "outside_perspectives.delete");
  const { error: e4 } = await db.from("profiles").update({ map_seen_at: null, map_delete_at: null, talk_guide_avoids: [] }).eq("id", id);
  if (e4) dbError(e4, "profiles.update");
  return { beliefs_removed: (bs ?? []).length, conversations_removed: (cd ?? []).length, outside_removed: (ps ?? []).length };
}

/** Called by the handler on every authenticated request: when the undo window has closed, the map goes now, before the route runs. */
export async function purgeMapIfDue(caller: Caller, service: SupabaseClient, nowMs = Date.now()): Promise<boolean> {
  if (mapDeleteState(caller.mapDeleteAt, nowMs) !== "due") return false;
  await purgeMap(caller.db, service, caller.id);
  caller.mapDeleteAt = null;
  caller.mapPurged = true;
  return true;
}

route("DELETE", "/map", async ({ caller }) => {
  const db = caller!.db, id = caller!.id;
  const refusal = deleteRefusal(caller!, "map");
  if (refusal) throw new ApiError("forbidden", "", { reason: refusal });
  const [bs, cs, ps] = await Promise.all([
    db.from("beliefs").select("id", { count: "exact", head: true }).eq("owner", id).neq("status", "deleted"),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("owner", id).is("deleted_at", null),
    db.from("outside_perspectives").select("id", { count: "exact", head: true }).eq("owner", id),
  ]);
  for (const [r, w] of [[bs, "beliefs"], [cs, "conversations"], [ps, "outside_perspectives"]] as const) if (r.error) dbError(r.error, w);
  // A second tap inside the window keeps the first window: the undo stays possible exactly as long as the toast said.
  const pending = mapDeletePending(caller!);
  const undoUntil = pending ? new Date(caller!.mapDeleteAt!).toISOString() : new Date(Date.now() + MAP_UNDO_MS).toISOString();
  if (!pending) {
    const { error } = await db.from("profiles").update({ map_delete_at: undoUntil }).eq("id", id);
    if (error) dbError(error, "profiles.update");
    caller!.mapDeleteAt = undoUntil;
  }
  return json({ undo_until: undoUntil, beliefs_removed: bs.count ?? 0, conversations_removed: cs.count ?? 0, outside_removed: ps.count ?? 0 });
});

route("POST", "/map/undo", async ({ caller }) => {
  const db = caller!.db, id = caller!.id;
  if (caller!.mapPurged) return json({ restored: false, reason: "window_closed" });        // the window closed before the tap landed
  if (!mapDeletePending(caller!)) return json({ restored: false, reason: "nothing_pending" });
  const { error } = await db.from("profiles").update({ map_delete_at: null }).eq("id", id);
  if (error) dbError(error, "profiles.update");
  caller!.mapDeleteAt = null;
  return json({ restored: true });
});

// ------------------------------------------------------------------ DELETE /account

/** The reply shape `delete_account` (migration 0028) returns, run as one Postgres transaction: withdrawn bridges
 *  (sent, unopened, now withdrawn), links ended, and anything that is only theirs — all in or out together. */
export interface DeleteAccountResult { withdrawn: string[]; links_ended: number }

route("DELETE", "/account", async ({ caller, service, env }) => {
  const id = caller!.id;
  const refusal = deleteRefusal(caller!, "account");
  if (refusal) throw new ApiError("forbidden", "", { reason: refusal });

  // SD6b: revoke at Apple's end before the tombstone, so a deleted account's Sign in with Apple grant doesn't
  // outlive it. A missing/undecryptable token, an unconfigured Apple key, or Apple's own call failing never blocks
  // the deletion itself — only a Ref is logged (law: a third party being unreachable can't hold a tap hostage).
  const appleTokenEnc = caller!.profile?.apple_refresh_token_enc as string | null | undefined;
  if (appleTokenEnc) {
    try {
      const refreshToken = await decryptAppleToken(env.serviceRoleKey, appleTokenEnc);
      if (refreshToken) {
        const ok = await revokeAppleToken({
          appleTeamId: env.appleTeamId,
          appleKeyId: env.appleKeyId,
          applePrivateKey: env.applePrivateKey,
          appleClientId: env.appleClientId,
        }, refreshToken);
        if (!ok) await recordError(service, id, "account.apple_revoke", "apple_revoke_failed", "Apple revoke did not succeed");
      }
    } catch (e) {
      await recordError(service, id, "account.apple_revoke", "apple_revoke_threw", e instanceof Error ? e.message : String(e));
    }
  }

  // Google sign-in: the same for our Google grant. The column is cleared right after (delete_account predates it),
  // so a deleted account never keeps even the encrypted token; a revoke that fails is logged, never blocking.
  const googleTokenEnc = caller!.profile?.google_refresh_token_enc as string | null | undefined;
  if (googleTokenEnc) {
    try {
      const refreshToken = await decryptAppleToken(env.serviceRoleKey, googleTokenEnc);
      if (refreshToken && !(await revokeGoogleToken(refreshToken))) {
        await recordError(service, id, "account.google_revoke", "google_revoke_failed", "Google revoke did not succeed");
      }
    } catch (e) {
      await recordError(service, id, "account.google_revoke", "google_revoke_threw", e instanceof Error ? e.message : String(e));
    }
    const { error: clearError } = await service.from("profiles").update({ google_refresh_token_enc: null }).eq("id", id);
    if (clearError) dbError(clearError, "profiles.google_token.clear");
  }

  // SD6 (system design work plan #6): every destructive step — withdrawing bridges, ending links, deleting the person's
  // own rows, writing the "Deleted account" tombstone — runs inside one Postgres function, so a failure partway through
  // leaves nothing half-done (a bridge withdrawn with its link still active, or rows gone with no tombstone written).
  const { data, error } = await service.rpc("delete_account", { p_id: id });
  if (error) dbError(error, "delete_account");
  const result = data as DeleteAccountResult;

  // The Auth user, its provider identity, sessions and refresh tokens are a separate service, not a table write, so they
  // cannot join the SQL transaction above; they are hard-deleted right after it commits. Migration 0014's trigger still
  // cascades ordinary throwaway-user cleanup; this call only ever meets the tombstone the transaction already wrote.
  try {
    const { error: authError } = await service.auth.admin.deleteUser(id);
    if (authError) console.error(`account ${id}: auth delete failed: ${authError.message}`);
  } catch (e) { console.error(`account ${id}: auth delete threw: ${e instanceof Error ? e.message : String(e)}`); }

  return json({ deleted: true, withdrawn: result.withdrawn, links_ended: result.links_ended });
});
