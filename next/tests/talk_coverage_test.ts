// CPO spec d-coo-talk-coverage-05nov: the Talk coverage director picks a target area from RATED beliefs only, never
// mid-thread over the person's own topic, never under heavy load, and never leaks its mechanism to the writer or the
// person. Fixtures are mocked; $0.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  AREAS,
  areaCoverage,
  areaFor,
  BODY_GAP_TOPICS,
  coverageTarget,
  foundationCoverage,
  gapOrder,
  writerInputLeaksMechanism,
  writerTargetLine,
} from "../engine/talk/coverage.ts";
import { echoesWaitingGuess, longestSharedRun, runChecks } from "../engine/talk/checks.ts";
import type { Belief, PersonMap } from "../engine/types.ts";

let n = 0;
function rated(domains: Belief["domains"], level: Belief["level"], status: Belief["status"] = "endorsed"): Belief {
  n++;
  return {
    id: `b${n}`, label: `Belief ${n}`, statement: "A gentle statement.", type: "something I believe is true",
    level, domains, confidence: 0.8, receipts: [], links: [], status,
  };
}

Deno.test("areaFor folds self onto the other domain, and alone onto meaning (CONTRACT §1.3)", () => {
  assertEquals(areaFor(["self", "work"]), "work");
  assertEquals(areaFor(["self"]), "meaning");
  assertEquals(areaFor(["close_relationships"]), "relationships");
  assertEquals(areaFor(["society"]), "politics");
});

Deno.test("areaCoverage counts only endorsed or disputed beliefs; inferred (waiting) guesses never count", () => {
  const beliefs: Belief[] = [
    rated(["family"], "L1", "endorsed"),
    rated(["family"], "L0", "inferred"), // still in the tray: must not count
  ];
  const cov = areaCoverage(beliefs);
  const family = cov.find((c) => c.area === "family")!;
  assertEquals(family.ratedCount, 1);
  assertEquals(family.hasL0, false, "the only L0 beliefs is still inferred, so no core yet");
  assertEquals(family.bucket, "thin");
});

Deno.test("gap order: zero rated leads, then 1-2, then 3+ with no L0; covered areas drop off the list", () => {
  const beliefs: Belief[] = [
    rated(["work"], "L1"), rated(["work"], "L1"), rated(["work"], "L1"), // 3+, no L0: no_core
    rated(["money"], "L0"), // 1, has L0: thin (not covered; thin still ranks before no_core)
  ];
  const order = gapOrder(areaCoverage(beliefs));
  assertEquals(order[0], "relationships", "an untouched area (0 rated) leads every other bucket");
  assert(order.indexOf("money") < order.indexOf("work"), "thin (1 rated) outranks 3+ with no L0 core");
});

// Done check (a): a work-heavy fixture with 0 rated family/body never targets Meaning, politics or morality.
Deno.test("done check (a): work-heavy fixture with 0 rated family/body opens into family or body, never meaning/politics/morality", () => {
  const beliefs: Belief[] = [
    rated(["work"], "L0"), rated(["work"], "L1"), rated(["work"], "L2"),
    rated(["meaning"], "L0"), rated(["politics"], "L1"), rated(["morality"], "L1"),
    rated(["close_relationships"], "L0"), rated(["money"], "L1"),
  ];
  const target = coverageTarget({ turnKind: "opener", heavyLoad: false, beliefs });
  assert(target === "family" || target === "body", `expected family or body, got ${target}`);
});

// Done check (f): docs/design/foundation-slots-20261105.md §3's 4th gap tier. Every area has an L0 core (so
// buckets a-c are all satisfied), but no L1/L2/L4 belief exists anywhere, so the "me"-lens foundation slots
// "my main rule", "my main strategy" and "my typical reaction" (rules/coping/reactions) stay empty; a me-lens
// area (work, body or money) must still come up as a target, ahead of a fully covered area.
Deno.test("done check (f): every area covered at L0 but empty me/others foundation slots still targets a slot", () => {
  const beliefs: Belief[] = AREAS.flatMap((area) => {
    const domain = ({
      relationships: "close_relationships", work: "work", body: "body_health", money: "money",
      meaning: "meaning", family: "family", politics: "politics", morality: "morality",
    } as const)[area];
    return [rated([domain], "L0"), rated([domain], "L0"), rated([domain], "L0")];
  });
  const slots = foundationCoverage(beliefs);
  assert(slots.some((s) => s.lens === "me" && !s.filled), "rules/coping/reactions never got an L1/L2/L4 belief");
  const coverage = areaCoverage(beliefs);
  assert(coverage.every((c) => c.ratedCount >= 3 && c.hasL0), "every area already has a full L0 core");
  assert(coverage.some((c) => c.bucket === "foundation_gap"), "a me-lens area is held back by its empty slot");
  const target = coverageTarget({ turnKind: "opener", heavyLoad: false, beliefs });
  assert(
    target === "work" || target === "body" || target === "money",
    `expected a me-lens area (work, body or money), got ${target}`,
  );
});

