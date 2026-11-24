// The reply objects of CONTRACT §2 (Person, Me, Conversation, Message, Card, Belief) built from database rows, and the small
// reads several endpoint modules share. No model calls here.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "./errors.ts";
import { dbError } from "./db.ts";
import { patchFor } from "./map.ts";

export const PERSONAS = ["nami", "lea", "mom", "sam", "ari", "dara", "jo", "kai", "noor", "jantest", "namitest", "journeyday1", "journeyweek1", "journeymonth1"] as const;   // journey*: the three staging journey fixtures (J1, COO 21:20Z 16 Nov; seed_staging_journeys.py), fictional, account_kind test; namitest: "Nami (test)", partner of jantest only (CEO 9 Nov 17:12 PT); jantest: "Jan (test)", flagged account_kind test contact (CEO 9 Nov 16:45 PT); jo: the QA pair with sam (COO 00:55 10-28 item 10), never linked to Nami
// kai, noor: Nami's hand-test pair (COO 13:50 10-31), partners linked only to each other, never to Nami or any example
export const DEFAULT_SETTINGS = {
  voice_turns: "send_on_pause", read_aloud: true, start_in: "voice", bridge_tonight: "20:00", bridge_tomorrow: "20:00",
  heads_up_default: true, show_original_default: false, read_receipts: true, keep_archived: false,
  frost: true, frost_after_seconds: 30,
  notify: { bridges_ready: true, talk_reminders: true, mirror: true, talk_replies: true, previews: false },
  server: "hosted",
};

export type Row = Record<string, unknown>;

export function personObject(p: Row) {
  return { id: p.id, name: p.name ?? "", initial: p.initial ?? String(p.name ?? "").slice(0, 1).toUpperCase(), color: p.color ?? "#7D6BC9",
    photo_url: p.photo_url ?? null, is_example: p.is_example ?? false, practice: p.is_practice ?? false,
    deleted: !!p.deleted_at, tz: (p.tz as string | null) ?? null };
}

export async function meObject(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("profiles").select("*").eq("id", id).single();
  if (error) dbError(error, "profiles");
  return meObjectFromRow(data);
}

/** Build Me from a profile already read during authentication. */
export function meObjectFromRow(data: Row) {
  const stored = (data.settings as Row | null) ?? {};
  const settings = { ...DEFAULT_SETTINGS, ...stored,
    notify: { ...DEFAULT_SETTINGS.notify, ...((stored as Record<string, Row>).notify ?? {}) } };
  return { person: personObject(data), preview: data.is_preview ?? false, example: data.is_example ?? false, persona: data.persona ?? null,
    created_at: data.created_at, settings };
}

export function dayGroup(iso: string, tz: string): "today" | "yesterday" | "previous_7_days" | "earlier" {
  const fmt = (d: Date) => { try { return d.toLocaleDateString("en-CA", { timeZone: tz }); } catch { return d.toISOString().slice(0, 10); } };
  const day = fmt(new Date(iso)), now = new Date();
  if (day === fmt(now)) return "today";
  if (day === fmt(new Date(now.getTime() - 864e5))) return "yesterday";
  if (new Date(iso).getTime() > now.getTime() - 7 * 864e5) return "previous_7_days";
  return "earlier";
}

export interface ConversationCounts { beliefs_added?: number; turns?: number; unrated?: number }

export function conversationObject(c: Row, tz: string, extra: ConversationCounts = {}) {
  return { id: c.id, title: c.title ?? "", status: c.status, mode: c.mode, started_at: c.started_at, last_active_at: c.last_active_at,
    paused_at: c.paused_at ?? null, finished_at: c.finished_at ?? null, beliefs_added: extra.beliefs_added ?? 0, turns: extra.turns ?? 0,
    unrated: extra.unrated ?? 0, group: dayGroup(String(c.last_active_at), tz), source: (c.source as string | undefined) ?? "talk" };
}

/** The Conversation object with its counts read from the database (beliefs this conversation added, turns, unrated guesses). */
export async function conversationWithCounts(db: SupabaseClient, c: Row, tz: string) {
  const [{ data: bs }, { data: ms }] = await Promise.all([
    db.from("beliefs").select("id,status").eq("conversation_id", c.id as string).neq("status", "deleted"),
    db.from("messages").select("turn").eq("conversation_id", c.id as string).eq("role", "me").eq("superseded", false).is("deleted_at", null),
  ]);
  const turns = Math.max(0, ...(ms ?? []).map((m) => m.turn as number));
  return conversationObject(c, tz, { beliefs_added: (bs ?? []).filter((b) => b.status === "confirmed").length, turns, unrated: (bs ?? []).filter((b) => b.status === "guess").length });
}

