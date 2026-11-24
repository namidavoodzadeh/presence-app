// Measure hosted Talk and Bridge prompt-cache usage with two disposable fictional accounts. The run stops before starting
// another endpoint once settled spend reaches 40¢, leaving at least 10¢ of the 50¢ hard cap for an in-flight endpoint.
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadEnv } from "../api/lib/env.ts";
import { serviceClient } from "../api/lib/db.ts";
import { rate } from "../engine/model/client.ts";

type Row = Record<string, unknown>;
const label = Deno.args[0] ?? "measurement";
const output = Deno.args[1];
if (!output) throw new Error("usage: measure_prompt_cache.ts <before|after> <output.json>");

const env = await loadEnv();
const service = serviceClient(env);
const base = `${env.supabaseUrl}/functions/v1/api`;
const startedAt = new Date().toISOString();
const stamp = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const users: { id: string; email: string; password: string; token: string }[] = [];

async function owner(name: string) {
  const email = `cache-${label}-${stamp}-${users.length}@preview.presence.app`;
  const password = `cache-${stamp}-${crypto.randomUUID()}`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`create throwaway: ${created.error?.message ?? "no user"}`);
  }
  const id = created.data.user.id;
  const profile = await service.from("profiles").insert({ id, name, is_example: false, is_preview: false });
  if (profile.error) throw new Error(`create profile: ${profile.error.message}`);
  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(`sign in throwaway: ${signed.error?.message}`);
  const row = { id, email, password, token: signed.data.session.access_token };
  users.push(row);
  return row;
}

async function call(token: string, path: string, body: Row) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { apikey: env.anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  let json: Row = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (response.status !== 200) throw new Error(`${path}: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

function exactCostUsd(row: Row): number {
  const model = String(row.model ?? "");
  const [inputRate, outputRate] = rate(model);
  const readMultiplier = /claude-(?:sonnet|opus)-5-5/.test(model) ? 0.05 : 0.1;
  const cents = Number(row.input_tokens ?? 0) * inputRate +
    Number(row.cache_creation_input_tokens ?? 0) * inputRate * 1.25 +
    Number(row.cache_read_input_tokens ?? 0) * inputRate * readMultiplier +
    Number(row.output_tokens ?? 0) * outputRate;
  return cents / 100_000_000;
}

function summary(rows: Row[], actions: number) {
  const input = rows.reduce((n, r) => n + Number(r.input_tokens ?? 0), 0);
  const created = rows.reduce((n, r) => n + Number(r.cache_creation_input_tokens ?? 0), 0);
  const read = rows.reduce((n, r) => n + Number(r.cache_read_input_tokens ?? 0), 0);
  const total = input + created + read;
  return {
    actions,
    calls: rows.length,
    inputTokens: input,
    cacheCreationInputTokens: created,
    cacheReadInputTokens: read,
    cacheHitRate: total ? read / total : 0,
    settledLedgerCents: rows.reduce((n, r) => n + Number(r.cents ?? 0), 0),
    usagePricedUsd: rows.reduce((n, r) => n + exactCostUsd(r), 0),
    costPerActionUsd: actions ? rows.reduce((n, r) => n + exactCostUsd(r), 0) / actions : 0,
    perCall: rows.map((r) => ({
      purpose: String(r.purpose),
      inputTokens: Number(r.input_tokens ?? 0),
      cacheCreationInputTokens: Number(r.cache_creation_input_tokens ?? 0),
      cacheReadInputTokens: Number(r.cache_read_input_tokens ?? 0),
    })),
  };
}

try {
  const talker = await owner("Cache Talker");
  const receiver = await owner("Cache Receiver");
  const link = await service.from("links").insert({ person_a: talker.id, person_b: receiver.id });
  if (link.error) throw new Error(`link: ${link.error.message}`);
  const prefs = await service.from("link_prefs").insert([
    { owner: talker.id, other: receiver.id, relationship: "friend" },
    { owner: receiver.id, other: talker.id, relationship: "friend" },
  ]);
  if (prefs.error) throw new Error(`link prefs: ${prefs.error.message}`);

  const first = await call(talker.token, "/talk/turn", {
    conversation_id: null,
    text:
      "At work today the plan changed after I had already covered the details, and I said yes even though I felt left out of the decision.",
    mode: "text",
  });
  const conversationId = String((first.conversation as Row)?.id ?? "");
  await call(talker.token, "/talk/turn", {
    conversation_id: conversationId,
    text:
      "I kept thinking that objecting would make me look difficult, so I stayed quiet and handled the new plan myself.",
    mode: "text",
  });

  const bridgeMessages = [
    "You always change the plan after I have arranged everything, and then I am the one explaining it to everyone.",
    "You never tell me when the timing changes, and I end up carrying the awkward conversation with the rest of the group.",
  ];
  for (const text of bridgeMessages) {
    const { data: spentRows } = await service.from("engine_calls").select("cents").eq("person", talker.id)
      .gte("created_at", startedAt);
    const spent = (spentRows ?? []).reduce((n, row) => n + Number(row.cents ?? 0), 0);
    if (spent >= 40) {
      throw new Error(`50-cent cap guard: stopped at ${spent} settled cents before another Bridge action`);
    }
    await call(talker.token, "/bridge/run", { person_id: receiver.id, text });
  }

  const { data, error } = await service.from("engine_calls").select("*").eq("person", talker.id).gte(
    "created_at",
    startedAt,
  ).order("created_at");
  if (error) throw new Error(`read usage: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const talk = rows.filter((r) => ["turn", "repair"].includes(String(r.purpose)));
  const bridge = rows.filter((r) =>
    ["analyse", "analyse_repair", "rewrite", "rewrite_retry", "verify", "verify_retry"].includes(
      String(r.purpose),
    )
  );
  const report = {
    label,
    measuredAt: new Date().toISOString(),
    source: "hosted engine_calls provider usage; fictional throwaway accounts",
    pricing:
      "usage-priced with the app ledger rate table; settledLedgerCents is the hosted ledger's rounded per-call amount",
    talk: summary(talk, 2),
    bridge: summary(bridge, 2),
    totalSettledCents: rows.reduce((n, r) => n + Number(r.cents ?? 0), 0),
    purposes: rows.map((r) => String(r.purpose)),
  };
  await Deno.writeTextFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const user of users.reverse()) {
    const deleted = await service.auth.admin.deleteUser(user.id);
    console.log(`${deleted.error ? "FAIL" : "PASS"} cleanup ${user.id.slice(0, 8)}`);
  }
}
