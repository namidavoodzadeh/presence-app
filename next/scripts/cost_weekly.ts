// Friday cost report. Every figure comes from `engine_calls` rows: the provider's own usage block
// (input/output/cache tokens, model), priced at call time against the in-code rate table
// (next/engine/model/client.ts RATES_CENTS_PER_MILLION, confirmed 2026-10-26). No organization billing
// API call: the runtime credential cannot read it (Q74, 2026-10-30), and the COO's 2026-10-31 09:20 answer
// to Q74 asks for per-call measurement instead. The protected config loader supplies credentials without
// this script reading, printing, or persisting secret values; message content is never read here.
import { loadEnv } from "../api/lib/env.ts";
import { serviceClient } from "../api/lib/db.ts";
import { summarizeCalls, type CallUsageRow } from "./cost_report.ts";

type Row = Record<string, unknown>;
const output = Deno.args[0] ?? new URL("../../../../outputs/engine/COST-WEEKLY.md", import.meta.url).pathname;
const ending = new Date();
const starting = new Date(ending.getTime() - 7 * 24 * 60 * 60 * 1000);
const startIso = starting.toISOString();
const endIso = ending.toISOString();

const env = await loadEnv();
const db = serviceClient(env);
type SelectedQuery = ReturnType<ReturnType<typeof db.from>["select"]>;

async function rows(table: string, select: string, filters: (query: SelectedQuery) => SelectedQuery): Promise<Row[]> {
  const result = await filters(db.from(table).select(select));
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

const profiles = await rows(
  "profiles",
  "id,name,is_example,is_preview",
  (q) => q.or("is_example.eq.true,is_preview.eq.true"),
);
const internal = new Set(profiles.map((p) => String(p.id)));
const talkActions = await rows(
  "messages",
  "owner",
  (q) => q.eq("role", "me").gte("created_at", startIso).lt("created_at", endIso),
);
const bridgeActions = await rows(
  "bridges",
  "sender",
  (q) => q.gte("created_at", startIso).lt("created_at", endIso),
);
const mirrorActions = await rows(
  "mirror_contributions",
  "owner",
  (q) => q.gte("created_at", startIso).lt("created_at", endIso),
);
const calls = await rows(
  "engine_calls",
  "person,purpose,cents,input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens",
  (q) => q.gte("created_at", startIso).lt("created_at", endIso),
);

const active = new Set<string>();
for (const row of talkActions) if (internal.has(String(row.owner))) active.add(String(row.owner));
for (const row of bridgeActions) if (internal.has(String(row.sender))) active.add(String(row.sender));
for (const row of mirrorActions) if (internal.has(String(row.owner))) active.add(String(row.owner));

const internalCalls = calls.filter((row) => internal.has(String(row.person))) as unknown as CallUsageRow[];
const summary = summarizeCalls(internalCalls);
const measuredSpend = summary.totalCents / 100;
const monthlyPerActive = active.size ? measuredSpend / active.size * 52 / 12 : null;
const money = (value: number | null) => value === null ? "unavailable" : `$${value.toFixed(4)}`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

const report = [
  "# Hosted AI cost — trailing week",
  "",
  `Generated: ${ending.toISOString()} (Friday regeneration script: \`next/scripts/cost_weekly.ts\`)`,
  `Window: ${startIso} inclusive to ${endIso} exclusive`,
  "Scope: internal test profiles (`is_example` or `is_preview`). No organization billing API call: Q74, 2026-10-30" +
    " found no billing-read credential; every figure below is measured from logged `engine_calls` usage, priced" +
    " against the in-code rate table (next/engine/model/client.ts, confirmed 2026-10-26).",
  "",
  "| Figure | Value | Basis |",
  "|---|---:|---|",
  `| Active internal users | ${active.size} | measured — distinct internal profiles with at least one Talk message, sent Bridge, or received Mirror contribution |`,
  `| Hosted AI spend | ${
    money(measuredSpend)
  } | measured — sum of \`engine_calls.cents\` for internal profiles, each row priced from the provider's own usage block at call time |`,
  `| Cost per active user per month | ${
    money(monthlyPerActive)
  } | measured spend, projected — trailing-week measured spend × 52/12 ÷ active users |`,
  `| Talk spend | ${money(summary.byProduct.Talk / 100)} | measured — sum of \`engine_calls.cents\` where purpose is a Talk purpose |`,
  `| Bridge spend | ${
    money(summary.byProduct.Bridge / 100)
  } | measured — sum of \`engine_calls.cents\` where purpose is a Bridge purpose |`,
  `| Mirror spend | ${
    money(summary.byProduct.Mirror / 100)
  } | measured — sum of \`engine_calls.cents\` where purpose is a Mirror purpose |`,
  `| Cache hit rate | ${
    percent(summary.cacheHitRate)
  } | measured — cache-read tokens ÷ all input tokens on internal-account engine calls |`,
  "",
  `Internal engine calls: ${internalCalls.length}. Unclassified-purpose spend (not Talk/Bridge/Mirror): ${
    money(summary.byProduct.Other / 100)
  }.`,
  `Activity counts (events, not people): Talk ${talkActions.length}, Bridge ${bridgeActions.length}, Mirror ${mirrorActions.length}.`,
  "",
  "Limits: cost per active user per month is a projection from one trailing week, not a measured monthly total." +
    " A product action implies the app was opened; there is no separate open event in the hosted schema." +
    " If Anthropic's published per-model rates change, the rate table (and its confirmation date) must be updated" +
    " or every figure above drifts from billed reality even though the token counts stay measured.",
  "",
  "— Engine",
  "",
].join("\n");

await Deno.writeTextFile(output, report);
console.log(`wrote ${output}`);
console.log(`active=${active.size} spend=${money(measuredSpend)} (measured) cache=${percent(summary.cacheHitRate)}`);
