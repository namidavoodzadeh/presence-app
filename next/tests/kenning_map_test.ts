// V3 kenning map: deterministic layout, confirmed-only stations, person-set fields, links, route card. Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import { layoutKennings, type Station } from "../api/lib/kenning_layout.ts";
import "../api/kenning_map.ts";

const ME = "00000000-0000-4000-8000-000000000091", JAN = "00000000-0000-4000-8000-000000000092";
type Row = Record<string, unknown>;
const st = (id: string, lines: string[], at = "2026-11-01T00:00:00Z", level: string | null = "L2", order: Record<string, number> = {}): Station => ({ id, lines, order, level, created_at: at });

Deno.test("layout: deterministic, stored order wins, max 5 per line, no count sent as a number", () => {
  const ss = ["a", "b", "c", "d", "e", "f", "g"].map((i, n) => st(i, ["work"], `2026-11-0${n + 1}T00:00:00Z`));
  const l1 = layoutKennings(ss), l2 = layoutKennings([...ss].reverse());
  assertEquals(l1, l2);
  assertEquals(l1.lines[0].station_ids.length, 5);
  assertEquals(l1.lines[0].overflow_ids.length, 2);
  const moved = layoutKennings(ss.map((s) => s.id === "g" ? { ...s, order: { work: 0 } } : s));
  assertEquals(moved.lines[0].station_ids[0], "g", "the person's order always wins");
  assertEquals(l1.axis, { left: "broad", right: "specific" });
});
Deno.test("layout: engine level orders broad to specific; at most six lines, rest under more_lines", () => {
  const l = layoutKennings([st("s", ["work"], "2026-11-01T00:00:00Z", "L3"), st("b", ["work"], "2026-11-02T00:00:00Z", "L0")]);
  assertEquals(l.lines[0].station_ids, ["b", "s"]);
  const many = layoutKennings(["family", "relationships", "work", "money", "meaning", "body", "politics", "me"].map((t, i) => st(`x${i}`, [t])));
  assertEquals(many.lines.length, 6);
  assertEquals(many.more_lines.length, 2);
});
Deno.test("layout: geometry is horizontal or 45 degrees, stations 44+ apart, interchange sits between adjacent lines", () => {
  const l = layoutKennings([st("a", ["work"], "2026-11-05T00:00:00Z"), st("x", ["work", "family"], "2026-11-02T00:00:00Z"), st("y", ["family"], "2026-11-03T00:00:00Z"), st("z", ["work"], "2026-11-06T00:00:00Z")]);
  for (const ln of l.lines) for (let i = 1; i < ln.path.length; i++) {
    const dx = Math.abs(ln.path[i][0] - ln.path[i - 1][0]), dy = Math.abs(ln.path[i][1] - ln.path[i - 1][1]);
    assert(dy === 0 || dx === dy, `segment ${dx},${dy} on ${ln.topic}`);
  }
  for (const ln of l.lines) {
    const xs = ln.station_ids.map((i) => l.stations.find((s) => s.id === i)!.x);
    for (let i = 1; i < xs.length; i++) assert(xs[i] - xs[i - 1] >= 44);
  }
  const x = l.stations.find((s) => s.id === "x")!;
  assert(x.interchange);
  assertEquals(l.lines.filter((ln) => ln.station_ids.includes("x")).length, 2);
});

const t: Record<string, Row[]> = {};
class T implements PromiseLike<{ data: unknown; error: null }> {
  eqs: Array<[string, unknown]> = []; ins: Array<[string, unknown[]]> = []; upd: Row | null = null; del = false; up: Row | null = null; one = false;
  constructor(private n: string) { t[n] ??= []; }
  select() { return this; } order() { return this; } or() { return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in(c: string, v: unknown[]) { this.ins.push([c, v]); return this; }
  update(p: Row) { this.upd = p; return this; } delete() { this.del = true; return this; } upsert(r: Row) { this.up = r; return this; }
  single() { this.one = true; return this; } maybeSingle() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) {
    const m = () => t[this.n].filter((x) => this.eqs.every(([c, v]) => x[c] === v) && this.ins.every(([c, v]) => v.includes(x[c])));
    if (this.up) { const row = { id: `L${t[this.n].length}`, ...this.up }; t[this.n].push(row); return Promise.resolve(r({ data: row, error: null })); }
    if (this.upd) { for (const x of m()) Object.assign(x, this.upd); return Promise.resolve(r({ data: null, error: null })); }
    if (this.del) { t[this.n] = t[this.n].filter((x) => !m().includes(x)); return Promise.resolve(r({ data: null, error: null })); }
    const d = m(); return Promise.resolve(r({ data: this.one ? (d[0] ?? null) : d, error: null }));
  }
}
const b = (id: string, area: string, over: Row = {}): Row => ({ id, owner: ME, label: `L${id}`, statement: `Part of you ${id}`, area, kind: "foundation", level: "L2", status: "confirmed", rating: "very",
  created_at: "2026-11-01T00:00:00Z", confirmed_at: "2026-11-01T00:00:00Z", map_order: {}, ...over });
