// Finish: one consolidation call (one card per belief, a short summary, one gentle line for next time),
// then reconciliation against the existing map: same belief → new receipt; explicit contradiction → tension.

import { BELIEF_TYPES, DOMAINS, LEVELS, TYPE_FOR_LEVEL } from "../types.ts";
import type { Belief, BeliefType, CheckResult, Domain, Feeling, Level, LinkType, ModelExchange, PersonMap, Rating } from "../types.ts";
import type { ModelClient, ModelMessage } from "../model/client.ts";
import { extractJson } from "../model/client.ts";
import { cardWordHits, isExactSubstring, normalise, words } from "../words.ts";
import { contextPackage } from "./context.ts";
import type { TurnState } from "./turn.ts";
import { newId } from "./turn.ts";
import { labelProblem, shortLabel } from "./checks.ts";

/** What a risk stop leaves behind instead of Finish (A48 Q48(b) → iii; law 8). */
export interface RiskStopTrace {
  turn: number;                 // the turn whose risk stopped mapping
  kept: string[];               // ids of the cards rated Very me / Partly before that turn, now on the map as-is
  leftOut: string[];            // rated hypotheses not kept (Not me, or still unrated), with the reason
  finishCalled: false;
}

/**
 * A risk stop ends the session in the resources state: no Finish (no consolidation, summary or guidance), nothing
 * from the risk turn, and the cards the person already rated Very me / Partly before it stay on the map exactly as
 * they were shown — unmerged, wording and receipts untouched — because they were confirmed before the stop.
 */
export function keepRatedOnRiskStop(state: TurnState, ratings: Map<string, Rating>, riskTurn: number): RiskStopTrace {
  const out: RiskStopTrace = { turn: riskTurn, kept: [], leftOut: [], finishCalled: false };
  for (const h of state.hypotheses.values()) {
    const rating = ratings.get(h.id);
    const fromRiskTurn = h.receipts.some((r) => r.sessionId === state.session.id && r.turn >= riskTurn);
    if (fromRiskTurn) { out.leftOut.push(`${h.id}: from the risk turn`); continue; }
    if (!rating) { out.leftOut.push(`${h.id}: not rated`); continue; }
    if (rating === "not_me") { out.leftOut.push(`${h.id}: Not me`); continue; }
    if (state.map.beliefs.some((b) => b.id === h.id)) { out.kept.push(h.id); continue; }   // already on the map (rated there)
    const belief: Belief = { id: h.id, label: h.label, statement: h.statement, keyword: h.keyword ?? null, type: h.type, level: h.level, domains: [...h.domains],
      confidence: h.confidence, receipts: h.receipts.map((r) => ({ ...r })), links: h.links.map((l) => ({ ...l })), status: "endorsed" };
    state.map.beliefs.push(belief);
    out.kept.push(h.id);
  }
  return out;
}

import { TALK_FINISH } from "../prompt_text.ts";
export const FINISH_PROMPT = TALK_FINISH;

/** A finish call that already took longer than this skips the label-rename repair (a second call on a slow provider would pass the 30 s contract);
 *  the card with an incomplete label is then dropped, the same outcome as a repair that does not fix it. */
export const FINISH_REPAIR_SKIP_AFTER_MS = 10_000;

export interface FinishCard {
  id: string;
  label: string;
  statement: string;
  type: BeliefType;
  level: Level;
  domains: Domain[];
  confidence: number;
  receipts: string[];
  mergedFrom: string[];
  mapId: string | null;
  tensionWith: string | null;
  links: { to: string; type: LinkType }[];
  rating?: Rating;
  birthMood: Feeling;   // from the first hypothesis it merged (the turn it took shape in), else neutral
  keyword?: string | null;   // map v2: from the first merged hypothesis that has one
}

export interface FinishTrace {
  exchange: ModelExchange | null;
  repairExchange: ModelExchange | null;
  checks: CheckResult[];
  cards: FinishCard[];
  summary: string;
  nextTime: string;
  openThreads: string[];
  reconciled: { newReceipts: string[]; tensions: string[]; added: string[]; changed: string[] };
  failed: string | null;
  cents: number;
}

