// Loads the Bridge run fixture: 12 drafts, and a sender map per persona built from next/fixtures/personas.json.

import { DOMAINS, TYPE_FOR_LEVEL } from "../types.ts";
import type { Belief, Domain, Level, Link } from "../types.ts";
import type { Persona } from "../sim/user.ts";
import { RELATIONSHIPS } from "./types.ts";
import type { Draft, Sender } from "./types.ts";

interface FixtureSender {
  personaId: string; firstName: string; labels: Record<string, string>; extraReceipts: Record<string, string>;
  earlierMessages: string[]; receiverShared: string[];
}

export interface BridgeFixture { senders: Map<string, Sender>; drafts: Draft[] }

/** A short label from a first-person statement when the fixture gives none ("I take extra shifts before anyone asks." → "Extra shifts"). */
export function derivedLabel(statement: string): string {
  const w = statement.replace(/[.!?]+$/, "").split(/\s+/).filter((x) => !/^(?:i|i'm|am|my|a|an|the|to|is|are|when|should|can|be|not)$/i.test(x));
  return w.slice(0, 2).map((x) => x.replace(/^[a-z]/, (c) => c.toUpperCase())).join(" ") || "Belief";
}

export function senderFromPersona(p: Persona, f: FixtureSender, date = "2026-10-20"): Sender {
  const beliefs: Belief[] = p.beliefs.map((b) => {
    const receipts = [b.evidence, f.extraReceipts[b.id]].filter((q): q is string => !!q).map((quote, i) => ({ quote, sessionId: `${p.id}-earlier`, turn: i + 1, date }));
    const level = b.level as Level;
    const links: Link[] = (p.edges ?? []).filter((e) => e.from === b.id).map((e) => ({ to: e.to, type: e.type === "supports" || e.type === "co_activates" ? "supports" as const : e.type === "conflicts_with" ? "tension" as const : "under" as const }));
    return { id: b.id, label: f.labels[b.id] ?? derivedLabel(b.statement), statement: b.statement, type: TYPE_FOR_LEVEL[level] ?? "a view or taste", level,
      domains: b.domains.filter((d): d is Domain => (DOMAINS as readonly string[]).includes(d)), confidence: 0.85, receipts, links, status: "endorsed" };
  });
  return { personaId: p.id, firstName: f.firstName, map: { beliefs, consent: {}, openThreads: [] }, earlierMessages: f.earlierMessages.slice(0, 3), receiverShared: f.receiverShared };
}

export async function loadBridgeFixture(root: URL): Promise<BridgeFixture> {
  const personas = (JSON.parse(await Deno.readTextFile(new URL("next/fixtures/personas.json", root))).personas as Persona[]);
  const by = new Map(personas.map((p) => [p.id, p]));
  const raw = JSON.parse(await Deno.readTextFile(new URL("next/fixtures/bridge_drafts.json", root))) as { senders: FixtureSender[]; drafts: Draft[] };
  const senders = new Map<string, Sender>();
  for (const f of raw.senders) {
    const p = by.get(f.personaId);
    if (!p) throw new Error(`bridge fixture: unknown persona ${f.personaId}`);
    senders.set(f.personaId, senderFromPersona(p, f));
  }
  for (const d of raw.drafts) {
    if (!senders.has(d.senderId)) throw new Error(`bridge fixture: draft ${d.id} names unknown sender ${d.senderId}`);
    if (!(RELATIONSHIPS as readonly string[]).includes(d.relationship)) throw new Error(`bridge fixture: draft ${d.id} has unknown relationship ${d.relationship}`);
  }
  return { senders, drafts: raw.drafts };
}
