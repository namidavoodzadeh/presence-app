// $0 live check of Your data (CONTRACT §7 Data) against the hosted database. The preview accounts are only read (GET /export as
// Nami and Lea; the two deletes answer 403 for them). The deletes themselves run on two throwaway accounts this check creates,
// links and fills, then removes completely (auth hard delete cascades everything). Nothing of the owner's or the cast's changes.
//   deno run --allow-net --allow-read --allow-env next/api/check_data.ts [--hosted]      (--hosted: through the deployed function)
import { handler } from "./index.ts";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";
import { DELETED_NAME } from "./data.ts";

const env = await loadEnv();
const hosted = Deno.args.includes("--hosted");
const base = hosted ? `${env.supabaseUrl}/functions/v1/api` : "http://api.local";
const service = serviceClient(env);
const J = (o: unknown) => JSON.stringify(o);
type R = Record<string, unknown>;
const results: { step: string; status: number; ok: boolean; note: string }[] = [];
const step = (name: string, status: number, ok: boolean, note = "") => { results.push({ step: name, status, ok, note }); if (!ok) console.log("   !", name, status, note); };

async function call(method: string, path: string, body?: unknown, token?: string) {
  const req = new Request(base + path, { method, headers: { "content-type": "application/json", apikey: env.anonKey, "x-presence-tz": "Asia/Tehran", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const res = hosted ? await fetch(req) : await handler(req);
  const text = await res.text();
  let json: R = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json, headers: res.headers };
}

// ---- the preview accounts: read only
let r = await call("POST", "/preview/login", { persona: "nami" });
const nami = String(r.json.access_token ?? "");
r = await call("POST", "/preview/login", { persona: "lea" });
const lea = String(r.json.access_token ?? ""), leaId = String(((r.json.me as R)?.person as R)?.id ?? "");
step("login nami + lea", r.status, !!nami && !!lea);

r = await call("GET", "/export", undefined, nami);
const keys = ["exported_at", "me", "conversations", "beliefs", "links", "people", "bridges_sent", "bridges_received", "plans", "mirror", "never", "settings"];
step("GET /export as Nami: attachment with every section, no engine_calls", r.status, r.status === 200 && keys.every((k) => k in r.json) && !("engine_calls" in r.json) && /attachment; filename="presence-\d{4}-\d{2}-\d{2}\.json"/.test(r.headers.get("content-disposition") ?? ""),
  `sections=${keys.filter((k) => k in r.json).length}/${keys.length} disposition=${r.headers.get("content-disposition")} conversations=${(r.json.conversations as unknown[])?.length} beliefs=${(r.json.beliefs as unknown[])?.length}`);
r = await call("GET", "/export", undefined, lea);
const lx = r.json;
const received = (lx.bridges_received as R[]) ?? [];
step("GET /export as Lea: her map with receipts, only opened received bridges, no other map", r.status,
  r.status === 200 && (lx.beliefs as R[]).length > 0 && (lx.beliefs as R[]).every((b) => Array.isArray(b.receipts)) && received.every((b) => !!b.opened_at && typeof b.final === "string") && (lx.people as R[]).every((p) => !("beliefs" in p)),
  `beliefs=${(lx.beliefs as R[]).length} people=${(lx.people as R[]).length} sent=${(lx.bridges_sent as R[]).length} received(opened)=${received.length} plans=${(lx.plans as R[]).length} mirror.perspectives=${((lx.mirror as R)?.perspectives as R[])?.length}`);
r = await call("DELETE", "/map", undefined, lea);
step("DELETE /map as Lea (example) → 403 example_account", r.status, r.status === 403 && r.json.reason === "example_account", J(r.json));
r = await call("DELETE", "/account", undefined, lea);
step("DELETE /account as Lea → 403 preview_account", r.status, r.status === 403 && r.json.reason === "preview_account", J(r.json));
r = await call("DELETE", "/account", undefined, nami);
step("DELETE /account as Nami (owner preview) → 403 preview_account", r.status, r.status === 403 && r.json.reason === "preview_account", J(r.json));
const { data: leaLeft } = await service.from("beliefs").select("id", { count: "exact", head: true }).eq("owner", leaId);
void leaLeft;

// ---- two throwaway accounts: A sends B one opened bridge and one sealed one; A deletes map, then account
const stamp = Date.now().toString(36);
const password = `check-${stamp}-${crypto.randomUUID()}`;
async function throwaway(name: string): Promise<{ id: string; token: string }> {
  const email = `check-data-${stamp}-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@preview.presence.app`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${name}: ${error?.message}`);
  const { error: e2 } = await service.from("profiles").insert({ id: data.user.id, name, is_example: false, is_preview: false });
  if (e2) throw new Error(`profile ${name}: ${e2.message}`);
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const anon = createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e3 } = await anon.auth.signInWithPassword({ email, password });
  if (e3 || !s.session) throw new Error(`sign in ${name}: ${e3?.message}`);
  return { id: data.user.id, token: s.session.access_token };
}
const A = await throwaway("Check A"), B = await throwaway("Check B");
try {
  const a = A.id < B.id ? A.id : B.id, b = A.id < B.id ? B.id : A.id;
  await service.from("links").insert({ person_a: a, person_b: b });
  await service.from("link_prefs").insert([{ owner: A.id, other: B.id, relationship: "friend" }, { owner: B.id, other: A.id, relationship: "friend" }]);
  const { data: conv } = await service.from("conversations").insert({ owner: A.id, title: "Check", status: "finished" }).select("id").single();
  const { data: msg } = await service.from("messages").insert({ conversation_id: conv!.id, owner: A.id, role: "me", turn: 1, text: "I keep saying it is fine when it is not." }).select("id").single();
  const { data: bel } = await service.from("beliefs").insert({ owner: A.id, label: "Says it's fine", statement: "Part of you says it's fine so nobody has to deal with it.", type: "how I tend to react", kind: "everyday", area: "relationships", status: "confirmed", rating: "very", conversation_id: conv!.id }).select("id").single();
  await service.from("receipts").insert({ owner: A.id, belief_id: bel!.id, message_id: msg!.id, conversation_id: conv!.id, quote: "I keep saying it is fine" });
  await service.from("engine_calls").insert([{ person: A.id, purpose: "turn", model: "check", request: {}, conversation_id: conv!.id }, { person: A.id, purpose: "rewrite", model: "check", request: {} }]);
  await service.from("outside_perspectives").insert({ owner: A.id, label: "Goes quiet", statement: "People who know you say you go quiet.", people_count: 3, moment_count: 4 });
  const past = new Date(Date.now() - 3600e3).toISOString(), future = new Date(Date.now() + 86400e3).toISOString();
  const { data: opened } = await service.from("bridges").insert({ sender: A.id, receiver: B.id, original: "You never listen.", bridged: "I feel unheard.", final: "I feel unheard.", used: "bridged", deliver_at: past }).select("id").single();
  const { data: sealed } = await service.from("bridges").insert({ sender: A.id, receiver: B.id, original: "Still thinking about it.", final: "Still thinking about it.", used: "mine", deliver_at: future, heads_up: true, heads_up_seen_at: past }).select("id").single();
  r = await call("POST", `/bridges/${opened!.id}/open`, undefined, B.token);
  step("B opens A's delivered bridge", r.status, r.status === 200 && !!(r.json.bridge as R)?.opened_at, J(r.json).slice(0, 120));

  r = await call("GET", "/export", undefined, A.token);
  step("GET /export as A: 1 conversation with its message, 1 belief with its receipt, 2 bridges sent, 1 person", r.status,
    r.status === 200 && (r.json.conversations as R[]).length === 1 && ((r.json.conversations as R[])[0].messages as R[]).length === 1 && (r.json.beliefs as R[]).length === 1 && ((r.json.beliefs as R[])[0].receipts as R[]).length === 1 && (r.json.bridges_sent as R[]).length === 2 && (r.json.people as R[]).length === 1,
    `conversations=${(r.json.conversations as R[])?.length} beliefs=${(r.json.beliefs as R[])?.length} sent=${(r.json.bridges_sent as R[])?.length} people=${(r.json.people as R[])?.length}`);
  r = await call("GET", "/export", undefined, B.token);
  step("GET /export as B: the opened bridge under bridges_received, the sealed one absent", r.status, r.status === 200 && (r.json.bridges_received as R[]).length === 1 && (r.json.bridges_received as R[])[0].id === opened!.id, `received=${(r.json.bridges_received as R[])?.length}`);

  // Q63: DELETE /map is a soft delete with a 5-second undo; the map reads as empty meanwhile; the purge runs on the first request after
  const t0 = Date.now();
  r = await call("DELETE", "/map", undefined, A.token);
  const undoUntil = String(r.json.undo_until ?? "");
  const ahead = Date.parse(undoUntil) - t0;
  step("DELETE /map as A: pending, undo_until about 5 s ahead, 1 belief + 1 conversation + 1 outside card to go", r.status,
    r.status === 200 && ahead > 3000 && ahead <= 8000 && r.json.beliefs_removed === 1 && r.json.conversations_removed === 1 && r.json.outside_removed === 1, `${J(r.json)} ahead=${ahead}ms`);
  const { count: bPending } = await service.from("beliefs").select("id", { count: "exact", head: true }).eq("owner", A.id);
  r = await call("GET", "/map", undefined, A.token);
  step("while pending: GET /map reads empty with deleting.undo_until, the rows are still there", r.status,
    r.status === 200 && (r.json.beliefs as R[]).length === 0 && ((r.json.deleting as R)?.undo_until) === undoUntil && bPending === 1, `beliefs=${(r.json.beliefs as R[])?.length} deleting=${J(r.json.deleting)} rows=${bPending}`);
  r = await call("DELETE", "/map", undefined, A.token);
  step("a second tap inside the window keeps the first undo_until", r.status, r.status === 200 && r.json.undo_until === undoUntil, J(r.json));
  r = await call("POST", "/map/undo", undefined, A.token);
  step("POST /map/undo inside the window → restored", r.status, r.status === 200 && r.json.restored === true, J(r.json));
  r = await call("GET", "/map", undefined, A.token);
  step("after undo: the map is whole again, deleting null", r.status, r.status === 200 && (r.json.beliefs as R[]).length === 1 && r.json.deleting === null, `beliefs=${(r.json.beliefs as R[])?.length} deleting=${J(r.json.deleting)}`);
  r = await call("POST", "/map/undo", undefined, A.token);
  step("POST /map/undo with nothing pending → restored false, nothing_pending", r.status, r.status === 200 && r.json.restored === false && r.json.reason === "nothing_pending", J(r.json));
  r = await call("DELETE", "/map", undefined, A.token);
  const until2 = Date.parse(String(r.json.undo_until ?? ""));
  step("DELETE /map as A again: pending", r.status, r.status === 200 && Number.isFinite(until2), J(r.json));
  await new Promise((f) => setTimeout(f, Math.max(0, until2 - Date.now()) + 300));
  r = await call("POST", "/map/undo", undefined, A.token);
  step("POST /map/undo after the window: the map was purged first, restored false, window_closed", r.status, r.status === 200 && r.json.restored === false && r.json.reason === "window_closed", J(r.json));
  const { data: profA } = await service.from("profiles").select("map_delete_at,map_seen_at").eq("id", A.id).single();
  const { count: bAfter } = await service.from("beliefs").select("id", { count: "exact", head: true }).eq("owner", A.id);
  step("after the purge: no belief, no mark left on the profile", 200, bAfter === 0 && profA?.map_delete_at === null, `beliefs=${bAfter} profile=${J(profA)}`);
  const { count: ec } = await service.from("engine_calls").select("id", { count: "exact", head: true }).eq("person", A.id);
  const { count: rc } = await service.from("receipts").select("id", { count: "exact", head: true }).eq("owner", A.id);
  const { count: bc } = await service.from("bridges").select("id", { count: "exact", head: true }).eq("sender", A.id).neq("status", "withdrawn");
  step("after the purge: Talk trace gone, Bridge trace kept, receipts gone, both bridges still there", 200, ec === 1 && rc === 0 && bc === 2, `engine_calls=${ec} receipts=${rc} bridges=${bc}`);
  r = await call("GET", "/threads", undefined, B.token);
  step("B's thread with A still lists", r.status, r.status === 200 && (r.json.threads as R[]).some((t) => ((t.person as R)?.id) === A.id), `threads=${(r.json.threads as R[])?.length}`);

  r = await call("DELETE", "/account", undefined, A.token);
  step("DELETE /account as A: deleted, the sealed bridge withdrawn, the link ended", r.status, r.status === 200 && r.json.deleted === true && (r.json.withdrawn as string[]).length === 1 && (r.json.withdrawn as string[])[0] === sealed!.id && r.json.links_ended === 1, J(r.json));
  r = await call("GET", "/me", undefined, A.token);
  step("A's old bearer → 401", r.status, r.status === 401, `error=${r.json.error}`);
  r = await call("GET", `/threads/${A.id}`, undefined, B.token);
  const items = (r.json.items as R[]) ?? [];
  const keptBridge = items.find((i) => i.kind === "bridge" && ((i.bridge as R)?.id === opened!.id));
  const withdrew = items.find((i) => i.kind === "event" && ((i.event as R)?.type === "withdrew"));
  const removed = items.find((i) => i.kind === "event" && ((i.event as R)?.type === "removed"));
  step("B's thread: the opened bridge stays under \"Deleted account\", withdrew + removed events, link removed", r.status,
    r.status === 200 && (r.json.person as R)?.name === DELETED_NAME && (r.json.person as R)?.deleted === true && !!keptBridge && ((keptBridge!.bridge as R).from as R)?.name === DELETED_NAME && !!withdrew && !!removed && (r.json.link as R)?.status === "removed",
    `person=${J(r.json.person)} items=${items.map((i) => i.kind === "event" ? `event:${(i.event as R).type}` : i.kind).join(",")} link=${(r.json.link as R)?.status}`);
  const { data: prof } = await service.from("profiles").select("name,persona,settings,deleted_at").eq("id", A.id).single();
  const { count: mc } = await service.from("mirror_links").select("id", { count: "exact", head: true }).eq("owner", A.id);
  step("A's profile: Deleted account, no settings, deleted_at set; no mirror link", 200, prof?.name === DELETED_NAME && !!prof?.deleted_at && J(prof?.settings) === "{}" && mc === 0, J(prof));
} finally {
  for (const u of [A, B]) { const { error } = await service.auth.admin.deleteUser(u.id); if (error) console.log("   ! cleanup", u.id, error.message); }
  const { count } = await service.from("profiles").select("id", { count: "exact", head: true }).in("id", [A.id, B.id]);
  step("cleanup: both throwaway users and every row of theirs are gone", 200, count === 0, `profiles left=${count}`);
}

for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${String(x.status).padEnd(4)} ${x.step.padEnd(88)} ${x.note}`);
console.log(`${results.filter((x) => x.ok).length}/${results.length} ${hosted ? "(hosted function)" : "(in-process handler, hosted database)"}`);
Deno.exit(results.every((x) => x.ok) ? 0 : 1);