export async function finishSession(client: ModelClient, state: TurnState, ratings: Map<string, Rating>): Promise<FinishTrace> {
  const trace: FinishTrace = { exchange: null, repairExchange: null, checks: [], cards: [], summary: "", nextTime: "", openThreads: [],
    reconciled: { newReceipts: [], tensions: [], added: [], changed: [] }, failed: null, cents: 0 };
  const hypotheses = [...state.hypotheses.values()];
  if (hypotheses.length === 0 && state.session.turns.length === 0) { trace.failed = "empty session"; return trace; }

  const pkg = contextPackage(state.person, state.map, state.session, state.previous);
  const list = hypotheses.map((h) => `- ${h.id} "${h.label}": ${h.statement} (${h.type}; ${h.level}; ${h.domains.join(", ")}; confidence ${h.confidence.toFixed(2)}; ` +
    `receipts: ${h.receipts.map((r) => JSON.stringify(r.quote)).join(" | ")}; rated ${ratings.get(h.id) ?? "not yet"}` +
    (h.links.length ? `; links: ${h.links.map((l) => `${l.type} ${l.to}`).join(", ")}` : "") + ")").join("\n");
  const messages: ModelMessage[] = [{ role: "user", content: `${pkg}\n\n# HYPOTHESES PROPOSED THIS SESSION\n${list || "(none)"}\n\nConsolidate now.` }];
  const exchange = await client.complete({ purpose: "finish", system: FINISH_PROMPT, messages, maxTokens: 4000 });
  trace.exchange = exchange;
  trace.cents = exchange.usage.cents;
  if (exchange.error && !exchange.rawResponse) { trace.failed = exchange.error; trace.checks.push({ name: "model_call", ok: false, detail: exchange.error }); return trace; }

  if (exchange.usage.outputTokens > 0 && exchange.usage.outputTokens >= exchange.request.maxTokens) {
    trace.failed = `reply cut off at ${exchange.request.maxTokens} output tokens`; trace.checks.push({ name: "not_truncated", ok: false, detail: trace.failed }); return trace;
  }
  let parsed: Record<string, unknown>;
  try { parsed = extractJson(exchange.rawResponse) as Record<string, unknown>; trace.checks.push({ name: "valid_json", ok: true, detail: "parsed" }); }
  catch (e) { trace.failed = `no readable reply: ${e}`; trace.checks.push({ name: "valid_json", ok: false, detail: String(e) }); return trace; }

  const personTurns = state.session.turns.map((t) => t.person);
  const knownIds = new Set([...state.map.beliefs.map((b) => b.id), ...state.hypotheses.keys()]);
  const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const badLabels = rawCards.map((raw, i) => ({ i, label: raw && typeof raw === "object" ? (raw as Record<string, unknown>).label : null }))
    .filter((x): x is { i: number; label: string } => typeof x.label === "string" && labelProblem(x.label) !== null);
  if (badLabels.length && exchange.usage.ms > FINISH_REPAIR_SKIP_AFTER_MS) {
    for (const b of badLabels) trace.checks.push({ name: `label_rename:${b.i}`, ok: false, detail: `${JSON.stringify(b.label)}: rename skipped, the finish call took ${Math.round(exchange.usage.ms)} ms; card dropped` });
  } else if (badLabels.length) {
    const failures = badLabels.map((x) => `cards[${x.i}] ${JSON.stringify(x.label)}: ${labelProblem(x.label)}`).join("\n");
    const repair = await client.complete({ purpose: "finish_repair", system: FINISH_PROMPT, maxTokens: 1200,
      messages: [...messages, { role: "assistant", content: exchange.rawResponse }, { role: "user", content: `These labels are not names:\n${failures}\nReturn the same JSON object with only those labels renamed to complete one-to-three-word names. Do not cut a sentence. Change nothing else.` }] });
    trace.repairExchange = repair;
    trace.cents += repair.usage.cents;
    if (repair.error?.startsWith("budget_unavailable") && !repair.rawResponse) { trace.failed = repair.error; return trace; }
    try {
      const fixed = extractJson(repair.rawResponse) as Record<string, unknown>;
      const fixedCards = Array.isArray(fixed.cards) ? fixed.cards : [];
      for (const b of badLabels) {
        const row = fixedCards[b.i];
        const label = row && typeof row === "object" ? (row as Record<string, unknown>).label : null;
        if (typeof label === "string" && shortLabel(label)) {
          (rawCards[b.i] as Record<string, unknown>).label = shortLabel(label);
          trace.checks.push({ name: `label_rename:${b.i}`, ok: true, detail: `${JSON.stringify(b.label)} renamed to ${JSON.stringify(shortLabel(label))}` });
        } else trace.checks.push({ name: `label_rename:${b.i}`, ok: false, detail: `${JSON.stringify(b.label)} still had no complete name; card dropped` });
      }
    } catch (e) {
      trace.checks.push({ name: "label_rename", ok: false, detail: `rename reply unreadable; invalid cards dropped: ${e}` });
    }
  }
  rawCards.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const c = raw as Record<string, unknown>;
    const level = typeof c.level === "string" && (LEVELS as readonly string[]).includes(c.level) ? c.level as Level : null;
    const type = typeof c.type === "string" && (BELIEF_TYPES as readonly string[]).includes(c.type) ? c.type as BeliefType : (level ? TYPE_FOR_LEVEL[level] : null);
    const domains = (Array.isArray(c.domains) ? c.domains : []).filter((d): d is Domain => typeof d === "string" && (DOMAINS as readonly string[]).includes(d));
    const receipts = (Array.isArray(c.receipts) ? c.receipts : []).filter((r): r is string => typeof r === "string");
    const exact = receipts.filter((r) => personTurns.some((t) => isExactSubstring(r, t)));
    const tag = `cards[${i}] "${String(c.label ?? "")}"`;
    trace.checks.push({ name: `receipts_exact:${i}`, ok: exact.length === receipts.length && exact.length > 0,
      detail: exact.length === receipts.length && exact.length > 0 ? `${exact.length} exact receipt(s)` : `${tag}: ${receipts.length - exact.length} receipt(s) not exact, ${exact.length} kept` });
    const harsh = cardWordHits(`${String(c.label ?? "")} ${String(c.statement ?? "")}`);
    trace.checks.push({ name: `card_words:${i}`, ok: harsh.length === 0, detail: harsh.length ? `${tag}: ${harsh.join(", ")}` : "clean" });
    if (!level || !type || !domains.length || !exact.length || harsh.length || typeof c.statement !== "string" || typeof c.label !== "string") return;
    // A label that still is not a complete name after the one rename attempt is dropped whole (A-Q22).
    const label = shortLabel(c.label);
    trace.checks.push({ name: `label_short:${i}`, ok: label !== null, detail: label === null ? `${tag}: no complete label name, card dropped` : "label is a one-to-four-word name" });
    if (label === null) return;
    const mergedFrom = (Array.isArray(c.mergedFrom) ? c.mergedFrom : []).filter((m): m is string => typeof m === "string" && state.hypotheses.has(m));
    const mapId = typeof c.mapId === "string" && state.map.beliefs.some((b) => b.id === c.mapId) ? c.mapId : null;
    const tensionWith = typeof c.tensionWith === "string" && state.map.beliefs.some((b) => b.id === c.tensionWith) ? c.tensionWith : null;
    const links = (Array.isArray(c.links) ? c.links : []).map((l) => l as Record<string, unknown>)
      .filter((l) => typeof l.to === "string" && knownIds.has(l.to as string) && ["supports", "under", "tension"].includes(String(l.type)))
      .map((l) => ({ to: l.to as string, type: l.type as LinkType }));
    const rating = mergedFrom.map((m) => ratings.get(m)).find((r): r is Rating => r !== undefined);
    const confidence = typeof c.confidence === "number" ? Math.max(0, Math.min(1, c.confidence)) : Math.max(0, ...mergedFrom.map((m) => state.hypotheses.get(m)?.confidence ?? 0));
    const birthMood = mergedFrom.map((m) => state.hypotheses.get(m)?.birthMood).find((f): f is Feeling => !!f) ?? "neutral";
    const keyword = mergedFrom.map((m) => state.hypotheses.get(m)?.keyword).find((k): k is string => !!k) ?? null;
    trace.cards.push({ id: mergedFrom[0] ?? (state.idFor ? state.idFor() : newId("c")), label, statement: c.statement.trim(), type, level, domains, confidence,
      receipts: exact, mergedFrom, mapId, tensionWith, links, rating, birthMood, keyword });
  });

  // One card per belief: two cards with the same statement collapse.
  const seen = new Map<string, FinishCard>();
  for (const card of trace.cards) {
    const key = normalise(card.statement).toLowerCase();
    const dup = seen.get(key);
    if (dup) { for (const r of card.receipts) if (!dup.receipts.includes(r)) dup.receipts.push(r); dup.mergedFrom.push(...card.mergedFrom); }
    else seen.set(key, card);
  }
  trace.cards = [...seen.values()];
  trace.checks.push({ name: "one_card_per_belief", ok: true, detail: `${rawCards.length} card(s) in, ${trace.cards.length} after merging` });

  trace.summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  trace.nextTime = typeof parsed.nextTime === "string" ? parsed.nextTime.trim() : "";
  trace.openThreads = (Array.isArray(parsed.openThreads) ? parsed.openThreads : []).filter((t): t is string => typeof t === "string");
  const summaryBad = cardWordHits(`${trace.summary} ${trace.nextTime}`);
  trace.checks.push({ name: "summary_words", ok: summaryBad.length === 0, detail: summaryBad.length ? summaryBad.join(", ") : "clean" });
  if (summaryBad.length) { trace.summary = ""; trace.nextTime = ""; }

  reconcile(state.map, trace, state.session.id, state.session.date);
  return trace;
}

