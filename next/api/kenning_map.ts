// V3 kenning map (spec "Kenember map and share cards", sections 2-3; migration 0060, staging only).
//   GET    /kennings/map[?seen_by=<person>]   stations + deterministic layout + confirmed links + set-aside list
//   PATCH  /kennings/:id/map                  { lines?, central?, hidden?, central_asked?, seen? }  person-set fields only
//   (GET also carries ask_comes_from: [{a,b}], heard-'because' pairs not yet drawn or declined; PATCH takes comes_from_declined: <other id>)
//   PUT    /kennings/order                    { line, ids: [belief ids in the person's order] }
//   PUT    /kennings/links                    { a, b, kind: both_true|comes_from, note? }  two kinds only, both person-confirmed
//   DELETE /kennings/links/:id
//   POST   /kennings/route-card               { belief_ids } a fresh mini-layout from only the chosen kennings
// Only confirmed kennings are ever drawn; no suggestion, no size, direction or conflict from the engine (advisor principle).
import { route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError, type Caller } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { RESOURCES } from "../engine/safety.ts";
import { AREAS } from "./lib/map.ts";
import { LINE_ORDER, layoutKennings, type Station } from "./lib/kenning_layout.ts";
import { offerable } from "./share_items.ts";
import { OWN_LABEL } from "./map.ts";
import { groupIds, keywordCandidates, memberships, readStoredSaid, saidToStore, stationKeyword, wordsKey, type ReceiptIn } from "./lib/kenning_v2.ts";
import { myLinks, otherOf } from "./bridge.ts";
import { isHarshSelfStatement } from "./lib/harsh_self.ts";

const TOPICS = [...AREAS, "me"] as readonly string[];
const COLS = "id,label,area,kind,level,statement,own_wording,status,rating,created_at,confirmed_at,map_lines,map_order,central,central_asked,hidden_from_map,prior_wording,changed_at,map_seen_at,domains,map_keyword,map_said,keyword_override,fold_opt_out,line_exclusions";
const COL_LIST = COLS.split(",");
const WEEK = 7 * 864e5;

const linesOf = (b: Row): string[] => Array.isArray(b.map_lines) && b.map_lines.length ? (b.map_lines as string[]) : [String(b.area)];
const wordsOf = (b: Row) => String(b.own_wording ?? b.statement);
const station = (b: Row): Station => ({
  id: String(b.id), lines: linesOf(b), order: (b.map_order ?? {}) as Record<string, number>, level: (b.level as string | null) ?? null,
  created_at: String(b.confirmed_at ?? b.created_at),
});
const monthName = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

async function load(db: Caller["db"], owner: string) {
  // `*`, not COLS: the V3 comm_kind column exists only once migration 0069 is applied, and the map must keep working before and after it.
  const { data, error } = await db.from("beliefs").select("*").eq("owner", owner).in("status", ["confirmed", "set_aside"]).order("created_at");
  if (error) dbError(error, "beliefs.kenning_map");
  // V3 4.4 / CPO READ-1 (b): an item created as a communication item has no topic line and no honest place, so it is not on the Map (laws 1 and 3); it shows in the
  // List and on You. An old kenning that carry-over gave a kind stays (marker comm_native, migration 0075).
  return ((data ?? []) as Row[]).filter((b) => !b.comm_native).map((b) => Object.fromEntries(COL_LIST.map((c) => [c, b[c]])) as Row);
}

