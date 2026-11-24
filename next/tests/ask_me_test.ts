import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  ASK_ME_STRINGS,
  buildCards, endorsementMark, foldIntoConfirmed, hasIdentifyingDetail, isHardToRead, linkOpen, MERGED_LINE, mergeOverlapping,
  mixOrder, oneAnswerPerDevice, reportDevice, screenAnswer, toOwner,
} from "../api/lib/ask_me.ts";

const K = [{ id: "k1", wording: "Part of you keeps your word even when it costs you" }];
const A = (id: string, text: string, device?: string) => ({ id, text, device });
const kind = [
  A("a", "stayed with me after the argument and listened"), A("b", "first to apologise after an argument, then listened"),
  A("c", "helped carry the boxes without being asked"),
];

Deno.test("fewer than three answers and the link open: nothing is delivered", () => {
  const r = buildCards(kind.slice(0, 2), []);
  assertEquals(r.cards, []); assert(r.waiting);
});
Deno.test("link closed releases what is there; folds count as endorsement, never a card", () => {
  const r = buildCards([A("a", "keeps their word even when it costs them"), A("b", "keeps your word even when it costs")], K, { linkClosed: true });
  assertEquals(r.folds, [{ kenning_id: "k1", count: 2, answer_ids: ["a", "b"] }]); assertEquals(r.cards, []);
});
Deno.test("overlapping answers merge into one card; owner sees the line with no number", () => {
  const r = buildCards(kind, []);
  const merged = r.cards.filter((c) => c.basis === "merged");
  assertEquals(merged.length, 1); assertEquals(merged[0].count, 2);
  assertEquals(toOwner(merged[0]), { kind: "merged", lead: MERGED_LINE });
  assert(!JSON.stringify(toOwner(merged[0])).match(/\d/));
});
Deno.test("single answer: generalised only; identifying detail waits and is dropped if none overlaps", () => {
  const plain = buildCards([...kind.slice(0, 2), A("c", "helped carry the boxes without being asked")], []);
  assertEquals(plain.cards.filter((c) => c.basis === "single").map((c) => c.answer_ids), [["c"]]);
  for (const t of ["helped Sam carry the boxes", "helped at the airport without being asked", 'said "I got you" and helped', "helped me on Tuesday", "helped me move 3 boxes"]) {
    assert(hasIdentifyingDetail(t), t);
    const r = buildCards([A("x", t), A("y", "walked the dog alone"), A("z", "listened after the argument")], [], { linkClosed: true });
    assertEquals(r.cards.some((c) => c.answer_ids.includes("x")), false, t);
  }
});
Deno.test("hard-to-read single waits when the hold is on (default), goes through when it is off", () => {
  const set = [A("h", "forgot to call back after the dinner talk"), A("y", "helped carry the boxes"), A("z", "listened after the argument")];
  assert(isHardToRead("forgot to call back"));
  assertEquals(buildCards(set, [], { linkClosed: true }).cards.some((c) => c.answer_ids.includes("h")), false);
  assertEquals(buildCards(set, [], { linkClosed: true, holdHardSingles: false }).cards.some((c) => c.answer_ids.includes("h")), true);
});
Deno.test("hard singles that overlap a second answer merge and are delivered as merged", () => {
  const r = buildCards([A("h1", "forgot to call back after the talk"), A("h2", "forgot to call back after our talk"), A("z", "listened after the argument")], []);
  assertEquals(r.cards.filter((c) => c.basis === "merged").length, 1);
});
Deno.test("one answer per device; report drops every answer from that device", () => {
  const xs = [A("1", "helped carry the boxes", "d1"), A("2", "helped carry the boxes again", "d1"), A("3", "listened after the argument", "d2")];
  assertEquals(oneAnswerPerDevice(xs).map((a) => a.id), ["1", "3"]);
  assertEquals(reportDevice(xs, "d1").map((a) => a.id), ["3"]);
});
Deno.test("after Not me the theme never returns for that ask", () => {
  const r = buildCards(kind, [], { declined: ["first to apologise after an argument"] });
  assertEquals(r.cards.some((c) => c.basis === "merged"), false);
});
Deno.test("link closes after 7 days or on the owner's tap", () => {
  const t0 = 1_000_000;
  assert(linkOpen({ createdAt: t0, now: t0 + 6 * 86400_000 }));
  assert(!linkOpen({ createdAt: t0, now: t0 + 7 * 86400_000 }));
  assert(!linkOpen({ createdAt: t0, now: t0 + 1000, closedByOwner: true }));
});
Deno.test("endorsement mark: never a 1, never on a harsh self-statement, off when the person turns it off", () => {
  assertEquals(endorsementMark(1, { kenningWording: "I keep my word" }), null);
  assertEquals(endorsementMark(4, { kenningWording: "I keep my word" }), "Came up in 4 answers");
  assertEquals(endorsementMark(4, { kenningWording: "Part of you feels you're not enough" }), null);
  assertEquals(endorsementMark(4, { kenningWording: "I keep my word", markOff: true }), null);
});
Deno.test("mixed order is stable and independent of arrival order; owner shape has no ids, times or text", () => {
  const cs = [{ answer_ids: ["a"] }, { answer_ids: ["b"] }, { answer_ids: ["c"] }, { answer_ids: ["d"] }];
  assertEquals(mixOrder(cs), mixOrder([...cs].reverse()));
  assertEquals(Object.keys(toOwner({ answer_ids: ["a"], count: 1, basis: "single" })).sort(), ["kind", "lead"]);
});
Deno.test("never invents answers: no answers, no cards", () => {
  const r = buildCards([], K, { linkClosed: true });
  assertEquals(r.cards, []); assertEquals(r.folds, []);
});
Deno.test("too-short answers are ignored; same input, same output", () => {
  assertEquals(foldIntoConfirmed([A("x", "ok")], K).rest.length, 1);
  assertEquals(mergeOverlapping([A("x", "ok")]), []);
  assertEquals(buildCards(kind, []), buildCards(kind, []));
});

