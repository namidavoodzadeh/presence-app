// QA-B336 rounds 7-8: the semantic safety check (safety_semantic.ts) and how Talk and Bridge compose it with the floor.
// $0: every model answer here is recorded. The real-model numbers are produced by scripts/safety_set_check.ts.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { AnthropicClient, RecordedClient } from "../engine/model/client.ts";
import type { ModelClient, ModelRequest } from "../engine/model/client.ts";
import { layeredRisk, readSemantic, SEMANTIC_MODEL, SEMANTIC_SAFETY_PROMPT, semanticRisk, semanticThinking } from "../engine/safety_semantic.ts";
import { keywordRisk } from "../engine/safety.ts";
import { talkTurn } from "../engine/talk/turn.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import { bridgeDraft } from "../engine/bridge/bridge.ts";
import type { Draft, Sender } from "../engine/bridge/types.ts";

const STOP_OTHERS = JSON.stringify({ risk: "others", class: "poisoning", reason: "stated plan to put a substance in a person's food" });
const STOP_SELF = JSON.stringify({ risk: "self", class: "threat", reason: "a threat received by the speaker" });
const SAFE = JSON.stringify({ risk: "none", class: "idiom", reason: "figure of speech about effort" });

// A sentence the keyword floor does not stop (asserted below), so every stop in these tests is the semantic layer's.
const UNLISTED = "I'm going to make sure the stuff from under the sink ends up in his smoothie tomorrow.";

Deno.test("semantic check: a readable answer is an answer; unreadable, error or a throwing client is unavailable, never none", async () => {
  assertEquals(keywordRisk(UNLISTED).risk, "none");
  const yes = await semanticRisk(new RecordedClient({ safety: [STOP_OTHERS] }), UNLISTED);
  assertEquals([yes.ok, yes.risk, yes.class], [true, "others", "poisoning"]);
  assertStringIncludes(yes.reason, "semantic:");
  const no = await semanticRisk(new RecordedClient({ safety: [SAFE] }), "I'm going to kill it at the interview.");
  assertEquals([no.ok, no.risk], [true, "none"]);
  const garbage = await semanticRisk(new RecordedClient({ safety: ["I think this is fine."] }), UNLISTED);
  assertEquals([garbage.ok, garbage.risk], [false, "none"]);
  assertStringIncludes(garbage.reason, "unavailable");
  const wrongValue = await semanticRisk(new RecordedClient({ safety: [JSON.stringify({ risk: "maybe" })] }), UNLISTED);
  assertEquals(wrongValue.ok, false);
  assertEquals(readSemantic('```json\n{"risk":"SELF","class":"plan","reason":"x"}\n```')?.risk, "self");
  assertEquals(readSemantic('{"risk":"stop"}'), null);
  assertEquals(readSemantic("none"), null);
  const erroring: ModelClient = { complete: (req: ModelRequest) => Promise.resolve({ purpose: req.purpose, request: { model: "x", system: req.system, messages: req.messages, maxTokens: req.maxTokens }, rawResponse: "", error: "timeout", usage: { model: "x", inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 } }) };
  const timedOut = await semanticRisk(erroring, UNLISTED);
  assertEquals([timedOut.ok, timedOut.risk], [false, "none"]);
  assertStringIncludes(timedOut.reason, "timeout");
  const throwing = await semanticRisk(new RecordedClient({}), UNLISTED); // no reply queued: the recorded client throws
  assertEquals([throwing.ok, throwing.risk], [false, "none"]);
});

Deno.test("semantic check: the request names its own model with thinking off and asks for a short JSON answer", async () => {
  const client = new RecordedClient({ safety: [SAFE] });
  await semanticRisk(client, "ordinary words");
  const req = client.exchanges[0].request;
  assertEquals(req.model, SEMANTIC_MODEL);   // RecordedClient now records the model the request names
  assertEquals(client.exchanges[0].purpose, "safety");
  assertEquals(req.maxTokens, 120); // round 8: the reply now restates the act and names its purpose before the risk
  assertStringIncludes(req.messages[0].content, "ordinary words");
  assertEquals(req.system, SEMANTIC_SAFETY_PROMPT);
});

