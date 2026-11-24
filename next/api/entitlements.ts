// Prototype item 2: one Presence subscription covers one mutually linked partner. This is Presence server sharing,
// never App Store Family Sharing. The route stays inert unless PRESENCE_PARTNER_ENTITLEMENTS=true.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { dbError } from "./lib/db.ts";

type Row = Record<string, unknown>;

export interface Plan {
  active: boolean;
  source: "own" | "partner";
  partner_name: string | null;
}

export interface VerifiedTransaction {
  appAccountToken?: string;
  productId?: string;
  originalTransactionId?: string;
  expiresDate?: number;
  revocationDate?: number;
  inAppOwnershipType?: string;
  environment?: string;
}

export interface EntitlementWrite {
  person: string;
  product_id: string;
  original_transaction_id: string;
  status: "active" | "expired" | "revoked";
  expires_at: string | null;
  app_environment: string;
  last_notification_uuid: string;
}

const PRODUCTS = new Set(["app.presence.plus.monthly", "app.presence.plus.yearly"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function inactivePlan(): Plan {
  return { active: false, source: "own", partner_name: null };
}

function entitlementActive(row: Row | undefined, nowMs: number): boolean {
  if (!row || row.status !== "active") return false;
  const expires = typeof row.expires_at === "string" ? Date.parse(row.expires_at) : Number.POSITIVE_INFINITY;
  return Number.isFinite(expires) ? expires > nowMs : row.expires_at == null;
}

/** Pure policy used by the server query and unit tests. Own coverage wins; partner coverage requires a mutual partner label. */
export function resolvePlanFromRows(
  person: string,
  links: Row[],
  prefs: Row[],
  profiles: Row[],
  entitlements: Row[],
  nowMs = Date.now(),
): Plan {
  const entitlement = new Map(entitlements.map((row) => [String(row.person), row]));
  if (entitlementActive(entitlement.get(person), nowMs)) {
    return { active: true, source: "own", partner_name: null };
  }

  const profile = new Map(profiles.map((row) => [String(row.id), row]));
  const mutualPartnersFor = (owner: string) =>
    links
      .filter((link) => link.status === "active" && (link.person_a === owner || link.person_b === owner))
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
      .map((link) => String(link.person_a === owner ? link.person_b : link.person_a))
      .filter((other) =>
        prefs.some((pref) =>
          pref.owner === owner && pref.other === other && pref.relationship === "partner"
        ) &&
        prefs.some((pref) => pref.owner === other && pref.other === owner && pref.relationship === "partner")
      );
  // A paying account shares with at most its first active mutual partner, so adding more "partner" labels cannot fan out a plan.
  const partner = mutualPartnersFor(person).find((other) =>
    entitlementActive(entitlement.get(other), nowMs) && mutualPartnersFor(other)[0] === person
  );
  if (!partner) return inactivePlan();
  return { active: true, source: "partner", partner_name: String(profile.get(partner)?.name ?? "Partner") };
}

export async function loadPlan(service: SupabaseClient, person: string, enabled: boolean): Promise<Plan> {
  if (!enabled) return inactivePlan();
  const { data: directLinks, error: linksError } = await service.from("links").select(
    "person_a,person_b,status,created_at",
  )
    .or(`person_a.eq.${person},person_b.eq.${person}`);
  if (linksError) dbError(linksError, "entitlements.links");
  const directPeople = [
    person,
    ...(directLinks ?? []).map((link) => String(link.person_a === person ? link.person_b : link.person_a)),
  ];
  const inList = directPeople.join(",");
  const { data: links, error: relatedLinksError } = await service.from("links").select(
    "person_a,person_b,status,created_at",
  )
    .or(`person_a.in.(${inList}),person_b.in.(${inList})`);
  if (relatedLinksError) dbError(relatedLinksError, "entitlements.related_links");
  const people = [
    ...new Set([person, ...(links ?? []).flatMap((link) => [String(link.person_a), String(link.person_b)])]),
  ];
  const [
    { data: prefs, error: prefsError },
    { data: profiles, error: profilesError },
    { data: entitlements, error: entitlementsError },
  ] = await Promise.all([
    service.from("link_prefs").select("owner,other,relationship").in("owner", people).in("other", people),
    service.from("profiles").select("id,name").in("id", people),
    service.from("subscription_entitlements").select("person,status,expires_at").in("person", people),
  ]);
  if (prefsError) dbError(prefsError, "entitlements.prefs");
  if (profilesError) dbError(profilesError, "entitlements.profiles");
  if (entitlementsError) dbError(entitlementsError, "entitlements.rows");
  return resolvePlanFromRows(person, links ?? [], prefs ?? [], profiles ?? [], entitlements ?? []);
}

/** Convert already signature-verified ASSN v2 transaction data into the only row Presence persists. */
export function entitlementFromVerifiedTransaction(
  notificationUuid: string,
  transaction: VerifiedTransaction,
  nowMs = Date.now(),
): EntitlementWrite | null {
  if (
    !UUID.test(notificationUuid) || !transaction.appAccountToken || !UUID.test(transaction.appAccountToken)
  ) return null;
  if (!transaction.productId || !PRODUCTS.has(transaction.productId) || !transaction.originalTransactionId) {
    return null;
  }
  // Presence does its own partner sharing. A transaction supplied through Apple's Family Sharing never grants an own entitlement.
  if (transaction.inAppOwnershipType !== "PURCHASED") return null;
  const revoked = typeof transaction.revocationDate === "number";
  const expires = typeof transaction.expiresDate === "number" ? transaction.expiresDate : null;
  const status = revoked ? "revoked" : expires !== null && expires <= nowMs ? "expired" : "active";
  return {
    person: transaction.appAccountToken,
    product_id: transaction.productId,
    original_transaction_id: transaction.originalTransactionId,
    status,
    expires_at: expires === null ? null : new Date(expires).toISOString(),
    app_environment: transaction.environment === "Production" ? "production" : "sandbox",
    last_notification_uuid: notificationUuid,
  };
}

/** Persist only data returned by a signature-verifying ASSN v2 adapter; never pass decoded-but-unverified JWS data here. */
export async function upsertVerifiedEntitlement(
  service: SupabaseClient,
  notificationUuid: string,
  transaction: VerifiedTransaction,
): Promise<boolean> {
  const row = entitlementFromVerifiedTransaction(notificationUuid, transaction);
  if (!row) return false;
  const { error } = await service.from("subscription_entitlements").upsert(row, { onConflict: "person" });
  if (error) dbError(error, "entitlements.upsert");
  return true;
}
