// A $0 stand-in for the Bridge model calls: analysis by simple patterns with exact quotes, a mechanical rewrite,
// a passing critic. It exercises the pipeline, the checks and the report; it is never used for the proof run.

import type { ModelExchange } from "../types.ts";
import type { ModelClient, ModelRequest } from "../model/client.ts";

const SUBS: [RegExp, string, string][] = [
  [/\balways\b/i, "absolute", "again this week"],
  [/\bpathetic\s+disappearing act\b/i, "contempt", "no-show"],
  [/\byou clearly don't care that\b/i, "mind_reading", "It felt like it didn't matter that"],
  [/\bthat's obviously fine\b/i, "sarcasm", "that's not fine with me"],
  [/^stop\s+/i, "demand", "I want you to stop "],
  [/\bthen at the christening, and now\b/i, "blame_stack", "then at the christening. Today"],
  [/\byou're being controlling about the kitchen too\b/i, "character", "you've been weighing in on the kitchen too, and I want that decided with us, not for us"],
  [/\bcan't keep being the one who holds everything together\b/i, "vague_ask", "can't keep being the one who holds everything together"],
];

export class FakeBridgeClient implements ModelClient {
  complete(req: ModelRequest): Promise<ModelExchange> {
    return Promise.resolve({ purpose: req.purpose, request: { model: "fake", system: req.system, messages: req.messages, maxTokens: req.maxTokens },
      rawResponse: this.#reply(req), usage: { model: "fake", inputTokens: 0, outputTokens: 0, cents: 0, ms: 1 } });
  }
  #reply(req: ModelRequest): string {
    const text = req.messages[0]?.content ?? "";
    if (req.purpose.startsWith("analyse")) {
      const message = (text.match(/# MESSAGE[^\n]*\n([\s\S]*?)\n\n# THE SENDER/) ?? [])[1] ?? "";
      const ids = [...text.matchAll(/^- (\S+) "/gm)].map((m) => m[1]);
      const sentences = message.split(/(?<=[.!?])\s+/).filter(Boolean);
      const points = sentences.map((s) => ({ kind: /\?$/.test(s) ? "question" : /^(?:i felt|i'm|i can't|i just)/i.test(s) ? "feeling" : "complaint", quote: s }));
      const frictions = SUBS.flatMap(([re, kind]) => { const m = re.exec(message); return m ? [{ kind, quote: m[0] }] : []; });
      return JSON.stringify({ points, feeling: { name: "fed up", intensity: 3 }, frictions, activated: ids.length ? [{ beliefId: ids[0], why: "fake: first listed" }] : [], safety: { level: "none", reason: "fake" } });
    }
    if (req.purpose.startsWith("rewrite")) {
      const original = (text.match(/# ORIGINAL[^\n]*\n([\s\S]*?)\n\n# REGISTER/) ?? [])[1] ?? "";
      const hasContext = !/\(none; contextNote must be null\)/.test(text);
      let bridged = original;
      const changes: { kind: string; from: string; to: string }[] = [];
      for (const [re, kind, to] of SUBS) { const m = re.exec(bridged); if (m) { changes.push({ kind, from: m[0], to }); bridged = bridged.replace(re, to); } }
      return JSON.stringify({ bridged, contextNote: hasContext ? "This lands on something old for me." : null, changes });
    }
    if (req.purpose.startsWith("verify")) return JSON.stringify({ pass: true, pointsMissing: [], added: [], receiverInnerLife: [], voice: 4, feelingPreserved: true, notes: "fake" });
    return "{}";
  }
}
