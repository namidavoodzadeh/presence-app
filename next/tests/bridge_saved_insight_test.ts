// QA-B240: an unchanged analysed draft returns its saved insight; a changed draft, map, mode or `refresh` recomputes. $0.

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { drainAfterReply, insightKey, requireOnlyInsightFields, saveInsightAfterReply, savedInsight } from "../api/bridge_engine.ts";
import type { Belief } from "../engine/types.ts";

const belief = (id: string, status = "endorsed", statement = "Part of you feels it is on you."): Belief =>
  ({ id, label: "On me", statement, type: "core", level: "foundation", domains: [], confidence: 0.8, receipts: [], links: [], status } as unknown as Belief);

Deno.test("insightKey: same draft + map + mode is stable; any change to text, relationship, mode or a belief changes it", async () => {
  const base = await insightKey("hello there", "partner", [belief("a"), belief("b")], false);
  assertEquals(await insightKey("hello there", "partner", [belief("b"), belief("a")], false), base, "belief order does not matter");
  for (const other of [
    await insightKey("hello there!", "partner", [belief("a"), belief("b")], false),
    await insightKey("hello there", "friend", [belief("a"), belief("b")], false),
    await insightKey("hello there", "partner", [belief("a"), belief("b")], true),
    await insightKey("hello there", "partner", [belief("a"), belief("b", "disputed")], false),
    await insightKey("hello there", "partner", [belief("a"), belief("b", "endorsed", "Part of you feels differently.")], false),
    await insightKey("hello there", "partner", [belief("a")], false),
  ]) assert(other !== base);
});

function dbReturning(row: Record<string, unknown> | null, updates: Record<string, unknown>[] = []) {
  const q = (filters: Record<string, unknown> = {}, rec: Record<string, unknown> | null = null): Record<string, unknown> => ({
    select: () => q(filters, rec), eq: (c: string, v: unknown) => { filters[c] = v; return q(filters, rec); },
    maybeSingle: () => Promise.resolve({ data: row }),
    update: (patch: Record<string, unknown>) => { const r = { patch, filters }; updates.push(r); return q(filters, r); },
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
  });
  return { from: () => q() } as never;
}

Deno.test("savedInsight returns the saved reply with the caller's seq when the key matches, and nothing otherwise", async () => {
  const stored = { seq: 1, state: "insight", spans: [], points: [], line: null };
  const row = { insight: stored, insight_key: "k1" };
  assertEquals(await savedInsight(dbReturning(row), "o", "p", "k1", 7), { ...stored, seq: 7, saved: true });
  assertEquals(await savedInsight(dbReturning(row), "o", "p", "k2", 7), null, "changed draft or map");
  assertEquals(await savedInsight(dbReturning(null), "o", "p", "k1", 7), null, "no draft row");
  assertEquals(await savedInsight(dbReturning({ insight: { ...stored, state: "risk" }, insight_key: "k1" }), "o", "p", "k1", 7), null, "a stop is never served from the cache");
});

Deno.test("saveInsightAfterReply saves only an insight reply, only onto the row that still holds this text, without seq", async () => {
  const updates: Record<string, unknown>[] = [];
  const ctx = { service: dbReturning(null, updates) } as never;
  saveInsightAfterReply(ctx, "o", "p", "the text", "k", { seq: 3, saved: true, state: "insight", spans: [] });
  saveInsightAfterReply(ctx, "o", "p", "the text", "k", { seq: 3, state: "risk" });
  saveInsightAfterReply(ctx, "o", "p", "the text", "k", { seq: 3, state: "unavailable" });
  saveInsightAfterReply(ctx, "o", "p", "the text", "k", { seq: 3, state: "insight", outcome: "could_not_bridge" });
  await drainAfterReply();
  assertEquals(updates.length, 1);
  assertEquals(updates[0].filters, { owner: "o", other: "p", text: "the text" });
  const patch = updates[0].patch as Record<string, unknown>;
  assertEquals(patch.insight_key, "k");
  assertEquals(patch.insight, { state: "insight", spans: [] });
});

Deno.test("refresh must be a boolean", () => {
  requireOnlyInsightFields({ person_id: "p", text: "x", refresh: true });
  assertThrows(() => requireOnlyInsightFields({ person_id: "p", text: "x", refresh: "yes" }));
});
