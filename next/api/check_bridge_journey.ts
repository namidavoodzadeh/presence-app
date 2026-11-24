// $0 journey check of Bridge, both ways, between two example accounts (Nami ↔ Lea): everything that needs no model (COO check-in
// 23:30 10-27, item 9). Each direction runs the same steps: send mine; schedule; deliver at time (a bridge set a few seconds ahead
// is sealed, then ready once its time passes); the receiver's sealed view (no text, no tone, no `used`, no mark); open; the read
// receipt per setting ("Show when I've opened": the sender sees `opened_at` only while it is on for both); Talked about it from
// either side (a Let's talk plan marked talked by the sender, then one by the receiver); withdraw (seen bubble → "withdrew",
// unseen → nothing, opened → too_late). The owner's and the cast's drafts are read first and put back; every bridge, plan and
// event the check made is removed at the end and the link settings are restored (read receipts on, unread off).
//   deno run --allow-net --allow-read --allow-env --allow-write next/api/check_bridge_journey.ts [--hosted] [--personas nami,lea]
//     --hosted            through the deployed function (default: the same handler in-process, same hosted database)
//     --personas a,b      run on two preview accounts (the COO named Nami ↔ Lea). Default: two throwaway accounts this check creates,
//                         links by invite and deletes at the end, because the preview accounts are in use by the app lane at the same
//                         time (on 10-27 23:42 Tehran their "Delete conversation" cleared both threads under a running journey, and a
//                         journey's thread reads mark their sealed bubbles as seen). Same steps either way.
// Writes next/reports/<stamp>-bridge-journey[-hosted]/report.md with every step's result.
import { handler } from "./index.ts";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

type R = Record<string, unknown>;
const J = (o: unknown) => JSON.stringify(o);
const Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const env = await loadEnv();
const hosted = Deno.args.includes("--hosted");
const base = hosted ? `${env.supabaseUrl}/functions/v1/api` : "http://api.local";
const service = serviceClient(env);
const results: { dir: string; step: string; status: number; ok: boolean; note: string; ms: number }[] = [];
let dirName = "";
const step = (name: string, status: number, ok: boolean, note = "", ms = 0) => { results.push({ dir: dirName, step: name, status, ok, note, ms }); if (!ok) console.log("   !", dirName, name, status, note); };

