import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  clearAllWaitingImports,
  hooks,
  type ImportRoundRow,
  importScoreEligible,
  matchingTalkBelief,
  parseLocalImportBody,
  personImportRound,
  requireImportAccess,
} from "../api/import_ai.ts";
import { RecordedClient } from "../engine/model/client.ts";
import { runImportStages } from "../engine/import_ai.ts";
import { ApiError } from "../api/lib/errors.ts";
import { importReceiptObject } from "../api/lib/objects.ts";
import { routes } from "../api/lib/router.ts";
import { ImportLedger } from "../api/lib/ledger.ts";
import { IMPORT_PREVIEW_OWNER_ID } from "../api/lib/env.ts";
import "../api/map.ts";

const OWNER_ID = "0fbbae71-cd59-4e6b-b303-323e9e3344cf";
const IMPORT_ENV = { importFromAi: true, importHosted: true, importOwnerId: "person" };
const OWNER_ENV = { ...IMPORT_ENV, importOwnerId: OWNER_ID };

Deno.test("E13 hosted import access is switched and restricted to the configured account id", () => {
  assertEquals(IMPORT_PREVIEW_OWNER_ID, OWNER_ID);
  requireImportAccess({ env: OWNER_ENV, caller: { id: OWNER_ID } } as never);
  for (
    const [env, id, reason] of [
      [{ ...OWNER_ENV, importFromAi: false }, OWNER_ID, "feature_off"],
      [OWNER_ENV, "partner", "owner_only"],
    ] as const
  ) {
    const error = assertThrows(
      () => requireImportAccess({ env, caller: { id } } as never),
      ApiError,
    );
    assertEquals(error.code, "forbidden");
    assertEquals(error.extra.reason, reason);
  }
});

Deno.test("E14 each realistic source yields 10+ cards, rates five, and places all five on the owner map", async () => {
  const local = routes.find((route) =>
    route.method === "POST" && route.keys.length === 0 && route.pattern.test("/imports/local")
  );
  assert(local);
  const map = routes.find((route) =>
    route.method === "GET" && route.keys.length === 0 && route.pattern.test("/map")
  );
  assert(map);
  const fixtures = JSON.parse(
    await Deno.readTextFile(new URL("fixtures/import_real_styles.json", import.meta.url)),
  ) as Array<{ source: "chatgpt" | "claude" | "gemini"; answer: string; labels: string[] }>;
  let lastService: { from: (table: string) => FakeQuery } | null = null;
  let lastGuesses: Record<string, unknown>[] = [];
  for (const fixture of fixtures) {
    const client = new RecordedClient({
      import_safety: ['{"risk":"none","reason":"none"}'],
      import_scrub: [JSON.stringify({ text: fixture.answer })],
      import_listener: [JSON.stringify({
        guesses: fixture.labels.map((label, index) => ({
          label,
          statement: `Part of you notices ${label.toLowerCase()} in this fictional answer.`,
          type: "how I tend to react",
          area: index % 2 ? "relationships" : "work",
          note: `The answer gives specific fictional evidence about ${label.toLowerCase()}.`,
        })),
      })],
    });
    const extracted = await runImportStages(client, fixture.answer, "Nami");
    assert(extracted.guesses.length >= 10, `${fixture.source}: ${extracted.guesses.length}`);
    const guesses = extracted.guesses.slice(0, 5).map((guess) => ({
      guess_id: guess.id,
      label: guess.label,
      statement: guess.statement,
      type: guess.type,
      area: guess.area,
      about: null,
      merge_key: guess.mergeKey,
      rating: "very",
    }));
    const tables: Record<string, FakeRow[]> = {
      ai_imports: [],
      ai_import_guesses: [],
      beliefs: [],
      receipts: [],
      belief_links: [],
      outside_perspectives: [],
    };
    const service = { from: (table: string) => new FakeQuery(table, tables[table] ??= []) };
    const response = await local.handler({
      env: OWNER_ENV,
      req: new Request("https://presence.invalid/imports/local", { method: "POST" }),
      url: new URL("https://presence.invalid/imports/local"),
      params: {},
      caller: { id: OWNER_ID, isPreview: true, db: service },
      service,
      tz: "Asia/Tehran",
      body: () => Promise.resolve({
        assistant: fixture.source,
        imported_at: "2026-11-04T08:30:00+03:30",
        knows_me: "some",
        guesses,
      }),
    } as never);
    assertEquals(response.status, 200, fixture.source);
    assertEquals((await response.json()).beliefs.length, 5, fixture.source);
    const mapResponse = await map.handler({
      env: OWNER_ENV,
      req: new Request("https://presence.invalid/map"),
      url: new URL("https://presence.invalid/map"),
      params: {},
      caller: { id: OWNER_ID, isPreview: true, db: service, profile: { map_seen_at: null } },
      service,
      tz: "Asia/Tehran",
      body: () => Promise.resolve({}),
    } as never);
    const mapBody = await mapResponse.json();
    assertEquals(mapBody.counts.confirmed, 5, fixture.source);
    assertEquals(mapBody.beliefs.length, 5, fixture.source);
    lastService = service;
    lastGuesses = guesses;
  }
  assert(lastService);

  const denied = await assertRejects(() =>
    local.handler({
      env: OWNER_ENV,
      req: new Request("https://presence.invalid/imports/local", { method: "POST" }),
      url: new URL("https://presence.invalid/imports/local"),
      params: {},
      caller: { id: "partner", isPreview: false, db: lastService },
      service: lastService,
      tz: "Asia/Tehran",
      body: () => Promise.resolve({ ...LOCAL_BODY, guesses: lastGuesses }),
    } as never)
  );
  assert(denied instanceof ApiError);
  assertEquals(denied.code, "forbidden");
  assertEquals(denied.extra.reason, "owner_only");
});

