// Contract v1.53: the shared check-in session (board 28, CPO conditions). Fake database, recorded model, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import { hooks } from "../api/checkin.ts";
import "../api/checkin.ts";
import "../api/checkin_session.ts";

const A = "00000000-0000-4000-8000-000000000081";
const B = "00000000-0000-4000-8000-000000000082";
const C = "00000000-0000-4000-8000-000000000083";
const ON = { checkIn: true };
type Row = Record<string, unknown>;

class Q implements PromiseLike<{ data: unknown; error: null }> {
  kind = "select"; eqs: Array<[string, unknown]> = []; ins: Array<[string, unknown[]]> = [];
  val: Row | Row[] = {}; one = false;
  static n = 1;
  constructor(private rows: Row[], private name: string) {}
  select() { return this; }
  insert(v: Row | Row[]) { this.kind = "insert"; this.val = v; return this; }
  update(v: Row) { this.kind = "update"; this.val = v; return this; }
  delete() { this.kind = "delete"; return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in(c: string, v: unknown[]) { this.ins.push([c, v]); return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { return Promise.resolve(r(this.run())); }
  run() {
    const m = (x: Row) => this.eqs.every(([c, v]) => x[c] === v) && this.ins.every(([c, v]) => v.includes(x[c]));
    let out: Row[];
    if (this.kind === "insert") {
      out = (Array.isArray(this.val) ? this.val : [this.val]).map((v) => ({ id: `${this.name}-${Q.n++}`, created_at: new Date().toISOString(), ...v }));
      // the schema's unique keys
      for (const o of out) {
        const dupe = this.name === "checkin_session_items" && this.rows.some((x) => x.session === o.session && x.note_id === o.note_id);
        if (dupe) throw new Error("duplicate key");
      }
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
const tables = (): Record<string, Row[]> => ({
  links: [{ person_a: LO, person_b: HI, status: "active" }],
  check_ins: [{ owner: A, person: B, status: "active" }],
  check_in_dates: [],
  parked_notes: [
    { id: "a-kept", writer: A, partner: B, text: "I'd like us to plan the trip together", state: "later", created_at: "2026-11-01T00:00:00Z" },
    { id: "a-kept2", writer: A, partner: B, text: "The dishes sit a while", state: "later", created_at: "2026-11-02T00:00:00Z" },
    { id: "a-kept3", writer: A, partner: B, text: "Weekends feel short", state: "later", created_at: "2026-11-03T00:00:00Z" },
    { id: "a-parked", writer: A, partner: B, text: "never kept, never offered", state: "parked", created_at: "2026-11-04T00:00:00Z" },
    { id: "b-kept", writer: B, partner: A, text: "I get quiet when I'm tired", state: "later", created_at: "2026-11-01T00:00:00Z" },
    { id: "b-parked", writer: B, partner: A, text: "B secret not kept", state: "parked", created_at: "2026-11-02T00:00:00Z" },
  ],
  link_prefs: [], engine_calls: [], checkin_sessions: [], checkin_session_parts: [], checkin_session_items: [],
});
function reply(text: string) {
  return JSON.stringify({
    points: [{ kind: "complaint", quote: text }], frictions: [], activated: [], feeling: { name: "neutral", intensity: 1 },
    safety: { level: "none", reason: "fixture" },
  });
}
function call(path: string, method: string, body: Row, caller: string, t: Record<string, Row[]>, env: Row = ON) {
  const f = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(f, `no route ${method} ${path}`);
  const m = f.pattern.exec(path)!; const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = client(t);
  return f.handler({
    env, req: new Request("https://x.invalid" + path, { method }), url: new URL("https://x.invalid" + path), params,
    caller: { id: caller, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve(body),
  } as never).then((r: Response) => r.json());
}
async function rejects(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { assert(e instanceof ApiError); return e; }
  throw new Error("expected ApiError");
}
async function withModel(texts: string[], fn: () => Promise<void>) {
  const rc = new RecordedClient({ analyse: texts.map(reply) });
  hooks.client = () => rc;
  try { await fn(); } finally { hooks.client = null; }
}
const APP_A = "Thank you for the Sunday walk";
const APP_B = "I liked how you listened last week";

async function open(t: Record<string, Row[]>) {
  return (await call(`/checkin/${B}/session`, "POST", {}, A, t)).session;
}

Deno.test("needs an accepted check-in and the switch on; a stranger has no link", async () => {
  const t = tables(); t.check_ins = [];
  assertEquals((await rejects(() => call(`/checkin/${B}/session`, "POST", {}, A, t))).extra.reason, "no_check_in");
  t.check_ins = [{ owner: A, person: B, status: "invited" }];
  assertEquals((await rejects(() => call(`/checkin/${B}/session`, "POST", {}, A, t))).extra.reason, "no_check_in");
  assertEquals((await rejects(() => call(`/checkin/${C}/session`, "POST", {}, A, tables()))).code, "not_found");
  assertEquals((await rejects(() => call(`/checkin/${B}/session`, "POST", {}, A, tables(), { checkIn: false }))).extra.reason, "feature_off");
  // a dated check-in the other person accepted counts
  const d = tables(); d.check_ins = []; d.check_in_dates = [{ owner: B, person: A, status: "active" }];
  assert((await open(d)).id);
});

Deno.test("either person opens; one at a time; opening again returns the same session", async () => {
  const t = tables();
  const s1 = await open(t);
  const s2 = (await call(`/checkin/${A}/session`, "POST", {}, B, t)).session;
  assertEquals(s2.id, s1.id);
  assertEquals(s1.opened_by_me, true);
  assertEquals(s2.opened_by_me, false);
  assertEquals(t.checkin_sessions.length, 1);
  assertEquals(s1.phase, "appreciations");
  // nothing of either person's notes is visible or offered in the first phase
  for (const v of [s1, s2]) { assertEquals(v.mine.eligible, []); assertEquals(v.theirs.brought, []); assertEquals(v.theirs.appreciation, null); }
});

Deno.test("one appreciation each first; theirs stays hidden until both are in", () =>
  withModel([APP_A, APP_B], async () => {
    const t = tables(); const s = await open(t);
    let r = await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_A }, A, t);
    assertEquals(r.state, "ok"); assertEquals(r.session.phase, "appreciations"); assertEquals(r.session.mine.appreciation, APP_A);
    // B still sees none of A's words, and a second appreciation from A is refused
    assertEquals((await call(`/checkin/${A}/session`, "GET", {}, B, t)).session.theirs.appreciation, null);
    assertEquals((await rejects(() => call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: "again" }, A, t))).extra.reason, "already_given");
    // bringing before both are in is refused
    assertEquals((await rejects(() => call(`/checkin/session/${s.id}/items/a-kept`, "PUT", { bring: true }, A, t))).extra.reason, "appreciation_first");
    r = await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_B }, B, t);
    assertEquals(r.session.phase, "items");
    assertEquals(r.session.theirs.appreciation, APP_A);
    assertEquals((await call(`/checkin/${B}/session`, "GET", {}, A, t)).session.theirs.appreciation, APP_B);
  }));

