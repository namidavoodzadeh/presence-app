// E32: schedule, home rows, parked origin, the reminder queue and the push payload, against a fake database. $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import { queueCheckInReminders } from "../api/checkin.ts";
import { pushPayload } from "../api/push.ts";
import { nextOccurrence } from "../engine/checkin/schedule.ts";

const A = "00000000-0000-4000-8000-000000000051";
const B = "00000000-0000-4000-8000-000000000052";
const C = "00000000-0000-4000-8000-000000000053";
type Row = Record<string, unknown>;

class Q implements PromiseLike<{ data: unknown; error: null }> {
  kind = "select"; eqs: Array<[string, unknown]> = []; val: Row = {}; one = false; conflict = "";
  constructor(private rows: Row[]) {}
  select() { return this; }
  insert(v: Row) { this.kind = "insert"; this.val = v; return this; }
  upsert(v: Row, o?: { onConflict: string }) { this.kind = "upsert"; this.val = v; this.conflict = o?.onConflict ?? ""; return this; }
  delete() { this.kind = "delete"; return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  is(c: string, v: unknown) { this.eqs.push([c, v ?? null]); return this; }
  update(v: Row) { this.kind = "update"; this.val = v; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { return Promise.resolve(r(this.run())); }
  run() {
    const m = (x: Row) => this.eqs.every(([c, v]) => x[c] === v);
    let out: Row[];
    if (this.kind === "insert") { const row = { id: crypto.randomUUID(), ...this.val }; this.rows.push(row); out = [row]; }
    else if (this.kind === "upsert") {
      const keys = this.conflict.split(",");
      const ex = this.rows.find((x) => keys.every((k) => x[k] === this.val[k]));
      if (ex) { Object.assign(ex, this.val); out = [ex]; } else { const row = { id: crypto.randomUUID(), ...this.val }; this.rows.push(row); out = [row]; }
    } else if (this.kind === "update") {
      out = this.rows.filter(m); for (const x of out) Object.assign(x, this.val);
    } else if (this.kind === "delete") {
      out = this.rows.filter(m); for (const x of out) this.rows.splice(this.rows.indexOf(x), 1);
    } else out = this.rows.filter(m);
    out = out.map((x) => ({ ...x }));
    return { data: this.one ? out[0] ?? null : out, error: null as null };
  }
}
const client = (t: Record<string, Row[]>) => ({ from: (n: string) => new Q(t[n] ??= []) });
const tables = (): Record<string, Row[]> => ({
  links: [{ person_a: A, person_b: B, status: "active" }], check_ins: [], check_in_dates: [], parked_notes: [], push_events: [],
  profiles: [{ id: B, settings: {} }], device_tokens: [{ id: "dev1", owner: B, enabled: true }],
});
function call(path: string, method: string, body: Row, caller: string, t: Record<string, Row[]>, headers: Record<string, string> = {}, checkIn = true) {
  const f = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(f, `no route ${method} ${path}`);
  const m = f.pattern.exec(path)!; const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = client(t);
  return f.handler({
    env: { checkIn, pushDrainSecret: "s3cret" }, req: new Request("https://x.invalid" + path, { method, headers }),
    url: new URL("https://x.invalid" + path), params, caller: { id: caller, isPreview: false, db }, service: db,
    tz: "Asia/Tehran", body: () => Promise.resolve(body),
  } as never);
}
async function rejects(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { assert(e instanceof ApiError); return e; }
  throw new Error("expected ApiError");
}

Deno.test("E32 PUT schedule stores one per person and replaces on a second PUT", async () => {
  const t = tables();
  const r = await (await call(`/checkin/${B}/schedule`, "PUT", { day: "thursday", time: "19:00" }, A, t)).json();
  assertEquals(r.schedule.remind_other, true);
  assertEquals(r.schedule.tz, "Asia/Tehran");
  assert(typeof r.schedule.next_at === "string");
  await call(`/checkin/${B}/schedule`, "PUT", { day: "friday", time: "08:30", remind_other: false }, A, t);
  assertEquals(t.check_ins.length, 1);
  assertEquals(t.check_ins[0].day, "friday");
  assertEquals(t.check_ins[0].remind_other, false);
});

Deno.test("E32 schedule: bad field named, no link, switch off", async () => {
  const t = tables();
  assertEquals((await rejects(() => call(`/checkin/${B}/schedule`, "PUT", { day: "someday", time: "19:00" }, A, t))).extra.field, "day");
  assertEquals((await rejects(() => call(`/checkin/${C}/schedule`, "PUT", { day: "monday", time: "19:00" }, A, t))).extra.where, "link");
  assertEquals((await rejects(() => call(`/checkin/${B}/schedule`, "PUT", { day: "monday", time: "19:00" }, A, t, {}, false))).extra.reason, "feature_off");
  assertEquals(t.check_ins.length, 0);
});

Deno.test("E32 the other person cannot read or delete my schedule", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", { day: "monday", time: "19:00" }, A, t);
  const home = await (await call("/checkin", "GET", {}, B, t)).json();
  assertEquals(home.check_ins, []);
  await call(`/checkin/${A}/schedule`, "DELETE", {}, B, t);
  assertEquals(t.check_ins.length, 1);
});

Deno.test("E32 home rows: numbers only, parked counted, no text", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", { day: "thursday", time: "19:00" }, A, t);
  t.parked_notes.push(
    { id: "n1", writer: A, partner: B, text: "secret words one", state: "parked", origin: "bridged" },
    { id: "n2", writer: A, partner: B, text: "secret words two", state: "parked", origin: "topic" },
    { id: "n3", writer: A, partner: B, text: "done", state: "talked" },
  );
  const res = await (await call("/checkin", "GET", {}, A, t)).json();
  assertEquals(res.check_ins.length, 1);
  assertEquals(res.check_ins[0].parked, 2);
  assertEquals(res.check_ins[0].person_id, B);
  assert(!JSON.stringify(res).includes("secret"));
  const one = await (await call(`/checkin/${B}`, "GET", {}, A, t)).json();
  assertEquals(one.parked, 2);
  assertEquals(one.schedule.day, "thursday");
  assertEquals(one.notes.map((n: Row) => n.origin).sort(), ["bridged", "note", "topic"]);
});

