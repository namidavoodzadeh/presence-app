// Law 8, spec safety-stop.md B, C, I (K-0003): the three-label classifier. One short call, pinned Haiku, JSON only. The prompt is
// prompt.md beside this file. No temperature is sent: the API refuses one on claude-haiku-5-5 (400, checked 15 Nov), and the
// client has no field for it; the prompt and a single JSON answer keep it as repeatable as the model allows. The text is never logged.
import { SAFETY_CLASSIFIER } from "../../../engine/prompt_text.ts";
import type { ModelExchange } from "../../../engine/types.ts";
import type { ModelClient } from "../../../engine/model/client.ts";
import { extractJson } from "../../../engine/model/client.ts";
import { semanticThinking } from "../../../engine/safety_semantic.ts";

export const CLASSIFIER_MODEL = "claude-haiku-5-5";
export const CLASSIFIER_VERSION = "k0003-v1";
export const CLASSIFIER_MAX_TOKENS = 80;
export const CLASSIFIER_PURPOSE = "safety";
export const CLASSIFIER_PROMPT = SAFETY_CLASSIFIER.trim();

export type Label = "STOP" | "CHECK" | "PASS";
export type Target = "self" | "other" | "none";
export interface Classification { label: Label; target: Target; reason: string }
export interface ClassifierOptions { signal?: AbortSignal }

/** Strict read of the reply. Anything that is not a valid label is unreadable (null), never PASS. */
export function readClassification(raw: string): Classification | null {
  let parsed: unknown;
  try { parsed = extractJson(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const label = typeof o.label === "string" ? o.label.trim().toUpperCase() : "";
  if (label !== "STOP" && label !== "CHECK" && label !== "PASS") return null;
  const t = typeof o.target === "string" ? o.target.trim().toLowerCase() : "none";
  const target: Target = t === "self" || t === "other" ? t : "none";
  const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 80) : "";
  // A STOP with no target is read as self: the more careful sheet. A PASS carries no target.
  return { label, target: label === "PASS" ? "none" : label === "STOP" && target === "none" ? "self" : target, reason };
}

/** One call. Returns null when no answer could be read (error, refusal-less empty, bad JSON): the gate treats that as a failed try. */
export async function classify(client: ModelClient, text: string, priorTurns: string[] = []): Promise<Classification | null> {
  return (await classifyExchange(client, text, priorTurns)).classification;
}

export async function classifyExchange(client: ModelClient, text: string, priorTurns: string[] = [], options: ClassifierOptions = {}): Promise<{ classification: Classification | null; exchange: ModelExchange | null }> {
  const context = priorTurns.length ? `EARLIER TURNS (only to resolve references):\n${priorTurns.slice(-4).join("\n")}\n\n` : "";
  let exchange: ModelExchange;
  try {
    exchange = await client.complete({
      purpose: CLASSIFIER_PURPOSE, system: CLASSIFIER_PROMPT, messages: [{ role: "user", content: `${context}MESSAGE:\n${text}` }],
      maxTokens: CLASSIFIER_MAX_TOKENS, model: CLASSIFIER_MODEL, thinking: semanticThinking(CLASSIFIER_MODEL), effort: null,
    }, options.signal ? { signal: options.signal } : undefined);
  } catch { return { classification: null, exchange: null }; }
  // A reader that refused the message is a stop, not an outage (PSY 16 Nov 2b).
  if (exchange.usage.stopReason === "refusal") return { classification: { label: "STOP", target: "self", reason: "reader declined" }, exchange };
  if (exchange.error && !exchange.rawResponse) return { classification: null, exchange };
  return { classification: readClassification(exchange.rawResponse), exchange };
}
