// $0 live check of the Talk endpoints against the hosted database: a recorded model (no paid call) answers five turns and one
// Finish for the preview account, exercising turn → card row, the consent ask → Never, an edit (re-answer, superseded rows,
// receipts re-checked), a delete, and Finish with a rating. Everything it created is removed at the end.
//   deno run --allow-net --allow-read --allow-env next/api/check_talk.ts [persona]
import { handler } from "./index.ts";
import { hooks } from "./talk.ts";
import { RecordedClient } from "../engine/model/client.ts";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

const persona = Deno.args[0] ?? "nami";
const J = (o: unknown) => JSON.stringify(o);
const env = await loadEnv();
const service = serviceClient(env);
const turn = (o: Record<string, unknown>) => J({ risk: { level: "none", reason: "none" }, feeling: "neutral", title: null, permission_domain: null, beliefs: [], ...o });
const recorded = new RecordedClient({
  turn: [
    // QA-B36/E74P: consumed by the stray-conversation-id check below, before the T1 sequence starts.
    turn({ reflection: "That's a lot to carry in.", question: "What feels most important about it right now?", move: { kind: "follow", why: "first turn", gap: "self: unknown" } }),
    turn({ feeling: "lonely", title: "Dinner plans", reflection: "Dinner moved again and nobody asked you first.", question: "What did you do when the new time came through?",
      move: { kind: "deepen", why: "the moment", gap: "self: worth" },
      beliefs: [{ id: null, label: "Afterthought", statement: "You may feel like an afterthought when plans move without you.", type: "something I believe is true", level: "L0",
        domains: ["self", "close_relationships"], confidence: 0.75, receipt: "nobody asked me", links: [] }] }),
    turn({ reflection: "Going along with it is what you did.", question: "Would it be all right to talk about how you have been looking after yourself?",
      move: { kind: "ask_permission", why: "body mentioned", gap: "body_health: care" }, permission_domain: "body_health" }),
    turn({ reflection: "That stays out of it.", question: "What happened after the new time came through?", move: { kind: "follow", why: "back to the moment", gap: "close_relationships: needs" } }),
    turn({ feeling: "sad", reflection: "You got the new time without being asked.", question: "What did you do when it arrived?", move: { kind: "deepen", why: "edit", gap: "self: worth" },
      beliefs: [{ id: null, label: "Not counting", statement: "Part of you may feel your say does not count in the plan.", type: "a rule I live by", level: "L1",
        domains: ["close_relationships"], confidence: 0.72, receipt: "I just got the new time", links: [] }] }),
    turn({ reflection: "Going along is the familiar move.", question: "When did that start?", move: { kind: "deepen", why: "pattern", gap: "self: control" } }),
  ],
  finish: [J({ cards: [
    { label: "Afterthought", statement: "You may feel like an afterthought when plans move without you.", type: "something I believe is true", level: "L0", domains: ["self", "close_relationships"],
      confidence: 0.8, receipts: ["nobody asked me"], mergedFrom: [], mapId: null, tensionWith: null, links: [] },
    { label: "Not counting", statement: "Part of you may feel your say does not count in the plan.", type: "a rule I live by", level: "L1", domains: ["close_relationships"],
      confidence: 0.72, receipts: ["I just got the new time"], mergedFrom: [], mapId: null, tensionWith: null, links: [] }],
    summary: "You talked about dinner moving and being told rather than asked.", nextTime: "There was more to say about being asked.", openThreads: ["dinner plans"] })],
});
hooks.client = () => recorded;