Deno.test("appreciation text: empty or oversized is invalid", async () => {
  const t = tables(); const s = await open(t);
  for (const text of ["", "  ", "x".repeat(601)]) {
    assertEquals((await rejects(() => call(`/checkin/session/${s.id}/appreciation`, "PUT", { text }, A, t))).extra.field, "text");
  }
});

Deno.test("law 8: a risk appreciation stores nothing and shows resources to the writer only", async () => {
  const t = tables(); const s = await open(t);
  const r = await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: "I want to kill myself" }, A, t);
  assertEquals(r.state, "risk"); assertEquals(r.session, null); assert(r.resources && r.line);
  assert(t.checkin_session_parts.every((p) => p.appreciation === undefined || p.appreciation === null));
  assertEquals(t.engine_calls.length, 0, "the keyword floor caught it before any model call");
});

Deno.test("items: only my own kept notes are offered; two at most; the other sees only what was brought, by words alone", () =>
  withModel([APP_A, APP_B], async () => {
    const t = tables(); const s = await open(t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_A }, A, t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_B }, B, t);
    const v = (await call(`/checkin/${B}/session`, "GET", {}, A, t)).session;
    assertEquals(v.mine.eligible.map((n: Row) => n.note_id), ["a-kept", "a-kept2", "a-kept3"]);
    assert(!JSON.stringify(v).includes("never kept"), "a parked (not kept) note is never offered");
    assert(!JSON.stringify(v).includes("B secret"), "the other person's notes are not in my view");
    // before anything is brought, B sees none of A's saved words
    assertEquals((await call(`/checkin/${A}/session`, "GET", {}, B, t)).session.theirs.brought, []);
    await call(`/checkin/session/${s.id}/items/a-kept`, "PUT", { bring: true }, A, t);
    const two = await call(`/checkin/session/${s.id}/items/a-kept2`, "PUT", { bring: true }, A, t);
    assertEquals(two.session.mine.brought.length, 2); assertEquals(two.session.mine.can_bring_more, false);
    assertEquals((await rejects(() => call(`/checkin/session/${s.id}/items/a-kept3`, "PUT", { bring: true }, A, t))).extra.reason, "limit");
    // not kept / not mine / unknown are the same 404
    for (const [who, note] of [[A, "a-parked"], [A, "b-kept"], [A, "nope"], [B, "a-kept"]] as const) {
      assertEquals((await rejects(() => call(`/checkin/session/${s.id}/items/${note}`, "PUT", { bring: true }, who, t))).code, "not_found");
    }
    // idempotent re-bring
    assertEquals((await call(`/checkin/session/${s.id}/items/a-kept`, "PUT", { bring: true }, A, t)).session.mine.brought.length, 2);
    const theirView = (await call(`/checkin/${A}/session`, "GET", {}, B, t)).session;
    assertEquals(theirView.theirs.brought, [{ text: "I'd like us to plan the trip together", state: "parked" }, { text: "The dishes sit a while", state: "parked" }]);
    assert(!JSON.stringify(theirView.theirs).includes("a-kept"), "no note ids, no dates reach the other side");
    // taking one back is immediate
    await call(`/checkin/session/${s.id}/items/a-kept`, "PUT", { bring: false }, A, t);
    assertEquals((await call(`/checkin/${A}/session`, "GET", {}, B, t)).session.theirs.brought.length, 1);
  }));

