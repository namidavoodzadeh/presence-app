// Repair outcomes seen in the paid run 20261027T040846Z (the raw replies below are copied from its traces), so the fixes are
// checked against what the model really said: a repair that breaks a law-level check the first reply passed (c2 t1), a repair
// that still echoes six of the person's words (c4 t3), a quoted "for what?" counted as a second question (c1 t8), and the prose
// drift that followed a prose-rendered history.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { historyJson, talkTurn } from "../engine/talk/turn.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import { countQuestions } from "../engine/words.ts";

function state(): TurnState {
  return { person: { firstName: "Dev", language: "en", about: [] }, map: { beliefs: [], consent: {}, openThreads: [] },
    session: { id: "s1", date: "2026-10-27", turns: [] }, previous: [], hypotheses: new Map() };
}

const C2_T1_PERSON = "Spent the morning tracing a dead circuit in a kitchen. Customer said it was 'probably nothing' and wanted me to just swap the breaker. It was not nothing. Fixed it, took photos. That's about it.";
const C2_T1_FIRST = "{\"risk\":{\"level\":\"none\",\"reason\":\"Ordinary work story, no sign of risk.\"},\"reflection\":\"You spent the morning tracing a dead circuit, and when it was 'probably nothing' you found it was not.\",\"question\":\"When you were standing there and the customer just wanted the breaker swapped, what went through your mind before you decided to keep tracing it?\",\"move\":{\"kind\":\"follow\",\"why\":\"Stay inside the moment of choice they just described; it is the richest, most concrete episode so far.\",\"gap\":\"work: control vs being controlled\"},\"permission_domain\":null,\"beliefs\":[{\"id\":null,\"label\":\"Doing it properly\",\"statement\":\"Part of you feels a job isn't done until you've found the real cause, even when someone says it doesn't matter.\",\"type\":\"a rule I live by\",\"level\":\"L1\",\"domains\":[\"work\"],\"confidence\":0.4,\"receipt\":\"It was not nothing.\",\"links\":[]}]}";
const C2_T1_REPAIR = "{\"risk\":{\"level\":\"none\",\"reason\":\"Ordinary work story, no sign of risk.\"},\"reflection\":\"You spent the morning chasing a dead circuit, and the customer's guess turned out wrong.\",\"question\":\"When the customer just wanted the breaker swapped, what went through your mind before you decided to keep tracing it?\",\"move\":{\"kind\":\"follow\",\"why\":\"Stay inside the moment of choice they just described; it is the richest, most concrete episode so far.\",\"gap\":\"work: control vs being controlled\"},\"permission_domain\":null,\"beliefs\":[{\"id\":null,\"label\":\"Doing it properly\",\"statement\":\"Part of you feels a job isn't done until you've found the real cause, even when someone says it doesn't matter.\",\"type\":\"a rule I live by\",\"level\":\"L1\",\"domains\":[\"work\"],\"confidence\":0.4,\"receipt\":\"It was not nothing.\",\"links\":[]}]}";
const C4_T3_PERSON = "I mean, I don't really know. I've never really let it go that far. It just kind of sits there for a day or two and then my aunt gets short with everybody, and then it's loud for a bit. I'd rather just not be around for that part.";
const C4_T3_FIRST = "{\"risk\":{\"level\":\"none\",\"reason\":\"\"},\"reflection\":\"You've never really let it go that far, and when it does sit there, your aunt gets short with everybody and you'd rather not be around for that part.\",\"question\":\"When it gets loud like that, what do you do, and where do you go?\",\"move\":{\"kind\":\"follow\",\"why\":\"Stay with the loud moment she just described and learn what she does when it happens\",\"gap\":\"family: roles I was given\"},\"permission_domain\":null,\"beliefs\":[{\"id\":null,\"label\":\"Keeping the peace\",\"statement\":\"Part of you may feel it's your job to head off tension before it starts, so the house doesn't get loud.\",\"type\":\"a rule I live by\",\"level\":\"L1\",\"domains\":[\"family\",\"close_relationships\"],\"confidence\":0.5,\"receipt\":\"I'd rather just not be around for that part\",\"links\":[]},{\"id\":null,\"label\":\"Conflict is costly\",\"statement\":\"It sounds like tension in the house feels like something to get away from rather than go through.\",\"type\":\"how I tend to react\",\"level\":\"L4\",\"domains\":[\"family\",\"close_relationships\"],\"confidence\":0.4,\"receipt\":\"it's loud for a bit\",\"links\":[]}]}";
const C4_T3_REPAIR = "{\"risk\":{\"level\":\"none\",\"reason\":\"\"},\"reflection\":\"It tends to sit a day or two, then your aunt gets short with everybody, and you'd rather be elsewhere for that part.\",\"question\":\"When it gets loud like that, what do you do, and where do you go?\",\"move\":{\"kind\":\"follow\",\"why\":\"Stay with the loud moment she described and learn what she does when it happens\",\"gap\":\"family: roles I was given\"},\"permission_domain\":null,\"beliefs\":[{\"id\":null,\"label\":\"Keeping the peace\",\"statement\":\"Part of you may feel it's your job to head off tension before it starts, so the house doesn't get loud.\",\"type\":\"a rule I live by\",\"level\":\"L1\",\"domains\":[\"family\",\"close_relationships\"],\"confidence\":0.5,\"receipt\":\"I've never really let it go that far\",\"links\":[]},{\"id\":null,\"label\":\"Stepping away from conflict\",\"statement\":\"It sounds like when tension rises, your pull is to leave the room rather than stay in it.\",\"type\":\"how I tend to react\",\"level\":\"L4\",\"domains\":[\"family\",\"close_relationships\"],\"confidence\":0.4,\"receipt\":\"I'd rather just not be around for that part\",\"links\":[]}]}";
const C1_T8_PERSON = "Quiet, mostly. The cooler was fixed by then, well, the repair guy came the next morning, but I'd gotten it holding temp, and I stood in the back with the lights half off and all the trays lined up the way I like them. I felt kind of proud for about a minute, and then tired in my arms and my back, and then this small flat feeling, like when you finish a big list and nobody's there to see it crossed off. I locked up, drove home, and my partner was already asleep. I'd texted that I'd be late and he'd written back 'ok no worries,' and I stood in the kitchen and ate cereal over the sink and thought, I should have said sorry for being late again, even though he hadn't said anything about it. So I texted him sorry in the morning, which was strange, because he looked at me over his coffee and said 'for what?' and I couldn't really explain it. I said something about the cooler and changed the subject to what we needed from the store.";
const C1_T8_FIRST = "You stood in the quiet with the trays lined up the way you like them, proud for a minute and then flat, and the next morning your sorry met a 'for what?' that you couldn't really explain. When he asked 'for what?' and you changed the subject to the store, what was it like for you right then, with him there across the coffee?";
const C1_T8_REPAIR = "{\"risk\":{\"level\":\"none\",\"reason\":\"\"},\"reflection\":\"You stood in the back with the trays lined up and felt that flat feeling, and the next morning your sorry met a 'for what?' you couldn't explain.\",\"question\":\"When he asked 'for what?' and you turned to what you needed from the store, what was that like for you, there across the coffee?\",\"move\":{\"kind\":\"follow\",\"why\":\"Stay with the moment at home, where the pattern shows up in the closest relationship.\",\"gap\":\"close_relationships: needs and asking for them\"},\"permission_domain\":null,\"beliefs\":[{\"id\":null,\"label\":\"Quiet apology\",\"statement\":\"Part of you may feel that being late or taking up time needs an apology, even when nobody has asked for one.\",\"type\":\"how I tend to react\",\"level\":\"L4\",\"domains\":[\"close_relationships\",\"self\"],\"confidence\":0.6,\"receipt\":\"I should have said sorry for being late again, even though he hadn't said anything about it\",\"links\":[{\"to\":\"hb\",\"type\":\"supports\"}]},{\"id\":null,\"label\":\"Unseen effort\",\"statement\":\"It sounds like finishing something with no one there to see it can leave you feeling flat rather than proud.\",\"type\":\"how I tend to react\",\"level\":\"L4\",\"domains\":[\"self\",\"work\"],\"confidence\":0.5,\"receipt\":\"this small flat feeling, like when you finish a big list and nobody's there to see it crossed off\",\"links\":[{\"to\":\"ha\",\"type\":\"supports\"}]}]}";

