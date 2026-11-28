// V3 communication model, Talk on the question bank (spec 4.2), as its own route so the ordinary Talk path stays exactly as it is:
//   POST /comm/talk/turn  { text?, conversation_id?, way_in?: "invited_by_partner" | "invited_by_friend" | "own_download", name? }
// No text = the opener: the planner's first question, no model call. With text = the person's answer to the question asked before: the
// risk precheck runs first (a stop makes no call and stores nothing, law 8), then ONE model call (engine/talk/comm_turn.ts) whose reply is
// checked and falls back to the bank's own words. The reply may carry ONE drafted item in the person's own words; it is never stored
// here. "That's me" posts it to POST /comm/items (source talk_said), so the person decides (law 3).
// Same owner-only switch as /comm/items (PRESENCE_COMM_ITEMS plus PRESENCE_COMM_OWNER_IDS). Same ledger, caps and trace as Talk.
// NOT built here: the old extraction at /talk/finish for a comm session (it reads nothing new from these turns), the gold run for the
// cheaper model (TALK_MODEL is used until the staging gold run records a pass for COMM_TURN_MODEL).

import { route, type Ctx } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";
import { messageObject } from "./lib/objects.ts";
import { PostgresLedger } from "./lib/ledger.ts";
import { clientFor, MAX_TEXT, scopeFor, TALK_MODEL, traceExchanges } from "./talk.ts";
import { requireCommAccess } from "./comm_items.ts";
import { COMM_KINDS, type CommKind } from "../engine/comm.ts";
import { type PlanInput, planNextQuestion, QUESTION_BANK, type WayIn } from "../engine/comm_planner.ts";
import { buildCommTurnRequest, commTurnPrecheck, finishCommTurn } from "../engine/talk/comm_turn.ts";
import { RESOURCES } from "../engine/safety.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { loadPairContext } from "./pair_context.ts";
import { aiConsentRefusal, hasAiConsent } from "./lib/ai_consent.ts";

const WAYS: readonly WayIn[] = ["invited_by_partner", "invited_by_friend", "own_download"];
const MAX_NAME = 40;
const isKind = (k: unknown): k is CommKind => typeof k === "string" && (COMM_KINDS as readonly string[]).includes(k);

interface CommMark { kind: CommKind; question_from?: "model" | "bank" }
const markOf = (m: Row): CommMark | null => {
  const c = (m.reply as Row | null)?.comm as Row | undefined;
  return c && isKind(c.kind) ? { kind: c.kind } : null;
};

async function conversationFor(ctx: Ctx, b: Row): Promise<Row> {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  if (typeof b.conversation_id === "string" && b.conversation_id) {
    const { data, error } = await db.from("conversations").select("*").eq("id", b.conversation_id).eq("owner", owner).is("deleted_at", null).maybeSingle();
    if (error) dbError(error, "conversations.comm");
    if (!data) throw new ApiError("not_found", "", { where: "conversation" });
    return data as Row;
  }
  const { data, error } = await db.from("conversations").insert({ owner, mode: "voice", source: "talk" }).select("*").single();
  if (error) dbError(error, "conversations.insert");
  return data as Row;
}

/** The person's last answer still waiting for its reply (a refused or failed call), or null. */
function pendingAnswer(rows: Row[]): Row | null {
  const last = rows.filter((m) => m.role === "me").at(-1);
  if (!last || rows.some((m) => m.role === "presence" && m.turn === last.turn)) return null;
  return last;
}

/** Keep the person's answer: the same words still waiting for a reply are the same row (a retry adds nothing). */
async function keepAnswer(ctx: Ctx, cid: string, rows: Row[], raw: string): Promise<{ me: Row; turn: number }> {
  const pending = pendingAnswer(rows);
  if (pending && String(pending.text ?? "").trim() === raw) return { me: pending, turn: pending.turn as number };
  const turn = rows.filter((m) => m.role === "me").length + 1;
  const { data, error } = await ctx.caller!.db.from("messages").insert({ owner: ctx.caller!.id, conversation_id: cid, role: "me", turn, text: raw, answer_kind: "told" }).select("*").single();
  if (error) dbError(error, "messages.insert");
  return { me: data as Row, turn };
}

