// The model-usage numbers the re-smoke is judged on (A47(2): no truncation, no repair for length; A48 Q48(a): block types and
// output tokens per call), and the run-stopping errors (NEXT-ENGINE §1: a refusal stops the run; a rejected request shape would
// repeat on every later call), both on hand-built traces so no model is needed.

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { confidenceLine, confidenceSummary, confidenceTotals, usageRows, usageTotals } from "../engine/harness/report.ts";
import { fatalApiError, roomForTurn, TYPICAL_FINISH_CENTS, TYPICAL_TURN_CENTS } from "../engine/harness/run_talk.ts";
import type { ConversationTrace, ConversationTurn } from "../engine/harness/trace.ts";
import type { TurnTrace } from "../engine/talk/turn.ts";
import type { ModelExchange } from "../engine/types.ts";

function exchange(purpose: string, out: number, max: number, blocks: string[], stop: string, error?: string): ModelExchange {
  return { purpose, request: { model: "m", system: "", messages: [], maxTokens: max }, rawResponse: error ? "" : "{}",
    usage: { model: "m", inputTokens: 1000, outputTokens: out, cents: 2, ms: 1500, stopReason: stop, blocks }, ...(error ? { error } : {}) };
}

function engine(turn: number, exchanges: ModelExchange[], repaired: boolean, failed: string | null): TurnTrace {
  return { turn, person: "said", floor: { risk: "none", reason: "" }, exchanges, repaired, failed, warnings: [], fallback: false, cents: 0, ms: 0, checks: [], parsed: null,
    shown: { state: "turn", cards: [] }, hypotheses: [] };
}

function row(turn: number, sim: ModelExchange | null, simFailed: string | null, eng: TurnTrace | null): ConversationTurn {
  return { turn, sim: { message: simFailed ? "" : "said", ratings: {}, permission: null, note: "", failed: simFailed, exchange: sim }, engine: eng, ratingsApplied: {}, cents: 0, ms: 0 };
}

function trace(turns: ConversationTurn[], stoppedBy: ConversationTrace["stoppedBy"], finish: ModelExchange | null): ConversationTrace {
  const empty = { beliefs: [], consent: {}, openThreads: [] };
  return { id: "c1", personaId: "p", personaName: "Pat Example", style: "plain", kind: "normal", sessionNumber: 1, startedAt: "", model: "m", opener: null, turns,
    finish: finish ? { exchange: finish, repairExchange: null, checks: [], cards: [], summary: "", nextTime: "", openThreads: [], reconciled: { newReceipts: [], tensions: [], added: [], changed: [] }, failed: null, cents: 0 } : null,
    riskStop: null, session: { id: "s1", date: "2026-10-26", turns: [] }, mapBefore: empty, mapAfter: empty, stoppedBy, cents: 0, ms: 0, targets: [] };
}

Deno.test("usage: one row per call in order; cut-off replies, thinking blocks, repairs and output per engine call are counted", () => {
  const t = trace([
    row(1, exchange("sim_user", 200, 500, ["text"], "end_turn"), null, engine(1, [exchange("turn", 2500, 2500, ["thinking", "text"], "max_tokens"), exchange("repair", 400, 2500, ["text"], "end_turn")], true, null)),
    row(2, exchange("sim_user", 150, 500, ["text"], "end_turn"), null, engine(2, [exchange("turn", 350, 2500, ["text"], "end_turn")], false, null)),
  ], "turns", exchange("finish", 900, 4000, ["text"], "end_turn"));
  const rows = usageRows(t);
  assertEquals(rows.map((r) => `${r.turn}:${r.purpose}`), ["1:sim_user", "1:turn", "1:repair", "2:sim_user", "2:turn", "finish:finish"]);
  assertEquals(rows[1].blocks, "thinking+text");
  const u = usageTotals(t);
  assertEquals(u.calls, 6);
  assertEquals(u.cutOff, 1);
  assertEquals(u.thinking, 1);
  assertEquals(u.repairs, 1);
  assertEquals(u.outputTokens, 200 + 2500 + 400 + 150 + 350 + 900);
  assertEquals(u.outputPerEngineCall, Math.round((2500 + 400 + 350 + 900) / 4));
});

Deno.test("usage: a reply that filled its limit with no stop reason recorded still counts as cut off", () => {
  const t = trace([row(1, null, null, engine(1, [exchange("turn", 2500, 2500, [], "")], false, null))], "turns", null);
  assertEquals(usageTotals(t).cutOff, 1);
  assertEquals(usageTotals(t).calls, 1);
});

Deno.test("fatal: the API rejecting the request shape on the simulated user stops the run and names the error", () => {
  const err = "invalid_request_error 400: thinking.type: between_tools is not supported";
  const t = trace([row(1, exchange("sim_user", 0, 500, [], "", err), err, null)], "sim_failed", null);
  assertStringIncludes(fatalApiError(t) ?? "", "invalid_request_error 400");
});

Deno.test("fatal: a ledger refusal on the engine call stops the run (NEXT-ENGINE §1)", () => {
  const err = "budget_unavailable: daily cap";
  const t = trace([row(1, exchange("sim_user", 100, 500, ["text"], "end_turn"), null, engine(1, [exchange("turn", 0, 2500, [], "", err)], false, `no readable reply: ${err}`))], "engine_failed", null);
  assertStringIncludes(fatalApiError(t) ?? "", "budget_unavailable");
});

