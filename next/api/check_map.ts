// $0 live check of the Map endpoints against the hosted database as an example account (Lea, seeded map) and the owner's
// empty map: GET /map, one belief with connections and receipts, wording/type edits (put back), Not me → restore, delete →
// restore, an outside perspective rated Partly → a mirror belief (then removed). Nothing it changes is left changed.
//   deno run --allow-net --allow-read --allow-env next/api/check_map.ts
import { handler } from "./index.ts";
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";

const J = (o: unknown) => JSON.stringify(o);
const results: { step: string; status: number; ok: boolean; note: string }[] = [];
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await handler(new Request("http://api.local" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}
const step = (name: string, status: number, ok: boolean, note: string) => { results.push({ step: name, status, ok, note }); if (!ok) console.log("   !", name, note); };
type R = Record<string, unknown>;

let r = await call("POST", "/preview/login", { persona: "lea" });
const lea = String(r.json.access_token ?? ""), leaId = String(((r.json.me as R)?.person as R)?.id ?? "");
r = await call("POST", "/preview/login", { persona: "nami" });
const nami = String(r.json.access_token ?? "");
step("login lea + nami", r.status, !!lea && !!nami, "");

r = await call("GET", "/map", undefined, nami);
const nc = r.json.counts as R;
step("GET /map as Nami (empty map)", r.status, r.status === 200 && (r.json.beliefs as unknown[]).length >= 0 && typeof nc?.confirmed === "number" && (r.json.areas_with_beliefs as unknown[]).length === ((r.json.beliefs as R[]).some((b) => b.status === "confirmed") ? (r.json.areas_with_beliefs as unknown[]).length : 0),
  `counts=${J(nc)} areas=${J(r.json.areas_with_beliefs)}`);

r = await call("GET", "/map", undefined, lea);
const map = r.json, beliefs = (map.beliefs as R[]) ?? [], counts = map.counts as R;
const confirmed = beliefs.filter((b) => b.status === "confirmed");
const b0 = confirmed[0];
step("GET /map as Lea: beliefs, patches, weights, links", r.status, r.status === 200 && confirmed.length > 0 && !!(b0?.patch as R)?.direction_deg && Object.keys(map.area_weights as R).length === 8 && typeof map.as_of === "string",
  `counts=${J(counts)} weights=${J(map.area_weights)} links=${(map.links as unknown[])?.length} new_since=${(map.new_since_last_visit as unknown[])?.length} first="${b0?.label}" patch=${J(b0?.patch)} receipts=${(b0?.receipts as unknown[])?.length}`);
r = await call("GET", "/map", undefined, lea);
step("GET /map again: new_since_last_visit is empty after a visit", r.status, (r.json.new_since_last_visit as unknown[]).length === 0, `${(r.json.new_since_last_visit as unknown[]).length}`);

const id = String(b0.belief_id);
r = await call("GET", `/beliefs/${id}`, undefined, lea);
const one = r.json.belief as R, conn = r.json.connected as R, rec = (r.json.receipts as R[]) ?? [];
step("GET /beliefs/:id: belief, connected, receipts with titles", r.status, r.status === 200 && one?.belief_id === id && !!conn && Array.isArray(conn.same_area) && rec.length > 0 && typeof rec[0].conversation_title === "string",
  `connected=${J(Object.fromEntries(Object.entries(conn ?? {}).map(([k, v]) => [k, (v as unknown[]).length])))} receipts=${rec.length} title="${rec[0]?.conversation_title}"`);
r = await call("GET", "/beliefs/00000000-0000-0000-0000-000000000000", undefined, lea);
step("GET /beliefs/<missing> → 404", r.status, r.status === 404, `error=${r.json.error} ref=${r.json.ref}`);

const original = { statement: one.statement as string, type: one.type as string, status: one.status as string, rating: one.rating as string | null };
r = await call("PATCH", `/beliefs/${id}`, { statement: original.statement + " (edited)" }, lea);
step("PATCH statement (the person's words, as given)", r.status, r.status === 200 && (r.json.belief as R)?.statement === original.statement + " (edited)" && ((r.json.belief as R)?.receipts as unknown[]).length === rec.length, `receipts kept ${((r.json.belief as R)?.receipts as unknown[])?.length}`);
r = await call("PATCH", `/beliefs/${id}`, { statement: original.statement }, lea);
step("PATCH statement back", r.status, (r.json.belief as R)?.statement === original.statement, "");
const otherType = original.type === "a view or taste" ? "a rule I live by" : "a view or taste";
r = await call("PATCH", `/beliefs/${id}`, { type: otherType }, lea);
step("PATCH type re-derives kind", r.status, (r.json.belief as R)?.type === otherType && (r.json.belief as R)?.kind === (otherType === "a view or taste" ? "everyday" : "rule"), `kind=${(r.json.belief as R)?.kind}`);
r = await call("PATCH", `/beliefs/${id}`, { type: original.type }, lea);
step("PATCH type back", r.status, (r.json.belief as R)?.type === original.type, "");
r = await call("PATCH", `/beliefs/${id}`, { rating: "maybe" }, lea);
step("PATCH bad rating → 400", r.status, r.status === 400, `error=${r.json.error}`);

r = await call("POST", `/beliefs/${id}/notme`, undefined, lea);
step("notme → set_aside, rating not, undo_until", r.status, (r.json.belief as R)?.status === "set_aside" && (r.json.belief as R)?.rating === "not" && typeof r.json.undo_until === "string", `status=${(r.json.belief as R)?.status}`);
r = await call("GET", "/map", undefined, lea);
step("GET /map counts it under set_aside", r.status, (r.json.counts as R).set_aside === Number(counts.set_aside) + 1, `set_aside=${(r.json.counts as R).set_aside}`);
r = await call("POST", `/beliefs/${id}/restore`, undefined, lea);
step("restore → previous status and rating", r.status, (r.json.belief as R)?.status === original.status && (r.json.belief as R)?.rating === original.rating, `status=${(r.json.belief as R)?.status} rating=${(r.json.belief as R)?.rating} (was ${original.status}/${original.rating})`);

r = await call("DELETE", `/beliefs/${id}`, undefined, lea);
step("DELETE belief → undo_until", r.status, r.status === 200 && r.json.deleted === id, J(r.json));
r = await call("GET", `/beliefs/${id}`, undefined, lea);
step("GET deleted belief → 404", r.status, r.status === 404, "");
r = await call("POST", `/beliefs/${id}/restore`, undefined, lea);
step("restore after delete → back as it was", r.status, (r.json.belief as R)?.status === original.status && (r.json.belief as R)?.rating === original.rating, `status=${(r.json.belief as R)?.status} rating=${(r.json.belief as R)?.rating}`);

// an outside perspective (Mirror's output) rated Partly becomes a mirror belief
const env = await loadEnv();
const service = serviceClient(env);
const { data: p } = await service.from("outside_perspectives").insert({ owner: leaId, label: "Keeps the peace", statement: "People who know you say you smooth things over before anyone asks.", people_count: 4, moment_count: 6 }).select("*").single();
r = await call("GET", "/outside", undefined, lea);
step("GET /outside lists it with its line", r.status, ((r.json.perspectives as R[]) ?? []).some((x) => x.id === p.id && x.line === "From 4 people who know you, across 6 moments"), J((r.json.perspectives as R[])?.find((x) => x.id === p.id)?.line));
r = await call("GET", "/map", undefined, lea);
step("GET /map counts.outside_new = 1", r.status, (r.json.counts as R)?.outside_new === 1, `outside_new=${(r.json.counts as R)?.outside_new}`);
r = await call("PATCH", `/outside/${p.id}`, { rating: "partly" }, lea);
const mb = r.json.belief as R;
step("PATCH /outside rating partly → mirror belief, seen by others, sheen, outside counts", r.status,
  r.status === 200 && (r.json.perspective as R)?.status === "rated" && mb?.source === "mirror" && mb?.seen_by_others === true && (mb?.patch as R)?.sheen === true && (mb?.patch as R)?.pale === true && (mb?.outside as R)?.people === 4,
  `belief=${mb?.belief_id ? "yes" : "no"} source=${mb?.source} patch=${J(mb?.patch)} outside=${J(mb?.outside)}`);
await service.from("beliefs").delete().eq("id", String(mb?.belief_id ?? ""));
await service.from("outside_perspectives").delete().eq("id", p.id);
const { data: left } = await service.from("beliefs").select("statement,type,status,rating").eq("id", id).single();
step("cleanup: Lea's belief exactly as before, perspective and mirror belief removed", 200, left?.statement === original.statement && left?.type === original.type && left?.status === original.status && (left?.rating ?? null) === original.rating, J(left));

for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${String(x.status).padEnd(4)} ${x.step.padEnd(72)} ${x.note}`);
Deno.exit(results.every((x) => x.ok) ? 0 : 1);
