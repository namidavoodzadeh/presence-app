// E27 (3): the /bridge/run reply's highlights[] and summary, built in code from what the run already has: the verified
// rewrite's own change units (so every `suggested` is what the bridged text says), the frictions the rewrite left as they
// were, and the belief touches on both sides. No model call. Suggestions are about the message's words, never the belief
// (law 4); the receiver's side is wording only, worded as a possibility (law 10, BRIDGE-INSIGHT §2.4).

import { INSIGHT_COPY, locate } from "./insight.ts";
import type { BeliefTouches } from "./touches.ts";
import type { Change, FrictionKind, InsightFriction } from "./types.ts";
import { engineTermsIn, kindHolds } from "./validate.ts";

export interface Highlight {
  start: number;
  end: number;
  original: string;
  suggested: string;
  why_line: string;
  /** The friction this part carries; null for a part that only touches a belief. */
  friction_kind: FrictionKind | null;
  from_you: { belief_id: string; wording: string; receipt: string; date: string }[];
  from_them: { belief_id: string; wording: string; item_id: string | null; quote: string | null; quote_label: string | null }[];
  /** v1.61 (app Q-APP-V3-4): what the why line is about. "receiver": it describes the other person (THEM_WHY, no friction),
   *  so under the V3 source rule it shows only with a `from_them` shared quote. "wording": it is about the sender's own
   *  words or the sender's own beliefs, and needs no source. */
  about: "receiver" | "wording";
}

