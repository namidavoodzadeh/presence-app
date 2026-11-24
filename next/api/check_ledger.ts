// $0 check of the Postgres ledger adapter and the engine_calls trace: reserve 1¢, settle 0¢, write one trace row, read both
// back through the service client, then remove the two check rows it made. No model call.
//   deno run --allow-net --allow-read --allow-env next/api/check_ledger.ts
import { loadEnv } from "./lib/env.ts";
import { serviceClient } from "./lib/db.ts";
import { PostgresLedger, recordEngineCall } from "./lib/ledger.ts";
import type { ModelExchange } from "../engine/types.ts";

const env = await loadEnv();
const db = serviceClient(env);
const ledger = new PostgresLedger(db, { person: null, ownerPreview: false, conversationId: null });
const a = await ledger.reserve("chk-1", "check", 1);
await ledger.settle("chk-1", 0, "check-receipt", "none");
const id = ledger.ids.get("chk-1") ?? null;
const exchange: ModelExchange = { purpose: "check", request: { model: "none", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 1 },
  rawResponse: "{}", usage: { model: "none", inputTokens: 0, outputTokens: 0, cents: 0, ms: 1 } };
await recordEngineCall(db, { person: null, ownerPreview: false }, exchange, id, null);
const { data: row } = await db.from("usage_ledger").select("kind,reserved_micros,spent_micros,model,settled_at").eq("id", id!).single();
const { data: calls } = await db.from("engine_calls").select("id,purpose,model,cents,ledger_id").eq("ledger_id", id!);
console.log("reserve ok:", a.ok, "| ledger row:", JSON.stringify(row), "| engine_calls rows:", calls?.length, JSON.stringify(calls?.[0]));
// a refusal path: 3,000¢ worst case must be refused as daily_limit with opens_at
const big = new PostgresLedger(db, { person: null, ownerPreview: false });
const r = await big.reserve("chk-2", "check", 3000);
const err = big.refusalError("talk");
console.log("3000¢ refused:", !r.ok, r.error, "→", err.code, JSON.stringify(err.extra));
await db.from("engine_calls").delete().eq("ledger_id", id!);
await db.from("usage_ledger").delete().eq("id", id!);
const { count } = await db.from("usage_ledger").select("*", { count: "exact", head: true }).eq("kind", "check");
console.log("check rows left:", count);
