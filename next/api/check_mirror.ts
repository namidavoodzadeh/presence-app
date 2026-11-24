// $0 live check of Mirror with recorded models (no paid call), against the hosted database: Nami turns Mirror on, Lea, Sam, Dara and
// Mom contribute through the web page's calls, a label is asked for a moment, a concern is not mapped, the gate holds at two people
// and passes at three, the synthesis makes one card (a Belief with type and area once rated Partly), approvals, rotate, delete.
// Everything it made is removed; Nami's link is left as it was found.
//   deno run --allow-net --allow-read --allow-env next/api/check_mirror.ts
import { handler } from "./index.ts";
import { contributorKey, hooks } from "./mirror.ts";
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
const nami = await login("nami"), lea = await login("lea"), sam = await login("sam"), dara = await login("dara"), mom = await login("mom");
const env = await loadEnv(); const service = serviceClient(env);
const { data: linkBefore } = await service.from("mirror_links").select("*").eq("owner", nami.id).maybeSingle();
const { data: perspBefore } = await service.from("outside_perspectives").select("id").eq("owner", nami.id);
const beforeIds = new Set((perspBefore ?? []).map((p) => p.id as string));
const { count: waitingBefore } = await service.from("outside_perspectives").select("id", { count: "exact", head: true }).eq("owner", nami.id).eq("status", "new");
const w0 = waitingBefore ?? 0;   // cards the owner already has waiting (his own sample); the check reads its counts relative to them

const moment = (key: string | null, behaviour: string, conf = 0.8) => J({ kind: "moment", safety: { level: "none", reason: "" },
  observation: { situation: "a plan changed at the last minute", behaviour, reaction: "the evening went quiet", guess: null, domains: ["close_relationships"] },
  theme: { key, label: "Goes quiet", statement: "Part of you may go quiet when a plan changes on you.", type: "how I tend to react", confidence: conf }, map: { belief_id: null, relation: null, confidence: 0 } });
const label = J({ kind: "label", safety: { level: "none", reason: "" }, observation: {}, theme: { confidence: 0 }, map: {} });
const card = J({ label: "Goes quiet", statement: "People who know you describe you going quiet when a plan changes on you at the last minute.", type: "something I do to cope", domains: ["close_relationships"],
  summary: "People who know you describe the same shape: a plan moves late, you say it's fine, and then you go quiet for the rest of the evening." });
const recorded = new RecordedClient({ mirror_observe: [moment(null, "went quiet and kept cooking"), moment("{KEY}", "went very quiet in the car"), label, moment("{KEY}", "was short and quiet all day")], mirror_synthesise: [card] });
// the second and third observations must name the first's theme key, which the API makes: patch the queue after the first call
const queue = (recorded as unknown as { "#queues"?: unknown });
void queue;
hooks.client = () => recorded;

