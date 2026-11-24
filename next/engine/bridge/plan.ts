// Plan (BRIDGE-ENGINE §3.2): code, deterministic. Every friction maps to one transformation from a fixed menu;
// the model never chooses a remedy. Receiver-aware mode is built as a switch that is off and may only reorder.

import type { Belief } from "../types.ts";
import type { Analysis, FrictionKind, Plan, Relationship, Transformation } from "./types.ts";

export const MENU: Record<FrictionKind, string> = {
  absolute:
    'replace the absolute (always/never/every time) with the specific event the sender means, stated as what happened ("when dinner moved twice this week without a heads-up"), never as a label on the person in any tense ("you\'re bailing", "you bailed when it got inconvenient"); when the sender named no event, drop the absolute word and keep the behaviour in their words ("you always leave the dishes" → "you leave the dishes"), with no invented count or example, and no invented instance ("this one")',
  character:
    "replace the label on the person with the behaviour and its effect on the sender; if the words name no behaviour, recast the label as the sender's experience without inventing one; the label word itself goes, also as the sender's feeling",
  mind_reading:
    "replace the claim about the receiver's motive or feeling with the sender's own feeling, said about the sender (the FEELING given: \"I feel <it>\"); never \"it feels like you…\" followed by the same claim",
  sarcasm:
    "say the literal point underneath, plainly; the plain restatement may name the dissatisfaction the sarcasm carries, but it need not carry the whole message's intensity when another kept sentence already does",
  contempt: "say the literal point underneath, plainly, without the look-down wording",
  demand:
    "make the same ask a clear request; never weaker; when the order is a don't and the sender's words imply what they want instead (the same thing at another time, place or way), say that as the request, in the sender's words, adding no new ask",
  blame_stack: "put the current point first; keep the older ones only as the sender's list, not as a pile",
  vague_ask:
    "make the ask explicit if the sender's words imply it; otherwise flag it (to equals from) so the sender is asked what they want them to do",
  heat:
    "keep the strength of the feeling, said as the sender's own feeling at the same strength (the FEELING given; \"I'm really tired of…\"), without the heat word; never a milder word for it",
  you_blame:
    "replace the claim about what the receiver does or is with what happened and how it was for the sender; no claim about the receiver",
};

export const REGISTER: Record<Relationship, string> = {
  partner: "warm and direct, the way the sender talks to the person they share a life with",
  friend: "casual and direct, as between friends",
  family: "direct and familiar, with the care a family message carries",
  coworker: "plain and professional; no pet names, nothing raised; the points stay the same",
};

export const RECEIVER_AWARE = (Deno.env.get("PRESENCE_BRIDGE_RECEIVER_AWARE") ?? "false") === "true";
export const DECLINE_LINE = "I won't rewrite this one.";

export const MIN_CONTEXT_RECEIPTS = 2;

const fold = (x: string) => x.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").replace(/^\W+|\W+$/g, "");

export function makePlan(analysis: Analysis, senderBeliefs: Belief[], relationship: Relationship): Plan {
  const base = {
    relationship,
    register: REGISTER[relationship],
    transformations: [] as Transformation[],
    contextBelief: null,
    receiverAware: false as const,
  };
  if (analysis.safety === "risk") return { outcome: "declined_safety", ...base };
  if (analysis.safety === "threat_or_abuse") return { outcome: "declined_abuse", ...base };
  // A you_blame whose words sit inside a demand's words is the demand's content ("Stop telling me how to raise my kids"): the
  // demand row already rewrites them as a request, and a second row made the writer add a feeling sentence the budget had
  // no room for (E27 g07, every short demand that names a behaviour).
  const demands = analysis.frictions.filter((f) => f.kind === "demand").map((f) => fold(f.quote));
  const inDemand = (f: { kind: string; quote: string }) => f.kind === "you_blame" && demands.some((d) => d.includes(fold(f.quote)));
  let rows: Transformation[] = analysis.frictions.filter((f) => !inDemand(f)).map((f) => ({
    kind: f.kind,
    quote: f.quote,
    instruction: MENU[f.kind],
  }));
  // Receiver-aware framing may only choose the order; it adds, removes and alters nothing, and gets no receiver text here.
  if (RECEIVER_AWARE) rows = [...rows].reverse();
  const endorsed = new Map(senderBeliefs.filter((b) => b.status === "endorsed").map((b) => [b.id, b]));
  let contextBelief: Plan["contextBelief"] = null;
  for (const a of analysis.activated) {
    const b = endorsed.get(a.beliefId);
    if (b && b.receipts.length >= MIN_CONTEXT_RECEIPTS) {
      contextBelief = {
        id: b.id,
        label: b.label,
        statement: b.statement,
        receipts: b.receipts.map((r) => r.quote),
      };
      break;
    }
  }
  if (rows.length === 0) return { outcome: "nothing_to_change", ...base, contextBelief };
  return { outcome: "ok", ...base, transformations: rows, contextBelief };
}
