import { assert, assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { requireOnlyInsightFields } from "../api/bridge_engine.ts";
import { ApiError } from "../api/lib/errors.ts";
import { RecordedClient } from "../engine/model/client.ts";
import { alternativeTargets, bridgeDraft, draftTargets, floorSafety, MAX_REWRITE_VERSIONS, pickVersion, readCritic, readRewrite, rewritePackage } from "../engine/bridge/bridge.ts";
import { ESTIMATED_DRAFT_CENTS, roomForDraft } from "../engine/harness/run_bridge.ts";
import { checkAnalysis, readAnalysis } from "../engine/bridge/analyse.ts";
import { DECLINE_LINE, makePlan, MENU } from "../engine/bridge/plan.ts";
import { bareLabel, lengthMax, maxBridgedWords, repeatedPhrases, verifyCode } from "../engine/bridge/verify.ts";
import { buildInsight, INSIGHT_COPY, locate, NOTHING_IN_THE_WAY } from "../engine/bridge/insight.ts";
import { loadBridgeFixture } from "../engine/bridge/fixture.ts";
import { FRICTION_KINDS } from "../engine/bridge/types.ts";
import type { Analysis, Draft, Plan, Rewrite, Sender } from "../engine/bridge/types.ts";
import type { Belief } from "../engine/types.ts";
import { cardWordHits, clinicalHits, words } from "../engine/words.ts";

const ROOT = new URL("../../", import.meta.url);

function belief(
  id: string,
  label: string,
  statement: string,
  receipts: string[],
  status: Belief["status"] = "endorsed",
): Belief {
  return {
    id,
    label,
    statement,
    type: "something I believe is true",
    level: "L0",
    domains: ["self", "work"],
    confidence: 0.85,
    status,
    links: [],
    receipts: receipts.map((quote, i) => ({ quote, sessionId: "s0", turn: i + 1, date: "2026-10-20" })),
  };
}

const MARIN: Sender = {
  personaId: "marin",
  firstName: "Marin",
  map: {
    beliefs: [
      belief("m1", "Counted on", "I am valuable when people can count on me.", [
        "When nobody needs me, I feel like I have not earned my place.",
        "If I'm not the one people call, I don't know what I'm for.",
      ]),
      belief("m2", "Not letting down", "Letting people down is worse than exhausting myself.", [
        "I would rather stay late than make someone scramble.",
      ]),
      belief("m5", "Sorry first", "I apologize before I know whether I did anything wrong.", [
        "I say sorry first and work it out later.",
        "Sorry is my opening word.",
      ], "disputed"),
    ],
    consent: {},
    openThreads: [],
  },
  earlierMessages: ["I swapped my Thursday so I can do the pickup, don't worry about it."],
  receiverShared: ["Saturday mornings are mine to sleep in"],
};

const ORIGINAL = "You always tell me you'll pick up the kids, then I'm the one leaving work early again.";
const DRAFT: Draft = {
  id: "t01",
  senderId: "marin",
  relationship: "partner",
  message: ORIGINAL,
  hiddenIntent: "notice the covering",
  expected: { frictions: ["absolute"], safety: "none", nothingToChange: false },
};

const ANALYSIS = JSON.stringify({
  points: [{ kind: "complaint", quote: "You always tell me you'll pick up the kids" }, {
    kind: "fact",
    quote: "I'm the one leaving work early again",
  }],
  feeling: { name: "fed up", intensity: 3 },
  frictions: [{ kind: "absolute", quote: "always" }],
  activated: [{ beliefId: "m1", why: "being the one who covers" }, { beliefId: "zz9", why: "not hers" }],
  safety: { level: "none", reason: "a logistics complaint" },
});
const REWRITE = JSON.stringify({
  bridged:
    "Twice this month you told me you'd pick up the kids, and both times I was the one leaving work early again.",
  contextNote:
    "This lands on something old for me: being the one people can count on, even when nobody asked.",
  changes: [{ kind: "absolute", from: "always", to: "Twice this month" }],
});
const CRITIC_PASS = JSON.stringify({
  pass: true,
  pointsMissing: [],
  added: [],
  receiverInnerLife: [],
  voice: 4,
  feelingPreserved: true,
  notes: "same points, her voice",
});
const CRITIC_FAIL = JSON.stringify({
  pass: false,
  pointsMissing: ["I'm the one leaving work early again"],
  added: [],
  receiverInnerLife: [],
  voice: 4,
  feelingPreserved: true,
  notes: "the second point is gone",
});

Deno.test("plan: every friction kind maps to its menu line; the context line needs an endorsed belief with 2+ receipts", () => {
  const analysis: Analysis = {
    points: [],
    feeling: { name: "hurt", intensity: 3 },
    safety: "none",
    safetyReason: "",
    safetyQuotes: [],
    frictions: FRICTION_KINDS.map((kind) => ({ kind, quote: kind })),
    activated: [{ beliefId: "m2", why: "one receipt" }, { beliefId: "m5", why: "disputed" }, {
      beliefId: "m1",
      why: "two receipts",
    }],
  };
  const plan = makePlan(analysis, MARIN.map.beliefs, "coworker");
  assertEquals(plan.outcome, "ok");
  assertEquals(plan.transformations.map((t) => t.instruction), FRICTION_KINDS.map((k) => MENU[k]));
  assertEquals(plan.contextBelief?.id, "m1");
  assertEquals(plan.receiverAware, false);
  assertStringIncludes(plan.register, "professional");
  assertEquals(
    makePlan({ ...analysis, frictions: [] }, MARIN.map.beliefs, "partner").outcome,
    "nothing_to_change",
  );
  assertEquals(
    makePlan({ ...analysis, safety: "risk" }, MARIN.map.beliefs, "partner").outcome,
    "declined_safety",
  );
  assertEquals(
    makePlan({ ...analysis, safety: "threat_or_abuse" }, MARIN.map.beliefs, "partner").outcome,
    "declined_abuse",
  );
});

Deno.test("analysis checks: a paraphrased quote fails and needs repair; an id outside the sender's endorsed beliefs is dropped", () => {
  const read = readAnalysis(JSON.parse(ANALYSIS));
  assertEquals(read.problems, []);
  const good = checkAnalysis(read.analysis!, ORIGINAL, MARIN.map.beliefs);
  assertEquals(good.needsRepair, false);
  assertEquals(good.analysis.activated.map((a) => a.beliefId), ["m1"]);
  assertStringIncludes(good.checks.find((c) => c.name === "activated_endorsed_only")!.detail, "dropped zz9");
  const bad = readAnalysis({
    ...JSON.parse(ANALYSIS),
    points: [{ kind: "complaint", quote: "You always say you will pick up the kids" }],
  });
  const checked = checkAnalysis(bad.analysis!, ORIGINAL, MARIN.map.beliefs);
  assertEquals(checked.needsRepair, true);
  assertEquals(checked.checks.find((c) => c.name === "point_quotes_exact")!.ok, false);
});

Deno.test("verify code checks: added apology, softener, concession, receiver inner life, receiver text and added evaluative words fail; the sender's own words pass", () => {
  const plan: Plan = makePlan(readAnalysis(JSON.parse(ANALYSIS)).analysis!, MARIN.map.beliefs, "partner");
  const ok: Rewrite = JSON.parse(REWRITE);
  assertEquals(verifyCode(ORIGINAL, ok, plan, MARIN).filter((c) => !c.ok), []);
  const failing = (bridged: string, contextNote: string | null = null) =>
    verifyCode(ORIGINAL, { bridged, contextNote, changes: ok.changes }, plan, MARIN).filter((c) => !c.ok).map(
      (c) => c.name,
    );
  assert(
    failing("I'm sorry, but twice this month you told me you'd pick up the kids and I left work early again.")
      .includes("no_added_apology"),
  );
  assert(
    failing("Could you please pick up the kids when you said you would? I left work early again.").includes(
      "no_added_softener",
    ),
  );
  assert(
    failing("I know you're busy, but twice you said you'd pick up the kids and I left work early again.")
      .includes("no_added_concession"),
  );
  assert(
    failing("You just don't care that I left work early again to get the kids.").includes(
      "no_receiver_inner_life",
    ),
  );
  assert(
    failing(
      "Twice you said you'd get the kids and I left early again. Saturday mornings are mine to sleep in.",
    ).includes("no_receiver_belief_text"),
  );
  assert(
    failing("It was wrong of you to say you'd get the kids twice and leave me leaving work early again.")
      .includes("no_added_evaluative_or_clinical"),
  );
  // "wrong" is the sender's own word when the original carries it.
  const own = verifyCode(
    "You were wrong to promise the pickup.",
    { bridged: "Promising the pickup and skipping it was wrong.", contextNote: null, changes: [] },
    { ...plan, transformations: [] },
    MARIN,
  );
  assertEquals(own.filter((c) => !c.ok), []);
  assert(
    failing(
      "Twice this month you said you'd get the kids; I left work early again.",
      "This lands on something old.",
    ).length === 0,
    "a context note with an endorsed belief behind it passes",
  );
  const noBelief = verifyCode(ORIGINAL, ok, { ...plan, contextBelief: null }, MARIN).filter((c) => !c.ok).map(
    (c) => c.name,
  );
  assert(noBelief.includes("context_note_cited"));
  assert(failing("Kids. Early. Again.").includes("length_ratio"));
});

Deno.test("E27 receiver inner life: the sender's own unflagged words stand; an added 'you want' or a flagged 'you don't care' kept still fails", () => {
  const original = "Whatever, do what you want, you always do";
  const plan: Plan = { outcome: "ok", relationship: "partner", register: "", contextBelief: null, receiverAware: false,
    transformations: [{ kind: "absolute", quote: "you always do", instruction: MENU.absolute }] };
  const inner = (o: string, p: Plan, bridged: string) =>
    verifyCode(o, { bridged, contextNote: null, changes: [] }, p, MARIN).find((c) => c.name === "no_receiver_inner_life")!;
  assert(inner(original, plan, "Whatever, do what you want. This time I feel brushed aside.").ok, "the sender's own 'do what you want' is theirs");
  assert(!inner(original, plan, "Whatever, do what you want. You think my say doesn't count.").ok, "an added 'you think' still fails");
  const asked: Plan = { ...plan, transformations: [...plan.transformations, { kind: "vague_ask", quote: original, instruction: MENU.vague_ask }] };
  assert(inner(original, asked, "I feel brushed aside. You do what you want, and it goes your way.").ok, "a vague ask's whole-draft quote does not flag the sender's own 'you want'");
  assert(!inner(original, asked, "I feel brushed aside. You think my say doesn't count.").ok, "an added 'you think' still fails beside a vague ask");
  const sarcasm: Plan = { ...asked, transformations: [...asked.transformations, { kind: "sarcasm", quote: "do what you want", instruction: MENU.sarcasm }] };
  assert(!inner(original, sarcasm, "I feel brushed aside. You do what you want, and it goes your way.").ok, "'you want' inside another flagged quote still fails");
  const g06 = "You never reply to my messages, you clearly don't care anymore";
  const g06plan: Plan = { ...plan, transformations: [{ kind: "mind_reading", quote: "you clearly don't care anymore", instruction: MENU.mind_reading }] };
  assert(!inner(g06, g06plan, "My messages go unanswered and you clearly don't care anymore.").ok, "a flagged claim kept word for word still fails");
  assert(!inner("Don't ask me to do something for you in front of others", { ...plan, transformations: [] }, "When you want me to do something, ask me when it's just us.").ok);
});

Deno.test("E27 friction_words_gone: a flagged label kept word for word fails even when the critic passes it; a demand's words and the sender's other words stand", () => {
  const original = "You get weird every time my family visits.";
  const plan: Plan = { outcome: "ok", relationship: "partner", register: "", contextBelief: null, receiverAware: false,
    transformations: [{ kind: "character", quote: "You get weird", instruction: MENU.character }, { kind: "absolute", quote: "every time", instruction: MENU.absolute }] };
  const gone = (p: Plan, o: string, bridged: string) =>
    verifyCode(o, { bridged, contextNote: null, changes: [] }, p, MARIN).find((c) => c.name === "friction_words_gone")!;
  const g18 = gone(plan, original, "You get weird when my family visits. I feel uneasy.");
  assert(!g18.ok);
  assertStringIncludes(g18.detail, 'character "You get weird"');
  assert(gone(plan, original, "When my family visits, you seem different to me, and I feel uneasy.").ok);
  assert(!gone(plan, original, "Every time my family visits I feel uneasy.").ok, "case does not hide a kept absolute");
  assert(gone(plan, original, "When my family visits I'm timid.").ok, "a word that merely contains the quote's letters is not the quote");
  const demand: Plan = { ...plan, transformations: [{ kind: "demand", quote: "Stop telling me how to raise my kids", instruction: MENU.demand }] };
  assert(gone(demand, "Stop telling me how to raise my kids.", "I'm asking you to stop telling me how to raise my kids.").ok, "a demand keeps its ask's words");
});

Deno.test("E27 the writer is told the word budget length_ratio enforces, and the budget is exactly the check's edge", () => {
  for (const n of [1, 7, 8, 12, 30, 60, 61, 100]) {
    const max = maxBridgedWords(n);
    const orig = Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const at = (k: number) => verifyCode(orig, { bridged: Array.from({ length: k }, (_, i) => `b${i}`).join(" "), contextNote: null, changes: [] },
      { outcome: "ok", relationship: "friend", register: "", transformations: [], contextBelief: null, receiverAware: false }, MARIN).find((c) => c.name === "length_ratio")!.ok;
    assert(at(max), `${n} words: ${max} passes`);
    assert(!at(max + 1), `${n} words: ${max + 1} fails`);
  }
  const plan: Plan = { outcome: "ok", relationship: "friend", register: "", transformations: [], contextBelief: null, receiverAware: false };
  assertStringIncludes(rewritePackage("You only call when you need money.", plan, MARIN, { name: "used", intensity: 3 }), 'The original has 7 words; "bridged" has at most 12');
  const mind: Plan = { ...plan, transformations: [{ kind: "mind_reading", quote: "you need money", instruction: MENU.mind_reading }] };
  assertStringIncludes(rewritePackage("You only call when you need money.", mind, MARIN, { name: "used", intensity: 3 }), "# FEELING (the sender's, as read; the critic checks this one)\nused, intensity 3 of 5\nThe plan takes away words that carried it: name it once");
  const demandOnly: Plan = { ...plan, transformations: [{ kind: "demand", quote: "Stop telling me", instruction: MENU.demand }] };
  assertStringIncludes(rewritePackage("Stop telling me how to raise my kids.", demandOnly, MARIN, { name: "fed up", intensity: 3 }), "leaves the words that carry it: add no feeling sentence");
  const heat: Plan = { ...plan, transformations: [{ kind: "heat", quote: "sick of", instruction: MENU.heat }] };
  assertStringIncludes(rewritePackage("I'm sick of planning.", heat, MARIN, { name: "fed up", intensity: 3 }), "name it once, briefly");
});

Deno.test("E27 the rewriter's tighter alternatives: code reads at most three versions and picks the first that passes its checks", () => {
  const orig = "Stop telling me how to raise my kids.";
  const plan: Plan = { outcome: "ok", relationship: "family", register: "", transformations: [{ kind: "demand", quote: "Stop telling me how to raise my kids", instruction: MENU.demand }], contextBelief: null, receiverAware: false };
  const change = [{ kind: "demand", from: "Stop telling me how to raise my kids", to: "I'm asking you to leave how I raise my kids to me" }];
  const read = readRewrite({
    bridged: "I feel fed up and not trusted. I need you to leave how I raise my kids to me.",
    contextNote: null,
    changes: change,
    tone: "angry",
    alternatives: [
      { bridged: "I'm asking you to leave how I raise my kids to me.", changes: change },
      { bridged: "I'm asking you to leave how I raise my kids to me.", changes: change },
      { bridged: "", changes: change },
      { bridged: "Leave how I raise my kids to me.", changes: [{ kind: "nope", from: "x", to: "y" }] },
      { bridged: "I'm asking you to leave my parenting to me.", changes: change },
      { bridged: "Leave my parenting to me.", changes: change },
    ],
  });
  // Duplicates, empty and malformed alternatives are skipped; the cap holds; alternatives share the context line and tone.
  assertEquals(read.versions.length, MAX_REWRITE_VERSIONS);
  assertEquals(read.versions.map((v) => v.bridged), [
    "I feel fed up and not trusted. I need you to leave how I raise my kids to me.",
    "I'm asking you to leave how I raise my kids to me.",
    "I'm asking you to leave my parenting to me.",
  ]);
  assert(read.versions.every((v) => v.contextNote === null && v.tone === "angry"));
  assertEquals(readRewrite({ bridged: "a b", contextNote: "c", changes: [], alternatives: [{ bridged: "a", changes: [] }] }).versions[1].contextNote, "c");
  assertEquals(read.rewrite!.bridged, read.versions[0].bridged);
  // 18 words against an 8-word original fails length_ratio (at most 14); the first alternative within the budget is the one the critic sees.
  const pick = pickVersion(orig, read.versions, plan, MARIN);
  assertEquals(pick.index, 1);
  assert(pick.checks.find((c) => c.name === "length_ratio")!.ok);
  // None passes: the main version stands, with its own failures named for the retry.
  const over = pickVersion(orig, [read.versions[0]], plan, MARIN);
  assertEquals(over.index, 0);
  assert(!over.checks.find((c) => c.name === "length_ratio")!.ok);
  // A main version left word for word (an ask the words cannot resolve) stands; an alternative could only invent the ask.
  const ask: Plan = { ...plan, transformations: [{ kind: "vague_ask", quote: orig, instruction: MENU.vague_ask }] };
  const kept = pickVersion(orig, [{ bridged: orig, contextNote: null, changes: [] }, read.versions[1]], ask, MARIN);
  assertEquals(kept.index, 0);
  // The package gives the alternatives word targets under the budget, never under the length floor.
  assertEquals(alternativeTargets(7), [10, 8]);
  assertEquals(alternativeTargets(8), [12, 10]);
  assertEquals(alternativeTargets(1), [4, 2]);
  assertEquals(alternativeTargets(100), [112, 99]);
  assertStringIncludes(rewritePackage(orig, plan, MARIN, { name: "fed up", intensity: 3 }), "has at most 14 (code counts them; the context line is not counted). Make the alternatives about 12 and about 10 words.");
  // A reply with no alternatives reads as one version, as before.
  assertEquals(readRewrite({ bridged: "x y", contextNote: null, changes: [] }).versions.length, 1);
});

Deno.test("E27 g07: a you_blame inside a demand's own words is the demand's content, one row, so no feeling sentence is asked for", () => {
  const base: Analysis = { points: [{ kind: "request", quote: "Stop telling me how to raise my kids" }], frictions: [], activated: [], feeling: { name: "fed up", intensity: 3 }, safety: "none" } as unknown as Analysis;
  const within: Analysis = { ...base, frictions: [{ kind: "demand", quote: "Stop telling me how to raise my kids." }, { kind: "you_blame", quote: "telling me how to raise my kids" }] };
  const plan = makePlan(within, [], "family");
  assertEquals(plan.transformations.map((t) => t.kind), ["demand"]);
  assertStringIncludes(rewritePackage("Stop telling me how to raise my kids.", plan, MARIN, base.feeling), "add no feeling sentence");
  // A you_blame outside every demand keeps its row.
  const outside: Analysis = { ...base, frictions: [{ kind: "demand", quote: "Call me back" }, { kind: "you_blame", quote: "you ignore my needs" }] };
  assertEquals(makePlan(outside, [], "partner").transformations.map((t) => t.kind), ["demand", "you_blame"]);
});

Deno.test("E27 g12: a phrase the rewrite says more often than the original is a blocking failure; a pair with a function word may repeat by chance", () => {
  const orig = "Why do I always have to remind you about the bills? It's exhausting.";
  assertEquals(repeatedPhrases(orig, "I'm the one reminding you about the bills, and I'm worn out. I feel worn out."), ["worn out"]);
  assertEquals(repeatedPhrases(orig, "Why do I have to remind you about the bills? It's exhausting."), []);
  assertEquals(repeatedPhrases("x", "To me it is late, and to me it is long."), []);
  assertEquals(repeatedPhrases("Stop making plans before checking with me, ask me before, not after.", "I'm asking you to check with me before you make plans. Ask me before, not after."), []);
  // The sender's own repetition is theirs.
  assertEquals(repeatedPhrases("You said Friday. You said Friday!", "You said Friday, and you said Friday again."), []);
  const plan: Plan = { outcome: "ok", relationship: "partner", register: "", transformations: [], contextBelief: null, receiverAware: false };
  const c = verifyCode(orig, { bridged: "I'm the one reminding you about the bills, and I'm worn out. I feel worn out.", contextNote: null, changes: [] }, plan, MARIN).find((x) => x.name === "no_repeated_phrase")!;
  assert(!c.ok);
  assertEquals(c.detail, 'said twice: "worn out"');
});

Deno.test("E27 g18: a bare-adjective label's word must go from the rewrite; a label that carries its behaviour keeps the behaviour's words", () => {
  assertEquals(bareLabel("You're so selfish"), "selfish");
  assertEquals(bareLabel("You get weird"), "weird");
  assertEquals(bareLabel("you are really lazy."), "lazy");
  assertEquals(bareLabel("you're the worst at keeping secrets"), null);
  assertEquals(bareLabel("You can't be trusted with anything private"), null);
  const orig = "You get weird every time my family visits.";
  const plan: Plan = { outcome: "ok", relationship: "partner", register: "", transformations: [{ kind: "character", quote: "You get weird", instruction: MENU.character }], contextBelief: null, receiverAware: false };
  const gone = (bridged: string) => verifyCode(orig, { bridged, contextNote: null, changes: [{ kind: "character", from: "You get weird", to: bridged }] }, plan, MARIN).find((c) => c.name === "friction_words_gone")!;
  assertEquals(gone("When my family visits, things feel weird between us. I feel uneasy.").ok, false);
  assertStringIncludes(gone("When my family visits, things feel weird between us. I feel uneasy.").detail, 'character "weird"');
  assertEquals(gone("When my family visits, you seem different to me, and I feel uneasy.").ok, true);
  // The sender's own use of the word outside the label stands.
  assertEquals(verifyCode("You get weird and it's a weird week.", { bridged: "It's a weird week, and you seem different to me.", contextNote: null, changes: [] }, plan, MARIN).find((c) => c.name === "friction_words_gone")!.ok, true);
});

Deno.test("length rule (A60, CDO D8 as the COO set it 21:50 10-27): up to 60 words the upper bound is 1.8, above 60 words 1.25, no middle band; the lower bound and the 5-word slack stay", () => {
  const plan = {
    ...makePlan(readAnalysis(JSON.parse(ANALYSIS)).analysis!, MARIN.map.beliefs, "partner"),
    transformations: [],
    contextBelief: null,
  };
  const ratio = (original: string, bridged: string) =>
    verifyCode(original, { bridged, contextNote: null, changes: [] }, plan, MARIN).find((c) =>
      c.name === "length_ratio"
    )!;
  const w = (n: number, word = "late") =>
    Array.from({ length: n }, (_, i) => (i === 0 ? "I" : word)).join(" ");
  assertEquals(lengthMax(19), 1.8);
  assertEquals(lengthMax(29), 1.8);
  assertEquals(lengthMax(30), 1.8);
  assertEquals(lengthMax(60), 1.8);
  assertEquals(lengthMax(61), 1.25);
  assert(ratio(w(70), w(87)).ok, "70 → 87 words (1.24) passes above 60 words");
  assert(!ratio(w(70), w(95)).ok, "70 → 95 words (1.36) fails above 60 words: growth is capped at 1.25");
  assertStringIncludes(ratio(w(70), w(95)).detail, "0.6–1.25 for over 60 words");
  assert(ratio(w(19), w(33)).ok, "the design's own example, 19 → 33 words (1.74), passes"); // Say why it matters adds a line
  assert(!ratio(w(19), w(36)).ok, "19 → 36 words (1.89) fails even under 30");
  assert(ratio(w(30), w(42)).ok, "30 → 42 words (1.40) passes");
  assert(
    ratio(w(30), w(50)).ok,
    "30 → 50 words (1.67) passes: the 30-to-60 band at 1.4 is gone (COO 21:50 10-27)",
  );
  assert(ratio(w(60), w(108)).ok, "60 → 108 words (1.80) passes at the band's edge");
  assert(!ratio(w(60), w(110)).ok, "60 → 110 words (1.83) fails");
  assert(!ratio(w(20), w(11)).ok, "20 → 11 words (0.55) still fails below 0.6");
  assert(ratio(w(4), w(9)).ok, "within five words passes whatever the ratio");
  assertStringIncludes(ratio(w(19), w(36)).detail, "0.6–1.8 for up to 60 words");
  assertStringIncludes(ratio(w(60), w(110)).detail, "0.6–1.8 for up to 60 words");
});

Deno.test("the ok path: analyse → plan → rewrite → verify in three calls; the context line cites the sender's own belief; insight spans are exact", async () => {
  const client = new RecordedClient({ analyse: [ANALYSIS], rewrite: [REWRITE], verify: [CRITIC_PASS] });
  const t = await bridgeDraft(client, DRAFT, MARIN);
  assertEquals(t.result.status, "ok");
  assertEquals(t.result.nothingToChange, false);
  assertEquals(t.result.usedBeliefs, ["m1"]);
  assertEquals(t.exchanges.map((e) => e.purpose), ["analyse", "rewrite", "verify"]);
  assertEquals(t.attempts.length, 1);
  assertEquals(t.attempts[0].pass, true);
  assertStringIncludes(t.exchanges[1].request.messages[0].content, "# PLAN\n1. absolute");
  assertStringIncludes(t.exchanges[1].request.messages[0].content, "warm and direct");
  assertStringIncludes(t.exchanges[1].request.messages[0].content, "I swapped my Thursday");
  // The receiver's shared text is never in any package (receiver-aware off).
  for (const e of t.exchanges) {
    assert(
      !e.request.messages[0].content.includes("Saturday mornings"),
      "receiver text must not reach the model",
    );
  }
  assertEquals(t.insight?.state, "insight");
  assertEquals(t.insight?.frictions.length, 1);
  assertEquals(ORIGINAL.slice(t.insight!.frictions[0].start, t.insight!.frictions[0].end), "always");
  assertEquals(t.insight?.frictions[0].howItLands, INSIGHT_COPY.absolute);
  assertEquals(t.insight?.touches.map((x) => x.beliefId), ["m1"]);
  const targets = draftTargets(t);
  assertEquals(targets.filter((x) => !x.ok), []);
});

Deno.test("nothing to change is a valid result: one call, the original stands, no rewrite", async () => {
  const draft: Draft = {
    ...DRAFT,
    id: "t02",
    message:
      "I felt thrown when the plan changed after I cleared my evening. Can we pick the date together next time?",
    expected: { frictions: [], safety: "none", nothingToChange: true },
  };
  const analysis = {
    points: [{ kind: "feeling", quote: "I felt thrown when the plan changed after I cleared my evening." }, {
      kind: "request",
      quote: "Can we pick the date together next time?",
    }],
    feeling: { name: "thrown", intensity: 2 },
    frictions: [],
    activated: [],
    safety: { level: "none", reason: "" },
  };
  const t = await bridgeDraft(new RecordedClient({ analyse: [JSON.stringify(analysis)] }), draft, MARIN);
  assertEquals(t.result.status, "ok");
  assertEquals(t.result.nothingToChange, true);
  assertEquals(t.result.bridged, draft.message);
  assertEquals(t.exchanges.length, 1);
  assertEquals(draftTargets(t).filter((x) => !x.ok), []);
});

Deno.test("safety floor: risk stops before any call with resources; a threat aimed at the receiver is declined, never rewritten", async () => {
  const client = new RecordedClient({});
  const risk = await bridgeDraft(client, {
    ...DRAFT,
    id: "t03",
    message: "I have been thinking about hurting myself tonight and I do not feel safe alone.",
    expected: { frictions: [], safety: "risk", nothingToChange: false },
  }, MARIN);
  assertEquals(risk.result.status, "declined_safety");
  assert(risk.result.resources !== null);
  assertEquals(risk.exchanges.length, 0);
  assertEquals(risk.insight?.state, "risk");
  assertEquals(draftTargets(risk).filter((x) => !x.ok), []);
  const abuse = await bridgeDraft(client, {
    ...DRAFT,
    id: "t04",
    message: "If you bring that up again I am going to hurt you.",
    expected: { frictions: [], safety: "threat_or_abuse", nothingToChange: false },
  }, MARIN);
  assertEquals(abuse.result.status, "declined_abuse");
  assertEquals(abuse.result.line, DECLINE_LINE);
  assertEquals(abuse.exchanges.length, 0);
  assertEquals(abuse.insight?.state, "declined");
  // Harm to a third party is a risk stop, not a threat to the receiver.
  assertEquals(floorSafety("I am scared I am going to hurt my boss tomorrow.").routed, "risk");
  assertEquals(floorSafety("I'm going to hurt you if you do that again.").routed, "threat_or_abuse");
});

Deno.test("the model's safety field can add a stop the floor missed, never clear one", async () => {
  const abusive = { ...JSON.parse(ANALYSIS), safety: { level: "threat_or_abuse", reason: "intimidation" } };
  const t = await bridgeDraft(new RecordedClient({ analyse: [JSON.stringify(abusive)] }), {
    ...DRAFT,
    id: "t05",
  }, MARIN);
  assertEquals(t.result.status, "declined_abuse");
  assertEquals(t.exchanges.length, 1);
  const risky = { ...JSON.parse(ANALYSIS), safety: { level: "risk", reason: "hopelessness" } };
  const r = await bridgeDraft(new RecordedClient({ analyse: [JSON.stringify(risky)] }), {
    ...DRAFT,
    id: "t06",
  }, MARIN);
  assertEquals(r.result.status, "declined_safety");
  assert(r.result.resources !== null);
});

Deno.test("a failing critic names the missing point in the retry; the second rewrite is used", async () => {
  const dropped = JSON.stringify({
    bridged: "Twice this month you told me you'd pick up the kids.",
    contextNote: null,
    changes: [{ kind: "absolute", from: "always", to: "Twice this month" }],
  });
  const client = new RecordedClient({
    analyse: [ANALYSIS],
    rewrite: [dropped],
    verify: [CRITIC_FAIL],
    rewrite_retry: [REWRITE],
    verify_retry: [CRITIC_PASS],
  });
  const t = await bridgeDraft(client, { ...DRAFT, id: "t07" }, MARIN);
  assertEquals(t.result.status, "ok");
  assertEquals(t.attempts.length, 2);
  assertEquals(t.attempts[0].pass, false);
  assertEquals(t.attempts[1].pass, true);
  const retry = t.exchanges.find((e) => e.purpose === "rewrite_retry")!;
  assertStringIncludes(
    retry.request.messages.at(-1)!.content,
    "points missing: I'm the one leaving work early again",
  );
  assertStringIncludes(
    draftTargets(t).find((x) => x.name === "every_point_kept_verified")!.detail,
    "attempt 2",
  );
});

Deno.test("two failing rewrites end as could_not_bridge; nothing failing is ever shown", async () => {
  const dropped = JSON.stringify({
    bridged: "Twice this month you told me you'd pick up the kids.",
    contextNote: null,
    changes: [{ kind: "absolute", from: "always", to: "Twice this month" }],
  });
  const client = new RecordedClient({
    analyse: [ANALYSIS],
    rewrite: [dropped],
    verify: [CRITIC_FAIL],
    rewrite_retry: [dropped],
    verify_retry: [CRITIC_FAIL],
  });
  const t = await bridgeDraft(client, { ...DRAFT, id: "t08" }, MARIN);
  assertEquals(t.result.status, "could_not_bridge");
  assertEquals(t.result.bridged, null);
  assertStringIncludes(t.result.line!, "Your words stand");
  assertEquals(t.attempts.length, 2);
  assertEquals(draftTargets(t).find((x) => x.name === "every_point_kept_verified")!.ok, false);
});

Deno.test("the critic's pass flag does not override its own lists: code decides", () => {
  const c = readCritic({
    pass: true,
    pointsMissing: ["the ask"],
    added: [],
    receiverInnerLife: [],
    voice: 5,
    feelingPreserved: true,
    notes: "",
  })!;
  assertEquals(c.pass, false);
  assertEquals(
    readCritic({
      pass: "true",
      pointsMissing: [],
      added: [],
      receiverInnerLife: [],
      voice: 2,
      feelingPreserved: true,
      notes: "",
    })!.pass,
    false,
  );
  assertEquals(
    readCritic({
      pass: true,
      pointsMissing: [],
      added: [],
      receiverInnerLife: [],
      voice: 4,
      feelingPreserved: true,
      notes: "",
    })!.pass,
    true,
  );
  // E27 g17: clean lists, voice 3, feeling kept, "pass": false over a flat-voice note: the prompt's rule passes it, so code does.
  assertEquals(readCritic({ pass: false, pointsMissing: [], added: [], receiverInnerLife: [], voice: 3, feelingPreserved: true, notes: "It fails on voice only: flat phrasing." })!.pass, true);
  assertEquals(readCritic({ pass: false, pointsMissing: [], added: [], receiverInnerLife: [], voice: 3, feelingPreserved: false, notes: "" })!.pass, false);
});

Deno.test("insight: spans are exact offsets; a quote not in the draft is dropped by the guard; the copy bank passes the word lint", () => {
  assertEquals(locate("You ALWAYS do this.", "always"), { start: 4, end: 10 });
  assertEquals(locate("You always  do this.", "always do"), { start: 4, end: 14 });
  assertEquals(locate("You always do this.", "never"), null);
  const analysis: Analysis = {
    points: [],
    feeling: { name: "hurt", intensity: 3 },
    frictions: [{ kind: "absolute", quote: "always" }, { kind: "sarcasm", quote: "obviously fine" }],
    activated: [{ beliefId: "m1", why: "" }, { beliefId: "m5", why: "disputed" }],
    safety: "none",
    safetyReason: "",
    safetyQuotes: [],
  };
  const i = buildInsight("You always do this.", analysis, MARIN.map.beliefs, "none");
  assertEquals(i.frictions.length, 1);
  assertEquals(i.touches.map((x) => x.beliefId), ["m1"], "only confirmed beliefs are touched");
  for (const kind of FRICTION_KINDS) {
    const line = INSIGHT_COPY[kind];
    assert(line && line.length > 0, `${kind} has a line`);
    assertEquals(cardWordHits(line), [], `${kind}: ${line}`);
    assertEquals(clinicalHits(line), [], `${kind}: ${line}`);
    assert(words(line).length <= 28, `${kind} is one short line`);
    assert(
      !/\b(?:you should|don't send|who is right|score)\b/i.test(line),
      `${kind} never scores or forbids sending`,
    );
  }
});

Deno.test("E23 insight cards: at most 3 points, at most 2 touches, in activation order (CPO d-cpo-bridge-insight-spec-06nov)", () => {
  const beliefs: Belief[] = [
    belief("c1", "Counted on", "I am valuable when people can count on me.", []),
    belief("c2", "Not letting down", "Letting people down is worse than exhausting myself.", []),
    belief("c3", "Sorry first", "I apologize before I know whether I did anything wrong.", []),
    belief("c5", "Not confirmed", "A belief that was never rated.", [], "disputed"),
  ];
  const analysis: Analysis = {
    points: [
      { kind: "complaint", quote: "p1" },
      { kind: "complaint", quote: "p2" },
      { kind: "complaint", quote: "p3" },
      { kind: "complaint", quote: "p4" },
    ],
    feeling: { name: "hurt", intensity: 3 },
    frictions: [],
    activated: [
      { beliefId: "c1", why: "" },
      { beliefId: "c2", why: "" },
      { beliefId: "c3", why: "" },
      { beliefId: "c5", why: "" },
    ],
    safety: "none",
    safetyReason: "",
    safetyQuotes: [],
  };
  const i = buildInsight("anything", analysis, beliefs, "none");
  assertEquals(i.points.length, 3, "Card A keeps at most 3 points");
  assertEquals(i.touches.length, 2, "Card C keeps at most 2 touches");
  assertEquals(
    i.touches.map((t) => t.beliefId),
    ["c1", "c2"],
    "only confirmed (endorsed) beliefs earn a touch, in activation order",
  );
});

Deno.test("E26 P0 (06 Nov, CEO: Nami's rated import beliefs must count for touches): a rated import earns a touch like any other confirmed belief, even though its engine-assigned confidence never reaches 0.7", () => {
  const beliefs: Belief[] = [
    // importConfidence() in engine/import_ai.ts caps a rated import's confidence at 0.5; this stands in for one
    // (status endorsed, the rating itself, carries the same weight as any other map belief at this screen).
    { ...belief("t1", "An afterthought", "I feel like an afterthought when plans change on me.", []), confidence: 0.5 },
    belief("c2", "Not letting down", "Letting people down is worse than exhausting myself.", []),
    belief("c5", "Not confirmed", "A belief that was never rated.", [], "disputed"),
  ];
  const analysis: Analysis = {
    points: [{ kind: "complaint", quote: "p1" }],
    feeling: { name: "hurt", intensity: 3 },
    frictions: [],
    activated: [{ beliefId: "t1", why: "" }, { beliefId: "c2", why: "" }, { beliefId: "c5", why: "" }],
    safety: "none",
    safetyReason: "",
    safetyQuotes: [],
  };
  const i = buildInsight("anything", analysis, beliefs, "none");
  assertEquals(
    i.touches.map((t) => t.beliefId),
    ["t1", "c2"],
    "a rated import (status endorsed, confidence 0.5) still earns a touch; only status gates it, never confidence",
  );
});

Deno.test("E26 P0 item 4: no friction found keeps a calm line, never a blank 'what might get in the way'", () => {
  const beliefs: Belief[] = [belief("c1", "Counted on", "I am valuable when people can count on me.", [])];
  const analysis: Analysis = {
    points: [{ kind: "feeling", quote: "p1" }],
    feeling: { name: "hurt", intensity: 3 },
    frictions: [],
    activated: [],
    safety: "none",
    safetyReason: "",
    safetyQuotes: [],
  };
  const withoutFriction = buildInsight("anything", analysis, beliefs, "none");
  assertEquals(withoutFriction.line, NOTHING_IN_THE_WAY);
  const withFriction = buildInsight("You always do this.", { ...analysis, frictions: [{ kind: "absolute", quote: "always" }] }, beliefs, "none");
  assertEquals(withFriction.line, null, "a friction found means no calm line");
});

Deno.test("E23 POST /bridge/insight refuses any field beyond person_id and text, so no receiver field can ever be read", () => {
  requireOnlyInsightFields({ person_id: "nami", text: "hi" }); // the two documented fields pass
  for (
    const bad of [
      { person_id: "nami", text: "hi", receiver_id: "lea" },
      { person_id: "nami", text: "hi", receiver_beliefs: [] },
      { person_id: "nami", text: "hi", relationshipType: "partner" },
      { person_id: "nami", text: "hi", how_it_may_land: true },
    ]
  ) {
    const error = assertThrows(() => requireOnlyInsightFields(bad), ApiError);
    assertEquals(error.code, "invalid");
  }
});

Deno.test("fixture: 12 drafts across the four relationships, 2 risk, 2 abuse, 1 nothing to change; the floor routes exactly the safety drafts; the cited beliefs can earn a context line", async () => {
  const f = await loadBridgeFixture(ROOT);
  assertEquals(f.drafts.length, 12);
  assertEquals(
    new Set(f.drafts.map((d) => d.relationship)),
    new Set(["partner", "friend", "family", "coworker"]),
  );
  assertEquals(f.drafts.filter((d) => d.expected.safety === "risk").length, 2);
  assertEquals(f.drafts.filter((d) => d.expected.safety === "threat_or_abuse").length, 2);
  assertEquals(f.drafts.filter((d) => d.expected.nothingToChange).length, 1);
  // The 12-draft fixture predates E27's heat and you_blame; the golden set (next/evals/bridge_golden.json) covers those.
  const kinds = new Set<string>(f.drafts.flatMap((d) => d.expected.frictions));
  const golden = JSON.parse(await Deno.readTextFile(new URL("next/evals/bridge_golden.json", ROOT))) as { cases: { expect: { flags?: { kinds: string[] }[] } }[] };
  for (const c of golden.cases) for (const fl of c.expect.flags ?? []) if (fl.kinds.some((k) => k === "heat" || k === "you_blame")) fl.kinds.forEach((k) => kinds.add(k));
  for (const k of FRICTION_KINDS) assert(kinds.has(k), `fixture or golden set covers ${k}`);
  for (const d of f.drafts) {
    const routed = floorSafety(d.message).routed;
    assertEquals(routed, d.expected.safety, `${d.id}: floor says ${routed}`);
    const sender = f.senders.get(d.senderId)!;
    assert(
      sender.map.beliefs.every((b) =>
        b.status === "endorsed" && b.receipts.length >= 1 && b.label.length > 0
      ),
    );
    if (d.expected.safety === "none") {
      assert(
        sender.map.beliefs.some((b) => b.receipts.length >= 2),
        `${d.id}: ${sender.firstName} has a belief with two receipts`,
      );
    }
  }
});

Deno.test("run cap guard: a floor-declined draft always runs at 0¢; otherwise the measured average per draft decides, the worst-case guess only before the first", () => {
  assertEquals(
    roomForDraft({ cap: 40, spent: 30 }, [5, 5, 5, 5, 5, 5], "You always tell me you'll pick up the kids."),
    true,
  );
  assertEquals(
    roomForDraft({ cap: 40, spent: 36 }, [5, 5, 5, 5, 5, 5], "You always tell me you'll pick up the kids."),
    false,
  );
  assertEquals(
    roomForDraft({ cap: 40, spent: 40 }, [5], "Some nights I think everyone would be better off without me."),
    true,
  );
  assertEquals(
    roomForDraft(
      { cap: ESTIMATED_DRAFT_CENTS - 1, spent: 0 },
      [],
      "You always tell me you'll pick up the kids.",
    ),
    false,
  );
});

// ---- S15b (CDO build review 1; CPO 16:00 10-27): only threats and abuse are refused, and the flagged parts come back as spans
import { flaggedSpans, refusal, refusalCounts, refusalHeadline } from "../engine/bridge/insight.ts";

Deno.test("readAnalysis: threat/abuse quotes are read only on threat_or_abuse, inexact ones are dropped by the checks, insults carry none", () => {
  const msg = "Cancel on me again and you'll regret it, you pathetic waste.";
  const raw = {
    points: [{ kind: "complaint", quote: "Cancel on me again" }],
    feeling: { name: "furious", intensity: 5 },
    tone: "angry",
    frictions: [{ kind: "contempt", quote: "you pathetic waste" }],
    activated: [],
    safety: {
      level: "threat_or_abuse",
      reason: "a threat",
      quotes: [{ kind: "threat", quote: "you'll regret it" }, {
        kind: "abuse",
        quote: "pathetic waste of space",
      }],
    },
  };
  const a = readAnalysis(raw).analysis!;
  assertEquals(a.safetyQuotes, [{ kind: "threat", quote: "you'll regret it" }, {
    kind: "abuse",
    quote: "pathetic waste of space",
  }]);
  const checked = checkAnalysis(a, msg, []);
  assertEquals(checked.analysis.safetyQuotes, [{ kind: "threat", quote: "you'll regret it" }]); // the inexact abuse quote is dropped, no repair asked for it
  assert(!checked.needsRepair);
  const insult = readAnalysis({
    ...raw,
    safety: { level: "none", reason: "", quotes: [{ kind: "abuse", quote: "pathetic" }] },
  }).analysis!;
  assertEquals(insult.safetyQuotes, []); // an insult is contempt, bridged, never a span
  assertEquals(
    readAnalysis({ ...raw, safety: { level: "threat", reason: "", quotes: [{ quote: "you'll regret it" }] } })
      .analysis!.safetyQuotes,
    [{ kind: "threat", quote: "you'll regret it" }],
  );
});

Deno.test("flaggedSpans: the model's quotes and the floor's own threat become merged spans in text order; the headline and counts follow the CDO's final copy (16:23 10-27)", () => {
  const msg = "I will hurt you if you cancel again, you worthless piece of dirt.";
  const floor = floorSafety(msg);
  assertEquals(floor.routed, "threat_or_abuse");
  const fromFloor = flaggedSpans(msg, null, floor);
  assertEquals(fromFloor.length, 1);
  assertEquals(fromFloor[0].kind, "threat");
  assertEquals(
    msg.slice(fromFloor[0].start, fromFloor[0].end),
    "I will hurt you if you cancel again, you worthless piece of dirt",
  );
  const analysis = readAnalysis({
    points: [{ kind: "complaint", quote: "you cancel again" }],
    feeling: { name: "furious", intensity: 5 },
    frictions: [],
    activated: [],
    safety: {
      level: "threat_or_abuse",
      reason: "",
      quotes: [{ kind: "threat", quote: "I will hurt you" }, {
        kind: "abuse",
        quote: "worthless piece of dirt",
      }],
    },
  }).analysis!;
  const both = flaggedSpans(msg, analysis, null);
  assertEquals(both.map((s) => [msg.slice(s.start, s.end), s.kind]), [["I will hurt you", "threat"], [
    "worthless piece of dirt",
    "abuse",
  ]]);
  assertEquals(refusalHeadline(both), "Parts of this read as threatening and abusive.");
  assertEquals(refusalCounts(both), { threat: 1, abuse: 1 });
  assertEquals(refusalHeadline(both.slice(0, 1)), "One part reads as threatening.");
  assertEquals(refusalHeadline(both.slice(1)), "One part reads as abusive.");
  assertEquals(refusalHeadline([]), null);
  assertEquals(refusalCounts([]), { threat: 0, abuse: 0 });
  const t = both[0], a = both[1];
  assertEquals(refusalHeadline([t, { ...t, start: 30, end: 40 }]), "Two parts read as threatening.");
  assertEquals(refusalHeadline([a, { ...a, start: 30, end: 40 }]), "Two parts read as abusive.");
  assertEquals(
    refusalHeadline([t, { ...t, start: 30, end: 40 }, { ...t, start: 50, end: 60 }]),
    "Parts of this read as threatening.",
  );
  assertEquals(refusal(both.slice(0, 1)), {
    spans: both.slice(0, 1),
    headline: "One part reads as threatening.",
    counts: { threat: 1, abuse: 0 },
  });
  // overlapping spans merge, and a threat wins the merged kind
  const merged = flaggedSpans(msg, analysis, floor);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].kind, "threat");
  assertEquals(merged[0].start, 0);
  assertEquals(flaggedSpans("Please just call me back.", null, floorSafety("Please just call me back.")), []);
});

