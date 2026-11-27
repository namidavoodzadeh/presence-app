// #54: the shared fake answers db.rpc(name, args) from the scenario fixture (`tables.__rpc`), falls back to the
// ledger stub when the fixture gives no reply, and supports PostgREST `.or()` filter text.

import { assertEquals } from "jsr:@std/assert@1";
import { fakeClient } from "./fake_supabase.ts";
import type { FakeTables } from "./fake_supabase.ts";

Deno.test("a scenario gives each database function its own reply", async () => {
  const seen: Record<string, unknown> = {};
  const tables = {
    __rpc: {
      receiver_bridges: [{ id: "b1", sender: "p2" }],
      accept_invite: { person: { id: "p2", name: "Sam" }, link_id: "l1" },
      open_bridge: (args: Record<string, unknown> | undefined) => {
        seen.open_bridge = args;
        return { id: args?.p_id, final: "Hello" };
      },
      register_apns_device: { id: "d1", token: "abc" },
      delete_account: null,
    },
  } as unknown as FakeTables;
  const db = fakeClient(tables);

  assertEquals((await db.rpc("receiver_bridges", { p_me: "p1" })).data, [{ id: "b1", sender: "p2" }]);
  assertEquals((await db.rpc("accept_invite", { p_code: "ABC" })).data, {
    person: { id: "p2", name: "Sam" },
    link_id: "l1",
  });
  assertEquals((await db.rpc("open_bridge", { p_id: "b9" })).data, { id: "b9", final: "Hello" });
  assertEquals(seen.open_bridge, { p_id: "b9" });
  assertEquals((await db.rpc("register_apns_device", { p_token: "abc" })).data, { id: "d1", token: "abc" });
  const deleted = await db.rpc("delete_account", { p_id: "p1" });
  assertEquals(deleted.data, null);
  assertEquals(deleted.error, null);
});

Deno.test("a one-element __rpc array, typed as rows, also carries the replies", async () => {
  const db = fakeClient({ __rpc: [{ receiver_bridges: [] }] });
  assertEquals((await db.rpc("receiver_bridges", {})).data, []);
});

Deno.test("a function with no fixture reply still answers with the ledger stub", async () => {
  const db = fakeClient({ __rpc: [{ receiver_bridges: [] }] });
  assertEquals((await db.rpc("record_spend", {})).data, { ok: true, id: "ledger-row" });
  assertEquals((await fakeClient({}).rpc("open_bridge", { p_id: "x" })).data, { ok: true, id: "ledger-row" });
});

Deno.test(".or() matches PostgREST filter text, including nested and()", async () => {
  const tables: FakeTables = {
    links: [
      { id: "l1", person_a: "p1", person_b: "p2" },
      { id: "l2", person_a: "p3", person_b: "p1" },
      { id: "l3", person_a: "p3", person_b: "p4" },
    ],
  };
  const db = fakeClient(tables);
  const either = await db.from("links").select("*").or("person_a.eq.p1,person_b.eq.p1").order("id");
  assertEquals((either.data ?? []).map((r) => r.id), ["l1", "l2"]);
  const pair = await db.from("links").select("*").or(
    "and(person_a.eq.p3,person_b.eq.p1),and(person_a.eq.p1,person_b.eq.p3)",
  );
  assertEquals((pair.data ?? []).map((r) => r.id), ["l2"]);
  const inList = await db.from("links").select("*").or("person_a.in.(p1,p4),person_b.in.(p4)").order("id");
  assertEquals((inList.data ?? []).map((r) => r.id), ["l1", "l3"]);
});
