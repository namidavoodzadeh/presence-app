// Bridge history as cards (CEO/Nami decision 8 Nov 12:04 PT): one state per card shared by both people, a person's cards
// latest first with closed ones apart, cards sent for a check-in belong to it. Fake database, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import "../api/cards.ts";
import "../api/checkin.ts";

const A = "00000000-0000-4000-8000-000000000061";
const B = "00000000-0000-4000-8000-000000000062";
const C = "00000000-0000-4000-8000-000000000063";
type Row = Record<string, unknown>;
const past = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

class Q implements PromiseLike<{ data: unknown; error: null }> {
  kind = "select"; eqs: Array<[string, unknown]> = []; nulls: string[] = []; nes: Array<[string, unknown]> = [];
  val: Row = {}; one = false; conflict = ""; ors: string[] = [];
  constructor(private rows: Row[]) {}
  select() { return this; }
  insert(v: Row) { this.kind = "insert"; this.val = v; return this; }
  update(v: Row) { this.kind = "update"; this.val = v; return this; }
  upsert(v: Row, o?: { onConflict: string }) { this.kind = "upsert"; this.val = v; this.conflict = o?.onConflict ?? ""; return this; }
  delete() { this.kind = "delete"; return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  neq(c: string, v: unknown) { this.nes.push([c, v]); return this; }
  is(c: string, _v: null) { this.nulls.push(c); return this; }
  in() { return this; }
  order() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) { return Promise.resolve(r(this.run())); }
  run() {
    const m = (x: Row) => this.eqs.every(([c, v]) => x[c] === v) && this.nulls.every((c) => x[c] == null) && this.nes.every(([c, v]) => x[c] !== v);
    let out: Row[];
    if (this.kind === "insert") { const row = { ...this.val }; this.rows.push(row); out = [row]; }
    else if (this.kind === "update") { out = this.rows.filter(m); for (const x of out) Object.assign(x, this.val); }
    else if (this.kind === "upsert") {
      const keys = this.conflict.split(",");
      const ex = this.rows.find((x) => keys.every((k) => x[k] === this.val[k]));
      if (ex) { Object.assign(ex, this.val); out = [ex]; } else { const row = { ...this.val }; this.rows.push(row); out = [row]; }
    } else if (this.kind === "delete") { out = this.rows.filter(m); for (const x of out) this.rows.splice(this.rows.indexOf(x), 1); }
    else out = this.rows.filter(m);
    out = out.map((x) => ({ ...x }));
    return { data: this.one ? out[0] ?? null : out, error: null as null };
  }
}
const client = (t: Record<string, Row[]>) => ({ from: (n: string) => new Q(t[n] ??= []) });
const bridge = (id: string, sender: string, receiver: string, over: Row = {}): Row => ({
  id, sender, receiver, final: `words ${id}`, status: "scheduled", deliver_at: past(10), opened_at: null,
  created_at: past(20), sender_deleted_at: null, receiver_deleted_at: null, ...over,
});
const tables = (): Record<string, Row[]> => ({
  links: [{ person_a: A, person_b: B, status: "active" }],
  check_ins: [], bridge_cards: [],
  bridges: [
    bridge("b1", A, B, { created_at: past(50), deliver_at: past(48), opened_at: past(40) }),
    bridge("b2", B, A, { created_at: past(30), deliver_at: past(28), opened_at: past(20) }),
    bridge("b3", A, B, { created_at: past(5), deliver_at: past(4) }), // latest, delivered, B has not opened it
    bridge("b4", A, B, { created_at: past(1), deliver_at: future(72) }), // parked/scheduled: sealed for B
    bridge("b5", A, C, { created_at: past(2) }), // another pair
    bridge("bw", A, B, { created_at: past(3), status: "withdrawn" }),
  ],
});
function call(path: string, method: string, body: Row, caller: string, t: Record<string, Row[]>) {
  const f = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(f, `no route ${method} ${path}`);
  const m = f.pattern.exec(path)!; const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = client(t);
  return f.handler({
    env: { checkIn: true }, req: new Request("https://x.invalid" + path, { method }), url: new URL("https://x.invalid" + path), params,
    caller: { id: caller, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve(body),
  } as never);
}
async function rejects(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { assert(e instanceof ApiError); return e; }
  throw new Error("expected ApiError");
}
const ids = (cs: Row[]) => cs.map((c) => c.bridge_id);

Deno.test("cards: the sender sees every card to this person latest first, own words always, the withdrawn and other pairs never", async () => {
  const r = await (await call(`/cards/${B}`, "GET", {}, A, tables())).json();
  assertEquals(ids(r.cards), ["b4", "b3", "b2", "b1"]);
  assertEquals(r.closed, []);
  const b4 = r.cards[0];
  assertEquals(b4.direction, "sent");
  assertEquals(b4.text, "words b4");
  assertEquals(b4.delivered, false);
  assertEquals(b4.state, "open");
  assertEquals(b4.state_by, null);
});

Deno.test("cards: the receiver sees nothing before delivery, and the words only once opened", async () => {
  const r = await (await call(`/cards/${A}`, "GET", {}, B, tables())).json();
  assertEquals(ids(r.cards), ["b3", "b2", "b1"], "b4 is not there until its time");
  const by = Object.fromEntries(r.cards.map((c: Row) => [c.bridge_id, c]));
  assertEquals(by.b3.text, null, "delivered but unopened: no words");
  assertEquals(by.b3.direction, "received");
  assertEquals(by.b1.text, "words b1", "opened: words");
  assertEquals(by.b2.direction, "sent", "b2 is mine: B wrote it");
  assertEquals(by.b2.text, "words b2");
});

Deno.test("cards: either person closes a card; the state, who and when are shared; closed leave the main list", async () => {
  const t = tables();
  const patched = await (await call("/cards/b1", "PATCH", { state: "talked" }, B, t)).json();
  assertEquals(patched.card.state, "talked");
  assertEquals(patched.card.state_by, "me");
  const mine = await (await call(`/cards/${B}`, "GET", {}, A, t)).json();
  assertEquals(ids(mine.closed), ["b1"]);
  assert(!ids(mine.cards).includes("b1"));
  const closed = mine.closed[0];
  assertEquals(closed.state, "talked");
  assertEquals(closed.state_by, "them", "A sees that B set it");
  assert(typeof closed.state_at === "string");
  // A resolves another; B sees "them".
  await call("/cards/b3", "PATCH", { state: "resolved" }, A, t);
  const theirs = await (await call(`/cards/${A}`, "GET", {}, B, t)).json();
  assertEquals(theirs.closed.map((c: Row) => [c.bridge_id, c.state, c.state_by]), [["b3", "resolved", "them"], ["b1", "talked", "me"]]);
});

Deno.test("cards: keep and reopen; the latest card and the kept ones are the shown ones", async () => {
  const t = tables();
  await call("/cards/b1", "PATCH", { state: "kept" }, A, t);
  let r = await (await call(`/cards/${B}`, "GET", {}, A, t)).json();
  const shown = r.cards.filter((c: Row) => c.shown).map((c: Row) => c.bridge_id);
  assertEquals(shown, ["b4", "b1"]);
  await call("/cards/b1", "PATCH", { state: "talked" }, A, t);
  await call("/cards/b1", "PATCH", { state: "open" }, B, t);
  r = await (await call(`/cards/${B}`, "GET", {}, A, t)).json();
  assertEquals(r.closed, []);
  assertEquals(r.cards.find((c: Row) => c.bridge_id === "b1").state, "open");
  assertEquals(r.cards.find((c: Row) => c.bridge_id === "b1").state_by, "them");
});

Deno.test("cards: only the two people; the receiver cannot act on a card still sealed; bad state is invalid", async () => {
  const t = tables();
  assertEquals((await rejects(() => call("/cards/b1", "PATCH", { state: "talked" }, C, t))).code, "not_found");
  assertEquals((await rejects(() => call("/cards/b4", "PATCH", { state: "kept" }, B, t))).code, "forbidden");
  assertEquals((await rejects(() => call("/cards/nope", "PATCH", { state: "kept" }, A, t))).code, "not_found");
  const e = await rejects(() => call("/cards/b1", "PATCH", { state: "liked" }, A, t));
  assertEquals(e.code, "invalid");
  assertEquals(t.bridge_cards.length, 0);
  await call("/cards/b4", "PATCH", { state: "kept" }, A, t); // the sender may keep a parked card
  assertEquals(t.bridge_cards.length, 1);
});

Deno.test("cards: no link, no cards; a blocked link answers forbidden", async () => {
  assertEquals((await rejects(() => call(`/cards/${C}`, "GET", {}, B, tables()))).code, "not_found");
  const t = tables(); t.links[0].status = "blocked";
  assertEquals((await rejects(() => call(`/cards/${B}`, "GET", {}, A, t))).code, "forbidden");
  assertEquals((await rejects(() => call("/cards/b1", "PATCH", { state: "kept" }, A, t))).code, "forbidden");
});

Deno.test("cards: cards between people with an active check-in belong to it; an invite does not count", async () => {
  const t = tables();
  t.check_ins.push({ id: "ci1", owner: A, person: B, status: "invited" });
  let r = await (await call(`/cards/${B}`, "GET", {}, A, t)).json();
  assertEquals(r.check_in_id, null);
  assertEquals(r.cards[0].check_in_id, null);
  t.check_ins[0].status = "active";
  r = await (await call(`/cards/${B}`, "GET", {}, A, t)).json();
  assertEquals(r.check_in_id, "ci1");
  assert(r.cards.every((c: Row) => c.check_in_id === "ci1"));
  // The check-in either person started counts for both.
  const r2 = await (await call(`/cards/${A}`, "GET", {}, B, t)).json();
  assertEquals(r2.check_in_id, "ci1");
});

Deno.test("cards: a card keeps its words out of the receiver's reach after the sender deletes or the receiver removes it", async () => {
  const t = tables();
  t.bridges[0].receiver_deleted_at = past(1);
  t.bridges[1].sender_deleted_at = past(1); // B's own b2
  const r = await (await call(`/cards/${A}`, "GET", {}, B, t)).json();
  assertEquals(ids(r.cards), ["b3"]);
});

Deno.test("v1.63 closed_in_check_in: true only for a card closed while a check-in session is open, or marked from the check-in", async () => {
  const t = tables();
  t.check_ins.push({ id: "ci1", owner: A, person: B, status: "active" });
  // no session open, no flag: a card closed at home is not 'At the check-in', even with an accepted check-in
  let c = (await (await call("/cards/b1", "PATCH", { state: "talked" }, B, t)).json()).card;
  assertEquals(c.closed_in_check_in, false);
  // a session open between them: closed there
  const [lo, hi] = A < B ? [A, B] : [B, A];
  t.checkin_sessions = [{ id: "s1", person_a: lo, person_b: hi, expires_at: future(2) }];
  c = (await (await call("/cards/b2", "PATCH", { state: "resolved" }, A, t)).json()).card;
  assertEquals(c.closed_in_check_in, true);
  // kept during the session is not closed, so no flag
  c = (await (await call("/cards/b3", "PATCH", { state: "kept" }, A, t)).json()).card;
  assertEquals(c.closed_in_check_in, false);
  // an expired session does not count
  t.checkin_sessions[0].expires_at = past(1);
  c = (await (await call("/cards/b3", "PATCH", { state: "talked" }, A, t)).json()).card;
  assertEquals(c.closed_in_check_in, false);
  // marked from the check-in screen with an accepted check-in: closed there
  c = (await (await call("/cards/b3", "PATCH", { state: "talked", at_check_in: true }, A, t)).json()).card;
  assertEquals(c.closed_in_check_in, true);
  // both people read the same flag on closed[]
  const r = await (await call(`/cards/${A}`, "GET", {}, B, t)).json();
  assertEquals(Object.fromEntries(r.closed.map((x: Row) => [x.bridge_id, x.closed_in_check_in])), { b1: false, b2: true, b3: true });
  // reopening clears it; re-closing at home leaves it off
  await call("/cards/b2", "PATCH", { state: "open" }, B, t);
  c = (await (await call("/cards/b2", "PATCH", { state: "talked" }, B, t)).json()).card;
  assertEquals(c.closed_in_check_in, false);
  // at_check_in without an accepted check-in does nothing; a non-boolean is invalid
  const u = tables();
  c = (await (await call("/cards/b1", "PATCH", { state: "talked", at_check_in: true }, A, u)).json()).card;
  assertEquals(c.closed_in_check_in, false);
  assertEquals((await rejects(() => call("/cards/b1", "PATCH", { state: "talked", at_check_in: "yes" }, A, u))).extra.field, "at_check_in");
});

Deno.test("v1.65 a parked bridge's note marked talked closes its card at the check-in (Q-APP-V3-22), only when brought (v1.68)", async () => {
  const t = tables();
  t.check_ins.push({ id: "ci1", owner: A, person: B, status: "active" });
  const [lo, hi] = A < B ? [A, B] : [B, A];
  t.checkin_sessions = [{ id: "s1", person_a: lo, person_b: hi, expires_at: future(2) }];
  t.parked_notes = [
    { id: "n1", writer: A, partner: B, text: "words b3", state: "parked", origin: "bridged", origin_ref: "b3" },
    { id: "n2", writer: A, partner: B, text: "a note", state: "parked", origin: "note", origin_ref: null },
    { id: "n3", writer: A, partner: B, text: "not this pair", state: "parked", origin: "bridged", origin_ref: "b5" },
    { id: "n4", writer: A, partner: B, text: "gone", state: "parked", origin: "bridged", origin_ref: "bw" },
    { id: "n5", writer: B, partner: A, text: "sealed for B", state: "parked", origin: "bridged", origin_ref: "b4" },
    { id: "n6", writer: A, partner: B, text: "words b1", state: "parked", origin: "bridged", origin_ref: "b1" },
  ];
  // every note above was brought into the open session s1 by its writer
  t.checkin_session_items = t.parked_notes.map((n) => ({ session: "s1", writer: n.writer, note_id: n.id }));
  // 'later' leaves the card alone
  await call("/checkin/notes/n1", "PATCH", { state: "later" }, A, t);
  assertEquals(t.bridge_cards.length, 0);
  // talked: the card closes, set by the writer, tagged 'At the check-in'; both read it on closed[]
  const r = await (await call("/checkin/notes/n1", "PATCH", { state: "talked" }, A, t)).json();
  assertEquals(r.note.state, "talked");
  const forB = await (await call(`/cards/${A}`, "GET", {}, B, t)).json();
  assertEquals(forB.closed.map((c: Row) => [c.bridge_id, c.state, c.state_by, c.closed_in_check_in]), [["b3", "talked", "them", true]]);
  // a plain note, another pair's bridge, a withdrawn bridge, and a receiver's note on a sealed bridge: no card write
  for (const [id, who] of [["n2", A], ["n3", A], ["n4", A], ["n5", B]] as const) await call(`/checkin/notes/${id}`, "PATCH", { state: "talked" }, who, t);
  assertEquals(t.bridge_cards.map((c) => c.bridge_id), ["b3"]);
  // a card already closed by the other person keeps its first close (B closed it during the open session: v1.63 tags it)
  await call("/cards/b1", "PATCH", { state: "resolved" }, B, t);
  await call("/checkin/notes/n6", "PATCH", { state: "talked" }, A, t);
  const b1 = t.bridge_cards.find((c) => c.bridge_id === "b1")!;
  assertEquals([b1.state, b1.set_by, b1.closed_in_check_in], ["resolved", B, true]);
  // a link no longer active: the note is marked, the card is left alone
  const v = tables();
  v.links[0].status = "paused";
  v.checkin_sessions = [{ id: "s1", person_a: lo, person_b: hi, expires_at: future(2) }];
  v.parked_notes = [{ id: "m2", writer: A, partner: B, text: "words b3", state: "later", origin: "bridged", origin_ref: "b3" }];
  v.checkin_session_items = [{ session: "s1", writer: A, note_id: "m2" }];
  const rv = await (await call("/checkin/notes/m2", "PATCH", { state: "talked" }, A, v)).json();
  assertEquals([rv.note.state, v.bridge_cards.length], ["talked", 0]);
});

Deno.test("v1.68 guard (CPO 12 Nov (2)): a kept note the writer did NOT bring stays writer-only when marked talked", async () => {
  const [lo, hi] = A < B ? [A, B] : [B, A];
  const receiverRows = (t: Record<string, Row[]>) => JSON.stringify([t.bridge_cards, t.bridges, t.checkin_session_items, t.checkin_sessions]);
  const cases: Array<[string, (t: Record<string, Row[]>) => void]> = [
    // a session is open and the writer brought another note, not this one
    ["open session, not brought", (t) => {
      t.checkin_sessions = [{ id: "s1", person_a: lo, person_b: hi, expires_at: future(2) }];
      t.checkin_session_items = [{ session: "s1", writer: A, note_id: "other" }];
    }],
    // the receiver brought something; the writer's own note was not brought
    ["brought by the other person only", (t) => {
      t.checkin_sessions = [{ id: "s1", person_a: lo, person_b: hi, expires_at: future(2) }];
      t.checkin_session_items = [{ session: "s1", writer: B, note_id: "k1" }];
    }],
    // an accepted check-in but no session at all (marked at home)
    ["no session", (t) => { t.check_ins.push({ id: "ci1", owner: A, person: B, status: "active" }); }],
    // brought into a session that has since expired
    ["expired session", (t) => {
      t.checkin_sessions = [{ id: "s1", person_a: lo, person_b: hi, expires_at: past(1) }];
      t.checkin_session_items = [{ session: "s1", writer: A, note_id: "k1" }];
    }],
    // brought into a session with someone else (a different session id)
    ["brought into another session", (t) => {
      t.checkin_sessions = [{ id: "s1", person_a: lo, person_b: hi, expires_at: future(2) }];
      t.checkin_session_items = [{ session: "s9", writer: A, note_id: "k1" }];
    }],
  ];
  for (const [name, setup] of cases) {
    const t = tables();
    t.parked_notes = [{ id: "k1", writer: A, partner: B, text: "words b3", state: "later", origin: "bridged", origin_ref: "b3" }];
    setup(t);
    t.checkin_sessions ??= [];
    t.checkin_session_items ??= [];
    const before = receiverRows(t);
    const r = await (await call("/checkin/notes/k1", "PATCH", { state: "talked" }, A, t)).json();
    assertEquals(r.note.state, "talked", name); // the writer's own list moves
    assertEquals(receiverRows(t), before, name); // nothing on the receiver's side
    const forB = await (await call(`/cards/${A}`, "GET", {}, B, t)).json();
    assertEquals(forB.closed.length, 0, name);
    assertEquals(forB.cards.find((c: Row) => c.bridge_id === "b3")?.state, "open", name);
  }
});
