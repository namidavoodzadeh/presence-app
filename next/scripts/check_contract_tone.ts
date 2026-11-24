// Hosted, $0 verification for CONTRACT v1.22. It creates one throwaway account, seeds fictional rows directly,
// checks both Card and Belief response shapes, and deletes the account and all of its rows before exiting.
import { createClient } from "npm:@supabase/supabase-js@2";
import { serviceClient } from "../api/lib/db.ts";
import { loadEnv } from "../api/lib/env.ts";

type Row = Record<string, unknown>;

const env = await loadEnv();
const service = serviceClient(env);
const base = `${env.supabaseUrl}/functions/v1/api`;
const stamp = Date.now().toString(36);
const email = `check-tone-${stamp}@preview.presence.app`;
const password = `check-tone-${stamp}-${crypto.randomUUID()}`;
const results: { name: string; ok: boolean; note: string }[] = [];
let userId: string | null = null;

function check(name: string, ok: boolean, note: string) {
  results.push({ name, ok, note });
}

async function get(path: string, token: string) {
  const response = await fetch(base + path, {
    headers: { apikey: env.anonKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json() as Row;
  return { status: response.status, body };
}

try {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`create throwaway: ${created.error?.message ?? "no user"}`);
  }
  userId = created.data.user.id;
  const profile = await service.from("profiles").insert({
    id: userId,
    name: "Tone Check",
    is_example: false,
    is_preview: false,
  });
  if (profile.error) throw new Error(`create profile: ${profile.error.message}`);

  const conversation = await service.from("conversations").insert({
    owner: userId,
    title: "A changed plan",
    status: "finished",
  }).select("id").single();
  if (conversation.error || !conversation.data) {
    throw new Error(`create conversation: ${conversation.error?.message}`);
  }
  const message = await service.from("messages").insert({
    owner: userId,
    conversation_id: conversation.data.id,
    role: "me",
    turn: 1,
    text: "The plan changed and nobody asked me.",
  }).select("id").single();
  if (message.error || !message.data) throw new Error(`create message: ${message.error?.message}`);
  const belief = await service.from("beliefs").insert({
    owner: userId,
    conversation_id: conversation.data.id,
    label: "Not included",
    statement: "Part of you may feel left out when plans change without you.",
    type: "something I believe is true",
    kind: "foundation",
    area: "relationships",
    domains: ["self", "close_relationships"],
    birth_mood: "lonely",
    confidence: 0.78,
    status: "guess",
  }).select("id").single();
  if (belief.error || !belief.data) throw new Error(`create belief: ${belief.error?.message}`);
  const receipt = await service.from("receipts").insert({
    owner: userId,
    belief_id: belief.data.id,
    message_id: message.data.id,
    conversation_id: conversation.data.id,
    quote: "nobody asked me",
  });
  if (receipt.error) throw new Error(`create receipt: ${receipt.error.message}`);

  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(`sign in throwaway: ${signed.error?.message}`);
  const token = signed.data.session.access_token;

  const conversationReply = await get(`/conversations/${conversation.data.id}`, token);
  const cards = (conversationReply.body.unrated as Row[]) ?? [];
  check(
    "hosted Card carries neutral tone",
    conversationReply.status === 200 && cards.length === 1 && cards[0].tone === 0,
    `status=${conversationReply.status} cards=${cards.length} tone=${String(cards[0]?.tone)}`,
  );

  const mapReply = await get("/map", token);
  const beliefs = (mapReply.body.beliefs as Row[]) ?? [];
  check(
    "hosted Belief carries neutral tone",
    mapReply.status === 200 && beliefs.length === 1 && beliefs[0].tone === 0,
    `status=${mapReply.status} beliefs=${beliefs.length} tone=${String(beliefs[0]?.tone)}`,
  );
} catch (error) {
  check("verification completed", false, error instanceof Error ? error.message : String(error));
} finally {
  if (userId) {
    const deleted = await service.auth.admin.deleteUser(userId);
    check("throwaway account deleted", !deleted.error, deleted.error?.message ?? "deleted");
    const { count } = await service.from("profiles").select("id", { count: "exact", head: true }).eq(
      "id",
      userId,
    );
    check("throwaway rows removed", count === 0, `profiles=${count}`);
  }
}

for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.note}`);
Deno.exit(results.every((result) => result.ok) ? 0 : 1);
