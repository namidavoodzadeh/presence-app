// COO 07:20Z 16 Nov (PSY 4b): nothing the model says reaches the person before the safety reading returns. With the semantic check on,
// the streamed delta is held until the reading is back, readable and clear; a stop or an unreadable reading never releases it.
// Real talkTurn, a hand-made client whose safety reading settles when the test says so, $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { ModelClient, ModelRequest, ModelStreamObserver } from "../engine/model/client.ts";
import type { ModelExchange } from "../engine/types.ts";
import { holdUntilSafetyRead, talkTurn } from "../engine/talk/turn.ts";
import type { TurnState } from "../engine/talk/turn.ts";
import type { SemanticRisk } from "../engine/safety_semantic.ts";

const SAID = "Dinner moved again and nobody asked me first.";
const REPLY = JSON.stringify({ risk: { level: "none", reason: "" }, feeling: "neutral", title: null, permission_domain: null,
  reflection: "Dinner moved without anyone asking you.", question: "What did you do when the new time came through?",
  move: { kind: "follow", why: "first turn", gap: "self: unknown" }, beliefs: [] });
const safetyRaw = (risk: string) => JSON.stringify({ act: "an ordinary evening", purpose: "neither", risk, class: "ordinary", reason: risk === "none" ? "nothing" : "says so" });

const state = (): TurnState => ({ person: { firstName: "Marin", language: "en", about: [] }, map: { beliefs: [], consent: {}, openThreads: [] },
  session: { id: "s1", date: "2026-11-16", turns: [] }, previous: [], hypotheses: new Map() });

const exchange = (req: ModelRequest, raw: string, error?: string): ModelExchange => ({
  purpose: req.purpose, request: { model: "t", system: req.system, messages: req.messages, maxTokens: req.maxTokens },
  rawResponse: raw, ...(error ? { error } : {}), usage: { model: "t", inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 },
});

/** The turn call streams its whole reply at once; the safety reading settles only when `settle` is called. */
function client(log: string[]) {
  let settle!: (raw: string | Error) => void;
  const safety = new Promise<string | Error>((r) => { settle = r; });
  const c: ModelClient = {
    async complete(req, stream?: ModelStreamObserver) {
      if (req.purpose === "safety") {
        const raw = await safety;
        log.push("safety-returned");
        if (raw instanceof Error) throw raw;
        return exchange(req, raw);
      }
      await stream?.onDelta?.(REPLY, REPLY, 5);
      log.push("turn-streamed");
      return exchange(req, REPLY);
    },
  };
  return { c, settle };
}

Deno.test("the held delta is forwarded only after a clear safety reading, and the turn waits for nothing extra", async () => {
  const log: string[] = [];
  const { c, settle } = client(log);
  const observer: ModelStreamObserver = { onDelta: () => { log.push("delta-forwarded"); } };
  const run = talkTurn(c, state(), SAID, 1, observer, "told", { semanticCheck: true });
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(log, ["turn-streamed"], "the model finished streaming; nothing was forwarded yet");
  settle(safetyRaw("none"));
  const trace = await run;
  assertEquals(trace.shown.state, "turn");
  assertEquals(log, ["turn-streamed", "safety-returned", "delta-forwarded"]);
});

Deno.test("a stop reading never releases the held text", async () => {
  const log: string[] = [];
  const { c, settle } = client(log);
  const observer: ModelStreamObserver = { onDelta: () => { log.push("delta-forwarded"); } };
  const run = talkTurn(c, state(), SAID, 1, observer, "told", { semanticCheck: true });
  settle(safetyRaw("self"));
  const trace = await run;
  assertEquals(trace.shown.state, "safety");
  assert(!log.includes("delta-forwarded"), `forwarded before/after a stop: ${log}`);
});

Deno.test("an unreadable reading never releases the held text", async () => {
  const log: string[] = [];
  const { c, settle } = client(log);
  const observer: ModelStreamObserver = { onDelta: () => { log.push("delta-forwarded"); } };
  const run = talkTurn(c, state(), SAID, 1, observer, "told", { semanticCheck: true });
  settle(new Error("reader down"));
  const trace = await run;
  assertEquals(trace.shown.state, "unavailable");
  assert(!log.includes("delta-forwarded"), `forwarded with no reading: ${log}`);
});

Deno.test("with the check off (hosted today) nothing is held", async () => {
  const log: string[] = [];
  const { c } = client(log);
  const observer: ModelStreamObserver = { onDelta: () => { log.push("delta-forwarded"); } };
  await talkTurn(c, state(), SAID, 1, observer, "told", { semanticCheck: false });
  assertEquals(log, ["delta-forwarded", "turn-streamed"]);
});

Deno.test("holdUntilSafetyRead: later deltas pass straight through once released; no observer or no onDelta passes unchanged", async () => {
  const seen: string[] = [];
  const read = { ok: true, risk: "none" } as SemanticRisk;
  const held = holdUntilSafetyRead({ onDelta: (_d, acc) => { seen.push(acc); } }, Promise.resolve(read))!;
  held.onDelta!("a", "a", 1);          // before the microtask that releases
  await Promise.resolve(); await Promise.resolve();
  held.onDelta!("b", "ab", 2);
  assertEquals(seen, ["a", "ab"]);
  assertEquals(holdUntilSafetyRead(undefined, Promise.resolve(read)), undefined);
  const bare: ModelStreamObserver = { onFirstToken: () => {} };
  assert(holdUntilSafetyRead(bare, Promise.resolve(read)) === bare);
});
