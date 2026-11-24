// System design item 7: Talk traces keep no spoken words, and engine_calls has a retention limit (migration 0034).
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { isRedacted, redactTalkExchange } from "../engine/talk/redact.ts";
import type { ModelExchange } from "../engine/types.ts";

const exchange = (): ModelExchange => ({
  purpose: "turn",
  request: { model: "m", system: "SYSTEM PROMPT", messages: [{ role: "user", content: "my sister never calls me back" }, { role: "assistant", content: "What did that feel like?" }], maxTokens: 400 },
  rawResponse: '{"question":"What did that feel like?"}',
  usage: { model: "m", inputTokens: 10, outputTokens: 5, cents: 2, ms: 900 } as ModelExchange["usage"],
});

Deno.test("redactTalkExchange: no word of the person or the reply survives; system prompt, tokens, cents and ms stay", async () => {
  const e = await redactTalkExchange(exchange());
  assert(!JSON.stringify(e).includes("sister"));
  assert(!JSON.stringify(e).includes("feel like"));
  assertEquals(e.request.system, "SYSTEM PROMPT");
  assertEquals(e.request.messages.map((m) => m.role), ["user", "assistant"]);
  assert(e.request.messages.every((m) => isRedacted(m.content)));
  assert(isRedacted(e.rawResponse));
  assertEquals([e.usage.cents, e.usage.ms, e.usage.inputTokens], [2, 900, 10]);
  assert(/29 characters, sha256 [0-9a-f]{16}/.test(e.request.messages[0].content));
});

Deno.test("redactTalkExchange: same words give the same mark, different words a different one, and it is idempotent", async () => {
  const a = await redactTalkExchange(exchange());
  const b = await redactTalkExchange(exchange());
  assertEquals(a.request.messages[0].content, b.request.messages[0].content);
  const other = exchange(); other.request.messages[0].content = "my brother never calls me back";
  assertNotEquals((await redactTalkExchange(other)).request.messages[0].content, a.request.messages[0].content);
  assertEquals(await redactTalkExchange(a), a);
});

Deno.test("talk.ts writes every Talk trace through the redactor", async () => {
  const src = await Deno.readTextFile(new URL("../api/talk.ts", import.meta.url));
  assert(/recordEngineCall\(ctx\.service, scope, await redactTalkExchange\(/.test(src));
  assertEquals((src.match(/recordEngineCall\(/g) ?? []).length, 1); // the one call site
});

Deno.test("0034: purge_engine_calls deletes rows past the limit only, refuses a limit under a day", async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create table public.engine_calls (id serial primary key, purpose text, created_at timestamptz not null default now());
    insert into engine_calls (purpose, created_at) values ('turn', now() - interval '45 days'), ('turn', now() - interval '31 days'),
      ('turn', now() - interval '29 days'), ('finish', now());`);
  await pg.exec(await Deno.readTextFile(new URL("../../supabase/migrations/0034_engine_trace_retention.sql", import.meta.url)));
  const r = await pg.query<{ n: number }>("select public.purge_engine_calls() as n");
  assertEquals(Number(r.rows[0].n), 2);
  assertEquals((await pg.query("select 1 from engine_calls")).rows.length, 2);
  const r7 = await pg.query<{ n: number }>("select public.purge_engine_calls(7) as n");
  assertEquals(Number(r7.rows[0].n), 1);
  let refused = false;
  try { await pg.query("select public.purge_engine_calls(0)"); } catch { refused = true; }
  assert(refused);
  await pg.close();
});

Deno.test("0058: purge_client_diagnostics deletes crash and hang rows past 90 days only, leaves other errors, refuses under a day", async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table public.errors (id serial primary key, source text, code text, created_at timestamptz not null default now());
    insert into errors (source, code, created_at) values
      ('client', 'client_crash', now() - interval '91 days'), ('client', 'client_hang', now() - interval '120 days'),
      ('client', 'client_crash', now() - interval '89 days'), ('server', 'x', now() - interval '200 days'),
      ('client', 'client_reported', now() - interval '200 days');`);
  await pg.exec(await Deno.readTextFile(new URL("../../supabase/migrations/0058_client_diagnostics_retention.sql", import.meta.url)));
  const r = await pg.query<{ n: number }>("select public.purge_client_diagnostics() as n");
  assertEquals(Number(r.rows[0].n), 2);
  assertEquals((await pg.query("select 1 from errors")).rows.length, 3);
  let refused = false;
  try { await pg.query("select public.purge_client_diagnostics(0)"); } catch { refused = true; }
  assert(refused);
  await pg.close();
});