Deno.test("v1.67 theirs.brought[].state: the writer's own mark, no words or time; parked until marked, then talked or later", () =>
  withModel([APP_A, APP_B], async () => {
    const t = tables(); const s = await open(t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_A }, A, t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_B }, B, t);
    await call(`/checkin/session/${s.id}/items/a-kept`, "PUT", { bring: true }, A, t);
    await call(`/checkin/session/${s.id}/items/a-kept2`, "PUT", { bring: true }, A, t);
    const at = (id: string) => t.checkin_session_items.find((i) => i.note_id === id)!;
    at("a-kept").created_at = at("a-kept2").created_at = "2026-11-12T20:00:00Z";
    // kept through "Still matters?" before the check-in: still 'later', but not marked here yet
    t.parked_notes.find((n) => n.id === "a-kept2")!.updated_at = "2026-11-10T00:00:00Z";
    let v = (await call(`/checkin/${A}/session`, "GET", {}, B, t)).session;
    assertEquals(v.theirs.brought.map((n: Row) => n.state), ["parked", "parked"]);
    // A marks one Talked about it and the other Next week (the writer's own PATCH /checkin/notes/:id)
    Object.assign(t.parked_notes.find((n) => n.id === "a-kept")!, { state: "talked", updated_at: "2026-11-12T20:05:00Z" });
    Object.assign(t.parked_notes.find((n) => n.id === "a-kept2")!, { state: "later", updated_at: "2026-11-12T20:06:00Z" });
    v = (await call(`/checkin/${A}/session`, "GET", {}, B, t)).session;
    assertEquals(v.theirs.brought, [{ text: "I'd like us to plan the trip together", state: "talked" }, { text: "The dishes sit a while", state: "later" }]);
    assertEquals(Object.keys(v.theirs.brought[0]).sort(), ["state", "text"], "no id, no date, no time");
    const mine = (await call(`/checkin/${B}/session`, "GET", {}, A, t)).session.mine.brought;
    assertEquals(mine.map((n: Row) => [n.note_id, n.state]), [["a-kept", "talked"], ["a-kept2", "later"]], "the writer sees the same marks");
  }));

Deno.test("a brought note the writer lets go of, or un-keeps to parked, stops showing at once", () =>
  withModel([APP_A, APP_B], async () => {
    const t = tables(); const s = await open(t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_A }, A, t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_B }, B, t);
    await call(`/checkin/session/${s.id}/items/a-kept`, "PUT", { bring: true }, A, t);
    t.parked_notes.splice(t.parked_notes.findIndex((n) => n.id === "a-kept"), 1); // Let go (v1.50)
    assertEquals((await call(`/checkin/${A}/session`, "GET", {}, B, t)).session.theirs.brought, []);
  }));

