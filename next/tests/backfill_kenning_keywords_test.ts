// Map v2 keyword backfill: dry run calls nothing, apply writes only null keywords, bad model words fall back to the label. $0.
import { assertEquals } from "jsr:@std/assert@1";
import { backfillKeywords } from "../scripts/backfill_kenning_keywords.ts";
import type { ModelClient } from "../engine/model/client.ts";

type Row = Record<string, unknown>;
const rows: Row[] = [];
class Q {
  f: Array<(r: Row) => boolean> = []; upd: Row | null = null;
  select() { return this; }
  eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
  is(c: string, v: unknown) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  update(p: Row) { this.upd = p; return this; }
  // deno-lint-ignore no-explicit-any
  then(res: any) {
    const m = rows.filter((r) => this.f.every((g) => g(r)));
    if (this.upd) { for (const r of m) Object.assign(r, this.upd); return Promise.resolve(res({ data: null, error: null })); }
    return Promise.resolve(res({ data: m.map((r) => ({ ...r })), error: null }));
  }
}
const db = { from: (_: string) => new Q() };
const seen: string[] = [];
const fake = (answer: string): ModelClient => ({
  complete: (req) => { seen.push(req.messages[0].content); return Promise.resolve({ purpose: req.purpose, request: { model: "m", system: "", messages: [], maxTokens: 0 },
    rawResponse: answer, usage: { model: "m", inputTokens: 1, outputTokens: 1, cents: 0.1, ms: 1 } } as never); },
} as ModelClient);

Deno.test("backfill: dry run counts and calls nothing; apply writes null keywords only; a bad word falls back to the label", async () => {
  rows.length = 0; seen.length = 0;
  rows.push({ id: "a", owner: "o", label: "Say it's fine", statement: "Part of you says it's fine.", status: "confirmed", map_keyword: null },
    { id: "b", owner: "o", label: "Keep things smooth", statement: "You keep things smooth.", status: "confirmed", map_keyword: null },
    { id: "c", owner: "o", label: "Done", statement: "x", status: "confirmed", map_keyword: "Done" },
    { id: "d", owner: "o", label: "Guess", statement: "x", status: "guess", map_keyword: null });
  const dry = await backfillKeywords(db, null, { apply: false });
  assertEquals([dry.candidates, dry.calls, dry.written], [2, 0, 0]);
  const r = await backfillKeywords(db, fake('{"keywords":[{"i":0,"keyword":"fine"},{"i":1,"keyword":"selfish"}]}'), { apply: true });
  assertEquals([r.candidates, r.calls, r.written, r.fromModel, r.fromLabel], [2, 1, 2, 1, 1]);
  assertEquals(rows.map((x) => x.map_keyword), ["Fine", "Smooth", "Done", null]);
  // Only label and wording go to the model; no receipt or quote is read.
  assertEquals(JSON.parse(seen[0]), [{ i: 0, label: "Say it's fine", wording: "Part of you says it's fine." }, { i: 1, label: "Keep things smooth", wording: "You keep things smooth." }]);
  const again = await backfillKeywords(db, fake("{}"), { apply: true });
  assertEquals([again.candidates, again.calls], [0, 0]);
});
