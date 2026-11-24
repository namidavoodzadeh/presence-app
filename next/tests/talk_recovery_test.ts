import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { turnFailureDisposition } from "../api/lib/talk_recovery.ts";
import type { ModelClient, ModelRequest } from "../engine/model/client.ts";
import { talkTurn, THREAD_LINE } from "../engine/talk/turn.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import type { ModelExchange } from "../engine/types.ts";

function failedExchange(req: ModelRequest, error: string): ModelExchange {
  return {
    purpose: req.purpose,
    request: { ...req, model: req.model ?? "recorded" },
    rawResponse: "",
    error,
    usage: {
      model: "recorded",
      inputTokens: 0,
      outputTokens: 0,
      cents: 0,
      ms: 12_000,
    },
  };
}

class FailedClient implements ModelClient {
  defaultModel = "recorded";
  calls = 0;

  constructor(private readonly error: string) {}

  complete(req: ModelRequest): Promise<ModelExchange> {
    if (req.purpose !== "safety") this.calls++; // QA-B336: the semantic safety check fails the same way and is counted separately
    return Promise.resolve(failedExchange(req, this.error));
  }
}

function freshState(): TurnState {
  return {
    person: { firstName: "Fictional", language: "en", about: [] },
    map: { beliefs: [], consent: {}, openThreads: [] },
    session: { id: "s1", date: "2026-10-28", turns: [] },
    previous: [],
    hypotheses: new Map(),
  };
}

Deno.test("QA-B3: two provider timeouts retry once, then persist the safe Talk fallback", async () => {
  const client = new FailedClient("timeout");
  const trace = await talkTurn(client, freshState(), "A fictional decision felt difficult.");

  assertEquals(client.calls, 2);
  assertStringIncludes(trace.failed ?? "", "timeout");
  assertEquals(trace.fallback, true);
  assertEquals(trace.shown.question, THREAD_LINE);
  assertEquals(turnFailureDisposition(trace), "safe_fallback");
});

Deno.test("QA-B3: a provider network failure is a safe fallback, while a ledger refusal stays the daily limit", async () => {
  const network = await talkTurn(
    new FailedClient("network: connection reset"),
    freshState(),
    "A fictional choice is on my mind.",
  );
  assertEquals(turnFailureDisposition(network), "safe_fallback");

  const budget = await talkTurn(
    new FailedClient("budget_unavailable: daily cap"),
    freshState(),
    "A fictional choice is on my mind.",
  );
  assertEquals(turnFailureDisposition(budget), "budget");
});