Deno.test("E32 DELETE schedule never loses the parked words (E39: they come back in the reply as drafts)", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", { day: "monday", time: "19:00" }, A, t);
  t.parked_notes.push({ id: "n1", writer: A, partner: B, text: "x", state: "parked" });
  const res = await (await call(`/checkin/${B}/schedule`, "DELETE", {}, A, t)).json();
  assertEquals(t.check_ins.length, 0);
  assertEquals(res.drafts.map((d: Row) => d.text), ["x"]);
});

Deno.test("E32 reminders: queued once per occurrence, to the other person, only within the hour", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", { day: "thursday", time: "19:00" }, A, t);
  t.check_ins[0].status = "active"; // E33: reminders only go for accepted check-ins
  const at = nextOccurrence({ repeats: "weekly", day: "thursday", time: "19:00", tz: "Asia/Tehran", remind_other: true }, Date.now());
  assertEquals((await queueCheckInReminders(client(t) as never, at - 3 * 3600_000)).queued, 0);
  assertEquals((await queueCheckInReminders(client(t) as never, at - 30 * 60_000)).queued, 1);
  assertEquals((await queueCheckInReminders(client(t) as never, at - 20 * 60_000)).queued, 0, "second run is a no-op");
  assertEquals(t.push_events.length, 1);
  assertEquals(t.push_events[0].owner, B);
  assertEquals(t.push_events[0].kind, "checkin_reminder");
  assertEquals(t.push_events[0].route_target_id, A);
  assert(!JSON.stringify(t.push_events).includes("secret"));
});

