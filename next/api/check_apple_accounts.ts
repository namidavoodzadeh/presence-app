// $0 hosted check for the real-account boundary. It creates only fictional throwaway password users, exercises the same profile,
// pairing and deletion paths an Apple-authenticated account uses after token verification, then removes every test row.
// No owner/example account and no model call is used.
//   deno run --allow-env --allow-read --allow-net next/api/check_apple_accounts.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { serviceClient } from "./lib/db.ts";
import { loadEnv } from "./lib/env.ts";

type Row = Record<string, unknown>;
interface Account {
  id: string;
  token: string;
}

const env = await loadEnv();
const service = serviceClient(env);
const base = `${env.supabaseUrl}/functions/v1/api`;
const made = new Set<string>();
const results: { step: string; ok: boolean; note: string }[] = [];

function step(name: string, ok: boolean, note: string) {
  results.push({ step: name, ok, note });
  console.log(ok ? "PASS" : "FAIL", name, note);
}

async function call(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(base + path, {
    method,
    headers: {
      apikey: env.anonKey,
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  let json: Row = {};
  try {
    json = await response.json();
  } catch { /* status is enough */ }
  return { status: response.status, json };
}

async function account(name: string): Promise<Account> {
  const suffix = crypto.randomUUID();
  const email = `siwa-check-${suffix}@example.invalid`;
  const password = `Check-${suffix}-9a!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${name}: ${created.error?.message}`);
  const id = created.data.user.id;
  made.add(id);
  const profile = await service.from("profiles").insert({
    id,
    name,
    is_example: false,
    is_preview: false,
    auth_provider: "apple",
    adult_confirmed_at: new Date().toISOString(),
    terms_version: "2026-10-29",
  });
  if (profile.error) throw new Error(`profile ${name}: ${profile.error.message}`);
  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(`sign in ${name}: ${signed.error?.message}`);
  return { id, token: signed.data.session.access_token };
}

try {
  const missingAdult = await call("POST", "/auth/apple", {
    identity_token: "fictional.invalid.token",
    nonce: "fictional-nonce",
  });
  step(
    "Apple envelope requires the O02 adult confirmation",
    missingAdult.status === 400 && missingAdult.json.error === "invalid" &&
      missingAdult.json.field === "adult_confirmed",
    `status=${missingAdult.status} error=${missingAdult.json.error} field=${missingAdult.json.field}`,
  );
  const invalidToken = await call("POST", "/auth/apple", {
    identity_token: "fictional.invalid.token",
    nonce: "fictional-nonce",
    adult_confirmed: true,
  });
  step(
    "Supabase Apple verification refuses an invalid credential",
    invalidToken.status === 401 && invalidToken.json.error === "unauthorized",
    `status=${invalidToken.status} error=${invalidToken.json.error}`,
  );

  const a = await account("Apple Check A");
  const b = await account("Apple Check B");
  const invite = await call("POST", "/invites", {}, a.token);
  const accepted = await call("POST", `/invites/${invite.json.code}/accept`, {}, b.token);
  const [peopleA, peopleB] = await Promise.all([
    call("GET", "/people", undefined, a.token),
    call("GET", "/people", undefined, b.token),
  ]);
  step(
    "two real profiles pair by invite",
    invite.status === 200 && accepted.status === 200 && (peopleA.json.people as unknown[])?.length === 1 &&
      (peopleB.json.people as unknown[])?.length === 1,
    `invite=${invite.status} accept=${accepted.status} people=${
      (peopleA.json.people as unknown[])?.length ?? 0
    }/${(peopleB.json.people as unknown[])?.length ?? 0}`,
  );
  for (const item of [a, b]) {
    const removed = await service.auth.admin.deleteUser(item.id);
    if (removed.error) throw removed.error;
    made.delete(item.id);
  }
  const pairProfiles = await service.from("profiles").select("id", { count: "exact", head: true }).in(
    "id",
    [a.id, b.id],
  );
  step(
    "ordinary Auth deletion cascades throwaway profiles",
    pairProfiles.count === 0,
    `profiles_left=${pairProfiles.count}`,
  );

  const c = await account("Apple Delete Check");
  const deleted = await call("DELETE", "/account", undefined, c.token);
  const after = await call("GET", "/me", undefined, c.token);
  const authGone = await service.auth.admin.getUserById(c.id);
  const tombstone = await service.from("profiles").select("name,deleted_at").eq("id", c.id).maybeSingle();
  step(
    "DELETE /account removes Auth access and retains only the anonymised tombstone",
    deleted.status === 200 && after.status === 401 && !!authGone.error &&
      tombstone.data?.name === "Deleted account" &&
      !!tombstone.data?.deleted_at,
    `delete=${deleted.status} bearer_after=${after.status} auth_gone=${!!authGone.error} tombstone=${
      tombstone.data?.name === "Deleted account"
    }`,
  );
  await service.from("profiles").delete().eq("id", c.id);
  made.delete(c.id);
} finally {
  for (const id of made) {
    await service.from("profiles").delete().eq("id", id);
    await service.auth.admin.deleteUser(id);
  }
}

const passed = results.filter((result) => result.ok).length;
console.log(`${passed}/${results.length} passed; $0; fictional throwaway accounts removed`);
Deno.exit(passed === results.length ? 0 : 1);
