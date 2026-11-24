// E25: the check-in API (CONTRACT §6A) against a fake database and a recorded model client. Park it, the week's
// list, done and reschedule, writer-only, behind PRESENCE_CHECK_IN. $0: the model is always RecordedClient, never
// a live call, and the keyword-caught cases below never reach the model at all.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { RecordedClient } from "../engine/model/client.ts";
import { ApiError } from "../api/lib/errors.ts";
import { routes } from "../api/lib/router.ts";
import { hooks } from "../api/checkin.ts";
import "../api/checkin.ts";

const WRITER = "00000000-0000-4000-8000-000000000041";
const PARTNER = "00000000-0000-4000-8000-000000000042";
const STRANGER = "00000000-0000-4000-8000-000000000043";
const ON_ENV = { checkIn: true };
const OFF_ENV = { checkIn: false };

function analyseReply(safety: "none" | "risk" | "threat_or_abuse", text = "") {
  return JSON.stringify({
    // checkAnalysis requires an exact-substring quote when safety is "none" (its "no points found" rule), so the
    // fixture's one point is the whole message, which is always an exact substring of itself.
    points: safety === "none" ? [{ kind: "complaint", quote: text }] : [],
    frictions: [],
    activated: [],
    feeling: { name: "neutral", intensity: 1 },
    safety: { level: safety, reason: "fixture" },
  });
}

