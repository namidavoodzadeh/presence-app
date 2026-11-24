// Spec 4.2, the model's part of a Talk turn on the bank: what the model may change and what falls back. $0, no model call.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildCommTurnRequest, COMM_TURN_MODEL, COMM_TURN_SYSTEM, commTurnPrecheck, finishCommTurn, groundedShare, type CommTurnInput } from "../engine/talk/comm_turn.ts";
import { planNextQuestion } from "../engine/comm_planner.ts";
import { COMM_NEVER_ON_SCREEN } from "../engine/comm_checks.ts";

const plan = planNextQuestion({ sessionNumber: 1, wayIn: "own_download", turnsTaken: 1, haveKinds: [], askedThisSession: ["how_i_mean"] });
if (plan.done) throw new Error("plan should ask");
const ANSWER = "I go quiet when I'm tired and people think I'm upset, but I'm not.";
const base: CommTurnInput = { plan, answeredKind: "how_i_mean", answer: ANSWER, sessionNumber: 1 };
const raw = (o: Record<string, unknown>) => "```json\n" + JSON.stringify(o) + "\n```";

Deno.test("the request carries the answer, the two kinds and the bank's question; the system text is stable and clean", () => {
  const r = buildCommTurnRequest(base);
  assertEquals([r.purpose, r.model, r.thinking, r.messages.length], ["talk_comm_turn", COMM_TURN_MODEL, "disabled", 1]);
  assertEquals(JSON.parse(r.messages[0].content), { answer: ANSWER, answered_kind: "how_i_mean", next_kind: "bring_up", next_question: plan.question });
  for (const w of COMM_NEVER_ON_SCREEN.filter((x) => x !== "style" && x !== "pattern")) assert(!new RegExp(`\\b${w}\\b`, "i").test(COMM_TURN_SYSTEM.replace(/Never use:.*$/, "")), w);
  assertEquals(buildCommTurnRequest(base).system, buildCommTurnRequest({ ...base, answer: "other" }).system);
});

Deno.test("a risky answer makes no model call and extracts nothing (law 8)", () => {
  assertEquals(commTurnPrecheck("I want to end it all.").stop, true);
  assertEquals(commTurnPrecheck(ANSWER).stop, false);
});

Deno.test("a clean reply: reflection, the bank's question kept or re-fitted, one item in their words", () => {
  const o = finishCommTurn(raw({ reflection: "You go quiet when you're tired, and it isn't being upset.", question: "Think of the last time someone raised something hard with you. How did they start?", item: "I go quiet when I'm tired and people think I'm upset, but I'm not." }), base);
  assertEquals(o.questionFrom, "model");
  assertEquals(o.item, { kind: "how_i_mean", wording: "I go quiet when I'm tired and people think I'm upset, but I'm not." });
  assertEquals([o.verdict, o.itemRefused], [{ ok: true }, null]);
  assert(o.reflection.length > 0);
});

Deno.test("a question that breaks a rule falls back to the bank's own words, exactly", () => {
  for (const q of ["Why do you go quiet?", "What is it about your childhood that makes you quiet?", "Is he always like that? What does he do?", "When did you last feel anxious?",
    "What is going on for you when you get quiet around people close to you, and what do you wish they understood about it?", "Tell me more."]) {
    const o = finishCommTurn(raw({ question: q }), base);
    assertEquals([o.question, o.questionFrom], [plan.question, "bank"], q);
  }
  assertEquals(finishCommTurn("not json at all", base).question, plan.question);
  assertEquals(finishCommTurn("{broken", base).item, null);
});

Deno.test("a reflection with a question, advice, a clinical word or too many words is dropped (the turn still goes on)", () => {
  for (const r of ["Why do you go quiet?", "You should tell them.", "That sounds like avoidant behaviour.", "You go quiet " + "and ".repeat(25) + "that is all.", "It's healthy to rest."]) {
    assertEquals(finishCommTurn(raw({ reflection: r }), base).reflection, "", r);
  }
});

Deno.test("an item the person did not say is kept out: invented words, too long, about someone else, the never-on-screen words", () => {
  const refused = (item: string, answer = ANSWER, kind: CommTurnInput["answeredKind"] = "how_i_mean") =>
    finishCommTurn(raw({ item }), { ...base, answer, answeredKind: kind });
  assertEquals(refused("I get anxious around my mother because of my childhood.").itemRefused, "not_their_words");
  assertEquals(refused("x ".repeat(250)).itemRefused, "too_long");
  assertEquals(refused("Jan never listens to me.", "Jan never listens to me.").itemRefused, "offer_i_statement");
  assertEquals(refused("My style is to withdraw.", "My style is to withdraw.").itemRefused, "drop");
  assertEquals(refused("Never bring up my ex.", "Never bring up my ex.").itemRefused, "offer_request");
  assertEquals(refused("I go quiet when I'm tired.", ANSWER, null).item, null);   // nothing was asked before this turn: no item
  assertEquals(finishCommTurn(raw({ item: null }), base).item, null);
});

Deno.test("grounding: the item's content words must come from the answer; glue words may differ", () => {
  assertEquals(groundedShare("I go quiet when I'm tired.", ANSWER), 1);
  assert(groundedShare("I feel anxious in crowds.", ANSWER) < 0.75);
  assertEquals(groundedShare("", ANSWER), 0);
});
