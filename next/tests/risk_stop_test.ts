// A48 Q48(b) → (iii), law 8: a risk stop calls no Finish, keeps nothing from the risk turn, and leaves the cards the
// person already rated Very me / Partly on the map exactly as they were shown — unmerged, wording and receipts intact.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { keepRatedOnRiskStop } from "../engine/talk/finish.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import type { Belief, Rating } from "../engine/types.ts";

function hyp(id: string, statement: string, turn: number, label = id): Belief {
  return { id, label, statement, type: "a rule I live by", level: "L1", domains: ["work"], confidence: 0.8,
    receipts: [{ quote: `quote ${id}`, sessionId: "s1", turn, date: "2026-10-26" }], links: [], status: "inferred" };
}

function state(existing: Belief[] = []): TurnState {
  return { person: { firstName: "Omar", language: "en", about: [] }, map: { beliefs: existing, consent: {}, openThreads: [] },
    session: { id: "s1", date: "2026-10-26", turns: [] }, previous: [], hypotheses: new Map() };
}

Deno.test("risk stop: Very me and Partly cards from before the risk turn go on the map as-is; Not me, unrated and risk-turn items do not", () => {
  const st = state();
  const a = hyp("h1", "Part of you may feel the deadline is yours alone.", 2);
  const b = hyp("h2", "Part of you may feel that asking for help costs something.", 4);
  const c = hyp("h3", "Part of you may feel the team should notice without being told.", 5);
  const d = hyp("h4", "Part of you may feel rest has to be earned.", 6);
  const e = hyp("h5", "Part of you may feel nights are the hardest.", 7);
  for (const h of [a, b, c, d, e]) st.hypotheses.set(h.id, h);
  const ratings = new Map<string, Rating>([["h1", "very_me"], ["h2", "partly"], ["h3", "not_me"], ["h5", "very_me"]]);
  const rs = keepRatedOnRiskStop(st, ratings, 7);
  assertEquals(rs.finishCalled, false);
  assertEquals(rs.turn, 7);
  assertEquals(rs.kept, ["h1", "h2"]);
  assertEquals(rs.leftOut, ["h3: Not me", "h4: not rated", "h5: from the risk turn"]);
  assertEquals(st.map.beliefs.map((x) => x.id), ["h1", "h2"]);
  for (const kept of st.map.beliefs) {
    const h = st.hypotheses.get(kept.id)!;
    assertEquals(kept.status, "endorsed");
    assertEquals(kept.statement, h.statement);
    assertEquals(kept.label, h.label);
    assertEquals(kept.receipts, h.receipts);
    assert(kept.receipts !== h.receipts, "the map holds its own copy");
  }
});

Deno.test("risk stop: a kept card is never merged into an existing belief with the same wording", () => {
  const old = hyp("m1", "Part of you may feel the deadline is yours alone.", 1, "Deadline");
  old.status = "endorsed"; old.receipts[0].sessionId = "s0";
  const st = state([old]);
  const same = hyp("h9", "Part of you may feel the deadline is yours alone.", 3, "Deadline");
  st.hypotheses.set(same.id, same);
  const rs = keepRatedOnRiskStop(st, new Map([["h9", "partly"]]), 5);
  assertEquals(rs.kept, ["h9"]);
  assertEquals(st.map.beliefs.map((x) => x.id), ["m1", "h9"]);
  assertEquals(st.map.beliefs[0].receipts.length, 1, "the earlier belief gained no receipt: nothing is reconciled on a risk stop");
});

Deno.test("risk stop with nothing rated leaves the map untouched", () => {
  const st = state();
  st.hypotheses.set("h1", hyp("h1", "Part of you may feel the deadline is yours alone.", 2));
  const rs = keepRatedOnRiskStop(st, new Map(), 3);
  assertEquals(rs.kept, []);
  assertEquals(st.map.beliefs, []);
});
