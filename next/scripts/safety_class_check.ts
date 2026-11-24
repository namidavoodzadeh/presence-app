// QA-B336 under PSY 15 Nov ruling 2 (2e): run the class twins (tests/fixtures/b336_psy_classes.json) through the floor, the
// class key (engine/safety_classes.ts) and the semantic check, as Talk and Bridge do, N times each.
//   - floor stops, key 1 fits: two parallel class readings per repeat, Sonnet and Haiku one each, as the surfaces run them (PSY 15 Nov 04:44Z); cleared when twoKeyClear says so on both.
//   - floor stops, key 1 does not fit: the stop stands, no call.
//   - floor lets it through: the ordinary semantic check per repeat (it can only add a stop).
// A must_stop twin passes only if it stops on every repeat (PSY: a twin that clears even once sends its class back to
// unconditional). must_clear lines are counted. The surface's own turn or analysis model field is not run here, so a twin's
// stop count is a lower bound for the whole surface. Counts only; never prints a key.
//
//   deno run --allow-read --allow-env --allow-net --allow-write --allow-run next/scripts/safety_class_check.ts [--repeat 5] [--cap-cents 120]
//       [--only CLASS] [--limit N] [--floor-only] [--out DIR] [--file b336_heldout7.json | --files a.json,b.json] [--positives-only]
//       [--strict-surfaces] [--controls-from a.json,b.json] [--control-repeat N]
// EXIT CODE (QA-B336, 16 Nov): 0 only when every must-stop and unconditional row stopped on every repeat and no reading was
// unavailable (cap, timeout, unreadable reply). Any miss or any unavailable reading exits 1 and prints a GATE FAILED line per cause.
// --strict-surfaces also fails when a surface (the gateWords entry, Ask me, import) lets a must-stop line through on any repeat.
// --files runs several sets with ONE client and ONE cap (a line repeated in two sets runs once); --positives-only skips each set's
// benign lines (saves cost) except for the sets named in --controls-from, whose benign lines run --control-repeat times (default: --repeat).
// --file runs a {positives, controls} set the same way instead (positives must stop on every repeat; controls are counted, e.g.
// PSY's 2e rerun of the 46 benign sentences in b336_heldout7.json).
import { keywordRisk } from "../engine/safety.ts";
import { screenAnswer } from "../api/lib/ask_me.ts";
import { preflightImportSafety } from "../engine/import_ai.ts";
import { candidateClasses } from "../engine/safety_classes.ts";
import { SEMANTIC_MODEL } from "../engine/safety_semantic.ts";
import { AnthropicClient, CappedModelClient, loadProtectedConfig } from "../engine/model/client.ts";
import type { ModelClient } from "../engine/model/client.ts";
import { gateWords } from "../api/lib/safety_gate.ts";
import { hooks as bridgeHooks } from "../api/bridge_engine.ts";
import type { Ctx } from "../api/lib/router.ts";

export interface ClassRow { cls: string; kind: "must_stop" | "must_clear" | "unconditional"; text: string; floor: string; key1: string[];
  stops: number; clears: number; runs: number; unavailable: number; notes: string[]; stopVec: boolean[] }

/** QA-B336 (COO 02:20Z): the check calls api/lib/safety_gate.ts gateWords(), the one entry every route that takes a person's words calls
 *  (Talk floor path, Bridge send and edit, Check-in notes, Reading, Map /beliefs, Mirror question and contribution, import), through a
 *  stub request context whose model client is the capped one. So the number measured is the route's own entry, not a copy of it. */
export function makeGate(client: ModelClient): (text: string) => ReturnType<typeof gateWords> {
  const service = { from() { throw new Error("no database in the safety check"); } };
  const ctx = { env: { safetySemantic: true }, caller: { id: "b336-check", isPreview: false }, service } as unknown as Ctx;
  bridgeHooks.client = () => client;
  return (text: string) => gateWords(ctx, text);
}

export async function runOne(cls: string, kind: ClassRow["kind"], text: string, gate: ((text: string) => ReturnType<typeof gateWords>) | null, repeat: number): Promise<ClassRow> {
  const floor = keywordRisk(text);
  const key1 = candidateClasses(text, floor);
  const row: ClassRow = { cls, kind, text, floor: floor.risk, key1, stops: 0, clears: 0, runs: 0, unavailable: 0, notes: [], stopVec: [] };
  for (let i = 0; i < repeat; i++) {
    if (floor.risk !== "none" && !key1.length) { row.stops++; row.runs++; row.stopVec.push(true); continue; }
    if (!gate) { row.notes.push("no client"); break; }
    const r = await gate(text);
    row.runs++;
    row.unavailable += r.readingsUnavailable;
    if (r.unavailable) { const n = r.reason.slice(0, 140); if (!row.notes.includes(n)) row.notes.push(n); }
    row.stopVec.push(r.stop);
    if (r.stop) row.stops++; else row.clears++;
    if (r.stop && floor.risk !== "none") { const n = `entry ${r.via}: ${r.reason.slice(0, 100)}`; if (!row.notes.includes(n)) row.notes.push(n); }
  }
  return row;
}

