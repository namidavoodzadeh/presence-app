// V3 Mirror ask (Y6/X2, contract v1.60, migration 0053): the owner's one question on the Mirror link. PATCH /mirror {question}
// stores it (≤140 characters, the law 8 floor first, no model call), GET /mirror and GET /m/:slug echo it, rotate and delete clear
// it. Fake database, $0.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import { QUESTION_MAX, readQuestion } from "../api/mirror.ts";
import { mirrorPageHtml } from "../api/mirror_page.ts";
import { ApiError } from "../api/lib/errors.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

const OWNER = "00000000-0000-4000-8000-0000000000a1";
type R = Record<string, unknown>;

function world(): FakeTables {
  return {
    profiles: [{ id: OWNER, name: "Maya Example", is_preview: false }],
    mirror_links: [],
    outside_perspectives: [],
    mirror_approvals: [],
  };
}

async function call(tables: FakeTables, method: string, path: string, body: R = {}, owner: string | null = OWNER) {
  const r = routes.find((x) => x.method === method && x.pattern.test(path));
  assert(r, `no route ${method} ${path}`);
  const m = path.match(r.pattern)!;
  const params: Record<string, string> = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
  const service = fakeClient(tables);
  const res = await r.handler({
    env: {} as never,
    req: new Request("https://presence.invalid" + path, { method }),
    url: new URL("https://presence.invalid" + path),
    params,
    caller: owner ? { id: owner, isPreview: false, db: service } : null,
    service,
    tz: "UTC",
    body: () => Promise.resolve(body),
  } as never);
  return { status: res.status, json: await res.json() as R };
}

Deno.test("readQuestion: trims and folds whitespace, blank or null clears, over 140 or not a string is invalid", () => {
  assertEquals(readQuestion("  When do I shut\n a conversation   down?  "), { question: "When do I shut a conversation down?", risk: false });
  assertEquals(readQuestion(""), { question: null, risk: false });
  assertEquals(readQuestion("   "), { question: null, risk: false });
  assertEquals(readQuestion(null), { question: null, risk: false });
  assertEquals(readQuestion("é".repeat(QUESTION_MAX)).question?.length, QUESTION_MAX, "140 characters is allowed");
  for (const bad of ["x".repeat(QUESTION_MAX + 1), 7, true, { q: "x" }, ["x"]]) {
    try {
      readQuestion(bad);
      throw new Error(`accepted ${JSON.stringify(bad)}`);
    } catch (e) {
      assert(e instanceof ApiError, String(e));
      assertEquals(e.code, "invalid");
      assertEquals(e.extra.field, "question");
    }
  }
});

Deno.test("PATCH /mirror {question}: stored, echoed on GET /mirror; off by default; null clears", async () => {
  const t = world();
  let r = await call(t, "GET", "/mirror");
  assertEquals((r.json.mirror as R).question, null, "no question by default");
  r = await call(t, "PATCH", "/mirror", { question: "When do I shut a conversation down?" });
  assertEquals(r.status, 200);
  assertEquals((r.json.mirror as R).question, "When do I shut a conversation down?");
  assertEquals((r.json.mirror as R).on, false, "setting a question does not turn the link on");
  assertEquals(t.mirror_links[0].question, "When do I shut a conversation down?");
  r = await call(t, "GET", "/mirror");
  assertEquals((r.json.mirror as R).question, "When do I shut a conversation down?");
  r = await call(t, "PATCH", "/mirror", { question: null });
  assertEquals((r.json.mirror as R).question, null);
  assertEquals(t.mirror_links[0].question, null);
});

Deno.test("PATCH /mirror {question}: too long is 400 invalid and changes nothing", async () => {
  const t = world();
  await call(t, "PATCH", "/mirror", { question: "What do I do when I'm stressed?" });
  await assertRejects(
    () => call(t, "PATCH", "/mirror", { question: "x".repeat(QUESTION_MAX + 1), paused: true }),
    ApiError,
  );
  assertEquals(t.mirror_links[0].question, "What do I do when I'm stressed?");
  assert(t.mirror_links[0].paused !== true, "no other field in the refused call is applied");
});

Deno.test("PATCH /mirror {question}: law 8, a question showing risk stores nothing and returns resources to the owner", async () => {
  const t = world();
  await call(t, "PATCH", "/mirror", { on: true, question: "When do I go quiet?" });
  const r = await call(t, "PATCH", "/mirror", { question: "I want to kill myself, do people notice?", who: "approved" });
  assertEquals(r.status, 200);
  assertEquals(r.json.state, "safety");
  assert(r.json.resources, "resources shown");
  assertEquals((r.json.mirror as R).question, "When do I go quiet?", "the earlier question stays");
  assertEquals(t.mirror_links[0].question, "When do I go quiet?");
  assertEquals(t.mirror_links[0].who ?? "anyone", "anyone", "no other field in the same call is stored");
  assert(!JSON.stringify(t).includes("kill myself"), "the words are stored nowhere");
});

Deno.test("GET /m/:slug: the question shows only while the page is open; the HTML page shows it escaped", async () => {
  const t = world();
  let r = await call(t, "PATCH", "/mirror", { on: true, question: "When do I <b>shut</b> a conversation down?" });
  const slug = String((r.json.mirror as R).slug);
  r = await call(t, "GET", `/m/${slug}`, {}, null);
  assertEquals(r.json.open, true);
  assertEquals(r.json.question, "When do I <b>shut</b> a conversation down?");
  const html = mirrorPageHtml(r.json as never, slug, "https://api.invalid", "anon");
  assert(!html.includes("<b>shut</b>"), "the question is never raw HTML in the page");
  assert(html.includes("asked you one thing"), "the page leads with the question when there is one");
  await call(t, "PATCH", "/mirror", { paused: true });
  r = await call(t, "GET", `/m/${slug}`, {}, null);
  assertEquals(r.json.open, false);
  assertEquals(r.json.question, null, "a paused page shows one calm line, no question");
  r = await call(t, "GET", "/m/nosuchslug", {}, null);
  assertEquals(r.json.question, null);
});

Deno.test("POST /mirror/rotate clears the question; DELETE /mirror takes it with the link", async () => {
  const t = world();
  let r = await call(t, "PATCH", "/mirror", { on: true, question: "When do I shut a conversation down?" });
  const old = String((r.json.mirror as R).slug);
  r = await call(t, "POST", "/mirror/rotate");
  assertEquals((r.json.mirror as R).question, null);
  assert((r.json.mirror as R).slug !== old);
  r = await call(t, "GET", `/m/${old}`, {}, null);
  assertEquals(r.json.reason, "not_found");
  await call(t, "PATCH", "/mirror", { question: "What do I do when I'm stressed?" });
  r = await call(t, "DELETE", "/mirror");
  assertEquals((r.json.mirror as R).question, null);
  assertEquals(t.mirror_links.length, 0);
});

Deno.test("rotate on a database before 0053 (no question column) never writes the column", async () => {
  const t = world();
  t.mirror_links.push({ id: "l1", owner: OWNER, slug: "abcdefghjk", enabled: true, paused: false, who: "anyone" });
  await call(t, "POST", "/mirror/rotate");
  assert(!("question" in t.mirror_links[0]), "no question key written to a pre-0053 row");
});
