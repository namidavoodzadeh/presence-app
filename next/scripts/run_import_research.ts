// R13 research runner: fictional inputs only, through the production import stages and shared ledger.

import { harnessLedger } from "../api/lib/ledger.ts";
import { runImportStages } from "../engine/import_ai.ts";
import { AnthropicClient, CappedModelClient, loadProtectedConfig, rateNote } from "../engine/model/client.ts";

const MODEL = "claude-haiku-5-5";
const DEFAULT_CAP_CENTS = 200;

interface FictionalImport {
  id: string;
  fictional: true;
  owner_first_name: string;
  text?: string;
  source_path?: string;
}

function usage(exchanges: Awaited<ReturnType<typeof runImportStages>>["exchanges"]) {
  return exchanges.map((exchange) => ({
    purpose: exchange.purpose,
    model: exchange.usage.model,
    input_tokens: exchange.usage.inputTokens,
    output_tokens: exchange.usage.outputTokens,
    cents: exchange.usage.cents,
    error: exchange.error ?? null,
  }));
}

if (
  ![3, 5].includes(Deno.args.length) || Deno.args[0] !== "--disclosed-provider" ||
  Deno.args[1] !== "anthropic" ||
  (Deno.args.length === 5 && Deno.args[3] !== "--cap-cents")
) {
  throw new Error(
    "usage: run_import_research.ts --disclosed-provider anthropic <fictional-inputs.json> [--cap-cents <cents>]",
  );
}

const fixtures = JSON.parse(await Deno.readTextFile(Deno.args[2])) as FictionalImport[];
const capCents = Deno.args.length === 5 ? Number(Deno.args[4]) : DEFAULT_CAP_CENTS;
if (
  !Array.isArray(fixtures) || fixtures.length !== 5 ||
  !Number.isInteger(capCents) || capCents < 1 || capCents > DEFAULT_CAP_CENTS ||
  fixtures.some((fixture) =>
    fixture.fictional !== true || !fixture.id || !fixture.owner_first_name ||
    (typeof fixture.text !== "string" && typeof fixture.source_path !== "string") ||
    (typeof fixture.text === "string" && typeof fixture.source_path === "string")
  )
) {
  throw new Error("research input must contain exactly five explicitly fictional answers");
}
for (const fixture of fixtures) {
  if (fixture.source_path) fixture.text = await Deno.readTextFile(fixture.source_path);
  if (!fixture.text?.trim()) throw new Error(`empty fictional answer: ${fixture.id}`);
}

const ledger = await harnessLedger();
const ledgerBefore = await ledger.snapshot();
const client = new CappedModelClient(
  new AnthropicClient({
    config: await loadProtectedConfig(),
    ledger,
    defaultModel: MODEL,
    fallbackModel: null,
    thinking: "disabled",
    timeoutMs: 30_000,
  }),
  capCents,
  MODEL,
);

const results = [];
for (const fixture of fixtures) {
  const stages = await runImportStages(client, fixture.text!, fixture.owner_first_name);
  if (stages.exchanges.some((exchange) => exchange.error)) {
    throw new Error(`provider or ledger failure on ${fixture.id}`);
  }
  results.push({
    id: fixture.id,
    fictional: true,
    risk: stages.risk,
    cards: stages.guesses.map(({ id: _id, ...guess }) => guess),
    usage: usage(stages.exchanges),
    cents: stages.exchanges.reduce((sum, exchange) => sum + exchange.usage.cents, 0),
  });
}

console.log(JSON.stringify(
  {
    provider_disclosure: { provider: "anthropic", disclosed_at: new Date().toISOString() },
    model: MODEL,
    cap_cents: capCents,
    spent_cents: client.spent,
    ledger_before: ledgerBefore,
    ledger_after: await ledger.snapshot(),
    rate_note: rateNote(MODEL),
    results,
  },
  null,
  2,
));
