// Review round 4 of PR #96 (#8): release always gates; a Mirror contributor needs their own consent (the local floor still answers risk);
// Comm Talk replaces or removes only answers it kept while consent was missing.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { aiConsentGateOn } from "../api/lib/env.ts";
import { contributorConsentOrFloor, heldMayBeRead, mirrorReadsWords } from "../api/mirror.ts";
import { claimedElsewhere, CONSENT_CLAIM_MS, dropConsentPending, keepConsentPending, settleConsentPending } from "../api/comm_talk.ts";
import { ApiError } from "../api/lib/errors.ts";
import { REQUIRED_VERSION } from "../api/lib/ai_consent.ts";

type Row = Record<string, unknown>;

/** A tiny in-memory table store with the chained filters these routes use. */
function memDb(tables: Record<string, Row[]>, snapshotReads = false) {
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
      if (op === "update") { for (const r of hit) Object.assign(r, patch); return { data: single ? hit[0] ?? null : hit, error: null }; }
      const out = snapshotReads ? hit.map((r) => ({ ...r })) : hit;
      return { data: single ? out[0] ?? null : out, error: null };
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
  await dropConsentPending(talkCtx(messages), "c1", "kept for consent");
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

Deno.test("a consented turn makes the kept answer an ordinary one, with the words now given", async () => {
  const same: Row[] = [{ id: "h", owner: "me", conversation_id: "c1", role: "me", turn: 1, text: "my words", pending_consent: true }];
  await settleConsentPending(talkCtx(same), "c1", "my words");
  assertEquals(same.length, 1);
  assertEquals(same[0].pending_consent, false);

  // Round 5: different words take the kept row's place in one write, so the confirmed answer is never without a row.
  const other: Row[] = [{ id: "h", owner: "me", conversation_id: "c1", role: "me", turn: 1, text: "old unchecked words", pending_consent: true }];
  await settleConsentPending(talkCtx(other), "c1", "new words");
  assertEquals(other.length, 1);
  assertEquals(other[0].text, "new words");
  assertEquals(other[0].pending_consent, false);
});

Deno.test("a held Mirror moment is read later only if its contributor's consent is current then", async () => {
  const consent = (rows: Row[]) => ({ env, service: memDb({ ai_consent: rows }) } as never);
  const held = { id: "m1", contributor_id: "friend", owner: "nami" };
  const agreed = (who: string) => ({ owner: who, version: REQUIRED_VERSION, providers: ["anthropic"], at: now, withdrawn_at: null });
  assertEquals(await heldMayBeRead(consent([agreed("friend"), agreed("nami")]), held), true);
  assertEquals(await heldMayBeRead(consent([agreed("friend")]), held), false);                  // the link owner withdrew
  assertEquals(await heldMayBeRead(consent([]), held), false);                                   // withdrawn since
  assertEquals(await heldMayBeRead(consent([{ owner: "friend", version: "2026-01", providers: ["anthropic"], at: now, withdrawn_at: null }]), held), false); // older version
  assertEquals(await heldMayBeRead(consent([]), { id: "m2" }), false);                          // no contributor kept: not read
});

Deno.test("of two concurrent retries, the one that settled the kept answer first is not overwritten", async () => {
  const messages: Row[] = [{ id: "h", owner: "me", conversation_id: "c1", role: "me", turn: 1, text: "kept", pending_consent: true }];
  const ctx = { caller: { id: "me", db: memDb({ messages }, true) } } as never;
  const results = await Promise.allSettled([settleConsentPending(ctx, "c1", "first retry"), settleConsentPending(ctx, "c1", "second retry")]);
  // Round 7: the loser is told, so the kept answer is answered once.
  assertEquals(results[0].status, "fulfilled");
  assertEquals(results[1].status, "rejected");
  assertEquals(((results[1] as PromiseRejectedResult).reason as ApiError).code, "conflict");
  assertEquals(messages.length, 1);
  assertEquals(messages[0].text, "first retry");
  assertEquals(messages[0].pending_consent, false);
});

Deno.test("a stop on different words leaves the kept answer that was confirmed saved", async () => {
  const messages: Row[] = [{ id: "held", owner: "me", conversation_id: "c1", role: "me", turn: 1, text: "kept words", pending_consent: true }];
  await dropConsentPending(talkCtx(messages), "c1", "other words that stopped");
  assertEquals(messages.map((m) => m.id), ["held"]);
});

Deno.test("a release deployment reads no Mirror moment until package 04's consent flow exists", () => {
  assertEquals(mirrorReadsWords({ env: { releaseBuild: true } } as never), false);
  assertEquals(mirrorReadsWords({ env: { releaseBuild: false } } as never), true);
});

Deno.test("a kept answer claimed by another request is not answered again until its claim expires", () => {
  const at = Date.parse("2026-11-28T05:00:00Z");
  const row = { id: "h", consent_claimed_at: new Date(at).toISOString() };
  assertEquals(claimedElsewhere(row, null, at + 1_000), true);
  assertEquals(claimedElsewhere(row, "h", at + 1_000), false);                // the request that claimed it
  assertEquals(claimedElsewhere(row, null, at + CONSENT_CLAIM_MS + 1), false); // a crashed claim lapses
  assertEquals(claimedElsewhere({ id: "x" }, null, at), false);               // never claimed: an ordinary retry
});

Deno.test("without the link owner's consent the link takes no Mirror moment", async () => {
  const ctx = { env, service: memDb({ ai_consent: [{ owner: "friend", version: REQUIRED_VERSION, providers: ["anthropic"], at: now, withdrawn_at: null }] }) } as never;
  const e = await assertRejects(() => contributorConsentOrFloor(ctx, "friend", "She went quiet when the plan changed.", "nami"), ApiError);
  assertEquals((e as ApiError).extra.reason, "closed");
});