// Done check (d): the person's own topic always wins over a coverage pick, including mid-thread.
Deno.test("done check (d): the person's own topic area wins over the coverage pick", () => {
  const beliefs: Belief[] = []; // every area is empty, so coverage alone would pick the first gap
  const target = coverageTarget({ turnKind: "mid_thread", heavyLoad: false, ownTopicArea: "work", beliefs });
  assertEquals(target, "work");
});

// Done check (e): heavy load turns coverage off, even at the opener with every area empty.
Deno.test("done check (e): heavy load returns no coverage target", () => {
  const target = coverageTarget({ turnKind: "opener", heavyLoad: true, beliefs: [] });
  assertEquals(target, null);
});

Deno.test("mid-thread with no own topic defers to relevance and cost (no coverage target)", () => {
  const target = coverageTarget({ turnKind: "mid_thread", heavyLoad: false, beliefs: [] });
  assertEquals(target, null);
});

Deno.test("the body gap topics are exactly routines, energy, rest and movement", () => {
  assertEquals(BODY_GAP_TOPICS, ["routines", "energy", "rest", "movement"]);
});

Deno.test("writerTargetLine names only the area, never a mechanism word", () => {
  assertEquals(writerTargetLine("family"), "Target area: family");
  assertEquals(writerTargetLine(null), "");
  for (const area of AREAS) assert(!writerInputLeaksMechanism(writerTargetLine(area)));
});

// Done check (b): the writer's input never carries import text, guess text, or the words import/your AI/guess.
Deno.test("done check (b): writer input built from a coverage target never leaks import, guess or AI wording", () => {
  const line = writerTargetLine("family");
  assert(!writerInputLeaksMechanism(line));
  assert(!writerInputLeaksMechanism("Target area: body. Move: deepen. Load: light."));
  assert(writerInputLeaksMechanism("Your AI noticed a guess about family"), "the probe itself must catch the banned words");
});

// Done check (c), first clause: no question contains "do you believe" or "is it true".
Deno.test("done check (c): the belief-quiz guard catches 'do you believe' and 'is it true' phrasing", () => {
  const map: PersonMap = { beliefs: [], consent: {}, openThreads: [] };
  const base = {
    risk: { level: "none" as const, reason: "" },
    reflection: "You mentioned the morning routine felt rushed again.",
    move: { kind: "follow" as const, why: "", gap: "" },
    permissionDomain: null, beliefs: [],
  };
  const leading = runChecks({ ...base, question: "Do you believe you deserve rest in the mornings?" }, [], map);
  assert(leading.checks.find((c) => c.name === "infer_not_ask" && !c.ok), "do you believe must fail infer_not_ask");
  const leading2 = runChecks({ ...base, question: "Is it true that mornings feel rushed to you?" }, [], map);
  assert(leading2.checks.find((c) => c.name === "infer_not_ask" && !c.ok), "is it true must fail infer_not_ask");
  const clean = runChecks({ ...base, question: "What usually happens right after you wake up?" }, [], map);
  assert(clean.checks.find((c) => c.name === "infer_not_ask" && c.ok));
});

// Done check (c), second clause: a question never shares four or more consecutive words with a waiting guess.
Deno.test("done check (c): a question sharing 4+ consecutive words with a waiting guess is caught", () => {
  const waiting = ["Part of you feels you have to earn rest before you take it."];
  const echoing = "Do mornings feel like you have to earn rest before you take it?";
  assert(echoesWaitingGuess(echoing, waiting));
  const fine = "What usually happens right after you wake up on a weekday?";
  assert(!echoesWaitingGuess(fine, waiting));
  assertEquals(longestSharedRun("you have to earn rest", "you have to earn rest"), 5);
});