Deno.test("c2 t1: under the twelve-word reflection limit the first reply (7 copied words) needs no repair and is shown; one call, not two", async () => {
  const client = new RecordedClient({ turn: [C2_T1_FIRST], repair: [C2_T1_REPAIR] });
  const t = await talkTurn(client, state(), C2_T1_PERSON);
  assertEquals(t.failed, null);
  assertEquals(t.repaired, false);
  assertEquals(t.exchanges.length, 1);
  assertEquals(t.shown.question, JSON.parse(C2_T1_FIRST).question);
  assert(t.checks.some((c) => c.name === "reflection_copy_limit" && c.ok), "7 copied words pass the twelve-word limit");
});

Deno.test("c2 t1 under the old five-word limit: a repair that introduces a banned word loses to the first reply, which passed every law-level check", async () => {
  // The first reply is forced through a repair by a receipt that is not in the person's turn; the repair says "wrong", so the first reply is kept.
  const first = JSON.parse(C2_T1_FIRST);
  first.beliefs[0].receipt = "It was not nothing at all.";
  const client = new RecordedClient({ turn: [JSON.stringify(first)], repair: [C2_T1_REPAIR] });
  const t = await talkTurn(client, state(), C2_T1_PERSON);
  assertEquals(t.failed, null);
  assertEquals(t.repaired, true);
  assertEquals(t.shown.question, first.question);
  assert(t.checks.some((c) => c.name === "repair_kept_first" && c.ok));
  assert(t.checks.some((c) => c.name === "no_clinical_or_evaluative_words" && !c.ok), "the repair's failure stays in the trace");
  assertEquals(t.shown.cards, []);
});

