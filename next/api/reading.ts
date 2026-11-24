// V2.5 "Read a message" (boards 10, 11, 11b and 18's reading row; contract v1.57; migration 0052). The reader asks what an
// opened message may mean; the answer is 2 or 3 possibilities, each tied to ONE item the writer granted to this reader
// (share_items, word for word), read live. Nothing is stored on either side: no reading, no message copy, no usage beyond the
// ledger's token and cent counts (the trace keeps length and hash, never words).
//   GET /links/:person/reading            my switch for that person        { person_id, help_read, confirmed_at }
//   PUT /links/:person/reading            { help_read: bool }              on (or 'Keep on') restarts the 30-day clock; off tells no one
//   POST /bridges/:id/reading             receiver only, an opened message { available, meanings?, flagged?, resources? }
// Every "no" (switch off, nothing granted, unsupported, model unsure, bad output) is the same { available: false }, so the
// reader cannot learn which. Only a message the safety screen flags adds { flagged: true, resources } for the reader (law 8).
import { route } from "./lib/router.ts";
import type { Ctx } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";
import { PostgresLedger } from "./lib/ledger.ts";
import { clientFor, refused, scopeFor, trace } from "./bridge_engine.ts";
import type { GrantedItem } from "./share_items.ts";
import { loadPairContext } from "./pair_context.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import { RESOURCES } from "../engine/safety.ts";
import { extractJson } from "../engine/model/client.ts";
import type { ModelClient } from "../engine/model/client.ts";
import { cardWordHits, clinicalHits } from "../engine/words.ts";

export const READING_SYSTEM = `You help a person read a message they received. The writer has chosen to share a few of their own beliefs with this reader. You get the message, the writer's first name, and a numbered list of items the writer shared (id and wording).

Return ONE JSON object and nothing else:
{"safety":"none"|"risk"|"flagged","meanings":[{"meaning":"…","item_id":"…","ordinary":true|false}]}

Rules:
1. safety "risk" if the message shows risk of harm to anyone. safety "flagged" if it is a threat, an insult, a demand to restrict someone's money, friends, phone or where they go, or any attempt to control them. Then meanings is [].
2. Otherwise give 2 or 3 meanings, never 1. Each is a short possibility, under 20 words, starting with a verb or a feeling ("Wants to feel included on Friday"). Each cites exactly one item_id from the list that makes that possibility plausible. Never invent an item_id.
3. At least one meaning must be ordinary or kind (ordinary: true), such as being tired or wanting closeness.
4. Never rank or score the meanings. Never say what the writer thinks or feels as a fact; these are possibilities. Never use a pronoun for the writer; use the first name or no subject.
5. No advice, no diagnosis, no clinical or evaluative words (should, healthy, unhealthy, toxic, fix, improve, wrong, better).
6. If no item makes any reading plausible, return meanings [].`;

const MAX_MEANING_WORDS = 24;
const FREE = { available: false } as const;

export interface Reading { meaning: string; item: string; item_id: string }
export type ReadingOutcome =
  | { kind: "ok"; meanings: Reading[] }
  | { kind: "flagged" }
  | { kind: "none" };

/** Validate the model's JSON against the granted items. Anything off is "none" (the reader sees the same line). */
export function checkReading(value: unknown, granted: GrantedItem[]): ReadingOutcome {
  if (!value || typeof value !== "object") return { kind: "none" };
  const v = value as Record<string, unknown>;
  if (v.safety === "risk" || v.safety === "flagged") return { kind: "flagged" };
  if (v.safety !== "none" || !Array.isArray(v.meanings)) return { kind: "none" };
  const byId = new Map(granted.map((g) => [g.item_id, g]));
  const out: Reading[] = [];
  let ordinary = false;
  for (const m of v.meanings as unknown[]) {
    if (!m || typeof m !== "object") return { kind: "none" };
    const r = m as Record<string, unknown>;
    const text = typeof r.meaning === "string" ? r.meaning.trim() : "";
    const g = typeof r.item_id === "string" ? byId.get(r.item_id) : undefined;
    if (!text || !g || text.split(/\s+/).length > MAX_MEANING_WORDS) return { kind: "none" };
    if (clinicalHits(text).length || cardWordHits(text).length) return { kind: "none" };
    if (r.ordinary === true) ordinary = true;
    out.push({ meaning: text.replace(/[.!]+$/, ""), item: g.wording, item_id: g.item_id });
  }
  if (out.length < 2 || out.length > 3 || !ordinary) return { kind: "none" };
  return { kind: "ok", meanings: out };
}

export function readingPackage(text: string, writerName: string, granted: GrantedItem[]): string {
  return `Writer's first name: ${writerName || "the writer"}\n\nMessage:\n${text}\n\nShared items:\n${granted.map((g) => `${g.item_id}: ${g.wording}`).join("\n")}`;
}