route("GET", "/kennings/map", async (ctx) => {
  const db = ctx.caller!.db, id = ctx.caller!.id, now = Date.now();
  const rows = await load(db, id);
  const mine = rows.filter(offerable);
  const onMap = mine.filter((b) => b.hidden_from_map !== true);
  const setAside = rows.filter((b) => b.status === "set_aside" && b.rating !== "not").map((b) => ({ belief_id: b.id, wording: wordsOf(b) }));
  const ids = mine.map((b) => String(b.id));
  const [rc, lk, bc, bl] = await Promise.all([
    ids.length ? db.from("receipts").select("id,belief_id,said_at,quote").eq("owner", id).in("belief_id", ids) : Promise.resolve({ data: [], error: null }),
    db.from("kenning_links").select("id,a_belief,b_belief,kind,note,created_at").eq("owner", id),
    db.from("kenning_because").select("a_belief,b_belief,declined").eq("owner", id),
    ids.length ? db.from("belief_links").select("from_belief,to_belief,kind").eq("owner", id).eq("kind", "rests_on").in("from_belief", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (bl.error) dbError(bl.error, "belief_links.kenning_map");
  if (rc.error) dbError(rc.error, "receipts.kenning_map");
  if (lk.error) dbError(lk.error, "kenning_links.select");
  if (bc.error) dbError(bc.error, "kenning_because.select");
  const said = new Map<string, string[]>();
  const quotes = new Map<string, ReceiptIn[]>();
  for (const r of (rc.data ?? []) as Row[]) {
    const m = said.get(String(r.belief_id)) ?? []; m.push(String(r.said_at)); said.set(String(r.belief_id), m);
    const q = quotes.get(String(r.belief_id)) ?? []; q.push({ id: String(r.id), quote: String(r.quote ?? ""), said_at: String(r.said_at ?? "") });
    quotes.set(String(r.belief_id), q);
  }
  // v2 (d-all-kenning-map-v2-14nov): keyword, memberships with receipt ids, fold group. Receipts sorted by id so the same rows give the same ids.
  for (const q of quotes.values()) q.sort((a, b) => a.id.localeCompare(b.id));
  const saidWrites: [string, unknown][] = [];
  const v2 = new Map(mine.map((b) => {
    const personLines = Array.isArray(b.map_lines) && b.map_lines.length ? (b.map_lines as string[]) : null;
    const rs = quotes.get(String(b.id)) ?? [];
    // PSY 6(d): a harsh statement about the self never gets a second line from the engine.
    const harsh = isHarshSelfStatement(`${wordsOf(b)} ${String(b.statement ?? "")} ${String(b.label ?? "")}`);
    // PSY 15 Nov point 4: the second line chosen earlier is kept (beliefs.map_said, migration 0065) until its receipts go, the wording
    // is edited or the person picks the lines; a change is written back below so the next GET keeps it.
    const key = wordsKey(wordsOf(b)), stored = readStoredSaid(b.map_said);
    const ms = memberships({ area: String(b.area), domains: (b.domains ?? []) as string[], personLines, receipts: rs, harsh, stored, wordsKey: key }, LINE_ORDER);
    const next = personLines ? stored : saidToStore(ms, key);
    if (JSON.stringify(next) !== JSON.stringify(stored)) saidWrites.push([String(b.id), next]);
    // CPO keyword rules (KM2-W4), checked here for every station, so a word stored under older rules is never shown. A kenning the
    // person wrote carries the fixed label "In my words": its fallback comes from its wording, never from that label.
    const override = b.keyword_override === "none" ? null : b.keyword_override;
    const kw = stationKeyword({ stored: override ?? b.map_keyword, label: String(b.label ?? ""), wording: wordsOf(b), ownPen: String(b.label ?? "") === OWN_LABEL,
      lines: ms.map((m) => m.line), texts: rs.map((r) => r.quote) });
    // KM2-C3: other words from the person's own sentence and receipts, for the phone's word menu; only the owner's read carries them.
    const candidates = ctx.url.searchParams.get("seen_by") ? [] : keywordCandidates([wordsOf(b), ...rs.map((r) => r.quote)], kw.keyword, { lines: ms.map((m) => m.line) });
    return [String(b.id), { keyword: kw.keyword, keyword_source: b.keyword_override ? "owner" : kw.source, keyword_candidates: candidates, memberships: ms, kind: String(b.kind ?? "everyday") }];
  }));
  // Best effort: a failed write leaves the stored line as it was (the next GET tries again); the map itself still answers.
  if (saidWrites.length) {
    const res = await Promise.all(saidWrites.map(([bid, v]) => db.from("beliefs").update({ map_said: v }).eq("owner", id).eq("id", bid)));
    const bad = res.filter((r) => r.error).length;
    if (bad) console.log(JSON.stringify({ at: "kenning_map.map_said", failed: bad, of: saidWrites.length }));
  }
  const onMapIds = new Set(onMap.map((b) => String(b.id)));
  const restsOn = ((bl.data ?? []) as Row[]).filter((l) => onMapIds.has(String(l.from_belief)) && onMapIds.has(String(l.to_belief)))
    .map((l) => [String(l.from_belief), String(l.to_belief)] as [string, string]);
  const groups = groupIds(onMap.map((b) => { const v = v2.get(String(b.id))!; return { id: String(b.id), keyword: v.keyword, home: v.memberships[0].line, kind: v.kind }; }), restsOn);
  // "Seen by <person>": that person's grants at full strength, the rest at 22% with labels hidden; same layout.
  const seenBy = ctx.url.searchParams.get("seen_by");
  let granted: Set<string> | null = null;
  if (seenBy) {
    const active = (await myLinks(db, id)).some((l) => l.status === "active" && otherOf(l, id) === seenBy);
    if (!active) throw new ApiError("not_found", "", { where: "link" });
    const { data, error } = await db.from("share_items").select("belief_id").eq("owner", id).eq("other", seenBy);
    if (error) dbError(error, "share_items.kenning_map");
    granted = new Set(((data ?? []) as Row[]).map((g) => String(g.belief_id)));
  }
  const layout = layoutKennings(onMap.map(station));
  const shown = new Set(onMap.map((b) => String(b.id)));
  // v1.80 (Q-APP-B358-1): a kept-off kenning comes back as a station with hidden: true so the List can show it and turn it back on. It
  // is never laid out, grouped, linked or counted in `lines`; a Seen-by view never shows it (the person's own choice stays theirs).
  const hiddenRows = seenBy ? [] : mine.filter((b) => b.hidden_from_map === true);
  const stations = [...onMap, ...hiddenRows].map((b) => {
    const hidden = b.hidden_from_map === true;
    const dates = (said.get(String(b.id)) ?? []).sort();
    const full = granted ? granted.has(String(b.id)) : true;
    return {
      belief_id: b.id, words: wordsOf(b), strength: b.rating === "very" ? "that's me" : "partly", lines: linesOf(b), central: !hidden && b.central === true,
      said_in: [...new Set(dates.map(monthName))], said_dates: dates,
      changed: !!b.changed_at, earlier_wording: b.changed_at ? (b.prior_wording ?? null) : null,
      new: !hidden && !b.map_seen_at && now - Date.parse(String(b.confirmed_at ?? b.created_at)) < WEEK,
      // The engine's Core level may trigger one question per kenning, once. It never sets `central`.
      ask_central: !hidden && b.level === "L0" && b.central !== true && b.central_asked !== true,
      emphasis: full ? 1 : 0.22, show_label: full,
      keyword: v2.get(String(b.id))!.keyword, keyword_source: v2.get(String(b.id))!.keyword_source,
      keyword_candidates: v2.get(String(b.id))!.keyword_candidates,
      memberships: v2.get(String(b.id))!.memberships, group_id: groups.get(String(b.id)) ?? `k:${v2.get(String(b.id))!.memberships[0].line}:${v2.get(String(b.id))!.kind}`,
      hidden,
      keyword_override: b.keyword_override ?? null,
      fold_opt_out: b.fold_opt_out === true,
      line_exclusions: Array.isArray(b.line_exclusions) ? b.line_exclusions : [],
      shares: [], // owner-only audience names are added by the live sharing reader; never sent to a seen-by projection
    };
  });
  const links = ((lk.data ?? []) as Row[]).filter((l) => shown.has(String(l.a_belief)) && shown.has(String(l.b_belief))
    && (!granted || (granted.has(String(l.a_belief)) && granted.has(String(l.b_belief)))))
    .map((l) => ({ link_id: l.id, a: l.a_belief, b: l.b_belief, kind: l.kind, note: l.note ?? null }));
  // One ask per heard pair ("for me, a comes from b"): both ends on the map, not declined, not already drawn as comes_from. Never in a Seen-by view.
  const drawn = new Set(links.filter((l) => l.kind === "comes_from").map((l) => `${l.a}|${l.b}`));
  const askComesFrom = granted ? [] : ((bc.data ?? []) as Row[])
    .filter((p) => p.declined !== true && shown.has(String(p.a_belief)) && shown.has(String(p.b_belief)) && !drawn.has(`${p.a_belief}|${p.b_belief}`))
    .map((p) => ({ a: p.a_belief, b: p.b_belief }));
  // v2 lines: every topic a station belongs to, in the fixed line order (the phone lays them out).
  const used = new Set(stations.filter((s) => !s.hidden).flatMap((s) => s.memberships.map((m) => m.line)));
  const v2Lines = [...LINE_ORDER.filter((l) => used.has(l)), ...[...used].filter((l) => !(LINE_ORDER as readonly string[]).includes(l)).sort()];
  // v1.77 (law 2, CPO KM2-W1): the station sheet shows the person's exact words and the month per receipt. Only receipts some
  // membership cites, from the person's own receipts table (their words only; Mirror input never sits there). In a Seen-by view,
  // only the stations shown at full strength. v1.82: a kept-off station's receipts ride along on the owner's own read only, never on a seen_by read.
  const cited = new Set(stations.filter((s) => s.show_label && !(s.hidden && seenBy)).flatMap((s) => s.memberships.flatMap((m) => m.receipt_ids)));
  const receipts = ((rc.data ?? []) as Row[]).filter((r) => cited.has(String(r.id)))
    .map((r) => ({ id: String(r.id), quote: String(r.quote ?? ""), said_at: new Date(String(r.said_at)).toISOString() }))
    .sort((a, b) => a.said_at.localeCompare(b.said_at) || a.id.localeCompare(b.id));
  return json({ layout, stations, links, ask_comes_from: askComesFrom, set_aside: setAside, seen_by: seenBy ?? null, map_version: 2, lines: v2Lines, receipts });
});

route("PATCH", "/kennings/:id/map", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id, b = await ctx.body();
  const { data: cur, error } = await db.from("beliefs").select("id,status,rating,statement").eq("owner", owner).eq("id", ctx.params.id).maybeSingle();
  if (error) dbError(error, "beliefs.kenning_map_patch");
  if (!cur) throw new ApiError("not_found", "", { where: "belief" });
  if (!offerable(cur as Row)) throw new ApiError("forbidden", "", { reason: "not_confirmed" });
  const patch: Row = {};
  // 'Not now' on a heard-because ask: { comes_from_declined: "<other belief id>" } stores it for the pair (this comes from that); it never asks again.
  if (b.comes_from_declined !== undefined) {
    const other = b.comes_from_declined;
    if (typeof other !== "string" || other === ctx.params.id) throw new ApiError("invalid", "", { field: "comes_from_declined" });
    const { data: pair, error: pe } = await db.from("kenning_because").select("id").eq("owner", owner).eq("a_belief", ctx.params.id).eq("b_belief", other).maybeSingle();
    if (pe) dbError(pe, "kenning_because.select");
    if (!pair) throw new ApiError("not_found", "", { where: "ask" });
    const { error: pu } = await db.from("kenning_because").update({ declined: true }).eq("owner", owner).eq("a_belief", ctx.params.id).eq("b_belief", other);
    if (pu) dbError(pu, "kenning_because.update");
    if (Object.keys(b).length === 1) return json({ belief_id: ctx.params.id, comes_from_declined: other });
  }
  if (b.lines !== undefined) {
    const ls = b.lines;
    if (!Array.isArray(ls) || ls.length < 1 || ls.length > 2 || new Set(ls).size !== ls.length || !ls.every((l) => typeof l === "string" && TOPICS.includes(l))) {
      throw new ApiError("invalid", "", { field: "lines" });
    }
    patch.map_lines = ls; patch.map_order = {};   // a new line has no stored position yet
    patch.map_said = null;                        // the person's own lines replace the engine's second line (PSY 15 Nov point 4)
  }
  for (const [k, col] of [["central", "central"], ["hidden", "hidden_from_map"], ["central_asked", "central_asked"]] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== "boolean") throw new ApiError("invalid", "", { field: k });
    patch[col] = b[k];
  }
  if (b.central === true) patch.central_asked = true;
  if (b.seen === true) patch.map_seen_at = new Date().toISOString();
  if (b.keyword_override !== undefined) {
    if (b.keyword_override !== null && b.keyword_override !== "none" && (typeof b.keyword_override !== "string" || !/^[A-Za-z][A-Za-z'-]{0,17}$/.test(b.keyword_override))) {
      throw new ApiError("invalid", "", { field: "keyword_override" });
    }
    patch.keyword_override = b.keyword_override;
  }
  if (b.fold_opt_out !== undefined) {
    if (typeof b.fold_opt_out !== "boolean") throw new ApiError("invalid", "", { field: "fold_opt_out" });
    patch.fold_opt_out = b.fold_opt_out;
  }
  if (b.line_exclusions !== undefined) {
    if (!Array.isArray(b.line_exclusions) || !b.line_exclusions.every((x) => typeof x === "string" && TOPICS.includes(x))) {
      throw new ApiError("invalid", "", { field: "line_exclusions" });
    }
    patch.line_exclusions = b.line_exclusions;
  }
  if (!Object.keys(patch).length && b.comes_from_declined === undefined) throw new ApiError("invalid", "", { field: "body" });
  const { error: e2 } = Object.keys(patch).length ? await db.from("beliefs").update(patch).eq("owner", owner).eq("id", ctx.params.id) : { error: null };
  if (e2) dbError(e2, "beliefs.kenning_map_update");
  return json({ belief_id: ctx.params.id, ...("map_lines" in patch ? { lines: patch.map_lines } : {}),
    ...("central" in patch ? { central: patch.central } : {}), ...("hidden_from_map" in patch ? { hidden: patch.hidden_from_map } : {}) });
});

route("PUT", "/kennings/order", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id, b = await ctx.body();
  if (typeof b.line !== "string" || !TOPICS.includes(b.line)) throw new ApiError("invalid", "", { field: "line" });
  const ids = b.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every((i) => typeof i === "string") || new Set(ids).size !== ids.length) {
    throw new ApiError("invalid", "", { field: "ids" });
  }
  const rows = (await load(db, owner)).filter(offerable);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  for (const i of ids as string[]) {
    const r = byId.get(i);
    if (!r || !linesOf(r).includes(b.line)) throw new ApiError("invalid", "", { field: "ids", reason: "not_on_line" });
  }
  // The person's order wins everywhere: write the dragged order as 0..n-1 on this line for exactly these kennings.
  for (const [pos, i] of (ids as string[]).entries()) {
    const r = byId.get(i)!;
    const { error } = await db.from("beliefs").update({ map_order: { ...((r.map_order ?? {}) as object), [b.line]: pos } }).eq("owner", owner).eq("id", i);
    if (error) dbError(error, "beliefs.kenning_order");
  }
  return json({ line: b.line, ids });
});

route("PUT", "/kennings/links", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id, b = await ctx.body();
  if (b.kind !== "both_true" && b.kind !== "comes_from") throw new ApiError("invalid", "", { field: "kind" });
  if (typeof b.a !== "string" || typeof b.b !== "string" || b.a === b.b) throw new ApiError("invalid", "", { field: "a" });
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim() : "";
    if (!note || note.length > 300) throw new ApiError("invalid", "", { field: "note" });
    const held = await requireSafetyPass(ctx, note, "kenning_map");   // K-0002
    if (held.routed === "unavailable") return json(unreadBody({ link: null }));
    if (held.stop) return json({ link: null, state: "safety", resources: RESOURCES });
  }
  const rows = (await load(db, owner)).filter(offerable);
  for (const i of [b.a, b.b]) if (!rows.some((r) => r.id === i)) throw new ApiError("not_found", "", { where: "belief" });
  // both_true is symmetric (stored smaller id first); comes_from reads "for me, a comes from b".
  const [x, y] = b.kind === "both_true" && b.a > b.b ? [b.b, b.a] : [b.a, b.b];
  const { data, error } = await db.from("kenning_links").upsert({ owner, a_belief: x, b_belief: y, kind: b.kind, note },
    { onConflict: "owner,a_belief,b_belief,kind" }).select("id,a_belief,b_belief,kind,note").single();
  if (error) dbError(error, "kenning_links.upsert");
  const l = data as Row;
  return json({ link: { link_id: l.id, a: l.a_belief, b: l.b_belief, kind: l.kind, note: l.note ?? null } });
});

