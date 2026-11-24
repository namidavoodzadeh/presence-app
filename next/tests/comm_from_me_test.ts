// v1.91, app Q-APP-P4-1 (2): the Bridge insight reply carries `from_me` (one of the sender's own How I mean things items) when the receiver shared nothing. $0, no model.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { withFromMe } from "../api/bridge_engine.ts";
import { contentWords, pickFromMe } from "../engine/comm_fit.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const ME = "00000000-0000-4000-8000-0000000000a1", JAN = "00000000-0000-4000-8000-0000000000a2";
type Row = Record<string, unknown>;
const item = (id: string, wording: string, extra: Row = {}): Row => ({ id, owner: ME, status: "confirmed", comm_kind: "how_i_mean", comm_status: "active", comm_expires_at: null, own_wording: wording, statement: wording, confirmed_at: "2026-11-01T00:00:00Z", ...extra });
const ctxOf = (t: FakeTables, env: Row = { commItems: true, commOwnerIds: [ME] }, who = ME) => ({ env, caller: { id: who, db: fakeClient(t) } }) as never;
const reply = { seq: 2, state: "insight", spans: [], points: [], line: null };

Deno.test("fit: shared content words only; stop words and short words never match; a tie goes to the newer item", () => {
  assertEquals([...contentWords("When I go quiet, I'm thinking.")].sort(), ["quiet", "thinking"]);
  const a = { id: "a", wording: "When I go quiet, I'm thinking.", datedAt: "2026-01-01" };
  const b = { id: "b", wording: "A quiet evening helps me think.", datedAt: "2026-02-01" };
  assertEquals(pickFromMe("Why are you so quiet lately?", [a, b])?.id, "b", "tie on one word: newer");
  assertEquals(pickFromMe("You are quiet and thinking about something", [a, b])?.id, "a", "two shared words beat one");
  assertEquals(pickFromMe("What time is dinner?", [a, b]), null);
  assertEquals(pickFromMe("with that when this", [a, b]), null, "stop words alone fit nothing");
  assertEquals(pickFromMe("", [a]), null);
});

Deno.test("from_me: the sender's own fitting item, shared or not, at most one; id and wording only", async () => {
  const t: FakeTables = { beliefs: [
    item("a", "When I go quiet, I'm thinking.", { comm_status: "private_only" }),
    item("b", "I like to be asked about plans early.", { confirmed_at: "2026-11-05T00:00:00Z" }),
  ] };
  const r = await withFromMe(ctxOf(t), { ...reply }, "Why are you so quiet today?", true);
  assertEquals(r.from_me, { item_id: "a", wording: "When I go quiet, I'm thinking." });
  assertEquals(Object.keys(r.from_me as object).sort(), ["item_id", "wording"]);
  assertEquals({ ...r, from_me: undefined }, { ...reply, from_me: undefined }, "nothing else in the reply changes");
  assertEquals((await withFromMe(ctxOf(t), { ...reply }, "What time is dinner?", true)).from_me, null, "no fit, no item");
});

Deno.test("from_me: null when the receiver shared something; never another kind, set-aside, expired, deleted or someone else's item", async () => {
  const t: FakeTables = { beliefs: [
    item("a", "When I go quiet, I'm thinking.", { comm_status: "set_aside" }),
    item("b", "When I go quiet, I'm thinking.", { comm_kind: "gets_heated" }),
    item("c", "When I go quiet, I'm thinking.", { comm_kind: "this_week", comm_expires_at: "2020-01-01T00:00:00Z" }),
    item("d", "When I go quiet, I'm thinking.", { status: "deleted" }),
    item("e", "When I go quiet, I'm thinking.", { owner: JAN }),
    item("f", "When I go quiet, I'm thinking.", { comm_kind: null }),
  ] };
  assertEquals((await withFromMe(ctxOf(t), { ...reply }, "Why are you so quiet?", true)).from_me, null);
  t.beliefs.push(item("g", "When I go quiet, I'm thinking."));
  assertEquals(((await withFromMe(ctxOf(t), { ...reply }, "Why are you so quiet?", true)).from_me as Row).item_id, "g");
  assertEquals((await withFromMe(ctxOf(t), { ...reply }, "Why are you so quiet?", false)).from_me, null, "the receiver shared something: Bridge uses theirs, not this");
});

Deno.test("from_me: absent unless the owner switch is on for the caller, and never on a safety, declined or unavailable reply", async () => {
  const t: FakeTables = { beliefs: [item("a", "When I go quiet, I'm thinking.")] };
  const draft = "Why are you so quiet?";
  for (const [env, who] of [[{}, ME], [{ commItems: false, commOwnerIds: [ME] }, ME], [{ commItems: true, commOwnerIds: [ME] }, JAN]] as [Row, string][]) {
    const r = await withFromMe(ctxOf(t, env, who), { ...reply }, draft, true);
    assert(!("from_me" in r), "reply is byte for byte as before");
  }
  for (const state of ["risk", "declined", "unavailable"]) {
    const r = await withFromMe(ctxOf(t), { ...reply, state }, draft, true);
    assert(!("from_me" in r), state);
  }
});
