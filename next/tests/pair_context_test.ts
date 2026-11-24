import { assert, assertEquals } from "jsr:@std/assert@1";
import { loadPairContext, softeningItems } from "../api/pair_context.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const A = "00000000-0000-4000-8000-0000000000a1",
  B = "00000000-0000-4000-8000-0000000000b2",
  C = "00000000-0000-4000-8000-0000000000c3";
const future = "2099-01-01T00:00:00.000Z", past = "2000-01-01T00:00:00.000Z";
function tables(): FakeTables {
  return {
    profiles: [{ id: A, name: "Ari Sender" }, { id: B, name: "Bea Receiver" }],
    links: [{ person_a: A, person_b: B, status: "active" }],
    link_prefs: [{ owner: A, other: B, relationship: "friend" }],
    share_items: [
      { owner: B, other: A, belief_id: "open", wording: "Say it plainly" },
      { owner: B, other: A, belief_id: "wrong-scope", wording: "Must stay hidden" },
      { owner: B, other: A, belief_id: "expired", wording: "Expired words" },
      { owner: B, other: A, belief_id: "lands", wording: "No sarcasm" },
    ],
    beliefs: [
      {
        id: "open",
        owner: B,
        status: "confirmed",
        rating: "very",
        statement: "private",
        confidence: .9,
        comm_kind: "bring_up",
        comm_status: "active",
        comm_scope_type: "everyone",
        comm_scope_value: null,
      },
      {
        id: "wrong-scope",
        owner: B,
        status: "confirmed",
        rating: "very",
        statement: "private",
        confidence: .9,
        comm_kind: "bring_up",
        comm_status: "active",
        comm_scope_type: "person",
        comm_scope_value: C,
      },
      {
        id: "expired",
        owner: B,
        status: "confirmed",
        rating: "very",
        statement: "private",
        confidence: .9,
        comm_kind: "this_week",
        comm_status: "active",
        comm_scope_type: "everyone",
        comm_scope_value: null,
        comm_expires_at: past,
      },
      {
        id: "lands",
        owner: B,
        status: "confirmed",
        rating: "very",
        statement: "private",
        confidence: .9,
        comm_kind: "lands_hard",
        comm_status: "active",
        comm_scope_type: "everyone",
        comm_scope_value: null,
        comm_expires_at: future,
      },
      {
        id: "private",
        owner: B,
        status: "confirmed",
        rating: "very",
        statement: "never leak",
        confidence: 1,
        comm_kind: "how_i_mean",
        comm_status: "active",
        comm_scope_type: "everyone",
        comm_scope_value: null,
      },
      {
        id: "set-aside",
        owner: B,
        status: "confirmed",
        rating: "very",
        statement: "never leak",
        confidence: 1,
        comm_kind: "how_i_mean",
        comm_status: "set_aside",
        comm_scope_type: "everyone",
        comm_scope_value: null,
      },
    ],
  };
}

Deno.test("pair context privacy: scope, active status, and softening-only items apply", async () => {
  const ctx = await loadPairContext(fakeClient(tables()), A, B);
  assertEquals(ctx.receiver?.items.map((x) => x.id).sort(), ["open"]);
});

Deno.test("pair context privacy: This week expires", async () => {
  const t = tables();
  (t.beliefs ?? []).find((x) => x.id === "expired")!.comm_expires_at = future;
  const live = await loadPairContext(fakeClient(t), A, B);
  assertEquals(live.receiver?.thisWeek.map((x) => x.id), ["expired"]);
  (t.beliefs ?? []).find((x) => x.id === "expired")!.comm_expires_at = past;
  assertEquals((await loadPairContext(fakeClient(t), A, B)).receiver?.thisWeek, []);
});

Deno.test("pair context privacy: a grant never widens a person scope", async () => {
  const t = tables();
  (t.beliefs ?? []).find((x) => x.id === "wrong-scope")!.comm_scope_value = A;
  assert((await loadPairContext(fakeClient(t), A, B)).receiver?.items.some((x) => x.id === "wrong-scope"));
  (t.beliefs ?? []).find((x) => x.id === "wrong-scope")!.comm_scope_value = C;
  assert(!(await loadPairContext(fakeClient(t), A, B)).receiver?.items.some((x) => x.id === "wrong-scope"));
});

Deno.test("pair context privacy: What lands hard is returned only by softeningItems", async () => {
  const ctx = await loadPairContext(fakeClient(tables()), A, B);
  assertEquals(ctx.receiver?.items.some((x) => x.id === "lands"), false);
  assertEquals(softeningItems(ctx.receiver!.softeningOnly), [{
      id: "lands",
      kind: "lands_hard",
      words: "No sarcasm",
      when: null,
      scope: { type: "everyone", value: null },
      strength: .9,
      confirmedAt: null,
    }]);
});

Deno.test("pair context: sender items require active communication status", async () => {
  const t = tables();
  (t.beliefs ?? []).push({
    id: "mine-inactive",
    owner: A,
    status: "confirmed",
    rating: "very",
    statement: "No longer use this",
    comm_kind: "how_i_mean",
    comm_status: "set_aside",
  });
  (t.beliefs ?? []).push({
    id: "mine-active",
    owner: A,
    status: "confirmed",
    rating: "very",
    statement: "Use this",
    comm_kind: "how_i_mean",
    comm_status: "active",
  });
  const ctx = await loadPairContext(fakeClient(t), A, B);
  assertEquals(ctx.sender.itemsByKind.how_i_mean?.map((x) => x.id), ["mine-active"]);
});

Deno.test("pair context privacy: a service read never returns an unshared item", async () => {
  const t = tables(), service = fakeClient(t);
  const ctx = await loadPairContext(fakeClient(t), A, B, service);
  assert(!ctx.receiver?.items.some((x) => x.id === "private" || x.id === "set-aside"));
});
