// E27 (1), CEO 09:55 PT 07 Nov: the Bridge golden gate's door into the real engine. POST /eval/bridge/run takes one
// golden case's fictional sender map and receiver map in the body and answers exactly what POST /bridge/run answers
// (runReply, the same code), on the real model, so next/scripts/eval_bridge_golden.ts can score the live path without
// seeding twenty fictional accounts into a database.
//
// Closed unless all three hold: not the hosted runtime (the staging project, with PRESENCE_STAGING=true, counts as not hosted), PRESENCE_BRIDGE_EVAL=true in this server's environment, and the
// request carries x-presence-eval-token equal to PRESENCE_BRIDGE_EVAL_TOKEN (16+ characters). Closed answers 404, as an
// unknown path does. Nothing is stored: no trace, no engine_calls row, no bridge; the model spend goes through the
// shared usage ledger with person null, as the eval harnesses' does (A59), and a per-call cap bounds it.

import type { Belief, BeliefStatus } from "../engine/types.ts";
import { AnthropicClient, CappedModelClient } from "../engine/model/client.ts";
import type { ModelClient } from "../engine/model/client.ts";
import { RELATIONSHIPS } from "../engine/bridge/types.ts";
import type { BridgeTrace, Relationship, Sender } from "../engine/bridge/types.ts";
import { hooks, refused, RUN_MODEL, runReply, textOf, type SharedBelief } from "./bridge_engine.ts";
import { route, type Ctx } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { EVAL_KIND, PostgresLedger } from "./lib/ledger.ts";
import { secretEquals } from "./lib/secret.ts";

export const EVAL_CAP_CENTS = 40;
const MIN_TOKEN = 16;

/** Open only off hosted, with the switch on and the matching token. Exported for the Tier 1 test. */
export async function evalOpen(isHosted: boolean, envGet: (k: string) => string | undefined, header: string | null): Promise<boolean> {
  // Hosted is closed, except the staging project, which carries PRESENCE_STAGING=true as a function secret (production never does).
  if (isHosted && envGet("PRESENCE_STAGING") !== "true") return false;
  if (envGet("PRESENCE_BRIDGE_EVAL") !== "true") return false;
  const token = envGet("PRESENCE_BRIDGE_EVAL_TOKEN") ?? "";
  if (token.length < MIN_TOKEN || !header) return false;
  return await secretEquals(header, token);
}

type R = Record<string, unknown>;

function str(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) throw new ApiError("invalid", "", { field });
  return v;
}

/** A golden sender belief as loadMap would give it: a rating of not_me is set aside (disputed), any other rating confirmed. */
export function beliefFromGolden(raw: R, i: number): Belief {
  const id = str(raw.id, `sender.beliefs[${i}].id`);
  const rating = raw.rating;
  const status: BeliefStatus = rating === "not_me" ? "disputed"
    : rating === "very_me" || rating === "partly" ? "endorsed"
    : raw.status === "endorsed" || raw.status === "disputed" ? raw.status : "inferred";
  const receipts = (Array.isArray(raw.receipts) ? raw.receipts : []).map((r, j) => {
    const x = (r && typeof r === "object" ? r : {}) as R;
    return { quote: str(x.quote, `sender.beliefs[${i}].receipts[${j}].quote`), sessionId: `eval-${id}`, turn: j + 1, date: str(x.date, `sender.beliefs[${i}].receipts[${j}].date`) };
  });
  return { id, label: str(raw.label, `sender.beliefs[${i}].label`), statement: str(raw.statement, `sender.beliefs[${i}].statement`), type: "something I believe is true",
    level: "L2", domains: ["close_relationships"], confidence: 0.8, receipts, links: [], status };
}

/** Only beliefs marked shared reach the engine: an unshared one is dropped here, as link_prefs consent would drop it. */
export function sharedFromGolden(receiver: unknown): SharedBelief[] {
  const r = (receiver && typeof receiver === "object" ? receiver : {}) as R;
  return (Array.isArray(r.beliefs) ? r.beliefs as R[] : []).filter((b) => b && b.shared === true)
    .map((b, i) => ({ id: str(b.id, `receiver.beliefs[${i}].id`), label: str(b.label, `receiver.beliefs[${i}].label`), statement: str(b.statement, `receiver.beliefs[${i}].statement`) }));
}