let r = await call("GET", "/mirror", undefined, nami.token);
step("GET /mirror as Nami", r.status, r.status === 200 && typeof (r.json.mirror as R).on === "boolean" && (r.json.mirror as R).waiting !== undefined, J(r.json.mirror));
r = await call("PATCH", "/mirror", { on: true }, nami.token);
const mirror = r.json.mirror as R, slug = String(mirror.slug ?? "");
step("PATCH /mirror on → slug and link", r.status, r.status === 200 && mirror.on === true && slug.length === 10 && String(mirror.link).endsWith(slug), `link=${mirror.link}`);
r = await call("GET", `/m/${slug}`);
step("GET /m/:slug (no bearer): open, owner's first name, three prompts, the line", r.status, r.status === 200 && r.json.open === true && (r.json.prompts as string[]).length === 3 && String(r.json.line).includes("will never see your words"), `owner=${r.json.owner_name} prompts=${J(r.json.prompts)}`);
r = await call("GET", `/m/${slug}`);
step("GET /m/:slug JSON: prompt 3 is the CPO's wording, how_long, preview true with the example people as test friends", r.status,
  (r.json.prompts as string[])[2] === "What seemed to matter to Nami there?" && (r.json.how_long as string[]).length === 3 && r.json.preview === true && ((r.json.test_friends as R[]) ?? []).some((f) => f.persona === "lea") && !((r.json.test_friends as R[]) ?? []).some((f) => f.persona === "nami"),
  `prompts[2]="${(r.json.prompts as string[])[2]}" friends=${J((r.json.test_friends as R[])?.map((f) => f.persona))}`);
{
  const res = await handler(new Request(`http://api.local/m/${slug}`, { headers: { accept: "text/html,application/xhtml+xml" } }));
  const html = await res.text();
  step("GET /m/:slug as a browser → the HTML page with the owner's name, the prompts, noindex", res.status, res.status === 200 && (res.headers.get("content-type") ?? "").startsWith("text/html") && html.includes("asked for your perspective") && html.includes('"owner_name":"Nami"') && html.includes("What seemed to matter to Nami there?") && res.headers.get("x-robots-tag") === "noindex, nofollow", `${html.length} chars`);
}
r = await call("GET", "/m/nosuchslug00");
step("GET /m/<unknown> → open false, not_found", r.status, r.json.open === false && r.json.reason === "not_found", J(r.json));
r = await call("POST", `/m/${slug}/contributions`, { how_known: "partner", moment: "We had friends coming and one couple cancelled. He went quiet and kept cooking." }, nami.token);
step("POST contribution to own link → 403 own_link", r.status, r.status === 403 && r.json.reason === "own_link", J(r.json));
r = await call("POST", `/m/${slug}/contributions`, { how_known: "partner", moment: "We had friends coming and one couple cancelled an hour before. He went quiet." });
step("POST contribution with no bearer and no test friend → 401", r.status, r.status === 401, J(r.json));
r = await call("POST", `/m/${slug}/contributions`, { how_known: "partner", moment: "short" }, lea.token);
step("POST contribution under 12 characters → 400", r.status, r.status === 400, J(r.json));
r = await call("POST", `/m/${slug}/contributions`, { how_known: "friend", moment: "He told me last week he wanted to end it all and didn't see the point any more." }, sam.token);
step("POST a concern → not mapped, contributor shown resources, nothing stored raw", r.status, r.status === 200 && r.json.accepted === false && r.json.state === "concern" && !!r.json.resources, `state=${r.json.state}`);
const { data: c0 } = await service.from("mirror_contributions").select("status,moment,dropped_reason").eq("link_id", String(linkBefore?.id ?? (await service.from("mirror_links").select("id").eq("owner", nami.id).single()).data?.id)).eq("dropped_reason", "concern").limit(1).maybeSingle();
step("  the concern row: dropped, raw moment deleted", 200, c0?.status === "dropped" && c0?.moment === null, J(c0));

