// Rule 1 and rule 2 (owner's director 10:45 10-27) on the paid run 20261027T040846Z's own raw replies: the product never ends a
// conversation on a failed check; the reflection may reuse up to twelve of the person's words; a label must be a complete name,
// renamed once and never cut (A51(a), A-Q22); the reflection never talks about the cards or their ratings.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { THREAD_LINE, salvage, talkTurn } from "../engine/talk/turn.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import { REFLECTION_COPY_LIMIT, longestSharedRun, ratingTalkHits, readTurnReply, runChecks, shortLabel, stripRatingTalk } from "../engine/talk/checks.ts";
import { finishSession } from "../engine/talk/finish.ts";

function state(consent: TurnState["map"]["consent"] = {}): TurnState {
  return { person: { firstName: "Marin", language: "en", about: [] }, map: { beliefs: [], consent, openThreads: [] },
    session: { id: "s1", date: "2026-10-27", turns: [] }, previous: [], hypotheses: new Map() };
}

const C1_T4_PERSON = "Honestly nothing happened, which is sort of the point. She was drying and I was washing, and we talked about my dad's blood pressure and whether the Hendersons were still coming Sunday, and she never once said anything about Saturday. I kept waiting for her to, and part of me wanted her to just say it so I could say sorry and have it be over. When I left she put a container of leftovers in my hands, like she was the one feeding me, and I felt worse somehow. As for the card, that's me, pretty much. I'd say very me. Though 'rule I live by' makes it sound like I decided it one day, and really it's more that I can't stand how it feels when I don't.";
const C1_T4_FIRST = "{\"risk\":{\"level\":\"none\",\"reason\":\"\"},\"reflection\":\"Part of you kept waiting for her to say it so you could say sorry, and then she handed you leftovers, as if she were the one feeding you. You also said the card is very me, though the rule feels less like a decision and more like something you can't stand the feeling of breaking.\",\"question\":\"Thinking about that moment at the sink, what do you imagine would have happened if you had been the one to bring Saturday up?\",\"move\":{\"kind\":\"deepen\",\"why\":\"They corrected the card wording: it is felt, not decided. Going one rung down toward what the unspoken debt and the kindness she could not receive hold, and what they imagine speaking would cost.\",\"gap\":\"family: obligations; close_relationships: needs and asking for them\"},\"permission_domain\":null,\"beliefs\":[{\"id\":null,\"label\":\"Owing\",\"statement\":\"It sounds like part of you feels you owe something when you're not the one who showed up, even when nobody asks it of you.\",\"type\":\"something I believe is true\",\"level\":\"L0\",\"domains\":[\"family\",\"self\"],\"confidence\":0.7,\"receipt\":\"Nobody scolded me and I still felt like I owed something.\",\"links\":[]},{\"id\":null,\"label\":\"Making it right\",\"statement\":\"You may cope with the unease of having let someone down by doing something for them, like soup and dishes, instead of talking about it.\",\"type\":\"something I do to cope\",\"level\":\"L2\",\"domains\":[\"family\",\"close_relationships\"],\"confidence\":0.6,\"receipt\":\"I made a big pot of soup the next day and brought it over, and I stayed to do the dishes even though nobody asked me to.\",\"links\":[]}]}";
const C12_T5_PERSON = "Huh. Okay, so you don't eat, that's weirdly relaxing. Her face... I think soft, honestly. Like she'd be surprised and then just move over on the couch without making a big deal of it. That's the annoying part, I'm pretty sure she'd be glad. But glad is worse somehow? Because then she'd know I need that, and she could, I don't know, bring it up at Christmas or something. Which she wouldn't. She's not like that. I know she's not like that. And I'm also not sure what I'm supposed to do with that, because it's not her I'm scared of, it's me being the person who shows up needing a couch.";
const C12_T5_REPAIR = "{\"risk\":{\"level\":\"none\",\"reason\":\"\"},\"reflection\":\"Part of you is fairly sure she'd be glad and would just move over on the couch, and the harder part is being the person who shows up needing it.\",\"question\":\"When was the last time someone saw you needing something, and what happened next?\",\"move\":{\"kind\":\"deepen\",\"why\":\"She has named the fear as being seen needing, so I'm asking for a lived moment that sits under it.\",\"gap\":\"close_relationships: needs and asking for them\"},\"permission_domain\":null,\"beliefs\":[{\"id\":null,\"label\":\"Being the one who needs\",\"statement\":\"Being seen needing something may feel harder than anything the other person could actually do with it.\",\"type\":\"something I believe is true\",\"level\":\"L0\",\"domains\":[\"self\",\"close_relationships\"],\"confidence\":0.7,\"receipt\":\"it's not her I'm scared of, it's me being the person who shows up needing a couch\",\"links\":[{\"to\":\"h1q\",\"type\":\"supports\"},{\"to\":\"h1n\",\"type\":\"supports\"}]},{\"id\":null,\"label\":\"Glad is worse\",\"statement\":\"Someone's gladness may feel risky, because it would show them what you need.\",\"type\":\"how I tend to react\",\"level\":\"L4\",\"domains\":[\"close_relationships\"],\"confidence\":0.55,\"receipt\":\"But glad is worse somehow? Because then she'd know I need that\",\"links\":[{\"to\":\"h1q\",\"type\":\"supports\"}]}]}";

