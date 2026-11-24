// Compares the four gate numbers of two offline evaluation runs (metrics.json) and fails if any is worse.
// The four numbers: flaw caught (higher is better), false alarms (lower), belief link right (higher),
// receiver reading match (higher).
// Usage: deno run -A evals/bridge_offline/compare.ts <main metrics.json> <change metrics.json> [markdown out]
type Metrics = Record<string, number>;
const FOUR: { key: string; total: string; label: string; better: "higher" | "lower" }[] = [
  { key: "flaw_caught", total: "flaw_total", label: "flaw caught", better: "higher" },
  { key: "false_alarms", total: "quiet", label: "false alarms", better: "lower" },
  { key: "link_right", total: "link_total", label: "belief link right", better: "higher" },
  { key: "receiver_right", total: "receiver_total", label: "receiver reading match", better: "higher" },
];
const [mainPath, changePath, outPath] = Deno.args;
if (!mainPath || !changePath) throw new Error("usage: compare.ts <main metrics.json> <change metrics.json> [out.md]");
const main: Metrics = JSON.parse(await Deno.readTextFile(mainPath));
const change: Metrics = JSON.parse(await Deno.readTextFile(changePath));
let worse = 0;
const lines = ["| number | main | this change | |", "|---|---:|---:|---|"];
for (const n of FOUR) {
  const a = main[n.key] / main[n.total], b = change[n.key] / change[n.total];
  const bad = n.better === "higher" ? b < a : b > a;
  if (bad) worse++;
  lines.push(`| ${n.label} | ${main[n.key]}/${main[n.total]} | ${change[n.key]}/${change[n.total]} | ${bad ? "worse" : "ok"} |`);
}
const verdict = worse ? `**Blocked:** ${worse} of the four numbers is worse than main.` : "None of the four numbers is worse than main.";
const md = ["## Engine evaluation: the four numbers", "", ...lines, "", verdict, ""].join("\n");
console.log(md);
if (outPath) await Deno.writeTextFile(outPath, md);
Deno.exit(worse ? 1 : 0);
