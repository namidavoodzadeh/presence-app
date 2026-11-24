// $0 tests for Mirror's pure pieces: the gate (3 / 0.7 / 2 / 3, near-identical submissions counted once), the observation
// reader with its de-identifying floor, the synthesis guard (no quote, no name, no relationship, no count, no verdict), the slug
// and the contributor key.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { decide, dedupe, GATE } from "../engine/mirror/gate.ts";
import {
  deidentify,
  momentInPackage,
  observePackage,
  readObserved,
  redactMoment,
  weightFor,
} from "../engine/mirror/observe.ts";
import { longestCopiedRun, readSynthesis, synthesisProblems } from "../engine/mirror/synthesise.ts";
import type { GateInput, Observation } from "../engine/mirror/types.ts";
import { blockedPerspectiveObjects, contributorKey, newSlug, partitionHeld } from "../api/mirror.ts";

const obs = (behaviour: string, situation = "a plan changed"): Observation => ({
  situation,
  behaviour,
  reaction: "the evening went quiet",
  guess: null,
  domains: ["close_relationships"],
});
const input = (
  id: string,
  who: string,
  theme: string | null,
  conf: number,
  extra: Partial<GateInput> = {},
): GateInput => ({
  id,
  contributorKey: who,
  weight: 1,
  themeKey: theme,
  themeConfidence: conf,
  observation: obs(`went quiet ${"abcdefghij"[Number(id)]}`),
  mapBeliefId: null,
  mapRelation: null,
  mapConfidence: 0,
  ...extra,
});

Deno.test("B-Q10: blocked perspectives expose one card id and label, never contributor details or counts", () => {
  const blocked = blockedPerspectiveObjects([
    {
      id: "secret-row-1",
      perspective_id: "p2",
      contributor_key: "secret-key-a",
      contributor_name: "Marta",
      people_count: 4,
      perspective: { label: "Keeps an exit", statement: "private summary" },
    },
    {
      id: "secret-row-2",
      perspective_id: "p2",
      contributor_key: "secret-key-b",
      perspective: { label: "Keeps an exit" },
    },
    { perspective_id: "p1", contributor_key: "secret-key-c", perspective: [{ label: "Goes quiet" }] },
  ]);
  assertEquals(blocked, [{ id: "p1", label: "Goes quiet" }, { id: "p2", label: "Keeps an exit" }]);
  assertEquals(Object.keys(blocked[0]), ["id", "label"]);
  assert(!JSON.stringify(blocked).includes("secret"));
  assert(!JSON.stringify(blocked).includes("Marta"));
  assert(!JSON.stringify(blocked).includes("people"));
});

Deno.test("gate: a new theme surfaces at three distinct people with mean confidence 0.7; two people or lower confidence hold", () => {
  assertEquals(decide([input("1", "a", "t1", 0.8), input("2", "b", "t1", 0.8)]), []); // two people
  assertEquals(
    decide([input("1", "a", "t1", 0.8), input("2", "b", "t1", 0.8), input("3", "a", "t1", 0.9)]),
    [],
  ); // three moments, two people
  assertEquals(
    decide([input("1", "a", "t1", 0.6), input("2", "b", "t1", 0.6), input("3", "c", "t1", 0.7)]),
    [],
  ); // mean 0.63
  const d = decide([
    input("1", "a", "t1", 0.8),
    input("2", "b", "t1", 0.7),
    input("3", "c", "t1", 0.7),
    input("4", "a", "t1", 0.9),
  ]);
  assertEquals(d.length, 1);
  assertEquals([d[0].variant, d[0].themeKey, d[0].people, d[0].moments, d[0].confidence], [
    "new",
    "t1",
    3,
    4,
    0.78,
  ]);
  assertEquals(GATE, { newPeople: 3, confidence: 0.7, supportPeople: 2, tensionPeople: 3 });
});

Deno.test("gate: support for a map belief needs two people, a different view needs three; the weight of 'other' lowers the mean", () => {
  const sup = (id: string, who: string, conf = 0.8, weight = 1) =>
    input(id, who, null, 0, { mapBeliefId: "b1", mapRelation: "supports", mapConfidence: conf, weight });
  assertEquals(decide([sup("1", "a")]), []);
  const d = decide([sup("1", "a"), sup("2", "b")]);
  assertEquals([d[0].variant, d[0].beliefId, d[0].people], ["support", "b1", 2]);
  const ten = (id: string, who: string) =>
    input(id, who, null, 0, { mapBeliefId: "b1", mapRelation: "contradicts", mapConfidence: 0.8 });
  assertEquals(decide([ten("1", "a"), ten("2", "b")]), []);
  assertEquals(decide([ten("1", "a"), ten("2", "b"), ten("3", "c")])[0].variant, "tension");
  assertEquals(decide([sup("1", "a", 0.7, 0.8), sup("2", "b", 0.65, 1)]), []); // weighted mean 0.67
  assertEquals(weightFor("other"), 0.8);
  assertEquals(weightFor("partner"), 1);
});

