// Scheduler entry point: a regression is an explicit non-zero alert, not a
// silent dashboard change.  The scheduler/loop owns delivery to the CEO.

const HERE = new URL("./", import.meta.url);
const RESULTS = new URL("results/", HERE);
type Metrics = Record<string, number>;
const watched = ["flaw_caught", "quiet_right", "link_right", "receiver_right"];

async function baselines(): Promise<URL[]> {
  const paths: URL[] = [];
  try { for await (const entry of Deno.readDir(RESULTS)) if (entry.isDirectory && entry.name.endsWith("-baseline")) paths.push(new URL(`${entry.name}/`, RESULTS)); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  return paths.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

const before = await baselines();
const prior = before.length ? JSON.parse(await Deno.readTextFile(new URL("metrics.json", before.at(-1)!))) as Metrics : null;
const run = await new Deno.Command("deno", { args: ["run", "-A", new URL("run.ts", HERE).pathname, "--variant", "baseline"], stdout: "piped", stderr: "piped" }).output();
if (!run.success) throw new Error(new TextDecoder().decode(run.stderr).trim());
const after = await baselines();
const current = JSON.parse(await Deno.readTextFile(new URL("metrics.json", after.at(-1)!))) as Metrics;
const drops = prior ? watched.filter((key) => (prior[key] ?? 0) - (current[key] ?? 0) > 2).map((key) => `${key}: ${prior[key]} → ${current[key]}`) : [];
if (drops.length) {
  console.error(`ALERT CEO: Bridge offline baseline dropped by more than 2 cases — ${drops.join("; ")}`);
  Deno.exit(2);
}
console.log("Bridge offline nightly baseline: no metric dropped by more than 2 cases.");
