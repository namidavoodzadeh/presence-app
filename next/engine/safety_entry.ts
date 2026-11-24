// Law 8, QA-B336 (COO 02:20Z 16 Nov, PSY 1d): ONE safety entry for every surface that takes a person's words. Floor first, then
// the semantic check (one Sonnet reading, about 0.15 cent); a floor row in a benign class clears only on the two-key rule
// (safety_classes.ts + two agreeing readings). It FAILS CLOSED: a reading that is unavailable (error, timeout, cap) or unreadable
// stops the message with the law 8 resources, never passes it. Any layer can add a stop; none can clear one except the two keys.
//
// `semantic: false` is the API's PRESENCE_SAFETY_SEMANTIC switch off (hosted today): the floor decides alone, exactly as before.
// With the switch on and no client, the entry stops (nothing can be read, so nothing passes).

import type { ModelExchange, Risk } from "./types.ts";
import type { ModelClient } from "./model/client.ts";
import { keywordRisk, stops } from "./safety.ts";
import { AIMED_AT_RECEIVER } from "./bridge/insight.ts";
import { candidateClasses, settleClear } from "./safety_classes.ts";
import { classReadings, semanticRisk } from "./safety_semantic.ts";
import type { SemanticRisk } from "./safety_semantic.ts";

// "unavailable" (PSY 16 Nov 2c): no reading said stop, at least one could not answer, the floor was silent. Still a stop for every caller
// that tests `routed !== "none"` (nothing is stored, sent or mapped), but NOT a risk: the person sees the "couldn't read" state, not the resources.
export type Routed = "none" | "risk" | "threat_or_abuse" | "unavailable";

export interface EntryResult {
  /** True when the words must not be used, stored, mapped or carried. */
  stop: boolean;
  risk: Risk;
  /** Bridge's two stops: harm aimed at the receiver is a threat; any other stop shows resources. */
  routed: Routed;
  reason: string;
  /** True when the stop is only because no reading was available (fail closed). */
  unavailable: boolean;
  /** How it ended: floor, semantic, class_cleared, unavailable, clear, floor_only. */
  via: "floor" | "semantic" | "class_cleared" | "unavailable" | "clear" | "floor_only";
  exchanges: ModelExchange[];
  cents: number;
  /** Readings that could not answer (cap, timeout, unreadable), counted even when the stop stands anyway. The x10 gate fails on any. */
  readingsUnavailable: number;
}

export interface EntryOptions {
  /** False = the switch is off: the floor decides alone. */
  semantic: boolean;
  signal?: AbortSignal;
}

function routedFor(risk: Risk, text: string): Routed {
  if (risk === "none") return "none";
  return risk === "others" && AIMED_AT_RECEIVER.test(text) ? "threat_or_abuse" : "risk";
}

function done(text: string, risk: Risk, reason: string, via: EntryResult["via"], exchanges: ModelExchange[], unavailable = false, readingsUnavailable = 0): EntryResult {
  const cents = exchanges.reduce((n, e) => n + e.usage.cents, 0);
  return { stop: risk !== "none", risk, routed: unavailable ? "unavailable" : routedFor(risk, text), reason, unavailable, via, exchanges, cents, readingsUnavailable };
}

/** The single entry. Never throws: every failure is a stop. */
export async function safetyEntry(client: ModelClient | null, text: string, options: EntryOptions): Promise<EntryResult> {
  const floor = keywordRisk(text);
  if (!options.semantic) return done(text, floor.risk, floor.reason, "floor_only", []);
  const exchanges: ModelExchange[] = [];
  const keep = (rs: SemanticRisk[]) => { for (const r of rs) if (r.exchange) exchanges.push(r.exchange); };
  const opts = options.signal ? { signal: options.signal } : {};
  if (stops(floor)) {
    // A floor stop stands unless it is a candidate row of a benign class and two different readings both clear it.
    if (!client || !candidateClasses(text, floor).length) return done(text, floor.risk, floor.reason, "floor", exchanges);
    const both = await classReadings(client, text, opts);
    keep(both);
    const cleared = settleClear(text, floor, both);
    const down = both.filter((r) => !r.ok).length;
    if (cleared) return done(text, "none", `cleared: ${cleared}`, "class_cleared", exchanges, false, down);
    return done(text, floor.risk, floor.reason, "floor", exchanges, false, down);
  }
  if (!client) return done(text, "self", "safety check unavailable: no model client", "unavailable", exchanges, true, 1);
  const r = await semanticRisk(client, text, opts);
  keep([r]);
  if (!r.ok) return done(text, "self", r.reason, "unavailable", exchanges, true, 1);
  if (r.risk !== "none") return done(text, r.risk, r.reason, "semantic", exchanges);
  return done(text, "none", "no risk read", "clear", exchanges);
}

/** Several texts (Ask me's answers), one entry each, in parallel. Same order out as in. */
export function safetyEntries(client: ModelClient | null, texts: string[], options: EntryOptions): Promise<EntryResult[]> {
  return Promise.all(texts.map((t) => safetyEntry(client, t, options)));
}
