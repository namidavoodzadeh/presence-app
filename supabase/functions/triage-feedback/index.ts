// Off by default. No deployment is part of R8; tests inject both the store and classifier.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AnthropicClient } from "../../../next/engine/model/client.ts";
import {
  PostgresLedger,
  recordEngineCall,
} from "../../../next/api/lib/ledger.ts";
import {
  classificationPrompt,
  cloudTriageEnabled,
  type FeedbackRow,
  triageNewFeedback,
  type TriagePatch,
  type TriageStore,
} from "./triage.ts";

const MODEL = "claude-haiku-5-5";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

class SupabaseStore implements TriageStore {
  constructor(private readonly db: SupabaseClient) {}

  async newReports(): Promise<FeedbackRow[]> {
    const { data, error } = await this.db.rpc("feedback_triage_new");
    if (error) throw new Error(`triage_queue: ${error.message}`);
    return (data ?? []) as FeedbackRow[];
  }

  async triagedReports(): Promise<FeedbackRow[]> {
    const { data, error } = await this.db.rpc("feedback_triage_history", {
      p_limit: 500,
    });
    if (error) throw new Error(`feedback history: ${error.message}`);
    return (data ?? []) as FeedbackRow[];
  }

  async markTriaged(id: string, patch: TriagePatch): Promise<void> {
    const { data, error } = await this.db.rpc("feedback_triage_mark", {
      p_id: id,
      p_severity: patch.severity,
      p_area: patch.area,
      p_dedupe_key: patch.dedupe_key,
      p_bug_id: patch.bug_id,
      p_lane: patch.lane,
      p_triaged_at: patch.triaged_at,
    });
    if (error) throw new Error(`feedback update: ${error.message}`);
    if (!data) throw new Error(`feedback update lost race: ${id}`);
  }
}

function modelClassifier(db: SupabaseClient) {
  const ledger = new PostgresLedger(db, {
    person: null,
    ownerPreview: false,
    conversationId: null,
  });
  const client = new AnthropicClient({
    config: {
      key: required("ANTHROPIC_API_KEY"),
      workspace: required("ANTHROPIC_WORKSPACE_ID"),
    },
    ledger,
    defaultModel: MODEL,
    fallbackModel: null,
    thinking: "disabled",
    timeoutMs: 30_000,
  });
  return async (
    report: FeedbackRow,
    prior: FeedbackRow[],
  ): Promise<unknown> => {
    const ledgerIndex = ledger.ids.size;
    const exchange = await client.complete({
      purpose: "feedback_triage",
      system: "Classify tester reports. Return only the requested JSON object.",
      messages: [{
        role: "user",
        content: classificationPrompt(report, prior),
      }],
      maxTokens: 300,
    });
    await recordEngineCall(
      db,
      { person: null, ownerPreview: false, conversationId: null },
      exchange,
      [...ledger.ids.values()][ledgerIndex] ?? null,
    );
    if (exchange.error) throw new Error(`classifier: ${exchange.error}`);
    try {
      return JSON.parse(
        exchange.rawResponse.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""),
      );
    } catch {
      throw new Error("classifier returned invalid JSON");
    }
  };
}

export async function handler(): Promise<Response> {
  if (!cloudTriageEnabled(Deno.env.get("PRESENCE_CLOUD_TRIAGE"))) {
    return Response.json({ state: "off", triaged: 0 }, { status: 503 });
  }
  try {
    const db = createClient(
      required("SUPABASE_URL"),
      Deno.env.get("PRESENCE_SERVICE_KEY") || required("SUPABASE_SERVICE_ROLE_KEY"), // rotation: our own secret key first, legacy as the rollback
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const result = await triageNewFeedback(
      new SupabaseStore(db),
      modelClassifier(db),
    );
    return Response.json({ state: "ok", ...result });
  } catch (error) {
    return Response.json({
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

if (import.meta.main) Deno.serve(() => handler());
