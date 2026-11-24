import { assert, assertEquals } from "jsr:@std/assert@1";
import { canSteer, comfortForTurn, gapsForGuide, median } from "../engine/talk/comfort.ts";
import { type GuideGap, rankGuideGaps } from "../engine/talk/gaps.ts";

const NOW = new Date("2026-11-19T00:00:00Z");

Deno.test("guide gaps are missing, partly confirmed, or six months old; recent Bridge use leads", () => {
  const gaps = rankGuideGaps({
    confirmed: [
      { kind: "how_i_mean", rating: "very_me", confirmedAt: "2026-11-01T00:00:00Z" },
      { kind: "feels_like_care", rating: "partly", confirmedAt: "2026-11-01T00:00:00Z" },
      { kind: "bring_up", rating: "very_me", confirmedAt: "2026-05-19T00:00:00Z" },
    ],
    recentDraftKinds: ["coming_back", "bring_up"],
    now: NOW,
  });
  assertEquals(gaps.map((g) => [g.kind, g.reason]), [
    ["coming_back", "missing"],
    ["bring_up", "stale"],
    ["feels_like_care", "partly"],
    ["gets_heated", "missing"],
    ["matters", "missing"],
  ]);
});

Deno.test("guide gaps never offer sensitive, declined, or kept-private kinds", () => {
  const gaps = rankGuideGaps({
    confirmed: [],
    avoid: ["gets_heated", "lands_hard", "this_week"],
    recentDraftKinds: ["gets_heated", "lands_hard", "this_week"],
    now: NOW,
  });
  assert(!gaps.some((g) => ["gets_heated", "lands_hard", "this_week"].includes(g.kind)));
  // The two sensitive kinds are deliberately not guide-gap kinds: the guide only receives
  // the six Bridge grounding kinds, while a raised sensitive topic remains listener-led.
  assertEquals(rankGuideGaps({ confirmed: [], raisedThisSession: ["lands_hard"], now: NOW }).length, 6);
});

Deno.test("comfort: personal short-answer run, deflections, decline, safety and sensitive disclosure", () => {
  assertEquals(median([10, 30, 20, 40]), 25);
  assertEquals(
    comfortForTurn({ text: "tiny" }, { priorAnswerLengths: [100, 120], priorWasShort: false }).state,
    "ok",
  );
  assertEquals(
    comfortForTurn({ text: "tiny" }, { priorAnswerLengths: [100, 120], priorWasShort: true }).state,
    "easing",
  );
  assertEquals(comfortForTurn({ text: "Anyway, it is fine." }, { priorAnswerLengths: [] }).state, "easing");
  const decline = comfortForTurn({ text: "I'd rather not talk about that." }, { priorAnswerLengths: [] });
  assertEquals([decline.state, decline.avoidTopic], ["follow_only", true]);
  assertEquals(
    comfortForTurn({ text: "More words", safetyOrSensitive: true }, { priorAnswerLengths: [] }).state,
    "follow_only",
  );
  assertEquals(
    comfortForTurn({ text: "More words", alreadyFollowOnly: true }, { priorAnswerLengths: [] }).state,
    "follow_only",
  );
});

Deno.test("comfort guard sends no gap until turn three, on any easing/follow-only turn, or over steer budget", () => {
  const gap: GuideGap[] = [{ kind: "how_i_mean", reason: "missing" }];
  for (const comfort of ["easing", "follow_only"] as const) {
    assertEquals(gapsForGuide({ comfort, personTurn: 3, recentSteeredTurns: [], gaps: gap }), []);
  }
  assertEquals(gapsForGuide({ comfort: "ok", personTurn: 1, recentSteeredTurns: [], gaps: gap }), []);
  assertEquals(gapsForGuide({ comfort: "ok", personTurn: 2, recentSteeredTurns: [], gaps: gap }), []);
  assertEquals(
    gapsForGuide({ comfort: "ok", personTurn: 3, recentSteeredTurns: [false, true], gaps: gap }),
    [],
  );
  assertEquals(canSteer([true, false]), false);
  assertEquals(
    gapsForGuide({ comfort: "ok", personTurn: 3, recentSteeredTurns: [false, false], gaps: gap }),
    gap,
  );
});