const reset = () => {
  for (const k of Object.keys(t)) delete t[k];
  t.beliefs = [b("a", "work"), b("c", "work", { rating: "partly", central: true }), b("h", "work", { hidden_from_map: true }), b("g", "family", { status: "guess", rating: null }),
    b("n", "work", { rating: "not", status: "set_aside" }), b("r", "money", { status: "set_aside", rating: "very" }), b("f", "family"), b("L0", "meaning", { level: "L0" })];
  t.receipts = [{ owner: ME, belief_id: "a", said_at: "2026-10-03T00:00:00Z" }, { owner: ME, belief_id: "a", said_at: "2026-11-09T00:00:00Z" }];
  t.share_items = [{ owner: ME, other: JAN, belief_id: "f" }];
  t.links = [{ person_a: ME, person_b: JAN, status: "active", created_at: "2026-10-01T00:00:00Z" }];
  t.profiles = [{ id: JAN, name: "Jan" }]; t.kenning_links = [];
  t.kenning_because = [{ owner: ME, a_belief: "a", b_belief: "f", declined: false }, { owner: ME, a_belief: "c", b_belief: "a", declined: false }, { owner: ME, a_belief: "a", b_belief: "g", declined: false }, { owner: ME, a_belief: "f", b_belief: "c", declined: true }];
};
const call = (method: string, path: string, body: Row = {}) => {
  const url = new URL("https://x.invalid" + path);
  const f = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
  assert(f, `no ${method} ${path}`);
  const m = url.pathname.match(f.pattern)!; const params: Record<string, string> = {}; f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = { from: (n: string) => new T(n) };
  return f.handler({ env: {}, req: new Request(url, { method }), url, params, body: () => Promise.resolve(body), caller: { id: ME, db }, service: db } as never);
};

