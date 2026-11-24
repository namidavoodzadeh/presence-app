import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  APNS_TOPICS,
  apnsHeaders,
  apnsHost,
  apnsJwt,
  type PushEvent,
  pushPayload,
  sendApns,
} from "../api/push.ts";

function b64(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).match(/.{1,64}/g)!.join("\n");
}

async function env() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return {
    supabaseUrl: "https://example.invalid",
    anonKey: "anon",
    serviceRoleKey: "service",
    previewPassword: "preview",
    previewDeviceSecret: null,
    anthropicKey: null,
    anthropicWorkspace: null,
    apnsKeyId: "TESTKEY123",
    apnsTeamId: "UK39PYVJ96",
    apnsPrivateKey: `-----BEGIN PRIVATE KEY-----\n${b64(der)}\n-----END PRIVATE KEY-----`,
    pushDrainSecret: "drain",
    appleTeamId: null,
    appleKeyId: null,
    applePrivateKey: null,
    appleClientId: null,
    testerToken: "tester",
    isHosted: false,
    releaseBuild: false,
  };
}

const event: PushEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  owner: "22222222-2222-4222-8222-222222222222",
  device_id: "33333333-3333-4333-8333-333333333333",
  kind: "bridge_ready",
  subject_id: "44444444-4444-4444-8444-444444444444",
  route_target_id: "55555555-5555-4555-8555-555555555555",
  due_at: "2026-10-28T12:00:00.000Z",
  attempts: 1,
  token: "a".repeat(64),
  environment: "sandbox",
  bundle_id: APNS_TOPICS[1],
};

Deno.test("APNs JWT uses ES256, the configured key/team, and a current iat", async () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const token = await apnsJwt(await env(), now);
  const [h, c, s] = token.split(".");
  const decode = (v: string) =>
    JSON.parse(atob(v.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(v.length / 4) * 4, "=")));
  assertEquals(decode(h), { alg: "ES256", kid: "TESTKEY123" });
  assertEquals(decode(c), { iss: "UK39PYVJ96", iat: Math.floor(now / 1000) });
  assertMatch(s, /^[A-Za-z0-9_-]+$/);
});

Deno.test("payloads contain only localization and opaque routing fields, never message content", () => {
  for (const kind of ["bridge_ready", "bridge_reminder", "talk_reply_ready"] as const) {
    const text = JSON.stringify(pushPayload({ ...event, kind }));
    for (
      const forbidden of [
        "original",
        "bridged",
        "tone",
        "feeling",
        "length",
        "word",
        "receipt",
        "belief",
        "mirror",
        "quote",
        "name",
      ]
    ) {
      assert(!text.toLowerCase().includes(forbidden), `${kind} leaked ${forbidden}`);
    }
    assert(text.includes(event.route_target_id));
  }
});

Deno.test("arrived sound names only the Bridge-ready push; every other kind keeps the system default", () => {
  const ready = pushPayload({ ...event, kind: "bridge_ready" }) as { aps: { sound: string } };
  assertEquals(ready.aps.sound, "arrived.caf");
  for (const kind of ["bridge_reminder", "talk_reply_ready"] as const) {
    const other = pushPayload({ ...event, kind }) as { aps: { sound: string } };
    assertEquals(other.aps.sound, "default");
  }
});

Deno.test("Debug/QA use sandbox, TestFlight/release use production, with the approved topic", () => {
  assertEquals(apnsHost("sandbox"), "https://api.sandbox.push.apple.com");
  assertEquals(apnsHost("production"), "https://api.push.apple.com");
  const headers = apnsHeaders(event, "jwt");
  assertEquals(headers["apns-topic"], "com.namidavoodzadeh.presence.qa");
  assertEquals(headers["apns-collapse-id"], `bridge:${event.subject_id}`);
});

Deno.test("sender posts to APNs with token auth and does not put the device token in the payload", async () => {
  const e = await env();
  let url = "", init: RequestInit | undefined;
  const fake: typeof fetch = (input, options) => {
    url = String(input);
    init = options;
    return Promise.resolve(new Response(null, { status: 200, headers: { "apns-id": event.id } }));
  };
  const result = await sendApns(event, e, fake);
  assertEquals(result, { status: 200, reason: null, apnsId: event.id });
  assert(url.endsWith(`/3/device/${event.token}`));
  assertEquals((init!.headers as Record<string, string>)["apns-topic"], event.bundle_id);
  assert(!(init!.body as string).includes(event.token));
});

Deno.test("migration keeps token/outbox service-only and queues all three product events", async () => {
  const sql = await Deno.readTextFile(
    new URL("../../supabase/migrations/0011_apns_push.sql", import.meta.url),
  );
  assert(sql.includes("force row level security"));
  assert(sql.includes("revoke all on public.device_tokens from anon, authenticated"));
  for (const kind of ["bridge_ready", "bridge_reminder", "talk_reply_ready"]) {
    assert(sql.includes(`'${kind}'`));
  }
  assert(sql.includes("for update of p skip locked"));
  const schedule = await Deno.readTextFile(
    new URL("../../supabase/migrations/0012_apns_schedule.sql", import.meta.url),
  );
  const installer = await Deno.readTextFile(
    new URL("../scripts/configure_push_schedule.py", import.meta.url),
  );
  assert(schedule.includes("pg_cron") && schedule.includes("pg_net"));
  assert(installer.includes("vault.decrypted_secrets"));
  assert(installer.includes("'* * * * *'"));
});

Deno.test("bridge pushes carry the card id; talk and check-in pushes do not", () => {
  const card = "11111111-1111-4111-8111-111111111111";
  for (const kind of ["bridge_ready", "bridge_reminder"] as const) {
    const p = pushPayload({ ...event, kind, subject_id: card }) as { presence: Record<string, unknown> };
    assertEquals(p.presence.card_id, card);
    assertEquals(p.presence.route, "bridge_thread");
  }
  for (const kind of ["talk_reply_ready", "checkin_reminder"] as const) {
    const p = pushPayload({ ...event, kind, subject_id: card }) as { presence: Record<string, unknown> };
    assertEquals("card_id" in p.presence, false);
  }
});
