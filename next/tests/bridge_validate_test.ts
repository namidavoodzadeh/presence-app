// E27 stability (CEO 13:15 PT 07 Nov): the code validators after the analysis. $0, no model: a scripted client stands in.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { analyse, checkAnalysis } from "../engine/bridge/analyse.ts";
import { buildHighlights, summaryLine, youWhy } from "../engine/bridge/highlights.ts";
import { INSIGHT_COPY } from "../engine/bridge/insight.ts";
import { engineTermsIn, kindHolds, kindViolations } from "../engine/bridge/validate.ts";
import { loadGolden } from "../evals/bridge_golden.ts";
import { engineTerms } from "../evals/bridge_golden.ts";
import type { ModelExchange } from "../engine/types.ts";
import type { ModelClient, ModelRequest } from "../engine/model/client.ts";
import type { Analysis, FrictionKind, InsightFriction } from "../engine/bridge/types.ts";
import type { BeliefTouches } from "../engine/bridge/touches.ts";

class Scripted implements ModelClient {
  calls: string[] = [];
  constructor(private replies: unknown[]) {}
  complete(req: ModelRequest): Promise<ModelExchange> {
    this.calls.push(req.purpose);
    const raw = JSON.stringify(this.replies[this.calls.length - 1] ?? {});
    return Promise.resolve({ purpose: req.purpose, request: { model: "scripted", system: req.system, messages: req.messages, maxTokens: req.maxTokens },
      rawResponse: raw, usage: { model: "scripted", inputTokens: 0, outputTokens: 1, cents: 0, ms: 1 } });
  }
}

const reply = (draft: string, frictions: { kind: string; quote: string }[]) =>
  ({ points: [{ kind: "complaint", quote: draft }], feeling: { name: "fed up", intensity: 3 }, frictions, activated: [], safety: { level: "none", reason: "" } });

Deno.test("every golden flag keeps every documented kind code checks: the validators never drop a friction the gate expects", async () => {
  const golden = await loadGolden();
  for (const c of golden.cases) for (const f of c.expect.flags ?? []) for (const k of f.kinds) {
    assert(kindHolds(k as FrictionKind, f.quote, c.draft), `${c.id}: ${k} on "${f.quote}" was judged to have no sign`);
  }
});

Deno.test("the mislabels seen in the golden traces fail their kind: sarcasm on a literal line, you_blame with no you, heat on 'Whatever', absolute on a label", () => {
  const g11 = "Whatever, do what you want, you always do";
  assert(!kindHolds("sarcasm", "do what you want", g11));
  assert(!kindHolds("heat", "Whatever", g11));
  assert(kindHolds("absolute", "you always do", g11));
  const g08 = "Thanks for finally sending the report, great timing as usual.";
  assert(!kindHolds("you_blame", "great timing as usual", g08));
  assert(kindHolds("sarcasm", "great timing as usual", g08));
  assert(kindHolds("absolute", "as usual", g08));
  assert(!kindHolds("absolute", "You get weird", "You get weird every time my family visits."));
  // A claim about the receiver may quote without its "you": the sentence names them, or speaks to them as an order.
  assert(kindHolds("mind_reading", "ignore my needs", "I hate when you ignore my needs when we travel"));
  assert(kindHolds("you_blame", "telling me how to raise my kids", "Stop telling me how to raise my kids."));
  assert(!kindHolds("you_blame", "finally sending the report", g08));
  assert(!kindHolds("heat", "Honestly", "Honestly you're the worst at keeping secrets."));
  assert(kindHolds("heat", "I HATE THIS", "I HATE THIS"));
  // vague_ask is checked on the draft: a message that asks has no vague ask.
  assert(!kindHolds("vague_ask", "Can you pick up milk on your way home?", "Can you pick up milk on your way home?"));
  assert(kindHolds("vague_ask", "You get weird every time my family visits.", "You get weird every time my family visits."));
  // Kinds with no reliable sign are left to the critic.
  assert(kindHolds("character", "so lazy", "so lazy"));
  assertEquals(kindViolations([{ kind: "sarcasm", quote: "do what you want" }], g11).length, 1);
});

Deno.test("checkAnalysis names a kind with no sign in its words and asks for the repair call", () => {
  const draft = "Whatever, do what you want, you always do";
  const a: Analysis = { points: [{ kind: "complaint", quote: draft }], feeling: { name: "fed up", intensity: 3 }, activated: [], landsOn: [], safety: "none",
    safetyReason: "", safetyQuotes: [], tone: "angry", frictions: [{ kind: "sarcasm", quote: "do what you want" }, { kind: "absolute", quote: "you always do" }] };
  const c = checkAnalysis(a, draft, []);
  const hold = c.checks.find((x) => x.name === "friction_kinds_hold")!;
  assert(!hold.ok && hold.detail.includes(`sarcasm "do what you want"`), hold.detail);
  assert(!hold.detail.includes("absolute"));
  assert(c.needsRepair);
});

