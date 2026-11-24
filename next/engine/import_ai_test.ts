import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  chunkImportText,
  IMPORT_LISTENER,
  IMPORT_SAFETY,
  IMPORT_SCRUB,
  importConfidence,
  importMergeKey,
  importRound,
  initialImportRound,
  isThinImportAnswer,
  parsePsyPromptV1,
  preflightImportSafety,
  readGuesses,
  readSafety,
  readScrub,
  redactImportExchange,
  repeatImportPrompt,
  runImportStages,
  stripImportClinical,
} from "./import_ai.ts";
import { RecordedClient } from "./model/client.ts";
import { loadMap } from "../api/lib/state.ts";

Deno.test("import stages are explicitly safety then scrub then listener", () => {
  assertStringIncludes(IMPORT_SAFETY, "Do not extract");
  assertStringIncludes(IMPORT_SCRUB, "identifying detail");
  assertStringIncludes(IMPORT_LISTENER, "already safety-screened");
  assertEquals(readSafety('{"risk":"self","reason":"direct"}').risk, "self");
});

Deno.test("R14 import preflight stops minors, source-AI safety messages, and partner fear/control privately", () => {
  assertEquals(preflightImportSafety("You are 17 and still deciding."), {
    risk: "minor",
    reason: "under_18",
  });
  assertEquals(preflightImportSafety("If you are in immediate danger, call emergency services."), {
    risk: "self",
    reason: "source_ai_safety_message",
  });
  assertEquals(preflightImportSafety("You said you are afraid of your partner."), {
    risk: "partner",
    reason: "partner_fear_control_violence",
  });
  assertEquals(preflightImportSafety("Your partner controls the money."), {
    risk: "partner",
    reason: "partner_fear_control_violence",
  });
  assertEquals(preflightImportSafety("You took control of the project schedule.").risk, "none");
});

Deno.test("E13 refusal/no-access/no-memory answers are thin before extraction", () => {
  for (
    const text of [
      "I can't share that information.",
      "I don't have access to previous chats.",
      "I have no memory of our conversations.",
    ]
  ) assertEquals(isThinImportAnswer(text), true);
  assertEquals(isThinImportAnswer("KNOWS ME: some\nPATTERN 1: You prepare early."), false);
});

Deno.test("R14 clinical words are stripped silently from structured import fields", () => {
  assertEquals(
    stripImportClinical("anxious perfectionism and burnout shaped the week"),
    "and shaped the week",
  );
});

Deno.test("actual pipeline stops after safety and redacts traces", async () => {
  const stoppedClient = new RecordedClient({ import_safety: ['{"risk":"self","reason":"direct"}'] });
  const stopped = await runImportStages(stoppedClient, "raw private text", "Nami");
  assertEquals(stopped.risk, "self");
  assertEquals(stopped.exchanges.map((e) => e.purpose), ["import_safety"]);
  const redacted = redactImportExchange(stopped.exchanges[0]);
  assertEquals(JSON.stringify(redacted).includes("raw private text"), false);
  assertEquals(JSON.stringify(redacted).includes("direct"), false);
});

Deno.test("actual pipeline calls safety, scrub, listener in order", async () => {
  const client = new RecordedClient({
    import_safety: ['{"risk":"none","reason":"none"}'],
    import_scrub: [
      '{"text":"KNOWS ME: some\\nMOMENT 1:\\nWhat happened: A plan changed.\\nWhat you did or said: You made a new plan.\\nYour words: none\\nArea: work\\nPATTERN 1: Making a new plan.\\nSeen: 2"}',
    ],
    import_listener: ['{"guesses":[]}'],
  });
  const result = await runImportStages(client, "source", "Nami");
  assertEquals(result.exchanges.map((e) => e.purpose), ["import_safety", "import_scrub", "import_listener"]);
  assertEquals(result.psy?.moments.length, 1);
});

Deno.test("scrub and listener remove names without a per-import guess cap", () => {
  const scrubbed = readScrub('{"text":"At work Jordan said this on 2026-10-01."}', "Nami");
  assertEquals(scrubbed.includes("Jordan"), false);
  assertEquals(scrubbed.includes("2026"), false);
  const guesses = readGuesses(
    JSON.stringify({
      guesses: Array.from({ length: 30 }, (_, i) => ({
        label: `Pattern ${i}`,
        statement: "Part of you keeps things steady.",
        type: "a rule I live by",
        area: "work",
        note: "Jordan noticed this at Acme.",
      })),
    }),
    "Nami",
    (() => {
      let n = 0;
      return () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
    })(),
  );
  assertEquals(guesses.length, 30);
  assertEquals(guesses.some((g) => g.note.includes("Jordan") || g.note.includes("Acme")), false);
  assertEquals(guesses[0].label.split(/\s+/)[0], "Pattern");
});

