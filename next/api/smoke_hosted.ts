// Smoke of the hosted `api` function (the real model, the owner's preview account): $0 checks first (health, login, me,
// conversations), then one turn, one edit and one Finish, stopping before any call that could pass the cap. Writes a report
// with every reply and the ledger before and after. The base URL comes from the secrets file and is never printed.
//   deno run --allow-net --allow-read --allow-env --allow-write next/api/smoke_hosted.ts [--cap 10] [--no-paid]
import { loadEnv } from "./lib/env.ts";

const args = Deno.args;
const cap = Number(args[args.indexOf("--cap") + 1] || 10) || 10;
const paid = !args.includes("--no-paid");
const env = await loadEnv();
const base = `${env.supabaseUrl}/functions/v1/api`;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const dir = new URL(`../../../../outputs/engine/verification/${stamp}-talk-hosted-smoke/`, import.meta.url);
await Deno.mkdir(dir, { recursive: true });
const lines: string[] = [`# Hosted Talk smoke ${stamp}`, "", `Function: api (Management API deploy), model claude-sonnet-5-5, thinking between_tools. Cap ${cap}¢.`, ""];
const log = (s: string) => { lines.push(s); console.log(s); };
const scrub = (s: string) => s.replaceAll(env.supabaseUrl, "<supabase-url>");

async function call(method: string, path: string, body?: unknown, token?: string) {
  const t0 = performance.now();
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", apikey: env.anonKey, "x-presence-tz": "Asia/Tehran", "x-presence-client": "smoke/0",
    ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json, ms: Math.round(performance.now() - t0), contract: res.headers.get("x-presence-contract") };
}

let r = await call("GET", "/health");
log(`- GET /health → ${r.status} in ${r.ms} ms, contract header ${r.contract}: ${scrub(JSON.stringify(r.json))}`);
r = await call("GET", "/me");
log(`- GET /me without bearer → ${r.status} error=${r.json.error} ref=${r.json.ref}`);
r = await call("POST", "/preview/login", { persona: "nami" });
const token = String(r.json.access_token ?? "");
log(`- POST /preview/login nami → ${r.status} in ${r.ms} ms, token ${token ? "yes" : "no"}, me.person.name=${((r.json.me as Record<string, unknown>)?.person as Record<string, unknown>)?.name}`);
if (!token) { await Deno.writeTextFile(new URL("report.md", dir), lines.join("\n")); Deno.exit(1); }
r = await call("GET", "/me", undefined, token);
log(`- GET /me → ${r.status}, settings keys ${Object.keys(((r.json.me as Record<string, unknown>)?.settings as Record<string, unknown>) ?? {}).length}`);
r = await call("GET", "/conversations", undefined, token);
log(`- GET /conversations → ${r.status}, ${((r.json.conversations as unknown[]) ?? []).length} conversation(s), active=${r.json.active ? "yes" : "null"}`);
const active = r.json.active as Record<string, unknown> | null;
const spend0 = await call("GET", "/preview/spend", undefined, token);
log(`- GET /preview/spend → ${spend0.status}: ${JSON.stringify(spend0.json)}`);
const today0 = Number(spend0.json.today_cents ?? 0);
const spent = async () => Number((await call("GET", "/preview/spend", undefined, token)).json.today_cents ?? 0) - today0;

