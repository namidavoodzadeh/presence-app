// Hosted phase-1 SSE latency check. Fictional first turns only, one throwaway account, shared ledger, hard cap.
// Reports ids, timings, tokens and cents; never the fictional text, speech chunks or final reply words.
//
//   deno run --allow-net --allow-read --allow-env --allow-write --allow-run api/check_voice_stream_latency.ts --calls 10 --cap 40

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

type Row = Record<string, unknown>;
interface Sample {
  call: number;
  status: number;
  conversation_id: string | null;
  accepted_ms: number | null;
  first_token_ms: number | null;
  first_sentence_ms: number | null;
  reply_ms: number | null;
  done_ms: number | null;
  model_ms: number;
  model_calls: number;
  engine_call_ids: string[];
  input_tokens: number;
  output_tokens: number;
  cents: number;
  state: string | null;
  events: string[];
}

interface NonStreamControl {
  status: number;
  state: string | null;
  speech_was_empty: boolean;
  conversation_id: string | null;
}

const env = await loadEnv();
const service = serviceClient(env);
const base = `${env.supabaseUrl}/functions/v1/api`;
const valueAfter = (name: string, fallback: number) => {
  const at = Deno.args.indexOf(name);
  return at >= 0 ? Number(Deno.args[at + 1]) : fallback;
};
const calls = Math.max(1, Math.min(20, valueAfter("--calls", 10)));
const cap = Math.max(1, Math.min(40, valueAfter("--cap", 40)));
const routeWorst = 10;
const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const reportDir = new URL(`../reports/${stamp}-voice-live-sse-latency/`, import.meta.url);
const turns = [
  "A fictional dinner plan changed after the evening had already been arranged.",
  "A fictional work meeting moved after the afternoon had been cleared for it.",
  "A fictional friend cancelled a walk after the meeting place was reached.",
  "A fictional family call ended before the timing could be explained.",
  "A fictional handoff changed after the agreed steps had been written down.",
  "A fictional shared task was reassigned after most of it was finished.",
  "A fictional class time changed after the rest of the day was arranged.",
  "A fictional group picked a date while one member was away.",
  "A fictional appointment started late after an early arrival.",
  "A fictional neighbour returned a borrowed tool with one part missing.",
];

function rounded(n: number): number {
  return Math.round(n * 10) / 10;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
}

async function spent(person: string): Promise<number> {
  const { data, error } = await service.from("usage_ledger").select("reserved_micros,spent_micros")
    .eq("person", person).gte("created_at", startedAt);
  if (error) throw new Error(`ledger read: ${error.message}`);
  return (data ?? []).reduce(
    (sum, row) => sum + Number(row.spent_micros ?? row.reserved_micros ?? 0) / 10_000,
    0,
  );
}

async function streamTurn(token: string, turn: string): Promise<{
  status: number;
  conversation: string | null;
  accepted: number | null;
  firstToken: number | null;
  firstSentence: number | null;
  reply: number | null;
  done: number | null;
  state: string | null;
  events: string[];
}> {
  const started = performance.now();
  const response = await fetch(`${base}/talk/turn?stream=1`, {
    method: "POST",
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-presence-client": "engine-voice-sse-spike/1",
      "x-presence-tz": "Asia/Tehran",
    },
    body: JSON.stringify({ conversation_id: null, text: turn, mode: "voice" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.body) throw new Error(`stream HTTP ${response.status}: no body`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", event = "", data: string[] = [];
  let conversation: string | null = null;
  let accepted: number | null = null, firstToken: number | null = null, firstSentence: number | null = null;
  let reply: number | null = null, done: number | null = null, state: string | null = null;
  const events: string[] = [];
  const dispatch = () => {
    if (!event || !data.length) return;
    const elapsed = rounded(performance.now() - started);
    let value: Row = {};
    try {
      value = JSON.parse(data.join("\n")) as Row;
    } catch { /* the product stream owns malformed-event handling; this check records the event name */ }
    events.push(event);
    if (event === "accepted") {
      accepted ??= elapsed;
      conversation = typeof value.conversation_id === "string" ? value.conversation_id : null;
    } else if (event === "speech") {
      firstSentence ??= elapsed;
    } else if (event === "reply") {
      reply ??= elapsed;
      const r = value.reply as Row | undefined;
      state = typeof r?.state === "string" ? r.state : null;
    } else if (event === "done") {
      done = elapsed;
      firstToken = typeof value.first_token_ms === "number" ? value.first_token_ms : null;
    }
    event = "";
    data = [];
  };
  while (true) {
    const { value, done: ended } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !ended });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line) dispatch();
      else if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      newline = buffer.indexOf("\n");
    }
    if (ended) break;
  }
  dispatch();
  return {
    status: response.status,
    conversation,
    accepted,
    firstToken,
    firstSentence,
    reply,
    done,
    state,
    events,
  };
}