Deno.test("either person ends it; every row is gone; a stranger or a stale id is 404", () =>
  withModel([APP_A], async () => {
    const t = tables(); const s = await open(t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_A }, A, t);
    assertEquals((await rejects(() => call(`/checkin/session/${s.id}/close`, "POST", {}, C, t))).code, "not_found");
    assertEquals(await call(`/checkin/session/${s.id}/close`, "POST", {}, B, t), { closed: true });
    assertEquals([t.checkin_sessions.length, t.checkin_session_parts.length, t.checkin_session_items.length], [0, 0, 0]);
    assertEquals((await call(`/checkin/${B}/session`, "GET", {}, A, t)).session, null);
    assertEquals((await rejects(() => call(`/checkin/session/${s.id}/close`, "POST", {}, A, t))).code, "not_found");
    // the notes themselves are untouched, and no mark was made for the user
    assertEquals(t.parked_notes.length, 6);
    assertEquals(t.parked_notes.filter((n) => n.state === "talked").length, 0);
  }));

Deno.test("board 28 roll-over: end deletes appreciations and brought 'talked' notes only; kept and unbrought notes roll over", () =>
  withModel([APP_A, APP_B, APP_A, APP_B], async () => {
    const t = tables(); const s = await open(t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_A }, A, t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_B }, B, t);
    await call(`/checkin/session/${s.id}/items/a-kept`, "PUT", { bring: true }, A, t);
    await call(`/checkin/session/${s.id}/items/a-kept2`, "PUT", { bring: true }, A, t);
    await call(`/checkin/session/${s.id}/items/b-kept`, "PUT", { bring: true }, B, t);
    // A marks a-kept 'Talked about it'; a-kept2 stays kept (Next week); a-kept3 was never brought
    t.parked_notes.find((n) => n.id === "a-kept")!.state = "talked";
    await call(`/checkin/session/${s.id}/close`, "POST", {}, B, t);
    assertEquals(t.parked_notes.map((n) => n.id).sort(), ["a-kept2", "a-kept3", "a-parked", "b-kept", "b-parked"]);
    assertEquals(t.parked_notes.find((n) => n.id === "a-kept2")!.state, "later");
    assertEquals([t.checkin_sessions.length, t.checkin_session_parts.length, t.checkin_session_items.length], [0, 0, 0]);
    // next check-in: the rolled-over notes are eligible again
    const s2 = await open(t);
    await call(`/checkin/session/${s2.id}/appreciation`, "PUT", { text: APP_A }, A, t);
    await call(`/checkin/session/${s2.id}/appreciation`, "PUT", { text: APP_B }, B, t);
    const v = (await call(`/checkin/${B}/session`, "GET", {}, A, t)).session;
    assertEquals(v.mine.eligible.map((n: Row) => n.note_id).sort(), ["a-kept2", "a-kept3"]);
  }));

Deno.test("board 28 roll-over: expiry does the same", () =>
  withModel([APP_A, APP_B], async () => {
    const t = tables(); const s = await open(t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_A }, A, t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_B }, B, t);
    await call(`/checkin/session/${s.id}/items/a-kept`, "PUT", { bring: true }, A, t);
    await call(`/checkin/session/${s.id}/items/a-kept2`, "PUT", { bring: true }, A, t);
    t.parked_notes.find((n) => n.id === "a-kept")!.state = "talked";
    t.checkin_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
    assertEquals((await call(`/checkin/${B}/session`, "GET", {}, A, t)).session, null);
    assertEquals(t.parked_notes.map((n) => n.id).sort(), ["a-kept2", "a-kept3", "a-parked", "b-kept", "b-parked"]);
    assertEquals(t.checkin_session_parts.length, 0);
  }));

Deno.test("an expired session reads as none and is deleted on sight", async () => {
  const t = tables(); await open(t);
  t.checkin_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assertEquals((await call(`/checkin/${B}/session`, "GET", {}, A, t)).session, null);
  assertEquals([t.checkin_sessions.length, t.checkin_session_parts.length], [0, 0]);
});

