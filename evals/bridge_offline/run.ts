// Offline Bridge evaluation: frozen fictional inputs, direct engine calls, and
// a content-addressed response cache.  It intentionally has no HTTP,
// Supabase, account, or staging dependency.

import {
  analyse,
  gateActivatedLinks,
} from "../../next/engine/bridge/analyse.ts";
import { buildInsight } from "../../next/engine/bridge/insight.ts";
import {
  AnthropicClient,
  DEFAULT_MODEL,
  loadProtectedConfig,
} from "../../next/engine/model/client.ts";
import type {
  ModelClient,
  ModelRequest,
} from "../../next/engine/model/client.ts";
import type {
  Analysis,
  ReceiverBelief,
  Relationship,
} from "../../next/engine/bridge/types.ts";
import type { Belief, ModelExchange } from "../../next/engine/types.ts";
import { clinicalHits } from "../../next/engine/words.ts";
import { applyVariant, instructionFor } from "./variants.ts";
import type { VariantName } from "./variants.ts";

const ROOT = new URL("../../", import.meta.url);
const HERE = new URL("./", import.meta.url);
const DRAFTS = new URL("drafts_e2e.v2.json", HERE);
const CALIBRATION = new URL("judge_calibration.v2.json", HERE);
const MAPS = new URL("maps/", HERE);
const RESULTS = new URL("results/", HERE);
const CACHE = new URL("cache/", HERE);
interface FrozenMap {
  persona_id: string;
  first_name: string;
  beliefs: Belief[];
  shared_items: ReceiverBelief[];
}
interface DraftCase {
  id: string;
  text: string;
  frictions: string[];
  sender_belief: string;
  lands_on: string | null;
  expect: string;
  sender_meant: string;
}
interface Pair {
  sender_id: string;
  receiver_id: string;
  relationship: string;
  share_from_receiver: string[];
  drafts: DraftCase[];
}
interface Gold {
  schema_version: number;
  gold_version: string;
  pairs: Pair[];
}
interface Row {
  id: string;
  draft: string;
  gold: {
    frictions: string[];
    belief: string;
    receiver_reading: string | null;
    expect: string;
  };
  output: {
    frictions: string[];
    activated: string[];
    lands_on: string[];
    safety: string;
    note: string[];
  };
  flaw_caught: boolean;
  false_alarm: boolean;
  quiet_when_expected: boolean;
  belief_link_right: boolean;
  wrong_link: boolean;
  receiver_reading_match: boolean | null;
  law_failures: string[];
  error: string | null;
  attempts: number;
  cached_calls: number;
  live_calls: number;
}
interface Metrics {
  rows: number;
  flaw_caught: number;
  flaw_total: number;
  false_alarms: number;
  quiet: number;
  quiet_right: number;
  link_right: number;
  link_total: number;
  wrong_links: number;
  receiver_right: number;
  receiver_total: number;
  law_failures: number;
  errors: number;
}
interface KindMetric {
  kind: string;
  true_positive: number;
  false_positive: number;
  false_negative: number;
  precision: number | null;
  recall: number | null;
}

function args(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let index = 0; index < Deno.args.length; index++) {
    const item = Deno.args[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    out[key] = Deno.args[index + 1]?.startsWith("--") ||
        Deno.args[index + 1] === undefined
      ? true
      : Deno.args[++index];
  }
  return out;
}

function sha256(text: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((
    bytes,
  ) =>
    [...new Uint8Array(bytes)].map((value) =>
      value.toString(16).padStart(2, "0")
    ).join("")
  );
}

function cleanExchange(exchange: ModelExchange): ModelExchange {
  return { ...exchange, usage: { ...exchange.usage, cents: 0, ms: 0 } };
}

class CachedClient implements ModelClient {
  cached = 0;
  live = 0;
  constructor(
    private readonly inner: ModelClient,
    private readonly model: string,
    private readonly variant: VariantName,
  ) {}