// ---- 1g: hostile set, 100+ answers; none may become a card, alone or among kind answers -------------------------------------
const HOSTILE: string[] = [
  // insults wrapped in a moment
  "stupid how you laughed at me when I asked", "you were pathetic when you froze at the meeting", "when we talked you acted like a selfish idiot",
  "after the party you came off as fake and annoying", "you said sorry but you're such a loser", "whenever you listen you look worthless",
  "when you left early you were rude and lazy", "you told the story and it was cringe", "you came over and were clingy and needy",
  "after dinner you were arrogant and weird", "you answered the phone like a jerk", "you walked in and everyone found you annoying",
  "when you cried you looked like a freak", "you asked for help and were useless", "you stayed late, what a moron",
  "you called her and acted like trash", "you showed up and honestly it was disgusting", "I hate you for how you waited",
  // body, looks
  "when you wore that dress you looked fat", "you walked in and your face looked ugly", "after the gym you look so skinny",
  "you looked hot when you laughed at the party", "your body changed after you stopped training", "when you came in your hair was a mess",
  "you looked so pretty when you left", "your weight came up when we talked", "you were chubby when we met at school",
  "I noticed your butt when you walked away", "you said that and honestly overweight people do that", "your looks got you in the door",
  // sexual
  "when you hooked up with him at the party everyone knew", "you slept with her after the trip", "you were so horny after drinks",
  "after the party you sent a nude", "you told us about the sex you had", "you watched porn on the sofa when I came over",
  "you flirted and it was so sexy", "everyone knows you were a virgin until college",
  // diagnosis, mental state
  "when you panicked I thought you were bipolar", "you shouted and honestly you seem borderline", "after the talk I figured you have ADHD",
  "you went quiet and it looked like depression", "you cried and I think you have anxiety", "you laughed and you seemed manic crazy",
  "when you froze it was your trauma showing", "you acted like a narcissist at dinner", "you were unstable when we met last week",
  "you gaslight people when you explain things", "you manipulated me when you asked for help", "your mental health shows when you shout",
  "you said it and honestly you seem psychotic", "after the call you looked like you have ptsd", "you are toxic when you apologise",
  // faith, politics, health
  "when you prayed before dinner it was weird", "you told us who you voted for and it was embarrassing", "after the election you were insufferable",
  "your religion came up when you left early", "you said god helped you and we laughed", "when you talked about the political party people rolled their eyes",
  "you came out as gay at the dinner", "after the talk I heard you are trans", "your orientation came up when we met",
  "you told us about your cancer when we ate", "you took your pills before the meeting", "after rehab you came back different",
  "when you missed work because you were sick it showed", "you mentioned your therapy after dinner", "you said you were a muslim and left",
  // private reveals
  "when you told me about the pregnancy I was shocked", "you got an abortion after the trip", "your divorce came up when you left",
  "after the dinner I learned you are in debt", "you said your salary and it was low", "you owe money to him since the party",
  "you got fired and told no one", "you had an affair when you travelled", "when she cheated you stayed quiet",
  "you secretly were arrested last year", "your ex told us what happened when you left", "you are broke and hid it at dinner",
  "you told me his secret when we talked", "you came out to your mother after the dinner",
  // accusations
  "you stole from the team when you left", "after the meeting I saw that you lied to us", "you abused your sister when you were young",
  "you harassed her at the party", "you cheated on the exam when we studied", "you scammed him when you sold the car",
  "you blamed me when it went wrong", "you bullied the new kid when you were there", "you committed fraud when you filed it",
  "you betrayed me when you told them", "you assaulted him after the game", "you lied when we asked and everybody saw",
  // threats
  "you will pay for how you treated me when you left", "I will find you after the party", "I will ruin you when you tell them",
  "you'll regret what you said after dinner", "watch your back when you leave tonight", "I will expose you after what you did",
  "when you leave I'm coming for you", "I will destroy you after you called her",
  // risk (self, others)
  "when you left I wanted to kill myself", "after the talk I want to end my life", "you said you want to hurt your wife when you drank",
  "you told me you will kill him after dinner", "I am going to hurt myself after the party", "I don't want to be alive since you left",
  "when you came over I thought about suicide", "you said you'd kill yourself when we talked",
  // labels, no moment
  "so kind", "you are the best", "always selfish", "a good person", "fake", "so nice and quiet",
];

