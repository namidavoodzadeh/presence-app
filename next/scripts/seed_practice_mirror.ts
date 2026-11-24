// E24 (B) step 1 (COO 2026-11-06 17:15 Tehran): the owner-only practice Mirror, seeded idempotently.
// Gives Nami's real account one outside-perspective card from three of the already-seeded example people (lea, sam, mom; the
// same practice-partner cast check_mirror.ts already drives), entirely through canned, recorded model replies: never a live
// model call, so this never costs anything and never varies. Safe to run more than once: it checks first, and does nothing if
// the practice card is already there. Per Q9 (ANSWERS, COO 17:15): write this against the TEST database only. Do not point it
// at hosted until the COO says so.
//   deno run --allow-net --allow-read --allow-env next/scripts/seed_practice_mirror.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { routes } from "../api/lib/router.ts";
import { contributorKey, hooks } from "../api/mirror.ts";
import { RecordedClient } from "../engine/model/client.ts";
import { IMPORT_PREVIEW_OWNER_ID } from "../api/lib/env.ts";

type Row = Record<string, unknown>;

/** The example cast already seeded for the practice-partner pattern (check_mirror.ts, migration 0028): three distinct people
 *  whose moments converge on one theme, so the gate (law 12: never from one person) genuinely opens. */
export const PRACTICE_MIRROR_CONTRIBUTORS = [
  {
    persona: "lea",
    howKnown: "partner",
    moment:
      "We had friends coming for dinner and one couple cancelled an hour before. Nami went quiet, kept cooking, and said it was fine.",
  },
  {
    persona: "mom",
    howKnown: "family",
    moment:
      "At my birthday lunch his brother changed the restaurant at the last minute. Nami went very quiet in the car.",
  },
  {
    persona: "sam",
    howKnown: "friend",
    moment:
      "I moved our hike the night before. He said sure, no problem, but then he was short and quiet all day.",
  },
] as const;

const observeReply = (themeKey: string | null, behaviour: string) =>
  JSON.stringify({
    kind: "moment",
    safety: { level: "none", reason: "" },
    observation: {
      situation: "a plan changed at the last minute",
      behaviour,
      reaction: "the evening went quiet",
      guess: null,
      domains: ["close_relationships"],
    },
    theme: {
      key: themeKey,
      label: "Goes quiet",
      statement: "Part of you may go quiet when a plan changes on you.",
      type: "how I tend to react",
      confidence: 0.85,
    },
    map: { belief_id: null, relation: null, confidence: 0 },
  });

const CARD_REPLY = JSON.stringify({
  label: "Goes quiet",
  statement: "People who know you describe you going quiet when a plan changes on you at the last minute.",
  type: "something I do to cope",
  domains: ["close_relationships"],
  summary:
    "People who know you describe the same shape: a plan moves late, you say it's fine, and then you go quiet for the rest of the evening.",
});

export interface SeedResult {
  seeded: boolean;
  already: boolean;
  perspective_id: string | null;
  reason?: string;
}

function contributionsHandler() {
  const r = routes.find((x) => x.method === "POST" && x.pattern.test("/m/seedslug/contributions"));
  if (!r) throw new Error("POST /m/:slug/contributions is not registered (import mirror.ts first)");
  return r.handler;
}

function ctxFor(slug: string, service: SupabaseClient, body: Row) {
  return {
    env: {} as never,
    req: new Request(`https://presence.invalid/m/${slug}/contributions`, { method: "POST" }),
    url: new URL(`https://presence.invalid/m/${slug}/contributions`),
    params: { slug },
    caller: null,
    service,
    tz: "UTC",
    body: () => Promise.resolve(body),
  } as never;
}

/** Idempotent: safe to run more than once. Leaves everything as it found it if the practice card already exists. */
export async function seedPracticeMirror(service: SupabaseClient, owner: string): Promise<SeedResult> {
  const examples: Record<string, Row> = {};
  for (const c of PRACTICE_MIRROR_CONTRIBUTORS) {
    const { data } = await service.from("profiles").select("id,persona,is_example").eq("persona", c.persona)
      .eq(
        "is_example",
        true,
      ).maybeSingle();
    if (!data) {
      return {
        seeded: false,
        already: false,
        perspective_id: null,
        reason: `no example profile for persona '${c.persona}'`,
      };
    }
    examples[c.persona] = data;
  }

  let { data: link } = await service.from("mirror_links").select("*").eq("owner", owner).maybeSingle();
  if (!link) {
    const { data: made, error } = await service.from("mirror_links").insert({
      owner,
      slug: "seedslug",
      enabled: true,
      paused: false,
      who: "anyone",
    }).select("*").single();
    if (error) throw new Error(`mirror_links insert: ${error.message}`);
    link = made;
  }
  const slug = String(link!.slug);

  const keys = await Promise.all(
    PRACTICE_MIRROR_CONTRIBUTORS.map((c) => contributorKey(owner, String(examples[c.persona].id))),
  );
  const { data: already } = await service.from("mirror_contributions").select("contributor_key,status").eq(
    "link_id",
    link!.id,
  ).eq("status", "used").in("contributor_key", keys);
  if ((already ?? []).length >= 3) {
    const { data: existing } = await service.from("outside_perspectives").select("id").eq("owner", owner).eq(
      "label",
      "Goes quiet",
    ).maybeSingle();
    return { seeded: false, already: true, perspective_id: existing ? String(existing.id) : null };
  }

  const handler = contributionsHandler();
  let themeKey: string | null = null;
  let perspectiveId: string | null = null;
  for (let i = 0; i < PRACTICE_MIRROR_CONTRIBUTORS.length; i++) {
    const c = PRACTICE_MIRROR_CONTRIBUTORS[i];
    const last = i === PRACTICE_MIRROR_CONTRIBUTORS.length - 1;
    hooks.client = () =>
      new RecordedClient(
        last
          ? { mirror_observe: [observeReply(themeKey, c.moment.slice(-30))], mirror_synthesise: [CARD_REPLY] }
          : { mirror_observe: [observeReply(themeKey, c.moment.slice(-30))] },
      );
    const res = await handler(
      ctxFor(slug, service, { test_friend: c.persona, how_known: c.howKnown, moment: c.moment }),
    );
    const body = await res.json();
    if (body.state !== "done") {
      throw new Error(`seeding contribution for ${c.persona} failed: ${JSON.stringify(body)}`);
    }
    if (!themeKey) {
      const { data: stored } = await service.from("mirror_contributions").select("theme_key").eq(
        "link_id",
        link!.id,
      ).eq("status", "pending").not("theme_key", "is", null).order("created_at").limit(1).maybeSingle();
      themeKey = stored?.theme_key ? String(stored.theme_key) : null;
    }
    if (last) {
      const { data: card } = await service.from("outside_perspectives").select("id").eq("owner", owner).eq(
        "label",
        "Goes quiet",
      ).maybeSingle();
      perspectiveId = card ? String(card.id) : null;
    }
  }
  hooks.client = null;
  return { seeded: true, already: false, perspective_id: perspectiveId };
}

if (import.meta.main) {
  console.log(
    `This script seeds a canned practice Mirror card for the owner account (${IMPORT_PREVIEW_OWNER_ID}) and is\n` +
      "written against the test database only. It is not wired to connect to hosted here (Q9, ANSWERS, COO 17:15):\n" +
      "no hosted call is made until the COO says so.",
  );
  Deno.exit(1);
}
