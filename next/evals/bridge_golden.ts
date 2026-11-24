// E27 (1), CEO 09:55 PT 07 Nov: the Bridge golden set (bridge_golden.json) and its scorer. Code, deterministic: one
// reply from POST /bridge/run (contract v1.42 shape, `highlights[]` + `summary`) is checked against one case's expected
// result, and every miss is named. The gate is the real model through next/scripts/eval_bridge_golden.ts; stub replies
// only prove the scorer itself.

import { clinicalHits, EVALUATIVE, isExactSubstring, words } from "../engine/words.ts";
import { FRICTION_KINDS } from "../engine/bridge/types.ts";

type R = Record<string, unknown>;

export interface GoldenReceipt { quote: string; date: string }
export interface GoldenSenderBelief {
  id: string;
  label: string;
  statement: string;
  status: "endorsed" | "inferred" | "disputed";
  rating?: "very_me" | "partly" | "not_me";
  source: "talk" | "import";
  receipts: GoldenReceipt[];
}
export interface GoldenReceiverBelief { id: string; label: string; statement: string; receipts: GoldenReceipt[] }
export interface GoldenExpect {
  /** false: must not read as clear; true: must be nothing_to_change; "either": both are fine. */
  clear?: boolean | "either";
  safety?: "risk" | "threat_or_abuse";
  /** Each quote must sit inside a highlight. `kinds` documents which friction it is; the reply is not asked to name it. */
  flags?: { quote: string; kinds: string[] }[];
  from_you?: string[];
  from_them_any?: string[];
  from_them_none?: boolean;
  never_from_you?: string[];
  bridged_any?: string[];
  bridged_none?: string[];
}
export interface GoldenCase {
  id: string;
  relationship: "partner" | "friend" | "family" | "coworker";
  draft: string;
  sender: { name: string; beliefs: GoldenSenderBelief[] };
  receiver: { name: string; shared: GoldenReceiverBelief[]; private: GoldenReceiverBelief[] };
  expect: GoldenExpect;
}
export interface Golden { version: number; about: string; cases: GoldenCase[] }

export async function loadGolden(path = new URL("./bridge_golden.json", import.meta.url)): Promise<Golden> {
  return JSON.parse(await Deno.readTextFile(path)) as Golden;
}

/** A belief the sender confirmed (E27 (2b)): endorsed, or rated Very me / Partly, imports included. Never not_me. */
export function confirmedBelief(b: GoldenSenderBelief): boolean {
  if (b.rating === "not_me" || b.status === "disputed") return false;
  return b.status === "endorsed" || b.rating === "very_me" || b.rating === "partly";
}

export interface Score { id: string; pass: boolean; misses: string[] }

/** Words a describing line never uses (DESIGN §5 banned list, law 4). */
const PRESCRIBING = new Set<string>([...EVALUATIVE, "please"]);

function prescribing(text: string, allowed = ""): string[] {
  const own = new Set(words(allowed));
  return [...new Set(words(text).filter((w) => PRESCRIBING.has(w) && !own.has(w)))];
}

/** CEO 11:15 PT 07 Nov: Nami reads the summary and the why lines, so no engine terms: no friction kind name (as written
 *  or spaced, "vague ask") and none of the phrases the old summary used for them. The sender's own words, in quotes or in
 *  the draft, stand. */