Deno.test("E13 import reservations use the ledger and stop at a separate 200-cent UTC-day cap", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rows = [{ reserved_micros: 1_990_000, spent_micros: null }];
  const query = {
    select: () => query,
    eq: () => query,
    then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
  };
  const db = {
    from: () => query,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data: { ok: true, id: "ledger-id" }, error: null });
    },
  };
  const ledger = new ImportLedger(db as never, {
    person: "person",
    ownerPreview: true,
    conversationId: null,
  });
  assertEquals(await ledger.reserve("over", "next-engine", 2), {
    ok: false,
    error: "daily_limit",
  });
  rows[0].reserved_micros = 1_980_000;
  assertEquals(await ledger.reserve("fits", "next-engine", 2), { ok: true });
  assertEquals(calls[0].name, "ledger_reserve");
  assertEquals(calls[0].args.p_kind, "import_ai");
});

Deno.test("E13 a safety stop makes no provider call and saves no import rows", async () => {
  const tables: Record<string, FakeRow[]> = {
    ai_imports: [],
    ai_import_guesses: [],
    ai_import_moments: [],
  };
  const service = { from: (table: string) => new FakeQuery(table, tables[table] ??= []) };
  const importRoute = routes.find((route) =>
    route.method === "POST" && route.keys.length === 0 && route.pattern.test("/imports/ai")
  );
  assert(importRoute);
  hooks.client = () => {
    throw new Error("provider must not be constructed for a preflight safety stop");
  };
  try {
    const response = await importRoute.handler({
      env: IMPORT_ENV,
      req: new Request("https://presence.invalid/imports/ai", { method: "POST" }),
      url: new URL("https://presence.invalid/imports/ai"),
      params: {},
      caller: { id: "person", isPreview: true, db: service },
      service,
      tz: "Asia/Tehran",
      body: () =>
        Promise.resolve({
          text: "Your partner controls the money.",
          source: "claude",
          imported_at: "2026-11-04T12:00:00Z",
          provider_disclosure: { provider: "anthropic", disclosed_at: "2026-11-04T12:00:00Z" },
        }),
    } as never);
    assertEquals((await response.json()).state, "safety");
    assertEquals(tables.ai_imports, []);
    assertEquals(tables.ai_import_guesses, []);
    assertEquals(tables.ai_import_moments, []);
  } finally {
    hooks.client = null;
  }
});

const LOCAL_BODY = {
  assistant: "Claude",
  imported_at: "2026-11-04T08:30:00+03:30",
  knows_me: "some",
  guesses: [{
    guess_id: "10000000-0000-4000-8000-000000000001",
    label: "Keeps peace",
    statement: "Part of you keeps the peace before asking for room.",
    type: "something I do to cope",
    area: "relationships",
    about: null,
    merge_key: "relationships:keeps-peace",
    rating: "partly",
  }],
};

Deno.test("E8 local import accepts only guarded structured guesses and rejects raw answers or AI notes", () => {
  const parsed = parseLocalImportBody(LOCAL_BODY);
  assertEquals(parsed.assistant, "Claude");
  assertEquals(parsed.importDate, "2026-11-04");
  assertEquals(parsed.guesses[0].wording, null);

  for (
    const body of [
      { ...LOCAL_BODY, text: "raw pasted answer" },
      { ...LOCAL_BODY, answer: "raw answer" },
      { ...LOCAL_BODY, raw_text: "raw answer" },
      { ...LOCAL_BODY, ai_note: "the source AI's note" },
      { ...LOCAL_BODY, guesses: [{ ...LOCAL_BODY.guesses[0], note: "the source AI's note" }] },
    ]
  ) {
    const error = assertThrows(() => parseLocalImportBody(body), ApiError);
    assertEquals(error.code, "invalid");
  }
});

function roundRow(
  id: string,
  mergeKey: string,
  statement: string,
  priority: number,
  assistant = "Claude",
  area = "relationships",
  about: string | null = null,
): ImportRoundRow {
  return {
    id,
    import_id: `import-${id}`,
    label: "Keeps peace",
    statement,
    type: "something I do to cope",
    area,
    about,
    merge_key: mergeKey,
    note: `server note ${id}`,
    priority,
    source_assistant: assistant,
    source: assistant.toLowerCase() === "chatgpt" ? "chatgpt" : "claude",
    source_date: "2026-11-04",
  };
}

