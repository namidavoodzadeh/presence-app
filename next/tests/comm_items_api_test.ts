// V3 communication items routes (/comm/items): fake database, $0. The switch, the checks, the receipt, the one-person-at-a-time rule,
// expiry, and that the older share route never newly grants a kind that must not reach a card.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/comm_items.ts";
import "../api/share_items.ts";
import { ApiError, STATUS } from "../api/lib/errors.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const ME = "00000000-0000-4000-8000-0000000000a1", JAN = "00000000-0000-4000-8000-0000000000a2";
type Row = Record<string, unknown>;

function run(method: string, path: string, t: FakeTables, body: Row = {}, env: Row = { commItems: true, commOwnerIds: [ME] }, who = ME) {
  const r = routes.find((x) => x.method === method && x.pattern.test(path));
  assert(r, `no ${method} ${path}`);
  const m = path.match(r.pattern)!;
  const params: Record<string, string> = {};
  r.keys.forEach((k, i) => params[k] = m[i + 1]);
  const db = fakeClient(t);
  // The router turns an ApiError into its status and body; do the same here so a test can read both.
  return Promise.resolve(r.handler({ env, req: new Request("https://x.invalid" + path), url: new URL("https://x.invalid" + path), params, caller: { id: who, db }, service: db, tz: "UTC", body: () => Promise.resolve(body) } as never))
    .catch((e) => { if (e instanceof ApiError) return new Response(JSON.stringify({ error: e.code, ...e.extra }), { status: STATUS[e.code] }); throw e; });
}
const post = (t: FakeTables, body: Row, env?: Row, who?: string) => run("POST", "/comm/items", t, body, env, who);

Deno.test("comm items: off by default, and for any account not on the owner list (nothing stored)", async () => {
  const t: FakeTables = {};
  assertEquals((await post(t, { kind: "how_i_mean", wording: "When I go quiet, I'm thinking." }, { commItems: false, commOwnerIds: [ME] })).status, 403);
  assertEquals((await post(t, { kind: "how_i_mean", wording: "When I go quiet, I'm thinking." }, {})).status, 403);
  assertEquals((await post(t, { kind: "how_i_mean", wording: "When I go quiet, I'm thinking." }, { commItems: true, commOwnerIds: [ME] }, JAN)).status, 403);
  assertEquals((await run("GET", "/comm/items", t, {}, { commItems: true, commOwnerIds: [] })).status, 403);
  assertEquals(t.beliefs ?? [], []);
});

Deno.test("comm items: a typed item is one belief row with the new columns, fixed compatibility values, and one receipt (law 2)", async () => {
  const t: FakeTables = {};
  const r = await post(t, { kind: "how_i_mean", wording: "  When I go quiet,   I'm thinking.  ", scope: { type: "type", value: "partner" }, when: "By text" });
  assertEquals(r.status, 201);
  const { item, state } = await r.json();
  assertEquals(state, "created");
  assertEquals([item.kind, item.wording, item.scope, item.when, item.status, item.expires_at], ["how_i_mean", "When I go quiet, I'm thinking.", { type: "type", value: "partner" }, "By text", "active", null]);
  const b = t.beliefs[0];
  assertEquals([b.owner, b.type, b.kind, b.area, b.status, b.rating, b.source, b.comm_kind, b.comm_status], [ME, "something I believe is true", "everyday", "relationships", "confirmed", "very", "own", "how_i_mean", "active"]);
  assert(!("level" in b) || b.level === undefined, "no level on a new item");
  assertEquals(t.receipts.length, 1);
  assertEquals([t.receipts[0].belief_id, t.receipts[0].quote, t.receipts[0].owner], [b.id, "When I go quiet, I'm thinking.", ME]);
  assert(typeof t.receipts[0].said_at === "string");
});