Deno.test("E32 reminders respect remind_other off, notify off, an ended link", async () => {
  for (const mut of [
    (t: Record<string, Row[]>) => { t.check_ins[0].remind_other = false; },
    (t: Record<string, Row[]>) => { t.profiles[0].settings = { notify: { talk_reminders: false } }; },
    (t: Record<string, Row[]>) => { t.links[0].status = "ended"; },
  ]) {
    const t = tables();
    await call(`/checkin/${B}/schedule`, "PUT", { day: "thursday", time: "19:00" }, A, t);
    t.check_ins[0].status = "active"; // E33
    mut(t);
    const at = nextOccurrence({ repeats: "weekly", day: "thursday", time: "19:00", tz: "Asia/Tehran", remind_other: true }, Date.now());
    assertEquals((await queueCheckInReminders(client(t) as never, at - 10 * 60_000)).queued, 0);
  }
});

Deno.test("E32 the remind route is not found without the secret", async () => {
  const t = tables();
  assertEquals((await call("/internal/checkin/remind", "POST", {}, A, t)).status, 404);
  assertEquals((await (await call("/internal/checkin/remind", "POST", {}, A, t, { "x-presence-push-secret": "s3cret" })).json()).queued, 0);
});

Deno.test("E32 the push payload carries no words, only the check-in route", () => {
  const p = pushPayload({ id: "e1", kind: "checkin_reminder", route_target_id: A }) as { aps: Record<string, unknown>; presence: Record<string, unknown> };
  assertEquals(p.aps.alert, { "title-loc-key": "PRESENCE_TITLE", "loc-key": "PUSH_CHECKIN_REMINDER" });
  assertEquals(p.presence.route, "checkin");
  assertEquals(p.aps.category, "CHECKIN_REMINDER");
});

Deno.test("E32 Park it rejects an unknown origin or a malformed reference before any model call", async () => {
  const t = tables();
  assertEquals((await rejects(() => call(`/checkin/${B}/notes`, "POST", { text: "hi", origin: "email" }, A, t))).extra.field, "origin");
  assertEquals((await rejects(() => call(`/checkin/${B}/notes`, "POST", { text: "hi", origin: "bridged", origin_ref: "nope" }, A, t))).extra.field, "origin_ref");
  assertEquals(t.parked_notes.length, 0);
});

Deno.test("E36 PUT schedule takes fortnightly and monthly; a fortnightly keeps its anchor on a second PUT", async () => {
  const t = tables();
  const r = await (await call(`/checkin/${B}/schedule`, "PUT", { day: "thursday", time: "19:00", repeats: "fortnightly" }, A, t)).json();
  assertEquals(r.schedule.repeats, "fortnightly");
  const anchor = t.check_ins[0].anchor;
  assert(typeof anchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(anchor));
  t.check_ins[0].anchor = "2026-01-01";
  await call(`/checkin/${B}/schedule`, "PUT", { day: "friday", time: "19:00", repeats: "fortnightly" }, A, t);
  assertEquals(t.check_ins[0].anchor, "2026-01-01");
  await call(`/checkin/${B}/schedule`, "PUT", { day: "friday", time: "19:00", repeats: "monthly" }, A, t);
  assertEquals([t.check_ins[0].repeats, t.check_ins[0].anchor], ["monthly", null]);
  assertEquals((await rejects(() => call(`/checkin/${B}/schedule`, "PUT", { day: "friday", time: "19:00", repeats: "daily" }, A, t))).extra.field, "repeats");
});

