import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { guideAvoidTopics, guideBrief, guidePackage, readGuideBrief } from "../engine/talk/guide.ts";
import { ownerTalkGuide, storeGuideBrief } from "../api/talk.ts";
import { contextPackage } from "../engine/talk/context.ts";

const offered = [{ kind: "how_i_mean" as const, reason: "missing" as const }];
const valid = JSON.stringify({ thread: "The moment with their sister still seems present", gap: { kind: "how_i_mean", angle: "the way they held back around it" }, avoid: ["family details"], why: "private trace" });

Deno.test("guide: fake provider's valid private brief is stored on its conversation", async () => {
  const out = await guideBrief(new RecordedClient({ talk_guide: [valid] }), { map: [], commItems: [], sessionTurns: [{ role: "person", text: "I did not say much." }], lastSession: null, gaps: offered, comfort: "ok" });
  assertEquals(out.brief, { thread: "The moment with their sister still seems present", gap: { kind: "how_i_mean", angle: "the way they held back around it" }, avoid: ["family details"], why: "private trace" });
  assertEquals(out.exchange.request.model, "claude-haiku-5-5");
  const calls: Record<string, unknown>[] = [];
  const db = { from: () => ({ update: (patch: Record<string, unknown>) => ({ eq: (key: string, value: unknown) => ({ eq: (next: string, nextValue: unknown) => {
    calls.push({ patch, key, value, next, nextValue }); return Promise.resolve({ error: null });
  } }) }) }) } as never;
  await storeGuideBrief(db, "conversation", "owner", out.brief);
  assertEquals(calls, [{ patch: { guide_brief: out.brief }, key: "id", value: "conversation", next: "owner", nextValue: "owner" }]);
});

Deno.test("guide: invalid output and a gap the code did not offer are dropped", async () => {
  const invalid = await guideBrief(new RecordedClient({ talk_guide: [JSON.stringify({ thread: "This contains therapy", gap: null, avoid: [], why: "trace" })] }), { map: [], commItems: [], sessionTurns: [], lastSession: null, gaps: offered, comfort: "ok" });
  assertEquals(invalid.brief, null);
  assertEquals(readGuideBrief({ thread: "Stay with the latest moment", gap: { kind: "matters", angle: "what mattered there" }, avoid: [], why: "trace" }, offered, "ok").brief, null);
});

Deno.test("guide: comfort not ok omits gaps from the provider package and rejects one if returned", () => {
  const pkg = guidePackage({ map: [], commItems: [], sessionTurns: [{ role: "person", text: "Rather not." }], lastSession: null, gaps: [], comfort: "easing" });
  assertStringIncludes(pkg, '"offered_gaps":[]');
  assertEquals(readGuideBrief(JSON.parse(valid), [], "easing").brief, null);
});

Deno.test("guide: carried avoids are short, screened guide topics rather than a person's declined words", () => {
  assertEquals(guideAvoidTopics(["family plans", "a subject with more than six words in it", "therapy details"]), ["family plans"]);
});

Deno.test("guide: its own switch stays off when communication items are on", () => {
  const off = { caller: { id: "owner" }, env: { commItems: true, talkGuide: false, commOwnerIds: ["owner"] } };
  assertEquals(ownerTalkGuide(off as never), false);
  assertEquals(ownerTalkGuide({ ...off, env: { ...off.env, talkGuide: true } } as never), true);
});

Deno.test("guide: only the owner path adds the private brief to a listener package", () => {
  const state = { person: { firstName: "Marin", language: "en", about: [] }, map: { beliefs: [], consent: {}, openThreads: [] }, session: { id: "s1", date: "2026-11-20", turns: [] } };
  const ordinary = contextPackage(state.person, state.map, state.session);
  const guided = contextPackage(state.person, state.map, state.session, [], { guideBrief: {
    thread: "Stay with the missed dinner", gap: { kind: "how_i_mean", angle: "how they held the point back" }, avoid: ["health"],
  } });
  assert(!ordinary.includes("GUIDE BRIEF"));
  assertStringIncludes(guided, "## GUIDE BRIEF (private)");
});

Deno.test("talk guide is deferred after the listener reply is persisted, never awaited by runTurn", async () => {
  const src = await Deno.readTextFile(new URL("../api/talk.ts", import.meta.url));
  assert(/guideAfterReply\(ctx, conv, me, reply, turnIndex\);\s*return \{\s*conversation: conv/.test(src));
  assert(!/await guideAfterReply\(/.test(src));
  assert(src.indexOf('role: "presence"') < src.indexOf("guideAfterReply(ctx, conv, me, reply, turnIndex)"));
  assertStringIncludes(src, "ownerTalkGuide(ctx) && conversation.guide_brief");
});
