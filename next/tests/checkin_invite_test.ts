// E33: the check-in invite (starts only when the other person accepts) and "next_checkin" as a delivery choice
// on PATCH /bridges (and POST), which parks the bridge onto the check-in. Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import { queueCheckInReminders } from "../api/checkin.ts";
import "../api/bridge.ts";
import { nextOccurrence } from "../engine/checkin/schedule.ts";

const A = "00000000-0000-4000-8000-000000000061";
const B = "00000000-0000-4000-8000-000000000062";
const C = "00000000-0000-4000-8000-000000000063";
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
const client = (t: Record<string, Row[]>) => ({ from: (n: string) => new Q(t[n] ??= []), rpc: () => Promise.resolve({ data: null, error: null }) });
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
async function rejects(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { assert(e instanceof ApiError); return e; }
  throw new Error("expected ApiError");
}
const sched = { day: "thursday", time: "19:00" };

Deno.test("E33 a new check-in is an invite: status invited, no reminder until accepted", async () => {
  const t = tables();
  const r = await (await call(`/checkin/${B}/schedule`, "PUT", sched, A, t)).json();
  assertEquals(r.schedule.status, "invited");
  const at = nextOccurrence({ repeats: "weekly", ...sched, tz: "Asia/Tehran", remind_other: true } as never, Date.now());
  assertEquals((await queueCheckInReminders(client(t) as never, at - 10 * 60_000)).queued, 0);
  assertEquals(t.push_events.length, 0);
});

Deno.test("E33 the invitee sees the invite (day, time, who) and accepting makes it active; reminders then flow", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  const inv = await (await call("/checkin/invites", "GET", {}, B, t)).json();
  assertEquals(inv.invites.length, 1);
  assertEquals(inv.invites[0].person_id, A);
  assertEquals(inv.invites[0].day, "thursday");
  assertEquals((await (await call("/checkin/invites", "GET", {}, A, t)).json()).invites, [], "the inviter has none");
  const acc = await (await call(`/checkin/${A}/accept`, "POST", {}, B, t)).json();
  assertEquals(acc.check_in.status, "active");
  assertEquals(t.check_ins[0].status, "active");
  assertEquals((await call(`/checkin/${A}/accept`, "POST", {}, B, t)).status, 200, "idempotent");
  const at = nextOccurrence({ repeats: "weekly", ...sched, tz: "Asia/Tehran", remind_other: true } as never, Date.now());
  assertEquals((await queueCheckInReminders(client(t) as never, at - 10 * 60_000)).queued, 1);
  // A re-PUT keeps it active.
  await call(`/checkin/${B}/schedule`, "PUT", { day: "friday", time: "08:00" }, A, t);
  assertEquals(t.check_ins[0].status, "active");
});

Deno.test("E33 only the invitee can accept; the inviter cannot accept their own; no invite is not_found", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  assertEquals((await rejects(() => call(`/checkin/${B}/accept`, "POST", {}, A, t))).code, "not_found");
  assertEquals((await rejects(() => call(`/checkin/${C}/accept`, "POST", {}, B, t))).code, "not_found");
  assertEquals(t.check_ins[0].status, "invited");
});

Deno.test("E33 declining removes the invite and keeps the inviter's parked notes", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  t.parked_notes.push({ id: "n1", writer: A, partner: B, text: "x", state: "parked" });
  await call(`/checkin/${A}/decline`, "POST", {}, B, t);
  assertEquals(t.check_ins.length, 0);
  assertEquals(t.parked_notes.length, 1);
});

Deno.test("E33 PATCH deliver_at next_checkin parks the bridge: note on the check-in, receiver sees nothing until then", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  await call(`/checkin/${A}/accept`, "POST", {}, B, t);
  const res = await (await call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t)).json();
  assertEquals(res.parked_on_check_in, true);
  const at = nextOccurrence({ repeats: "weekly", ...sched, tz: "Asia/Tehran", remind_other: true } as never, Date.now());
  assertEquals(new Date(t.bridges[0].deliver_at as string).getTime(), at);
  assertEquals(t.bridges[0].heads_up, false, "no heads-up before the check-in");
  assertEquals(t.parked_notes.length, 1);
  assertEquals(t.parked_notes[0].origin, "bridged");
  assertEquals(t.parked_notes[0].origin_ref, BR);
  assertEquals(t.parked_notes[0].writer, A);
  assertEquals(t.parked_notes[0].partner, B);
  assertEquals(t.parked_notes[0].state, "parked");
  assertEquals(t.push_events.length, 0, "nothing is queued for the receiver");
  // Idempotent: a second PATCH does not park twice.
  await call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t);
  assertEquals(t.parked_notes.length, 1);
  // The home row counts it, with no words.
  const home = await (await call("/checkin", "GET", {}, A, t)).json();
  assertEquals(home.check_ins[0].parked, 1);
  assert(!JSON.stringify(home).includes("hurt"));
});

Deno.test("E33 next_checkin needs a check-in the other person accepted", async () => {
  const t = tables();
  let e = await rejects(() => call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t));
  assertEquals(e.extra.reason, "no_check_in");
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  e = await rejects(() => call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t));
  assertEquals(e.extra.reason, "not_accepted");
  assertEquals(t.parked_notes.length, 0);
  assertEquals(t.bridges[0].heads_up, true);
});

Deno.test("E33 moving the bridge to another time, or withdrawing it, takes it off the check-in", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  await call(`/checkin/${A}/accept`, "POST", {}, B, t);
  await call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t);
  await call(`/bridges/${BR}`, "PATCH", { deliver_at: new Date(Date.now() + 7200_000).toISOString() }, A, t);
  assertEquals(t.parked_notes.length, 0);
  await call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t);
  assertEquals(t.parked_notes.length, 1);
  await call(`/bridges/${BR}/withdraw`, "POST", {}, A, t);
  assertEquals(t.parked_notes.length, 0);
});

Deno.test("E33 a talked-about note is not removed by moving the bridge", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  await call(`/checkin/${A}/accept`, "POST", {}, B, t);
  await call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t);
  t.parked_notes[0].state = "talked";
  await call(`/bridges/${BR}`, "PATCH", { deliver_at: new Date(Date.now() + 7200_000).toISOString() }, A, t);
  assertEquals(t.parked_notes.length, 1);
});

Deno.test("E33 an already delivered bridge cannot be parked", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", sched, A, t);
  await call(`/checkin/${A}/accept`, "POST", {}, B, t);
  t.bridges[0].deliver_at = new Date(Date.now() - 1000).toISOString();
  assertEquals((await rejects(() => call(`/bridges/${BR}`, "PATCH", { deliver_at: "next_checkin" }, A, t))).extra.reason, "delivered");
  assertEquals(t.parked_notes.length, 0);
});

Deno.test("E33 the check-in switch off refuses the invite routes", async () => {
  const t = tables();
  assertEquals((await rejects(() => call(`/checkin/${A}/accept`, "POST", {}, B, t, false))).extra.reason, "feature_off");
  assertEquals((await rejects(() => call("/checkin/invites", "GET", {}, B, t, false))).extra.reason, "feature_off");
});