Deno.test("a safety stop's frictions are never checked or repaired (law 8: nothing more is read from it)", () => {
  const draft = "If you read my phone again I'll break your hand.";
  const a: Analysis = { points: [{ kind: "complaint", quote: draft }], feeling: { name: "furious", intensity: 5 }, activated: [], landsOn: [], safety: "threat_or_abuse",
    safetyReason: "threat", safetyQuotes: [], tone: "angry", frictions: [{ kind: "heat", quote: "I'll break your hand" }] };
  const c = checkAnalysis(a, draft, []);
  assert(c.checks.find((x) => x.name === "friction_kinds_hold")!.ok);
  assert(!c.needsRepair);
});

Deno.test("a wrong kind is retried once, then dropped; the right frictions stay (never an empty result while one is left)", async () => {
  const draft = "Whatever, do what you want, you always do";
  const bad = reply(draft, [{ kind: "sarcasm", quote: "do what you want" }, { kind: "absolute", quote: "you always do" }, { kind: "heat", quote: "Whatever" }]);
  const stubborn = new Scripted([bad, bad]);
  const out = await analyse(stubborn, draft, "partner", []);
  assertEquals(stubborn.calls, ["analyse", "analyse_repair"]);
  const repairAsk = String((await Promise.resolve(out.exchanges[1].request.messages.at(-1)!.content)));
  assert(repairAsk.includes(`sarcasm "do what you want"`) && repairAsk.includes(`heat "Whatever"`), repairAsk);
  assertEquals(out.analysis!.frictions.map((f) => f.kind), ["absolute"]);
  assert(out.checks.some((c) => c.name === "wrong_kinds_dropped" && c.detail.startsWith("2 ")));

  const fixed = new Scripted([bad, reply(draft, [{ kind: "absolute", quote: "you always do" }, { kind: "you_blame", quote: "do what you want" }])]);
  const again = await analyse(fixed, draft, "partner", []);
  assertEquals(again.analysis!.frictions.map((f) => f.kind), ["absolute", "you_blame"]);

  const clean = new Scripted([reply(draft, [{ kind: "absolute", quote: "you always do" }])]);
  await analyse(clean, draft, "partner", []);
  assertEquals(clean.calls, ["analyse"], "a clean analysis costs no repair call");
});

const TEXT = "Thanks for finally sending the report, great timing as usual.";
const span = (q: string, kind: FrictionKind): InsightFriction => {
  const start = TEXT.indexOf(q);
  return { kind, quote: q, start, end: start + q.length, howItLands: INSIGHT_COPY[kind] };
};

Deno.test("a change's why line is a kind whose sign is in its words, before the rewrite's own label", () => {
  const frictions = [span("great timing as usual", "sarcasm")];
  const bridged = "Thanks for sending the report; it came later than I needed.";
  const h = buildHighlights(TEXT, frictions, [{ kind: "you_blame", from: "great timing as usual", to: "it came later than I needed" }], bridged, null);
  assertEquals(h.length, 1);
  assertEquals(h[0].friction_kind, "sarcasm");
  assertEquals(h[0].why_line, INSIGHT_COPY.sarcasm);
});

Deno.test("a from_you outside the sender's confirmed beliefs is dropped, and a part left with nothing goes with it", () => {
  const touches: BeliefTouches = {
    fromYou: [
      { beliefId: "b1", label: "Being on time", wording: "Part of you feels time is respect", receipt: "late again", date: "2026-10-01", start: 0, end: 6 },
      { beliefId: "b9", label: "Not confirmed", wording: "Part of you feels unseen", receipt: "x", date: "2026-10-02", start: 40, end: 61 },
    ],
    fromThem: [],
  };
  const all = buildHighlights(TEXT, [], [], null, touches);
  assertEquals(all.flatMap((h) => h.from_you.map((y) => y.belief_id)), ["b1", "b9"]);
  const kept = buildHighlights(TEXT, [], [], null, touches, new Set(["b1"]));
  assertEquals(kept.map((h) => [h.original, h.from_you.map((y) => y.belief_id)]), [["Thanks", ["b1"]]]);
  for (const h of kept) assertEquals(h.original, TEXT.slice(h.start, h.end));
});

Deno.test("a belief wording or a shared label that holds a friction kind's name is quoted, so the summary and why lines name no kind", () => {
  assertEquals(youWhy("Demands", "Part of you feels a demand is disrespect"), "This comes from something that matters to you: “Part of you feels a demand is disrespect”.");
  assertEquals(youWhy("Time", "Part of you feels time is respect"), "This comes from something that matters to you: part of you feels time is respect.");
  const touches: BeliefTouches = {
    fromYou: [{ beliefId: "b1", label: "Demands", wording: "Part of you feels a demand is disrespect", receipt: "r", date: "2026-10-01", start: null, end: null }],
    fromThem: [{ beliefId: "r1", label: "Sarcasm hurts me", wording: "Sarcasm hurts me.", why: "", start: null, end: null }],
  };
  const line = summaryLine([span("great timing as usual", "sarcasm")], touches);
  assertEquals(engineTermsIn(line, TEXT), []);
  assertEquals(engineTerms(line, TEXT), [], line);
  assert(line.includes("“Sarcasm hurts me”"), line);
});