const results: { step: string; status: number; ok: boolean; note: string }[] = [];
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await handler(new Request("http://api.local" + path, { method, headers: { "content-type": "application/json", "x-presence-tz": "Asia/Tehran", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}
const step = (name: string, status: number, ok: boolean, note: string) => { results.push({ step: name, status, ok, note }); if (!ok) console.log("   !", name, note); };

let r = await call("POST", "/preview/login", { persona });
const token = String(r.json.access_token ?? "");
const owner = String(((r.json.me as Record<string, unknown>)?.person as Record<string, unknown>)?.id ?? "");
step("login", r.status, !!token, `owner ${owner.slice(0, 8)}`);

// an open conversation would make turn 1 a 409: finish it first so the check is reproducible
r = await call("GET", "/conversations", undefined, token);
const open = r.json.active as Record<string, unknown> | null;
if (open) { const f = await call("POST", "/talk/finish", { conversation_id: open.id, ratings: [] }, token); step("finish the open conversation first", f.status, f.status === 200, `id ${String(open.id).slice(0, 8)} (${open.title})`); }

// QA-B36/E74P: a conversation_id the server never created (a client sent one before any conversation existed)
// must start a conversation, not 404 and strand the person's words.
r = await call("POST", "/talk/turn", { conversation_id: "00000000-0000-0000-0000-000000000000", text: "A long dictated message with no conversation yet.", mode: "voice" }, token);
const strayConv = r.json.conversation as Record<string, unknown>;
const strayId = strayConv?.id as string | undefined;
step("turn with an unresolved conversation_id starts fresh, not 404", r.status, r.status === 200 && !!strayId && strayId !== "00000000-0000-0000-0000-000000000000",
  `status=${r.status} conversation=${J(strayId)} error=${r.json.error}`);
if (strayId) {
  // Deleted directly (not /talk/finish): that would spend the recorded client's one `finish` reply.
  await service.from("messages").delete().eq("conversation_id", strayId);
  await service.from("conversations").delete().eq("id", strayId);
}

const T1 = "Dinner moved again, third time this month, and nobody asked me.";
r = await call("POST", "/talk/turn", { conversation_id: null, text: T1, mode: "text" }, token);
const conv = r.json.conversation as Record<string, unknown>, m1 = r.json.message as Record<string, unknown>, reply1 = r.json.reply as Record<string, unknown>;
const cards1 = (reply1?.cards as Record<string, unknown>[]) ?? [];
const card1 = cards1[0];
step("turn 1: card shown, feeling, title", r.status, r.status === 200 && cards1.length === 1 && m1.feeling === "lonely" && conv.title === "Dinner plans" && reply1.state === "turn",
  `cards=${cards1.length} feeling=${m1.feeling} title="${conv.title}" turn=${reply1?.turn} receipts=${J((card1?.receipts as unknown[])?.length)} kind=${card1?.kind} area=${card1?.area} birth=${card1?.birth_mood}`);
const cid = String(conv.id);

r = await call("POST", "/talk/turn", { conversation_id: cid, text: "I just went along with it. I have been skipping meals lately too.", mode: "text" }, token);
const reply2 = r.json.reply as Record<string, unknown>;
step("turn 2: consent ask", r.status, r.status === 200 && reply2?.state === "consent" && (reply2.consent as Record<string, unknown>)?.domain === "body_health",
  `state=${reply2?.state} consent=${J(reply2?.consent)}`);

r = await call("POST", "/talk/consent", { conversation_id: cid, area: "body", label: "your health", answer: "never" }, token);
const reply3 = r.json.reply as Record<string, unknown>;
step("consent never → Never row, engine answers again", r.status, r.status === 200 && !!r.json.never_id && reply3?.state === "turn" && (r.json.message as Record<string, unknown>)?.text === "Never",
  `never_id=${String(r.json.never_id ?? "").slice(0, 8)} state=${reply3?.state} q="${reply3?.question}"`);
const neverId = String(r.json.never_id ?? "");
r = await call("GET", "/never", undefined, token);
step("GET /never lists it", r.status, ((r.json.topics as Record<string, unknown>[]) ?? []).some((t) => t.id === neverId), `${((r.json.topics as unknown[]) ?? []).length} topic(s)`);

r = await call("POST", "/talk/edit", { message_id: m1.id, text: T1.replace(".", ", I just got the new time.") }, token);
const reply4 = r.json.reply as Record<string, unknown>;
const cards4 = (reply4?.cards as Record<string, unknown>[]) ?? [];
step("edit turn 1: re-answered at turn 1, later rows superseded, receipt kept, second card", r.status,
  r.status === 200 && reply4?.turn === 1 && (r.json.superseded as string[]).length === 5 && r.json.receipts_updated === 1 && cards4.length === 1,
  `turn=${reply4?.turn} superseded=${(r.json.superseded as string[])?.length} receipts_updated=${r.json.receipts_updated} removed=${J(r.json.beliefs_removed)} cards=${cards4.length}`);
const card2 = cards4[0];

r = await call("GET", `/conversations/${cid}`, undefined, token);
const msgs = (r.json.messages as Record<string, unknown>[]) ?? [];
step("GET /conversations/:id after the edit: two live rows, two unrated", r.status, msgs.length === 2 && ((r.json.unrated as unknown[]) ?? []).length === 2,
  `messages=${msgs.length} unrated=${((r.json.unrated as unknown[]) ?? []).length} turns=${(r.json.conversation as Record<string, unknown>)?.turns}`);
r = await call("GET", `/conversations/${cid}?include_superseded=true`, undefined, token);
step("…with include_superseded: history kept", r.status, ((r.json.messages as unknown[]) ?? []).length === 7, `messages=${((r.json.messages as unknown[]) ?? []).length}`);

r = await call("POST", "/talk/turn", { conversation_id: cid, text: "I went along with it, like always.", mode: "voice" }, token);
const m5 = r.json.message as Record<string, unknown>;
step("turn 2 again (voice)", r.status, r.status === 200 && m5?.turn === 2 && (r.json.conversation as Record<string, unknown>)?.mode === "voice", `turn=${m5?.turn} mode=${(r.json.conversation as Record<string, unknown>)?.mode}`);

r = await call("DELETE", `/talk/messages/${m5.id}`, undefined, token);
step("delete turn 2: its reply superseded, no receipts touched", r.status, r.status === 200 && (r.json.superseded as string[]).length === 1 && r.json.receipts_removed === 0, J(r.json));

r = await call("POST", "/talk/finish", { conversation_id: cid, ratings: [{ belief_id: card1?.belief_id, rating: "very" }], not_now: [card2?.belief_id] }, token);
const beliefs = (r.json.beliefs as Record<string, unknown>[]) ?? [];
step("finish: 1 added, 1 to confirm, summary, beliefs with patch", r.status,
  r.status === 200 && r.json.added === 1 && r.json.to_confirm === 1 && typeof r.json.summary === "string" && beliefs.length === 2 && !!(beliefs[0].patch as Record<string, unknown>)?.direction_deg,
  `added=${r.json.added} to_confirm=${r.json.to_confirm} summary="${r.json.summary}" beliefs=${beliefs.length} status=${J(beliefs.map((b) => b.status))} patch=${J(beliefs[0]?.patch)}`);
r = await call("POST", "/talk/finish", { conversation_id: cid, ratings: [] }, token);
step("finish twice: 409", r.status, r.status === 409, `error=${r.json.error}`);

// trace rows exist for the conversation (fake model: 0¢)
const { data: calls } = await service.from("engine_calls").select("purpose,cents").eq("conversation_id", cid);
step("engine_calls trace rows", 200, (calls ?? []).length === 6, `${(calls ?? []).length} rows: ${J((calls ?? []).map((c) => c.purpose))}`);
const { data: cs } = await service.from("conversations").select("hypotheses,open_threads,summary,risk_turn,status").eq("id", cid).single();
step("conversation row: finished, open_threads, hypotheses cleared", 200, cs?.status === "finished" && (cs?.open_threads as string[])?.length === 1 && (cs?.hypotheses as unknown[])?.length === 0,
  `status=${cs?.status} open_threads=${J(cs?.open_threads)} hypotheses=${(cs?.hypotheses as unknown[])?.length}`);

// clean up everything this check made
const ids = [card1?.belief_id, card2?.belief_id].filter((x): x is string => typeof x === "string");
await service.from("engine_calls").delete().eq("conversation_id", cid);
if (ids.length) await service.from("beliefs").delete().in("id", ids);
await service.from("consent").delete().eq("id", neverId);
await service.from("conversations").delete().eq("id", cid);
const { count } = await service.from("messages").select("*", { count: "exact", head: true }).eq("conversation_id", cid);
step("cleanup", 200, (count ?? 0) === 0, `messages left ${count}`);

for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${String(x.status).padEnd(4)} ${x.step.padEnd(70)} ${x.note}`);
Deno.exit(results.every((x) => x.ok) ? 0 : 1);
