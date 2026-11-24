// Kenning map v2 (d-all-kenning-map-v2-14nov): one-time keyword backfill for kennings made before Talk gave a keyword (migration 0064).
// Haiku 5.5 names each kenning's station with ONE plain word from its label and wording only (never a receipt, never a quote);
// a word that fails the keyword check falls back to the label's own word (keywordFromLabel). Writes only rows whose map_keyword is
// still null; a re-run does nothing new. Capped (CappedModelClient) and counted: calls, nominal cents, rows written.
//   deno run --allow-read --allow-env --allow-net next/scripts/backfill_kenning_keywords.ts                 # dry run: counts, no call, no write
//   deno run --allow-read --allow-env --allow-net next/scripts/backfill_kenning_keywords.ts --apply [--cap-cents 40] [--out DIR]
// STAGING only (staging.env). Hosted waits for the map pre-approval with QA PASS; this script has no hosted switch.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanKeyword, keywordFromLabel } from "../engine/keyword.ts";
import { AnthropicClient, CappedModelClient, loadProtectedConfig } from "../engine/model/client.ts";
import type { ModelClient } from "../engine/model/client.ts";

export const BACKFILL_MODEL = "claude-haiku-5-5";
export const BATCH = 25;
export const KEYWORD_PROMPT = `You name stations on a person's map of what they believe. Each item is one belief: its short label and its wording.
For each, give ONE word that names it: a noun for what the belief is about, from the label or wording when one fits ("Keep the peace" -> "Peace"; "Rest has to be earned" -> "Rest"; "I'm not enough for others" -> "Enough").
Rules: one word, letters only (a hyphen or apostrophe inside is fine), at most 18 letters. For a harsh statement about the self, its topic ("Worth", "Enough"), never its verdict. Never a trait or label about the person (lazy, needy, selfish, weak, broken), a judgement (failure, weakness), a feeling (shame, guilt, fear), a person's name (use the relation, "Mum", or the topic), the name of an area (work, family, money, body, meaning), a clinical or mood word, advice, or any of: core, root, origin, deep, conflict, contradiction, tension, torn, pulled, crossroads, score, complete. When no word fits, give null.
Answer with ONE JSON object and nothing else: {"keywords":[{"i":0,"keyword":"…"}]}`;

type Row = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

export interface BackfillResult { candidates: number; calls: number; cents: number; written: number; fromModel: number; fromLabel: number; failedCalls: number }

/** Reads every confirmed kenning with no keyword; with a client, asks in batches; with apply, writes each keyword where still null. */
export async function backfillKeywords(db: Db, client: ModelClient | null, opts: { apply: boolean; batch?: number }): Promise<BackfillResult> {
  const out: BackfillResult = { candidates: 0, calls: 0, cents: 0, written: 0, fromModel: 0, fromLabel: 0, failedCalls: 0 };
  const { data, error } = await db.from("beliefs").select("id,owner,label,statement,own_wording,map_keyword").eq("status", "confirmed").is("map_keyword", null);
  if (error) throw new Error(`beliefs.select: ${error.message ?? error}`);
  const rows = ((data ?? []) as Row[]).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  out.candidates = rows.length;
  if (!client) return out;
  const size = opts.batch ?? BATCH;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const items = chunk.map((r, n) => ({ i: n, label: String(r.label ?? ""), wording: String(r.own_wording ?? r.statement ?? "") }));
    const ex = await client.complete({ purpose: "kenning_keyword", system: KEYWORD_PROMPT, messages: [{ role: "user", content: JSON.stringify(items) }],
      maxTokens: 40 + 16 * chunk.length, model: BACKFILL_MODEL, thinking: "disabled", effort: null });
    out.calls++; out.cents += ex.usage.cents;
    const got = new Map<number, string>();
    try {
      const text = ex.rawResponse.slice(ex.rawResponse.indexOf("{"), ex.rawResponse.lastIndexOf("}") + 1);
      for (const k of (JSON.parse(text).keywords ?? []) as Row[]) {
        const w = cleanKeyword(k.keyword);
        if (typeof k.i === "number" && w) got.set(k.i, w);
      }
    } catch { out.failedCalls++; }
    for (const [n, r] of chunk.entries()) {
      const model = got.get(n);
      const ownPen = String(r.label ?? "") === "In my words";   // map.ts OWN_LABEL: the person wrote it; fall back to the wording
      const keyword = model ?? (ownPen ? null : keywordFromLabel(String(r.label ?? ""))) ?? keywordFromLabel(String(r.own_wording ?? r.statement ?? ""));
      if (!keyword) continue;
      if (model) out.fromModel++; else out.fromLabel++;
      if (!opts.apply) continue;
      const { error: ue } = await db.from("beliefs").update({ map_keyword: keyword }).eq("id", r.id).eq("owner", r.owner).is("map_keyword", null);
      if (ue) throw new Error(`beliefs.update: ${ue.message ?? ue}`);
      out.written++;
    }
  }
  return out;
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
  const args = Deno.args;
  const apply = args.includes("--apply");
  const at = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const cap = Number(at("--cap-cents") ?? "40");
  const env = await stagingValues();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("staging.env has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); Deno.exit(2);
  }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const client = apply
    ? new CappedModelClient(new AnthropicClient({ config: await loadProtectedConfig(), defaultModel: BACKFILL_MODEL, thinking: "disabled", timeoutMs: 30_000 }), cap, BACKFILL_MODEL)
    : null;
  const r = await backfillKeywords(db, client, { apply });
  const line = `${new Date().toISOString()} staging ${apply ? "apply" : "dry-run"} candidates=${r.candidates} calls=${r.calls} cents=${r.cents.toFixed(2)} ` +
    `written=${r.written} model=${r.fromModel} label=${r.fromLabel} failed_calls=${r.failedCalls} cap=${cap}`;
  console.log(line);
  const dir = at("--out");
  if (dir) { await Deno.mkdir(dir, { recursive: true }); await Deno.writeTextFile(`${dir}/backfill.log`, line + "\n", { append: true }); }
}
