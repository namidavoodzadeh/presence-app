// E27 (1), CEO 09:55 PT 07 Nov: the Bridge golden gate. Runs every case in next/evals/bridge_golden.json through
// POST /eval/bridge/run (the same code as POST /bridge/run, fed the case's fictional maps) on the REAL model, scores each
// reply with next/evals/bridge_golden.ts, writes outputs/engine/evals/bridge-golden-<date>.md, and exits 1 on any miss.
// Stub replies never count for Bridge quality.
//
//   In process (no server to start or stop; the api handler is called directly, real model, this Mac's secrets):
//     deno run --allow-net --allow-read --allow-env --allow-write next/scripts/eval_bridge_golden.ts --inproc [--cap 600] [--cases g01,g02]
//   Against a running local server started with PRESENCE_BRIDGE_EVAL=true and PRESENCE_BRIDGE_EVAL_TOKEN=<token>:
//     PRESENCE_BRIDGE_EVAL_TOKEN=<token> deno run ... next/scripts/eval_bridge_golden.ts --base http://localhost:8820 [--cap 600]
// The route is closed on hosted, so a hosted base URL answers 404 for every case (a miss, never a pass).

import { evalBody, loadGolden, scoreAnalysis, scoreCase, type Score } from "../evals/bridge_golden.ts";

type R = Record<string, unknown>;
const args = Deno.args;
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const inproc = args.includes("--inproc");
const baseArg = flag("base");
if (!inproc && !baseArg) {
  console.error("give --inproc or --base <url>");
  Deno.exit(2);
}
const cap = Number(flag("cap") ?? "600");
// --level analysis scores E27 (2) alone (frictions and belief touches, from the eval-only analysis field); the gate is --level full.
const level = flag("level") ?? "full";
if (level !== "full" && level !== "analysis") {
  console.error("--level is full or analysis");
  Deno.exit(2);
}
const only = flag("cases")?.split(",").map((x) => x.trim()).filter(Boolean) ?? null;