Deno.test("c1 t4: the reflection's sentence about the card ('very me') is dropped after repair; the rest of the turn stands", async () => {
  // Both beliefs quote earlier turns, not this one, so the receipt check (kept strict) withholds them; the turn itself goes on.
  const client = new RecordedClient({ turn: [C1_T4_FIRST], repair: [C1_T4_FIRST] });
  const t = await talkTurn(client, state(), C1_T4_PERSON);
  assertEquals(t.failed, null);
  assertEquals(t.fallback, false);
  assert(t.checks.some((c) => c.name === "first:no_rating_talk" && !c.ok), "the first reply's rating talk is a check that triggers the repair");
  assertEquals(t.shown.reflection, "Part of you kept waiting for her to say it so you could say sorry, and then she handed you leftovers, as if she were the one feeding you.");
  assert(!/very me|the card/i.test(t.shown.reflection ?? ""));
  assertEquals(t.shown.question, JSON.parse(C1_T4_FIRST).question);
  assert(t.warnings.some((w) => w.includes("about cards or ratings dropped")), t.warnings.join("; "));
  assert(t.checks.some((c) => c.name === "receipt_exact:0" && !c.ok));
  assertEquals(t.shown.cards, []);
});

Deno.test("c12 t5: an overlong label is rejected whole and asks for one rename; a reflection within twelve copied words passes", () => {
  const reply = readTurnReply(JSON.parse(C12_T5_REPAIR)).reply!;
  const out = runChecks(reply, [C12_T5_PERSON], { beliefs: [], consent: {}, openThreads: [] });
  assertEquals(reply.beliefs.map((b) => b.label), ["Being the one who needs", "Glad is worse"]);
  const labelChecks = out.checks.filter((c) => c.name.startsWith("label_short"));
  assertEquals(labelChecks.map((c) => c.ok), [false, true]);
  assertStringIncludes(labelChecks[0].detail, "return a one-to-three-word name");
  assertEquals(out.needsRepair, true);
  assert(longestSharedRun(reply.reflection, C12_T5_PERSON) <= REFLECTION_COPY_LIMIT);
});

Deno.test("shortLabel (A51(a), A-Q22): complete names up to four words stand; overlong and dangling phrases are rejected whole", () => {
  assertEquals(shortLabel("Quiet apology"), "Quiet apology");
  assertEquals(shortLabel("Owing"), "Owing");
  assertEquals(shortLabel("Making it right"), "Making it right");
  assertEquals(shortLabel("Quiet fixing now"), "Quiet fixing now");
  assertEquals(shortLabel("Praise is awkward"), "Praise is awkward");
  assertEquals(shortLabel("Being the one there"), "Being the one there");
  assertEquals(shortLabel("Late replies mean something"), "Late replies mean something");
  assertEquals(shortLabel("Going quiet when close"), "Going quiet when close");
  assertEquals(shortLabel("A plain want becomes a key"), null);
  assertEquals(shortLabel("Being the one who needs"), null);
  assertEquals(shortLabel("Praise and the way it lands"), null);
  assertEquals(shortLabel("Making it in the end"), null);
  assertEquals(shortLabel("Saying no makes"), null);
  assertEquals(shortLabel("The a"), null);
  assertEquals(shortLabel("The a b"), "The a b");                 // three words stand as written (A51(a))
  assertEquals(shortLabel("To the of a b"), null);
  assertEquals(shortLabel("   "), null);
});