Deno.test("map: only confirmed kennings are stations; kept-off ones carry hidden: true and are never laid out; retired are set aside; Not me is nowhere", async () => {
  reset();
  const r = await (await call("GET", "/kennings/map")).json();
  assertEquals(r.stations.map((s: Row) => s.belief_id).sort(), ["L0", "a", "c", "f", "h"]);
  assertEquals(r.stations.filter((s: Row) => s.hidden).map((s: Row) => s.belief_id), ["h"]);
  assertEquals(r.stations.at(-1).belief_id, "h");                                       // kept-off ones come last
  assertEquals(Object.keys(r.layout).length ? JSON.stringify(r.layout).includes('"h"') : false, false);   // v1.80: never drawn on the map
  const h = r.stations.find((s: Row) => s.belief_id === "h");
  assertEquals([h.central, h.new, h.ask_central], [false, false, false]);
  assertEquals(r.stations.filter((s: Row) => s.belief_id !== "h").every((s: Row) => s.hidden === false), true);
  assertEquals(r.set_aside, [{ belief_id: "r", wording: "Part of you r" }]);
  const a = r.stations.find((s: Row) => s.belief_id === "a");
  assertEquals(a.said_in, ["October", "November"]);
  assertEquals(a.strength, "that's me");
  assertEquals(r.stations.find((s: Row) => s.belief_id === "c").central, true);
  assertEquals(r.stations.find((s: Row) => s.belief_id === "L0").ask_central, true);
  assertEquals(r.stations.find((s: Row) => s.belief_id === "c").ask_central, false);
});
Deno.test("V3 READ-1: a communication item is never a station, a set-aside line or an ask; old kennings are unchanged", async () => {
  reset();
  const before = await (await call("GET", "/kennings/map")).json();
  t.beliefs.push(
    b("k1", "relationships", { comm_native: true, comm_kind: "how_i_mean", own_wording: "When I go quiet, I'm thinking." }),
    b("k2", "relationships", { comm_native: true, comm_kind: "lands_hard", status: "set_aside", rating: "very" }),
    b("k3", "work", { comm_native: true, comm_kind: "this_week", map_lines: ["work"] }));
  const r = await (await call("GET", "/kennings/map")).json();
  assertEquals(JSON.stringify(r), JSON.stringify(before), "the map response is byte-for-byte what it was without the items");
  assert(!JSON.stringify(r).includes("go quiet"));
});
Deno.test("map v1.80: a kept-off kenning changes nothing about the drawn map, and a Seen-by view never shows it", async () => {
  reset();
  const withHidden = await (await call("GET", "/kennings/map")).json();
  t.beliefs = t.beliefs.filter((x: Row) => x.id !== "h");
  const without = await (await call("GET", "/kennings/map")).json();
  assertEquals(withHidden.layout, without.layout);
  assertEquals(withHidden.links, without.links);
  assertEquals(withHidden.lines, without.lines);
  assertEquals(withHidden.stations.filter((s: Row) => !s.hidden), without.stations);
  reset();
  t.share_items.push({ owner: ME, other: JAN, belief_id: "h" });
  const seen = await (await call("GET", `/kennings/map?seen_by=${JAN}`)).json();
  assertEquals(seen.stations.some((s: Row) => s.belief_id === "h"), false);
  // Turning it back on: the same patch the app already sends moves it into the drawn stations.
  reset();
  await call("PATCH", "/kennings/h/map", { hidden: false });
  const back = await (await call("GET", "/kennings/map")).json();
  assertEquals(back.stations.find((s: Row) => s.belief_id === "h").hidden, false);
  assertEquals(JSON.stringify(back.layout).includes('"h"'), true);
});
Deno.test("map v1.82: a kept-off station's receipts ride along on the owner's own read only, never on a seen_by read", async () => {
  reset();
  t.receipts = [{ id: "r1", owner: ME, belief_id: "a", said_at: "2026-10-03T00:00:00Z", quote: "at work I say it's fine" },
    { id: "r3", owner: ME, belief_id: "h", said_at: "2026-11-04T00:00:00Z", quote: "kept off the map" }];
  t.share_items = [{ owner: ME, other: JAN, belief_id: "a" }, { owner: ME, other: JAN, belief_id: "h" }]; // a grant on the kept-off one changes nothing
  const own = await (await call("GET", "/kennings/map")).json();
  assertEquals(own.stations.filter((s: Row) => s.hidden).map((s: Row) => s.belief_id), ["h"]);
  assertEquals(own.receipts.map((r: Row) => r.id), ["r1", "r3"]);
  assertEquals(own.receipts.find((r: Row) => r.id === "r3").quote, "kept off the map");
  const seen = await (await call("GET", `/kennings/map?seen_by=${JAN}`)).json();
  assertEquals(seen.stations.some((s: Row) => s.belief_id === "h"), false);
  assertEquals(seen.receipts.map((r: Row) => r.id), ["r1"]);
  assertEquals(JSON.stringify(seen).includes("kept off the map"), false);
});
Deno.test("map v1.84 (KM2-C3): keyword_candidates come from the owner's own words on the owner's read; a seen_by read carries none", async () => {
  reset();
  t.receipts = [{ id: "r1", owner: ME, belief_id: "a", said_at: "2026-10-03T00:00:00Z", quote: "at the kitchen table I say it's fine" }];
  t.share_items = [{ owner: ME, other: JAN, belief_id: "a" }];
  const own = await (await call("GET", "/kennings/map")).json();
  assertEquals(own.stations.every((s: Row) => Array.isArray(s.keyword_candidates) && s.keyword_candidates.length <= 6), true);
  assertEquals(own.stations.find((s: Row) => s.belief_id === "a").keyword_candidates.includes("Kitchen"), true);
  const seen = await (await call("GET", `/kennings/map?seen_by=${JAN}`)).json();
  assertEquals(seen.stations.every((s: Row) => Array.isArray(s.keyword_candidates) && s.keyword_candidates.length === 0), true);
  assertEquals(JSON.stringify(seen).includes("Kitchen"), false);
});
Deno.test("V3 READ-1 (b): a kenning carry-over gave a kind stays on the map, whatever its kind or wording becomes; only comm_native items are off", async () => {
  reset();
  const before = await (await call("GET", "/kennings/map")).json();
  const id = (t.beliefs[0] as Row).id as string;
  Object.assign(t.beliefs[0], { comm_kind: "how_i_mean", comm_source: "typed", comm_native: false });   // carried over, then re-worded by the person
  const after = await (await call("GET", "/kennings/map")).json();
  assertEquals(JSON.stringify(after), JSON.stringify(before), "the station is where it was");
  assert(after.stations.some((s: Row) => s.belief_id === id));
  t.beliefs[0].comm_native = true;
  assert(!(await (await call("GET", "/kennings/map")).json()).stations.some((s: Row) => s.belief_id === id), "the same row marked as created as an item leaves the map");
});
Deno.test("map: Seen by Jan keeps the layout and dims everything not shared", async () => {
  reset();
  const all = await (await call("GET", "/kennings/map")).json();
  const seen = await (await call("GET", `/kennings/map?seen_by=${JAN}`)).json();
  assertEquals(seen.layout, all.layout);
  assertEquals(seen.stations.filter((s: Row) => s.emphasis === 1).map((s: Row) => s.belief_id), ["f"]);
  assertEquals(seen.stations.filter((s: Row) => s.emphasis !== 1).every((s: Row) => s.show_label === false), true);
});
Deno.test("patch: lines, central and hidden are the person's; a guess cannot be placed; bad lines are refused", async () => {
  reset();
  await call("PATCH", "/kennings/a/map", { lines: ["work", "me"], central: true });
  const a = t.beliefs.find((x) => x.id === "a")!;
  assertEquals(a.map_lines, ["work", "me"]); assertEquals(a.central, true); assertEquals(a.central_asked, true);
  for (const bad of [{ lines: ["work", "work"] }, { lines: ["love2"] }, { lines: [] }, { central: "yes" }, {}]) {
    let code = ""; try { await call("PATCH", "/kennings/a/map", bad); } catch (e) { code = (e as { code?: string }).code ?? "err"; }
    assert(code, JSON.stringify(bad));
  }
  let forbidden = false; try { await call("PATCH", "/kennings/g/map", { central: true }); } catch { forbidden = true; }
  assert(forbidden);
});
Deno.test("order: the person's drag is stored per line and survives the next read", async () => {
  reset();
  await call("PUT", "/kennings/order", { line: "work", ids: ["c", "a"] });
  const r = await (await call("GET", "/kennings/map")).json();
  assertEquals(r.layout.lines.find((l: Row) => l.topic === "work").station_ids, ["c", "a"]);
});
Deno.test("links: two kinds only, both ends confirmed, both_true is symmetric and visible on the map", async () => {
  reset();
  const ok = await (await call("PUT", "/kennings/links", { a: "c", b: "a", kind: "both_true", note: "work days vs weekends" })).json();
  assertEquals([ok.link.a, ok.link.b], ["a", "c"]);
  await call("PUT", "/kennings/links", { a: "f", b: "a", kind: "comes_from" });
  for (const bad of [{ a: "a", b: "a", kind: "both_true" }, { a: "a", b: "c", kind: "tension" }, { a: "a", b: "g", kind: "both_true" }]) {
    let threw = false; try { await call("PUT", "/kennings/links", bad); } catch { threw = true; }
    assert(threw, JSON.stringify(bad));
  }
  const r = await (await call("GET", "/kennings/map")).json();
  assertEquals(r.links.map((l: Row) => l.kind).sort(), ["both_true", "comes_from"]);
  await call("DELETE", `/kennings/links/${ok.link.link_id}`);
  assertEquals((await (await call("GET", "/kennings/map")).json()).links.length, 1);
});
Deno.test("route card: only the chosen kennings, at most three, no links, no suggestion", async () => {
  reset();
  const r = await (await call("POST", "/kennings/route-card", { belief_ids: ["a", "f"] })).json();
  assertEquals(r.stations.map((s: Row) => s.belief_id), ["a", "f"]);
  assertEquals(r.layout.stations.map((s: Row) => s.id).sort(), ["a", "f"]);
  assert(!("links" in r));
  for (const bad of [{ belief_ids: ["a", "c", "f", "L0"] }, { belief_ids: ["g"] }, { belief_ids: [] }]) {
    let threw = false; try { await call("POST", "/kennings/route-card", bad); } catch { threw = true; }
    assert(threw, JSON.stringify(bad));
  }
});

Deno.test("ask_comes_from: one ask per heard pair; drawn, declined, off-map and Seen-by pairs never ask; 'Not now' is stored and final", async () => {
  reset();
  const ask = async (q = "") => (await (await call("GET", "/kennings/map" + q)).json()).ask_comes_from as Row[];
  assertEquals(await ask(), [{ a: "a", b: "f" }, { a: "c", b: "a" }]);   // g is a guess (not on the map); f->c is declined
  assertEquals(await ask(`?seen_by=${JAN}`), []);
  await call("PATCH", "/kennings/a/map", { comes_from_declined: "f" });
  assertEquals(await ask(), [{ a: "c", b: "a" }]);
  assertEquals(t.kenning_because.find((x) => x.a_belief === "a" && x.b_belief === "f")!.declined, true);
  await call("PUT", "/kennings/links", { a: "c", b: "a", kind: "comes_from" });   // drawing it answers the ask
  assertEquals(await ask(), []);
  for (const bad of [{ comes_from_declined: "a" }, { comes_from_declined: 5 }, { comes_from_declined: "L0" }]) {
    let threw = false; try { await call("PATCH", "/kennings/a/map", bad); } catch { threw = true; }
    assert(threw, JSON.stringify(bad));
  }
});
