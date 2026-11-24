import { assert, assertEquals } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { renderReadout, runSession, SESSIONS } from "../scripts/talk_comm_readout.ts";

const reply = (o: Record<string, unknown>) => JSON.stringify(o);

Deno.test("readout: a grounded item is suggested with kind, scope and receipt; an ungrounded one is kept out and the check is named", async () => {
  const s = SESSIONS.find((x) => x.id === "S1")!;
  const client = new RecordedClient({
    talk_comm_turn: [
      reply({ reflection: "You go quiet when you are thinking something through.", question: "", item: "When I go quiet, I'm thinking something through." }),
      reply({ reflection: "", question: "", item: "I love surprise parties and loud music." }),   // not their words
      reply({ reflection: "Would you like to try a new routine?", question: "", item: null }),  // a question mark: reflection dropped
      reply({ reflection: "", question: "", item: null }),
    ],
  });
  const r = await runSession(client, s, "2026-11-17");
  assertEquals(r.turns.length, 4);
  const it = r.turns[0].item!;
  assertEquals(it.kind, "how_i_mean");
  assertEquals(it.scope, "person: Maya");
  assert(it.receipt.includes("I'm thinking something through") && it.receipt.includes("2026-11-17"));
  assertEquals(r.turns[1].item, null);
  assertEquals(r.turns[1].refused, "not_their_words");
  assert(r.turns[1].checksFired.some((c) => c.includes("not_their_words")));
  assertEquals(r.turns[2].reflection, null);
  assert(r.turns[2].checksFired.some((c) => c.startsWith("reflection dropped")));
  assertEquals(r.ended, "planner done: end_on_care");
  const md = renderReadout([r], { model: "recorded", cents: 0, cap: 150, today: "2026-11-17", dry: false });
  assert(md.includes("**Suggested item:** kind how_i_mean; scope person: Maya"));
});

Deno.test("readout: a risk answer makes no model call and extracts nothing", async () => {
  const s = { ...SESSIONS[2], turns: [{ answer: "Honestly I want to kill myself." }] };
  const r = await runSession(new RecordedClient({}), s, "2026-11-17");   // an empty recorded client throws if it is called
  assertEquals(r.ended, "risk stop");
  assertEquals(r.turns[0].stop, true);
  assertEquals(r.turns[0].item, null);
});

Deno.test("readout: the script's own session order matches the planner (every scripted answer meets the question it answers)", async () => {
  const asked: Record<string, string[]> = {};
  for (const s of SESSIONS) {
    const r = await runSession(null, s, "2026-11-17");
    asked[s.id] = r.turns.map((t) => t.asked.kind);
    assert(r.turns.filter((t) => t.answer !== null).length >= 3, s.id);
  }
  assertEquals(asked.S1, ["how_i_mean", "bring_up", "this_week", "feels_like_care"]);
  assertEquals(asked.S2, ["feels_like_care", "bring_up", "gets_heated", "lands_hard", "coming_back", "matters"]);
  assertEquals(asked.S4, ["how_i_mean", "bring_up", "this_week", "feels_like_care"]);
  assertEquals(asked.S6, ["how_i_mean", "bring_up", "feels_like_care"]);
});
