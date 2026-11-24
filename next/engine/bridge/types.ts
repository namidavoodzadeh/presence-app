// Bridge engine types (docs/NEXT-ENGINE.md §3, docs/BRIDGE-ENGINE.md §1 and §3, docs/BRIDGE-INSIGHT.md).

import type { Belief, CheckResult, Feeling, ModelExchange, PersonMap } from "../types.ts";
import type { RESOURCES } from "../safety.ts";
import type { BeliefTouches } from "./touches.ts";

export const RELATIONSHIPS = ["partner", "friend", "family", "coworker"] as const;
export type Relationship = typeof RELATIONSHIPS[number];

// E27 (2a): heat ("hate", "can't stand", "sick of") and you_blame (claims about the receiver: "you ignore", "you never", "you don't care").
export const FRICTION_KINDS = ["absolute", "character", "mind_reading", "sarcasm", "contempt", "demand", "blame_stack", "vague_ask", "heat", "you_blame"] as const;
export type FrictionKind = typeof FRICTION_KINDS[number];

export const POINT_KINDS = ["complaint", "request", "feeling", "fact", "question"] as const;
export type PointKind = typeof POINT_KINDS[number];

export type BridgeSafety = "none" | "risk" | "threat_or_abuse";

export interface Point { kind: PointKind; quote: string }
export interface Friction { kind: FrictionKind; quote: string }
export interface Activated { beliefId: string; why: string; quote?: string }
/** E27 (2c): a belief the receiver shared with the sender (link_prefs share, law 10 consent). Wording only: its receipts
 *  never reach the engine, the model or the sender. */
/** `sharedItem` marks a per-item grant (contract v1.52): `statement` is then the wording its owner approved for this sender. */
export interface ReceiverBelief { id: string; label: string; statement: string; sharedItem?: boolean }
/** The words that make a message a threat or abuse (CPO 16:00 10-27: insults are bridged, only threats and abuse are refused). */
export interface SafetyQuote { kind: "threat" | "abuse"; quote: string }
export interface FlaggedSpan { start: number; end: number; kind: "threat" | "abuse" }

/** Model call 1, after code checks. Quotes are exact substrings of the message. */
export interface Analysis {
  points: Point[];
  feeling: { name: string; intensity: number };
  frictions: Friction[];
  activated: Activated[];
  /** E27 (2c): which of the receiver's shared beliefs the wording may land on; ids outside the shared list are dropped. */
  landsOn?: Activated[];
  safety: BridgeSafety;
  safetyReason: string;
  /** Exact quotes of the threatening or abusive parts (S15b underlines); empty unless safety is threat_or_abuse. */
  safetyQuotes: SafetyQuote[];
  tone?: Feeling;         // the design's seven-word reading of the feeling (engine item 6); derived from feeling.name when absent
}

export interface Transformation { kind: FrictionKind; quote: string; instruction: string }

export type PlanOutcome = "ok" | "nothing_to_change" | "declined_safety" | "declined_abuse";

/** Code, deterministic (BRIDGE-ENGINE §3.2). The model never chooses a remedy. */
export interface Plan {
  outcome: PlanOutcome;
  relationship: Relationship;
  register: string;
  transformations: Transformation[];
  /** One context line at most, and only from an endorsed belief of the sender's with 2+ receipts. */
  contextBelief: { id: string; label: string; statement: string; receipts: string[] } | null;
  receiverAware: false;
}

export interface Change { kind: FrictionKind | "context"; from: string; to: string }

/** Model call 2. */
export interface Rewrite { bridged: string; contextNote: string | null; changes: Change[]; tone?: Feeling }

/** Model call 3, the critic. */
export interface Critic {
  pass: boolean;
  pointsMissing: string[];
  added: string[];
  receiverInnerLife: string[];
  voice: number;              // 1–5
  feelingPreserved: boolean;
  notes: string;
}

export type BridgeStatus = "ok" | "could_not_bridge" | "declined_safety" | "declined_abuse";

/** Contract output (BRIDGE-ENGINE §4) plus the "nothing to change" flag (NEXT-ENGINE §3). */
export interface BridgeResult {
  draftId: string;
  status: BridgeStatus;
  original: string;
  bridged: string | null;
  contextNote: string | null;
  changes: Change[];
  usedBeliefs: string[];
  nothingToChange: boolean;
  /** nothingToChange because the only planned frictions were asks the sender's words did not resolve: the text stands and the
   *  sender is told it does not yet say what they want (COO 15:15 10-27). */
  askUnresolved: boolean;
  receiverAware: false;
  /** What the sender sees when bridging does not happen. */
  line: string | null;
  resources: typeof RESOURCES | null;
}

export interface InsightFriction extends Friction { start: number; end: number; howItLands: string }
export interface InsightTouch { beliefId: string; label: string; gentleStatement: string }

/** "Send mine, with insight" (BRIDGE-INSIGHT §2–3): built from the same analysis, no extra call. */
export interface InsightResult {
  state: "insight" | "risk" | "declined";
  points: Point[];
  frictions: InsightFriction[];
  touches: InsightTouch[];
  safety: BridgeSafety;
  line: string | null;
  resources: typeof RESOURCES | null;
}

export interface Sender {
  personaId: string;
  firstName: string;
  map: PersonMap;
  /** Up to 3 earlier messages by the sender: the voice sample for the writer. */
  earlierMessages: string[];
  /** Beliefs the receiver shared through a grant. Never sent to the model while receiver-aware mode is off;
   *  the verify step still proves none of their text leaks into the rewrite. */
  receiverShared: string[];
  /** E27 (2c): the receiver's shared beliefs (link_prefs consent), wording only; read by the analysis for lands_on. */
  receiverBeliefs?: ReceiverBelief[];
  /** The receiver's first name, for the "From what <Name> shared:" label (v1.51). */
  receiverFirstName?: string;
}

export interface Draft {
  id: string;
  senderId: string;
  relationship: Relationship;
  message: string;
  hiddenIntent: string;
  expected: { frictions: FrictionKind[]; safety: BridgeSafety; nothingToChange: boolean };
}

export interface RewriteAttempt {
  exchange: ModelExchange;
  rewrite: Rewrite | null;
  /** Every version the reply offered, main first (E27); rewrite is the one code picked. */
  versions?: string[];
  codeChecks: CheckResult[];
  critic: { exchange: ModelExchange; read: Critic | null } | null;
  pass: boolean;
}

export interface BridgeTrace {
  draft: Draft;
  sender: { personaId: string; firstName: string; beliefs: Belief[] };
  floor: { risk: string; reason: string; routed: BridgeSafety };
  exchanges: ModelExchange[];
  analysis: Analysis | null;
  analysisChecks: CheckResult[];
  analysisRepaired: boolean;
  plan: Plan | null;
  attempts: RewriteAttempt[];
  result: BridgeResult;
  insight: InsightResult | null;
  /** E27 (2b, 2c): belief touches on both sides, from the analysis; null when no analysis ran. */
  touches?: BeliefTouches | null;
  targets: CheckResult[];
  /** PSY 16 Nov 2c: the safety reading could not answer (and the analysis did not say stop): nothing is rewritten, sent or kept. Not a risk. */
  unreadable?: boolean;
  cents: number;
  ms: number;
}
