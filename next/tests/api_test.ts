// $0 tests for the API's pure pieces: type → kind and area folds (CONTRACT §1), the title cleaner (engine item 4), the row ↔ engine
// mapping (lib/state.ts) and the hypothesis pruning after an edit or a delete (talk.ts).
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  areaFor,
  CONSENT_LABEL,
  dbRating,
  engineRating,
  FOUNDATION_SLOTS,
  kindFor,
  lensForAbout,
  lensForArea,
  lensForDomain,
  patchFor,
  statusForRating,
} from "../api/lib/map.ts";
import { cleanTitle } from "../engine/talk/checks.ts";
import { beliefFromRow, shownFromReply } from "../api/lib/state.ts";
import {
  guardedStreamReflection,
  pruneHypotheses,
  sentenceChunks,
  sseFrame,
  streamedJsonString,
} from "../api/talk.ts";
import { bearerSubject } from "../api/lib/db.ts";
import { meObjectFromRow, messageObject, receiptObject } from "../api/lib/objects.ts";
import { bridgeReviewHint } from "../api/bridge_engine.ts";
import type { Belief } from "../engine/types.ts";

Deno.test("type → kind follows CONTRACT §1.2", () => {
  assertEquals(kindFor("something I believe is true"), "foundation");
  assertEquals(kindFor("a rule I live by"), "rule");
  assertEquals(kindFor("something I do to cope"), "rule");
  assertEquals(kindFor("a view or taste"), "everyday");
  assertEquals(kindFor("how I tend to react"), "everyday");
});