if (paid) {
  lines.push("", "## Paid calls", "");
  if (active) { const f = await call("POST", "/talk/finish", { conversation_id: active.id, ratings: [] }, token); log(`- (an open conversation "${active.title}" was finished first → ${f.status}, ${f.ms} ms)`); }
  const T1 = "Dinner moved again tonight, third time this month, and nobody asked me. I just got the new time by text.";
  r = await call("POST", "/talk/turn", { conversation_id: null, text: T1, mode: "text" }, token);
  const conv = r.json.conversation as Record<string, unknown>, msg = r.json.message as Record<string, unknown>, reply = r.json.reply as Record<string, unknown>;
  log(`- POST /talk/turn → ${r.status} in ${r.ms} ms (latency_ms ${r.json.latency_ms})${r.status !== 200 ? ` ${JSON.stringify(r.json)}` : ""}`);
  if (r.status === 200) {
    log(`  - conversation "${conv.title}" ${String(conv.id).slice(0, 8)}; feeling ${msg.feeling}; state ${reply.state}; cards ${(reply.cards as unknown[]).length}; early_guess ${reply.early_guess ? "yes" : "null"}; ref ${reply.ref}`);
    log(`  - reflection: ${JSON.stringify(reply.reflection)}`); log(`  - question: ${JSON.stringify(reply.question)}`);
    for (const c of (reply.cards as Record<string, unknown>[])) log(`  - card "${c.label}" (${c.type}, ${c.area}, ${c.birth_mood}, ${c.confidence}): ${c.statement} — receipts ${JSON.stringify((c.receipts as Record<string, unknown>[]).map((x) => x.quote))}`);
    const eg = reply.early_guess as Record<string, unknown> | null; if (eg) log(`  - early guess "${eg.label}" (${eg.confidence}): ${eg.statement}`);
    let s = await spent(); log(`  - spent so far ${s}¢`);
    if (s <= cap - 4) {
      r = await call("POST", "/talk/edit", { message_id: msg.id, text: T1 + " It is a small thing but it stays with me." }, token);
      const rp = r.json.reply as Record<string, unknown>;
      log(`- POST /talk/edit → ${r.status} in ${r.ms} ms; superseded ${JSON.stringify(r.json.superseded)}; receipts_updated ${r.json.receipts_updated}; beliefs_removed ${JSON.stringify(r.json.beliefs_removed)}`);
      if (rp) { log(`  - reflection: ${JSON.stringify(rp.reflection)}`); log(`  - question: ${JSON.stringify(rp.question)}`); log(`  - cards ${(rp.cards as unknown[]).length}, feeling ${(r.json.message as Record<string, unknown>)?.feeling}, turn ${rp.turn}`);
        for (const c of (rp.cards as Record<string, unknown>[])) log(`  - card "${c.label}" (${c.confidence}): ${c.statement} — receipts ${JSON.stringify((c.receipts as Record<string, unknown>[]).map((x) => x.quote))}`); }
      s = await spent(); log(`  - spent so far ${s}¢`);
    } else log(`- edit skipped: ${s}¢ spent, cap ${cap}¢`);
    const cards = [...(reply.cards as Record<string, unknown>[]), ...((r.json.reply as Record<string, unknown>)?.cards as Record<string, unknown>[] ?? [])];
    if (s <= cap - 3) {
      const ratings = cards.slice(0, 1).map((c) => ({ belief_id: c.belief_id, rating: "very" }));
      r = await call("POST", "/talk/finish", { conversation_id: conv.id, ratings, not_now: [] }, token);
      log(`- POST /talk/finish → ${r.status} in ${r.ms} ms; added ${r.json.added}; to_confirm ${r.json.to_confirm}; ref ${r.json.ref}; summary: ${JSON.stringify(r.json.summary)}`);
      for (const b of (r.json.beliefs as Record<string, unknown>[]) ?? []) log(`  - belief "${b.label}" ${b.status} rating=${b.rating} patch=${JSON.stringify(b.patch)} receipts=${(b.receipts as unknown[]).length}`);
      s = await spent(); log(`  - spent so far ${s}¢`);
    } else log(`- finish skipped: ${s}¢ spent, cap ${cap}¢`);
  }
  const spend1 = await call("GET", "/preview/spend", undefined, token);
  log(``); log(`Ledger: ${JSON.stringify(spend0.json)} → ${JSON.stringify(spend1.json)}; this smoke ${Number(spend1.json.today_cents) - today0}¢.`);
}
await Deno.writeTextFile(new URL("report.md", dir), lines.join("\n") + "\n");
console.log(`report: ${dir.pathname}report.md`);
