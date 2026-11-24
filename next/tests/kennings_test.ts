// V3 You: GET /kennings groups confirmed beliefs by topic, dated, with who can see each. Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/kennings.ts";

const ME = "00000000-0000-4000-8000-000000000081", JAN = "00000000-0000-4000-8000-000000000082", AMY = "00000000-0000-4000-8000-000000000083", GONE = "00000000-0000-4000-8000-000000000084";
type Row = Record<string, unknown>;
class T implements PromiseLike<{ data: unknown; error: null }> {
  eqs: Array<[string, unknown]> = []; ins: Array<[string, unknown[]]> = [];
  constructor(private rows: Row[]) {}
  select() { return this; } order() { return this; } or() { return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in(c: string, v: unknown[]) { this.ins.push([c, v]); return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { return Promise.resolve(r({ data: this.rows.filter((x) => this.eqs.every(([c, v]) => x[c] === v) && this.ins.every(([c, v]) => v.includes(x[c]))), error: null })); }
}
const lk = (o: string, status = "active"): Row => ({ person_a: ME < o ? ME : o, person_b: ME < o ? o : ME, status, created_at: "2026-10-01T00:00:00Z" });
const b = (id: string, area: string, status: string, at: string, over: Row = {}): Row => ({ id, owner: ME, label: `L${id}`, statement: `Part of you ${id}`, area, kind: "foundation", status, rating: "very", created_at: at, confirmed_at: at, ...over });
const t: Record<string, Row[]> = {
  profiles: [{ id: JAN, name: "Jan" }, { id: AMY, name: "Amy" }, { id: GONE, name: "Gone" }],
  links: [lk(JAN), lk(AMY), lk(GONE, "removed")],
  beliefs: [
    b("a", "work", "confirmed", "2026-11-01T00:00:00Z"), b("b", "relationships", "confirmed", "2026-11-05T00:00:00Z"),
    b("c", "relationships", "confirmed", "2026-11-03T00:00:00Z"), b("n", "work", "confirmed", "2026-11-04T00:00:00Z", { rating: "not" }),
    b("g", "family", "guess", "2026-11-06T00:00:00Z", { rating: null }),
    { ...b("o", "work", "confirmed", "2026-11-02T00:00:00Z"), owner: JAN },
  ],
  share_items: [
    { owner: ME, other: JAN, belief_id: "b", created_at: "2026-11-06T00:00:00Z" }, { owner: ME, other: AMY, belief_id: "b", created_at: "2026-11-07T00:00:00Z" },
    { owner: ME, other: GONE, belief_id: "c", created_at: "2026-11-07T00:00:00Z" },
  ],
};
const call = () => {
  const f = routes.find((r) => r.method === "GET" && r.pattern.test("/kennings"));
  assert(f, "no GET /kennings");
  const db = { from: (n: string) => new T(t[n] ??= []) };
  return f.handler({ env: {}, req: new Request("https://x.invalid/kennings"), url: new URL("https://x.invalid/kennings"), params: {}, caller: { id: ME, db }, service: db } as never);
};
Deno.test("kennings: grouped by topic, newest topic first, newest kenning first, mine only, never Not me", async () => {
  const r = await (await call()).json();
  assertEquals(r.groups.map((g: Row) => g.topic), ["relationships", "work"]);
  assertEquals((r.groups[0].items as Row[]).map((i) => i.belief_id), ["b", "c"]);
  assertEquals((r.groups[1].items as Row[]).map((i) => i.belief_id), ["a"], "n is Not me, o is Jan's");
  assertEquals(r.groups[0].items[0].dated_at, "2026-11-05T00:00:00.000Z");
});
Deno.test("kennings: seen_by lists only people still linked, by name; no one means empty, not hidden", async () => {
  const r = await (await call()).json();
  const [b0, c0] = r.groups[0].items;
  assertEquals(b0.seen_by.map((p: Row) => p.name), ["Amy", "Jan"]);
  assertEquals(c0.seen_by, [], "the grant to a removed link does not show");
});
Deno.test("kennings: suggestions stay apart, dim, and seen by no one", async () => {
  const r = await (await call()).json();
  assertEquals(r.suggested.map((s: Row) => s.belief_id), ["g"]);
  assertEquals(r.suggested[0].seen_by, []);
  assert(!JSON.stringify(r.groups).includes('"g"'));
});