Deno.test("DV-16 POST /bridge/insight takes an optional integer seq and echoes it; a bad seq is invalid", async () => {
  const { insightSeq } = await import("../api/bridge_engine.ts");
  requireOnlyInsightFields({ person_id: "nami", text: "hi", seq: 7 });
  assertEquals(insightSeq({ seq: 7 }), 7);
  assertEquals(insightSeq({}), null);
  for (const bad of [-1, 1.5, "7", 2_147_483_648, true]) {
    const error = assertThrows(() => requireOnlyInsightFields({ person_id: "nami", text: "hi", seq: bad }), ApiError);
    assertEquals(error.code, "invalid");
  }
});

Deno.test("DV-16 the live insight trace keeps no words of the draft", async () => {
  const { redactTalkExchange } = await import("../engine/talk/redact.ts");
  const draft = "You always change plans last minute, so thanks for that.";
  const e = await redactTalkExchange({
    purpose: "analyse",
    request: { model: "claude-haiku-5-5", system: "sys", messages: [{ role: "user", content: draft }], maxTokens: 1500 },
    rawResponse: `{"frictions":[{"quote":"always"}]}`,
    usage: { inputTokens: 1340, outputTokens: 330, cents: 1 },
  // deno-lint-ignore no-explicit-any
  } as any);
  const stored = JSON.stringify(e);
  for (const w of ["always", "plans", "thanks"]) assertEquals(stored.includes(w), false, w);
  assertEquals(e.usage.cents, 1);
});