Deno.test("comm items: defaults by kind (one-person-at-a-time kinds and Other start private; the person can only widen to one person)", async () => {
  const t: FakeTables = {};
  const lands = await (await post(t, { kind: "lands_hard", wording: "It's hard for me to hear that I was late.", source: "talk_said" })).json();
  assertEquals(lands.item.status, "private_only");
  const other = await (await post(t, { kind: "other", wording: "I keep a paper diary." })).json();
  assertEquals(other.item.status, "private_only");
  // Active for everyone is refused for a one-person kind; active for exactly one person is allowed.
  const bad = await post(t, { kind: "gets_heated", wording: "When it gets tense, I leave the room.", status: "active" });
  assertEquals(bad.status, 400);
  assertEquals((await bad.json()).problems, ["one_person_at_a_time"]);
  const ok = await post(t, { kind: "gets_heated", wording: "When it gets tense, I leave the room.", status: "active", scope: { type: "person", value: JAN } });
  assertEquals(ok.status, 201);
  assertEquals(t.beliefs.length, 4 - 1);
});

Deno.test("comm items: this week gets an expiry (7, 14 or 30 days, 14 default), nothing else can", async () => {
  const t: FakeTables = {};
  const r = await (await post(t, { kind: "this_week", wording: "This week I'm short on sleep.", source: "typed" })).json();
  const days = (Date.parse(r.item.expires_at) - Date.now()) / 86_400_000;
  assert(days > 13.9 && days <= 14.01, String(days));
  const r7 = await (await post(t, { kind: "this_week", wording: "This week I'm travelling.", expires_in_days: 7 })).json();
  assert((Date.parse(r7.item.expires_at) - Date.now()) / 86_400_000 < 7.01);
  assertEquals((await post(t, { kind: "this_week", wording: "This week I'm travelling.", expires_in_days: 5 })).status, 400);
  // An expiry on any other kind is simply not a field: the stored row has none.
  const m = await (await post(t, { kind: "matters", wording: "What matters to me is being on time.", expires_in_days: 7 })).json();
  assertEquals(m.item.expires_at, null);
});

Deno.test("comm items: never inferred and never raw: only the person's own statement writes an item", async () => {
  const t: FakeTables = {};
  for (const source of ["draft", "mirror", "import", "carry_over", "guess"]) {
    assertEquals((await post(t, { kind: "lands_hard", wording: "It's hard for me to hear no.", source })).status, 400, source);
  }
  assertEquals(t.beliefs ?? [], []);
});

Deno.test("comm items: a wording that shows risk stores nothing and answers with resources (law 8)", async () => {
  const t: FakeTables = {};
  const r = await post(t, { kind: "other", wording: "I don't want to be alive anymore." });
  const j = await r.json();
  assertEquals([r.status, j.state, j.item], [200, "safety", null]);
  assert(j.resources);
  assertEquals([t.beliefs ?? [], t.receipts ?? []], [[], []]);
});

Deno.test("comm items: the 4.3 checks keep an item out: about the other person, forbids raising, never-on-screen words", async () => {
  const t: FakeTables = {};
  assertEquals((await (await post(t, { kind: "other", wording: "Jan never listens." })).json()).state, "offer_i_statement");
  const f = await (await post(t, { kind: "bring_up", wording: "Never bring up my sister." })).json();
  assertEquals([f.state, f.offer], ["offer_request", "It's hard for me to talk about my sister; ask me first."]);
  assertEquals((await (await post(t, { kind: "how_i_mean", wording: "I have an avoidant style." })).json()).state, "not_kept");
  assertEquals(t.beliefs ?? [], []);
});