Deno.test("R14 PSY prompt v1 parses five fictional item 8 fixtures into structured rows", async () => {
  const fixtures = JSON.parse(
    await Deno.readTextFile(new URL("../tests/fixtures/import_psy_v1.json", import.meta.url)),
  ) as Array<{ id: string; text: string; expected_risk?: string }>;
  assertEquals(fixtures.length, 5);
  const clear = fixtures.filter((fixture) => preflightImportSafety(fixture.text).risk === "none");
  const stopped = fixtures.filter((fixture) => preflightImportSafety(fixture.text).risk !== "none");
  assertEquals(clear.length, 4);
  assertEquals(stopped.map((fixture) => [fixture.id, fixture.expected_risk]), [["teacher", "self"]]);
  const parsed = clear.map((fixture) => ({ id: fixture.id, value: parsePsyPromptV1(fixture.text) }));
  for (const { value } of parsed) {
    assert(value.moments.length > 0);
  }
  assertEquals(parsed[0].value.moments[0], {
    whatHappened: "A relative needed help during a busy week.",
    whatTheyDidOrSaid: "You organised the practical details and kept working.",
    aiWords: "If I stop, it all stops.",
    area: "family",
  });
  assertEquals(parsed[0].value.themes[0].l0Candidate, true);
  assertEquals(parsed[1].value.themes[0].l0Candidate, false);
  assertEquals(parsed[2].value.themes[0].tensionCandidate, true);
});

Deno.test("R14 corrected $0 rubric: AI notes count as marked import evidence and the risk fixture makes no cards", async () => {
  const fixtures = JSON.parse(
    await Deno.readTextFile(new URL("../tests/fixtures/import_psy_v1.json", import.meta.url)),
  ) as Array<{ id: string; text: string }>;
  for (const fixture of fixtures) {
    const floor = preflightImportSafety(fixture.text);
    if (fixture.id === "teacher") {
      assertEquals(floor.risk, "self");
      continue;
    }
    const parsed = parsePsyPromptV1(fixture.text);
    assert(parsed.moments.length > 0);
    assert(parsed.themes.length + parsed.rules.length + parsed.patterns.length + parsed.matters.length > 0);
    assertEquals(
      parsed.moments.every((moment) => {
        const text = JSON.stringify(moment);
        return stripImportClinical(text) === text;
      }),
      true,
    );
  }
  const migration = await Deno.readTextFile(
    new URL("../../supabase/migrations/0023_ai_import_flow.sql", import.meta.url),
  );
  assertStringIncludes(migration, "source_mark text not null default 'from_your_ai'");
});

Deno.test("R14 import confidence is code-owned from Seen and KNOWS ME", () => {
  const parsed = parsePsyPromptV1(
    "KNOWS ME: some\nPATTERN 1: Keeping plans flexible.\nSeen: 2\nCONFIDENCE: 0.99",
  );
  assertEquals(parsed.patterns[0].confidence, importConfidence("some", 2));
  assertEquals(parsed.patterns[0].confidence, 0.55);
});

Deno.test("E14 KNOWS ME may move, but a labelled answer without it is invalid", () => {
  let message = "";
  try {
    parsePsyPromptV1("MOMENT 1:\nPATTERN 1: You prepare early.");
  } catch (error) {
    message = String(error);
  }
  assertStringIncludes(message, "psy_v1_knows_me_missing");
});

Deno.test("E14 labelled answers tolerate markdown, numbering, and reordered sections", () => {
  const parsed = parsePsyPromptV1(`
## Themes
1. **THEME 1:** You prepare before asking for help.
- Seen: 3
### Familiarity
**KNOWS ME:** some
2) **PATTERN 1** — You check details twice before sending work.
Seen — 2
`);
  assertEquals(parsed.knowsMe, "some");
  assertEquals(parsed.themes.length, 1);
  assertEquals(parsed.patterns.length, 1);
});

