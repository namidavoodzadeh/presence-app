// E27 (2): the analysis reads both maps. heat and you_blame are frictions; the sender's touches count every confirmed
// belief (rated imports with one receipt included) with a receipt in their own words; the receiver's touches come only
// from beliefs they shared, wording only. Recorded replies prove the code; the golden gate judges the real model.

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { analysePackage, checkAnalysis, readAnalysis } from "../engine/bridge/analyse.ts";
import { bridgeDraft } from "../engine/bridge/bridge.ts";
import { beliefTouches, pickReceipt } from "../engine/bridge/touches.ts";
import { type Analysis, type Draft, FRICTION_KINDS, type FrictionKind, type Sender } from "../engine/bridge/types.ts";
import { RecordedClient } from "../engine/model/client.ts";
import { evalBody, loadGolden } from "../evals/bridge_golden.ts";
import { evalInput } from "../api/bridge_eval.ts";

const golden = await loadGolden();
const g01 = golden.cases.find((c) => c.id.startsWith("g01"))!;
const input = evalInput(evalBody(g01));
const TEXT = g01.draft;

const ANALYSIS = {
  points: [{ kind: "complaint", quote: TEXT }],
  feeling: { name: "hurt", intensity: 4 },
  tone: "angry",
  frictions: [{ kind: "heat", quote: "I hate" }, { kind: "you_blame", quote: "you ignore my needs" }],
  activated: [{ beliefId: "s01a", why: "needs coming last", quote: "ignore my needs" }, { beliefId: "s01c", why: "x" }, { beliefId: "s01b", why: "travel" , quote: "when we travel" }],
  lands_on: [{ beliefId: "r01a", why: "may land as a hint rather than an ask", quote: "you ignore my needs" }, { beliefId: "r01p", why: "unshared" }],
  safety: { level: "none", reason: "", quotes: [] },
};

Deno.test("E27 (2) the analysis package lists the receiver's shared beliefs by wording, never a receipt or an unshared one", () => {
  const pkg = analysePackage(TEXT, "partner", input.sender.map.beliefs, input.receiverShared);
  assert(pkg.includes("# BELIEFS THE RECEIVER CHOSE TO SHARE WITH THE SENDER"));
  assert(pkg.includes("r01a \"Direct asks\": Being asked directly matters to me more than hints."));
  for (const b of [...g01.receiver.shared, ...g01.receiver.private]) for (const r of b.receipts) assert(!pkg.includes(r.quote), `no receipt ${r.quote}`);
  assert(!pkg.includes("r01p") && !pkg.includes("freezes"), "no unshared belief");
  assert(analysePackage(TEXT, "partner", [], []).includes("(none shared)"));
});

Deno.test("E27 (2a) heat and you_blame are read as frictions; (2c) lands_on outside the shared list is dropped", () => {
  const read = readAnalysis(ANALYSIS);
  assert(read.analysis);
  assertEquals(read.analysis.frictions.map((f) => f.kind), ["heat", "you_blame"]);
  assertEquals((read.analysis.landsOn ?? []).map((a) => a.beliefId), ["r01a", "r01p"]);
  const checked = checkAnalysis(read.analysis, TEXT, input.sender.map.beliefs, input.receiverShared);
  assertEquals((checked.analysis.landsOn ?? []).map((a) => a.beliefId), ["r01a"]);
  assertEquals(checked.analysis.activated.map((a) => a.beliefId), ["s01a", "s01b"], "not_me s01c dropped");
  assert(!checked.needsRepair);
});

Deno.test("E27 (2b) touches: rated import with one receipt counts, receipts are the sender's own words, receiver wording only", () => {
  const checked = checkAnalysis(readAnalysis(ANALYSIS).analysis!, TEXT, input.sender.map.beliefs, input.receiverShared).analysis;
  const t = beliefTouches(TEXT, checked, input.sender.map.beliefs, input.receiverShared);
  assertEquals(t.fromYou.map((y) => y.beliefId), ["s01a", "s01b"]);
  for (const y of t.fromYou) {
    const own = g01.sender.beliefs.find((b) => b.id === y.beliefId)!;
    assert(own.receipts.some((r) => r.quote === y.receipt && r.date === y.date), `${y.beliefId} receipt is theirs`);
  }
  assertEquals(TEXT.slice(t.fromYou[0].start!, t.fromYou[0].end!), "ignore my needs");
  assertEquals(t.fromThem.map((x) => x.beliefId), ["r01a"]);
  assertEquals(Object.keys(t.fromThem[0]).sort(), ["beliefId", "end", "label", "start", "why", "wording"]);
  assert(!JSON.stringify(t).includes("I can't read hints"));
});

