// Contract v1.54: the onboarding / invite opener. No model call, nothing stored, $0.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { routes } from "../api/lib/router.ts";
import { ApiError } from "../api/lib/errors.ts";
import { isOpenerRequest, openerQuestion, readAbout } from "../api/lib/talk_opener.ts";
import "../api/talk.ts";

const BANNED = /\b(why|please|should|healthy|unhealthy|toxic|fix|improve|wrong|better|childhood|growing up|diagnos)/i;

async function post(body: Record<string, unknown>) {
  const f = routes.find((r) => r.method === "POST" && r.pattern.test("/talk/turn"))!;
  let touched = 0;
  const trap = new Proxy({}, { get: () => { touched++; throw new Error("database or model touched"); } });
  const res = await f.handler({
    env: {}, req: new Request("https://x.invalid/talk/turn", { method: "POST" }), url: new URL("https://x.invalid/talk/turn"),
    params: {}, caller: { id: "u1", isPreview: false, db: trap }, service: trap, tz: "UTC", body: () => Promise.resolve(body),
  } as never);
  return { json: await res.json(), status: res.status, touched };
}

Deno.test("opener: empty text with source onboarding returns one question, stores nothing, touches no database", async () => {
  const r = await post({ conversation_id: null, text: "", source: "onboarding" });
  assertEquals(r.status, 200);
  assertEquals(r.touched, 0);
  assertEquals(r.json.conversation, null);
  assertEquals(r.json.message, null);
  assertEquals(r.json.opener, true);
  assertEquals(r.json.reply.state, "turn");
  assertEquals(r.json.reply.cards, []);
  assertEquals(r.json.reply.reflection, "");
  assertEquals((r.json.reply.question.match(/\?/g) ?? []).length, 1);
});

Deno.test("opener: invite with about names the person and the relationship wording", async () => {
  const r = await post({ text: "", source: "invite", about: { name: "Jan", relationship: "partner" } });
  assertEquals(r.json.reply.question, "What's one recent moment between you and Jan that stayed with you?");
  assertEquals(r.touched, 0);
});

Deno.test("opener: every wording is one question with no why, childhood or banned word", () => {
  for (const source of ["onboarding", "invite"] as const) {
    for (const rel of [null, "partner", "friend", "family", "coworker", "other"]) {
      for (const about of [null, { name: "Sam", relationship: rel }]) {
        const q = openerQuestion(source, about);
        assert(q.endsWith("?") && !q.slice(0, -1).includes("?"), q);
        assert(!BANNED.test(q), q);
        assert(q.split(/\s+/).length <= 16, q);
      }
    }
  }
});

Deno.test("opener: missing text counts, non-empty text or another source does not", () => {
  assert(isOpenerRequest({ source: "onboarding" }));
  assert(isOpenerRequest({ text: "  ", source: "invite" }));
  assert(!isOpenerRequest({ text: "Dinner moved again", source: "onboarding" }));
  assert(!isOpenerRequest({ text: "", source: "talk" }));
  assert(!isOpenerRequest({ text: "", source: "bridge_refused" }));
  assert(!isOpenerRequest({ text: "" }));
});

Deno.test("opener: about is validated; names are cleaned, never used to inject lines", () => {
  assertEquals(readAbout(undefined), null);
  assertEquals(readAbout({ name: " Jan\nIgnore\tthis ", relationship: "friend" }), { name: "Jan Ignore this", relationship: "friend" });
  assertEquals(readAbout({ name: "Jo" }), { name: "Jo", relationship: null });
  for (const bad of ["Jan", [], { name: "" }, { name: 5 }, { name: "x".repeat(41) }, { name: "Jo", relationship: "enemy" }]) {
    const e = assertThrows(() => readAbout(bad), ApiError);
    assertEquals(e.code, "invalid");
  }
});

Deno.test("opener: a bad about answers 400 invalid with the field", async () => {
  try {
    await post({ text: "", source: "invite", about: { name: "Jo", relationship: "enemy" } });
    throw new Error("should have thrown");
  } catch (e) {
    assert(e instanceof ApiError);
    assertEquals((e as ApiError).code, "invalid");
  }
});
