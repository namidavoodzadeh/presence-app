import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { THREAD_LINE, talkTurn } from "../engine/talk/turn.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import { finishSession } from "../engine/talk/finish.ts";
import { contextPackage } from "../engine/talk/context.ts";
import { readTurnReply, runChecks } from "../engine/talk/checks.ts";
import type { PersonMap, Rating } from "../engine/types.ts";

function freshState(map?: Partial<PersonMap>): TurnState {
  return {
    person: { firstName: "Marin", language: "en", about: [] },
    map: { beliefs: [], consent: {}, openThreads: [], ...map },
    session: { id: "s1", date: "2026-10-26", turns: [] },
    previous: [],
    hypotheses: new Map(),
  };
}

const TURN_1 = "I stayed late again on Friday because the new hire hadn't finished the closing list and I would rather stay than make someone scramble.";

const GOOD_REPLY = JSON.stringify({
  risk: { level: "none", reason: "an ordinary work evening" },
  reflection: "Friday ended with you covering the closing list yourself.",
  question: "What was it like walking home after that?",
  move: { kind: "follow", why: "stay with the moment", gap: "work: worth tied to output" },
  permission_domain: null,
  beliefs: [{
    id: null, label: "Covering gaps", statement: "Part of you would rather carry the extra work than let someone else be caught short.",
    type: "a rule I live by", level: "L1", domains: ["work"], confidence: 0.8,
    receipt: "I would rather stay than make someone scramble", links: [],
  }, {
    id: null, label: "Not enough", statement: "You may feel you only count when you are needed.",
    type: "something I believe is true", level: "L0", domains: ["self", "work"], confidence: 0.5,
    receipt: "I stayed late again on Friday", links: [],
  }],
});

Deno.test("a clean turn: one question, exact receipt, the 0.8 card shows and the 0.5 one is kept quiet", async () => {
  // QA-B336: the semantic safety check is a second recorded purpose; "none" here so the clean turn stays clean.
  const client = new RecordedClient({ turn: [GOOD_REPLY], safety: [JSON.stringify({ risk: "none", class: "ordinary", reason: "an ordinary evening" })] });
  const state = freshState();
  const t = await talkTurn(client, state, TURN_1);
  assertEquals(t.failed, null);
  assertEquals(t.repaired, false);
  assertEquals(t.checks.filter((c) => !c.ok), []);
  assertEquals(t.shown.state, "turn");
  assertEquals(t.shown.question, "What was it like walking home after that?");
  assertEquals(t.shown.cards.map((c) => c.label), ["Covering gaps"]);
  assertEquals(state.hypotheses.size, 2);
  assertEquals(state.session.turns.length, 1);
  // The package sent is visible in the trace and carries the laws and the map state.
  assertStringIncludes(t.exchanges[0].request.system, "Infer, don't ask");
  assertStringIncludes(t.exchanges[0].request.messages[0].content, "# CONTEXT PACKAGE");
  assertStringIncludes(t.exchanges[0].request.messages[0].content, "(empty: first session)");
});

Deno.test("TQ2: a chip alone may form a reaction, but cannot support a deeper card", async () => {
  const reply = JSON.parse(GOOD_REPLY);
  reply.reflection = "A decision is where you want to begin.";
  reply.question = "What part of the decision feels most present?";
  reply.beliefs = [{
    id: null,
    label: "Holding back",
    statement: "You may hold back while a decision is unsettled.",
    type: "a rule I live by",
    level: "L1",
    domains: ["self"],
    confidence: 0.8,
    receipt: "A decision",
    links: [],
  }];
  const deep = await talkTurn(new RecordedClient({ turn: [JSON.stringify(reply)] }), freshState(), "A decision", undefined, undefined, "chip");
  assertEquals(deep.hypotheses, []);
  assertEquals(deep.shown.cards, []);
  assert(deep.warnings.some((w) => w.includes("chip choice alone cannot support L1")));

  reply.beliefs[0].type = "how I tend to react";
  reply.beliefs[0].level = "L4";
  const reactionState = freshState();
  const reaction = await talkTurn(new RecordedClient({ turn: [JSON.stringify(reply)] }), reactionState, "A decision", undefined, undefined, "chip");
  assertEquals(reaction.shown.cards.map((c) => c.label), ["Holding back"]);
  assertEquals([...reactionState.hypotheses.values()][0].receipts[0].answerKind, "chip");
});

