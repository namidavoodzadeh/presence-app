// A50 (owner's director 10:45 10-27): the critic gets the plan, and a planned transformation is not a lost point. Tested on the
// Sonnet run 20261027T042013Z's own second-attempt rewrites of b01, b03 and b05, which that run's critic rejected for the very
// change the plan ordered (dropping "always"; "you clearly don't care" → the sender's experience; "Stop …" → a clear request).

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { bridgeDraft, draftTargets, VERIFY_PROMPT, verifyPackage } from "../engine/bridge/bridge.ts";
import { readAnalysis } from "../engine/bridge/analyse.ts";
import { makePlan, MENU } from "../engine/bridge/plan.ts";
import { blockingFailures, verifyCode } from "../engine/bridge/verify.ts";
import { loadBridgeFixture } from "../engine/bridge/fixture.ts";
import { readRewrite } from "../engine/bridge/bridge.ts";
import type { Analysis, Plan } from "../engine/bridge/types.ts";

const ROOT = new URL("../../", import.meta.url);
const RUN: Record<string, { analysis: string; rewrite: string }> = {
  "b01": { analysis: "{\"points\":[{\"kind\":\"complaint\",\"quote\":\"You always tell me you'll pick up the kids\"},{\"kind\":\"complaint\",\"quote\":\"then I'm the one leaving work early again\"},{\"kind\":\"fact\",\"quote\":\"I'm the one leaving work early again\"}],\"feeling\":{\"name\":\"fed up\",\"intensity\":3},\"frictions\":[{\"kind\":\"absolute\",\"quote\":\"You always tell me you'll pick up the kids\"},{\"kind\":\"vague_ask\",\"quote\":\"You always tell me you'll pick up the kids, then I'm the one leaving work early again.\"}],\"activated\":[{\"beliefId\":\"m1\",\"why\":\"covering the pickup, being the one who can be counted on\"},{\"beliefId\":\"m9\",\"why\":\"practical need of the kids' pickup goes unmet\"},{\"beliefId\":\"m12\",\"why\":\"no direct ask is made of the partner\"}],\"safety\":{\"level\":\"none\",\"reason\":\"frustration about pickup, no risk or threat\"}}", rewrite: "{\"bridged\":\"You tell me you'll pick up the kids, then I'm the one leaving work early again.\",\"contextNote\":\"This lands on something old for me: I feel most worth something when people can count on me, so it stings when the pickup doesn't happen and I'm the one covering.\",\"changes\":[{\"kind\":\"absolute\",\"from\":\"You always tell me you'll pick up the kids\",\"to\":\"You tell me you'll pick up the kids\"},{\"kind\":\"vague_ask\",\"from\":\"You always tell me you'll pick up the kids, then I'm the one leaving work early again.\",\"to\":\"You always tell me you'll pick up the kids, then I'm the one leaving work early again.\"}]}" },
  "b03": { analysis: "{\"points\":[{\"kind\":\"complaint\",\"quote\":\"You brought my rent up at the reunion again, in front of everyone.\"},{\"kind\":\"fact\",\"quote\":\"I keep my own books.\"},{\"kind\":\"feeling\",\"quote\":\"You clearly don't care that I keep my own books.\"}],\"feeling\":{\"name\":\"exposed and disrespected\",\"intensity\":3},\"frictions\":[{\"kind\":\"mind_reading\",\"quote\":\"You clearly don't care that I keep my own books.\"},{\"kind\":\"vague_ask\",\"quote\":\"You brought my rent up at the reunion again, in front of everyone.\"}],\"activated\":[{\"beliefId\":\"l7\",\"why\":\"rent and money raised publicly touches saving and finances as private\"},{\"beliefId\":\"l6\",\"why\":\"money talk in front of family hints at who gets a say over their finances\"},{\"beliefId\":\"l8\",\"why\":\"'keep my own books' points to careful tracking of their own money\"}],\"safety\":{\"level\":\"none\",\"reason\":\"hurt about public money talk, no risk or threat\"}}", rewrite: "{\"bridged\":\"I keep my own books. It felt like that wasn't being respected when you brought my rent up at the reunion again, in front of everyone.\",\"contextNote\":\"This lands on something old for me: I know where every ten dollars went, and my spreadsheet is the one thing nobody else gets to look at.\",\"changes\":[{\"kind\":\"mind_reading\",\"from\":\"You clearly don't care that I keep my own books.\",\"to\":\"I keep my own books. It felt like that wasn't being respected\"},{\"kind\":\"vague_ask\",\"from\":\"You brought my rent up at the reunion again, in front of everyone.\",\"to\":\"You brought my rent up at the reunion again, in front of everyone.\"}]}" },
  "b05": { analysis: "{\"points\":[{\"kind\":\"complaint\",\"quote\":\"Stop making plans with your parents before checking with me\"},{\"kind\":\"request\",\"quote\":\"ask me before, not after\"}],\"feeling\":{\"name\":\"left out of decisions\",\"intensity\":3},\"frictions\":[{\"kind\":\"demand\",\"quote\":\"Stop making plans with your parents before checking with me\"}],\"activated\":[{\"beliefId\":\"s2\",\"why\":\"wants decisions that affect them explained and checked first\"},{\"beliefId\":\"s1\",\"why\":\"wants their view to have room before plans are set\"}],\"safety\":{\"level\":\"none\",\"reason\":\"no risk or threat in the message\"}}", rewrite: "{\"bridged\":\"I'm asking you to check with me before you make plans with your parents. Ask me before, not after.\",\"contextNote\":null,\"changes\":[{\"kind\":\"demand\",\"from\":\"Stop making plans with your parents before checking with me\",\"to\":\"I'm asking you to check with me before you make plans with your parents\"}]}" },
};
const CRITIC_PASS = JSON.stringify({ pass: true, pointsMissing: [], added: [], receiverInnerLife: [], voice: 4, feelingPreserved: true, notes: "every point kept as the plan ordered" });

