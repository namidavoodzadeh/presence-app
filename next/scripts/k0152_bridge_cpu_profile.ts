// K-0152: reproducible CPU timing for the real /bridge/insight handler.  It
// uses recorded model replies and an in-process Supabase double: no person's
// words, credentials or network leave the process.
//
//   deno run --allow-read --allow-env --allow-write --allow-run next/scripts/k0152_bridge_cpu_profile.ts

import { routes } from "../api/lib/router.ts";
import { drainAfterReply, hooks, INSIGHT_MODEL } from "../api/bridge_engine.ts";
import "../api/bridge_engine.ts";
import { AnthropicClient } from "../engine/model/client.ts";

const OWNER = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const DRAFTS = [
  "When plans change at the last minute, I end up rearranging my whole evening and feel as though my time did not matter.",
  "I want us to talk about how we decide weekends, because I keep learning the plan after everyone else has already agreed to it.",
  "I care about getting this right, but when the answer changes after I have asked twice, I do not know what I can rely on.",
];

const beliefs = Array.from({ length: 30 }, (_, n) => ({
  id: `belief-${n}`, owner: OWNER, label: `Steady ${n}`, statement: `Part of you needs steady plans number ${n}.`,
  status: "confirmed", rating: "very", confidence: 0.8, created_at: `2026-01-${String((n % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
}));

function db(): unknown {
  const result = (name: string) => {
    if (name === "rpc:ledger_reserve") return { ok: true, id: "ledger-1" };
    if (name.startsWith("rpc:")) return null;
    if (name === "beliefs") return beliefs;
    if (name === "profiles:single") return { name: "Sam" };
    if (name === "links:single") return { status: "active" };
    if (name === "link_prefs:single") return { relationship: "partner", share_on: false };
    return name.endsWith(":single") ? null : [];
  };
  const chain = (name: string): unknown => new Proxy({}, {
    get: (_target, key) => {
      if (key === "then") return (ok: (value: unknown) => void) => ok({ data: result(name), error: null });
      if (key === "insert") return (value: unknown) => {
        if (name === "engine_calls") traceBytes += JSON.stringify(value).length;
        return Promise.resolve({ data: null, error: null });
      };
      if (key === "single" || key === "maybeSingle") return () => chain(`${name.split(":")[0]}:single`);
      return () => chain(name);
    },
  });
  return { from: (table: string) => chain(table), rpc: (fn: string) => chain(`rpc:${fn}`) };
}

const semantic = JSON.stringify({ act: "talk about plans", purpose: "neither", risk: "none", class: "ordinary", reason: "no bodily harm described" });
const analysis = JSON.stringify({
  points: [{ kind: "complaint", quote: "plans change at the last minute" }],
  frictions: [{ quote: "at the last minute", kind: "specific", how_it_lands: "This names the moment clearly." }],
  activated: [], feeling: { name: "frustrated", intensity: 2 }, tone: "tense", safety: { level: "none", reason: "" },
});
let calls = 0, traceBytes = 0;
const fakeFetch: typeof fetch = (_url, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  const max = Number(body.max_tokens ?? 0);
  const text = max <= 120 ? semantic : analysis;
  calls++;
  return Promise.resolve(new Response(JSON.stringify({
    id: `recorded-${calls}`, model: INSIGHT_MODEL, stop_reason: "end_turn", content: [{ type: "text", text }],
    usage: { input_tokens: 900, output_tokens: 160 },
  }), { headers: { "content-type": "application/json" } }));
};

hooks.client = (_ctx, ledger) => new AnthropicClient({
  config: { key: "local", workspace: "local" }, ledger, defaultModel: INSIGHT_MODEL, fallbackModel: null,
  thinking: "disabled", timeoutMs: 30_000, fetchImpl: fakeFetch,
});

const route = routes.find((r) => r.method === "POST" && r.pattern.test("/bridge/insight"))!;

async function one(text: string) {
  calls = 0; traceBytes = 0;
  const caller = db(), service = db();
  const ctx = {
    env: { anthropicKey: "local", anthropicWorkspace: "local", safetySemantic: true, commItems: false },
    req: new Request("http://local/bridge/insight", { method: "POST" }), url: new URL("http://local/bridge/insight"), params: {}, tz: "UTC",
    caller: { id: OWNER, db: caller, isPreview: false }, service,
    body: () => Promise.resolve({ person_id: OTHER, text }),
  };
  const started = performance.now();
  // deno-lint-ignore no-explicit-any
  const response = await route.handler(ctx as any);
  const replied = performance.now();
  await drainAfterReply();
  const traced = performance.now();
  return { reply_ms: Number((replied - started).toFixed(2)), trace_ms: Number((traced - replied).toFixed(2)), trace_bytes: traceBytes, calls, state: (await response.json()).state };
}

// Warm Deno's module graph, regexp JIT and WebCrypto implementation before the recorded timings.
await one(DRAFTS[0]);
const samples = [];
for (const text of DRAFTS) samples.push(await one(text));
console.log(JSON.stringify({
  fixture: { drafts: DRAFTS.length, sender_beliefs: beliefs.length, model: "recorded", network: false },
  samples,
  interpretation: "reply_ms covers floor regexes, semantic prompt/model JSON, map/pair loading and analysis; trace_ms covers redaction/hash plus ledger trace writes.",
}, null, 2));