Deno.test("comm items: bad input is refused by field name", async () => {
  const t: FakeTables = {};
  for (const [body, field] of [
    [{ kind: "style", wording: "x" }, "kind"], [{ kind: "other", wording: "" }, "wording"], [{ kind: "other", wording: "x".repeat(401) }, "wording"],
    [{ kind: "other", wording: "ok", scope: { type: "group" } }, "scope"], [{ kind: "other", wording: "ok", topic: "faith" }, "topic"],
    [{ kind: "other", wording: "ok", status: "deleted" }, "status"], [{ kind: "other", wording: "ok", when: "w".repeat(121) }, "when"],
  ] as Array<[Row, string]>) {
    const r = await post(t, body);
    assertEquals([r.status, (await r.json()).field], [400, field], JSON.stringify(body));
  }
  // Topic only on What matters to me.
  const r = await post(t, { kind: "other", wording: "ok", topic: "work" });
  assertEquals((await r.json()).problems, ["topic_only_matters"]);
  assertEquals(t.beliefs ?? [], []);
});

Deno.test("comm items: GET puts This week on top, then the kinds in the You order, newest first, empty kinds absent, expired and deleted and others' items gone", async () => {
  const past = new Date(Date.now() - 86_400_000).toISOString(), soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const row = (id: string, kind: string, at: string, over: Row = {}): Row => ({ id, owner: ME, statement: id, status: "confirmed", comm_kind: kind, comm_scope_type: "everyone", comm_scope_value: null, comm_status: "active", created_at: at, confirmed_at: at, ...over });
  const t: FakeTables = {
    beliefs: [
      row("m1", "matters", "2026-11-01T00:00:00Z"), row("m2", "matters", "2026-11-05T00:00:00Z"), row("h1", "how_i_mean", "2026-11-02T00:00:00Z", { comm_last_confirmed_at: "2026-01-01T00:00:00Z" }),
      row("w1", "this_week", "2026-11-03T00:00:00Z", { comm_expires_at: soon }), row("w0", "this_week", "2026-11-03T00:00:00Z", { comm_expires_at: past }),
      row("d1", "other", "2026-11-04T00:00:00Z", { status: "deleted" }), row("old", null as unknown as string, "2026-11-04T00:00:00Z"),
      { ...row("j1", "how_i_mean", "2026-11-04T00:00:00Z"), owner: JAN },
    ],
  };
  const j = await (await run("GET", "/comm/items", t)).json();
  assertEquals(j.this_week.map((x: Row) => x.id), ["w1"]);
  assertEquals(j.groups.map((g: Row) => g.kind), ["how_i_mean", "matters"]);
  assertEquals(j.groups[1].items.map((x: Row) => x.id), ["m2", "m1"]);
  assertEquals(j.groups[0].heading, "How I mean things");
  assertEquals(j.groups[0].items[0].still_true_due, true, "last confirmed over 183 days ago");
  assertEquals(j.groups[1].items[0].still_true_due, false);
});

Deno.test("comm items: PATCH re-words with a new receipt, re-scopes, sets aside, confirms, and re-checks every rule", async () => {
  const t: FakeTables = {};
  const id = (await (await post(t, { kind: "how_i_mean", wording: "When I go quiet, I'm thinking." })).json()).item.id as string;
  const p = (body: Row) => run("PATCH", `/comm/items/${id}`, t, body);
  const w = await (await p({ wording: "When I go quiet, I'm thinking it over." })).json();
  assertEquals(w.item.wording, "When I go quiet, I'm thinking it over.");
  assertEquals(t.receipts.map((r) => r.quote), ["When I go quiet, I'm thinking.", "When I go quiet, I'm thinking it over."]);
  assertEquals((await (await p({ scope: { type: "person", value: JAN } })).json()).item.scope, { type: "person", value: JAN });
  assertEquals((await (await p({ status: "set_aside" })).json()).item.status, "set_aside");
  t.beliefs[0].comm_last_confirmed_at = "2026-01-01T00:00:00Z";
  const c = await (await p({ still_true: true })).json();
  assertEquals(c.item.still_true_due, false);
  assertEquals((await p({ scope: { type: "type", value: "boss" } })).status, 400);
  assertEquals((await p({ expires_in_days: 7 })).status, 400, "only This week expires");
  assertEquals((await p({})).status, 400);
  assertEquals((await (await p({ wording: "I don't want to be alive anymore." })).json()).state, "safety");
  assertEquals(t.beliefs[0].statement, "When I go quiet, I'm thinking it over.", "a refused re-wording changes nothing");
  assertEquals((await run("PATCH", "/comm/items/nope", t, { status: "set_aside" })).status, 404);
});

