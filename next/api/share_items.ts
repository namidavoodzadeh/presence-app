// Per-item sharing (V2.5 board 18; CPO d-coo-cpo-v25-share-granularity-10nov; migration 0049). The owner picks which single
// beliefs one linked person may draw on. Nothing is shared by default. Only a belief the owner confirmed (Very me, Partly or
// edited; never "Not me") can be offered, and the person sees the owner-approved wording, never receipts (law 10).
//   GET  /links/:person/share                      what I could share with them, and what I do
//   PUT  /links/:person/share/items/:belief_id     { shared: bool, wording? }  share, re-word or revoke one belief
//   GET  /links/:person/share/preview              exactly what they can read now (same function the readers use)
// Pair context is the one reader: preview and every receiving surface use the
// same grant, status, expiry and scope checks.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { RESOURCES } from "../engine/safety.ts";
import type { Ctx } from "./lib/router.ts";
import { NEVER_ON_CARDS, type CommKind } from "../engine/comm.ts";
import { loadPairContext } from "./pair_context.ts";

export const MAX_SHARE_WORDING = 400;

export interface GrantedItem {
  item_id: string; // the belief id; the only thing a trace or a log may keep
  area: string;
  label: string;
  wording: string; // the owner-approved text for this person
  shared_at: string;
  /** V3 comm item fields when the shared belief is one (undefined on an old kenning, and when the grantee cannot read the belief); never returned by a route, read only by `grantMayRead`. */
  comm?: { kind: string | null; status: string | null; expiresAt: string | null };
}

function me(ctx: Ctx) {
  return { db: ctx.caller!.db, service: ctx.service, id: ctx.caller!.id };
}

async function requireActiveLink(db: SupabaseClient, mine: string, other: string): Promise<void> {
  const a = mine < other ? mine : other, b = mine < other ? other : mine;
  const { data, error } = await db.from("links").select("status").eq("person_a", a).eq("person_b", b).maybeSingle();
  if (error) dbError(error, "links");
  if (!data) throw new ApiError("not_found", "", { where: "link" });
  if (data.status !== "active") throw new ApiError("forbidden", "", { reason: data.status });
}

/** A belief the owner may offer: confirmed, and not "Not me". */
export function offerable(b: Row): boolean {
  return b.status === "confirmed" && b.rating !== "not" && typeof b.statement === "string" && b.statement.trim() !== "";
}

async function pairItems(client: SupabaseClient, grantor: string, grantee: string, service?: SupabaseClient): Promise<GrantedItem[]> {
  const pair = await loadPairContext(client, grantee, grantor, service);
  return (pair.receiver?.items ?? []).map((x) => ({ item_id: x.id, area: "", label: "", wording: x.words, shared_at: x.confirmedAt ?? "",
    ...(x.kind ? { comm: { kind: x.kind, status: "active", expiresAt: x.kind === "this_week" ? x.confirmedAt : null } } : {}) }));
}

function itemObject(g: GrantedItem) {
  return { item_id: g.item_id, area: g.area, wording: g.wording, shared_at: g.shared_at };
}

route("GET", "/links/:person/share", async (ctx) => {
  const { db, id } = me(ctx);
  const other = ctx.params.person;
  await requireActiveLink(db, id, other);
  const [{ data: beliefs, error }, granted] = await Promise.all([
    db.from("beliefs").select("id,label,area,statement,own_wording,status,rating,confirmed_at").eq("owner", id).eq("status", "confirmed")
      .order("created_at"),
    pairItems(db, id, other),
  ]);
  if (error) dbError(error, "beliefs.share_list");
  const byItem = new Map(granted.map((g) => [g.item_id, g]));
  const items = ((beliefs ?? []) as Row[]).filter(offerable).map((b) => {
    const g = byItem.get(String(b.id));
    return {
      // v1.66: the owner's own first-person line when they set one, else the statement (as before).
      belief_id: b.id, area: b.area, label: b.label, wording: b.own_wording ?? b.statement, own_wording: b.own_wording ?? null,
      shared: !!g, shared_wording: g?.wording ?? null, shared_at: g?.shared_at ?? null,
    };
  });
  return json({ person_id: other, items, shared_count: granted.length });
});