export async function loadConversation(db: SupabaseClient, id: string): Promise<Row> {
  const { data, error } = await db.from("conversations").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) dbError(error, "conversations");
  if (!data) throw new ApiError("not_found", "", { where: "conversation" });
  return data;
}

export async function pendingReply(db: SupabaseClient, conversationId?: string) {
  if (!conversationId) return null;
  const { data } = await db.from("messages").select("id,turn,role,created_at").eq("conversation_id", conversationId).eq("superseded", false)
    .is("deleted_at", null).order("turn", { ascending: false }).order("role", { ascending: true }).limit(2);
  const rows = data ?? [];
  const last = rows[0];
  if (!last || last.role !== "me") return null;
  if (rows.some((r) => r.turn === last.turn && r.role === "presence")) return null;
  return { conversation_id: conversationId, message_id: last.id, since: last.created_at };
}

export function messageObject(m: Row) {
  return { id: m.id, conversation_id: m.conversation_id, role: m.role, turn: m.turn, text: m.text ?? "", created_at: m.created_at,
    edited_at: m.edited_at ?? null, superseded: m.superseded ?? false, feeling: m.role === "me" ? (m.feeling ?? null) : null,
    answer_kind: m.role === "me" ? (m.answer_kind ?? "told") : null,
    reply: m.role === "presence" ? (m.reply ?? null) : null };
}

interface BeliefExtras {
  receipts: Row[];                         // receipts rows of these beliefs
  links: Row[];                            // belief_links rows touching these beliefs
  labels: Map<string, string>;             // id → label for every linked belief
}

async function extrasFor(db: SupabaseClient, ids: string[]): Promise<BeliefExtras> {
  const [{ data: rs }, { data: a }, { data: b }] = await Promise.all([
    db.from("receipts").select("belief_id,message_id,quote,conversation_id,said_at,messages(answer_kind)").in("belief_id", ids).order("said_at"),
    db.from("belief_links").select("from_belief,to_belief,kind").in("from_belief", ids),
    db.from("belief_links").select("from_belief,to_belief,kind").in("to_belief", ids),
  ]);
  const links = [...(a ?? []), ...(b ?? [])].filter((l, i, all) => all.findIndex((x) => x.from_belief === l.from_belief && x.to_belief === l.to_belief && x.kind === l.kind) === i);
  const other = [...new Set(links.flatMap((l) => [l.from_belief as string, l.to_belief as string]))].filter((id) => !ids.includes(id));
  const labels = new Map<string, string>();
  if (other.length) {
    const { data: ps } = await db.from("beliefs").select("id,label").in("id", other);
    for (const p of ps ?? []) labels.set(p.id, p.label);
  }
  return { receipts: rs ?? [], links, labels };
}

/** The links of one belief as the app reads them: rests_on (I rest on X), holds_up (X rests on me), tension, same_area. */
function linksOf(id: string, x: BeliefExtras, own: Map<string, string>) {
  const label = (i: string) => own.get(i) ?? x.labels.get(i) ?? "";
  const out: { belief_id: string; label: string; kind: string }[] = [];
  for (const l of x.links) {
    const from = l.from_belief as string, to = l.to_belief as string, kind = l.kind as string;
    if (from === id && kind === "rests_on") out.push({ belief_id: to, label: label(to), kind: "rests_on" });
    else if (to === id && kind === "rests_on") out.push({ belief_id: from, label: label(from), kind: "holds_up" });
    else if (from === id && kind === "holds_up") out.push({ belief_id: to, label: label(to), kind: "holds_up" });
    else if (to === id && kind === "holds_up") out.push({ belief_id: from, label: label(from), kind: "rests_on" });
    else if ((from === id || to === id) && (kind === "tension" || kind === "same_area")) out.push({ belief_id: from === id ? to : from, label: label(from === id ? to : from), kind });
  }
  return out;
}

