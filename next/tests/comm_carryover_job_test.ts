// Spec 4.7 carry-over job: dry run sends nothing, the cap stops a batch before the call, a crash between submit and collect loses nothing,
// results become placeholders and pending suggestions only where the item is still uncarried, words/grants never change. $0, fake Batch API.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { AnthropicBatches, type BatchApi, collectJob, estimateCents, lineCents, loadExisting, planJob, submitJob } from "../scripts/comm_carryover_job.ts";
import { buildBatchRequests, type BatchRequest } from "../engine/comm_carryover.ts";

type Row = Record<string, unknown>;
class Q {
  f: Array<(r: Row) => boolean> = []; upd: Row | null = null;
  constructor(private rows: Row[]) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
  is(c: string, v: unknown) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) { this.f.push((r) => vs.includes(r[c])); return this; }
  update(p: Row) { this.upd = p; return this; }
  // deno-lint-ignore no-explicit-any
  then(res: any) {
    const m = this.rows.filter((r) => this.f.every((g) => g(r)));
    if (this.upd) { for (const r of m) Object.assign(r, this.upd); return Promise.resolve(res({ data: null, error: null })); }
    return Promise.resolve(res({ data: m.map((r) => ({ ...r })), error: null }));
  }
}
function world() {
  const beliefs: Row[] = [
    { id: "a", owner: "o", statement: "Part of you goes quiet when tired.", own_wording: "I go quiet when I'm tired, it doesn't mean I'm upset.", area: "relationships", status: "confirmed", comm_kind: null },
    { id: "b", owner: "o", statement: "x", own_wording: "I feel looked after when someone texts to say they got home.", area: "family", status: "confirmed", comm_kind: null },
    { id: "c", owner: "o", statement: "x", own_wording: "I want to end it all.", area: "meaning", status: "confirmed", comm_kind: null },
    { id: "d", owner: "o", statement: "x", own_wording: "Already carried.", area: "work", status: "confirmed", comm_kind: "matters" },
    { id: "e", owner: "o", statement: "x", own_wording: "I like quiet mornings.", area: "work", status: "confirmed", comm_kind: null },
    { id: "f", owner: "o", statement: "x", own_wording: "A guess.", area: "work", status: "guess", comm_kind: null },
  ];
  const share_items: Row[] = [{ belief_id: "a", other: "jan" }, { belief_id: "b", other: "jan" }, { belief_id: "b", other: "mum" }];
  const tables: Record<string, Row[]> = { beliefs, share_items };
  return { beliefs, db: { from: (t: string) => new Q(tables[t]) } };
}
const okLine = (id: string, kind: string, conf: number, tokens = [200, 20]) => JSON.stringify({ custom_id: id, result: { type: "succeeded", message: {
  content: [{ type: "text", text: `{"kind":"${kind}","confidence":${conf},"topic":null}` }], usage: { input_tokens: tokens[0], output_tokens: tokens[1] } } } });
class FakeBatches implements BatchApi {
  submitted: BatchRequest[][] = []; ended = false; lines: string[] = [];
  submit(r: BatchRequest[]) { this.submitted.push(r); return Promise.resolve({ id: "msgbatch_1" }); }
  status() { return Promise.resolve({ ended: this.ended, counts: { succeeded: this.lines.length } }); }
  results() { return Promise.resolve(this.lines); }
}
const tmp = () => Deno.makeTempDir({ prefix: "carryover-" });

Deno.test("load: only confirmed, uncarried kennings, the person's own wording, and who each is granted to today", async () => {
  const { db } = world();
  const { items } = await loadExisting(db);
  assertEquals(items.map((k) => k.id), ["a", "b", "c", "e"]);
  assertEquals(items[0].wording, "I go quiet when I'm tired, it doesn't mean I'm upset.");
  assertEquals(items[1].grantedTo, ["jan", "mum"]);
  assertEquals(items[2].grantedTo, []);
});

Deno.test("plan is a dry run: counts, a fractional estimate under the discount, no call; risky wording is counted and never sent", async () => {
  const { db } = world();
  const p = await planJob(db);
  assertEquals([p.candidates, p.sendable, p.skippedSafety], [4, 3, 1]);
  assert(p.estimatedCents > 0 && p.estimatedCents < 3, `estimate ${p.estimatedCents}`);   // three tiny requests: well under one cent each, not rounded up per call
  const reqs = buildBatchRequests((await loadExisting(db)).items);
  assertEquals(estimateCents(reqs), p.estimatedCents);
});

