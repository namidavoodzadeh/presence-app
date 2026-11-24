// E41: GET /threads/:person marks the SENDER's own parked bridge rows (parked_on_check_in, checkin_id); the receiver's rows never
// carry it (law 10). A moved check-in moves its parked bridges. Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/bridge.ts";
import { nextOccurrence } from "../engine/checkin/schedule.ts";

const A = "00000000-0000-4000-8000-000000000061";
const B = "00000000-0000-4000-8000-000000000062";
const BR = "00000000-0000-4000-8000-0000000000b1";
type Row = Record<string, unknown>;

class Q implements PromiseLike<{ data: unknown; error: null }> {
  kind = "select"; eqs: Array<[string, unknown]> = []; val: Row = {}; one = false; conflict = "";
  constructor(private rows: Row[]) {}
  select() { return this; }
  insert(v: Row) { this.kind = "insert"; this.val = v; return this; }
  update(v: Row) { this.kind = "update"; this.val = v; return this; }
  upsert(v: Row, o?: { onConflict: string }) { this.kind = "upsert"; this.val = v; this.conflict = o?.onConflict ?? ""; return this; }
  delete() { this.kind = "delete"; return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in() { return this; }
  neq() { return this; }
  is() { return this; }
  not() { return this; }
  or() { return this; }
  limit() { return this; }
  gte() { return this; }
  lte() { return this; }
  order() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { return Promise.resolve(r(this.run())); }
  run() {
    const m = (x: Row) => this.eqs.every(([c, v]) => x[c] === v);
    let out: Row[];
    if (this.kind === "insert") { const row = { id: crypto.randomUUID(), ...this.val }; this.rows.push(row); out = [row]; }
    else if (this.kind === "update") { out = this.rows.filter(m); for (const x of out) Object.assign(x, this.val); }
    else if (this.kind === "upsert") {
      const keys = this.conflict.split(",");
      const ex = this.rows.find((x) => keys.every((k) => x[k] === this.val[k]));
      if (ex) { Object.assign(ex, this.val); out = [ex]; } else { const row = { id: crypto.randomUUID(), ...this.val }; this.rows.push(row); out = [row]; }
    } else if (this.kind === "delete") {
      out = this.rows.filter(m); for (const x of out) this.rows.splice(this.rows.indexOf(x), 1);
    } else out = this.rows.filter(m);
    out = out.map((x) => ({ ...x }));
    return { data: this.one ? out[0] ?? null : out, error: null as null };
  }
}
const client = (t: Record<string, Row[]>) => ({ from: (n: string) => new Q(t[n] ??= []), rpc: (n: string) => Promise.resolve({ data: n === "receiver_bridges" ? (t.__recv ?? []) : null, error: null }) });
const tables = (): Record<string, Row[]> => ({
  links: [{ person_a: A, person_b: B, status: "active" }], check_ins: [], parked_notes: [], push_events: [], plans: [], profiles: [{ id: A }, { id: B, settings: {} }],
  device_tokens: [{ id: "dev1", owner: B, enabled: true }],
  bridges: [{ id: BR, sender: A, receiver: B, original: "o", final: "I felt hurt when you left early.", used: "mine", status: "scheduled",
    deliver_at: new Date(Date.now() + 3600_000).toISOString(), heads_up: true, opened_at: null }],
});
function call(path: string, method: string, body: Row, caller: string, t: Record<string, Row[]>, checkIn = true) {
  const f = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(f, `no route ${method} ${path}`);
  const m = f.pattern.exec(path)!; const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = client(t);
  return f.handler({
    env: { checkIn, pushDrainSecret: "s3cret" }, req: new Request("https://x.invalid" + path, { method }),
    url: new URL("https://x.invalid" + path), params, caller: { id: caller, isPreview: false, db }, service: db,
    tz: "Asia/Tehran", body: () => Promise.resolve(body),
  } as never);
}
const sched = { day: "thursday", time: "19:00" };
const keysDeep = (x: unknown): string[] => x && typeof x === "object" ? Object.entries(x as Row).flatMap(([k, v]) => [k, ...keysDeep(v)]) : [];

async function parked() {
  const t = tables();
  t.profiles = [{ id: A }, { id: B, settings: {} }];
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  await call(`/checkin/${A}/accept`, "POST", {}, B, t);
  await call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t);
  return t;
}
const bridgesIn = (th: { items: Row[] }) => th.items.filter((i) => i.kind === "bridge").map((i) => i.bridge as Row);

Deno.test("E41 the sender's row for a bridge parked on a check-in carries parked_on_check_in and checkin_id", async () => {
  const t = await parked();
  const th = await (await call(`/threads/${B}`, "GET", {}, A, t)).json();
  const [b] = bridgesIn(th);
  assertEquals(b.id, BR);
  assertEquals(b.parked_on_check_in, true);
  assertEquals(b.checkin_id, t.check_ins[0].id);
});

Deno.test("E41 a bridge sent at a plain time carries neither field; talked-about notes drop the flag", async () => {
  const t = tables();
  const th = await (await call(`/threads/${B}`, "GET", {}, A, t)).json();
  const [b] = bridgesIn(th);
  assert(!("parked_on_check_in" in b) && !("checkin_id" in b));
  const p = await parked();
  p.parked_notes[0].state = "talked";
  const [c] = bridgesIn(await (await call(`/threads/${B}`, "GET", {}, A, p)).json());
  assert(!("parked_on_check_in" in c));
});