Deno.test("hostile set: 100+ answers, none passes the screen; none ever becomes a card", () => {
  assert(HOSTILE.length >= 100, `only ${HOSTILE.length}`);
  const failures: string[] = [];
  for (const t of HOSTILE) {
    if (screenAnswer(t).verdict === "ok") failures.push(`passes screen: ${t}`);
    const r = buildCards([A("h", t), ...kind.slice(0, 1), A("z", "walked the dog alone")], [], { linkClosed: true });
    if (r.cards.some((c) => c.answer_ids.includes("h"))) failures.push(`became a card: ${t}`);
  }
  assertEquals(failures, []);
});
Deno.test("hostile merges: two hostile answers that overlap still make no card", () => {
  const r = buildCards([A("p", "when you left you were selfish and rude"), A("q", "when you left you were rude and selfish"), A("z", "helped carry the boxes")], [], { linkClosed: true });
  assertEquals(r.cards.some((c) => c.answer_ids.includes("p") || c.answer_ids.includes("q")), false);
});
Deno.test("risk answers are stopped, listed apart, never stored as cards", () => {
  const r = buildCards([A("r", "after the talk I want to end my life"), ...kind], [], { linkClosed: true });
  assertEquals(r.stopped, ["r"]);
  assertEquals(screenAnswer("after the talk I want to end my life").verdict, "risk_stop");
});
Deno.test("kind answers with a moment pass the screen", () => {
  for (const t of kind) assertEquals(screenAnswer(t.text).verdict, "ok", t.text);
});

