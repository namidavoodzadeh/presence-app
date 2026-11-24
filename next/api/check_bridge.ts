// $0 live check of the Bridge endpoints (no engine) against the hosted database with the preview accounts: people, an invite
// Lea → Sam accepted, drafts, a bridge Nami → Lea sent now and one sealed for tomorrow, the receiver's thread (sealed bubble,
// ready one), open, Let's talk, talked, withdraw after the bubble was seen, the safety floor, link settings, a shared map.
// v1.3: times normalised to Z with milliseconds, X-Client-Ref kept in errors, mark-unread, activity_at, delete-for-me on a thread.
// Everything it created is removed at the end.
//   deno run --allow-net --allow-read --allow-env next/api/check_bridge.ts
import { handler } from "./index.ts";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

type R = Record<string, unknown>;
const J = (o: unknown) => JSON.stringify(o);
const results: { step: string; status: number; ok: boolean; note: string }[] = [];
async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await handler(new Request("http://api.local" + path, { method, headers: { "content-type": "application/json", "x-presence-tz": "Asia/Tehran", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let json: R = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}
const Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const step = (name: string, status: number, ok: boolean, note: string) => { results.push({ step: name, status, ok, note }); if (!ok) console.log("   !", name, note); };
async function login(p: string) { const r = await call("POST", "/preview/login", { persona: p }); return { token: String(r.json.access_token ?? ""), id: String(((r.json.me as R)?.person as R)?.id ?? "") }; }
const nami = await login("nami"), lea = await login("lea"), sam = await login("sam");
step("login nami, lea, sam", 200, !!nami.token && !!lea.token && !!sam.token, "");

let r = await call("GET", "/people", undefined, nami.token);
const ppl = (r.json.people as R[]) ?? [];
step("GET /people as Nami: five linked example people, A–Z", r.status, r.status === 200 && ppl.length === 5 && ppl.every((p) => (p.person as R)?.is_example === true),
  `${ppl.map((p) => `${(p.person as R)?.name}${p.shares_map ? "*" : ""}`).join(", ")}`);

r = await call("POST", "/invites", {}, lea.token);
const code = String(r.json.code ?? "");
step("POST /invites as Lea", r.status, r.status === 200 && code.length === 6 && String(r.json.qr_payload).endsWith(code), `code ${code} link ${r.json.link}`);
r = await call("POST", `/invites/${code}/accept`, {}, lea.token);
step("accept my own invite → 400", r.status, r.status === 400, `error=${r.json.error}`);
r = await call("POST", `/invites/${code}/accept`, {}, sam.token);
const linkId = String(r.json.link_id ?? "");
step("accept as Sam → linked to Lea", r.status, r.status === 200 && (r.json.person as R)?.name === "Lea" && !!linkId, `link ${linkId.slice(0, 8)}`);
r = await call("POST", `/invites/${code}/accept`, {}, sam.token);
step("accept twice → 404 (used)", r.status, r.status === 404 || r.status === 409, `error=${r.json.error}`);
r = await call("GET", "/threads", undefined, sam.token);
step("GET /threads as Sam shows Lea", r.status, ((r.json.threads as R[]) ?? []).some((t) => (t.person as R)?.name === "Lea" && (t.last as R)?.kind === "none"), `${((r.json.threads as R[]) ?? []).map((t) => `${(t.person as R)?.name}:${(t.last as R)?.kind}`).join(" ")}`);

r = await call("PUT", `/drafts/${lea.id}`, { text: "You always change plans" }, nami.token);
step("PUT draft", r.status, r.status === 200 && (r.json.draft as R)?.text === "You always change plans", "");
r = await call("GET", "/threads", undefined, nami.token);
const leaThread = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === lea.id);
step("GET /threads as Nami: Lea's last is the draft", r.status, (leaThread?.last as R)?.kind === "draft" && (leaThread?.last as R)?.text === "You always change plans", J(leaThread?.last));

r = await call("POST", "/bridges", { person_id: lea.id, original: "I will hurt you if you cancel again", final: "I will hurt you if you cancel again", used: "mine", deliver_at: "now" }, nami.token);
step("POST /bridges with a threat → 403 wont_carry (law 8)", r.status, r.status === 403 && r.json.reason === "wont_carry", `error=${r.json.error} reason=${r.json.reason}`);

const original = "You always change plans last minute, so thanks for that.";
const bridged = "The plan changed last minute three times this month, and I am left feeling like an afterthought.";
r = await call("POST", "/bridges", { person_id: lea.id, original, bridged, final: bridged, used: "bridged", outcome: "ok", changes: [], points: [{ kind: "complaint", quote: "change plans last minute", kept: true }],
  tone_original: "angry", tone_bridged: "sad", show_original: false, heads_up: true, deliver_at: "now", tz: "Asia/Tehran" }, nami.token);
const b1 = r.json.bridge as R;
step("POST /bridges now → scheduled, delivered, draft cleared", r.status, r.status === 200 && b1?.status === "scheduled" && b1?.delivered === true && (b1.to as R)?.name === "Lea" && b1.used === "bridged", `id ${String(b1?.id).slice(0, 8)} delivered=${b1?.delivered}`);
r = await call("GET", `/drafts/${lea.id}`, undefined, nami.token);
step("draft gone after sending", r.status, r.json.draft === null, J(r.json));
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString();
r = await call("POST", "/bridges", { person_id: lea.id, original: "Second one, for tomorrow.", final: "Second one, for tomorrow.", used: "mine", deliver_at: tomorrow, heads_up: true }, nami.token);
const b2 = r.json.bridge as R;
step("POST /bridges for tomorrow → sealed", r.status, r.status === 200 && b2?.delivered === false, `deliver_at ${b2?.deliver_at}`);

r = await call("GET", `/threads/${nami.id}`, undefined, lea.token);
const items = (r.json.items as R[]) ?? [];
const views = items.filter((i) => i.kind === "bridge").map((i) => i.bridge as R);
const ready = views.find((v) => v.id === b1.id), sealed = views.find((v) => v.id === b2.id);
step("Lea's thread: one ready (no text), one sealed (no text, no tone, no length)", r.status,
  !!ready && ready.ready === true && !("final" in ready) && !("tone" in ready) && !!sealed && sealed.sealed === true && !("final" in sealed) && !("tone" in sealed) && !("used" in sealed),
  `ready keys=${J(Object.keys(ready ?? {}))} sealed keys=${J(Object.keys(sealed ?? {}))}`);
r = await call("GET", "/threads", undefined, lea.token);
const nThread = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === nami.id);
step("Lea's thread list: badge 1, ready, tab dot", r.status, nThread?.badge === 1 && r.json.bridge_tab_dot === true && ["ready", "sealed"].includes(String((nThread?.last as R)?.kind)), `badge=${nThread?.badge} last=${J(nThread?.last)}`);

// CDO build review 1: the receiver's zone on the sender's bridge (Q7), Remind me later on a ready bridge (B10c), the bridged mark on nothing_to_change (Q4).
step("Nami's bridge carries receiver_tz (Lea: Europe/Berlin) and bridged_mark true", 200, b1?.receiver_tz === "Europe/Berlin" && (b1.to as R)?.tz === "Europe/Berlin" && b1?.bridged_mark === true, `receiver_tz=${b1?.receiver_tz} mark=${b1?.bridged_mark}`);
const inAnHour = new Date(Date.now() + 3600e3).toISOString();
r = await call("POST", `/bridges/${b1.id}/remind`, { remind_at: inAnHour }, lea.token);
step("POST /bridges/:id/remind as Lea → remind_at on her ready view", r.status, r.status === 200 && Z.test(String(r.json.remind_at)) && (r.json.bridge as R)?.ready === true && !("final" in (r.json.bridge as R)), `remind_at=${r.json.remind_at}`);
r = await call("POST", `/bridges/${b1.id}/remind`, { remind_at: "2020-01-01T00:00:00Z" }, lea.token);
step("remind in the past → 400", r.status, r.status === 400, `error=${r.json.error}`);
r = await call("POST", `/bridges/${b2.id}/remind`, { remind_at: inAnHour }, lea.token);
step("remind on the sealed one → 403 sealed", r.status, r.status === 403 && r.json.error === "sealed", `error=${r.json.error}`);
r = await call("POST", `/bridges/${b1.id}/remind`, { remind_at: inAnHour }, nami.token);
step("remind by the sender → 404 (not his to set)", r.status, r.status === 404, `error=${r.json.error}`);
r = await call("GET", `/threads/${nami.id}`, undefined, lea.token);
const readyAgain = ((r.json.items as R[]) ?? []).filter((i) => i.kind === "bridge").map((i) => i.bridge as R).find((v) => v.id === b1.id);
step("Lea's thread: the ready view carries her remind_at", r.status, Z.test(String(readyAgain?.remind_at)), `remind_at=${readyAgain?.remind_at}`);
r = await call("GET", `/threads/${lea.id}`, undefined, nami.token);
const senderSide = ((r.json.items as R[]) ?? []).filter((i) => i.kind === "bridge").map((i) => i.bridge as R).find((v) => v.id === b1.id);
step("Nami's view says nothing about the reminder", r.status, !!senderSide && !("remind_at" in senderSide), `keys=${J(Object.keys(senderSide ?? {}).filter((k) => k.includes("remind")))}`);
r = await call("POST", "/bridges", { person_id: lea.id, original: "Nothing to change here, it reads clearly.", bridged: "Nothing to change here, it reads clearly.", final: "Nothing to change here, it reads clearly.", used: "bridged", outcome: "nothing_to_change", deliver_at: "now" }, nami.token);
const b4 = r.json.bridge as R;
step("POST /bridges with outcome nothing_to_change → bridged_mark false for the sender", r.status, r.status === 200 && b4?.bridged_mark === false, `mark=${b4?.bridged_mark}`);
r = await call("POST", `/bridges/${b4.id}/open`, {}, lea.token);
step("open it → bridged_mark false for the receiver too", r.status, r.status === 200 && (r.json.bridge as R)?.bridged_mark === false, `mark=${(r.json.bridge as R)?.bridged_mark}`);
r = await call("POST", `/bridges/${b4.id}/remind`, { remind_at: inAnHour }, lea.token);
step("remind on an opened bridge → 409", r.status, r.status === 409, `error=${r.json.error}`);

r = await call("POST", `/bridges/${b2.id}/open`, {}, lea.token);
step("open the sealed one → 403 sealed with deliver_at", r.status, r.status === 403 && r.json.error === "sealed" && !!r.json.deliver_at, `error=${r.json.error}`);
r = await call("POST", `/bridges/${b1.id}/open`, {}, lea.token);
const opened = r.json.bridge as R;
step("open the ready one → text, bridged mark, tone, no original", r.status, r.status === 200 && opened?.final === bridged && opened?.bridged_mark === true && opened?.tone === "sad" && opened?.original === null && !!r.json.opened_at,
  `final="${String(opened?.final).slice(0, 30)}…" tone=${opened?.tone} original=${opened?.original}`);
r = await call("PATCH", `/bridges/${b1.id}`, { heads_up: false }, nami.token);
step("PATCH an opened bridge → 403 too_late", r.status, r.status === 403 && r.json.reason === "too_late", `reason=${r.json.reason}`);

r = await call("POST", `/bridges/${b1.id}/letstalk`, { when: "soon" }, lea.token);
const plan = r.json.plan as R;
step("Let's talk soon → plan", r.status, r.status === 200 && plan?.soon === true && plan?.status === "planned" && plan?.proposed_by === lea.id, `plan ${String(plan?.id).slice(0, 8)}`);
r = await call("GET", `/threads/${lea.id}`, undefined, nami.token);
const mine = ((r.json.items as R[]) ?? []).filter((i) => i.kind === "bridge").map((i) => i.bridge as R).find((b) => b.id === b1.id);
step("Nami's thread: his bridge shows opened_at and the plan", r.status, !!mine?.opened_at && (mine?.plan as R)?.id === plan.id, `opened_at=${mine?.opened_at ? "yes" : "no"} plan=${(mine?.plan as R)?.status}`);
r = await call("PATCH", `/plans/${plan.id}`, { talked: true }, nami.token);
step("PATCH plan talked → event", r.status, r.status === 200 && (r.json.plan as R)?.status === "talked" && (r.json.event as R)?.type === "talked", `event=${(r.json.event as R)?.type}`);
r = await call("PATCH", `/plans/${plan.id}`, { cancel: true }, nami.token);
step("PATCH a talked plan → 409", r.status, r.status === 409, `error=${r.json.error}`);

r = await call("POST", `/bridges/${b2.id}/withdraw`, {}, nami.token);
step("withdraw the sealed one after Lea saw the bubble → receiver_sees withdrawn", r.status, r.status === 200 && r.json.receiver_sees === "withdrawn" && (r.json.bridge as R)?.status === "withdrawn", `receiver_sees=${r.json.receiver_sees}`);
r = await call("GET", `/threads/${nami.id}`, undefined, lea.token);
const ev = ((r.json.items as R[]) ?? []).filter((i) => i.kind === "event").map((i) => i.event as R);
step("Lea's thread: a withdrew event, the sealed bubble gone, a talked event", r.status, ev.some((e) => e.type === "withdrew") && ev.some((e) => e.type === "talked") && !((r.json.items as R[]) ?? []).some((i) => i.kind === "bridge" && (i.bridge as R).id === b2.id),
  `events=${J(ev.map((e) => e.type))}`);

r = await call("PATCH", `/links/${lea.id}`, { relationship: "partner", mute: "8h", share: { on: true, areas: ["relationships", "work"], quotes: false } }, nami.token);
const link = r.json.link as R;
step("PATCH /links: relationship, mute, share", r.status, r.status === 200 && link?.relationship === "partner" && !!link?.muted_until && (link?.share as R)?.on === true && J((link?.share as R)?.areas) === J(["relationships", "work"]), J(link?.share));
r = await call("PATCH", `/links/${lea.id}`, { relationship: null, mute: null, share: { on: false, areas: [] } }, nami.token);
step("PATCH /links back", r.status, (r.json.link as R)?.relationship === null && (r.json.link as R)?.muted_until === null, "");
r = await call("GET", `/people/${lea.id}/map`, undefined, nami.token);
step("GET /people/lea/map as Nami: Lea's shared areas only, read-only", r.status, r.status === 200 ? ((r.json.areas as string[]).length > 0 && (r.json.beliefs as R[]).every((b) => (r.json.areas as string[]).includes(String(b.area)))) : r.status === 403,
  r.status === 200 ? `areas=${J(r.json.areas)} beliefs=${(r.json.beliefs as unknown[]).length} quotes=${r.json.quotes} receipts on first=${((r.json.beliefs as R[])[0]?.receipts as unknown[])?.length}` : `error=${r.json.error} reason=${r.json.reason}`);
r = await call("GET", `/people/${nami.id}/map`, undefined, lea.token);
step("GET /people/nami/map as Lea: Nami shares nothing → 403", r.status, r.status === 403 && r.json.reason === "not_shared", `reason=${r.json.reason}`);
r = await call("POST", `/links/${lea.id}/report`, { bridge_ids: [b1.id], reason: "check" }, nami.token);
const reportId = String(r.json.report_id ?? "");
step("report", r.status, r.status === 200 && !!reportId, "");

// ---- v1.3: times, client Ref, thread actions
const times: string[] = [];
const walk = (v: unknown, k = ""): void => { if (v && typeof v === "object") { for (const [kk, vv] of Object.entries(v as R)) walk(vv, kk); } else if (typeof v === "string" && /(?:^|_)(?:at|until|since|when)$/.test(k) && v !== "infinity") times.push(v); };
r = await call("GET", "/threads", undefined, nami.token); walk(r.json);
r = await call("GET", `/threads/${lea.id}`, undefined, lea.token); walk(r.json);
r = await call("GET", "/conversations", undefined, nami.token); walk(r.json);
step("every time field is ISO 8601 UTC with Z and milliseconds (A-Q10)", 200, times.length > 0 && times.every((t) => Z.test(t)), `${times.length} times; odd: ${J(times.filter((t) => !Z.test(t)).slice(0, 3))}`);

r = await call("GET", "/me", undefined, nami.token, { "x-client-ref": "7f3k, xaur" });
const env0 = await loadEnv(); const service0 = serviceClient(env0);
const { data: clientRows } = await service0.from("errors").select("ref,client_ref,source,code,person,where_").in("client_ref", ["7F3K", "XAUR"]).order("created_at", { ascending: false }).limit(2);
step("X-Client-Ref on a request → errors rows with source client (A-Q8)", r.status, r.status === 200 && (clientRows ?? []).length === 2 && (clientRows ?? []).every((e) => e.source === "client" && e.code === "client_reported" && e.person === nami.id && /^GET \^.*me/.test(String(e.where_))),
  J((clientRows ?? []).map((e) => `${e.ref}<-${e.client_ref}`)));

r = await call("POST", `/threads/${lea.id}/mark-unread`, {}, nami.token);
step("POST /threads/:person/mark-unread", r.status, r.status === 200 && r.json.unread === true, "");
r = await call("GET", "/threads", undefined, nami.token);
let row = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === lea.id);
step("GET /threads: Lea's row unread, activity_at is a past moment (not the coming deliver time)", r.status, row?.unread === true && typeof row?.activity_at === "string" && new Date(String(row.activity_at)).getTime() <= Date.now(),
  `unread=${row?.unread} activity_at=${row?.activity_at} last=${(row?.last as R)?.kind}@${(row?.last as R)?.at}`);
