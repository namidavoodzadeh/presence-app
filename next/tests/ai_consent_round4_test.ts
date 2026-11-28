// Review round 4 of PR #96 (#8): release always gates; a Mirror contributor needs their own consent (the local floor still answers risk);
// Comm Talk replaces or removes only answers it kept while consent was missing.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { aiConsentGateOn } from "../api/lib/env.ts";
import { contributorConsentOrFloor } from "../api/mirror.ts";
import { dropConsentPending, keepConsentPending, settleConsentPending } from "../api/comm_talk.ts";
import { ApiError } from "../api/lib/errors.ts";
import { REQUIRED_VERSION } from "../api/lib/ai_consent.ts";

type Row = Record<string, unknown>;

/** A tiny in-memory table store with the chained filters these routes use. */
function memDb(tables: Record<string, Row[]>) {
  const builder = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "delete" | "update" | "insert" = "select";
    let patch: Row = {};
    let inserted: Row | null = null;
    let single = false;
    const run = () => {
      if (op === "insert") return { data: inserted, error: null };
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "delete") { for (const r of hit) rows.splice(rows.indexOf(r), 1); return { data: null, error: null }; }
      if (op === "update") { for (const r of hit) Object.assign(r, patch); return { data: null, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
      order: () => q,
      single: () => { single = true; return q; },
      maybeSingle: () => { single = true; return q; },
      delete: () => { op = "delete"; return q; },
      update: (p: Row) => { op = "update"; patch = p; return q; },
      insert: (r: Row) => { op = "insert"; inserted = { id: crypto.randomUUID(), ...r }; rows.push(inserted); return q; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };
  return { from: builder } as unknown as never;
}

Deno.test("a release deployment always requires AI consent; no switch turns it off", () => {
  assertEquals(aiConsentGateOn(true, "false"), true);
  assertEquals(aiConsentGateOn(true, undefined), true);
  assertEquals(aiConsentGateOn(false, undefined), false);
  assertEquals(aiConsentGateOn(false, "true"), true);
});

const env = { requireAiConsent: true } as never;
const now = new Date().toISOString();

Deno.test("a Mirror contributor without consent is refused before any model reads the moment", async () => {
  const ctx = { env, service: memDb({ ai_consent: [] }) } as never;
  const e = await assertRejects(() => contributorConsentOrFloor(ctx, "friend", "She went quiet when the plan changed and then called me later."), ApiError);
  assertEquals((e as ApiError).extra.reason, "ai_consent_required");
});

Deno.test("a risky Mirror moment still gets resources from the local floor without consent", async () => {
  const ctx = { env, service: memDb({ ai_consent: [] }) } as never;
  const r = await contributorConsentOrFloor(ctx, "friend", "I want to kill myself tonight");
  assert(r);
  const body = await r!.json();
  assertEquals(body.state, "concern");
  assert(body.resources);
});

Deno.test("a Mirror contributor with consent passes", async () => {
  const ctx = { env, service: memDb({ ai_consent: [{ owner: "friend", version: REQUIRED_VERSION, providers: ["anthropic"], at: now, withdrawn_at: null }] }) } as never;
  assertEquals(await contributorConsentOrFloor(ctx, "friend", "She went quiet when the plan changed."), null);
});

function talkCtx(messages: Row[]) {
  return { caller: { id: "me", db: memDb({ messages }) } } as never;
}

Deno.test("a stopped reading removes only consent-pending answers, never a regular Talk answer", async () => {
  const messages: Row[] = [
    { id: "talk", owner: "me", conversation_id: "c1", role: "me", turn: 1, text: "regular talk answer" },
    { id: "held", owner: "me", conversation_id: "c1", role: "me", turn: 2, text: "kept for consent", pending_consent: true },
  ];
  await dropConsentPending(talkCtx(messages), "c1");
  assertEquals(messages.map((m) => m.id), ["talk"]);
});

Deno.test("new words without consent replace the kept answer instead of adding a turn", async () => {
  const messages: Row[] = [];
  const ctx = talkCtx(messages);
  const first = await keepConsentPending(ctx, "c1", "first words");
  const again = await keepConsentPending(ctx, "c1", "first words");
  assertEquals(again.id, first.id);
  await keepConsentPending(ctx, "c1", "different words");
  assertEquals(messages.length, 1);
  assertEquals(messages[0].text, "different words");
  assertEquals(messages[0].turn, 1);
});

Deno.test("a consented turn keeps the same words as the answer and drops different kept words", async () => {
  const same: Row[] = [{ id: "h", owner: "me", conversation_id: "c1", role: "me", turn: 1, text: "my words", pending_consent: true }];
  await settleConsentPending(talkCtx(same), "c1", "my words");
  assertEquals(same.length, 1);
  assertEquals(same[0].pending_consent, false);

  const other: Row[] = [{ id: "h", owner: "me", conversation_id: "c1", role: "me", turn: 1, text: "old unchecked words", pending_consent: true }];
  await settleConsentPending(talkCtx(other), "c1", "new words");
  assertEquals(other.length, 0);
});
