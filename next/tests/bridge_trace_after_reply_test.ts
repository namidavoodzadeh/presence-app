// QA-B298 (b): the trace write leaves the reply's critical path. $0, no model, no database: a fake client records inserts.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { drainAfterReply, traceAfterReply, traceExchange } from "../api/bridge_engine.ts";
import type { ModelExchange } from "../engine/types.ts";

const exchange = (): ModelExchange => ({ purpose: "bridge_analyse", request: { model: "m", system: "s", messages: [{ role: "user", content: "a draft" }], maxTokens: 10 },
  rawResponse: "{}", usage: { model: "m", inputTokens: 1, outputTokens: 1, cents: 0, ms: 1 } });

function fakeCtx(insert: () => Promise<{ error: { message: string } | null }>, log: string[]) {
  return { service: { from: (t: string) => ({ insert: async () => { log.push(`insert:${t}`); return await insert(); } }) } } as never;
}
const scope = { person: "p", ownerPreview: false, conversationId: null, feature: "bridge" } as never;
const ledger = { ids: new Map([["a", "id-1"]]) } as never;

Deno.test("traceAfterReply returns before a slow write finishes, and the write still lands", async () => {
  const log: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const ctx = fakeCtx(async () => { await gate; log.push("done"); return { error: null }; }, log);
  traceAfterReply(ctx, scope, ledger, [exchange()], true);
  await new Promise((r) => setTimeout(r, 5));
  assert(!log.includes("done"), "the caller was not held for the write");
  release();
  await drainAfterReply();
  assertEquals(log.filter((l) => l === "done").length, 1);
  assertEquals(log.filter((l) => l.startsWith("insert:")).length, 1);
});

Deno.test("a failing trace write is swallowed, never raised to the reply", async () => {
  const log: string[] = [];
  const ctx = fakeCtx(() => Promise.reject(new Error("db down")), log);
  const orig = console.error; console.error = () => {};
  try {
    traceAfterReply(ctx, scope, ledger, [exchange()]);
    await drainAfterReply();
  } finally { console.error = orig; }
  assertEquals(log.length, 1);
});

Deno.test("safety traces keep the redacted receipt but omit the fixed 7 KiB prompt", async () => {
  const prompt = "fixed safety instruction ".repeat(400);
  const safety = { ...exchange(), purpose: "safety", request: { ...exchange().request, system: prompt } };
  const stored = await traceExchange(safety, true);
  assertEquals(stored.request.system, "[fixed safety reader prompt; see release source]");
  assert(stored.request.messages[0].content.startsWith("[deleted once processed: "));
  assert(stored.rawResponse.startsWith("[deleted once processed: "));
  assert(stored.usage.model === "m");
});
