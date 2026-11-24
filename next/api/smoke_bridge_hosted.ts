// Paid smoke of the hosted Bridge engine endpoints as one preview persona writing to another: one insight (Haiku) and one run (Sonnet: analyse,
// rewrite, verify), stopping before any call that could pass the cap. Writes a report with the replies and the ledger.
//   deno run --allow-net --allow-read --allow-env --allow-write next/api/smoke_bridge_hosted.ts [--cap 12] [--personas nami,lea]
import { loadEnv } from "./lib/env.ts";
const args = Deno.args;
const cap = Number(args[args.indexOf("--cap") + 1] || 12) || 12;
const pairAt = args.indexOf("--personas");
const [senderPersona, receiverPersona] = String(pairAt >= 0 ? args[pairAt + 1] : "nami,lea")
  .split(",").map((x) => x.trim().toLowerCase());
if (!senderPersona || !receiverPersona) throw new Error("--personas requires sender,receiver");
const env = await loadEnv();
const base = `${env.supabaseUrl}/functions/v1/api`;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const dir = new URL(`../../../../outputs/engine/verification/${stamp}-bridge-hosted-smoke/`, import.meta.url);
await Deno.mkdir(dir, { recursive: true });
const lines: string[] = [`# Hosted Bridge smoke ${stamp}`, "", `Function api; insight on claude-haiku-5-5 (thinking disabled), run on claude-sonnet-5-5 (between_tools). Cap ${cap}¢.`, ""];
const log = (s: string) => { lines.push(s); console.log(s); };
async function call(method: string, path: string, body?: unknown, token?: string) {
  const t0 = performance.now();
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", apikey: env.anonKey, "x-presence-tz": "Asia/Tehran", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const text = await res.text(); let json: Record<string, unknown> = {}; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json, ms: Math.round(performance.now() - t0) };
}
let r = await call("POST", "/preview/login", { persona: senderPersona });
const token = String(r.json.access_token ?? "");
r = await call("GET", "/people", undefined, token);
const receiver = ((r.json.people as Record<string, unknown>[]) ?? []).map((p) => p.person as Record<string, unknown>)
  .find((p) => String(p.name).toLowerCase() === receiverPersona);
if (!token || !receiver?.id) throw new Error(`preview pair unavailable: ${senderPersona},${receiverPersona}`);
const spend0 = await call("GET", "/preview/spend", undefined, token);
const today0 = Number(spend0.json.today_cents ?? 0);
const spent = async () => Number((await call("GET", "/preview/spend", undefined, token)).json.today_cents ?? 0) - today0;
log(`- login ${senderPersona}, ${String(receiver.name)} ${String(receiver.id).slice(0, 8)}; ledger before ${JSON.stringify(spend0.json)}`);
const TEXT = "You always change plans last minute, so thanks for that. I moved my whole evening around for nothing.";
r = await call("POST", "/bridge/insight", { person_id: receiver.id, text: TEXT }, token);
log(`- POST /bridge/insight → ${r.status} in ${r.ms} ms: state ${r.json.state}, tone ${r.json.tone}, ${((r.json.spans as unknown[]) ?? []).length} span(s), ${((r.json.points as unknown[]) ?? []).length} point(s), ref ${r.json.ref}`);
for (const s of (r.json.spans as Record<string, unknown>[]) ?? []) log(`  - ${s.kind} "${TEXT.slice(Number(s.start), Number(s.end))}" (${s.friction_kind ?? s.label}): ${s.note}`);
let s = await spent(); log(`  - spent so far ${s}¢`);
if (s <= cap - 8) {
  r = await call("POST", "/bridge/run", { person_id: receiver.id, text: TEXT }, token);
  log(`- POST /bridge/run → ${r.status} in ${r.ms} ms (latency_ms ${r.json.latency_ms}): outcome ${r.json.outcome}, tone ${JSON.stringify(r.json.tone)}, points_line ${JSON.stringify(r.json.points_line)}, ref ${r.json.ref}${r.status !== 200 ? " " + JSON.stringify(r.json) : ""}`);
  log(`  - bridged: ${JSON.stringify(r.json.bridged)}`);
  for (const c of (r.json.changes as Record<string, unknown>[]) ?? []) log(`  - change (${c.kind}): "${c.original}" → "${c.to}" — ${c.why}`);
  for (const p of (r.json.points as Record<string, unknown>[]) ?? []) log(`  - point (${p.kind}) "${p.quote}" kept=${p.kept}`);
  if (r.json.line) log(`  - line: ${r.json.line}`);
  s = await spent(); log(`  - spent so far ${s}¢`);
} else log(`- run skipped: ${s}¢ spent, cap ${cap}¢`);
const spend1 = await call("GET", "/preview/spend", undefined, token);
log(``); log(`Ledger after ${JSON.stringify(spend1.json)}; this smoke ${Number(spend1.json.today_cents) - today0}¢.`);
await Deno.writeTextFile(new URL("report.md", dir), lines.join("\n") + "\n");
console.log(`report: ${dir.pathname}report.md`);
