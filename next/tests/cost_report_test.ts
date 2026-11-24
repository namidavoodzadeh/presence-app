// Measured-cost-per-user (CEO d-coo-review-30oct D, item 1): every figure in COST-WEEKLY.md comes from logged
// `engine_calls` usage, priced against the in-code rate table, never from a separate billing API call.

import { assertEquals } from "jsr:@std/assert@1";
import { productOf, summarizeCalls } from "../scripts/cost_report.ts";

Deno.test("productOf: every known purpose maps to exactly one product; unknown purposes are Other", () => {
  assertEquals(productOf("turn"), "Talk");
  assertEquals(productOf("repair"), "Talk");
  assertEquals(productOf("finish"), "Talk");
  assertEquals(productOf("finish_repair"), "Talk");
  assertEquals(productOf("analyse"), "Bridge");
  assertEquals(productOf("rewrite_retry"), "Bridge");
  assertEquals(productOf("why_repair"), "Bridge");
  assertEquals(productOf("mirror_observe"), "Mirror");
  assertEquals(productOf("mirror_synthesise_repair"), "Mirror");
  assertEquals(productOf("sim_user"), "Other");
});

Deno.test("summarizeCalls: sums priced cents per product and computes cache hit rate from token counts", () => {
  const rows = [
    { purpose: "turn", cents: 3, input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    { purpose: "repair", cents: 2, input_tokens: 0, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 400 },
    { purpose: "analyse", cents: 5, input_tokens: 200, output_tokens: 30, cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
    { purpose: "mirror_observe", cents: 1, input_tokens: 0, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  ];
  const summary = summarizeCalls(rows);
  assertEquals(summary.totalCents, 11);
  assertEquals(summary.byProduct, { Talk: 5, Bridge: 5, Mirror: 1, Other: 0 });
  // cache-read 400 / (input 300 + cache-create 100 + cache-read 400) = 400/800
  assertEquals(summary.cacheHitRate, 0.5);
});

Deno.test("summarizeCalls: no rows means zero spend and a zero cache hit rate, never a divide-by-zero", () => {
  const summary = summarizeCalls([]);
  assertEquals(summary.totalCents, 0);
  assertEquals(summary.cacheHitRate, 0);
});

Deno.test("summarizeCalls: null cents and null token counts count as zero, never throw", () => {
  const summary = summarizeCalls([{ purpose: "turn", cents: null, input_tokens: null, output_tokens: null }]);
  assertEquals(summary.totalCents, 0);
  assertEquals(summary.byProduct.Talk, 0);
});