route("PUT", "/links/:person/share/items/:belief_id", async (ctx) => {
  const { db, id } = me(ctx);
  const other = ctx.params.person, beliefId = ctx.params.belief_id;
  if (other === id) throw new ApiError("invalid", "", { field: "person" });
  await requireActiveLink(db, id, other);
  const b = await ctx.body();
  if (typeof b.shared !== "boolean") throw new ApiError("invalid", "", { field: "shared" });
  if (!b.shared) {
    // Revoking works at once, for any belief the owner holds, and says nothing to the other person (no push, no event).
    const { error } = await db.from("share_items").delete().eq("owner", id).eq("other", other).eq("belief_id", beliefId);
    if (error) dbError(error, "share_items.delete");
    return json({ item: { belief_id: beliefId, shared: false, shared_wording: null } });
  }
  const { data: belief, error } = await db.from("beliefs").select("*").eq("owner", id).eq("id", beliefId)
    .maybeSingle();
  if (error) dbError(error, "beliefs.share");
  if (!belief) throw new ApiError("not_found", "", { where: "belief" });
  // Only a belief the person rated Very me or Partly, or edited, can be offered (law 3). A guess or "Not me" cannot.
  if (!offerable(belief as Row)) throw new ApiError("forbidden", "", { reason: "not_confirmed" });
  // V3 communication items (spec 4.4; `*` so this still works on a database that does not have migration 0069 yet): a kind that never reaches a card or invite, or an item that is not active, is never newly granted through
  // this older route; existing grants on carried-over rows keep working (revoking above is unchanged), so nothing is shared less than before.
  const ck = (belief as Row).comm_kind as CommKind | null | undefined;
  if (ck && (NEVER_ON_CARDS.includes(ck) || (belief as Row).comm_status !== "active")) throw new ApiError("forbidden", "", { reason: "comm_kind_not_shareable" });
  let wording = String((belief as Row).own_wording ?? (belief as Row).statement).trim();
  if (b.wording !== undefined) {
    const t = typeof b.wording === "string" ? b.wording.trim() : "";
    if (!t || t.length > MAX_SHARE_WORDING) throw new ApiError("invalid", "", { field: "wording", max: MAX_SHARE_WORDING });
    const held = await requireSafetyPass(ctx, t, "share_items");   // K-0002: reworded text that will be shown to another person
    if (held.routed === "unavailable") return json(unreadBody({ item: null }));
    if (held.stop) return json({ item: null, state: "safety", resources: RESOURCES });
    wording = t;
  } else {
    // Re-sharing an item keeps the wording its owner approved earlier.
    const { data: old } = await db.from("share_items").select("wording").eq("owner", id).eq("other", other).eq("belief_id", beliefId)
      .maybeSingle();
    if (old && typeof (old as Row).wording === "string") wording = String((old as Row).wording);
  }
  const { error: e2 } = await db.from("share_items").upsert(
    { owner: id, other, belief_id: beliefId, wording, updated_at: new Date().toISOString() },
    { onConflict: "owner,other,belief_id" },
  );
  if (e2) dbError(e2, "share_items.upsert");
  return json({ item: { belief_id: beliefId, shared: true, shared_wording: wording } });
});

route("GET", "/links/:person/share/preview", async (ctx) => {
  const { db, service, id } = me(ctx);
  const other = ctx.params.person;
  await requireActiveLink(db, id, other);
  // The service client reads the same rows the other person's client would; the function is the one the readers call.
  const granted = await pairItems(db, id, other, service);
  return json({ person_id: other, items: granted.map(itemObject), receipts: false });
});
