// The only server-side view of one person in relation to another.  A context is
// deliberately built from the reader's identity first: it is impossible for a
// caller to ask this module for an owner's whole map and filter it later.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Row } from "./lib/objects.ts";
import { dbError } from "./lib/db.ts";
import { type CommKind, commRelationshipType, isExpired } from "../engine/comm.ts";
import { loadMap } from "./lib/state.ts";
import type { PersonMap } from "../engine/types.ts";

export interface PairItem {
  id: string;
  kind: CommKind | null;
  words: string;
  when: string | null;
  scope: { type: string | null; value: string | null };
  strength: number | null;
  confirmedAt: string | null;
}

/**
 * Receiver wording that may inform a softening change, but is deliberately not
 * a general receiver item.  Keeping this as a distinct container makes it a
 * type error to pass it to analysis, reading, or any path that expects the
 * ordinary `PairItem[]` context.
 */
export class SofteningOnly {
  readonly #items: readonly PairItem[];
  constructor(items: readonly PairItem[]) { this.#items = items; }
  forSoftening(): readonly PairItem[] { return this.#items; }
}

/** The only projection intended for a softening rewrite. */
export function softeningItems(value: SofteningOnly): readonly PairItem[] { return value.forSoftening(); }

export interface PairContext {
  sender: { id: string; name: string; itemsByKind: Partial<Record<CommKind, PairItem[]>>; map: PersonMap | null };
  receiver:
    | {
      id: string;
      name: string;
      items: PairItem[];
      thisWeek: PairItem[];
      /** `lands_hard` items; never merge these into `items`. */
      softeningOnly: SofteningOnly;
      areaShare: AreaShare | null;
    }
    | null;
  relationship: string;
  readiness: Record<string, { complete: number; total: number }>;
}

/** Legacy area sharing is restricted to owner/test accounts, but remains part of
 * the one pair view until hosted readers have migrated to item grants. */
export interface AreaShare {
  areas: string[];
  quotes: boolean;
  rows: Row[];
}

const ITEM_COLUMNS =
  "id,owner,label,statement,own_wording,status,rating,confidence,confirmed_at,created_at,comm_kind,comm_scope_type,comm_scope_value,comm_when,comm_expires_at,comm_status";

function firstName(row: Row | null | undefined) {
  return String(row?.name ?? "").trim().split(/\s+/)[0] || "";
}
function activeLinkQuery(db: SupabaseClient, a: string, b: string) {
  return db.from("links").select("status").eq("person_a", a < b ? a : b).eq("person_b", a < b ? b : a)
    .maybeSingle();
}
function item(row: Row, words?: string): PairItem {
  return {
    id: String(row.id),
    kind: typeof row.comm_kind === "string" ? row.comm_kind as CommKind : null,
    words: String(words ?? row.own_wording ?? row.statement ?? "").trim(),
    when: (row.comm_when as string | null) ?? null,
    scope: {
      type: (row.comm_scope_type as string | null) ?? null,
      value: (row.comm_scope_value as string | null) ?? null,
    },
    strength: typeof row.confidence === "number" ? row.confidence : null,
    confirmedAt: (row.confirmed_at as string | null) ?? (row.created_at as string | null) ?? null,
  };
}
function visible(row: Row, reader: string, relationship: string | undefined, now: Date): boolean {
  // Old per-item grants have no communication kind. Their explicit grant is the
  // scope and they retain their prior behaviour; new items must satisfy both.
  if (!row.comm_kind) return row.status === "confirmed" && row.rating !== "not";
  if (
    row.status !== "confirmed" || row.comm_status !== "active" ||
    isExpired({ expiresAt: (row.comm_expires_at as string | null) ?? null }, now)
  ) return false;
  // Rows from before scope columns were populated retain the explicit per-item
  // grant as their scope; new rows always carry one of the three values.
  if (!row.comm_scope_type || row.comm_scope_type === "everyone") return true;
  if (row.comm_scope_type === "person") return row.comm_scope_value === reader;
  return row.comm_scope_type === "type" && !!relationship && row.comm_scope_value === relationship;
}

/**
 * Load the context for `sender` reading `receiver`.  `db` is user-scoped by
 * default.  Pass `service` only for a route that needs to cross RLS; service
 * reads repeat the active-link and exact owner→reader grant checks in code.
 */
export async function loadPairContext(
  db: SupabaseClient,
  senderId: string,
  receiverId?: string,
  service?: SupabaseClient,
  now = new Date(),
  includeSenderMap = false,
): Promise<PairContext> {
  const read = service ?? db;
  const [{ data: senderProfile, error: senderError }, { data: ownRows, error: ownError }, map] = await Promise.all(
    [
      db.from("profiles").select("name,account_kind,is_practice,is_example,is_preview").eq("id", senderId)
        .maybeSingle(),
      db.from("beliefs").select(ITEM_COLUMNS).eq("owner", senderId).eq("status", "confirmed").order(
        "created_at",
      ),
      includeSenderMap ? loadMap(db, senderId) : Promise.resolve(null),
    ],
  );
  if (senderError) dbError(senderError, "profiles.pair_sender");
  if (ownError) dbError(ownError, "beliefs.pair_sender");
  const own = ((ownRows ?? []) as Row[]).filter((r) =>
    !!r.comm_kind && r.comm_status === "active" &&
    !isExpired({ expiresAt: (r.comm_expires_at as string | null) ?? null }, now)
  ).map((r) => item(r));
  const itemsByKind: Partial<Record<CommKind, PairItem[]>> = {};
  for (const row of own) if (row.kind) (itemsByKind[row.kind] ??= []).push(row);
  const sender = {
    id: senderId,
    name: firstName(senderProfile as Row | null),
    itemsByKind,
    map,
  };
  if (!receiverId || receiverId === senderId) {
    return { sender, receiver: null, relationship: "friend", readiness: readiness(itemsByKind) };
  }

  // Service role bypasses RLS, hence the two checks below are not optional.
  const [
    { data: link, error: linkError },
    { data: pref, error: prefError },
    { data: receiverPref, error: receiverPrefError },
    { data: receiverProfile, error: receiverError },
  ] = await Promise.all([
    activeLinkQuery(read, senderId, receiverId),
    read.from("link_prefs").select("relationship").eq("owner", senderId).eq("other", receiverId)
      .maybeSingle(),
    read.from("link_prefs").select("share_on,share_areas,share_quotes").eq("owner", receiverId).eq(
      "other",
      senderId,
    )
      .maybeSingle(),
    read.from("profiles").select("name,account_kind,is_practice,is_example,is_preview").eq("id", receiverId)
      .maybeSingle(),
  ]);
  if (linkError) dbError(linkError, "links.pair");
  if (prefError) dbError(prefError, "link_prefs.pair");
  if (receiverPrefError) dbError(receiverPrefError, "link_prefs.pair_receiver");
  if (receiverError) dbError(receiverError, "profiles.pair_receiver");
  const relationship = commRelationshipType((pref as Row | null)?.relationship as string | null) ?? "friend";
  const emptyReceiver = () => ({
    id: receiverId,
    name: firstName(receiverProfile as Row | null),
    items: [] as PairItem[],
    thisWeek: [] as PairItem[],
    softeningOnly: new SofteningOnly([]),
    areaShare: null as AreaShare | null,
  });
  if ((link as Row | null)?.status !== "active") {
    return { sender, receiver: emptyReceiver(), relationship, readiness: readiness(itemsByKind) };
  }
  const { data: grants, error: grantError } = await read.from("share_items").select("belief_id,wording").eq(
    "owner",
    receiverId,
  ).eq("other", senderId).order("created_at");
  if (grantError) dbError(grantError, "share_items.pair");
  const grantRows = (grants ?? []) as Row[];
  const receiver = emptyReceiver();
  if (!grantRows.length) {
    const receiverProfileRow = receiverProfile as Row | null;
    const senderProfileRow = senderProfile as Row | null;
    const testAccount = (p: Row | null) =>
      p?.account_kind === "test" || p?.is_practice === true || p?.is_example === true ||
      p?.is_preview === true;
    const legacy = receiverPref as Row | null;
    const areas =
      legacy?.share_on === true && (testAccount(senderProfileRow) || testAccount(receiverProfileRow)) &&
        Array.isArray(legacy.share_areas)
        ? legacy.share_areas.filter((a): a is string => typeof a === "string")
        : [];
    if (areas.length) {
      const { data: legacyRows, error: legacyError } = await read.from("beliefs").select("*").eq(
        "owner",
        receiverId,
      ).eq("status", "confirmed").in("area", areas).order("created_at");
      if (legacyError) dbError(legacyError, "beliefs.pair_area_share");
      receiver.areaShare = {
        areas,
        quotes: legacy?.share_quotes === true,
        // The legacy test/practice fallback has the same confirmation boundary
        // as a per-item grant: a person's "Not me" row never reaches anyone.
        rows: ((legacyRows ?? []) as Row[]).filter((row) => row.rating !== "not"),
      };
    }
    return { sender, receiver, relationship, readiness: readiness(itemsByKind) };
  }
  const { data: rows, error: rowsError } = await read.from("beliefs").select(ITEM_COLUMNS).eq(
    "owner",
    receiverId,
  ).in("id", grantRows.map((g) => String(g.belief_id)));
  if (rowsError) dbError(rowsError, "beliefs.pair_receiver");
  const byId = new Map(((rows ?? []) as Row[]).map((r) => [String(r.id), r]));
  // The wording comes only from the exact grant; labels, receipts and private
  // wording are never put in the context.
  const visibleGrantRows = grantRows.flatMap((g) => {
    const row = byId.get(String(g.belief_id));
    return row && visible(row, senderId, relationship, now) &&
        String(g.wording ?? "").trim()
      ? [{ row, granted: item(row, String(g.wording)) }]
      : [];
  });
  // What lands hard may inform a softening rewrite only.  It is intentionally
  // returned in the separate `SofteningOnly` type instead of being silently
  // dropped or becoming available to ordinary receiver-aware paths.
  receiver.items = visibleGrantRows.filter(({ row }) => row.comm_kind !== "lands_hard").map(({ granted }) =>
    granted
  );
  receiver.softeningOnly = new SofteningOnly(
    visibleGrantRows.filter(({ row }) => row.comm_kind === "lands_hard").map(({ granted }) => granted),
  );
  receiver.thisWeek = receiver.items.filter((x) => x.kind === "this_week");
  return { sender, receiver, relationship, readiness: readiness(itemsByKind) };
}

function readiness(items: Partial<Record<CommKind, PairItem[]>>) {
  const have = (k: CommKind) => (items[k]?.length ?? 0) > 0;
  const write = ["how_i_mean", "feels_like_care", "bring_up"] as CommKind[];
  return {
    write: { complete: write.filter(have).length, total: write.length },
    talk: { complete: Object.values(items).flat().length, total: 3 },
  };
}
