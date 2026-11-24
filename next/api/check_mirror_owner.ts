// $0 check of the Mirror owner settings (Y02) and the contributor page's reachability, on a throwaway owner so nothing of Nami's or
// the cast's is touched (COO 23:30 10-27, overnight item 4: "confirm the Y02 calls answer on hosted"). Off by default; on → a slug and
// link; the page's JSON by slug; Only people I approve; Pause and resume; Get a new link (the old one stops); Delete link and
// everything pending (off again, the page says it no longer works). The W01–W06 page is fetched as HTML from the Mac fallback 8821
// (the hosted gateway serves it as text/plain, CONTRACT v1.7/Q64). The throwaway account is deleted at the end.
//   deno run --allow-net --allow-read --allow-env --allow-write next/api/check_mirror_owner.ts [--hosted | --live-mac] [--mac http://127.0.0.1:8821]
import { handler } from "./index.ts";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

type R = Record<string, unknown>;
const J = (o: unknown) => JSON.stringify(o);
const hosted = Deno.args.includes("--hosted");
const liveMac = Deno.args.includes("--live-mac");
// --hosted must mean the hosted project. loadEnv() fills every missing key from secrets/staging.env, so without the three keys in
// the shell this script silently tested STAGING (QA 17:28Z 16 Nov). Refuse instead of guessing; never print a value.
const homeDir = Deno.env.get("HOME") ?? "";
const secretsRoot = `${Deno.env.get("PRESENCE_HOME_ROOT") || `${homeDir}/Library/Application Support/PresenceHome`}/secrets`;
async function fileValue(file: string, key: string): Promise<string | null> {
  try {
    const text = await Deno.readTextFile(`${secretsRoot}/${file}`);
    return text.match(new RegExp(`^(?:export\\s+)?${key}=["']?([^"'\\s]+)`, "m"))?.[1] ?? null;
  } catch { return null; }
}
if (hosted) {
  const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !Deno.env.get(k));
  if (missing.length) {
    console.error(`--hosted refused: ${missing.join(", ")} not set in the environment (the loader would fall back to staging). Source the hosted project's env first.`);
    Deno.exit(2);
  }
  const stagingUrl = await fileValue("staging.env", "SUPABASE_URL");
  if (stagingUrl && Deno.env.get("SUPABASE_URL") === stagingUrl) {
    console.error("--hosted refused: SUPABASE_URL is the staging project's.");
    Deno.exit(2);
  }
}
const env = await loadEnv();
// The API env loader never reads the device secret from a file (hosted safety); this Mac-side script does, and sends it on every
// call that reaches a deployed function (preview login on hosted and the Mac fallback needs it).
const deviceSecret = env.previewDeviceSecret ?? ((hosted || liveMac) ? await fileValue("preview-device.env", "PRESENCE_PREVIEW_DEVICE_SECRET") : null);
const macIdx = Deno.args.indexOf("--mac");
const mac = macIdx >= 0 ? Deno.args[macIdx + 1] : "http://127.0.0.1:8821";
const base = hosted ? `${env.supabaseUrl}/functions/v1/api` : liveMac ? mac : "http://api.local";
const service = serviceClient(env);
const results: { step: string; status: number; ok: boolean; note: string; ms: number }[] = [];
const step = (name: string, status: number, ok: boolean, note = "", ms = 0) => { results.push({ step: name, status, ok, note, ms }); if (!ok) console.log("   !", name, status, note); };

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}, at = base) {
  const t0 = performance.now();
  const req = new Request(at + path, { method, headers: { "content-type": "application/json", apikey: env.anonKey, "x-presence-tz": "Asia/Tehran", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(deviceSecret && at === base && at !== "http://api.local" ? { "x-presence-preview-secret": deviceSecret } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const res = at === "http://api.local" ? await handler(req) : await fetch(req);
  const text = await res.text();
  let json: R = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, text, type: res.headers.get("content-type") ?? "", ms: Math.round(performance.now() - t0) };
}

// ---- a throwaway owner (as check_data.ts makes them): a real account, not preview, not example
const stamp = Date.now().toString(36);
const password = `check-${stamp}-${crypto.randomUUID()}`;
const email = `check-mirror-owner-${stamp}@preview.presence.app`;
const { data: created, error: e1 } = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (e1 || !created.user) throw new Error(`createUser: ${e1?.message}`);
const owner = created.user.id;
const { error: e2 } = await service.from("profiles").insert({ id: owner, name: "Check Owner", is_example: false, is_preview: false });
if (e2) throw new Error(`profile: ${e2.message}`);
const { createClient } = await import("npm:@supabase/supabase-js@2");
const anon = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: s, error: e3 } = await anon.auth.signInWithPassword({ email, password });
if (e3 || !s.session) throw new Error(`sign in: ${e3?.message}`);
const token = s.session.access_token;
step("throwaway owner created and signed in", 200, !!token, `id ${owner.slice(0, 8)}`);

try {
  let r = await call("GET", "/mirror", undefined, token);
  let m = (r.json.mirror as R) ?? {};
  step("GET /mirror: off by default, no slug, no link, who anyone, not paused, no approvals, waiting 0", r.status,
    r.status === 200 && m.on === false && m.slug === null && m.link === null && m.who === "anyone" && m.paused === false && J(m.approvals) === "[]" && m.waiting === 0, J(m), r.ms);
  r = await call("PATCH", "/mirror", { on: true }, token);
  m = (r.json.mirror as R) ?? {};
  const slug1 = String(m.slug ?? "");
  step("PATCH /mirror on → a slug and the link", r.status, r.status === 200 && m.on === true && slug1.length >= 8 && m.link === `https://kenember.com/m/${slug1}`, `slug ${slug1}`, r.ms);
  r = await call("GET", `/m/${slug1}`);
  const page = r.json;
  step("GET /m/:slug (no bearer): open, the owner's first name, three prompts, no test friends (not a preview owner)", r.status,
    r.status === 200 && page.open === true && page.owner_name === "Check" && (page.prompts as string[])?.length === 3 && (page.prompts as string[])[2] === "What seemed to matter to Check there?" && J(page.test_friends) === "[]" && page.preview === false,
    `prompts=${J(page.prompts)} line="${String(page.line).slice(0, 40)}…"`, r.ms);
  r = await call("PATCH", "/mirror", { who: "approved" }, token);
  m = (r.json.mirror as R) ?? {};
  step("PATCH /mirror who approved (Only people I approve)", r.status, r.status === 200 && m.who === "approved" && m.on === true, "", r.ms);
  r = await call("GET", `/m/${slug1}`);
  step("the page carries who approved", r.status, r.json.who === "approved" && r.json.open === true, "", r.ms);
  r = await call("PATCH", "/mirror", { who: "nobody" }, token);
  step("PATCH /mirror who nobody → 400 invalid", r.status, r.status === 400 && r.json.error === "invalid", `error=${r.json.error}`, r.ms);
  r = await call("PATCH", "/mirror", { paused: true }, token);
  m = (r.json.mirror as R) ?? {};
  step("Pause link → paused, still on", r.status, r.status === 200 && m.paused === true && m.on === true, "", r.ms);
  r = await call("GET", `/m/${slug1}`);
  step("the page while paused: closed, reason paused", r.status, r.status === 200 && r.json.open === false && r.json.reason === "paused" && r.json.owner_name === "Check", J(r.json).slice(0, 80), r.ms);
  r = await call("POST", `/m/${slug1}/contributions`, { happening: "Something happened at dinner.", did: "Check said it was fine.", how_known: "friend" }, undefined, { authorization: `Bearer ${token}` });
  step("a contribution while paused is refused (no row)", r.status, r.status >= 400 && r.status < 500, `error=${r.json.error} reason=${r.json.reason}`, r.ms);
  r = await call("PATCH", "/mirror", { paused: false }, token);
  m = (r.json.mirror as R) ?? {};
  step("resume → not paused", r.status, r.status === 200 && m.paused === false && m.on === true, "", r.ms);
  r = await call("POST", "/mirror/rotate", {}, token);
  m = (r.json.mirror as R) ?? {};
  const slug2 = String(m.slug ?? "");
  step("Get a new link → a new slug, still on", r.status, r.status === 200 && m.on === true && slug2.length >= 8 && slug2 !== slug1 && m.link === `https://kenember.com/m/${slug2}`, `slug ${slug1} → ${slug2}`, r.ms);
  r = await call("GET", `/m/${slug1}`);
  step("the old link no longer works (not_found, no owner name)", r.status, r.status === 404 || (r.json.open === false && r.json.reason === "not_found" && r.json.owner_name === null), `status=${r.status} reason=${r.json.reason}`, r.ms);
  r = await call("GET", `/m/${slug2}`);
  step("the new link opens", r.status, r.status === 200 && r.json.open === true, "", r.ms);
  // W01–W06 with a real second identity: sign in through the preview route, send the three page answers, then delete that answer.
  // The owner stays a throwaway non-preview account, so this verifies the bearer contributor path rather than the test_friend shortcut.
  r = await call("POST", "/preview/login", { persona: "lea" });
  const contributorToken = String(r.json.access_token ?? "");
  step("W01 contributor signs in through preview login as Lea", r.status, r.status === 200 && contributorToken.length > 20,
    contributorToken ? "token received" : `error=${r.json.error}`, r.ms);
  const answer = {
    how_known: "coworker", how_long: "one_to_five_years",
    happening: "At a planning meeting, the deadline changed after the team had already agreed on the schedule.",
    did: "Check wrote the new dates on the board, asked each person what would be affected, and stayed after to update the plan.",
    mattered: "Keeping the handoff clear seemed important to Check.",
  };
  r = await call("POST", `/m/${slug2}/contributions`, answer, contributorToken);
  const contributionId = String(r.json.contribution_id ?? "");
  step("W02–W06 contributor sends relationship, duration and all three prompts", r.status,
    r.status === 200 && r.json.accepted === true && contributionId.length > 10,
    `state=${r.json.state} contribution_id=${contributionId || "null"}`, r.ms);
  r = await call("DELETE", `/m/${slug2}/contributions/${contributionId}`, answer, contributorToken);
  step("W06 Delete my answer removes the contributor's own answer", r.status,
    r.status === 200 && r.json.deleted === true, `deleted=${r.json.deleted}`, r.ms);
  // the W01–W06 page as HTML, from the Mac fallback (same database)
  try {
    r = await call("GET", `/m/${slug2}`, undefined, undefined, { accept: "text/html" }, mac);
    step(`GET ${mac}/m/:slug with Accept text/html → the W01–W06 page as text/html with the owner's name and the three prompts`, r.status,
      r.status === 200 && r.type.startsWith("text/html") && r.text.includes("Check") && r.text.includes("asked for your perspective") &&
        r.text.includes("How do you know") && r.text.includes("What was happening?") && r.text.includes("What did Check do or say?") &&
        r.text.includes("What seemed to matter to Check there?") && r.text.includes("Thank you") &&
        r.text.includes("Add another moment") && r.text.includes("Delete my answer") && /noindex/i.test(r.text),
      `content-type=${r.type} bytes=${r.text.length}`, r.ms);
  } catch (e) {
    step(`GET ${mac}/m/:slug as HTML (the Mac fallback)`, 0, false, `unreachable: ${(e as Error).message}`);
  }
  if (hosted) {
    r = await call("GET", `/m/${slug2}`, undefined, undefined, { accept: "text/html" });
    step("hosted GET /m/:slug as HTML: the body is the page, the gateway labels it (Q64: text/plain on the shared domain)", r.status,
      r.status === 200 && r.text.includes("What was happening?"), `content-type=${r.type}`, r.ms);
  }
  r = await call("PATCH", "/mirror", { on: false }, token);
  m = (r.json.mirror as R) ?? {};
  step("PATCH /mirror off → off, slug and link hidden", r.status, r.status === 200 && m.on === false && m.slug === null && m.link === null, "", r.ms);
  r = await call("GET", `/m/${slug2}`);
  step("the page while off: closed, reason off", r.status, r.status === 200 && r.json.open === false && r.json.reason === "off", `reason=${r.json.reason}`, r.ms);
  r = await call("PATCH", "/mirror", { on: true }, token);
  step("on again keeps the slug (the link is the same unless rotated)", r.status, (r.json.mirror as R)?.slug === slug2, `slug=${(r.json.mirror as R)?.slug}`, r.ms);
  r = await call("DELETE", "/mirror", undefined, token);
  m = (r.json.mirror as R) ?? {};
  step("Delete link and everything pending → off, no slug", r.status, r.status === 200 && m.on === false && m.slug === null && m.link === null, J(m), r.ms);
  r = await call("GET", `/m/${slug2}`);
  step("the deleted link no longer works", r.status, r.status === 404 || (r.json.open === false && r.json.reason === "not_found"), `status=${r.status} reason=${r.json.reason}`, r.ms);
  const { count } = await service.from("mirror_links").select("id", { count: "exact", head: true }).eq("owner", owner);
  step("no mirror_links row left for the owner", 200, (count ?? 1) === 0, `rows=${count}`);
} finally {
  const { error } = await service.auth.admin.deleteUser(owner);
  const { count } = await service.from("profiles").select("id", { count: "exact", head: true }).eq("id", owner);
  step("cleanup: the throwaway owner is gone", 200, !error && (count ?? 1) === 0, error?.message ?? `profiles left=${count}`);
}

const when = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const dir = new URL(`../reports/${when}-mirror-owner${hosted ? "-hosted" : ""}/`, import.meta.url);
await Deno.mkdir(dir, { recursive: true });
const passed = results.filter((x) => x.ok).length;
await Deno.writeTextFile(new URL("report.md", dir), [`# Mirror owner settings check ${when} (${hosted ? "through the hosted function" : liveMac ? `through ${mac}` : "in-process, hosted database"}; page from ${mac})`, "",
  `Throwaway owner, no model call, $0. ${passed}/${results.length} steps passed.`, "", "| step | status | ok | ms | note |", "|---|---|---|---|---|",
  ...results.map((x) => `| ${x.step} | ${x.status} | ${x.ok ? "PASS" : "FAIL"} | ${x.ms || ""} | ${x.note.replace(/\|/g, "\\|")} |`), ""].join("\n"));
for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${String(x.status).padEnd(4)} ${x.step.padEnd(100)} ${x.note}`);
console.log(`\n${passed}/${results.length} passed; report ${dir.pathname}report.md`);
Deno.exit(passed === results.length ? 0 : 1);
