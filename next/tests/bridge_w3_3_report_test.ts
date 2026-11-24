import assert from "node:assert/strict";
import {
  buildReport,
  formatReportMarkdown,
  reportPaths,
  writeReport,
} from "../evals/bridge/w3-3-v1/score.ts";

// Recorded fixtures only: the checked-in mocked replay, and copies of it with flipped decisions.
const EVAL = new URL("../evals/bridge/w3-3-v1/", import.meta.url);
const RECORDED = new URL("mocked_outputs.json", EVAL);

interface Recorded {
  mode: string;
  at: string;
  outputs: { id: string; criteria: Record<string, boolean> }[];
}

async function recordedWithFailures(flips: Record<string, string[]>): Promise<URL> {
  const recorded = JSON.parse(await Deno.readTextFile(RECORDED)) as Recorded;
  for (const output of recorded.outputs) {
    for (const rule of flips[output.id] ?? []) output.criteria[rule] = false;
  }
  const dir = await Deno.makeTempDir({ prefix: "bridge-w3-report-" });
  const url = new URL(`file://${dir}/flipped_outputs.json`);
  await Deno.writeTextFile(url, JSON.stringify(recorded));
  return url;
}

Deno.test("W3.2 report on the recorded mocked replay passes with full B1-B5 and C1-C3 counts", async () => {
  const report = await buildReport(RECORDED);
  assert.equal(report.mode, "mocked");
  assert.equal(report.outputs, "mocked_outputs.json");
  for (const rule of ["B1", "B2", "B3", "B4", "B5"]) {
    assert.deepEqual(report.score.rules[rule], { passed: 12, total: 12 });
  }
  for (const rule of ["C1", "C2", "C3"]) assert.deepEqual(report.score.rules[rule], { passed: 8, total: 8 });
  assert.deepEqual(report.failures, []);
  assert.equal(report.verdict.pass, true);
  assert.deepEqual(report.verdict.kinds.map((k) => [k.kind, k.met]), [
    ["blame_frame", true],
    ["negative_crisis", true],
    ["positive_safety", true],
  ]);
});

Deno.test("W3.2 report lists failed case ids and fails the verdict", async () => {
  const outputs = await recordedWithFailures({ bp03: ["B1", "B4"], nc05: ["C2"] });
  const report = await buildReport(outputs);
  assert.deepEqual(report.failures, [
    { id: "bp03", kind: "blame_frame", failed: ["B1", "B4"] },
    { id: "nc05", kind: "negative_crisis", failed: ["C2"] },
  ]);
  assert.deepEqual(report.score.rules.B1, { passed: 11, total: 12 });
  assert.deepEqual(report.score.rules.C2, { passed: 7, total: 8 });
  assert.equal(report.verdict.pass, false);
  assert.deepEqual(report.verdict.kinds.map((k) => [k.kind, k.met]), [
    ["blame_frame", false],
    ["negative_crisis", false],
    ["positive_safety", true],
  ]);

  const md = formatReportMarkdown(report);
  assert.match(md, /\| B1 \| 11 \| 12 \|/);
  assert.match(md, /\| C2 \| 7 \| 8 \|/);
  assert.match(md, /- bp03 \(blame_frame\): B1, B4/);
  assert.match(md, /- nc05 \(negative_crisis\): C2/);
  assert.match(md, /## Verdict: FAIL/);
});

Deno.test("W3.2 a missed safety stop alone fails the verdict", async () => {
  const report = await buildReport(await recordedWithFailures({ ps02: ["S1"] }));
  assert.equal(report.verdict.pass, false);
  assert.deepEqual(report.failures.map((f) => f.id), ["ps02"]);
});

Deno.test("W3.2 writeReport puts JSON and markdown next to the run", async () => {
  const outputs = await recordedWithFailures({ bp07: ["B5"] });
  const { json, md } = await writeReport(outputs);
  assert.deepEqual([json.href, md.href], [reportPaths(outputs).json.href, reportPaths(outputs).md.href]);
  assert.equal(json.href, outputs.href.replace(/flipped_outputs\.json$/, "flipped_outputs.report.json"));
  const written = JSON.parse(await Deno.readTextFile(json));
  assert.equal(written.verdict.pass, false);
  assert.deepEqual(written.failures, [{ id: "bp07", kind: "blame_frame", failed: ["B5"] }]);
  assert.match(await Deno.readTextFile(md), /- bp07 \(blame_frame\): B5/);
});
