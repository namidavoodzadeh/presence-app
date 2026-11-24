// The Postgres ledger (usage_ledger) behind the same Ledger interface the engines already use: reserve the worst case before a
// call, settle the measured cost after. The caps live in ledger_reserve() (3,000¢ a day, +500¢ for the owner's preview use,
// 20,000¢ in total, seeded with everything spent before this API existed). A refused reserve is CONTRACT's 429 daily_limit.
// Every exchange is also one engine_calls row: the package sent and the reply received (the trace; never shown in the app).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Admission, type Ledger, SAFETY_LEDGER_KIND } from "../../engine/model/ledger.ts";
import type { ModelExchange } from "../../engine/types.ts";
import { ApiError } from "./errors.ts";
import { loadEnv } from "./env.ts";
import { serviceClient } from "./db.ts";
import { RELEASE_ID } from "./release_id.ts";

export type AiFeature = "talk" | "bridge" | "import" | "mirror";

// Kill switches (migration 0040): ai_switches.enabled=false stops every model call for that feature. Read at most every 10 s per
// instance; an unreadable table fails open (the ledger RPC would fail anyway if the database were down).
const SWITCH_TTL_MS = 10_000;
let switchCache: { at: number; off: Set<string> } | null = null;
export function resetSwitchCache() {
  switchCache = null;
}
async function featureIsOff(db: SupabaseClient, feature: AiFeature): Promise<boolean> {
  if (!switchCache || Date.now() - switchCache.at > SWITCH_TTL_MS) {
    const { data, error } = await db.from("ai_switches").select("feature").eq("enabled", false);
    if (error) return false;
    switchCache = { at: Date.now(), off: new Set((data ?? []).map((r: { feature: string }) => r.feature)) };
  }
  return switchCache.off.has(feature);
}

export interface LedgerScope {
  person: string | null;
  ownerPreview: boolean; // the owner's own preview account: +500¢ a day past the shared cap
  conversationId?: string | null;
  feature?: AiFeature; // which kill switch governs this scope; none for evals and agents
}

export class PostgresLedger implements Ledger {
  readonly #db: SupabaseClient;
  readonly #scope: LedgerScope;
  readonly #kindOverride: string | null;
  readonly ids = new Map<string, string>(); // nonce → usage_ledger.id
  readonly log: { nonce: string; action: string; cents: number; ok: boolean; error?: string }[] = [];
  lastRefusal: Record<string, unknown> | null = null;

  constructor(db: SupabaseClient, scope: LedgerScope, kindOverride: string | null = null) {
    this.#db = db;
    this.#scope = scope;
    this.#kindOverride = kindOverride;
  }