  async complete(request: ModelRequest): Promise<ModelExchange> {
    const adjusted =
      request.purpose === "analyse" && this.variant !== "baseline"
        ? { ...request, system: request.system + instructionFor(this.variant) }
        : request;
    const key = await sha256(
      JSON.stringify({
        model: adjusted.model ?? this.model,
        system: adjusted.system,
        messages: adjusted.messages,
        maxTokens: adjusted.maxTokens,
      }),
    );
    const path = new URL(`${key}.json`, CACHE);
    try {
      const saved = JSON.parse(await Deno.readTextFile(path)) as {
        exchange: ModelExchange;
      };
      this.cached++;
      return cleanExchange(saved.exchange);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const exchange = await this.inner.complete(adjusted);
    this.live++;
    if (!exchange.error) {
      await Deno.mkdir(CACHE, { recursive: true });
      await Deno.writeTextFile(
        path,
        JSON.stringify({ key, exchange }, null, 2) + "\n",
      );
    }
    return exchange;
  }
}

async function loadMap(id: string): Promise<FrozenMap> {
  const value = JSON.parse(
    await Deno.readTextFile(new URL(`${id}.json`, MAPS)),
  ) as FrozenMap;
  if (value.persona_id !== id || !value.beliefs.length) {
    throw new Error(`invalid frozen map ${id}`);
  }
  return value;
}

function noteText(
  draft: string,
  analysis: Analysis,
  beliefs: Belief[],
): string[] {
  const insight = buildInsight(draft, analysis, beliefs, analysis.safety);
  return [
    ...insight.frictions.map((friction) => friction.howItLands),
    ...insight.touches.map((touch) => touch.gentleStatement),
  ];
}

function lawFailures(analysis: Analysis, notes: string[]): string[] {
  const text = [
    analysis.feeling.name,
    ...analysis.activated.map((item) => item.why),
    ...(analysis.landsOn ?? []).map((item) => item.why),
    ...notes,
  ].join(" ");
  const failures = clinicalHits(text).map((word) => `clinical:${word}`);
  if (/\b(should|must|need to|fix|improve|wrong|better)\b/i.test(text)) {
    failures.push("prescriptive_word");
  }
  return failures;
}

async function evaluateCase(
  client: CachedClient,
  variant: VariantName,
  pair: Pair,
  draft: DraftCase,
): Promise<Row> {
  const sender = await loadMap(pair.sender_id);
  const receiver = await loadMap(pair.receiver_id);
  const shared = receiver.shared_items.filter((item) =>
    pair.share_from_receiver.includes(item.id)
  );
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await analyse(
        client,
        draft.text,
        pair.relationship as Relationship,
        sender.beliefs,
        shared,
      );
      if (!result.analysis) {
        throw new Error(
          result.failed ?? "analysis returned no readable output",
        );
      }
      const analysis = applyVariant(
        variant,
        result.analysis,
        draft.text,
        sender.beliefs,
        gateActivatedLinks,
      );
      const activated = analysis.activated.map((item) => item.beliefId);
      const landsOn = (analysis.landsOn ?? []).map((item) => item.beliefId);
      const quiet = draft.expect === "quiet";
      const shown = analysis.frictions.length > 0 || activated.length > 0 ||
        landsOn.length > 0;
      const note = noteText(draft.text, analysis, sender.beliefs);
      const expectedBelief = draft.sender_belief;
      const right = expectedBelief !== "none" &&
        activated.includes(expectedBelief);
      const wrong = activated.some((id) => id !== expectedBelief);
      return {
        id: draft.id,
        draft: draft.text,
        gold: {
          frictions: draft.frictions,
          belief: expectedBelief,
          receiver_reading: draft.lands_on,
          expect: draft.expect,
        },
        output: {
          frictions: analysis.frictions.map((item) => item.kind),
          activated,
          lands_on: landsOn,
          safety: analysis.safety,
          note,
        },
        flaw_caught: draft.frictions.some((kind) =>
          analysis.frictions.some((item) => item.kind === kind)
        ),
        false_alarm: quiet && shown,
        quiet_when_expected: quiet && !shown,
        belief_link_right: right,
        wrong_link: wrong,
        receiver_reading_match: draft.lands_on === null
          ? null
          : landsOn.includes(draft.lands_on),
        law_failures: lawFailures(analysis, note),
        error: null,
        attempts: attempt,
        cached_calls: client.cached,
        live_calls: client.live,
      };
    } catch (error) {
      lastError = `${error instanceof Error ? error.name : "Error"}: ${
        String(error)
      }`;
    }
  }
  return {
    id: draft.id,
    draft: draft.text,
    gold: {
      frictions: draft.frictions,
      belief: draft.sender_belief,
      receiver_reading: draft.lands_on,
      expect: draft.expect,
    },
    output: {
      frictions: [],
      activated: [],
      lands_on: [],
      safety: "error",
      note: [],
    },
    flaw_caught: false,
    false_alarm: false,
    quiet_when_expected: false,
    belief_link_right: false,
    wrong_link: false,
    receiver_reading_match: draft.lands_on === null ? null : false,
    law_failures: [],
    error: lastError,
    attempts: 3,
    cached_calls: client.cached,
    live_calls: client.live,
  };
}

