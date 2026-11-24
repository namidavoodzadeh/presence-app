// TQ3 / law 8: the existing Bridge screen decides before a note can become parked state.
// This boundary never tries to rediscover risk from the note's words.

import { RESOURCES } from "../safety.ts";
import type { BridgeSafety } from "../bridge/types.ts";

export interface ParkInput {
  writerId: string;
  partnerId: string;
  text: string;
}

export interface SafetyScreenResult {
  safety: BridgeSafety;
  reason?: string;
}

export type ParkDecision =
  | { state: "feature_off"; store: null; writer: null; shared: null }
  | { state: "parked"; store: ParkInput; writer: null; shared: null }
  | {
    state: "safety";
    store: null;
    writer: { line: string; resources: typeof RESOURCES };
    shared: null;
  }
  | { state: "declined"; store: null; writer: null; shared: null };

/**
 * A positive writer-safety result means no database payload and no check-in payload exist.
 * Only the writer receives resources. Threatening/abusive outbound notes are also refused,
 * but use Bridge's ordinary declined state rather than pretending the writer is at risk.
 */
export function decidePark(enabled: boolean, input: ParkInput, screen: SafetyScreenResult): ParkDecision {
  if (!enabled) return { state: "feature_off", store: null, writer: null, shared: null };
  if (screen.safety === "risk") {
    return {
      state: "safety",
      store: null,
      writer: { line: RESOURCES.message, resources: RESOURCES },
      shared: null,
    };
  }
  if (screen.safety === "threat_or_abuse") {
    return { state: "declined", store: null, writer: null, shared: null };
  }
  return { state: "parked", store: { ...input }, writer: null, shared: null };
}
