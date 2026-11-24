// QA 16 Nov F1-F3 (Opus verdict on e66ba2bc), adapted from QA's probes. Real route table, in-memory db, recorded or failing model, $0.
// /talk/edit reads the edited words once, before anything changes, and that reading is the reading: a stop stands (no later reading may
// clear it), and there is no second reading left to fail after the row changed. With the provider fully down, the Bridge draft routes
// answer the unavailable state with the help line instead of throwing before they can.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import type { ModelClient, ModelRequest } from "../engine/model/client.ts";
import type { ModelExchange } from "../engine/types.ts";
import { routes } from "../api/lib/router.ts";
import { hooks } from "../api/talk.ts";
import { hooks as bridgeHooks } from "../api/bridge_engine.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const OWNER = "00000000-0000-4000-8000-0000000000a1", SENDER_ID = "00000000-0000-4000-8000-0000000000b2";
const EDIT = "Dinner moved again and nobody asked me first.";
const NONE_SAFETY = JSON.stringify({ act: "an ordinary evening", purpose: "neither", risk: "none", class: "ordinary", reason: "nothing" });
const STOP_SAFETY = JSON.stringify({ act: "hurt a person", purpose: "harm", risk: "others", class: "plan", reason: "a stated plan to hurt a person" });
const reply = (level: string) => JSON.stringify({ risk: { level, reason: level === "none" ? "" : "the turn says so" }, feeling: "neutral", title: null, permission_domain: null,
  reflection: "Dinner moved without anyone asking you.", question: "What did you do when the new time came through?",
  move: { kind: "follow", why: "first turn", gap: "self: unknown" }, beliefs: [] });

function seeded(riskTurn: number | null): FakeTables {
  return {
    profiles: [{ id: OWNER, name: "Marin" }, { id: SENDER_ID, name: "Jo" }], beliefs: [], receipts: [], belief_links: [], consent: [], engine_calls: [],
    conversations: [{ id: "c1", owner: OWNER, status: "active", mode: "voice", risk_turn: riskTurn, source: "talk", hypotheses: [], last_active_at: "2026-11-16T00:00:00Z" }],
    messages: [
      { id: "m1", owner: OWNER, conversation_id: "c1", role: "me", turn: 1, text: "Earlier words.", superseded: false, deleted_at: null, edited_at: null },
      { id: "p1", owner: OWNER, conversation_id: "c1", role: "presence", turn: 1, text: "ok", superseded: false, deleted_at: null },
      { id: "m2", owner: OWNER, conversation_id: "c1", role: "me", turn: 2, text: "Later words.", superseded: false, deleted_at: null, edited_at: null },
      { id: "p2", owner: OWNER, conversation_id: "c1", role: "presence", turn: 2, text: "ok", superseded: false, deleted_at: null },
    ],
  };
}

function call(db: ReturnType<typeof fakeClient>, path: string, body: Record<string, unknown>) {
  const found = routes.find((r) => r.method === "POST" && r.pattern.test(path));
  assert(found, `no route for ${path}`);
  return found.handler({
    env: { safetySemantic: true }, req: new Request("https://presence.invalid" + path, { method: "POST" }), url: new URL("https://presence.invalid" + path),
    params: {}, caller: { id: OWNER, isPreview: false, db }, service: db, tz: "UTC", body: () => Promise.resolve(body),
  } as never);
}

async function withModel(client: ModelClient, fn: () => Promise<void>) {
  hooks.client = () => client; bridgeHooks.client = () => client;
  try { await fn(); } finally { hooks.client = null; bridgeHooks.client = null; }
}

Deno.test("edit: a pre-read stop stands when a second reading would have been clear (QA Q3)", async () => {
  const t = seeded(null);
  await withModel(new RecordedClient({ turn: [reply("none")], safety: [STOP_SAFETY, NONE_SAFETY] }), async () => {
    const j = await (await call(fakeClient(t), "/talk/edit", { message_id: "m1", text: EDIT })).json();
    assertEquals(j.reply.state, "safety");
    assert(j.reply.safety, "resources shown");
  });
  assertEquals(t.conversations[0].risk_turn, 1, "the stop pauses mapping");
});