type FakeRow = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  #kind: "select" | "update" | "insert" = "select";
  #changes: FakeRow = {};
  #inserted: FakeRow[] = [];
  #equals: Array<[string, unknown]> = [];
  #single = false;
  #nextId = 1;

  constructor(private table: string, private rows: FakeRow[]) {}

  select(_columns: string) {
    return this;
  }
  update(changes: FakeRow) {
    this.#kind = "update";
    this.#changes = changes;
    return this;
  }
  insert(value: FakeRow | FakeRow[]) {
    this.#kind = "insert";
    const now = new Date().toISOString();
    this.#inserted = (Array.isArray(value) ? value : [value]).map((row) => ({
      id: row.id ?? `${this.table}-${this.#nextId++}`,
      state: row.state ?? "parked",
      created_at: row.created_at ?? now,
      updated_at: row.updated_at ?? now,
      ...row,
    }));
    return this;
  }
  eq(column: string, value: unknown) {
    this.#equals.push([column, value]);
    return this;
  }
  maybeSingle() {
    this.#single = true;
    return this;
  }
  single() {
    this.#single = true;
    return this;
  }
  #matches(row: FakeRow) {
    return this.#equals.every(([column, value]) => row[column] === value);
  }
  #run() {
    let matched: FakeRow[];
    if (this.#kind === "insert") {
      this.rows.push(...this.#inserted);
      matched = this.#inserted;
    } else {
      matched = this.rows.filter((row) => this.#matches(row));
      if (this.#kind === "update") { for (const row of matched) Object.assign(row, this.#changes); }
    }
    const copied = matched.map((row) => ({ ...row }));
    return { data: this.#single ? copied[0] ?? null : copied, error: null as null };
  }
  then<T>(resolve: (v: { data: unknown; error: null }) => T) {
    return Promise.resolve(resolve(this.#run()));
  }
}

function fakeClient(tables: Record<string, FakeRow[]>) {
  return { from: (table: string) => new FakeQuery(table, tables[table] ??= []) };
}

function baseTables(): Record<string, FakeRow[]> {
  const a = WRITER < PARTNER ? WRITER : PARTNER, b = WRITER < PARTNER ? PARTNER : WRITER;
  return {
    links: [{ person_a: a, person_b: b, status: "active" }],
    parked_notes: [],
    link_prefs: [],
    engine_calls: [],
  };
}

function call(
  path: string,
  method: string,
  body: FakeRow,
  caller: string,
  tables: Record<string, FakeRow[]>,
  env = ON_ENV,
) {
  const found = routes.find((r) => r.method === method && r.pattern.test(path));
  assert(found, `no route for ${method} ${path}`);
  const match = found.pattern.exec(path)!;
  const params: Record<string, string> = {};
  found.keys.forEach((k, i) => params[k] = match[i + 1]);
  const service = fakeClient(tables);
  return found.handler({
    env,
    req: new Request("https://presence.invalid" + path, { method }),
    url: new URL("https://presence.invalid" + path),
    params,
    caller: { id: caller, isPreview: false, db: service },
    service,
    tz: "Asia/Tehran",
    body: () => Promise.resolve(body),
  } as never);
}

async function rejects(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof ApiError);
    return e;
  }
  throw new Error("expected an ApiError");
}

function withModel(safety: "none" | "risk" | "threat_or_abuse", text: string, fn: () => Promise<void>) {
  hooks.client = () => new RecordedClient({ analyse: [analyseReply(safety, text)] });
  return fn().finally(() => {
    hooks.client = null;
  });
}

Deno.test("E25 the feature switch off is forbidden before any lookup", async () => {
  const tables = baseTables();
  const error = await rejects(() =>
    call(`/checkin/${PARTNER}/notes`, "POST", { text: "hi" }, WRITER, tables, OFF_ENV)
  );
  assertEquals(error.code, "forbidden");
  assertEquals(error.extra.reason, "feature_off");
  assertEquals(tables.parked_notes.length, 0);
});

Deno.test("E25 a stranger with no link cannot park a note", async () => {
  const tables = baseTables();
  const error = await rejects(() =>
    call(`/checkin/${STRANGER}/notes`, "POST", { text: "hi" }, WRITER, tables)
  );
  assertEquals(error.code, "not_found");
  assertEquals(error.extra.where, "link");
});

Deno.test("E25 Park it stores an ordinary note writer-only, after the model clears it", () =>
  withModel("none", "We keep missing each other on plans.", async () => {
    const tables = baseTables();
    const res = await call(
      `/checkin/${PARTNER}/notes`,
      "POST",
      { text: "We keep missing each other on plans." },
      WRITER,
      tables,
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.state, "parked");
    assertEquals(body.note.state, "parked");
    assertEquals(body.note.person_id, PARTNER);
    assertEquals(body.note.source, { kind: "note", id: body.note.id });
    assertEquals(body.line, null);
    assertEquals(tables.parked_notes.length, 1);
    assertEquals(tables.parked_notes[0].writer, WRITER);
    assertEquals(tables.parked_notes[0].partner, PARTNER);
    assertEquals(tables.parked_notes[0].source, { kind: "note", id: body.note.id });
    assertEquals(tables.engine_calls.length, 1, "the safety read is traced like any other engine call");
  }));

Deno.test("E25 an empty or oversized note is invalid and nothing is stored, with no model call", async () => {
  const tables = baseTables();
  for (const text of ["", "   ", "x".repeat(4001)]) {
    const error = await rejects(() => call(`/checkin/${PARTNER}/notes`, "POST", { text }, WRITER, tables));
    assertEquals(error.code, "invalid");
    assertEquals(error.extra.field, "text");
  }
  assertEquals(tables.parked_notes.length, 0);
});

Deno.test("E25 a keyword-caught risk sign never reaches the model, never parks, and nothing is stored (law 8)", async () => {
  const tables = baseTables();
  const res = await call(
    `/checkin/${PARTNER}/notes`,
    "POST",
    { text: "I want to kill myself tonight." },
    WRITER,
    tables,
  );
  const body = await res.json();
  assertEquals(body.state, "risk");
  assertEquals(body.note, null);
  assert(typeof body.line === "string" && body.line.length > 0);
  assert(body.resources);
  assertEquals(tables.parked_notes.length, 0);
  assertEquals(tables.engine_calls.length, 0, "the keyword floor alone decided; no model call was made");
});

Deno.test("E25 a partner-harm note the model reads as risk never parks; only the writer gets resources (TQ3/law 8)", () =>
  withModel("risk", "My partner threatened me after I said no.", async () => {
    const tables = baseTables();
    const res = await call(
      `/checkin/${PARTNER}/notes`,
      "POST",
      { text: "My partner threatened me after I said no." },
      WRITER,
      tables,
    );
    const body = await res.json();
    assertEquals(body.state, "risk");
    assertEquals(body.note, null);
    assert(body.resources);
    assertEquals(tables.parked_notes.length, 0);
  }));

Deno.test("E25 the writer's own outbound threat is declined, not treated as the writer being at risk", () =>
  withModel("threat_or_abuse", "I'll make them regret this.", async () => {
    const tables = baseTables();
    const res = await call(
      `/checkin/${PARTNER}/notes`,
      "POST",
      { text: "I'll make them regret this." },
      WRITER,
      tables,
    );
    const body = await res.json();
    assertEquals(body.state, "declined");
    assertEquals(body.note, null);
    assertEquals(body.resources, null);
    assertEquals(tables.parked_notes.length, 0);
  }));

Deno.test("E25 the week's list is writer-only and ordered parked, later, then talked", async () => {
  const tables = baseTables();
  tables.parked_notes.push(
    {
      id: "n1",
      writer: WRITER,
      partner: PARTNER,
      text: "a",
      state: "talked",
      created_at: "2026-11-01T00:00:00.000Z",
      updated_at: "2026-11-01T00:00:00.000Z",
    },
    {
      id: "n2",
      writer: WRITER,
      partner: PARTNER,
      text: "b",
      state: "later",
      created_at: "2026-11-02T00:00:00.000Z",
      updated_at: "2026-11-02T00:00:00.000Z",
    },
    {
      id: "n3",
      writer: WRITER,
      partner: PARTNER,
      text: "c",
      state: "parked",
      created_at: "2026-11-03T00:00:00.000Z",
      updated_at: "2026-11-03T00:00:00.000Z",
    },
    {
      id: "n4",
      writer: WRITER,
      partner: PARTNER,
      text: "d",
      state: "parked",
      created_at: "2026-11-02T12:00:00.000Z",
      updated_at: "2026-11-02T12:00:00.000Z",
    },
    {
      id: "n5",
      writer: PARTNER,
      partner: WRITER,
      text: "not mine",
      state: "parked",
      created_at: "2026-11-03T00:00:00.000Z",
      updated_at: "2026-11-03T00:00:00.000Z",
    },
  );
  const res = await call(`/checkin/${PARTNER}`, "GET", {}, WRITER, tables);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.notes.map((n: FakeRow) => n.id), ["n4", "n3", "n2", "n1"]);
  for (const n of body.notes) assertEquals(n.person_id, PARTNER);
});

// QA-B437: the agenda can only open an editor when the response carries the exact source chosen when the item was
// saved. A missing source is intentionally inert: matching the item's text could open the wrong private thing.
Deno.test("QA-B437 returns every explicit check-in source and leaves legacy items without a route", async () => {
  const tables = baseTables();
  tables.parked_notes.push(
    {
      id: "private-note-item", writer: WRITER, partner: PARTNER, text: "Private note", state: "parked",
      created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z",
      source: { kind: "note", id: "private-note-id" },
    },
    {
      id: "conversation-item", writer: WRITER, partner: PARTNER, text: "Talk source", state: "parked",
      created_at: "2026-11-02T00:00:00.000Z", updated_at: "2026-11-02T00:00:00.000Z",
      source: { kind: "conversation", id: "conversation-id" },
    },
    {
      id: "card-item", writer: WRITER, partner: PARTNER, text: "Card source", state: "later",
      created_at: "2026-11-03T00:00:00.000Z", updated_at: "2026-11-03T00:00:00.000Z",
      source: { kind: "card", id: "card-id" },
    },
    {
      id: "legacy-item", writer: WRITER, partner: PARTNER, text: "Older item", state: "later",
      created_at: "2026-11-04T00:00:00.000Z", updated_at: "2026-11-04T00:00:00.000Z",
    },
  );

  const res = await call(`/checkin/${PARTNER}`, "GET", {}, WRITER, tables);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.notes.map((n: FakeRow) => ({ id: n.id, source: n.source })), [
    { id: "private-note-item", source: { kind: "note", id: "private-note-id" } },
    { id: "conversation-item", source: { kind: "conversation", id: "conversation-id" } },
    { id: "card-item", source: { kind: "card", id: "card-id" } },
    { id: "legacy-item", source: null },
  ]);
});