r = await call("POST", `/m/${slug}/contributions`, { how_known: "partner", moment: "We had friends coming for dinner and one couple cancelled an hour before. Nami went quiet, kept cooking, and said it was fine." }, lea.token);
step("POST moment 1 (Lea) → accepted, done", r.status, r.status === 200 && r.json.accepted === true && r.json.state === "done", `state=${r.json.state} ref=${r.json.ref}`);
const { data: link } = await service.from("mirror_links").select("id").eq("owner", nami.id).single();
const leaKey = await contributorKey(nami.id, lea.id);
const { data: first } = await service.from("mirror_contributions").select("*").eq("link_id", link!.id).eq("contributor_key", leaKey).eq("status", "pending").not("theme_key", "is", null).order("created_at", { ascending: false }).limit(1).single();
const key = String(first?.theme_key);
step("  stored de-identified: observation present, raw moment deleted, theme key made", 200, !!first?.observation && first?.moment === null && key.startsWith("t_"), `key=${key} obs=${J((first?.observation as R)?.behaviour)}`);
// the recorded replies for the next moments name this key
const patched = new RecordedClient({ mirror_observe: [moment(key, "went very quiet in the car"), label, moment(key, "was short and quiet all day")], mirror_synthesise: [card] });
hooks.client = () => patched;
r = await call("POST", `/m/${slug}/contributions`, { how_known: "family", moment: "At my birthday lunch his brother changed the restaurant at the last minute. Nami went very quiet in the car." }, mom.token);
step("POST moment 2 (Mom) → done; two people: nothing surfaces", r.status, r.json.state === "done", `state=${r.json.state}`);
r = await call("GET", "/mirror", undefined, nami.token);
step("GET /mirror: nothing new waiting (the gate holds at two people), never a count of contributions", r.status, (r.json.mirror as R).waiting === w0 && !("contributions" in (r.json.mirror as R)), J(r.json.mirror));
r = await call("POST", `/m/${slug}/contributions`, { test_friend: "dara", how_known: "friend", how_long: "over_five_years", happening: "We were talking about his brother.", did: "He's just stubborn, always has been." });
step("POST a label as a test friend (no bearer, three fields) → asked for a moment, not used; contribution_id returned", r.status, r.status === 200 && r.json.accepted === false && r.json.state === "ask_moment" && String(r.json.line).includes("describe a moment") && typeof r.json.contribution_id === "string", `state=${r.json.state}`);
const labelId = String(r.json.contribution_id);
const { data: labelRow } = await service.from("mirror_contributions").select("how_long,moment,status").eq("id", labelId).maybeSingle();
step("  the label row: how_long stored, raw text gone, dropped", 200, labelRow?.how_long === "over_five_years" && labelRow?.moment === null && labelRow?.status === "dropped", J(labelRow));
r = await call("DELETE", `/m/${slug}/contributions/${labelId}`, { test_friend: "lea" });
step("Delete my answer by another test friend → 404 (not theirs)", r.status, r.status === 404, `error=${r.json.error}`);
r = await call("DELETE", `/m/${slug}/contributions/${labelId}`, { test_friend: "dara" });
step("Delete my answer by its contributor → deleted", r.status, r.status === 200 && r.json.deleted === true, J(r.json));
r = await call("POST", `/m/${slug}/contributions`, { test_friend: "nami", how_known: "friend", moment: "Some moment that is long enough to count here." });
step("test friend = the owner → 403 own_link", r.status, r.status === 403 && r.json.reason === "own_link", `reason=${r.json.reason}`);
r = await call("POST", `/m/${slug}/contributions`, { how_known: "friend", moment: "I moved our hike the night before. He said sure, no problem, but then he was short and quiet all day." }, sam.token);
step("POST moment 3 (Sam) → three people: the gate passes, synthesis runs", r.status, r.json.state === "done", `state=${r.json.state}`);
r = await call("GET", "/mirror", undefined, nami.token);
step("GET /mirror: one more waiting", r.status, (r.json.mirror as R).waiting === w0 + 1, J(r.json.mirror));
r = await call("GET", "/map", undefined, nami.token);
const persp = ((r.json.outside as R[]) ?? []).find((p) => !beforeIds.has(String(p.id)));
step("GET /map: counts.outside_new 1, the card with label, statement, summary, counts line 3 people / 3 moments, type, area", r.status,
  (r.json.counts as R).outside_new === w0 + 1 && !!persp && persp.label === "Goes quiet" && persp.line === "From 3 people who know you, across 3 moments" && persp.type === "something I do to cope" && persp.area === "relationships" && typeof persp.summary === "string",
  J(persp));
const { data: used } = await service.from("mirror_contributions").select("status").eq("link_id", link!.id).eq("theme_key", key);
step("  the three moments are marked used", 200, (used ?? []).length === 3 && (used ?? []).every((u) => u.status === "used"), J(used));
const { count: calls } = await service.from("engine_calls").select("id", { count: "exact", head: true }).eq("person", nami.id).in("purpose", ["mirror_observe", "mirror_synthesise"]).gte("created_at", new Date(Date.now() - 120e3).toISOString());
step("  engine_calls rows: 4 observe + 1 synthesise", 200, (calls ?? 0) >= 5, `${calls}`);
const { data: observeRows } = await service.from("engine_calls").select("request").eq("person", nami.id).in("purpose", ["mirror_observe", "mirror_observe_repair"]).gte("created_at", new Date(Date.now() - 120e3).toISOString());
const packages = (observeRows ?? []).flatMap((row) => (((row.request as R)?.messages as R[]) ?? []).map((m) => String(m.content ?? "")));
const rawWords = ["kept cooking, and said it was fine", "went very quiet in the car", "just stubborn, always has been", "short and quiet all day"];
step("  the observe traces carry no moment as written: length and hash in its place (Q62 b)", 200,
  packages.length >= 4 && packages.every((c) => c.includes("[deleted once processed:")) && !packages.some((c) => rawWords.some((w) => c.includes(w))), `${packages.length} packages`);