/**
 * An answer kept while consent was missing (review round 4, #8). It carries `pending_consent`, so only these rows are ever replaced or
 * removed here: a regular Talk answer in the same table is never touched. One per conversation: new words replace the old ones, which
 * no model has read, so the turn does not move on past words that were never checked.
 */
export async function keepConsentPending(ctx: Ctx, cid: string, raw: string): Promise<Row> {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const rows = await answerRows(ctx, cid);
  const held = rows.find((m) => m.role === "me" && m.pending_consent === true);
  if (held) return String(held.text ?? "").trim() === raw ? held : await rewordConsentPending(ctx, held, raw);
  const turn = rows.filter((m) => m.role === "me").length + 1;
  const { data, error } = await db.from("messages").insert({ owner, conversation_id: cid, role: "me", turn, text: raw, answer_kind: "told", pending_consent: true }).select("*").single();
  if (!error) return data as Row;
  // A concurrent request kept one first (the database allows one per conversation): this one becomes those words.
  if ((error as { code?: string }).code !== "23505") dbError(error, "messages.insert.pending_consent");
  const again = (await answerRows(ctx, cid)).find((m) => m.role === "me" && m.pending_consent === true);
  if (!again) dbError(error, "messages.insert.pending_consent");
  return String(again!.text ?? "").trim() === raw ? again! : await rewordConsentPending(ctx, again!, raw);
}

/** New words for the kept answer, in place: one write, so the answer that was confirmed saved is never without a row. */
async function rewordConsentPending(ctx: Ctx, held: Row, raw: string): Promise<Row> {
  const { data, error } = await ctx.caller!.db.from("messages").update({ text: raw }).eq("id", held.id).eq("owner", ctx.caller!.id).eq("pending_consent", true).select("*").single();
  if (error) dbError(error, "messages.update.pending_consent");
  return data as Row;
}

/** Remove the caller's consent-pending answer in this conversation when it holds exactly these words (a held or stopped
 * reading of them). A different kept answer stays: it was confirmed saved and has not been read. */
export async function dropConsentPending(ctx: Ctx, cid: unknown, raw: string): Promise<void> {
  if (typeof cid !== "string" || !cid) return;
  const { error } = await ctx.caller!.db.from("messages").delete().eq("owner", ctx.caller!.id).eq("conversation_id", cid).eq("pending_consent", true).eq("text", raw);
  if (error) dbError(error, "messages.delete.pending_consent");
}

/**
 * On a consented turn whose words passed the safety reading: the kept answer becomes these words and an ordinary answer, in
 * place. Only one request can do this (the update matches while the row is still pending); a concurrent retry that loses
 * answers `409 conflict`, so the kept answer is answered once.
 */
export async function settleConsentPending(ctx: Ctx, cid: string, raw: string): Promise<void> {
  const rows = await answerRows(ctx, cid);
  const held = rows.find((m) => m.role === "me" && m.pending_consent === true);
  if (!held) return;
  const { data, error } = await ctx.caller!.db.from("messages").update({ text: raw, pending_consent: false }).eq("id", held.id).eq("owner", ctx.caller!.id).eq("pending_consent", true).select("id");
  if (error) dbError(error, "messages.update.pending_consent");
  if (!data || (data as Row[]).length === 0) throw new ApiError("conflict", "", { reason: "already_answering", conversation_id: cid });
}

async function answerRows(ctx: Ctx, cid: string): Promise<Row[]> {
  const { data: msgs, error: mErr } = await ctx.caller!.db.from("messages").select("*").eq("conversation_id", cid).neq("superseded", true).order("turn");
  if (mErr) dbError(mErr, "messages.comm");
  return ((msgs ?? []) as Row[]).filter((m) => !m.deleted_at);
}

