// V3 READ-1 on the older GET /map: a communication item is not placed on the map. Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/map.ts";

type Row = Record<string, unknown>;
const ME = "00000000-0000-4000-8000-0000000000b1";
class Q implements PromiseLike<{ data: unknown; error: null }> {
  filters: Array<(x: Row) => boolean> = []; one = false; upd = false;
  constructor(private rows: Row[]) {}
  select() { return this; } order() { return this; } limit() { return this; }
  eq(c: string, v: unknown) { this.filters.push((x) => x[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((x) => x[c] !== v); return this; }
  in(c: string, v: unknown[]) { this.filters.push((x) => v.includes(x[c])); return this; }
  update() { this.upd = true; return this; }
  maybeSingle() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { const d = this.upd ? [] : this.rows.filter((x) => this.filters.every((f) => f(x))); return Promise.resolve(r({ data: this.one ? d[0] ?? null : d, error: null })); }
}
const belief = (id: string, over: Row = {}): Row => ({ id, owner: ME, label: `L${id}`, statement: `Part of you ${id}`, area: "relationships", kind: "foundation", status: "confirmed", rating: "very",
  created_at: "2026-11-01T00:00:00Z", confirmed_at: "2026-11-01T00:00:00Z", ...over });

Deno.test("V3 READ-1: GET /map leaves communication items off the map and out of the counts; old beliefs are unchanged", async () => {
  const t: Record<string, Row[]> = {
    beliefs: [belief("a"), belief("k1", { comm_native: true, comm_kind: "how_i_mean", own_wording: "When I go quiet, I'm thinking.", statement: "When I go quiet, I'm thinking." }),
      belief("k2", { comm_native: true, comm_kind: "lands_hard", status: "set_aside" }),
      belief("c1", { comm_kind: "other", own_wording: "I keep the peace." })],   // carried over: not created as a communication item, still on the map
    belief_links: [], outside_perspectives: [], receipts: [], profiles: [{ id: ME }],
  };
  const db = { from: (n: string) => new Q(t[n] ??= []) };
  const f = routes.find((r) => r.method === "GET" && r.pattern.test("/map"))!;
  assert(f);
  const res = await f.handler({ env: {}, req: new Request("https://x.invalid/map"), url: new URL("https://x.invalid/map"), params: {}, tz: "UTC",
    caller: { id: ME, db, profile: {}, mapDeleteAt: null }, service: db, body: () => Promise.resolve({}) } as never);
  const j = await res.json();
  assertEquals(j.beliefs.map((b: Row) => b.belief_id), ["a", "c1"]);
  assertEquals(j.counts.confirmed, 2);
  assertEquals(j.counts.set_aside, 0);
  assert(!JSON.stringify(j).includes("go quiet"));
});
