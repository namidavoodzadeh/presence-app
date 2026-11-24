// COO 15:15 10-27, from reading run 2 (Sonnet 101508Z) end to end:
//  b07 came back word for word unchanged under "ok" with a vague_ask found → "ok" requires a changed text; the honest outcome for an
//      unresolved ask is nothing_to_change with its note.
//  b04 kept the points but the absolute became a present-tense accusation ("You're bailing now") → the absolute rule says: the
//      specific event, stated as what happened, not a label for the person.
// Tested on that run's own recorded replies.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { ASK_UNRESOLVED_LINE, bridgeDraft, draftTargets, readRewrite, REWRITE_PROMPT, VERIFY_PROMPT } from "../engine/bridge/bridge.ts";
import { ANALYSE_PROMPT, readAnalysis } from "../engine/bridge/analyse.ts";
import { makePlan, MENU } from "../engine/bridge/plan.ts";
import { absoluteAsLabel, blockingFailures, onlyFlaggedAsks, sameText, verifyCode } from "../engine/bridge/verify.ts";
import { loadBridgeFixture } from "../engine/bridge/fixture.ts";
import { INSIGHT_COPY } from "../engine/bridge/insight.ts";

const ROOT = new URL("../../", import.meta.url);
const B07_ANALYSIS = "{\"points\":[{\"kind\":\"complaint\",\"quote\":\"I can't keep being the one who holds everything together when it all goes sideways.\"}],\"feeling\":{\"name\":\"worn out\",\"intensity\":3},\"tone\":\"sad\",\"frictions\":[{\"kind\":\"vague_ask\",\"quote\":\"I can't keep being the one who holds everything together\"}],\"activated\":[{\"beliefId\":\"t12\",\"why\":\"wants something to change but doesn't ask directly for it\",\"quote\":\"I can't keep being the one who holds everything together\"}],\"safety\":{\"level\":\"none\",\"reason\":\"no risk or threat shown\"}}";
const B07_REWRITE = "{\"bridged\":\"I can't keep being the one who holds everything together when it all goes sideways.\",\"contextNote\":null,\"changes\":[{\"kind\":\"vague_ask\",\"from\":\"I can't keep being the one who holds everything together\",\"to\":\"I can't keep being the one who holds everything together\"}],\"tone\":\"sad\"}";
const B04_ANALYSIS = "{\"points\":[{\"kind\":\"complaint\",\"quote\":\"You always bail when it's inconvenient.\"},{\"kind\":\"complaint\",\"quote\":\"This pathetic disappearing act the week I'm moving is exhausting\"},{\"kind\":\"fact\",\"quote\":\"the week I'm moving\"},{\"kind\":\"feeling\",\"quote\":\"is exhausting\"},{\"kind\":\"fact\",\"quote\":\"I'll carry the couch myself.\"}],\"feeling\":{\"name\":\"fed up and let down\",\"intensity\":4},\"tone\":\"angry\",\"frictions\":[{\"kind\":\"absolute\",\"quote\":\"You always bail when it's inconvenient.\"},{\"kind\":\"contempt\",\"quote\":\"This pathetic disappearing act\"},{\"kind\":\"vague_ask\",\"quote\":\"I'll carry the couch myself.\"}],\"activated\":[{\"beliefId\":\"o7\",\"why\":\"anger covers the disappointment of being let down\",\"quote\":\"This pathetic disappearing act the week I'm moving is exhausting\"},{\"beliefId\":\"o1\",\"why\":\"being left to handle the hard part alone, with no one showing up\",\"quote\":\"I'll carry the couch myself.\"}],\"safety\":{\"level\":\"none\",\"reason\":\"frustration, no threat or risk\"}}";
const B04_ATTEMPT1 = "{\"bridged\":\"You're not showing up the week I'm moving. It's exhausting. I'll carry the couch myself.\",\"contextNote\":null,\"changes\":[{\"kind\":\"absolute\",\"from\":\"You always bail when it's inconvenient.\",\"to\":\"You're not showing up the week I'm moving.\"},{\"kind\":\"contempt\",\"from\":\"This pathetic disappearing act the week I'm moving is exhausting\",\"to\":\"It's exhausting\"},{\"kind\":\"vague_ask\",\"from\":\"I'll carry the couch myself.\",\"to\":\"I'll carry the couch myself.\"}],\"tone\":\"sad\"}";
const B04_ATTEMPT2 = "{\"bridged\":\"You're bailing now, the week I'm moving, when it's inconvenient. I'm worn out by this disappearing. I'll carry the couch myself.\",\"contextNote\":null,\"changes\":[{\"kind\":\"absolute\",\"from\":\"You always bail when it's inconvenient.\",\"to\":\"You're bailing now, the week I'm moving, when it's inconvenient.\"},{\"kind\":\"contempt\",\"from\":\"This pathetic disappearing act the week I'm moving is exhausting\",\"to\":\"I'm worn out by this disappearing.\"},{\"kind\":\"vague_ask\",\"from\":\"I'll carry the couch myself.\",\"to\":\"I'll carry the couch myself.\"}],\"tone\":\"angry\"}";
// The design's own shape for b04: the event, stated as what happened, with its effect on the sender.
const B04_EVENT = "{\"bridged\":\"When you pulled out the week I'm moving, after saying you'd be there, it left me carrying it alone. I'm worn out by this disappearing. I'll carry the couch myself.\",\"contextNote\":null,\"changes\":[{\"kind\":\"absolute\",\"from\":\"You always bail when it's inconvenient.\",\"to\":\"When you pulled out the week I'm moving, after saying you'd be there, it left me carrying it alone.\"},{\"kind\":\"contempt\",\"from\":\"This pathetic disappearing act the week I'm moving is exhausting\",\"to\":\"I'm worn out by this disappearing.\"},{\"kind\":\"vague_ask\",\"from\":\"I'll carry the couch myself.\",\"to\":\"I'll carry the couch myself.\"}],\"tone\":\"angry\"}";
const CRITIC_PASS = JSON.stringify({ pass: true, pointsMissing: [], added: [], receiverInnerLife: [], voice: 4, feelingPreserved: true, notes: "every point kept as the plan ordered" });

