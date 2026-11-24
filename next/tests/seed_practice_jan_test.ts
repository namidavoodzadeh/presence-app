// E27 (4), CEO 09:55 PT 07 Nov: seed_practice_jan.ts seeds Jan's fictional map, the link and Jan's share for the owner, is
// idempotent, replaces a stale map of Jan's own, and never touches the owner's rows beyond the one link_prefs row for Jan.
// Proved against the in-memory fixture database only.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";
import { JAN, JAN_BELIEFS, JAN_SHARED_AREAS, janSharedBeliefs, seedPracticeJan } from "../scripts/seed_practice_jan.ts";
import { loadGolden } from "../evals/bridge_golden.ts";

const OWNER = "nami-owner-fixture", JAN_ID = "jan-fixture";

function seedTables(): FakeTables {
  return {
    profiles: [{ id: OWNER, name: "Nami", is_preview: true, is_example: false }, { id: JAN_ID }],
    beliefs: [{ id: "owner-b1", owner: OWNER, statement: "Part of you feels your needs come last.", status: "confirmed", area: "relationships" }],
    receipts: [{ id: "owner-r1", owner: OWNER, belief_id: "owner-b1", quote: "I go along with it." }],
    messages: [{ id: "owner-m1", owner: OWNER, text: "I go along with it." }],
    conversations: [{ id: "owner-c1", owner: OWNER, title: "Mine" }],
    belief_links: [],
    links: [],
    link_prefs: [{ owner: OWNER, other: "sam-fixture", relationship: "friend" }],
  };
}

const ownRows = (t: FakeTables) => JSON.stringify(["beliefs", "receipts", "messages", "conversations"].map((k) => t[k].filter((r) => r.owner === OWNER)));

Deno.test("seed_practice_jan: Jan's twelve fictional beliefs with one receipt each, the link, and Jan's own share of two areas", async () => {
  const t = seedTables();
  const before = ownRows(t);
  const r = await seedPracticeJan(fakeClient(t), OWNER, JAN_ID);
  assertEquals(r, { seeded: true, already: false, beliefs: 12, shared: 6 });
  const jan = t.profiles.find((p) => p.id === JAN_ID)!;
  assertEquals([jan.name, jan.is_example, jan.is_practice, jan.persona], [JAN.name, true, true, "jan"]);
  const beliefs = t.beliefs.filter((b) => b.owner === JAN_ID);
  assertEquals(beliefs.length, JAN_BELIEFS.length);
  assert(beliefs.every((b) => b.status === "confirmed"));
  const receipts = t.receipts.filter((x) => x.owner === JAN_ID);
  assertEquals(receipts.length, 12);
  // Law 2: every receipt is the text of a message Jan "said", tied to its belief.
  for (const x of receipts) {
    const m = t.messages.find((m) => m.id === x.message_id)!;
    assertEquals(m.text, x.quote);
    assert(beliefs.some((b) => b.id === x.belief_id));
  }
  assertEquals(t.links.map((l) => l.status), ["active"]);
  const theirs = t.link_prefs.find((p) => p.owner === JAN_ID && p.other === OWNER)!;
  // Law 10: Jan's consent is Jan's own row: share on, two areas, never quotes.
  assertEquals([theirs.share_on, [...theirs.share_areas as string[]].sort(), theirs.share_quotes], [true, [...JAN_SHARED_AREAS].sort(), false]);
  assertEquals(t.link_prefs.find((p) => p.owner === OWNER && p.other === JAN_ID)!.relationship, "partner");
  assertEquals(ownRows(t), before, "the owner's own map is untouched");
  assertEquals(t.link_prefs.find((p) => p.other === "sam-fixture")!.relationship, "friend");
});

Deno.test("seed_practice_jan: a second run does nothing; a stale map of Jan's own is replaced", async () => {
  const t = seedTables();
  const db = fakeClient(t);
  await seedPracticeJan(db, OWNER, JAN_ID);
  const counts = () => ["beliefs", "receipts", "messages", "conversations", "links", "link_prefs"].map((k) => t[k].length);
  const after = counts();
  assertEquals(await seedPracticeJan(db, OWNER, JAN_ID), { seeded: false, already: true, beliefs: 12, shared: 6 });
  assertEquals(counts(), after);

  t.beliefs.push({ id: "stale", owner: JAN_ID, statement: "An old line.", status: "confirmed", area: "work" });
  assertEquals((await seedPracticeJan(db, OWNER, JAN_ID)).seeded, true);
  assertEquals(t.beliefs.filter((b) => b.owner === JAN_ID).length, 12);
  assert(!t.beliefs.some((b) => b.id === "stale"));
  assertEquals(counts(), after);
});

Deno.test("seed_practice_jan: Jan shares the beliefs the golden owner draft lands on (g01), and nothing outside the two areas", async () => {
  const g01 = (await loadGolden()).cases.find((c) => c.id === "g01_travel_hate")!;
  for (const b of g01.receiver.shared) assert(janSharedBeliefs().includes(b.statement), b.statement);
  assertEquals(janSharedBeliefs().length, JAN_BELIEFS.filter((b) => (JAN_SHARED_AREAS as readonly string[]).includes(b.area)).length);
});
