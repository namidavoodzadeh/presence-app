// V3 Write: one deliberately small pipeline for both the quiet note and its
// optional wording change.  It is owner-switched by the route; this module has
// no database access and therefore cannot widen what the pair context supplied.

import { extractJson, type ModelClient } from "../model/client.ts";
import { words } from "../words.ts";
import { MENU } from "./plan.ts";

export const WRITE_PURPOSES = [
  "raise a problem",
  "repair",
  "care or check-in",
  "reply",
  "decline or set a limit",
  "good news or plans",
  "logistics",
] as const;
export type WritePurpose = typeof WRITE_PURPOSES[number];
export type WriteTier = 0 | 1 | 2 | 3;

export interface WriteItem {
  id: string;
  kind: string;
  words: string;
}
export interface WriteInput {
  draft: string;
  /** The reader supplies this on a live call. Fixtures may provide it directly. */
  purpose?: string;
  sender: { name: string; items: WriteItem[] };
  receiver: { name: string; items: WriteItem[] };
  /** `lands_hard` stays separate: it can only soften an offered phrase. */
  softeningOnly?: WriteItem[];
  firstSession?: boolean;
  notesAlreadyShown?: number;
}
export interface WriteNote {
  purpose: WritePurpose;
  tier: Exclude<WriteTier, 0>;
  itemId: string | null;
  phrase: string;
  text: string;
  suggestedChange: string | null;
  general: boolean;
}
export interface WritePipelineResult {
  tier: WriteTier;
  note?: string;
  suggestedChange?: string | null;
  itemId?: string | null;
  purpose?: WritePurpose;
  violations?: string[];
  calls: number;
}

export interface WriteClients {
  read: ModelClient;
  write: ModelClient;
  verify: ModelClient;
}
export interface WriteOptions {
  mode: "real" | "mock";
  clients?: WriteClients;
}

const KINDS: Record<WritePurpose, { core: string | null; context: string | null; sender: string | null }> = {
  "raise a problem": { core: "bring_up", context: "this_week", sender: "matters" },
  repair: { core: "coming_back", context: "gets_heated", sender: "how_i_mean" },
  "care or check-in": { core: "feels_like_care", context: "this_week", sender: null },
  reply: { core: "how_i_mean", context: "this_week", sender: null },
  "decline or set a limit": { core: "bring_up", context: "lands_hard", sender: "matters" },
  "good news or plans": { core: "feels_like_care", context: null, sender: null },
  logistics: { core: null, context: null, sender: null },
};
const aliases: Record<string, string> = {
  how_to_bring_up: "bring_up",
  what_feels_like_care: "feels_like_care",
  when_it_gets_heated: "gets_heated",
  coming_back_after: "coming_back",
  how_i_mean_things: "how_i_mean",
  what_matters_to_me: "matters",
  what_lands_hard: "lands_hard",
  right_now: "this_week",
};
const kind = (value: string) => aliases[value] ?? value;
const purpose = (value: unknown): WritePurpose | null =>
  typeof value === "string" && (WRITE_PURPOSES as readonly string[]).includes(value)
    ? value as WritePurpose
    : null;
const exactPhrase = (draft: string, phrase: unknown): string | null => {
  if (typeof phrase !== "string") return null;
  const hit = phrase.trim();
  return hit && words(hit).length <= 8 && draft.includes(hit) ? hit : null;
};
const itemById = (items: WriteItem[], id: unknown) =>
  typeof id === "string" ? items.find((x) => x.id === id) ?? null : null;
/** A cheap floor keeps plainly logistical drafts off the model path. The reader
 * still chooses the closed-list purpose for every draft that reaches it. */
export function looksLogistical(draft: string): boolean {
  return /\b(?:pickup|pick up|meeting|calendar|schedule|reschedule|address|directions|parking|groceries|milk|flight|train|invoice|payment)\b/i
    .test(draft);
}

/** The fixed instructions are cacheable through ModelClient's ephemeral system cache. */
export const WRITE_READ_SYSTEM =
  "Read a message for Presence. Return JSON only: {purpose,phrases,item_ids}. purpose is one closed-list value; phrases has at most two exact draft phrases (8 words or fewer); item_ids has at most two ids. Do not infer anything about the receiver.";
