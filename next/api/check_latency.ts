// $0 hosted latency check for A-Q24. Creates a populated throwaway account, measures GET /me and GET /map,
// and deletes the account. No model route is called and no secret or bearer is printed.
//
//   deno run --allow-net --allow-read --allow-env --allow-write api/check_latency.ts --label before

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

type Sample = {
  route: string;
  call: number;
  status: number;
  client_ms: number;
  server_ms: number | null;
  auth_ms: number | null;
  route_ms: number | null;
  first: boolean;
  instance: string | null;
};

const env = await loadEnv();
const service = serviceClient(env);
const base = `${env.supabaseUrl}/functions/v1/api`;
const labelAt = Deno.args.indexOf("--label");
const label = String(labelAt >= 0 ? Deno.args[labelAt + 1] : "run").replace(/[^a-z0-9_-]/gi, "-");
const callsAt = Deno.args.indexOf("--calls");
const calls = Math.max(1, Number(callsAt >= 0 ? Deno.args[callsAt + 1] : 20));
const firstAt = Deno.args.indexOf("--first");
const firstRoute = String(firstAt >= 0 ? Deno.args[firstAt + 1] : "me") === "map" ? "/map" : "/me";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const reportDir = new URL(`../reports/${stamp}-hosted-latency-${label}/`, import.meta.url);

function timing(value: string | null, name: string): number | null {
  const part = (value ?? "").split(",").map((x) => x.trim()).find((x) => x.startsWith(`${name};`));
  const found = part?.match(/(?:^|;)dur=([0-9.]+)/);
  return found ? Number(found[1]) : null;
}

async function call(path: string, token: string, callNo: number): Promise<Sample> {
  const started = performance.now();
  const res = await fetch(base + path, {
    headers: { apikey: env.anonKey, authorization: `Bearer ${token}`, "x-presence-tz": "Asia/Tehran" },
    signal: AbortSignal.timeout(60_000),
  });
  await res.arrayBuffer();
  const clientMs = performance.now() - started;
  const server = res.headers.get("server-timing");
  return {
    route: path,
    call: callNo,
    status: res.status,
    client_ms: Math.round(clientMs * 10) / 10,
    server_ms: timing(server, "total"),
    auth_ms: timing(server, "auth"),
    route_ms: timing(server, "route"),
    first: res.headers.get("x-presence-first-request") === "true",
    instance: res.headers.get("x-presence-instance"),
  };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
}

function summary(samples: Sample[], route: string) {
  const rows = samples.filter((s) => s.route === route);
  const client = rows.map((s) => s.client_ms);
  const first = rows.filter((s) => s.first), reused = rows.filter((s) => !s.first);
  const server = rows.flatMap((s) => s.server_ms === null ? [] : [s.server_ms]);
  const auth = rows.flatMap((s) => s.auth_ms === null ? [] : [s.auth_ms]);
  const routeTime = rows.flatMap((s) => s.route_ms === null ? [] : [s.route_ms]);
  const platform = rows.flatMap((s) => s.server_ms === null ? [] : [Math.max(0, s.client_ms - s.server_ms)]);
  return {
    calls: rows.length,
    statuses: [...new Set(rows.map((s) => s.status))],
    p50_ms: percentile(client, 0.5),
    p95_ms: percentile(client, 0.95),
    max_ms: Math.max(...client),
    first_instances: first.length,
    reused_instances: reused.length,
    server_p50_ms: server.length ? percentile(server, 0.5) : null,
    auth_p50_ms: auth.length ? percentile(auth, 0.5) : null,
    query_p50_ms: routeTime.length ? percentile(routeTime, 0.5) : null,
    query_p95_ms: routeTime.length ? percentile(routeTime, 0.95) : null,
    platform_p50_ms: platform.length ? percentile(platform, 0.5) : null,
    reused_client_p95_ms: reused.length ? percentile(reused.map((s) => s.client_ms), 0.95) : null,
  };
}

const runId = crypto.randomUUID();
const email = `latency-${runId}@preview.presence.app`;
const password = `latency-${crypto.randomUUID()}`;
let userId = "";
const samples: Sample[] = [];
let cleanupError: string | null = null;