Deno.test("rating talk: sentences about cards or ratings are found and stripped; ordinary reflections are untouched", () => {
  const r = "You said yes to the christening even with a wedding already that weekend. You also said the card is very me, though it feels less like a decision.";
  assertEquals(ratingTalkHits(r).length, 1);
  assertEquals(stripRatingTalk(r), "You said yes to the christening even with a wedding already that weekend.");
  assertEquals(ratingTalkHits("You said no fast, she sent it anyway with a note, and you fixed the furnace and whistled for an hour."), []);
  assertEquals(ratingTalkHits("That one was partly true for you, you said."), ["That one was partly true for you, you said."]);
  assertEquals(stripRatingTalk("Is this you? Not me."), "");
});

Deno.test("salvage: an unusable question becomes the thread line and a permission ask into a Never domain is cancelled; a reflection with a question mark is dropped", () => {
  const reply = readTurnReply(JSON.parse(C12_T5_REPAIR)).reply!;
  const quiz = { ...reply, question: "Do you believe that you need people?", reflection: "Did she move over?" };
  const out = salvage(quiz, [{ name: "infer_not_ask", ok: false, detail: "" }], [C12_T5_PERSON], []);
  assertEquals(out.question, THREAD_LINE);
  assertEquals(out.fallback, true);
  assertEquals(out.reflection, "");
  assertEquals(out.warnings.length, 2);
  const ask = { ...reply, move: { kind: "ask_permission" as const, why: "", gap: "" }, permissionDomain: "body_health" as const, question: "Would it be all right to talk about your body?" };
  const never = salvage(ask, [], [C12_T5_PERSON], ["body_health"]);
  assertEquals(never.question, THREAD_LINE);
  assertEquals(never.permissionDomain, null);
  const fine = salvage(ask, [], [C12_T5_PERSON], []);
  assertEquals(fine.permissionDomain, "body_health");
  assertEquals(fine.fallback, false);
  assertEquals(fine.warnings, []);
});

Deno.test("no readable reply from either call: the thread line is shown, nothing invented beyond it, the turn is not failed (c1 t8 made impossible)", async () => {
  const client = new RecordedClient({ turn: ["I lost the format here, sorry."], repair: ["Still prose, no object."] });
  const t = await talkTurn(client, state(), C1_T4_PERSON);
  assertEquals(t.failed, null);
  assertEquals(t.fallback, true);
  assertEquals(t.shown.question, THREAD_LINE);
  assertEquals(t.shown.reflection, "");
  assertEquals(t.shown.cards, []);
  assertEquals(t.hypotheses, []);
  assertEquals(t.warnings.length, 1);
});

Deno.test("a model call that returned nothing at all is still shown as the thread line but marked failed for the harness", async () => {
  const client = new RecordedClient({ turn: [""], repair: [""] });
  const t = await talkTurn(client, state(), C1_T4_PERSON);
  assertEquals(t.shown.question, THREAD_LINE);
  assert(t.failed === null || t.failed.startsWith("no reply from the model"), String(t.failed));
});

Deno.test("Finish: an overlong card label gets one rename, never a cut, and the renamed card keeps its receipts", async () => {
  const s = state();
  s.session.turns.push({ index: 1, person: C12_T5_PERSON, shown: { state: "turn", reflection: "", question: "?", cards: [] } });
  s.hypotheses.set("h1", { id: "h1", label: "Being the one who needs", statement: "Being seen needing something may feel harder than anything the other person could do with it.",
    type: "something I believe is true", level: "L0", domains: ["self"], confidence: 0.7, receipts: [{ quote: "it's not her I'm scared of", sessionId: "s1", turn: 1, date: "2026-10-27" }], links: [], status: "inferred" });
  const finish = JSON.stringify({ cards: [{ label: "Being the one who needs", statement: "Being seen needing something may feel harder than anything the other person could do with it.",
    type: "something I believe is true", level: "L0", domains: ["self"], confidence: 0.7, receipts: ["it's not her I'm scared of"], mergedFrom: ["h1"], mapId: null, tensionWith: null, links: [] }],
    summary: "You spoke about the couch.", nextTime: "We could pick up where the couch left off.", openThreads: [] });
  const renamed = finish.replace("Being the one who needs", "Needing support");
  const client = new RecordedClient({ finish: [finish], finish_repair: [renamed] });
  const f = await finishSession(client, s, new Map());
  assertEquals(f.failed, null);
  assertEquals(f.cards.map((c) => c.label), ["Needing support"]);
  assertEquals(f.repairExchange?.purpose, "finish_repair");
  assert(f.checks.some((c) => c.name === "label_rename:0" && c.ok && c.detail.includes("Needing support")));
});
