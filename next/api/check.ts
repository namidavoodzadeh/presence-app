// In-process live check of the $0 endpoints against the hosted database. No listener, no model call, no secret printed.
//   deno run --allow-net --allow-read --allow-env next/api/check.ts [persona]

import { handler } from "./index.ts";

const persona = Deno.args[0] ?? "nami";
const base = "http://api.local";
const results: { step: string; status: number; note: string }[] = [];

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await handler(new Request(base + path, {
    method, headers: { "content-type": "application/json", "x-presence-tz": "Asia/Tehran", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

let r = await call("GET", "/health");
results.push({ step: "GET /health", status: r.status, note: JSON.stringify(r.json).slice(0, 80) });

r = await call("GET", "/me");
results.push({ step: "GET /me without bearer", status: r.status, note: `error=${r.json.error} ref=${String(r.json.ref ?? "").length === 4 ? "4 chars" : r.json.ref}` });

r = await call("POST", "/preview/login", { persona });
const token = String(r.json.access_token ?? "");
const me = r.json.me as Record<string, unknown> | undefined;
results.push({ step: `POST /preview/login ${persona}`, status: r.status, note: token ? `token ${token.length} chars; me.person.name=${(me?.person as Record<string, unknown>)?.name} example=${me?.example} preview=${me?.preview}` : JSON.stringify(r.json).slice(0, 120) });

r = await call("POST", "/preview/login", { persona: "nobody" });
results.push({ step: "POST /preview/login nobody", status: r.status, note: `error=${r.json.error} field=${r.json.field}` });

if (token) {
  r = await call("GET", "/me", undefined, token);
  const m = r.json.me as Record<string, unknown> | undefined;
  results.push({ step: "GET /me", status: r.status, note: `settings keys=${Object.keys((m?.settings as Record<string, unknown>) ?? {}).length}` });

  r = await call("GET", "/preview/spend", undefined, token);
  results.push({ step: "GET /preview/spend", status: r.status, note: `today=${r.json.today_cents}¢ total=${r.json.total_cents}¢ caps ${r.json.daily_cap_cents}/${r.json.total_cap_cents}` });

  r = await call("GET", "/conversations", undefined, token);
  const list = (r.json.conversations as Record<string, unknown>[]) ?? [];
  results.push({ step: "GET /conversations", status: r.status, note: `${list.length} conversations; active=${r.json.active ? "yes" : "null"}; first group=${list[0]?.group ?? "-"} beliefs_added=${list[0]?.beliefs_added ?? "-"}` });

  if (list[0]) {
    r = await call("GET", `/conversations/${list[0].id}`, undefined, token);
    const msgs = (r.json.messages as unknown[]) ?? [];
    results.push({ step: "GET /conversations/:id", status: r.status, note: `${msgs.length} messages; unrated=${(r.json.unrated as unknown[])?.length}` });
    r = await call("GET", `/conversations/${list[0].id}/delete-preview`, undefined, token);
    results.push({ step: "GET /conversations/:id/delete-preview", status: r.status, note: `count=${r.json.count} line="${r.json.line}"` });
  }

  r = await call("GET", "/conversations/00000000-0000-0000-0000-000000000000", undefined, token);
  results.push({ step: "GET /conversations/<missing>", status: r.status, note: `error=${r.json.error} ref=${r.json.ref}` });

  r = await call("GET", "/never", undefined, token);
  results.push({ step: "GET /never", status: r.status, note: `${(r.json.topics as unknown[])?.length} topics` });

  r = await call("PATCH", "/me", {}, token);
  results.push({ step: "PATCH /me {}", status: r.status, note: `error=${r.json.error}` });
}

for (const x of results) console.log(`${String(x.status).padEnd(4)} ${x.step.padEnd(40)} ${x.note}`);
const bad = results.filter((x) => x.status >= 500);
Deno.exit(bad.length ? 1 : 0);