r = await call("GET", `/threads/${lea.id}`, undefined, nami.token);
step("GET /threads/:person reads it (activity_at in the reply)", r.status, r.status === 200 && typeof r.json.activity_at === "string", "");
r = await call("GET", "/threads", undefined, nami.token);
row = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === lea.id);
step("GET /threads: unread cleared", r.status, row?.unread === false, `unread=${row?.unread}`);

r = await call("POST", "/bridges", { person_id: lea.id, original: "Third one, for tomorrow.", final: "Third one, for tomorrow.", used: "mine", deliver_at: tomorrow, heads_up: true }, nami.token);
const b3 = r.json.bridge as R;
step("POST /bridges a sealed third one", r.status, r.status === 200 && b3?.delivered === false, "");
r = await call("PUT", `/drafts/${lea.id}`, { text: "a draft that goes with the thread" }, nami.token);
r = await call("GET", `/threads/${nami.id}`, undefined, lea.token);   // Lea sees the sealed bubble
step("Lea sees the sealed bubble", r.status, ((r.json.items as R[]) ?? []).some((i) => i.kind === "bridge" && (i.bridge as R).id === b3.id && (i.bridge as R).sealed === true), "");
r = await call("DELETE", `/threads/${lea.id}`, undefined, nami.token);
step("DELETE /threads/:person as Nami: the sealed one withdrawn, copies removed", r.status, r.status === 200 && r.json.deleted === true && J(r.json.withdrawn) === J([b3.id]) && Number(r.json.removed) >= 1 && Z.test(String(r.json.cleared_at)),
  `withdrawn=${J(r.json.withdrawn)} removed=${r.json.removed}`);