Deno.test("E13 rounds merge distinct AI sources, keep conflicts, and spread areas", () => {
  const round = personImportRound([
    roundRow("m1", "merged", "Part of you keeps the peace.", 90),
    roundRow("m2", "merged", "Part of you keeps the peace.", 80, "ChatGPT"),
    roundRow("d1", "disagreement", "Part of you asks early.", 70),
    roundRow("d2", "disagreement", "Part of you waits before asking.", 60, "ChatGPT"),
    roundRow("held", "fourth", "Part of you checks once more.", 55),
    roundRow("o1", "ordinary", "Part of you prepares carefully.", 50, "Claude", "work"),
  ]);

  assertEquals(round.has_waiting, true);
  assertEquals(round.items.length, 3);
  assertEquals(round.items.map((item) => item.kind), ["merged", "disagreement", "ordinary"]);
  assertEquals(
    round.items.map((item) => item.kind === "disagreement" ? item.readings[0].area : item.reading.area),
    [
      "relationships",
      "relationships",
      "work",
    ],
  );
  const merged = round.items[0];
  assert(merged.kind === "merged");
  assertEquals(merged.agreement, {
    sources: 2,
    line: "2 of your AIs noticed this",
  });
  assertEquals(merged.confidence, 0.45);
  const disagreement = round.items[1];
  assert(disagreement.kind === "disagreement");
  assertEquals(disagreement.guess_ids, ["d1", "d2"]);
  assertEquals(disagreement.item_id, "d1");
  assertEquals(disagreement.readings.length, 2);
  assertEquals(disagreement.sources[1], {
    guess_id: "d2",
    import_id: "import-d2",
    assistant: "ChatGPT",
    date: "2026-11-04",
    note: "server note d2",
  });
  assertEquals(personImportRound([]), { items: [], has_waiting: false });
});

Deno.test("E17 done check (f): an 8-area fixture's first round covers at least min(5, areas with guesses) distinct areas", () => {
  const areas = ["relationships", "work", "body", "money", "meaning", "family", "politics", "morality"] as const;
  const rows = areas.map((area, index) => roundRow(`g${index}`, `area-${area}`, `A belief about ${area}.`, 90 - index, "Claude", area));
  const round = personImportRound(rows, true);
  assertEquals(round.items.length >= 5 && round.items.length <= 7, true);
  const distinctAreas = new Set(round.items.map((item) => item.kind === "disagreement" ? item.readings[0].area : item.reading.area));
  assertEquals(distinctAreas.size >= Math.min(5, areas.length), true);
});

Deno.test("E17 first round: top card per distinct area first, at most two per area, then fills by priority to 5-7", () => {
  const rows = [
    roundRow("w1", "w1", "Part of you worries about money.", 90, "Claude", "money"),
    roundRow("w2", "w2", "Part of you double-checks the budget.", 85, "Claude", "money"), // 2nd money item
    roundRow("w3", "w3", "Part of you plans ahead at work.", 80, "Claude", "work"),
    roundRow("f1", "f1", "Part of you keeps the peace at home.", 10, "Claude", "family"),
  ];
  const round = personImportRound(rows, true);
  // money's 2nd-best item only shows up after every distinct area has its first pick (w3, f1 before w2).
  assertEquals(round.items.map((item) => item.item_id), ["w1", "w3", "f1", "w2"]);
  const moneyCount = round.items.filter((item) => item.kind !== "disagreement" && item.reading.area === "money").length;
  assertEquals(moneyCount, 2);
});

Deno.test("E17 first round guarantees a me-lens and an others-lens card when both are available, within the 5-7 cap", () => {
  const mine = (id: string, area: string, priority: number) =>
    roundRow(id, id, `A belief about ${area}.`, priority, "Claude", area, "I handle it myself");
  const rows = [
    mine("body1", "body", 90),
    mine("money1", "money", 80),
    mine("work1", "work", 70),
    mine("meaning1", "meaning", 60),
    mine("politics1", "politics", 50),
    mine("morality1", "morality", 40),
    // Lowest priority, and the only others-lens card; shares an area already taken, so pass 1 alone would drop it.
    roundRow("body2", "body2", "Her opinion of me matters too much.", 10, "Claude", "body", "her opinion"),
  ];
  const round = personImportRound(rows, true);
  assertEquals(round.items.length, 7);
  assertEquals(round.items.some((item) => item.item_id === "body2"), true);
});

Deno.test("E17 later rounds collapse to at most three and prefer areas with no confirmed belief", () => {
  const rows = [
    roundRow("covered1", "covered1", "A belief in a covered area.", 90, "Claude", "relationships"),
    roundRow("thin1", "thin1", "A belief in a thin area.", 50, "Claude", "money"),
  ];
  const withNoPreference = personImportRound(rows, false);
  assertEquals(withNoPreference.items.map((item) => item.item_id), ["covered1", "thin1"]);

  const withThinPreference = personImportRound(rows, false, { thinAreas: new Set(["money"]) });
  assertEquals(withThinPreference.items.map((item) => item.item_id), ["thin1", "covered1"]);
  assertEquals(withThinPreference.items.length <= 3, true);
});

Deno.test("E13 an exact confirmed Talk belief wins over a matching AI reading", () => {
  const talk = {
    id: "talk-belief",
    source: "talk",
    status: "confirmed",
    area: "work",
    label: "Prepares early",
    statement: "Part of you prepares early.",
  };
  assertEquals(
    matchingTalkBelief([talk], {
      area: "work",
      label: " prepares EARLY ",
      statement: "Part of you prepares early",
    }),
    talk,
  );
  assertEquals(matchingTalkBelief([{ ...talk, status: "set_aside" }], talk), undefined);
});

Deno.test("E12 score eligibility counts only definite ratings on generic-check-surviving guesses", () => {
  assertEquals(
    importScoreEligible([
      { rating: "very" },
      { rating: "partly" },
      { rating: "not" },
    ]),
    true,
  );
  assertEquals(
    importScoreEligible([
      { rating: "very" },
      { rating: "partly" },
      { rating: null, status: "retired" },
      { status: "waiting" },
    ]),
    false,
  );
});