r = await call("PATCH", `/outside/${persp?.id}`, { rating: "partly" }, nami.token);
const mb = r.json.belief as R;
step("PATCH /outside Partly → mirror belief with the synthesis's type, kind and area, seen by others, outside summary", r.status,
  r.status === 200 && mb?.source === "mirror" && mb?.type === "something I do to cope" && mb?.kind === "rule" && mb?.area === "relationships" && mb?.seen_by_others === true && (mb?.outside as R)?.people === 3 && String((mb?.outside as R)?.summary).startsWith("People who know you"),
  `type=${mb?.type} kind=${mb?.kind} area=${mb?.area} outside=${J(mb?.outside)}`);

r = await call("PATCH", "/mirror", { who: "approved" }, nami.token);
step("PATCH /mirror who approved", r.status, (r.json.mirror as R).who === "approved", "");
r = await call("POST", `/m/${slug}/contributions`, { how_known: "friend", name: "Dara", moment: "When we planned the trip to the coast he lit up and found all the little places." }, dara.token);
step("POST from an unapproved contributor → waiting_approval", r.status, r.json.state === "waiting_approval", `state=${r.json.state}`);
r = await call("GET", "/mirror", undefined, nami.token);
const approvals = (r.json.mirror as R).approvals as R[];
step("GET /mirror: approvals list shows the name, never beside a moment", r.status, approvals.length === 1 && approvals[0].name === "Dara" && !("moment" in approvals[0]), J(approvals));
r = await call("POST", `/mirror/approvals/${approvals[0]?.id}`, { approve: false }, nami.token);
step("decline → approvals empty, the waiting moment dropped with its raw text", r.status, ((r.json.mirror as R).approvals as R[]).length === 0, "");
const { data: declined } = await service.from("mirror_contributions").select("status,moment").eq("link_id", link!.id).eq("status", "declined");
step("  declined row: no raw text", 200, (declined ?? []).length === 1 && declined![0].moment === null, J(declined));
r = await call("POST", "/mirror/rotate", undefined, nami.token);
const slug2 = String((r.json.mirror as R).slug);
step("POST /mirror/rotate → new slug; the old one stops", r.status, slug2 !== slug && slug2.length === 10, `${slug} → ${slug2}`);
r = await call("GET", `/m/${slug}`);
step("GET /m/<old slug> → not_found", r.status, r.json.open === false && r.json.reason === "not_found", "");
r = await call("PATCH", "/mirror", { paused: true }, nami.token);
r = await call("POST", `/m/${slug2}/contributions`, { how_known: "friend", moment: "Some moment that is long enough to count." }, lea.token);
step("POST to a paused link → 403 closed", r.status, r.status === 403 && r.json.reason === "closed", J(r.json));
r = await call("DELETE", "/mirror", undefined, nami.token);
step("DELETE /mirror → off, no slug; contributions gone with the link", r.status, (r.json.mirror as R).on === false && (r.json.mirror as R).slug === null, J(r.json.mirror));
const { count: leftC } = await service.from("mirror_contributions").select("id", { count: "exact", head: true }).eq("owner", nami.id);
step("  no contribution rows left for Nami", 200, (leftC ?? 0) === 0, `${leftC}`);

// cleanup: the perspective and the mirror belief it became; Nami's link as it was
await service.from("beliefs").delete().eq("id", String(mb?.belief_id ?? ""));
await service.from("outside_perspectives").delete().eq("id", String(persp?.id ?? ""));
if (linkBefore) await service.from("mirror_links").insert({ owner: nami.id, slug: linkBefore.slug, enabled: linkBefore.enabled, who: linkBefore.who, paused: linkBefore.paused });
const { data: perspAfter } = await service.from("outside_perspectives").select("id").eq("owner", nami.id);
step("cleanup: perspectives as before, mirror belief removed, link as found", 200, (perspAfter ?? []).length === beforeIds.size, `${(perspAfter ?? []).length} = ${beforeIds.size}; link before: ${linkBefore ? "present" : "none"}`);

for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${String(x.status).padEnd(4)} ${x.step.padEnd(90)} ${x.note}`);
Deno.exit(results.every((x) => x.ok) ? 0 : 1);
