import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  AnthropicClient,
  cacheableBody,
  CappedModelClient,
  cents,
  EFFORT_SETTINGS,
  extractJson,
  modelSetting,
  rateNote,
  RecordedClient,
  THINKING_SETTINGS,
  usageCents,
  usageCentsExact,
  worstCaseCents,
} from "../engine/model/client.ts";
import type { Ledger } from "../engine/model/ledger.ts";

class MemoryLedger implements Ledger {
  events: string[] = [];
  refuse = false;
  reserve(_nonce: string, kind: string, worst: number) {
    this.events.push(`reserve ${kind} ${worst}`);
    return Promise.resolve({ ok: !this.refuse, error: this.refuse ? "budget_unavailable" : undefined });
  }
  settle(_n: string, spent: number, receipt: string | null) {
    this.events.push(`settle ${spent} ${receipt ?? "-"}`);
    return Promise.resolve();
  }
}

function fakeFetch(
  handler: (body: Record<string, unknown>) => { status: number; json: unknown },
): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const r = handler(body);
    return Promise.resolve(new Response(JSON.stringify(r.json), { status: r.status }));
  }) as typeof fetch;
}

function fakeStreamFetch(
  events: Record<string, unknown>[],
  bodies: Record<string, unknown>[] = [],
): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const payload = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
      .join("");
    return Promise.resolve(
      new Response(payload, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  }) as typeof fetch;
}

const config = { key: "test-key-never-printed", workspace: "ws" };
const req = {
  purpose: "turn",
  system: "sys",
  messages: [{ role: "user" as const, content: "hello" }],
  maxTokens: 100,
};

Deno.test("extractJson reads a bare object, a fenced object, and an object inside prose", () => {
  assertEquals(extractJson('{"a":1}'), { a: 1 });
  assertEquals(extractJson('```json\n{"a":"x}y"}\n```'), { a: "x}y" });
  assertEquals(extractJson('Sure: {"a":{"b":[1,2]}} done'), { a: { b: [1, 2] } });
});

Deno.test("pricing: cents round up; unpriced IDs take the worst case", () => {
  assertEquals(cents("claude-sonnet-5", 1000, 100), 1); // 0.3 + 0.15 → 1
  assertEquals(cents("claude-haiku-5-5", 100000, 10000), 15);
  assertEquals(cents("claude-unknown", 1000, 100), 1);
  assertEquals(worstCaseCents(req, "claude-sonnet-5") >= 1, true);
});

