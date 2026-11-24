// System design item 7: a stored Talk trace keeps no words the person said. The same rule as Import ("[deleted after import stage]")
// and Mirror (length + sha256 prefix): once a turn is processed the package's messages and the raw reply are replaced by a
// placeholder that still lets a run be matched to a message without its words. The system prompt, model, tokens, cents and
// latency stay: they hold nothing personal and are what a cost or latency check needs.
import type { ModelExchange } from "../types.ts";

async function placeholder(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return `[deleted once processed: ${text.length} characters, sha256 ${hex}]`;
}

export const isRedacted = (text: string): boolean => text.startsWith("[deleted once processed: ");

export async function redactTalkExchange(exchange: ModelExchange): Promise<ModelExchange> {
  const messages = await Promise.all(exchange.request.messages.map(async (m) => ({
    ...m,
    content: isRedacted(m.content) ? m.content : await placeholder(m.content),
  })));
  const rawResponse = isRedacted(exchange.rawResponse) ? exchange.rawResponse : await placeholder(exchange.rawResponse);
  return { ...exchange, rawResponse, request: { ...exchange.request, messages } };
}
