// Bridge, the $0 half (CONTRACT §6): people and invites, threads, drafts, scheduling and opening bridges (sealed until
// deliver_at through the database function, §1.7), withdraw, Let's talk plans, link settings and profile actions, and a
// linked person's shared map. The engine endpoints (/bridge/insight, /bridge/run, reword-part, why-it-matters) land with
// engine items 6–8 in bridge_engine.ts. The safety floor runs on every text that would reach another person (law 8).

import { nextCheckInAt, parkBridge, parkedOnCheckIns, unparkBridge } from "./checkin.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { UNREAD_LINE, unreadBody } from "./lib/safety_gate.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import { flaggedSpans, refusal } from "../engine/bridge/insight.ts";
import { type Ctx, route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import { type Area, AREAS, type Kind, SIZE_FOR_KIND } from "./lib/map.ts";
import { beliefsFor, personObject, type Row } from "./lib/objects.ts";
import { loadPairContext } from "./pair_context.ts";

const RELATIONSHIPS = ["partner", "friend", "family", "coworker"] as const;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_TEXT = 4000;

function me(ctx: Ctx) {
  return { db: ctx.caller!.db, id: ctx.caller!.id };
}

export async function people(
  db: SupabaseClient,
  ids: string[],
): Promise<Map<string, ReturnType<typeof personObject>>> {
  const out = new Map<string, ReturnType<typeof personObject>>();
  if (!ids.length) return out;
  const { data } = await db.from("profiles").select("*").in("id", [...new Set(ids)]);
  for (const p of data ?? []) out.set(p.id as string, personObject(p));
  return out;
}

/** The link row between me and another person, in any status; null when none. */
async function linkWith(db: SupabaseClient, mine: string, other: string): Promise<Row | null> {
  const a = mine < other ? mine : other, b = mine < other ? other : mine;
  const { data, error } = await db.from("links").select("*").eq("person_a", a).eq("person_b", b)
    .maybeSingle();
  if (error) dbError(error, "links");
  return data ?? null;
}

async function requireActiveLink(db: SupabaseClient, mine: string, other: string): Promise<Row> {
  const link = await linkWith(db, mine, other);
  if (!link) throw new ApiError("not_found", "", { where: "link" });
  // QA-B415: the person who was blocked must not learn that fact from an API
  // response. To them, this person is indistinguishable from one who is gone.
  if (link.status === "blocked" && link.blocked_by !== mine) {
    throw new ApiError("not_found", "", { where: "link" });
  }
  if (link.status !== "active") throw new ApiError("forbidden", "", { reason: link.status });
  return link;
}

async function prefs(db: SupabaseClient, owner: string, other: string): Promise<Row> {
  const { data } = await db.from("link_prefs").select("*").eq("owner", owner).eq("other", other)
    .maybeSingle();
  return data ??
    {
      owner,
      other,
      relationship: null,
      muted_until: null,
      archived: false,
      pinned: false,
      unread: false,
      read_receipts: true,
      share_on: false,
      share_areas: [],
      share_quotes: false,
    };
}

function shareOf(p: Row) {
  return { on: p.share_on ?? false, areas: p.share_areas ?? [], quotes: p.share_quotes ?? false };
}

export function planObject(p: Row) {
  return {
    id: p.id,
    bridge_id: p.bridge_id,
    proposed_by: p.proposer,
    when: p.at ?? null,
    soon: p.soon ?? false,
    status: p.status,
    talked_at: p.talked_at ?? null,
    created_at: p.created_at,
  };
}

function eventObject(e: Row) {
  return {
    id: e.id,
    type: e.type,
    by: e.person_a,
    at: e.created_at,
    bridge_id: e.bridge_id ?? null,
    plan_id: e.plan_id ?? null,
  };
}

/**
 * "Show when I've opened" (Y03, Bridge): the sender learns `opened_at` only when read receipts are on for both sides; off on either
 * side hides theirs too, as in WhatsApp. The default is on; a missing link_prefs row counts as on.
 */
export async function receiptsOn(db: SupabaseClient, mine: string, other: string): Promise<boolean> {
  const { data, error } = await db.from("link_prefs").select("owner,read_receipts").or(
    `and(owner.eq.${mine},other.eq.${other}),and(owner.eq.${other},other.eq.${mine})`,
  );
  if (error) dbError(error, "link_prefs");
  return (data ?? []).every((p) => p.read_receipts !== false);
}

/** A bridge as its sender sees it (CONTRACT §2). `receipts` false hides `opened_at` (read receipts off on either side). */
export function senderBridge(b: Row, persons: Map<string, unknown>, plan: Row | null, receipts = true) {
  const delivered = b.status === "scheduled" && new Date(String(b.deliver_at)).getTime() <= Date.now();
  // QA-B404 (COO 05:20Z 17 Nov, ruled (a)): a row that reached an account before it was deleted stays, and its sender must not read
  // 'scheduled' for something that already went. Read-side only (no row is rewritten); live receivers keep the contract's derived
  // `delivered` beside `status: "scheduled"`, so the app is unchanged for them.
  const toDeleted =
    (persons.get(b.receiver as string) as { deleted?: boolean } | undefined)?.deleted === true;
  return {
    id: b.id,
    from: persons.get(b.sender as string) ?? null,
    to: persons.get(b.receiver as string) ?? null,
    reply_to: b.reply_to ?? null,
    status: delivered && toDeleted ? "delivered" : b.status,
    delivered,
    opened_at: receipts ? (b.opened_at ?? null) : null,
    deliver_at: b.deliver_at,
    tz: b.tz ?? "UTC",
    receiver_tz: ((persons.get(b.receiver as string) as { tz?: string | null } | undefined)?.tz) ?? null,
    original: b.original,
    bridged: b.bridged ?? null,
    final: b.final,
    used: b.used,
    outcome: b.outcome ?? null,
    // Q4 (CDO build review 1): nothing changed, so the sent bubble carries no bridged mark.
    bridged_mark: b.used === "bridged" && b.outcome !== "nothing_to_change",
    tone_original: b.tone_original ?? null,
    tone_bridged: b.tone_bridged ?? null,
    changes: b.changes ?? [],
    points: b.points ?? [],
    show_original: b.show_original ?? false,
    heads_up: b.heads_up ?? true,
    created_at: b.created_at,
    updated_at: b.updated_at,
    plan: plan ? planObject(plan) : null,
    ref: b.ref ?? null,
  };
}

/** A bridge as its receiver sees it: the database function's view (never the table), plus the sender as a Person and the plan. */
/** The receiver's view (§1.7), straight from receiver_view(): the sealed and ready shapes carry no text; `remind_at` is the receiver's own. */
function receiverBridge(v: Row, persons: Map<string, unknown>, plan: Row | null) {
  return {
    ...v,
    remind_at: v.ready ? (v.remind_at ?? null) : undefined,
    from: persons.get(v.from as string) ?? null,
    plan: plan ? planObject(plan) : null,
  };
}

export async function receiverViews(
  db: SupabaseClient,
  sender: string,
  createdAfter: string | null = null,
): Promise<Row[]> {
  const { data, error } = await db.rpc("receiver_bridges", {
    p_sender: sender,
    p_created_after: createdAfter,
  });
  if (error) dbError(error, "receiver_bridges");
  return ((data ?? []) as unknown[]).map((x) =>
    (typeof x === "object" && x && "receiver_view" in (x as Row) ? (x as Row).receiver_view : x) as Row
  ).filter(Boolean);
}

async function plansFor(db: SupabaseClient, bridgeIds: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  if (!bridgeIds.length) return out;
  const { data } = await db.from("plans").select("*").in("bridge_id", bridgeIds).neq("status", "cancelled")
    .order("created_at", { ascending: false });
  for (const p of data ?? []) if (!out.has(p.bridge_id as string)) out.set(p.bridge_id as string, p);
  return out;
}

// ------------------------------------------------------------------ people and invites

export async function myLinks(db: SupabaseClient, mine: string): Promise<Row[]> {
  const { data, error } = await db.from("links").select("*").or(`person_a.eq.${mine},person_b.eq.${mine}`)
    .order("created_at");
  if (error) dbError(error, "links");
  return data ?? [];
}
/** Speed (CEO 12 Nov): run `f` over `xs` at most `limit` at a time; results keep the order of `xs`. The first rejection rejects. */
export async function inParallel<T, R>(xs: T[], f: (x: T, i: number) => Promise<R>, limit = 6): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await f(xs[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}
export const otherOf = (l: Row, mine: string) => (l.person_a === mine ? l.person_b : l.person_a) as string;

route("GET", "/people", async (ctx) => {
  const { db, id } = me(ctx);
  const links = await myLinks(db, id);
  const others = links.map((l) => otherOf(l, id));
  const inviteIds = links.map((l) => l.invite_id).filter(Boolean) as string[];
  // v1.52: a person "shares with me" when they granted me at least one item (the grantee reads only grants to them, live).
  // v1.55: `invite_code` only on links made from MY OWN invites (the inviter's RLS read; the joiner never gets one).
  // Speed (CEO 12 Nov): these five reads depend only on the links, so they go out together.
  const [persons, { data: mine }, { data: theirs }, { data: grants }, { data: inv }] = await Promise.all([
    people(db, others),
    db.from("link_prefs").select("*").eq("owner", id),
    db.from("link_prefs").select("owner,share_on").eq("other", id),
    db.from("share_items").select("owner").eq("other", id),
    inviteIds.length
      ? db.from("invites").select("id,code").eq("owner", id).in("id", inviteIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const grantors = new Set(((grants ?? []) as Row[]).map((g) => String(g.owner)));
  const inviteCodeByLink = new Map<string, string>();
  if (inviteIds.length) {
    const codeById = new Map(((inv ?? []) as Row[]).map((r) => [String(r.id), String(r.code)]));
    for (const l of links) {
      if (l.invite_id && codeById.has(String(l.invite_id))) {
        inviteCodeByLink.set(String(l.id), codeById.get(String(l.invite_id))!);
      }
    }
  }
  const rows = links.map((l) => {
    const o = otherOf(l, id);
    const p = (mine ?? []).find((x) => x.other === o) ?? {};
    return {
      person: persons.get(o) ?? null,
      relationship: p.relationship ?? null,
      shares_map: grantors.has(o) || (theirs ?? []).some((t) => t.owner === o && t.share_on),
      i_share: shareOf(p),
      pinned: p.pinned ?? false,
      muted_until: p.muted_until ?? null,
      archived: p.archived ?? false,
      status: l.status,
      joined_at: l.created_at,
      invite_code: inviteCodeByLink.get(String(l.id)) ?? null,
    };
  }).sort((a, b) =>
    String((a.person as Row | null)?.name ?? "").localeCompare(String((b.person as Row | null)?.name ?? ""))
  );
  return json({ people: rows, archived_count: rows.filter((r) => r.archived).length });
});

route("POST", "/invites", async (ctx) => {
  const { db, id } = me(ctx);
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  const { data, error } = await db.from("invites").insert({ code, owner: id }).select("*").single();
  if (error) dbError(error, "invites.insert");
  return json({
    code,
    link: `https://kenember.com/i/${code}`,
    qr_payload: `presence://i/${code}`,
    expires_at: data.expires_at,
  });
});

// v1.54: read-only peek at an invite for a signed-in person (app Q-V25-ON2). Never notifies, never marks, never accepts.
route("GET", "/invites/:code", async (ctx) => {
  const { db } = me(ctx);
  const code = ctx.params.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new ApiError("not_found", "", { where: "invites" });
  const { data, error } = await db.rpc("peek_invite", { p_code: code });
  if (error) dbError(error, "peek_invite");
  const r = data as Row;
  return json({ inviter: { name: r.name, initial: r.initial }, expires_at: r.expires_at });
});

route("POST", "/invites/:code/accept", async (ctx) => {
  const { db } = me(ctx);
  const { data, error } = await db.rpc("accept_invite", { p_code: ctx.params.code.toUpperCase() });
  if (error) dbError(error, "accept_invite");
  const r = data as Row;
  const persons = await people(db, [String(r.person)]);
  return json({ person: persons.get(String(r.person)) ?? null, link_id: r.link_id });
});

// ------------------------------------------------------------------ threads

interface Last {
  kind: string;
  at: string | null;
  text: string | null;
  bridge_id: string | null;
}

/**
 * One thread as the viewer sees it. `clearedAt` is the viewer's "Delete conversation" moment (link_prefs.cleared_at): everything in
 * the thread up to then is their removed copy and stays hidden for them only. `activity` is the latest thing that happened in the
 * thread (a bridge sent, delivered or opened, a plan, an event, the draft), for the B01 row time, separate from `last.at`, which for
 * a scheduled or sealed bridge is the coming time.
 */
export async function threadOf(
  db: SupabaseClient,
  mine: string,
  other: string,
  persons: Map<string, unknown>,
  draft: Row | null,
  clearedAt: string | null = null,
) {
  const cleared = clearedAt ? new Date(clearedAt).getTime() : null;
  const after = (t: unknown) => cleared === null || (!!t && new Date(String(t)).getTime() > cleared);
  // Speed (CEO 12 Nov): the reads that do not depend on each other go out together, two round trips instead of six.
  // QA-B16: a clear divides bridges by when they were made, not by when they are due. Two bridges scheduled
  // for the same evening can sit on opposite sides of the clear; `deliver_at` cannot distinguish them.
  const [{ data: sentAll }, received, receipts, { data: eventsAll }] = await Promise.all([
    db.from("bridges").select("*").eq("sender", mine).eq("receiver", other).is("sender_deleted_at", null)
      .neq("status", "withdrawn").order("created_at"),
    receiverViews(db, other, clearedAt),
    receiptsOn(db, mine, other),
    db.from("thread_events").select("*").or(
      `and(person_a.eq.${mine},person_b.eq.${other}),and(person_a.eq.${other},person_b.eq.${mine})`,
    ).order("created_at"),
  ]);
  const sent = (sentAll ?? []).filter((b) => after(b.created_at));
  const bridgeIds = [...(sent ?? []).map((b) => b.id as string), ...received.map((v) => String(v.id))];
  // E41: only the sender's rows say a bridge waits on a check-in (and which); the receiver's rows never carry it.
  const [plansAll, parkedOn] = await Promise.all([
    plansFor(db, bridgeIds),
    parkedOnCheckIns(db, mine, other, sent),
  ]);
  const plans = new Map([...plansAll].filter(([, p]) => after(p.created_at)));
  // QA-B403 (CEO GAP-1): an event written invisible to its other party (a block, a removal) is never part of that party's thread, so it
  // carries no `by` or `at` and bumps no activity. Row-level security already holds this on the live database; the filter keeps it true
  // for any client that is not subject to it, and in the tests.
  const events = (eventsAll ?? []).filter((e) =>
    after(e.created_at) && (e.person_a === mine || e.visible_to_b !== false)
  );
  const items: { at: string; item: Record<string, unknown> }[] = [];
  for (const b of sent) {
    const ci = parkedOn.get(String(b.id));
    items.push({
      at: String(b.created_at),
      item: {
        kind: "bridge",
        bridge: {
          ...senderBridge(b, persons, plans.get(b.id as string) ?? null, receipts),
          ...(ci ? { parked_on_check_in: true, checkin_id: ci } : {}),
        },
      },
    });
  }
  for (const v of received) {
    items.push({
      at: String(v.deliver_at),
      item: { kind: "bridge", bridge: receiverBridge(v, persons, plans.get(String(v.id)) ?? null) },
    });
  }
  for (const p of plans.values()) {
    items.push({ at: String(p.created_at), item: { kind: "plan", plan: planObject(p) } });
  }
  for (const e of events) {
    items.push({ at: String(e.created_at), item: { kind: "event", event: eventObject(e) } });
  }
  items.sort((a, b) => a.at.localeCompare(b.at));

  // The B01 line. Pick order (v1.12): your draft; else a ready bridge; else what is pending (a scheduled or sealed bridge, a plan:
  // the soonest coming time first); else the latest thing that happened (opened words, a delivered bridge). A coming time never
  // outranks something that happened by being further away, as it did before v1.12.
  let last: Last = { kind: "none", at: null, text: null, bridge_id: null };
  const now = Date.now();
  const candidates: { l: Last; rank: number }[] = [];
  for (const b of sent) {
    const delivered = new Date(String(b.deliver_at)).getTime() <= now;
    // With read receipts off on either side the sender's row never says "opened": the bridge stays a delivered one for them.
    if (b.opened_at && receipts) {
      candidates.push({
        l: { kind: "opened", at: String(b.opened_at), text: String(b.final), bridge_id: String(b.id) },
        rank: 3,
      });
    } else {candidates.push({
        l: {
          kind: "scheduled",
          at: String(delivered ? b.created_at : b.deliver_at),
          text: null,
          bridge_id: String(b.id),
        },
        rank: delivered ? 3 : 2,
      });}
  }
  for (const v of received) {
    if (v.opened_at) {
      candidates.push({
        l: { kind: "opened", at: String(v.opened_at), text: String(v.final ?? ""), bridge_id: String(v.id) },
        rank: 3,
      });
    } else if (v.ready) {
      candidates.push({
        l: { kind: "ready", at: String(v.deliver_at), text: null, bridge_id: String(v.id) },
        rank: 1,
      });
    } else {candidates.push({
        l: { kind: "sealed", at: String(v.deliver_at), text: null, bridge_id: String(v.id) },
        rank: 2,
      });}
  }
  for (const p of plans.values()) {
    if (p.status === "planned") {
      candidates.push({
        l: { kind: "plan", at: String(p.at ?? p.created_at), text: null, bridge_id: String(p.bridge_id) },
        rank: 2,
      });
    }
  }
  if (draft && String(draft.text ?? "").trim()) {
    candidates.push({
      l: { kind: "draft", at: String(draft.updated_at), text: String(draft.text), bridge_id: null },
      rank: 0,
    });
  }
  candidates.sort((a, b) =>
    a.rank - b.rank ||
    (a.rank === 2
      ? String(a.l.at).localeCompare(String(b.l.at))
      : String(b.l.at).localeCompare(String(a.l.at)))
  );
  last = candidates[0]?.l ?? last;
  const today = new Date().toISOString().slice(0, 10);
  const badge = received.filter((v) => v.ready && !v.opened_at).length +
    [...plans.values()].filter((p) => p.status === "planned" && String(p.at ?? "").slice(0, 10) === today)
      .length;
  // What happened last, as a moment in the past (never a coming time): the B01 row time and the list order.
  const happened: number[] = [];
  const mark = (t: unknown) => {
    if (t) {
      const n = new Date(String(t)).getTime();
      if (!Number.isNaN(n) && n <= now) happened.push(n);
    }
  };
  for (const b of sent) {
    mark(b.created_at);
    if (receipts) mark(b.opened_at);
  }
  for (const v of received) {
    if (!v.sealed) mark(v.deliver_at);
    mark(v.opened_at);
  }
  for (const p of plans.values()) {
    mark(p.created_at);
    mark(p.talked_at);
  }
  for (const e of events) mark(e.created_at);
  if (draft && String(draft.text ?? "").trim()) mark(draft.updated_at);
  if (clearedAt) mark(clearedAt);
  const activity = happened.length ? new Date(Math.max(...happened)).toISOString() : null;
  return { items: items.map((x) => x.item), last, badge, received, activity };
}

route("GET", "/threads", async (ctx) => {
  const { db, id } = me(ctx);
  const links = await myLinks(db, id);
  const others = links.filter((l) => l.status !== "blocked" || l.blocked_by === id).map((l) =>
    otherOf(l, id)
  );
  const [persons, { data: mine }, { data: drafts }] = await Promise.all([
    people(db, [...others, id]),
    db.from("link_prefs").select("*").eq("owner", id),
    db.from("drafts").select("*").eq("owner", id),
  ]);
  // One thread per person, read side by side (was one after another: N people x six round trips).
  const built = await inParallel(others, (o) => {
    const p = (mine ?? []).find((x) => x.other === o) ?? {};
    return threadOf(
      db,
      id,
      o,
      persons,
      (drafts ?? []).find((d) => d.other === o) ?? null,
      (p.cleared_at as string | null) ?? null,
    );
  });
  const threads = [];
  for (const [i, o] of others.entries()) {
    const p = (mine ?? []).find((x) => x.other === o) ?? {};
    const link = links.find((l) => otherOf(l, id) === o);
    const t = built[i];
    threads.push({
      person: persons.get(o) ?? null,
      pinned: p.pinned ?? false,
      unread: t.badge > 0 || p.unread === true,
      archived: p.archived ?? false,
      muted_until: p.muted_until ?? null,
      last: t.last,
      badge: t.badge,
      activity_at: t.activity ?? link?.created_at ?? null,
      joined_at: link?.created_at ?? null,
      status: link?.status ?? "active",
    });
  }
  threads.sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) ||
    String(b.activity_at ?? "").localeCompare(String(a.activity_at ?? ""))
  );
  return json({
    threads: threads.filter((t) => !t.archived),
    archived: threads.filter((t) => t.archived),
    bridge_tab_dot: threads.some((t) => t.badge > 0),
  });
});

route("GET", "/threads/:person", async (ctx) => {
  const { db, id } = me(ctx);
  const other = ctx.params.person;
  const link = await linkWith(db, id, other);
  if (!link) throw new ApiError("not_found", "", { where: "link" });
  // This read intentionally permits the blocker to see their own closed
  // thread, so it cannot use requireActiveLink. Preserve the same neutral
  // absence for the other person here instead.
  if (link.status === "blocked" && link.blocked_by !== id) {
    throw new ApiError("not_found", "", { where: "link" });
  }
  const [persons, p, { data: draft }] = await Promise.all([
    people(db, [id, other]),
    prefs(db, id, other),
    db.from("drafts").select("*").eq("owner", id).eq("other", other).maybeSingle(),
  ]);
  const t = await threadOf(db, id, other, persons, draft ?? null, (p.cleared_at as string | null) ?? null);
  if (t.received.some((v) => v.sealed)) await db.rpc("mark_heads_up_seen", { p_sender: other }); // the sealed bubble was shown: a withdrawal must now say so
  if (p.unread === true) {
    await db.from("link_prefs").update({ unread: false }).eq("owner", id).eq("other", other); // opening the thread reads it
  }
  return json({
    person: persons.get(other) ?? null,
    link: {
      status: link.status,
      relationship: p.relationship ?? null,
      read_receipts: p.read_receipts ?? true,
    },
    items: t.items,
    activity_at: t.activity ?? link.created_at ?? null,
    draft: draft
      ? { text: draft.text, reply_to: draft.reply_to ?? null, updated_at: draft.updated_at }
      : null,
  });
});

/** B01 swipe right: Mark unread. The dot shows until the viewer opens the thread (or a new bridge badges it anyway). */
route("POST", "/threads/:person/mark-unread", async (ctx) => {
  const { db, id } = me(ctx);
  const other = ctx.params.person;
  if (!(await linkWith(db, id, other))) throw new ApiError("not_found", "", { where: "link" });
  const { error } = await db.from("link_prefs").upsert({
    owner: id,
    other,
    unread: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner,other" });
  if (error) dbError(error, "link_prefs.upsert");
  return json({ person_id: other, unread: true });
});

/**
 * B01 More → Delete ("Edit, delete and archive rules": removes your copy only and withdraws your undelivered bridges). The link and the
 * other person's copy stay. Your scheduled, undelivered bridges to them are withdrawn (they see "withdrew" only if they saw the sealed
 * bubble); your delivered copies, their delivered bridges to you, the plans and events up to now, and your draft leave your view.
 */
route("DELETE", "/threads/:person", async (ctx) => {
  const { db, id } = me(ctx);
  const other = ctx.params.person;
  if (!(await linkWith(db, id, other))) throw new ApiError("not_found", "", { where: "link" });
  const now = new Date().toISOString();
  const { data: pending } = await db.from("bridges").select("id,heads_up_seen_at").eq("sender", id).eq(
    "receiver",
    other,
  ).eq("status", "scheduled").is("opened_at", null).gt("deliver_at", now);
  const withdrawn: string[] = [];
  for (const b of pending ?? []) {
    const { error } = await db.from("bridges").update({ status: "withdrawn", withdrawn_at: now }).eq(
      "id",
      b.id,
    ).eq("sender", id);
    if (error) dbError(error, "bridges.withdraw");
    withdrawn.push(String(b.id));
    // The event is for the other side; stamped at the cleared moment so it is part of what the deleter just removed.
    if (b.heads_up_seen_at) {
      await db.from("thread_events").insert({
        person_a: id,
        person_b: other,
        type: "withdrew",
        bridge_id: b.id,
        created_at: now,
      });
    }
  }
  const { data: removed, error: e1 } = await db.from("bridges").update({ sender_deleted_at: now }).eq(
    "sender",
    id,
  ).eq("receiver", other).neq("status", "withdrawn").is("sender_deleted_at", null).select("id");
  if (e1) dbError(e1, "bridges.delete");
  const { data: theirs, error: e2 } = await db.rpc("receiver_delete_thread", { p_sender: other });
  if (e2) dbError(e2, "receiver_delete_thread");
  await db.from("drafts").delete().eq("owner", id).eq("other", other);
  const { error: e3 } = await db.from("link_prefs").upsert({
    owner: id,
    other,
    cleared_at: now,
    unread: false,
    updated_at: now,
  }, { onConflict: "owner,other" });
  if (e3) dbError(e3, "link_prefs.upsert");
  return json({
    deleted: true,
    person_id: other,
    withdrawn,
    removed: (removed ?? []).length + Number(theirs ?? 0),
    cleared_at: now,
  });
});

// ------------------------------------------------------------------ drafts

route("PUT", "/drafts/:person", async (ctx) => {
  const { db, id } = me(ctx);
  const b = await ctx.body();
  const t = typeof b.text === "string" ? b.text : "";
  if (t.length > MAX_TEXT) throw new ApiError("invalid", "", { field: "text", max: MAX_TEXT });
  const { data, error } = await db.from("drafts").upsert({
    owner: id,
    other: ctx.params.person,
    text: t,
    reply_to: typeof b.reply_to === "string" ? b.reply_to : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner,other" }).select("*").single();
  if (error) dbError(error, "drafts.upsert");
  return json({ draft: { text: data.text, reply_to: data.reply_to ?? null, updated_at: data.updated_at } });
});
route("GET", "/drafts/:person", async (ctx) => {
  const { db, id } = me(ctx);
  const { data } = await db.from("drafts").select("*").eq("owner", id).eq("other", ctx.params.person)
    .maybeSingle();
  return json({
    draft: data ? { text: data.text, reply_to: data.reply_to ?? null, updated_at: data.updated_at } : null,
  });
});
route("DELETE", "/drafts/:person", async (ctx) => {
  const { db, id } = me(ctx);
  await db.from("drafts").delete().eq("owner", id).eq("other", ctx.params.person);
  return json({ deleted: true });
});

// ------------------------------------------------------------------ sending

function deliverAt(v: unknown): string {
  if (v === "now" || v === undefined || v === null) return new Date().toISOString();
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new ApiError("invalid", "", { field: "deliver_at" });
  return d.toISOString();
}

async function loadSent(db: SupabaseClient, mine: string, id: string): Promise<Row> {
  const { data, error } = await db.from("bridges").select("*").eq("id", id).eq("sender", mine).maybeSingle();
  if (error) dbError(error, "bridges");
  if (!data) throw new ApiError("not_found", "", { where: "bridge" });
  return data;
}

async function sentReply(db: SupabaseClient, b: Row) {
  const persons = await people(db, [String(b.sender), String(b.receiver)]);
  const plans = await plansFor(db, [String(b.id)]);
  return senderBridge(
    b,
    persons,
    plans.get(String(b.id)) ?? null,
    await receiptsOn(db, String(b.sender), String(b.receiver)),
  );
}

route("POST", "/bridges", async (ctx) => {
  const { db, id } = me(ctx);
  const b = await ctx.body();
  if (typeof b.person_id !== "string") throw new ApiError("invalid", "", { field: "person_id" });
  await requireActiveLink(db, id, b.person_id);
  const used = ["bridged", "mine", "edited"].includes(String(b.used)) ? String(b.used) : null;
  if (!used) throw new ApiError("invalid", "", { field: "used" });
  const original = typeof b.original === "string" ? b.original.trim() : "";
  const final = typeof b.final === "string"
    ? b.final.trim()
    : (used === "mine" ? original : typeof b.bridged === "string" ? b.bridged.trim() : "");
  if (!original || !final) throw new ApiError("invalid", "", { field: !original ? "original" : "final" });
  if (original.length > MAX_TEXT || final.length > MAX_TEXT) {
    throw new ApiError("invalid", "", { field: "final", max: MAX_TEXT });
  }
  // Law 8: nothing that reads as a threat is carried to another person.
  const floor = await requireSafetyPass(ctx, final, "bridge");
  if (floor.routed === "unavailable") {
    throw new ApiError("unreachable", UNREAD_LINE, unreadBody({ reason: "unread" }));
  }
  if (floor.routed !== "none") {
    throw new ApiError("forbidden", "I won't carry this one.", {
      reason: "wont_carry",
      safety: floor.routed === "risk" ? "risk" : "threat",
      ...refusal(flaggedSpans(final, null, { routed: floor.routed })),
      detail: floor.reason,
    });
  }
  // E32/E33: "Next check-in" as a send time: the sender's accepted check-in with this person; the words are parked on it.
  const park = b.deliver_at === "next_checkin";
  if (park) b.deliver_at = await nextCheckInAt(db, id, b.person_id);
  const row: Row = {
    sender: id,
    receiver: b.person_id,
    original,
    bridged: typeof b.bridged === "string" ? b.bridged : null,
    final,
    used,
    outcome: ["ok", "nothing_to_change", "could_not_bridge", "wont_carry"].includes(String(b.outcome))
      ? b.outcome
      : null,
    changes: Array.isArray(b.changes) ? b.changes : [],
    points: Array.isArray(b.points) ? b.points : [],
    tone_original: typeof b.tone_original === "string" ? b.tone_original : null,
    tone_bridged: typeof b.tone_bridged === "string" ? b.tone_bridged : null,
    show_original: b.show_original === true,
    heads_up: park ? false : b.heads_up !== false,
    deliver_at: deliverAt(b.deliver_at),
    tz: typeof b.tz === "string" ? b.tz : ctx.tz,
    reply_to: typeof b.reply_to === "string" ? b.reply_to : null,
    status: "scheduled",
  };
  const { data, error } = await db.from("bridges").insert(row).select("*").single();
  if (error) dbError(error, "bridges.insert");
  await db.from("drafts").delete().eq("owner", id).eq("other", b.person_id);
  if (park) await parkBridge(db, id, b.person_id, String((data as Row).id), final);
  return json({
    bridge: await sentReply(db, data),
    parked_on_check_in: park,
    held_by_window: HELD_BY_WINDOW,
  });
});

/**
 * v1.69 (CPO 12 Nov 22:40Z (1), COO 23:20Z): the send reply says whether the receiver's own delivery window moved the
 * delivery time. The engine has no receiver-side window: `deliver_at` is exactly what the sender chose ("now" is the
 * server's now and `bridge.delivered` is true at once; a later time is the sender's own pick). So it is false on every
 * reply; it turns true only if a receiver window is ever built (new product work, not scheduled).
 */
const HELD_BY_WINDOW = false;

route("PATCH", "/bridges/:id", async (ctx) => {
  const { db, id } = me(ctx);
  const cur = await loadSent(db, id, ctx.params.id);
  if (cur.status === "withdrawn") throw new ApiError("forbidden", "", { reason: "withdrawn" });
  if (cur.opened_at) throw new ApiError("forbidden", "", { reason: "too_late" });
  const b = await ctx.body();
  const patch: Row = {};
  const delivered = new Date(String(cur.deliver_at)).getTime() <= Date.now();
  const park = b.deliver_at === "next_checkin";
  if (park) {
    if (delivered) throw new ApiError("forbidden", "", { reason: "delivered" });
    patch.deliver_at = await nextCheckInAt(db, id, String(cur.receiver));
    patch.heads_up = false; // the receiver is told nothing before the check-in
  } else if (b.deliver_at !== undefined) patch.deliver_at = deliverAt(b.deliver_at);
  if (b.final !== undefined) {
    if (delivered) throw new ApiError("forbidden", "", { reason: "delivered" });
    const final = typeof b.final === "string" ? b.final.trim() : "";
    if (!final || final.length > MAX_TEXT) throw new ApiError("invalid", "", { field: "final" });
    const floor = await requireSafetyPass(ctx, final, "bridge");
    if (floor.routed === "unavailable") {
      throw new ApiError("unreachable", UNREAD_LINE, unreadBody({ reason: "unread" }));
    }
    if (floor.routed !== "none") {
      throw new ApiError("forbidden", "I won't carry this one.", {
        reason: "wont_carry",
        safety: floor.routed === "risk" ? "risk" : "threat",
        ...refusal(flaggedSpans(final, null, { routed: floor.routed })),
      });
    }
    patch.final = final;
    patch.used = b.used === "bridged" || b.used === "mine" ? b.used : "edited";
  }
  if (typeof b.heads_up === "boolean" && !park) patch.heads_up = b.heads_up;
  if (typeof b.show_original === "boolean") patch.show_original = b.show_original;
  if (!Object.keys(patch).length) throw new ApiError("invalid", "", { field: "body" });
  const { data, error } = await db.from("bridges").update(patch).eq("id", cur.id).eq("sender", id).select("*")
    .single();
  if (error) dbError(error, "bridges.update");
  if (park) await parkBridge(db, id, String(cur.receiver), String(cur.id), String((data as Row).final));
  else if (b.deliver_at !== undefined) await unparkBridge(db, id, String(cur.id));
  return json({
    bridge: await sentReply(db, data),
    parked_on_check_in: park,
    held_by_window: HELD_BY_WINDOW,
  });
});

route("POST", "/bridges/:id/withdraw", async (ctx) => {
  const { db, id } = me(ctx);
  const cur = await loadSent(db, id, ctx.params.id);
  if (cur.opened_at) throw new ApiError("forbidden", "", { reason: "too_late" });
  if (cur.status === "withdrawn") {
    return json({
      bridge: await sentReply(db, cur),
      receiver_sees: cur.heads_up_seen_at ? "withdrawn" : "nothing",
    });
  }
  const { data, error } = await db.from("bridges").update({
    status: "withdrawn",
    withdrawn_at: new Date().toISOString(),
  }).eq("id", cur.id).eq("sender", id).select("*").single();
  if (error) dbError(error, "bridges.update");
  await unparkBridge(db, id, String(cur.id));
  const seen = !!cur.heads_up_seen_at;
  if (seen) {
    await db.from("thread_events").insert({
      person_a: id,
      person_b: cur.receiver,
      type: "withdrew",
      bridge_id: cur.id,
    });
  }
  return json({ bridge: await sentReply(db, data), receiver_sees: seen ? "withdrawn" : "nothing" });
});

route("POST", "/bridges/:id/open", async (ctx) => {
  const { db } = me(ctx);
  const { data, error } = await db.rpc("open_bridge", { p_id: ctx.params.id });
  if (error) dbError(error, "open_bridge");
  const v = data as Row;
  const persons = await people(db, [String(v.from)]);
  const plans = await plansFor(db, [String(v.id)]);
  return json({
    bridge: receiverBridge(v, persons, plans.get(String(v.id)) ?? null),
    opened_at: v.opened_at,
  });
});

/**
 * B10c Remind me later (CDO build review 1, R3 Q2): the receiver's own time for a ready bridge (In 1 hour, Tonight 10:00 PM, Tomorrow 8:00 AM, or a
 * picked time: the app turns the pick into an ISO time in the receiver's zone). Per viewer; the sender is told nothing; opened_at is set only when
 * the bridge is opened. `null` clears it. The app schedules its local notification from the reply's `remind_at`.
 */
route("POST", "/bridges/:id/remind", async (ctx) => {
  const { db } = me(ctx);
  const b = await ctx.body();
  let at: string | null = null;
  if (b.remind_at !== null && b.remind_at !== undefined) {
    const d = new Date(String(b.remind_at));
    if (Number.isNaN(d.getTime())) throw new ApiError("invalid", "", { field: "remind_at" });
    if (d.getTime() <= Date.now()) throw new ApiError("invalid", "", { field: "remind_at", reason: "past" });
    at = d.toISOString();
  }
  const { data, error } = await db.rpc("remind_bridge", { p_id: ctx.params.id, p_at: at });
  if (error) dbError(error, "remind_bridge");
  const v = data as Row;
  const persons = await people(db, [String(v.from)]);
  const plans = await plansFor(db, [String(v.id)]);
  return json({
    bridge: receiverBridge(v, persons, plans.get(String(v.id)) ?? null),
    remind_at: v.remind_at ?? null,
  });
});

route("DELETE", "/bridges/:id", async (ctx) => {
  const { db, id } = me(ctx);
  const { data: mine } = await db.from("bridges").select("id,opened_at").eq("id", ctx.params.id).eq(
    "sender",
    id,
  ).maybeSingle();
  if (mine) {
    if (!mine.opened_at) throw new ApiError("forbidden", "", { reason: "not_opened" });
    await db.from("bridges").update({ sender_deleted_at: new Date().toISOString() }).eq("id", mine.id).eq(
      "sender",
      id,
    );
    return json({ deleted: mine.id });
  }
  // The receiver removes their copy only after delivery (§6). Before its time the answer is 403 sealed with deliver_at,
  // never a silent 200 that changes nothing (A-Q16); a bridge that is not theirs is 404.
  const { data: theirs } = await ctx.service.from("bridges").select("id,deliver_at").eq("id", ctx.params.id)
    .eq("receiver", id).maybeSingle();
  if (!theirs) throw new ApiError("not_found", "", { where: "bridge" });
  if (new Date(String(theirs.deliver_at)).getTime() > Date.now()) {
    throw new ApiError("sealed", "It opens at its time.", {
      deliver_at: new Date(String(theirs.deliver_at)).toISOString(),
    });
  }
  const { error } = await db.rpc("receiver_delete_bridge", { p_id: ctx.params.id });
  if (error) dbError(error, "receiver_delete_bridge");
  return json({ deleted: ctx.params.id });
});

// ------------------------------------------------------------------ after opening: Let's talk

route("POST", "/bridges/:id/letstalk", async (ctx) => {
  const { db, id } = me(ctx);
  const b = await ctx.body();
  // The receiver's view of this bridge, through the function: it must be opened.
  const { data: senderRow } = await db.from("bridges").select("sender").eq("id", ctx.params.id).maybeSingle(); // RLS: only when I am the sender → then I am not the receiver
  if (senderRow) throw new ApiError("forbidden", "", { reason: "sender" });
  const { data: all } = await db.from("plans").select("bridge_id,status").eq("bridge_id", ctx.params.id).eq(
    "status",
    "planned",
  );
  if (all?.length) throw new ApiError("conflict", "", { where: "plan" });
  // Find the sender through my received views (any linked person).
  const links = await myLinks(db, id);
  let view: Row | null = null;
  for (const l of links) {
    const v = (await receiverViews(db, otherOf(l, id))).find((x) => String(x.id) === ctx.params.id);
    if (v) {
      view = v;
      break;
    }
  }
  if (!view) throw new ApiError("not_found", "", { where: "bridge" });
  if (!view.opened_at) throw new ApiError("forbidden", "", { reason: "not_opened" });
  const soon = b.when === "soon" || b.when === undefined;
  const at = soon ? null : deliverAt(b.when);
  const { data, error } = await db.from("plans").insert({
    bridge_id: ctx.params.id,
    proposer: id,
    other: view.from,
    soon,
    at,
  }).select("*").single();
  if (error) dbError(error, "plans.insert");
  return json({ plan: planObject(data) });
});

route("PATCH", "/plans/:id", async (ctx) => {
  const { db, id } = me(ctx);
  const { data: cur, error } = await db.from("plans").select("*").eq("id", ctx.params.id).maybeSingle();
  if (error) dbError(error, "plans");
  if (!cur) throw new ApiError("not_found", "", { where: "plan" });
  if (cur.status !== "planned") throw new ApiError("conflict", "", { status: cur.status });
  const b = await ctx.body();
  const patch: Row = {};
  let event: Row | null = null;
  if (b.cancel === true) patch.status = "cancelled";
  else if (b.talked === true) {
    patch.status = "talked";
    patch.talked_at = new Date().toISOString();
  } else if (b.when !== undefined) {
    patch.soon = b.when === "soon";
    patch.at = b.when === "soon" ? null : deliverAt(b.when);
  } else throw new ApiError("invalid", "", { field: "body" });
  const { data, error: e2 } = await db.from("plans").update(patch).eq("id", cur.id).select("*").single();
  if (e2) dbError(e2, "plans.update");
  if (patch.status === "talked") {
    const other = cur.proposer === id ? cur.other : cur.proposer;
    const { data: ev } = await db.from("thread_events").insert({
      person_a: id,
      person_b: other,
      type: "talked",
      bridge_id: cur.bridge_id,
      plan_id: cur.id,
    }).select("*").single();
    event = ev ?? null;
  }
  return json({ plan: planObject(data), event: event ? eventObject(event) : null });
});

// ------------------------------------------------------------------ link settings and profile actions

function muteUntil(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v === "always") return "infinity";
  const hours = v === "8h" ? 8 : v === "1w" ? 24 * 7 : v === "24h" ? 24 : null;
  if (hours === null) throw new ApiError("invalid", "", { field: "mute" });
  return new Date(Date.now() + hours * 3600e3).toISOString();
}

async function linkReply(db: SupabaseClient, mine: string, other: string) {
  const link = await linkWith(db, mine, other);
  const p = await prefs(db, mine, other);
  const persons = await people(db, [other]);
  return {
    person: persons.get(other) ?? null,
    relationship: p.relationship ?? null,
    muted_until: p.muted_until ?? null,
    archived: p.archived ?? false,
    pinned: p.pinned ?? false,
    share: shareOf(p),
    read_receipts: p.read_receipts ?? true,
    status: link?.status ?? "removed",
  };
}

route("PATCH", "/links/:person", async (ctx) => {
  const { db, id } = me(ctx);
  const other = ctx.params.person;
  if (!(await linkWith(db, id, other))) throw new ApiError("not_found", "", { where: "link" });
  const b = await ctx.body();
  const patch: Row = { owner: id, other, updated_at: new Date().toISOString() };
  if (b.relationship !== undefined) {
    if (b.relationship !== null && !(RELATIONSHIPS as readonly unknown[]).includes(b.relationship)) {
      throw new ApiError("invalid", "", { field: "relationship" });
    }
    patch.relationship = b.relationship;
  }
  if (b.mute !== undefined) patch.muted_until = muteUntil(b.mute);
  if (typeof b.archived === "boolean") patch.archived = b.archived;
  if (typeof b.pinned === "boolean") patch.pinned = b.pinned;
  if (typeof b.read_receipts === "boolean") patch.read_receipts = b.read_receipts;
  if (b.share && typeof b.share === "object") {
    const s = b.share as Row;
    if (typeof s.on === "boolean") patch.share_on = s.on;
    if (Array.isArray(s.areas)) {
      const areas = s.areas.filter((a): a is Area => (AREAS as readonly unknown[]).includes(a));
      patch.share_areas = areas;
    }
    if (typeof s.quotes === "boolean") patch.share_quotes = s.quotes;
  }
  if (Object.keys(patch).length === 3) throw new ApiError("invalid", "", { field: "body" });
  const { error } = await db.from("link_prefs").upsert(patch, { onConflict: "owner,other" });
  if (error) dbError(error, "link_prefs.upsert");
  return json({ link: await linkReply(db, id, other) });
});

async function setLinkStatus(db: SupabaseClient, link: Row, patch: Row) {
  const { error } = await db.from("links").update({ ...patch, updated_at: new Date().toISOString() }).eq(
    "id",
    link.id,
  );
  if (error) dbError(error, "links.update");
}

// QA-B402 / QA-B413: when a pair ends (remove, block), every bridge between them still scheduled and not opened is withdrawn, both ways,
// silently (the service client: the receiver has no bridges policy). Delivered and opened rows stay as they were. Returns the count.
async function withdrawBetween(service: SupabaseClient, a: string, b: string): Promise<number> {
  const now = new Date().toISOString();
  let dropped = 0;
  for (const [from, to] of [[a, b], [b, a]]) {
    const { data } = await service.from("bridges").update({ status: "withdrawn", withdrawn_at: now })
      .eq("sender", from).eq("receiver", to).eq("status", "scheduled").is("opened_at", null).select("id");
    dropped += (data ?? []).length;
  }
  return dropped;
}

route("POST", "/links/:person/remove", async (ctx) => {
  const { db, id } = me(ctx);
  const link = await requireActiveLink(db, id, ctx.params.person);
  await setLinkStatus(db, link, { status: "removed" });
  // QA-B403 (CEO GAP-1, COO 03:20Z 17 Nov): the removed person is not told who removed them or when. The event is the remover's own,
  // written invisible to the other side, as a block's is; the other side sees only that the link is no longer active.
  await db.from("thread_events").insert({
    person_a: id,
    person_b: ctx.params.person,
    type: "removed",
    visible_to_b: false,
  });
  // QA-B402: a removed pair delivers nothing more, in either direction (see withdrawBetween).
  const dropped = await withdrawBetween(ctx.service, id, ctx.params.person);
  return json({ status: "removed", dropped });
});

route("POST", "/links/:person/block", async (ctx) => {
  const { db, id } = me(ctx);
  const other = ctx.params.person;
  const link = await linkWith(db, id, other);
  if (!link) throw new ApiError("not_found", "", { where: "link" });
  await setLinkStatus(db, link, { status: "blocked", blocked_by: id });
  await db.from("blocks").upsert({ owner: id, blocked: other }, {
    onConflict: "owner,blocked",
    ignoreDuplicates: true,
  });
  await db.from("thread_events").insert({
    person_a: id,
    person_b: other,
    type: "blocked",
    visible_to_b: false,
  });
  // QA-B413 (P0): nothing either way after a block. Their scheduled bridges to me AND mine to them are withdrawn, silently (they are not told);
  // before this, only theirs were, so my own sealed message still came due and the blocked person could open it.
  const dropped = await withdrawBetween(ctx.service, id, other);
  return json({ status: "blocked", dropped });
});

route("POST", "/links/:person/unblock", async (ctx) => {
  const { db, id } = me(ctx);
  const link = await linkWith(db, id, ctx.params.person);
  if (!link) throw new ApiError("not_found", "", { where: "link" });
  if (link.status === "blocked" && link.blocked_by !== id) {
    throw new ApiError("forbidden", "", { reason: "blocked" });
  }
  await setLinkStatus(db, link, { status: "active", blocked_by: null });
  await db.from("blocks").delete().eq("owner", id).eq("blocked", ctx.params.person);
  return json({ status: "active" });
});

route("POST", "/links/:person/report", async (ctx) => {
  const { db, id } = me(ctx);
  // QA-B416: reports come from a linked person's profile. Validate before the
  // insert so a missing profile/link is a neutral 404, never a database 500.
  if (!(await linkWith(db, id, ctx.params.person))) {
    throw new ApiError("not_found", "", { where: "link" });
  }
  const b = await ctx.body();
  const { data, error } = await db.from("reports").insert({
    reporter: id,
    reported: ctx.params.person,
    bridge_ids: Array.isArray(b.bridge_ids) ? b.bridge_ids.filter((x) => typeof x === "string") : [],
    reason: typeof b.reason === "string" ? b.reason.slice(0, 2000) : null,
  }).select("id").single();
  if (error) dbError(error, "reports.insert");
  return json({ report_id: data.id });
});

// ------------------------------------------------------------------ a linked person's shared map (the pair-context door)

route("GET", "/people/:person/map", async (ctx) => {
  const { db, id } = me(ctx);
  const other = ctx.params.person;
  await requireActiveLink(db, id, other);
  const pair = await loadPairContext(db, id, other, ctx.service);
  const shared = pair.receiver?.items ?? [];
  const areaShare = pair.receiver?.areaShare;
  if (!shared.length && !areaShare?.rows.length) {
    throw new ApiError("forbidden", "", { reason: "not_shared" });
  }
  const persons = await people(db, [other]);
  if (areaShare && !shared.length) {
    const weights: Record<Area, number> = Object.fromEntries(AREAS.map((a) => [a, 0])) as Record<
      Area,
      number
    >;
    for (const belief of areaShare.rows) {
      const area = belief.area as Area;
      weights[area] = Math.round(((weights[area] ?? 0) + SIZE_FOR_KIND[belief.kind as Kind]) * 10) / 10;
    }
    const beliefs = await beliefsFor(db, areaShare.rows, []);
    if (!areaShare.quotes) { for (const belief of beliefs) belief.receipts = []; }
    return json({
      person: persons.get(other) ?? null,
      areas: areaShare.areas as Area[],
      beliefs,
      links: [],
      area_weights: weights,
      quotes: areaShare.quotes,
    });
  }
  const areas: Area[] = [];
  const weights: Record<Area, number> = Object.fromEntries(AREAS.map((a) => [a, 0])) as Record<Area, number>;
  const beliefs = shared.map((x) => ({
    id: x.id,
    label: x.words,
    statement: x.words,
    area: null,
    status: "confirmed",
    receipts: [] as unknown[],
    shared_item: true,
  }));
  return json({
    person: persons.get(other) ?? null,
    areas,
    beliefs,
    links: [],
    area_weights: weights,
    quotes: false,
    items: true,
  });
});
