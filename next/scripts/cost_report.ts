// Pure math for the Friday cost report (next/scripts/cost_weekly.ts). No DB, no network: testable at $0.
// Every number here comes from `engine_calls` rows already priced at call time (client.ts usageCents, against
// RATES_CENTS_PER_MILLION) from the provider's own usage block — never from a separate billing API call.

export type Product = "Talk" | "Bridge" | "Mirror" | "Other";

export function productOf(purpose: string): Product {
  if (["turn", "repair", "finish", "finish_repair"].includes(purpose)) return "Talk";
  if (
    [
      "insight",
      "analyse",
      "analyse_repair",
      "rewrite",
      "rewrite_retry",
      "verify",
      "verify_retry",
      "reword",
      "reword_repair",
      "why",
      "why_repair",
    ].includes(purpose)
  ) return "Bridge";
  if (purpose.startsWith("mirror_")) return "Mirror";
  return "Other";
}

export interface CallUsageRow {
  purpose: string;
  cents: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface CostSummary {
  totalCents: number;
  byProduct: Record<Product, number>;
  cacheHitRate: number;
}

/** Sums already-priced rows (measured provider usage × the in-code rate table), never re-derives a price. */
export function summarizeCalls(rows: CallUsageRow[]): CostSummary {
  const byProduct: Record<Product, number> = { Talk: 0, Bridge: 0, Mirror: 0, Other: 0 };
  let totalCents = 0;
  let cacheRead = 0, cacheCreated = 0, uncached = 0;
  for (const row of rows) {
    const cents = Number(row.cents ?? 0);
    totalCents += cents;
    byProduct[productOf(row.purpose)] += cents;
    cacheRead += Number(row.cache_read_input_tokens ?? 0);
    cacheCreated += Number(row.cache_creation_input_tokens ?? 0);
    uncached += Number(row.input_tokens ?? 0);
  }
  const denominator = cacheRead + cacheCreated + uncached;
  return { totalCents, byProduct, cacheHitRate: denominator ? cacheRead / denominator : 0 };
}
