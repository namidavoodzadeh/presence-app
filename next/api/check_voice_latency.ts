// Hosted latency spike for NEXT 2026-10-28 20:58. Uses a throwaway non-preview account and fictional first
// turns, measures transcript submission through the complete Talk reply, and deletes the account afterward.
// Reports metadata only: ids, timing, tokens and cents; never the fictional words or model reply.
//
//   deno run --allow-net --allow-read --allow-env --allow-write api/check_voice_latency.ts --calls 10 --cap 30

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

type Row = Record<string, unknown>;
type Sample = {
  call: number;
  status: number;
  conversation_id: string | null;
  client_ms: number;
  handler_ms: number | null;
  auth_ms: number | null;
  route_ms: number | null;
  api_latency_ms: number | null;
  model_ms: number;
  model_calls: number;
  engine_call_ids: string[];
  input_tokens: number;
  output_tokens: number;
  cents: number;
  state: string | null;
};

const env = await loadEnv();
const service = serviceClient(env);
const base = `${env.supabaseUrl}/functions/v1/api`;
const valueAfter = (name: string, fallback: number) => {
  const at = Deno.args.indexOf(name);
  return at >= 0 ? Number(Deno.args[at + 1]) : fallback;
};
const requestedCalls = Math.max(1, Math.min(20, valueAfter("--calls", 10)));
const capCents = Math.max(1, Math.min(30, valueAfter("--cap", 30)));
const silenceMs = 1_200;
// Current first-turn admission is 4 cents per model attempt and Talk makes at most one repair. Two cents of
// headroom makes this a conservative route bound. The script verifies the actual reservations after every call.
const routeWorstCents = 10;
const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const reportDir = new URL(`../reports/${stamp}-voice-live-latency/`, import.meta.url);

const fictionalTurns = [
  "A fictional dinner plan changed twice, and the last update arrived by text.",
  "A fictional project meeting moved after I had already cleared the afternoon.",
  "A fictional friend cancelled our walk after I had reached the meeting place.",
  "A fictional family call ended before I could explain why the timing mattered.",
  "A fictional work handoff changed after I had written down the agreed steps.",
  "A fictional neighbour borrowed a tool and returned it without the missing part.",
  "A fictional class schedule changed after I had arranged the rest of the day.",
  "A fictional group chose a date while I was away and told me afterward.",
  "A fictional appointment started late after I had arrived early to prepare.",
  "A fictional shared task was reassigned after I had nearly finished my part.",
];