Deno.test("comm items: PATCH cannot widen a one-person kind to everyone", async () => {
  const t: FakeTables = {};
  const id = (await (await post(t, { kind: "coming_back", wording: "After a hard moment, it helps when we sit together.", scope: { type: "person", value: JAN }, status: "active" })).json()).item.id as string;
  const r = await run("PATCH", `/comm/items/${id}`, t, { scope: { type: "everyone" } });
  assertEquals([r.status, (await r.json()).problems], [400, ["one_person_at_a_time"]]);
  assertEquals(t.beliefs[0].comm_scope_type, "person");
});

Deno.test("comm items: DELETE marks it deleted for the owner only; it leaves GET", async () => {
  const t: FakeTables = {};
  const id = (await (await post(t, { kind: "matters", wording: "What matters to me is being on time." })).json()).item.id as string;
  assertEquals((await run("DELETE", `/comm/items/${id}`, t, {}, { commItems: true, commOwnerIds: [ME, JAN] }, JAN)).status, 404);
  assertEquals((await run("DELETE", `/comm/items/${id}`, t)).status, 200);
  assertEquals(t.beliefs[0].status, "deleted");
  assertEquals((await (await run("GET", "/comm/items", t)).json()).groups, []);
  assertEquals((await run("DELETE", `/comm/items/${id}`, t)).status, 404);
});

Deno.test("share route: an item of a kind that never reaches a card, or one that is not active, is never newly granted; old kennings and revoking are unchanged", async () => {
  const link = { person_a: ME < JAN ? ME : JAN, person_b: ME < JAN ? JAN : ME, status: "active" };
  const b = (id: string, over: Row = {}): Row => ({ id, owner: ME, statement: id, status: "confirmed", rating: "very", ...over });
  const t: FakeTables = {
    links: [link],
    beliefs: [b("old"), b("care", { comm_kind: "feels_like_care", comm_status: "active" }), b("hard", { comm_kind: "lands_hard", comm_status: "active" }),
      b("other", { comm_kind: "other", comm_status: "private_only" }), b("priv", { comm_kind: "bring_up", comm_status: "private_only" })],
    share_items: [{ owner: ME, other: JAN, belief_id: "other", wording: "x" }],
  };
  const put = (bid: string, shared = true) => run("PUT", `/links/${JAN}/share/items/${bid}`, t, { shared }, {});
  assertEquals((await put("old")).status, 200);
  assertEquals((await put("care")).status, 200);
  for (const bid of ["hard", "other", "priv"]) {
    const r = await put(bid);
    assertEquals([bid, r.status, (await r.json()).reason], [bid, 403, "comm_kind_not_shareable"]);
  }
  assertEquals(t.share_items.map((s) => s.belief_id).sort(), ["care", "old", "other"].sort(), "the old grant on a carried-over row stays");
  assertEquals((await put("other", false)).status, 200);
  assertEquals(t.share_items.map((s) => s.belief_id).sort(), ["care", "old"]);
});

