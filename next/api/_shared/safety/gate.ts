// Law 8, spec docs/spec/safety-stop.md section A and D (K-0002): the ONE enforcement point every next/api route with a free-text
// field calls first, before it stores, maps, carries or sends anything. Order: backstop phrases (a hit is STOP, no model call), then
// the existing classifier (gateWords -> safetyEntry) with a 3 s timeout and one retry. If both tries fail and the backstop was silent,
// the result is "unavailable" (hold the message, "Couldn't send. Try again.", no crisis sheet). The text never goes forward unchecked.
// Thresholds and the classifier prompt are K-0003's, not this file's. The text is never logged.
import type { Ctx } from "../../lib/router.ts";
import { gateWords } from "../../lib/safety_gate.ts";
import type { EntryResult } from "../../../engine/safety_entry.ts";
import backstop from "./backstop.json" with { type: "json" };
import { PostgresLedger } from "../../lib/ledger.ts";
import type { LedgerScope } from "../../lib/ledger.ts";
import { clientFor, trace } from "../../bridge_engine.ts";
import { AIMED_AT_RECEIVER } from "../../../engine/bridge/insight.ts";
import { CLASSIFIER_VERSION, classifyExchange } from "./classifier.ts";
import type { Classification, Label } from "./classifier.ts";

export const GATE_TIMEOUT_MS = 3000;
export const GATE_RETRIES = 1;
export const BACKSTOP_MAX = 25;

export type { EntryResult, Label };
/** What requireSafetyPass returns: the entry result plus the label. HELD = nothing could read it (hold, "Couldn't send. Try again."). */
export type GateResult = EntryResult & { label: Label | "HELD" };

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const PHRASES: { phrase: string; target: "self" | "other" }[] = [
  ...backstop.self.map((p) => ({ phrase: norm(p), target: "self" as const })),
  ...backstop.other.map((p) => ({ phrase: norm(p), target: "other" as const })),
];
if (PHRASES.length > BACKSTOP_MAX) throw new Error(`backstop.json has ${PHRASES.length} phrases; the maximum is ${BACKSTOP_MAX}`);

/** The backstop alone: a first-person phrase hit, or null. */
export function backstopHit(text: string): "self" | "other" | null {
  const t = ` ${norm(text)} `;
  for (const p of PHRASES) if (t.includes(` ${p.phrase} `)) return p.target;
  return null;
}

function stopResult(target: "self" | "other"): GateResult {
  return {
    label: "STOP",
    stop: true, risk: target === "self" ? "self" : "others", routed: "risk", reason: "backstop phrase", unavailable: false,
    via: "floor", exchanges: [], cents: 0, readingsUnavailable: 0,
  };
}
function unavailableResult(): GateResult {
  return {
    label: "HELD",
    stop: true, risk: "none", routed: "unavailable", reason: "no reading", unavailable: true,
    via: "unavailable", exchanges: [], cents: 0, readingsUnavailable: 1,
  };
}

/** The signal is aborted when this gate's bounded attempt expires.  Readers that call a
 * provider must pass it through, so a retry never leaves the earlier model call running. */
export type Read = (text: string, signal?: AbortSignal) => Promise<EntryResult & { label?: Label | "HELD" }>;
export interface GateOptions { timeoutMs?: number; retries?: number }

async function withTimeout(read: Read, text: string, ms: number): Promise<(EntryResult & { label?: Label | "HELD" }) | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      // K-0152: a timed-out safety read used to keep running while the one
      // retry started.  That doubled the provider, ledger and trace work in a
      // single Edge request.  Abort it before the retry; an abort is HELD,
      // never PASS.
      controller.abort();
      resolve(null);
    }, ms);
  });
  try { return await Promise.race([read(text, controller.signal).catch(() => null), late]); } finally { clearTimeout(timer); }
}