Deno.test("a removed link ends access", async () => {
  const t = tables(); const s = await open(t);
  t.links[0].status = "removed";
  assertEquals((await rejects(() => call(`/checkin/session/${s.id}/close`, "POST", {}, A, t))).extra.reason, "removed");
});

Deno.test("migration 0050: service-role only, ephemeral, no policy, account-delete hook", async () => {
  const sql = await Deno.readTextFile("../supabase/migrations/0050_checkin_session.sql");
  assert(!/create policy/i.test(sql), "no policy: only the API reads these tables");
  for (const t of ["checkin_sessions", "checkin_session_parts", "checkin_session_items"]) assert(sql.includes(`${t} enable row level security`));
  assert(sql.includes("unique (person_a, person_b)"));
  assert(sql.includes("profiles_checkin_sessions_gone") && sql.includes("-- rollback:"));
});

Deno.test("v1.63 first: the person who accepted the check-in invite goes first, the same on both phones", async () => {
  // A invited, B accepted: B first, whoever opens
  const t = tables();
  const sa = await open(t);
  const sb = (await call(`/checkin/${A}/session`, "GET", {}, B, t)).session;
  assertEquals([sa.first, sb.first], [B, B]);
  assertEquals(t.checkin_sessions[0].first, B, "fixed on the session when it opens");
  // B invited A (dated): A first
  const d = tables(); d.check_ins = []; d.check_in_dates = [{ owner: B, person: A, status: "active", accepted_at: "2026-11-05T00:00:00Z" }];
  assertEquals((await call(`/checkin/${A}/session`, "POST", {}, B, d)).session.first, A);
  // check-ins both ways: the one accepted earliest decides
  const both = tables();
  both.check_ins = [{ owner: A, person: B, status: "active", accepted_at: "2026-11-09T00:00:00Z" },
    { owner: B, person: A, status: "active", accepted_at: "2026-11-02T00:00:00Z" }];
  assertEquals((await open(both)).first, A);
  // a session row from before 0055 (no first) works it out live
  const old = tables(); const so = await open(old); old.checkin_sessions[0].first = null;
  assertEquals((await call(`/checkin/${A}/session`, "GET", {}, B, old)).session.first, B);
  assertEquals(so.first, B);
});

Deno.test("v1.63 said: a text-free mark, first speaker first; both marks open the items step; nothing typed or screened", async () => {
  const t = tables(); const s = await open(t); // B goes first (B accepted A's invite)
  // A cannot mark before B
  assertEquals((await rejects(() => call(`/checkin/session/${s.id}/said`, "PUT", {}, A, t))).extra.reason, "not_your_turn");
  let r = await call(`/checkin/session/${s.id}/said`, "PUT", {}, B, t);
  assertEquals(r.session.mine.said, true); assertEquals(r.session.phase, "appreciations");
  assertEquals(r.session.mine.appreciation, null);
  // A sees that B's mark is in (and no words), then marks theirs
  let a = (await call(`/checkin/${B}/session`, "GET", {}, A, t)).session;
  assertEquals([a.theirs.said, a.mine.said, a.theirs.appreciation], [true, false, null]);
  assertEquals((await rejects(() => call(`/checkin/session/${s.id}/said`, "PUT", {}, B, t))).extra.reason, "already_given");
  r = await call(`/checkin/session/${s.id}/said`, "PUT", {}, A, t);
  assertEquals(r.session.phase, "items");
  assertEquals(r.session.mine.eligible.map((n: Row) => n.note_id), ["a-kept", "a-kept2", "a-kept3"]);
  // a written appreciation after the mark is refused (one each), and no model was called at all
  assertEquals((await rejects(() => call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_A }, A, t))).extra.reason, "already_given");
  assertEquals(t.engine_calls.length, 0);
  assert(t.checkin_session_parts.every((p) => !p.appreciation), "no words stored");
  // ending the session takes the marks with it
  await call(`/checkin/session/${s.id}/close`, "POST", {}, A, t);
  assertEquals([t.checkin_sessions.length, t.checkin_session_parts.length], [0, 0]);
  a = (await call(`/checkin/${B}/session`, "GET", {}, A, t)).session;
  assertEquals(a, null);
});