Deno.test("E12 GET round returns score eligibility even after no guesses remain waiting", async () => {
  const tables: Record<string, FakeRow[]> = {
    ai_import_guesses: ["very", "partly", "not"].map((rating, index) => ({
      id: `rated-${index}`,
      owner: "person",
      import_id: "i1",
      status: "rated",
      rating,
    })),
  };
  const service = { from: (table: string) => new FakeQuery(table, tables[table] ??= []) };
  const roundRoute = routes.find((route) =>
    route.method === "GET" && route.pattern.test("/imports/ai/round")
  );
  assert(roundRoute);
  const response = await roundRoute.handler({
    env: IMPORT_ENV,
    req: new Request("https://presence.invalid/imports/ai/round"),
    url: new URL("https://presence.invalid/imports/ai/round"),
    params: {},
    caller: { id: "person", isPreview: false, db: service },
    service,
    tz: "Asia/Tehran",
    body: () => Promise.resolve({}),
  } as never);
  assertEquals(await response.json(), { items: [], has_waiting: false, score_eligible: true });
});

type FakeRow = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  #kind: "select" | "update" | "insert" = "select";
  #changes: FakeRow = {};
  #inserted: FakeRow[] = [];
  #equals: Array<[string, unknown]> = [];
  #notEquals: Array<[string, unknown]> = [];
  #ins: Array<[string, unknown[]]> = [];
  #single = false;

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
    this.#inserted = (Array.isArray(value) ? value : [value]).map((row, index) => ({
      ...(this.table === "ai_imports" && !row.id ? { id: `local-import-${index + 1}` } : {}),
      ...row,
    }));
    return this;
  }

  eq(column: string, value: unknown) {
    this.#equals.push([column, value]);
    return this;
  }

  neq(column: string, value: unknown) {
    this.#notEquals.push([column, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.#ins.push([column, values]);
    return this;
  }

  order(_column: string) {
    return this;
  }

  single() {
    this.#single = true;
    return this;
  }

  maybeSingle() {
    this.#single = true;
    return this;
  }

  limit(_count: number) {
    return this;
  }

  #matches(row: FakeRow) {
    return this.#equals.every(([column, value]) => row[column] === value) &&
      this.#notEquals.every(([column, value]) => row[column] !== value) &&
      this.#ins.every(([column, values]) => values.includes(row[column]));
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

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.#run()).then(onfulfilled, onrejected);
  }
}

function roundAnswerService(tables: Record<string, FakeRow[]>) {
  return {
    from: (table: string) => new FakeQuery(table, tables[table] ??= []),
    rpc: (name: string, args: Record<string, unknown>) => {
      assertEquals(name, "rate_import_round_v2");
      const owner = String(args.p_owner);
      const answers = args.p_answers as Array<Record<string, unknown>>;
      const tensions = args.p_tensions as Array<{ first: string; second: string }>;
      const guesses = tables.ai_import_guesses;
      if (
        answers.some((answer) =>
          !guesses.some((guess) =>
            guess.id === answer.guess_id && guess.owner === owner && guess.status === "waiting"
          )
        )
      ) {
        return Promise.resolve({ data: null, error: { message: "not_found import_guess" } });
      }
      const beliefIds = new Set<string>();
      for (const answer of answers) {
        const guess = guesses.find((row) => row.id === answer.guess_id)!;
        const rating = String(answer.rating);
        if (rating === "skip") continue;
        if (rating === "not_sure") {
          guess.status = "retired";
          continue;
        }
        const batch = tables.ai_imports.find((row) => row.id === guess.import_id)!;
        const beliefKey = String(answer.belief_key ?? guess.merge_key ?? guess.id);
        let belief = tables.beliefs.find((row) =>
          row.owner === owner && row.source === "import" && row.import_merge_key === beliefKey
        );
        if (!belief) {
          belief = {
            id: guess.id,
            owner,
            label: guess.label,
            statement: answer.wording || guess.statement,
            type: guess.type,
            kind: "everyday",
            level: "L4",
            area: guess.area,
            domains: [guess.area === "relationships" ? "close_relationships" : guess.area],
            status: rating === "not" ? "set_aside" : "confirmed",
            rating,
            confidence: guess.confidence,
            source: "import",
            import_assistant: batch.source_assistant,
            import_date: batch.source_date,
            import_merge_key: beliefKey,
          };
          tables.beliefs.push(belief);
        } else {
          belief.rating = rating;
          belief.status = rating === "not" ? "set_aside" : "confirmed";
          belief.statement = answer.wording || guess.statement;
          belief.import_assistant = batch.source_assistant;
          belief.import_date = batch.source_date;
        }
        guess.status = "rated";
        guess.rating = rating;
        beliefIds.add(String(belief.id));
      }
      for (const tension of tensions) {
        tables.belief_links.push({
          owner,
          from_belief: tension.first,
          to_belief: tension.second,
          kind: "tension",
        });
      }
      return Promise.resolve({
        data: {
          belief_ids: [...beliefIds],
          saved: beliefIds.size,
          has_waiting: guesses.some((guess) => guess.owner === owner && guess.status === "waiting"),
          score_eligible: guesses.filter((guess) => ["not", "partly", "very"].includes(String(guess.rating)))
            .length >= 3,
        },
        error: null,
      });
    },
  };
}

