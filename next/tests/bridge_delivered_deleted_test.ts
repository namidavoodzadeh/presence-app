// QA-B404 (COO 05:20Z 17 Nov, ruled (a)): a bridge that was delivered before its receiver deleted the account stays, and the sender's read
// of it says "delivered", never "scheduled". Route level, fake database, $0. A live receiver's row is unchanged: status "scheduled" with the
// derived `delivered: true` (CONTRACT: delivered is derived from deliver_at). Mutation check: take the `toDeleted` branch out of
// senderBridge and the first test fails.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/bridge.ts";

const A = "00000000-0000-4000-8000-0000000000a1";   // the sender
const B = "00000000-0000-4000-8000-0000000000b2";   // the receiver, deleted or removed
const LINKED_AT = "2026-11-01T10:00:00.000Z";
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
const tables = (deleted: boolean): Record<string, Row[]> => ({
  links: [{ id: "L1", person_a: A, person_b: B, status: deleted ? "removed" : "active", created_at: LINKED_AT }],
  profiles: [{ id: A, name: "Ava" }, deleted ? { id: B, name: "Deleted account", deleted_at: "2026-11-17T04:00:00.000Z" } : { id: B, name: "Ben" }],
  thread_events: [],
  bridges: [{
    id: "b_due", sender: A, receiver: B, status: "scheduled", deliver_at: "2026-11-17T03:00:00.000Z", opened_at: null,
    created_at: "2026-11-17T02:00:00.000Z", original: "o", final: "o", used: "mine", changes: [], points: [],
  }],
  plans: [], link_prefs: [], drafts: [],
});
const sentRow = async (deleted: boolean) => {
  const body = await (await call("GET", `/threads/${B}`, A, tables(deleted))).json();
  const items = body.items.filter((i: Row) => i.kind === "bridge").map((i: Row) => i.bridge as Row);
  assertEquals(items.length, 1);
  return items[0];
};

Deno.test("B404: a delivered, unopened row to a deleted account reads delivered on the sender's thread", async () => {
  const b = await sentRow(true);
  assertEquals([b.status, b.delivered, b.opened_at], ["delivered", true, null]);
});

Deno.test("B404: the same row to a live account is unchanged (status scheduled, delivered true)", async () => {
  const b = await sentRow(false);
  assertEquals([b.status, b.delivered], ["scheduled", true]);
});