route("DELETE", "/kennings/links/:id", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const { error } = await db.from("kenning_links").delete().eq("owner", owner).eq("id", ctx.params.id);
  if (error) dbError(error, "kenning_links.delete");
  return json({ link_id: ctx.params.id, deleted: true });
});

// Share route card: a fresh layout from only the chosen kennings, keeping their real lines and order. No links, no count, nothing in between.
route("POST", "/kennings/route-card", async (ctx) => {
  const db = ctx.caller!.db, owner = ctx.caller!.id, b = await ctx.body();
  const ids = b.belief_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || !ids.every((i) => typeof i === "string") || new Set(ids).size !== ids.length) {
    throw new ApiError("invalid", "", { field: "belief_ids", max: 3 });
  }
  const rows = (await load(db, owner)).filter(offerable);
  const chosen = (ids as string[]).map((i) => rows.find((r) => r.id === i));
  if (chosen.some((c) => !c)) throw new ApiError("not_found", "", { where: "belief" });
  const picked = chosen as Row[];
  const layout = layoutKennings(picked.map(station));
  return json({ layout, stations: picked.map((r) => ({ belief_id: r.id, words: wordsOf(r), strength: r.rating === "very" ? "that's me" : "partly", lines: linesOf(r) })) });
});

export { LINE_ORDER };