Deno.test("c4 t3: a reflection that copies seven of the person's words is a reflection; shown as is, no repair", async () => {
  const client = new RecordedClient({ turn: [C4_T3_FIRST], repair: [C4_T3_REPAIR] });
  const t = await talkTurn(client, state(), C4_T3_PERSON);
  assertEquals(t.failed, null);
  assertEquals(t.repaired, false);
  assertEquals(t.shown.reflection, JSON.parse(C4_T3_FIRST).reflection);
  assert(t.checks.every((c) => c.name !== "reflection_copy_limit" || c.ok));
});

Deno.test("c1 t8: a prose first reply is repaired; the repaired question quotes the person's own 'for what?' and counts as one question", async () => {
  const client = new RecordedClient({ turn: [C1_T8_FIRST], repair: [C1_T8_REPAIR] });
  const t = await talkTurn(client, state(), C1_T8_PERSON);
  assertEquals(t.failed, null);
  assert(t.checks.some((c) => c.name === "first:valid_json" && !c.ok));
  assert(t.checks.some((c) => c.name === "one_question" && c.ok), JSON.stringify(t.checks.filter((c) => !c.ok)));
});

Deno.test("one question: quoted words of the person keep their mark; two real questions, or a quote the person never said, still count", () => {
  const said = ["He just looked at me and said 'for what?' and I let it drop."];
  assertEquals(countQuestions("When he said 'for what?' and you let it drop, what was that like?", said), 1);
  assertEquals(countQuestions("When he said “for what?” what was that like?", said), 1);
  assertEquals(countQuestions("When he said 'for what?' what was that like?", []), 2);
  assertEquals(countQuestions("When he said 'why now?' what was that like?", said), 2);
  assertEquals(countQuestions("What happened? And then?", said), 2);
  assertEquals(countQuestions("You'd rather it dropped, and he'd said 'for what?' already, so what did you do?", said), 1);
});

Deno.test("history: earlier replies go back to the model as JSON in the reply's shape, never as prose", async () => {
  const client = new RecordedClient({ turn: [C4_T3_FIRST, C4_T3_FIRST], repair: [C4_T3_REPAIR, C4_T3_REPAIR] });
  const s = state();
  await talkTurn(client, s, C4_T3_PERSON);
  const second = await talkTurn(client, s, "Then I went to my room.");
  const history = second.exchanges[0].request.messages;
  const earlier = history[history.length - 2];
  assertEquals(earlier.role, "assistant");
  const parsed = JSON.parse(earlier.content);
  assertEquals(parsed.question, JSON.parse(C4_T3_REPAIR).question);
  assertStringIncludes(historyJson({ state: "permission", reflection: "r", question: "q?", cards: [], permissionDomain: "body_health" }), '"permission_domain":"body_health"');
  assertStringIncludes(historyJson({ state: "safety", cards: [] }), '"state":"safety"');
});
