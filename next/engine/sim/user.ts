// The simulated user: a model plays a persona and talks naturally. Its private note goes to the trace only.

import type { CardShown, ModelExchange, Rating, ShownTurn } from "../types.ts";
import type { ModelClient, ModelMessage } from "../model/client.ts";
import { extractJson } from "../model/client.ts";

import { SIM_USER } from "../prompt_text.ts";
export const USER_PROMPT = SIM_USER;

export interface PersonaBelief { id: string; statement: string; level: string; domains: string[]; evidence: string }
export interface Persona {
  id: string;
  name: string;
  age?: number;
  style: string;
  biography: string;
  boundaries: string[];
  beliefs: PersonaBelief[];
  edges?: { from: string; to: string; type: string }[];
}

export interface SimReply {
  message: string;
  ratings: Record<string, Rating>;
  permission: "ok" | "not_now" | "never" | null;
  note: string;
  exchange: ModelExchange;
  /** A first reply that hit its output limit mid-JSON (040846Z c8 t1, Mika at 500 tokens): kept here, retried once asking for less. */
  retries?: ModelExchange[];
  failed: string | null;
}

export const MAX_SIM_TOKENS = 1200;

function cutOff(x: ModelExchange): boolean {
  return x.usage.outputTokens > 0 && x.usage.outputTokens >= x.request.maxTokens;
}

export async function loadPersonas(root: URL): Promise<Persona[]> {
  const data = JSON.parse(await Deno.readTextFile(new URL("next/fixtures/personas.json", root)));
  return data.personas as Persona[];
}

export function personaSheet(p: Persona, scripted?: string): string {
  const beliefs = p.beliefs.map((b) => `- ${b.id} (${b.level}; ${b.domains.join(", ")}): ${b.statement} — you might say: "${b.evidence}"`).join("\n");
  return `# PERSON\nName: ${p.name}${p.age ? `, ${p.age}` : ""}. Speaking style: ${p.style}.\n${p.biography}\n` +
    `Won't discuss (answer Never if asked): ${p.boundaries.length ? p.boundaries.join(", ") : "nothing in particular"}.\n` +
    `Hidden beliefs (never recite them):\n${beliefs}` + (scripted ? `\n\nSCRIPTED MOMENT for this turn: ${scripted}` : "");
}

function describeShown(shown: ShownTurn): string {
  if (shown.state === "safety") return `The app stopped and showed support resources: "${shown.safety?.message ?? ""}"`;
  const lines: string[] = [];
  if (shown.reflection) lines.push(`App: ${shown.reflection}`);
  if (shown.question) lines.push(`App: ${shown.question}`);
  if (shown.state === "permission") lines.push(`(The app is asking permission to talk about ${shown.permissionDomain}. Answer Sure, Not now or Never.)`);
  const card = (c: CardShown) => `Card ${c.beliefId} "${c.label}": ${c.statement} [${c.type}] — Is this you? Not me · Partly · Very me`;
  for (const c of shown.cards) lines.push(card(c));
  if (shown.earlyGuess) lines.push(`Early guess: ${card(shown.earlyGuess)}`);
  return lines.join("\n") || "(the app showed nothing)";
}

