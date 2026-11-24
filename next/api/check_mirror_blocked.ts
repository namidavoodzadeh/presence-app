// $0 live check for B-Q10. Two throwaway owners prove list shape, grouping, unblock, and cross-owner isolation on the Mac fallback.
// Everything inserted is cascade-deleted with the auth users at the end.
//   deno run --allow-net --allow-read --allow-env --allow-write api/check_mirror_blocked.ts [--base http://127.0.0.1:8821]
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

type R = Record<string, unknown>;
const env = await loadEnv();
const service = serviceClient(env);
const baseIdx = Deno.args.indexOf("--base");
const base = baseIdx >= 0 ? Deno.args[baseIdx + 1] : "http://127.0.0.1:8821";
const baseLabel = base.startsWith(env.supabaseUrl) ? "hosted function" : base;
const results: { step: string; status: number; ok: boolean; note: string }[] = [];
const step = (name: string, status: number, ok: boolean, note = "") =>
  results.push({ step: name, status, ok, note });

async function call(method: string, path: string, token: string) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, apikey: env.anonKey, "content-type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: R = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function owner(name: string) {
  const stamp = `${Date.now().toString(36)}-${crypto.randomUUID()}`;
  const email = `check-mirror-blocked-${stamp}@preview.presence.app`;
  const password = `check-${stamp}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const id = data.user.id;
  const { error: profileError } = await service.from("profiles").insert({
    id,
    name,
    is_example: false,
    is_preview: false,
  });
  if (profileError) throw new Error(`profile: ${profileError.message}`);
  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signed, error: signError } = await anon.auth.signInWithPassword({ email, password });
  if (signError || !signed.session) throw new Error(`sign in: ${signError?.message}`);
  return { id, token: signed.session.access_token };
}

const made: string[] = [];
try {
  const a = await owner("Blocked Check A");
  made.push(a.id);
  const b = await owner("Blocked Check B");
  made.push(b.id);
  const { data: cards, error: cardError } = await service.from("outside_perspectives").insert([
    { owner: a.id, label: "Keeps an exit", statement: "A private de-identified summary." },
    { owner: a.id, label: "Goes quiet", statement: "Another private de-identified summary." },
    { owner: b.id, label: "Other owner's card", statement: "Not visible to owner A." },
  ]).select("id,owner,label");
  if (cardError || !cards || cards.length !== 3) throw new Error(`cards: ${cardError?.message}`);
  const aExit = cards.find((x) => x.owner === a.id && x.label === "Keeps an exit")!;
  const aQuiet = cards.find((x) => x.owner === a.id && x.label === "Goes quiet")!;
  const bCard = cards.find((x) => x.owner === b.id)!;
  const { error: blockError } = await service.from("mirror_blocks").insert([
    { owner: a.id, perspective_id: aExit.id, contributor_key: "opaque-a" },
    { owner: a.id, perspective_id: aExit.id, contributor_key: "opaque-b" },
    { owner: a.id, perspective_id: aQuiet.id, contributor_key: "opaque-c" },
    { owner: b.id, perspective_id: bCard.id, contributor_key: "opaque-other-owner" },
  ]);
  if (blockError) throw new Error(`blocks: ${blockError.message}`);

  let r = await call("GET", "/mirror/blocked", a.token);
  const blocked = (r.json.blocked as R[]) ?? [];
  step(
    "GET groups hidden keys by card and returns labels A–Z",
    r.status,
    r.status === 200 && JSON.stringify(blocked) === JSON.stringify([
          { id: aQuiet.id, label: "Goes quiet" },
          { id: aExit.id, label: "Keeps an exit" },
        ]),
    JSON.stringify(blocked),
  );
  step(
    "GET shape contains only id and label",
    r.status,
    blocked.every((row) => JSON.stringify(Object.keys(row).sort()) === '["id","label"]') &&
      !JSON.stringify(blocked).includes("opaque") && !JSON.stringify(blocked).includes("count"),
  );

  r = await call("DELETE", `/mirror/blocked/${bCard.id}`, a.token);
  step(
    "another owner's block is not found",
    r.status,
    r.status === 404 && r.json.error === "not_found",
    `error=${r.json.error}`,
  );

  r = await call("DELETE", `/mirror/blocked/${aExit.id}`, a.token);
  step(
    "DELETE unblocks one card without returning a count",
    r.status,
    r.status === 200 && r.json.unblocked === aExit.id && Object.keys(r.json).length === 1,
    JSON.stringify(r.json),
  );
  const { count: removed } = await service.from("mirror_blocks").select("id", { count: "exact", head: true })
    .eq("owner", a.id).eq("perspective_id", aExit.id);
  const { count: otherKept } = await service.from("mirror_blocks").select("id", {
    count: "exact",
    head: true,
  })
    .eq("owner", b.id).eq("perspective_id", bCard.id);
  step(
    "all keys behind that card are gone; the other owner's row remains",
    200,
    removed === 0 && otherKept === 1,
    `removed=${removed} other_owner=${otherKept}`,
  );

  r = await call("GET", "/mirror/blocked", a.token);
  step(
    "GET after unblock keeps the other card",
    r.status,
    r.status === 200 &&
      JSON.stringify(r.json.blocked) === JSON.stringify([{ id: aQuiet.id, label: "Goes quiet" }]),
    JSON.stringify(r.json.blocked),
  );
} finally {
  for (const id of made) await service.auth.admin.deleteUser(id);
}

const when = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const dir = new URL(`../reports/${when}-mirror-blocked/`, import.meta.url);
await Deno.mkdir(dir, { recursive: true });
const passed = results.filter((x) => x.ok).length;
await Deno.writeTextFile(
  new URL("report.md", dir),
  [
    `# Mirror blocked-perspectives check ${when}`,
    "",
    `Base ${baseLabel}; two throwaway owners; no model call; $0. ${passed}/${results.length} steps passed.`,
    "",
    "| step | status | ok | note |",
    "|---|---|---|---|",
    ...results.map((x) =>
      `| ${x.step} | ${x.status} | ${x.ok ? "PASS" : "FAIL"} | ${x.note.replace(/\|/g, "\\|")} |`
    ),
    "",
  ].join("\n"),
);
for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${x.status} ${x.step} ${x.note}`);
console.log(`\n${passed}/${results.length} passed; report ${dir.pathname}report.md`);
Deno.exit(passed === results.length ? 0 : 1);
