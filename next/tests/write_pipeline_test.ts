import { assertEquals } from "jsr:@std/assert@1";
import { runWritePipeline, tierOneNote } from "../engine/bridge/write_pipeline.ts";
import type { ModelClient } from "../engine/model/client.ts";

const base = {
  sender: { name: "Ari", items: [{ id: "mine", kind: "matters", words: "Being direct matters to me." }] },
  receiver: {
    name: "Noor",
    items: [{ id: "theirs", kind: "bring_up", words: "Starting with the moment helps me listen." }],
  },
};

Deno.test("Write v3: logistics and short drafts are silent before any model call", async () => {
  const a = await runWritePipeline({
    ...base,
    draft: "Can you pick up milk after work?",
    purpose: "logistics",
  }, { mode: "mock" });
  const b = await runWritePipeline({ ...base, draft: "Please call", purpose: "raise a problem" }, {
    mode: "mock",
  });
  assertEquals([a.tier, a.calls, b.tier, b.calls], [0, 0, 0, 0]);
});

Deno.test("Write v3: receiver context wins, sender fallback is tier 2, and first session suppresses tier 2", async () => {
  const receiver = await runWritePipeline({
    ...base,
    draft: "When the plan changed this morning I felt left out.",
    purpose: "raise a problem",
  }, { mode: "mock" });
  const sender = await runWritePipeline({
    ...base,
    receiver: { name: "Noor", items: [] },
    draft: "When the plan changed this morning I felt left out.",
    purpose: "raise a problem",
  }, { mode: "mock" });
  const first = await runWritePipeline({
    ...base,
    receiver: { name: "Noor", items: [] },
    firstSession: true,
    draft: "When the plan changed this morning I felt left out.",
    purpose: "raise a problem",
  }, { mode: "mock" });
  assertEquals([receiver.tier, receiver.itemId, sender.tier, sender.itemId, first.tier], [
    3,
    "theirs",
    2,
    "mine",
    0,
  ]);
});

function client(replies: string[]): ModelClient {
  return {
    complete: (request) =>
      Promise.resolve({
        purpose: request.purpose,
        request: {
          model: request.model ?? "test",
          system: request.system,
          messages: request.messages,
          maxTokens: request.maxTokens,
        },
        rawResponse: replies.shift() ?? "",
        usage: { model: "test", inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 },
      }),
  };
}

Deno.test("Write v3: verifier plus exact code checks are required before a note is returned", async () => {
  const replies = [
    JSON.stringify({
      purpose: "raise a problem",
      phrases: ["When the plan changed this morning"],
      item_ids: ["theirs"],
    }),
    JSON.stringify({
      note: 'Noor shared "Starting with the moment helps me listen."',
      phrase: "When the plan changed this morning",
      item_id: "theirs",
      suggested_change: "When the plan changed this morning",
    }),
    JSON.stringify({
      grounded: "yes",
      specific: "yes",
      soften_only: "yes",
      information_not_rule: "yes",
      sender_voice: "yes",
      nothing_clinical: "yes",
    }),
  ];
  const c = client(replies);
  const out = await runWritePipeline({
    ...base,
    draft: "When the plan changed this morning I felt left out.",
  }, { mode: "real", clients: { read: c, write: c, verify: c } });
  assertEquals([out.tier, out.itemId, out.calls], [3, "theirs", 3]);

  const bad = client([
    JSON.stringify({
      purpose: "raise a problem",
      phrases: ["When the plan changed this morning"],
      item_ids: ["theirs"],
    }),
    JSON.stringify({
      note: 'Noor shared "Starting with the moment helps me listen."',
      phrase: "invented phrase",
      item_id: "theirs",
    }),
  ]);
  const dropped = await runWritePipeline({
    ...base,
    draft: "When the plan changed this morning I felt left out.",
  }, { mode: "real", clients: { read: bad, write: bad, verify: bad } });
  assertEquals([dropped.tier, dropped.calls], [0, 2]);
});

Deno.test("Write v3: tier 1 uses only the existing general friction menu", () => {
  const note = tierOneNote("You always decide without me.", "You always decide without me");
  assertEquals([note?.tier, note?.itemId, note?.note?.includes("General:")], [1, null, true]);
});
