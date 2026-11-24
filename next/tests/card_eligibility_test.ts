import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  ASK_MOMENT_QUESTION,
  askChoices,
  askStaysOpen,
  cardChoices,
  type EligibilityItem,
  eligibilityReason,
  eligibleItems,
} from "../api/lib/card_eligibility.ts";
import { readEligibility, readerSaysSensitive } from "../api/lib/card_eligibility_reader.ts";
import { hooks as bridgeHooks } from "../api/bridge_engine.ts";
import type { ModelClient, ModelRequest } from "../engine/model/client.ts";
import { fakeClient, type FakeTables } from "./fake_supabase.ts";

class ReaderFake implements ModelClient {
  constructor(private readonly reply: string, private readonly error?: string) {}
  complete(req: ModelRequest) {
    return Promise.resolve({ purpose: req.purpose, request: { model: req.model ?? "fake", system: req.system, messages: req.messages, maxTokens: req.maxTokens }, rawResponse: this.reply,
      ...(this.error ? { error: this.error } : {}), usage: { model: "fake", inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 } });
  }
}

class RetryingReaderFake implements ModelClient {
  calls = 0;
  complete(req: ModelRequest) {
    this.calls++;
    const failure = this.calls === 1;
    return Promise.resolve({ purpose: req.purpose, request: { model: req.model ?? "fake", system: req.system, messages: req.messages, maxTokens: req.maxTokens }, rawResponse: failure ? "" : '{"sensitive":false}',
      ...(failure ? { error: "timeout" } : {}), usage: { model: "fake", inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 } });
  }
}

const fixture = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/card_eligibility_psy_19nov.json", import.meta.url)),
) as { excluded: Record<string, EligibilityItem[]>; clean: EligibilityItem[] };
const excluded = Object.values(fixture.excluded).flat();

Deno.test("K-0046: PSY fixture has ten fictional excluded items per class and fifteen clean adult items", () => {
  for (const [name, items] of Object.entries(fixture.excluded)) assert(items.length >= 10, name);
  assert(fixture.clean.length >= 15);
});

Deno.test("K-0046: every card list uses the same exclusion decision; clean items are offered", () => {
  const all = [...excluded, ...fixture.clean];
  for (const surface of ["card", "ask"] as const) {
    const offered = eligibleItems(all, surface).map((x) => x.id).sort();
    for (const item of excluded) assert(!offered.includes(item.id), `${surface} leaked ${item.id}`);
    for (const item of fixture.clean) assert(offered.includes(item.id), `${surface} omitted ${item.id}`);
  }
  const wanted = fixture.clean.map((x) => x.id).sort();
  const cards = cardChoices(all);
  for (
    const list of [cards.picker, cards.surprise, cards.preselected, cards.preview, askChoices(all).presets]
  ) {
    assertEquals(list.map((x) => x.id).sort(), wanted);
  }
});

Deno.test("K-0046: Ask me requires every seed condition and uses the moment question", () => {
  const base: EligibilityItem = {
    id: "ok",
    wording: "I take a pause before I answer.",
    kind: "how_i_mean",
    scope: "friends",
    status: "confirmed",
  };
  assertEquals(eligibilityReason(base, "ask"), null);
  assertEquals(ASK_MOMENT_QUESTION, "Describe a time it happened.");
  for (
    const [field, value, reason] of [
      ["kind", "matters", "ask_kind"],
      ["status", "suggested", "ask_status"],
      ["scope", "person", "narrow_scope"],
      ["topic", "morality", "excluded_topic"],
      ["wording", "I am a burden.", "harsh_self"],
      ["readerSensitive", true, "excluded_content"],
    ] as const
  ) assertEquals(eligibilityReason({ ...base, [field]: value }, "ask"), reason, field);
});

Deno.test("K-0046: every excluded status and map-hidden item stays out of card lists", () => {
  const base: EligibilityItem = { id: "status", wording: "I pause before answering.", kind: "how_i_mean", scope: "friends", status: "confirmed" };
  for (const status of ["set_aside", "not_me", "suggested", "imported_unrated", "retired"] as const) {
    assertEquals(eligibilityReason({ ...base, status }, "card"), "card_status", status);
  }
  assertEquals(eligibilityReason({ ...base, hiddenFromMap: true }, "card"), "hidden_from_map");
});

Deno.test("K-0046: content reader can exclude but cannot clear; provider failure excludes", async () => {
  assert(await readerSaysSensitive(new ReaderFake('{"sensitive":true}'), "An otherwise clean sentence."));
  assertEquals(await readerSaysSensitive(new ReaderFake('{"sensitive":false}'), "An otherwise clean sentence."), false);
  assert(await readerSaysSensitive(new ReaderFake("", "timeout"), "An otherwise clean sentence."));
});

Deno.test("K-0059: a failed reader request excludes without caching, then a successful retry can include", async () => {
  const owner = "00000000-0000-4000-8000-0000000000c1";
  const tables: FakeTables = { beliefs: [{ id: "retry", owner }] };
  const db = fakeClient(tables);
  const row = tables.beliefs[0];
  const item: EligibilityItem = { id: "retry", wording: "I take a pause before I answer.", kind: "how_i_mean", scope: "friends", status: "confirmed" };
  const reader = new RetryingReaderFake();
  const ctx = { service: db, caller: { id: owner, isPreview: false }, env: {} };
  bridgeHooks.client = () => reader;
  try {
    assert((await readEligibility(ctx as never, row, item)).readerSensitive, "the failed request fails closed");
    assertEquals(row.card_eligibility_wording_hash, undefined, "a failed request is not cached");
    assertEquals(row.card_eligibility_sensitive, undefined, "a failed request is not cached");

    assertEquals((await readEligibility(ctx as never, row, item)).readerSensitive, false);
    assertEquals(reader.calls, 2, "the second request rereads instead of using a failure cache");
    assertEquals(row.card_eligibility_sensitive, false, "the successful finding is cached");

    assertEquals((await readEligibility(ctx as never, row, item)).readerSensitive, false);
    assertEquals(reader.calls, 2, "the successful cache avoids another provider read");
  } finally {
    bridgeHooks.client = null;
  }
});

Deno.test("K-0046: setting aside, retiring or narrowing an Ask source stops new answers without deleting old ones", () => {
  const source: EligibilityItem = {
    id: "source",
    wording: "I take a pause before I answer.",
    kind: "how_i_mean",
    scope: "friends",
    status: "confirmed",
  };
  assert(askStaysOpen(source));
  for (
    const change of [{ status: "set_aside" }, { status: "retired" }, { scope: "person" }, {
      scope: "private",
    }, { scope: "unset" }] as const
  ) {
    assert(!askStaysOpen({ ...source, ...change }), JSON.stringify(change));
  }
});
