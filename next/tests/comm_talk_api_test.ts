// POST /comm/talk/turn: Talk on the question bank, fake database and a fake model, $0. The switch, the opener (no call), law 8 before any call,
// one checked call per answer, the bank's words when the call fails, the item offered but never stored, and the last answer of a session.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import "../api/comm_talk.ts";
import { ApiError, STATUS } from "../api/lib/errors.ts";
import { hooks } from "../api/talk.ts";
import type { ModelClient, ModelRequest } from "../engine/model/client.ts";
import type { ModelExchange } from "../engine/types.ts";
import { QUESTION_BANK } from "../engine/comm_planner.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const ME = "00000000-0000-4000-8000-0000000000a1", JAN = "00000000-0000-4000-8000-0000000000a2";
type Row = Record<string, unknown>;
const ENV = { commItems: true, commOwnerIds: [ME] };

class Fake implements ModelClient {
  calls: ModelRequest[] = [];
  constructor(private replies: (string | { error: string })[]) {}
  complete(req: ModelRequest): Promise<ModelExchange> {
    this.calls.push(req);
    const r = this.replies.shift();
    const raw = typeof r === "string" ? r : "";
    return Promise.resolve({
      purpose: req.purpose, request: { model: req.model ?? "fake", system: req.system, messages: req.messages, maxTokens: req.maxTokens },
      rawResponse: raw, usage: { model: req.model ?? "fake", inputTokens: 0, outputTokens: 0, cents: 0, ms: 1 },
      ...(typeof r === "object" && r ? { error: r.error } : {}),
    });
  }
}

function turn(t: FakeTables, body: Row, who = ME, env: Row = ENV) {
  const r = routes.find((x) => x.method === "POST" && x.pattern.test("/comm/talk/turn"));
  assert(r);
  const db = fakeClient(t);
  return Promise.resolve(r.handler({ env, req: new Request("https://x.invalid/comm/talk/turn"), url: new URL("https://x.invalid/comm/talk/turn"), params: {}, caller: { id: who, db, isPreview: false }, service: db, tz: "UTC", body: () => Promise.resolve(body) } as never))
    .catch((e) => { if (e instanceof ApiError) return new Response(JSON.stringify({ error: e.code, ...e.extra }), { status: STATUS[e.code] }); throw e; });
}
function withModel(f: Fake) { hooks.client = () => f; }
const reply = (o: Row) => JSON.stringify(o);
const ANSWER = "I go quiet when I'm tired and people think I'm upset, but I'm not.";

Deno.test("comm talk: off by default and for any other account; no call, nothing stored", async () => {
  const f = new Fake([]); withModel(f);
  const t: FakeTables = {};
  try {
    assertEquals((await turn(t, {}, ME, { commItems: false, commOwnerIds: [ME] })).status, 403);
    assertEquals((await turn(t, {}, JAN)).status, 403);
    assertEquals((await turn(t, { text: ANSWER }, ME, {})).status, 403);
    assertEquals([f.calls.length, t.conversations ?? [], t.messages ?? []], [0, [], []]);
  } finally { hooks.client = null; }
});

Deno.test("comm talk: the opener is the bank's first question, no model call, one presence row at turn 0", async () => {
  const f = new Fake([]); withModel(f);
  const t: FakeTables = {};
  try {
    const r = await turn(t, {});
    assertEquals(r.status, 200);
    const body = await r.json();
    assertEquals([body.reply.state, body.reply.question, body.reply.comm.kind, body.message], ["ask", QUESTION_BANK[0].open, "how_i_mean", null]);
    assertEquals([f.calls.length, t.messages.length, t.messages[0].role, t.messages[0].turn], [0, 1, "presence", 0]);
    assertEquals(body.conversation.session_number, 1);
  } finally { hooks.client = null; }
});

Deno.test("comm talk: a risky answer stops before any call and stores nothing (law 8)", async () => {
  const f = new Fake([]); withModel(f);
  const t: FakeTables = {};
  try {
    const r = await turn(t, { text: "I want to end it all." });
    const body = await r.json();
    assertEquals([r.status, body.reply.state, body.reply.item, body.reply.question], [200, "safety", null, ""]);
    assert(body.reply.resources);
    assertEquals([f.calls.length, t.messages ?? [], t.conversations ?? []], [0, [], []]);
  } finally { hooks.client = null; }
});