  /** A switched-off feature is refused here, before any ledger row or provider call. */
  protected async switchRefusal(nonce: string, worstCents: number): Promise<Admission | null> {
    const feature = this.#scope.feature;
    if (!feature || !(await featureIsOff(this.#db, feature))) return null;
    this.lastRefusal = { error: "ai_off", scope: feature };
    this.log.push({ nonce, action: "reserve", cents: worstCents, ok: false, error: "ai_off" });
    return { ok: false, error: "ai_off" };
  }

  async reserve(nonce: string, kind: string, worstCents: number): Promise<Admission> {
    // A safety read carries no feature kill switch: a switched-off feature must not switch the safety read off (COO 03:20Z).
    const off = kind === SAFETY_LEDGER_KIND ? null : await this.switchRefusal(nonce, worstCents);
    if (off) return off;
    const { data, error } = await this.#db.rpc("ledger_reserve", {
      p_kind: kind === SAFETY_LEDGER_KIND ? kind : this.#kindOverride ?? kind,
      p_person: this.#scope.person,
      p_worst_micros: Math.max(0, Math.ceil(worstCents)) * 10_000,
      p_owner_preview: this.#scope.ownerPreview,
    });
    if (error) {
      this.log.push({ nonce, action: "reserve", cents: worstCents, ok: false, error: error.message });
      return { ok: false, error: `ledger: ${error.message}` };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok !== true) {
      this.lastRefusal = r;
      this.log.push({
        nonce,
        action: "reserve",
        cents: worstCents,
        ok: false,
        error: String(r.error ?? "refused"),
      });
      return { ok: false, error: String(r.error ?? "refused") };
    }
    this.ids.set(nonce, String(r.id));
    this.log.push({ nonce, action: "reserve", cents: worstCents, ok: true });
    return { ok: true };
  }

  async settle(nonce: string, spentCents: number, receipt: string | null, model: string): Promise<void> {
    const id = this.ids.get(nonce);
    if (!id) return;
    const { error } = await this.#db.rpc("ledger_settle", {
      p_id: id,
      p_spent_micros: Math.round(Math.max(0, spentCents) * 10_000), // exact: a micro is 1/10,000 of a cent (0068)
      p_model: model,
      p_receipt: receipt,
      p_release: RELEASE_ID,
    });
    this.log.push({ nonce, action: "settle", cents: spentCents, ok: !error, error: error?.message });
    if (error) console.error(`ledger settle failed for ${nonce}: ${error.message}`);
  }

  /** ledger_snapshot(): utc_day, today_cents, owner_preview_cents, total_cents and the caps; `{error}` when the database is unreachable. */
  async snapshot(): Promise<Record<string, unknown>> {
    const { data, error } = await this.#db.rpc("ledger_snapshot");
    if (error) return { error: error.message };
    return (data ?? {}) as Record<string, unknown>;
  }

  /** The ApiError for the last refusal: 429 daily_limit with opens_at (next 00:00 UTC), or 503 when the ledger itself failed. */
  refusalError(scope: "talk" | "bridge" | "mirror" | "import"): ApiError {
    const r = this.lastRefusal;
    if (r && r.error === "ai_off") {
      const what = scope === "talk"
        ? "Talk can't read this just now. What you said is saved."
        : scope === "bridge"
        ? "Bridging is paused. You can send it as written."
        : "This is paused for now.";
      return new ApiError("ai_off", what, { scope });
    }
    if (r && r.error === "month_limit") {
      // Migration 0067: the monthly budget is used up. The line is true: it names the day it opens (the 1st, 00:00 UTC), never "12:00 AM".
      const d = typeof r.opens_at === "string" ? new Date(r.opens_at) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
      const day = `${d.getUTCDate()} ${d.toLocaleString("en-US", { month: "long", timeZone: "UTC" })}`;
      return new ApiError("daily_limit", `Talk opens again on ${day}.`, { opens_at: d.toISOString(), scope, limit: "month_limit" });
    }
    if (r && (r.error === "daily_limit" || r.error === "total_limit")) {
      const opensAt = typeof r.opens_at === "string" ? new Date(r.opens_at).toISOString() : nextUtcMidnight();
      return new ApiError("daily_limit", "Talk opens again at 12:00 AM.", {
        opens_at: opensAt,
        scope,
        limit: r.error,
      });
    }
    return new ApiError("unreachable", "Can't reach Presence right now.", {
      detail: this.log.at(-1)?.error ?? "ledger",
    });
  }
}

const IMPORT_DAILY_CAP_CENTS = 200;
let importAdmissionTail: Promise<void> = Promise.resolve();

/**
 * Mac-only Import admission. The database remains the source of the running UTC-day total, while
 * this process-wide queue prevents two concurrent owner imports from both passing the cap check.
 * Every accepted call still reserves and settles through the shared Postgres ledger.
 */
export class ImportLedger extends PostgresLedger {
  readonly #db: SupabaseClient;

  constructor(db: SupabaseClient, scope: LedgerScope) {
    super(db, scope, "import_ai");
    this.#db = db;
  }