function timing(header: string | null, name: string): number | null {
  const part = (header ?? "").split(",").map((x) => x.trim()).find((x) => x.startsWith(`${name};`));
  const found = part?.match(/(?:^|;)dur=([0-9.]+)/);
  return found ? Number(found[1]) : null;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

async function spentCents(person: string): Promise<number> {
  const { data, error } = await service.from("usage_ledger")
    .select("reserved_micros,spent_micros")
    .eq("person", person)
    .gte("created_at", startedAt);
  if (error) throw new Error(`ledger read: ${error.message}`);
  return (data ?? []).reduce(
    (sum, row) => sum + Number(row.spent_micros ?? row.reserved_micros ?? 0) / 10_000,
    0,
  );
}

async function reservedSince(person: string, since: string): Promise<number> {
  const { data, error } = await service.from("usage_ledger")
    .select("reserved_micros")
    .eq("person", person)
    .gte("created_at", since);
  if (error) throw new Error(`reservation read: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + Number(row.reserved_micros ?? 0) / 10_000, 0);
}

async function callTurn(token: string, text: string) {
  const started = performance.now();
  const response = await fetch(`${base}/talk/turn`, {
    method: "POST",
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-presence-client": "engine-voice-spike/1",
      "x-presence-tz": "Asia/Tehran",
    },
    body: JSON.stringify({ conversation_id: null, text, mode: "voice" }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({})) as Row;
  return {
    status: response.status,
    body,
    clientMs: performance.now() - started,
    serverTiming: response.headers.get("server-timing"),
  };
}

const runId = crypto.randomUUID();
const email = `voice-latency-${runId}@preview.presence.app`;
const password = `voice-latency-${crypto.randomUUID()}`;
let userId = "";
const samples: Sample[] = [];
let cleanupError: string | null = null;

try {
  const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || !made.data.user) throw new Error(`create throwaway: ${made.error?.message ?? "no user"}`);
  userId = made.data.user.id;
  const profile = await service.from("profiles").insert({
    id: userId,
    name: "Voice Latency Check",
    is_example: false,
    is_preview: false,
    tz: "Asia/Tehran",
  });
  if (profile.error) throw new Error(`create profile: ${profile.error.message}`);

  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    throw new Error(`sign in throwaway: ${signed.error?.message ?? "no session"}`);
  }
  const token = signed.data.session.access_token;

  for (let i = 0; i < requestedCalls; i++) {
    const spentBefore = await spentCents(userId);
    if (spentBefore + routeWorstCents > capCents) break;
    const callStartedAt = new Date().toISOString();
    const result = await callTurn(token, fictionalTurns[i % fictionalTurns.length]);
    const conversation = result.body.conversation as Row | undefined;
    const conversationId = typeof conversation?.id === "string" ? conversation.id : null;
    const { data: traces, error: traceError } = conversationId
      ? await service.from("engine_calls")
        .select("id,purpose,ms,cents,input_tokens,output_tokens")
        .eq("person", userId)
        .eq("conversation_id", conversationId)
        .order("created_at")
      : { data: [] as Row[], error: null };
    if (traceError) throw new Error(`trace read: ${traceError.message}`);
    const rows = (traces ?? []) as Row[];
    const reservation = await reservedSince(userId, callStartedAt);
    if (reservation > routeWorstCents) {
      throw new Error(
        `route reservation ${reservation} cents exceeded the ${routeWorstCents}-cent spike bound`,
      );
    }
    const reply = result.body.reply as Row | undefined;
    samples.push({
      call: i + 1,
      status: result.status,
      conversation_id: conversationId,
      client_ms: rounded(result.clientMs),
      handler_ms: timing(result.serverTiming, "total"),
      auth_ms: timing(result.serverTiming, "auth"),
      route_ms: timing(result.serverTiming, "route"),
      api_latency_ms: typeof result.body.latency_ms === "number" ? result.body.latency_ms : null,
      model_ms: rows.reduce((sum, row) => sum + Number(row.ms ?? 0), 0),
      model_calls: rows.length,
      engine_call_ids: rows.map((row) => String(row.id)),
      input_tokens: rows.reduce((sum, row) => sum + Number(row.input_tokens ?? 0), 0),
      output_tokens: rows.reduce((sum, row) => sum + Number(row.output_tokens ?? 0), 0),
      cents: rows.reduce((sum, row) => sum + Number(row.cents ?? 0), 0),
      state: typeof reply?.state === "string" ? reply.state : null,
    });
    if (result.status !== 200 || !conversationId) break;
    const deleted = await fetch(`${base}/conversations/${conversationId}`, {
      method: "DELETE",
      headers: { apikey: env.anonKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (deleted.status !== 200) throw new Error(`delete conversation: HTTP ${deleted.status}`);
  }

  const spent = await spentCents(userId);
  if (spent > capCents) throw new Error(`spike spent ${spent} cents, above the ${capCents}-cent cap`);
  const ok = samples.filter((sample) => sample.status === 200);
  if (ok.length < 3) {
    throw new Error(`only ${ok.length} successful latency samples; need at least 3 for p50/p95`);
  }
  const metric = (pick: (sample: Sample) => number) => ({
    p50: rounded(percentile(ok.map(pick), 0.5)),
    p95: rounded(percentile(ok.map(pick), 0.95)),
  });
  const client = metric((sample) => sample.client_ms);
  const route = metric((sample) => sample.route_ms ?? sample.client_ms);
  const model = metric((sample) => sample.model_ms);
  const mouthToTextFloor = metric((sample) => silenceMs + sample.client_ms);
  const sourceSha = new TextDecoder().decode(
    new Deno.Command("git", { args: ["rev-parse", "HEAD"], cwd: new URL("../..", import.meta.url) })
      .outputSync().stdout,
  ).trim();
  await Deno.mkdir(reportDir, { recursive: true });
  await Deno.writeTextFile(new URL("samples.json", reportDir), JSON.stringify(samples, null, 2) + "\n");
  const report = `# Hosted Talk voice-latency spike\n\n` +
    `- Time: ${startedAt}\n- Source before the design commit: \`${sourceSha}\`\n` +
    `- Workload: ${ok.length} successful fictional first turns on one throwaway non-preview account; each conversation deleted after its sample; account deleted after the run\n` +
    `- Model: claude-sonnet-5-5, thinking between_tools; current assumed rate; raw token counts are in samples.json\n` +
    `- Spend: ${spent} cents through the shared Postgres ledger; cap ${capCents} cents\n` +
    `- Privacy: report contains ids and metadata only; no turn or reply text\n\n` +
    `| interval | p50 ms | p95 ms | what it includes |\n|---|---:|---:|---|\n` +
    `| hosted client | ${client.p50} | ${client.p95} | transcript POST through complete JSON reply |\n` +
    `| function route | ${route.p50} | ${route.p95} | route timing from the function's Server-Timing header |\n` +
    `| model calls | ${model.p50} | ${model.p95} | sum of engine_calls.ms, including a repair when present |\n` +
    `| current end-of-speech → reply-text floor | ${mouthToTextFloor.p50} | ${mouthToTextFloor.p95} | current 1.2 s silence detector + hosted client; excludes on-device recognition finalization and AVSpeechSynthesizer startup |\n\n` +
    `This is not a literal phone speaker measurement: the lane is prohibited from using the phone or simulators. The current app waits for the complete JSON reply before starting optional on-device TTS, so actual mouth-to-ear is the final row plus device-local TTS startup. With only ${ok.length} samples, p95 is directional.\n\n` +
    `Complete metadata: [samples.json](./samples.json).\n`;
  await Deno.writeTextFile(new URL("report.md", reportDir), report);
  console.log(JSON.stringify({
    report: `${reportDir.pathname}report.md`,
    calls: ok.length,
    spend_cents: spent,
    hosted_client_ms: client,
    end_of_speech_to_reply_text_floor_ms: mouthToTextFloor,
  }));
} finally {
  if (userId) {
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) cleanupError = removed.error.message;
  }
}
if (cleanupError) throw new Error(`delete throwaway: ${cleanupError}`);
