// CONTRACT §4 "forming" (COO NEXT item 7, 2026-10-31): one event per hypothesis kept after checks, carrying only
// structural fields (id, area, area_confidence, confidence, state, conviction?, existing_belief_id?) for the Talk
// spheres animation — never a label, statement or receipt (law 9: wording reaches the screen only at 0.7+, inside
// the ordinary reply cards, never here).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { talkTurn } from "../engine/talk/turn.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import { formingEvents } from "../api/talk.ts";
import type { PersonMap } from "../engine/types.ts";

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

Deno.test("forming events: no belief words, state follows the 0.7 threshold, area_confidence reflects domain agreement", async () => {
  const client = new RecordedClient({ turn: [GOOD_REPLY] });
  const state = freshState();
  const t = await talkTurn(client, state, TURN_1);
  const forming = formingEvents(t.hypotheses, state.map);
  assertEquals(forming.length, 2);

  for (const event of forming) {
    assert(!("label" in event), "forming event must not carry a label");
    assert(!("statement" in event), "forming event must not carry a statement");
    assert(!("receipt" in event), "forming event must not carry a receipt");
    assertEquals(
      Object.keys(event).every((key) => ["id", "area", "area_confidence", "confidence", "state", "conviction", "existing_belief_id"].includes(key)),
      true,
      "hosted forming events use only the closed structural contract",
    );
  }

  const coveringGaps = forming[0];
  assertEquals(coveringGaps.confidence, 0.8);
  assertEquals(coveringGaps.state, "card_up");
  assertEquals(coveringGaps.area, "work");
  assertEquals(coveringGaps.area_confidence, 1);
  assertEquals(coveringGaps.existing_belief_id, undefined);
  assertEquals(coveringGaps.conviction, undefined);

  const notEnough = forming[1];
  assertEquals(notEnough.confidence, 0.5);
  assertEquals(notEnough.state, "forming");
  assertEquals(notEnough.area, "work");        // self + work folds to work (CONTRACT §1.3)
  assertEquals(notEnough.area_confidence, 0.5); // one of two domains ("work") agrees with the chosen area
});

Deno.test("forming events: a hypothesis that resolves to an existing map belief carries existing_belief_id and conviction", async () => {
  const state = freshState({ beliefs: [{ id: "m1", label: "Covering gaps", statement: "Part of you would rather carry the extra work than let someone else be caught short.",
    type: "a rule I live by", level: "L1", domains: ["work"], confidence: 0.6, receipts: [{ quote: "old quote", sessionId: "s0", turn: 1, date: "2026-10-20" }], links: [], status: "endorsed" }] });
  const reply = JSON.stringify({
    risk: { level: "none", reason: "an ordinary work evening" },
    reflection: "Friday ended with you covering the closing list yourself.",
    question: "What was it like walking home after that?",
    move: { kind: "follow", why: "stay with the moment", gap: "work: worth tied to output" },
    permission_domain: null,
    beliefs: [{
      id: "m1", label: "Covering gaps", statement: "Part of you would rather carry the extra work than let someone else be caught short.",
      type: "a rule I live by", level: "L1", domains: ["work"], confidence: 0.75,
      receipt: "I would rather stay than make someone scramble", links: [],
    }],
  });
  const client = new RecordedClient({ turn: [reply] });
  const t = await talkTurn(client, state, TURN_1);
  const forming = formingEvents(t.hypotheses, state.map);
  assertEquals(forming.length, 1);
  assertEquals(forming[0].existing_belief_id, "m1");
  assertEquals(forming[0].state, "card_up");
  // turn.ts keeps the higher of the two confidences (law 2: receipts only strengthen a belief, never weaken it)
  assertEquals(forming[0].conviction, 0.75);
});

Deno.test("forming events: a risk stop extracts nothing (law 8), so there is nothing to form", async () => {
  const client = new RecordedClient({ turn: [GOOD_REPLY] });
  const state = freshState();
  const t = await talkTurn(client, state, "I want to end it all tonight.");
  assertEquals(t.shown.state, "safety");
  assertEquals(formingEvents(t.hypotheses, state.map), []);
});