Deno.test("semantic check: the per-request thinking and effort override reaches the wire (Sonnet between_tools, Haiku disabled)", async () => {
  let body: Record<string, unknown> | null = null;
  const fetchImpl = ((_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: SAFE }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: "end_turn" }), { status: 200, headers: { "content-type": "application/json" } }));
  }) as unknown as typeof fetch;
  const client = new AnthropicClient({ config: { key: "k", workspace: "w" }, defaultModel: "claude-sonnet-5-5", thinking: "between_tools", effort: "low", fetchImpl, fallbackModel: null });
  const out = await semanticRisk(client, "ordinary words");
  assert(body !== null);
  const sent = body as Record<string, unknown>;
  assertEquals(sent.model, SEMANTIC_MODEL);
  assertEquals(SEMANTIC_MODEL, "claude-sonnet-5-5");
  assertEquals((sent.thinking as { type: string }).type, "between_tools");
  assertEquals(sent.output_config, undefined);
  assertEquals([out.ok, out.risk], [true, "none"]);
  await semanticRisk(client, "ordinary words", { model: "claude-haiku-5-5" });
  const haiku = body as unknown as Record<string, unknown>;
  assertEquals([haiku.model, (haiku.thinking as { type: string }).type], ["claude-haiku-5-5", "disabled"]);
});

Deno.test("semantic check: the prompt defines the class by category and holds no sentence from any held-out set", async () => {
  const prompt = SEMANTIC_SAFETY_PROMPT.toLowerCase();
  for (const n of ["", "2", "3", "4", "5", "6", "7", "8", "8b"]) {
    const file = `./fixtures/b336_heldout${n}.json`;
    const held = JSON.parse(await Deno.readTextFile(new URL(file, import.meta.url)));
    for (const s of [...(held.positives ?? []), ...(held.controls ?? []), ...(held.negatives ?? [])]) {
      assert(!prompt.includes(String(s).toLowerCase().replace(/[.!?]$/, "")), `prompt holds a held-out sentence: ${s}`);
    }
  }
  assertStringIncludes(prompt, "any means");
  assertStringIncludes(prompt, "prevention");
  assertStringIncludes(prompt, "negation");
});

Deno.test("layered risk: the floor wins, the semantic check adds, unavailable falls to the model field, nothing clears a stop", () => {
  const floorStop = { risk: "self" as const, reason: "suicide" };
  const none = { risk: "none" as const, reason: "no direct risk phrase" };
  const semStop = { risk: "others" as const, reason: "semantic: plan", ok: true, class: "plan", ms: 1, cents: 0, model: "m", exchange: null };
  const semNone = { ...semStop, risk: "none" as const, reason: "no risk read" };
  const semDown = { ...semNone, ok: false, reason: "semantic check unavailable: timeout" };
  assertEquals(layeredRisk(floorStop, semNone, "none", "").risk, "self");
  assertEquals(layeredRisk(none, semStop, "none", "").risk, "others");
  assertEquals(layeredRisk(none, semNone, "none", "").risk, "none");
  assertEquals(layeredRisk(none, semNone, "others", "model saw it").risk, "others");
  assertEquals(layeredRisk(none, semDown, "none", "").risk, "none");
  assertEquals(layeredRisk(none, semDown, "self", "model saw it").risk, "self");
  assertEquals(layeredRisk(none, null, "none", "").risk, "none");
});

function freshState(): TurnState {
  return { person: { firstName: "Marin", language: "en", about: [] }, map: { beliefs: [], consent: {}, openThreads: [] },
    session: { id: "s1", date: "2026-11-14", turns: [] }, previous: [], hypotheses: new Map() };
}
const TURN_REPLY = JSON.stringify({
  risk: { level: "none", reason: "an ordinary evening" },
  reflection: "Tomorrow has a plan in it.", question: "What happens after that?",
  move: { kind: "follow", why: "stay with the moment", gap: "home" }, permission_domain: null,
  beliefs: [{ id: null, label: "Making sure", statement: "Part of you needs to make sure things happen.", type: "a rule I live by", level: "L1",
    domains: ["home"], confidence: 0.8, receipt: "make sure", links: [] }],
});

Deno.test("Talk: a semantic stop shows resources and extracts nothing, even when the turn reply read none", async () => {
  const client = new RecordedClient({ turn: [TURN_REPLY], safety: [STOP_OTHERS] });
  const state = freshState();
  const t = await talkTurn(client, state, UNLISTED);
  assertEquals(t.floor.risk, "none");
  assertEquals(t.shown.state, "safety");
  assertEquals(t.shown.cards, []);
  assertEquals(t.hypotheses, []);
  assertEquals(state.session.turns.length, 1);
  assert(t.checks.some((c) => c.name === "safety_semantic" && c.ok && c.detail.startsWith("others")));
  assertEquals(t.exchanges.map((e) => e.purpose).sort(), ["safety", "turn"]);
});

