// Mirror (CONTRACT §7 Mirror and §3 preview; thesis v3 "Mirror"; APP-V1-BUILD §5 item 9). The owner's link and controls, the
// contributor page's two calls, the processing pipeline (observe on Haiku → the gate → synthesis on Sonnet) and the preview sample.
// Hard rules kept in code: never raw (the moment text is deleted once processed and never returned), never named (the owner
// sees a contributor's name only in the approvals list and never beside a moment), never from one person (the gate), no reply
// channel, no per-contribution signal of any kind (there is no count of contributions anywhere in a reply to the owner).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ModelExchange } from "../engine/types.ts";
import { AnthropicClient } from "../engine/model/client.ts";
import type { ModelClient } from "../engine/model/client.ts";
import { MIRROR_OBSERVE, MIRROR_SYNTHESISE } from "../engine/prompt_text.ts";
import { keywordRisk, RESOURCES, stops } from "../engine/safety.ts";
import type { EntryResult } from "../engine/safety_entry.ts";
import { MIRROR_UNREAD_LINE, unreadBody } from "./lib/safety_gate.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import { aiConsentRefusal, aiConsentRequired, personHasAiConsent, requireAiConsent } from "./lib/ai_consent.ts";
import { decide } from "../engine/mirror/gate.ts";
import {
  OBSERVE_MAX_CHARS,
  OBSERVE_MAX_TOKENS,
  OBSERVE_MIN_CHARS,
  observePackage,
  type OpenTheme,
  readObserved,
  redactMoment,
  weightFor,
} from "../engine/mirror/observe.ts";
import {
  readSynthesis,
  SYNTHESISE_MAX_TOKENS,
  synthesisPackage,
  synthesisProblems,
} from "../engine/mirror/synthesise.ts";
import {
  type GateDecision,
  type GateInput,
  HOW_KNOWN,
  type HowKnown,
  type Observation,
  type Observed,
} from "../engine/mirror/types.ts";
import { type Ctx, route } from "./lib/router.ts";
import { ApiError, json, recordError } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import { type LedgerScope, PostgresLedger, recordEngineCall } from "./lib/ledger.ts";
import { loadMap } from "./lib/state.ts";
import { areaFor, kindFor } from "./lib/map.ts";
import { PERSONAS, perspectiveObject, type Row } from "./lib/objects.ts";
import { MIRROR_SAMPLE } from "./mirror_sample.ts";
import { mirrorPageHtml } from "./mirror_page.ts";
import { authenticate, type Caller } from "./lib/db.ts";
import { ASK_MOMENT_QUESTION, type EligibilityItem, isEligibleFor } from "./lib/card_eligibility.ts";
import { readEligibility } from "./lib/card_eligibility_reader.ts";

export const OBSERVE_MODEL = "claude-haiku-5-5"; // the listener, screen and mapper: small and fast
export const SYNTHESISE_MODEL = "claude-sonnet-5-5"; // the writer, only when the gate runs (APP-V1-BUILD §3)
export const LINK_BASE = "https://kenember.com/m/";
/** W03–W05. The third prompt's wording is the CPO's (16:00 10-27): "What seemed to matter to Nami there?", optional, with Skip. */
export const PROMPTS = [
  "What was happening?",
  "What did {name} do or say?",
  "What seemed to matter to {name} there?",
] as const;
export const HOW_LONG = ["under_a_year", "one_to_five_years", "over_five_years"] as const;
export const CONTRIBUTOR_LINE =
  "{name} will never see your words or who you are. What several people describe may become an outside perspective on their map, which they choose to accept or not.";
export const ASK_MOMENT_LINE =
  "Could you describe a moment where you saw that? What was happening, and what did {name} do or say?";
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const SAMPLE_CAP_CENTS = 15;

/** Test seam, as in bridge_engine.ts: the $0 check swaps both models for recorded ones. `authenticate` stands in for the bearer
 *  check on the routes that authenticate themselves (the preview sample), so a test can drive them on the fake database. Hosted code
 *  never sets either. */
export const hooks: {
  client: ((ctx: Ctx, ledger: PostgresLedger, model: "observe" | "synthesise") => ModelClient) | null;
  authenticate?: ((ctx: Ctx) => Promise<Caller>) | null;
} = { client: null, authenticate: null };

function clientFor(ctx: Ctx, ledger: PostgresLedger, which: "observe" | "synthesise"): ModelClient {
  if (hooks.client) return hooks.client(ctx, ledger, which);
  if (!ctx.env.anthropicKey || !ctx.env.anthropicWorkspace) {
    throw new ApiError("unreachable", "Can't reach Presence right now.", {
      detail: "anthropic key or workspace not configured",
    });
  }
  const config = { key: ctx.env.anthropicKey, workspace: ctx.env.anthropicWorkspace };
  return which === "observe"
    ? new AnthropicClient({
      config,
      ledger,
      defaultModel: OBSERVE_MODEL,
      fallbackModel: null,
      thinking: "disabled",
      timeoutMs: 30_000,
    })
    : new AnthropicClient({
      config,
      ledger,
      defaultModel: SYNTHESISE_MODEL,
      thinking: "between_tools",
      timeoutMs: 55_000,
    });
}