Deno.test("read-path helpers reuse a validated profile without another database read", () => {
  const sub = "123e4567-e89b-42d3-a456-426614174000";
  const payload = btoa(JSON.stringify({ sub })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(bearerSubject(`x.${payload}.x`), sub);
  assertEquals(bearerSubject("not-a-token"), null);
  const me = meObjectFromRow({
    id: sub,
    name: "Latency Check",
    settings: { read_aloud: false },
    tz: "Asia/Tehran",
  });
  assertEquals(me.person.name, "Latency Check");
  assertEquals(me.person.tz, "Asia/Tehran");
  assertEquals(me.settings.read_aloud, false);
  assertEquals((me.settings.notify as Record<string, boolean>).bridges_ready, true);
});

Deno.test("TQ2: chip taps are episode answers and receipts render as choices, never plain quotes", () => {
  const message = messageObject({ id: "m1", conversation_id: "c1", role: "me", turn: 1, text: "A decision",
    answer_kind: "chip", created_at: "2026-11-02T12:00:00Z" });
  assertEquals(message.answer_kind, "chip");
  assertEquals(receiptObject({ message_id: "m1", quote: "A decision", conversation_id: "c1",
    said_at: "2026-11-02T12:00:00Z", messages: { answer_kind: "chip" } }), {
    message_id: "m1", quote: "you chose: A decision", kind: "choice", conversation_id: "c1",
    said_at: "2026-11-02T12:00:00Z",
  });
  assertEquals(receiptObject({ quote: "I stayed", messages: { answer_kind: "told" } }).kind, "quote");
});

Deno.test("TQ2 migration stores the answer kind on each episode message", async () => {
  const sql = await Deno.readTextFile("../supabase/migrations/0019_chip_episode_answers.sql");
  assert(sql.includes("answer_kind text not null default 'told'"));
  for (const kind of ["told", "chip", "consent"]) assert(sql.includes(`'${kind}'`));
});

Deno.test("domains → area: self folds into the other domain, self alone is meaning, society is politics", () => {
  assertEquals(areaFor(["self", "close_relationships"]), "relationships");
  assertEquals(areaFor(["self"]), "meaning");
  assertEquals(areaFor(["society"]), "politics");
  assertEquals(areaFor(["body_health"]), "body");
  assertEquals(areaFor([]), "meaning");
});

Deno.test("foundation slots: 12 named slots, Me/Rules/Coping/Reactions default to the me lens (COO Q4 2026-11-05)", () => {
  assertEquals(FOUNDATION_SLOTS.length, 12);
  assertEquals(new Set(FOUNDATION_SLOTS.map((s) => s.id)).size, 12);
  assertEquals(FOUNDATION_SLOTS.filter((s) => s.lens === "me").length, 7); // worth/competence/lovability/control + rules/coping/reactions
  assertEquals(FOUNDATION_SLOTS.filter((s) => s.lens === "others").length, 3); // safety/reliability/intentions
  assertEquals(FOUNDATION_SLOTS.filter((s) => s.lens === "world").length, 2); // fairness/future
});

Deno.test("lensForDomain / lensForArea: self is me, close relationships and family are others, the rest is world", () => {
  assertEquals(lensForDomain("self"), "me");
  assertEquals(lensForDomain("close_relationships"), "others");
  assertEquals(lensForDomain("family"), "others");
  assertEquals(lensForDomain("society"), "world");
  assertEquals(lensForDomain("politics"), "world");
  assertEquals(lensForDomain("morality"), "world");
  assertEquals(lensForDomain("meaning"), "world");
  assertEquals(lensForDomain("work"), "me");
  assertEquals(lensForArea("relationships"), "others");
  assertEquals(lensForArea("politics"), "world");
});

Deno.test("lensForAbout: a tested free-text lookup, third-person words win over a first-person pronoun", () => {
  assertEquals(lensForAbout("her mother"), "others");
  assertEquals(lensForAbout("my mother"), "others"); // names another person despite containing "my"
  assertEquals(lensForAbout("he never calls back"), "others");
  assertEquals(lensForAbout("the world in general"), "world");
  assertEquals(lensForAbout("society expects too much"), "world");
  assertEquals(lensForAbout("myself and my choices"), "me");
  assertEquals(lensForAbout("I keep doing this"), "me");
  assertEquals(lensForAbout(null), null);
  assertEquals(lensForAbout(""), null);
  assertEquals(lensForAbout("a quiet Tuesday"), null);
});

Deno.test("patch: direction by area, size and height by kind, pale for partly, sheen for seen by others", () => {
  const p = patchFor({
    kind: "foundation",
    area: "relationships",
    birth_mood: "lonely",
    rating: "partly",
    seen_by_others: true,
  });
  assertEquals([p.direction_deg, p.size, p.height, p.mood, p.pale, p.sheen], [
    90,
    1.5,
    "crown",
    "lonely",
    true,
    true,
  ]);
  assertEquals(patchFor({ kind: "everyday", area: "work" }).size, 0.6);
});

Deno.test("ratings map both ways and set the status", () => {
  assertEquals(engineRating("very"), "very_me");
  assertEquals(engineRating("not"), "not_me");
  assertEquals(engineRating(null), undefined);
  assertEquals(dbRating("partly"), "partly");
  assertEquals(statusForRating("not"), "set_aside");
  assertEquals(statusForRating("very"), "confirmed");
  for (const d of Object.keys(CONSENT_LABEL)) {
    assert(CONSENT_LABEL[d as keyof typeof CONSENT_LABEL].length > 2);
  }
});

Deno.test("cleanTitle: two to four plain words stand, fragments, questions and banned words do not", () => {
  assertEquals(cleanTitle("Dinner plans"), "Dinner plans");
  assertEquals(cleanTitle('"the job offer."'), "The job offer");
  assertEquals(cleanTitle("Why dinner keeps moving again"), null); // five words
  assertEquals(cleanTitle("Should I leave"), null); // banned word
  assertEquals(cleanTitle("Dinner plans?"), "Dinner plans"); // a trailing mark is trimmed
  assertEquals(cleanTitle("Dinner? plans"), null); // a question inside is not a title
  assertEquals(cleanTitle(null), null);
  assertEquals(cleanTitle(""), null);
});

Deno.test("beliefFromRow: status, level default, receipts with their message turn, rests_on becomes supports", () => {
  const row = {
    id: "b1",
    label: "Afterthought",
    statement: "You may feel…",
    type: "something I believe is true",
    status: "confirmed",
    domains: ["self", "close_relationships"],
    confidence: 0.8,
    birth_mood: "lonely",
    level: null,
  };
  const b = beliefFromRow(row, [{
    quote: "nobody asked me",
    conversation_id: "c1",
    said_at: "2026-10-27T10:00:00Z",
    messages: { turn: 3 },
  }], [{ from_belief: "b1", to_belief: "b0", kind: "rests_on" }, {
    from_belief: "b2",
    to_belief: "b1",
    kind: "tension",
  }]);
  assertEquals(b.status, "endorsed");
  assertEquals(b.level, "L0");
  assertEquals(b.receipts[0].turn, 3);
  assertEquals(b.receipts[0].date, "2026-10-27");
  assertEquals(b.links, [{ to: "b0", type: "supports" }, { to: "b2", type: "tension" }]);
  assertEquals(b.birthMood, "lonely");
});

Deno.test("shownFromReply: consent → permission with its domain; cards carry the row's rating", () => {
  const s = shownFromReply({
    state: "consent",
    reflection: "r",
    question: "q?",
    consent: { area: "body", label: "your health", domain: "body_health" },
    cards: [{ belief_id: "b1", label: "L", statement: "S", type: "a rule I live by", birth_mood: "sad" }],
    feeling: "sad",
  }, (id) => id === "b1" ? "partly" : undefined);
  assertEquals(s.state, "permission");
  assertEquals(s.permissionDomain, "body_health");
  assertEquals(s.cards[0].rating, "partly");
  assertEquals(s.feeling, "sad");
  assertEquals(
    shownFromReply({
      state: "safety",
      reflection: "",
      question: "",
      cards: [],
      safety: { message: "m", resources: [] },
    }, () => undefined).state,
    "safety",
  );
});

Deno.test("QA-B6: an unresolved Bridge ask carries the add-ask action and no other review does", () => {
  assertEquals(bridgeReviewHint(true), { ask_unresolved: true, next_step: "add_ask" });
  assertEquals(bridgeReviewHint(false), { ask_unresolved: false, next_step: null });
});

Deno.test("QA-B16: receiver clears use bridge creation time, never the scheduled delivery time", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../supabase/migrations/0013_receiver_clear_cutoff.sql", import.meta.url),
  );
  assert(migration.includes("b.created_at > p_created_after"));
  assert(!migration.includes("b.deliver_at > p_created_after"));
});