Deno.test("submit: over the cap sends nothing; under it, one batch, the record is written, and a second submit into the same directory is refused", async () => {
  const { db } = world(), api = new FakeBatches(), dir = await tmp();
  await assertRejects(() => submitJob(db, api, dir, { capCents: 0.001 }), Error, "budget_unavailable");
  assertEquals(api.submitted.length, 0);
  const rec = await submitJob(db, api, dir, { capCents: 5, now: new Date("2026-11-16T10:00:00Z") });
  assertEquals([api.submitted.length, api.submitted[0].length, rec.ids, rec.state, rec.batch_id], [1, 3, ["a", "b", "e"], "submitted", "msgbatch_1"]);
  assert(!JSON.stringify(rec).includes("quiet"), "the record names ids, never wording");
  await assertRejects(() => submitJob(db, api, dir, { capCents: 5 }), Error, "already exists");
  assertEquals(api.submitted.length, 1);
});

Deno.test("collect: pending until the batch ends; dry run writes nothing; apply writes placeholder + suggestion only; sharing, words and the guess are untouched", async () => {
  const { db, beliefs } = world(), api = new FakeBatches(), dir = await tmp();
  await submitJob(db, api, dir, { capCents: 5 });
  assertEquals((await collectJob(db, api, dir, { apply: true })).state, "pending");
  assertEquals(beliefs.filter((b) => b.comm_suggestion !== undefined).length, 0);
  api.ended = true;
  api.lines = [okLine("a", "how_i_mean", 0.9), okLine("b", "feels_like_care", 0.82), okLine("e", "other", 0.9)];
  const before = JSON.stringify(beliefs);
  const dry = await collectJob(db, api, dir, { apply: false });
  assertEquals([dry.state, dry.rows, dry.suggestions, dry.written, dry.problems], ["collected", 3, 2, 0, []]);
  assertEquals(dry.skipped, { model_chose_other: 1 });
  assertEquals(JSON.stringify(beliefs), before);
  const r = await collectJob(db, api, dir, { apply: true });
  assertEquals([r.state, r.written], ["applied", 3]);
  const by = Object.fromEntries(beliefs.map((b) => [b.id, b]));
  for (const id of ["a", "b", "e"]) assertEquals([by[id].comm_kind, by[id].comm_scope_type, by[id].comm_scope_value, by[id].comm_status], ["other", "everyone", null, "private_only"]);
  assertEquals(by.a.comm_suggestion, { kind: "how_i_mean", confidence: 0.9, topic: null });
  assertEquals(by.e.comm_suggestion, null);
  assertEquals([by.c.comm_kind, by.d.comm_kind, by.f.comm_kind], [null, "matters", null]);   // never sent, already carried, a guess
  assertEquals(by.a.own_wording, "I go quiet when I'm tired, it doesn't mean I'm upset.");
  // Nothing about words, receipts or sharing is in what was written.
  assertEquals(Object.keys(by.a).filter((k) => !["id", "owner", "statement", "own_wording", "area", "status"].includes(k)).sort(),
    ["comm_kind", "comm_scope_type", "comm_scope_value", "comm_status", "comm_suggestion"]);
  // A second collect after apply does nothing.
  assertEquals((await collectJob(db, api, dir, { apply: true })).state, "applied");
});

Deno.test("collect: an item the person carried over by hand in the meantime is not overwritten; errored lines and bad answers stay under Other", async () => {
  const { db, beliefs } = world(), api = new FakeBatches(), dir = await tmp();
  await submitJob(db, api, dir, { capCents: 5 });
  beliefs[0].comm_kind = "bring_up";        // the person did it by hand while the batch ran
  api.ended = true;
  api.lines = [okLine("a", "how_i_mean", 0.9), JSON.stringify({ custom_id: "b", result: { type: "errored" } }), okLine("e", "lands_hard", 0.99)];
  const r = await collectJob(db, api, dir, { apply: true });
  assertEquals(r.written, 2);
  assertEquals(beliefs[0].comm_kind, "bring_up");
  assertEquals(beliefs[0].comm_suggestion, undefined);
  assertEquals(beliefs[1].comm_suggestion, null);
  assertEquals(beliefs[4].comm_suggestion, null);   // lands_hard is off the closed list: no suggestion, ever
  assertEquals(r.skipped, { no_answer: 2 });
});

