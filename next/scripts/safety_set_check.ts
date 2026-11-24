// QA-B336: run a sentence set through the law-8 layers exactly as the surfaces do: the keyword floor first, then the
// semantic check (one call on SEMANTIC_MODEL, Sonnet 5.5 since round 8; --model to compare) for every sentence the floor lets through. Prints per-sentence results, counts, per-call
// latency (p50, p95, max), cents and the unavailable count. The floor needs no key; the semantic layer reads the protected
// key file (never printed) and is capped per run. Sets are {positives:[...], controls:[...]} (b336_heldout*.json) or
// {positives, negatives}.
//
//   deno run --allow-read --allow-env --allow-net next/scripts/safety_set_check.ts [--file F] [--floor-only] [--cap-cents N] [--model M] [--out DIR]

import { keywordRisk } from "../engine/safety.ts";
import { SEMANTIC_MODEL, semanticRisk } from "../engine/safety_semantic.ts";
import type { SemanticRisk } from "../engine/safety_semantic.ts";
import { AnthropicClient, CappedModelClient, loadProtectedConfig } from "../engine/model/client.ts";
import type { ModelClient } from "../engine/model/client.ts";

interface Row { text: string; expectStop: boolean; floor: string; floorReason: string; semantic: SemanticRisk | null; layered: string }

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

export async function checkSet(set: { positives: string[]; controls?: string[]; negatives?: string[] }, client: ModelClient | null, model: string): Promise<Row[]> {
  const rows: Row[] = [];
  const all = [...set.positives.map((t) => [t, true] as const), ...(set.controls ?? set.negatives ?? []).map((t) => [t, false] as const)];
  for (const [text, expectStop] of all) {
    const floor = keywordRisk(text);
    let semantic: SemanticRisk | null = null;
    if (floor.risk === "none" && client) semantic = await semanticRisk(client, text, { model });
    const layered = floor.risk !== "none" ? floor.risk : semantic && semantic.ok ? semantic.risk : "none";
    rows.push({ text, expectStop, floor: floor.risk, floorReason: floor.reason, semantic, layered });
  }
  return rows;
}

export function summarise(rows: Row[], floorOnly: boolean): string {
  const pos = rows.filter((r) => r.expectStop), neg = rows.filter((r) => !r.expectStop);
  const floorStops = pos.filter((r) => r.floor !== "none").length, floorFalse = neg.filter((r) => r.floor !== "none").length;
  const layStops = pos.filter((r) => r.layered !== "none").length, layFalse = neg.filter((r) => r.layered !== "none").length;
  const calls = rows.map((r) => r.semantic).filter((s): s is SemanticRisk => !!s);
  const ms = calls.map((s) => s.ms), cents = calls.reduce((n, s) => n + s.cents, 0), unavailable = calls.filter((s) => !s.ok).length;
  const lines = [
    `floor:   stops ${floorStops}/${pos.length}, false stops ${floorFalse}/${neg.length}`,
  ];
  if (!floorOnly) {
    lines.push(`layered: stops ${layStops}/${pos.length}, false stops ${layFalse}/${neg.length}  (floor, then the semantic check on what the floor let through)`);
    lines.push(`semantic calls: ${calls.length}, unavailable ${unavailable}, cents ${cents}, latency ms p50 ${Math.round(pct(ms, 0.5))} p95 ${Math.round(pct(ms, 0.95))} max ${Math.round(Math.max(0, ...ms))}`);
    for (const r of pos.filter((r) => r.layered === "none")) lines.push(`MISS    | ${r.text}${r.semantic && !r.semantic.ok ? `  [${r.semantic.reason}]` : ""}`);
    for (const r of neg.filter((r) => r.layered !== "none")) lines.push(`FALSE   | ${r.layered} by ${r.floor !== "none" ? `floor (${r.floorReason})` : `semantic (${r.semantic?.reason})`} | ${r.text}`);
  } else {
    for (const r of pos.filter((r) => r.floor === "none")) lines.push(`MISS    | ${r.text}`);
    for (const r of neg.filter((r) => r.floor !== "none")) lines.push(`FALSE   | ${r.floor} (${r.floorReason}) | ${r.text}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const args: Record<string, string | boolean> = { "cap-cents": "40" };
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "floor-only") args[key] = true;
    else args[key] = Deno.args[++i] ?? "";
  }
  const file = typeof args.file === "string" ? args.file : new URL("../tests/fixtures/b336_heldout7.json", import.meta.url).pathname;
  const set = JSON.parse(await Deno.readTextFile(file));
  const model = typeof args.model === "string" ? args.model : SEMANTIC_MODEL;
  let client: ModelClient | null = null;
  if (!args["floor-only"]) {
    const config = await loadProtectedConfig();
    client = new CappedModelClient(new AnthropicClient({ config, defaultModel: model, thinking: "disabled", timeoutMs: 20_000 }), Number(args["cap-cents"]), model);
  }
  const rows = await checkSet(set, client, model);
  const summary = summarise(rows, !!args["floor-only"]);
  console.log(`set: ${file}\nmodel: ${client ? model : "(floor only)"}\n${summary}`);
  if (typeof args.out === "string") {
    await Deno.mkdir(args.out, { recursive: true });
    const name = file.split("/").pop()!.replace(/\.json$/, "");
    await Deno.writeTextFile(`${args.out}/${name}.rows.json`, JSON.stringify(rows.map((r) => ({ text: r.text, expectStop: r.expectStop, floor: r.floor, floorReason: r.floorReason,
      semantic: r.semantic ? { ok: r.semantic.ok, risk: r.semantic.risk, class: r.semantic.class, reason: r.semantic.reason, ms: Math.round(r.semantic.ms), cents: r.semantic.cents, model: r.semantic.model } : null, layered: r.layered })), null, 1));
    await Deno.writeTextFile(`${args.out}/${name}.summary.txt`, `set: ${file}\nmodel: ${client ? model : "(floor only)"}\n${summary}\n`);
  }
}