Deno.test("E27 (2b) a belief with no receipt never touches (law 2); the closest receipt wins, then the latest", () => {
  const a: Analysis = { points: [], feeling: { name: "x", intensity: 1 }, frictions: [], activated: [{ beliefId: "n", why: "" }], safety: "none", safetyReason: "", safetyQuotes: [] };
  const none = { ...input.sender.map.beliefs[0], id: "n", receipts: [] };
  assertEquals(beliefTouches(TEXT, a, [none], []).fromYou, []);
  const b = { ...input.sender.map.beliefs[0], receipts: [
    { quote: "Work is busy", sessionId: "s", turn: 1, date: "2026-10-30" },
    { quote: "When we travel my needs vanish", sessionId: "s", turn: 2, date: "2026-10-01" },
    { quote: "Work is loud", sessionId: "s", turn: 3, date: "2026-10-31" },
  ] };
  assertEquals(pickReceipt(b, TEXT)?.quote, "When we travel my needs vanish");
  assertEquals(pickReceipt(b, "nothing shared here")?.quote, "Work is loud");
});

Deno.test("E27 (2) bridgeDraft passes the shared beliefs to the analysis and keeps the touches on the trace", async () => {
  const sender: Sender = input.sender;
  const draft: Draft = { id: "d", senderId: sender.personaId, relationship: "partner", message: TEXT, hiddenIntent: "", expected: { frictions: [], safety: "none", nothingToChange: false } };
  const client = new RecordedClient({ analyse: [JSON.stringify(ANALYSIS)], rewrite: [JSON.stringify({ bridged: "When we travel my needs get lost, and it's really hard for me.", contextNote: null, changes: [{ kind: "heat", from: "I hate", to: "it's really hard for me" }] })], verify: [JSON.stringify({ pass: true, pointsMissing: [], added: [], receiverInnerLife: [], voice: 4, feelingPreserved: true, notes: "" })] });
  const t = await bridgeDraft(client, draft, sender);
  assert(String(t.exchanges[0].request.messages[0].content).includes("Being asked directly matters to me more than hints."));
  assertEquals(t.touches?.fromYou.map((y) => y.beliefId), ["s01a", "s01b"]);
  assertEquals(t.touches?.fromThem.map((x) => x.beliefId), ["r01a"]);
});

// ------------------------------------------------------------------ E27 (3): highlights, summary, outcome rules

import { buildHighlights, CHECKED_LINE, summaryLine, THEM_WHY, youWhy } from "../engine/bridge/highlights.ts";
import { INSIGHT_COPY } from "../engine/bridge/insight.ts";
import { runReply } from "../api/bridge_engine.ts";
import { engineTerms, scoreCase } from "../evals/bridge_golden.ts";
import { EVALUATIVE, words } from "../engine/words.ts";

const frictionAt = (kind: FrictionKind, quote: string) => {
  const start = Math.max(0, TEXT.indexOf(quote));
  return { kind, quote, start, end: start + quote.length, howItLands: INSIGHT_COPY[kind] };
};