Deno.test("fatal: a network failure, a timeout or an ordinary failed check never stops the run", () => {
  const net = trace([row(1, exchange("sim_user", 0, 500, [], "", "network: connection reset"), "network: connection reset", null)], "sim_failed", null);
  assertEquals(fatalApiError(net), null);
  const timeout = trace([row(1, exchange("sim_user", 0, 500, [], "", "timeout"), "timeout", null)], "sim_failed", null);
  assertEquals(fatalApiError(timeout), null);
  const checks = trace([row(1, exchange("sim_user", 100, 500, ["text"], "end_turn"), null, engine(1, [exchange("turn", 300, 2500, ["text"], "end_turn")], true, "checks still failing after repair"))], "engine_failed", null);
  assertEquals(fatalApiError(checks), null);
  const fine = trace([row(1, exchange("sim_user", 100, 500, ["text"], "end_turn"), null, engine(1, [exchange("turn", 300, 2500, ["text"], "end_turn")], false, null))], "turns", null);
  assertEquals(fatalApiError(fine), null);
});

Deno.test("refusal rule: request-shape, auth and budget errors repeat; network, timeout, overload and empty do not", async () => {
  const { repeatingRefusal } = await import("../engine/model/client.ts");
  for (const e of ["invalid_request_error 400: thinking", "authentication_error 401: bad key", "permission_error 403: workspace", "budget_unavailable: daily cap", "no readable reply: budget_unavailable"]) assertEquals(repeatingRefusal(e), true, e);
  for (const e of ["network: reset", "timeout", "overloaded_error 529: busy", "api_error 500", "checks still failing after repair", "", undefined, null]) assertEquals(repeatingRefusal(e), false, String(e));
});

Deno.test("bridge usage: one row per call; the analysis repair and later rewrite attempts count as repairs", async () => {
  const { draftUsageRows, draftUsageTotals } = await import("../engine/harness/report_bridge.ts");
  const t = { exchanges: [exchange("analyse", 700, 2000, ["text"], "end_turn"), exchange("repair", 500, 2000, ["text"], "end_turn"), exchange("rewrite", 2000, 2000, ["thinking", "text"], "max_tokens"),
    exchange("rewrite", 400, 2000, ["text"], "end_turn"), exchange("verify", 200, 1000, ["text"], "end_turn")], analysisRepaired: true, attempts: [{}, {}] } as unknown as import("../engine/bridge/types.ts").BridgeTrace;
  assertEquals(draftUsageRows(t).map((r) => `${r.turn}:${r.purpose}`), ["1:analyse", "2:repair", "3:rewrite", "4:rewrite", "5:verify"]);
  const u = draftUsageTotals(t);
  assertEquals([u.calls, u.cutOff, u.thinking, u.repairs, u.outputPerEngineCall], [5, 1, 1, 2, Math.round((700 + 500 + 2000 + 400 + 200) / 5)]);
});

Deno.test("confidence: the distribution counts every proposal by band and a belief once at its highest confidence (A48 Q48(c) → ii)", () => {
  const h = (id: string, confidence: number) => ({ id, label: id, statement: `You may ${id}.`, type: "a rule I live by" as const, level: "L1" as const, domains: ["work" as const], confidence, receipt: "said", links: [] });
  const e1 = engine(1, [exchange("turn", 300, 2500, ["text"], "end_turn")], false, null); e1.hypotheses = [h("record", 0.3), h("pace", 0.5)];
  const e2 = engine(2, [exchange("turn", 300, 2500, ["text"], "end_turn")], false, null); e2.hypotheses = [h("record", 0.65), h("pace", 0.75)];
  const e3 = engine(3, [exchange("turn", 300, 2500, ["text"], "end_turn")], false, null); e3.hypotheses = [h("record", 0.72)];
  const t = trace([row(1, null, null, e1), row(2, null, null, e2), row(3, null, null, e3)], "turns", null);
  const c = confidenceSummary(t);
  assertEquals(c, { proposals: 5, under50: 1, from50to69: 2, from70: 2, beliefs: 2, beliefsAt70: 2, max: 0.75 });
  assertStringIncludes(confidenceLine(c), "2 of 2 belief(s) reached the 0.7 card line");
  const quiet = trace([row(1, null, null, (() => { const e = engine(1, [], false, null); e.hypotheses = [h("keep", 0.4), h("keep", 0.6)]; return e; })())], "turns", null);
  assertEquals(confidenceSummary(quiet).beliefsAt70, 0);
  const all = confidenceTotals([c, confidenceSummary(quiet)]);
  assertEquals([all.proposals, all.beliefs, all.beliefsAt70, all.max], [7, 3, 2, 0.75]);
  assertEquals(confidenceSummary(trace([], "turns", null)), { proposals: 0, under50: 0, from50to69: 0, from70: 0, beliefs: 0, beliefsAt70: 0, max: 0 });
});

Deno.test("budget guard: a 15¢ re-smoke starts, runs while the measured average plus Finish fits, and stops before the cap is passed", () => {
  assertEquals(roomForTurn({ cap: 15, spent: 0 }, []), true);                       // before any turn: the smoke's measured numbers
  assertEquals(roomForTurn({ cap: TYPICAL_TURN_CENTS + TYPICAL_FINISH_CENTS - 1, spent: 0 }, []), false);
  assertEquals(roomForTurn({ cap: 15, spent: 6 }, [3, 3]), true);                   // 6 + 3 + 4 = 13
  assertEquals(roomForTurn({ cap: 15, spent: 9 }, [3, 3, 3]), false);               // 9 + 3 + 4 = 16: the cap would not hold for Finish
  assertEquals(roomForTurn({ cap: 15, spent: 7 }, [7]), false);                     // a repaired first turn at 7¢: 7 + 7 + 4 = 18
  assertEquals(roomForTurn({ cap: 15, spent: 0 }, [0, 0]), true);                   // measured 0 (fake) still counts at least 1¢ a turn
});