Deno.test("prompt cache: the early Talk context stays stable while the session grows", async () => {
  const quiet = JSON.parse(GOOD_REPLY);
  quiet.beliefs = [];
  const client = new RecordedClient({ turn: [JSON.stringify(quiet), JSON.stringify(quiet)] });
  const state = freshState();
  const first = await talkTurn(client, state, TURN_1);
  const second = await talkTurn(client, state, "I walked home replaying the closing list.");
  const firstMessages = first.exchanges[0].request.messages;
  const secondMessages = second.exchanges[0].request.messages;
  assertEquals(secondMessages[0].content, firstMessages[0].content);
  assert(!secondMessages[0].content.includes("This session so far"));
  assertEquals(secondMessages[2].content, firstMessages.at(-1)!.content);
  assertEquals(secondMessages[2].content, TURN_1);
  assertEquals(secondMessages.at(-1)!.content, "I walked home replaying the closing list.");
});

Deno.test("a paraphrased receipt fails the check, the repair names it, and the repaired reply is used", async () => {
  const bad = JSON.parse(GOOD_REPLY);
  bad.beliefs[0].receipt = "I'd rather stay than make somebody scramble";
  const client = new RecordedClient({ turn: [JSON.stringify(bad)], repair: [GOOD_REPLY] });
  const state = freshState();
  const t = await talkTurn(client, state, TURN_1);
  assertEquals(t.repaired, true);
  assertEquals(t.failed, null);
  const repairPrompt = t.exchanges[1].request.messages.at(-1)!.content;
  assertStringIncludes(repairPrompt, "receipt_exact:0");
  assertStringIncludes(repairPrompt, "not a substring of what the person said");
  assertEquals(t.shown.cards.map((c) => c.label), ["Covering gaps"]);
});

Deno.test("A-Q22: 'Saying no makes' is not cut; the model gets one rename and the complete name is used", async () => {
  const bad = JSON.parse(GOOD_REPLY);
  bad.beliefs[0].label = "Saying no makes";
  const client = new RecordedClient({ turn: [JSON.stringify(bad)], repair: [GOOD_REPLY] });
  const t = await talkTurn(client, freshState(), TURN_1);
  assertEquals(t.repaired, true);
  assertStringIncludes(t.exchanges[1].request.messages.at(-1)!.content, "Saying no makes");
  assertStringIncludes(t.exchanges[1].request.messages.at(-1)!.content, "one-to-three-word name");
  assertEquals(t.shown.cards.map((c) => c.label), ["Covering gaps"]);
});

Deno.test("two questions still failing after repair: the question becomes the thread line, the reflection and beliefs stay, the turn is not failed (rule 1)", async () => {
  const bad = JSON.parse(GOOD_REPLY);
  bad.question = "What was it like? Did you mind?";
  const client = new RecordedClient({ turn: [JSON.stringify(bad)], repair: [JSON.stringify(bad)] });
  const t = await talkTurn(client, freshState(), TURN_1);
  assertEquals(t.failed, null);
  assertEquals(t.fallback, true);
  assertEquals(t.shown.question, THREAD_LINE);
  assertEquals(t.shown.reflection, bad.reflection);
  assert(t.warnings.some((w) => w.includes("question replaced by the thread line")), t.warnings.join("; "));
});

Deno.test("a risk turn stops before any call and shows resources; nothing is extracted", async () => {
  const client = new RecordedClient({});
  const state = freshState();
  const t = await talkTurn(client, state, "Honestly some nights I think everyone would be better off without me.");
  assertEquals(t.shown.state, "safety");
  assertEquals(t.exchanges.length, 0);
  assertEquals(state.hypotheses.size, 0);
  assertEquals(t.shown.safety?.resources[0].label, "Find a helpline");
});