Deno.test("E27 (3) highlights: the rewrite's change units carry the suggestion; a whole-message ask yields to smaller frictions; touches attach", () => {
  const frictions = [frictionAt("vague_ask", TEXT), frictionAt("heat", "I hate"), frictionAt("you_blame", "you ignore my needs")];
  const bridged = "It's really hard for me when my needs get lost when we travel";
  const changes = [{ kind: "heat" as const, from: "I hate", to: "It's really hard for me" }, { kind: "you_blame" as const, from: "you ignore my needs", to: "my needs get lost" }];
  const touches = { fromYou: [{ beliefId: "s01a", label: "Needs last", wording: "w", receipt: "r", date: "2026-10-19", start: TEXT.indexOf("ignore"), end: TEXT.indexOf("ignore") + 6 }],
    fromThem: [{ beliefId: "r01a", label: "Direct asks", wording: "Being asked directly matters to me more than hints.", why: "x", start: null, end: null }] };
  const h = buildHighlights(TEXT, frictions, changes, bridged, touches);
  assertEquals(h.map((x) => [x.original, x.suggested]), [["I hate", "It's really hard for me"], ["you ignore my needs", "my needs get lost"]]);
  assertEquals(h[0].why_line, INSIGHT_COPY.heat);
  assertEquals(h[1].from_you.map((y) => y.belief_id), ["s01a"]);
  assertEquals(h[0].from_them, [{ belief_id: "r01a", wording: "Being asked directly matters to me more than hints.", item_id: null, quote: null, quote_label: null }], "a touch with no place goes on the first highlight");
  for (const x of h) { assertEquals(TEXT.slice(x.start, x.end), x.original); assert(bridged.includes(x.suggested)); }
});

Deno.test("E27 (3) highlights: with no rewrite, touches on clear wording get their own highlight, words unchanged", () => {
  const t = "I feel lonely in the evenings when you're on your phone.";
  const touches = { fromYou: [{ beliefId: "y", label: "Undivided time", wording: "w", receipt: "r", date: "d", start: 2, end: 13 }],
    fromThem: [{ beliefId: "t", label: "Unwinding", wording: "Scrolling is how I unwind after work.", why: "x", start: 35, end: 55 }] };
  const h = buildHighlights(t, [], [], null, touches);
  assertEquals(h.map((x) => [x.original, x.suggested === x.original, x.why_line]), [["feel lonely", true, youWhy("Undivided time", "w")], ["you're on your phone", true, THEM_WHY]]);
});

Deno.test("v1.61 highlights: `about` says whether the why line describes the receiver (source rule) or the sender's own words", () => {
  const t = "I feel lonely in the evenings when you're on your phone.";
  const touches = { fromYou: [{ beliefId: "y", label: "Undivided time", wording: "w", receipt: "r", date: "d", start: 2, end: 13 }],
    fromThem: [{ beliefId: "t", label: "Unwinding", wording: "Scrolling is how I unwind after work.", why: "x", start: 35, end: 55 }] };
  const h = buildHighlights(t, [], [], null, touches);
  assertEquals(h.map((x) => [x.original, x.about]), [["feel lonely", "wording"], ["you're on your phone", "receiver"]]);
  for (const x of h) assertEquals(x.about === "receiver", x.why_line === THEM_WHY && x.friction_kind === null);
  // A friction note stays about the wording even when a receiver touch rides on it as context.
  const frictions = [frictionAt("heat", "I hate")];
  const withThem = { fromYou: [], fromThem: [{ beliefId: "r", label: "Direct asks", wording: "w2", why: "x", start: null, end: null }] };
  const h2 = buildHighlights(TEXT, frictions, [], null, withThem);
  assertEquals(h2.map((x) => [x.original, x.about, x.from_them.length]), [["I hate", "wording", 1]]);
});