Deno.test("comm talk: an answer makes one call; the item is offered in the person's words and is not stored (law 3)", async () => {
  const f = new Fake([reply({ reflection: "You go quiet when you're tired, and it isn't being upset.", question: "", item: ANSWER })]); withModel(f);
  const t: FakeTables = {};
  try {
    const first = await (await turn(t, {})).json();
    const cid = first.conversation.id;
    const r = await turn(t, { text: ANSWER, conversation_id: cid });
    const body = await r.json();
    assertEquals(r.status, 200);
    assertEquals(f.calls.length, 1);
    assertEquals([body.reply.state, body.reply.comm.kind, body.reply.item_state], ["ask", "bring_up", "offered"]);
    assertEquals(body.reply.item, { kind: "how_i_mean", wording: ANSWER });
    assertEquals(body.reply.question, QUESTION_BANK[2].open);     // the model's empty question falls back to the bank's own words
    assertEquals(t.beliefs ?? [], []);                             // nothing is stored until the person says "That's me"
    assertEquals(t.receipts ?? [], []);
    assertEquals(t.messages.filter((m) => m.role === "me").length, 1);
    assertEquals(t.engine_calls.length, 1);
    assertEquals(JSON.parse(f.calls[0].messages[0].content).answered_kind, "how_i_mean");
  } finally { hooks.client = null; }
});

Deno.test("comm talk: a failed call is not a failed turn: the bank's question, no reflection, no item", async () => {
  const f = new Fake([{ error: "timeout" }]); withModel(f);
  const t: FakeTables = {};
  try {
    const first = await (await turn(t, {})).json();
    const body = await (await turn(t, { text: ANSWER, conversation_id: first.conversation.id })).json();
    assertEquals([body.reply.state, body.reply.reflection, body.reply.item, body.reply.question_from ?? body.reply.comm.question_from], ["ask", "", null, "bank"]);
    assertEquals(body.reply.question, QUESTION_BANK[2].open);
  } finally { hooks.client = null; }
});

Deno.test("comm talk: an item that is not their words, or about someone else, is kept out with its reason", async () => {
  const f = new Fake([
    reply({ item: "I get anxious around my mother because of my childhood." }),
    reply({ item: "Jan never listens to me." }),
  ]); withModel(f);
  const t: FakeTables = {};
  try {
    const first = await (await turn(t, {})).json();
    const cid = first.conversation.id;
    const a = await (await turn(t, { text: ANSWER, conversation_id: cid })).json();
    assertEquals([a.reply.item, a.reply.item_state], [null, null]);
    const b = await (await turn(t, { text: "Jan never listens to me.", conversation_id: cid })).json();
    assertEquals([b.reply.item, b.reply.item_state], [null, "offer_i_statement"]);
  } finally { hooks.client = null; }
});

Deno.test("comm talk: the last answer of the first session still gets its item, asks nothing and closes the conversation", async () => {
  // own_download walks three kinds; after the third answer the planner has nothing left.
  const f = new Fake([reply({ item: "I go quiet when I'm tired." }), reply({}), reply({ reflection: "A call from a friend helped.", item: "A call from a friend made me feel looked after." })]); withModel(f);
  const t: FakeTables = {};
  try {
    const first = await (await turn(t, {})).json();
    const cid = first.conversation.id;
    await turn(t, { text: "I go quiet when I'm tired.", conversation_id: cid });
    await turn(t, { text: "My sister started with how are you really.", conversation_id: cid });
    const last = await (await turn(t, { text: "A call from a friend made me feel looked after.", conversation_id: cid })).json();
    assertEquals([last.reply.state, last.reply.reason, last.reply.question], ["done", "nothing_left", ""]);
    assertEquals(last.reply.item, { kind: "feels_like_care", wording: "A call from a friend made me feel looked after." });
    assertEquals(t.conversations[0].status, "finished");
    assertEquals(f.calls.length, 3);
  } finally { hooks.client = null; }
});

Deno.test("comm talk: the second session is recognised by an item that existed before this conversation began", async () => {
  const f = new Fake([]); withModel(f);
  const t: FakeTables = { beliefs: [{ id: "b1", owner: ME, status: "confirmed", comm_kind: "how_i_mean", comm_status: "active", created_at: "2020-01-01T00:00:00.000Z" }] };
  try {
    const body = await (await turn(t, {})).json();
    assertEquals(body.conversation.session_number, 2);
    assertEquals(body.reply.comm.kind, "feels_like_care");        // how_i_mean is already held, so it is not asked again
  } finally { hooks.client = null; }
});