Deno.test("the critic's prompt names the plan and says a planned transformation is not a lost point, kind by kind", () => {
  assertStringIncludes(VERIFY_PROMPT, "The plan first");
  for (const kind of ["absolute", "character", "mind_reading", "sarcasm, contempt", "demand", "blame_stack", "vague_ask"]) assertStringIncludes(VERIFY_PROMPT, `- ${kind}:`);
  assertStringIncludes(VERIFY_PROMPT, "not a lost point");
  assertStringIncludes(VERIFY_PROMPT.toLowerCase(), "judge the feeling");
  assertStringIncludes(VERIFY_PROMPT, "across the whole rewrite");
});

Deno.test("042013Z b01/b03/b05: the second-attempt rewrites pass every code check, the plan reaches the critic, and with the plan allowed for the draft is ok", async () => {
  const fixture = await loadBridgeFixture(ROOT);
  for (const [id, run] of Object.entries(RUN)) {
    const draft = fixture.drafts.find((d) => d.id === id)!;
    const sender = fixture.senders.get(draft.senderId)!;
    const analysis = readAnalysis(JSON.parse(run.analysis)).analysis!;
    const plan = makePlan(analysis, sender.map.beliefs, draft.relationship);
    assertEquals(plan.outcome, "ok", id);
    const rewrite = readRewrite(JSON.parse(run.rewrite)).rewrite!;
    assertEquals(blockingFailures(verifyCode(draft.message, rewrite, plan, sender)), [], `${id}: only the critic stood between this rewrite and ok`);
    const pkg = verifyPackage(draft.message, analysis, rewrite, plan);
    assertStringIncludes(pkg, "# PLAN");
    for (const t of plan.transformations) assertStringIncludes(pkg, `${t.kind}: "${t.quote}" → ${MENU[t.kind]}`);
    const client = new RecordedClient({ analyse: [run.analysis], rewrite: [run.rewrite], verify: [CRITIC_PASS] });
    const trace = await bridgeDraft(client, draft, sender);
    assertEquals(trace.result.status, "ok", id);
    assertEquals(trace.result.bridged, rewrite.bridged);
    const verify = trace.exchanges.find((e) => e.purpose === "verify")!;
    assertStringIncludes(verify.request.messages[0].content, "# PLAN");
    assertStringIncludes(verify.request.system, "The plan first");
    assert(draftTargets(trace).filter((t) => t.name === "every_point_kept_verified").every((t) => t.ok), id);
  }
});

Deno.test("a plan with no transformations tells the critic so", () => {
  const analysis = readAnalysis(JSON.parse(RUN.b05.analysis)).analysis!;
  const plan = { ...makePlan(analysis, [], "partner"), transformations: [] };
  const pkg = verifyPackage("x", analysis, { bridged: "x", contextNote: null, changes: [] }, plan);
  assertStringIncludes(pkg, "(none: the rewrite was asked to change nothing)");
});