function importTables(): Record<string, FakeRow[]> {
  return {
    ai_imports: [
      { id: "i1", owner: "person", source_assistant: "Claude", source_date: "2026-11-04" },
      { id: "i2", owner: "person", source_assistant: "ChatGPT", source_date: "2026-10-20" },
    ],
    ai_import_guesses: [],
    beliefs: [],
    belief_links: [],
    receipts: [],
    outside_perspectives: [],
  };
}

function waitingGuess(
  id: string,
  importId: string,
  mergeKey: string,
  statement: string,
  priority: number,
): FakeRow {
  return {
    id,
    import_id: importId,
    owner: "person",
    label: "Keeps peace",
    statement,
    type: "how I tend to react",
    area: "relationships",
    merge_key: mergeKey,
    note: "held note",
    status: "waiting",
    confidence: 0.7,
    priority,
  };
}

function roundAnswersRoute() {
  const found = routes.find((route) =>
    route.method === "POST" && route.pattern.test("/imports/ai/round/answers") && route.keys.length === 0
  );
  assert(found);
  return found;
}

async function postRoundAnswers(tables: Record<string, FakeRow[]>, body: Record<string, unknown>) {
  const service = roundAnswerService(tables);
  return await roundAnswersRoute().handler({
    env: IMPORT_ENV,
    req: new Request("https://presence.invalid/imports/ai/round/answers", { method: "POST" }),
    url: new URL("https://presence.invalid/imports/ai/round/answers"),
    params: {},
    caller: { id: "person", isPreview: false, db: service },
    service,
    tz: "Asia/Tehran",
    body: () => Promise.resolve(body),
  } as never);
}

Deno.test("E9 merged item spanning two imports is rated in one person-wide transaction", async () => {
  const tables = importTables();
  const first = "50000000-0000-4000-8000-000000000005";
  const second = "60000000-0000-4000-8000-000000000006";
  tables.ai_import_guesses.push(
    waitingGuess(first, "i1", "relationships:peace", "Part of you keeps the peace.", 90),
    waitingGuess(second, "i2", "relationships:peace", "Part of you keeps the peace.", 80),
  );
  const response = await postRoundAnswers(tables, {
    answers: [
      { guess_id: first, rating: "partly" },
      { guess_id: second, rating: "partly" },
    ],
    resolutions: [],
  });
  const reply = await response.json();

  assertEquals(reply.saved, 1);
  assertEquals(reply.has_waiting, false);
  assertEquals(reply.score_eligible, false);
  assertEquals(tables.beliefs.length, 1);
  assertEquals(tables.ai_import_guesses.map((row) => row.status), ["rated", "rated"]);
  assertEquals(reply.beliefs[0].import_receipt.date, "2026-10-20");
});