Deno.test("cost: settled from usage at half the live price, no round-up per call", () => {
  const c = lineCents(okLine("a", "how_i_mean", 0.9, [1000, 40]), "claude-haiku-5-5");
  assertEquals(Math.round(c * 1000) / 1000, Math.round(((1000 * 100 + 40 * 500) / 1_000_000) * 0.5 * 1000) / 1000);
  assertEquals(lineCents(JSON.stringify({ custom_id: "x", result: { type: "errored" } }), "claude-haiku-5-5"), 0);
});

Deno.test("the real Batch client sends the key as a header only and the requests as the body; a failure names the status, not the key", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = ((url: string, init: RequestInit) => { seen.push({ url, init }); return Promise.resolve(new Response(JSON.stringify({ id: "msgbatch_9" }), { status: 200 })); }) as unknown as typeof fetch;
  const api = new AnthropicBatches("sk-test-key", f);
  assertEquals((await api.submit([])).id, "msgbatch_9");
  assertEquals(seen[0].url, "https://api.anthropic.com/v1/messages/batches");
  assertEquals((seen[0].init.headers as Record<string, string>)["x-api-key"], "sk-test-key");
  assert(!String(seen[0].init.body).includes("sk-test-key"));
  const bad = new AnthropicBatches("sk-test-key", (() => Promise.resolve(new Response("nope sk-test-key", { status: 401 }))) as unknown as typeof fetch);
  const e = await bad.submit([]).catch((x) => x as Error);
  assert(String((e as Error).message).startsWith("batch submit 401"));
});

Deno.test("0071 on PGlite: a suggestion holds only a closed kind, a number and a topic; only a placeholder can carry one; rollback removes the column", async () => {
  const pg = new PGlite();
  await pg.exec(`create schema if not exists public;
    create table public.beliefs (id uuid primary key default gen_random_uuid(), owner uuid not null, label text not null default 'x',
      kind text not null default 'everyday', level text, status text not null default 'confirmed');`);
  await pg.exec(await Deno.readTextFile(new URL("../../supabase/migrations/0069_comm_items.sql", import.meta.url)));
  await pg.exec(await Deno.readTextFile(new URL("../../supabase/migrations/0071_comm_suggestion.sql", import.meta.url)));
  const put = (sugg: string | null, kind = "other", status = "private_only") => pg.query(
    `insert into public.beliefs (owner, comm_kind, comm_scope_type, comm_status, comm_suggestion) values (gen_random_uuid(), $1, 'everyone', $2, $3::jsonb)`, [kind, status, sugg]);
  await put(null);
  await put('{"kind":"how_i_mean","confidence":0.9,"topic":null}');
  await put('{"kind":"matters","confidence":0.8,"topic":"work"}');
  for (const bad of ['{"kind":"lands_hard","confidence":0.9,"topic":null}', '{"kind":"this_week","confidence":0.9}', '{"kind":"how_i_mean","confidence":1.5}',
    '{"kind":"how_i_mean","confidence":"high"}', '{"kind":"how_i_mean","confidence":0.9,"topic":"work"}', '{"kind":"matters","confidence":0.9,"topic":"faith"}',
    '{"kind":"how_i_mean","confidence":0.9,"note":"a word"}', '{"confidence":0.9}']) {
    await assertRejects(() => put(bad), Error, "beliefs_comm_suggestion", bad);
  }
  await assertRejects(() => put('{"kind":"matters","confidence":0.9,"topic":null}', "matters", "active"), Error, "beliefs_comm_suggestion_pending");
  const rb = (await Deno.readTextFile(new URL("../../supabase/migrations/0071_comm_suggestion.sql", import.meta.url))).split("\n").filter((l) => l.startsWith("--   ")).map((l) => l.slice(5)).join("\n");
  await pg.exec(rb);
  const cols = await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name='beliefs' and column_name='comm_suggestion'`);
  assertEquals(cols.rows.length, 0);
  assertEquals((await pg.query<{ n: number }>(`select count(*)::int n from public.beliefs`)).rows[0].n, 3);
});