try {
  const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || !made.data.user) throw new Error(`create throwaway: ${made.error?.message ?? "no user"}`);
  userId = made.data.user.id;
  const profile = await service.from("profiles").insert({
    id: userId,
    name: "Latency Check",
    is_example: false,
    is_preview: false,
    tz: "Asia/Tehran",
  });
  if (profile.error) throw new Error(`create profile: ${profile.error.message}`);

  const beliefs = Array.from({ length: 16 }, (_, i) => ({
    owner: userId,
    label: `Test belief ${i + 1}`,
    statement: `A fictional latency-check belief number ${i + 1}.`,
    type: i % 3 === 0
      ? "something I believe is true"
      : i % 3 === 1
      ? "a rule I live by"
      : "how I tend to react",
    kind: i % 3 === 0 ? "foundation" : i % 3 === 1 ? "rule" : "everyday",
    area: ["relationships", "work", "family", "meaning"][i % 4],
    birth_mood: "neutral",
    status: "confirmed",
    rating: "very",
    confidence: 0.8,
    source: "talk",
    confirmed_at: new Date(Date.now() - i * 60_000).toISOString(),
  }));
  const seeded = await service.from("beliefs").insert(beliefs).select("id");
  if (seeded.error || !seeded.data) throw new Error(`seed beliefs: ${seeded.error?.message ?? "no rows"}`);
  const ids = seeded.data.map((b) => b.id as string);
  const receipts = await service.from("receipts").insert(
    ids.map((id, i) => ({ owner: userId, belief_id: id, quote: `Fictional receipt ${i + 1}.` })),
  );
  if (receipts.error) throw new Error(`seed receipts: ${receipts.error.message}`);
  const links = await service.from("belief_links").insert(
    ids.slice(1).map((id, i) => ({
      owner: userId,
      from_belief: id,
      to_belief: ids[i],
      kind: i % 4 === 0 ? "tension" : "rests_on",
    })),
  );
  if (links.error) throw new Error(`seed links: ${links.error.message}`);

  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    throw new Error(`sign in throwaway: ${signed.error?.message ?? "no session"}`);
  }
  const token = signed.data.session.access_token;

  const routes = firstRoute === "/me" ? ["/me", "/map"] : ["/map", "/me"];
  const seen = new Map<string, number>([["/me", 0], ["/map", 0]]);
  for (let i = 0; i < calls; i++) {
    for (const route of routes) {
      const callNo = (seen.get(route) ?? 0) + 1;
      seen.set(route, callNo);
      const sample = await call(route, token, callNo);
      samples.push(sample);
      if (sample.status !== 200) throw new Error(`${route} call ${callNo}: HTTP ${sample.status}`);
    }
  }

  const result = {
    label,
    first_route: firstRoute,
    me: summary(samples, "/me"),
    map: summary(samples, "/map"),
  };
  const first = samples.find((s) => s.first) ?? null;
  await Deno.mkdir(reportDir, { recursive: true });
  await Deno.writeTextFile(new URL("samples.json", reportDir), JSON.stringify(samples, null, 2) + "\n");
  const line = (name: string, s: ReturnType<typeof summary>) =>
    `| ${name} | ${s.calls} | ${
      s.statuses.join(",")
    } | ${s.p50_ms} | ${s.p95_ms} | ${s.first_instances}/${s.reused_instances} | ${
      s.server_p50_ms ?? "n/a"
    } | ${s.auth_p50_ms ?? "n/a"} | ${s.query_p50_ms ?? "n/a"}/${s.query_p95_ms ?? "n/a"} | ${
      s.platform_p50_ms ?? "n/a"
    } | ${s.reused_client_p95_ms ?? "n/a"} |`;
  const report = `# Hosted latency ${label}\n\n` +
    `- Timestamp: ${
      new Date().toISOString()
    }\n- Workload: populated throwaway, 16 beliefs / 16 receipts / 15 links; deleted after the run\n` +
    `- Calls: ${calls} per route, sequential and interleaved; first route ${firstRoute}\n- Model calls/spend: none / 0 cents\n` +
    `- First-instance request: ${
      first
        ? `${first.route} ${first.client_ms} ms client, ${first.server_ms ?? "n/a"} ms inside handler`
        : "not observed (instance already warm)"
    }\n\n` +
    `| route | calls | HTTP | client p50 ms | client p95 ms | first/reused isolates | handler p50 ms | auth p50 ms | query p50/p95 ms | platform p50 ms | reused client p95 ms |\n` +
    `|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${line("GET /me", result.me)}\n${
      line("GET /map", result.map)
    }\n\n` +
    `Complete samples: [samples.json](./samples.json).\n`;
  await Deno.writeTextFile(new URL("report.md", reportDir), report);
  console.log(JSON.stringify({ report: reportDir.pathname, ...result }));
} finally {
  if (userId) {
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) cleanupError = removed.error.message;
  }
}
if (cleanupError) throw new Error(`delete throwaway: ${cleanupError}`);
