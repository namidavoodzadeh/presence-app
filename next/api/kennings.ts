// V3 You (CEO 11 Nov): kennings grouped by topic, dated, each with who can see it. A kenning is a belief the owner confirmed
// (Very me, Partly or edited; never "Not me"). Topic = the belief's area. "Seen by" is the owner's own per-item grants
// (`share_items`, v1.52) to people still linked, nothing else: Mirror marks and receipts stay on `GET /map` / `GET /beliefs/:id`.
// Read-only; no receipts and no quotes here (law 2 receipts stay one tap away on `GET /beliefs/:id`).
import { route } from "./lib/router.ts";
import { json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";
import { AREAS } from "./lib/map.ts";
import { offerable } from "./share_items.ts";
import { myLinks, otherOf, people } from "./bridge.ts";

route("GET", "/kennings", async (ctx) => {
  const db = ctx.caller!.db, id = ctx.caller!.id;
  const [bs, gs, links] = await Promise.all([
    db.from("beliefs").select("id,label,area,kind,statement,own_wording,offered_wording,source,status,rating,created_at,confirmed_at,updated_at").eq("owner", id).in("status", ["confirmed", "guess"])
      .order("created_at"),
    db.from("share_items").select("belief_id,other,created_at,updated_at").eq("owner", id),
    myLinks(db, id),
  ]);
  if (bs.error) dbError(bs.error, "beliefs.kennings");
  if (gs.error) dbError(gs.error, "share_items.kennings");
  const active = new Set(links.filter((l) => l.status === "active").map((l) => otherOf(l, id)));
  const persons = await people(db, [...active]);
  const seen = new Map<string, Array<{ person_id: string; name: string; initial: string; since: string }>>();
  for (const g of (gs.data ?? []) as Row[]) {
    const who = String(g.other), p = persons.get(who);
    if (!active.has(who) || !p) continue;
    const list = seen.get(String(g.belief_id)) ?? [];
    list.push({ person_id: who, name: p.name as string, initial: p.initial as string, since: String(g.updated_at ?? g.created_at) });
    seen.set(String(g.belief_id), list);
  }
  const rows = (bs.data ?? []) as Row[];
  const item = (b: Row) => ({
    belief_id: b.id, label: b.label, wording: b.statement, kind: b.kind, area: b.area,
    // v1.66 kenning voice (CPO 20:45Z (1)): own_wording is the person's confirmed first-person line; offered_wording is Talk's
    // first-person offer, on suggestions only (the Y5 card shows it; 'That's me' sends it back as own_wording with the rating).
    own_wording: b.own_wording ?? null, offered_wording: b.status === "guess" ? (b.offered_wording ?? null) : null, source: b.source ?? "talk",
    dated_at: String(b.confirmed_at ?? b.created_at), status: b.status,
    seen_by: (seen.get(String(b.id)) ?? []).sort((a, c) => a.name.localeCompare(c.name)),
  });
  const mine = rows.filter(offerable);
  const groups = AREAS.map((area) => ({
    topic: area,
    items: mine.filter((b) => b.area === area).sort((a, c) => String(c.confirmed_at ?? c.created_at).localeCompare(String(a.confirmed_at ?? a.created_at))).map(item),
  })).filter((g) => g.items.length)
    // The topic holding the newest kenning first.
    .sort((a, c) => c.items[0].dated_at.localeCompare(a.items[0].dated_at));
  // Suggestions (not yet confirmed) stay apart and dim (V3 rule 9); nobody can see them, so `seen_by` is always empty.
  const suggested = rows.filter((b) => b.status === "guess" && typeof b.statement === "string" && b.statement.trim() !== "").map(item)
    .map((x) => ({ ...x, seen_by: [] }));
  return json({ groups, suggested });
});
