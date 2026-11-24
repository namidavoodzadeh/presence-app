// E24 (B) step 1 (COO 2026-11-06 17:15 Tehran): seed_practice_mirror.ts must be idempotent and must never touch hosted on
// its own. Both proved against the in-memory fixture database only.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { hooks } from "../api/mirror.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";
import { PRACTICE_MIRROR_CONTRIBUTORS, seedPracticeMirror } from "../scripts/seed_practice_mirror.ts";

const OWNER = "nami-owner-fixture";

function seedTables(): FakeTables {
  return {
    mirror_links: [],
    profiles: [
      { id: OWNER, name: "Nami", is_preview: true, is_example: false },
      { id: "lea-fixture", name: "Lea", is_example: true, persona: "lea" },
      { id: "sam-fixture", name: "Sam", is_example: true, persona: "sam" },
      { id: "mom-fixture", name: "Mom", is_example: true, persona: "mom" },
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

Deno.test("seed_practice_mirror: names the same three example people as the practice-partner cast", () => {
  assertEquals(PRACTICE_MIRROR_CONTRIBUTORS.map((c) => c.persona), ["lea", "mom", "sam"]);
});

Deno.test("seed_practice_mirror: seeds one card from three distinct example people, then does nothing the second time", async () => {
  const tables = seedTables();
  const service = fakeClient(tables);

  const first = await seedPracticeMirror(service, OWNER);
  hooks.client = null;
  assertEquals(first, { seeded: true, already: false, perspective_id: first.perspective_id });
  assert(first.perspective_id, "a perspective id came back");
  assertEquals(tables.outside_perspectives.length, 1, "exactly one practice card");
  assertEquals(tables.outside_perspectives[0].people_count, 3);
  assertEquals(tables.mirror_links.length, 1, "exactly one link created, not re-created");

  const linksAfterFirst = tables.mirror_links.length;
  const contributionsAfterFirst = tables.mirror_contributions.length;

  const second = await seedPracticeMirror(service, OWNER);
  hooks.client = null;
  assertEquals(second, { seeded: false, already: true, perspective_id: second.perspective_id });
  assertEquals(tables.outside_perspectives.length, 1, "running it again never makes a second card");
  assertEquals(tables.mirror_links.length, linksAfterFirst, "no duplicate link on the second run");
  assertEquals(
    tables.mirror_contributions.length,
    contributionsAfterFirst,
    "no new contribution rows on the second run",
  );
});

Deno.test("seed_practice_mirror: without the example people seeded, it reports why instead of guessing", async () => {
  const tables = seedTables();
  tables.profiles = tables.profiles.filter((p) => p.persona !== "mom");
  const service = fakeClient(tables);
  const result = await seedPracticeMirror(service, OWNER);
  hooks.client = null;
  assertEquals(result.seeded, false);
  assertEquals(result.already, false);
  assert(result.reason?.includes("mom"));
  assertEquals(tables.outside_perspectives.length, 0);
  assertEquals(tables.mirror_links.length, 0, "nothing created when the cast is incomplete");
});