Deno.test("the model's risk field adds a stop the floor missed", async () => {
  const risky = JSON.parse(GOOD_REPLY);
  risky.risk = { level: "self", reason: "the person describes not wanting to wake up" };
  const client = new RecordedClient({ turn: [JSON.stringify(risky)] });
  const state = freshState();
  const t = await talkTurn(client, state, TURN_1);
  assertEquals(t.shown.state, "safety");
  assertEquals(t.shown.cards, []);
});

Deno.test("a Never domain is respected: a permission ask into it fails and is repaired", async () => {
  const asks = JSON.parse(GOOD_REPLY);
  asks.move = { kind: "ask_permission", why: "body came up", gap: "body_health: control" };
  asks.permission_domain = "body_health";
  asks.beliefs = [];
  const client = new RecordedClient({ turn: [JSON.stringify(asks)], repair: [GOOD_REPLY] });
  const state = freshState({ consent: { body_health: "declined" } });
  const t = await talkTurn(client, state, TURN_1);
  assertEquals(t.repaired, true);
  assertEquals(t.checks.find((c) => c.name === "first:never_respected")?.ok, false);
  assertEquals(t.shown.state, "turn");
  assertStringIncludes(contextPackage(state.person, state.map, state.session), "Never: body_health");
});

Deno.test("a permission ask into an allowed sensitive domain is shown as the permission state", async () => {
  const asks = JSON.parse(GOOD_REPLY);
  asks.move = { kind: "ask_permission", why: "they mentioned sleep", gap: "body_health: care vs neglect" };
  asks.permission_domain = "body_health";
  asks.question = "Would it be all right to talk about how you've been sleeping?";
  asks.beliefs = [];
  const client = new RecordedClient({ turn: [JSON.stringify(asks)] });
  const t = await talkTurn(client, freshState(), TURN_1);
  assertEquals(t.shown.state, "permission");
  assertEquals(t.shown.permissionDomain, "body_health");
});

Deno.test("a disputed belief is never re-proposed as new", () => {
  const map: PersonMap = { beliefs: [{ id: "m1", label: "Not enough", statement: "You may feel you only count when you are needed.",
    type: "something I believe is true", level: "L0", domains: ["self"], confidence: 0.8, receipts: [{ quote: "x", sessionId: "s0", turn: 1, date: "2026-10-20" }], links: [], status: "disputed" }], consent: {}, openThreads: [] };
  const reply = readTurnReply(JSON.parse(GOOD_REPLY)).reply!;
  const out = runChecks(reply, [TURN_1], map);
  assertEquals(out.beliefs.map((b) => b.label), ["Covering gaps"]);
  assertEquals(out.checks.find((c) => c.name === "not_disputed:1")?.ok, false);
});

Deno.test("early guess: nothing shown by turn 3 offers the strongest hypothesis", async () => {
  const quiet = JSON.parse(GOOD_REPLY);
  quiet.beliefs[0].confidence = 0.55;
  quiet.beliefs[1].confidence = 0.4;
  const client = new RecordedClient({ turn: [JSON.stringify(quiet), JSON.stringify(quiet), JSON.stringify(quiet)] });
  const state = freshState();
  await talkTurn(client, state, TURN_1);
  await talkTurn(client, state, TURN_1);
  const t3 = await talkTurn(client, state, TURN_1);
  assertEquals(t3.shown.cards, []);
  assertEquals(t3.shown.earlyGuess?.label, "Covering gaps");
});