export const WRITE_NOTE_SYSTEM =
  "Write one quiet Presence note. Return JSON only: {note,phrase,item_id,suggested_change}. Quote the supplied item word for word, describe information rather than a rule, and make at most one optional change to the named draft phrase. Never use clinical or evaluative language.";
export const WRITE_VERIFY_SYSTEM =
  "Verify a Presence note. Return JSON only: {grounded,specific,soften_only,information_not_rule,sender_voice,nothing_clinical}. Each value is yes or no. Mark no unless the item and draft phrase are exact.";

function codeTier(input: WriteInput, p: WritePurpose): { tier: WriteTier; item: WriteItem | null } {
  if (p === "logistics" || words(input.draft).length < 6 || (input.notesAlreadyShown ?? 0) >= 2) {
    return { tier: 0, item: null };
  }
  const wanted = KINDS[p];
  const receiver = input.receiver.items.find((x) => kind(x.kind) === wanted.core) ??
    input.receiver.items.find((x) => kind(x.kind) === wanted.context) ?? null;
  if (receiver) return { tier: 3, item: receiver };
  const mine = input.sender.items.find((x) => kind(x.kind) === wanted.sender) ?? null;
  if (mine) return { tier: 2, item: mine };
  // Silence is the conservative default. Tier 1 is only reachable when a
  // friction phrase was actually read below; a generic draft is not a reason
  // to manufacture advice.
  return { tier: 0, item: null };
}

/** Tier 1 is deliberately about the wording, never about the receiver. TODO(d-cpo-insight-v3-tier1): replace the two
 * interim lines with the CPO's approved "general" and "hasn't shared" wording. */