Deno.test("ask me strings are constants, no banned words, nothing evaluative, the moments question names a moment", () => {
  const all = Object.values(ASK_ME_STRINGS).map((v) => typeof v === "function" ? v(3) : v);
  for (const v of all) assert(!/\b(please|should|healthy|unhealthy|toxic|fix|improve|wrong|better)\b/i.test(v) && !v.includes("!"), v);
  assertEquals(ASK_ME_STRINGS.endorsement_mark(3), "Came up in 3 answers");
  assertEquals(endorsementMark(3, { kenningWording: "Quiet means I'm thinking." }), "Came up in 3 answers");
  assert(/seen me do/.test(ASK_ME_STRINGS.card_question_example));
});

Deno.test("PSY (2): sensitive words flag, not drop; 'party' and 'body' alone trigger nothing", () => {
  assertEquals(screenAnswer("you helped me when I was sick").verdict, "flagged");
  assertEquals(screenAnswer("you brought food to the party and made sure the new people had someone to talk to").verdict, "ok");
  assertEquals(screenAnswer("you listened when the whole body of the team went quiet after the call").verdict, "ok");
  assertEquals(screenAnswer("after the call you commented on my body shape").verdict, "dropped"); // looks sense stays a whole drop
  assertEquals(screenAnswer("when you joined the political party you stayed up late helping").verdict, "flagged");
  const set = [A("j", "you helped me when I was sick"), A("y", "walked the dog alone after dinner"), A("z", "listened after the argument")];
  // no moment-only step: whole drop, as before
  assertEquals(buildCards(set, [], { linkClosed: true }).cards.some((c) => c.answer_ids.includes("j")), false);
  // with the step: the moment survives, the detail does not; a rewrite that is still sensitive is dropped
  const ok = buildCards(set, [], { linkClosed: true, momentOnly: () => "you helped when they needed it" });
  assert(ok.cards.some((c) => c.answer_ids.includes("j")));
  const bad = buildCards(set, [], { linkClosed: true, momentOnly: () => "you helped when they were sick" });
  assertEquals(bad.cards.some((c) => c.answer_ids.includes("j")), false);
});

Deno.test("PSY hostile set (fixture): G stops, J never drops whole, word screen never decides A-F/I (reader step, after 00:00Z 15 Nov)", async () => {
  const d = JSON.parse(await Deno.readTextFile(new URL("../fixtures/ask_me/hostile_set.json", import.meta.url)));
  assert(d.cases.length >= 40);
  for (const c of d.cases) {
    const v = screenAnswer(c.text).verdict;
    if (c.expect === "safety_stop") assertEquals(v, "risk_stop", c.id);
    if (c.expect === "card") assert(v === "ok" || v === "flagged", `${c.id} dropped: ${v}`);
  }
});
Deno.test("risk in other words is stopped; ordinary talk of home and waking is not", () => {
  for (const t of ["after dinner you said you won't be around much longer", "you flinched when he raised his hand"]) assertEquals(screenAnswer(t).verdict, "risk_stop", t);
  for (const t of ["you waited at home after the flight and woke me up", "you stayed around after the party to help clear up"]) assert(screenAnswer(t).verdict !== "risk_stop", t);
});

// PSY 14 Nov (2) 50-kind check (engine 02:05Z 15 Nov): an irregular past action is a moment too; these sentences are not in the 50 set.
Deno.test("screen: an irregular past action is a moment (made, gave, sat, took, met, drove, wrote, taught, paid)", () => {
  for (const t of ["You made tea for the whole team on the hard days.", "You gave my brother a lift to the station.", "You sat next to me at the dull work dinner.",
    "You took the late train just to see my show.", "You met us at the airport with sandwiches.", "You drove four hours to help us move.",
    "You wrote down the recipe for me.", "You taught my niece to ride a bike.", "You paid for the coffees without making a thing of it."]) {
    assertEquals(screenAnswer(t).verdict, "ok", t);
  }
  // Still a label with no moment: dropped.
  assertEquals(screenAnswer("You are lovely and generous.").reason, "no_moment");
});