Deno.test("E14 prompt v2 parses WITH PEOPLE and completed inline interviews with no item caps", () => {
  const sections = Array.from({ length: 6 }, (_, index) => `
WITH PEOPLE ${index + 1}
Who (a role, never a name): a friend
What I tend to do: I wait until I can raise one concrete thing.
Example: I returned to a fictional disagreement after taking notes.
Seen: ${index % 2 ? "often" : "a few times"}`).join("\n");
  const parsed = parsePsyPromptV1(`
KNOWS ME: a little
MOMENT 1
What happened: A fictional plan changed suddenly.
What I did or said: I made a shorter plan and asked for help.
My words: none
Area: work
${sections}
MATTERS 1
What: Keeping commitments without hiding overload.
Example: I renegotiated a deadline before it surprised anyone.
MORE TO COME
PATTERN 1
When this happens: A decision has too many unknowns.
I tend to: Make a small model and test it.
Example: I compared two fictional routes before choosing.
Seen: once
`);
  assertEquals(parsed.initialRoundEligible, true);
  assertEquals(parsed.moments.length, 1);
  assertEquals(parsed.withPeople.length, 6);
  assertEquals(parsed.withPeople[0].seen, 2);
  assertEquals(parsed.withPeople[1].seen, 3);
  assertEquals(parsed.matters.length, 1);
  assertEquals(parsed.patterns.length, 1);
  assertStringIncludes(parsed.withPeople[0].text, "WHAT I TEND TO DO");
  assertStringIncludes(parsed.withPeople[0].text, "WHO (A ROLE, NEVER A NAME)");
});

Deno.test("E14 KNOWS ME a little without completed interview evidence remains thin", () => {
  assertEquals(parsePsyPromptV1("KNOWS ME: a little").initialRoundEligible, false);
});

Deno.test("E14 long answers are split without truncation or a fixed chunk count", () => {
  const paragraphs = Array.from(
    { length: 25 },
    (_, index) => `Paragraph ${index + 1}. ${"A fictional but substantive observation. ".repeat(180)}`,
  );
  const raw = paragraphs.join("\n\n");
  const chunks = chunkImportText(raw, 10_000);
  assert(chunks.length > 10);
  assertEquals(chunks.join("\n\n"), raw);
});

Deno.test("E14 MORE TO COME continuation chunks reassemble before structured parsing", async () => {
  const raw = `${
    "Fictional setup. ".repeat(585)
  }\n\nMORE TO COME\n\nA completed fictional interview follows.`;
  assertEquals(chunkImportText(raw).length, 2);
  const client = new RecordedClient({
    import_safety: [
      '{"risk":"none","reason":"none"}',
      '{"risk":"none","reason":"none"}',
    ],
    import_scrub: [
      '{"text":"KNOWS ME: a little\\nMORE TO COME"}',
      '{"text":"WITH PEOPLE 1\\nWho (a role, never a name): a friend\\nWhat I tend to do: I return to one concrete point.\\nExample: I raised a fictional disagreement later.\\nSeen: a few times"}',
    ],
    import_listener: [
      '{"guesses":[]}',
      '{"guesses":[{"label":"Returns calmly","statement":"Part of you returns to a disagreement once the point is clear.","type":"how I tend to react","area":"relationships","note":"The fictional interview describes returning to one concrete point."}]}',
    ],
  });
  const result = await runImportStages(client, raw, "Nami");
  assertEquals(result.exchanges.map((exchange) => exchange.purpose), [
    "import_safety",
    "import_safety",
    "import_scrub",
    "import_scrub",
    "import_listener",
    "import_listener",
  ]);
  assertEquals(result.psy?.initialRoundEligible, true);
  assertEquals(result.psy?.withPeople.length, 1);
  assertEquals(result.guesses.length, 1);
  assertEquals(result.thin, false);
});

Deno.test("E14 missing labels fall back to whole-answer extraction instead of thin", async () => {
  const names = [
    "Anchor",
    "Boundary",
    "Care",
    "Dependability",
    "Effort",
    "Focus",
    "Generosity",
    "Honesty",
    "Independence",
    "Judgment",
  ];
  const client = new RecordedClient({
    import_safety: ['{"risk":"none","reason":"none"}'],
    import_scrub: [
      '{"text":"I tend to prepare carefully before asking for help. I value being dependable, but I also wait too long before saying I am overloaded."}',
    ],
    import_listener: [JSON.stringify({
      guesses: names.map((name) => ({
        label: name,
        statement: `Part of you notices ${name.toLowerCase()} in this fictional answer.`,
        type: "how I tend to react",
        area: "work",
        note: `The answer gives specific fictional evidence about ${name.toLowerCase()}.`,
      })),
    })],
  });
  const result = await runImportStages(client, "A substantive free-text answer without labels.", "Nami");
  assertEquals(result.thin, false);
  assertEquals(result.guesses.length, 10);
  assertEquals(result.psy, null);
});

