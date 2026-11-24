// Contract v1.57: reading switch + POST /bridges/:id/reading. Fake database and a recorded model, $0, fictional people.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import { hooks } from "../api/bridge_engine.ts";
import "../api/reading.ts";
import { RecordedClient } from "../engine/model/client.ts";
import { checkReading } from "../api/reading.ts";
import { RESOURCES } from "../engine/safety.ts";

type Row = Record<string, unknown>;
const WRITER = "00000000-0000-4000-8000-0000000000a1";
const READER = "00000000-0000-4000-8000-0000000000a2";
const OTHER = "00000000-0000-4000-8000-0000000000a3";
const [A, B] = WRITER < READER ? [WRITER, READER] : [READER, WRITER];

class Q implements PromiseLike<{ data: unknown; error: null }> {
  eqs: Array<[string, unknown]> = []; ins: Array<[string, unknown[]]> = []; single = false; op: "select" | "write" = "select";
  constructor(private rows: Row[], private table: string, private log: string[]) {}
  select() { return this; } order() { return this; } limit() { return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in(c: string, v: unknown[]) { this.ins.push([c, v]); return this; }
  maybeSingle() { this.single = true; return this; }
  insert(r: Row) { this.log.push(this.table + ".insert"); this.rows.push(r); return this; }
  upsert(r: Row) {
    this.log.push(this.table + ".upsert");
    const i = this.rows.findIndex((x) => x.owner === r.owner && x.other === r.other);
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...r }; else this.rows.push(r);
    this.op = "write"; return this;
  }
  // deno-lint-ignore no-explicit-any
  then(r: any) {
    if (this.op === "write") return Promise.resolve(r({ data: null, error: null }));
    const out = this.rows.filter((x) => this.eqs.every(([c, v]) => x[c] === v) && this.ins.every(([c, v]) => v.includes(x[c])));
    return Promise.resolve(r({ data: this.single ? out[0] ?? null : out, error: null }));
  }
}

function world(over: { text?: string; help?: boolean; grants?: Row[]; opened?: boolean } = {}) {
  const t: Record<string, Row[]> = {
    links: [{ person_a: A, person_b: B, status: "active" }],
    profiles: [{ id: WRITER, name: "Lea Marsh" }, { id: READER, name: "Jo" }],
    link_prefs: over.help === undefined ? [] : [{ owner: WRITER, other: READER, help_read: over.help }],
    beliefs: [{ id: "b1", owner: WRITER, label: "Rest", area: "work", status: "confirmed", rating: "very", statement: "Part of you needs quiet after a long day" },
              { id: "b2", owner: WRITER, label: "Plans", area: "love", status: "confirmed", rating: "partly", statement: "Part of you likes plans made early" }],
    share_items: over.grants ?? [{ owner: WRITER, other: READER, belief_id: "b1", wording: "Needs quiet after a long day", created_at: "2026-11-10T00:00:00Z" },
                                 { owner: WRITER, other: READER, belief_id: "b2", wording: "Likes plans made early", created_at: "2026-11-10T00:00:01Z" }],
    bridges: [{ id: "m1", sender: WRITER, receiver: READER, final: over.text ?? "I'm skipping Friday, long week.", status: "scheduled",
                opened_at: over.opened === false ? null : "2026-11-11T10:00:00Z", receiver_deleted_at: null }],
    engine_calls: [],
  };
  const log: string[] = [];
  const mk = () => ({ from: (n: string) => new Q(t[n] ??= [], n, log) });
  return { t, log, mk };
}

