// The bridge between the database and the engine's in-memory state (TurnState): load a person's map, consent, this
// conversation's turns and hypotheses into the shapes the Talk engine reads, and write the engine's changes back as rows.
// Beliefs the person rated keep their wording (law 3): a consolidation may add receipts and links to them, never reword them.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DOMAINS } from "../../engine/types.ts";
import type { Belief, BeliefStatus, BeliefType, CardShown, Domain, Feeling, Level, LinkType, PersonMap, Rating, Session, SessionTurn, ShownTurn } from "../../engine/types.ts";
import type { TurnState } from "../../engine/talk/turn.ts";
import { isExactSubstring, normalise } from "../../engine/words.ts";
import { areaFor, dbRating, engineRating, kindFor, LEVEL_FOR_TYPE } from "./map.ts";
import type { Row } from "./objects.ts";
import { dbError } from "./db.ts";

export interface Loaded {
  state: TurnState;
  conversation: Row;
  meRows: Row[];                       // this conversation's visible `me` rows (not superseded, not deleted), by turn
  presenceRows: Row[];
  rows: Map<string, Row>;              // the owner's belief rows by id (not deleted)
  before: Map<string, string>;         // belief id → JSON at load, so persistBeliefs writes only what changed
  meIdByTurn: Map<number, string>;
}

const STATUS_TO_ENGINE: Record<string, BeliefStatus> = { confirmed: "endorsed", set_aside: "disputed", guess: "inferred" };
const STATUS_TO_DB: Record<BeliefStatus, string> = { endorsed: "confirmed", disputed: "set_aside", inferred: "guess" };
const CONSENT_TO_ENGINE: Record<string, "ok" | "ask_later" | "declined"> = { allowed: "ok", not_now: "ask_later", never: "declined" };

function isDomain(x: unknown): x is Domain { return typeof x === "string" && (DOMAINS as readonly string[]).includes(x); }

/** A belief row as the engine reads it. Links: a `rests_on` row (A rests on B) is A's `supports` link; `tension` stays. */
export function beliefFromRow(row: Row, receipts: Row[], links: Row[]): Belief {
  const type = row.type as BeliefType;
  const id = row.id as string;
  const out: Belief = {
    id, label: String(row.label ?? ""), statement: String(row.statement ?? ""), offeredWording: (row.offered_wording as string | null) ?? null, keyword: (row.map_keyword as string | null) ?? null, type,
    level: (row.level as Level) ?? LEVEL_FOR_TYPE[type], domains: ((row.domains as unknown[]) ?? []).filter(isDomain),
    confidence: typeof row.confidence === "number" ? row.confidence : 0.7,
    receipts: receipts.map((r) => ({ quote: String(r.quote), sessionId: String(r.conversation_id ?? ""), turn: Number((r.messages as Row | null)?.turn ?? 0),
      date: String(r.said_at ?? "").slice(0, 10), answerKind: ((r.messages as Row | null)?.answer_kind as "told" | "chip" | "consent" | undefined) ?? "told" })),
    links: [], status: STATUS_TO_ENGINE[String(row.status)] ?? "inferred", birthMood: (row.birth_mood as Feeling) ?? "neutral",
  };
  for (const l of links) {
    const from = l.from_belief as string, to = l.to_belief as string, kind = l.kind as string;
    if (kind === "rests_on" && from === id) out.links.push({ to, type: "supports" });
    else if (kind === "holds_up" && to === id) out.links.push({ to: from, type: "supports" });
    else if (kind === "tension" && from === id) out.links.push({ to, type: "tension" });
    else if (kind === "tension" && to === id) out.links.push({ to: from, type: "tension" });
  }
  if (!out.domains.length) out.domains = ["self"];
  return out;
}

function cardShown(c: Row, ratingFor: (id: string) => Rating | undefined): CardShown {
  return { beliefId: String(c.belief_id), label: String(c.label ?? ""), statement: String(c.statement ?? ""), type: c.type as BeliefType,
    rating: ratingFor(String(c.belief_id)), birthMood: (c.birth_mood as Feeling) ?? undefined };
}

/** The stored Reply of a presence row, as the engine's ShownTurn. */
export function shownFromReply(reply: Row | null, ratingFor: (id: string) => Rating | undefined): ShownTurn {
  if (!reply) return { state: "turn", cards: [] };
  const state = reply.state === "consent" ? "permission" : reply.state === "safety" ? "safety" : "turn";
  const consent = (reply.consent as Row | null) ?? null;
  const shown: ShownTurn = {
    state, reflection: typeof reply.reflection === "string" ? reply.reflection : "", question: typeof reply.question === "string" ? reply.question : "",
    cards: ((reply.cards as Row[]) ?? []).map((c) => cardShown(c, ratingFor)),
    feeling: (reply.feeling as Feeling) ?? undefined,
  };
  if (state === "permission" && consent && isDomain(consent.domain)) shown.permissionDomain = consent.domain;
  if (reply.early_guess && typeof reply.early_guess === "object") shown.earlyGuess = cardShown(reply.early_guess as Row, ratingFor);
  if (reply.safety && typeof reply.safety === "object") shown.safety = reply.safety as ShownTurn["safety"];
  return shown;
}

