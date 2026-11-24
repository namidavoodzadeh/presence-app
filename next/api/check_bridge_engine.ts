// $0 live check of the Bridge engine endpoints with recorded models (no paid call), as Lea writing to Nami: insight spans and
// tone, run → ok with changes/points/tone, run → wont_carry on a threat (the floor, no call), reword-part, why-it-matters;
// engine_calls rows written and removed. Nothing is stored but the trace.
//   deno run --allow-net --allow-read --allow-env next/api/check_bridge_engine.ts
import { handler } from "./index.ts";
import { hooks } from "./bridge_engine.ts";
import { RecordedClient } from "../engine/model/client.ts";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

type R = Record<string, unknown>;
const J = (o: unknown) => JSON.stringify(o);
const results: { step: string; status: number; ok: boolean; note: string }[] = [];
const step = (name: string, status: number, ok: boolean, note: string) => { results.push({ step: name, status, ok, note }); if (!ok) console.log("   !", name, note); };
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await handler(new Request("http://api.local" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text(); let json: R = {}; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}
async function login(p: string) { const r = await call("POST", "/preview/login", { persona: p }); return { token: String(r.json.access_token ?? ""), id: String(((r.json.me as R)?.person as R)?.id ?? "") }; }
const lea = await login("lea"), nami = await login("nami");
const env = await loadEnv(); const service = serviceClient(env);
const { data: lb } = await service.from("beliefs").select("id,label,statement").eq("owner", lea.id).eq("status", "confirmed").limit(1).single();
const beliefId = String(lb?.id);

const ORIGINAL = "You always change plans last minute, so thanks for that.";
const analysis = (extra: R = {}) => J({ points: [{ kind: "complaint", quote: "change plans last minute" }], feeling: { name: "fed up", intensity: 3 }, tone: "angry",
  frictions: [{ kind: "absolute", quote: "always" }, { kind: "sarcasm", quote: "so thanks for that" }],
  activated: [{ beliefId, why: "being the one who adjusts", quote: "change plans last minute" }], safety: { level: "none", reason: "" }, ...extra });
const rewrite = J({ bridged: "The plan changed last minute three times this month, and I am left out.", contextNote: null,
  changes: [{ kind: "absolute", from: "always", to: "three times this month" }, { kind: "sarcasm", from: "so thanks for that", to: "I am left out" }], tone: "sad" });
const critic = J({ pass: true, pointsMissing: [], added: [], receiverInnerLife: [], voice: 4, feelingPreserved: true, notes: "same point, her voice" });
const recorded = new RecordedClient({ analyse: [analysis(), analysis()], rewrite: [rewrite], verify: [critic], reword: [J({ to: "changed plans last minute three times this month" })], why: [J({ line: "Being the one who adjusts lands on something old for me: I only feel I count when I am the one people can lean on." })] });
hooks.client = () => recorded;

let r = await call("POST", "/bridge/insight", { person_id: nami.id, text: "short" }, lea.token);
step("insight under 12 characters: no call, no spans", r.status, r.status === 200 && (r.json.spans as unknown[]).length === 0 && r.json.tone === "neutral", J(r.json));
r = await call("POST", "/bridge/insight", { person_id: nami.id, text: "I will hurt you if you cancel again." }, lea.token);
step("insight on a threat: declined at the floor, no call, the threat span for the underline", r.status, r.json.state === "declined" && r.json.line === "I won't rewrite this one." && ((r.json.spans as R[]) ?? [])[0]?.kind === "threat", `state=${r.json.state} spans=${J(r.json.spans)}`);
r = await call("POST", "/bridge/insight", { person_id: nami.id, text: ORIGINAL }, lea.token);
const spans = (r.json.spans as R[]) ?? [];
const f = spans.filter((s) => s.kind === "friction"), bsp = spans.find((s) => s.kind === "belief");
step("insight: friction spans with notes, a belief span with id and label, tone, points", r.status,
  r.status === 200 && f.length === 2 && f.every((s) => ORIGINAL.slice(Number(s.start), Number(s.end)).length > 0 && typeof s.note === "string") && !!bsp && bsp.belief_id === beliefId && bsp.label === lb?.label && r.json.tone === "angry" && (r.json.points as R[]).length === 1,
  `spans=${J(spans.map((s) => [s.kind, ORIGINAL.slice(Number(s.start), Number(s.end)), s.friction_kind ?? s.label]))} tone=${r.json.tone}`);

r = await call("POST", "/bridge/run", { person_id: nami.id, text: "I will hurt you if you cancel again." }, lea.token);
const wc = (r.json.spans as R[]) ?? [];
step("run on a threat → wont_carry with the threat span and the S15b headline, nothing stored", r.status,
  r.status === 200 && r.json.outcome === "wont_carry" && r.json.bridged === null && wc.length === 1 && wc[0].kind === "threat" && Number(wc[0].start) === 0 && r.json.headline === "One part reads as threatening." && J(r.json.counts) === J({ threat: 1, abuse: 0 }),
  `outcome=${r.json.outcome} spans=${J(wc)} headline="${r.json.headline}" counts=${J(r.json.counts)}`);
r = await call("POST", "/bridges", { person_id: nami.id, original: "I will hurt you if you cancel again.", final: "I will hurt you if you cancel again.", used: "mine", deliver_at: "now" }, lea.token);
step("POST /bridges with the threat → 403 wont_carry carrying the spans, headline and counts", r.status, r.status === 403 && r.json.reason === "wont_carry" && ((r.json.spans as R[]) ?? []).length === 1 && r.json.safety === "threat" && r.json.headline === "One part reads as threatening." && J(r.json.counts) === J({ threat: 1, abuse: 0 }), `spans=${J(r.json.spans)} counts=${J(r.json.counts)}`);
r = await call("POST", "/bridge/run", { person_id: nami.id, text: ORIGINAL }, lea.token);
const changes = (r.json.changes as R[]) ?? [], points = (r.json.points as R[]) ?? [];
step("run → ok: bridged, changes with both spans and why, points kept, points_line, tones", r.status,
  r.status === 200 && r.json.outcome === "ok" && changes.length === 2 && changes.every((c) => typeof c.start === "number" && typeof c.original_start === "number" && typeof c.why === "string") &&
    points.every((p) => p.kept === true) && r.json.points_line === "Keeps your point" && J(r.json.tone) === J({ original: "angry", bridged: "sad" }),
  `outcome=${r.json.outcome} changes=${J(changes.map((c) => [c.original, c.to]))} tone=${J(r.json.tone)} points_line=${r.json.points_line} latency=${r.json.latency_ms}`);

r = await call("POST", "/bridge/reword-part", { person_id: nami.id, text: ORIGINAL, start: 4, end: 10, friction_kind: "absolute" }, lea.token);
step("reword-part: only the marked part changes", r.status, r.status === 200 && r.json.text === "You changed plans last minute three times this month change plans last minute, so thanks for that." && (r.json.replaced as R)?.original === "always", `text="${r.json.text}" replaced=${J(r.json.replaced)}`);
r = await call("POST", "/bridge/reword-part", { person_id: nami.id, text: ORIGINAL, start: 10, end: 4 }, lea.token);
step("reword-part with a bad span → 400", r.status, r.status === 400, `error=${r.json.error}`);

r = await call("POST", "/bridge/why-it-matters", { person_id: nami.id, text: ORIGINAL, belief_id: beliefId }, lea.token);
step("why-it-matters: one first-person line from the belief", r.status, r.status === 200 && typeof r.json.line === "string" && r.json.belief_id === beliefId && r.json.ref === null, `line="${r.json.line}"`);
r = await call("POST", "/bridge/why-it-matters", { person_id: nami.id, text: ORIGINAL, belief_id: "00000000-0000-0000-0000-000000000000" }, lea.token);
step("why-it-matters on a belief that is not mine → 404", r.status, r.status === 404, `error=${r.json.error}`);

const { data: calls } = await service.from("engine_calls").select("id,purpose,cents").eq("person", lea.id).eq("model", "recorded");
step("engine_calls trace rows (recorded model, 0¢)", 200, (calls ?? []).length === 6 && (calls ?? []).every((c) => c.cents === 0), J((calls ?? []).map((c) => c.purpose)));
await service.from("engine_calls").delete().in("id", (calls ?? []).map((c) => c.id));
const { count } = await service.from("bridges").select("*", { count: "exact", head: true }).eq("sender", lea.id);
step("nothing stored: Lea has no bridges", 200, (count ?? 0) === 0, `bridges=${count}`);
for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${String(x.status).padEnd(4)} ${x.step.padEnd(80)} ${x.note}`);
Deno.exit(results.every((x) => x.ok) ? 0 : 1);
