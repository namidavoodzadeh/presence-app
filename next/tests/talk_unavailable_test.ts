// PSY 16 Nov 2c-2h on the Talk routes. Real route table, the in-memory database, a recorded model, $0.
// An unreadable safety reading: the turn is not shown, not mapped, not stored (the words stay in the field), a conversation the turn
// opened goes with it, risk_turn is untouched, and the reply is the one 'unavailable' shape. One reading saying stop and the other
// unavailable is the usual stop with resources.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { routes } from "../api/lib/router.ts";
import { hooks } from "../api/talk.ts";
import { hooks as bridgeHooks } from "../api/bridge_engine.ts";
import { UNREAD_ACTION, UNREAD_HELP, UNREAD_LINE } from "../api/lib/safety_gate.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const ORDINARY = "Dinner moved again and nobody asked me first.";
const NONE_SAFETY = JSON.stringify({ act: "an ordinary evening", purpose: "neither", risk: "none", class: "ordinary", reason: "nothing" });
const reply = (level: string) => JSON.stringify({ risk: { level, reason: level === "none" ? "" : "the turn says so" }, feeling: "neutral", title: null, permission_domain: null,
  reflection: "Dinner moved without anyone asking you.", question: "What did you do when the new time came through?",
  move: { kind: "follow", why: "first turn", gap: "self: unknown" }, beliefs: [] });

function tables(): FakeTables {
  return { profiles: [{ id: OWNER, name: "Marin" }], conversations: [], messages: [], beliefs: [], receipts: [], belief_links: [], consent: [], engine_calls: [] };
}