/** The person's map alone (Bridge reads the sender's own beliefs; never the receiver's). Rated imports (E26 P0: Nami's
 *  "From your AI" beliefs, confirmed by his own rating) are real beliefs on the map here, same as Talk's; only `loadState`
 *  (Talk's own session) keeps them out, so Talk never quotes an import as if it were said in this conversation. */
export async function loadMap(db: SupabaseClient, owner: string): Promise<PersonMap> {
  const [beliefs, receipts, links, consent] = await Promise.all([
    db.from("beliefs").select("*").eq("owner", owner).neq("status", "deleted"),
    db.from("receipts").select("*, messages(turn,answer_kind)").eq("owner", owner),
    db.from("belief_links").select("from_belief,to_belief,kind").eq("owner", owner),
    db.from("consent").select("area,state").eq("owner", owner),
  ]);
  for (const [r, where] of [[beliefs, "beliefs"], [receipts, "receipts"], [links, "belief_links"], [consent, "consent"]] as const) if (r.error) dbError(r.error, where);
  const receiptsBy = new Map<string, Row[]>();
  for (const r of receipts.data ?? []) { const k = r.belief_id as string; receiptsBy.set(k, [...(receiptsBy.get(k) ?? []), r]); }
  const map: PersonMap = { beliefs: [], consent: {}, openThreads: [] };
  for (const row of beliefs.data ?? []) map.beliefs.push(beliefFromRow(row, receiptsBy.get(row.id as string) ?? [], links.data ?? []));
  for (const c of consent.data ?? []) if (isDomain(c.area) && CONSENT_TO_ENGINE[String(c.state)]) map.consent[c.area] = CONSENT_TO_ENGINE[String(c.state)];
  return map;
}

export interface LoadOptions {
  upToTurn?: number;               // only turns below this one join the session (an edit re-answers from its turn)
  aboutBelief?: Row | null;        // "Talk about this": the belief the conversation opened on
}