Deno.test("edit: a pre-read stop is the usual stop with resources even when no second reading could answer (QA Q2)", async () => {
  const t = seeded(null);
  await withModel(new RecordedClient({ turn: [reply("none")], safety: [STOP_SAFETY] }), async () => {
    const j = await (await call(fakeClient(t), "/talk/edit", { message_id: "m1", text: EDIT })).json();
    assertEquals(j.reply.state, "safety");
  });
});

Deno.test("edit: one reading only; a clear pre-read is not read again, so nothing can fail half way (QA Q1, F2)", async () => {
  const t = seeded(1);
  const recorded = new RecordedClient({ turn: [reply("none")], safety: [NONE_SAFETY] });
  let safetyCalls = 0;
  const counting: ModelClient = { model: recorded.model, complete: (req: ModelRequest) => { if (req.purpose === "safety") safetyCalls++; return recorded.complete(req); } } as ModelClient;
  await withModel(counting, async () => {
    const j = await (await call(fakeClient(t), "/talk/edit", { message_id: "m1", text: EDIT })).json();
    assertEquals(j.reply.state, "turn", "a clear reading answers the edited words as an ordinary turn");
  });
  assertEquals(safetyCalls, 1, "the edited words are read once");
  assertEquals(t.messages.find((m) => m.id === "m1")!.text, EDIT);
});

Deno.test("edit: a pre-read that cannot answer changes nothing and keeps risk_turn (QA Q1b)", async () => {
  const t = seeded(1);
  await withModel(new RecordedClient({ turn: [reply("none")] }), async () => {
    const j = await (await call(fakeClient(t), "/talk/edit", { message_id: "m1", text: EDIT })).json();
    assertEquals(j.reply.state, "unavailable");
  });
  assertEquals(t.messages.find((m) => m.id === "m1")!.text, "Earlier words.");
  assertEquals(["p1", "m2", "p2"].map((id) => t.messages.find((m) => m.id === id)!.superseded), [false, false, false]);
  assertEquals(t.conversations[0].risk_turn, 1);
});

// F3: the live client's shape on a provider outage: every call comes back as an exchange with a transport error and no text, never a throw.
class DownClient implements ModelClient {
  model = "down";
  complete(req: ModelRequest): Promise<ModelExchange> {
    return Promise.resolve({ purpose: req.purpose, request: { model: this.model, system: req.system, messages: req.messages, maxTokens: req.maxTokens }, rawResponse: "", error: "network: provider unreachable", usage: { model: this.model, inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 } } as ModelExchange);
  }
}
const DRAFT = "You said tomorrow and I am holding you to it, so thanks for that.";
for (const [path, body] of [["/talk/turn", { text: EDIT }], ["/bridge/insight", { person_id: SENDER_ID, text: DRAFT }],
  ["/bridge/insight", { person_id: SENDER_ID, text: DRAFT, with_wording: true }], ["/bridge/run", { person_id: SENDER_ID, text: DRAFT }]] as [string, Record<string, unknown>][]) {
  Deno.test(`full provider outage ${path}${body.with_wording ? " (with wording)" : ""}: the unavailable state with the help line (QA F3)`, async () => {
    const t = seeded(null); t.conversations = []; t.messages = [];
    t.links = [{ owner: OWNER, person: SENDER_ID, relationship: "partner" }]; t.bridges = []; t.drafts = [];
    await withModel(new DownClient(), async () => {
      const res = await call(fakeClient(t), path, body);
      const j = await res.json();
      const r = j.reply ?? j;
      assertEquals(res.status, 200);
      assertEquals(r.state ?? r.outcome, "unavailable");
      assertEquals(r.help, "Need to talk to someone now?");
      assert(r.resources, "the resources are one tap away");
    });
  });
}
