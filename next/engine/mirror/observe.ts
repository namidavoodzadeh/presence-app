// The observation listener, screen and mapper (one Haiku call): the package, the tolerant reader, and the code guard that
// strips anything identifying the model let through. Pure; the API calls the model and stores the result.

import { BELIEF_TYPES, DOMAINS } from "../types.ts";
import type { Belief, BeliefType, Domain } from "../types.ts";
import { extractJson } from "../model/client.ts";
import { cardWordHits } from "../words.ts";
import { HOW_KNOWN, type Observed, type Observation } from "./types.ts";
import type { HowKnown } from "./types.ts";

export const OBSERVE_MAX_TOKENS = 700;
export const OBSERVE_MAX_CHARS = 2000;
export const OBSERVE_MIN_CHARS = 12;

export interface OpenTheme { key: string; label: string; statement: string; count: number }

export function observePackage(ownerFirstName: string, howKnown: HowKnown, moment: string, map: Belief[], open: OpenTheme[]): string {
  const beliefs = map.filter((b) => b.status === "endorsed").map((b) => `- ${b.id}: "${b.label}": ${b.statement}`).join("\n") || "- (nothing on the map yet)";
  const themes = open.map((t) => `- ${t.key} (${t.count} so far): "${t.label}": ${t.statement}`).join("\n") || "- (none yet)";
  return `# OWNER\n${ownerFirstName}\n\n# HOW THE CONTRIBUTOR KNOWS THEM\n${howKnown}\n\n# THE MOMENT, AS WRITTEN\n${moment}\n\n# THE OWNER'S CONFIRMED BELIEFS\n${beliefs}\n\n# OPEN THEMES\n${themes}`;
}

/** The trace keeps the package sent, but the moment as written must live nowhere once processed (thesis, Mirror protections:
 *  "raw contribution text is deleted once processed"). For the engine_calls row the moment block is replaced by its length and a
 *  hash prefix, so a run can still be matched to its contribution without the words. If the block is not found as built, the
 *  whole package is replaced: never store it on a guess. */
export async function redactMoment(pkg: string, moment: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(moment));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const block = `# THE MOMENT, AS WRITTEN\n${moment}\n`;
  const placeholder = `# THE MOMENT, AS WRITTEN\n[deleted once processed: ${moment.length} characters, sha256 ${hex}]\n`;
  return pkg.includes(block) ? pkg.replace(block, placeholder) : placeholder.trimEnd();
}

/** The moment as written inside a package built by observePackage(), or null when the block is absent or already redacted.
 *  Used by the one-off scrub of trace rows written before redaction existed (Q65): the same placeholder, by row. */
export function momentInPackage(pkg: string): string | null {
  const head = "# THE MOMENT, AS WRITTEN\n", tail = "\n\n# THE OWNER'S CONFIRMED BELIEFS\n";
  const i = pkg.indexOf(head);
  if (i < 0) return null;
  const j = pkg.indexOf(tail, i + head.length);
  if (j < 0) return null;
  const moment = pkg.slice(i + head.length, j);
  return moment.startsWith("[deleted once processed: ") ? null : moment;
}

/** Weighting by how the contributor knows the owner (thesis: used only inside the engine). */
export function weightFor(howKnown: string): number {
  return (HOW_KNOWN as readonly string[]).includes(howKnown) && howKnown !== "other" ? 1.0 : 0.8;
}

const str = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
const isDomain = (x: unknown): x is Domain => typeof x === "string" && (DOMAINS as readonly string[]).includes(x);
const isType = (x: unknown): x is BeliefType => typeof x === "string" && (BELIEF_TYPES as readonly string[]).includes(x);

/** Strip what could identify someone: capitalised words that are not sentence-initial and not the owner's name, @handles,
 *  digits (dates, ages, counts of years), and e-mail-like tokens. The listener is asked to leave none; this is the floor. */
export function deidentify(text: string, ownerFirstName: string): string {
  const keep = new Set(["I", ownerFirstName, "They", "Their", "Them", "The", "A", "An", "One", "At", "When", "After", "Before", "During", "Once", "Then", "It", "In", "On", "He", "She", "His", "Her", "We", "Our", "You", "Your", "Part", "People", "Someone", "Some"]);
  let out = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "someone").replace(/@\w+/g, "someone").replace(/\b\d[\d:./-]*\b/g, "some");
  out = out.replace(/(^|[.!?]\s+|\s)([A-Z][a-z]+)/g, (m, before: string, word: string) => {
    const sentenceStart = before === "" || /[.!?]\s+$/.test(before);
    if (keep.has(word) || sentenceStart) return m;
    return `${before}someone`;
  });
  return out.replace(/\s+/g, " ").trim();
}

export function readObserved(raw: string, ownerFirstName: string, openKeys: readonly string[], mapIds: readonly string[]): { observed: Observed | null; problems: string[] } {
  let v: Record<string, unknown>;
  try { v = extractJson(raw) as Record<string, unknown>; } catch (e) { return { observed: null, problems: [`unreadable: ${e instanceof Error ? e.message : String(e)}`] }; }
  if (!v || typeof v !== "object") return { observed: null, problems: ["unreadable: not an object"] };
  const problems: string[] = [];
  const kindRaw = str(v.kind).toLowerCase();
  const kind = kindRaw === "moment" || kindRaw === "label" || kindRaw === "unclear" ? kindRaw : "unclear";
  const s = (v.safety ?? {}) as Record<string, unknown>;
  const levelRaw = str(s.level).toLowerCase();
  const level = levelRaw === "concern" || levelRaw === "abuse" ? levelRaw : "none";
  const observed: Observed = { kind, safety: { level, reason: str(s.reason, 200) }, observation: null, theme: null, map: null };
  if (kind !== "moment" || level !== "none") return { observed, problems };
  const o = (v.observation ?? {}) as Record<string, unknown>;
  const observation: Observation = {
    situation: deidentify(str(o.situation), ownerFirstName), behaviour: deidentify(str(o.behaviour), ownerFirstName),
    reaction: deidentify(str(o.reaction), ownerFirstName), guess: o.guess ? deidentify(str(o.guess), ownerFirstName) : null,
    domains: Array.isArray(o.domains) ? (o.domains as unknown[]).filter(isDomain) : [],
  };
  if (!observation.behaviour) problems.push("observation.behaviour empty");
  if (!observation.domains.length) observation.domains = ["close_relationships"];
  observed.observation = observation;
  const t = (v.theme ?? {}) as Record<string, unknown>;
  const label = str(t.label, 60).replace(/[.!?]+$/, "");
  const statement = str(t.statement, 300);
  if (label && statement) {
    const key = typeof t.key === "string" && openKeys.includes(t.key) ? t.key : null;
    const bad = cardWordHits(`${label} ${statement}`);
    if (bad.length) problems.push(`theme words: ${bad.join(", ")}`);
    if (label.split(/\s+/).length > 4) problems.push("theme label over four words");
    observed.theme = { key, label, statement, type: isType(t.type) ? t.type : "how I tend to react", confidence: num(t.confidence) };
  }
  const m = (v.map ?? {}) as Record<string, unknown>;
  if (typeof m.belief_id === "string" && mapIds.includes(m.belief_id) && (m.relation === "supports" || m.relation === "contradicts")) {
    observed.map = { beliefId: m.belief_id, relation: m.relation, confidence: num(m.confidence) };
  }
  return { observed, problems };
}
