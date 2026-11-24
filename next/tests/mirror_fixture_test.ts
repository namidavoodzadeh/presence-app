// E24 (B) step 1 (COO 2026-11-06 17:15 Tehran): the fixture-first proof, before Mirror ever touches Nami's real account.
// Seeds Nami-shaped fixture data (an owner link, no beliefs of his own yet) plus three fictional contributors, drives the real
// POST /m/:slug/contributions route (same code path the web page calls) with a recorded model client ($0, no live call) against
// an in-memory fixture database (never hosted), and checks the result against law 12: the card that reaches the owner is never
// raw (no moment text anywhere), never named (no contributor name or key survives into the card), and never from one person (the
// gate holds until a third distinct contributor converges on the same theme).

import { assert, assertEquals } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import { hooks } from "../api/mirror.ts";
import "../api/mirror.ts";
import { RecordedClient } from "../engine/model/client.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

type Tables = FakeTables;

function contributionsHandler() {
  const r = routes.find((x) => x.method === "POST" && x.pattern.test("/m/slug1/contributions"));
  assert(r, "POST /m/:slug/contributions is registered");
  return r.handler;
}

function ctxFor(tables: Tables, body: Record<string, unknown>) {
  const service = fakeClient(tables);
  return {
    env: {} as never,
    req: new Request("https://presence.invalid/m/slug1/contributions", { method: "POST" }),
    url: new URL("https://presence.invalid/m/slug1/contributions"),
    params: { slug: "slug1" },
    caller: null,
    service,
    tz: "UTC",
    body: () => Promise.resolve(body),
  } as never;
}

const OWNER = "nami-fixture-owner";

function seedTables(): Tables {
  return {
    mirror_links: [{
      id: "link-fixture-1",
      owner: OWNER,
      slug: "slug1",
      enabled: true,
      paused: false,
      who: "anyone",
    }],
    profiles: [
      { id: OWNER, name: "Nami", is_preview: true, is_example: false },
      { id: "lea-fixture", name: "Lea", is_preview: false, is_example: true, persona: "lea" },
      { id: "sam-fixture", name: "Sam", is_preview: false, is_example: true, persona: "sam" },
      { id: "mom-fixture", name: "Mom", is_preview: false, is_example: true, persona: "mom" },
    ],
    beliefs: [],
    receipts: [],
    belief_links: [],
    consent: [],
    mirror_contributions: [],
    mirror_approvals: [],
    outside_perspectives: [],
    engine_calls: [],
  };
}

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

const cardReply = JSON.stringify({
  label: "Goes quiet",
  statement: "People who know you describe you going quiet when a plan changes on you at the last minute.",
  type: "something I do to cope",
  domains: ["close_relationships"],
  summary:
    "People who know you describe the same shape: a plan moves late, you say it's fine, and then you go quiet for the rest of the evening.",
});

async function submit(tables: Tables, who: string, howKnown: string, moment: string) {
  const handler = contributionsHandler();
  const res = await handler(ctxFor(tables, { test_friend: who, how_known: howKnown, moment }));
  const json = await res.json();
  return { status: res.status, json };
}

Deno.test("E24 (B) step 1: Nami's own entry, with no outside contributor, yields nothing (law 12, never from one person)", async () => {
  const tables = seedTables();
  // Nami-shaped fixture: his own map has nothing of its own yet; a single fictional contributor is not enough on its own.
  hooks.client = () =>
    new RecordedClient({ mirror_observe: [observeReply(null, "went quiet and kept cooking")] });
  const r1 = await submit(
    tables,
    "lea",
    "partner",
    "We had friends coming for dinner and one couple cancelled an hour before. Nami went quiet, kept cooking, and said it was fine.",
  );
  assertEquals(r1.json.state, "done");
  assertEquals(tables.outside_perspectives.length, 0, "one contributor alone never surfaces a card");
  hooks.client = null;
});

Deno.test("E24 (B) step 1: three fictional contributors converge on one theme; the owner's card is never raw, never named, never from one person", async () => {
  const tables = seedTables();

  hooks.client = () =>
    new RecordedClient({ mirror_observe: [observeReply(null, "went quiet and kept cooking")] });
  const r1 = await submit(
    tables,
    "lea",
    "partner",
    "We had friends coming for dinner and one couple cancelled an hour before. Nami went quiet, kept cooking, and said it was fine.",
  );
  assertEquals(r1.json.state, "done");
  assertEquals(tables.outside_perspectives.length, 0, "one person: still nothing");

  const stored = tables.mirror_contributions.find((c) => c.status === "pending" && c.theme_key);
  assert(stored, "the first contribution's theme key was stored, de-identified");
  const themeKey = String(stored!.theme_key);
  assert(
    !JSON.stringify(stored).includes("cancelled an hour before"),
    "the raw moment never survives processing",
  );
  assertEquals(stored!.moment, null);

  hooks.client = () =>
    new RecordedClient({ mirror_observe: [observeReply(themeKey, "went very quiet in the car")] });
  const r2 = await submit(
    tables,
    "mom",
    "family",
    "At my birthday lunch his brother changed the restaurant at the last minute. Nami went very quiet in the car.",
  );
  assertEquals(r2.json.state, "done");
  assertEquals(
    tables.outside_perspectives.length,
    0,
    "two people: the gate still holds (needs three, law 12)",
  );

  hooks.client = () =>
    new RecordedClient({
      mirror_observe: [observeReply(themeKey, "was short and quiet all day")],
      mirror_synthesise: [cardReply],
    });
  const r3 = await submit(
    tables,
    "sam",
    "friend",
    "I moved our hike the night before. He said sure, no problem, but then he was short and quiet all day.",
  );
  assertEquals(r3.json.state, "done");
  hooks.client = null;

  assertEquals(
    tables.outside_perspectives.length,
    1,
    "three distinct people: the card surfaces, exactly once",
  );
  const card = tables.outside_perspectives[0];
  assertEquals(card.owner, OWNER);
  assertEquals(card.people_count, 3);
  assertEquals(card.moment_count, 3);
  assertEquals(card.label, "Goes quiet");

  const serialized = JSON.stringify(card);
  // never raw: none of the contributors' own words survive into the card
  for (const phrase of ["cancelled an hour before", "birthday lunch", "moved our hike"]) {
    assert(!serialized.includes(phrase), `card must not carry the raw words: ${phrase}`);
  }
  // never named: no contributor's name, persona, or hashed key appears on the card
  for (const name of ["Lea", "Mom", "Sam", "lea-fixture", "sam-fixture", "mom-fixture"]) {
    assert(!serialized.includes(name), `card must not name a contributor: ${name}`);
  }
  // never from one person: the gate's own three-person floor is what let this card through
  assert(card.people_count as number >= 3);

  const used = tables.mirror_contributions.filter((c) => c.theme_key === themeKey);
  assertEquals(used.length, 3);
  assert(used.every((c) => c.status === "used"), "all three moments are marked used, none left waiting");
  assert(
    used.every((c) => c.moment === null),
    "no raw moment text remains stored anywhere, even after the card surfaced",
  );
});