Deno.test("gate: near-identical submissions from one person count once", () => {
  const a = input("1", "a", "t1", 0.9),
    same = { ...input("2", "a", "t1", 0.9), observation: obs("went quiet b") };
  assertEquals(dedupe([a, same]).length, 1);
  assertEquals(decide([a, same, input("3", "b", "t1", 0.9), input("4", "c", "t1", 0.9)])[0].moments, 3);
});

Deno.test("deidentify: names, handles and numbers go; the owner's name, sentence starts and plain words stay", () => {
  assertEquals(
    deidentify("At Lea's birthday in Berlin on 12 May, Nami went quiet when Marco changed the plan.", "Nami"),
    "At someone's birthday in someone on some someone, Nami went quiet when someone changed the plan.",
  );
  assertEquals(
    deidentify(
      "They went quiet. Later Nami said it was fine to a friend, email me at x@y.com or @nami.",
      "Nami",
    ),
    "They went quiet. Later Nami said it was fine to a friend, email me at someone or someone.",
  );
});

Deno.test("readObserved: a moment keeps its de-identified observation, theme (existing key or null) and map match; a label keeps nothing", () => {
  const raw = JSON.stringify({
    kind: "moment",
    safety: { level: "none", reason: "" },
    observation: {
      situation: "friends cancelled dinner with Marta",
      behaviour: "went quiet and kept cooking",
      reaction: "said it was fine",
      guess: null,
      domains: ["close_relationships"],
    },
    theme: {
      key: "t_abc",
      label: "Goes quiet",
      statement: "Part of you may go quiet when a plan changes on you.",
      type: "how I tend to react",
      confidence: 0.8,
    },
    map: { belief_id: "b1", relation: "supports", confidence: 0.6 },
  });
  const { observed, problems } = readObserved(raw, "Nami", ["t_abc"], ["b1"]);
  assertEquals(problems, []);
  assertEquals(observed!.observation!.situation, "friends cancelled dinner with someone");
  assertEquals(observed!.theme!.key, "t_abc");
  assertEquals(observed!.map, { beliefId: "b1", relation: "supports", confidence: 0.6 });
  const unknownKey = readObserved(raw.replace("t_abc", "t_zzz"), "Nami", ["t_abc"], []).observed!;
  assertEquals(unknownKey.theme!.key, null);
  assertEquals(unknownKey.map, null); // unknown key → new theme; unknown belief → no match
  const label = readObserved(JSON.stringify({ kind: "label", safety: { level: "none" } }), "Nami", [], [])
    .observed!;
  assertEquals([label.kind, label.observation, label.theme], ["label", null, null]);
  const concern = readObserved(
    JSON.stringify({
      kind: "moment",
      safety: { level: "concern", reason: "mentions wanting to disappear" },
      observation: { behaviour: "x" },
    }),
    "Nami",
    [],
    [],
  ).observed!;
  assertEquals([concern.safety.level, concern.observation], ["concern", null]);
  const bad = readObserved(
    JSON.stringify({
      kind: "moment",
      safety: { level: "none" },
      observation: { behaviour: "went quiet", domains: [] },
      theme: {
        label: "Selfish and quiet all the time",
        statement: "You are toxic.",
        type: "x",
        confidence: 0.9,
      },
    }),
    "Nami",
    [],
    [],
  );
  assert(
    bad.problems.some((p) => p.startsWith("theme words")) &&
      bad.problems.includes("theme label over four words"),
  );
  assertEquals(bad.observed!.observation!.domains, ["close_relationships"]);
  assertEquals(readObserved("not json", "Nami", [], []).observed, null);
});

