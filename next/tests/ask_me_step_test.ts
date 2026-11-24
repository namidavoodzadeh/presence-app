// Ask me model step (PSY 14 Nov (1), (2)): composition with the floor, fail closed, the moment guards, and a prompt free of test
// sentences. $0: every model answer here is recorded. Real-model numbers come from scripts/ask_me_step_check.ts.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import type { ModelClient, ModelRequest } from "../engine/model/client.ts";
import { buildCards, screenAnswer } from "../api/lib/ask_me.ts";
import type { Answer } from "../api/lib/ask_me.ts";
import { ASK_ME_STEP_PROMPT, ASK_ME_STEP_PURPOSE, askMeStep, longestCopiedRun, readStep, runAskMeStep } from "../api/lib/ask_me_step.ts";

const keep = (moment: string) => JSON.stringify({ keep: true, moment, why: "act" });
const drop = (why: string) => JSON.stringify({ keep: false, moment: null, why });
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

Deno.test("ask_me step: the prompt holds no sentence and no five-word run from the hostile set or the 50 kind answers", async () => {
  const hostile = JSON.parse(await Deno.readTextFile(new URL("../fixtures/ask_me/hostile_set.json", import.meta.url))).cases.map((c: { text: string }) => c.text);
  const kind = JSON.parse(await Deno.readTextFile(new URL("../fixtures/ask_me/kind_answers_50.json", import.meta.url))).answers as string[];
  // Also every sentence in ask_me_test.ts (its 100+ hostile list and its kind answers), read from the source.
  const src = await Deno.readTextFile(new URL("./ask_me_test.ts", import.meta.url));
  const fromSource = [...src.matchAll(/"([^"\\\n]{20,})"|'([^'\\\n]{20,})'/g)].map((m) => m[1] ?? m[2]);
  assert(fromSource.length > 100, `read ${fromSource.length} sentences from ask_me_test.ts`);
  const prompt = words(ASK_ME_STEP_PROMPT);
  for (const t of [...hostile, ...kind, ...fromSource]) {
    const w = words(t);
    for (let i = 0; i + 5 <= w.length; i++) {
      const run = w.slice(i, i + 5).join(" ");
      assert(!` ${prompt.join(" ")} `.includes(` ${run} `), `prompt holds "${run}" from: ${t}`);
    }
  }
});

Deno.test("ask_me step: a readable verdict is a verdict; a kept answer needs a short moment about the owner in its own words", () => {
  const a = "You stayed late to help me pack when I moved.";
  assertEquals(readStep(keep("you stayed to help someone move"), a), { ok: true, keep: true, moment: "you stayed to help someone move", why: "act" });
  assertEquals(readStep(drop("sarcasm"), a), { ok: true, keep: false, moment: null, why: "sarcasm" });
  assertEquals(readStep('```json\n{"keep":false}\n```', a).ok, true);
  for (const bad of ["fine", '{"keep":"yes","moment":"you helped"}', '{"keep":true}', '{"keep":true,"moment":""}']) assertEquals(readStep(bad, a).ok, false, bad);
  assertEquals(readStep(keep("they stayed to help someone move"), a).ok, false, "not about the owner");
  assertEquals(readStep(keep("you " + "really ".repeat(16) + "helped"), a).ok, false, "too long");
  // Law 12: never the answer word for word.
  assertEquals(readStep(keep("You stayed late to help me pack when I moved."), a).ok, false);
  assertEquals(readStep(keep("you stayed late to help me pack"), a).ok, false, "six words copied in order");
  assertEquals(longestCopiedRun("you stayed late to help someone pack", a), 5);
  assertEquals(readStep(keep("you stayed late to help someone pack"), a).ok, true);
});