export async function loadState(db: SupabaseClient, owner: { id: string; name: string }, conversation: Row, opts: LoadOptions = {}): Promise<Loaded> {
  const cid = conversation.id as string;
  const [beliefs, receipts, links, consent, messages, finished] = await Promise.all([
    db.from("beliefs").select("*").eq("owner", owner.id).neq("status", "deleted").neq("source", "import"),
    db.from("receipts").select("*, messages(turn,answer_kind)").eq("owner", owner.id),
    db.from("belief_links").select("from_belief,to_belief,kind").eq("owner", owner.id),
    db.from("consent").select("area,state").eq("owner", owner.id),
    db.from("messages").select("*").eq("conversation_id", cid).eq("superseded", false).is("deleted_at", null).order("turn").order("role"),
    db.from("conversations").select("id,started_at,open_threads").eq("owner", owner.id).eq("status", "finished").is("deleted_at", null).neq("id", cid)
      .order("finished_at", { ascending: false }).limit(30),
  ]);
  for (const [r, where] of [[beliefs, "beliefs"], [receipts, "receipts"], [links, "belief_links"], [consent, "consent"], [messages, "messages"], [finished, "conversations"]] as const) {
    if (r.error) dbError(r.error, where);
  }

  const rows = new Map<string, Row>();
  for (const b of beliefs.data ?? []) rows.set(b.id as string, b);
  const receiptsBy = new Map<string, Row[]>();
  for (const r of receipts.data ?? []) { const k = r.belief_id as string; receiptsBy.set(k, [...(receiptsBy.get(k) ?? []), r]); }
  const map: PersonMap = { beliefs: [], consent: {}, openThreads: [] };
  for (const row of rows.values()) map.beliefs.push(beliefFromRow(row, receiptsBy.get(row.id as string) ?? [], links.data ?? []));
  for (const c of consent.data ?? []) if (isDomain(c.area) && CONSENT_TO_ENGINE[String(c.state)]) map.consent[c.area] = CONSENT_TO_ENGINE[String(c.state)];
  const threads = new Set<string>();
  for (const f of finished.data ?? []) for (const t of (f.open_threads as string[]) ?? []) threads.add(t);
  for (const t of (conversation.open_threads as string[]) ?? []) threads.add(t);
  map.openThreads = [...threads].slice(0, 12);

  const ratingFor = (id: string) => engineRating(rows.get(id)?.rating);
  const hypotheses = new Map<string, Belief>();
  for (const h of (conversation.hypotheses as Belief[]) ?? []) {
    if (!h || typeof h !== "object" || !h.id) continue;
    const row = rows.get(h.id);
    if (row) h.status = STATUS_TO_ENGINE[String(row.status)] ?? h.status;
    hypotheses.set(h.id, h);
  }

  const all = messages.data ?? [];
  const limit = opts.upToTurn ?? Infinity;
  const meRows = all.filter((m) => m.role === "me" && (m.turn as number) < limit);
  const presenceRows = all.filter((m) => m.role === "presence" && (m.turn as number) < limit);
  const meIdByTurn = new Map<number, string>();
  const turns: SessionTurn[] = [];
  for (const m of meRows) {
    meIdByTurn.set(m.turn as number, m.id as string);
    const p = presenceRows.find((x) => x.turn === m.turn);
    if (!p) continue;                                           // a turn still waiting for its reply is not history yet
    turns.push({ index: m.turn as number, person: String(m.text ?? ""), answerKind: (m.answer_kind as "told" | "chip" | "consent" | undefined) ?? "told", shown: shownFromReply((p.reply as Row) ?? null, ratingFor) });
  }
  const session: Session = { id: cid, date: String(conversation.started_at ?? new Date().toISOString()).slice(0, 10), turns };

  const turnsPerConversation = new Map<string, number>();
  if ((finished.data ?? []).length) {
    const { data: ms } = await db.from("messages").select("conversation_id,turn").eq("owner", owner.id).eq("role", "me").eq("superseded", false).is("deleted_at", null)
      .in("conversation_id", (finished.data ?? []).map((f) => f.id as string)).limit(3000);
    for (const m of ms ?? []) turnsPerConversation.set(m.conversation_id as string, Math.max(turnsPerConversation.get(m.conversation_id as string) ?? 0, m.turn as number));
  }
  const previous: Session[] = (finished.data ?? []).map((f) => ({
    id: f.id as string, date: String(f.started_at ?? "").slice(0, 10),
    turns: Array.from({ length: turnsPerConversation.get(f.id as string) ?? 0 }, (_, i) => ({ index: i + 1, person: "", shown: { state: "turn" as const, cards: [] } })),
  }));

  const about: string[] = [];
  if (opts.aboutBelief) about.push(`They opened this conversation from a belief on their map, "${opts.aboutBelief.label}": ${opts.aboutBelief.statement}`);
  const state: TurnState = {
    person: { firstName: owner.name.split(" ")[0] || "there", language: "en", about },
    map, session, previous, hypotheses, idFor: () => crypto.randomUUID(),
  };
  const before = new Map<string, string>();
  for (const b of map.beliefs) before.set(b.id, JSON.stringify(b));
  for (const h of hypotheses.values()) if (!before.has(h.id)) before.set(h.id, JSON.stringify(h));
  return { state, conversation, meRows, presenceRows, rows, before, meIdByTurn };
}

export interface PersistOptions {
  conversationId: string;
  /** The rating the engine's status came from (Finish), so a new confirmed row carries it. */
  ratingFor?: (id: string) => Rating | undefined;
  /** New rows need at least this confidence unless rated (law 9: confidence earns the screen). */
  minConfidence?: number;
}

export interface Persisted { created: string[]; updated: string[]; receipts: number; links: number }

/** Write the engine's beliefs back: new rows for new beliefs, changed fields on existing rows (wording only while a guess),
 *  missing receipts (resolved to the message they quote) and links. Beliefs are deduplicated by id, last one wins. */
