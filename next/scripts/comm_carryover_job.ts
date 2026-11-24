// V3 communication model, spec 4.7: the carry-over pass as a background job on the Batch API (50% off, not live, results within 24 h).
// Rules and request shapes live in engine/comm_carryover.ts; this file reads, submits, collects and writes. Resumable: a job record on disk
// names the batch, so a crash between submit and collect loses nothing and never submits twice.
//   deno run --allow-read --allow-write --allow-env --allow-net next/scripts/comm_carryover_job.ts plan   [--owner ID]            # dry run: counts, estimate, no call
//   deno run ... comm_carryover_job.ts submit  --job DIR [--cap-cents 40] [--owner ID] [--limit N]                                 # one batch; writes DIR/job.json
//   deno run ... comm_carryover_job.ts collect --job DIR [--apply]                                                                 # results to rows (dry unless --apply)
// STAGING only (staging.env), owner-only switch; no hosted switch exists in this script. The model is Haiku only after the carry-over gold
// run passes: `--model` refuses anything else until the record `gold_passed` is set by hand in the job directory's gate file.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildBatchRequests, CARRY_OVER_MODEL, carryOverProblems, type BatchRequest, type CarryOverRow, type ExistingKenning, type ModelAnswer,
  parseBatchLine, planCarryOver, PLACEHOLDER, sendable,
} from "../engine/comm_carryover.ts";
import { loadProtectedConfig, rate } from "../engine/model/client.ts";

type Row = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

/** What the job needs of the Batch API. The real one is `AnthropicBatches`; tests pass a fake. */
export interface BatchApi {
  submit(requests: BatchRequest[]): Promise<{ id: string }>;
  status(id: string): Promise<{ ended: boolean; counts?: Record<string, number> }>;
  /** One JSON object per line, as the results file gives them. */
  results(id: string): Promise<string[]>;
}

export interface JobRecord {
  batch_id: string;
  model: string;
  submitted_at: string;
  ids: string[];            // kenning ids sent, in order (never the wording)
  estimated_cents: number;  // worst case at the batch discount, before the call
  cap_cents: number;
  state: "submitted" | "collected" | "applied";
  settled_cents?: number;
  counts?: Record<string, number>;
}

/** The Batch API is billed at half the live price. */
export const BATCH_DISCOUNT = 0.5;

// ---------------------------------------------------------------- read
/** Confirmed kennings with no comm kind yet, with the people each is granted to today. Wording is the person's own where they wrote it. */
export async function loadExisting(db: Db, opts: { owner?: string; limit?: number } = {}): Promise<{ items: ExistingKenning[]; owners: Map<string, string> }> {
  let q = db.from("beliefs").select("id,owner,statement,own_wording,area,status,comm_kind").eq("status", "confirmed").is("comm_kind", null);
  if (opts.owner) q = q.eq("owner", opts.owner);
  const { data, error } = await q;
  if (error) throw new Error(`beliefs.select: ${error.message ?? error}`);
  let rows = ((data ?? []) as Row[]).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (opts.limit !== undefined) rows = rows.slice(0, opts.limit);
  const ids = rows.map((r) => String(r.id));
  const grants = new Map<string, string[]>();
  if (ids.length) {
    const { data: g, error: ge } = await db.from("share_items").select("belief_id,other").in("belief_id", ids);
    if (ge) throw new Error(`share_items.select: ${ge.message ?? ge}`);
    for (const r of (g ?? []) as Row[]) grants.set(String(r.belief_id), [...(grants.get(String(r.belief_id)) ?? []), String(r.other)]);
  }
  const owners = new Map<string, string>();
  const items = rows.map((r): ExistingKenning => {
    owners.set(String(r.id), String(r.owner));
    return { id: String(r.id), wording: String(r.own_wording ?? r.statement ?? ""), oldTopic: (r.area as string | null) ?? null, grantedTo: grants.get(String(r.id)) ?? [], commKind: null };
  });
  return { items, owners };
}

/** Worst-case cost of a batch at the discount, in fractional cents (no round-up per call): one UTF-8 byte per input token and the full output
 *  allowance, the same overestimate the live ledger admits on. The cached system prompt is counted in full every time, so the estimate only errs high. */
export function estimateCents(reqs: readonly BatchRequest[]): number {
  let c = 0;
  const enc = new TextEncoder();
  for (const r of reqs) {
    const [i, o] = rate(r.params.model);
    const bytes = enc.encode(r.params.system.map((s) => s.text).join("") + JSON.stringify(r.params.messages)).length;
    c += (bytes * i + r.params.max_tokens * o) / 1_000_000;
  }
  return Math.ceil(c * BATCH_DISCOUNT * 100) / 100;
}