Deno.test("ask_me step: an error, a timeout, an unreadable reply or a throwing client is unavailable, never a keep", async () => {
  const erroring: ModelClient = { complete: (req: ModelRequest) => Promise.resolve({ purpose: req.purpose, request: { model: "x", system: req.system, messages: req.messages, maxTokens: req.maxTokens }, rawResponse: "", error: "timeout", usage: { model: "x", inputTokens: 0, outputTokens: 0, cents: 1, ms: 0 } }) };
  assertEquals((await askMeStep(erroring, "You helped me move.")).ok, false);
  assertEquals((await askMeStep(new RecordedClient({}), "You helped me move.")).ok, false); // no reply queued: throws
  assertEquals((await askMeStep(new RecordedClient({ [ASK_ME_STEP_PURPOSE]: ["I'd keep it"] }), "You helped me move.")).ok, false);
});

Deno.test("ask_me step: only answers the floor lets through are read; risk stops are never sent; drops and failures drop the answer", async () => {
  const answers: Answer[] = [
    { id: "a1", text: "You stayed late to help me pack when I moved.", device: "d1" },
    { id: "a2", text: "You brought soup over when I was sick with the flu.", device: "d2" }, // flagged: health
    { id: "a3", text: "You gave a long speech at the dinner and people kept checking the time.", device: "d3" },
    { id: "a4", text: "You listened when I said I want to kill myself.", device: "d4" }, // risk: never sent
    { id: "a5", text: "Kind.", device: "d5" }, // floor drop: never sent
    { id: "a6", text: "You fixed my bike chain before the race.", device: "d6" },
    { id: "a7", text: "You stayed late at work to cover my shift.", device: "d1" }, // same device as a1: one answer per device
  ];
  assertEquals(screenAnswer(answers[1].text).verdict, "flagged");
  assertEquals(screenAnswer(answers[3].text).verdict, "risk_stop");
  const seen: string[] = [];
  const replies = new Map<string, string>([
    [answers[0].text, keep("you stayed to help someone move house")],
    [answers[1].text, keep("you brought food to someone who needed it")],
    [answers[2].text, drop("belittling")],
    [answers[5].text, "not json"],
  ]);
  const client: ModelClient = {
    complete: (req: ModelRequest) => {
      const text = String(req.messages[0].content).replace(/^ANSWER:\n/, "");
      seen.push(text);
      return Promise.resolve({ purpose: req.purpose, request: { model: "r", system: req.system, messages: req.messages, maxTokens: req.maxTokens }, rawResponse: replies.get(text) ?? "", usage: { model: "r", inputTokens: 0, outputTokens: 0, cents: 1, ms: 0 } });
    },
  };
  const run = await runAskMeStep(client, answers, { concurrency: 2 });
  assertEquals(seen.sort(), [answers[0].text, answers[1].text, answers[2].text, answers[5].text].sort());
  assertEquals([run.calls, run.cents, run.unavailable], [4, 4, 1]);
  assertEquals(run.reasons, { kept: 2, "dropped:belittling": 1, unavailable: 1 });
  assertEquals(run.moments.get("a3"), null);
  assertEquals(run.moments.get("a6"), null);
  assert(!run.moments.has("a4") && !run.moments.has("a5"));

  const r = buildCards(answers, [], { moments: run.moments, linkClosed: true, holdHardSingles: false });
  assertEquals(r.stopped, ["a4"]);
  assertEquals(r.cards.map((c) => c.answer_ids).flat().sort(), ["a1", "a2"]);
});

Deno.test("ask_me step: with moments given, a missing entry drops, and a moment that fails the floor again drops", () => {
  const answers: Answer[] = [
    { id: "b1", text: "You stayed late to help me pack when I moved.", device: "d1" },
    { id: "b2", text: "You fixed my bike chain before the race.", device: "d2" },
    { id: "b3", text: "You brought food to the party for the new people.", device: "d3" },
  ];
  const moments = new Map<string, string | null>([
    ["b1", "you helped someone pack up their home"],
    ["b3", "you brought medication to someone"], // still flagged: dropped
  ]);
  const r = buildCards(answers, [], { moments, linkClosed: true, holdHardSingles: false });
  assertEquals(r.cards.map((c) => c.answer_ids).flat(), ["b1"]);
  // Without moments the floor alone decides, as before.
  assertEquals(buildCards(answers, [], { linkClosed: true, holdHardSingles: false }).cards.length, 3);
});