async function planFor(ctx: Ctx, conversation: Row, marks: CommMark[], wayIn: WayIn, name: string | undefined) {
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const pair = await loadPairContext(db, owner);
  const items = Object.values(pair.sender.itemsByKind).flat();
  const started = String(conversation.created_at ?? "");
  const input: PlanInput = {
    // The first session is the one before any item exists; an item saved during this very session does not turn it into the second.
    sessionNumber: items.some((r) => started && String(r.confirmedAt) < started) ? 2 : 1,
    wayIn,
    turnsTaken: marks.length,
    haveKinds: [...new Set(items.filter((r) => isKind(r.kind)).map((r) => r.kind as CommKind))],
    askedThisSession: marks.map((m) => m.kind),
    name,
  };
  return { input, plan: planNextQuestion(input) };
}

route("POST", "/comm/talk/turn", async (ctx) => {
  requireCommAccess(ctx);
  const started = performance.now();
  const db = ctx.caller!.db, owner = ctx.caller!.id;
  const b = await ctx.body();
  const raw = typeof b.text === "string" ? b.text.trim() : "";
  if (raw.length > MAX_TEXT) throw new ApiError("invalid", "", { field: "text", max: MAX_TEXT });
  if (b.text !== undefined && b.text !== null && typeof b.text !== "string") throw new ApiError("invalid", "", { field: "text" });
  const wayIn: WayIn = b.way_in === undefined ? "own_download" : (WAYS as readonly unknown[]).includes(b.way_in) ? b.way_in as WayIn : (() => { throw new ApiError("invalid", "", { field: "way_in" }); })();
  // deno-lint-ignore no-control-regex
  const name = typeof b.name === "string" ? b.name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME) || undefined : undefined;

  // Law 8 first: a risky answer stops here, with nothing stored and no call. (Mapping stays off for this conversation: no item is ever drafted.)
  if (raw && commTurnPrecheck(raw).stop) {
    // A retry of an answer kept while consent was missing: that kept answer goes too (nothing is stored on a stop).
    await dropConsentPending(ctx, b.conversation_id, raw);
    return json({ conversation: null, message: null, reply: { state: "safety", reflection: "", question: "", comm: null, item: null, resources: RESOURCES }, latency_ms: 0 });
  }

  // CONTRACT §7 AI consent: without it no model is called (the safety reading included). The answer is kept, as Talk keeps it
  // (flows/talk.md "the words were kept"), so the same words are answered once consent exists. The kept row is only a pending
  // answer: nothing reads it until the safety gate below has passed on the consented retry, and a stop there deletes it.
  if (raw && !(await hasAiConsent(ctx))) {
    const conversation = await conversationFor(ctx, b);
    const me = await keepConsentPending(ctx, conversation.id as string, raw);
    throw aiConsentRefusal({ saved: true, message_id: me.id, conversation_id: conversation.id });
  }

  // K-0002: the one safety gate, before any row is made or model called; held (unreadable) stores nothing.
  if (raw) {
    const g = await requireSafetyPass(ctx, raw, "comm_talk");
    // An answer kept while consent was missing has not been read yet: a held or stopped reading removes it (stores nothing).
    if (g.routed === "unavailable" || g.stop) await dropConsentPending(ctx, b.conversation_id, raw);
    if (g.routed === "unavailable") return json({ conversation: null, message: null, reply: { ...unreadBody(), reflection: "", question: "", comm: null, item: null }, latency_ms: 0 });
    if (g.stop) return json({ conversation: null, message: null, reply: { state: "safety", reflection: "", question: "", comm: null, item: null, resources: RESOURCES }, latency_ms: 0 });
  }

  const conversation = await conversationFor(ctx, b);
  const cid = conversation.id as string;
  if (raw) await settleConsentPending(ctx, cid, raw);
  const rows = await answerRows(ctx, cid);
  const presence = rows.filter((m) => m.role === "presence");
  const marks = presence.map(markOf).filter((m): m is CommMark => !!m);
  const answeredKind = marks.at(-1)?.kind ?? null;
  const { input, plan } = await planFor(ctx, conversation, marks, wayIn, name);
  const pending = raw ? pendingAnswer(rows) : null;
  const kept = pending && String(pending.text ?? "").trim() === raw ? pending : null;
  const turn = kept ? kept.turn as number : rows.filter((m) => m.role === "me").length + 1;
  const convPatch: Row = { last_active_at: new Date().toISOString(), status: "active" };

  const finish = async (reply: Record<string, unknown>, meRow: Row | null, spoken: string, patch: Row = {}) => {
    const presenceId = crypto.randomUUID();
    const full = { message_id: presenceId, turn: meRow ? turn : 0, ...reply };
    const { error } = await db.from("messages").insert({ id: presenceId, owner, conversation_id: cid, role: "presence", turn: meRow ? turn : 0, text: spoken, reply: full, ref: null });
    if (error) dbError(error, "messages.insert");
    const { data: conv, error: cErr } = await db.from("conversations").update({ ...convPatch, ...patch }).eq("id", cid).select("*").single();
    if (cErr) dbError(cErr, "conversations.update");
    return json({
      conversation: { id: conv.id, status: conv.status, session_number: input.sessionNumber },
      message: meRow ? messageObject(meRow) : null, reply: full, latency_ms: Math.round(performance.now() - started),
    });
  };
  const askReply = (question: string, kind: CommKind, from: "model" | "bank", extra: Record<string, unknown> = {}) =>
    ({ state: "ask", reflection: "", question, comm: { kind, question_from: from }, item: null, item_state: null, ...extra });
  const doneReply = (reason: string, extra: Record<string, unknown> = {}) =>
    ({ state: "done", reflection: "", question: "", comm: null, item: null, item_state: null, reason, ...extra });

  // The opener: nothing was said yet, so no model call and no row for the person.
  if (!raw) {
    if (marks.length) throw new ApiError("invalid", "", { field: "text" });   // an answer is needed once a question is open
    if (plan.done) return finish(doneReply(plan.reason), null, "", { status: "finished", finished_at: new Date().toISOString() });
    return finish(askReply(plan.question, plan.kind, "bank"), null, plan.question);
  }

  // The person's answer is stored as they said it (like every Talk turn; a kept answer from a refused turn is the same row), then one
  // checked model call.
  const { me } = await keepAnswer(ctx, cid, rows, raw);

  // When the session's budget is spent this answer is the last: it still gets its reflection and its item, but no next question.
  const closing = plan.done;
  const askPlan = plan.done
    ? { done: false as const, kind: answeredKind ?? ("other" as CommKind), question: "", entry: QUESTION_BANK.find((e) => e.kind === answeredKind) ?? { kind: answeredKind ?? ("other" as CommKind), open: "" } }
    : plan;
  const turnInput = { plan: askPlan, answeredKind, answer: raw, sessionNumber: input.sessionNumber };
  const scope = scopeFor(ctx, cid);
  const ledger = new PostgresLedger(ctx.service, scope);
  const exchange = await clientFor(ctx, ledger).complete(buildCommTurnRequest(turnInput, TALK_MODEL));
  await traceExchanges(ctx, scope, ledger, [exchange]);
  if (exchange.error?.startsWith("budget_unavailable")) {
    const e = ledger.refusalError("talk");
    throw new ApiError(e.code, e.message, { ...e.extra, saved: true, message_id: (me as Row).id });
  }
  // A failed call is not a failed turn: the bank's own question goes out word for word, with no reflection and no item.
  const out = finishCommTurn(exchange.error ? "" : exchange.rawResponse, turnInput);
  if (out.verdict && !out.verdict.ok && out.verdict.action === "safety_route") {
    // The drafted item itself reached the safety route (for example it asks to control another person): resources, nothing kept, no next question.
    return finish({ state: "safety", reflection: "", question: "", comm: null, item: null, item_state: "safety_route", resources: RESOURCES }, me as Row, "");
  }
  const refused = out.verdict && !out.verdict.ok ? out.verdict : null;
  const spoken = [out.reflection, closing ? "" : out.question].filter(Boolean).join(" ").trim();
  const extra = {
    reflection: out.reflection,
    item: out.item,
    item_state: out.item ? "offered" : refused ? refused.action : null,
    ...(refused && refused.action === "offer_request" ? { offer: refused.offer } : {}),
  };
  if (closing) return finish(doneReply(plan.done ? plan.reason : "session_budget", extra), me as Row, out.reflection, { status: "finished", finished_at: new Date().toISOString() });
  return finish(askReply(out.question, askPlan.kind, out.questionFrom, extra), me as Row, spoken);
});