async function call(method: string, path: string, body?: unknown, token?: string) {
  const t0 = performance.now();
  const req = new Request(base + path, { method, headers: { "content-type": "application/json", apikey: env.anonKey, "x-presence-tz": "Asia/Tehran", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const res = hosted ? await fetch(req) : await handler(req);
  const text = await res.text();
  let json: R = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json, ms: Math.round(performance.now() - t0) };
}
interface Acct { token: string; id: string; name: string; tz: string | null }
async function login(p: string): Promise<Acct> {
  const r = await call("POST", "/preview/login", { persona: p });
  const person = (r.json.me as R)?.person as R;
  return { token: String(r.json.access_token ?? ""), id: String(person?.id ?? ""), name: String(person?.name ?? ""), tz: (person?.tz as string | null) ?? null };
}
/** A throwaway account (as check_data.ts makes them): a real user, not preview, not example; its zone set through PATCH /me. */
const runStamp = Date.now().toString(36);
const password = `check-${runStamp}-${crypto.randomUUID()}`;
async function throwaway(name: string, tz: string): Promise<Acct> {
  const email = `check-journey-${runStamp}-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@preview.presence.app`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${name}: ${error?.message}`);
  const { error: e2 } = await service.from("profiles").insert({ id: data.user.id, name, is_example: false, is_preview: false });
  if (e2) throw new Error(`profile ${name}: ${e2.message}`);
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const anon = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e3 } = await anon.auth.signInWithPassword({ email, password });
  if (e3 || !s.session) throw new Error(`sign in ${name}: ${e3?.message}`);
  const token = s.session.access_token;
  const r = await call("PATCH", "/me", { tz }, token);
  if (r.status !== 200) throw new Error(`PATCH /me tz ${name}: ${r.status} ${J(r.json)}`);
  return { token, id: data.user.id, name, tz };
}
const personasIdx = Deno.args.indexOf("--personas");
const personas = personasIdx >= 0 ? String(Deno.args[personasIdx + 1] ?? "nami,lea").split(",").map((x) => x.trim()).filter(Boolean) : null;
const bridgesOf = (items: R[]) => items.filter((i) => i.kind === "bridge").map((i) => i.bridge as R);
const eventsOf = (items: R[]) => items.filter((i) => i.kind === "event").map((i) => i.event as R);
const plansOf = (items: R[]) => items.filter((i) => i.kind === "plan").map((i) => i.plan as R);
const TEXT_KEYS = ["final", "original", "bridged", "tone", "tone_original", "tone_bridged", "used", "bridged_mark", "show_original", "changes", "points", "outcome"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const made = { bridges: [] as string[], plans: [] as string[] };
const savedDrafts: { owner: Acct; other: Acct; draft: R | null }[] = [];

/** QA-B16: the receiver clears one scheduled bridge, then must see only the one scheduled afterward. */
async function clearThenScheduleAgain(S: Acct, Rv: Acct) {
  dirName = `${S.name} → ${Rv.name} clear regression`;
  const due = new Date(Date.now() + 24 * 3600e3).toISOString();
  const send = async (which: string) => {
    const text = `${S.name} to ${Rv.name}, ${which} scheduled bridge around a cleared thread.`;
    const r = await call("POST", "/bridges", {
      person_id: Rv.id,
      original: text,
      final: text,
      used: "mine",
      deliver_at: due,
      heads_up: true,
    }, S.token);
    const bridge = (r.json.bridge as R) ?? {};
    if (bridge.id) made.bridges.push(String(bridge.id));
    step(`schedule ${which} bridge`, r.status, r.status === 200 && bridge.delivered === false, "", r.ms);
    return bridge;
  };

  const before = await send("before-clear");
  let r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  step("receiver sees the before-clear sealed bridge", r.status,
    bridgesOf((r.json.items as R[]) ?? []).some((b) => b.id === before.id && b.sealed === true), "", r.ms);
  r = await call("DELETE", `/threads/${S.id}`, undefined, Rv.token);
  step("receiver clears the thread", r.status, r.status === 200 && r.json.deleted === true && Z.test(String(r.json.cleared_at)), "", r.ms);

  const after = await send("after-clear");
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  const visible = bridgesOf((r.json.items as R[]) ?? []);
  step("receiver sees only the bridge scheduled after the clear", r.status,
    !visible.some((b) => b.id === before.id) && visible.some((b) => b.id === after.id && b.sealed === true),
    `visible=${J(visible.map((b) => String(b.id).slice(0, 8)))}`, r.ms);
  const ids = [String(before.id), String(after.id)];
  const { error } = await service.from("bridges").delete().in("id", ids);
  step("clear regression rows removed before the ordinary journey", 200, !error, error?.message ?? "");
  made.bridges = made.bridges.filter((id) => !ids.includes(id));
}

async function journey(S: Acct, Rv: Acct) {
  dirName = `${S.name} → ${Rv.name}`;
  console.log(`\n== ${dirName}`);
  const T1 = `${S.name} to ${Rv.name}, sent as written: dinner moved twice this week without a heads-up, and I noticed it.`;
  const T2 = `${S.name} to ${Rv.name}, scheduled a few seconds ahead: I would like us to settle the plan the day before.`;
  const T3 = `${S.name} to ${Rv.name}, for tomorrow, to be withdrawn after the bubble was seen.`;
  const T4 = `${S.name} to ${Rv.name}, for tomorrow, quiet, to be withdrawn unseen.`;

  // the sender's existing draft to the receiver is kept and put back at the end (the owner's words are never lost to a check)
  let r = await call("GET", `/drafts/${Rv.id}`, undefined, S.token);
  savedDrafts.push({ owner: S, other: Rv, draft: (r.json.draft as R | null) ?? null });
  r = await call("GET", "/threads", undefined, Rv.token);
  const row0 = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === S.id);
  const badge0 = Number(row0?.badge ?? 0);
  const rDraftToS = async () => { const d = await call("GET", `/drafts/${S.id}`, undefined, Rv.token); return !!(d.json.draft as R | null)?.text; };
  // someone else (the app lane shares these preview accounts) may write a draft meanwhile; a draft rightly tops the row, so it is tolerated and noted
  const sDraftToR = async () => { const d = await call("GET", `/drafts/${Rv.id}`, undefined, S.token); return !!(d.json.draft as R | null)?.text; };

  // ---- send mine
  r = await call("PUT", `/drafts/${Rv.id}`, { text: T1 }, S.token);
  step("PUT /drafts/:person (the words as written)", r.status, r.status === 200 && (r.json.draft as R)?.text === T1, "", r.ms);
  r = await call("POST", "/bridges", { person_id: Rv.id, original: T1, final: T1, used: "mine", deliver_at: "now", heads_up: true, tz: "Asia/Tehran" }, S.token);
  const b1 = (r.json.bridge as R) ?? {};
  if (b1.id) made.bridges.push(String(b1.id));
  step("send mine: POST /bridges used mine, deliver_at now → delivered, no bridged mark, opened_at null", r.status,
    r.status === 200 && b1.status === "scheduled" && b1.delivered === true && b1.used === "mine" && b1.bridged_mark === false && b1.opened_at === null && (b1.to as R)?.id === Rv.id && b1.receiver_tz === Rv.tz && b1.final === T1,
    `id ${String(b1.id).slice(0, 8)} delivered=${b1.delivered} mark=${b1.bridged_mark} receiver_tz=${b1.receiver_tz}`, r.ms);
  r = await call("GET", `/drafts/${Rv.id}`, undefined, S.token);
  step("the draft is cleared by sending", r.status, r.status === 200 && r.json.draft === null, J(r.json), r.ms);

  // ---- the receiver's ready view
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  let v = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b1.id);
  step("receiver's thread: ready, not sealed, no text, no tone, no used, no mark", r.status,
    !!v && v.ready === true && v.sealed === false && v.opened_at === null && v.remind_at === null && TEXT_KEYS.every((k) => !(k in v!)) && (v.from as R)?.id === S.id,
    `keys=${J(Object.keys(v ?? {}))}`, r.ms);
  r = await call("GET", "/threads", undefined, Rv.token);
  let row = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === S.id);
  step("receiver's list: badge up by one, tab dot, row unread, last is ready (or their own draft)", r.status,
    Number(row?.badge) === badge0 + 1 && r.json.bridge_tab_dot === true && row?.unread === true && ["ready", "draft"].includes(String((row?.last as R)?.kind)) && (row?.last as R)?.text !== T1,
    `badge=${row?.badge} (was ${badge0}) last=${(row?.last as R)?.kind} dot=${r.json.bridge_tab_dot}`, r.ms);

  // ---- open
  r = await call("POST", `/bridges/${b1.id}/open`, {}, Rv.token);
  const o1 = (r.json.bridge as R) ?? {};
  const openedAt1 = String(r.json.opened_at ?? "");
  step("open: the words as written, used mine, no bridged mark, no original, no tone, opened_at set", r.status,
    r.status === 200 && o1.final === T1 && o1.used === "mine" && o1.bridged_mark === false && o1.original === null && o1.tone === null && Z.test(openedAt1) && o1.ready === false && o1.sealed === false,
    `final="${String(o1.final).slice(0, 24)}…" opened_at=${openedAt1}`, r.ms);
  r = await call("GET", "/threads", undefined, Rv.token);
  row = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === S.id);
  step("receiver's list after opening: badge back, last is the opened words (or their own draft)", r.status,
    Number(row?.badge) === badge0 && (((row?.last as R)?.kind === "opened" && (row?.last as R)?.text === T1) || ((row?.last as R)?.kind === "draft" && await rDraftToS())),
    `badge=${row?.badge} last=${(row?.last as R)?.kind}`, r.ms);

  // ---- read receipt per setting (Y03 "Show when I've opened": on for both → opened_at; off on either side → null, as in WhatsApp)
  r = await call("GET", `/threads/${Rv.id}`, undefined, S.token);
  let mine = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b1.id);
  step("read receipts on for both (default): the sender sees opened_at", r.status, !!mine && mine.opened_at === openedAt1 && mine.delivered === true, `opened_at=${mine?.opened_at}`, r.ms);
  r = await call("GET", "/threads", undefined, S.token);
  row = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === Rv.id);
  step("sender's list: last is opened with the words (or a draft someone wrote meanwhile), activity_at is the opening", r.status,
    (((row?.last as R)?.kind === "opened" && (row?.last as R)?.text === T1) || ((row?.last as R)?.kind === "draft" && await sDraftToR())) && row?.activity_at === openedAt1, `last=${(row?.last as R)?.kind} activity_at=${row?.activity_at}`, r.ms);
  r = await call("PATCH", `/links/${S.id}`, { read_receipts: false }, Rv.token);
  step("receiver turns Show when I've opened off", r.status, r.status === 200 && (r.json.link as R)?.read_receipts === false, "", r.ms);
  r = await call("GET", `/threads/${Rv.id}`, undefined, S.token);
  mine = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b1.id);
  step("receiver off: the sender's opened_at is null, still delivered", r.status, !!mine && mine.opened_at === null && mine.delivered === true, `opened_at=${mine?.opened_at}`, r.ms);
  r = await call("GET", "/threads", undefined, S.token);
  row = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === Rv.id);
  step("receiver off: the sender's row never says opened, activity_at is not the opening", r.status,
    (((row?.last as R)?.kind === "scheduled" && (row?.last as R)?.text === null) || ((row?.last as R)?.kind === "draft" && await sDraftToR())) && row?.activity_at !== openedAt1, `last=${(row?.last as R)?.kind} activity_at=${row?.activity_at}`, r.ms);
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  v = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b1.id);
  step("receiver off: their own opened view keeps its opened_at and the words", r.status, !!v && v.opened_at === openedAt1 && v.final === T1, "", r.ms);
  r = await call("PATCH", `/links/${S.id}`, { read_receipts: true }, Rv.token);
  r = await call("PATCH", `/links/${Rv.id}`, { read_receipts: false }, S.token);
  step("receiver back on, sender off (off also hides theirs)", r.status, r.status === 200 && (r.json.link as R)?.read_receipts === false, "", r.ms);
  r = await call("GET", `/threads/${Rv.id}`, undefined, S.token);
  mine = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b1.id);
  step("sender off: the sender's opened_at is null", r.status, !!mine && mine.opened_at === null, `opened_at=${mine?.opened_at}`, r.ms);
  r = await call("PATCH", `/links/${Rv.id}`, { read_receipts: true }, S.token);
  r = await call("GET", `/threads/${Rv.id}`, undefined, S.token);
  mine = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b1.id);
  step("both on again: opened_at is back", r.status, !!mine && mine.opened_at === openedAt1, `opened_at=${mine?.opened_at}`, r.ms);
  r = await call("GET", "/export", undefined, S.token);
  const exported = ((r.json.bridges_sent as R[]) ?? []).find((b) => b.id === b1.id);
  step("GET /export carries the sent bridge with opened_at (receipts on)", r.status, r.status === 200 && !!exported && exported.opened_at === openedAt1, `opened_at=${exported?.opened_at}`, r.ms);

  // ---- schedule, the sealed view, deliver at time
  const LEAD = 45_000;   // long enough for the sealed checks below to run before the time passes, in-process too (a thread list read is slow from here)
  const ahead = new Date(Date.now() + LEAD).toISOString();
  r = await call("POST", "/bridges", { person_id: Rv.id, original: T2, final: T2, used: "mine", deliver_at: ahead, heads_up: true, tz: "Asia/Tehran" }, S.token);
  const b2 = (r.json.bridge as R) ?? {};
  if (b2.id) made.bridges.push(String(b2.id));
  step("schedule: POST /bridges 45 seconds ahead → scheduled, not delivered", r.status,
    r.status === 200 && b2.status === "scheduled" && b2.delivered === false && b2.opened_at === null && Z.test(String(b2.deliver_at)) && new Date(String(b2.deliver_at)).getTime() === new Date(ahead).getTime(),
    `id ${String(b2.id).slice(0, 8)} deliver_at=${b2.deliver_at}`, r.ms);
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  v = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b2.id);
  const sealedKeys = Object.keys(v ?? {}).sort();
  step("receiver's sealed view: sealed, not ready, deliver_at and from only; no text, tone, used, mark, length", r.status,
    !!v && v.sealed === true && v.ready === false && v.opened_at === null && v.heads_up === true && TEXT_KEYS.every((k) => !(k in v!)) && !("remind_at" in v!) && !("length" in v!) && !("words" in v!) && sealedKeys.every((k) => ["deliver_at", "from", "heads_up", "id", "opened_at", "plan", "ready", "reply_to", "sealed"].includes(k)),
    `keys=${J(sealedKeys)}`, r.ms);
  r = await call("POST", `/bridges/${b2.id}/open`, {}, Rv.token);
  step("open before its time → 403 sealed with deliver_at", r.status, r.status === 403 && r.json.error === "sealed" && !!r.json.deliver_at, `error=${r.json.error}`, r.ms);
  r = await call("POST", `/bridges/${b2.id}/remind`, { remind_at: new Date(Date.now() + 3600e3).toISOString() }, Rv.token);
  step("remind before its time → 403 sealed", r.status, r.status === 403 && r.json.error === "sealed", `error=${r.json.error}`, r.ms);
  r = await call("DELETE", `/bridges/${b2.id}`, undefined, Rv.token);
  step("receiver's DELETE before its time → 403 sealed with deliver_at, not a silent 200 (A-Q16)", r.status, r.status === 403 && r.json.error === "sealed" && !!r.json.deliver_at, `error=${r.json.error}`, r.ms);
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  v = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b2.id);
  step("the refused delete changed nothing: still listed sealed", r.status, !!v && v.sealed === true && v.ready === false, `sealed=${v?.sealed}`, r.ms);
  r = await call("DELETE", `/bridges/${crypto.randomUUID()}`, undefined, Rv.token);
  step("DELETE a bridge that is not mine → 404", r.status, r.status === 404 && r.json.error === "not_found", `error=${r.json.error}`, r.ms);
  r = await call("GET", "/threads", undefined, Rv.token);
  row = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === S.id);
  step("receiver's list: sealed does not badge; last is sealed (or their own draft)", r.status,
    Number(row?.badge) === badge0 && ["sealed", "draft"].includes(String((row?.last as R)?.kind)) && (row?.last as R)?.text !== T2 && Date.now() < new Date(String(b2.deliver_at)).getTime(),
    `badge=${row?.badge} last=${(row?.last as R)?.kind} ${Math.round((new Date(String(b2.deliver_at)).getTime() - Date.now()) / 1000)} s before its time`, r.ms);
  // deliver at time: poll until the receiver's view turns ready
  const due = new Date(String(b2.deliver_at)).getTime();
  let readyAt = 0, polls = 0;
  while (Date.now() < due + 20_000) {
    r = await call("GET", `/threads/${S.id}`, undefined, Rv.token); polls++;
    v = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b2.id);
    if (v?.ready === true) { readyAt = Date.now(); break; }
    if (Date.now() < due) step(`still sealed ${Math.round((due - Date.now()) / 1000)} s before its time`, r.status, v?.sealed === true, "", r.ms);
    await sleep(2000);
  }
  step("deliver at time: the receiver's view turns ready once deliver_at passes (no job, computed)", r.status,
    readyAt > 0 && readyAt >= due && !!v && v.ready === true && v.sealed === false && TEXT_KEYS.every((k) => !(k in v!)),
    `ready ${readyAt ? Math.round((readyAt - due) / 100) / 10 : "never"} s after deliver_at, ${polls} poll(s)`, r.ms);
  r = await call("GET", `/threads/${Rv.id}`, undefined, S.token);
  mine = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b2.id);
  step("the sender's view says delivered, not opened", r.status, !!mine && mine.delivered === true && mine.opened_at === null, `delivered=${mine?.delivered}`, r.ms);
  r = await call("GET", "/threads", undefined, Rv.token);
  row = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === S.id);
  step("receiver's list: the ready one badges", r.status, Number(row?.badge) === badge0 + 1 && r.json.bridge_tab_dot === true, `badge=${row?.badge}`, r.ms);
  r = await call("POST", `/bridges/${b2.id}/open`, {}, Rv.token);
  const o2 = (r.json.bridge as R) ?? {};
  step("open the delivered one → the words", r.status, r.status === 200 && o2.final === T2 && Z.test(String(r.json.opened_at)), "", r.ms);

  // ---- Talked about it, from either side
  r = await call("POST", `/bridges/${b2.id}/letstalk`, { when: "soon" }, Rv.token);
  const plan1 = (r.json.plan as R) ?? {};
  if (plan1.id) made.plans.push(String(plan1.id));
  step("receiver: Let's talk soon → a plan", r.status, r.status === 200 && plan1.status === "planned" && plan1.soon === true && plan1.proposed_by === Rv.id && plan1.bridge_id === b2.id, `plan ${String(plan1.id).slice(0, 8)}`, r.ms);
  r = await call("GET", `/threads/${Rv.id}`, undefined, S.token);
  mine = bridgesOf((r.json.items as R[]) ?? []).find((b) => b.id === b2.id);
  step("the sender sees the plan on the bridge and as an item", r.status, (mine?.plan as R)?.id === plan1.id && plansOf((r.json.items as R[]) ?? []).some((p) => p.id === plan1.id), `plan=${(mine?.plan as R)?.status}`, r.ms);
  r = await call("PATCH", `/plans/${plan1.id}`, { talked: true }, S.token);
  step("sender: We talked → plan talked, a talked event by the sender", r.status,
    r.status === 200 && (r.json.plan as R)?.status === "talked" && Z.test(String((r.json.plan as R)?.talked_at)) && (r.json.event as R)?.type === "talked" && (r.json.event as R)?.by === S.id && (r.json.event as R)?.bridge_id === b2.id,
    `event=${(r.json.event as R)?.type} by=${(r.json.event as R)?.by === S.id ? S.name : "?"}`, r.ms);
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  let ev = eventsOf((r.json.items as R[]) ?? []);
  step("receiver's thread shows Talked about it (by the sender) and the plan as talked", r.status,
    ev.some((e) => e.type === "talked" && e.by === S.id && e.plan_id === plan1.id) && plansOf((r.json.items as R[]) ?? []).some((p) => p.id === plan1.id && p.status === "talked"),
    `events=${J(ev.map((e) => `${e.type}:${e.by === S.id ? S.name : e.by === Rv.id ? Rv.name : "?"}`))}`, r.ms);
  const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString();
  r = await call("POST", `/bridges/${b1.id}/letstalk`, { when: tomorrow }, Rv.token);
  const plan2 = (r.json.plan as R) ?? {};
  if (plan2.id) made.plans.push(String(plan2.id));
  step("receiver: Let's talk tomorrow on the first bridge → a timed plan", r.status, r.status === 200 && plan2.status === "planned" && plan2.soon === false && Z.test(String(plan2.when)), `when=${plan2.when}`, r.ms);
  r = await call("PATCH", `/plans/${plan2.id}`, { when: "soon" }, S.token);
  step("sender: Change time to soon (either side may)", r.status, r.status === 200 && (r.json.plan as R)?.soon === true && r.json.event === null, "", r.ms);
  r = await call("PATCH", `/plans/${plan2.id}`, { talked: true }, Rv.token);
  step("receiver: We talked → plan talked, a talked event by the receiver", r.status,
    r.status === 200 && (r.json.plan as R)?.status === "talked" && (r.json.event as R)?.type === "talked" && (r.json.event as R)?.by === Rv.id, `by=${(r.json.event as R)?.by === Rv.id ? Rv.name : "?"}`, r.ms);
  r = await call("GET", `/threads/${Rv.id}`, undefined, S.token);
  ev = eventsOf((r.json.items as R[]) ?? []);
  step("sender's thread shows both Talked about it lines (one by each side)", r.status,
    ev.some((e) => e.type === "talked" && e.by === S.id && e.plan_id === plan1.id) && ev.some((e) => e.type === "talked" && e.by === Rv.id && e.plan_id === plan2.id),
    `events=${J(ev.map((e) => `${e.type}:${e.by === S.id ? S.name : e.by === Rv.id ? Rv.name : "?"}`))}`, r.ms);
  r = await call("PATCH", `/plans/${plan2.id}`, { talked: true }, S.token);
  step("We talked twice → 409", r.status, r.status === 409, `error=${r.json.error}`, r.ms);

  // ---- withdraw
  r = await call("POST", "/bridges", { person_id: Rv.id, original: T3, final: T3, used: "mine", deliver_at: tomorrow, heads_up: true }, S.token);
  const b3 = (r.json.bridge as R) ?? {};
  if (b3.id) made.bridges.push(String(b3.id));
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  step("a sealed one for tomorrow; the receiver's thread shows the bubble", r.status, !!b3.id && bridgesOf((r.json.items as R[]) ?? []).some((b) => b.id === b3.id && b.sealed === true), "", r.ms);
  r = await call("POST", `/bridges/${b3.id}/withdraw`, {}, S.token);
  step("withdraw after the bubble was seen → receiver_sees withdrawn, status withdrawn", r.status, r.status === 200 && r.json.receiver_sees === "withdrawn" && (r.json.bridge as R)?.status === "withdrawn", `receiver_sees=${r.json.receiver_sees}`, r.ms);
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  ev = eventsOf((r.json.items as R[]) ?? []);
  step("receiver's thread: the bubble is gone, a withdrew line in its place", r.status,
    !bridgesOf((r.json.items as R[]) ?? []).some((b) => b.id === b3.id) && ev.some((e) => e.type === "withdrew" && e.bridge_id === b3.id && e.by === S.id), `events=${J(ev.map((e) => e.type))}`, r.ms);
  r = await call("POST", "/bridges", { person_id: Rv.id, original: T4, final: T4, used: "mine", deliver_at: tomorrow, heads_up: false }, S.token);
  const b4 = (r.json.bridge as R) ?? {};
  if (b4.id) made.bridges.push(String(b4.id));
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  step("a quiet one (heads_up off) for tomorrow: absent from the receiver's thread", r.status, !!b4.id && !bridgesOf((r.json.items as R[]) ?? []).some((b) => b.id === b4.id), "", r.ms);
  r = await call("POST", `/bridges/${b4.id}/withdraw`, {}, S.token);
  step("withdraw the quiet one → receiver_sees nothing", r.status, r.status === 200 && r.json.receiver_sees === "nothing", `receiver_sees=${r.json.receiver_sees}`, r.ms);
  r = await call("GET", `/threads/${S.id}`, undefined, Rv.token);
  step("receiver's thread: no withdrew line for the one they never saw", r.status, !eventsOf((r.json.items as R[]) ?? []).some((e) => e.bridge_id === b4.id), "", r.ms);
  r = await call("POST", `/bridges/${b1.id}/withdraw`, {}, S.token);
  step("withdraw an opened one → 403 too_late", r.status, r.status === 403 && r.json.reason === "too_late", `reason=${r.json.reason}`, r.ms);
  r = await call("GET", `/threads/${Rv.id}`, undefined, S.token);
  const sb = bridgesOf((r.json.items as R[]) ?? []);
  step("sender's thread: the two withdrawn ones are gone, the two opened ones stay with their plans", r.status,
    !sb.some((b) => b.id === b3.id || b.id === b4.id) && sb.some((b) => b.id === b1.id && (b.plan as R)?.status === "talked") && sb.some((b) => b.id === b2.id && (b.plan as R)?.status === "talked"), `bridges=${sb.length}`, r.ms);
}

// ---- run both ways
dirName = "setup";
let A: Acct, B: Acct;
if (personas) {
  A = await login(personas[0]); B = await login(personas[1] ?? "lea");
  step(`login ${personas.join(" + ")} (preview accounts)`, 200, !!A.token && !!B.token && !!A.id && !!B.id, `${A.name} tz=${A.tz} ${B.name} tz=${B.tz}`);
} else {
  A = await throwaway("Journey A", "Asia/Tehran"); B = await throwaway("Journey B", "Europe/Berlin");
  step("two throwaway accounts, zones set", 200, !!A.token && !!B.token, `A tz=${A.tz} B tz=${B.tz}`);
  let r = await call("POST", "/invites", {}, A.token);
  const code = String(r.json.code ?? "");
  r = await call("POST", `/invites/${code}/accept`, {}, B.token);
  step("linked by invite (A invites, B accepts)", r.status, r.status === 200 && (r.json.person as R)?.id === A.id, `code ${code}`, r.ms);
}
const pair = `and(sender.eq.${A.id},receiver.eq.${B.id}),and(sender.eq.${B.id},receiver.eq.${A.id})`;
const { count: before } = await service.from("bridges").select("*", { count: "exact", head: true }).or(pair);
try {
  await clearThenScheduleAgain(A, B);
  await clearThenScheduleAgain(B, A);
  await journey(A, B);
  await journey(B, A);
} finally {
  // ---- clean up
  dirName = "cleanup";
  if (personas) {
    // everything the check made goes; the link settings and the drafts go back
    if (made.plans.length) await service.from("thread_events").delete().in("plan_id", made.plans);
    if (made.bridges.length) await service.from("thread_events").delete().in("bridge_id", made.bridges);
    if (made.plans.length) await service.from("plans").delete().in("id", made.plans);
    if (made.bridges.length) await service.from("bridges").delete().in("id", made.bridges);
    await service.from("link_prefs").update({ read_receipts: true, unread: false }).or(`and(owner.eq.${A.id},other.eq.${B.id}),and(owner.eq.${B.id},other.eq.${A.id})`);
    for (const d of savedDrafts) {
      if (d.draft?.text) await call("PUT", `/drafts/${d.other.id}`, { text: d.draft.text, reply_to: d.draft.reply_to ?? null }, d.owner.token);
      else await call("DELETE", `/drafts/${d.other.id}`, undefined, d.owner.token);
    }
    const { count: after } = await service.from("bridges").select("*", { count: "exact", head: true }).or(pair);
    const { count: plansLeft } = await service.from("plans").select("*", { count: "exact", head: true }).in("id", made.plans.length ? made.plans : ["00000000-0000-0000-0000-000000000000"]);
    let r = await call("GET", `/drafts/${B.id}`, undefined, A.token);
    const aBack = ((r.json.draft as R | null)?.text ?? null) === (savedDrafts[0]?.draft?.text ?? null);
    r = await call("GET", `/drafts/${A.id}`, undefined, B.token);
    const bBack = ((r.json.draft as R | null)?.text ?? null) === (savedDrafts[1]?.draft?.text ?? null);
    step(`cleanup: bridges between ${A.name} and ${B.name} as before, plans gone, read receipts on, drafts put back`, 200,
      (after ?? -1) === (before ?? -2) && (plansLeft ?? 1) === 0 && aBack && bBack, `bridges ${before} → ${after}; plans left ${plansLeft}; drafts back ${A.name}=${aBack} ${B.name}=${bBack}`);
  } else {
    // the throwaway users go, and auth's hard delete cascades every row of theirs
    const errs: string[] = [];
    for (const u of [A, B]) { const { error } = await service.auth.admin.deleteUser(u.id); if (error) errs.push(error.message); }
    const { count: profiles } = await service.from("profiles").select("id", { count: "exact", head: true }).in("id", [A.id, B.id]);
    const { count: bridges } = await service.from("bridges").select("id", { count: "exact", head: true }).or(pair);
    step("cleanup: both throwaway users and every row of theirs are gone", 200, errs.length === 0 && (profiles ?? 1) === 0 && (bridges ?? 1) === 0, errs.join("; ") || `profiles left=${profiles} bridges left=${bridges}`);
  }
}

// ---- report
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const dir = new URL(`../reports/${stamp}-bridge-journey${hosted ? "-hosted" : ""}/`, import.meta.url);
await Deno.mkdir(dir, { recursive: true });
const passed = results.filter((x) => x.ok).length;
const lines = [`# Bridge journey check ${stamp} (${hosted ? "through the hosted function" : "in-process, hosted database"})`, "",
  `${personas ? `${A.name} ↔ ${B.name} (preview accounts)` : "two throwaway accounts linked by invite"}, both ways, no model call, $0. ${passed}/${results.length} steps passed.`, "", "| dir | step | status | ok | ms | note |", "|---|---|---|---|---|---|",
  ...results.map((x) => `| ${x.dir} | ${x.step} | ${x.status} | ${x.ok ? "PASS" : "FAIL"} | ${x.ms || ""} | ${x.note.replace(/\|/g, "\\|")} |`), ""];
await Deno.writeTextFile(new URL("report.md", dir), lines.join("\n"));
console.log("");
for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${String(x.status).padEnd(4)} ${x.dir.padEnd(12)} ${x.step.padEnd(92)} ${x.note}`);
console.log(`\n${passed}/${results.length} passed; report ${dir.pathname}report.md`);
Deno.exit(passed === results.length ? 0 : 1);
