// Paid smoke of the hosted Mirror pipeline as Nami: POST /preview/mirror-sample (ten example moments through Haiku, the gate, Sonnet
// behind it) with a cap, then GET /mirror and GET /map; writes a report with what surfaced and the ledger. Nothing is removed:
// the sample is the owner's to rate on his phone.
//   deno run --allow-net --allow-read --allow-env --allow-write next/api/smoke_mirror_hosted.ts [--cap 10]
import { loadEnv } from "./lib/env.ts";
const args = Deno.args;
const cap = Number(args[args.indexOf("--cap") + 1] || 10) || 10;
const env = await loadEnv();
const base = `${env.supabaseUrl}/functions/v1/api`;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const dir = new URL(`../../../../outputs/engine/verification/${stamp}-mirror-hosted-smoke/`, import.meta.url);
await Deno.mkdir(dir, { recursive: true });
type R = Record<string, unknown>;
const lines: string[] = [`# Hosted Mirror smoke ${stamp}`, "", `Function api; observe on claude-haiku-5-5 (thinking disabled), synthesis on claude-sonnet-5-5 (between_tools). Cap ${cap}¢.`, ""];
const log = (s: string) => { lines.push(s); console.log(s); };
async function call(method: string, path: string, body?: unknown, token?: string) {
  const t0 = performance.now();
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", apikey: env.anonKey, "x-presence-tz": "Asia/Tehran", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(170_000) });
  const text = await res.text(); let json: R = {}; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json, ms: Math.round(performance.now() - t0) };
}
let r = await call("POST", "/preview/login", { persona: "nami" });
const token = String(r.json.access_token ?? "");
const spend0 = await call("GET", "/preview/spend", undefined, token);
log(`- login nami; ledger before ${JSON.stringify(spend0.json)}`);
r = await call("POST", "/preview/mirror-sample", { cap_cents: cap }, token);
log(`- POST /preview/mirror-sample → ${r.status} in ${r.ms} ms: contributions ${r.json.contributions}, processed ${JSON.stringify(r.json.processed)}, spent ${r.json.spent_cents}¢, stopped ${JSON.stringify(r.json.stopped)}, ref ${r.json.ref}${r.status !== 200 ? " " + JSON.stringify(r.json) : ""}`);
for (const p of (r.json.surfaced as R[]) ?? []) {
  log(`  - surfaced (${p.variant}): "${p.label}" [${p.type}; ${p.area}] ${p.line}`);
  log(`    statement: ${p.statement}`);
  log(`    summary: ${p.summary}`);
}
for (const s of (r.json.seen_by_others as R[]) ?? []) log(`  - seen by others: belief ${s.belief_id} (${s.people} people, ${s.moments} moments)`);
log(`  - mirror: ${JSON.stringify(r.json.mirror)}`);
r = await call("GET", "/map", undefined, token);
log(`- GET /map → ${r.status}: counts ${JSON.stringify(r.json.counts)}, outside cards ${((r.json.outside as R[]) ?? []).length}`);
const spend1 = await call("GET", "/preview/spend", undefined, token);
log(``); log(`Ledger after ${JSON.stringify(spend1.json)}; this smoke ${Number(spend1.json.today_cents) - Number(spend0.json.today_cents)}¢.`);
await Deno.writeTextFile(new URL("report.md", dir), lines.join("\n") + "\n");
console.log(`report: ${dir.pathname}report.md`);
