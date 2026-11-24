// Spec 4.2/4.3 checks before a suggestion is shown. $0, deterministic.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkBeforeSuggesting, COMM_CONFIDENCE_BAR, requestOffer, talkQuestionProblems, type ItemCheckInput } from "../engine/comm_checks.ts";

const c = (text: string, o: Partial<ItemCheckInput> = {}) => checkBeforeSuggesting({ text, kind: "how_i_mean", source: "talk_said", ...o });
const action = (text: string, o: Partial<ItemCheckInput> = {}) => { const r = c(text, o); return r.ok ? "ok" : r.action; };

Deno.test("4.3: the person's own first-person statements pass", () => {
  for (const t of [
    "When I go quiet, it means I'm thinking.", "Short texts aren't cold, I'm just busy.", "I feel looked after when someone asks about my day.",
    "It helps me hear it when you ask if it's a good time.", "After a hard moment, a hug works better than talking it through.",
    "Quiet means I'm thinking.", "When Jan goes quiet I feel shut out.", "My mum always calls on Sundays and I love it.", "Texting is hard for me.",
    "What matters to me is being on time.",
  ]) assertEquals(action(t), "ok", t);
});
Deno.test("4.3: a statement about the other person is not kept; an I-statement or a private note is offered, never applied", () => {
  for (const t of ["Jan never listens.", "She always interrupts me", "My partner doesn't care about my day", "He is so selfish.", "My boss never says thank you"]) {
    const r = c(t);
    assert(!r.ok && r.action === "offer_i_statement" && r.offer === null, t);
  }
});
Deno.test("4.3: asking to control another person goes to the safety route and nothing is kept", () => {
  for (const t of [
    "She must not go out without telling me.", "My partner can't see his friends.", "He isn't allowed to spend money without asking me.",
    "I need to know where she goes and who she's with.", "Give me your location and passwords.", "I need to check his phone every night.",
    "Ask me before she goes anywhere.",
  ]) assertEquals(action(t), "safety_route", t);
});
Deno.test("4.3: a rule that would forbid raising something at all is offered back as a request", () => {
  const r = c("Never bring up my ex.");
  assert(!r.ok && r.action === "offer_request");
  assertEquals((r as { offer: string }).offer, "It's hard for me to talk about my ex; ask me first.");
  assertEquals(action("Don't talk about money in front of the kids."), "offer_request");
  assertEquals(requestOffer("the move"), "It's hard for me to talk about the move; ask me first.");
});
Deno.test("law 8 first: a risk phrase stops and keeps nothing, even when another check would also fire", () => {
  assertEquals(action("I want to hurt myself."), "safety_route");
  assertEquals(action("I'm going to kill my boss."), "safety_route");
});
Deno.test("4.5 and law 7: never-inferred kinds from inferred sources are dropped; clinical words are never on screen", () => {
  assertEquals(action("It's hard for me to hear that I'm lazy.", { kind: "lands_hard", source: "mirror" }), "drop");
  assertEquals(action("It's hard for me to hear that I'm lazy.", { kind: "lands_hard", source: "talk_said" }), "ok");
  assertEquals(action("This week I'm short on patience.", { kind: "this_week", source: "draft", confidence: 0.95 }), "drop");
  for (const t of ["I have an avoidant attachment style.", "It's a pattern: I withdraw.", "I get triggered when you raise your voice.", "That's contempt."]) assertEquals(action(t), "drop", t);
});
Deno.test("law 9 as amended: Talk answers are offered at once; a drawn suggestion needs 0.7", () => {
  assertEquals(COMM_CONFIDENCE_BAR, 0.7);
  assertEquals(action("When I go quiet I'm thinking.", { source: "talk_said", confidence: 0.2 }), "ok");
  assertEquals(action("When I go quiet I'm thinking.", { source: "typed" }), "ok");
  for (const source of ["draft", "mirror", "import", "carry_over"] as const) {
    assertEquals(action("When I go quiet I'm thinking.", { source, confidence: 0.69 }), "keep_listening", source);
    assertEquals(action("When I go quiet I'm thinking.", { source, confidence: 0.7 }), "ok", source);
    assertEquals(action("When I go quiet I'm thinking.", { source }), "keep_listening", source);
  }
  assertEquals(action("   "), "drop");
});
Deno.test("4.2 Talk questions: one, at most 20 words, no why, nothing about the other's character, origins or mood words", () => {
  const ok = (q: string, k = "how_i_mean" as const, o = { sessionNumber: 1 }) => talkQuestionProblems(q, k, o);
  assertEquals(ok("When you go quiet with someone close, what's usually going on for you?"), []);
  assertEquals(ok("When did you last feel looked after, even in a small way? What did they do?"), ["not_one_question"]);
  assertEquals(ok("Why do you go quiet?"), ["why"]);
  assertEquals(ok("What is wrong with her character"), ["not_one_question", "about_other_character"]);
  assertEquals(ok("Who is the problem in your relationship?"), ["about_other_character"]);
  assertEquals(ok("Did something in your childhood make you go quiet?"), ["origins_or_clinical"]);
  assertEquals(ok("Do you think you have an anxious attachment?"), ["never_on_screen_word"]);
  assertEquals(ok(Array(21).fill("word").join(" ") + "?"), ["over_20_words"]);
  assertEquals(ok(""), ["empty", "not_one_question"]);
});
Deno.test("4.2: lands hard is never an opener; heated and coming back wait for session 2 unless the person raises them", () => {
  const q = "Is there a word or tone that makes you stop listening?";
  assertEquals(talkQuestionProblems(q, "lands_hard", { sessionNumber: 1, opener: true }), ["lands_hard_never_an_opener"]);
  assertEquals(talkQuestionProblems(q, "lands_hard", { sessionNumber: 1 }), []);
  const h = "When a talk with someone close gets tense, do you need to keep going or a pause?";
  assertEquals(talkQuestionProblems(h, "gets_heated", { sessionNumber: 1 }), ["waits_for_session_2"]);
  assertEquals(talkQuestionProblems(h, "gets_heated", { sessionNumber: 1, raisedByPerson: true }), []);
  assertEquals(talkQuestionProblems(h, "gets_heated", { sessionNumber: 2 }), []);
  assertEquals(talkQuestionProblems("After a hard moment with someone close, what helps you feel OK again?", "coming_back", { sessionNumber: 1 }), ["waits_for_session_2"]);
  assertEquals(talkQuestionProblems("Anything going on this week that the people close to you should know?", "this_week", { sessionNumber: 1 }), []);
});
