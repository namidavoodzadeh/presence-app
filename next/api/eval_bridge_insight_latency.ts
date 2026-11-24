// E26 NEXT item 5: "Latency within the doc's budget. Tests first, using recorded fixtures." Measures
// POST /bridge/insight latency against the live server (docs/BRIDGE-INSIGHT.md §4: 1.5 s median,
// 2.5 s p90 for refreshes that reach the model) using the already-reviewed W3.3 draft bank
// (next/evals/bridge/w3-3-v1) as fixtures, so this run adds no new fictional data. blame_frame and
// negative_crisis drafts reach the analyse call; positive_safety drafts must decline at the floor
// (no call) and stay fast regardless of budget.
//   deno run --allow-net --allow-read --allow-env --allow-write next/api/eval_bridge_insight_latency.ts [--cap 20] [--sender lea] [--receiver mom]
import { loadEnv } from "./lib/env.ts";

type R = Record<string, unknown>;
const args = Deno.args;
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const cap = Number(flag("cap", "20"));
const senderPersona = flag("sender", "lea");
const receiverPersona = flag("receiver", "mom");

const env = await loadEnv();
const base = `${env.supabaseUrl}/functions/v1/api`;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const dir = new URL(
  `../../../../outputs/engine/verification/${stamp}-bridge-insight-latency/`,
  import.meta.url,
);
await Deno.mkdir(dir, { recursive: true });
const lines: string[] = [
  `# Bridge insight latency eval ${stamp}`,
  "",
  `Budget (docs/BRIDGE-INSIGHT.md §4): median ≤ 1500 ms, p90 ≤ 2500 ms, measured over the eval set against the live server.`,
  `Fixtures: next/evals/bridge/w3-3-v1 (26 drafts, unchanged source, sha-locked by next/tests/bridge_w3_3_eval_test.ts). Sender ${senderPersona} → receiver ${receiverPersona}. Cap ${cap}¢.`,
  "",
];
const log = (s: string) => {
  lines.push(s);
  console.log(s);
};

async function call(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    apikey: env.anonKey,
    "x-presence-tz": "Asia/Tehran",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  // env.isHosted describes this script's own runtime (never true for a local Deno run), not whether
  // the target base URL is the hosted project, so the header goes along whenever we have the secret.
  if (env.previewDeviceSecret) headers["x-presence-preview-secret"] = env.previewDeviceSecret;
  const t0 = performance.now();
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json: R = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json, ms: Math.round(performance.now() - t0) };
}

let r = await call("POST", "/preview/login", { persona: senderPersona });
const senderToken = String(r.json.access_token ?? "");
r = await call("POST", "/preview/login", { persona: receiverPersona });
const receiverToken = String(r.json.access_token ?? "");
const receiverId = String(((r.json.me as R)?.person as R)?.id ?? "");
if (!senderToken || !receiverToken || !receiverId) {
  throw new Error(`preview pair unavailable: ${senderPersona},${receiverPersona}`);
}

const spend0 = await call("GET", "/preview/spend", undefined, senderToken);
const today0 = Number(spend0.json.today_cents ?? 0);
const spent = async () =>
  Number((await call("GET", "/preview/spend", undefined, senderToken)).json.today_cents ?? 0) - today0;

const blame = JSON.parse(
  await Deno.readTextFile(new URL("../evals/bridge/w3-3-v1/cases.json", import.meta.url)),
);
const positive = JSON.parse(
  await Deno.readTextFile(new URL("../evals/bridge/w3-3-v1/positive_safety_cases.json", import.meta.url)),
);
const cases = [...blame.cases as R[], ...positive.cases as R[]] as {
  id: string;
  kind: string;
  sender_input: string;
}[];

const modeled: { id: string; kind: string; ms: number }[] = [];
const declined: { id: string; kind: string; ms: number; state: unknown }[] = [];
let stopped = "";
for (const c of cases) {
  if (await spent() >= cap) {
    stopped = `stopped early at ${c.id}: cap ${cap}¢ reached`;
    log(`- ${stopped}`);
    break;
  }
  r = await call("POST", "/bridge/insight", { person_id: receiverId, text: c.sender_input }, senderToken);
  if (r.status !== 200) {
    log(`! ${c.id} (${c.kind}) → ${r.status} ${JSON.stringify(r.json)}`);
    continue;
  }
  if (r.json.state === "declined") declined.push({ id: c.id, kind: c.kind, ms: r.ms, state: r.json.state });
  else modeled.push({ id: c.id, kind: c.kind, ms: r.ms });
  log(`- ${c.id} (${c.kind}) → ${r.status} in ${r.ms} ms, state ${r.json.state}`);
}
const spentCents = await spent();

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
const msValues = modeled.map((m) => m.ms);
const median = percentile(msValues, 50), p90 = percentile(msValues, 90);
const budgetOk = modeled.length > 0 && median <= 1500 && p90 <= 2500;
const unexpectedDecline = declined.filter((d) => d.kind !== "positive_safety");
const missedDecline = modeled.filter((m) => m.kind === "positive_safety");

log("");
log(`## Modeled drafts (analyse call reached): ${modeled.length}`);
log(`- median ${median} ms, p90 ${p90} ms → ${budgetOk ? "PASS" : "FAIL"} against 1500/2500 ms`);
log(`## Declined at the floor (no call): ${declined.length} (expected: positive_safety only)`);
if (unexpectedDecline.length) {
  log(`- FAIL: declined but not positive_safety: ${unexpectedDecline.map((d) => d.id).join(", ")}`);
}
if (missedDecline.length) {
  log(
    `- FAIL: positive_safety reached the model instead of declining: ${
      missedDecline.map((m) => m.id).join(", ")
    }`,
  );
}
log(`## Ledger: ${spentCents}¢ spent this run (cap ${cap}¢)${stopped ? `, ${stopped}` : ""}`);

await Deno.writeTextFile(new URL("report.md", dir), lines.join("\n") + "\n");
console.log(`report: ${dir.pathname}report.md`);

const pass = budgetOk && unexpectedDecline.length === 0 && missedDecline.length === 0 && !stopped;
Deno.exit(pass ? 0 : 1);
