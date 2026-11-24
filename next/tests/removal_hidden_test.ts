// QA-B403 (P0; CEO GAP-1, COO 03:20Z 17 Nov): the removed person is not told who removed them or when. After POST /links/:person/remove,
// the removed person's GET /threads/:person and GET /threads carry no removal event, no `by`, no `at`, and no activity bump; the remover
// still sees their own event. Fake database, $0, no row-level security: the route itself must hold this.
// Mutation check: drop `visible_to_b: false` on the insert, or the visible_to_b filter in threadOf, and the tests below fail.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/bridge.ts";

const A = "00000000-0000-4000-8000-0000000000a1";   // the remover
const B = "00000000-0000-4000-8000-0000000000b2";   // the removed person
const LINKED_AT = "2026-11-01T10:00:00.000Z";
const LAST_TALK = "2026-11-10T09:00:00.000Z";
type Row = Record<string, unknown>;

class Q implements PromiseLike<{ data: unknown; error: null }> {
  kind = "select"; eqs: Array<[string, unknown]> = []; nulls: string[] = []; ins: Array<[string, unknown[]]> = []; val: Row = {}; one = false;
  constructor(private rows: Row[]) {}
  select() { return this; }
  insert(v: Row) { this.kind = "insert"; this.val = v; return this; }
  update(v: Row) { this.kind = "update"; this.val = v; return this; }
  upsert(v: Row) { this.kind = "insert"; this.val = v; return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in(c: string, v: unknown[]) { this.ins.push([c, v]); return this; }
  is(c: string, _v: null) { this.nulls.push(c); return this; }
  // The pair filters (or / order / neq / limit) do not change what a one-pair fixture holds.
  or() { return this; }
  order() { return this; }
  neq() { return this; }
  limit() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { return Promise.resolve(r(this.run())); }
  run() {
    const m = (x: Row) => this.eqs.every(([c, v]) => x[c] === v) && this.nulls.every((c) => x[c] == null) &&
      this.ins.every(([c, v]) => v.includes(x[c]));
    let out: Row[];
    if (this.kind === "insert") { this.rows.push({ id: `e${this.rows.length}`, created_at: "2026-11-17T03:00:00.000Z", ...this.val }); out = [this.rows.at(-1)!]; }
    else if (this.kind === "update") { out = this.rows.filter(m); for (const x of out) Object.assign(x, this.val); }
    else out = this.rows.filter(m);
    out = out.map((x) => ({ ...x }));
    return { data: this.one ? out[0] ?? null : out, error: null as null };
  }
}
const tables = (): Record<string, Row[]> => ({
  links: [{ id: "L1", person_a: A, person_b: B, status: "active", created_at: LINKED_AT }],
  profiles: [{ id: A, name: "Ava" }, { id: B, name: "Ben" }],
  thread_events: [{ id: "e_talked", person_a: A, person_b: B, type: "talked", created_at: LAST_TALK, visible_to_b: true }],
  bridges: [], plans: [], link_prefs: [], drafts: [],
});
function call(method: string, path: string, caller: string, t: Record<string, Row[]>) {
  const f = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(f, `no route ${method} ${path}`);
  const m = f.pattern.exec(path)!; const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const client = { from: (n: string) => new Q(t[n] ??= []), rpc: () => Promise.resolve({ data: [], error: null }) };
  return f.handler({
    env: {}, req: new Request("https://x.invalid" + path, { method }), url: new URL("https://x.invalid" + path), params,
    caller: { id: caller, isPreview: false, db: client }, service: client, tz: "UTC", body: () => Promise.resolve({}),
  } as never) as Promise<Response>;
}
const removeThen = async () => {
  const t = tables();
  const res = await call("POST", `/links/${B}/remove`, A, t);
  assertEquals((await res.json()).status, "removed");
  return t;
};

Deno.test("B403: the removal event is written invisible to the removed person", async () => {
  const t = await removeThen();
  const ev = t.thread_events.find((e) => e.type === "removed")!;
  assertEquals([ev.person_a, ev.person_b, ev.visible_to_b], [A, B, false]);
});

Deno.test("B403: the removed person's thread has no removal event, no by/at, no activity bump, and says only that the link is not active", async () => {
  const t = await removeThen();
  const removalAt = t.thread_events.find((e) => e.type === "removed")!.created_at as string;
  const body = await (await call("GET", `/threads/${A}`, B, t)).json();
  assertEquals(body.link.status, "removed");
  const events = body.items.filter((i: Row) => i.kind === "event").map((i: Row) => (i.event as Row).type);
  assertEquals(events, ["talked"], "only the earlier talked event; no removed event");
  assertEquals(body.activity_at, LAST_TALK, "no activity bump from the removal");
  assert(!JSON.stringify(body).includes(removalAt), "the removal time appears nowhere the removed person reads");
  const list = await (await call("GET", "/threads", B, t)).json();
  assertEquals(list.threads.length, 1);
  assertEquals(list.threads[0].activity_at, LAST_TALK);
  assertEquals(list.threads[0].status, "removed");
  assert(!JSON.stringify(list).includes(removalAt), "nor in the thread list");
});

Deno.test("B403: the remover still sees their own removal", async () => {
  const t = await removeThen();
  const body = await (await call("GET", `/threads/${B}`, A, t)).json();
  const types = body.items.filter((i: Row) => i.kind === "event").map((i: Row) => (i.event as Row).type);
  assertEquals(types, ["talked", "removed"]);
});
