import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { formatScore, loadScore, scoreCases } from "../evals/bridge/w3-3-v1/score.ts";

const ROOT = new URL("../", import.meta.url);
const EVAL = new URL("evals/bridge/w3-3-v1/", ROOT);

Deno.test("W3.3 source is the unchanged 20-case HQ v1 bank and law 8 adds six fictional positives", async () => {
  const bytes = await Deno.readFile(new URL("cases.json", EVAL));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  assertEquals(sha, "8edcd8b91cf1a1d481bf2ad542a7684aa500d16fb269f864de3ac747aaa5041c");

  const source = JSON.parse(new TextDecoder().decode(bytes));
  const positives = JSON.parse(await Deno.readTextFile(new URL("positive_safety_cases.json", EVAL)));
  assertEquals(source.cases.length, 20);
  assertEquals(positives.cases.length, 6);
  assertEquals(positives.cases.every((item: { kind: string }) => item.kind === "positive_safety"), true);
});

Deno.test("W3.3 scorer locks case, kind, and per-rule counts for the mocked replay", async () => {
  const score = await loadScore();
  assertEquals(score, {
    cases: { passed: 26, total: 26 },
    kinds: {
      blame_frame: { passed: 12, total: 12 },
      negative_crisis: { passed: 8, total: 8 },
      positive_safety: { passed: 6, total: 6 },
    },
    rules: {
      B1: { passed: 12, total: 12 },
      B2: { passed: 12, total: 12 },
      B3: { passed: 12, total: 12 },
      B4: { passed: 12, total: 12 },
      B5: { passed: 12, total: 12 },
      C1: { passed: 8, total: 8 },
      C2: { passed: 8, total: 8 },
      C3: { passed: 8, total: 8 },
      S1: { passed: 6, total: 6 },
      S2: { passed: 6, total: 6 },
      S3: { passed: 6, total: 6 },
    },
  });
  const printed = formatScore(score);
  assertStringIncludes(printed, "rule B1 12/12");
  assertStringIncludes(printed, "rule C3 8/8");
  assertStringIncludes(printed, "rule S3 6/6");
});

Deno.test("W3.3 scorer refuses missing or extra binary decisions", async () => {
  const cases = [{ id: "one", kind: "test", rubric: ["B1 first", "B2 second"] }];
  await assertRejects(
    () => Promise.resolve().then(() => scoreCases(cases, [{ id: "one", criteria: { B1: true } }])),
    Error,
    "missing [B2]",
  );
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        scoreCases(cases, [{ id: "one", criteria: { B1: true, B2: true, B3: true } }])
      ),
    Error,
    "extra [B3]",
  );
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        scoreCases(cases, [{
          id: "one",
          criteria: { B1: true, B2: "yes" } as unknown as Record<string, boolean>,
        }])
      ),
    Error,
    "not binary: B2",
  );
});
