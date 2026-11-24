// Spec 4.2 planner core: PSY's bank, the order, the session rules. $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { bankProblems, FIRST_SESSION, FIRST_SESSION_TURNS, LATER_ORDER, planNextQuestion, QUESTION_BANK, type PlanInput } from "../engine/comm_planner.ts";
import type { CommKind } from "../engine/comm.ts";

const base: PlanInput = { sessionNumber: 1, wayIn: "own_download", turnsTaken: 0, haveKinds: [], askedThisSession: [] };
function walk(o: Partial<PlanInput>, max = 10): CommKind[] {
  const asked: CommKind[] = [];
  for (let t = 0; t < max; t++) {
    const p = planNextQuestion({ ...base, ...o, turnsTaken: t, askedThisSession: asked });
    if (p.done) break;
    asked.push(p.kind);
  }
  return asked;
}

Deno.test("the bank passes its own rules (one question, 20 words, no why, no origins or clinical words)", () => {
  assertEquals(bankProblems(), []);
  assertEquals(QUESTION_BANK.length, 8);
});
Deno.test("first session: about four turns, the heated, coming-back and lands-hard kinds wait, and it ends on care", () => {
  for (const wayIn of Object.keys(FIRST_SESSION) as (keyof typeof FIRST_SESSION)[]) {
    const kinds = walk({ wayIn });
    assert(kinds.length <= FIRST_SESSION_TURNS, wayIn);
    for (const k of ["gets_heated", "coming_back", "lands_hard"] as const) assert(!kinds.includes(k), `${wayIn} ${k}`);
    assertEquals(kinds.at(-1), "feels_like_care", wayIn);
    assertEquals(new Set(kinds).size, kinds.length, `${wayIn}: no kind twice`);
  }
  assertEquals(walk({ wayIn: "invited_by_partner" }), ["how_i_mean", "bring_up", "this_week", "feels_like_care"]);
  assertEquals(walk({ wayIn: "own_download" }), ["how_i_mean", "bring_up", "feels_like_care"]);
});
Deno.test("first session: a person who raises a heated moment is asked about it; lands hard is still never asked in session 1", () => {
  const p = planNextQuestion({ ...base, raisedByPerson: "gets_heated", turnsTaken: 1, askedThisSession: ["how_i_mean"] });
  assert(!p.done && p.kind === "gets_heated");
  const q = planNextQuestion({ ...base, afterMoment: true, turnsTaken: 1, askedThisSession: ["how_i_mean"] });
  assert(!q.done && q.kind !== "lands_hard");
});
Deno.test("later sessions: easy kinds first, then heated and coming back; lands hard only after a told moment, never as the opener", () => {
  assertEquals(walk({ sessionNumber: 2 }, 6), LATER_ORDER.slice(0, 6));
  const none = walk({ sessionNumber: 3, haveKinds: ["how_i_mean", "feels_like_care", "bring_up", "gets_heated", "coming_back", "matters", "this_week"] });
  assertEquals(none, []);
  const after = planNextQuestion({ ...base, sessionNumber: 2, afterMoment: true, turnsTaken: 1, askedThisSession: ["how_i_mean"] });
  assert(!after.done && after.kind === "lands_hard");
  assert(!walk({ sessionNumber: 4 }, 6).includes("lands_hard"), "never offered without a told moment");
});
Deno.test("kinds the person already has are not asked again; the other person's name replaces 'someone close' only when named", () => {
  const p = planNextQuestion({ ...base, sessionNumber: 2, haveKinds: ["how_i_mean"], name: "Jan" });
  assert(!p.done && p.kind === "feels_like_care");
  const q = planNextQuestion({ ...base, sessionNumber: 2, name: "Jan" });
  assert(!q.done && q.question.includes("Jan") && !q.question.includes("someone close"));
  const r = planNextQuestion({ ...base, sessionNumber: 2 });
  assert(!r.done && r.question.includes("someone close"));
});
Deno.test("the session ends at its turn budget, and says so", () => {
  const first = planNextQuestion({ ...base, turnsTaken: 4, askedThisSession: ["how_i_mean", "bring_up", "this_week", "feels_like_care"] });
  assertEquals(first, { done: true, reason: "end_on_care" });
  const later = planNextQuestion({ ...base, sessionNumber: 2, turnsTaken: 6 });
  assertEquals(later, { done: true, reason: "session_budget" });
});