export interface PlanResult { candidates: number; sendable: number; skippedSafety: number; estimatedCents: number }
export async function planJob(db: Db, opts: { owner?: string; limit?: number; model?: string } = {}): Promise<PlanResult> {
  const { items } = await loadExisting(db, opts);
  const reqs = buildBatchRequests(items, opts.model);
  return { candidates: items.length, sendable: reqs.length, skippedSafety: items.filter((k) => !sendable(k) && k.wording.trim()).length, estimatedCents: estimateCents(reqs) };
}

// ---------------------------------------------------------------- submit
export async function submitJob(db: Db, api: BatchApi, dir: string, opts: { capCents: number; owner?: string; limit?: number; model?: string; now?: Date }): Promise<JobRecord> {
  const path = `${dir}/job.json`;
  try { await Deno.stat(path); throw new Error(`a job already exists in ${dir}; collect it or use a new directory`); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  const model = opts.model ?? CARRY_OVER_MODEL;
  const { items } = await loadExisting(db, opts);
  const reqs = buildBatchRequests(items, model);
  if (!reqs.length) throw new Error("nothing to send");
  const est = estimateCents(reqs);
  if (est > opts.capCents) throw new Error(`budget_unavailable: estimate ${est}¢ is over the cap ${opts.capCents}¢; nothing sent`);
  const { id } = await api.submit(reqs);
  const rec: JobRecord = { batch_id: id, model, submitted_at: (opts.now ?? new Date()).toISOString(), ids: reqs.map((r) => r.custom_id), estimated_cents: est, cap_cents: opts.capCents, state: "submitted" };
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(rec, null, 2));   // written right after the call: a crash after this point still knows the batch
  return rec;
}

// ---------------------------------------------------------------- collect
export interface CollectResult {
  state: "pending" | "collected" | "applied";
  rows: number; suggestions: number; skipped: Record<string, number>; written: number; settledCents: number; problems: string[];
}

/** Provider-billed cost in fractional cents (the same arithmetic as the client's usageCents, without its round-up).
 * Kept here so this job does not wait on the credit-cycle change (0068); fold into the client's export when that lands. */
function usageCentsExact(model: string, input: number, output: number, cacheWrite: number, cacheRead: number): number {
  const [inputRate, outputRate] = rate(model);
  const readMultiplier = /claude-(?:sonnet|opus)-5-5/.test(model) ? 0.05 : 0.1;
  return (input * inputRate + cacheWrite * inputRate * 1.25 + cacheRead * inputRate * readMultiplier + output * outputRate) / 1_000_000;
}

/** The settled cost of one results line: usage tokens at the batch discount. Lines with no usage cost nothing here. */
export function lineCents(line: string, model: string): number {
  try {
    const u = JSON.parse(line)?.result?.message?.usage;
    if (!u) return 0;
    return usageCentsExact(model, u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0) * BATCH_DISCOUNT;
  } catch { return 0; }
}

export async function collectJob(db: Db, api: BatchApi, dir: string, opts: { apply: boolean; owner?: string }): Promise<CollectResult> {
  const path = `${dir}/job.json`;
  const rec = JSON.parse(await Deno.readTextFile(path)) as JobRecord;
  const empty: CollectResult = { state: "pending", rows: 0, suggestions: 0, skipped: {}, written: 0, settledCents: 0, problems: [] };
  if (rec.state === "applied") return { ...empty, state: "applied" };
  const st = await api.status(rec.batch_id);
  if (!st.ended) return empty;
  const lines = await api.results(rec.batch_id);
  const answers = new Map<string, ModelAnswer | null>();
  let settled = 0;
  for (const line of lines) {
    const p = parseBatchLine(line);
    if (p) answers.set(p.id, p.answer);
    settled += lineCents(line, rec.model);
  }
  // Re-read the kennings as they are now: anything the person has since carried over by hand is left alone; only the ids that were sent count.
  const { items } = await loadExisting(db, { owner: opts.owner });
  const sent = new Set(rec.ids);
  const subset = items.filter((k) => sent.has(k.id));
  const rows = planCarryOver(subset, answers);
  const problems = carryOverProblems(subset, rows);
  const res: CollectResult = { state: "collected", rows: rows.length, suggestions: rows.filter((r) => r.suggestion).length, skipped: {}, written: 0, settledCents: Math.round(settled * 1000) / 1000, problems };
  for (const r of rows) if (r.skipped) res.skipped[r.skipped] = (res.skipped[r.skipped] ?? 0) + 1;
  rec.state = "collected"; rec.settled_cents = res.settledCents; rec.counts = st.counts;
  await Deno.writeTextFile(path, JSON.stringify(rec, null, 2));
  if (problems.length) return res;                       // the job's own invariants failed: nothing is written
  if (!opts.apply) return res;
  res.written = await applyRows(db, rows);
  rec.state = "applied";
  await Deno.writeTextFile(path, JSON.stringify(rec, null, 2));
  res.state = "applied";
  return res;
}