async function requireActiveLink(ctx: Ctx, other: string): Promise<void> {
  const db = ctx.caller!.db, mine = ctx.caller!.id;
  const a = mine < other ? mine : other, b = mine < other ? other : mine;
  const { data, error } = await db.from("links").select("status").eq("person_a", a).eq("person_b", b).maybeSingle();
  if (error) dbError(error, "links");
  if (!data) throw new ApiError("not_found", "", { where: "link" });
  if (data.status !== "active") throw new ApiError("forbidden", "", { reason: data.status });
}

function switchObject(other: string, row: Row | null) {
  return { person_id: other, help_read: row?.help_read === true, ...(row?.help_read === true && row.help_read_at ? { confirmed_at: row.help_read_at } : {}) };
}

route("GET", "/links/:person/reading", async (ctx) => {
  const other = ctx.params.person;
  await requireActiveLink(ctx, other);
  const { data, error } = await ctx.caller!.db.from("link_prefs").select("help_read,help_read_at").eq("owner", ctx.caller!.id).eq("other", other).maybeSingle();
  if (error) dbError(error, "link_prefs.reading");
  return json(switchObject(other, (data ?? null) as Row | null));
});

route("PUT", "/links/:person/reading", async (ctx) => {
  const db = ctx.caller!.db, id = ctx.caller!.id, other = ctx.params.person;
  if (other === id) throw new ApiError("invalid", "", { field: "person" });
  await requireActiveLink(ctx, other);
  const b = await ctx.body();
  if (typeof b.help_read !== "boolean") throw new ApiError("invalid", "", { field: "help_read" });
  const now = new Date().toISOString();
  // Off tells no one: no push, no event, no row the reader can read.
  const { error } = await db.from("link_prefs").upsert(
    { owner: id, other, help_read: b.help_read, help_read_at: b.help_read ? now : null, updated_at: now },
    { onConflict: "owner,other" },
  );
  if (error) dbError(error, "link_prefs.reading_upsert");
  return json(switchObject(other, { help_read: b.help_read, help_read_at: b.help_read ? now : null }));
});

route("POST", "/bridges/:id/reading", async (ctx) => {
  const reader = ctx.caller!.id, service = ctx.service;
  if (!service) throw new ApiError("internal", "", { detail: "service client missing" });
  const { data: br, error } = await service.from("bridges").select("id,sender,receiver,final,status,opened_at,receiver_deleted_at")
    .eq("id", ctx.params.id).eq("receiver", reader).maybeSingle();
  if (error) dbError(error, "bridges.reading");
  const m = br as Row | null;
  if (!m || m.status !== "scheduled" || m.receiver_deleted_at) throw new ApiError("not_found", "", { where: "bridge" });
  if (!m.opened_at) throw new ApiError("forbidden", "", { reason: "not_opened" });
  const writer = String(m.sender), text = String(m.final ?? "");
  await requireActiveLink(ctx, writer);
  // 1. The safety screen runs first, whatever the switch says. Flagged: no reading, resources to the reader only.
  const floor = await requireSafetyPass(ctx, text, "reading");
  if (floor.routed === "unavailable") return json(unreadBody({ available: false }));
  if (floor.routed !== "none") return json({ available: false, flagged: true, resources: RESOURCES });
  // 2. The writer's switch (default off) and the items they granted this reader, both read live. Either missing: same line.
  const { data: pref } = await service.from("link_prefs").select("help_read").eq("owner", writer).eq("other", reader).maybeSingle();
  if ((pref as Row | null)?.help_read !== true) return json(FREE);
  // The pair loader is the service-read door: it re-checks both the active
  // link and the exact grant before returning any wording.
  const pair = await loadPairContext(ctx.caller!.db, reader, writer, service);
  const granted: GrantedItem[] = (pair.receiver?.items ?? [])
    .filter((x) => !x.kind || x.kind === "how_i_mean" || x.kind === "this_week")
    .map((x) => ({ item_id: x.id, area: "", label: "", wording: x.words, shared_at: x.confirmedAt ?? "" }));
  if (!granted.length) return json(FREE);
  const { data: prof } = await service.from("profiles").select("name").eq("id", writer).maybeSingle();
  const first = String((prof as Row | null)?.name ?? "").trim().split(/\s+/)[0] ?? "";
  // 3. One live read. Nothing is stored; the trace keeps counts only.
  const scope = scopeFor(ctx), ledger = new PostgresLedger(service, scope);
  const client: ModelClient = clientFor(ctx, ledger, "insight");
  const ex = await client.complete({ purpose: "reading", system: READING_SYSTEM, maxTokens: 500, messages: [{ role: "user", content: readingPackage(text, first, granted) }] });
  await trace(ctx, scope, ledger, [ex], null, true);
  refused(ledger, [ex]);
  let parsed: unknown = null;
  try { parsed = extractJson(ex.rawResponse); } catch { /* unreadable = none */ }
  const out = checkReading(parsed, granted);
  if (out.kind === "flagged") return json({ available: false, flagged: true, resources: RESOURCES });
  if (out.kind === "none") return json(FREE);
  return json({ available: true, meanings: out.meanings.map((r) => ({ meaning: r.meaning, item: r.item })) });
});