Deno.test("E36 one date: stored beside the repeating check-in, echoed on GET /checkin (dated) and GET /checkin/:person, past ones hidden", async () => {
  const t = tables();
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await call(`/checkin/${B}/schedule`, "PUT", { day: "thursday", time: "19:00" }, A, t);
  const r = await (await call(`/checkin/${B}/schedule`, "PUT", { on: day, time: "20:30", tz: "UTC" }, A, t)).json();
  assertEquals([r.dated.on, r.dated.time, r.dated.person_id, r.dated.status], [day, "20:30", B, "invited"]);
  await call(`/checkin/${B}/schedule`, "PUT", { on: day, time: "21:00", tz: "UTC" }, A, t);   // same date again: replaced, not doubled
  assertEquals(t.check_in_dates.length, 1);
  assertEquals(t.check_ins.length, 1, "the repeating check-in is untouched");
  t.check_in_dates.push({ id: "old", owner: A, person: B, on_date: "2020-01-01", time: "10:00", tz: "UTC", status: "active" });
  const home = await (await call("/checkin", "GET", {}, A, t)).json();
  assertEquals(home.check_ins.length, 1);
  assertEquals(home.dated.map((d: Row) => d.on), [day]);
  assertEquals(home.dated[0].time, "21:00");
  const one = await (await call(`/checkin/${B}`, "GET", {}, A, t)).json();
  assertEquals(one.dated.length, 1);
  assertEquals((await (await call("/checkin", "GET", {}, B, t)).json()).dated, [], "the other person does not see it as theirs");
  await call(`/checkin/dated/${home.dated[0].id}`, "DELETE", {}, B, t);
  assertEquals(t.check_in_dates.length, 2, "only its owner can delete");
  await call(`/checkin/dated/${home.dated[0].id}`, "DELETE", {}, A, t);
  assertEquals(t.check_in_dates.length, 1);
});

Deno.test("E36 one date: bad forms name the field", async () => {
  const t = tables();
  assertEquals((await rejects(() => call(`/checkin/${B}/schedule`, "PUT", { on: "2020-01-01", time: "19:00" }, A, t))).extra.field, "on");
  assertEquals((await rejects(() => call(`/checkin/${B}/schedule`, "PUT", { on: "2099-01-01", time: "19:00", repeats: "weekly" }, A, t))).extra.field, "repeats");
  assertEquals(t.check_in_dates.length, 0);
});

Deno.test("E36 accept answers the dated ones too; a dated check-in is reminded once, within the hour, only when accepted", async () => {
  const t = tables();
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await call(`/checkin/${B}/schedule`, "PUT", { on: day, time: "20:30", tz: "UTC" }, A, t);
  const at = Date.parse(`${day}T20:30:00Z`);
  assertEquals((await queueCheckInReminders(client(t) as never, at - 30 * 60_000)).queued, 0, "not accepted yet");
  const acc = await call(`/checkin/${A}/accept`, "POST", {}, B, t);
  assertEquals(acc.status, 200);
  assertEquals(t.check_in_dates[0].status, "active");
  assertEquals((await queueCheckInReminders(client(t) as never, at - 3 * 3600_000)).queued, 0);
  assertEquals((await queueCheckInReminders(client(t) as never, at - 30 * 60_000)).queued, 1);
  assertEquals((await queueCheckInReminders(client(t) as never, at - 20 * 60_000)).queued, 0);
});

Deno.test("E37 Just you: PUT /checkin/self/schedule needs no link, is active, and GET /checkin returns it with person_id null", async () => {
  const t = tables();
  t.links.length = 0;   // no link to anyone
  const r = await (await call(`/checkin/self/schedule`, "PUT", { day: "sunday", time: "09:00", repeats: "weekly" }, A, t)).json();
  assertEquals([r.schedule.person_id, r.schedule.status, r.schedule.repeats], [null, "active", "weekly"]);
  await call(`/checkin/self/schedule`, "PUT", { day: "monday", time: "08:00" }, A, t);
  assertEquals(t.check_ins.length, 1, "one repeating Just you row, replaced");
  assertEquals(t.check_ins[0].day, "monday");
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const d = await (await call(`/checkin/self/schedule`, "PUT", { on: day, time: "07:00", tz: "UTC" }, A, t)).json();
  assertEquals([d.dated.person_id, d.dated.status], [null, "active"]);
  await call(`/checkin/self/schedule`, "PUT", { on: day, time: "07:30", tz: "UTC" }, A, t);
  assertEquals(t.check_in_dates.length, 1);
  const home = await (await call("/checkin", "GET", {}, A, t)).json();
  assertEquals(home.check_ins.map((c: Row) => [c.person_id, c.parked, c.status]), [[null, 0, "active"]]);
  assertEquals(home.dated.map((x: Row) => [x.person_id, x.time]), [[null, "07:30"]]);
  const one = await (await call(`/checkin/self`, "GET", {}, A, t)).json();
  assertEquals([one.schedule.person_id, one.dated.length, one.notes], [null, 1, []]);
  await call(`/checkin/self/schedule`, "DELETE", {}, A, t);
  assertEquals(t.check_ins.length, 0);
});