Deno.test("pruneHypotheses: later receipts go, the turn's own stay only while still in the text, empty ones without a row drop", () => {
  const h = (id: string, receipts: [number, string][]): Belief => ({
    id,
    label: "L",
    statement: "S",
    type: "a rule I live by",
    level: "L1",
    domains: ["self"],
    confidence: 0.6,
    receipts: receipts.map(([turn, quote]) => ({ quote, sessionId: "c", turn, date: "2026-10-27" })),
    links: [],
    status: "inferred",
  });
  const out = pruneHypotheses(
    [
      h("a", [[2, "early"], [5, "late"]]),
      h("b", [[4, "kept words"], [4, "gone words"]]),
      h("c", [[6, "later"]]),
      h("d", [[6, "later"]]),
    ],
    4,
    "the kept words stay",
    (id) => id === "d",
  );
  assertEquals(out.map((x) => x.id), ["a", "b", "d"]);
  assertEquals(out[0].receipts.map((r) => r.quote), ["early"]);
  assertEquals(out[1].receipts.map((r) => r.quote), ["kept words"]);
  assertEquals(out[2].receipts.length, 0);
  // a delete: no text at all, the turn's receipts go
  assertEquals(pruneHypotheses([h("b", [[4, "x"]])], 4, null, () => false), []);
});