async function nonStreamSafetyControl(token: string): Promise<NonStreamControl> {
  const response = await fetch(`${base}/talk/turn`, {
    method: "POST",
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-presence-client": "engine-voice-sse-spike/1",
      "x-presence-tz": "Asia/Tehran",
    },
    body: JSON.stringify({
      conversation_id: null,
      text: "In a fictional situation, I plan to hurt someone.",
      mode: "voice",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json() as Row;
  const reply = body.reply as Row | undefined;
  const conversation = body.conversation as Row | undefined;
  return {
    status: response.status,
    state: typeof reply?.state === "string" ? reply.state : null,
    speech_was_empty: reply?.reflection === "" && reply?.question === "",
    conversation_id: typeof conversation?.id === "string" ? conversation.id : null,
  };
}

const runId = crypto.randomUUID();
const email = `voice-sse-${runId}@preview.presence.app`;
const password = `voice-sse-${crypto.randomUUID()}`;
let userId = "";
const samples: Sample[] = [];
let nonStreamControl: NonStreamControl | null = null;
let cleanupError: string | null = null;

try {
  const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || !made.data.user) throw new Error(`create throwaway: ${made.error?.message ?? "no user"}`);
  userId = made.data.user.id;
  const profile = await service.from("profiles").insert({
    id: userId,
    name: "Voice SSE Latency Check",
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
    throw new Error(`sign in: ${signed.error?.message ?? "no session"}`);
  }
  const token = signed.data.session.access_token;

  nonStreamControl = await nonStreamSafetyControl(token);
  if (
    nonStreamControl.status !== 200 || nonStreamControl.state !== "safety" ||
    !nonStreamControl.speech_was_empty || !nonStreamControl.conversation_id
  ) {
    throw new Error(`non-stream S07 control failed: ${JSON.stringify(nonStreamControl)}`);
  }
  const controlRemoved = await fetch(`${base}/conversations/${nonStreamControl.conversation_id}`, {
    method: "DELETE",
    headers: { apikey: env.anonKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (controlRemoved.status !== 200) {
    throw new Error(`delete non-stream control conversation: HTTP ${controlRemoved.status}`);
  }

  for (let i = 0; i < calls; i++) {
    if (await spent(userId) + routeWorst > cap) break;
    const result = await streamTurn(token, turns[i % turns.length]);
    const { data: traces, error } = result.conversation
      ? await service.from("engine_calls").select("id,ms,cents,input_tokens,output_tokens")
        .eq("person", userId).eq("conversation_id", result.conversation).order("created_at")
      : { data: [] as Row[], error: null };
    if (error) throw new Error(`trace read: ${error.message}`);
    const rows = (traces ?? []) as Row[];
    samples.push({
      call: i + 1,
      status: result.status,
      conversation_id: result.conversation,
      accepted_ms: result.accepted,
      first_token_ms: result.firstToken,
      first_sentence_ms: result.firstSentence,
      reply_ms: result.reply,
      done_ms: result.done,
      model_ms: rounded(rows.reduce((sum, row) => sum + Number(row.ms ?? 0), 0)),
      model_calls: rows.length,
      engine_call_ids: rows.map((row) => String(row.id)),
      input_tokens: rows.reduce((sum, row) => sum + Number(row.input_tokens ?? 0), 0),
      output_tokens: rows.reduce((sum, row) => sum + Number(row.output_tokens ?? 0), 0),
      cents: rows.reduce((sum, row) => sum + Number(row.cents ?? 0), 0),
      state: result.state,
      events: result.events,
    });
    if (result.status !== 200 || !result.conversation || result.done === null) break;
    const removed = await fetch(`${base}/conversations/${result.conversation}`, {
      method: "DELETE",
      headers: { apikey: env.anonKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (removed.status !== 200) throw new Error(`delete conversation: HTTP ${removed.status}`);
  }

  const cost = await spent(userId);
  if (cost > cap) throw new Error(`spike spent ${cost} cents, above ${cap}`);
  const ok = samples.filter((s) =>
    s.status === 200 && s.first_token_ms !== null && s.first_sentence_ms !== null
  );
  if (ok.length < 3) throw new Error(`only ${ok.length} complete samples; need at least 3`);
  const metric = (pick: (sample: Sample) => number | null) => {
    const values = ok.map(pick).filter((v): v is number => v !== null);
    return { p50: rounded(percentile(values, 0.5)), p95: rounded(percentile(values, 0.95)) };
  };
  const tokenLatency = metric((s) => s.first_token_ms);
  const sentence = metric((s) => s.first_sentence_ms);
  const reply = metric((s) => s.reply_ms);
  const source = new TextDecoder().decode(
    new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      cwd: new URL("../..", import.meta.url),
    }).outputSync().stdout,
  ).trim();
  await Deno.mkdir(reportDir, { recursive: true });
  await Deno.writeTextFile(new URL("samples.json", reportDir), JSON.stringify(samples, null, 2) + "\n");
  const report = `# Hosted Talk SSE latency\n\n` +
    `- Time: ${startedAt}\n- Source revision: \`${source}\`\n` +
    `- Workload: ${ok.length} fictional first turns on one throwaway non-preview account; conversations and account deleted\n` +
    `- Non-stream control: HTTP ${nonStreamControl.status}, S07 safety reply, empty reflection/question, zero model calls\n` +
    `- Spend: ${cost} cents through the shared Postgres ledger; cap ${cap} cents\n` +
    `- Privacy: ids and metadata only; no turn, speech-chunk or reply text\n\n` +
    `| hosted interval | p50 ms | p95 ms |\n|---|---:|---:|\n` +
    `| provider first text token (function) | ${tokenLatency.p50} | ${tokenLatency.p95} |\n` +
    `| POST to first guarded sentence (client) | ${sentence.p50} | ${sentence.p95} |\n` +
    `| POST to final reply event (client) | ${reply.p50} | ${reply.p95} |\n\n` +
    `These are hosted transcript-to-event intervals, not literal mouth-to-ear measurements. End-of-turn detection and local AVSpeechSynthesizer startup are outside this lane. With ${ok.length} samples, p95 is directional.\n\n` +
    `Complete metadata: [samples.json](./samples.json).\n`;
  await Deno.writeTextFile(new URL("report.md", reportDir), report);
  console.log(JSON.stringify({
    report: `${reportDir.pathname}report.md`,
    calls: ok.length,
    spend_cents: cost,
    first_token_ms: tokenLatency,
    first_sentence_ms: sentence,
    final_reply_ms: reply,
  }));
} finally {
  if (userId) {
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) cleanupError = removed.error.message;
  }
}
if (cleanupError) throw new Error(`delete throwaway: ${cleanupError}`);