export function evalInput(b: R): { text: string; relationship: Relationship; sender: Sender; receiverShared: SharedBelief[] } {
  const text = textOf(b);
  const relationship = String(b.relationship);
  if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) throw new ApiError("invalid", "", { field: "relationship" });
  const s = (b.sender && typeof b.sender === "object" ? b.sender : {}) as R;
  const beliefs = (Array.isArray(s.beliefs) ? s.beliefs as R[] : []).map(beliefFromGolden);
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : "I";
  const receiverShared = sharedFromGolden(b.receiver);
  const r = (b.receiver && typeof b.receiver === "object" ? b.receiver : {}) as R;
  const receiverFirstName = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
  // receiverShared (strings) is what verify proves never leaks into a rewrite; receiverBeliefs is what the analysis reads.
  // v1.61: a golden "shared" belief stands for a per-item grant (v1.52), the only share the phone's path reads for a real
  // receiver, so a receiver note can carry its source (the source rule) exactly as on the phone.
  return { text, relationship: relationship as Relationship, receiverShared,
    sender: { personaId: `eval-${name.toLowerCase()}`, firstName: name, map: { beliefs, consent: {}, openThreads: [] }, earlierMessages: [],
      receiverShared: receiverShared.map((x) => x.statement), receiverBeliefs: receiverShared.map((x) => ({ ...x, sharedItem: true })),
      ...(receiverFirstName ? { receiverFirstName } : {}) } };
}

/** Eval only, never the phone: what the analysis found, so the gate can score E27 (2) before the v1.42 reply shape exists. */
export function analysisOf(t: BridgeTrace | null): Record<string, unknown> | null {
  if (!t?.analysis) return null;
  return {
    frictions: t.analysis.frictions.map((f) => ({ kind: f.kind, quote: f.quote })),
    from_you: (t.touches?.fromYou ?? []).map((y) => ({ belief_id: y.beliefId, wording: y.wording, receipt: y.receipt, date: y.date, start: y.start, end: y.end })),
    from_them: (t.touches?.fromThem ?? []).map((x) => ({ belief_id: x.beliefId, wording: x.wording, why: x.why, start: x.start, end: x.end })),
  };
}

/** Eval only: each rewrite attempt's text and what rejected it, so a could_not_bridge miss can be read, not guessed. */
export function attemptsOf(t: BridgeTrace | null): Record<string, unknown>[] {
  return (t?.attempts ?? []).map((a) => ({
    bridged: a.rewrite?.bridged ?? null,
    context_note: a.rewrite?.contextNote ?? null,
    versions: a.versions ?? [],
    failed_checks: a.codeChecks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`),
    critic: a.critic?.read ? { pass: a.critic.read.pass, points_missing: a.critic.read.pointsMissing, added: a.critic.read.added, receiver_inner_life: a.critic.read.receiverInnerLife, voice: a.critic.read.voice, feeling_preserved: a.critic.read.feelingPreserved, notes: a.critic.read.notes } : null,
  }));
}

function evalClient(ctx: Ctx): { client: ModelClient; capped: CappedModelClient | null } {
  const ledger = new PostgresLedger(ctx.service, { person: null, ownerPreview: false, conversationId: null }, EVAL_KIND.bridgeRun);
  if (hooks.client) return { client: hooks.client(ctx, ledger, "run"), capped: null };
  if (!ctx.env.anthropicKey || !ctx.env.anthropicWorkspace) throw new ApiError("unreachable", "Can't reach Presence right now.", { detail: "anthropic key or workspace not configured" });
  const inner = new AnthropicClient({ config: { key: ctx.env.anthropicKey, workspace: ctx.env.anthropicWorkspace }, ledger, defaultModel: RUN_MODEL, thinking: "between_tools", timeoutMs: 55_000 });
  const capped = new CappedModelClient(inner, EVAL_CAP_CENTS, RUN_MODEL);
  return { client: capped, capped };
}

route("POST", "/eval/bridge/run", async (ctx) => {
  const envGet = (k: string) => { try { return Deno.env.get(k); } catch { return undefined; } };
  if (!await evalOpen(ctx.env.isHosted, envGet, ctx.req.headers.get("x-presence-eval-token"))) throw new ApiError("not_found", "", { path: "/eval/bridge/run" });
  const started = performance.now();
  const input = evalInput(await ctx.body());
  const { client, capped } = evalClient(ctx);
  const ledger = new PostgresLedger(ctx.service, { person: null, ownerPreview: false, conversationId: null }, EVAL_KIND.bridgeRun);
  let trace: BridgeTrace | null = null;
  const out = await runReply(client, input.text, input.relationship, input.sender, {
    after: (exchanges) => { refused(ledger, exchanges); return Promise.resolve(); },
    failure: (detail) => Promise.resolve(`eval:${detail.slice(0, 300)}`),
    trace: (t) => { trace = t; },
    semanticCheck: ctx.env.safetySemantic === true,
  });
  out.latency_ms = Math.round(performance.now() - started);
  out.eval = { cents: capped?.spent ?? 0, cap_cents: EVAL_CAP_CENTS, analysis: analysisOf(trace), attempts: attemptsOf(trace) };
  return json(out);
}, false);
