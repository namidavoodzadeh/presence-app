// Issue #6 hosted probe, written in C4 from packages/01 (routes.md "Not ready" 4, flows/read.md) and CONTRACT "Cards
// (v1.41; migration 0038)" only. A test pair sends a card, the receiver keeps it, and the card shows kept for both.
//
//   deno run --allow-net --allow-env next/tests/hosted/card_keep_probe.ts
//
// Inputs (see README.md): PRESENCE_API_URL, SUPABASE_ANON_KEY,
//   PROBE_SENDER_TOKEN, PROBE_RECEIVER_TOKEN  access tokens of two test accounts with an active link
// The probe sends one short card from the sender to the receiver (deliver_at "now"); it stays in the test pair's thread.

const NEED = ["PRESENCE_API_URL", "SUPABASE_ANON_KEY", "PROBE_SENDER_TOKEN", "PROBE_RECEIVER_TOKEN"];
const missing = NEED.filter((k) => !Deno.env.get(k));
if (missing.length) {
  console.error(`card_keep_probe: missing ${missing.join(", ")}. Nothing was called.`);
  Deno.exit(2);
}
const BASE = Deno.env.get("PRESENCE_API_URL")!.replace(/\/$/, "");
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SENDER = Deno.env.get("PROBE_SENDER_TOKEN")!;
const RECEIVER = Deno.env.get("PROBE_RECEIVER_TOKEN")!;

type R = Record<string, unknown>;
async function call(token: string, method: string, path: string, body?: R): Promise<{ status: number; body: R }> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, apikey: ANON, "Content-Type": "application/json",
      "X-Presence-Client": "probe/card_keep", "X-Presence-TZ": "UTC",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: R = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: parsed };
}
const ok2 = (s: number) => s >= 200 && s < 300;
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail: string) => results.push([name, ok, detail]);
function finish(): never {
  for (const [name, ok, detail] of results) console.log(`${ok ? "ok  " : "FAIL"} ${name} (${detail})`);
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed ? `FAIL: ${failed} of ${results.length}` : `PASS: ${results.length} checks`);
  Deno.exit(failed ? 1 : 0);
}
const personId = (b: R) => ((b.me as R | undefined)?.person as R | undefined)?.id as string | undefined;

const sMe = await call(SENDER, "GET", "/me");
const rMe = await call(RECEIVER, "GET", "/me");
const senderId = personId(sMe.body), receiverId = personId(rMe.body);
check("both test accounts answer GET /me", ok2(sMe.status) && ok2(rMe.status) && !!senderId && !!receiverId,
  `status ${sMe.status}/${rMe.status}`);
if (!senderId || !receiverId) finish();

const words = `Probe card ${new Date().toISOString()}: thank you for waiting for me.`;
const sent = await call(SENDER, "POST", "/bridges", {
  person_id: receiverId, original: words, bridged: null, final: words, used: "mine", show_original: false,
  heads_up: true, deliver_at: "now", tz: "UTC", reply_to: null,
});
const bridgeId = (sent.body.bridge as R | undefined)?.id as string | undefined;
check("sender: POST /bridges sends now", ok2(sent.status) && !!bridgeId, `status ${sent.status}`);
if (!bridgeId) finish();

const opened = await call(RECEIVER, "POST", `/bridges/${bridgeId}/open`);
check("receiver: POST /bridges/:id/open returns the words", ok2(opened.status) && JSON.stringify(opened.body).includes(words),
  `status ${opened.status}`);

const kept = await call(RECEIVER, "PATCH", `/cards/${bridgeId}`, { state: "kept" });
const card = kept.body.card as R | undefined;
check("receiver: PATCH /cards/:bridge_id {state: kept}", ok2(kept.status) && card?.state === "kept", `status ${kept.status}`);

const findCard = (b: R) => [...((b.cards as R[] | undefined) ?? []), ...((b.closed as R[] | undefined) ?? [])]
  .find((c) => c.bridge_id === bridgeId);
const rCards = await call(RECEIVER, "GET", `/cards/${senderId}`);
const rc = findCard(rCards.body);
check("receiver: the card reads kept, set by me", ok2(rCards.status) && rc?.state === "kept" && rc?.state_by === "me" &&
  rc?.direction === "received", `status ${rCards.status}, state ${rc?.state}, by ${rc?.state_by}`);
const sCards = await call(SENDER, "GET", `/cards/${receiverId}`);
const sc = findCard(sCards.body);
check("sender: the same card reads kept, set by them", ok2(sCards.status) && sc?.state === "kept" && sc?.state_by === "them" &&
  sc?.direction === "sent", `status ${sCards.status}, state ${sc?.state}, by ${sc?.state_by}`);

finish();
