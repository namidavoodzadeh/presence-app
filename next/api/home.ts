// V3 Home order (CEO 11 Nov, "V3 is the build now"): ONE read that gives Home its card stack, so the app does not
// compute it from five calls. People ordered by who needs you; the most urgent LAST (nearest the thumb). Numbers and
// kinds only: no words from any bridge, note or draft, no preview, no count of what the other side saved (laws 10, 12;
// V3 rule 12 "anything that may hurt arrives closed"). Read-only; marks nothing; nothing is stored.
import { route } from "./lib/router.ts";
import { json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import type { Row } from "./lib/objects.ts";
import { inParallel, otherOf, myLinks, people, threadOf } from "./bridge.ts";
import { asSchedule } from "./checkin.ts";
import { nextOccurrence } from "../engine/checkin/schedule.ts";

/** What each reason is worth. A person's `rank` is the highest reason they have; `score` breaks ties inside a rank. */
export const HOME_REASONS = ["unread", "invite", "checkin_soon", "open_items", "draft"] as const;
const RANK: Record<string, number> = { unread: 5, invite: 4, checkin_soon: 3, open_items: 2, draft: 1 };
const SOON_MS = 24 * 3600_000;

route("GET", "/home", async (ctx) => {
  const db = ctx.caller!.db, id = ctx.caller!.id, now = Date.now();
  const links = (await myLinks(db, id)).filter((l) => l.status === "active");
  const others = links.map((l) => otherOf(l, id));
  // Speed (CEO 12 Nov): every read below depends only on the links, so they go out together (was seven in a row).
  const checkInReads = ctx.env.checkIn
    ? Promise.all([
      db.from("check_ins").select("*").eq("owner", id),
      ctx.service.from("check_ins").select("*").eq("person", id).in("status", ["active", "invited"]),
      db.from("parked_notes").select("partner,state").eq("writer", id).eq("state", "parked"),
    ])
    : null;
  const [persons, { data: prefs }, { data: drafts }, ciReads] = await Promise.all([
    people(db, [...others, id]),
    db.from("link_prefs").select("*").eq("owner", id),
    db.from("drafts").select("*").eq("owner", id),
    checkInReads,
  ]);

  // Check-in facts only when the feature is on; off means Home simply has no check-in reasons (never a 403 here).
  const soon = new Map<string, string>(), invites = new Map<string, string>(), open = new Map<string, number>();
  if (ciReads) {
    const [mine, inc, notes] = ciReads;
    if (mine.error) dbError(mine.error, "check_ins.home.mine");
    if (inc.error) dbError(inc.error, "check_ins.home.incoming");
    for (const r of [...((mine.data ?? []) as Row[]).filter((x) => x.status === "active"), ...((inc.data ?? []) as Row[]).filter((x) => x.status === "active")]) {
      const who = String(r.owner === id ? r.person : r.owner);
      if (!who || who === "null") continue;
      let at: number;
      try { at = nextOccurrence(asSchedule(r), now); } catch { continue; } // a malformed row never breaks Home
      if (at - now <= SOON_MS && (!soon.has(who) || at < new Date(soon.get(who)!).getTime())) soon.set(who, new Date(at).toISOString());
    }
    for (const r of (inc.data ?? []) as Row[]) if (r.status === "invited") invites.set(String(r.owner), String(r.id));
    if (notes.error) dbError(notes.error, "parked_notes.home");
    for (const n of (notes.data ?? []) as Row[]) open.set(String(n.partner), (open.get(String(n.partner)) ?? 0) + 1);
  }

  // One thread per shown person, read side by side (was one after another: N people x six round trips).
  const prefOf = (o: string) => ((prefs ?? []) as Row[]).find((x) => x.other === o) ?? {};
  const shown = others.filter((o) => prefOf(o).archived !== true);
  const draftOf = (o: string) => ((drafts ?? []) as Row[]).find((d) => d.other === o) ?? null;
  const threads = await inParallel(shown, (o) => threadOf(db, id, o, persons, draftOf(o), (prefOf(o).cleared_at as string | null) ?? null));

  const rows = [];
  for (const [i, o] of shown.entries()) {
    const p = prefOf(o);
    const draft = draftOf(o);
    const t = threads[i];
    const muted = !!p.muted_until && new Date(String(p.muted_until)).getTime() > now;
    const hasDraft = !!draft && String(draft.text ?? "").trim().length > 0;
    const reasons: string[] = [];
    if (t.badge > 0 || p.unread === true) reasons.push("unread");
    if (invites.has(o)) reasons.push("invite");
    if (soon.has(o)) reasons.push("checkin_soon");
    if ((open.get(o) ?? 0) > 0) reasons.push("open_items");
    if (hasDraft) reasons.push("draft");
    rows.push({
      person: persons.get(o) ?? null,
      reasons,
      // Numbers only. `unread` counts ready, unopened bridges and today's plans (same number as GET /threads `badge`).
      unread: t.badge,
      open_items: open.get(o) ?? 0,
      checkin_at: soon.get(o) ?? null,
      invite_check_in_id: invites.get(o) ?? null,
      draft: hasDraft,
      pinned: p.pinned === true,
      muted,
      activity_at: t.activity ?? null,
      _rank: muted ? 0 : Math.max(0, ...reasons.map((r) => RANK[r])),
    });
  }
  // Least urgent first, most urgent LAST. Inside a rank: pinned, then the later activity, then name, so the order is stable.
  rows.sort((a, b) =>
    a._rank - b._rank || Number(a.pinned) - Number(b.pinned) ||
    String(a.activity_at ?? "").localeCompare(String(b.activity_at ?? "")) ||
    String(a.person?.name ?? "").localeCompare(String(b.person?.name ?? ""))
  );
  return json({
    order: "least_urgent_first",
    people: rows.map(({ _rank, ...r }) => r),
  });
});
