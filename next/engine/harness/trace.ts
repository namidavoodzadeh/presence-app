// Trace schema shared by the Talk runner and the report.

import type { CheckResult, PersonMap, Rating, Session } from "../types.ts";
import type { TurnTrace } from "../talk/turn.ts";
import type { FinishTrace, RiskStopTrace } from "../talk/finish.ts";
import type { SimReply } from "../sim/user.ts";

export type ConversationKind = "normal" | "sensitive" | "risk" | "second_session";

export interface ConversationTurn {
  turn: number;
  sim: Omit<SimReply, "exchange"> & { exchange: SimReply["exchange"] | null };
  engine: TurnTrace | null;
  consent?: { domain: string; answer: string } | null;
  ratingsApplied: Record<string, Rating>;
  cents: number;
  ms: number;
}

export interface ConversationTrace {
  id: string;
  personaId: string;
  personaName: string;
  style: string;
  kind: ConversationKind;
  sessionNumber: number;
  startedAt: string;
  model: string;
  opener: string | null;
  turns: ConversationTurn[];
  finish: FinishTrace | null;
  riskStop?: RiskStopTrace | null;   // set instead of finish when a risk turn stopped the session
  session: Session;
  mapBefore: PersonMap;
  mapAfter: PersonMap;
  stoppedBy: "turns" | "risk" | "budget" | "sim_failed" | "engine_failed" | "close";
  cents: number;
  ms: number;
  targets: CheckResult[];
}

export interface RunManifest {
  run: string;
  mode: "live" | "fake";
  startedAt: string;
  finishedAt: string;
  model: string;
  capCents: number;
  cents: number;
  ledgerBefore: Record<string, unknown> | null;
  ledgerAfter: Record<string, unknown> | null;
  conversations: { id: string; file: string; persona: string; kind: string; cents: number; turns: number; targetsOk: number; targetsTotal: number }[];
  notes: string[];
}

export interface BridgeManifest {
  kind: "bridge";
  run: string;
  mode: "live" | "fake";
  startedAt: string;
  finishedAt: string;
  model: string;
  capCents: number;
  cents: number;
  ledgerBefore: Record<string, unknown> | null;
  ledgerAfter: Record<string, unknown> | null;
  drafts: { id: string; file: string; sender: string; relationship: string; expected: string; status: string; calls: number; cents: number; targetsOk: number; targetsTotal: number }[];
  notes: string[];
}
