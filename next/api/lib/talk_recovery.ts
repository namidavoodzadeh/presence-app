import type { TurnTrace } from "../../engine/talk/turn.ts";

/**
 * A ledger refusal is the only model-side Talk failure that remains an API error.
 * Every other exhausted retry already carries talkTurn's safe thread-line and can
 * be persisted as an ordinary reply (DIRECTOR: retry, then safe fallback).
 */
export function turnFailureDisposition(
  trace: Pick<TurnTrace, "failed" | "exchanges">,
): "budget" | "safe_fallback" | "none" {
  if (!trace.failed) return "none";
  return trace.exchanges.some((exchange) => exchange.error?.startsWith("budget_unavailable"))
    ? "budget"
    : "safe_fallback";
}

/**
 * Finish failed (timeout, unreadable or cut-off reply). The first failure since the person last talked is "retry": the conversation stays
 * open, nothing is marked finished or lost, and the same request again is the one retry. A second failure is "give_up" (the conversation
 * ends with a null summary, as before). A ledger refusal is "budget" and keeps its own path; an empty session is "none".
 */
export function finishFailureDisposition(
  input: { failed: string | null; exchanges: ({ error?: string } | null)[]; priorFinishCalls: number },
): "none" | "budget" | "retry" | "give_up" {
  if (!input.failed || input.failed === "empty session") return "none";
  if (input.exchanges.some((exchange) => exchange?.error?.startsWith("budget_unavailable"))) return "budget";
  return input.priorFinishCalls === 0 ? "retry" : "give_up";
}
