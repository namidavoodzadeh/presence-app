// E15 (CEO, support for app AR(2), P2): a Bridge practice partner, owner account only. A fictional linked person
// whose replies are fixed fixtures (engine/bridge/practice_partner.ts) — never a model call, so there is no cost
// and no live text to screen. Behind server switch `PRESENCE_PRACTICE_PARTNER` (default off) and an id allowlist,
// the same pattern as Import from your AI (api/import_ai.ts `requireImportAccess`). Never registered for, or
// visible to, any other account: the only `links` row that ever names the practice-partner id is the one this
// module creates for the allowlisted owner, so `GET /people`/`/threads` for anyone else never surfaces it.

import { floorSafety } from "../engine/bridge/bridge.ts";
import { PRACTICE_PARTNER_ID, PRACTICE_PARTNER_NAME, pickExampleReply, pickPracticeReply } from "../engine/bridge/practice_partner.ts";
import { type Ctx, route } from "./lib/router.ts";
import { ApiError, json } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import { personObject, type Row } from "./lib/objects.ts";

export { PRACTICE_PARTNER_ID, PRACTICE_PARTNER_NAME };

export function requirePracticePartnerAccess(ctx: Pick<Ctx, "env" | "caller">) {
  if (!ctx.env.practicePartner) throw new ApiError("forbidden", "", { reason: "feature_off" });
  if (!ctx.caller || !ctx.env.practicePartnerOwnerId || ctx.caller.id !== ctx.env.practicePartnerOwnerId) {
    throw new ApiError("forbidden", "", { reason: "owner_only" });
  }
}

function me(ctx: Ctx) {
  return { db: ctx.caller!.db, id: ctx.caller!.id };
}

/** Idempotent: the fixed profile row and the owner's link to it, created once and reused after. */
async function ensurePracticePartner(ctx: Ctx, owner: string) {
  const { service } = ctx;
  const { data: existing } = await service.from("profiles").select("*").eq("id", PRACTICE_PARTNER_ID)
    .maybeSingle();
  let profile = existing as Row | null;
  if (!profile) {
    const { data, error } = await service.from("profiles").insert({
      id: PRACTICE_PARTNER_ID,
      name: PRACTICE_PARTNER_NAME,
      is_practice_partner: true,
    }).select("*").single();
    if (error) dbError(error, "profiles.insert.practice_partner");
    profile = data as Row;
  }
  const a = owner < PRACTICE_PARTNER_ID ? owner : PRACTICE_PARTNER_ID;
  const b = owner < PRACTICE_PARTNER_ID ? PRACTICE_PARTNER_ID : owner;
  const { data: link } = await service.from("links").select("*").eq("person_a", a).eq("person_b", b)
    .maybeSingle();
  if (!link) {
    const { error } = await service.from("links").insert({ person_a: a, person_b: b, status: "active" });
    if (error) dbError(error, "links.insert.practice_partner");
  }
  return profile;
}

route("POST", "/practice-partner/start", async (ctx) => {
  requirePracticePartnerAccess(ctx);
  const { id } = me(ctx);
  const profile = await ensurePracticePartner(ctx, id);
  return json({ person: personObject(profile) });
});

/**
 * Stands in for a real receiver reading and replying to a practiced Bridge: marks the owner's sent bridge opened,
 * then sends back ONE canned reply so the thread shows a round trip. Acts on a bridge the owner sent to the single
 * synthetic practice partner, OR to one of the owner's own fictional linked people (`profiles.is_example`, e.g.
 * seed_preview.py's Lea/Mom/Sam/Ari/Dara — already shared with the owner through `link_prefs`): anything else
 * (a real person, or a bridge that isn't the owner's own) is 404. One reply per bridge (a second call is 409).
 */
route("POST", "/practice-partner/bridges/:id/reply", async (ctx) => {
  requirePracticePartnerAccess(ctx);
  const { db, id: owner } = me(ctx);
  const { data: sent, error } = await db.from("bridges").select("*").eq("id", ctx.params.id).eq("sender", owner)
    .maybeSingle();
  if (error) dbError(error, "bridges");
  if (!sent) throw new ApiError("not_found", "", { where: "bridge" });
  if (sent.opened_at) throw new ApiError("conflict", "", { reason: "already_replied" });

  let replyName: string;
  let text: string;
  if (sent.receiver === PRACTICE_PARTNER_ID) {
    replyName = PRACTICE_PARTNER_NAME;
    text = pickPracticeReply(String(sent.id));
  } else {
    const { data: receiver, error: e0 } = await ctx.service.from("profiles").select("id,name,is_example")
      .eq("id", sent.receiver).maybeSingle();
    if (e0) dbError(e0, "profiles");
    if (!receiver || !receiver.is_example) throw new ApiError("not_found", "", { where: "bridge" });
    const { data: pref } = await ctx.service.from("link_prefs").select("relationship").eq("owner", owner)
      .eq("other", receiver.id).maybeSingle();
    replyName = String(receiver.name);
    text = pickExampleReply(String(sent.id), String(pref?.relationship ?? ""));
  }
  const now = new Date().toISOString();
  const { error: e1 } = await db.from("bridges").update({ opened_at: now }).eq("id", sent.id);
  if (e1) dbError(e1, "bridges.update.practice_partner_open");
  // Defence in depth (CONTRACT §6 parity with POST /bridges): a fixed fixture must still never carry a flagged word.
  const floor = floorSafety(text);
  if (floor.routed !== "none") throw new ApiError("internal", "", { detail: "practice reply failed its own safety floor" });
  // The practice person "sends" this row, which the owner's own RLS-scoped client cannot do (bridges_sender
  // requires auth.uid() = sender); the service client acts as the fictional sender, exactly as block/unblock do.
  const { data: reply, error: e2 } = await ctx.service.from("bridges").insert({
    sender: sent.receiver,
    receiver: owner,
    original: text,
    final: text,
    used: "mine",
    status: "scheduled",
    deliver_at: now,
    tz: ctx.tz,
    reply_to: sent.id,
  }).select("*").single();
  if (e2) dbError(e2, "bridges.insert.practice_partner_reply");
  return json({
    opened_at: now,
    reply: {
      id: reply.id,
      from: replyName,
      final: reply.final,
      reply_to: sent.id,
      created_at: reply.created_at,
    },
  });
});