r = await call("GET", `/threads/${lea.id}`, undefined, nami.token);
step("Nami's thread is empty for him: no items, no draft", r.status, r.status === 200 && ((r.json.items as R[]) ?? []).length === 0 && r.json.draft === null, `items=${((r.json.items as R[]) ?? []).length}`);
r = await call("GET", "/threads", undefined, nami.token);
row = ((r.json.threads as R[]) ?? []).find((t) => (t.person as R)?.id === lea.id);
step("Nami's list: Lea still there, last none, activity_at = cleared", r.status, !!row && (row.last as R)?.kind === "none" && typeof row.activity_at === "string", `last=${(row?.last as R)?.kind}`);
r = await call("GET", `/threads/${nami.id}`, undefined, lea.token);
const leaItems = (r.json.items as R[]) ?? [];
step("Lea keeps her copy: the opened bridge stays, a withdrew event for the sealed one, b3 gone", r.status,
  leaItems.some((i) => i.kind === "bridge" && (i.bridge as R).id === b1.id && !!(i.bridge as R).opened_at) && leaItems.some((i) => i.kind === "event" && (i.event as R).type === "withdrew" && (i.event as R).bridge_id === b3.id) && !leaItems.some((i) => i.kind === "bridge" && (i.bridge as R).id === b3.id),
  `items=${J(leaItems.map((i) => i.kind === "bridge" ? `bridge:${String((i.bridge as R).id).slice(0, 4)}` : i.kind === "event" ? `event:${(i.event as R).type}` : i.kind))}`);