Deno.test("E27 (3) summary: one line that describes in plain warm words (CEO 11:15 PT); the checked line when nothing is found", () => {
  const needsLast = { beliefId: "y", label: "Needs last", wording: "Part of you feels your needs come last when plans get made.", receipt: "", date: "", start: null, end: null };
  const directAsks = { beliefId: "t", label: "Direct asks", wording: "Being asked directly matters to me more than hints.", why: "", start: null, end: null };
  const draft = "I hate when you ignore my needs when we travel";
  const s = summaryLine([frictionAt("heat", "I hate"), frictionAt("you_blame", "you ignore my needs"), { ...frictionAt("vague_ask", draft), start: 0 }], { fromYou: [needsLast], fromThem: [directAsks] });
  assertEquals(s, "This comes from something that matters to you: part of you feels your needs come last when plans get made. " +
    "Words like “I hate” and “you ignore my needs” may land as blame. It doesn't yet say what you'd like them to do. " +
    "It may touch something they've shared with you: direct asks.");
  // The receiver's side is the label only: never their wording (law 10).
  assert(!s.includes(directAsks.wording));
  assertEquals(summaryLine([frictionAt("demand", "Don't ask me to do something for you in front of others")], null), "Words like “Don't ask me…” may land as an order.");
  assertEquals(summaryLine([], { fromYou: [], fromThem: [directAsks] }), "It may touch something they've shared with you: direct asks. The wording itself reads clearly.");
  assertEquals(summaryLine([], null), CHECKED_LINE);
  // The same words under two kinds, or overlapping stretches, are said once; at most three; the sender's own first person stays quoted.
  const g05 = "You never reply to me and you clearly don't care";
  const at = (kind: FrictionKind, quote: string) => ({ kind, quote, start: g05.indexOf(quote), end: g05.indexOf(quote) + quote.length, howItLands: INSIGHT_COPY[kind] });
  assertEquals(summaryLine([at("absolute", "You never reply"), at("you_blame", "You never reply to me"), at("mind_reading", "you clearly don't care"), at("you_blame", "you clearly don't care")], null),
    "Words like “You never reply” may sound like every time and “you clearly don't care” may sound like telling them what they feel.");
  assertEquals(youWhy("Not a follower", "I don't want to look weak in front of others."), "This comes from something that matters to you: “I don't want to look weak in front of others”.");
  const lines = [s, CHECKED_LINE, THEM_WHY, youWhy("X"), youWhy("Needs last", needsLast.wording), ...FRICTION_KINDS.map((k) => summaryLine([frictionAt(k, "you always")], null)), ...Object.values(INSIGHT_COPY)];
  for (const line of lines) {
    assert(!/\n/.test(line));
    assertEquals(words(line).filter((w) => (EVALUATIVE as readonly string[]).includes(w)), []);
    assertEquals(engineTerms(line, ""), [], line);
  }
});

Deno.test("E27 golden scorer: the summary and why lines name no friction kind and none of the old engine phrases; the sender's quoted words stand", () => {
  assertEquals(engineTerms("What might get in the way: heat words, a claim about what they do and no clear ask yet.", ""), ["heat", "heat word", "claim about what they do", "no clear ask"]);
  assertEquals(engineTerms("This reads as a vague ask and some mind reading.", ""), ["mind reading", "vague ask"]);
  assertEquals(engineTerms("Sarcasm often lands as the opposite of its words.", ""), ["sarcasm"]);
  assertEquals(engineTerms("Words like “the heat is on” may land as blame.", ""), []);
  assertEquals(engineTerms("Your demand may land as an order.", "I demand an answer"), []);
  assertEquals(engineTerms("Absolutely clear, in character with you.", ""), ["character"]);
});

const hooksNoop = { after: () => Promise.resolve(), failure: () => Promise.resolve("ref") };
const CRITIC_PASS = JSON.stringify({ pass: true, pointsMissing: [], added: [], receiverInnerLife: [], voice: 4, feelingPreserved: true, notes: "" });

Deno.test("E27 (3) /bridge/run: the travel draft gets highlights from both maps and a bridged text built from them; the golden scorer passes it", async () => {
  const client = new RecordedClient({ analyse: [JSON.stringify(ANALYSIS)],
    rewrite: [JSON.stringify({ bridged: "It's really hard for me when my needs get lost when we travel", contextNote: null,
      changes: [{ kind: "heat", from: "I hate", to: "It's really hard for me" }, { kind: "you_blame", from: "you ignore my needs", to: "my needs get lost" }] })],
    verify: [CRITIC_PASS] });
  const out = await runReply(client, TEXT, "partner", input.sender, hooksNoop);
  assertEquals(out.outcome, "ok");
  assertEquals(out.words_changed, true);
  const s = scoreCase(g01, out);
  assertEquals(s.misses, []);
});