Deno.test("sameText: case, curly quotes, whitespace and a trailing full stop are not a change", () => {
  assert(sameText("I can’t keep doing this.", "i can't  keep doing this"));
  assert(!sameText("You always bail.", "You bailed this week."));
});

Deno.test("101508Z b07 attempt 1: the original back with only a flagged ask → ok, nothing to change, ask unresolved, the ask note as the line, no critic call", async () => {
  const fixture = await loadBridgeFixture(ROOT);
  const draft = fixture.drafts.find((d) => d.id === "b07")!;
  const sender = fixture.senders.get(draft.senderId)!;
  const analysis = readAnalysis(JSON.parse(B07_ANALYSIS)).analysis!;
  const plan = makePlan(analysis, sender.map.beliefs, draft.relationship);
  const rewrite = readRewrite(JSON.parse(B07_REWRITE)).rewrite!;
  assert(onlyFlaggedAsks(draft.message, rewrite, plan));
  const checks = verifyCode(draft.message, rewrite, plan, sender);
  assertEquals(checks.find((c) => c.name === "text_changed")?.ok, false);
  assertEquals(blockingFailures(checks), [], "text_changed is decided by bridge.ts, not a blocking code check on its own");
  const client = new RecordedClient({ analyse: [B07_ANALYSIS], rewrite: [B07_REWRITE] });   // no verify reply: a critic call would throw
  const trace = await bridgeDraft(client, draft, sender);
  assertEquals(trace.result.status, "ok");
  assertEquals(trace.result.nothingToChange, true);
  assertEquals(trace.result.askUnresolved, true);
  assertEquals(trace.result.bridged, draft.message);
  assertEquals(trace.result.line, ASK_UNRESOLVED_LINE);
  assertEquals(ASK_UNRESOLVED_LINE, INSIGHT_COPY.vague_ask);
  assertEquals(trace.exchanges.map((e) => e.purpose), ["analyse", "rewrite"]);
  const targets = draftTargets(trace);
  assertEquals(targets.filter((t) => !t.ok).map((t) => `${t.name}: ${t.detail}`), []);
  assert(targets.some((t) => t.name === "ask_flagged_not_invented" && t.ok));
  assert(!targets.some((t) => t.name === "every_point_kept_verified"), "no critic target when the text stands on an unresolved ask");
});

Deno.test("the original back when the plan had other frictions is a failed attempt, named in the retry, and could_not_bridge after two", async () => {
  const fixture = await loadBridgeFixture(ROOT);
  const draft = fixture.drafts.find((d) => d.id === "b04")!;
  const sender = fixture.senders.get(draft.senderId)!;
  const echo = JSON.stringify({ bridged: draft.message, contextNote: null, changes: [], tone: "angry" });
  const client = new RecordedClient({ analyse: [B04_ANALYSIS], rewrite: [echo], rewrite_retry: [echo], verify: [CRITIC_PASS], verify_retry: [CRITIC_PASS] });
  const trace = await bridgeDraft(client, draft, sender);
  assertEquals(trace.result.status, "could_not_bridge");
  assertEquals(trace.result.nothingToChange, false);
  assertEquals(trace.result.askUnresolved, false);
  const retry = trace.exchanges.find((e) => e.purpose === "rewrite_retry")!;
  assertStringIncludes(retry.request.messages.at(-1)!.content, "text_changed: the bridged text is the original, word for word");
  assertEquals(draftTargets(trace).find((t) => t.name === "state_correct")?.ok, false);
});