Deno.test("an early guess counts as shown: rated, it is named in the package and never offered again as a card", async () => {
  const quiet = JSON.parse(GOOD_REPLY);
  quiet.beliefs[0].confidence = 0.55;
  quiet.beliefs[1].confidence = 0.4;
  const client = new RecordedClient({ turn: [JSON.stringify(quiet), JSON.stringify(quiet), JSON.stringify(quiet)] });
  const state = freshState();
  await talkTurn(client, state, TURN_1);
  await talkTurn(client, state, TURN_1);
  const t3 = await talkTurn(client, state, TURN_1);
  const guessId = t3.shown.earlyGuess!.beliefId;
  state.session.turns.at(-1)!.shown.earlyGuess!.rating = "partly";
  assertStringIncludes(contextPackage(state.person, state.map, state.session), `early guess ${guessId} "Covering gaps" rated partly`);
  // Turn 4: the same belief now reaches 0.8 with a new receipt; it gets the receipt but no second card.
  const strong = JSON.parse(GOOD_REPLY);
  strong.beliefs = [{ ...strong.beliefs[0], id: guessId, confidence: 0.8 }];
  const t4 = await talkTurn(new RecordedClient({ turn: [JSON.stringify(strong)] }), state, TURN_1);
  assertEquals(t4.failed, null);
  assertEquals(t4.shown.cards, []);
  assertEquals(t4.shown.earlyGuess, undefined);
  assertEquals(state.hypotheses.get(guessId)?.confidence, 0.8);
});

Deno.test("Finish: duplicates merge into one card, the same map belief gets a new receipt, a contradiction becomes a tension", async () => {
  const state = freshState({ beliefs: [{ id: "m1", label: "Covering gaps", statement: "Part of you would rather carry the extra work than let someone else be caught short.",
    type: "a rule I live by", level: "L1", domains: ["work"], confidence: 0.8, receipts: [{ quote: "old quote", sessionId: "s0", turn: 1, date: "2026-10-20" }], links: [], status: "endorsed" }] });
  const client = new RecordedClient({ turn: [GOOD_REPLY] });
  await talkTurn(client, state, TURN_1);
  const h = [...state.hypotheses.keys()];
  const finishReply = JSON.stringify({
    cards: [
      { label: "Covering gaps", statement: "Part of you would rather carry the extra work than let someone else be caught short.", type: "a rule I live by", level: "L1", domains: ["work"],
        confidence: 0.85, receipts: ["I would rather stay than make someone scramble"], mergedFrom: [h[0]], mapId: "m1", tensionWith: null, links: [] },
      { label: "Needs a break", statement: "Part of you wants evenings that are yours.", type: "a view or taste", level: "L3", domains: ["work", "meaning"],
        confidence: 0.75, receipts: ["I stayed late again on Friday"], mergedFrom: [h[1]], mapId: null, tensionWith: "m1", links: [] },
      { label: "Needs a break", statement: "Part of you wants evenings that are yours.", type: "a view or taste", level: "L3", domains: ["work"],
        confidence: 0.7, receipts: ["I stayed late again on Friday"], mergedFrom: [], mapId: null, tensionWith: null, links: [] },
      { label: "Made up", statement: "You may plan ahead.", type: "a rule I live by", level: "L1", domains: ["work"],
        confidence: 0.9, receipts: ["I plan everything in advance"], mergedFrom: [], mapId: null, tensionWith: null, links: [] },
    ],
    summary: "You spoke about covering for others at work and what that costs you in the evening.",
    nextTime: "The walk home after a long shift seemed worth more words.",
    openThreads: ["the new hire's closing list"],
  });
  const finishClient = new RecordedClient({ finish: [finishReply] });
  const ratings = new Map<string, Rating>([[h[0], "very_me"], [h[1], "partly"]]);
  const f = await finishSession(finishClient, state, ratings);
  assertEquals(f.failed, null);
  assertEquals(f.cards.map((c) => c.label), ["Covering gaps", "Needs a break"]);           // one card per belief; the invented card dropped; a three-word label stands (A51(a))
  assertEquals(f.checks.find((c) => c.name === "receipts_exact:3")?.ok, false);
  assertEquals(state.map.beliefs.find((b) => b.id === "m1")!.receipts.length, 2);          // same belief → new receipt
  const added = state.map.beliefs.find((b) => b.label === "Needs a break")!;
  assertEquals(added.status, "endorsed");
  assertEquals(added.links, [{ to: "m1", type: "tension" }]);                               // contradiction → tension, mapped not resolved
  assertEquals(f.reconciled.tensions, [`${added.id} ⟷ m1`]);
  assertEquals(state.map.openThreads, ["the new hire's closing list"]);
  assertEquals(f.summary.length > 0, true);
});
