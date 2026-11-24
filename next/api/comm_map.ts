// V3 You map and card-maker reads. Communication items stay out of the older
// topic/subway map: this is the owner-only, kind-line view for the V3 shell.
// There is no engine layout, score, link, direction, total, or card record.
import { type Ctx, route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";
import { COMM_KIND_COPY, COMM_KIND_ORDER, type CommKind, isExpired } from "../engine/comm.ts";
import { requireCommAccess } from "./comm_items.ts";
import { loadPairContext } from "./pair_context.ts";

const COLUMNS =
  "id,owner,statement,own_wording,status,created_at,confirmed_at,comm_kind,comm_scope_type,comm_scope_value,comm_when,comm_expires_at,comm_status,comm_topic,comm_hidden_from_map,comm_show_separately";
const CARD_EXCLUDED_KINDS = new Set<CommKind>(["lands_hard", "gets_heated", "coming_back", "this_week"]);
const CARD_EXCLUDED_TOPICS = new Set(["politics", "faith", "body"]);

function station(row: Row) {
  return {
    id: String(row.id),
    wording: String(row.own_wording ?? row.statement ?? ""),
    scope: { type: row.comm_scope_type ?? null, value: row.comm_scope_value ?? null },
    when: row.comm_when ?? null,
    hidden: row.comm_hidden_from_map === true,
    show_separately: row.comm_show_separately === true,
  };
}

function scopeOrder(row: Row): [number, string] {
  const type = String(row.comm_scope_type ?? "");
  return [type === "everyone" ? 0 : type === "type" ? 1 : 2, String(row.comm_scope_value ?? "")];
}

async function items(ctx: Ctx): Promise<Row[]> {
  const { data, error } = await ctx.caller!.db.from("beliefs").select(COLUMNS).eq("owner", ctx.caller!.id)
    .eq("status", "confirmed").not("comm_kind", "is", null).order("created_at");
  if (error) dbError(error, "beliefs.comm_map");
  const now = new Date();
  // Set-aside items are confirmed history, but the person has removed them from
  // the active map. Hidden items remain here for the equal List view.
  return ((data ?? []) as Row[]).filter((row) =>
    row.comm_status !== "set_aside" && !isExpired({ expiresAt: row.comm_expires_at as string | null }, now)
  );
}

async function item(ctx: Ctx, id: string): Promise<Row> {
  const { data, error } = await ctx.caller!.db.from("beliefs").select(COLUMNS).eq("owner", ctx.caller!.id).eq(
    "id",
    id,
  )
    .eq("status", "confirmed").not("comm_kind", "is", null).maybeSingle();
  if (error) dbError(error, "beliefs.comm_map_item");
  const row = data as Row | null;
  if (!row) throw new ApiError("not_found", "", { where: "comm_item" });
  return row;
}

/** The V3 Map and List have the same stations. Lines are kinds; scope is the
 * only deterministic left-to-right ordering, chosen by the person on the item. */
route("GET", "/comm/map", async (ctx) => {
  requireCommAccess(ctx);
  const rows = await items(ctx);
  const line = (kind: CommKind) =>
    rows.filter((row) => row.comm_kind === kind).sort((a, b) => {
      const [ar, av] = scopeOrder(a), [br, bv] = scopeOrder(b);
      return ar - br || av.localeCompare(bv) || String(a.id).localeCompare(String(b.id));
    }).map(station);
  const lines = [...COMM_KIND_ORDER, "this_week" as CommKind].map((kind) => ({
    kind,
    heading: COMM_KIND_COPY[kind].heading,
    stations: line(kind),
  })).filter((line) => line.stations.length);
  // List is deliberately the same station data, only without spatial grouping.
  return json({ lines, list: lines.flatMap((line) => line.stations) });
});

/** Hide is map-only; List retains the item. Show separately is a person-owned
 * display choice for a kind line, not an inferred relationship or a share. */
route("PATCH", "/comm/items/:id/map", async (ctx) => {
  requireCommAccess(ctx);
  const body = await ctx.body();
  if (body.hidden === undefined && body.show_separately === undefined) {
    throw new ApiError("invalid", "", { field: "body" });
  }
  if (body.hidden !== undefined && typeof body.hidden !== "boolean") {
    throw new ApiError("invalid", "", { field: "hidden" });
  }
  if (body.show_separately !== undefined && typeof body.show_separately !== "boolean") {
    throw new ApiError("invalid", "", { field: "show_separately" });
  }
  const current = await item(ctx, ctx.params.id);
  const patch: Row = {};
  if (body.hidden !== undefined) patch.comm_hidden_from_map = body.hidden;
  if (body.show_separately !== undefined) patch.comm_show_separately = body.show_separately;
  const { error } = await ctx.caller!.db.from("beliefs").update(patch).eq("owner", ctx.caller!.id).eq(
    "id",
    current.id,
  );
  if (error) dbError(error, "beliefs.comm_map_display");
  return json({ station: station({ ...current, ...patch }) });
});

/** The owner's live answer to "Who sees what?". Every linked person's result
 * comes from the same pair-context reader used by receiving surfaces, so a
 * grant never bypasses status, expiry, scope, or link checks. */
route("GET", "/comm/items/:id/visibility", async (ctx) => {
  requireCommAccess(ctx);
  const current = await item(ctx, ctx.params.id);
  const owner = ctx.caller!.id;
  const [asA, asB] = await Promise.all([
    ctx.caller!.db.from("links").select("person_a,person_b,status").eq("status", "active").eq(
      "person_a",
      owner,
    ),
    ctx.caller!.db.from("links").select("person_a,person_b,status").eq("status", "active").eq(
      "person_b",
      owner,
    ),
  ]);
  if (asA.error) dbError(asA.error, "links.comm_visibility_a");
  if (asB.error) dbError(asB.error, "links.comm_visibility_b");
  const links = [...((asA.data ?? []) as Row[]), ...((asB.data ?? []) as Row[])];
  const people = await Promise.all(links.map(async (link) => {
    const personId = String(link.person_a) === owner ? String(link.person_b) : String(link.person_a);
    const pair = await loadPairContext(ctx.service, personId, owner, ctx.service);
    return {
      person_id: personId,
      name: pair.sender.name,
      sees: pair.receiver?.items.some((x) => x.id === String(current.id)) ?? false,
    };
  }));
  return json({
    item_id: current.id,
    scope: { type: current.comm_scope_type, value: current.comm_scope_value ?? null },
    people,
  });
});

/** Card-maker candidates are an owner read only. The phone chooses at most
 * three and renders/shares locally; neither selection nor output is persisted. */
route("GET", "/comm/card-items", async (ctx) => {
  requireCommAccess(ctx);
  const eligible = (await items(ctx)).filter((row) => {
    const kind = row.comm_kind as CommKind;
    return !CARD_EXCLUDED_KINDS.has(kind) && !CARD_EXCLUDED_TOPICS.has(String(row.comm_topic ?? ""));
  }).map((row) => ({
    id: String(row.id),
    wording: String(row.own_wording ?? row.statement ?? ""),
    kind: row.comm_kind,
    topic: row.comm_topic ?? null,
  }));
  return json({ items: eligible, max_selected: 3, persisted: false });
});
