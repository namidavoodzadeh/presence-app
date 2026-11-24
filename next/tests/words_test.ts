import { assertEquals } from "jsr:@std/assert@1";
import { advicePatternHit, cardWordHits, clinicalHits, countQuestions, isExactSubstring, questionWordHits } from "../engine/words.ts";

Deno.test("card words: evaluative, clinical and harsh words are caught; plain description passes", () => {
  assertEquals(cardWordHits("Part of you feels you're not enough for others."), []);
  assertEquals(cardWordHits("You should fix this unhealthy pattern."), ["fix", "should", "unhealthy"]);
  assertEquals(cardWordHits("Your anxiety and attachment style show here."), ["anxiety", "attachment style"]);
  assertEquals(cardWordHits("You avoid being the one who disrupts."), []);
});

Deno.test("question words and advice patterns", () => {
  assertEquals(questionWordHits("What stays with you about that evening?"), []);
  assertEquals(questionWordHits("Isn't that a wrong way to see it?"), ["wrong"]);
  assertEquals(advicePatternHit("Have you tried talking to her?"), "Have you tried");
  assertEquals(advicePatternHit("What did she say when you got home?"), null);
  assertEquals(clinicalHits("I was diagnosed with depression"), ["depression"]);
});

Deno.test("exactly one question is counted by its mark", () => {
  assertEquals(countQuestions("What happened next?"), 1);
  assertEquals(countQuestions("Why? And then?"), 2);
  assertEquals(countQuestions("Tell me more."), 0);
});

Deno.test("receipts are exact substrings after whitespace and quote normalisation only", () => {
  const turn = "I don’t know, I   just stay late so nobody has to scramble.";
  assertEquals(isExactSubstring("I just stay late so nobody has to scramble", turn), true);
  assertEquals(isExactSubstring("I don't know", turn), true);
  assertEquals(isExactSubstring("I stay late so nobody scrambles", turn), false);
  assertEquals(isExactSubstring("", turn), false);
});
