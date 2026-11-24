import { assertEquals } from "jsr:@std/assert@1";
import { entitlementFromVerifiedTransaction, resolvePlanFromRows } from "../api/entitlements.ts";
import { enabledSwitch } from "../api/lib/env.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const N = "33333333-3333-4333-8333-333333333333";
const C = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-11-01T16:00:00Z");
const active = (person: string) => ({ person, status: "active", expires_at: "2026-12-01T00:00:00Z" });
const link = { person_a: A, person_b: B, status: "active", created_at: "2026-10-31T00:00:00Z" };
const mutual = [
  { owner: A, other: B, relationship: "partner" },
  { owner: B, other: A, relationship: "partner" },
];
const profiles = [{ id: A, name: "Ava" }, { id: B, name: "Bo" }];

Deno.test("partner entitlement switch is strict and defaults off", () => {
  assertEquals(enabledSwitch(undefined), false);
  assertEquals(enabledSwitch("TRUE"), false);
  assertEquals(enabledSwitch("true"), true);
});

Deno.test("partner entitlement migration has a unique ordered version after the merged engine migrations", async () => {
  const names = [];
  for await (const entry of Deno.readDir("../supabase/migrations")) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  const versions = names.map((name) => name.split("_", 1)[0]);
  assertEquals(new Set(versions).size, versions.length);
  assertEquals(names.includes("0022_partner_entitlements.sql"), true);
});

Deno.test("own entitlement wins and never names a partner", () => {
  assertEquals(resolvePlanFromRows(A, [link], mutual, profiles, [active(A), active(B)], NOW), {
    active: true,
    source: "own",
    partner_name: null,
  });
});

Deno.test("an active mutually marked partner covers the other person for free", () => {
  assertEquals(resolvePlanFromRows(A, [link], mutual, profiles, [active(B)], NOW), {
    active: true,
    source: "partner",
    partner_name: "Bo",
  });
});

Deno.test("one-sided, ended, or expired partner links do not share entitlement", () => {
  const inactive = { active: false, source: "own" as const, partner_name: null };
  assertEquals(resolvePlanFromRows(A, [link], mutual.slice(0, 1), profiles, [active(B)], NOW), inactive);
  assertEquals(
    resolvePlanFromRows(A, [{ ...link, status: "removed" }], mutual, profiles, [active(B)], NOW),
    inactive,
  );
  assertEquals(
    resolvePlanFromRows(
      A,
      [link],
      mutual,
      profiles,
      [{ ...active(B), expires_at: "2026-10-01T00:00:00Z" }],
      NOW,
    ),
    inactive,
  );
});

Deno.test("one payer cannot fan one subscription out to several partner-labelled links", () => {
  const earlier = { person_a: B, person_b: C, status: "active", created_at: "2026-10-01T00:00:00Z" };
  const allPrefs = [...mutual, { owner: B, other: C, relationship: "partner" }, {
    owner: C,
    other: B,
    relationship: "partner",
  }];
  assertEquals(
    resolvePlanFromRows(A, [earlier, link], allPrefs, [...profiles, { id: C, name: "Cy" }], [active(B)], NOW),
    {
      active: false,
      source: "own",
      partner_name: null,
    },
  );
});

Deno.test("verified purchased ASSN transaction maps appAccountToken to an entitlement", () => {
  assertEquals(
    entitlementFromVerifiedTransaction(N, {
      appAccountToken: A,
      productId: "app.presence.plus.monthly",
      originalTransactionId: "original-1",
      expiresDate: Date.parse("2026-12-01T00:00:00Z"),
      inAppOwnershipType: "PURCHASED",
      environment: "Production",
    }, NOW),
    {
      person: A,
      product_id: "app.presence.plus.monthly",
      original_transaction_id: "original-1",
      status: "active",
      expires_at: "2026-12-01T00:00:00.000Z",
      app_environment: "production",
      last_notification_uuid: N,
    },
  );
});

Deno.test("Family Sharing, unknown products, and missing account tokens never grant Presence entitlement", () => {
  const base = {
    appAccountToken: A,
    productId: "app.presence.plus.yearly",
    originalTransactionId: "original-2",
    inAppOwnershipType: "PURCHASED",
  };
  assertEquals(
    entitlementFromVerifiedTransaction(N, { ...base, inAppOwnershipType: "FAMILY_SHARED" }, NOW),
    null,
  );
  assertEquals(entitlementFromVerifiedTransaction(N, { ...base, productId: "other.product" }, NOW), null);
  assertEquals(entitlementFromVerifiedTransaction(N, { ...base, appAccountToken: undefined }, NOW), null);
});
