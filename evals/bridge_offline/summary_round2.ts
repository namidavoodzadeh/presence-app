// K-0163 owner summary. It reads completed offline runs only; no provider call
// or production route is involved.

const HERE = new URL("./", import.meta.url);
const RESULTS = new URL("results/", HERE);
const OUTPUT = new URL(
  "../../outputs/lab/SUMMARY-offline-round2.md",
  import.meta.url,
);
const VARIANTS = [
  "baseline",
  "k0107-belief-link",
  "link-mid",
  "vague-strict",
  "you-blame-strict",
  "combo",
] as const;
type Variant = typeof VARIANTS[number];

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
}
interface Row {
  id: string;
  output: { frictions: string[]; activated: string[]; note: string[] };
}
interface Result {
  variant: Variant;
  path: URL;
  metrics: Metrics;
  rows: Row[];
}

async function latest(variant: Variant): Promise<URL | null> {
  const found: URL[] = [];
  try {
    for await (const entry of Deno.readDir(RESULTS)) {
      if (entry.isDirectory && entry.name.endsWith(`-${variant}`)) {
        found.push(new URL(`${entry.name}/`, RESULTS));
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
  return found.sort((left, right) =>
    right.pathname.localeCompare(left.pathname)
  )[0] ?? null;
}

async function result(variant: Variant): Promise<Result | null> {
  const path = await latest(variant);
  if (!path) return null;
  const [metrics, rows] = await Promise.all([
    Deno.readTextFile(new URL("metrics.json", path)).then(
      JSON.parse,
    ) as Promise<Metrics>,
    Deno.readTextFile(new URL("rows.json", path)).then(JSON.parse) as Promise<
      Row[]
    >,
  ]);
  return { variant, path, metrics, rows };
}

function meetsGoal(metrics: Metrics): boolean {
  return metrics.flaw_caught >= 32 && metrics.false_alarms <= 2 &&
    metrics.link_right >= 25 && metrics.wrong_links <= 10;
}

function goalCount(metrics: Metrics): number {
  return Number(metrics.flaw_caught >= 32) +
    Number(metrics.false_alarms <= 2) +
    Number(metrics.link_right >= 25) + Number(metrics.wrong_links <= 10);
}

function rank(left: Result, right: Result): number {
  const leftGoals = goalCount(left.metrics),
    rightGoals = goalCount(right.metrics);
  if (leftGoals !== rightGoals) return rightGoals - leftGoals;
  return right.metrics.link_right - left.metrics.link_right ||
    left.metrics.wrong_links - right.metrics.wrong_links ||
    left.metrics.false_alarms - right.metrics.false_alarms ||
    right.metrics.flaw_caught - left.metrics.flaw_caught;
}

function plain(row: Row): string {
  return row.output.note[0] ? `“${row.output.note[0]}”` : "nothing shown";
}

const completed = (await Promise.all(VARIANTS.map(result))).filter((
  item,
): item is Result => item !== null);
const baseline = completed.find((item) => item.variant === "baseline");
if (!baseline) {
  throw new Error("K-0163 summary requires a completed baseline run");
}
const candidates = completed.filter((item) => item.variant !== "baseline").sort(
  rank,
);
if (!candidates.length) {
  throw new Error("K-0163 summary requires at least one candidate run");
}
const winner = candidates[0];
const winnerById = new Map(winner.rows.map((row) => [row.id, row]));
const examples = baseline.rows.filter((row) =>
  plain(row) !== plain(winnerById.get(row.id) ?? row)
).slice(0, 3);

const lines = [
  "# Bridge offline round 2",
  "",
  "| variant | flaws | false alarms | quiet | right links | wrong links | goal |",
  "|---|---:|---:|---:|---:|---:|---|",
  ...completed.map(({ variant, metrics }) =>
    `| ${variant} | ${metrics.flaw_caught}/${metrics.flaw_total} | ${metrics.false_alarms}/${metrics.quiet} | ${metrics.quiet_right}/${metrics.quiet} | ${metrics.link_right}/${metrics.link_total} | ${metrics.wrong_links}/${metrics.rows} | ${
      meetsGoal(metrics) ? "pass" : "no"
    } |`
  ),
  "",
  "## Three before/after examples",
  "",
  ...examples.map((before) =>
    `- ${before.id}: baseline showed ${
      plain(before)
    }; ${winner.variant} showed ${plain(winnerById.get(before.id)!)}.`
  ),
  ...(examples.length
    ? []
    : ["- No row changed between the baseline and the selected candidate."]),
  "",
  "## Recommendation",
  "",
  meetsGoal(winner.metrics)
    ? `Ship ${winner.variant} to staging for independent real-path verification. It is the best completed candidate and meets all four offline targets.`
    : `Do not ship to staging. ${winner.variant} is the best completed candidate, but it misses one or more offline targets; no production prompt changed.`,
  "",
  `Reports: ${completed.map((item) => item.path.pathname).join(", ")}`,
  "",
];
await Deno.mkdir(new URL("./", OUTPUT), { recursive: true });
await Deno.writeTextFile(OUTPUT, lines.join("\n"));
console.log(OUTPUT.pathname);