/** The reasons a run is not a pass (empty = pass). Pure, so a test can prove a miss or an unavailable reading fails the gate. A row that
 *  could not run for lack of a client (--floor-only) is not counted: a floor-only run is never a gate on the semantic path. */
export function gateFailures(rows: ClassRow[], repeat: number): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.kind === "must_clear") { if (r.unavailable) out.push(`${r.cls}: ${r.unavailable} unavailable reading(s) on a benign line`); continue; }
    if (r.notes.includes("no client")) continue;
    if (r.runs !== repeat) out.push(`${r.cls}: ran ${r.runs}/${repeat} repeats | ${r.text}`);
    else if (r.stops !== r.runs) out.push(`${r.cls}: stopped ${r.stops}/${r.runs} | ${r.text}`);
    if (r.unavailable) out.push(`${r.cls}: ${r.unavailable} unavailable reading(s) | ${r.text}`);
  }
  return out;
}

/** Every surface that takes a person's words, with the deterministic layer it adds beside the one entry (which only ever adds a stop).
 *  A must-stop line is missed on a surface when some repeat is stopped by neither the entry nor that layer. */
export const SURFACES: { name: string; extra: (text: string) => boolean }[] = [
  { name: "gateWords entry (Talk floor path, Bridge send and edit, Check-in, Reading, Map, Mirror question and contribution, first message)", extra: () => false },
  { name: "Ask me (screenAnswer + the entry)", extra: (t) => screenAnswer(t).verdict === "risk_stop" },
  { name: "import (preflight + the entry)", extra: (t) => preflightImportSafety(t).risk !== "none" },
];
export function surfaceMisses(rows: ClassRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const sf of SURFACES) {
    out[sf.name] = [];
    for (const r of rows) {
      if (r.kind === "must_clear") continue;
      const extra = sf.extra(r.text);
      // A row that never ran (--floor-only, floor let it through) is unproven on the surface: counted as a miss unless its own layer stops it.
      if (r.runs === 0 ? !extra : r.stopVec.some((v) => !v && !extra)) out[sf.name].push(r.text);
    }
  }
  return out;
}

async function sourceNote(): Promise<string[]> {
  const run = async (args: string[]) => {
    try {
      const o = await new Deno.Command("git", { args, stdout: "piped", stderr: "null" }).output();
      return new TextDecoder().decode(o.stdout).trim();
    } catch { return "(git unavailable)"; }
  };
  const dirty = await run(["status", "--porcelain", "--untracked-files=no"]);
  return [`git rev-parse HEAD: ${await run(["rev-parse", "HEAD"])}`, `git status (tracked files): ${dirty ? "DIRTY: " + dirty.split("\n").length + " changed file(s)" : "clean"}`];
}

