// talk.finish (v1.79, COO 07:20Z 15 Nov, plan (a) + (c) in docs/ops/AI-COST.md): finish has its own ~25 s cap, one attempt, no label repair when the
// call already ran past 10 s, and a first failure leaves the conversation open for one retry instead of ending it with the work lost.
// A slow fake client stands in for the provider: finish at 13 s and at 30 s; Talk turns stay capped at 12 s.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { TALK_CALL_TIMEOUT_MS, TALK_FINISH_TIMEOUT_MS } from "../api/talk.ts";
import { finishFailureDisposition } from "../api/lib/talk_recovery.ts";
import type { ModelClient, ModelRequest } from "../engine/model/client.ts";
import { RecordedClient } from "../engine/model/client.ts";
import { FINISH_REPAIR_SKIP_AFTER_MS, finishSession } from "../engine/talk/finish.ts";
import { talkTurn } from "../engine/talk/turn.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import type { ModelExchange, Rating } from "../engine/types.ts";

const SAID = "I stayed late again on Friday because the new hire hadn't finished the closing list and I would rather stay than make someone scramble.";

function state(): TurnState {
  return { person: { firstName: "Marin", language: "en", about: [] }, map: { beliefs: [], consent: {}, openThreads: [] },
    session: { id: "s1", date: "2026-11-15", turns: [{ person: SAID, shown: { reflection: "", question: "", cards: [] } } as unknown as TurnState["session"]["turns"][number]] },
    previous: [], hypotheses: new Map() };
}

function reply(label: string): string {
  return JSON.stringify({ cards: [{ label, statement: "Part of you would rather carry the extra work than let someone else be caught short.", type: "a rule I live by", level: "L1",
    domains: ["work"], confidence: 0.8, receipts: ["I would rather stay than make someone scramble"], mergedFrom: [], mapId: null, tensionWith: null, links: [] }],
    summary: "You spoke about covering for others at work.", nextTime: "The walk home seemed worth more words.", openThreads: [] });
}

/** A provider that answers after `ms` (reported in usage.ms; no real sleeping) or times out at the cap it was given. */
class SlowClient implements ModelClient {
  calls: string[] = [];
  constructor(private readonly ms: number, private readonly replies: Record<string, string>, private readonly capMs: number) {}
  complete(req: ModelRequest): Promise<ModelExchange> {
    this.calls.push(req.purpose);
    const timedOut = this.ms >= this.capMs;
    const raw = timedOut ? "" : (this.replies[req.purpose] ?? "");
    return Promise.resolve({ purpose: req.purpose, request: { model: "recorded", system: req.system, messages: req.messages, maxTokens: req.maxTokens }, rawResponse: raw,
      error: timedOut ? "timeout" : undefined,
      usage: { model: "recorded", inputTokens: 0, outputTokens: timedOut ? 0 : 1200, cents: 0, ms: timedOut ? this.capMs : this.ms } });
  }
}

Deno.test("caps: finish has its own 25 s cap, Talk turns stay at 12 s, and finish plus persistence fits the 30 s client contract", () => {
  assertEquals(TALK_CALL_TIMEOUT_MS, 12_000);
  assertEquals(TALK_FINISH_TIMEOUT_MS, 25_000);
  assert(TALK_FINISH_TIMEOUT_MS + 3_000 <= 30_000);
});

Deno.test("a finish that takes 13 s (past the old 12 s cap, inside the new one) succeeds with one call", async () => {
  const client = new SlowClient(13_000, { finish: reply("Covering gaps") }, TALK_FINISH_TIMEOUT_MS);
  const f = await finishSession(client, state(), new Map<string, Rating>());
  assertEquals(f.failed, null);
  assertEquals(client.calls, ["finish"]);
  assertEquals(f.cards.map((c) => c.label), ["Covering gaps"]);
  assertEquals(finishFailureDisposition({ failed: f.failed, exchanges: [f.exchange, f.repairExchange], priorFinishCalls: 0 }), "none");
});

Deno.test("a slow finish with an incomplete label makes no repair call: the card is dropped and the check says why", async () => {
  const long = "Being the one who needs everything";
  const slow = new SlowClient(FINISH_REPAIR_SKIP_AFTER_MS + 1_000, { finish: reply(long), finish_repair: reply("Needing") }, TALK_FINISH_TIMEOUT_MS);
  const f = await finishSession(slow, state(), new Map());
  assertEquals(slow.calls, ["finish"]);
  assertEquals(f.cards, []);
  assert(f.checks.some((c) => c.name === "label_rename:0" && !c.ok && c.detail.includes("rename skipped")), JSON.stringify(f.checks));
  // The same reply from a fast provider still gets its one rename, as before.
  const fast = new SlowClient(4_000, { finish: reply(long), finish_repair: reply("Needing") }, TALK_FINISH_TIMEOUT_MS);
  const g = await finishSession(fast, state(), new Map());
  assertEquals(fast.calls, ["finish", "finish_repair"]);
  assertEquals(g.cards.map((c) => c.label), ["Needing"]);
});

Deno.test("a finish that runs to 30 s is cut at the 25 s cap: one attempt, failed 'timeout', the first failure is a retry, the second ends it", async () => {
  const client = new SlowClient(30_000, { finish: reply("Covering gaps") }, TALK_FINISH_TIMEOUT_MS);
  const f = await finishSession(client, state(), new Map());
  assertEquals(client.calls, ["finish"]);                                   // one attempt, no repair
  assertEquals(f.exchange?.usage.ms, TALK_FINISH_TIMEOUT_MS);
  assertEquals(f.failed, "timeout");
  const ex = [f.exchange, f.repairExchange];
  assertEquals(finishFailureDisposition({ failed: f.failed, exchanges: ex, priorFinishCalls: 0 }), "retry");
  assertEquals(finishFailureDisposition({ failed: f.failed, exchanges: ex, priorFinishCalls: 1 }), "give_up");
});

Deno.test("finish dispositions: empty session and success are none; a ledger refusal is budget on any attempt; other failures follow the retry count", () => {
  assertEquals(finishFailureDisposition({ failed: null, exchanges: [null, null], priorFinishCalls: 0 }), "none");
  assertEquals(finishFailureDisposition({ failed: "empty session", exchanges: [null, null], priorFinishCalls: 0 }), "none");
  const refused = { error: "budget_unavailable: daily" };
  assertEquals(finishFailureDisposition({ failed: "budget_unavailable: daily", exchanges: [refused, null], priorFinishCalls: 0 }), "budget");
  assertEquals(finishFailureDisposition({ failed: "budget_unavailable: daily", exchanges: [refused, null], priorFinishCalls: 3 }), "budget");
  assertEquals(finishFailureDisposition({ failed: "reply cut off at 4000 output tokens", exchanges: [{}, null], priorFinishCalls: 0 }), "retry");
  assertEquals(finishFailureDisposition({ failed: "no readable reply: x", exchanges: [{}, null], priorFinishCalls: 2 }), "give_up");
});

Deno.test("Talk turns still time out at 12 s into the safe thread line (the finish cap does not touch them)", async () => {
  const client = new SlowClient(TALK_CALL_TIMEOUT_MS + 1, {}, TALK_CALL_TIMEOUT_MS);
  const t = await talkTurn(client, { ...state(), session: { id: "s2", date: "2026-11-15", turns: [] } }, SAID);
  assert(t.failed !== null || t.fallback, "a timed-out turn falls back, it does not wait for the finish cap");
  assert(client.calls.length > 0 && client.calls.every((c) => c === "safety" || c.startsWith("turn") || c.startsWith("repair")), client.calls.join(","));
});

void RecordedClient;