export async function simulatedTurn(client: ModelClient, persona: Persona, history: { person: string; shown: ShownTurn }[],
  opener: string | null, scripted?: string): Promise<SimReply> {
  const messages: ModelMessage[] = [{ role: "user", content: personaSheet(persona, scripted) + "\n\nThe conversation follows. Reply as this person." }];
  messages.push({ role: "assistant", content: "Understood. I'll answer as this person with one JSON object." });
  if (history.length === 0) {
    messages.push({ role: "user", content: opener ? `App: ${opener}\n\nYou open the conversation now: say what is on your mind today.` : "You open the conversation now: say what is on your mind today, as this person." });
  } else {
    for (const h of history) {
      messages.push({ role: "assistant", content: JSON.stringify({ message: h.person }) });
      messages.push({ role: "user", content: describeShown(h.shown) });
    }
  }
  // The scripted moment is also the freshest instruction, not only a line in the sheet: in run 040846Z c9 t3 the sheet alone was
  // ignored and Yuki never mentioned the meals and sleep, so the permission ask and the Never answer never happened.
  if (scripted) messages[messages.length - 1] = { role: "user", content: `${messages[messages.length - 1].content}\n\nSCRIPTED MOMENT: this turn you must also ${scripted[0].toLowerCase()}${scripted.slice(1)} Say it in your own words and style, inside this reply.` };
  let exchange = await client.complete({ purpose: "sim_user", system: USER_PROMPT, messages, maxTokens: MAX_SIM_TOKENS });
  const retries: ModelExchange[] = [];
  if (cutOff(exchange)) {
    retries.push(exchange);
    const again: ModelMessage[] = [...messages, { role: "assistant", content: exchange.rawResponse || "(empty)" },
      { role: "user", content: "That reply was cut off before its JSON ended. Answer the same turn again as this person, shorter: one JSON object, a message of at most 120 words, a note of one line." }];
    exchange = await client.complete({ purpose: "sim_user_retry", system: USER_PROMPT, messages: again, maxTokens: MAX_SIM_TOKENS });
  }
  const reply: SimReply = { message: "", ratings: {}, permission: null, note: "", exchange, retries, failed: null };
  if (cutOff(exchange)) { reply.failed = `reply cut off at ${exchange.request.maxTokens} output tokens, twice`; return reply; }
  if (exchange.error && !exchange.rawResponse) { reply.failed = exchange.error; return reply; }
  if (readSimReply(exchange.rawResponse, reply)) return reply;
  // An unreadable reply that was not cut off (072112Z c2 t9: the object ended at end_turn without its closing brace): one retry.
  retries.push(exchange);
  const again: ModelMessage[] = [...messages, { role: "assistant", content: exchange.rawResponse || "(empty)" },
    { role: "user", content: "That reply was not a complete JSON object. Answer the same turn again as this person: ONE complete JSON object with message, ratings, permission and note, nothing else." }];
  exchange = await client.complete({ purpose: "sim_user_retry", system: USER_PROMPT, messages: again, maxTokens: MAX_SIM_TOKENS });
  reply.exchange = exchange;
  if (exchange.error && !exchange.rawResponse) { reply.failed = exchange.error; return reply; }
  if (!readSimReply(exchange.rawResponse, reply)) reply.failed = reply.failed ?? "no readable reply, twice";
  return reply;
}

/** Fill the reply from the raw text; true when a message was read. An unterminated object still yields its "message" field. */
function readSimReply(raw: string, reply: SimReply): boolean {
  reply.failed = null;
  try {
    let parsed: Record<string, unknown>;
    try { parsed = extractJson(raw) as Record<string, unknown>; }
    catch { parsed = extractJson(escapeControlInStrings(raw)) as Record<string, unknown>; }   // 072112Z c8 t9: a raw newline inside the message
    reply.message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    reply.note = typeof parsed.note === "string" ? parsed.note.trim() : "";
    const permission = parsed.permission;
    reply.permission = permission === "ok" || permission === "not_now" || permission === "never" ? permission : null;
    const ratings = (parsed.ratings && typeof parsed.ratings === "object") ? parsed.ratings as Record<string, unknown> : {};
    for (const [id, r] of Object.entries(ratings)) if (r === "very_me" || r === "partly" || r === "not_me") reply.ratings[id] = r;
    if (!reply.message) reply.failed = "empty message";
    return reply.message.length > 0;
  } catch (e) {
    const text = escapeControlInStrings(raw);
    const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
    if (m && m[1].trim()) {
      reply.message = JSON.parse(`"${m[1]}"`).trim();
      const r = /"ratings"\s*:\s*(\{[^}]*\})/.exec(text);
      if (r) { try { for (const [id, v] of Object.entries(JSON.parse(r[1]))) if (v === "very_me" || v === "partly" || v === "not_me") reply.ratings[id] = v; } catch { /* ratings unreadable; the message stands */ } }
      const p = /"permission"\s*:\s*"(ok|not_now|never)"/.exec(text);
      reply.permission = p ? p[1] as SimReply["permission"] : null;
      reply.note = `(salvaged from an unterminated object: ${e})`;
      return true;
    }
    reply.failed = `no readable reply: ${e}`;
    return false;
  }
}

/** Raw newlines, tabs and other control characters inside JSON string literals become their escapes; text outside strings is untouched. */
export function escapeControlInStrings(raw: string): string {
  let out = "", inString = false, escaped = false;
  for (const ch of raw) {
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) { out += code === 10 ? "\\n" : code === 13 ? "\\r" : code === 9 ? "\\t" : ""; continue; }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}
