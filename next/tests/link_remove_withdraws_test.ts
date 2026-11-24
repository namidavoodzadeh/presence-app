// QA-B402 (P0, QA 01:49Z 17 Nov): after POST /links/:person/remove, bridges scheduled before it must not deliver in either direction.
// Fake database, $0. Mutation check: drop the withdraw loop in api/bridge.ts and the first test fails.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/bridge.ts";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const C = "00000000-0000-4000-8000-0000000000c3";
type Row = Record<string, unknown>;

class Q implements PromiseLike<{ data: unknown; error: null }> {
  kind = "select"; eqs: Array<[string, unknown]> = []; nulls: string[] = []; val: Row = {}; one = false;
  constructor(private rows: Row[]) {}
  select() { return this; }
  insert(v: Row) { this.kind = "insert"; this.val = v; return this; }
  update(v: Row) { this.kind = "update"; this.val = v; return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  is(c: string, _v: null) { this.nulls.push(c); return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { return Promise.resolve(r(this.run())); }
  run() {
    const m = (x: Row) => this.eqs.every(([c, v]) => x[c] === v) && this.nulls.every((c) => x[c] == null);
    let out: Row[];
    if (this.kind === "insert") { this.rows.push({ ...this.val }); out = [this.val]; }
    else if (this.kind === "update") { out = this.rows.filter(m); for (const x of out) Object.assign(x, this.val); }
    else out = this.rows.filter(m);
    out = out.map((x) => ({ ...x }));
    return { data: this.one ? out[0] ?? null : out, error: null as null };
  }
}
const tables = (): Record<string, Row[]> => ({
  links: [{ id: "L1", person_a: A, person_b: B, status: "active" }, { id: "L2", person_a: A, person_b: C, status: "active" }],
  thread_events: [],
  bridges: [
    { id: "ab", sender: A, receiver: B, status: "scheduled", opened_at: null },        // A -> B, waiting
    { id: "ba", sender: B, receiver: A, status: "scheduled", opened_at: null },        // B -> A, waiting
    { id: "ab_open", sender: A, receiver: B, status: "scheduled", opened_at: "2026-11-16T00:00:00Z" },   // already opened: stays
    { id: "ab_done", sender: A, receiver: B, status: "delivered", opened_at: null },   // already delivered: stays
    { id: "ac", sender: A, receiver: C, status: "scheduled", opened_at: null },        // another pair: untouched
  ],
});
function call(path: string, caller: string, t: Record<string, Row[]>) {
  const f = routes.find((r) => r.method === "POST" && r.pattern.test(path));
  assert(f, `no route POST ${path}`);
  const m = f.pattern.exec(path)!; const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const client = { from: (n: string) => new Q(t[n] ??= []) };
  return f.handler({
    env: {}, req: new Request("https://x.invalid" + path, { method: "POST" }), url: new URL("https://x.invalid" + path), params,
    caller: { id: caller, isPreview: false, db: client }, service: client, tz: "UTC", body: () => Promise.resolve({}),
  } as never);
}
const status = (t: Record<string, Row[]>, id: string) => t.bridges.find((b) => b.id === id)!.status;

Deno.test("remove: scheduled, unopened bridges between the pair are withdrawn both ways; delivered, opened and other pairs are untouched", async () => {
  const t = tables();
  const res = await call(`/links/${B}/remove`, A, t) as Response;
  assertEquals(await res.json(), { status: "removed", dropped: 2 });
  assertEquals(["ab", "ba", "ab_open", "ab_done", "ac"].map((id) => status(t, id)), ["withdrawn", "withdrawn", "scheduled", "delivered", "scheduled"]);
  assert(t.bridges.find((b) => b.id === "ab")!.withdrawn_at, "withdrawn_at is set");
  assertEquals(t.links[0].status, "removed");
});

Deno.test("remove: the same withdraw runs from the other side of the pair", async () => {
  const t = tables();
  await call(`/links/${A}/remove`, B, t);
  assertEquals([status(t, "ab"), status(t, "ba"), status(t, "ac")], ["withdrawn", "withdrawn", "scheduled"]);
});