/** The gate proper, with the reader injected (tests drive it directly). Never throws; every failure is a stop. */
export async function runGate(read: Read, text: string, screen: string, opts: GateOptions = {}): Promise<GateResult> {
  const t0 = performance.now();
  const hit = backstopHit(text);
  let out: GateResult;
  let via = "classifier";
  if (hit) { out = stopResult(hit); via = "backstop"; } else {
    let r: (EntryResult & { label?: Label | "HELD" }) | null = null;
    for (let i = 0; i <= (opts.retries ?? GATE_RETRIES) && !r; i++) {
      const got = await withTimeout(read, text, opts.timeoutMs ?? GATE_TIMEOUT_MS);
      if (got && !got.unavailable) r = got;
    }
    out = r ? { ...r, label: r.label ?? (r.stop ? "STOP" : "PASS") } : unavailableResult();
    if (!r) via = "failed";
  }
  // Counts and labels only; never the text (spec I).
  const label = out.label;
  console.info(JSON.stringify({ safety_gate: { label, target: out.risk === "self" ? "self" : out.risk === "others" ? "other" : "none", screen, via, classifier: CLASSIFIER_VERSION, latency_ms: Math.round(performance.now() - t0) } }));
  return out;
}

/** The classifier's answer as an entry result. CHECK holds the message exactly as STOP does (nothing stored or sent); `label` tells the
 *  app which screen to show (spec B: CHECK maps to STOP if the tier is ever removed, never to PASS). */
export function resultFor(c: Classification, text: string): EntryResult & { label: Label } {
  const risk = c.label === "PASS" ? "none" : c.target === "other" ? "others" : "self";
  const routed = risk === "none" ? "none" : risk === "others" && AIMED_AT_RECEIVER.test(text) ? "threat_or_abuse" : "risk";
  return { label: c.label, stop: risk !== "none", risk, routed, reason: c.reason, unavailable: false, via: c.label === "PASS" ? "clear" : "semantic",
    exchanges: [], cents: 0, readingsUnavailable: 0 };
}

/** Second layer (spec E): Talk and Bridge return safety_flag: true when they see risk the gate passed. A flag is treated as CHECK. */
export function applySafetyFlag(r: GateResult, flag: unknown): GateResult {
  if (flag !== true || r.label === "STOP" || r.label === "CHECK" || r.label === "HELD") return r;
  return { ...r, label: "CHECK", stop: true, risk: "self", routed: "risk", reason: "second layer flag", via: "semantic" };
}

function classifierRead(ctx: Ctx, text: string, priorTurns: string[], person: string | null): Read {
  return async (t, signal) => {
    const scope: LedgerScope = { person: ctx.caller?.id ?? person, ownerPreview: ctx.caller?.isPreview ?? false, conversationId: null };
    const ledger = new PostgresLedger(ctx.service, scope);
    let client;
    try { client = clientFor(ctx, ledger, "insight"); } catch { return unavailableResult(); }
    const { classification, exchange } = await classifyExchange(client, t, priorTurns, { signal });
    if (exchange) { try { await trace(ctx, scope, ledger, [exchange], null, true); } catch { /* diagnostics only */ } }
    if (!classification) return unavailableResult();
    return { ...resultFor(classification, text), exchanges: exchange ? [exchange] : [], cents: exchange?.usage.cents ?? 0 };
  };
}

/** requireSafetyPass(text, screen, priorTurns): the caller (a route handler) supplies ctx for billing and the model client.
 *  Callers test `r.stop` (nothing may be stored or sent), `r.routed === "unavailable"` (show "Couldn't send. Try again."), and `r.label`
 *  (CHECK shows the short are-you-safe screen, STOP the stop sheet). With the semantic switch off the floor decides alone unless a
 *  safety-critical surface explicitly forces its reader on. */
export function requireSafetyPass(ctx: Ctx, text: string, screen: string, priorTurns: string[] = [], person: string | null = null, forceSemantic = false): Promise<GateResult> {
  if ((ctx.env.safetySemantic === true || forceSemantic) && ctx.env.safetyClassifier === true) return runGate(classifierRead(ctx, text, priorTurns, person), text, screen);
  return runGate((t, signal) => gateWords(ctx, t, person, forceSemantic, signal), text, screen);
}