// ---------------------------------------------------------------- carry-over suggestions (spec 4.7)
const carried = (id: string, wording: string, kind: string, confidence: number, topic: string | null = null): Row => ({
  id, owner: ME, statement: "x", own_wording: wording, status: "confirmed", comm_kind: "other", comm_scope_type: "everyone", comm_scope_value: null,
  comm_status: "private_only", comm_topic: null, created_at: `2026-11-0${id.length}T10:00:00Z`, comm_suggestion: { kind, confidence, topic },
});
const sugTables = (): FakeTables => ({
  beliefs: [
    carried("a", "I go quiet when I'm tired, it doesn't mean I'm upset.", "how_i_mean", 0.8),
    carried("bb", "I feel looked after when someone texts to say they got home.", "feels_like_care", 0.95),
    carried("ccc", "Being honest matters more to me than being liked.", "matters", 0.9, "morality"),
    carried("dddd", "I need a minute before I talk about money.", "bring_up", 0.7),
    { id: "plain", owner: ME, statement: "x", own_wording: "No suggestion here.", status: "confirmed", comm_kind: "other", comm_status: "private_only", comm_suggestion: null },
    { ...carried("e", "Someone else's.", "how_i_mean", 0.99), owner: JAN },
  ],
  share_items: [{ owner: ME, other: JAN, belief_id: "bb" }, { owner: ME, other: "mum", belief_id: "ccc" }, { owner: ME, other: JAN, belief_id: "ccc" }],
});

Deno.test("suggestions: the next three, strongest first, words and kind only; never a count, a score or someone else's; off for everyone else", async () => {
  const t = sugTables();
  const r = await run("GET", "/comm/suggestions", t);
  assertEquals(r.status, 200);
  const body = await r.json();
  assertEquals(body.suggestions.map((s: Row) => s.id), ["bb", "ccc", "a"]);
  assertEquals(Object.keys(body), ["suggestions"]);
  assertEquals(Object.keys(body.suggestions[0]).sort(), ["heading", "id", "kind", "topic", "wording"]);
  assert(!JSON.stringify(body).includes("0.95") && !JSON.stringify(body).includes("confidence"));
  assertEquals((await run("GET", "/comm/suggestions", t, {}, { commItems: true, commOwnerIds: [ME] }, JAN)).status, 403);
  assertEquals((await run("GET", "/comm/suggestions", t, {}, {})).status, 403);
});

Deno.test("suggestions: That's me writes the kind, scope stays exactly who has the grant today, words and grants are untouched", async () => {
  const t = sugTables();
  const grants = JSON.stringify(t.share_items);
  const one = await run("POST", "/comm/suggestions/bb", t, { action: "accept" });
  assertEquals(one.status, 200);
  const { item, state } = await one.json();
  assertEquals([state, item.kind, item.scope, item.status], ["accepted", "feels_like_care", { type: "person", value: JAN }, "active"]);
  const b = t.beliefs.find((x) => x.id === "bb")!;
  assert(b.comm_native !== true, "a carried-over kenning is never marked as created as an item: it keeps its place on the Map (READ-1 b)");
  assertEquals([b.comm_suggestion, typeof b.comm_last_confirmed_at, b.own_wording], [null, "string", "I feel looked after when someone texts to say they got home."]);
  // Two grantees: it cannot be said as one scope, so the comm model keeps it private and the old grants carry on.
  const two = await (await run("POST", "/comm/suggestions/ccc", t, { action: "accept" })).json();
  assertEquals([two.item.kind, two.item.scope, two.item.status, two.item.topic], ["matters", { type: "everyone", value: null }, "private_only", "morality"]);
  // No grant at all: private too.
  const none = await (await run("POST", "/comm/suggestions/a", t, { action: "accept" })).json();
  assertEquals([none.item.kind, none.item.status], ["how_i_mean", "private_only"]);
  assertEquals(JSON.stringify(t.share_items), grants);
  assertEquals((await run("POST", "/comm/suggestions/a", t, { action: "accept" })).status, 404);   // answered once
  const left = await (await run("GET", "/comm/suggestions", t)).json();
  assertEquals(left.suggestions.map((s: Row) => s.id), ["dddd"]);
});

