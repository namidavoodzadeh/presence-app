// QA-B336 (COO 02:20Z 16 Nov): the one safety entry. $0: recorded clients only.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { safetyEntries, safetyEntry } from "../engine/safety_entry.ts";
import { keywordRisk } from "../engine/safety.ts";
import { talkTurn } from "../engine/talk/turn.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import { bridgeDraft } from "../engine/bridge/bridge.ts";
import type { Draft, Sender } from "../engine/bridge/types.ts";
import { buildCards, semanticStops } from "../api/lib/ask_me.ts";

const UNLISTED = "My brother keeps telling me the stairs at his place are going to be the end of me."; // the floor lets it through (safety_semantic_test)
const NONE = JSON.stringify({ act: "an ordinary evening", purpose: "neither", risk: "none", class: "ordinary", reason: "nothing" });
const OTHERS = JSON.stringify({ act: "poison a person", purpose: "harm", risk: "others", class: "plan", reason: "a plan to poison a person" });
const ORDINARY = "I stayed late on Friday and then walked home.";

Deno.test("entry: switch off is the floor alone, no call; floor stop stands without a call when no class fits", async () => {
  const off = await safetyEntry(null, UNLISTED, { semantic: false });
  assertEquals([off.stop, off.via, off.exchanges.length], [false, "floor_only", 0]);
  const floorOnly = await safetyEntry(null, "I want to end it all tonight.", { semantic: false });
  assertEquals([floorOnly.stop, floorOnly.risk], [true, "self"]);
  const client = new RecordedClient({});
  const on = await safetyEntry(client, "I want to end it all tonight.", { semantic: true });
  assertEquals([on.stop, on.via, on.exchanges.length], [true, "floor", 0]);
});

Deno.test("entry: a line the floor misses is stopped by the semantic reading, and passed when it reads none", async () => {
  const stopped = await safetyEntry(new RecordedClient({ safety: [OTHERS] }), UNLISTED, { semantic: true });
  assertEquals([stopped.stop, stopped.via, stopped.risk, stopped.unavailable], [true, "semantic", "others", false]);
  assertEquals(stopped.exchanges.length, 1);
  const clear = await safetyEntry(new RecordedClient({ safety: [NONE] }), ORDINARY, { semantic: true });
  assertEquals([clear.stop, clear.via], [false, "clear"]);
});

Deno.test("entry: FAILS CLOSED. No reading, an error or an unreadable reply stops as 'unavailable' (not a risk); it never passes", async () => {
  for (const [name, client] of [["no client", null], ["no reply", new RecordedClient({})], ["unreadable", new RecordedClient({ safety: ["not json at all"] })]] as const) {
    const r = await safetyEntry(client, ORDINARY, { semantic: true });
    assertEquals([name, r.stop, r.unavailable, r.via, r.routed], [name, true, true, "unavailable", "unavailable"]);
    assertStringIncludes(r.reason, "unavailable");
  }
  // the same ordinary words with the switch OFF pass: only a switched-on check can fail closed
  assertEquals((await safetyEntry(null, ORDINARY, { semantic: false })).stop, false);
});

Deno.test("entry: harm aimed at the receiver is routed as a threat, any other stop as a risk (Bridge's two stops)", async () => {
  const AIMED = "One day soon something is going to hit your car while you're in it, and I'll make sure of it.";
  assertEquals(keywordRisk(AIMED).risk, "none");
  const aimed = await safetyEntry(new RecordedClient({ safety: [OTHERS] }), AIMED, { semantic: true });
  assertEquals(aimed.routed, "threat_or_abuse");
  const plain = await safetyEntry(new RecordedClient({ safety: [OTHERS] }), UNLISTED, { semantic: true });
  assertEquals(plain.routed, "risk");
});

Deno.test("entries: Ask me answers each get the entry; one unavailable answer stops only itself", async () => {
  const answers = [{ id: "a1", text: ORDINARY }, { id: "a2", text: UNLISTED }, { id: "a3", text: ORDINARY }];
  const client = new RecordedClient({ safety: [NONE, OTHERS] }); // a1 none, a2 others, a3: nothing queued -> unavailable
  const out = await safetyEntries(client, answers.map((a) => a.text), { semantic: true });
  assertEquals(out.map((r) => r.stop), [false, true, true]);
  const ids = await semanticStops(new RecordedClient({ safety: [OTHERS] }), [{ id: "x", text: UNLISTED }], true);
  assertEquals([...ids], ["x"]);
  assertEquals((await semanticStops(null, [{ id: "x", text: UNLISTED }], false)).size, 0); // switch off: the floor in buildCards decides
});

Deno.test("Ask me: buildCards drops a semantically stopped answer as a safety stop, nothing stored", () => {
  const a = (id: string, text: string) => ({ id, text } as never);
  const r = buildCards([a("a1", UNLISTED), a("a2", UNLISTED), a("a3", UNLISTED)], [], { semanticStopped: new Set(["a2"]), linkClosed: true });
  assert(r.stopped.includes("a2"));
});

