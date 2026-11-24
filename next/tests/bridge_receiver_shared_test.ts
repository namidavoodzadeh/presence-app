// Pair context is the only cross-person read. A fake Supabase stands in; never hosted.
import { assertEquals } from "jsr:@std/assert@1";
import { loadPairContext } from "../api/pair_context.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const OWNER = "owner-1", JAN = "jan-1";
function tables(over: Partial<{ practice: boolean; shareOn: boolean; areas: string[] }> = {}): FakeTables {
  const { practice = false, shareOn = true, areas = ["relationships", "family"] } = over;
  return {
    profiles: [{ id: JAN, is_practice: practice }, { id: OWNER, is_practice: false }],
    link_prefs: [{ owner: JAN, other: OWNER, share_on: shareOn, share_areas: areas }, { owner: OWNER, other: JAN, share_on: false, share_areas: [] }],
    beliefs: [
      { id: "b1", owner: JAN, label: "Direct asks", statement: "Being asked directly matters to me more than hints.", area: "relationships", status: "confirmed", created_at: "2026-11-01" },
      { id: "b2", owner: JAN, label: "Early word", statement: "When plans change I need to hear it early.", area: "family", status: "confirmed", created_at: "2026-11-02" },
      { id: "b3", owner: JAN, label: "Money worry", statement: "Part of me worries money will run out.", area: "money", status: "confirmed", created_at: "2026-11-03" },
      { id: "b4", owner: JAN, label: "Not sure", statement: "An inferred one.", area: "relationships", status: "inferred", created_at: "2026-11-04" },
      { id: "o1", owner: OWNER, label: "Mine", statement: "The owner's own.", area: "relationships", status: "confirmed", created_at: "2026-11-01" },
    ],
  };
}

Deno.test("pair context: area shares alone never cross the pair boundary", async () => {
  const got = await loadPairContext(fakeClient(tables()), OWNER, JAN);
  assertEquals(got.receiver?.items, []);
  assertEquals(got.receiver?.areaShare, null);
});