// clean up
const env = await loadEnv(); const service = serviceClient(env);
await service.from("plans").delete().eq("id", String(plan.id));
await service.from("thread_events").delete().in("bridge_id", [String(b1.id), String(b2.id), String(b3.id)]);
await service.from("errors").delete().in("client_ref", ["7F3K", "XAUR"]);
await service.from("link_prefs").update({ cleared_at: null, unread: false }).eq("owner", nami.id).eq("other", lea.id);
await service.from("thread_events").delete().eq("type", "joined").eq("person_a", sam.id).eq("person_b", lea.id);
await service.from("bridges").delete().in("id", [String(b1.id), String(b2.id), String(b3.id), String(b4.id)]);
await service.from("reports").delete().eq("id", reportId);
await service.from("link_prefs").delete().or(`and(owner.eq.${lea.id},other.eq.${sam.id}),and(owner.eq.${sam.id},other.eq.${lea.id})`);
await service.from("links").delete().eq("id", linkId);
await service.from("invites").delete().eq("code", code);
const { count } = await service.from("bridges").select("*", { count: "exact", head: true }).eq("sender", nami.id);
r = await call("GET", "/people", undefined, sam.token);
step("cleanup: Nami's bridges 0, Sam linked only to Nami again", 200, (count ?? 0) === 0 && ((r.json.people as R[]) ?? []).length === 1, `bridges=${count} sam people=${((r.json.people as R[]) ?? []).length}`);

for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${String(x.status).padEnd(4)} ${x.step.padEnd(78)} ${x.note}`);
Deno.exit(results.every((x) => x.ok) ? 0 : 1);