Deno.test("E27 (3) /bridge/run: clear wording that touches a belief is insight (ok, words unchanged), not 'already clear'", async () => {
  const g16 = golden.cases.find((c) => c.id.startsWith("g16"))!;
  const inp = evalInput(evalBody(g16));
  const client = new RecordedClient({ analyse: [JSON.stringify({ points: [{ kind: "feeling", quote: g16.draft }], feeling: { name: "lonely", intensity: 3 }, frictions: [],
    activated: [{ beliefId: "s16a", why: "closeness", quote: "lonely in the evenings" }], lands_on: [{ beliefId: "r16a", why: "may touch unwinding", quote: "on your phone" }],
    safety: { level: "none", reason: "" } })] });
  const out = await runReply(client, g16.draft, "partner", inp.sender, hooksNoop);
  assertEquals([out.outcome, out.words_changed, out.bridged], ["ok", false, g16.draft]);
  assertEquals(scoreCase(g16, out).misses, []);
});

Deno.test("E27 (3) /bridge/run: nothing_to_change only with no friction and no touch on either map, with the checked line", async () => {
  const g04 = golden.cases.find((c) => c.id.startsWith("g04"))!;
  const client = new RecordedClient({ analyse: [JSON.stringify({ points: [{ kind: "request", quote: g04.draft }], feeling: { name: "calm", intensity: 1 }, frictions: [], activated: [], lands_on: [], safety: { level: "none", reason: "" } })] });
  const out = await runReply(client, g04.draft, "partner", evalInput(evalBody(g04)).sender, hooksNoop);
  assertEquals([out.outcome, out.line, out.summary, out.highlights], ["nothing_to_change", CHECKED_LINE, CHECKED_LINE, []]);
});

Deno.test("E27 (3) /bridge/run: a safety stop carries no highlights and no summary (law 8)", async () => {
  const g19 = golden.cases.find((c) => c.id.startsWith("g19"))!;
  const out = await runReply(new RecordedClient({}), g19.draft, "friend", evalInput(evalBody(g19)).sender, hooksNoop);
  assertEquals([out.outcome, out.highlights, out.summary], ["could_not_bridge", [], null]);
});

type LiveReply = { seq: number; state: string; words_changed: boolean; bridged: string | null; spans: unknown[]; summary: string | null;
  highlights: { start: number; end: number; original: string }[] };

Deno.test("E35 live insight with wording: one call returns spans, Bridge's wording and the v1.42 highlights; offsets index the draft", async () => {
  const { liveWordingReply, withWording } = await import("../api/bridge_engine.ts");
  const client = new RecordedClient({ analyse: [JSON.stringify(ANALYSIS)],
    rewrite: [JSON.stringify({ bridged: "It's really hard for me when my needs get lost when we travel", contextNote: null,
      changes: [{ kind: "heat", from: "I hate", to: "It's really hard for me" }, { kind: "you_blame", from: "you ignore my needs", to: "my needs get lost" }] })],
    verify: [CRITIC_PASS] });
  const out = await liveWordingReply(client, TEXT, 12, "partner", input.sender, hooksNoop) as LiveReply;
  assertEquals([out.seq, out.state, out.words_changed], [12, "insight", true]);
  assertEquals(out.bridged, "It's really hard for me when my needs get lost when we travel");
  assert(out.spans.length > 0);
  assert(out.highlights.length > 0);
  for (const h of out.highlights) assertEquals(TEXT.slice(h.start, h.end), h.original);
  assert(typeof out.summary === "string");
  assertEquals(withWording({}), false);
  assertEquals(withWording({ with_wording: true }), true);
  assertThrows(() => withWording({ with_wording: "yes" }));
});

Deno.test("E35 live insight with wording: a safety reading gives no wording and no highlights (law 8)", async () => {
  const { liveWordingReply } = await import("../api/bridge_engine.ts");
  const g19 = golden.cases.find((c) => c.id.startsWith("g19"))!;
  const out = await liveWordingReply(new RecordedClient({}), g19.draft, 3, "friend", evalInput(evalBody(g19)).sender, hooksNoop) as LiveReply;
  assertEquals([out.seq, out.state, out.bridged, out.highlights, out.summary], [3, "risk", null, [], null]);
});