Deno.test("suggestions: dismiss keeps it under Other, shared as before, and it never comes back; a re-checked refusal keeps it under Other", async () => {
  const t = sugTables();
  const d = await (await run("POST", "/comm/suggestions/a", t, { action: "dismiss" })).json();
  assertEquals([d.state, d.item.kind, d.item.status], ["dismissed", "other", "private_only"]);
  assertEquals(t.beliefs.find((x) => x.id === "a")!.comm_suggestion, null);
  assertEquals((await run("POST", "/comm/suggestions/a", t, { action: "accept" })).status, 404);
  // The wording changed since the pass to something the checks refuse: nothing is written.
  t.beliefs.find((x) => x.id === "bb")!.own_wording = "Jan never listens to me.";
  const r = await run("POST", "/comm/suggestions/bb", t, { action: "accept" });
  assertEquals(r.status, 200);
  assertEquals((await r.json()).item, null);
  const bb = t.beliefs.find((x) => x.id === "bb")!;
  assertEquals([bb.comm_kind, bb.comm_status], ["other", "private_only"]);
  assertEquals((await run("POST", "/comm/suggestions/bb", t, { action: "nope" })).status, 400);
  assertEquals((await run("POST", "/comm/suggestions/e", t, { action: "accept" })).status, 404);   // someone else's item
});

// ---------------------------------------------------------------- v1.91: kind on PATCH, source on the item
Deno.test("PATCH kind: Change kind is a PATCH; words, date, receipts and rating stay; label follows; the 4.3 checks run again under the new kind", async () => {
  const t: FakeTables = {};
  const id = (await (await post(t, { kind: "how_i_mean", wording: "When I go quiet, I'm thinking.", scope: { type: "type", value: "partner" } })).json()).item.id as string;
  const before = { ...t.beliefs[0] };
  const r = await run("PATCH", `/comm/items/${id}`, t, { kind: "feels_like_care" });
  assertEquals(r.status, 200);
  const { item } = await r.json();
  assertEquals([item.kind, item.wording, item.scope, item.status, item.dated_at], ["feels_like_care", "When I go quiet, I'm thinking.", { type: "type", value: "partner" }, "active", item.dated_at]);
  const b = t.beliefs[0];
  assertEquals([b.comm_kind, b.label, b.own_wording, b.rating, b.confirmed_at, b.created_at], ["feels_like_care", "What feels like care", before.own_wording, "very", before.confirmed_at, before.created_at]);
  assertEquals(t.receipts.length, 1, "a kind change adds no receipt");
  assertEquals((await run("PATCH", `/comm/items/${id}`, t, { kind: "nope" })).status, 400);
  // Same kind is not a change: the body then has nothing to write.
  assertEquals((await run("PATCH", `/comm/items/${id}`, t, { kind: "feels_like_care" })).status, 400);
});

Deno.test("PATCH kind: never widens. Into a sensitive or one-person kind an active item goes private; an explicit widening is refused; leaving matters drops the topic", async () => {
  const t: FakeTables = {};
  const id = (await (await post(t, { kind: "matters", wording: "Being honest matters to me.", topic: "morality" })).json()).item.id as string;
  assertEquals(t.beliefs[0].comm_status, "active");
  const lands = await (await run("PATCH", `/comm/items/${id}`, t, { kind: "lands_hard" })).json();
  assertEquals([lands.item.kind, lands.item.status, lands.item.topic, lands.item.scope], ["lands_hard", "private_only", null, { type: "everyone", value: null }]);
  assertEquals(t.beliefs[0].comm_topic, null);
  assertEquals(t.beliefs[0].area, "relationships", "the old topic tag goes with the topic");
  const wide = await run("PATCH", `/comm/items/${id}`, t, { status: "active" });
  assertEquals([wide.status, (await wide.json()).problems], [400, ["one_person_at_a_time"]]);
  // A topic with a kind other than matters is refused.
  const bad = await run("PATCH", `/comm/items/${id}`, t, { kind: "how_i_mean", topic: "work" });
  assertEquals([bad.status, (await bad.json()).problems], [400, ["topic_only_matters"]]);
  assertEquals(t.beliefs[0].comm_kind, "lands_hard", "a refused change writes nothing");
});