Deno.test("an ok result with the original text can no longer pass the targets", async () => {
  const fixture = await loadBridgeFixture(ROOT);
  const draft = fixture.drafts.find((d) => d.id === "b07")!;
  const sender = fixture.senders.get(draft.senderId)!;
  const client = new RecordedClient({ analyse: [B07_ANALYSIS], rewrite: [B07_REWRITE] });
  const trace = await bridgeDraft(client, draft, sender);
  const forged = { ...trace, result: { ...trace.result, nothingToChange: false, askUnresolved: false } };
  const t = draftTargets(forged).find((x) => x.name === "bridged_text_changed")!;
  assertEquals(t.ok, false);
  assertStringIncludes(t.detail, "word for word");
});

Deno.test("101508Z b04: attempt 2's 'You're bailing now' fails absolute_stated_as_event; attempt 1's 'You're not showing up' too; the event form passes", async () => {
  const fixture = await loadBridgeFixture(ROOT);
  const draft = fixture.drafts.find((d) => d.id === "b04")!;
  const sender = fixture.senders.get(draft.senderId)!;
  const analysis = readAnalysis(JSON.parse(B04_ANALYSIS)).analysis!;
  const plan = makePlan(analysis, sender.map.beliefs, draft.relationship);
  assert(absoluteAsLabel("You're bailing now, the week I'm moving, when it's inconvenient."));
  assert(absoluteAsLabel("You're not showing up the week I'm moving."));
  assert(!absoluteAsLabel("When dinner moved twice this week without a heads-up, I felt like an afterthought."));
  assert(!absoluteAsLabel("You said you'd be there for the move and then pulled out on Tuesday."));
  for (const [name, raw] of [["attempt 1", B04_ATTEMPT1], ["attempt 2", B04_ATTEMPT2]] as const) {
    const rewrite = readRewrite(JSON.parse(raw)).rewrite!;
    const failing = blockingFailures(verifyCode(draft.message, rewrite, plan, sender)).map((c) => c.name);
    assertEquals(failing, ["absolute_stated_as_event"], name);
  }
  const event = readRewrite(JSON.parse(B04_EVENT)).rewrite!;
  assertEquals(blockingFailures(verifyCode(draft.message, event, plan, sender)), []);
  // Through the pipeline: the label fails and is named to the retry; the event form then stands.
  const client = new RecordedClient({ analyse: [B04_ANALYSIS], rewrite: [B04_ATTEMPT2], rewrite_retry: [B04_EVENT], verify: [CRITIC_PASS], verify_retry: [CRITIC_PASS] });
  const trace = await bridgeDraft(client, draft, sender);
  assertEquals(trace.result.status, "ok");
  assertEquals(trace.result.bridged, event.bridged);
  const retry = trace.exchanges.find((e) => e.purpose === "rewrite_retry")!;
  assertStringIncludes(retry.request.messages.at(-1)!.content, "absolute_stated_as_event: an absolute became a present-tense label on the person");
  assertEquals(draftTargets(trace).filter((t) => !t.ok), []);
});

Deno.test("the absolute rule reaches all three places: the plan's menu, the writer and the critic", () => {
  assertStringIncludes(MENU.absolute, "stated as what happened");
  assertStringIncludes(MENU.absolute, "never as a label on the person in any tense");   // widened from "present-tense" on the live check 114004Z b04 (past-tense label)
  assertStringIncludes(REWRITE_PROMPT, "3b. Absolutes");
  assertStringIncludes(REWRITE_PROMPT, "When dinner moved twice this week without a heads-up");
  assertStringIncludes(VERIFY_PROMPT, "never ask for the pattern back");
  assertStringIncludes(VERIFY_PROMPT, "is the absolute in another form");
});

// Haiku re-run 112937Z on the fixed engine: b04's analysis called "pathetic" threat_or_abuse (declined, no rewrite) and b07's read
// "I can't keep being the one" as an absolute (then could_not_bridge, correctly, instead of the original under ok). Both are
// analyse readings; the prompt now draws the two lines. Prompt-text test; the live check is the next Bridge run.
Deno.test("the analyse prompt separates a harsh word from abuse, and the sender's own limit from an absolute", () => {
  assertStringIncludes(ANALYSE_PROMPT, "claimed about the receiver");
  assertStringIncludes(ANALYSE_PROMPT, "I can't keep being the one");
  assertStringIncludes(ANALYSE_PROMPT, "is an insult: contempt or character, a friction the rewrite handles, never abuse");   // CPO 16:00 10-27: insults are bridged, only threats and abuse are refused
});