/** Same belief → a new receipt on the map belief; explicit contradiction → a tension link; else a new belief. */
export function reconcile(map: PersonMap, trace: FinishTrace, sessionId: string, date: string): void {
  for (const card of trace.cards) {
    const target = card.mapId ? map.beliefs.find((b) => b.id === card.mapId) : sameBelief(map, card);
    if (target) {
      for (const quote of card.receipts) {
        if (!target.receipts.some((r) => r.quote === quote)) { target.receipts.push({ quote, sessionId, turn: 0, date }); trace.reconciled.newReceipts.push(`${target.id} +"${quote}"`); }
      }
      if (card.rating === "not_me") target.status = "disputed";
      else if (card.rating) target.status = "endorsed";
      if (normalise(target.statement) !== normalise(card.statement) && card.rating && card.rating !== "not_me") {
        target.statement = card.statement; target.changed = true; trace.reconciled.changed.push(target.id);
      }
      card.id = target.id;
      continue;
    }
    const status = card.rating === "not_me" ? "disputed" : card.rating ? "endorsed" : "inferred";
    const belief: Belief = { id: card.id, label: card.label, statement: card.statement, keyword: card.keyword ?? null, type: card.type, level: card.level, domains: card.domains,
      confidence: card.confidence, receipts: card.receipts.map((quote) => ({ quote, sessionId, turn: 0, date })), links: [...card.links], status,
      birthMood: card.birthMood };
    if (card.tensionWith && !belief.links.some((l) => l.to === card.tensionWith && l.type === "tension")) {
      belief.links.push({ to: card.tensionWith, type: "tension" });
    }
    map.beliefs.push(belief);
    trace.reconciled.added.push(belief.id);
    for (const l of belief.links) if (l.type === "tension") trace.reconciled.tensions.push(`${belief.id} ⟷ ${l.to}`);
  }
  for (const t of trace.openThreads) if (!map.openThreads.includes(t)) map.openThreads.push(t);
}

/** Same belief by label match or by sharing most content words of the statement. */
function sameBelief(map: PersonMap, card: FinishCard): Belief | undefined {
  const label = normalise(card.label).toLowerCase();
  const byLabel = map.beliefs.find((b) => normalise(b.label).toLowerCase() === label && b.domains.some((d) => card.domains.includes(d)));
  if (byLabel) return byLabel;
  const STOP = new Set(["you", "your", "may", "feel", "feels", "part", "of", "that", "the", "a", "an", "to", "and", "it", "is", "are", "be", "when", "for", "in", "on", "with", "as", "than", "not", "sounds", "like", "seem", "seems"]);
  const content = (s: string) => new Set(words(s).filter((w) => w.length > 2 && !STOP.has(w)));
  const mine = content(card.statement);
  let best: Belief | undefined, bestScore = 0;
  for (const b of map.beliefs) {
    const theirs = content(b.statement);
    const shared = [...mine].filter((w) => theirs.has(w)).length;
    const score = shared / Math.max(1, Math.min(mine.size, theirs.size));
    if (shared >= 3 && score >= 0.6 && score > bestScore) { best = b; bestScore = score; }
  }
  return best;
}