Deno.test("prompt caching marks tools, fixed system text, and the moving conversation prefix without changing text", () => {
  const body = cacheableBody({
    ...req,
    messages: [{ role: "user", content: "belief map" }, { role: "assistant", content: "earlier reply" }, {
      role: "user",
      content: "latest turn",
    }],
    tools: [{ name: "lookup", description: "Read the map", input_schema: { type: "object" } }],
  }, "claude-sonnet-5-5");
  assertEquals(body.system, [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
  assertEquals(body.tools, [{
    name: "lookup",
    description: "Read the map",
    input_schema: { type: "object" },
    cache_control: { type: "ephemeral" },
  }]);
  const messages = body.messages as { role: string; content: Record<string, unknown>[] }[];
  assertEquals(messages.map((m) => m.content[0].text), ["belief map", "earlier reply", "latest turn"]);
  assertEquals(messages[0].content[0].cache_control, undefined);
  assertEquals(messages[2].content[0].cache_control, { type: "ephemeral" });
});

Deno.test("cache usage is priced at write/read rates and retained on a reply", async () => {
  assertEquals(usageCents("claude-sonnet-5-5", 0, 0, 1_000_000, 0), 375);
  assertEquals(usageCents("claude-sonnet-5-5", 0, 0, 0, 1_000_000), 15);
  const bodies: Record<string, unknown>[] = [];
  const client = new AnthropicClient({
    config,
    ledger: new MemoryLedger(),
    fetchImpl: fakeFetch((body) => {
      bodies.push(body);
      return {
        status: 200,
        json: {
          id: "msg_cache",
          content: [{ type: "text", text: "{}" }],
          usage: {
            input_tokens: 20,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 2000,
            output_tokens: 10,
          },
        },
      };
    }),
  });
  const result = await client.complete(req);
  assertEquals(result.usage.cacheCreationInputTokens, 1000);
  assertEquals(result.usage.cacheReadInputTokens, 2000);
  assertEquals(result.usage.cents, usageCents("claude-sonnet-5-5", 20, 10, 1000, 2000));
  assertEquals((bodies[0].system as Record<string, unknown>[])[0].cache_control, { type: "ephemeral" });
});

Deno.test("a 200 reply is settled at its usage and the text comes back raw", async () => {
  const ledger = new MemoryLedger();
  const client = new AnthropicClient({
    config,
    ledger,
    fetchImpl: fakeFetch(() => ({
      status: 200,
      json: {
        id: "msg_1",
        content: [{ type: "text", text: '{"ok":true}' }],
        usage: { input_tokens: 2000, output_tokens: 500 },
      },
    })),
  });
  const x = await client.complete(req);
  assertEquals(x.rawResponse, '{"ok":true}');
  assertEquals(x.usage.cents, cents("claude-sonnet-5-5", 2000, 500));
  assertEquals(ledger.events[0].startsWith("reserve next-engine "), true);
  assertEquals(ledger.events[1], `settle ${usageCentsExact("claude-sonnet-5-5", 2000, 500)} msg_1`);
  assertEquals(x.usage.cents, 2, "the trace keeps the whole-cent figure; the ledger settles the fraction (1.35 cents)");
  assertEquals(x.error, undefined);
});

Deno.test("a streamed reply keeps raw deltas server-side and settles the complete exchange", async () => {
  const ledger = new MemoryLedger();
  const bodies: Record<string, unknown>[] = [];
  const deltas: string[] = [];
  let firstTokens = 0;
  const client = new AnthropicClient({
    config,
    ledger,
    fetchImpl: fakeStreamFetch([
      {
        type: "message_start",
        message: {
          id: "msg_stream",
          usage: { input_tokens: 120, cache_creation_input_tokens: 80, cache_read_input_tokens: 40 },
        },
      },
      { type: "content_block_start", content_block: { type: "text", text: "" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: '{"risk":{"level":"none"},' } },
      { type: "content_block_delta", delta: { type: "text_delta", text: '"reflection":"Dinner moved."}' } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } },
      { type: "message_stop" },
    ], bodies),
  });
  const result = await client.complete(req, {
    onFirstToken: () => {
      firstTokens++;
    },
    onDelta: (delta) => {
      deltas.push(delta);
    },
  });
  assertEquals(bodies[0].stream, true);
  assertEquals(deltas, ['{"risk":{"level":"none"},', '"reflection":"Dinner moved."}']);
  assertEquals(firstTokens, 1);
  assertEquals(result.rawResponse, '{"risk":{"level":"none"},"reflection":"Dinner moved."}');
  assertEquals(result.usage.inputTokens, 120);
  assertEquals(result.usage.outputTokens, 40);
  assertEquals(result.usage.cacheCreationInputTokens, 80);
  assertEquals(result.usage.cacheReadInputTokens, 40);
  assertEquals(result.usage.stopReason, "end_turn");
  assertEquals(result.usage.blocks, ["text"]);
  assertEquals(ledger.events.at(-1)?.startsWith("settle "), true);
  assertEquals(Number(ledger.events.at(-1)?.split(" ")[1]) <= result.usage.cents, true, "exact settling never exceeds the rounded-up figure");
});

Deno.test("barge-in aborts the admitted provider request and settles it conservatively", async () => {
  const ledger = new MemoryLedger();
  const controller = new AbortController();
  const fetchImpl =
    ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")));
      })) as typeof fetch;
  const client = new AnthropicClient({ config, ledger, fetchImpl });
  const pending = client.complete(req, { signal: controller.signal, onDelta: () => {} });
  await Promise.resolve();
  controller.abort("barge-in");
  const result = await pending;
  assertEquals(result.error, "cancelled");
  assertEquals(result.usage.cents > 0, true);
  assertEquals(ledger.events.length, 2);
  assertEquals(ledger.events[0].startsWith("reserve next-engine "), true);
  assertEquals(ledger.events[1].startsWith("settle "), true);
});

