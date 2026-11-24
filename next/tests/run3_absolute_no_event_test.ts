// Live check of the fixed engine, 2026-10-27 (Haiku 113830Z 29¢, Sonnet 114004Z 35¢), read end to end:
//  Haiku b04 attempt 1 added "three times"; b05 attempt 1 added "Like when a plan with them got set without me being asked first";
//  b01 attempt 1 added "again and again", attempt 2 dropped the sender's "again"; Sonnet b04 attempt 2 wrote "You bailed when it
//  got inconvenient" (the label in the past tense). The absolute rule now says: no invented count or example when the sender named
//  no event; the behaviour once, as what happened this time, in their words; the sender's "again" stays; a past-tense label is
//  still the label. Sonnet b04 attempt 1 was 1,200 tokens of thinking and no text (the arm ran with thinking default, not the run
//  of record's between_tools): the harness now takes each model's run-of-record thinking setting when none is named.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { REWRITE_PROMPT, VERIFY_PROMPT } from "../engine/bridge/bridge.ts";
import { MENU } from "../engine/bridge/plan.ts";
import { verifyCode } from "../engine/bridge/verify.ts";
import type { Plan, Rewrite, Sender } from "../engine/bridge/types.ts";
import { defaultThinking } from "../engine/model/client.ts";

Deno.test("absolute rule: no invented count or example; the sender's 'again' stays; a past-tense label is still the label", () => {
  for (const [name, text] of [["writer", REWRITE_PROMPT], ["critic", VERIFY_PROMPT]] as const) {
    assertStringIncludes(text, "three times", `${name}: the invented count is named`);
    assertStringIncludes(text, "you bailed when it got inconvenient".toLowerCase() === "" ? "" : "bailed when it got inconvenient", `${name}: the past-tense label is named`);
    assertStringIncludes(text.toLowerCase(), "again", `${name}: the sender's 'again' is covered`);
  }
  assertStringIncludes(REWRITE_PROMPT, "When the sender's words name no event, invent none");
  assertStringIncludes(REWRITE_PROMPT, "keep any \"again\" the sender wrote");
  assertStringIncludes(VERIFY_PROMPT, "an \"again\" dropped is a missing point");
  assertStringIncludes(MENU.absolute, "no invented count or example");
  assertStringIncludes(MENU.absolute, "in any tense");
  assert(!MENU.absolute.includes("never as a present-tense label"), "the menu no longer limits the label rule to the present tense");
});

Deno.test("absolute guard: an unwritten 'again' fails in code; the sender's own 'again' stands", () => {
  const plan = { outcome: "ok", relationship: "friend", register: "casual", receiverAware: false, contextBelief: null,
    transformations: [{ kind: "absolute", quote: "always", instruction: MENU.absolute }] } as Plan;
  const sender = { personaId: "sam", firstName: "Sam", map: { beliefs: [], consent: {}, openThreads: [] }, earlierMessages: [], receiverShared: [] } as Sender;
  const rewrite = (bridged: string, to: string): Rewrite => ({ bridged, contextNote: null, changes: [{ kind: "absolute", from: "always", to }] });
  const invented = verifyCode("You always change plans last minute.", rewrite("You changed plans last minute again.", "You changed plans last minute again"), plan, sender);
  assertEquals(invented.find((c) => c.name === "no_invented_again")?.ok, false);
  const kept = verifyCode("You always change plans last minute again.", rewrite("You changed plans last minute again.", "You changed plans last minute again"), plan, sender);
  assertEquals(kept.find((c) => c.name === "no_invented_again")?.ok, true);
});

Deno.test("Sam → Jo rule: sarcasm is made literal without making its phrase carry the separate afterthought feeling", () => {
  assertStringIncludes(MENU.sarcasm, "another kept sentence already does");
  for (const prompt of [REWRITE_PROMPT, VERIFY_PROMPT]) {
    assertStringIncludes(prompt.toLowerCase(), "across the whole rewrite");
    assertStringIncludes(prompt.toLowerCase(), "another kept sentence");
    assertStringIncludes(prompt.toLowerCase(), "mock praise or mock thanks");
  }
});

Deno.test("the harness takes each model's run-of-record thinking setting when none is named", () => {
  assertEquals(defaultThinking("claude-sonnet-5-5"), "between_tools");
  assertEquals(defaultThinking("claude-haiku-5-5"), "disabled");
  assertEquals(defaultThinking("claude-sonnet-5"), "default");
  assertEquals(defaultThinking("claude-opus-5-5"), "default");
});
