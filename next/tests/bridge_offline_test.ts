import {
  assertEquals,
  assertGreater,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { gateActivatedLinks } from "../engine/bridge/analyse.ts";
import {
  applyVariant,
  gateMidLinks,
  instructionFor,
} from "../../evals/bridge_offline/variants.ts";
import type { Analysis } from "../engine/bridge/types.ts";
import type { Belief } from "../engine/types.ts";

const ROOT = new URL("../../", import.meta.url);
const OFFLINE = new URL("evals/bridge_offline/", ROOT);

const belief = (id: string, statement: string, receipt: string): Belief => ({
  id,
  label: "Shared work",
  statement,
  type: "a view or taste",
  level: "L3",
  domains: ["close_relationships"],
  confidence: .85,
  receipts: [{
    quote: receipt,
    sessionId: "frozen",
    turn: 1,
    date: "2026-11-20",
  }],
  links: [],
  status: "endorsed",
});

const analysis = (
  activated: Analysis["activated"],
  points: Analysis["points"] = [],
  frictions: Analysis["frictions"] = [],
): Analysis => ({
  points,
  feeling: { name: "annoyed", intensity: 3 },
  frictions,
  activated,
  landsOn: [],
  safety: "none",
  safetyReason: "",
  safetyQuotes: [],
});

Deno.test("Bridge offline gold and maps are fixed, complete, and fictional", async () => {
  const gold = JSON.parse(
    await Deno.readTextFile(new URL("drafts_e2e.v2.json", OFFLINE)),
  );
  assertEquals(gold.schema_version, 2);
  assertEquals(gold.pairs.length, 6);
  assertEquals(
    gold.pairs.flatMap((pair: { drafts: unknown[] }) => pair.drafts).length,
    48,
  );
  for (let number = 1; number <= 12; number++) {
    const id = `p${String(number).padStart(2, "0")}`;
    const map = JSON.parse(
      await Deno.readTextFile(new URL(`maps/${id}.json`, OFFLINE)),
    );
    assertEquals(map.persona_id, id);
    assertGreater(map.beliefs.length, 0);
    assertEquals(
      map.beliefs.every((item: { receipts: unknown[] }) =>
        item.receipts.length > 0
      ),
      true,
    );
  }
});

Deno.test("K-0107 candidate drops quiet logistics links and keeps only subject-supported links", () => {
  const beliefs = [
    belief(
      "work",
      "Making a home together means sharing the invisible work",
      "We compared our grocery and cleaning lists.",
    ),
    belief(
      "plans",
      "Evenings with my partner deserve protection",
      "We kept Friday evening for dinner.",
    ),
  ];
  const quiet = gateActivatedLinks(
    analysis([{
      beliefId: "work",
      why: "A porch light",
      quote: "leave the porch light on",
    }]),
    beliefs,
  );
  assertEquals(quiet.activated, []);
  const unsupported = gateActivatedLinks(
    analysis([{ beliefId: "plans", why: "chores", quote: "the bins" }], [{
      kind: "complaint",
      quote: "the bins",
    }], [{ kind: "you_blame", quote: "the bins" }]),
    beliefs,
  );
  assertEquals(unsupported.activated, []);
  const supported = gateActivatedLinks(
    analysis(
      [{ beliefId: "work", why: "shared work", quote: "sharing the cleaning" }],
      [{ kind: "complaint", quote: "sharing the cleaning" }],
      [{ kind: "you_blame", quote: "sharing the cleaning" }],
    ),
    beliefs,
  );
  assertEquals(supported.activated.map((item) => item.beliefId), ["work"]);
});

Deno.test("K-0163 lab variants keep links concrete and narrow only their named frictions", () => {
  const beliefs = [
    belief(
      "plans",
      "Friday plans need direct agreement",
      "We booked Friday dinner after comparing calendars.",
    ),
    belief(
      "work",
      "Invisible work belongs to both of us",
      "We split the bins and utility bill last week.",
    ),
  ];
  const source = analysis(
    [
      { beliefId: "plans", why: "Friday plans", quote: "Friday" },
      { beliefId: "work", why: "shared work", quote: "this" },
    ],
    [{ kind: "request", quote: "Could you do something?" }],
    [
      { kind: "vague_ask", quote: "Could you do something?" },
      { kind: "you_blame", quote: "Could you do something?" },
    ],
  );
  assertEquals(
    gateMidLinks(source, "Could you do something about Friday?", beliefs)
      .activated.map((item) => item.beliefId),
    ["plans"],
  );
  const strict = applyVariant(
    "combo",
    source,
    "Could you put the parcel by the door before six?",
    beliefs,
    gateActivatedLinks,
  );
  assertEquals(strict.frictions, []);
  assertStringIncludes(
    instructionFor("vague-strict"),
    "parcel by the door before six",
  );
  assertStringIncludes(
    instructionFor("you-blame-strict"),
    "Can you answer by noon?",
  );
});

Deno.test("offline command stays direct and exposes both named variants", async () => {
  const source = await Deno.readTextFile(new URL("run.ts", OFFLINE));
  assertStringIncludes(source, '"link-mid"');
  assertStringIncludes(source, '"combo"');
  assertStringIncludes(source, "await analyse(");
  assertStringIncludes(source, "buildInsight(");
  assertStringIncludes(source, "width = 8");
  assertStringIncludes(
    source,
    "for (let attempt = 1; attempt <= 3; attempt++)",
  );
  const roundTwo = await Deno.readTextFile(
    new URL("summary_round2.ts", OFFLINE),
  );
  assertStringIncludes(roundTwo, "SUMMARY-offline-round2.md");
  assertStringIncludes(roundTwo, "Do not ship to staging");
  const nightly = await Deno.readTextFile(new URL("nightly.ts", OFFLINE));
  assertStringIncludes(nightly, '"--variant", "baseline"');
  assertStringIncludes(nightly, "Deno.exit(2)");
  assertStringIncludes(nightly, '"link_right"');
});
