// QA-B298 local timing (no AI, no network): the real POST /bridge/insight handler, the real AnthropicClient and
// PostgresLedger, with a fake Supabase (every query or rpc resolves after RTT ms) and a fake Anthropic fetch (each
// call resolves after MODEL ms). It counts the database round trips that sit in series on the critical path, per
// model call and around it, so the server's own share of the wait can be read off apart from the model's.
//
//   deno run -A next/scripts/b298_local_timing.ts            # prints one JSON report
//
// Laws: fictional draft only, nothing leaves the process.

import { routes } from "../api/lib/router.ts";
import { hooks, INSIGHT_MODEL } from "../api/bridge_engine.ts";
import "../api/bridge_engine.ts";
import { AnthropicClient } from "../engine/model/client.ts";

const OWNER = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const DRAFT = "You always change plans at the last minute and I end up waiting around for you.";

let RTT = 0, MODEL = 0, FIRST_REPLY_BROKEN = false;
const ops: { name: string; start: number; end: number }[] = [];
let t0 = 0;

function dataFor(name: string): unknown {
  if (name === "rpc:ledger_reserve") return { ok: true, id: "ledger-1" };
  if (name.startsWith("rpc:")) return null;
  if (name.startsWith("profiles")) return { name: "Sam" };
  if (name.startsWith("link_prefs")) return { relationship: "partner" };
  return name.endsWith(":single") ? null : [];
}

function fakeDb(label: string): unknown {
  const chain = (name: string): unknown => {
    const p: Record<string | symbol, unknown> = {};
    return new Proxy(p, {
      get(_t, key) {
        if (key === "then") {
          return (ok: (v: unknown) => void) => {
            const start = performance.now() - t0;
            setTimeout(() => {
              ops.push({ name: `${label}:${name}`, start, end: performance.now() - t0 });
              ok({ data: dataFor(name), error: null });
            }, RTT);
          };
        }
        if (key === "single" || key === "maybeSingle") return () => chain(name.split(":")[0] + ":single");
        return () => chain(name);
      },
    });
  };
  return { from: (table: string) => chain(table), rpc: (fn: string) => chain(`rpc:${fn}`) };
}

function analyseJson(broken: boolean): string {
  if (broken) return "not json at all";
  return JSON.stringify({
    points: [{ kind: "complaint", quote: "You always change plans at the last minute" }],
    frictions: [{ quote: "You always", kind: "absolute", how_it_lands: "Always can sound like a verdict." }],
    activated: [], feeling: { name: "frustrated", intensity: 2 }, tone: "tense", safety: { level: "none", reason: "" },
  });
}

let calls = 0;
const fakeFetch: typeof fetch = (_url, _init) => {
  const n = ++calls;
  return new Promise((ok) => setTimeout(() => ok(new Response(JSON.stringify({
    id: `msg_${n}`, model: INSIGHT_MODEL, stop_reason: "end_turn",
    content: [{ type: "text", text: analyseJson(FIRST_REPLY_BROKEN && n === 1) }],
    usage: { input_tokens: 1200, output_tokens: 200 },
  }), { status: 200, headers: { "content-type": "application/json" } })), MODEL));
};

hooks.client = (_ctx, ledger) => new AnthropicClient({
  config: { key: "local", workspace: "local" }, ledger, defaultModel: INSIGHT_MODEL, fallbackModel: null, thinking: "disabled", timeoutMs: 30_000, fetchImpl: fakeFetch,
});

const route = routes.find((r) => r.method === "POST" && r.pattern.test("/bridge/insight"))!;

async function once(rtt: number, model: number, broken: boolean) {
  RTT = rtt; MODEL = model; FIRST_REPLY_BROKEN = broken; calls = 0; ops.length = 0;
  const user = fakeDb("caller"), service = fakeDb("service");
  const ctx = {
    env: { anthropicKey: "local", anthropicWorkspace: "local" }, req: new Request("http://local/bridge/insight", { method: "POST" }),
    url: new URL("http://local/bridge/insight"), params: {}, tz: "UTC",
    caller: { id: OWNER, db: user, isPreview: false }, service,
    body: () => Promise.resolve({ person_id: OTHER, text: DRAFT }),
  };
  t0 = performance.now();
  // deno-lint-ignore no-explicit-any
  const res = await route.handler(ctx as any);
  const total = performance.now() - t0;
  const reply = await res.json();
  await new Promise((r) => setTimeout(r, rtt * 4 + 20)); // let after-reply writes land so they are listed, not timed
  return { total: Math.round(total), state: reply.state, modelCalls: calls, ops: ops.map((o) => ({ ...o, start: Math.round(o.start), end: Math.round(o.end) })) };
}

/** Database round trips in series before the reply: group ops by overlapping windows that end before `total`. */
function serial(ops: { name: string; start: number; end: number }[], total: number) {
  const before = ops.filter((o) => o.end <= total + 1).sort((a, b) => a.start - b.start);
  const waves: string[][] = [];
  let edge = -1;
  for (const o of before) {
    if (o.start >= edge) { waves.push([o.name]); edge = o.end; } else { waves[waves.length - 1].push(o.name); edge = Math.max(edge, o.end); }
  }
  return waves;
}

await once(0, 0, false); // warm the module graph and regex caches
const compute = [];
for (let i = 0; i < 20; i++) compute.push((await once(0, 0, false)).total);
compute.sort((a, b) => a - b);

const RTT_MS = 100, MODEL_MS = 2000;
const ok = await once(RTT_MS, MODEL_MS, false);
const repair = await once(RTT_MS, MODEL_MS, true);
const report = {
  note: "local, fake DB and fake model; RTT and MODEL are inputs, not measurements of hosted",
  compute_ms_median: compute[10], compute_ms_max: compute[19],
  with: { db_rtt_ms: RTT_MS, model_ms: MODEL_MS },
  first_reply_parses: { total_ms: ok.total, state: ok.state, model_calls: ok.modelCalls, serial_db_waves: serial(ok.ops, ok.total).length, waves: serial(ok.ops, ok.total),
    after_reply: ok.ops.filter((o) => o.end > ok.total + 1).map((o) => o.name) },
  first_reply_unreadable: { total_ms: repair.total, state: repair.state, model_calls: repair.modelCalls, serial_db_waves: serial(repair.ops, repair.total).length },
};
console.log(JSON.stringify(report, null, 1));
