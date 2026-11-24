// Map (CONTRACT §5): GET /map with everything the sculpture draws per patch, one belief with its connections and receipts,
// ratings, wording and type edits, Not me (Set aside) with undo, restore, delete, and the outside perspectives Mirror surfaced.
// No model call anywhere here; everything is the person's own rows (RLS) and the person decides (law 3).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { BELIEF_TYPES } from "../engine/types.ts";
import type { BeliefType } from "../engine/types.ts";
import { route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import { AREAS, kindFor, LEVEL_FOR_TYPE, SIZE_FOR_KIND, statusForRating, type Area, type Kind } from "./lib/map.ts";
import { beliefsFor, perspectiveObject, receiptObject, type Row } from "./lib/objects.ts";
import { mapDeletePending } from "./data.ts";
import { RESOURCES } from "../engine/safety.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";

const UNDO_MS = 5000;
const undoUntil = () => new Date(Date.now() + UNDO_MS).toISOString();
const RATINGS = ["not", "partly", "very"] as const;

async function loadBelief(db: SupabaseClient, owner: string, id: string, includeDeleted = false): Promise<Row> {
  let q = db.from("beliefs").select("*").eq("id", id).eq("owner", owner);
  if (!includeDeleted) q = q.neq("status", "deleted");
  const { data, error } = await q.maybeSingle();
  if (error) dbError(error, "beliefs");
  if (!data) throw new ApiError("not_found", "", { where: "belief" });
  return data;
}

async function update(db: SupabaseClient, owner: string, id: string, patch: Row): Promise<Row> {
  const { data, error } = await db.from("beliefs").update(patch).eq("id", id).eq("owner", owner).select("*").single();
  if (error) dbError(error, "beliefs.update");
  return data;
}

function brief(b: Row) {
  return { belief_id: b.id, label: b.label, kind: b.kind, area: b.area, birth_mood: b.birth_mood ?? "neutral", status: b.status };
}

// ------------------------------------------------------------------ GET /map

route("GET", "/map", async ({ caller }) => {
  const db = caller!.db, owner = caller!.id;
  if (mapDeletePending(caller!)) {   // "Delete my map" tapped, Undo still possible: nothing is drawn, nothing is removed yet
    return json({
      counts: { confirmed: 0, to_confirm: 0, set_aside: 0, outside_new: 0 }, beliefs: [], links: [],
      area_weights: Object.fromEntries(AREAS.map((a) => [a, 0])), areas_with_beliefs: [], outside: [], new_since_last_visit: [],
      as_of: new Date().toISOString(), deleting: { undo_until: new Date(caller!.mapDeleteAt!).toISOString() },
    });
  }
  const [bs, ls, ps] = await Promise.all([
    db.from("beliefs").select("*").eq("owner", owner).neq("status", "deleted").order("created_at"),
    db.from("belief_links").select("from_belief,to_belief,kind").eq("owner", owner),
    db.from("outside_perspectives").select("*").eq("owner", owner).order("created_at", { ascending: false }),
  ]);
  for (const [r, w] of [[bs, "beliefs"], [ls, "belief_links"], [ps, "outside_perspectives"]] as const) if (r.error) dbError(r.error, w);
  // V3 4.4 / CPO READ-1 (b): items created as communication items are not placed on the map (no topic line, no honest area); old kennings,
  // including ones carry-over has given a kind, keep showing (marker comm_native, migration 0075).
  const rows = (bs.data ?? []).filter((b) => !b.comm_native);
  const ids = new Set(rows.map((b) => b.id as string));
  const weights: Record<Area, number> = Object.fromEntries(AREAS.map((a) => [a, 0])) as Record<Area, number>;
  for (const b of rows) if (b.status === "confirmed") weights[b.area as Area] = Math.round(((weights[b.area as Area] ?? 0) + SIZE_FOR_KIND[b.kind as Kind]) * 10) / 10;
  const seenAt = caller!.profile.map_seen_at ? new Date(caller!.profile.map_seen_at as string).getTime() : 0;
  const since = rows.filter((b) => b.status === "confirmed" && new Date(String(b.confirmed_at ?? b.created_at)).getTime() > seenAt).map((b) => b.id);
  const now = new Date().toISOString();
  const perspectives = ps.data ?? [];
  const cards = perspectives.filter((p) => p.status !== "set_aside" && p.status !== "quiet");   // quiet support is never a card (thesis: no alert)
  const [beliefs] = await Promise.all([
    beliefsFor(db, rows, perspectives),
    db.from("profiles").update({ map_seen_at: now }).eq("id", owner),
  ]);
  return json({
    counts: { confirmed: rows.filter((b) => b.status === "confirmed").length, to_confirm: rows.filter((b) => b.status === "guess").length,
      set_aside: rows.filter((b) => b.status === "set_aside").length, outside_new: perspectives.filter((p) => p.status === "new").length },
    beliefs,
    links: (ls.data ?? []).filter((l) => ids.has(l.from_belief) && ids.has(l.to_belief)).map((l) => ({ from: l.from_belief, to: l.to_belief, kind: l.kind })),
    area_weights: weights,
    areas_with_beliefs: AREAS.filter((a) => weights[a] > 0),
    outside: cards.map(perspectiveObject),
    new_since_last_visit: since,
    as_of: now,
    deleting: null,
  });
});

// ------------------------------------------------------------------ one belief

route("GET", "/beliefs/:id", async ({ caller, params }) => {
  const db = caller!.db, owner = caller!.id;
  const b = await loadBelief(db, owner, params.id);
  const [belief] = await beliefsFor(db, [b]);
  const linked = [...new Set((belief.links as { belief_id: string }[]).map((l) => l.belief_id))];
  const { data: others } = linked.length ? await db.from("beliefs").select("*").in("id", linked).neq("status", "deleted") : { data: [] };
  const by = new Map((others ?? []).map((o) => [o.id as string, o]));
  const pick = (kind: string) => (belief.links as { belief_id: string; kind: string }[]).filter((l) => l.kind === kind && by.has(l.belief_id)).map((l) => brief(by.get(l.belief_id)!));
  const { data: same } = await db.from("beliefs").select("*").eq("owner", owner).eq("area", b.area as string).eq("status", "confirmed").neq("id", b.id).limit(8);
  const connected = { rests_on: pick("rests_on"), holds_up: pick("holds_up"), tension: pick("tension"),
    same_area: (same ?? []).filter((s) => !linked.includes(s.id as string)).map(brief) };
  const { data: rs } = await db.from("receipts").select("message_id,quote,conversation_id,said_at, conversations(title),messages(answer_kind)").eq("belief_id", b.id).order("said_at");
  const receipts = (rs ?? []).map((r) => ({ ...receiptObject(r),
    conversation_title: (r.conversations as unknown as Row | null)?.title ?? "" }));
  return json({ belief, connected, receipts });
});

route("PATCH", "/beliefs/:id", async (ctx) => {
  const { caller, params, body } = ctx;
  const db = caller!.db, owner = caller!.id;
  const cur = await loadBelief(db, owner, params.id);
  const b = await body();
  const patch: Row = {};
  const now = new Date().toISOString();
  if (b.rating !== undefined) {
    if (!(RATINGS as readonly unknown[]).includes(b.rating)) throw new ApiError("invalid", "", { field: "rating" });
    const status = statusForRating(b.rating as typeof RATINGS[number]);
    Object.assign(patch, { rating: b.rating, status, rated_at: now, previous_status: cur.status, previous_rating: cur.rating ?? null });
    if (status === "confirmed") { patch.confirmed_at = cur.confirmed_at ?? now; patch.set_aside_at = null; } else patch.set_aside_at = now;
  }
  if (b.statement !== undefined) {
    const t = typeof b.statement === "string" ? b.statement.trim() : "";
    if (!t || t.length > 400) throw new ApiError("invalid", "", { field: "statement" });
    const held = await requireSafetyPass(ctx, t, "map");   // K-0002: an edited statement is the person's words again
    if (held.routed === "unavailable") return json(unreadBody({ belief: null }));
    if (held.stop) return json({ belief: null, state: "safety", resources: RESOURCES });
    patch.statement = t;                                                  // the person's words, stored as given (law 3)
  }
  if (b.own_wording !== undefined) {
    // v1.66 (CPO 20:45Z (1b, 1c)): the person's own first-person line. Set only by the person: an edit ('Edit the words'), or
    // the exact offered text they confirmed on the Y5 card, sent with the rating. It never rewrites `statement` (law 5).
    if (b.own_wording === null) patch.own_wording = null;
    else {
      const t = typeof b.own_wording === "string" ? b.own_wording.replace(/\s+/g, " ").trim() : "";
      if (!t || t.length > 400) throw new ApiError("invalid", "", { field: "own_wording" });
      patch.own_wording = t;
    }
  }
  if (b.label !== undefined) {
    const t = typeof b.label === "string" ? b.label.trim() : "";
    if (!t || t.split(/\s+/).length > 4) throw new ApiError("invalid", "", { field: "label" });
    patch.label = t;
  }
  if (b.type !== undefined) {
    if (!(BELIEF_TYPES as readonly unknown[]).includes(b.type)) throw new ApiError("invalid", "", { field: "type" });
    patch.type = b.type; patch.kind = kindFor(b.type as BeliefType); patch.level = LEVEL_FOR_TYPE[b.type as BeliefType];
  }
  if (!Object.keys(patch).length) throw new ApiError("invalid", "", { field: "body" });
  const row = await update(db, owner, cur.id as string, patch);
  const [belief] = await beliefsFor(db, [row]);
  return json({ belief });
});

// v1.66 own kenning (F4b; COO 21:20Z Q-ENG-OWN-KENNING, CPO KEY-ACTIONS 3): a line the person typed becomes a confirmed
// kenning in their own words. No model call: neutral type, kind from the type, area from the relationship the app names
// (family -> family, coworker -> work, else relationships). One receipt row quotes the line with today's date (law 2).
// Law 8: the keyword floor runs first; a line showing risk stores nothing and answers with resources.
export const OWN_LABEL = "In my words";
const AREA_FOR_RELATIONSHIP: Record<string, Area> = { partner: "relationships", friend: "relationships", family: "family", coworker: "work" };
const DOMAINS_FOR_AREA: Partial<Record<Area, string[]>> = { relationships: ["close_relationships"], family: ["family"], work: ["work"] };

route("POST", "/beliefs", async (ctx) => {
  const { caller, body } = ctx;
  const db = caller!.db, owner = caller!.id;
  const b = await body();
  const t = typeof b.statement === "string" ? b.statement.replace(/\s+/g, " ").trim() : "";
  if (!t || t.length > 400) throw new ApiError("invalid", "", { field: "statement" });
  if (b.relationship !== undefined && b.relationship !== null && !(typeof b.relationship === "string" && b.relationship in AREA_FOR_RELATIONSHIP)) {
    throw new ApiError("invalid", "", { field: "relationship" });
  }
  const gate = await requireSafetyPass(ctx, t, "map");
  if (gate.routed === "unavailable") return json(unreadBody({ belief: null }));
  if (gate.stop) return json({ belief: null, state: "safety", resources: RESOURCES });
  const area: Area = AREA_FOR_RELATIONSHIP[String(b.relationship ?? "friend")] ?? "relationships";
  const type: BeliefType = "something I believe is true";
  const now = new Date().toISOString();
  const { data: row, error } = await db.from("beliefs").insert({ owner, label: OWN_LABEL, statement: t, own_wording: t, type, kind: kindFor(type),
    level: LEVEL_FOR_TYPE[type], area, domains: DOMAINS_FOR_AREA[area] ?? ["self"], birth_mood: "neutral", status: "confirmed", rating: "very",
    confidence: 1, source: "own", rated_at: now, confirmed_at: now }).select("*").single();
  if (error) dbError(error, "beliefs.insert");
  const { error: e2 } = await db.from("receipts").insert({ owner, belief_id: row.id, quote: t, said_at: now });
  if (e2) {
    await db.from("beliefs").delete().eq("id", row.id).eq("owner", owner);   // no receipt, no belief (law 2)
    dbError(e2, "receipts.insert");
  }
  const [belief] = await beliefsFor(db, [row]);
  return json({ belief, state: "created" }, 201);
});

route("POST", "/beliefs/:id/notme", async ({ caller, params }) => {
  const db = caller!.db, owner = caller!.id;
  const cur = await loadBelief(db, owner, params.id);
  const now = new Date().toISOString();
  const row = await update(db, owner, cur.id as string, { status: "set_aside", rating: "not", previous_status: cur.status, previous_rating: cur.rating ?? null, rated_at: now, set_aside_at: now });
  const [belief] = await beliefsFor(db, [row]);
  return json({ belief, undo_until: undoUntil() });
});

route("POST", "/beliefs/:id/restore", async ({ caller, params }) => {
  const db = caller!.db, owner = caller!.id;
  const cur = await loadBelief(db, owner, params.id, true);
  const status = (cur.previous_status as string | null) && cur.previous_status !== "deleted" ? cur.previous_status : (cur.previous_rating ? statusForRating(cur.previous_rating as "not" | "partly" | "very") : "guess");
  const patch: Row = { status, rating: cur.status === "deleted" ? cur.rating : (cur.previous_rating ?? null), previous_status: null, previous_rating: null, deleted_at: null };
  if (status !== "set_aside") patch.set_aside_at = null;
  const row = await update(db, owner, cur.id as string, patch);
  const [belief] = await beliefsFor(db, [row]);
  return json({ belief });
});

route("DELETE", "/beliefs/:id", async ({ caller, params }) => {
  const db = caller!.db, owner = caller!.id;
  const cur = await loadBelief(db, owner, params.id);
  await update(db, owner, cur.id as string, { status: "deleted", previous_status: cur.status, deleted_at: new Date().toISOString() });
  return json({ deleted: cur.id, undo_until: undoUntil() });
});

// ------------------------------------------------------------------ outside perspectives (Mirror's output; the gate itself lands with item 6)

route("GET", "/outside", async ({ caller }) => {
  const { data, error } = await caller!.db.from("outside_perspectives").select("*").eq("owner", caller!.id).neq("status", "quiet").order("created_at", { ascending: false });
  if (error) dbError(error, "outside_perspectives");
  return json({ perspectives: (data ?? []).map(perspectiveObject) });
});

route("PATCH", "/outside/:id", async ({ caller, params, body }) => {
  const db = caller!.db, owner = caller!.id;
  const { data: p, error } = await db.from("outside_perspectives").select("*").eq("id", params.id).eq("owner", owner).maybeSingle();
  if (error) dbError(error, "outside_perspectives");
  if (!p) throw new ApiError("not_found", "", { where: "outside" });
  if (p.status === "quiet") throw new ApiError("conflict", "", { reason: "quiet_support" });   // seen-by-others support is not a card to rate
  const b = await body();
  const patch: Row = {};
  let belief: Row | null = null;
  if (b.not_now === true) patch.status = "not_now";
  else if ((RATINGS as readonly unknown[]).includes(b.rating)) {
    const rating = b.rating as typeof RATINGS[number];
    patch.rating = rating; patch.status = rating === "not" ? "set_aside" : "rated";
    if (rating !== "not") {
      // The owner confirmed it: it joins the map as a belief seen by others (laws 3, 11, 12). Its evidence is the moment count,
      // never a quote; type, area and domains come from the Mirror synthesis (defaults only for rows made before item 6).
      if (p.belief_id) belief = await loadBelief(db, owner, p.belief_id as string, true);
      const now = new Date().toISOString();
      if (belief) belief = await update(db, owner, belief.id as string, { status: "confirmed", rating, rated_at: now, confirmed_at: now, set_aside_at: null, deleted_at: null });
      else {
        const type: BeliefType = (p.type as BeliefType) ?? "how I tend to react";
        const { data: row, error: e } = await db.from("beliefs").insert({ owner, label: p.label, statement: p.statement, type, kind: kindFor(type), level: LEVEL_FOR_TYPE[type],
          area: (p.area as string) ?? "relationships", domains: (p.domains as string[]) ?? ["close_relationships"], birth_mood: "neutral", status: "confirmed", rating, confidence: 0.7,
          source: "mirror", seen_by_others: true, rated_at: now, confirmed_at: now }).select("*").single();
        if (e) dbError(e, "beliefs.insert");
        belief = row; patch.belief_id = row.id;
        if (p.variant === "tension" && p.about_belief_id) await db.from("belief_links").insert({ owner, from_belief: row.id, to_belief: p.about_belief_id, kind: "tension" });
      }
    }
  } else throw new ApiError("invalid", "", { field: "rating" });
  const { data: updated, error: e2 } = await db.from("outside_perspectives").update(patch).eq("id", p.id).select("*").single();
  if (e2) dbError(e2, "outside_perspectives.update");
  return json({ perspective: perspectiveObject(updated), belief: belief ? (await beliefsFor(db, [belief], [updated]))[0] : null });
});
