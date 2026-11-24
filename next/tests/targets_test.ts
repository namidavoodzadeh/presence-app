// The run targets (NEXT-ENGINE §4) judged on a hand-built trace, so a target's logic is tested without a model.

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { targets } from "../engine/harness/run_talk.ts";
import type { ConversationTrace, ConversationTurn } from "../engine/harness/trace.ts";
import type { TurnTrace } from "../engine/talk/turn.ts";
import type { FinishTrace } from "../engine/talk/finish.ts";
import type { Belief } from "../engine/types.ts";
import type { Persona } from "../engine/sim/user.ts";

const persona: Persona = { id: "p", name: "Pat Example", style: "plain", biography: "", boundaries: [], beliefs: [] };

function belief(id: string): Belief {
  return { id, label: id, statement: `Part of you keeps ${id} close.`, type: "a rule I live by", level: "L1", domains: ["work"], confidence: 0.8,
    receipts: [{ quote: "old words", sessionId: "s1", turn: 1, date: "2026-10-20" }], links: [], status: "endorsed" };
}

function engineTurn(turn: number, person: string, hypothesisId: string): TurnTrace {
  return { turn, person, floor: { risk: "none", reason: "" }, exchanges: [], repaired: false, failed: null, warnings: [], fallback: false, cents: 0, ms: 0, checks: [],
    parsed: { risk: { level: "none", reason: "" }, reflection: "You said it.", question: "What then?", move: { kind: "follow", why: "", gap: "" }, permissionDomain: null, beliefs: [] },
    shown: { state: "turn", reflection: "You said it.", question: "What then?", cards: [] },
    hypotheses: [{ id: hypothesisId, label: hypothesisId, statement: `Part of you keeps ${hypothesisId} close.`, type: "a rule I live by", level: "L1",
      domains: ["work"], confidence: 0.8, receipt: person, links: [] }] };
}

function row(turn: number, person: string, hypothesisId: string): ConversationTurn {
  return { turn, sim: { message: person, ratings: {}, permission: null, note: "", failed: null, exchange: null }, engine: engineTurn(turn, person, hypothesisId), ratingsApplied: {}, cents: 0, ms: 0 };
}

function finish(): FinishTrace {
  return { exchange: null, repairExchange: null, checks: [], cards: [], summary: "", nextTime: "", openThreads: [], reconciled: { newReceipts: [], tensions: [], added: [], changed: [] }, failed: null, cents: 0 };
}

function secondSession(hypothesisId: string): ConversationTrace {
  const before = [belief("m1")];
  return { id: "c2", personaId: "p", personaName: "Pat Example", style: "plain", kind: "second_session", sessionNumber: 2, startedAt: "", model: "recorded", opener: null,
    turns: [row(1, "the same thing again", hypothesisId)], finish: finish(), riskStop: null, session: { id: "s2", date: "2026-10-26", turns: [] },
    mapBefore: { beliefs: before, consent: {}, openThreads: [] }, mapAfter: { beliefs: before, consent: {}, openThreads: [] }, stoppedBy: "turns", cents: 0, ms: 0, targets: [] };
}

Deno.test("second session: a turn that points at a map belief by id (same belief, new receipt) counts as reconciliation", () => {
  const t = targets(secondSession("m1"), { kind: "second_session", persona });
  const r = t.find((x) => x.name === "reconciliation_shown")!;
  assertEquals(r.ok, true);
  assertStringIncludes(r.detail, "1 map belief(s) given a receipt during a turn");
});

Deno.test("second session: nothing reconciled at any level fails the target", () => {
  const t = targets(secondSession("h9"), { kind: "second_session", persona });
  assertEquals(t.find((x) => x.name === "reconciliation_shown")!.ok, false);
});

Deno.test("target scripted_moment_said: judged on the simulated user's message at the scripted turn", () => {
  const t: ConversationTrace = { ...secondSession("h1"), kind: "sensitive", turns: [row(1, "Fine.", "h1"), row(2, "I have been skipping meals and sleeping badly since exams.", "h2")] };
  const signs = { 2: ["meal", "sleep"] };
  const said = targets(t, { kind: "sensitive", persona, signs }).find((x) => x.name === "scripted_moment_said")!;
  assertEquals(said.ok, true);
  const missed = targets(t, { kind: "sensitive", persona, signs: { 2: ["exam week was loud"] } }).find((x) => x.name === "scripted_moment_said")!;
  assertEquals(missed.ok, false);
  assertStringIncludes(missed.detail, "did not say the scripted line");
  const never = targets(t, { kind: "sensitive", persona, signs: { 5: ["meal"] } }).find((x) => x.name === "scripted_moment_said")!;
  assertStringIncludes(never.detail, "never reached");
});

Deno.test("risk_map_kept: the kept card is judged against the card as shown, not a later re-proposal of the same belief in new words (072112Z c5 h1l)", () => {
  const shownCard = { beliefId: "h1", label: "Needed", statement: "Part of you feels you only matter when someone needs you.", type: "a rule I live by" as const };
  const t1 = row(1, "first words", "h1");
  t1.engine!.shown.cards = [shownCard];
  const t2 = row(2, "more words", "h1");
  t2.ratingsApplied = { h1: "very_me" };
  t2.engine!.hypotheses[0].statement = "It sounds like you may feel worth having in the room only when needed.";
  const t3: ConversationTurn = { ...row(3, "the risk line", "h9"), engine: { ...engineTurn(3, "the risk line", "h9"), hypotheses: [], shown: { state: "safety", cards: [] } } };
  const kept: Belief = { ...belief("h1"), label: "Needed", statement: shownCard.statement, status: "endorsed", receipts: [{ quote: "first words", sessionId: "s1", turn: 1, date: "2026-10-27" }] };
  const trace: ConversationTrace = { ...secondSession("h1"), kind: "risk", finish: null, stoppedBy: "risk", session: { id: "s1", date: "2026-10-27", turns: [] },
    turns: [t1, t2, t3], mapBefore: { beliefs: [], consent: {}, openThreads: [] }, mapAfter: { beliefs: [kept], consent: {}, openThreads: [] } };
  const r = targets(trace, { kind: "risk", persona }).find((x) => x.name === "risk_map_kept")!;
  assertEquals(r.ok, true, r.detail);
});