Deno.test("a refused reservation makes no network call", async () => {
  const ledger = new MemoryLedger();
  ledger.refuse = true;
  let calls = 0;
  const client = new AnthropicClient({
    config,
    ledger,
    fetchImpl: fakeFetch(() => {
      calls++;
      return { status: 200, json: {} };
    }),
  });
  const x = await client.complete(req);
  assertEquals(calls, 0);
  assertEquals(x.error, "budget_unavailable: budget_unavailable");
});

Deno.test("an unknown model ID falls back once to claude-sonnet-5 and the trace says so", async () => {
  const ledger = new MemoryLedger();
  const models: string[] = [];
  const client = new AnthropicClient({
    config,
    ledger,
    fetchImpl: fakeFetch((body) => {
      models.push(String(body.model));
      if (body.model === "claude-sonnet-5-5") {
        return {
          status: 404,
          json: { type: "error", error: { type: "not_found_error", message: "model: claude-sonnet-5-5" } },
        };
      }
      return {
        status: 200,
        json: {
          id: "msg_2",
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      };
    }),
  });
  const x = await client.complete(req);
  assertEquals(models, ["claude-sonnet-5-5", "claude-sonnet-5"]);
  assertEquals(x.usage.model, "claude-sonnet-5");
  assertEquals(x.error?.startsWith("fell back from claude-sonnet-5-5"), true);
  assertEquals(ledger.events, [
    "reserve next-engine 1",
    "settle 0 -",
    "reserve next-engine 1",
    `settle ${usageCentsExact("claude-sonnet-5", 10, 5)} msg_2`,
  ]);
  assertEquals(client.resolvedModel, "claude-sonnet-5");
});

Deno.test("the recorded client replays in order and refuses to invent", async () => {
  const client = new RecordedClient({ turn: ["one", "two"] });
  assertEquals((await client.complete(req)).rawResponse, "one");
  assertEquals((await client.complete(req)).rawResponse, "two");
  await assertRejects(() => client.complete(req), Error, "no reply left");
});

Deno.test("thinking and effort settings go on the wire only when set, and the trace records block types and the stop reason", async () => {
  const bodies: Record<string, unknown>[] = [];
  const reply = {
    id: "msg_3",
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"ok":true}' }],
    usage: { input_tokens: 100, output_tokens: 900 },
  };
  const plain = new AnthropicClient({
    config,
    ledger: new MemoryLedger(),
    fetchImpl: fakeFetch((body) => {
      bodies.push(body);
      return { status: 200, json: reply };
    }),
  });
  const x = await plain.complete(req);
  assertEquals(bodies[0].stream, undefined);
  assertEquals(bodies[0].thinking, undefined);
  assertEquals(bodies[0].output_config, undefined);
  assertEquals(x.usage.blocks, ["thinking", "text"]);
  assertEquals(x.usage.stopReason, "end_turn");
  assertEquals(x.rawResponse, '{"ok":true}');
  assertEquals(x.request.thinking, undefined);

  const off = new AnthropicClient({
    config,
    ledger: new MemoryLedger(),
    thinking: "between_tools",
    effort: "low",
    fetchImpl: fakeFetch((body) => {
      bodies.push(body);
      return { status: 200, json: reply };
    }),
  });
  const y = await off.complete(req);
  assertEquals(bodies[1].thinking, { type: "between_tools" });
  assertEquals(bodies[1].output_config, { effort: "low" });
  assertEquals(y.request.thinking, "between_tools");
  assertEquals(y.request.effort, "low");
});