function cardFrom(b: Row, x: BeliefExtras, own: Map<string, string>) {
  const links = linksOf(b.id as string, x, own);
  const rests = links.find((l) => l.kind === "rests_on");
  return {
    belief_id: b.id, label: b.label, statement: b.statement,
    // v1.66 kenning voice: own_wording is the person's own confirmed first-person line (any status); offered_wording is Talk's
    // first-person offer, only on a guess and only for the Y5 'Is this you?' card.
    own_wording: b.own_wording ?? null, offered_wording: b.status === "guess" ? (b.offered_wording ?? null) : null,
    type: b.type, kind: b.kind, area: b.area, domains: b.domains ?? [],
    birth_mood: b.birth_mood ?? "neutral", confidence: b.confidence ?? 0.7, tone: 0,
    receipts: x.receipts.filter((r) => r.belief_id === b.id).map(receiptObject),
    rests_on: rests ? { belief_id: rests.belief_id, label: rests.label } : null,
    rating: b.rating ?? null, status: b.status,
    import_receipt: importReceiptObject(b),
    _links: links,
  };
}

/** Import provenance is display metadata, never a Talk quote or a row in public.receipts. */
export function importReceiptObject(b: Row) {
  const date = typeof b.import_date === "string" ? b.import_date.slice(0, 10) : null;
  return b.source === "import" && date
    ? { kind: "import", line: `From your AI · ${date}`, date }
    : null;
}

/** A chip is a stored episode answer, not a verbatim quotation. Keep that distinction explicit on every receipt surface. */
export function receiptObject(r: Row) {
  const chip = (r.messages as Row | null)?.answer_kind === "chip";
  return {
    message_id: r.message_id,
    quote: chip ? `you chose: ${String(r.quote)}` : r.quote,
    kind: chip ? "choice" : "quote",
    conversation_id: r.conversation_id,
    said_at: r.said_at,
  };
}

/** Card objects (CONTRACT §2) for belief rows, with their receipts. */
export async function cardsFor(db: SupabaseClient, beliefs: Row[]) {
  if (!beliefs.length) return [];
  const x = await extrasFor(db, beliefs.map((b) => b.id as string));
  const own = new Map(beliefs.map((b) => [b.id as string, b.label as string]));
  return beliefs.map((b) => { const { _links: _, ...card } = cardFrom(b, x, own); return card; });
}

/** Belief objects (CONTRACT §2): the Card fields plus source, dates, links, the map patch and what Mirror has for it. */
export async function beliefsFor(db: SupabaseClient, beliefs: Row[], outside?: Row[]) {
  if (!beliefs.length) return [];
  const x = await extrasFor(db, beliefs.map((b) => b.id as string));
  const own = new Map(beliefs.map((b) => [b.id as string, b.label as string]));
  const seen = outside ?? (beliefs.some((b) => b.seen_by_others)
    ? (await db.from("outside_perspectives").select("*").in("belief_id", beliefs.filter((b) => b.seen_by_others).map((b) => b.id as string))).data ?? [] : []);
  return beliefs.map((b) => {
    const { _links, ...card } = cardFrom(b, x, own);
    const o = seen.find((p) => p.belief_id === b.id);
    return { ...card, source: b.source ?? "talk", rated_at: b.rated_at ?? null, confirmed_at: b.confirmed_at ?? null, set_aside_at: b.set_aside_at ?? null,
      seen_by_others: b.seen_by_others ?? false, links: _links, patch: patchFor(b as { kind: string; area: string; birth_mood?: string; rating?: string; seen_by_others?: boolean }),
      outside: o ? { people: o.people_count ?? 0, moments: o.moment_count ?? 0, summary: o.summary ?? o.statement ?? "" } : null };
  });
}

/** OutsidePerspective (CONTRACT §5). */
export function perspectiveObject(p: Row) {
  const people = Number(p.people_count ?? 0), moments = Number(p.moment_count ?? 0);
  const variant = (p.variant as string | undefined) ?? "new";
  return { id: p.id, label: p.label, statement: p.statement, summary: p.summary ?? p.statement, people, moments,
    line: `From ${people} ${people === 1 ? "person" : "people"} who know you, across ${moments} ${moments === 1 ? "moment" : "moments"}`,
    note: variant === "tension" ? "Some people who know you describe this differently." : null,
    variant, type: p.type ?? null, kind: p.kind ?? null, area: p.area ?? null, about_belief_id: p.about_belief_id ?? null,
    status: p.status, rating: p.rating ?? null, belief_id: p.belief_id ?? null, created_at: p.created_at };
}