Deno.test("E14 ChatGPT, Claude, and Gemini fixture answers each produce 10+ distinct cards", async () => {
  const fixtures = JSON.parse(
    await Deno.readTextFile(new URL("../tests/fixtures/import_real_styles.json", import.meta.url)),
  ) as Array<{ source: string; answer: string; labels: string[] }>;
  assertEquals(fixtures.map((fixture) => fixture.source), ["chatgpt", "claude", "gemini"]);
  for (const fixture of fixtures) {
    const guesses = fixture.labels.map((label) => ({
      label,
      statement: `Part of you notices ${label.toLowerCase()} in this fictional answer.`,
      type: "how I tend to react",
      area: "work",
      note: `The answer gives specific fictional evidence about ${label.toLowerCase()}.`,
    }));
    const client = new RecordedClient({
      import_safety: ['{"risk":"none","reason":"none"}'],
      import_scrub: [JSON.stringify({ text: fixture.answer })],
      import_listener: [JSON.stringify({ guesses })],
    });
    const result = await runImportStages(client, fixture.answer, "Nami");
    assertEquals(result.thin, false, fixture.source);
    assert(result.guesses.length >= 10, `${fixture.source}: ${result.guesses.length}`);
    assertEquals(new Set(result.guesses.map((guess) => guess.mergeKey)).size, result.guesses.length);
  }
});

Deno.test("R14 review rounds are priority ordered: first at most seven, later at most three", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: index, priority: index }));
  assertEquals(importRound(rows, true).map((row) => row.id), [11, 10, 9, 8, 7, 6, 5]);
  assertEquals(importRound(rows, false).map((row) => row.id), [11, 10, 9]);
  assertEquals(initialImportRound(rows, { initialRoundEligible: true }).length, 7);
  assertEquals(initialImportRound(rows, { initialRoundEligible: false }), []);
  assertEquals(initialImportRound(rows, null).length, 7);
});

Deno.test("R14 merge keys cross imports and repeat prompts name only thin areas", () => {
  assertEquals(
    importMergeKey("work", "Useful first", "Part of you feels useful when helping."),
    importMergeKey("work", "Useful first", "Part of you feels useful when helping."),
  );
  assertEquals(
    repeatImportPrompt(["work", "money", "work"]),
    "Ask your AI only about moments in these areas where your map is still thin: work, money.",
  );
  assertEquals(repeatImportPrompt([]), null);
});

Deno.test("R14 migration stores source, moments, lifecycle, merge keys, and 90-day quiet retirement", async () => {
  const sql = await Deno.readTextFile(
    new URL("../../supabase/migrations/0023_ai_import_flow.sql", import.meta.url),
  );
  for (
    const expected of [
      "source_assistant",
      "source_date",
      "ai_import_moments",
      "source text not null default 'import'",
      "from_your_ai",
      "merge_key",
      "waiting",
      "rated",
      "retired",
      "interval '90 days'",
    ]
  ) assertStringIncludes(sql, expected);
  assertEquals(sql.includes("14 days"), false);
});

Deno.test("E13 migration stores canonical sources and makes confirmed Talk win", async () => {
  const sql = await Deno.readTextFile(
    new URL("../../supabase/migrations/0027_hosted_owner_import.sql", import.meta.url),
  );
  for (
    const expected of [
      "chatgpt','claude','gemini','other",
      "imported_at set not null",
      "source = 'talk' and status = 'confirmed'",
      "delete from public.beliefs",
    ]
  ) assertStringIncludes(sql, expected);
});

Deno.test("E26 P0 (06 Nov, CEO): a rated import stands on Bridge's sender map beside Talk beliefs, so Bridge insight can touch it", async () => {
  const filters: Array<[string, string, unknown]> = [];
  const rows: Record<string, unknown[]> = {
    beliefs: [
      { id: "talk", source: "talk", type: "a rule I live by", status: "confirmed", domains: ["self"] },
      { id: "imported", source: "import", type: "something I believe is true", status: "confirmed", domains: ["self"] },
    ],
    receipts: [],
    belief_links: [],
    consent: [],
  };
  const db = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          filters.push(["eq", field, value]);
          return query;
        },
        neq: (field: string, value: unknown) => {
          filters.push(["neq", field, value]);
          return query;
        },
        then: (resolve: (value: unknown) => void) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return query;
    },
  };
  const map = await loadMap(db as never, "owner");
  assertEquals(map.beliefs.map((belief) => belief.id).sort(), ["imported", "talk"]);
  assert(
    !filters.some(([kind, field, value]) => kind === "neq" && field === "source" && value === "import"),
    "loadMap (Bridge, Mirror) never excludes import; only Talk's own loadState keeps them out of a session",
  );
});

Deno.test("AI import migration has a unique, ordered version", () => {
  const migrations = [...Deno.readDirSync(new URL("../../supabase/migrations/", import.meta.url))]
    .filter((entry) => entry.isFile && entry.name.endsWith(".sql")).map((entry) => entry.name);
  const versions = migrations.map((name) => name.split("_", 1)[0]);
  assertEquals(new Set(versions).size, versions.length);
  assert(migrations.includes("0017_ai_import.sql"));
});
