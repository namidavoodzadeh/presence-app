// The convergence gate (thesis "Convergence gate, the key rule"; CONTRACT §3 "3 / 0.7 / 2 / 3"): a new belief from outside needs
// three distinct contributors on one theme with a weighted mean confidence of 0.7 or more; quiet support for a belief already on the
// map needs two distinct contributors; a different view of a confirmed belief needs three. Near-identical observations count once.
// Pure: rows in, decisions out.

import type { GateDecision, GateInput } from "./types.ts";

export const GATE = { newPeople: 3, confidence: 0.7, supportPeople: 2, tensionPeople: 3 } as const;

function fingerprint(o: GateInput): string {
  return `${o.observation.situation} ${o.observation.behaviour}`.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Drop near-identical submissions (same person, same words) so one voice never counts twice. */
export function dedupe(inputs: GateInput[]): GateInput[] {
  const seen = new Set<string>();
  const out: GateInput[] = [];
  for (const i of inputs) {
    const k = `${i.contributorKey}|${fingerprint(i)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  return out;
}

function weightedMean(xs: { weight: number; confidence: number }[]): number {
  const w = xs.reduce((a, x) => a + x.weight, 0);
  return w > 0 ? Math.round((xs.reduce((a, x) => a + x.weight * x.confidence, 0) / w) * 100) / 100 : 0;
}

/** Every theme and every map match that clears the gate right now, from the link's held observations. */
export function decide(held: GateInput[]): GateDecision[] {
  const inputs = dedupe(held);
  const out: GateDecision[] = [];
  const byTheme = new Map<string, GateInput[]>();
  for (const i of inputs) if (i.themeKey) byTheme.set(i.themeKey, [...(byTheme.get(i.themeKey) ?? []), i]);
  for (const [themeKey, group] of byTheme) {
    const people = new Set(group.map((g) => g.contributorKey)).size;
    const confidence = weightedMean(group.map((g) => ({ weight: g.weight, confidence: g.themeConfidence })));
    if (people >= GATE.newPeople && confidence >= GATE.confidence) {
      out.push({ variant: "new", themeKey, beliefId: null, contributionIds: group.map((g) => g.id), people, moments: group.length, confidence });
    }
  }
  const byBelief = new Map<string, GateInput[]>();
  for (const i of inputs) if (i.mapBeliefId && i.mapRelation) byBelief.set(`${i.mapBeliefId}|${i.mapRelation}`, [...(byBelief.get(`${i.mapBeliefId}|${i.mapRelation}`) ?? []), i]);
  for (const [k, group] of byBelief) {
    const [beliefId, relation] = k.split("|");
    const people = new Set(group.map((g) => g.contributorKey)).size;
    const confidence = weightedMean(group.map((g) => ({ weight: g.weight, confidence: g.mapConfidence })));
    const need = relation === "supports" ? GATE.supportPeople : GATE.tensionPeople;
    if (people >= need && confidence >= GATE.confidence) {
      out.push({ variant: relation === "supports" ? "support" : "tension", themeKey: null, beliefId, contributionIds: group.map((g) => g.id), people, moments: group.length, confidence });
    }
  }
  return out;
}