/** Placeholder and (when one passed the checks) the pending suggestion, only where the item is still not carried over. Words, dates, receipts,
 *  rating and sharing are not in the update, so none of them can change. */
export async function applyRows(db: Db, rows: readonly CarryOverRow[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const patch: Row = {
      comm_kind: PLACEHOLDER.kind, comm_scope_type: PLACEHOLDER.scopeType, comm_scope_value: PLACEHOLDER.scopeValue, comm_status: PLACEHOLDER.status,
      comm_suggestion: r.suggestion ? { kind: r.suggestion.kind, confidence: r.suggestion.confidence, topic: r.suggestion.topic } : null,
    };
    const { error } = await db.from("beliefs").update(patch).eq("id", r.id).is("comm_kind", null);
    if (error) throw new Error(`beliefs.update: ${error.message ?? error}`);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- the real Batch API
export class AnthropicBatches implements BatchApi {
  constructor(private readonly key: string, private readonly fetchFn: typeof fetch = fetch) {}
  private headers() { return { "x-api-key": this.key, "anthropic-version": "2023-06-01", "content-type": "application/json" }; }
  async submit(requests: BatchRequest[]) {
    const r = await this.fetchFn("https://api.anthropic.com/v1/messages/batches", { method: "POST", headers: this.headers(), body: JSON.stringify({ requests }) });
    if (!r.ok) throw new Error(`batch submit ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return { id: String((await r.json()).id) };
  }
  async status(id: string) {
    const r = await this.fetchFn(`https://api.anthropic.com/v1/messages/batches/${id}`, { headers: this.headers() });
    if (!r.ok) throw new Error(`batch status ${r.status}`);
    const b = await r.json();
    return { ended: b.processing_status === "ended", counts: b.request_counts as Record<string, number> | undefined };
  }
  async results(id: string) {
    const r = await this.fetchFn(`https://api.anthropic.com/v1/messages/batches/${id}/results`, { headers: this.headers() });
    if (!r.ok) throw new Error(`batch results ${r.status}`);
    return (await r.text()).split("\n").filter((l) => l.trim());
  }
}

async function stagingValues(): Promise<Record<string, string>> {
  const root = Deno.env.get("PRESENCE_HOME_ROOT") ?? `${Deno.env.get("HOME")}/Library/Application Support/PresenceHome`;
  const values: Record<string, string> = {};
  for (const line of (await Deno.readTextFile(`${root}/secrets/staging.env`)).split("\n")) {
    const m = line.trim().replace(/^export\s+/, "").match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) values[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

if (import.meta.main) {
  const args = Deno.args, cmd = args[0];
  const at = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const env = await stagingValues();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error("staging.env has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); Deno.exit(2); }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const owner = at("--owner"), dir = at("--job");
  if (cmd === "plan") {
    console.log(JSON.stringify(await planJob(db, { owner, limit: at("--limit") ? Number(at("--limit")) : undefined })));
  } else if (cmd === "submit" && dir) {
    const model = at("--model") ?? CARRY_OVER_MODEL;
    const gate = await Deno.readTextFile(`${dir}/gold_passed.txt`).catch(() => "");
    if (!gate.includes(model)) { console.error(`no gold pass recorded for ${model}: write the model id into ${dir}/gold_passed.txt after the carry-over gold run passes`); Deno.exit(3); }
    const api = new AnthropicBatches((await loadProtectedConfig()).key);
    console.log(JSON.stringify(await submitJob(db, api, dir, { capCents: Number(at("--cap-cents") ?? "40"), owner, limit: at("--limit") ? Number(at("--limit")) : undefined, model })));
  } else if (cmd === "collect" && dir) {
    const api = new AnthropicBatches((await loadProtectedConfig()).key);
    console.log(JSON.stringify(await collectJob(db, api, dir, { apply: args.includes("--apply"), owner })));
  } else { console.error("usage: plan | submit --job DIR | collect --job DIR [--apply]"); Deno.exit(2); }
}
