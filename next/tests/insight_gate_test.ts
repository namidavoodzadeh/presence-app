import { assertEquals } from "jsr:@std/assert@1";
import { runInsightGate } from "../../evals/insight/harness.ts";

Deno.test("insight gate: fixed fictional set passes against the conservative pipeline mock", async () => {
  const report = await runInsightGate("mock");
  assertEquals(report.total, 63);
  assertEquals(report.built, true);
  assertEquals(report.mustNever, 0);
  assertEquals(report.silentRate, 1);
  assertEquals(report.tiers, { 0: 63, 1: 0, 2: 0, 3: 0 });
});