  override async reserve(nonce: string, _kind: string, worstCents: number): Promise<Admission> {
    if (_kind === SAFETY_LEDGER_KIND) return super.reserve(nonce, _kind, worstCents);   // a safety read is not an import call
    const off = await this.switchRefusal(nonce, worstCents);
    if (off) return off;
    let release = () => {};
    const previous = importAdmissionTail;
    importAdmissionTail = new Promise<void>((resolve) => release = resolve);
    await previous;
    try {
      const day = new Date().toISOString().slice(0, 10);
      const { data, error } = await this.#db.from("usage_ledger")
        .select("reserved_micros,spent_micros")
        .eq("utc_day", day)
        .eq("kind", "import_ai");
      if (error) {
        this.lastRefusal = { error: "ledger", detail: error.message };
        return { ok: false, error: `ledger: ${error.message}` };
      }
      const usedCents = (data ?? []).reduce((sum, row) => {
        const micros = row.spent_micros ?? row.reserved_micros ?? 0;
        return sum + Number(micros) / 10_000;
      }, 0);
      if (usedCents + Math.max(0, Math.ceil(worstCents)) > IMPORT_DAILY_CAP_CENTS) {
        this.lastRefusal = {
          error: "daily_limit",
          scope: "import",
          opens_at: nextUtcMidnight(),
          day_used_cents: usedCents,
          day_cap_cents: IMPORT_DAILY_CAP_CENTS,
        };
        return { ok: false, error: "daily_limit" };
      }
      return await super.reserve(nonce, "import_ai", worstCents);
    } finally {
      release();
    }
  }
}

/** Q16 (a), CEO 13:15 PT 07 Nov: agent and eval spend is written under an `eval:` kind, which migration 0032 counts against its
 *  own 1,000¢ a UTC day and never against the shared 3,000¢ that live use needs. Before 0032 the kind is only a label. */
export const EVAL_KIND = { bridgeRun: "eval:bridge_run", harness: "eval:harness" } as const;

/**
 * The eval harnesses (`deno task talk|bridge`) reserve and settle here too (A59, 2026-10-27): agent spend is the rows with
 * `person = null, owner_preview = false`, kind `eval:harness`; the SQLite ledger is retired for `next/`. Needs the service
 * key from the owner's files.
 */
export async function harnessLedger(): Promise<PostgresLedger> {
  const env = await loadEnv();
  return new PostgresLedger(
    serviceClient(env),
    { person: null, ownerPreview: false, conversationId: null },
    EVAL_KIND.harness,
  );
}

export function nextUtcMidnight(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

/** One engine_calls row per model exchange. Failures here never fail the request; they are logged. */
export async function recordEngineCall(
  db: SupabaseClient,
  scope: LedgerScope,
  exchange: ModelExchange,
  ledgerId: string | null,
  ref: string | null = null,
): Promise<void> {
  const { error } = await db.from("engine_calls").insert({
    person: scope.person,
    purpose: exchange.purpose,
    model: exchange.usage.model,
    request: {
      model: exchange.request.model,
      system: exchange.request.system,
      messages: exchange.request.messages,
      maxTokens: exchange.request.maxTokens,
      cache: exchange.request.cache ?? null,
      tools: exchange.request.tools ?? null,
      thinking: exchange.request.thinking ?? null,
      effort: exchange.request.effort ?? null,
    },
    response: exchange.rawResponse,
    input_tokens: exchange.usage.inputTokens,
    output_tokens: exchange.usage.outputTokens,
    cache_creation_input_tokens: exchange.usage.cacheCreationInputTokens ?? 0,
    cache_read_input_tokens: exchange.usage.cacheReadInputTokens ?? 0,
    cents: exchange.usage.cents,
    ms: Math.round(exchange.usage.ms),
    ledger_id: ledgerId,
    conversation_id: scope.conversationId ?? null,
    error: exchange.error ?? null,
    ref,
  });
  if (error) console.error(`engine_calls row not written (${exchange.purpose}): ${error.message}`);
}
