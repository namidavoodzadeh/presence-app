import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  type Classification,
  classificationPrompt,
  cloudTriageEnabled,
  type FeedbackRow,
  triageNewFeedback,
  type TriagePatch,
  type TriageStore,
  validateClassification,
} from "../../supabase/functions/triage-feedback/triage.ts";

interface Fixture extends FeedbackRow {
  classification: Classification;
}
const fixtures = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/triage_feedback.json", import.meta.url),
  ),
) as Fixture[];

class FakeStore implements TriageStore {
  readonly updates: Array<{ id: string; patch: TriagePatch }> = [];
  constructor(
    readonly pending: FeedbackRow[],
    readonly prior: FeedbackRow[] = [],
  ) {}
  newReports() {
    return Promise.resolve(this.pending);
  }
  triagedReports() {
    return Promise.resolve(this.prior);
  }
  markTriaged(id: string, patch: TriagePatch) {
    this.updates.push({ id, patch });
    return Promise.resolve();
  }
}

Deno.test("cloud triage uses the R7 severity, area, lane and dedupe rules with mocked classifications", async () => {
  const store = new FakeStore(
    fixtures.map(({ classification: _classification, ...row }) => row),
  );
  const byId = new Map(
    fixtures.map((row) => [row.report_id, row.classification]),
  );
  const result = await triageNewFeedback(
    store,
    (report) => Promise.resolve(byId.get(report.report_id)),
    () => new Date("2026-11-02T08:00:00.000Z"),
  );
  assertEquals(result, {
    triaged: 3,
    ids: fixtures.map((row) => row.report_id),
  });
  assertEquals(store.updates.map((row) => row.patch.severity), [
    "P1",
    "P1",
    "P2",
  ]);
  assertEquals(store.updates.map((row) => row.patch.area), [
    "Talk",
    "Talk",
    "Map",
  ]);
  assertEquals(store.updates[1].patch.bug_id, store.updates[0].patch.bug_id);
  assertEquals(store.updates[2].patch.lane, "app2");
  assertEquals(
    store.updates.every((row) => row.patch.triage_status === "triaged"),
    true,
  );
});

Deno.test("invalid model output never marks a report triaged", async () => {
  const { classification: _classification, ...report } = fixtures[0];
  const store = new FakeStore([report]);
  await assertRejects(
    () =>
      triageNewFeedback(store, () =>
        Promise.resolve({
          severity: "urgent",
          area: "Talk",
          lane: "engine",
          dedupe_key: "talk-retry",
        })),
    Error,
    "invalid severity",
  );
  assertEquals(store.updates, []);
});

Deno.test("classification prompt carries the R7 definitions and prior dedupe evidence", () => {
  const prompt = classificationPrompt(fixtures[1], [{
    ...fixtures[0],
    dedupe_key: "talk-retry-does-not-send",
    bug_id: "QA-B40",
  }]);
  for (
    const text of [
      "P0 blocks use or loses data",
      "P1 means a core flow is wrong or annoying",
      "P2 is polish",
      "P3 is an idea or backlog item",
      '"severity":"P0|P1|P2|P3"',
      "talk-retry-does-not-send",
      "QA-B40",
    ]
  ) {
    assertStringIncludes(prompt, text);
  }
});

Deno.test("classification validator limits writes to known severity and lane values", () => {
  assertEquals(
    validateClassification(fixtures[0].classification),
    fixtures[0].classification,
  );
  assertThrows(
    () =>
      validateClassification({
        ...fixtures[0].classification,
        lane: "director",
      }),
    Error,
    "invalid lane",
  );
  assertThrows(
    () =>
      validateClassification({
        ...fixtures[0].classification,
        dedupe_key: "Same symptom",
      }),
    Error,
    "invalid dedupe_key",
  );
});

Deno.test("migration exposes only the triage update columns to the nologin worker role", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../supabase/migrations/0018_feedback_triage.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(
    sql,
    "create role feedback_triage_worker nologin noinherit",
  );
  assertStringIncludes(
    sql,
    "revoke all on all tables in schema public from feedback_triage_worker",
  );
  assertStringIncludes(
    sql,
    "grant select on public.feedback to feedback_triage_worker",
  );
  assertStringIncludes(
    sql,
    "grant update (triage_status, severity, area, dedupe_key, bug_id, lane, triaged_at)",
  );
  assertStringIncludes(
    sql,
    "create or replace view public.triage_queue with (security_invoker = true)",
  );
});

Deno.test("Edge Function server switch defaults off and no new secret name is introduced", async () => {
  assertEquals(cloudTriageEnabled(undefined), false);
  assertEquals(cloudTriageEnabled("false"), false);
  assertEquals(cloudTriageEnabled("true"), true);
  const source = await Deno.readTextFile(
    new URL(
      "../../supabase/functions/triage-feedback/index.ts",
      import.meta.url,
    ),
  );
  assertStringIncludes(
    source,
    'cloudTriageEnabled(Deno.env.get("PRESENCE_CLOUD_TRIAGE"))',
  );
  assertStringIncludes(source, 'required("ANTHROPIC_API_KEY")');
  assertStringIncludes(source, 'required("ANTHROPIC_WORKSPACE_ID")');
  assertStringIncludes(source, 'required("SUPABASE_SERVICE_ROLE_KEY")');
  assertStringIncludes(source, "new PostgresLedger");
});

Deno.test("Edge Function reaches feedback only through worker-owned RPCs", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../supabase/functions/triage-feedback/index.ts",
      import.meta.url,
    ),
  );
  assertEquals(source.includes('.from("feedback")'), false);
  assertEquals(source.includes('.from("triage_queue")'), false);
  for (
    const rpc of [
      "feedback_triage_new",
      "feedback_triage_history",
      "feedback_triage_mark",
    ]
  ) {
    assertStringIncludes(source, `.rpc("${rpc}"`);
  }

  const sql = await Deno.readTextFile(
    new URL(
      "../../supabase/migrations/0018_feedback_triage.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(
    sql,
    "alter function public.feedback_triage_new() owner to feedback_triage_worker",
  );
  assertStringIncludes(
    sql,
    "alter function public.feedback_triage_history(integer) owner to feedback_triage_worker",
  );
  assertStringIncludes(
    sql,
    "alter function public.feedback_triage_mark(uuid,text,text,text,text,text,timestamptz) owner to feedback_triage_worker",
  );
  assertStringIncludes(
    sql,
    "revoke all on function public.feedback_triage_mark(uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated",
  );
});