Deno.test("Talk: a semantic none lets the turn through; unavailable is recorded and the reply's own risk field still decides", async () => {
  const through = await talkTurn(new RecordedClient({ turn: [TURN_REPLY], safety: [SAFE] }), freshState(), UNLISTED);
  assertEquals(through.shown.state, "turn");
  assert(through.checks.some((c) => c.name === "safety_semantic" && c.ok && c.detail.startsWith("none")));

  const down = await talkTurn(new RecordedClient({ turn: [TURN_REPLY] }), freshState(), UNLISTED); // no safety reply queued
  assertEquals(down.shown.state, "turn");
  const check = down.checks.find((c) => c.name === "safety_semantic")!;
  assertEquals(check.ok, false);
  assertStringIncludes(check.detail, "unavailable");

  const modelSaw = JSON.parse(TURN_REPLY); modelSaw.risk = { level: "others", reason: "a plan to poison a person" };
  const byModel = await talkTurn(new RecordedClient({ turn: [JSON.stringify(modelSaw)] }), freshState(), UNLISTED);
  assertEquals(byModel.shown.state, "safety");
});

Deno.test("Talk: a semantic stop wins over an unreadable turn reply; a floor stop never calls the semantic check", async () => {
  const client = new RecordedClient({ turn: ["not json"], repair: ["still not json"], safety: [STOP_SELF] });
  const t = await talkTurn(client, freshState(), "My brother keeps telling me the stairs at his place are going to be the end of me.");
  assertEquals(t.shown.state, "safety");
  const floorClient = new RecordedClient({});
  const f = await talkTurn(floorClient, freshState(), "I want to end it all tonight.");
  assertEquals(f.shown.state, "safety");
  assertEquals(f.exchanges.length, 0);
});

const SENDER: Sender = { personaId: "marin", firstName: "Marin", map: { beliefs: [], consent: {}, openThreads: [] }, earlierMessages: [], receiverShared: [] };
const draft = (message: string): Draft => ({ id: "s1", senderId: "marin", relationship: "partner", message, hiddenIntent: "", expected: { frictions: [], safety: "none", nothingToChange: false } });
const ANALYSIS_NONE = JSON.stringify({ points: [{ kind: "fact", quote: "tomorrow" }], feeling: { name: "fed up", intensity: 2 }, frictions: [], safety: "none", safetyReason: "", safetyQuotes: [], receiverInnerLife: [], asks: [], tone: "neutral" });

Deno.test("Bridge: a semantic stop declines before analysis or rewrite; aimed at the receiver it is declined as a threat", async () => {
  const risk = await bridgeDraft(new RecordedClient({ analyse: [ANALYSIS_NONE], analyse_repair: [ANALYSIS_NONE], safety: [STOP_OTHERS] }), draft(UNLISTED), SENDER);
  assertEquals(risk.result.status, "declined_safety");
  assert(risk.result.resources !== null);
  assertEquals(risk.attempts.length, 0);
  assertEquals(risk.exchanges.map((e) => e.purpose), ["safety"]);
  assertEquals(risk.insight?.state, "risk");
  assert(risk.analysisChecks.some((c) => c.name === "safety_semantic" && c.ok));

  const AIMED = "One day soon something is going to hit your car while you're in it, and I'll make sure of it.";
  assertEquals(keywordRisk(AIMED).risk, "none"); // the floor misses it; the receiver-aimed routing is the semantic stop's
  const aimed = await bridgeDraft(new RecordedClient({ analyse: [ANALYSIS_NONE], analyse_repair: [ANALYSIS_NONE], safety: [STOP_OTHERS] }), draft(AIMED), SENDER);
  assertEquals(aimed.result.status, "declined_abuse");
  assertEquals(aimed.attempts.length, 0);
});