Deno.test("PATCH kind: to and from This week sets and clears the expiry; a risky or refused wording under the new kind changes nothing", async () => {
  const t: FakeTables = {};
  const id = (await (await post(t, { kind: "bring_up", wording: "Please ask me before you plan a weekend." })).json()).item.id as string;
  const tw = await (await run("PATCH", `/comm/items/${id}`, t, { kind: "this_week", expires_in_days: 7 })).json();
  assertEquals([tw.item.kind, tw.item.status, typeof tw.item.expires_at], ["this_week", "private_only", "string"]);
  const back = await (await run("PATCH", `/comm/items/${id}`, t, { kind: "bring_up" })).json();
  assertEquals([back.item.kind, back.item.expires_at], ["bring_up", null]);
  assertEquals((await run("PATCH", `/comm/items/${id}`, t, { kind: "bring_up", expires_in_days: 7 })).status, 400);
  t.beliefs[0].own_wording = "I don't want to be alive anymore.";
  const stop = await (await run("PATCH", `/comm/items/${id}`, t, { kind: "matters" })).json();
  assertEquals([stop.state, stop.item], ["safety", null]);
  assertEquals(t.beliefs[0].comm_kind, "bring_up");
});

Deno.test("PATCH kind: choosing a kind for a carried-over item clears its pending suggestion and counts as confirming it; Leave it is POST /comm/suggestions/:id dismiss", async () => {
  const t = sugTables();
  const r = await (await run("PATCH", "/comm/items/a", t, { kind: "gets_heated" })).json();
  assertEquals([r.item.kind, r.item.status], ["gets_heated", "private_only"]);
  const a = t.beliefs.find((x) => x.id === "a")!;
  assertEquals([a.comm_suggestion, typeof a.comm_last_confirmed_at], [null, "string"]);
  assertEquals((await (await run("GET", "/comm/suggestions", t)).json()).suggestions.map((s: Row) => s.id), ["bb", "ccc", "dddd"]);
  // Someone else's item is not found.
  assertEquals((await run("PATCH", "/comm/items/e", t, { kind: "matters" })).status, 404);
});

Deno.test("source: the item says how its words came to be (typed or talk_said, null on an old kenning); a re-word is typed today", async () => {
  const t: FakeTables = {};
  const typed = await (await post(t, { kind: "how_i_mean", wording: "When I go quiet, I'm thinking." })).json();
  const said = await (await post(t, { kind: "gets_heated", wording: "When it gets tense, I leave the room.", source: "talk_said" })).json();
  assertEquals([typed.item.source, said.item.source, t.beliefs[1].comm_source], ["typed", "talk_said", "talk_said"]);
  assertEquals(t.beliefs.map((b) => b.comm_native), [true, true], "created as communication items: off the Map (READ-1 b)");
  assertEquals(typeof said.item.dated_at, "string");
  const g = await (await run("GET", "/comm/items", t)).json();
  assertEquals(g.groups.flatMap((x: Row) => (x.items as Row[]).map((i) => i.source)).sort(), ["talk_said", "typed"]);
  t.beliefs[1].confirmed_at = "2026-01-02T00:00:00.000Z";
  const re = await (await run("PATCH", `/comm/items/${said.item.id}`, t, { wording: "When it gets tense, I step outside." })).json();
  assertEquals(re.item.source, "typed");
  assert(re.item.dated_at > "2026-11-01", "dated today, as the new receipt is");
  const old = await (await run("GET", "/comm/suggestions", sugTables())).json();
  assertEquals(old.suggestions.length, 3);
  const carried = sugTables();
  const acc = await (await run("POST", "/comm/suggestions/a", carried, { action: "accept" })).json();
  assertEquals(acc.item.source, null);
});
