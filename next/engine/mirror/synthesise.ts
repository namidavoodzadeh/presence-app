// The writer behind the gate (one Sonnet call) and its guard: label, gentle statement, type, domains and a paraphrased summary;
// no quote, no identifying detail, no clinical word, no verdict (thesis "Writer and guard"). Pure.

import { BELIEF_TYPES, DOMAINS } from "../types.ts";
import type { BeliefType, Domain } from "../types.ts";
import { extractJson } from "../model/client.ts";
import { cardWordHits, words } from "../words.ts";
import type { GateDecision, Observation, Synthesis } from "./types.ts";

export const SYNTHESISE_MAX_TOKENS = 600;
const VERDICT_WORDS = ["lazy", "stubborn", "cold", "rude", "arrogant", "needy", "clingy", "manipulative", "immature", "childish"];

export function synthesisPackage(ownerFirstName: string, decision: GateDecision, theme: { label: string; statement: string; type: string } | null,
  observations: Observation[], about: { label: string; statement: string } | null): string {
  const obs = observations.map((o, i) => `${i + 1}. situation: ${o.situation}\n   did or said: ${o.behaviour}\n   what followed: ${o.reaction}${o.guess ? `\n   the contributor's guess: ${o.guess}` : ""}`).join("\n");
  const head = decision.variant === "tension"
    ? `# A DIFFERENT VIEW OF A BELIEF ON THE MAP\n"${about?.label ?? ""}": ${about?.statement ?? ""}\nThe moments below describe this differently; write the different view as its own card.`
    : decision.variant === "support"
    ? `# SUPPORT FOR A BELIEF ON THE MAP\n"${about?.label ?? ""}": ${about?.statement ?? ""}\nWrite the card for this same belief as others see it.`
    : `# THE THEME\n"${theme?.label ?? ""}": ${theme?.statement ?? ""} (${theme?.type ?? ""})`;
  return `# OWNER\n${ownerFirstName}\n\n${head}\n\n# COUNTS\n${decision.people} people, ${decision.moments} moments\n\n# THE OBSERVATIONS (de-identified)\n${obs}`;
}

/** The longest run of words the summary copies from any observation field; the summary paraphrases, it never quotes. */
export function longestCopiedRun(summary: string, observations: Observation[]): number {
  const s = words(summary);
  let best = 0;
  for (const o of observations) {
    for (const field of [o.situation, o.behaviour, o.reaction, o.guess ?? ""]) {
      const f = words(field);
      for (let i = 0; i < s.length; i++) {
        for (let j = 0; j < f.length; j++) {
          let n = 0;
          while (i + n < s.length && j + n < f.length && s[i + n] === f[j + n]) n++;
          if (n > best) best = n;
        }
      }
    }
  }
  return best;
}

const KEEP = new Set(["I", "People", "Several", "Part", "You", "Your", "They", "Their", "Them", "Some", "Someone", "Those", "When", "Others", "One", "It", "Even", "Then", "There", "This", "That", "Not"]);

/** Capitalised words that are not the first word of a sentence: the floor for names the writer let through. */
export function midSentenceCapitals(fields: string[]): string[] {
  const out: string[] = [];
  for (const field of fields) {
    for (const sentence of field.split(/[.!?]\s+/)) {
      const ws = sentence.trim().split(/\s+/).slice(1);
      for (const w of ws) { const m = w.match(/^([A-Z][a-z]+)/); if (m && !KEEP.has(m[1])) out.push(m[1]); }
    }
  }
  return out;
}

export function synthesisProblems(syn: Synthesis, ownerFirstName: string, observations: Observation[]): string[] {
  const out: string[] = [];
  const all = `${syn.label} ${syn.statement} ${syn.summary}`;
  const bad = [...new Set([...cardWordHits(all), ...words(all).filter((w) => VERDICT_WORDS.includes(w))])];
  if (bad.length) out.push(`words: ${bad.join(", ")}`);
  const n = syn.label.split(/\s+/).filter(Boolean).length;
  if (n < 1 || n > 4) out.push(`label ${n} words`);
  if (!syn.statement || (syn.statement.match(/[.!?](\s|$)/g) ?? []).length > 1) out.push("statement not one sentence");
  if (!/\byou\b|\byour\b/i.test(syn.statement)) out.push("statement not in the second person");
  if (words(syn.summary).length > 60) out.push(`summary ${words(syn.summary).length} words`);
  if (!syn.summary.trim()) out.push("summary empty");
  if (/\b(?:partner|wife|husband|girlfriend|boyfriend|mother|father|mom|dad|sister|brother|boss|manager)\b/i.test(syn.summary)) out.push("summary names a relationship");
  if (/\b\d+ (?:people|person|friends|moments)\b/i.test(syn.summary)) out.push("summary counts people");
  const names = midSentenceCapitals([syn.label, syn.statement, syn.summary]).filter((w) => w !== ownerFirstName);
  if (names.length) out.push(`names: ${[...new Set(names)].join(", ")}`);
  if (longestCopiedRun(syn.summary, observations) >= 7) out.push("summary copies a run of seven or more words from an observation");
  if (/\b(?:you (?:should|need|must)|try to|because you)\b/i.test(all)) out.push("advice or a cause");
  return out;
}

export function readSynthesis(raw: string): Synthesis | null {
  let v: Record<string, unknown>;
  try { v = extractJson(raw) as Record<string, unknown>; } catch { return null; }
  if (!v || typeof v !== "object") return null;
  const s = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const type = (BELIEF_TYPES as readonly string[]).includes(String(v.type)) ? (v.type as BeliefType) : "how I tend to react";
  const domains = Array.isArray(v.domains) ? (v.domains as unknown[]).filter((d): d is Domain => typeof d === "string" && (DOMAINS as readonly string[]).includes(d)) : [];
  return { label: s(v.label, 60).replace(/[.!?]+$/, ""), statement: s(v.statement, 300), type, domains: domains.length ? domains : ["close_relationships"], summary: s(v.summary, 500) };
}
