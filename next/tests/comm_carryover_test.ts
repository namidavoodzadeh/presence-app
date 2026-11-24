// Spec 4.7 carry-over: request shapes, answer parsing, the plan, the confirm step, and that sharing never widens. $0, no model call.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildBatchRequests, CARRY_OVER_KINDS, CARRY_OVER_MODEL, CARRY_OVER_SYSTEM, carryOverProblems, confirmedItem, type ExistingKenning,
  type ModelAnswer, nextToConfirm, parseBatchLine, parseModelAnswer, PLACEHOLDER, planCarryOver,
} from "../engine/comm_carryover.ts";
import { COMM_NEVER_ON_SCREEN } from "../engine/comm_checks.ts";

const K = (id: string, wording: string, o: Partial<ExistingKenning> = {}): ExistingKenning => ({ id, wording, grantedTo: [], ...o });
const items: ExistingKenning[] = [
  K("a", "I go quiet when I'm tired, it doesn't mean I'm upset.", { grantedTo: ["jan"] }),
  K("b", "I feel looked after when someone texts to say they got home.", { grantedTo: ["jan", "mum"] }),
  K("c", "Being honest matters more to me than being liked.", { oldTopic: "morality" }),
  K("d", "Jan never listens to me."),
  K("e", "I want to end it all."),
  K("f", "Already done.", { commKind: "matters" }),
  K("g", "It's hard for me to hear that I'm too much.", {}),
  K("h", "I like quiet mornings.", {}),
];
const ans = (kind: ModelAnswer["kind"], confidence: number, topic: string | null = null): ModelAnswer => ({ kind, confidence, topic });
const answers = new Map<string, ModelAnswer | null>([
  ["a", ans("how_i_mean", 0.9)], ["b", ans("feels_like_care", 0.8)], ["c", ans("matters", 0.85)], ["d", ans("how_i_mean", 0.9)],
  ["g", ans("how_i_mean", 0.95)], ["h", ans("other", 0.9)],
]);