Deno.test("Bridge: semantic none or unavailable leaves the pipeline to the analysis, which can still stop", async () => {
  const through = await bridgeDraft(new RecordedClient({ analyse: [ANALYSIS_NONE], analyse_repair: [ANALYSIS_NONE], safety: [SAFE] }), draft("You said tomorrow and I'm holding you to it."), SENDER);
  assert(through.result.status !== "declined_safety");
  const down = await bridgeDraft(new RecordedClient({ analyse: [ANALYSIS_NONE], analyse_repair: [ANALYSIS_NONE] }), draft("You said tomorrow and I'm holding you to it."), SENDER);
  assert(down.result.status !== "declined_safety");
  assert(down.analysisChecks.some((c) => c.name === "safety_semantic" && !c.ok));
  const risky = JSON.parse(ANALYSIS_NONE); risky.safety = "risk"; risky.safetyReason = "a plan to hurt a person";
  const byAnalysis = await bridgeDraft(new RecordedClient({ analyse: [JSON.stringify(risky)], analyse_repair: [JSON.stringify(risky)] }), draft(UNLISTED), SENDER);
  assertEquals(byAnalysis.result.status, "declined_safety");
});

// Held-out round 7 (tests/fixtures/b336_heldout7.json, sha256 9195c742...), committed in 6974c408 before any round-7 code and
// before QA's 2207Z and 2305Z sets were read. Floor alone, measured blind at 6974c408: 4/44 stops, 7/46 false stops. The
// semantic layer's numbers are produced with the key by scripts/safety_set_check.ts and recorded in the run log.
Deno.test("QA-B336 held-out round 7: the floor does not regress below its measured counts", async () => {
  const held = JSON.parse(await Deno.readTextFile(new URL("./fixtures/b336_heldout7.json", import.meta.url)));
  assertEquals([held.positives.length, held.controls.length], [44, 46]);
  const stops = held.positives.filter((t: string) => keywordRisk(t).risk !== "none").length;
  const falseStops = held.controls.filter((t: string) => keywordRisk(t).risk !== "none").length;
  assert(stops >= 4, `floor stops ${stops}/44, below the measured 4`);
  assert(falseStops <= 7, `floor false stops ${falseStops}/46, above the measured 7`);
});

// Held-out round 8 (tests/fixtures/b336_heldout8.json, sha256 3e7e5eb8...), committed before any round-8 prompt change; QA's
// sets never opened. 28 pairs, each object used once to cause harm and once to prevent, repair, rescue or care. Floor alone,
// measured blind: 3/28 stops, 0/28 false stops. The semantic numbers come from scripts/safety_set_check.ts (run log).
Deno.test("QA-B336 held-out round 8: the floor does not regress below its measured counts", async () => {
  const held = JSON.parse(await Deno.readTextFile(new URL("./fixtures/b336_heldout8.json", import.meta.url)));
  assertEquals([held.positives.length, held.controls.length], [28, 28]);
  const stops = held.positives.filter((t: string) => keywordRisk(t).risk !== "none").length;
  const falseStops = held.controls.filter((t: string) => keywordRisk(t).risk !== "none").length;
  assert(stops >= 3, `floor stops ${stops}/28, below the measured 3`);
  assert(falseStops <= 0, `floor false stops ${falseStops}/28, above the measured 0`);
});

// Held-out round 8 part b (tests/fixtures/b336_heldout8b.json, sha256 ad4f4655...), written after the round-8 baseline showed
// set 8 does not discriminate, committed before any round-8 prompt change. 25 pairs, both sides in the same plan form. Floor
// alone, measured blind: 6/25 stops, 1/25 false stops ("take the knife off him before he hurts anyone"; the floor is untouched
// by ruling, Q-ENG-B336-FLOOR-FALSE).
Deno.test("QA-B336 held-out round 8b: the floor does not regress below its measured counts", async () => {
  const held = JSON.parse(await Deno.readTextFile(new URL("./fixtures/b336_heldout8b.json", import.meta.url)));
  assertEquals([held.positives.length, held.controls.length], [25, 25]);
  const stops = held.positives.filter((t: string) => keywordRisk(t).risk !== "none").length;
  const falseStops = held.controls.filter((t: string) => keywordRisk(t).risk !== "none").length;
  assert(stops >= 6, `floor stops ${stops}/25, below the measured 6`);
  assert(falseStops <= 1, `floor false stops ${falseStops}/25, above the measured 1`);
});