Deno.test("synthesis guard: a clean card passes; quotes, names, relationships, counts, verdicts and advice do not", () => {
  const observations = [
    obs("went quiet and kept cooking for the rest of the evening"),
    obs("went very quiet in the car and barely spoke at the table"),
  ];
  const ok = readSynthesis(
    JSON.stringify({
      label: "Goes quiet",
      statement:
        "People who know you describe you going quiet when a plan changes on you at the last minute.",
      type: "how I tend to react",
      domains: ["close_relationships"],
      summary:
        "People who know you describe the same shape: a plan moves late, you say it's fine, and then you go quiet for the rest of the evening.",
    }),
  )!;
  assertEquals(synthesisProblems(ok, "Nami", observations), []);
  assertEquals(
    longestCopiedRun("went quiet and kept cooking for the rest of the evening, they say", observations),
    11,
  );
  const quote = { ...ok, summary: "One moment: he went quiet and kept cooking for the rest of the evening." };
  assert(synthesisProblems(quote, "Nami", observations).some((p) => p.includes("copies a run")));
  assert(
    synthesisProblems(
      { ...ok, summary: "Your partner and Marco both describe you going quiet." },
      "Nami",
      observations,
    ).some((p) => p.includes("relationship")),
  );
  assert(
    synthesisProblems({ ...ok, summary: "Lately Marco describes you going quiet." }, "Nami", observations)
      .some((p) => p.startsWith("names: Marco")),
  );
  assert(
    synthesisProblems({ ...ok, summary: "4 people describe you going quiet." }, "Nami", observations).some((
      p,
    ) => p.includes("counts")),
  );
  assert(
    synthesisProblems({ ...ok, statement: "You are stubborn and should speak up." }, "Nami", observations)
      .some((p) => p.startsWith("words:")),
  );
  assert(
    synthesisProblems({ ...ok, label: "Goes quiet when plans change late" }, "Nami", observations).some((p) =>
      p.startsWith("label")
    ),
  );
  assert(
    synthesisProblems({ ...ok, statement: "Part of them goes quiet." }, "Nami", observations).includes(
      "statement not in the second person",
    ),
  );
  assertEquals(readSynthesis("{}")!.type, "how I tend to react");
});

Deno.test("slug and contributor key: unambiguous alphabet, stable hash that differs per owner", async () => {
  const s = newSlug();
  assertEquals(s.length, 10);
  assert(/^[abcdefghjkmnpqrstuvwxyz23456789]+$/.test(s));
  assert(newSlug() !== s);
  const k1 = await contributorKey("owner-a", "uid-1"), k2 = await contributorKey("owner-b", "uid-1");
  assertEquals(k1.length, 64);
  assert(k1 !== k2);
  assertEquals(k1, await contributorKey("owner-a", "uid-1"));
});

Deno.test("partitionHeld: a held moment on a theme that already surfaced joins it; the rest face the gate", () => {
  const held = [{ id: "1", themeKey: "t_old" }, { id: "2", themeKey: "t_new" }, { id: "3", themeKey: null }, {
    id: "4",
    themeKey: "t_old",
  }];
  const { joining, gated } = partitionHeld(held, new Set(["t_old"]));
  assertEquals([...joining.keys()], ["t_old"]);
  assertEquals(joining.get("t_old")!.map((h) => h.id), ["1", "4"]);
  assertEquals(gated.map((h) => h.id), ["2", "3"]);
});

// ---- the web page (CDO build review 1, W01–W06) and the three prompts
import { composeMoment, HOW_LONG, PROMPTS } from "../api/mirror.ts";
import { mirrorPageHtml } from "../api/mirror_page.ts";

Deno.test("composeMoment: the three prompts become one moment for the listener, empty parts left out; a plain moment still passes", () => {
  assertEquals(
    composeMoment({ happening: "a dinner", did: "went quiet", mattered: "" }, "Nami"),
    "What was happening: a dinner\nWhat Nami did or said: went quiet",
  );
  assertEquals(
    composeMoment({ happening: " ", did: "said it was fine", mattered: "being counted on" }, "Nami"),
    "What Nami did or said: said it was fine\nWhat seemed to matter to Nami: being counted on",
  );
  assertEquals(composeMoment({ moment: "He went quiet.", did: "ignored" }, "Nami"), "He went quiet.");
  assertEquals(composeMoment({}, "Nami"), "");
  assertEquals(PROMPTS[2], "What seemed to matter to {name} there?"); // CPO 16:00 10-27 wording
  assertEquals(HOW_LONG.length, 3);
});

