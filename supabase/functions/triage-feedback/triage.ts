export const SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export const LANES = ["app", "app2", "engine", "qa"] as const;

export type Severity = typeof SEVERITIES[number];
export type Lane = typeof LANES[number];

export interface FeedbackRow {
  id: string;
  report_id: string;
  body: Record<string, unknown>;
  created_at: string;
  dedupe_key?: string | null;
  bug_id?: string | null;
}

export interface Classification {
  severity: Severity;
  area: string;
  lane: Lane;
  dedupe_key: string;
}

export interface TriagePatch extends Classification {
  triage_status: "triaged";
  bug_id: string;
  triaged_at: string;
}

export interface TriageStore {
  newReports(): Promise<FeedbackRow[]>;
  triagedReports(): Promise<FeedbackRow[]>;
  markTriaged(id: string, patch: TriagePatch): Promise<void>;
}

export type Classifier = (
  report: FeedbackRow,
  prior: FeedbackRow[],
) => Promise<unknown>;

export function cloudTriageEnabled(value: string | undefined): boolean {
  return value === "true";
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function classificationPrompt(
  report: FeedbackRow,
  prior: FeedbackRow[],
): string {
  const known = prior.map((row) => ({
    dedupe_key: row.dedupe_key,
    bug_id: row.bug_id,
    words: String(row.body.note ?? "").slice(0, 200),
  }));
  return `Classify this Presence tester report. Return one JSON object only.

Rules copied from the R7 triage contract:
- P0 blocks use or loses data.
- P1 means a core flow is wrong or annoying.
- P2 is polish.
- P3 is an idea or backlog item.
- area is a concise product area such as Talk, Bridge, Mirror, Map, dictation, onboarding, or engine.
- lane is app for native behavior, app2 for native visual craft, engine for server/AI, or qa for test infrastructure.
- dedupe_key is a stable lowercase kebab-case key for the symptom. Reuse a prior key only for the same symptom.
- exact shape: {"severity":"P0|P1|P2|P3","area":"...","lane":"app|app2|engine|qa","dedupe_key":"..."}.

Prior triage: ${JSON.stringify(known)}
Report: ${JSON.stringify({ report_id: report.report_id, body: report.body })}`;
}

export function validateClassification(value: unknown): Classification {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("classifier returned no object");
  }
  const row = value as Record<string, unknown>;
  const severity = clean(row.severity) as Severity;
  const lane = clean(row.lane) as Lane;
  const area = clean(row.area).replace(/\s+/g, " ");
  const dedupeKey = clean(row.dedupe_key).toLowerCase();
  if (!(SEVERITIES as readonly string[]).includes(severity)) {
    throw new Error("invalid severity");
  }
  if (!(LANES as readonly string[]).includes(lane)) {
    throw new Error("invalid lane");
  }
  if (!area || area.length > 80) throw new Error("invalid area");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dedupeKey) || dedupeKey.length > 100) {
    throw new Error("invalid dedupe_key");
  }
  return { severity, area, lane, dedupe_key: dedupeKey };
}

export function bugId(report: FeedbackRow): string {
  const compact = report.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)
    .toUpperCase();
  if (!compact) throw new Error("feedback id cannot form a bug id");
  return `FB-${compact}`;
}

export async function triageNewFeedback(
  store: TriageStore,
  classifier: Classifier,
  now: () => Date = () => new Date(),
): Promise<{ triaged: number; ids: string[] }> {
  const pending = await store.newReports();
  const prior = await store.triagedReports();
  const ids: string[] = [];
  for (const report of pending) {
    const classification = validateClassification(
      await classifier(report, prior),
    );
    const duplicate = prior.find((row) =>
      row.dedupe_key === classification.dedupe_key && row.bug_id
    );
    const patch: TriagePatch = {
      ...classification,
      triage_status: "triaged",
      bug_id: duplicate?.bug_id ?? bugId(report),
      triaged_at: now().toISOString(),
    };
    await store.markTriaged(report.id, patch);
    prior.push({ ...report, ...patch });
    ids.push(report.report_id);
  }
  return { triaged: ids.length, ids };
}