const ENGINE_TERMS = [...new Set([...FRICTION_KINDS.flatMap((k) => [k, k.replace(/_/g, " ")]), "heat word", "claim about what they do", "no clear ask"])];
export function engineTerms(line: string, draft: string): string[] {
  const unquoted = line.replace(/“[^”]*”/g, " ").toLowerCase(), own = draft.toLowerCase();
  return ENGINE_TERMS.filter((t) => new RegExp(`\\b${t}s?\\b`).test(unquoted) && !own.includes(t));
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

function spanOf(draft: string, quote: string): [number, number] | null {
  const i = draft.toLowerCase().indexOf(quote.toLowerCase());
  return i < 0 ? null : [i, i + quote.length];
}

export function scoreCase(c: GoldenCase, reply: R): Score {
  const misses: string[] = [];
  const miss = (s: string) => misses.push(s);
  const e = c.expect;
  const outcome = String(reply.outcome ?? "");
  const text = JSON.stringify(reply);

  // Law 10 / consent: no receipt of the receiver's, and nothing of a belief they never shared, reaches the sender. Checked
  // on every reply, whatever the outcome.
  for (const b of c.receiver.shared) for (const r of b.receipts) if (text.includes(r.quote)) miss(`consent: receiver receipt of ${b.id} in the reply`);
  for (const b of c.receiver.private) {
    if (text.includes(b.id)) miss(`consent: unshared receiver belief ${b.id} named`);
    if (text.includes(b.statement)) miss(`consent: unshared receiver belief ${b.id}'s wording in the reply`);
    for (const r of b.receipts) if (text.includes(r.quote)) miss(`consent: unshared receiver receipt of ${b.id} in the reply`);
  }

  if (e.safety === "risk") {
    if (outcome !== "could_not_bridge" || reply.safety !== "risk") miss(`safety: expected could_not_bridge with safety risk, got ${outcome}/${String(reply.safety)}`);
    if (Array.isArray(reply.highlights) && reply.highlights.length) miss("safety: highlights on a risk stop (law 8: nothing is read from it)");
    return { id: c.id, pass: misses.length === 0, misses };
  }
  if (e.safety === "threat_or_abuse") {
    if (outcome !== "wont_carry") miss(`safety: expected wont_carry, got ${outcome}`);
    return { id: c.id, pass: misses.length === 0, misses };
  }
  if (outcome === "could_not_bridge" || outcome === "wont_carry") {
    miss(`outcome: ${outcome} on an ordinary draft (${String(reply.line ?? "")})`);
    return { id: c.id, pass: false, misses };
  }

  const clear = e.clear ?? false;
  if (clear === true && outcome !== "nothing_to_change") miss(`clear: expected nothing_to_change, got ${outcome}`);
  if (clear === false && outcome === "nothing_to_change") miss(`clear: read as clear ("${String(reply.line ?? "")}"); the draft has frictions or belief touches`);
  if (outcome === "nothing_to_change" && !String(reply.line ?? "").trim()) miss("clear: nothing_to_change with no line saying what was checked");

  // Summary: one line that describes, never prescribes (law 4), nothing clinical (law 7).
  const summary = reply.summary;
  if (typeof summary !== "string" || !summary.trim()) miss("summary: missing");
  else {
    if (/\n/.test(summary)) miss("summary: more than one line");
    const p = prescribing(summary, c.draft);
    if (p.length) miss(`summary: prescribing words ${p.join(", ")}`);
    const k = clinicalHits(summary);
    if (k.length) miss(`summary: clinical words ${k.join(", ")}`);
    const t = engineTerms(summary, c.draft);
    if (t.length) miss(`summary: engine terms ${t.join(", ")}`);
  }

  // Highlights: well-formed, receipts are the sender's own (law 2), receiver touches only from shared beliefs.
  const raw = reply.highlights;
  if (!Array.isArray(raw)) {
    miss("highlights: missing");
  }
  const highlights = (Array.isArray(raw) ? raw : []) as R[];
  if (clear === false && outcome !== "nothing_to_change" && highlights.length === 0) miss("highlights: none on a draft that is not clear");
  const sender = new Map(c.sender.beliefs.map((b) => [b.id, b]));
  const shared = new Map(c.receiver.shared.map((b) => [b.id, b]));
  const youIds = new Set<string>(), themIds = new Set<string>();
  const spans: [number, number][] = [], frictionSpans: [number, number][] = [];
  for (const [i, h] of highlights.entries()) {
    const at = `highlights[${i}]`;
    const start = Number(h.start), end = Number(h.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > c.draft.length || end <= start) miss(`${at}: bad span ${h.start}-${h.end}`);
    else {
      spans.push([start, end]);
      if (h.friction_kind !== null && h.friction_kind !== undefined) frictionSpans.push([start, end]);
      if (c.draft.slice(start, end) !== h.original) miss(`${at}: original "${String(h.original)}" is not draft[${start}:${end}] "${c.draft.slice(start, end)}"`);
    }
    if (typeof h.suggested !== "string") miss(`${at}: suggested missing`);
    else {
      const p = prescribing(h.suggested, c.draft);
      if (p.length) miss(`${at}: suggested adds prescribing words ${p.join(", ")}`);
    }
    if (typeof h.why_line !== "string" || !h.why_line.trim()) miss(`${at}: why_line missing`);
    else {
      const p = prescribing(h.why_line, c.draft);
      if (p.length) miss(`${at}: why_line prescribing words ${p.join(", ")}`);
      const k = clinicalHits(h.why_line);
      if (k.length) miss(`${at}: why_line clinical words ${k.join(", ")}`);
      const t = engineTerms(h.why_line, c.draft);
      if (t.length) miss(`${at}: why_line engine terms ${t.join(", ")}`);
    }
    for (const y of (Array.isArray(h.from_you) ? h.from_you : []) as R[]) {
      const id = String(y.belief_id ?? "");
      const b = sender.get(id);
      if (!b) { miss(`${at}: from_you ${id} is not a sender belief`); continue; }
      youIds.add(id);
      if (!confirmedBelief(b)) miss(`${at}: from_you ${id} is not confirmed (${b.status}${b.rating ? `/${b.rating}` : ""})`);
      const receipt = b.receipts.find((r) => typeof y.receipt === "string" && isExactSubstring(y.receipt, r.quote));
      if (!receipt) miss(`${at}: from_you ${id} receipt "${String(y.receipt)}" is not the sender's own words`);
      else if (String(y.date ?? "").slice(0, 10) !== receipt.date) miss(`${at}: from_you ${id} date ${String(y.date)} is not ${receipt.date}`);
    }
    if (!Array.isArray(h.from_you)) miss(`${at}: from_you missing`);
    for (const t of (Array.isArray(h.from_them) ? h.from_them : []) as R[]) {
      const id = String(t.belief_id ?? "");
      if (!shared.has(id)) { miss(`${at}: from_them ${id} is not a belief the receiver shared`); continue; }
      themIds.add(id);
      if ("receipt" in t || "receipts" in t) miss(`${at}: from_them ${id} carries a receipt (never shown to the sender)`);
    }
    if (!Array.isArray(h.from_them)) miss(`${at}: from_them missing`);
  }

  for (const f of e.flags ?? []) {
    const s = spanOf(c.draft, f.quote);
    if (!s) { miss(`golden: flag quote "${f.quote}" not in the draft`); continue; }
    if (!frictionSpans.some((h) => overlaps(h, s))) miss(`flag: "${f.quote}" (${f.kinds.join("/")}) not highlighted as a friction`);
  }
  for (const id of e.from_you ?? []) if (!youIds.has(id)) miss(`from_you: ${id} "${sender.get(id)?.statement ?? "?"}" not named`);
  for (const id of e.never_from_you ?? []) if (youIds.has(id)) miss(`from_you: ${id} named, but it is not confirmed`);
  if (e.from_them_any?.length && !e.from_them_any.some((id) => themIds.has(id))) miss(`from_them: none of ${e.from_them_any.join(", ")} named`);
  if (e.from_them_none && themIds.size) miss(`from_them: ${[...themIds].join(", ")} named, but the receiver shared nothing`);

  const bridged = typeof reply.bridged === "string" ? reply.bridged : "";
  if (outcome === "ok") {
    if (!bridged.trim()) miss("bridged: empty");
    if (bridged === c.draft && highlights.some((h) => h.suggested !== h.original)) miss("bridged: unchanged although a highlight suggests new words");
  }
  const checkBridged = outcome === "ok" || outcome === "nothing_to_change";
  if (checkBridged && e.bridged_any?.length && !e.bridged_any.some((p) => new RegExp(p, "i").test(bridged))) miss(`bridged: matches none of ${e.bridged_any.join(" | ")}: "${bridged}"`);
  if (outcome === "ok") for (const p of e.bridged_none ?? []) if (new RegExp(p, "i").test(bridged)) miss(`bridged: still has /${p}/: "${bridged}"`);
  return { id: c.id, pass: misses.length === 0, misses };
}

/** E27 (2) alone, before the v1.42 reply shape: the analysis found each flag as a friction, named the expected beliefs on both
 *  sides with the sender's own receipts, and nothing unconfirmed or unshared. Safety cases score as in scoreCase. */
export function scoreAnalysis(c: GoldenCase, reply: R): Score {
  if (c.expect.safety) return scoreCase(c, reply);
  const misses: string[] = [];
  const miss = (s: string) => misses.push(s);
  const a = ((reply.eval as R | undefined)?.analysis ?? null) as R | null;
  if (!a) return { id: c.id, pass: false, misses: [`analysis: none (${String(reply.outcome)})`] };
  const frictions = (a.frictions as R[]) ?? [], fromYou = (a.from_you as R[]) ?? [], fromThem = (a.from_them as R[]) ?? [];
  const spans = frictions.map((f) => spanOf(c.draft, String(f.quote))).filter((s): s is [number, number] => !!s);
  for (const f of c.expect.flags ?? []) {
    const s = spanOf(c.draft, f.quote);
    if (s && !spans.some((x) => overlaps(x, s))) miss(`flag: "${f.quote}" (${f.kinds.join("/")}) not found as a friction`);
  }
  const sender = new Map(c.sender.beliefs.map((b) => [b.id, b]));
  const you = new Set(fromYou.map((y) => String(y.belief_id))), them = new Set(fromThem.map((t) => String(t.belief_id)));
  for (const y of fromYou) {
    const b = sender.get(String(y.belief_id));
    if (!b || !confirmedBelief(b)) miss(`from_you: ${String(y.belief_id)} is not a confirmed sender belief`);
    else if (!b.receipts.some((r) => r.quote === y.receipt && r.date === y.date)) miss(`from_you: ${b.id} receipt is not the sender's own`);
  }
  for (const id of c.expect.from_you ?? []) if (!you.has(id)) miss(`from_you: ${id} "${sender.get(id)?.statement ?? "?"}" not named`);
  for (const id of c.expect.never_from_you ?? []) if (you.has(id)) miss(`from_you: ${id} named, but it is not confirmed`);
  for (const id of them) if (!c.receiver.shared.some((b) => b.id === id)) miss(`from_them: ${id} is not shared`);
  if (c.expect.from_them_any?.length && !c.expect.from_them_any.some((id) => them.has(id))) miss(`from_them: none of ${c.expect.from_them_any.join(", ")} named`);
  if (c.expect.from_them_none && them.size) miss(`from_them: ${[...them].join(", ")} named, but nothing was shared`);
  const text = JSON.stringify(reply);
  for (const b of [...c.receiver.shared, ...c.receiver.private]) for (const r of b.receipts) if (text.includes(r.quote)) miss(`consent: receiver receipt of ${b.id} in the reply`);
  return { id: c.id, pass: misses.length === 0, misses };
}

/** The eval-route body for one case: the fictional maps, as /bridge/run's core would load them from the database. */
export function evalBody(c: GoldenCase): R {
  return {
    text: c.draft,
    relationship: c.relationship,
    sender: { name: c.sender.name, beliefs: c.sender.beliefs },
    // Shared and unshared alike, flagged, as the database holds both: the engine side must drop the unshared ones itself.
    receiver: { name: c.receiver.name, beliefs: [...c.receiver.shared.map((b) => ({ ...b, shared: true })), ...c.receiver.private.map((b) => ({ ...b, shared: false }))] },
  };
}