if (import.meta.main) {
  const args: Record<string, string | boolean> = { "cap-cents": "120", repeat: "5" };
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "floor-only" || key === "positives-only" || key === "strict-surfaces") args[key] = true; else args[key] = Deno.args[++i] ?? "";
  }
  const files = typeof args.files === "string" ? args.files.split(",").filter(Boolean) : [typeof args.file === "string" ? args.file : "b336_psy_classes.json"];
  const repeat = Number(args.repeat), limit = args.limit ? Number(args.limit) : Infinity;
  const positivesOnly = args["positives-only"] === true;
  const controlsFrom = typeof args["controls-from"] === "string" ? args["controls-from"].split(",") : [];
  const controlRepeat = args["control-repeat"] ? Number(args["control-repeat"]) : repeat;
  const seenTexts = new Set<string>();
  let client: ModelClient | null = null;
  let gate: ReturnType<typeof makeGate> | null = null;
  if (!args["floor-only"]) {
    const config = await loadProtectedConfig();
    client = new CappedModelClient(new AnthropicClient({ config, defaultModel: SEMANTIC_MODEL, thinking: "disabled", timeoutMs: 20_000 }), Number(args["cap-cents"]), SEMANTIC_MODEL);
    gate = makeGate(client);
  }
  const out: string[] = [...await sourceNote(), `model: ${client ? SEMANTIC_MODEL : "(floor only)"}; repeat ${repeat}; two parallel class readings per repeat; files: ${files.join(", ")}${positivesOnly ? " (positives only)" : ""}`];
  const allRows: ClassRow[] = [];
  const mustStopTexts: string[] = [];
  for (const file of files) {
    const raw = JSON.parse(await Deno.readTextFile(new URL(`../tests/fixtures/${file}`, import.meta.url)));
    const held = raw.classes ? raw : { classes: { [file.replace(/\.json$/, "")]: { must_stop: raw.positives ?? [], must_clear: raw.controls ?? raw.negatives ?? [] } }, unconditional: [] };
    const items: [string, ClassRow["kind"], string][] = [];
    for (const [cls, v] of Object.entries(held.classes) as [string, { must_stop: string[]; must_clear: string[] }][]) {
      if (typeof args.only === "string" && args.only !== cls) continue;
      for (const s of v.must_stop) if (!seenTexts.has(s)) { seenTexts.add(s); items.push([cls, "must_stop", s]); }
      if (!positivesOnly || controlsFrom.includes(file)) for (const s of v.must_clear) if (!seenTexts.has(s)) { seenTexts.add(s); items.push([cls, "must_clear", s]); }
    }
    if (typeof args.only !== "string") for (const s of (held.unconditional ?? []) as string[]) items.push(["unconditional", "unconditional", s]);
    const rows: ClassRow[] = [];
    for (const [cls, kind, text] of items.slice(0, limit)) rows.push(await runOne(cls, kind, text, gate, kind === "must_clear" ? controlRepeat : repeat));
    allRows.push(...rows);
    for (const r of rows) if (r.kind !== "must_clear") mustStopTexts.push(r.text);
    out.push(`== ${file}`);
    for (const cls of [...new Set(rows.map((r) => r.cls))]) {
      const tw = rows.filter((r) => r.cls === cls && r.kind !== "must_clear"), cl = rows.filter((r) => r.cls === cls && r.kind === "must_clear");
      const held5 = tw.filter((r) => r.stops === r.runs && r.runs === repeat).length;
      if (cl.length) out.push(`${cls}: clear or benign lines stopped on any repeat: ${cl.filter((r) => r.stops > 0).length}/${cl.length}`);
      out.push(`${cls}: must-stop lines stopping ${repeat}/${repeat}: ${held5}/${tw.length}${cl.length ? `; clear lines cleared on every repeat: ${cl.filter((r) => r.runs > 0 && r.clears === r.runs).length}/${cl.length}` : ""}`);
      for (const r of tw.filter((r) => !(r.stops === r.runs && r.runs === repeat))) out.push(`  TWIN NOT HELD ${r.stops}/${r.runs} | ${r.text} | ${r.notes.join("; ")}`);
      for (const r of cl) out.push(`  clear ${r.clears}/${r.runs} stop ${r.stops}/${r.runs} floor=${r.floor} key1=[${r.key1}] | ${r.text}${r.notes.length ? " | " + r.notes.join("; ") : ""}`);
    }
    if (typeof args.out === "string") {
      await Deno.mkdir(args.out, { recursive: true });
      await Deno.writeTextFile(`${args.out}/${file.replace(/\.json$/, "")}.rows.json`, JSON.stringify(rows, null, 1));
    }
  }
  const spent = client instanceof CappedModelClient ? client.spent : 0;
  out.push(`unavailable readings: ${allRows.reduce((n, r) => n + r.unavailable, 0)}; spent ${Number(spent.toFixed(2))}¢ (exact, the provider's bill)`);
  const surf = surfaceMisses(allRows.filter((r) => r.kind !== "must_clear"));
  out.push(`surfaces, ${new Set(mustStopTexts).size} must-stop lines, each through the one entry (api/lib/safety_gate.ts gateWords) plus its own deterministic layer:`);
  for (const [name, miss] of Object.entries(surf)) out.push(`  ${name}: ${miss.length} missed`);
  out.push("NOT reached by this script: (1) the Talk turn and Bridge analyse call's own risk field (the main model's reply; it only ever adds a stop beside the entry; covered by recorded-client unit tests, not by this live run); (2) invites: POST /invites and the accept route carry no person's words (a code only), so there is no entry to reach; (3) the first message is POST /bridges `final` or Talk's first turn and takes the entry above");
  const failures = gateFailures(allRows, repeat);
  if (args["strict-surfaces"] === true) for (const [name, miss] of Object.entries(surf)) if (miss.length) failures.push(`surface ${name}: ${miss.length} must-stop line(s) not stopped`);
  out.push(failures.length ? `GATE FAILED (${failures.length}):` : args["floor-only"] ? "GATE NOT RUN (--floor-only reads no model; lines that need the semantic check were skipped)" : "GATE PASSED");
  for (const f of failures.slice(0, 60)) out.push(`  GATE FAILED: ${f}`);
  console.log(out.join("\n"));
  if (typeof args.out === "string") {
    await Deno.mkdir(args.out, { recursive: true });
    await Deno.writeTextFile(`${args.out}/summary.txt`, out.join("\n") + "\n");
  }
  Deno.exit(failures.length ? 1 : 0);
}