Deno.test("E25 done and reschedule update only the writer's own note", async () => {
  const tables = baseTables();
  tables.parked_notes.push({
    id: "n1",
    writer: WRITER,
    partner: PARTNER,
    text: "a",
    state: "parked",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
  });
  const talked = await call("/checkin/notes/n1", "PATCH", { state: "talked" }, WRITER, tables);
  const talkedBody = await talked.json();
  assertEquals(talkedBody.note.state, "talked");

  const rescheduled = await call("/checkin/notes/n1", "PATCH", { state: "later" }, WRITER, tables);
  const rescheduledBody = await rescheduled.json();
  assertEquals(rescheduledBody.note.state, "later");

  const invalid = await rejects(() =>
    call("/checkin/notes/n1", "PATCH", { state: "parked" }, WRITER, tables)
  );
  assertEquals(invalid.code, "invalid");
  assertEquals(invalid.extra.field, "state");

  const notMine = await rejects(() =>
    call("/checkin/notes/n1", "PATCH", { state: "talked" }, STRANGER, tables)
  );
  assertEquals(notMine.code, "not_found");
  assertEquals(notMine.extra.where, "note");
});

function editTables(origin = "note") {
  const tables = baseTables();
  tables.parked_notes.push({
    id: "e1", writer: WRITER, partner: PARTNER, text: "first words", state: "later", origin, origin_ref: null,
    created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z",
  });
  return tables;
}