const SENDER: Sender = { personaId: "marin", firstName: "Marin", map: { beliefs: [], consent: {}, openThreads: [] }, earlierMessages: [], receiverShared: [] };
const draft = (message: string): Draft => ({ id: "s1", senderId: "marin", relationship: "partner", message, hiddenIntent: "", expected: { frictions: [], safety: "none", nothingToChange: false } });
const ANALYSIS_NONE = JSON.stringify({ points: [{ kind: "fact", quote: "tomorrow" }], feeling: { name: "fed up", intensity: 2 }, frictions: [], safety: "none", safetyReason: "", safetyQuotes: [], receiverInnerLife: [], asks: [], tone: "neutral" });

Deno.test("Bridge: with the check switched on, an unavailable reading is its own state (PSY 2c): no rewrite, no resources stop, nothing kept", async () => {
  const msg = "You said tomorrow and I'm holding you to it.";
  const closed = await bridgeDraft(new RecordedClient({ analyse: [ANALYSIS_NONE], analyse_repair: [ANALYSIS_NONE] }), draft(msg), SENDER, { semanticCheck: true });
  assertEquals(closed.unreadable, true);
  assertEquals(closed.result.status, "could_not_bridge");
  assertEquals(closed.result.resources, null);
  assertEquals(closed.attempts.length, 0);
});

Deno.test("Bridge: an unreadable required reading stops before analysis, even when an analysis fixture would say risk", async () => {
  const risky = JSON.stringify({ ...JSON.parse(ANALYSIS_NONE), safety: "risk", safetyReason: "says so", safetyQuotes: [{ quote: "tomorrow" }] });
  const client = new RecordedClient({ analyse: [risky], analyse_repair: [risky] });
  const closed = await bridgeDraft(client, draft("You said tomorrow and I'm holding you to it."), SENDER, { semanticCheck: true });
  assertEquals(closed.unreadable, true);
  assertEquals(closed.result.status, "could_not_bridge");
  assertEquals(closed.result.resources, null);
  assertEquals(client.exchanges.length, 0);
});

const STATE = (): TurnState => ({ person: { firstName: "Marin", language: "en", about: [] }, map: { beliefs: [], consent: {}, openThreads: [] }, session: { id: "s1", date: "2026-10-26", turns: [] }, previous: [], hypotheses: new Map() });
const TURN_REPLY = JSON.stringify({ risk: { level: "none", reason: "" }, reflection: "Friday ended with you walking home.", question: "What was that walk like?", move: { kind: "follow", why: "stay", gap: "" }, permission_domain: null, beliefs: [] });

Deno.test("Talk: with the check switched on, an unavailable reading is its own state (PSY 2c): no cards, no hypotheses, the turn is not kept on the session", async () => {
  const state = STATE();
  const t = await talkTurn(new RecordedClient({ turn: [TURN_REPLY] }), state, ORDINARY, undefined, undefined, "told", { semanticCheck: true });
  assertEquals(t.shown.state, "unavailable");
  assertEquals(t.shown.cards, []);
  assertEquals(t.hypotheses, []);
  assertEquals(state.session.turns.length, 0);
});