export async function persistBeliefs(db: SupabaseClient, owner: string, loaded: Loaded, beliefs: Belief[], opts: PersistOptions): Promise<Persisted> {
  const out: Persisted = { created: [], updated: [], receipts: 0, links: 0 };
  const byId = new Map<string, Belief>();
  for (const b of beliefs) byId.set(b.id, b);
  const now = new Date().toISOString();

  for (const b of byId.values()) {
    const row = loaded.rows.get(b.id);
    const rating = opts.ratingFor?.(b.id);
    if (!row) {
      if (!/^[0-9a-f-]{36}$/i.test(b.id)) continue;                        // never a non-UUID id as a row
      if ((opts.minConfidence ?? 0) > b.confidence && !rating) continue;
      const status = rating ? (rating === "not_me" ? "set_aside" : "confirmed") : STATUS_TO_DB[b.status] ?? "guess";
      const insert: Row = {
        id: b.id, owner, label: b.label, statement: b.statement, offered_wording: b.offeredWording ?? null, map_keyword: b.keyword ?? null, type: b.type, kind: kindFor(b.type), level: b.level, area: areaFor(b.domains),
        domains: b.domains, birth_mood: b.birthMood ?? "neutral", status, confidence: Math.max(0, Math.min(1, b.confidence)), source: "talk",
        conversation_id: opts.conversationId,
      };
      if (rating) { insert.rating = dbRating(rating); insert.rated_at = now; if (status === "confirmed") insert.confirmed_at = now; else insert.set_aside_at = now; }
      const { data, error } = await db.from("beliefs").insert(insert).select("*").single();
      if (error) dbError(error, "beliefs.insert");
      loaded.rows.set(b.id, data);
      out.created.push(b.id);
    } else if (loaded.before.get(b.id) !== JSON.stringify(b)) {
      const patch: Row = { confidence: Math.max(0, Math.min(1, b.confidence)), domains: b.domains, area: areaFor(b.domains), level: b.level, type: b.type, kind: kindFor(b.type) };
      if (row.status === "guess") { patch.label = b.label; patch.statement = b.statement; }   // rated wording is the person's (law 3)
      if (row.status === "guess" && b.offeredWording !== undefined) patch.offered_wording = b.offeredWording ?? null;
      if (!row.map_keyword && b.keyword) patch.map_keyword = b.keyword;   // map v2: made once, never rewritten
      if ((row.birth_mood ?? "neutral") === "neutral" && b.birthMood && b.birthMood !== "neutral") patch.birth_mood = b.birthMood;
      const wanted = rating ? (rating === "not_me" ? "set_aside" : "confirmed") : STATUS_TO_DB[b.status];
      if (row.status === "guess" && wanted && wanted !== "guess") {
        patch.status = wanted; patch.rated_at = now;
        if (rating) patch.rating = dbRating(rating);
        if (wanted === "confirmed") patch.confirmed_at = now; else patch.set_aside_at = now;
      }
      const { data, error } = await db.from("beliefs").update(patch).eq("id", b.id).eq("owner", owner).select("*").single();
      if (error) dbError(error, "beliefs.update");
      loaded.rows.set(b.id, data);
      out.updated.push(b.id);
    }
    loaded.before.set(b.id, JSON.stringify(b));
  }

  // Receipts: one row per (belief, quote); resolved to the message that holds the words.
  const ids = [...byId.keys()].filter((id) => loaded.rows.has(id));
  if (!ids.length) return out;
  const { data: have } = await db.from("receipts").select("belief_id,quote").in("belief_id", ids);
  const seen = new Set((have ?? []).map((r) => `${r.belief_id}|${normalise(String(r.quote)).toLowerCase()}`));
  const inserts: Row[] = [];
  for (const id of ids) {
    for (const r of byId.get(id)!.receipts) {
      const key = `${id}|${normalise(r.quote).toLowerCase()}`;
      if (seen.has(key) || !r.quote.trim()) continue;
      seen.add(key);
      let message: Row | undefined;
      if (r.sessionId === opts.conversationId) {
        const mid = r.turn > 0 ? loaded.meIdByTurn.get(r.turn) : undefined;
        message = mid ? loaded.meRows.find((m) => m.id === mid) : loaded.meRows.find((m) => isExactSubstring(r.quote, String(m.text ?? "")));
      }
      if (!message && r.sessionId !== opts.conversationId) continue;      // an old receipt not yet in the table: nothing to resolve it to
      inserts.push({ owner, belief_id: id, message_id: message?.id ?? null, conversation_id: opts.conversationId, quote: r.quote, said_at: message?.created_at ?? now });
    }
  }
  if (inserts.length) {
    const { error } = await db.from("receipts").insert(inserts);
    if (error) dbError(error, "receipts.insert");
    out.receipts = inserts.length;
  }

  // Links: supports A→B = A rests on B; under A→B = B rests on A; tension stays.
  const linkRows: Row[] = [];
  for (const id of ids) {
    for (const l of byId.get(id)!.links) {
      if (!loaded.rows.has(l.to)) continue;
      const row = l.type === "supports" ? { from_belief: id, to_belief: l.to, kind: "rests_on" }
        : l.type === "under" ? { from_belief: l.to, to_belief: id, kind: "rests_on" }
        : { from_belief: id, to_belief: l.to, kind: "tension" };
      if (row.from_belief === row.to_belief) continue;
      linkRows.push({ owner, ...row });
    }
  }
  if (linkRows.length) {
    const { error } = await db.from("belief_links").upsert(linkRows, { onConflict: "from_belief,to_belief,kind", ignoreDuplicates: true });
    if (error) dbError(error, "belief_links.upsert");
    out.links = linkRows.length;
  }
  return out;
}

export { STATUS_TO_DB, STATUS_TO_ENGINE };
export type { LinkType };