Deno.test("v1.73 PATCH text rewords the writer's own note and keeps origin, state and created_at", () =>
  withModel("none", "second words", async () => {
    const tables = editTables();
    const res = await call("/checkin/notes/e1", "PATCH", { text: "second words" }, WRITER, tables);
    const body = await res.json();
    assertEquals(body.state, "ok");
    assertEquals(body.note.text, "second words");
    assertEquals(body.note.state, "later");
    assertEquals(body.note.origin, "note");
    assertEquals(body.note.created_at, "2026-11-01T00:00:00.000Z");
    assertEquals(tables.parked_notes[0].text, "second words");
    assertEquals(tables.parked_notes[0].created_at, "2026-11-01T00:00:00.000Z");
  }));

Deno.test("v1.73 PATCH text: another user gets 404 and the text is unchanged", async () => {
  const tables = editTables();
  const e = await rejects(() => call("/checkin/notes/e1", "PATCH", { text: "x" }, STRANGER, tables));
  assertEquals(e.code, "not_found");
  assertEquals(tables.parked_notes[0].text, "first words");
});

Deno.test("v1.73 PATCH text: a keyword-caught risk sign leaves the text unchanged, no model call (law 8)", async () => {
  const tables = editTables();
  const res = await call("/checkin/notes/e1", "PATCH", { text: "I want to kill myself tonight." }, WRITER, tables);
  const body = await res.json();
  assertEquals(body.state, "risk");
  assertEquals(body.note, null);
  assert(body.resources);
  assertEquals(tables.parked_notes[0].text, "first words");
  assertEquals(tables.parked_notes[0].updated_at, "2026-11-01T00:00:00.000Z");
  assertEquals(tables.engine_calls.length, 0);
});

Deno.test("v1.73 PATCH text: a model-read risk or an outbound threat leaves the text unchanged", async () => {
  for (const [level, expected] of [["risk", "risk"], ["threat_or_abuse", "declined"]] as const) {
    await withModel(level, "edited", async () => {
      const tables = editTables();
      const res = await call("/checkin/notes/e1", "PATCH", { text: "edited" }, WRITER, tables);
      const body = await res.json();
      assertEquals(body.state, expected);
      assertEquals(body.note, null);
      assertEquals(tables.parked_notes[0].text, "first words");
    });
  }
});

Deno.test("v1.73 PATCH text: invalid bodies and a parked bridge's words are refused", async () => {
  const tables = editTables();
  for (const body of [{ text: "" }, { text: "   " }, { text: 5 }, { text: "x".repeat(4001) }, { text: "ok", state: "talked" }]) {
    const e = await rejects(() => call("/checkin/notes/e1", "PATCH", body as FakeRow, WRITER, tables));
    assertEquals(e.code, "invalid");
  }
  const bridged = editTables("bridged");
  const e = await rejects(() => call("/checkin/notes/e1", "PATCH", { text: "new" }, WRITER, bridged));
  assertEquals(e.code, "conflict");
  assertEquals(bridged.parked_notes[0].text, "first words");
  assertEquals(tables.parked_notes[0].text, "first words");
});