async function parallel<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  width = 8,
): Promise<R[]> {
  const result: R[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        result[index] = await worker(items[index]);
      }
    }),
  );
  return result;
}

function metrics(rows: Row[]): Metrics {
  const flawed = rows.filter((row) => row.gold.frictions.length > 0);
  const quiet = rows.filter((row) => row.gold.expect === "quiet");
  const links = rows.filter((row) => row.gold.belief !== "none");
  const receiver = rows.filter((row) => row.receiver_reading_match !== null);
  return {
    rows: rows.length,
    flaw_caught: flawed.filter((row) => row.flaw_caught).length,
    flaw_total: flawed.length,
    false_alarms: quiet.filter((row) => row.false_alarm).length,
    quiet: quiet.length,
    quiet_right: quiet.filter((row) => row.quiet_when_expected).length,
    link_right: links.filter((row) => row.belief_link_right).length,
    link_total: links.length,
    wrong_links: rows.filter((row) => row.wrong_link).length,
    receiver_right: receiver.filter((row) => row.receiver_reading_match).length,
    receiver_total: receiver.length,
    law_failures: rows.reduce(
      (total, row) => total + row.law_failures.length,
      0,
    ),
    errors: rows.filter((row) => row.error).length,
  };
}

function frictionMetrics(rows: Row[]): KindMetric[] {
  const kinds = [
    ...new Set(
      rows.flatMap((row) => [...row.gold.frictions, ...row.output.frictions]),
    ),
  ].sort();
  return kinds.map((kind) => {
    const true_positive = rows.filter((row) =>
      row.gold.frictions.includes(kind) && row.output.frictions.includes(kind)
    ).length;
    const false_positive = rows.filter((row) =>
      !row.gold.frictions.includes(kind) && row.output.frictions.includes(kind)
    ).length;
    const false_negative = rows.filter((row) =>
      row.gold.frictions.includes(kind) && !row.output.frictions.includes(kind)
    ).length;
    return {
      kind,
      true_positive,
      false_positive,
      false_negative,
      precision: true_positive + false_positive
        ? true_positive / (true_positive + false_positive)
        : null,
      recall: true_positive + false_negative
        ? true_positive / (true_positive + false_negative)
        : null,
    };
  });
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

function metricLines(current: Metrics, baseline: Metrics | null): string[] {
  const delta = (value: number, key: keyof Metrics) =>
    baseline
      ? ` (${value - baseline[key] >= 0 ? "+" : ""}${value - baseline[key]})`
      : "";
  return [
    "| metric | result | delta vs baseline |",
    "|---|---:|---:|",
    `| flaw caught | ${current.flaw_caught}/${current.flaw_total} |${
      delta(current.flaw_caught, "flaw_caught")
    }|`,
    `| false alarms | ${current.false_alarms}/${current.quiet} |${
      delta(current.false_alarms, "false_alarms")
    }|`,
    `| quiet when expected | ${current.quiet_right}/${current.quiet} |${
      delta(current.quiet_right, "quiet_right")
    }|`,
    `| belief link right | ${current.link_right}/${current.link_total} |${
      delta(current.link_right, "link_right")
    }|`,
    `| wrong links | ${current.wrong_links}/${current.rows} |${
      delta(current.wrong_links, "wrong_links")
    }|`,
    `| receiver reading match | ${current.receiver_right}/${current.receiver_total} |${
      delta(current.receiver_right, "receiver_right")
    }|`,
    `| law failures | ${current.law_failures} |${
      delta(current.law_failures, "law_failures")
    }|`,
    `| errors | ${current.errors} |${delta(current.errors, "errors")}|`,
  ];
}

async function judge(
  output: URL,
  rows: Row[],
): Promise<{ calibration: unknown[]; wording: unknown[] } | null> {
  const calibration = JSON.parse(await Deno.readTextFile(CALIBRATION)) as {
    rows: unknown[];
  };
  const input = new URL("judge-input.json", output),
    judged = new URL("judge-output.json", output);
  try {
    return JSON.parse(await Deno.readTextFile(judged)) as {
      calibration: unknown[];
      wording: unknown[];
    };
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const wording = rows.map((row) => ({
    id: row.id,
    draft: row.draft,
    gold: row.gold,
    note: row.output.note.join(" | ") ||
      "Nothing here is likely to get in the way",
  }));
  await Deno.writeTextFile(
    input,
    JSON.stringify({ calibration: calibration.rows, wording }, null, 2) + "\n",
  );
  const command = new Deno.Command("python3", {
    args: [new URL("judge.py", HERE).pathname, input.pathname, judged.pathname],
    cwd: ROOT.pathname,
    stdout: "piped",
    stderr: "piped",
  });
  const run = await command.output();
  if (!run.success) {
    throw new Error(
      `judge failed: ${
        new TextDecoder().decode(run.stderr).trim().slice(-400)
      }`,
    );
  }
  return JSON.parse(await Deno.readTextFile(judged)) as {
    calibration: unknown[];
    wording: unknown[];
  };
}

async function latestBaseline(except: URL): Promise<Metrics | null> {
  try {
    const paths: URL[] = [];
    for await (const entry of Deno.readDir(RESULTS)) {
      if (entry.isDirectory && entry.name.endsWith("-baseline")) {
        paths.push(new URL(`${entry.name}/metrics.json`, RESULTS));
      }
    }
    for (
      const path of paths.sort((a, b) => b.pathname.localeCompare(a.pathname))
    ) {
      if (
        path.pathname !== new URL("metrics.json", except).pathname
      ) return JSON.parse(await Deno.readTextFile(path)) as Metrics;
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return null;
}

function examples(rows: Row[]): Row[] {
  return [
    ...rows.filter((row) =>
      row.error || row.false_alarm ||
      !row.flaw_caught && row.gold.frictions.length || row.wrong_link
    ),
    ...rows,
  ]
    .filter((row, index, all) =>
      all.findIndex((item) => item.id === row.id) === index
    ).slice(0, 6);
}

async function main(): Promise<void> {
  const options = args();
  const variants: VariantName[] = [
    "baseline",
    "k0107-belief-link",
    "link-mid",
    "vague-strict",
    "you-blame-strict",
    "combo",
  ];
  const variant = typeof options.variant === "string" &&
      variants.includes(options.variant as VariantName)
    ? options.variant as VariantName
    : null;
  if (!variant) throw new Error(`--variant ${variants.join("|")} is required`);
  const selected = typeof options.only === "string"
    ? new Set(options.only.split(",").filter(Boolean))
    : null;
  const gold = JSON.parse(await Deno.readTextFile(DRAFTS)) as Gold;
  const calibrationGold = JSON.parse(await Deno.readTextFile(CALIBRATION)) as {
    rows: { label: boolean }[];
  };
  const all = gold.pairs.flatMap((pair) =>
    pair.drafts.map((draft) => ({ pair, draft }))
  );
  const cases = selected
    ? all.filter(({ draft }) => selected.has(draft.id))
    : all;
  if (!cases.length || selected && cases.length !== selected.size) {
    throw new Error("--only must name one or more known draft ids");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-")
    .replace("Z", "Z");
  const runName = typeof options["run-name"] === "string"
    ? options["run-name"]
    : `${stamp}-${variant}`;
  if (!/^[A-Za-z0-9-]+$/.test(runName) || !runName.endsWith(`-${variant}`)) {
    throw new Error("--run-name must be a safe name ending in its variant");
  }
  const output = new URL(`${runName}/`, RESULTS);
  await Deno.mkdir(output, { recursive: true });
  const model = typeof options.model === "string"
    ? options.model
    : DEFAULT_MODEL;
  const inner = new AnthropicClient({
    config: await loadProtectedConfig(),
    defaultModel: model,
    timeoutMs: 90_000,
  });
  const client = new CachedClient(inner, model, variant);
  const started = performance.now();
  const rows = await parallel(
    cases,
    ({ pair, draft }) => evaluateCase(client, variant, pair, draft),
  );
  const score = metrics(rows);
  const friction = frictionMetrics(rows);
  await Deno.writeTextFile(
    new URL("rows.json", output),
    JSON.stringify(rows, null, 2) + "\n",
  );
  await Deno.writeTextFile(
    new URL("metrics.json", output),
    JSON.stringify(score, null, 2) + "\n",
  );
  await Deno.writeTextFile(
    new URL("friction-metrics.json", output),
    JSON.stringify(friction, null, 2) + "\n",
  );
  let judged: { calibration: unknown[]; wording: unknown[] } | null = null;
  let judgeError: string | null = null;
  if (options["no-judge"] !== true) {
    try {
      judged = await judge(output, rows);
    } catch (error) {
      judgeError = error instanceof Error ? error.message : String(error);
    }
  }
  const calibration = (judged?.calibration as
    | { correct: boolean; error: string | null }[]
    | undefined) ?? [];
  const wording = (judged?.wording as
    | { law_clean: boolean; error: string | null }[]
    | undefined) ?? [];
  const calibrationMatches =
    calibration.filter((item, index) =>
      item.correct === Boolean(calibrationGold.rows[index]?.label)
    ).length;
  const baseline = variant === "baseline" ? null : await latestBaseline(output);
  const confused = rows.filter((row) =>
    row.error || row.false_alarm ||
    !row.flaw_caught && row.gold.frictions.length || row.wrong_link ||
    row.receiver_reading_match === false || row.law_failures.length
  );
  const report = [
    "# Bridge offline evaluation",
    "",
    `- Variant: \`${variant}\``,
    `- Gold: ${gold.gold_version}; ${rows.length}/${all.length} fixed fictional drafts`,
    `- Engine model: ${model}`,
    `- Cache: ${client.cached} hit(s), ${client.live} live model call(s)`,
    `- Elapsed: ${Math.round(performance.now() - started)} ms`,
    "",
    "## Metrics",
    "",
    ...metricLines(score, baseline),
    "",
    "## Friction precision and recall",
    "",
    "| kind | TP | FP | FN | precision | recall |",
    "|---|---:|---:|---:|---:|---:|",
    ...friction.map((item) =>
      `| ${item.kind} | ${item.true_positive} | ${item.false_positive} | ${item.false_negative} | ${
        percent(item.precision)
      } | ${percent(item.recall)} |`
    ),
    "",
    "## Judge",
    "",
    judged
      ? `- Calibration agreement with the 40 fixed labels: ${calibrationMatches}/40 (${
        Math.round(calibrationMatches / 40 * 100)
      }%).`
      : `- Not run: ${judgeError ?? "--no-judge"}.`,
    judged
      ? `- Wording/law rows clean: ${
        wording.filter((item) => item.law_clean && !item.error).length
      }/${wording.length}.`
      : "",
    "",
    "## Confusion list",
    "",
    ...(confused.length
      ? confused.flatMap((
        row,
      ) => [
        `### ${row.id}`,
        "",
        `- Draft: ${row.draft}`,
        `- Gold: ${JSON.stringify(row.gold)}`,
        `- Engine: ${JSON.stringify(row.output)}`,
        `- Why: ${
          row.error ?? (row.false_alarm
            ? "false alarm on quiet gold"
            : !row.flaw_caught
            ? "missed gold flaw"
            : row.wrong_link
            ? "wrong belief link"
            : "receiver reading missed")
        }`,
        "",
      ])
      : ["- None."]),
    "",
    "## Six examples",
    "",
    ...examples(rows).flatMap((
      row,
    ) => [
      `### ${row.id}`,
      "",
      `Before: ${row.draft}`,
      `After: ${
        row.output.note.join(" | ") ||
        "Nothing here is likely to get in the way."
      }`,
      `Gold: ${JSON.stringify(row.gold)}`,
      "",
    ]),
  ].join("\n").trimEnd() + "\n";
  await Deno.writeTextFile(new URL("REPORT.md", output), report);
  await Deno.writeTextFile(
    new URL("manifest.json", output),
    JSON.stringify(
      {
        variant,
        model,
        gold_version: gold.gold_version,
        source_hash: await sha256(await Deno.readTextFile(DRAFTS)),
        started_at: new Date(Date.now() - (performance.now() - started))
          .toISOString(),
        finished_at: new Date().toISOString(),
        elapsed_ms: Math.round(performance.now() - started),
        cache_hits: client.cached,
        live_calls: client.live,
        judge: judged ? "configured OpenAI lab judge" : judgeError ?? "not run",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(new URL("REPORT.md", output).pathname);
}

if (import.meta.main) await main();