Deno.test("E37 Just you never invites, parks or notifies anyone", async () => {
  const t = tables();
  await call(`/checkin/self/schedule`, "PUT", { day: "thursday", time: "19:00" }, A, t);
  const at = nextOccurrence({ repeats: "weekly", day: "thursday", time: "19:00", tz: "Asia/Tehran", remind_other: true }, Date.now());
  assertEquals((await queueCheckInReminders(client(t) as never, at - 30 * 60_000)).queued, 0);
  assertEquals(t.push_events.length, 0);
  assertEquals((await call(`/checkin/invites`, "GET", {}, B, t).then((r) => r.json())).invites, [], "nobody is invited");
  assertEquals((await rejects(() => call(`/checkin/self/notes`, "POST", { text: "x" }, A, t))).extra.reason, "just_you");
  assertEquals((await rejects(() => call(`/checkin/self/accept`, "POST", {}, A, t))).extra.reason, "just_you");
  assertEquals(t.parked_notes.length, 0);
});

// ------------------------------------------------------------------ E38 / E39 / E40
import { nextCheckInAt } from "../api/checkin.ts";
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const dated = (over: Row): Row => ({ id: crypto.randomUUID(), owner: A, person: B, on_date: inDays(2), time: "19:00", tz: "Asia/Tehran", remind_other: true, status: "active", ...over });

Deno.test("E38 next_checkin is the soonest ACCEPTED check-in with that person, repeating or dated", async () => {
  const t = tables();
  // Day chosen 4 days ahead so "the day before" is always still in the future (no calendar dependence).
  const day = new Date(Date.now() + 4 * 864e5).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Tehran" }).toLowerCase();
  await call(`/checkin/${B}/schedule`, "PUT", { day, time: "19:00" }, A, t);
  t.check_ins[0].status = "active";
  const repeating = nextOccurrence({ repeats: "weekly", day: day as never, time: "19:00", tz: "Asia/Tehran", remind_other: true }, Date.now());
  const soon = dated({ on_date: new Date(repeating - 86400_000).toISOString().slice(0, 10), time: "12:00" });
  const late = dated({ on_date: new Date(repeating + 3 * 86400_000).toISOString().slice(0, 10) });
  t.check_in_dates.push(late);
  assertEquals(await nextCheckInAt(client(t) as never, A, B), new Date(repeating).toISOString(), "the later dated one loses to the repeating one");
  t.check_in_dates.push(soon);
  const got = Date.parse(await nextCheckInAt(client(t) as never, A, B));
  assert(got < repeating, "an earlier accepted dated one wins");
  soon.status = "invited"; // not yet accepted: ignored
  assertEquals(await nextCheckInAt(client(t) as never, A, B), new Date(repeating).toISOString());
});

Deno.test("E38 dated-only, only-invited and none", async () => {
  const t = tables();
  assertEquals((await rejects(() => nextCheckInAt(client(t) as never, A, B))).extra.reason, "no_check_in");
  t.check_in_dates.push(dated({ status: "invited" }));
  assertEquals((await rejects(() => nextCheckInAt(client(t) as never, A, B))).extra.reason, "not_accepted");
  t.check_in_dates[0].status = "active";
  assert(Date.parse(await nextCheckInAt(client(t) as never, A, B)) > Date.now(), "a dated accepted check-in alone is enough");
  t.check_in_dates[0].on_date = "2020-01-01"; // past dates do not count
  assertEquals((await rejects(() => nextCheckInAt(client(t) as never, A, B))).extra.reason, "no_check_in");
});

