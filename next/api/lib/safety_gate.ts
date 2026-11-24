// QA-B336 (COO 02:20Z 16 Nov): the API side of the one safety entry (engine/safety_entry.ts). Every route that takes a person's
// words calls gateWords() before it stores, maps, carries or sends anything. With PRESENCE_SAFETY_SEMANTIC off (hosted today) the
// floor decides alone, as before; with it on, the semantic reading runs and an unavailable reading stops (fail closed).
// The read is a safety read, so it carries no feature kill switch (a switched-off feature must not switch the safety read off),
// and its trace keeps counts only (the words are redacted before they are written).
import type { Ctx } from "./router.ts";
import { PostgresLedger } from "./ledger.ts";
import type { LedgerScope } from "./ledger.ts";
import type { ModelClient } from "../../engine/model/client.ts";
import { safetyEntry } from "../../engine/safety_entry.ts";
import type { EntryResult } from "../../engine/safety_entry.ts";
import { clientFor, trace } from "../bridge_engine.ts";
import { RESOURCES } from "../../engine/safety.ts";

/** PSY 16 Nov 2c-2d: no reading said stop, at least one could not answer, the floor was silent. Nothing is stored, sent or mapped; the
 *  person sees this line and one action, with the resources one tap away under it. Never "safety", "flagged", "concern" or "check failed". */
export const UNREAD_LINE = "Couldn't read that just now. Nothing was sent or saved. Try again in a moment.";
export const UNREAD_ACTION = "Try again";
export const UNREAD_HELP = "Need to talk to someone now?";
/** The Mirror friend page's own line (2f). */
export const MIRROR_UNREAD_LINE = "Couldn't send this just now. Try again in a moment.";

/** The body every surface adds to its own shape when `routed === "unavailable"`. */
export function unreadBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { state: "unavailable", line: UNREAD_LINE, action: UNREAD_ACTION, help: UNREAD_HELP, resources: RESOURCES, ...extra };
}

/** `person` is whose account the read is billed to when the caller is not signed in (a Mirror contributor's words bill the owner).
 * `forceSemantic` is for a surface whose words are about to be rewritten or carried to another person: that safety reader cannot be
 * rolled off with the general experiment switch. */
export async function gateWords(ctx: Ctx, text: string, person: string | null = null, forceSemantic = false, signal?: AbortSignal): Promise<EntryResult> {
  if (!forceSemantic && ctx.env.safetySemantic !== true) return safetyEntry(null, text, { semantic: false });
  const scope: LedgerScope = { person: ctx.caller?.id ?? person, ownerPreview: ctx.caller?.isPreview ?? false, conversationId: null };
  const ledger = new PostgresLedger(ctx.service, scope);
  let client: ModelClient | null = null;
  try { client = clientFor(ctx, ledger, "insight"); } catch { client = null; }
  const r = await safetyEntry(client, text, { semantic: true, ...(signal ? { signal } : {}) });
  if (r.exchanges.length) { try { await trace(ctx, scope, ledger, r.exchanges, null, true); } catch { /* diagnostics only; the decision stands */ } }
  return r;
}
