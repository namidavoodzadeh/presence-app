// Review round 1 of PR #96 (#8): a consent record counts only if it names every provider and is not future-dated.
import { assertEquals } from "jsr:@std/assert@1";
import { aiConsentObject, REQUIRED_VERSION } from "../api/lib/ai_consent.ts";

function fakeDb(rows: Record<string, unknown>[]) {
  const q = {
    select: () => q,
    eq: () => q,
    is: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => q } as unknown as Parameters<typeof aiConsentObject>[0];
}

const now = new Date().toISOString();

Deno.test("a record that does not name anthropic is not consent", async () => {
  const c = await aiConsentObject(fakeDb([{ version: REQUIRED_VERSION, providers: ["other"], at: now, withdrawn_at: null }]), "me");
  assertEquals(c.given, null);
});

Deno.test("a future-dated record is not consent", async () => {
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const c = await aiConsentObject(fakeDb([{ version: REQUIRED_VERSION, providers: ["anthropic"], at: later, withdrawn_at: null }]), "me");
  assertEquals(c.given, null);
});

Deno.test("a current record naming anthropic is consent", async () => {
  const c = await aiConsentObject(fakeDb([{ version: REQUIRED_VERSION, providers: ["anthropic"], at: now, withdrawn_at: null }]), "me");
  assertEquals(c.given?.version, REQUIRED_VERSION);
});
