// V3 comm model, spec 4.4: what a check-in may show of the other person's shared items. Fake database, no model, 0 cents.
// One filter (`itemsVisibleTo`, surface "checkin") decides; these tests prove the table on the real session route.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/checkin.ts";
import "../api/checkin_session.ts";

const A = "00000000-0000-4000-8000-000000000081"; // reads
const B = "00000000-0000-4000-8000-000000000082"; // owns the shared items
const C = "00000000-0000-4000-8000-000000000083"; // someone else
const ON = { checkIn: true, commItems: true, commOwnerIds: [A, B] };
type Row = Record<string, unknown>;

class Q implements PromiseLike<{ data: unknown; error: null }> {
  kind = "select"; eqs: Array<[string, unknown]> = []; ins: Array<[string, unknown[]]> = []; nots: string[] = [];
  val: Row | Row[] = {}; one = false;
  static n = 1;
  constructor(private rows: Row[], private name: string) {}
  select() { return this; }
  insert(v: Row | Row[]) { this.kind = "insert"; this.val = v; return this; }
  update(v: Row) { this.kind = "update"; this.val = v; return this; }
  delete() { this.kind = "delete"; return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in(c: string, v: unknown[]) { this.ins.push([c, v]); return this; }
  not(c: string, op: string, v: unknown) { assertEquals([op, v], ["is", null]); this.nots.push(c); return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { return Promise.resolve(r(this.run())); }
  run() {
    const m = (x: Row) => this.eqs.every(([c, v]) => x[c] === v) && this.ins.every(([c, v]) => v.includes(x[c])) && this.nots.every((c) => x[c] !== null && x[c] !== undefined);
    let out: Row[];
    if (this.kind === "insert") {
      out = (Array.isArray(this.val) ? this.val : [this.val]).map((v) => ({ id: `${this.name}-${Q.n++}`, created_at: new Date().toISOString(), ...v }));
      this.rows.push(...out);
    } else if (this.kind === "update") { out = this.rows.filter(m); for (const x of out) Object.assign(x, this.val); }
    else if (this.kind === "delete") { out = this.rows.filter(m); for (const x of out) this.rows.splice(this.rows.indexOf(x), 1); }
    else out = this.rows.filter(m);
    out = out.map((x) => ({ ...x }));
    return { data: this.one ? out[0] ?? null : out, error: null as null };
  }
}
const client = (t: Record<string, Row[]>) => ({ from: (n: string) => new Q(t[n] ??= [], n) });
const [LO, HI] = A < B ? [A, B] : [B, A];

let n = 0;
/** One shared item of B's, as the beliefs table stores it. */
function item(kind: string, wording: string, o: Row = {}): Row {
  n++;
  return {
    id: `b${n}`, owner: B, status: "confirmed", own_wording: wording, statement: wording, comm_kind: kind,
    comm_scope_type: "everyone", comm_scope_value: null, comm_when: null, comm_expires_at: null, comm_status: "active", comm_topic: null,
    created_at: `2026-11-1${n % 9}T00:00:00Z`, ...o,
  };
}
const tables = (beliefs: Row[], prefs: Row[] = []): Record<string, Row[]> => ({
  links: [{ person_a: LO, person_b: HI, status: "active" }],
  check_ins: [{ owner: A, person: B, status: "active" }],
  check_in_dates: [], parked_notes: [], link_prefs: prefs, engine_calls: [], beliefs,
  checkin_sessions: [], checkin_session_parts: [], checkin_session_items: [],
});
function call(path: string, method: string, caller: string, t: Record<string, Row[]>, env: Row = ON) {
  const f = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(f, `no route ${method} ${path}`);
  const m = f.pattern.exec(path)!; const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = client(t);
  return f.handler({
    env, req: new Request("https://x.invalid" + path, { method }), url: new URL("https://x.invalid" + path), params,
    caller: { id: caller, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve({}),
  } as never).then((r: Response) => r.json());
}
/** A session in phase "items": both people have given their text-free mark. */
async function inItems(t: Record<string, Row[]>) {
  const s = (await call(`/checkin/${B}/session`, "POST", A, t)).session;
  t.checkin_sessions[0].first = A;
  await call(`/checkin/session/${s.id}/said`, "PUT", A, t);
  await call(`/checkin/session/${s.id}/said`, "PUT", B, t);
}
const sharedFor = async (t: Record<string, Row[]>, env: Row = ON) => (await call(`/checkin/${B}/session`, "GET", A, t, env)).session.theirs.shared as Array<Row>;

Deno.test("only the four check-in kinds show, as words by kind, in kind order, with no ids", async () => {
  const t = tables([
    item("bring_up", "It helps me hear it when you start with what went well."),
    item("feels_like_care", "I feel looked after when you check in after a long day."),
    item("coming_back", "After a hard moment, it helps when you ask for a few minutes first.", { comm_scope_type: "person", comm_scope_value: A }),
    item("this_week", "This week I'm short on sleep.", { comm_scope_type: "person", comm_scope_value: A, comm_expires_at: "2099-01-01T00:00:00Z" }),
    // never on a check-in screen
    item("lands_hard", "It's hard for me to hear that I forgot.", { comm_scope_type: "person", comm_scope_value: A }),
    item("gets_heated", "When it gets tense, I go quiet.", { comm_scope_type: "person", comm_scope_value: A }),
    item("matters", "What matters to me is time outside."), item("other", "A thing about me."), item("how_i_mean", "When I go quiet, I'm thinking."),
  ]);
  await inItems(t);
  const shared = await sharedFor(t);
  assertEquals(shared.map((s) => s.kind), ["this_week", "feels_like_care", "bring_up", "coming_back"]);
  for (const s of shared) assertEquals(Object.keys(s).sort(), ["heading", "kind", "when", "wording"]);
  assertEquals(shared[1].heading, "What feels like care");
});

Deno.test("a shared lands_hard never appears on any check-in screen, in either phase or either person's view", async () => {
  const lands = item("lands_hard", "It's hard for me to hear that I forgot.", { comm_scope_type: "person", comm_scope_value: A });
  const t = tables([lands, item("bring_up", "It helps me hear it when you start gently.")]);
  await inItems(t);
  assertEquals((await sharedFor(t)).map((s) => s.kind), ["bring_up"]);
  // the whole response, not only the shared list
  const raw = JSON.stringify(await call(`/checkin/${B}/session`, "GET", A, t));
  assert(!raw.includes("hard for me to hear") && !raw.includes("lands_hard"));
  // the owner of the item reads the other direction: nothing of their own is echoed back either
  const fromB = JSON.stringify(await call(`/checkin/${A}/session`, "GET", B, t));
  assert(!fromB.includes("hard for me to hear") && !fromB.includes("lands_hard"));
});

Deno.test("private_only, set aside, expired and other people's scopes never show", async () => {
  const t = tables([
    item("bring_up", "private one", { comm_status: "private_only" }),
    item("bring_up", "set aside one", { comm_status: "set_aside" }),
    item("this_week", "expired one", { comm_expires_at: "2020-01-01T00:00:00Z", comm_scope_type: "person", comm_scope_value: A }),
    item("feels_like_care", "for someone else", { comm_scope_type: "person", comm_scope_value: C }),
    item("feels_like_care", "not confirmed", { status: "inferred" }),
    item("feels_like_care", "for everyone"),
  ]);
  await inItems(t);
  assertEquals((await sharedFor(t)).map((s) => s.wording), ["for everyone"]);
});

Deno.test("a type scope shows only when the item's owner labels the reader with that type (friend is friends)", async () => {
  const mk = (prefs: Row[]) => tables([item("bring_up", "for friends", { comm_scope_type: "type", comm_scope_value: "friends" })], prefs);
  let t = mk([{ owner: B, other: A, relationship: "friend" }]); await inItems(t);
  assertEquals((await sharedFor(t)).map((s) => s.wording), ["for friends"]);
  t = mk([{ owner: B, other: A, relationship: "partner" }]); await inItems(t);
  assertEquals(await sharedFor(t), []);
  t = mk([]); await inItems(t);      // no label: the conservative reading, not shown
  assertEquals(await sharedFor(t), []);
});

Deno.test("items show only in the items phase, and only with the owner switch on for the reader", async () => {
  const t = tables([item("bring_up", "It helps when you start gently.")]);
  const s = (await call(`/checkin/${B}/session`, "POST", A, t)).session;
  assertEquals(s.theirs.shared, []);                       // appreciations phase
  t.checkin_sessions[0].first = A;
  await call(`/checkin/session/${s.id}/said`, "PUT", A, t);
  await call(`/checkin/session/${s.id}/said`, "PUT", B, t);
  assertEquals((await sharedFor(t)).length, 1);
  assertEquals(await sharedFor(t, { checkIn: true, commItems: false, commOwnerIds: [A, B] }), []);
  assertEquals(await sharedFor(t, { checkIn: true, commItems: true, commOwnerIds: [B] }), []);   // reader not on the owner list
  assertEquals(await sharedFor(t, { checkIn: true }), []);
});

Deno.test("nothing about shared items is written to the session", async () => {
  const t = tables([item("bring_up", "It helps when you start gently.")]);
  await inItems(t);
  await sharedFor(t);
  const stored = JSON.stringify([t.checkin_sessions, t.checkin_session_parts, t.checkin_session_items]);
  assert(!stored.includes("start gently") && !stored.includes("bring_up"));
});