Deno.test("E39 DELETE returns the writer's parked items as drafts and withdraws parked bridges; the other row leaves their list", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", { day: "monday", time: "19:00" }, A, t);
  t.bridges = [{ id: "br1", sender: A, receiver: B, status: "scheduled", opened_at: null, final: "I felt left out" }];
  t.parked_notes.push(
    { id: "n1", writer: A, partner: B, text: "weekend plans", state: "parked", origin: "topic" },
    { id: "n2", writer: A, partner: B, text: "I felt left out", state: "parked", origin: "bridged", origin_ref: "br1" },
    { id: "n3", writer: A, partner: B, text: "already done", state: "talked" },
    { id: "n4", writer: C, partner: B, text: "someone else's", state: "parked" },
  );
  const res = await (await call(`/checkin/${B}/schedule`, "DELETE", {}, A, t)).json();
  assertEquals(res.deleted, true);
  assertEquals(res.drafts.map((d: Row) => [d.origin, d.text]).sort(), [["bridged", "I felt left out"], ["topic", "weekend plans"]]);
  assertEquals(t.check_ins.length, 0);
  assertEquals((await (await call("/checkin/invites", "GET", {}, B, t)).json()).invites, []);
  assertEquals(t.bridges[0].status, "withdrawn", "the parked bridge is pulled; the receiver sees nothing");
  assertEquals(t.parked_notes.map((n) => n.id).sort(), ["n3", "n4"], "returned drafts leave the list; talked and others' stay");
  assert(t.push_events.length === 0, "content-free: no notification");
  // idempotent: a second call returns nothing
  assertEquals((await (await call(`/checkin/${B}/schedule`, "DELETE", {}, A, t)).json()).drafts, []);
});

Deno.test("E39 an opened bridge is not withdrawn; dated check-ins left keep the notes where they are; Just you has no drafts", async () => {
  const t = tables();
  t.bridges = [{ id: "brO", sender: A, receiver: B, status: "scheduled", opened_at: "2026-11-01T00:00:00Z" }];
  await call(`/checkin/${B}/schedule`, "PUT", { day: "monday", time: "19:00" }, A, t);
  t.parked_notes.push({ id: "n9", writer: A, partner: B, text: "sent already", state: "parked", origin: "bridged", origin_ref: "brO" });
  await call(`/checkin/${B}/schedule`, "DELETE", {}, A, t);
  assertEquals(t.bridges[0].status, "scheduled", "an opened bridge stays as it was");
  t.parked_notes.length = 0;
  await call(`/checkin/${B}/schedule`, "PUT", { day: "monday", time: "19:00" }, A, t);
  t.check_in_dates.push(dated({}));
  t.parked_notes.push({ id: "n1", writer: A, partner: B, text: "keep me here", state: "parked", origin: "topic" });
  const res = await (await call(`/checkin/${B}/schedule`, "DELETE", {}, A, t)).json();
  assertEquals(res.drafts, [], "a dated check-in is still to come, so the note still has somewhere to go");
  assertEquals(t.parked_notes.length, 1);
  assertEquals(t.check_in_dates.length, 1);
  await call("/checkin/self/schedule", "PUT", { day: "sunday", time: "09:00" }, A, t);
  assertEquals((await (await call("/checkin/self/schedule", "DELETE", {}, A, t)).json()).drafts, []);
});

Deno.test("E40 GET /checkin rows carry accepted_at, moved_at and moved_by; the other person sees accepted ones as incoming", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", { day: "sunday", time: "19:00" }, A, t);
  let row = (await (await call("/checkin", "GET", {}, A, t)).json()).check_ins[0];
  assertEquals([row.accepted_at, row.moved_at, row.moved_by], [null, null, null]);
  await call(`/checkin/${A}/accept`, "POST", {}, B, t);
  row = (await (await call("/checkin", "GET", {}, A, t)).json()).check_ins[0];
  assert(typeof row.accepted_at === "string");
  assertEquals(row.moved_at, null);
  // remind-only change is not a move
  await call(`/checkin/${B}/schedule`, "PUT", { day: "sunday", time: "19:00", remind_other: false }, A, t);
  assertEquals((await (await call("/checkin", "GET", {}, A, t)).json()).check_ins[0].moved_at, null);
  // a new day or time on an accepted check-in is a move
  await call(`/checkin/${B}/schedule`, "PUT", { day: "monday", time: "19:00" }, A, t);
  row = (await (await call("/checkin", "GET", {}, A, t)).json()).check_ins[0];
  assert(typeof row.moved_at === "string");
  assertEquals(row.moved_by, A);
  const mine = await (await call("/checkin", "GET", {}, B, t)).json();
  assertEquals(mine.check_ins, []);
  assertEquals(mine.incoming.length, 1);
  assertEquals([mine.incoming[0].person_id, mine.incoming[0].day, mine.incoming[0].moved_by], [A, "monday", A]);
  assert(!JSON.stringify(mine).includes("secret"));
});