interface Unit { start: number; end: number; suggested: string | null; kind: FrictionKind | null; you: Set<string>; them: Set<string>; why: string | null }

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** How each friction kind may land, in plain words, for the summary line (law 7: no clinical terms, CEO 11:15 PT 07 Nov: no
 *  engine terms either; Nami reads it). Kinds that land the same way share a sentence ("“I hate” and “you ignore” may land
 *  as blame"). A vague ask has no words of its own to quote, so its line says what is missing instead. */
export const KIND_LANDS: Record<FrictionKind, string> = {
  absolute: "may sound like every time",
  character: "may land as a judgement of who they are",
  mind_reading: "may sound like telling them what they feel",
  sarcasm: "may land as a jab",
  contempt: "may land as looking down on them",
  demand: "may land as an order",
  blame_stack: "may land as a pile of old moments",
  vague_ask: "It doesn't yet say what you'd like them to do.",
  heat: "may land as blame",
  you_blame: "may land as blame",
};

export const CHECKED_LINE = "This already reads clearly, and nothing in it looks likely to get in the way.";
export const THEM_WHY = "This may touch something they've shared with you.";
/** The sender's own belief, in its gentle wording (law 5), as something that matters to them; the label when there is no wording. */
export const youWhy = (label: string, wording = "") => {
  const w = wording.trim().replace(/[.!]+$/, "");
  if (!w) return `This comes from “${label}” on your map.`;
  // A wording in the sender's own first person ("I don't want to look weak") stays theirs, in quotes; the gentle second
  // person ("Part of you feels…") runs on as the sentence, unless it holds a word the line may not say as its own (a friction
  // kind's name, CEO 13:15 PT): then it is quoted too, as the belief's wording.
  return /^I\b/.test(w) || engineTermsIn(w, "").length ? `This comes from something that matters to you: “${w}”.` : `This comes from something that matters to you: ${w[0].toLowerCase()}${w.slice(1)}.`;
};

/** `confirmed`: the sender's confirmed belief ids (law 3); a from_you outside it is dropped, and a part left with nothing
 *  to show goes with it (CEO 13:15 PT validators). Null trusts the touches, which are built from confirmed beliefs only. */
export function buildHighlights(text: string, frictions: InsightFriction[], changes: Change[], bridged: string | null, touches: BeliefTouches | null, confirmed: Set<string> | null = null): Highlight[] {
  const units: Unit[] = [];
  const add = (u: Omit<Unit, "you" | "them">) => units.push({ ...u, you: new Set(), them: new Set() });
  // 1. The rewrite's change units: located in the draft, and (when there is a bridged text) present in it word for word.
  for (const c of changes) {
    if (c.kind === "context" || c.from === c.to) continue;
    const at = locate(text, c.from);
    if (!at || (bridged !== null && !bridged.includes(c.to)) || units.some((u) => overlaps(u, at))) continue;
    // The why line: the friction of the change's own kind, else the smallest friction it overlaps, else the change's kind;
    // a kind whose sign is not in these words comes after one whose sign is (CEO 13:15 PT: no always/never line on a
    // stretch without an absolute).
    const near = frictions.filter((x) => overlaps(x, at)).sort((a, b) => (a.end - a.start) - (b.end - b.start));
    const kinds = [...near.filter((x) => x.kind === c.kind), ...near].map((x) => x.kind).concat(c.kind as FrictionKind);
    const said = text.slice(at.start, at.end);
    add({ ...at, suggested: c.to, kind: kinds.find((k) => kindHolds(k, said, text)) ?? kinds[0], why: null });
  }
  // 2. Frictions the rewrite left as they were (or every friction, when there is no rewrite): the smallest first, no overlaps.
  for (const f of [...frictions].sort((a, b) => (a.end - a.start) - (b.end - b.start))) {
    if (units.some((u) => overlaps(u, f))) continue;
    add({ start: f.start, end: f.end, suggested: null, kind: f.kind, why: null });
  }
  // 3. Belief touches: onto every unit they overlap; else their own unit; a touch with no place goes on the first unit.
  const whole = (() => { const s = text.length - text.trimStart().length; return { start: s, end: text.trimEnd().length }; })();
  const attach = (span: { start: number | null; end: number | null }, put: (u: Unit) => void, why: string) => {
    const at = span.start !== null && span.end !== null && span.end > span.start ? { start: span.start, end: span.end } : null;
    const hit = at ? units.filter((u) => overlaps(u, at)) : [];
    if (hit.length) return hit.forEach(put);
    if (!at && units.length) return put([...units].sort((a, b) => a.start - b.start)[0]);
    const u: Unit = { ...(at ?? whole), suggested: null, kind: null, you: new Set(), them: new Set(), why };
    units.push(u);
    put(u);
  };
  for (const y of touches?.fromYou ?? []) attach(y, (u) => u.you.add(y.beliefId), youWhy(y.label, y.wording));
  for (const t of touches?.fromThem ?? []) attach(t, (u) => u.them.add(t.beliefId), THEM_WHY);
  const you = new Map((touches?.fromYou ?? []).map((y) => [y.beliefId, y]));
  const them = new Map((touches?.fromThem ?? []).map((t) => [t.beliefId, t]));
  if (confirmed) for (const u of units) for (const id of [...u.you]) if (!confirmed.has(id)) u.you.delete(id);
  const shows = (u: Unit) => u.kind !== null || u.you.size > 0 || u.them.size > 0 || u.suggested !== null;
  return units.filter((u) => u.start >= 0 && u.end <= text.length && u.end > u.start && shows(u)).sort((a, b) => a.start - b.start).map((u) => {
    const original = text.slice(u.start, u.end);
    return {
      start: u.start, end: u.end, original, suggested: u.suggested ?? original,
      why_line: u.kind ? INSIGHT_COPY[u.kind] : u.why ?? THEM_WHY, friction_kind: u.kind,
      about: !u.kind && (u.why ?? THEM_WHY) === THEM_WHY ? "receiver" as const : "wording" as const,
      from_you: [...u.you].map((id) => you.get(id)!).map((y) => ({ belief_id: y.beliefId, wording: y.wording, receipt: y.receipt, date: y.date })),
      from_them: [...u.them].map((id) => them.get(id)!).map((t) => ({ belief_id: t.beliefId, wording: t.wording, item_id: null, quote: null, quote_label: null })),
    };
  });
}

/** One line that describes what was found and what it touches, in plain warm words; never what to do (law 4), never a
 *  verdict (law 5). The receiver's side by label only, as a possibility (law 10). */
export function summaryLine(frictions: InsightFriction[], touches: BeliefTouches | null): string {
  const parts: string[] = [];
  const you = touches?.fromYou ?? [], them = touches?.fromThem ?? [];
  if (you.length) parts.push(youWhy(you[0].label, you[0].wording));
  // Frictions in the order the draft says them: each stretch of words once (an overlapping one is the same words), at most
  // three, grouped by how they may land.
  const kept: InsightFriction[] = [];
  let vague = false;
  for (const f of [...frictions].sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start))) {
    if (f.kind === "vague_ask") { vague = true; continue; }
    if (kept.length < 3 && !kept.some((k) => overlaps(k, f))) kept.push(f);
  }
  const groups = new Map<string, string[]>();
  for (const f of kept) groups.set(KIND_LANDS[f.kind], [...groups.get(KIND_LANDS[f.kind]) ?? [], `“${shortQuote(f.quote)}”`]);
  const clauses = [...groups].map(([lands, qs]) => `${listOf(qs)} ${lands}`);
  if (clauses.length) parts.push(opening(`${listOf(clauses)}.`));
  if (vague) parts.push(KIND_LANDS.vague_ask);
  if (them.length) parts.push(`It may touch something they've shared with you: ${listOf(them.map((t) => engineTermsIn(t.label, "").length ? `“${t.label}”` : lower(t.label)))}.`);
  if (!parts.length) return CHECKED_LINE;
  if (!clauses.length && !vague) parts.push("The wording itself reads clearly.");
  return parts.join(" ");
}

/** The sender's own words, at most four of them; a longer stretch is its first three and an ellipsis. */
function shortQuote(q: string): string {
  const w = q.trim().replace(/[.,;:!?]+$/, "").split(/\s+/);
  return w.length <= 4 ? w.join(" ") : `${w.slice(0, 3).join(" ")}…`;
}
/** The sender's quoted words are never recased, so a sentence that opens on a quote opens with "Words like". */
const opening = (s: string) => s.startsWith("“") ? `Words like ${s}` : s[0].toUpperCase() + s.slice(1);
const lower = (s: string) => s ? s[0].toLowerCase() + s.slice(1) : s;

function listOf(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}