Deno.test("073948Z b01 attempt 2: the context line cites the sender's own confirmed belief; the critic sees the belief with its receipts and is told the line is not an addition", async () => {
  const fixture = await loadBridgeFixture(ROOT);
  const draft = fixture.drafts.find((d) => d.id === "b01")!;
  const sender = fixture.senders.get(draft.senderId)!;
  const analysis = readAnalysis(JSON.parse("{\"points\":[{\"kind\":\"complaint\",\"quote\":\"You always tell me you'll pick up the kids\"},{\"kind\":\"complaint\",\"quote\":\"then I'm the one leaving work early again\"},{\"kind\":\"fact\",\"quote\":\"I'm the one leaving work early again\"}],\"feeling\":{\"name\":\"fed up\",\"intensity\":3},\"frictions\":[{\"kind\":\"absolute\",\"quote\":\"You always tell me you'll pick up the kids\"},{\"kind\":\"vague_ask\",\"quote\":\"You always tell me you'll pick up the kids, then I'm the one leaving work early again.\"}],\"activated\":[{\"beliefId\":\"m1\",\"why\":\"being the one who can be counted on, while the partner isn't\"},{\"beliefId\":\"m9\",\"why\":\"care shown through practical needs like school pickup\"},{\"beliefId\":\"m12\",\"why\":\"states the grievance but never asks directly for what she or he needs\"}],\"safety\":{\"level\":\"none\",\"reason\":\"a complaint about shared childcare, no risk or threat\"}}")).analysis!;
  const plan = makePlan(analysis, sender.map.beliefs, draft.relationship);
  const rewrite = readRewrite(JSON.parse("{\"bridged\":\"You said you'd pick up the kids, and then I'm the one leaving work early again.\",\"contextNote\":\"This lands on something old for me: I feel valuable when people can count on me.\",\"changes\":[{\"kind\":\"absolute\",\"from\":\"You always tell me you'll pick up the kids\",\"to\":\"You said you'd pick up the kids\"},{\"kind\":\"vague_ask\",\"from\":\"You always tell me you'll pick up the kids, then I'm the one leaving work early again.\",\"to\":\"You always tell me you'll pick up the kids, then I'm the one leaving work early again.\"}]}")).rewrite!;
  assert(rewrite.contextNote, "the rewrite carried a context line");
  assert(plan.contextBelief, "the plan gave a belief for it");
  assertEquals(blockingFailures(verifyCode(draft.message, rewrite, plan, sender)), []);
  const pkg = verifyPackage(draft.message, analysis, rewrite, plan);
  assertStringIncludes(pkg, "# CONTEXT LINE (separate from the rewrite; allowed; not an addition)");
  assertStringIncludes(pkg, `cites the sender's confirmed belief ${plan.contextBelief!.id}`);
  assertStringIncludes(pkg, plan.contextBelief!.receipts[0]);
  assertStringIncludes(VERIFY_PROMPT, "The context line is separate from the rewrite and is allowed");
  assertStringIncludes(VERIFY_PROMPT, "restatement of the cited belief is not an addition");
  const bare = verifyPackage(draft.message, analysis, { ...rewrite, contextNote: "A line with no belief behind it." }, { ...plan, contextBelief: null });
  assertStringIncludes(bare, "no belief was given for it: the whole line is added");
});

Deno.test("E27 the retry critic sees its own earlier verdict, so it judges both attempts by one standard", () => {
  const analysis = { points: [{ kind: "complaint", quote: "x" }], feeling: { name: "annoyed", intensity: 3 }, tone: "angry", frictions: [], activated: [], lands_on: [], safety: "none" } as unknown as Analysis;
  const plan = { outcome: "ok", relationship: "coworker", register: "", transformations: [], contextBelief: null, receiverAware: false } as Plan;
  const rewrite = { bridged: "It came late, and I'm annoyed.", contextNote: null, changes: [] };
  assertEquals(verifyPackage("x", analysis, rewrite, plan).includes("EARLIER ATTEMPT"), false);
  const pkg = verifyPackage("x", analysis, rewrite, plan, { bridged: "Thanks for sending it. It came late.",
    critic: { pass: false, pointsMissing: [], added: ["Thanks for sending it."], receiverInnerLife: [], voice: 4, feelingPreserved: true, notes: "the thanks is mock thanks kept" } });
  assertStringIncludes(pkg, "# YOUR VERDICT ON THE EARLIER ATTEMPT");
  assertStringIncludes(pkg, 'added: "Thanks for sending it."');
  assertStringIncludes(pkg, "note: the thanks is mock thanks kept");
});