Deno.test("v1.63 said and written mix: one person says it, the other writes; items open once both are in", () =>
  withModel([APP_B], async () => {
    const t = tables(); const s = await open(t);
    await call(`/checkin/session/${s.id}/appreciation`, "PUT", { text: APP_B }, B, t);
    const r = await call(`/checkin/session/${s.id}/said`, "PUT", {}, A, t);
    assertEquals(r.session.phase, "items");
    assertEquals(r.session.theirs.appreciation, APP_B);
    assertEquals((await call(`/checkin/${A}/session`, "GET", {}, B, t)).session.theirs.said, true);
  }));

Deno.test("v1.64 done_bringing: 'Nothing else' is a text-free mark both phones read; two brought is done too", async () => {
  const t = tables(); const s = await open(t); // B goes first
  // before the items step: refused, and nobody is done
  assertEquals((await rejects(() => call(`/checkin/session/${s.id}/done_bringing`, "PUT", {}, B, t))).extra.reason, "appreciation_first");
  await call(`/checkin/session/${s.id}/said`, "PUT", {}, B, t);
  let r = await call(`/checkin/session/${s.id}/said`, "PUT", {}, A, t);
  assertEquals([r.session.mine.done_bringing, r.session.theirs.done_bringing], [false, false]);
  // B brings one, then chooses Nothing else; A sees B is done without learning what B could still have brought
  await call(`/checkin/session/${s.id}/items/b-kept`, "PUT", { bring: true }, B, t);
  let a = (await call(`/checkin/${B}/session`, "GET", {}, A, t)).session;
  assertEquals(a.theirs.done_bringing, false, "still choosing");
  r = await call(`/checkin/session/${s.id}/done_bringing`, "PUT", {}, B, t);
  assertEquals([r.session.mine.done_bringing, r.session.mine.can_bring_more], [true, false]);
  assertEquals((await call(`/checkin/session/${s.id}/done_bringing`, "PUT", {}, B, t)).session.mine.done_bringing, true, "idempotent");
  a = (await call(`/checkin/${B}/session`, "GET", {}, A, t)).session;
  assertEquals([a.theirs.done_bringing, a.theirs.brought.length, a.mine.done_bringing], [true, 1, false]);
  assertEquals(Object.keys(a.theirs).sort(), ["appreciation", "brought", "done_bringing", "said", "shared"], "no count, no eligible list; shared (v1.88) is [] with the owner switch off");
  assertEquals(a.theirs.shared, []);
  // after Nothing else: bringing more is refused, taking back still works (law 10)
  t.parked_notes.push({ id: "b-kept2", writer: B, partner: A, text: "Mornings are rushed", state: "later", created_at: "2026-11-05T00:00:00Z" });
  assertEquals((await rejects(() => call(`/checkin/session/${s.id}/items/b-kept2`, "PUT", { bring: true }, B, t))).extra.reason, "done_bringing");
  r = await call(`/checkin/session/${s.id}/items/b-kept`, "PUT", { bring: false }, B, t);
  assertEquals([r.session.mine.brought.length, r.session.mine.done_bringing], [0, true]);
  // A brings two: done without a mark
  await call(`/checkin/session/${s.id}/items/a-kept`, "PUT", { bring: true }, A, t);
  r = await call(`/checkin/session/${s.id}/items/a-kept2`, "PUT", { bring: true }, A, t);
  assertEquals([r.session.mine.done_bringing, r.session.mine.can_bring_more], [true, false]);
  assertEquals((await call(`/checkin/${A}/session`, "GET", {}, B, t)).session.theirs.done_bringing, true);
  // no words stored, no model call; ending the session takes the marks with it
  assertEquals(t.engine_calls.length, 0);
  await call(`/checkin/session/${s.id}/close`, "POST", {}, A, t);
  assertEquals([t.checkin_sessions.length, t.checkin_session_parts.length], [0, 0]);
});

Deno.test("migration 0056: one additive column on the session's own parts row, with a rollback line", () => {
  const sql = Deno.readTextFileSync(new URL("../../supabase/migrations/0056_checkin_done_bringing.sql", import.meta.url));
  assert(sql.includes("alter table public.checkin_session_parts add column if not exists done_bringing_at timestamptz"));
  assert(sql.includes("-- rollback: alter table public.checkin_session_parts drop column done_bringing_at;"));
  assert(!/drop table|delete from|not null/i.test(sql.split("-- rollback:")[0]));
});