Deno.test("E12 a third definite round rating makes the score eligible; Not sure and Skip do not", async () => {
  const tables = importTables();
  for (let index = 1; index <= 5; index++) {
    tables.ai_import_guesses.push(
      waitingGuess(
        `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        "i1",
        `key-${index}`,
        `Reading ${index}.`,
        10 - index,
      ),
    );
  }
  const [first, second, third, fourth, fifth] = tables.ai_import_guesses.map((row) => String(row.id));
  const response = await postRoundAnswers(tables, {
    answers: [
      { guess_id: first, rating: "very" },
      { guess_id: second, rating: "partly" },
      { guess_id: third, rating: "not" },
      { guess_id: fourth, rating: "not_sure" },
      { guess_id: fifth, rating: "skip" },
    ],
    resolutions: [],
  });
  assertEquals((await response.json()).score_eligible, true);
  assertEquals(tables.ai_import_guesses.map((row) => row.rating ?? null), [
    "very",
    "partly",
    "not",
    null,
    null,
  ]);
});

Deno.test("E9 every disagreement choice resolves both readings and only both creates a tension", async () => {
  for (const choice of ["first", "second", "both", "neither"] as const) {
    const tables = importTables();
    const first = "70000000-0000-4000-8000-000000000007";
    const second = "80000000-0000-4000-8000-000000000008";
    tables.ai_import_guesses.push(
      waitingGuess(first, "i1", "relationships:ask", "Part of you asks early.", 90),
      waitingGuess(second, "i2", "relationships:ask", "Part of you waits before asking.", 80),
    );
    const response = await postRoundAnswers(tables, {
      answers: [],
      resolutions: [{ item_id: first, choice }],
    });
    const reply = await response.json();
    const expected = choice === "first"
      ? ["very", "not"]
      : choice === "second"
      ? ["not", "very"]
      : choice === "both"
      ? ["very", "very"]
      : ["not", "not"];

    assertEquals(tables.beliefs.map((row) => row.rating), expected, choice);
    assertEquals(tables.belief_links.length, choice === "both" ? 1 : 0, choice);
    assertEquals(reply.saved, 2, choice);
    assertEquals(reply.has_waiting, false, choice);
  }
});

Deno.test("E9 a foreign guess rejects the whole call before any write", async () => {
  const tables = importTables();
  const owned = "90000000-0000-4000-8000-000000000009";
  const foreign = "a0000000-0000-4000-8000-00000000000a";
  tables.ai_import_guesses.push(
    waitingGuess(owned, "i1", "relationships:owned", "Part of you asks clearly.", 90),
    { ...waitingGuess(foreign, "i2", "relationships:foreign", "Part of you waits.", 80), owner: "other" },
  );
  const error = await assertRejects(
    () =>
      postRoundAnswers(tables, {
        answers: [
          { guess_id: owned, rating: "very" },
          { guess_id: foreign, rating: "very" },
        ],
        resolutions: [],
      }),
    ApiError,
  );

  assertEquals(error.code, "not_found");
  assertEquals(tables.beliefs, []);
  assertEquals(tables.ai_import_guesses.map((row) => row.status), ["waiting", "waiting"]);
});

Deno.test("E9 not_sure retires, skip stays waiting, and the Import switch stays off", async () => {
  const tables = importTables();
  const notSure = "b0000000-0000-4000-8000-00000000000b";
  const skipped = "c0000000-0000-4000-8000-00000000000c";
  tables.ai_import_guesses.push(
    waitingGuess(notSure, "i1", "relationships:unsure", "Part of you pauses.", 90),
    waitingGuess(skipped, "i2", "relationships:skip", "Part of you checks.", 80),
  );
  const response = await postRoundAnswers(tables, {
    answers: [
      { guess_id: notSure, rating: "not_sure" },
      { guess_id: skipped, rating: "skip" },
    ],
    resolutions: [],
  });
  const reply = await response.json();
  assertEquals(tables.ai_import_guesses.map((row) => row.status), ["retired", "waiting"]);
  assertEquals(reply.saved, 0);
  assertEquals(reply.has_waiting, true);

  await assertRejects(
    () =>
      roundAnswersRoute().handler({
        env: { importFromAi: false },
        caller: { id: "person" },
        body: () => Promise.resolve({ answers: [], resolutions: [] }),
      } as never),
    ApiError,
    "forbidden",
  );
});

Deno.test("E8 clear-rest retires waiting guesses across two imports and returns no count", async () => {
  const tables: Record<string, FakeRow[]> = {
    ai_import_guesses: [
      { id: "g1", import_id: "i1", owner: "person", status: "waiting" },
      { id: "g2", import_id: "i2", owner: "person", status: "waiting" },
      { id: "g3", import_id: "i2", owner: "person", status: "rated" },
      { id: "other", import_id: "i3", owner: "someone-else", status: "waiting" },
    ],
    ai_imports: [
      { id: "i1", owner: "person", status: "active" },
      { id: "i2", owner: "person", status: "active" },
      { id: "i3", owner: "someone-else", status: "active" },
    ],
  };
  const service = { from: (table: string) => new FakeQuery(table, tables[table]) };
  const reply = await clearAllWaitingImports(
    service as never,
    "person",
    "2026-11-04T09:00:00.000Z",
  );

  assertEquals(reply, { cleared: true, has_waiting: false });
  assertEquals(tables.ai_import_guesses.map((row) => row.status), ["retired", "retired", "rated", "waiting"]);
  assertEquals(tables.ai_imports.map((row) => row.status), ["cleared", "cleared", "active"]);
});

Deno.test("E8 local route reconciles a matching server guess and returns one import belief with no Talk receipt", async () => {
  const serverGuessId = "20000000-0000-4000-8000-000000000002";
  const tables: Record<string, FakeRow[]> = {
    ai_imports: [{
      id: "server-import",
      owner: "person",
      source_assistant: "ChatGPT",
      source_date: "2026-10-20",
      status: "active",
    }],
    ai_import_guesses: [{
      id: serverGuessId,
      import_id: "server-import",
      owner: "person",
      label: "Keeps peace",
      statement: "Part of you keeps the peace before asking for room.",
      type: "something I do to cope",
      area: "relationships",
      note: "held server-side",
      status: "waiting",
      merge_key: "relationships:keeps-peace",
    }],
    beliefs: [],
    receipts: [],
    belief_links: [],
    outside_perspectives: [],
  };
  const service = { from: (table: string) => new FakeQuery(table, tables[table] ??= []) };
  const localRoute = routes.find((route) => route.method === "POST" && route.pattern.test("/imports/local"));
  assert(localRoute);
  const response = await localRoute.handler({
    env: IMPORT_ENV,
    req: new Request("https://presence.invalid/imports/local", { method: "POST" }),
    url: new URL("https://presence.invalid/imports/local"),
    params: {},
    caller: { id: "person", isPreview: false, db: service },
    service,
    tz: "Asia/Tehran",
    body: () => Promise.resolve(LOCAL_BODY),
  } as never);
  const reply = await response.json();

  assertEquals(response.status, 200);
  assertEquals(reply.beliefs.length, 1);
  assertEquals(reply.beliefs[0].belief_id, serverGuessId);
  assertEquals(reply.beliefs[0].source, "import");
  assertEquals(reply.beliefs[0].receipts, []);
  assertEquals(reply.beliefs[0].import_receipt, {
    kind: "import",
    line: "From your AI · 2026-11-04",
    date: "2026-11-04",
  });
  assertEquals(tables.beliefs.length, 1);
  assertEquals(tables.receipts, []);
  assertEquals(
    tables.ai_import_guesses.filter((row) => row.merge_key === "relationships:keeps-peace").map((row) =>
      row.status
    ),
    ["rated", "rated"],
  );
});

Deno.test("E8 server-side rating returns the same source-only import receipt", async () => {
  const importId = "30000000-0000-4000-8000-000000000003";
  const guessId = "40000000-0000-4000-8000-000000000004";
  const tables: Record<string, FakeRow[]> = {
    ai_imports: [{
      id: importId,
      owner: "person",
      source_assistant: "ChatGPT",
      source_date: "2026-10-20",
      status: "active",
    }],
    ai_import_guesses: [{
      id: guessId,
      import_id: importId,
      owner: "person",
      label: "Prepares early",
      statement: "Part of you prepares early so nothing gets missed.",
      type: "a rule I live by",
      area: "work",
      status: "waiting",
      merge_key: "work:prepares-early",
      confidence: 0.7,
    }],
    beliefs: [],
    receipts: [],
    belief_links: [],
    outside_perspectives: [],
  };
  const service = { from: (table: string) => new FakeQuery(table, tables[table] ??= []) };
  const answerRoute = routes.find((route) =>
    route.method === "POST" && route.pattern.test(`/imports/ai/${importId}/answers`)
  );
  assert(answerRoute);
  const response = await answerRoute.handler({
    env: IMPORT_ENV,
    req: new Request(`https://presence.invalid/imports/ai/${importId}/answers`, { method: "POST" }),
    url: new URL(`https://presence.invalid/imports/ai/${importId}/answers`),
    params: { id: importId },
    caller: { id: "person", isPreview: false, db: service },
    service,
    tz: "Asia/Tehran",
    body: () => Promise.resolve({ answers: [{ guess_id: guessId, rating: "very" }] }),
  } as never);
  const reply = await response.json();

  assertEquals(response.status, 200);
  assertEquals(reply.beliefs[0].source, "import");
  assertEquals(reply.beliefs[0].receipts, []);
  assertEquals(reply.beliefs[0].import_receipt, {
    kind: "import",
    line: "From your AI · 2026-10-20",
    date: "2026-10-20",
  });
  assertEquals(tables.beliefs[0].import_assistant, "ChatGPT");
  assertEquals(tables.beliefs[0].import_merge_key, "work:prepares-early");
  assertEquals(tables.ai_import_guesses[0].rating, "very");
});

Deno.test("E14 only a truly thin answer returns zero; two grounded guesses remain ready", async () => {
  const importRoute = routes.find((route) =>
    route.method === "POST" && route.keys.length === 0 && route.pattern.test("/imports/ai")
  );
  assert(importRoute);
  const names = ["Anchor", "Boundary", "Care"];
  const guess = (index: number) => ({
    label: names[index],
    statement: `Part of you notices ${names[index].toLowerCase()} in this fictional answer.`,
    type: "how I tend to react",
    area: "work",
    note: `A de-identified note about ${names[index].toLowerCase()}.`,
  });
  for (const [knowsMe, guessCount] of [["a little", 3], ["some", 2]] as const) {
    const tables: Record<string, FakeRow[]> = {
      profiles: [{ id: "person", name: "Ari" }],
      ai_imports: [],
      ai_import_guesses: [],
      ai_import_moments: [],
      engine_calls: [],
    };
    const service = { from: (table: string) => new FakeQuery(table, tables[table] ??= []) };
    hooks.client = () =>
      new RecordedClient({
        import_safety: ['{"risk":"none","reason":"none"}'],
        import_scrub: [
          knowsMe === "a little"
            ? '{"text":"KNOWS ME: a little"}'
            : `{"text":"KNOWS ME: ${knowsMe}\\nMOMENT 1:\\nWhat happened: A plan changed.\\nWhat you did or said: You made a new plan.\\nYour words: none\\nArea: work\\nPATTERN 1: Preparing carefully.\\nSeen: 2"}`,
        ],
        import_listener: [
          JSON.stringify({ guesses: Array.from({ length: guessCount }, (_, i) => guess(i)) }),
        ],
      });
    try {
      const response = await importRoute.handler({
        env: IMPORT_ENV,
        req: new Request("https://presence.invalid/imports/ai", { method: "POST" }),
        url: new URL("https://presence.invalid/imports/ai"),
        params: {},
        caller: { id: "person", isPreview: false, db: service },
        service,
        tz: "Asia/Tehran",
        body: () =>
          Promise.resolve({
            text: "fictional source answer",
            source: "claude",
            imported_at: "2026-11-04T12:00:00Z",
            provider_disclosure: { provider: "anthropic", disclosed_at: "2026-11-04T12:00:00Z" },
          }),
      } as never);
      const reply = await response.json();
      if (knowsMe === "a little") {
        assertEquals(reply, {
          state: "thin",
          import_id: null,
          created_at: null,
          guesses: [],
          score_eligible: false,
        });
        assertEquals(tables.ai_imports, []);
        assertEquals(tables.ai_import_guesses, []);
        assertEquals(tables.ai_import_moments, []);
      } else {
        assertEquals(reply.state, "ready");
        assertEquals(reply.guesses.length, 2);
        assertEquals(tables.ai_imports.length, 1);
        assertEquals(tables.ai_import_guesses.length, 2);
      }
    } finally {
      hooks.client = null;
    }
  }
});

Deno.test("E12 the private feel answer is accepted once per owned import", async () => {
  const feelRoute = routes.find((route) =>
    route.method === "POST" && route.pattern.test("/imports/ai/import-1/feel")
  );
  assert(feelRoute);
  let stored: string | null = null;
  const service = {
    rpc: (name: string, args: Record<string, unknown>) => {
      assertEquals(name, "answer_import_feel");
      assertEquals(args.p_owner, "person");
      if (stored !== null) {
        return Promise.resolve({ data: null, error: { message: "conflict already_answered" } });
      }
      stored = String(args.p_answer);
      return Promise.resolve({ data: true, error: null });
    },
  };
  const context = {
    env: IMPORT_ENV,
    req: new Request("https://presence.invalid/imports/ai/import-1/feel", { method: "POST" }),
    url: new URL("https://presence.invalid/imports/ai/import-1/feel"),
    params: { id: "import-1" },
    caller: { id: "person", isPreview: false, db: service },
    service,
    tz: "Asia/Tehran",
    body: () => Promise.resolve({ answer: "partly" }),
  };
  assertEquals(await (await feelRoute.handler(context as never)).json(), { saved: true });
  assertEquals(stored, "partly");
  const error = await assertRejects(() => feelRoute.handler(context as never), ApiError);
  assertEquals(error.code, "conflict");
  assertEquals(error.extra.reason, "already_answered");

  const migration = await Deno.readTextFile("../supabase/migrations/0026_import_finish.sql");
  assert(migration.includes("where id = p_import and owner = p_owner and feel_answer is null"));
  assert(migration.includes("revoke all on function public.answer_import_feel"));
});

Deno.test("E8 import receipt is source metadata only and the public routes replace the per-import round", async () => {
  assertEquals(importReceiptObject({ source: "import", import_date: "2026-11-04T00:00:00Z" }), {
    kind: "import",
    line: "From your AI · 2026-11-04",
    date: "2026-11-04",
  });
  assertEquals(importReceiptObject({ source: "talk", import_date: "2026-11-04" }), null);
  const migration = await Deno.readTextFile("../supabase/migrations/0024_import_contract_routes.sql");
  assert(!migration.includes("insert into public.receipts"));
  const transaction = await Deno.readTextFile("../supabase/migrations/0025_import_round_answers.sql");
  assert(transaction.includes("create or replace function public.rate_import_round"));
  assert(
    transaction.indexOf("raise exception 'not_found import_guess'") <
      transaction.indexOf("insert into public.beliefs"),
  );
  assert(
    transaction.includes(
      "grant execute on function public.rate_import_round(uuid, jsonb, jsonb) to service_role",
    ),
  );

  for (
    const [method, path] of [
      ["POST", "/imports/local"],
      ["GET", "/imports/ai/round"],
      ["POST", "/imports/ai/clear-rest"],
    ] as const
  ) {
    const registered = routes.find((route) => route.method === method && route.pattern.test(path));
    assert(registered, `${method} ${path}`);
    assertEquals(registered.auth, true);
  }
  assertEquals(
    routes.some((route) => route.method === "GET" && route.pattern.test("/imports/ai/an-import-id/round")),
    false,
  );
});

Deno.test("QA 01:40Z import: a stage that answers in prose, or a failed provider call, is the unavailable state, never a 500, and nothing is saved", async () => {
  const importRoute = routes.find((route) =>
    route.method === "POST" && route.keys.length === 0 && route.pattern.test("/imports/ai")
  );
  assert(importRoute);
  const prose = "I'm sorry, I can't help with that request.";
  const ok = { import_safety: ['{"risk":"none","reason":"none"}'], import_scrub: ['{"text":"KNOWS ME: some"}'], import_listener: ['{"guesses":[]}'] };
  const cases: Array<[string, () => RecordedClient | { complete: () => Promise<never>; model: string }]> = [
    ["safety stage in prose", () => new RecordedClient({ ...ok, import_safety: [prose] })],
    ["scrub stage in prose", () => new RecordedClient({ ...ok, import_scrub: [prose] })],
    ["listener stage in prose", () => new RecordedClient({ ...ok, import_listener: [prose] })],
    ["provider call fails", () => ({ model: "x", complete: () => Promise.reject(new Error("provider unreachable")) })],
  ];
  for (const [name, make] of cases) {
    const tables: Record<string, FakeRow[]> = {
      profiles: [{ id: "person", name: "Ari" }],
      ai_imports: [], ai_import_guesses: [], ai_import_moments: [], engine_calls: [], errors: [],
    };
    const service = { from: (table: string) => new FakeQuery(table, tables[table] ??= []) };
    hooks.client = make as never;
    try {
      const response = await importRoute.handler({
        env: IMPORT_ENV,
        req: new Request("https://presence.invalid/imports/ai", { method: "POST" }),
        url: new URL("https://presence.invalid/imports/ai"),
        params: {},
        caller: { id: "person", isPreview: false, db: service },
        service,
        tz: "Asia/Tehran",
        body: () =>
          Promise.resolve({
            text: "I could murder a curry right now, and I do not want to hurt my back lifting the sofa tonight",
            source: "claude",
            imported_at: "2026-11-04T12:00:00Z",
            provider_disclosure: { provider: "anthropic", disclosed_at: "2026-11-04T12:00:00Z" },
          }),
      } as never);
      assertEquals(response.status, 200, name);
      const reply = await response.json();
      assertEquals(reply.state, "unavailable", name);
      assertEquals(reply.guesses, [], name);
      assertEquals(reply.import_id, null, name);
      assertEquals(tables.ai_imports, [], name);
      assertEquals(tables.ai_import_guesses, [], name);
      assertEquals(tables.ai_import_moments, [], name);
      assertEquals(tables.errors.length, 1, name);          // the error's name and message only, for the next look
      assertEquals(tables.errors[0].code, "unavailable", name);
    } finally {
      hooks.client = null;
    }
  }
});