Deno.test("E41 a dated check-in's id is reported when the bridge is parked on the dated one", async () => {
  const t = tables();
  t.profiles = [{ id: A }, { id: B, settings: {} }];
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  await call(`/checkin/${A}/accept`, "POST", {}, B, t);
  const soon = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
  await call(`/checkin/${B}/schedule`, "PUT", { on: soon, time: "08:00" }, A, t);
  t.check_in_dates[0].status = "active";
  await call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t);
  const th = await (await call(`/threads/${B}`, "GET", {}, A, t)).json();
  const [b] = bridgesIn(th);
  const dated = Date.parse(b.deliver_at as string);
  const rep = nextOccurrence({ repeats: "weekly", ...sched, tz: "Asia/Tehran", remind_other: true } as never, Date.now());
  assertEquals(b.checkin_id, dated < rep ? t.check_in_dates[0].id : t.check_ins[0].id);
});

Deno.test("E41 the receiver's rows never carry the flag, the id or any hint (law 10)", async () => {
  const t = await parked();
  const br = t.bridges[0];
  // What receiver_bridges returns for B: the sealed view of A's parked bridge, as the database function shapes it.
  t.__recv = [{ id: br.id, from: A, deliver_at: br.deliver_at, created_at: new Date().toISOString(), ready: false, sealed: false, status: "scheduled" }];
  const th = await (await call(`/threads/${A}`, "GET", {}, B, t)).json();
  const all = JSON.stringify(th);
  assert(!all.includes("parked_on_check_in") && !all.includes("checkin_id") && !keysDeep(th).includes("parked"), "receiver thread carries no parked hint");
  assert(bridgesIn(th).length >= 1);
});

Deno.test("E41 when the check-in moves, every bridge parked on it moves its deliver_at with it", async () => {
  const t = await parked();
  t.bridges.push({ id: "b2", sender: A, receiver: B, original: "o", final: "second", used: "mine", status: "scheduled", deliver_at: t.bridges[0].deliver_at, heads_up: false, opened_at: null });
  t.parked_notes.push({ id: "n2", writer: A, partner: B, text: "second", state: "parked", origin: "bridged", origin_ref: "b2" });
  const before = t.bridges[0].deliver_at;
  const res = await (await call(`/checkin/${B}/schedule`, "PUT", { day: "friday", time: "08:00" }, A, t)).json();
  assert(res.schedule.moved_at);
  const want = nextOccurrence({ repeats: "weekly", day: "friday", time: "08:00", tz: "Asia/Tehran", remind_other: true } as never, Date.now());
  assert(t.bridges[0].deliver_at !== before);
  assertEquals(Date.parse(t.bridges[0].deliver_at as string), want);
  assertEquals(Date.parse(t.bridges[1].deliver_at as string), want);
  assert(res.schedule.next_at === new Date(want).toISOString());
});

Deno.test("E41 a remind-only change is not a move; an opened bridge and a bridge at another time stay put", async () => {
  const t = await parked();
  const before = t.bridges[0].deliver_at;
  await call(`/checkin/${B}/schedule`, "PUT", { ...sched, remind_other: false }, A, t);
  assertEquals(t.bridges[0].deliver_at, before);
  const other = new Date(Date.now() + 5 * 3600_000).toISOString();
  t.bridges.push({ id: "b3", sender: A, receiver: B, final: "x", status: "scheduled", deliver_at: other, opened_at: null });
  t.parked_notes.push({ id: "n3", writer: A, partner: B, text: "x", state: "talked", origin: "bridged", origin_ref: "b3" });
  await call(`/checkin/${B}/schedule`, "PUT", { day: "friday", time: "08:00" }, A, t);
  assertEquals(t.bridges[1].deliver_at, other);
});

Deno.test("v1.69 the send reply carries deliver_at and held_by_window (CPO 12 Nov (1)); no receiver window moves a send", async () => {
  const t = tables();
  const before = Date.now();
  let r = await (await call("/bridges", "POST", { person_id: B, original: "I'd like us to talk tonight.", used: "mine", deliver_at: "now" }, A, t)).json();
  const at = new Date(String(r.bridge.deliver_at)).getTime();
  assert(at >= before && at <= Date.now(), "now is the server's now");
  assertEquals([r.bridge.delivered, r.held_by_window, r.parked_on_check_in], [true, false, false]);
  // a later time is the sender's own pick: stored as asked, not delivered yet, not held by any window
  const later = new Date(Date.now() + 26 * 3600_000).toISOString();
  r = await (await call("/bridges", "POST", { person_id: B, original: "For tomorrow.", used: "mine", deliver_at: later }, A, t)).json();
  assertEquals([r.bridge.deliver_at, r.bridge.delivered, r.held_by_window], [later, false, false]);
  // PATCH (a moved time) carries it too
  r = await (await call(`/bridges/${BR}`, "PATCH", { deliver_at: "now" }, A, t)).json();
  assertEquals([r.bridge.delivered, r.held_by_window], [true, false]);
});
