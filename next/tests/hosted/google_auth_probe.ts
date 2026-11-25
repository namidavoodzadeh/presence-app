// Issue #7 hosted probe, written in C4 from packages/01 (routes.md "Not ready" 5, flows/sign-in.md) and CONTRACT §3
// `POST /auth/google` only. Sign-in returns a session; a sign-in without the adult confirmation is refused; an unverified
// Google email is refused.
//
//   deno run --allow-net --allow-env next/tests/hosted/google_auth_probe.ts
//
// Inputs (see README.md): PRESENCE_API_URL, SUPABASE_ANON_KEY,
//   PROBE_GOOGLE_ID_TOKEN, PROBE_GOOGLE_NONCE   a fresh ID token of a Google test account and the raw nonce it was made with
//   PROBE_GOOGLE_UNVERIFIED_ID_TOKEN, PROBE_GOOGLE_UNVERIFIED_NONCE   optional: the same for a test account whose email
//                                                is not verified; without them that check is reported as skipped
//
// Under 18 (flows/sign-in.md): the app sends nothing at all, so the server-side form of that refusal is the same as
// "unconfirmed": `adult_confirmed` missing or not the literal `true` → 400 invalid, field adult_confirmed, and no session.

const NEED = ["PRESENCE_API_URL", "SUPABASE_ANON_KEY", "PROBE_GOOGLE_ID_TOKEN", "PROBE_GOOGLE_NONCE"];
const missing = NEED.filter((k) => !Deno.env.get(k));
if (missing.length) {
  console.error(`google_auth_probe: missing ${missing.join(", ")}. Nothing was called.`);
  Deno.exit(2);
}
const BASE = Deno.env.get("PRESENCE_API_URL")!.replace(/\/$/, "");
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ID_TOKEN = Deno.env.get("PROBE_GOOGLE_ID_TOKEN")!;
const NONCE = Deno.env.get("PROBE_GOOGLE_NONCE")!;
const UNVERIFIED = Deno.env.get("PROBE_GOOGLE_UNVERIFIED_ID_TOKEN");
const UNVERIFIED_NONCE = Deno.env.get("PROBE_GOOGLE_UNVERIFIED_NONCE");

type R = Record<string, unknown>;
async function signIn(body: R): Promise<{ status: number; body: R }> {
  const res = await fetch(BASE + "/auth/google", {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json", "X-Presence-Client": "probe/google_auth", "X-Presence-TZ": "UTC" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: R = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: "(not JSON)" }; }
  return { status: res.status, body: parsed };
}
const noSession = (b: R) => !("access_token" in b) && !("refresh_token" in b);
const echoes = (b: R, secret: string) => JSON.stringify(b).includes(secret);
const results: [string, boolean | "skipped", string][] = [];
const check = (name: string, ok: boolean | "skipped", detail: string) => results.push([name, ok, detail]);

// Refusals first, so a single-use credential is not spent before them.
const unconfirmed = await signIn({ id_token: ID_TOKEN, nonce: NONCE });
check("no adult_confirmed: 400 invalid, field adult_confirmed, no session",
  unconfirmed.status === 400 && unconfirmed.body.error === "invalid" && unconfirmed.body.field === "adult_confirmed" &&
    noSession(unconfirmed.body), `status ${unconfirmed.status}`);
const notTrue = await signIn({ id_token: ID_TOKEN, nonce: NONCE, adult_confirmed: "true" });
check("adult_confirmed not the literal true: 400 invalid, no session",
  notTrue.status === 400 && notTrue.body.error === "invalid" && noSession(notTrue.body), `status ${notTrue.status}`);
const declinedAge = await signIn({ id_token: ID_TOKEN, nonce: NONCE, adult_confirmed: false });
check("adult_confirmed false (under 18): 400 invalid, no session",
  declinedAge.status === 400 && declinedAge.body.error === "invalid" && noSession(declinedAge.body), `status ${declinedAge.status}`);

if (UNVERIFIED && UNVERIFIED_NONCE) {
  const u = await signIn({ id_token: UNVERIFIED, nonce: UNVERIFIED_NONCE, adult_confirmed: true });
  check("unverified Google email: 401 unauthorized, no session",
    u.status === 401 && u.body.error === "unauthorized" && noSession(u.body), `status ${u.status}`);
} else {
  check("unverified Google email: 401 unauthorized", "skipped", "no unverified test account given");
}

const wrongNonce = await signIn({ id_token: ID_TOKEN, nonce: NONCE + "-wrong", adult_confirmed: true });
check("wrong nonce: 401, no session", wrongNonce.status === 401 && noSession(wrongNonce.body), `status ${wrongNonce.status}`);

const ok = await signIn({ id_token: ID_TOKEN, nonce: NONCE, adult_confirmed: true });
const me = ok.body.me as R | undefined;
check("sign-in returns a session",
  ok.status === 200 && typeof ok.body.access_token === "string" && typeof ok.body.refresh_token === "string" &&
    typeof ok.body.expires_at === "string" && typeof ok.body.created === "boolean" && !!me,
  `status ${ok.status}`);
check("no reply echoes the credential",
  ![unconfirmed, notTrue, declinedAge, wrongNonce, ok].some((r) => echoes(r.body, ID_TOKEN) || echoes(r.body, NONCE)),
  "id_token and nonce absent from every reply");

for (const [name, res, detail] of results) {
  console.log(`${res === "skipped" ? "skip" : res ? "ok  " : "FAIL"} ${name} (${detail})`);
}
const failed = results.filter(([, r]) => r === false).length;
const skipped = results.filter(([, r]) => r === "skipped").length;
console.log(failed ? `FAIL: ${failed} of ${results.length}` : `PASS: ${results.length - skipped} checks, ${skipped} skipped`);
Deno.exit(failed ? 1 : 0);