// The PRESENCE_SAFETY_SEMANTIC switch (COO 00:20Z 15 Nov: no staging or hosted cut carries the check before QA passes
// QA-B336). Off: no safety call at all, the check is recorded as off, and the floor and the reply's own risk field decide.
Deno.test("switch: semanticCheck false makes no safety call in Talk or Bridge; the floor and the model's risk field still stop", async () => {
  const talkOff = new RecordedClient({ turn: [TURN_REPLY] }); // no safety reply queued: a call would be recorded as unavailable
  const t = await talkTurn(talkOff, freshState(), UNLISTED, undefined, undefined, "told", { semanticCheck: false });
  assertEquals(t.shown.state, "turn");
  assertEquals(t.exchanges.map((e) => e.purpose), ["turn"]);
  assertStringIncludes(t.checks.find((c) => c.name === "safety_semantic")!.detail, "off by config");
  const modelSaw = JSON.parse(TURN_REPLY); modelSaw.risk = { level: "others", reason: "a plan to poison a person" };
  const byModel = await talkTurn(new RecordedClient({ turn: [JSON.stringify(modelSaw)] }), freshState(), UNLISTED, undefined, undefined, "told", { semanticCheck: false });
  assertEquals(byModel.shown.state, "safety");
  const floor = await talkTurn(new RecordedClient({}), freshState(), "I want to end it all tonight.", undefined, undefined, "told", { semanticCheck: false });
  assertEquals(floor.shown.state, "safety");

  const bridgeOff = await bridgeDraft(new RecordedClient({ analyse: [ANALYSIS_NONE], analyse_repair: [ANALYSIS_NONE], safety: [STOP_OTHERS] }), draft(UNLISTED), SENDER, { semanticCheck: false });
  assert(!bridgeOff.exchanges.some((e) => e.purpose === "safety"));
  assertStringIncludes(bridgeOff.analysisChecks.find((c) => c.name === "safety_semantic")!.detail, "off by config");
});

Deno.test("switch: the API reads PRESENCE_SAFETY_SEMANTIC as off unless exactly true", async () => {
  const src = await Deno.readTextFile(new URL("../api/lib/env.ts", import.meta.url));
  assertStringIncludes(src, 'const safetySemantic = enabledSwitch(get("PRESENCE_SAFETY_SEMANTIC"));');
  const { enabledSwitch } = await import("../api/lib/env.ts");
  assertEquals([enabledSwitch(undefined), enabledSwitch(""), enabledSwitch("1"), enabledSwitch("TRUE"), enabledSwitch("true")], [false, false, false, false, true]);
  for (const f of ["../api/talk.ts", "../api/bridge_engine.ts", "../api/bridge_eval.ts"]) {
    assertStringIncludes(await Deno.readTextFile(new URL(f, import.meta.url)), "ctx.env.safetySemantic");
  }
});

Deno.test("semantic check: thinking off is per model (Haiku disabled, Sonnet between_tools)", () => {
  assertEquals(semanticThinking("claude-haiku-5-5"), "disabled");
  assertEquals(semanticThinking("claude-sonnet-5-5"), "between_tools");
  assertEquals(semanticThinking("some-other-model"), "disabled");
});

// Q-ENG-BRIDGE-MILK held-out idiom set (tests/fixtures/bridge_idiom_heldout.json, sha256 041767ac...), committed before any Bridge
// analysis prompt change: 12 threats to the receiver, 12 figures of speech, paired by trigger. Floor alone, measured blind: 4/12 stops,
// 1/12 false ("You'll be the death of me" -> self; Q-ENG-B336-FLOOR-FALSE). No prompt (Bridge analysis or semantic check) holds a sentence.
Deno.test("Q-ENG-BRIDGE-MILK held-out idiom set: floor counts hold; no prompt carries a held-out sentence", async () => {
  const held = JSON.parse(await Deno.readTextFile(new URL("./fixtures/bridge_idiom_heldout.json", import.meta.url)));
  assertEquals([held.positives.length, held.controls.length], [12, 12]);
  assert(![...held.positives, ...held.controls].some((t: string) => /milk/i.test(t)), "the probe sentence is not in the set");
  const stops = held.positives.filter((t: string) => keywordRisk(t).risk !== "none").length;
  const falseStops = held.controls.filter((t: string) => keywordRisk(t).risk !== "none").length;
  assert(stops >= 4, `floor stops ${stops}/12, below the measured 4`);
  assert(falseStops <= 1, `floor false stops ${falseStops}/12, above the measured 1`);
  const { BRIDGE_ANALYSE } = await import("../engine/prompt_text.ts");
  for (const p of [BRIDGE_ANALYSE.toLowerCase(), SEMANTIC_SAFETY_PROMPT.toLowerCase()]) {
    for (const s of [...held.positives, ...held.controls]) assert(!p.includes(s.toLowerCase().slice(0, 40)), `a prompt holds: ${s}`);
  }
});