// Ratchet: every route that takes a person's words goes through the one entry. The floor alone is not an entry any more.
Deno.test("source: the API routes that take a person's words call requireSafetyPass (the one gate over gateWords), and none still has a floor-only gate", async () => {
  const read = (f: string) => Deno.readTextFile(new URL(`../api/${f}`, import.meta.url));
  for (const f of ["bridge.ts", "checkin.ts", "reading.ts", "map.ts", "mirror.ts", "import_ai.ts"]) {
    const src = await read(f);
    assertStringIncludes(src, "requireSafetyPass(", `${f} must call the one safety entry`);
    assert(!/\bfloorSafety\(/.test(src), `${f} still calls floorSafety directly`);
  }
  const map = await read("map.ts"), imp = await read("import_ai.ts");
  assert(!/\bkeywordRisk\(/.test(map) && !/\bkeywordRisk\(/.test(imp));
  const mirror = await read("mirror.ts");
  assertStringIncludes(mirror, 'requireSafetyPass(ctx, moment, "mirror", [], owner)');
  assertStringIncludes(mirror, 'requireSafetyPass(ctx, q.question, "mirror", [])');
  // Talk still has its rollout switch. Bridge cannot leave a P0 safety reader
  // disabled: its live routes always pass the add-only, fail-closed reader.
  assertStringIncludes(await read("talk.ts"), "semanticCheck: ctx.env.safetySemantic === true");
  const bridgeEngine = await read("bridge_engine.ts");
  assertStringIncludes(bridgeEngine, "semanticCheck: true");
  assert(!bridgeEngine.includes("semanticCheck: ctx.env.safetySemantic === true"));
  const insight = bridgeEngine.slice(bridgeEngine.indexOf('route("POST", "/bridge/insight"'), bridgeEngine.indexOf('route("POST", "/bridge/run"'));
  assert(insight.indexOf("await semanticRisk(insightClient, text)") !== -1 && insight.indexOf("await semanticRisk(insightClient, text)") < insight.indexOf("runWritePipeline("), "V3 insight must read safety before Write");
});

// ---- PSY 16 Nov 2b/2c: what the entry returns for a refusal, an outage, and one-of-two

const refusingClient = (): import("../engine/model/client.ts").ModelClient => ({
  complete(req) {
    return Promise.resolve({ purpose: req.purpose, request: { model: "m", system: "", messages: [], maxTokens: 1 }, rawResponse: "",
      usage: { model: "m", inputTokens: 1, outputTokens: 0, cents: 0, ms: 1, stopReason: "refusal" } });
  },
});

Deno.test("entry 2b: a reader that REFUSED the message is the usual stop with resources, not the outage state", async () => {
  const r = await safetyEntry(refusingClient(), UNLISTED, { semantic: true });
  assertEquals([r.stop, r.unavailable, r.routed, r.via], [true, false, "risk", "semantic"]);
});

Deno.test("entry 2c: no reading, floor silent: stop for every caller, routed 'unavailable', not a risk; floor first (2a): a floor stop never needs a provider", async () => {
  const outage = await safetyEntry(new RecordedClient({}), ORDINARY, { semantic: true });
  assertEquals([outage.stop, outage.routed, outage.via], [true, "unavailable", "unavailable"]);
  const floor = await safetyEntry(null, "I want to end it all tonight.", { semantic: true });
  assertEquals([floor.stop, floor.routed, floor.unavailable], [true, "risk", false]); // no client at all: the floor still answers with the usual stop
});

Deno.test("entry 2b: a floor stop with one class reading clearing and the other unavailable is the usual stop, not the outage state", async () => {
  // A floor row of a benign class (held fixture): one reading answers none + the class, the other has nothing queued -> unavailable.
  const held = JSON.parse(await Deno.readTextFile(new URL("./fixtures/b336_psy_classes.json", import.meta.url)));
  const row = held.classes.negation.must_clear[0] as string;
  assert(keywordRisk(row).risk !== "none", "the fixture row is a floor row");
  const r = await safetyEntry(new RecordedClient({ safety: [JSON.stringify({ act: "wanting to be heard", purpose: "neither", risk: "none", class: "negation", reason: "negated" })] }), row, { semantic: true });
  assert(r.stop, "one unavailable key can never clear a floor stop");
  assert(r.routed !== "unavailable", "a floor stop stays a risk stop with resources");
});

Deno.test("check-in 2c: an unreadable reading never reaches decidePark (it would park the note); source ratchet", async () => {
  const src = await Deno.readTextFile(new URL("../api/checkin.ts", import.meta.url));
  const body = src.slice(src.indexOf("export async function safetyDecision"));
  assert(body.indexOf('floor.routed === "unavailable"') > 0 && body.indexOf('floor.routed === "unavailable"') < body.indexOf("decidePark("));
  const session = await Deno.readTextFile(new URL("../api/checkin_session.ts", import.meta.url));
  assertStringIncludes(session, 'decision.state === "unavailable"');
});

Deno.test("2c: every route that calls gateWords answers the unavailable state itself (a stop that is not 'safety' must be handled, never fall through)", async () => {
  const api = new URL("../api/", import.meta.url);
  for await (const f of Deno.readDir(api)) {
    if (!f.isFile || !f.name.endsWith(".ts") || f.name.endsWith("_test.ts")) continue;
    const src = await Deno.readTextFile(new URL(f.name, api));
    if (!/\bgateWords\(ctx/.test(src)) continue;
    assert(/unavailable/.test(src), `${f.name} calls gateWords but never handles routed === "unavailable"`);
  }
});

Deno.test("Ask me is proven off in the friends' configuration: no route and no importer of lib/ask_me.ts in api/ or engine/, so no Ask me model call can run (PSY 16 Nov, QA 03:50Z)", async () => {
  for (const dir of ["../api/", "../engine/"]) {
    const walk = async (u: URL): Promise<void> => {
      for await (const f of Deno.readDir(u)) {
        const child = new URL(f.name + (f.isDirectory ? "/" : ""), u);
        if (f.isDirectory) { await walk(child); continue; }
        if (!f.name.endsWith(".ts") || f.name.endsWith("_test.ts") || f.name === "ask_me.ts") continue;
        const src = await Deno.readTextFile(child);
        // ask_me_step.ts (the model step) is the one module that may import ask_me.ts, and only while nothing in api/ or engine/ imports it.
        if (f.name !== "ask_me_step.ts") assert(!/from\s+"[^"]*\/ask_me\.ts"/.test(src), `${child.pathname} imports ask_me.ts: Ask me now has a production caller; wire it through gateWords and update this test`);
        assert(!/from\s+"[^"]*\/ask_me_step\.ts"/.test(src), `${child.pathname} imports ask_me_step.ts: Ask me now has a production caller; wire it through gateWords and update this test`);
      }
    };
    await walk(new URL(dir, import.meta.url));
  }
});