let token = Deno.env.get("PRESENCE_BRIDGE_EVAL_TOKEN") ?? "";
let send: (body: R) => Promise<{ status: number; json: R; ms: number }>;
if (inproc) {
  // This process is the server: open the eval door for itself only, with a token nobody else holds.
  token = crypto.randomUUID() + crypto.randomUUID();
  Deno.env.set("PRESENCE_BRIDGE_EVAL", "true");
  Deno.env.set("PRESENCE_BRIDGE_EVAL_TOKEN", token);
  const { handler } = await import("../api/index.ts");
  send = async (body) => {
    const t0 = performance.now();
    const res = await handler(new Request("http://inproc/eval/bridge/run", { method: "POST", headers: { "content-type": "application/json", "x-presence-eval-token": token }, body: JSON.stringify(body) }));
    const text = await res.text();
    let json: R = {};
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json, ms: Math.round(performance.now() - t0) };
  };
} else {
  const base = baseArg!.replace(/\/$/, "");
  send = async (body) => {
    const t0 = performance.now();
    const res = await fetch(`${base}/eval/bridge/run`, { method: "POST", headers: { "content-type": "application/json", "x-presence-eval-token": token }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    let json: R = {};
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json, ms: Math.round(performance.now() - t0) };
  };
}

const golden = await loadGolden();
const cases = golden.cases.filter((c) => !only || only.some((o) => c.id === o || c.id.startsWith(`${o}_`)));
const stamp = new Date().toISOString();
const date = stamp.slice(0, 10);
const lines: string[] = [
  `# Bridge golden gate ${stamp}`,
  "",
  `Target: ${inproc ? "in process (api handler, real model)" : baseArg}. Level: ${level}. Cases: ${cases.length} of ${golden.cases.length}. Run cap ${cap}¢ (40¢ per call).`,
  "",
];
const log = (s: string) => {
  lines.push(s);
  console.log(s);
};

let spent = 0;
const scores: Score[] = [];
for (const c of cases) {
  if (spent + 40 > cap) {
    scores.push({ id: c.id, pass: false, misses: [`not run: the next call could pass the ${cap}¢ cap (${spent}¢ spent)`] });
    log(`## ${c.id}: NOT RUN (cap)`);
    continue;
  }
  const r = await send(evalBody(c));
  const cents = Number((r.json.eval as R | undefined)?.cents ?? 0);
  spent += cents;
  const score = r.status === 200 ? (level === "analysis" ? scoreAnalysis : scoreCase)(c, r.json) : { id: c.id, pass: false, misses: [`http ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`] };
  scores.push(score);
  log(`## ${c.id}: ${score.pass ? "PASS" : "MISS"} (${r.ms} ms, ${cents}¢)`);
  log("");
  log(`- draft: ${JSON.stringify(c.draft)}`);
  log(`- outcome: ${String(r.json.outcome)}; safety: ${String(r.json.safety ?? null)}; line: ${JSON.stringify(r.json.line ?? null)}${r.json.ref ? `; ref: ${String(r.json.ref)}` : ""}`);
  log(`- summary: ${JSON.stringify(r.json.summary ?? null)}`);
  log(`- bridged: ${JSON.stringify(r.json.bridged ?? null)}`);
  for (const h of (Array.isArray(r.json.highlights) ? r.json.highlights : []) as R[]) {
    const you = ((h.from_you as R[]) ?? []).map((y) => `${y.belief_id} "${y.receipt}"`).join("; ") || "none";
    const them = ((h.from_them as R[]) ?? []).map((t) => `${t.belief_id} "${t.wording}"`).join("; ") || "none";
    log(`- highlight ${JSON.stringify(h.original)} → ${JSON.stringify(h.suggested)}: ${String(h.why_line)} (from you: ${you}; from them: ${them})`);
  }
  const a = (r.json.eval as R | undefined)?.analysis as R | null | undefined;
  if (a) {
    log(`- analysis frictions: ${((a.frictions as R[]) ?? []).map((f) => `${f.kind} ${JSON.stringify(f.quote)}`).join("; ") || "none"}`);
    log(`- analysis from you: ${((a.from_you as R[]) ?? []).map((y) => `${y.belief_id} "${y.receipt}" (${y.date})`).join("; ") || "none"}`);
    log(`- analysis from them: ${((a.from_them as R[]) ?? []).map((t) => `${t.belief_id} "${t.wording}": ${t.why}`).join("; ") || "none"}`);
  }
  if (!score.pass) {
    for (const [i, at] of (((r.json.eval as R | undefined)?.attempts as R[] | undefined) ?? []).entries()) {
      log(`- attempt ${i + 1}: ${JSON.stringify(at.bridged)}${at.context_note ? ` | context: ${JSON.stringify(at.context_note)}` : ""}`);
      const vs = (at.versions as string[] | undefined) ?? [];
      if (vs.length > 1) log(`  - versions offered: ${vs.map((v) => `${JSON.stringify(v)} (${v.split(/\s+/).filter(Boolean).length}w)`).join(" | ")}`);
      for (const f of (at.failed_checks as string[]) ?? []) log(`  - code: ${f}`);
      const cr = at.critic as R | null;
      if (cr && !cr.pass) log(`  - critic: ${JSON.stringify({ missing: cr.points_missing, added: cr.added, inner: cr.receiver_inner_life, voice: cr.voice, feeling: cr.feeling_preserved, notes: cr.notes })}`);
    }
  }
  for (const m of score.misses) log(`- MISS ${m}`);
  log("");
}

const passed = scores.filter((s) => s.pass).length;
lines.splice(4, 0, `**${passed} of ${scores.length} pass; ${spent}¢ spent.** ${passed === scores.length ? "Gate green." : `Gate red: ${scores.filter((s) => !s.pass).map((s) => s.id).join(", ")}.`}`, "");
console.log(`\n${passed}/${scores.length} pass, ${spent}¢`);
const opsHome = Deno.env.get("PRESENCE_OPERATIONS_HOME"); // overrides the checkout-relative default, as in deploy_gate.py
const dir = opsHome ? new URL("outputs/engine/evals/", "file://" + encodeURI(opsHome.replace(/\/?$/, "/"))) : new URL("../../../../outputs/engine/evals/", import.meta.url);
await Deno.mkdir(dir, { recursive: true });
// --tag names a partial or diagnostic run's file, so it never overwrites the day's gate report.
const tag = flag("tag");
const out = new URL(`bridge-golden-${date}${level === "analysis" ? "-analysis" : ""}${tag ? `-${tag.replace(/[^a-z0-9-]/gi, "")}` : ""}.md`, dir);
await Deno.writeTextFile(out, lines.join("\n") + "\n");
console.log(`wrote ${out.pathname}`);
Deno.exit(passed === scores.length ? 0 : 1);