Deno.test("live voice: only a complete, grounded reflection after a none safety decision can become speech", () => {
  const latest = "Dinner moved twice this week without a heads-up.";
  const safe =
    '{"risk":{"level":"none","reason":""},"feeling":"lonely","reflection":"Dinner moved twice, and there was no heads-up."';
  assertEquals(guardedStreamReflection(safe, latest), "Dinner moved twice, and there was no heads-up.");
  assertEquals(
    guardedStreamReflection('{"risk":{"level":"self"},"reflection":"Dinner moved twice."}', latest),
    null,
  );
  assertEquals(guardedStreamReflection('{"reflection":"Dinner moved twice."}', latest), null);
  assertEquals(guardedStreamReflection('{"risk":{"level":"none"},"reflection":"Dinner moved', latest), null);
  assertEquals(
    guardedStreamReflection('{"risk":{"level":"none"},"reflection":"You should leave."}', latest),
    null,
  );
  assertEquals(
    guardedStreamReflection('{"risk":{"level":"none"},"reflection":"A completely unrelated river."}', latest),
    null,
  );
});

Deno.test("live voice: escaped JSON fields and sentence SSE chunks are complete, never deltas", () => {
  assertEquals(
    streamedJsonString('{"reflection":"You said \\"enough\\"."}', "reflection"),
    'You said "enough".',
  );
  assertEquals(streamedJsonString('{"reflection":"unfinished', "reflection"), null);
  assertEquals(sentenceChunks("First sentence. Second question? Last"), [
    "First sentence.",
    "Second question?",
    "Last",
  ]);
  assertEquals(
    sseFrame("speech", { seq: 0, text: "First sentence.", kind: "reflection" }),
    'event: speech\ndata: {"seq":0,"text":"First sentence.","kind":"reflection"}\n\n',
  );
});

// ---- CDO build review 1 (2026-10-27): the bridged mark, the receiver's zone, Remind me later, time zones on /me
import { senderBridge } from "../api/bridge.ts";
import { validZone } from "../api/index.ts";
import { personObject } from "../api/lib/objects.ts";

Deno.test("senderBridge: bridged_mark is false when nothing changed (Q4); receiver_tz comes from the receiver's profile (Q7)", () => {
  const persons = new Map<string, unknown>([
    ["s", personObject({ id: "s", name: "Nami", tz: "Asia/Tehran" })],
    ["r", personObject({ id: "r", name: "Lea", tz: "Europe/Berlin" })],
  ]);
  const base = {
    id: "b",
    sender: "s",
    receiver: "r",
    status: "scheduled",
    deliver_at: "2026-10-27T16:30:00Z",
    original: "o",
    bridged: "b",
    final: "b",
    used: "bridged",
    changes: [],
    points: [],
  };
  const ok = senderBridge({ ...base, outcome: "ok" }, persons, null);
  assertEquals([ok.bridged_mark, ok.receiver_tz, (ok.to as { tz: string }).tz], [
    true,
    "Europe/Berlin",
    "Europe/Berlin",
  ]);
  assertEquals(senderBridge({ ...base, outcome: "nothing_to_change" }, persons, null).bridged_mark, false);
  assertEquals(senderBridge({ ...base, used: "mine", outcome: "ok" }, persons, null).bridged_mark, false);
  assertEquals(
    senderBridge({ ...base, used: "edited", outcome: "could_not_bridge" }, persons, null).bridged_mark,
    false,
  );
  assertEquals(
    senderBridge({ ...base, outcome: "ok" }, new Map([["r", personObject({ id: "r", name: "Lea" })]]), null)
      .receiver_tz,
    null,
  );
});

Deno.test("validZone: IANA zones pass, junk and UTC-offset strings do not; Person carries tz (null when unknown)", () => {
  assertEquals(validZone("Asia/Tehran"), "Asia/Tehran");
  assertEquals(validZone(" Europe/Berlin "), "Europe/Berlin");
  assertEquals(validZone("Mars/Olympus"), null);
  assertEquals(validZone("+03:30"), null);
  assertEquals(validZone(""), null);
  assertEquals(validZone(42), null);
  assertEquals(personObject({ id: "x", name: "Sam" }).tz, null);
  assertEquals(personObject({ id: "x", name: "Sam", tz: "America/Los_Angeles" }).tz, "America/Los_Angeles");
});