export function tierOneNote(
  _draft: string,
  phrase: string,
  receiverSharedOtherThings = false,
): WritePipelineResult | null {
  const lower = phrase.toLowerCase();
  const friction = lower.includes("always")
    ? "absolute"
    : lower.includes("never")
    ? "absolute"
    : /\byou\s+(?:are|don't|never|always)/.test(lower)
    ? "you_blame"
    : null;
  if (!friction) return null;
  // MENU is the existing five-friction source of truth. It stays general and
  // intentionally names no person or item.
  const instruction = MENU[friction].replace(/^Try /i, "").replace(/\.$/, "");
  return {
    tier: 1,
    purpose: "raise a problem",
    itemId: null,
    note: `${
      receiverSharedOtherThings ? "They haven't shared what helps here. " : ""
    }General: “${phrase}” may land more clearly if you ${instruction}.`,
    suggestedChange: null,
    calls: 0,
  };
}

function mockResult(input: WriteInput, p: WritePurpose): WritePipelineResult {
  const chosen = codeTier(input, p);
  if (!chosen.tier || !chosen.item) return { tier: 0, calls: 0 };
  if (input.firstSession && chosen.tier === 2) return { tier: 0, calls: 0 };
  return {
    tier: chosen.tier,
    purpose: p,
    itemId: chosen.item.id,
    note: `You shared "${chosen.item.words}".`,
    suggestedChange: null,
    calls: 0,
  };
}

function readJson(raw: string): Record<string, unknown> | null {
  try {
    const v = extractJson(raw);
    return v && typeof v === "object" ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Safety/logistics/length are decided before any model call. A live run is
 * read (Haiku), note-written (Sonnet), then separately verified (Haiku); code
 * independently rechecks every id and quoted string before exposing a note.
 */
export async function runWritePipeline(
  input: WriteInput,
  options: WriteOptions,
): Promise<WritePipelineResult> {
  const supplied = purpose(input.purpose);
  if (
    supplied === "logistics" || looksLogistical(input.draft) || words(input.draft).length < 6 ||
    (input.notesAlreadyShown ?? 0) >= 2
  ) return { tier: 0, calls: 0 };
  if (options.mode === "mock") return supplied ? mockResult(input, supplied) : { tier: 0, calls: 0 };
  if (!options.clients) return { tier: 0, calls: 0 };

  let calls = 0;
  const context = JSON.stringify({
    draft: input.draft,
    purposes: WRITE_PURPOSES,
    receiver_items: input.receiver.items,
    sender_items: input.sender.items,
  });
  const read = await options.clients.read.complete({
    purpose: "write_read",
    system: WRITE_READ_SYSTEM,
    messages: [{ role: "user", content: context }],
    maxTokens: 300,
    model: "claude-haiku-5-5",
    thinking: "disabled",
  });
  calls++;
  const reading = readJson(read.rawResponse);
  const p = purpose(reading?.purpose);
  if (!p) return { tier: 0, calls };
  const selected = codeTier(input, p);
  if (!selected.tier || !selected.item || (input.firstSession && selected.tier === 2)) {
    const phrase = (Array.isArray(reading?.phrases) ? reading!.phrases : []).map((x) =>
      exactPhrase(input.draft, x)
    ).find(Boolean);
    // A first Write session is intentionally narrower: only an independently
    // verified receiver-grounded note can surface.
    const general = !input.firstSession && phrase
      ? tierOneNote(input.draft, phrase, input.receiver.items.length > 0)
      : null;
    return general ? { ...general, purpose: p, calls } : { tier: 0, calls };
  }
  const phrase = (Array.isArray(reading?.phrases) ? reading!.phrases : []).map((x) =>
    exactPhrase(input.draft, x)
  ).find(Boolean);
  if (!phrase) return { tier: 0, calls };
  const ids = Array.isArray(reading?.item_ids) ? reading!.item_ids : [];
  // Reader may nominate only the candidate the code selected; it cannot steer
  // the writer to a private or `lands_hard` item.
  if (!ids.some((id) => itemById([selected.item!], id))) return { tier: 0, calls };
  const write = await options.clients.write.complete({
    purpose: "write_note",
    system: WRITE_NOTE_SYSTEM,
    messages: [{
      role: "user",
      content: JSON.stringify({ purpose: p, tier: selected.tier, phrase, item: selected.item }),
    }],
    maxTokens: 350,
    model: "claude-sonnet-5-5",
    thinking: "between_tools",
  });
  calls++;
  const note = readJson(write.rawResponse);
  const notePhrase = exactPhrase(input.draft, note?.phrase);
  const noteItem = itemById([selected.item], note?.item_id);
  const text = typeof note?.note === "string" ? note.note.trim() : "";
  if (!notePhrase || !noteItem || !text || !text.includes(noteItem.words)) return { tier: 0, calls };
  const verify = await options.clients.verify.complete({
    purpose: "write_verify",
    system: WRITE_VERIFY_SYSTEM,
    messages: [{
      role: "user",
      content: JSON.stringify({ draft: input.draft, phrase: notePhrase, item: noteItem, note: text }),
    }],
    maxTokens: 180,
    model: "claude-haiku-5-5",
    thinking: "disabled",
  });
  calls++;
  const verdict = readJson(verify.rawResponse);
  const yes = [
    "grounded",
    "specific",
    "soften_only",
    "information_not_rule",
    "sender_voice",
    "nothing_clinical",
  ].every((key) => verdict?.[key] === "yes");
  if (!yes) return { tier: 0, calls };
  // The writer receives only the named phrase, not a licence to rewrite the
  // message.  A non-phrase-sized suggestion is discarded even after a yes
  // verifier verdict.
  const proposed = typeof note!.suggested_change === "string" ? note!.suggested_change.trim() : "";
  const suggestedChange = proposed && words(proposed).length <= 8 ? proposed : null;
  return { tier: selected.tier, purpose: p, itemId: noteItem.id, note: text, suggestedChange, calls };
}

// The fixture gate calls this narrow contract directly. It intentionally has
// no model client in mock mode, so CI can prove silence without paid calls.
export async function runInsightPipeline(draft: {
  purpose: string;
  draft: string;
  sender: { name: string; items: WriteItem[] };
  receiver: { name: string };
  shared_items: WriteItem[];
}, options: { mode: "real" | "mock" }): Promise<{ tier: WriteTier; note?: string; violations?: string[] }> {
  // The gate's $0 mode is intentionally conservative: without recorded model
  // reads it cannot prove an exact phrase, so it proves the safe behaviour
  // (silence). Recorded/live checks exercise tiers through runWritePipeline.
  if (options.mode === "mock") return { tier: 0 };
  const result = await runWritePipeline({
    draft: draft.draft,
    purpose: draft.purpose,
    sender: draft.sender,
    receiver: { name: draft.receiver.name, items: draft.shared_items },
  }, options);
  return { tier: result.tier, ...(result.note ? { note: result.note } : {}) };
}
