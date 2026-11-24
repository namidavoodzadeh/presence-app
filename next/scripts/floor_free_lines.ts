// Plan helper for safety_surfaces.py: which lines the deterministic floor stops with no model read at all (a floor stop that is not a
// candidate row of a benign class stands on every surface without a call). Prints a JSON array of 0-based indexes. No network, no cost.
//   deno run --allow-read next/scripts/floor_free_lines.ts <lines.json>      (a JSON array of strings)
import { keywordRisk } from "../engine/safety.ts";
import { candidateClasses } from "../engine/safety_classes.ts";
const lines: string[] = JSON.parse(await Deno.readTextFile(Deno.args[0]));
const free = lines.flatMap((t, i) => { const f = keywordRisk(t); return f.risk !== "none" && !candidateClasses(t, f).length ? [i] : []; });
console.log(JSON.stringify(free));
