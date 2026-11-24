// PSY 19 Nov 1b: a Haiku reader judges the item's own words. Its answer can only
// exclude. A missing, malformed, or provider answer is sensitive: public card exposure fails closed.
import type { Ctx } from "./router.ts";
import { clientFor, scopeFor } from "../bridge_engine.ts";
import { PostgresLedger, recordEngineCall } from "./ledger.ts";
import type { ModelClient } from "../../engine/model/client.ts";
import { extractJson } from "../../engine/model/client.ts";
import type { ModelExchange } from "../../engine/types.ts";
import type { EligibilityItem } from "./card_eligibility.ts";

export const CARD_READER_MODEL = "claude-haiku-5-5";
export const CARD_READER_PROMPT = `You are a private eligibility reader. Does this item's wording name or point to health or mental health, diagnosis, medication, substance use, sex, orientation or gender identity, pregnancy/fertility, immigration, a legal matter, abuse/violence, another person by name, a child, or a workplace secret? Return JSON only: {"sensitive":true|false}. When uncertain, true.`;

export async function wordingHash(words: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(words));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Exported for the fake-provider regression check. Invalid, failed, or refused reads are sensitive. */
export async function readerSaysSensitive(client: ModelClient, words: string, seen?: (exchange: ModelExchange) => Promise<void>): Promise<boolean> {
  return (await readSensitivity(client, words, seen)).sensitive;
}

/**
 * A failed reading must fail closed for the request that made it, but is not a
 * finding about the wording and therefore must never be persisted as one.
 */
async function readSensitivity(
  client: ModelClient,
  words: string,
  seen?: (exchange: ModelExchange) => Promise<void>,
): Promise<{ ok: boolean; sensitive: boolean }> {
  try {
    const exchange = await client.complete({ purpose: "card_eligibility", system: CARD_READER_PROMPT,
      messages: [{ role: "user", content: words }], maxTokens: 40, model: CARD_READER_MODEL, thinking: "disabled", effort: null });
    if (seen) await seen(exchange);
    if (exchange.error || exchange.usage.stopReason === "refusal") return { ok: false, sensitive: true };
    const parsed = extractJson(exchange.rawResponse) as Record<string, unknown>;
    if (typeof parsed.sensitive !== "boolean") return { ok: false, sensitive: true };
    return { ok: true, sensitive: parsed.sensitive };
  } catch { return { ok: false, sensitive: true }; }
}

/** Uses a wording-hash cache on the belief row. The cached value never grants eligibility; policy still runs. */
export async function readEligibility(ctx: Ctx, row: Record<string, unknown>, item: EligibilityItem): Promise<EligibilityItem> {
  const hash = await wordingHash(item.wording);
  if (row.card_eligibility_wording_hash === hash && typeof row.card_eligibility_sensitive === "boolean") {
    return { ...item, readerSensitive: row.card_eligibility_sensitive };
  }
  let read = { ok: false, sensitive: true };
  try {
    const ledger = new PostgresLedger(ctx.service, scopeFor(ctx));
    read = await readSensitivity(clientFor(ctx, ledger, "insight"), item.wording, async (exchange) => {
      await recordEngineCall(ctx.service, scopeFor(ctx), exchange, [...ledger.ids.values()][0] ?? null, null);
    });
  } catch { read = { ok: false, sensitive: true }; }
  if (read.ok) {
    try {
      const { error } = await ctx.service.from("beliefs")
        .update({ card_eligibility_wording_hash: hash, card_eligibility_sensitive: read.sensitive })
        .eq("id", item.id).eq("owner", ctx.caller!.id);
      if (error) read = { ok: false, sensitive: true };
    } catch { read = { ok: false, sensitive: true }; }
  }
  return { ...item, readerSensitive: read.sensitive };
}