export function newSlug(n = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

/** A contributor's key: a hash of the owner and the contributor's account, so one person is one voice on one link and the owner
 *  can never recover who it was. */
export async function contributorKey(owner: string, uid: string): Promise<string> {
  const data = new TextEncoder().encode(`${owner}:${uid}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] || "they";

/** V3 Mirror ask (Y6/X2, v1.60): the owner's one question, at most this many characters (code points, as Postgres counts). */
export const QUESTION_MAX = 140;

/** Reads `question` from PATCH /mirror. `null` or blank clears it; whitespace runs fold to one space; over QUESTION_MAX or not a
 *  string is `400 invalid` (field question). `risk` is the law 8 floor (keywords, no model call): the caller stores nothing. */
export function readQuestion(raw: unknown): { question: string | null; risk: boolean } {
  if (raw === null) return { question: null, risk: false };
  if (typeof raw !== "string") throw new ApiError("invalid", "", { field: "question" });
  const q = Array.from(raw, (ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127 ? " " : ch;
  }).join("").replace(/\s+/g, " ").trim();
  if (!q) return { question: null, risk: false };
  if (Array.from(q).length > QUESTION_MAX) {
    throw new ApiError("invalid", "", { field: "question", max: QUESTION_MAX });
  }
  return { question: q, risk: stops(keywordRisk(q)) };
}

async function askSource(ctx: Ctx, id: unknown): Promise<EligibilityItem> {
  const { service, caller } = ctx;
  const owner = caller!.id;
  if (typeof id !== "string" || !id) throw new ApiError("invalid", "", { field: "ask_source_item_id" });
  const { data, error } = await service.from("beliefs").select(
    "id,statement,own_wording,status,rating,comm_kind,comm_scope_type,comm_scope_value,comm_status,comm_topic,comm_source,comm_hidden_from_map,card_eligibility_wording_hash,card_eligibility_sensitive",
  ).eq("id", id).eq("owner", owner).maybeSingle();
  if (error) dbError(error, "beliefs.ask_source");
  const row = data as Row | null;
  if (!row || !row.comm_kind) throw new ApiError("not_found", "", { where: "ask_source_item" });
  const scope = row.comm_status === "private_only"
    ? "private"
    : row.comm_scope_type === "everyone"
    ? "everyone"
    : row.comm_scope_type === "type" && row.comm_scope_value === "family"
    ? "family"
    : row.comm_scope_type === "type" && row.comm_scope_value === "friends"
    ? "friends"
    : row.comm_scope_type === "type" && row.comm_scope_value === "coworker"
    ? "coworker"
    : row.comm_scope_type === "person"
    ? "person"
    : "unset";
  const status = row.comm_status === "set_aside"
    ? "set_aside"
    : row.status === "retired"
    ? "retired"
    : row.rating === "not"
    ? "not_me"
    : row.status === "confirmed" && row.rating === "partly"
    ? "partly"
    : row.comm_source === "typed" && row.status === "confirmed"
    ? "edited"
    : row.status === "confirmed"
    ? "confirmed"
    : "suggested";
  const item: EligibilityItem = {
    id: String(row.id),
    wording: String(row.own_wording ?? row.statement),
    kind: String(row.comm_kind),
    topic: row.comm_topic as string | null,
    scope,
    status,
    hiddenFromMap: row.comm_hidden_from_map === true,
  };
  const read = await readEligibility(ctx, row, item);
  if (!isEligibleFor(read, "ask")) throw new ApiError("forbidden", "", { reason: "ineligible_ask_source" });
  return read;
}

// ------------------------------------------------------------------ the owner's link (Y02)

async function linkFor(service: SupabaseClient, owner: string): Promise<Row | null> {
  const { data, error } = await service.from("mirror_links").select("*").eq("owner", owner).maybeSingle();
  if (error) dbError(error, "mirror_links");
  return data;
}

async function ensureLink(service: SupabaseClient, owner: string): Promise<Row> {
  const have = await linkFor(service, owner);
  if (have) return have;
  const { data, error } = await service.from("mirror_links").insert({
    owner,
    slug: newSlug(),
    enabled: false,
  }).select("*").single();
  if (error) dbError(error, "mirror_links.insert");
  return data;
}

async function mirrorObject(service: SupabaseClient, owner: string) {
  const link = await linkFor(service, owner);
  const { count } = await service.from("outside_perspectives").select("id", { count: "exact", head: true })
    .eq("owner", owner).eq("status", "new");
  const approvals: Row[] = [];
  if (link && link.who === "approved") {
    const { data } = await service.from("mirror_approvals").select("id,contributor_name,how_known,created_at")
      .eq("link_id", link.id).eq("status", "pending").order("created_at");
    for (const a of data ?? []) {
      approvals.push({
        id: a.id,
        name: a.contributor_name,
        how_known: a.how_known ?? "other",
        since: a.created_at,
      });
    }
  }
  const on = !!link && link.enabled === true;
  return {
    on,
    slug: on ? link!.slug : null,
    link: on ? LINK_BASE + link!.slug : null,
    who: link?.who ?? "anyone",
    paused: link?.paused === true,
    question: typeof link?.question === "string" ? link.question : null,
    approvals,
    waiting: count ?? 0,
  };
}

/** B-Q10: one row per blocked outside card, never one row per contributor. The database rows are service-only and may contain
 * contributor keys; this projection is the whole owner-visible shape. */
export function blockedPerspectiveObjects(rows: Row[]): { id: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const row of rows) {
    const id = typeof row.perspective_id === "string" ? row.perspective_id : "";
    const joined = Array.isArray(row.perspective) ? row.perspective[0] : row.perspective;
    const label = joined && typeof joined === "object" && typeof (joined as Row).label === "string"
      ? String((joined as Row).label)
      : "";
    if (id && label && !byId.has(id)) byId.set(id, label);
  }
  return [...byId].map(([id, label]) => ({ id, label })).sort((a, b) =>
    a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
  );
}

route(
  "GET",
  "/mirror",
  async ({ caller, service }) => json({ mirror: await mirrorObject(service, caller!.id) }),
);

route("GET", "/mirror/blocked", async ({ caller, service }) => {
  const { data, error } = await service.from("mirror_blocks").select(
    "perspective_id,perspective:outside_perspectives!mirror_blocks_perspective_id_fkey(label)",
  ).eq("owner", caller!.id).order("created_at");
  if (error) dbError(error, "mirror_blocks.list");
  return json({ blocked: blockedPerspectiveObjects((data ?? []) as Row[]) });
});

route("DELETE", "/mirror/blocked/:id", async ({ caller, service, params }) => {
  const { data, error } = await service.from("mirror_blocks").delete().eq("owner", caller!.id).eq(
    "perspective_id",
    params.id,
  ).select("id");
  if (error) dbError(error, "mirror_blocks.delete");
  if (!data?.length) throw new ApiError("not_found", "", { where: "mirror_block" });
  return json({ unblocked: params.id });
});

route("PATCH", "/mirror", async (ctx) => {
  const { caller, service } = ctx;
  const b = await ctx.body();
  const patch: Row = {};
  if (typeof b.on === "boolean") {
    patch.enabled = b.on;
    if (b.on) patch.paused = false;
  }
  if (b.who !== undefined) {
    if (b.who !== "anyone" && b.who !== "approved") throw new ApiError("invalid", "", { field: "who" });
    patch.who = b.who;
  }
  if (typeof b.paused === "boolean") patch.paused = b.paused;
  if (b.question !== undefined) {
    const q = readQuestion(b.question);
    // Law 8: a question that shows risk stores nothing (and no other field in the same call); resources go to the owner only.
    const qGate = !q.risk && q.question ? await requireSafetyPass(ctx, q.question, "mirror", []) : null;
    if (qGate?.routed === "unavailable") {
      return json(unreadBody({ mirror: await mirrorObject(service, caller!.id) }));
    }
    if (q.risk || qGate?.stop) {
      return json({ mirror: await mirrorObject(service, caller!.id), state: "safety", resources: RESOURCES });
    }
    patch.question = q.question;
  }
  if (b.ask_source_item_id !== undefined) {
    if (b.ask_source_item_id === null) {
      patch.ask_source_item_id = null;
    } else {
      await askSource(ctx, b.ask_source_item_id);
      patch.ask_source_item_id = b.ask_source_item_id;
      // A preset never echoes the item's statement; it starts with the required moment form. The owner may then edit
      // `question` in a later PATCH, which passes this endpoint's safety screen again before the link is enabled.
      if (b.question === undefined) patch.question = ASK_MOMENT_QUESTION;
    }
  }
  if (!Object.keys(patch).length) throw new ApiError("invalid", "", { field: "body" });
  const link = await ensureLink(service, caller!.id);
  const { error } = await service.from("mirror_links").update(patch).eq("id", link.id);
  if (error) dbError(error, "mirror_links.update");
  if (patch.who === "anyone" && link.who === "approved") {
    await releaseWaiting(ctx, { ...link, ...patch }, null);
  }
  return json({ mirror: await mirrorObject(service, caller!.id) });
});

route("POST", "/mirror/rotate", async ({ caller, service }) => {
  const link = await ensureLink(service, caller!.id);
  // A new link starts with no question (v1.60). Only touch the column where it exists (a database before 0053 has none).
  const fresh: Row = "question" in link ? { slug: newSlug(), question: null } : { slug: newSlug() };
  const { error } = await service.from("mirror_links").update(fresh).eq("id", link.id);
  if (error) dbError(error, "mirror_links.update");
  return json({ mirror: await mirrorObject(service, caller!.id) });
});

/** Delete link and everything pending: the link row goes, and with it every contribution and approval (cascade). Perspectives
 *  that already reached the owner are his cards and stay. */
route("DELETE", "/mirror", async ({ caller, service }) => {
  const { error } = await service.from("mirror_links").delete().eq("owner", caller!.id);
  if (error) dbError(error, "mirror_links.delete");
  return json({ mirror: await mirrorObject(service, caller!.id) });
});

route("POST", "/mirror/approvals/:id", async (ctx) => {
  const { caller, service, params } = ctx;
  const b = await ctx.body();
  if (typeof b.approve !== "boolean") throw new ApiError("invalid", "", { field: "approve" });
  const { data: a, error } = await service.from("mirror_approvals").select("*").eq("id", params.id).eq(
    "owner",
    caller!.id,
  ).maybeSingle();
  if (error) dbError(error, "mirror_approvals");
  if (!a) throw new ApiError("not_found", "", { where: "approval" });
  const status = b.approve ? "approved" : "declined";
  await service.from("mirror_approvals").update({ status, decided_at: new Date().toISOString() }).eq(
    "id",
    a.id,
  );
  const link = await linkFor(service, caller!.id);
  if (b.approve && link) await releaseWaiting(ctx, link, a.contributor_key as string);
  else {await service.from("mirror_contributions").update({
      status: "declined",
      moment: null,
      dropped_reason: "declined",
    }).eq("link_id", a.link_id).eq("contributor_key", a.contributor_key).eq("status", "pending_approval");}
  return json({ mirror: await mirrorObject(service, caller!.id) });
});

/**
 * Mirror is package 04. Until its consent flow is built (the contributor page's disclosure and consent, the link owner's
 * consent for processing; review round 7, #8), a release deployment reads no Mirror moment with a model: the contributor
 * route answers `feature_off` and held moments stay held. Preview keeps Mirror as it is.
 */
export function mirrorReadsWords(ctx: Pick<Ctx, "env">): boolean {
  return ctx.env.releaseBuild !== true;
}

/** Contributions that waited for approval are processed now (one key, or every key when the link opens to anyone). */
async function releaseWaiting(ctx: Ctx, link: Row, key: string | null) {
  if (!mirrorReadsWords(ctx)) return;
  let q = ctx.service.from("mirror_contributions").select("*").eq("link_id", link.id).eq(
    "status",
    "pending_approval",
  ).order("created_at");
  if (key) q = q.eq("contributor_key", key);
  const { data } = await q;
  let released = 0;
  for (const c of data ?? []) {
    // Read later, with nobody there to ask: the contributor's consent is checked again now (review round 5, #8). Without it
    // the moment stays held, unread.
    if (!(await heldMayBeRead(ctx, c))) continue;
    await processContribution(ctx, link, c);
    await ctx.service.from("mirror_contributions").update({ contributor_id: null }).eq("id", c.id);
    released += 1;
  }
  if (released) await runGate(ctx, link, false);
}

/** A held moment may reach a model only if its contributor's consent is current now (withdrawn or an older version: not). */
export async function heldMayBeRead(ctx: Ctx, c: Row): Promise<boolean> {
  if (!aiConsentRequired(ctx)) return true;
  const person = typeof c.contributor_id === "string" ? c.contributor_id : null;
  const owner = typeof c.owner === "string" ? c.owner : null;
  return person !== null && owner !== null && await personHasAiConsent(ctx, ctx.service, person) &&
    await personHasAiConsent(ctx, ctx.service, owner);
}

// ------------------------------------------------------------------ the contributor page (web)

async function linkBySlug(service: SupabaseClient, slug: string): Promise<Row | null> {
  const { data, error } = await service.from("mirror_links").select(
    "*, profiles!mirror_links_owner_fkey(name,is_preview)",
  ).eq("slug", slug.toLowerCase()).maybeSingle();
  if (error) dbError(error, "mirror_links");
  return data;
}

async function pageObject(service: SupabaseClient, link: Row | null) {
  if (!link) {
    return {
      open: false,
      reason: "not_found",
      owner_name: null,
      who: null,
      prompts: [],
      how_known: HOW_KNOWN,
      how_long: HOW_LONG,
      line: null,
      question: null,
      preview: false,
      test_friends: [],
    };
  }
  const profile = link.profiles as Row | null;
  const name = firstName(profile?.name);
  const open = link.enabled === true && link.paused !== true;
  const preview = profile?.is_preview === true;
  // A preview link accepts only example contributors (CDO build review 1, R2): the page offers them as "Continue as a test friend".
  let friends: { persona: string; name: string }[] = [];
  if (preview && open) {
    const { data } = await service.from("profiles").select("persona,name").eq("is_example", true).neq(
      "id",
      link.owner,
    ).order("name");
    friends = (data ?? []).filter((f) => f.persona).map((f) => ({
      persona: String(f.persona),
      name: firstName(f.name),
    }));
  }
  return {
    open,
    reason: open ? null : (link.enabled ? "paused" : "off"),
    owner_name: name,
    who: String(link.who ?? "anyone"),
    prompts: PROMPTS.map((p) => p.replaceAll("{name}", name)),
    how_known: HOW_KNOWN,
    how_long: HOW_LONG,
    line: CONTRIBUTOR_LINE.replaceAll("{name}", name),
    // The owner's own question (v1.60), only while the page is open; a closed page shows one calm line and nothing else.
    question: open && typeof link.question === "string" ? link.question : null,
    preview,
    test_friends: friends,
  };
}

/** The contributor page: JSON for the app's calls; the HTML page (W01–W06) when a browser asks for it. Reachable only by its link (noindex). */
route("GET", "/m/:slug", async ({ service, params, req, env, url }) => {
  const page = await pageObject(service, await linkBySlug(service, params.slug));
  if (!/text\/html/.test(req.headers.get("accept") ?? "")) return json(page);
  const apiBase = url.pathname.replace(/\/m\/[^/]+\/?$/, ""); // the function's own base, hosted (/functions/v1/api) or on the Mac
  return new Response(mirrorPageHtml(page, params.slug, apiBase, env.anonKey), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-presence-contract": "1",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
    },
  });
}, false);

/**
 * Who is contributing. A signed-in bearer is the ordinary case (one voice per account per link). In preview, the page's "Continue as a test
 * friend" sends `test_friend: <persona>` instead, accepted only when the link's owner is a preview account and the persona is one of the
 * example people (never the owner's own); a preview link takes no other contributor (CDO build review 1, R2).
 */
async function contributor(
  ctx: Ctx,
  link: Row,
  b: Record<string, unknown>,
): Promise<{ id: string; caller: Caller | null }> {
  const profile = link.profiles as Row | null;
  const preview = profile?.is_preview === true;
  if (ctx.req.headers.get("authorization")) {
    const caller = await authenticate(ctx.env, ctx.req);
    if (preview && !caller.isExample && caller.id !== link.owner) {
      throw new ApiError("forbidden", "This preview link takes only the example people.", {
        reason: "preview_examples_only",
      });
    }
    return { id: caller.id, caller };
  }
  const persona = typeof b.test_friend === "string" ? b.test_friend.toLowerCase() : "";
  if (!preview || !persona) throw new ApiError("unauthorized", "Sign in to continue.");
  if (!(PERSONAS as readonly string[]).includes(persona)) {
    throw new ApiError("invalid", "", { field: "test_friend" });
  }
  const { data } = await ctx.service.from("profiles").select("id,is_example").eq("persona", persona)
    .maybeSingle();
  if (data && String(data.id) === String(link.owner)) {
    throw new ApiError("forbidden", "", { reason: "own_link" });
  }
  if (!data || data.is_example !== true) {
    throw new ApiError("forbidden", "", { reason: "preview_examples_only" });
  }
  return { id: String(data.id), caller: null };
}

/** The three prompts become one moment for the listener; a plain `moment` is still accepted. */
export function composeMoment(b: Record<string, unknown>, name: string): string {
  const part = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  if (part("moment")) return part("moment");
  const rows: string[] = [];
  if (part("happening")) rows.push(`What was happening: ${part("happening")}`);
  if (part("did")) rows.push(`What ${name} did or said: ${part("did")}`);
  if (part("mattered")) rows.push(`What seemed to matter to ${name}: ${part("mattered")}`);
  return rows.join("\n");
}

/** sre-08: how many moments one contributor may leave on one link in a day, and one link may take in an hour. */
export const MIRROR_LIMITS = { perContributorPerDay: 5, perLinkPerHour: 30 } as const;
export const ATTESTATION_VERSION = "2027-01";

/** sre-08: the 18+ attestation and the rate limits, decided before anything is stored or any model is called. Pure, so a test needs no database. */
export function contributionGuard(
  b: Record<string, unknown>,
  requireAdult: boolean,
  counts: { contributorDay: number; linkHour: number },
): void {
  if (requireAdult && b.adult !== true) {
    throw new ApiError("forbidden", "", { reason: "adult_attestation", version: ATTESTATION_VERSION });
  }
  if (
    counts.contributorDay >= MIRROR_LIMITS.perContributorPerDay ||
    counts.linkHour >= MIRROR_LIMITS.perLinkPerHour
  ) {
    throw new ApiError("rate_limited", "This link isn't taking more moments right now.", {
      reason: "rate_limited",
    });
  }
}

async function recentCount(
  service: SupabaseClient,
  linkId: unknown,
  sinceMs: number,
  key?: string,
): Promise<number> {
  let q = service.from("mirror_contributions").select("id", { count: "exact", head: true }).eq(
    "link_id",
    linkId,
  )
    .gte("created_at", new Date(Date.now() - sinceMs).toISOString());
  if (key) q = q.eq("contributor_key", key);
  const { count } = await q;
  return count ?? 0;
}

/** Null when the contributor may be read by a model; otherwise the floor's resources for a risky moment, or the consent refusal. */
export async function contributorConsentOrFloor(ctx: Ctx, contributorId: string, moment: string, linkOwner?: string): Promise<Response | null> {
  // The link owner's consent too (review round 8, #8): without it the link takes no moment (nothing stored, nothing read).
  if (linkOwner && !(await personHasAiConsent(ctx, ctx.service, linkOwner))) {
    throw new ApiError("forbidden", "This link isn't taking moments right now.", { reason: "closed" });
  }
  if (await personHasAiConsent(ctx, ctx.service, contributorId)) return null;
  if (stops(keywordRisk(moment))) {
    return json({ accepted: false, state: "concern", line: RESOURCES.message, resources: RESOURCES, ref: null, contribution_id: null });
  }
  throw aiConsentRefusal();
}

route("POST", "/m/:slug/contributions", async (ctx) => {
  if (!mirrorReadsWords(ctx)) throw new ApiError("forbidden", "This link isn't taking moments right now.", { reason: "feature_off" });
  const { service, params } = ctx;
  const link = await linkBySlug(service, params.slug);
  if (!link) throw new ApiError("not_found", "", { where: "mirror" });
  const b = await ctx.body();
  const who = await contributor(ctx, link, b);
  if (link.owner === who.id) throw new ApiError("forbidden", "", { reason: "own_link" });
  if (!(link.enabled === true && link.paused !== true)) {
    throw new ApiError("forbidden", "This link isn't taking moments right now.", { reason: "closed" });
  }
  const name = firstName((link.profiles as Row | null)?.name);
  const moment = composeMoment(b, name);
  if (moment.length < OBSERVE_MIN_CHARS) {
    throw new ApiError("invalid", "", { field: "moment", min: OBSERVE_MIN_CHARS });
  }
  if (moment.length > OBSERVE_MAX_CHARS) {
    throw new ApiError("invalid", "", { field: "moment", max: OBSERVE_MAX_CHARS });
  }
  const howKnown: HowKnown = (HOW_KNOWN as readonly string[]).includes(String(b.how_known))
    ? b.how_known as HowKnown
    : "other";
  const howLong = (HOW_LONG as readonly string[]).includes(String(b.how_long)) ? String(b.how_long) : null;
  const key = await contributorKey(link.owner as string, who.id);
  contributionGuard(b, (Deno.env.get("PRESENCE_MIRROR_REQUIRE_ADULT") ?? "false") === "true", {
    contributorDay: await recentCount(service, link.id, 86_400_000, key),
    linkHour: await recentCount(service, link.id, 3_600_000),
  });
  const attested = b.adult === true
    ? { adult_attested_at: new Date().toISOString(), attestation_version: ATTESTATION_VERSION }
    : {};
  const line = CONTRIBUTOR_LINE.replaceAll("{name}", name);
  // CONTRACT §7 AI consent, for the contributor (review round 4, #8): a model reads these words (the safety reading, the listener,
  // later the writer), so the person who wrote them must have agreed. Checked before anything is stored, a held approval included,
  // because a moment released later is read with nobody there to ask. Law 8 first: the local floor, which calls no model, still
  // answers a risky moment with resources.
  const held = await contributorConsentOrFloor(ctx, who.id, moment, link.owner as string);
  if (held) return held;
  if (link.who === "approved") {
    const { data: a } = await service.from("mirror_approvals").select("status").eq("link_id", link.id).eq(
      "contributor_key",
      key,
    ).maybeSingle();
    if (!a) {
      const { data: me } = await service.from("profiles").select("name").eq("id", who.id).maybeSingle();
      const contributorName = (typeof b.name === "string" && b.name.trim().slice(0, 40)) ||
        String(me?.name ?? "Someone");
      await service.from("mirror_approvals").insert({
        link_id: link.id,
        owner: link.owner,
        contributor_key: key,
        contributor_name: contributorName,
        how_known: howKnown,
      });
    }
    if (!a || a.status === "pending") {
      const { data: w } = await service.from("mirror_contributions").insert({
        link_id: link.id,
        owner: link.owner,
        contributor_key: key,
        how_known: howKnown,
        how_long: howLong,
        moment,
        ...attested,
        // Kept only while held, so consent can be checked again when the owner releases it; cleared once read.
        contributor_id: who.id,
        status: "pending_approval",
      }).select("id").single();
      return json({
        accepted: true,
        state: "waiting_approval",
        line,
        resources: null,
        ref: null,
        contribution_id: w?.id ?? null,
      });
    }
    if (a.status === "declined") {
      return json({ accepted: true, state: "done", line, resources: null, ref: null, contribution_id: null }); // dropped silently, nothing stored
    }
  }
  // PSY 16 Nov 2f: the one safety entry reads the words BEFORE anything is taken. Unreadable = not taken at all and not recorded as a concern.
  const gate = await requireSafetyPass(ctx, moment, "mirror", [], link.owner as string);
  if (gate.routed === "unavailable") {
    return json({
      accepted: false,
      state: "unavailable",
      line: MIRROR_UNREAD_LINE,
      resources: null,
      ref: null,
      contribution_id: null,
    });
  }
  const { data: c, error } = await service.from("mirror_contributions").insert({
    link_id: link.id,
    owner: link.owner,
    contributor_key: key,
    how_known: howKnown,
    how_long: howLong,
    moment,
    ...attested,
    status: "pending",
  }).select("*").single();
  if (error) dbError(error, "mirror_contributions.insert");
  const outcome = await processContribution(ctx, link, c, gate);
  if (outcome.state === "done") await runGate(ctx, link, false);
  return json({
    accepted: outcome.state !== "concern" && outcome.state !== "ask_moment",
    state: outcome.state,
    line: outcome.state === "ask_moment"
      ? ASK_MOMENT_LINE.replaceAll("{name}", name)
      : outcome.state === "concern"
      ? RESOURCES.message
      : line,
    resources: outcome.state === "concern" ? RESOURCES : null,
    ref: outcome.ref,
    contribution_id: c.id,
  });
}, false);

/**
 * W06 Delete my answer: the contributor's own row, found by their key. A held or waiting row is deleted outright (its raw text is already gone
 * once processed); a row already used by a card is detached from it and the card's counts shrink (the owner keeps what reached him).
 */
route("DELETE", "/m/:slug/contributions/:id", async (ctx) => {
  const { service, params } = ctx;
  const link = await linkBySlug(service, params.slug);
  if (!link) throw new ApiError("not_found", "", { where: "mirror" });
  const b = await ctx.body();
  const who = await contributor(ctx, link, b);
  const key = await contributorKey(link.owner as string, who.id);
  const { data: c } = await service.from("mirror_contributions").select("id,status,perspective_id").eq(
    "id",
    params.id,
  ).eq("link_id", link.id).eq("contributor_key", key).maybeSingle();
  if (!c) throw new ApiError("not_found", "", { where: "contribution" });
  if (c.status === "used" && c.perspective_id) {
    const { data: p } = await service.from("outside_perspectives").select("id,contribution_ids").eq(
      "id",
      c.perspective_id,
    ).maybeSingle();
    if (p) {
      const ids = ((p.contribution_ids as string[]) ?? []).filter((x) => x !== c.id);
      const { data: rest } = ids.length
        ? await service.from("mirror_contributions").select("contributor_key").in("id", ids)
        : { data: [] };
      await service.from("outside_perspectives").update({
        contribution_ids: ids,
        moment_count: ids.length,
        people_count: new Set((rest ?? []).map((r) => String(r.contributor_key))).size,
      }).eq("id", p.id);
    }
  }
  const { error } = await service.from("mirror_contributions").delete().eq("id", c.id);
  if (error) dbError(error, "mirror_contributions.delete");
  return json({ deleted: true });
}, false);

// ------------------------------------------------------------------ processing: observe (listener, screen, mapper)

interface Outcome {
  state: "done" | "ask_moment" | "concern" | "dropped" | "unavailable";
  ref: string | null;
}

async function ownerScope(service: SupabaseClient, owner: string): Promise<LedgerScope> {
  const { data } = await service.from("profiles").select("is_preview").eq("id", owner).maybeSingle();
  return { person: owner, ownerPreview: data?.is_preview === true, conversationId: null, feature: "mirror" };
}

async function trace(
  ctx: Ctx,
  scope: LedgerScope,
  ledger: PostgresLedger,
  exchanges: ModelExchange[],
  ref: string | null = null,
) {
  const ids = [...ledger.ids.values()];
  for (let i = 0; i < exchanges.length; i++) {
    await recordEngineCall(ctx.service, scope, exchanges[i], ids[i] ?? null, ref);
  }
}

/** The themes a new moment may join: those held on this link and those that already surfaced as a perspective (so later
 *  moments keep converging on the same theme instead of opening a fresh one). */
async function openThemes(service: SupabaseClient, linkId: string, owner: string): Promise<OpenTheme[]> {
  const by = new Map<string, OpenTheme>();
  const { data: ps } = await service.from("outside_perspectives").select(
    "theme_key,label,statement,moment_count",
  ).eq("owner", owner).not("theme_key", "is", null).order("created_at");
  for (const p of ps ?? []) {
    by.set(String(p.theme_key), {
      key: String(p.theme_key),
      label: String(p.label ?? ""),
      statement: String(p.statement ?? ""),
      count: Number(p.moment_count ?? 0),
    });
  }
  const { data } = await service.from("mirror_contributions").select("theme_key,observation").eq(
    "link_id",
    linkId,
  ).eq("status", "pending").not("theme_key", "is", null).order("created_at");
  for (const c of data ?? []) {
    const t = ((c.observation as Row)?.theme ?? {}) as Row;
    const key = String(c.theme_key);
    const have = by.get(key);
    if (have) have.count++;
    else by.set(key, { key, label: String(t.label ?? ""), statement: String(t.statement ?? ""), count: 1 });
  }
  return [...by.values()];
}

/** Held moments whose theme already reached the owner join it at once (counts grow, no card, no call); the rest face the gate. */
export function partitionHeld<T extends { themeKey: string | null }>(
  held: T[],
  surfacedKeys: ReadonlySet<string>,
): { joining: Map<string, T[]>; gated: T[] } {
  const joining = new Map<string, T[]>();
  const gated: T[] = [];
  for (const h of held) {
    if (h.themeKey && surfacedKeys.has(h.themeKey)) {
      joining.set(h.themeKey, [...(joining.get(h.themeKey) ?? []), h]);
    } else gated.push(h);
  }
  return { joining, gated };
}

/** One contribution through the listener. The raw moment is deleted here whatever happens (retention). */
async function processContribution(ctx: Ctx, link: Row, c: Row, gate?: EntryResult): Promise<Outcome> {
  const service = ctx.service, owner = link.owner as string, id = c.id as string;
  const moment = String(c.moment ?? "");
  const drop = async (reason: string, ref: string | null = null): Promise<Outcome> => {
    await service.from("mirror_contributions").update({
      status: "dropped",
      dropped_reason: reason,
      moment: null,
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    return {
      state: reason === "concern"
        ? "concern"
        : reason === "label_only" || reason === "unclear"
        ? "ask_moment"
        : "dropped",
      ref,
    };
  };
  if (!moment) return drop("empty");
  const safetyRead = gate ?? await requireSafetyPass(ctx, moment, "mirror", [], owner); // the one safety entry, before any listener call (law 8; fails closed)
  // An unreadable reading is not a concern: the row stays pending and nothing is mapped.
  if (safetyRead.routed === "unavailable") return { state: "unavailable", ref: null };
  if (safetyRead.stop) return drop("concern");
  const { data: profile } = await service.from("profiles").select("name").eq("id", owner).maybeSingle();
  const name = firstName(profile?.name);
  const map = await loadMap(service, owner);
  const open = await openThemes(service, link.id as string, owner);
  const mapIds = map.beliefs.filter((b) => b.status === "endorsed").map((b) => b.id);
  const scope = await ownerScope(service, owner), ledger = new PostgresLedger(service, scope);
  const client = clientFor(ctx, ledger, "observe");
  const pkg = observePackage(name, String(c.how_known ?? "other") as HowKnown, moment, map.beliefs, open);
  let exchange = await client.complete({
    purpose: "mirror_observe",
    system: MIRROR_OBSERVE,
    messages: [{ role: "user", content: pkg }],
    maxTokens: OBSERVE_MAX_TOKENS,
  });
  const exchanges = [exchange];
  let read = exchange.error && !exchange.rawResponse
    ? { observed: null, problems: [exchange.error] }
    : readObserved(exchange.rawResponse, name, open.map((t) => t.key), mapIds);
  if (read.problems.length && !(exchange.error && !exchange.rawResponse)) {
    exchange = await client.complete({
      purpose: "mirror_observe_repair",
      system: MIRROR_OBSERVE,
      maxTokens: OBSERVE_MAX_TOKENS,
      messages: [{ role: "user", content: pkg }, {
        role: "assistant",
        content: exchange.rawResponse || "(empty)",
      }, {
        role: "user",
        content: `That failed: ${
          read.problems.join("; ")
        }. Answer again with ONE JSON object in the same shape; de-identified, no banned word, label of one to three words.`,
      }],
    });
    exchanges.push(exchange);
    read = exchange.error && !exchange.rawResponse
      ? { observed: null, problems: [exchange.error] }
      : readObserved(exchange.rawResponse, name, open.map((t) => t.key), mapIds);
  }
  // the trace never keeps the moment as written (Q62 b): every copy of the package in the rows carries its length and hash instead
  const redacted = await redactMoment(pkg, moment);
  await trace(
    ctx,
    scope,
    ledger,
    exchanges.map((e) => ({
      ...e,
      request: {
        ...e.request,
        messages: e.request.messages.map((m) => (m.content === pkg ? { ...m, content: redacted } : m)),
      },
    })),
  );
  const observed: Observed | null = read.observed;
  if (!observed) {
    const ref = await recordError(
      service,
      owner,
      "mirror/observe",
      exchanges.at(-1)?.error?.startsWith("budget_unavailable") ? "daily_limit" : "unreadable",
      read.problems.join("; "),
    );
    return drop("unreadable", ref);
  }
  if (observed.safety.level === "concern") return drop("concern");
  if (observed.safety.level === "abuse") return drop("abuse");
  if (observed.kind !== "moment" || !observed.observation) {
    return drop(observed.kind === "label" ? "label_only" : "unclear");
  }
  const themeKey = observed.theme ? (observed.theme.key ?? `t_${newSlug(8)}`) : null;
  const { error } = await service.from("mirror_contributions").update({
    status: "pending",
    moment: null,
    processed_at: new Date().toISOString(),
    weight: weightFor(String(c.how_known ?? "other")),
    observation: {
      ...observed.observation,
      theme: observed.theme
        ? {
          label: observed.theme.label,
          statement: observed.theme.statement,
          type: observed.theme.type,
          confidence: observed.theme.confidence,
        }
        : null,
    },
    theme_key: themeKey,
    map_belief_id: observed.map?.beliefId ?? null,
    map_relation: observed.map?.relation ?? null,
    map_confidence: observed.map?.confidence ?? null,
  }).eq("id", id);
  if (error) dbError(error, "mirror_contributions.update");
  return { state: "done", ref: null };
}

// ------------------------------------------------------------------ processing: the gate and the synthesis

function gateInput(c: Row): GateInput {
  const o = (c.observation ?? {}) as Row;
  const t = (o.theme ?? {}) as Row;
  return {
    id: c.id as string,
    contributorKey: String(c.contributor_key),
    weight: Number(c.weight ?? 1),
    themeKey: (c.theme_key as string | null) ?? null,
    themeConfidence: Number(t.confidence ?? 0),
    observation: {
      situation: String(o.situation ?? ""),
      behaviour: String(o.behaviour ?? ""),
      reaction: String(o.reaction ?? ""),
      guess: (o.guess as string | null) ?? null,
      domains: (o.domains as Observation["domains"]) ?? [],
    },
    mapBeliefId: (c.map_belief_id as string | null) ?? null,
    mapRelation: (c.map_relation as "supports" | "contradicts" | null) ?? null,
    mapConfidence: Number(c.map_confidence ?? 0),
  };
}

/** Run the gate over the link's held observations; synthesise each decision that has no card yet; return what surfaced. */
export async function runGate(ctx: Ctx, link: Row, fromSample: boolean): Promise<Row[]> {
  const service = ctx.service, owner = link.owner as string;
  const { data: held, error } = await service.from("mirror_contributions").select("*").eq("link_id", link.id)
    .eq("status", "pending").not("observation", "is", null).order("created_at");
  if (error) dbError(error, "mirror_contributions");
  const rows = held ?? [];
  const inputs = rows.map(gateInput);
  const { data: surfacedRows } = await service.from("outside_perspectives").select(
    "id,theme_key,contribution_ids",
  ).eq("owner", owner).not("theme_key", "is", null);
  const byKey = new Map((surfacedRows ?? []).map((p) => [String(p.theme_key), p]));
  const { joining, gated } = partitionHeld(inputs, new Set(byKey.keys()));
  for (const [key, group] of joining) {
    const p = byKey.get(key)!;
    await joinPerspective(service, p as Row, group.map((g) => g.id));
  }
  const decisions = decide(gated);
  const surfaced: Row[] = [];
  for (const d of decisions) {
    const group = rows.filter((r) => d.contributionIds.includes(r.id as string));
    let q = service.from("outside_perspectives").select("*").eq("owner", owner).eq("variant", d.variant);
    q = d.variant === "new" ? q.eq("theme_key", d.themeKey!) : q.eq("about_belief_id", d.beliefId!);
    const { data: existing } = await q.maybeSingle();
    if (existing) {
      await joinPerspective(service, existing, d.contributionIds);
      continue;
    } // a map belief's support or tension card already exists
    const made = await synthesise(ctx, owner, d, group, fromSample);
    if (made) surfaced.push(made);
  }
  return surfaced;
}

/** Later moments on a theme that already reached the owner: the counts grow, the moments are used, no new card and no call. */
async function joinPerspective(service: SupabaseClient, existing: Row, contributionIds: string[]) {
  const ids = [...new Set([...((existing.contribution_ids as string[]) ?? []), ...contributionIds])];
  const { data: all } = await service.from("mirror_contributions").select("contributor_key").in("id", ids);
  const people = new Set((all ?? []).map((c) => String(c.contributor_key))).size;
  await service.from("outside_perspectives").update({
    contribution_ids: ids,
    moment_count: ids.length,
    people_count: people,
  }).eq("id", existing.id);
  await service.from("mirror_contributions").update({ status: "used", perspective_id: existing.id }).in(
    "id",
    contributionIds,
  );
}

async function synthesise(
  ctx: Ctx,
  owner: string,
  d: GateDecision,
  group: Row[],
  fromSample: boolean,
): Promise<Row | null> {
  const service = ctx.service;
  const { data: profile } = await service.from("profiles").select("name").eq("id", owner).maybeSingle();
  const name = firstName(profile?.name);
  const observations: Observation[] = group.map((g) => gateInput(g).observation);
  const theme = d.variant === "new"
    ? ((group[0].observation as Row)?.theme as { label: string; statement: string; type: string } | null)
    : null;
  let about: { label: string; statement: string } | null = null;
  if (d.beliefId) {
    const { data: b } = await service.from("beliefs").select("label,statement").eq("id", d.beliefId)
      .maybeSingle();
    about = b ? { label: String(b.label), statement: String(b.statement) } : null;
  }
  const scope = await ownerScope(service, owner), ledger = new PostgresLedger(service, scope);
  const client = clientFor(ctx, ledger, "synthesise");
  const pkg = synthesisPackage(name, d, theme, observations, about);
  let exchange = await client.complete({
    purpose: "mirror_synthesise",
    system: MIRROR_SYNTHESISE,
    messages: [{ role: "user", content: pkg }],
    maxTokens: SYNTHESISE_MAX_TOKENS,
  });
  const exchanges = [exchange];
  let syn = exchange.error && !exchange.rawResponse ? null : readSynthesis(exchange.rawResponse);
  let problems = syn ? synthesisProblems(syn, name, observations) : [exchange.error ?? "unreadable"];
  if (problems.length && !(exchange.error && !exchange.rawResponse)) {
    exchange = await client.complete({
      purpose: "mirror_synthesise_repair",
      system: MIRROR_SYNTHESISE,
      maxTokens: SYNTHESISE_MAX_TOKENS,
      messages: [{ role: "user", content: pkg }, {
        role: "assistant",
        content: exchange.rawResponse || "(empty)",
      }, {
        role: "user",
        content: `That failed: ${
          problems.join("; ")
        }. Answer again with ONE JSON object in the same shape: a paraphrase in the second person, no quote, no name or relationship, no count, no banned word.`,
      }],
    });
    exchanges.push(exchange);
    syn = exchange.error && !exchange.rawResponse ? null : readSynthesis(exchange.rawResponse);
    problems = syn ? synthesisProblems(syn, name, observations) : [exchange.error ?? "unreadable"];
  }
  let ref: string | null = null;
  if (!syn || problems.length) {
    ref = await recordError(service, owner, "mirror/synthesise", "held", problems.join("; ")); // held unseen; the next contribution tries again
  }
  await trace(ctx, scope, ledger, exchanges, ref);
  if (!syn || problems.length) return null;
  const area = areaFor(syn.domains);
  const { data: row, error } = await service.from("outside_perspectives").insert({
    owner,
    label: syn.label,
    statement: syn.statement,
    summary: syn.summary,
    type: syn.type,
    kind: kindFor(syn.type),
    area,
    domains: syn.domains,
    people_count: d.people,
    moment_count: d.moments,
    variant: d.variant,
    theme_key: d.themeKey,
    about_belief_id: d.beliefId,
    belief_id: d.variant === "support" ? d.beliefId : null,
    status: d.variant === "support" ? "quiet" : "new",
    contribution_ids: d.contributionIds,
    from_sample: fromSample,
  }).select("*").single();
  if (error) dbError(error, "outside_perspectives.insert");
  await service.from("mirror_contributions").update({ status: "used", perspective_id: row.id }).in(
    "id",
    d.contributionIds,
  );
  if (d.variant === "support" && d.beliefId) {
    await service.from("beliefs").update({ seen_by_others: true }).eq("id", d.beliefId);
  }
  return row;
}

// ------------------------------------------------------------------ the preview sample (CONTRACT §3)

route("POST", "/preview/mirror-sample", async (ctx) => {
  const { service } = ctx;
  // Release build never reaches this, authenticated or not (CONTRACT.md's release switch); checked before
  // authenticate() so an unauthenticated caller on a release build still gets 404, not 401.
  if (ctx.env.releaseBuild) throw new ApiError("not_found", "", { path: "/preview/mirror-sample" });
  const caller = hooks.authenticate ? await hooks.authenticate(ctx) : await authenticate(ctx.env, ctx.req);
  if (!caller.isPreview) throw new ApiError("forbidden", "", { reason: "preview_only" });
  await requireAiConsent(ctx, {}, caller);
  const owner = caller.id;
  const b = await ctx.body();
  const cap = Number.isFinite(Number(b.cap_cents)) && Number(b.cap_cents) > 0
    ? Math.min(Number(b.cap_cents), 50)
    : SAMPLE_CAP_CENTS;
  const link = await ensureLink(service, owner);
  await service.from("mirror_links").update({ enabled: true, paused: false }).eq("id", link.id);
  // an earlier sample that the owner has not rated is replaced; what he rated stays his
  const { data: old } = await service.from("outside_perspectives").select("id,variant,belief_id").eq(
    "owner",
    owner,
  ).eq("from_sample", true).in("status", ["new", "quiet"]);
  for (const p of old ?? []) {
    if (p.variant === "support" && p.belief_id) {
      await service.from("beliefs").update({ seen_by_others: false }).eq("id", p.belief_id);
    }
  }
  if (old?.length) await service.from("outside_perspectives").delete().in("id", old.map((p) => p.id));
  // The example people's earlier sample moments go; a real contributor's never do.
  const { data: earlier } = await service.from("mirror_contributions").select("id,contributor_key").eq("link_id", link.id);
  const sampleIds = (earlier ?? []).filter((c) => String(c.contributor_key ?? "").startsWith("example:")).map((c) => c.id);
  if (sampleIds.length) await service.from("mirror_contributions").delete().in("id", sampleIds);
  const { data: profile } = await service.from("profiles").select("name").eq("id", owner).maybeSingle();
  const name = firstName(profile?.name);
  const { data: spend0 } = await service.rpc("ledger_snapshot");
  const before = Number((spend0 as Row)?.today_cents ?? 0); // today_cents already includes owner-preview spend
  const spent = async () => {
    const { data } = await service.rpc("ledger_snapshot");
    return Number((data as Row)?.today_cents ?? 0) - before;
  };
  const tally = { contributions: 0, moments: 0, asked_for_moment: 0, concern: 0, dropped: 0, held: 0 };
  let surfaced: Row[] = [];
  let stopped: string | null = null;
  for (const s of MIRROR_SAMPLE) {
    if ((await spent()) >= cap) {
      stopped = `cap ${cap}¢ reached`;
      break;
    }
    const { data: c, error } = await service.from("mirror_contributions").insert({
      link_id: link.id,
      owner,
      contributor_key: `example:${s.persona}`,
      contributor_name: s.name,
      how_known: s.how_known,
      moment: s.moment.replaceAll("{name}", name),
      status: "pending",
    }).select("*").single();
    if (error) dbError(error, "mirror_contributions.insert");
    tally.contributions++;
    const o = await processContribution(ctx, { ...link, enabled: true, paused: false }, c);
    if (o.state === "done") {
      tally.moments++;
      surfaced = surfaced.concat(await runGate(ctx, link, true));
    } else if (o.state === "ask_moment") tally.asked_for_moment++;
    else if (o.state === "concern") tally.concern++;
    else tally.dropped++;
  }
  const { count } = await service.from("mirror_contributions").select("id", { count: "exact", head: true })
    .eq("link_id", link.id).eq("status", "pending");
  tally.held = count ?? 0;
  const ids = surfaced.map((p) => p.id);
  const { data: fresh } = ids.length
    ? await service.from("outside_perspectives").select("*").in("id", ids).order("created_at")
    : { data: [] };
  return json({
    contributions: tally.contributions,
    processed: tally,
    surfaced: (fresh ?? []).filter((p) => p.status !== "quiet").map(perspectiveObject),
    seen_by_others: (fresh ?? []).filter((p) => p.status === "quiet").map((p) => ({
      belief_id: p.belief_id,
      people: p.people_count,
      moments: p.moment_count,
    })),
    spent_cents: await spent(),
    stopped,
    mirror: await mirrorObject(service, owner),
    ref: null,
  });
}, false);