Deno.test("E40 an invited check-in that is edited before acceptance is not 'moved'", async () => {
  const t = tables();
  await call(`/checkin/${B}/schedule`, "PUT", { day: "sunday", time: "19:00" }, A, t);
  await call(`/checkin/${B}/schedule`, "PUT", { day: "monday", time: "20:00" }, A, t);
  const row = (await (await call("/checkin", "GET", {}, A, t)).json()).check_ins[0];
  assertEquals(row.moved_at, null);
  assertEquals((await (await call("/checkin", "GET", {}, B, t)).json()).incoming, [], "invites are listed on /checkin/invites, not as incoming");
});

Deno.test("V25 Let go: DELETE /checkin/notes/:id hard-deletes the writer's own note; nobody else's; a parked bridge is withdrawn", async () => {
  const t = tables();
  t.bridges = [{ id: "br1", sender: A, receiver: B, status: "scheduled", opened_at: null }, { id: "brO", sender: A, receiver: B, status: "scheduled", opened_at: "2026-11-01T00:00:00Z" }];
  t.parked_notes.push(
    { id: "n1", writer: A, partner: B, text: "weekend plans", state: "parked", origin: "topic" },
    { id: "n2", writer: A, partner: B, text: "I felt left out", state: "parked", origin: "bridged", origin_ref: "br1" },
    { id: "n3", writer: A, partner: B, text: "talked already", state: "talked", origin: "note" },
    { id: "n4", writer: A, partner: B, text: "sent already", state: "later", origin: "bridged", origin_ref: "brO" },
  );
  // not the writer: 404, nothing deleted
  const other = await rejects(() => call("/checkin/notes/n1", "DELETE", {}, C, t));
  assertEquals(other.code, "not_found");
  assertEquals(t.parked_notes.length, 4);
  // the partner has no route to it either
  assertEquals((await rejects(() => call("/checkin/notes/n1", "DELETE", {}, B, t))).code, "not_found");
  // writer: gone for good, in any state
  assertEquals(await (await call("/checkin/notes/n1", "DELETE", {}, A, t)).json(), { deleted: true });
  assertEquals(await (await call("/checkin/notes/n3", "DELETE", {}, A, t)).json(), { deleted: true });
  assertEquals(t.parked_notes.map((n) => n.id).sort(), ["n2", "n4"]);
  // a parked bridge's note: the bridge is withdrawn, the receiver sees nothing
  await call("/checkin/notes/n2", "DELETE", {}, A, t);
  assertEquals(t.bridges[0].status, "withdrawn");
  // a note whose bridge was already opened leaves the bridge alone
  await call("/checkin/notes/n4", "DELETE", {}, A, t);
  assertEquals(t.bridges[1].status, "scheduled");
  assertEquals(t.parked_notes.length, 0);
  assert(t.push_events.length === 0, "content-free: no notification");
  // idempotent in effect: a second delete is 404
  assertEquals((await rejects(() => call("/checkin/notes/n1", "DELETE", {}, A, t))).code, "not_found");
});

Deno.test("V25 Let go: the route is off when check-ins are off", async () => {
  const t = tables();
  t.parked_notes.push({ id: "n1", writer: A, partner: B, text: "x", state: "parked", origin: "note" });
  assert(await rejects(() => call("/checkin/notes/n1", "DELETE", {}, A, t, {}, false)));
  assertEquals(t.parked_notes.length, 1);
});