Deno.test("mirrorPageHtml: the owner's first name and prompts are on the page, escaped; the page carries no key but the anon key and no contributor's words", () => {
  const page = {
    open: true,
    reason: null,
    owner_name: "Na<mi>",
    who: "anyone",
    prompts: ["What was happening?", "What did Na<mi> do or say?", "What seemed to matter to Na<mi> there?"],
    how_known: ["partner", "friend", "family", "coworker", "other"],
    line: "x",
    preview: true,
    test_friends: [{ persona: "lea", name: "Lea" }],
  };
  const html = mirrorPageHtml(page, "cber97ta67", "/functions/v1/api", "anon-key-123");
  assert(html.startsWith("<!doctype html>"));
  assert(html.includes("Na&lt;mi&gt;") && !html.includes("<mi>")); // escaped in the markup
  assert(html.includes("noindex")); // reachable only by its link
  assert(html.includes("anon-key-123") && !html.includes("service_role"));
  assert(html.includes("Continue as a test friend") && html.includes("Continue with Apple"));
  assert(
    html.includes("Delete my answer") && html.includes("Add another moment") &&
      html.includes("has paused this link for now") && html.includes("This link no longer works") &&
      html.includes("will approve your request first"),
  );
  assert(html.includes("Can you think of one time you saw that? What happened?"));
  assert(!html.includes("</script><script>alert")); // the JSON island escapes <
  const closed = mirrorPageHtml(
    { ...page, open: false, reason: "paused", test_friends: [] },
    "s",
    "/api",
    "k",
  );
  assert(closed.includes('"open":false'));
});

Deno.test("redactMoment: the trace copy of the observe package keeps every section but the moment, which becomes its length and hash", async () => {
  const moment =
    "We had friends coming for dinner and one couple cancelled an hour before. Nami went quiet, kept cooking, and said it was fine.";
  const pkg = observePackage("Nami", "partner", moment, [], [{
    key: "t_abc",
    label: "Goes quiet",
    statement: "Part of you may go quiet.",
    count: 2,
  }]);
  assert(pkg.includes(moment));
  const out = await redactMoment(pkg, moment);
  assert(!out.includes("kept cooking") && !out.includes(moment));
  assert(out.includes(`[deleted once processed: ${moment.length} characters, sha256 `));
  assert(
    out.includes("# OWNER\nNami") && out.includes("# HOW THE CONTRIBUTOR KNOWS THEM\npartner") &&
      out.includes("# OPEN THEMES\n- t_abc (2 so far)"),
  );
  assertEquals(await redactMoment(pkg, moment), out); // deterministic: the same moment, the same hash
  assert(!(await redactMoment(pkg, "a different moment")).includes("kept cooking")); // block not found as built: nothing of the package is kept
  assert(
    (await redactMoment(pkg, "a different moment")).startsWith(
      "# THE MOMENT, AS WRITTEN\n[deleted once processed: 18 characters",
    ),
  );
});

Deno.test("momentInPackage: finds the moment as written in a stored package, and nothing once it was redacted (Q65 scrub)", async () => {
  const moment =
    "At the party someone asked about the move.\nNami changed the subject and said it was all fine.";
  const pkg = observePackage("Nami", "friend", moment, [], []);
  assertEquals(momentInPackage(pkg), moment); // a newline inside the moment is kept whole
  const redacted = await redactMoment(pkg, moment);
  assertEquals(momentInPackage(redacted), null); // already redacted: nothing to scrub
  assertEquals(await redactMoment(pkg, momentInPackage(pkg)!), redacted); // the scrub writes the very same placeholder
  assertEquals(momentInPackage("# OWNER\nNami\n"), null); // no block: null, never a guess
});

Deno.test("sre-08: the 18+ attestation is required when the flag is on, and the rate limits stop a flood before anything is stored", async () => {
  const { contributionGuard, MIRROR_LIMITS } = await import("../api/mirror.ts");
  const { ApiError, STATUS } = await import("../api/lib/errors.ts");
  const none = { contributorDay: 0, linkHour: 0 };
  contributionGuard({}, false, none); // preview: flag off, nothing required
  contributionGuard({ adult: true }, true, none);
  for (const body of [{}, { adult: false }, { adult: "true" }]) {
    try {
      contributionGuard(body, true, none);
      throw new Error("expected refusal");
    } catch (e) {
      assert(e instanceof ApiError);
      assertEquals(e.code, "forbidden");
      assertEquals(e.extra.reason, "adult_attestation");
    }
  }
  for (const counts of [{ contributorDay: MIRROR_LIMITS.perContributorPerDay, linkHour: 0 }, { contributorDay: 0, linkHour: MIRROR_LIMITS.perLinkPerHour }]) {
    try {
      contributionGuard({ adult: true }, true, counts);
      throw new Error("expected refusal");
    } catch (e) {
      assert(e instanceof ApiError);
      assertEquals(e.code, "rate_limited");
      assertEquals(STATUS[e.code], 429);
    }
  }
  contributionGuard({ adult: true }, true, { contributorDay: MIRROR_LIMITS.perContributorPerDay - 1, linkHour: MIRROR_LIMITS.perLinkPerHour - 1 });
});
