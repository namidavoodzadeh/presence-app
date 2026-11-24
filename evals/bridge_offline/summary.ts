// Produces the requested owner-readable summary after baseline and candidate
// have been run.  It contains fixture text only and never secrets or prompts.

const HERE = new URL("./", import.meta.url);
const RESULTS = new URL("results/", HERE);
const OUTPUTS = new URL("../../outputs/lab/", import.meta.url);
type Row = { id: string; draft: string; gold: { belief: string }; output: { activated: string[]; frictions: string[] } };
type Metrics = Record<string, number>;

async function latest(variant: string): Promise<URL> {
  const matches: URL[] = [];
  for await (const entry of Deno.readDir(RESULTS)) if (entry.isDirectory && entry.name.endsWith(`-${variant}`)) matches.push(new URL(`${entry.name}/`, RESULTS));
  const path = matches.sort((a, b) => b.pathname.localeCompare(a.pathname))[0];
  if (!path) throw new Error(`no ${variant} result exists`);
  return path;
}

const baseline = await latest("baseline"), candidate = await latest("k0107-belief-link");
const [baseMetrics, candidateMetrics, baseRows, candidateRows] = await Promise.all([
  Deno.readTextFile(new URL("metrics.json", baseline)).then(JSON.parse) as Promise<Metrics>,
  Deno.readTextFile(new URL("metrics.json", candidate)).then(JSON.parse) as Promise<Metrics>,
  Deno.readTextFile(new URL("rows.json", baseline)).then(JSON.parse) as Promise<Row[]>,
  Deno.readTextFile(new URL("rows.json", candidate)).then(JSON.parse) as Promise<Row[]>,
]);
const byId = new Map(candidateRows.map((row) => [row.id, row]));
const examples = baseRows.filter((row) => row.output.activated.join(",") !== byId.get(row.id)?.output.activated.join(",")).slice(0, 3);
const date = new Date().toISOString().slice(0, 10);
const lines = ["# Bridge offline summary", "", "1. The offline run used 48 fixed fictional drafts and maps; no staging, accounts, or HTTP routes.", `2. Flaws caught: ${baseMetrics.flaw_caught}/${baseMetrics.flaw_total} → ${candidateMetrics.flaw_caught}/${candidateMetrics.flaw_total}.`, `3. Quiet rows held: ${baseMetrics.quiet_right}/${baseMetrics.quiet} → ${candidateMetrics.quiet_right}/${candidateMetrics.quiet}.`, `4. Right belief links: ${baseMetrics.link_right}/${baseMetrics.link_total} → ${candidateMetrics.link_right}/${candidateMetrics.link_total}.`, `5. Wrong links: ${baseMetrics.wrong_links} → ${candidateMetrics.wrong_links}.`, `6. Receiver-reading matches: ${baseMetrics.receiver_right}/${baseMetrics.receiver_total} → ${candidateMetrics.receiver_right}/${candidateMetrics.receiver_total}.`, `7. Deterministic law failures: ${baseMetrics.law_failures} → ${candidateMetrics.law_failures}.`, "8. Examples:", ...examples.map((row) => { const next = byId.get(row.id)!; return `   - ${row.id}: “${row.draft}” linked ${row.output.activated.join(",") || "nothing"} → ${next.output.activated.join(",") || "nothing"}.`; }), "9. Full baseline and candidate reports are in evals/bridge_offline/results/.", "10. Rerunning unchanged inputs uses the response cache; changed prompts or inputs receive fresh calls.", ""];
await Deno.mkdir(OUTPUTS, { recursive: true });
const path = new URL(`SUMMARY-offline-${date}.md`, OUTPUTS);
await Deno.writeTextFile(path, lines.join("\n"));
console.log(path.pathname);