function call(db: ReturnType<typeof fakeClient>, method: string, path: string, body: Record<string, unknown>, semantic = true) {
  const found = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(found, `no route for ${method} ${path}`);
  return found.handler({
    env: { safetySemantic: semantic }, req: new Request("https://presence.invalid" + path, { method }), url: new URL("https://presence.invalid" + path),
    params: {}, caller: { id: OWNER, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve(body),
  } as never);
}

async function withModel(client: RecordedClient, fn: () => Promise<void>) {
  hooks.client = () => client;
  bridgeHooks.client = () => client;
  try { await fn(); } finally { hooks.client = null; bridgeHooks.client = null; }
}

Deno.test("Talk turn, first words, the safety reading is down: unavailable shape, nothing stored, no conversation left behind", async () => {
  const t = tables();
  await withModel(new RecordedClient({ turn: [reply("none")] }), async () => {   // no safety reading recorded = the reader could not answer
    const res = await call(fakeClient(t), "POST", "/talk/turn", { text: ORDINARY });
    const j = await res.json();
    assertEquals(res.status, 200);
    assertEquals(j.reply.state, "unavailable");
    assertEquals([j.reply.line, j.reply.action, j.reply.help], [UNREAD_LINE, UNREAD_ACTION, UNREAD_HELP]);
    assert(j.reply.resources, "the resources are one tap away");
    assertEquals([j.conversation, j.message], [null, null]);
  });
  assertEquals(t.messages.length, 0, "the person's words are not kept");
  assertEquals(t.conversations.length, 0, "the conversation this turn opened goes with it");
  assertEquals(t.beliefs.length, 0);
});

Deno.test("Talk turn in a running conversation: the earlier turns stay, the unread turn goes, risk_turn is untouched", async () => {
  const t = tables();
  t.conversations.push({ id: "c1", owner: OWNER, status: "active", mode: "voice", risk_turn: null, source: "talk", hypotheses: [], last_active_at: "2026-11-16T00:00:00Z" });
  t.messages.push({ id: "m1", owner: OWNER, conversation_id: "c1", role: "me", turn: 1, text: "Earlier words.", superseded: false, deleted_at: null });
  t.messages.push({ id: "p1", owner: OWNER, conversation_id: "c1", role: "presence", turn: 1, text: "ok", superseded: false, deleted_at: null });
  await withModel(new RecordedClient({ turn: [reply("none")] }), async () => {
    const j = await (await call(fakeClient(t), "POST", "/talk/turn", { text: ORDINARY, conversation_id: "c1" })).json();
    assertEquals(j.reply.state, "unavailable");
    assertEquals(j.conversation?.id, "c1");
  });
  assertEquals(t.messages.map((m) => m.id), ["m1", "p1"]);
  assertEquals(t.conversations[0].risk_turn, null, "an outage is not a risk stop: mapping is not paused");
});

Deno.test("Talk turn: a readable safety reading that says none is an ordinary turn (the outage state is not a default)", async () => {
  const t = tables();
  await withModel(new RecordedClient({ turn: [reply("none")], safety: [NONE_SAFETY] }), async () => {
    const j = await (await call(fakeClient(t), "POST", "/talk/turn", { text: ORDINARY })).json();
    assertEquals(j.reply.state, "turn");
  });
  assertEquals(t.messages.filter((m) => m.role === "me").length, 1);
});

Deno.test("Talk turn: reader down but the turn call's own risk field says stop is the usual stop with resources", async () => {
  const t = tables();
  await withModel(new RecordedClient({ turn: [reply("self")] }), async () => {
    const j = await (await call(fakeClient(t), "POST", "/talk/turn", { text: ORDINARY })).json();
    assertEquals(j.reply.state, "safety");
    assert(j.reply.safety, "resources are shown");
  });
});

Deno.test("Talk edit, reader down: nothing is edited, superseded or re-checked", async () => {
  const t = tables();
  t.conversations.push({ id: "c1", owner: OWNER, status: "active", mode: "voice", risk_turn: null, source: "talk", hypotheses: [], last_active_at: "2026-11-16T00:00:00Z" });
  t.messages.push({ id: "m1", owner: OWNER, conversation_id: "c1", role: "me", turn: 1, text: "Earlier words.", superseded: false, deleted_at: null, edited_at: null });
  t.messages.push({ id: "p1", owner: OWNER, conversation_id: "c1", role: "presence", turn: 1, text: "ok", superseded: false, deleted_at: null });
  await withModel(new RecordedClient({ turn: [reply("none")] }), async () => {
    const j = await (await call(fakeClient(t), "POST", "/talk/edit", { message_id: "m1", text: ORDINARY })).json();
    assertEquals(j.reply.state, "unavailable");
  });
  assertEquals(t.messages.find((m) => m.id === "m1")!.text, "Earlier words.");
  assertEquals(t.messages.find((m) => m.id === "p1")!.superseded, false);
});

Deno.test("source: the stream route announces an unavailable turn as its own event, never as safety", async () => {
  const src = await Deno.readTextFile(new URL("../api/talk.ts", import.meta.url));
  assert(src.includes('send("unavailable", { reply })'));
});

// ---- the Bridge draft analysis (the three routes that read a live draft)

const SENDER_ID = "00000000-0000-4000-8000-0000000000b2";
const ANALYSIS = JSON.stringify({ points: [{ kind: "fact", quote: "tomorrow" }], feeling: { name: "fed up", intensity: 2 }, frictions: [], safety: "none", safetyReason: "", safetyQuotes: [], receiverInnerLife: [], asks: [], tone: "neutral" });
const DRAFT = "You said tomorrow and I am holding you to it, so thanks for that.";

function bridgeTables(): FakeTables {
  return { ...tables(), links: [{ owner: OWNER, person: SENDER_ID, relationship: "partner" }], bridges: [], drafts: [], profiles: [{ id: OWNER, name: "Marin" }, { id: SENDER_ID, name: "Jo" }] };
}

for (const [path, body] of [
  ["/bridge/insight", { person_id: SENDER_ID, text: DRAFT }],
  ["/bridge/insight", { person_id: SENDER_ID, text: DRAFT, with_wording: true }],
  ["/bridge/run", { person_id: SENDER_ID, text: DRAFT }],
] as [string, Record<string, unknown>][]) {
  Deno.test(`${path}${body.with_wording ? " (with wording)" : ""}: the safety reading is down — the unavailable state, nothing rewritten, never the resources stop`, async () => {
    const client = new RecordedClient({ analyse: [ANALYSIS], analyse_repair: [ANALYSIS] });
    await withModel(client, async () => {
      let res: Response;
      try { res = await call(fakeClient(bridgeTables()), "POST", path, body); } catch (e) { throw new Error(`route threw: ${e}`); }
      const j = await res.json();
      assertEquals(res.status, 200);
      assertEquals(j.state ?? j.outcome, path === "/bridge/run" ? "unavailable" : "unavailable");
      assertEquals([j.line, j.action, j.help], [UNREAD_LINE, UNREAD_ACTION, UNREAD_HELP]);
      assert(j.resources, "resources are one tap away");
      assertEquals(j.bridged ?? null, null);
      assert(!client.exchanges.some((e) => e.purpose === "rewrite"), "no rewrite package was sent");
    });
  });
}
