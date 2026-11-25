// Issue #3 hosted probe, written in C4 from packages/01/routes.md "Not ready" 1 and the issue only.
// A listed test account gets 2xx on POST /comm/talk/turn, GET /comm/items and GET /comm/items/:id/visibility;
// an unlisted account gets 403 `feature_off` or `owner_only` on each.
//
//   deno run --allow-net --allow-env next/tests/hosted/comm_engine_probe.ts
//
// Inputs (see README.md): PRESENCE_API_URL, SUPABASE_ANON_KEY,
//   PROBE_LISTED_TOKEN    access token of a test account on PRESENCE_COMM_OWNER_IDS
//   PROBE_UNLISTED_TOKEN  access token of a test account not on the list
// The opener (POST /comm/talk/turn with no text) makes no model call. When the listed account has no item yet, the probe
// keeps one typed line (`source: "typed"`) on that test account so visibility has an id to read.

const NEED = ["PRESENCE_API_URL", "SUPABASE_ANON_KEY", "PROBE_LISTED_TOKEN", "PROBE_UNLISTED_TOKEN"];
const missing = NEED.filter((k) => !Deno.env.get(k));
if (missing.length) {
  console.error(`comm_engine_probe: missing ${missing.join(", ")}. Nothing was called.`);
  Deno.exit(2);
}
const BASE = Deno.env.get("PRESENCE_API_URL")!.replace(/\/$/, "");
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

type R = Record<string, unknown>;
async function call(token: string, method: string, path: string, body?: R): Promise<{ status: number; body: R }> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, apikey: ANON, "Content-Type": "application/json",
      "X-Presence-Client": "probe/comm_engine", "X-Presence-TZ": "UTC",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: R = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: parsed };
}

/** The first object in the reply that looks like an item: it has a string `id` and a string `kind`. */
function firstItemId(v: unknown): string | null {
  if (Array.isArray(v)) {
    for (const x of v) { const id = firstItemId(x); if (id) return id; }
  } else if (v && typeof v === "object") {
    const o = v as R;
    if (typeof o.id === "string" && typeof o.kind === "string") return o.id;
    for (const x of Object.values(o)) { const id = firstItemId(x); if (id) return id; }
  }
  return null;
}

const refusal = (b: R) => ["feature_off", "owner_only"].includes(String(b.reason ?? "")) ||
  ["feature_off", "owner_only"].includes(String(b.error ?? ""));

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail: string) => results.push([name, ok, detail]);

const listed = Deno.env.get("PROBE_LISTED_TOKEN")!;
const unlisted = Deno.env.get("PROBE_UNLISTED_TOKEN")!;

const opener = await call(listed, "POST", "/comm/talk/turn", { way_in: "own_download", name: "Probe" });
check("listed: POST /comm/talk/turn (opener)", opener.status >= 200 && opener.status < 300, `status ${opener.status}`);

let items = await call(listed, "GET", "/comm/items");
check("listed: GET /comm/items", items.status >= 200 && items.status < 300, `status ${items.status}`);
let id = firstItemId(items.body);
if (!id && items.status < 300) {
  const kept = await call(listed, "POST", "/comm/items", {
    kind: "how_i_mean", wording: "When I go quiet I am thinking, not upset.", source: "typed", scope: { type: "everyone" },
  });
  check("listed: POST /comm/items (an item to read)", kept.status >= 200 && kept.status < 300, `status ${kept.status}`);
  items = await call(listed, "GET", "/comm/items");
  id = firstItemId(items.body);
}
if (id) {
  const vis = await call(listed, "GET", `/comm/items/${id}/visibility`);
  check("listed: GET /comm/items/:id/visibility", vis.status >= 200 && vis.status < 300, `status ${vis.status}`);
} else {
  check("listed: GET /comm/items/:id/visibility", false, "no item id to read");
}

const u1 = await call(unlisted, "POST", "/comm/talk/turn", { way_in: "own_download", name: "Probe" });
check("unlisted: POST /comm/talk/turn refused", u1.status === 403 && refusal(u1.body), `status ${u1.status}`);
const u2 = await call(unlisted, "GET", "/comm/items");
check("unlisted: GET /comm/items refused", u2.status === 403 && refusal(u2.body), `status ${u2.status}`);
const u3 = await call(unlisted, "GET", `/comm/items/${id ?? "00000000-0000-4000-8000-000000000000"}/visibility`);
check("unlisted: GET /comm/items/:id/visibility refused", u3.status === 403 && refusal(u3.body), `status ${u3.status}`);

for (const [name, ok, detail] of results) console.log(`${ok ? "ok  " : "FAIL"} ${name} (${detail})`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `FAIL: ${failed} of ${results.length}` : `PASS: ${results.length} checks`);
Deno.exit(failed ? 1 : 0);