async function call(method: string, path: string, caller: string, body: Row = {}, w = world()) {
  const f = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(f, `no route ${method} ${path}`);
  const m = f.pattern.exec(path)!; const params: Record<string, string> = {};
  f.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = w.mk();
  const res = await f.handler({
    env: {}, req: new Request("https://x.invalid" + path), url: new URL("https://x.invalid" + path), params,
    caller: { id: caller, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve(body),
  } as never);
  return { res, w };
}

const GOOD = JSON.stringify({ safety: "none", meanings: [
  { meaning: "Is worn out and wants a quiet evening", item_id: "b1", ordinary: true },
  { meaning: "Wants Friday planned differently next time.", item_id: "b2", ordinary: false } ] });
function model(raw: string) { let n = 0; hooks.client = () => { n++; return new RecordedClient({ reading: [raw] }); }; return () => n; }
function off() { hooks.client = null; }

async function rejects(p: Promise<unknown>, code: string) {
  try { await p; throw new Error("should have thrown " + code); } catch (e) { assert(e instanceof ApiError, String(e)); assertEquals((e as ApiError).code, code); }
}

Deno.test("switch defaults off; PUT on sets confirmed_at; PUT off clears it and notifies no one", async () => {
  const w = world();
  assertEquals(await (await call("GET", `/links/${READER}/reading`, WRITER, {}, w)).res.json(), { person_id: READER, help_read: false });
  const on = await (await call("PUT", `/links/${READER}/reading`, WRITER, { help_read: true }, w)).res.json();
  assertEquals(on.help_read, true); assert(typeof on.confirmed_at === "string");
  const offJ = await (await call("PUT", `/links/${READER}/reading`, WRITER, { help_read: false }, w)).res.json();
  assertEquals(offJ, { person_id: READER, help_read: false });
  assertEquals(w.log.filter((x) => !x.startsWith("link_prefs")), [], "only link_prefs written: no event, no push row");
  await rejects(call("PUT", `/links/${READER}/reading`, WRITER, { help_read: "yes" }, w), "invalid");
  await rejects(call("GET", `/links/${OTHER}/reading`, WRITER, {}, w), "not_found");
});

Deno.test("reading: 2 or 3 meanings, each with the writer's granted wording; nothing stored", async () => {
  const calls = model(GOOD);
  try {
    const w = world({ help: true });
    const j = await (await call("POST", "/bridges/m1/reading", READER, {}, w)).res.json();
    assertEquals(j.available, true);
    assertEquals(j.meanings, [
      { meaning: "Is worn out and wants a quiet evening", item: "Needs quiet after a long day" },
      { meaning: "Wants Friday planned differently next time", item: "Likes plans made early" } ]);
    assertEquals(calls(), 1);
    assertEquals(w.t.link_prefs.length, 1); assertEquals(w.t.bridges.length, 1);
    assertEquals(JSON.stringify(w.t.engine_calls).includes("worn out"), false, "trace keeps no words");
    assertEquals(JSON.stringify(w.t.engine_calls).includes("skipping Friday"), false);
  } finally { off(); }
});

Deno.test("switch off, no switch row, or nothing granted: same 'not available', no model call", async () => {
  for (const o of [{ help: false }, {}, { help: true, grants: [] }]) {
    const calls = model(GOOD);
    try {
      const j = await (await call("POST", "/bridges/m1/reading", READER, {}, world(o))).res.json();
      assertEquals(j, { available: false }); assertEquals(calls(), 0);
    } finally { off(); }
  }
});

Deno.test("a revoked grant is gone at once (live read)", async () => {
  const calls = model(GOOD);
  try {
    const w = world({ help: true, grants: [{ owner: WRITER, other: READER, belief_id: "b1", wording: "Needs quiet", created_at: "x" }] });
    const j = await (await call("POST", "/bridges/m1/reading", READER, {}, w)).res.json();
    assertEquals(j, { available: false }, "model cites b2, which is no longer granted");
    assertEquals(calls(), 1);
  } finally { off(); }
});

Deno.test("safety first: a threat or risk message is flagged with resources, even with the switch off, and no model call", async () => {
  for (const text of ["I will kill you if you come Friday", "I want to end my life"]) {
    const calls = model(GOOD);
    try {
      for (const help of [true, false]) {
        const j = await (await call("POST", "/bridges/m1/reading", READER, {}, world({ text, help }))).res.json();
        assertEquals(j.available, false); assertEquals(j.flagged, true); assertEquals(j.resources, RESOURCES);
      }
      assertEquals(calls(), 0);
    } finally { off(); }
  }
});

Deno.test("fixtures/reading.json flagged reply is the server's exact shape (app Q-APP-READ2)", async () => {
  const fx = JSON.parse(await Deno.readTextFile(new URL("../../fixtures/reading.json", import.meta.url)));
  assertEquals(fx.flagged.reply, { available: false, flagged: true, resources: RESOURCES });
});

Deno.test("model flags a restriction: flagged + resources, no meanings", async () => {
  model(JSON.stringify({ safety: "flagged", meanings: [] }));
  try {
    const j = await (await call("POST", "/bridges/m1/reading", READER, {}, world({ help: true }))).res.json();
    assertEquals(j.flagged, true); assertEquals(j.meanings, undefined);
  } finally { off(); }
});

Deno.test("only the receiver of an opened message may ask", async () => {
  model(GOOD);
  try {
    await rejects(call("POST", "/bridges/m1/reading", WRITER, {}, world({ help: true })), "not_found");
    await rejects(call("POST", "/bridges/m1/reading", OTHER, {}, world({ help: true })), "not_found");
    await rejects(call("POST", "/bridges/m1/reading", READER, {}, world({ help: true, opened: false })), "forbidden");
  } finally { off(); }
});

Deno.test("checkReading rejects one meaning, four, no ordinary one, unknown item, clinical words, long text, bad JSON", () => {
  const g = [{ item_id: "b1", area: "", label: "", wording: "W1", shared_at: "" }, { item_id: "b2", area: "", label: "", wording: "W2", shared_at: "" }];
  const m = (meaning: string, item_id = "b1", ordinary = true) => ({ meaning, item_id, ordinary });
  const ok = (ms: unknown[], safety = "none") => checkReading({ safety, meanings: ms }, g).kind;
  assertEquals(ok([m("Is tired"), m("Wants space", "b2")]), "ok");
  assertEquals(ok([m("Is tired")]), "none");
  assertEquals(ok([m("a"), m("b"), m("c"), m("d")]), "none");
  assertEquals(ok([m("Is tired", "b1", false), m("Wants space", "b2", false)]), "none");
  assertEquals(ok([m("Is tired", "zz"), m("Wants space", "b2")]), "none");
  assertEquals(ok([m("Has a depression", "b1"), m("Wants space", "b2")]), "none");
  assertEquals(ok([m("word ".repeat(30)), m("Wants space", "b2")]), "none");
  assertEquals(ok([], "risk"), "flagged");
  assertEquals(checkReading("nope", g).kind, "none");
  assertEquals(checkReading(null, g).kind, "none");
});

Deno.test("V3 4.4: reading reads only how_i_mean and this_week of a kinded item; an old kenning's grant carries on", async () => {
  const mk = (kind: string | null, extra: Row = {}) => {
    const w = world({ help: true, grants: [{ owner: WRITER, other: READER, belief_id: "k1", wording: "When I go quiet, I'm thinking", created_at: "2026-11-10T00:00:00Z" }] });
    w.t.beliefs = [{ id: "k1", owner: WRITER, label: "x", area: "relationships", status: "confirmed", rating: "very", statement: "x", comm_kind: kind, comm_status: "active", comm_expires_at: null, ...extra }];
    return w;
  };
  const ask = async (w: ReturnType<typeof mk>) => {
    const calls = model(JSON.stringify({ safety: "none", meanings: [
      { meaning: "Is thinking it over", item_id: "k1", ordinary: true }, { meaning: "Wants a minute before talking", item_id: "k1", ordinary: false } ] }));
    try { return { j: await (await call("POST", "/bridges/m1/reading", READER, {}, w)).res.json(), calls: calls() }; } finally { off(); }
  };
  // read: how_i_mean, and an old kenning with no kind
  for (const kind of ["how_i_mean", "this_week", null]) {
    const r = await ask(mk(kind, kind === "this_week" ? { comm_expires_at: "2099-01-01T00:00:00Z" } : {}));
    assertEquals([kind, r.j.available, r.calls], [kind, true, 1]);
  }
  // never read: the other kinds, set-aside and expired items; the same "not available" line and no model call
  for (const [kind, extra] of [["lands_hard", {}], ["gets_heated", {}], ["matters", {}], ["feels_like_care", {}], ["bring_up", {}], ["coming_back", {}], ["other", {}],
    ["how_i_mean", { comm_status: "set_aside" }], ["this_week", { comm_expires_at: "2020-01-01T00:00:00Z" }]] as Array<[string, Row]>) {
    const r = await ask(mk(kind, extra));
    assertEquals([kind, JSON.stringify(extra), r.j, r.calls], [kind, JSON.stringify(extra), { available: false }, 0]);
  }
});