Deno.test("the request carries only the person's wording and the item id; the system prompt is cached; risky wording is never sent", () => {
  const reqs = buildBatchRequests(items);
  assertEquals(reqs.map((r) => r.custom_id), ["a", "b", "c", "d", "g", "h"]);   // e (safety floor) and f (done) are not sent
  for (const r of reqs) {
    assertEquals(r.params.model, CARRY_OVER_MODEL);
    assertEquals(r.params.messages.length, 1);
    assertEquals(r.params.system[0].cache_control.type, "ephemeral");
    assertEquals(r.params.messages[0].content, items.find((k) => k.id === r.custom_id)!.wording.trim());   // wording only: no grants, topic or dates
  }
  assertEquals(reqs[0].params.messages[0].content, items[0].wording);
  assert(!CARRY_OVER_SYSTEM.includes("lands_hard") && !CARRY_OVER_SYSTEM.includes("this_week"), "the model is never offered the two never-inferred kinds");
  for (const w of COMM_NEVER_ON_SCREEN) assert(!new RegExp(`\\b${w}\\b`, "i").test(CARRY_OVER_SYSTEM), w);
});
Deno.test("carry-over may suggest neither lands_hard nor this_week", () => {
  assertEquals(CARRY_OVER_KINDS.includes("lands_hard"), false);
  assertEquals(CARRY_OVER_KINDS.includes("this_week"), false);
  assertEquals(parseModelAnswer('{"kind":"lands_hard","confidence":0.99,"topic":null}'), null);
  assertEquals(parseModelAnswer('{"kind":"this_week","confidence":0.99,"topic":null}'), null);
});
Deno.test("parse: tolerant of wrapping text, strict on the closed lists", () => {
  assertEquals(parseModelAnswer('Sure: {"kind":"matters","confidence":0.8,"topic":"work"}'), { kind: "matters", confidence: 0.8, topic: "work" });
  assertEquals(parseModelAnswer('{"kind":"matters","confidence":7,"topic":"astrology"}'), { kind: "matters", confidence: 1, topic: null });
  assertEquals(parseModelAnswer('{"kind":"bring_up"}'), { kind: "bring_up", confidence: 0, topic: null });
  assertEquals(parseModelAnswer("no json"), null);
  assertEquals(parseModelAnswer('{"kind":"flooding","confidence":1}'), null);
  assertEquals(parseModelAnswer("{broken"), null);
});
Deno.test("batch result lines: succeeded gives an answer, errored or expired gives none, junk is skipped", () => {
  const ok = JSON.stringify({ custom_id: "a", result: { type: "succeeded", message: { content: [{ type: "text", text: '{"kind":"how_i_mean","confidence":0.9,"topic":null}' }] } } });
  assertEquals(parseBatchLine(ok), { id: "a", answer: { kind: "how_i_mean", confidence: 0.9, topic: null } });
  assertEquals(parseBatchLine(JSON.stringify({ custom_id: "b", result: { type: "errored" } })), { id: "b", answer: null });
  assertEquals(parseBatchLine(JSON.stringify({ custom_id: "c", result: { type: "expired" } })), { id: "c", answer: null });
  assertEquals(parseBatchLine("not json"), null);
  assertEquals(parseBatchLine("{}"), null);
});
Deno.test("plan: every row starts under Other and private; checks 4.3 apply; below 0.7, about-the-other, safety and 'other' give no suggestion", () => {
  const rows = planCarryOver(items, answers);
  assertEquals(rows.map((r) => r.id), ["a", "b", "c", "d", "e", "g", "h"]);   // f already carried over
  for (const r of rows) assertEquals(r.placeholder, PLACEHOLDER);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assertEquals(by.a.suggestion?.kind, "how_i_mean");
  assertEquals(by.c.suggestion, { kind: "matters", confidence: 0.85, topic: "morality" });   // the old topic survives as the tag, only on matters
  assertEquals(by.d.suggestion, null); assertEquals(by.d.skipped, "check_offer_i_statement");
  assertEquals(by.e.suggestion, null); assertEquals(by.e.skipped, "safety_floor");
  assertEquals(by.h.suggestion, null); assertEquals(by.h.skipped, "model_chose_other");
  const low = planCarryOver([items[0]], new Map([["a", ans("how_i_mean", 0.69)]]));
  assertEquals(low[0].suggestion, null); assertEquals(low[0].skipped, "check_keep_listening");
  assertEquals(planCarryOver([items[0]], new Map())[0].skipped, "no_answer");
  assertEquals(carryOverProblems(items, rows), []);
});
Deno.test("a topic goes only on matters, and only from the closed list", () => {
  const rows = planCarryOver([K("x", "I feel looked after when we eat together.", { oldTopic: "family" }), K("y", "I value hard work.", { oldTopic: "astrology" })],
    new Map([["x", ans("feels_like_care", 0.9, "family")], ["y", ans("matters", 0.9)]]));
  assertEquals(rows[0].suggestion?.topic, null);
  assertEquals(rows[1].suggestion?.topic, null);
});
Deno.test("the next few: strongest first, then oldest, three by default, none when nothing is left", () => {
  const rows = planCarryOver(items, answers);
  assertEquals(nextToConfirm(rows).map((r) => r.id), ["g", "a", "c"].filter((id) => rows.find((r) => r.id === id)?.suggestion));
  assertEquals(nextToConfirm(rows, 1).length, 1);
  assertEquals(nextToConfirm(rows, 0), []);
  assertEquals(nextToConfirm(rows.map((r) => ({ ...r, suggestion: null }))), []);
});
Deno.test("confirm: sharing never widens (one grantee = that person; none or several = private to the comm model, legacy grants carry on)", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const s = { kind: "how_i_mean" as const, confidence: 0.9, topic: null };
  const one = confirmedItem(items[0], s, now);
  assertEquals([one.scopeType, one.scopeValue, one.status], ["person", "jan", "active"]);
  assertEquals(one.lastConfirmedAt, now.toISOString());
  const two = confirmedItem(items[1], { ...s, kind: "feels_like_care" }, now);
  assertEquals([two.scopeType, two.scopeValue, two.status], ["everyone", null, "private_only"]);
  const none = confirmedItem(items[2], { kind: "matters", confidence: 0.9, topic: "morality" }, now);
  assertEquals([none.scopeType, none.status, none.topic], ["everyone", "private_only", "morality"]);
  // gets_heated to one person stays valid (person scope); to nobody it is private.
  const heated = confirmedItem(items[0], { ...s, kind: "gets_heated" }, now);
  assertEquals(heated.scopeType, "person");
});
Deno.test("the wording is never touched and the job's own invariants hold on a wide mix", () => {
  const before = JSON.stringify(items);
  const rows = planCarryOver(items, answers);
  assertEquals(JSON.stringify(items), before);
  assert(!JSON.stringify(rows).includes("quiet when I'm tired"), "rows carry ids and codes, not the person's words");
  // Tamper: a row that suggests lands_hard or sits below the bar is reported.
  const bad = rows.map((r) => r.id === "a" ? { ...r, suggestion: { kind: "lands_hard" as const, confidence: 0.5, topic: null } } : r);
  const p = carryOverProblems(items, bad);
  assert(p.some((x) => x.includes("inferred lands_hard")) && p.some((x) => x.includes("below the bar")), p.join("; "));
});