Deno.test("modelSetting accepts a known value, keeps the fallback when unset, and refuses anything else before a paid call", () => {
  assertEquals(modelSetting(undefined, THINKING_SETTINGS, "default"), "default");
  assertEquals(modelSetting("between_tools", THINKING_SETTINGS, "default"), "between_tools");
  assertEquals(modelSetting("disabled", THINKING_SETTINGS, "default"), "disabled");
  assertEquals(modelSetting(undefined, EFFORT_SETTINGS, null), null);
  assertThrows(() => modelSetting("off", THINKING_SETTINGS, "default"), Error, "unknown setting");
});

Deno.test("a model named on purpose is never swapped: with no fallback a refusal comes back as the error and no second call is made", async () => {
  const ledger = new MemoryLedger();
  const models: string[] = [];
  const client = new AnthropicClient({
    config,
    ledger,
    defaultModel: "claude-haiku-5-5",
    fallbackModel: null,
    fetchImpl: fakeFetch((body) => {
      models.push(String(body.model));
      return {
        status: 404,
        json: { type: "error", error: { type: "not_found_error", message: "model: claude-haiku-5-5" } },
      };
    }),
  });
  const x = await client.complete(req);
  assertEquals(models, ["claude-haiku-5-5"]);
  assertEquals(x.error?.startsWith("model_not_found"), true);
  assertEquals(client.resolvedModel, null);
});

Deno.test("rateNote names the row that priced the model and whether it is listed, assumed or the worst case", () => {
  assertEquals(rateNote("claude-haiku-5-5").includes("100/500¢ per million in/out (listed)"), true);
  assertEquals(rateNote("claude-sonnet-5-5").includes("(assumed equal to claude-sonnet-5"), true);
  assertEquals(rateNote("claude-unknown").includes("worst case"), true);
});

Deno.test("a capped model client refuses before a request whose worst case could cross the run cap", async () => {
  let calls = 0;
  const inner = {
    complete: () => {
      calls++;
      return Promise.resolve({
        purpose: req.purpose,
        request: { model: "claude-sonnet-5-5", ...req },
        rawResponse: "{}",
        usage: { model: "claude-sonnet-5-5", inputTokens: 1, outputTokens: 1, cents: 1, ms: 1 },
      });
    },
  };
  const capped = new CappedModelClient(inner, 1, "claude-sonnet-5-5");
  assertEquals((await capped.complete(req)).error, undefined);
  const refused = await capped.complete(req);
  assertEquals(calls, 1);
  assertEquals(capped.spent < 0.01, true);
  assertEquals(refused.error, "budget_unavailable: run cap 1¢; spent 0¢; next request reserves 1¢");
});

Deno.test("a capped model client counts the provider's bill, not a whole cent per call (B336 x10 cap exhausted after ~200 calls)", async () => {
  let calls = 0;
  const inner = {
    complete: () => {
      calls++;
      return Promise.resolve({
        purpose: req.purpose,
        request: { model: "claude-haiku-5-5", ...req },
        rawResponse: "{}",
        usage: { model: "claude-haiku-5-5", inputTokens: 600, outputTokens: 20, cents: 1, ms: 1 },
      });
    },
  };
  const capped = new CappedModelClient(inner, 20, "claude-haiku-5-5");
  for (let i = 0; i < 100; i++) assertEquals((await capped.complete(req)).error, undefined);
  assertEquals(calls, 100);
  assertEquals(Math.round(capped.spent * 100) / 100, 7); // 100 x 0.07¢; the old count said 100¢ and refused at 20 calls
});

Deno.test("usageCentsExact is the provider's bill; usageCents is its round-up", () => {
  // A safety reading: 600 in, 20 out on Haiku 5.5 (100/500 cents per million) = 0.07 cents; the old ledger counted 1.
  assertEquals(Math.round(usageCentsExact("claude-haiku-5-5", 600, 20) * 1e6) / 1e6, 0.07);
  assertEquals(usageCents("claude-haiku-5-5", 600, 20), 1);
  assertEquals(usageCentsExact("claude-sonnet-5-5", 0, 0, 1_000_000, 0), 375);
  assertEquals(usageCentsExact("claude-sonnet-5-5", 2000, 500), 1.35);
});
