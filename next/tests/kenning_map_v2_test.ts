// Kenning map v2 (d-all-kenning-map-v2-14nov): keyword, line memberships with receipt ids, fold groups; and the GET fields. $0.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { cleanKeyword, groupIds, keywordCandidates, keywordFromLabel, keywordProblem, memberships, readStoredSaid, SAID_LINES, saidToStore, stationKeyword, wordsKey } from "../api/lib/kenning_v2.ts";
import {
  looksLikeName, MAP_BANNED, PHONE_COPY_BANNED, PHONE_FEELINGS, PHONE_KINDS_OF_PERSON, PHONE_PRIVATE, PHONE_VERDICTS, PHONE_WEAK_NOUNS, phoneForms,
} from "../engine/keyword.ts";
import { LINE_ORDER } from "../api/lib/kenning_layout.ts";
import { readTurnReply } from "../engine/talk/checks.ts";
import { routes } from "../api/lib/router.ts";
import "../api/kenning_map.ts";

Deno.test("keyword: one plain word, capitalised; sentences, banned and clinical words refused", () => {
  assertEquals(cleanKeyword("afterthought"), "Afterthought");
  assertEquals(cleanKeyword(" Fine "), "Fine");
  assertEquals(cleanKeyword("self-reliant"), "Self-reliant");
  for (const bad of ["Say it's fine", "", "Selfish", "Anxiety", "Fine!", "x".repeat(19), "fine-", 3, null]) assertEquals(cleanKeyword(bad), null, String(bad));
  assertEquals(keywordProblem("two words"), "more than one word");
});
Deno.test("keyword, CPO rules (KM2-W4): title case; never a trait, judgement, feeling, map-banned word, name or the line's own name", () => {
  assertEquals(cleanKeyword("REST"), "Rest");
  assertEquals(cleanKeyword("worth"), "Worth");                                // no texts to check: kept
  assertEquals(keywordProblem("worth", { texts: ["I feel worthless at work."] }), "a word the person did not say");   // PSY C1
  assertEquals(cleanKeyword("worth", { texts: ["I don't know my worth."] }), "Worth");
  assertEquals(cleanKeyword("Enough"), "Enough");
  for (const bad of ["Lazy", "Needy", "Failure", "Weakness", "Shame", "Guilt", "Fears", "Core", "Roots", "Tension", "Tensions", "Torn", "Crossroads",
    "Score", "Complete", "Deep", "Conflict", "Origin", "Pulled", "Contradiction", "Unlovable", "Burden"]) {
    assertEquals(cleanKeyword(bad), null, bad);
  }
  assertEquals(cleanKeyword("Work", { lines: ["work"] }), null);
  assertEquals(cleanKeyword("Jobs", { lines: ["family", "work"] }), null);
  assertEquals(cleanKeyword("Work", { lines: ["family"] }), "Work");
  assertEquals(cleanKeyword("Family", { lines: ["family"] }), null);
  assertEquals(keywordProblem("Jan", { names: ["Jan"] }), "a person's name");
  assertEquals(keywordProblem("Jan", { texts: ["I told Jan it was fine. Jan just nodded."] }), "a person's name");
  assertEquals(keywordProblem("Dinner", { texts: ["At Dinner I said nothing, and after dinner I left."] }), null);   // seen in lower case
});
Deno.test("keyword: a name is a word only ever written capitalised after a sentence's first word", () => {
  assert(looksLikeName("Sara", ["My sister Sara called."]));
  assert(!looksLikeName("Sara", ["Sara called."]));                          // first word only: could be any word
  assert(!looksLikeName("Peace", ["I keep the peace with Peace in mind."]));
  assert(!looksLikeName("I", ["Then I left."]));
});
Deno.test("station keyword: made if it passes for this station, else the label's word, else the wording's, else none", () => {
  const base = { label: "Keep things smooth", wording: "You keep things smooth at work.", ownPen: false, lines: ["work"], texts: ["I told Jan it was fine."] };
  assertEquals(stationKeyword({ ...base, stored: "Smoothness" }), { keyword: "Smoothness", source: "made" });
  assertEquals(stationKeyword({ ...base, stored: "Work" }), { keyword: "Smooth", source: "label" });   // the line's own name
  assertEquals(stationKeyword({ ...base, stored: "Shame" }), { keyword: "Smooth", source: "label" });  // stored under older rules
  assertEquals(stationKeyword({ ...base, stored: "Jan" }), { keyword: "Smooth", source: "label" });    // a person's name
  assertEquals(stationKeyword({ ...base, stored: "Peace" }), { keyword: "Smooth", source: "label" });  // QA 17:21Z: a feeling word the phone draws as a dot
  assertEquals(stationKeyword({ ...base, stored: null, label: "Not me", wording: "Shame and guilt." }), { keyword: null, source: "none" });
  assertEquals(stationKeyword({ ...base, stored: null, label: "In my words", ownPen: true, wording: "I rest on Sundays." }),
    { keyword: "Sundays", source: "label" });
});
Deno.test("keyword fallback: the longest content word of the label, never a word the label lacks", () => {
  assertEquals(keywordFromLabel("Say it's fine"), "Fine");
  assertEquals(keywordFromLabel("Afterthought"), "Afterthought");
  assertEquals(keywordFromLabel("Not counting"), "Counting");
  assertEquals(keywordFromLabel("Keep the peace"), null);                      // "Peace" is a feeling word (PSY C3): no label
  assertEquals(keywordFromLabel("Keep the peace at dinner"), "Dinner");
  assertEquals(keywordFromLabel("Not me"), null);                              // no content word: no label, never a stop word
  assertEquals(keywordFromLabel("   "), null);
});
Deno.test("memberships: home line first, then lines the person's own words name, each with the receipts that name it", () => {
  const ms = memberships({ area: "work", domains: ["work"], personLines: null, receipts: [
    { id: "r1", quote: "my boss never asks" }, { id: "r2", quote: "and my mum was the same" }, { id: "r3", quote: "it didn't work out" },
  ] }, LINE_ORDER);
  assertEquals(ms, [{ line: "work", receipt_ids: ["r1"], source: "home" }, { line: "family", receipt_ids: ["r2"], source: "said" }]);
  // "work" the verb names nothing; with no receipt naming the home line, the home line rests on every receipt the extraction read.
  const verb = memberships({ area: "meaning", domains: ["self"], personLines: null, receipts: [{ id: "r3", quote: "it didn't work out" }] }, LINE_ORDER);
  assertEquals(verb, [{ line: "meaning", receipt_ids: ["r3"], source: "home" }]);
});
Deno.test("memberships: the person's line choice stands alone; body needs the kenning's own body domain; at most two lines", () => {
  const rs = [{ id: "r1", quote: "my sister and my boss and my friends and money and my health" }];
  assertEquals(memberships({ area: "work", domains: ["work"], personLines: ["me"], receipts: rs }, LINE_ORDER), [{ line: "me", receipt_ids: ["r1"], source: "you" }]);
  // QA-B362: a picked line no receipt names rests on the kenning's own receipts; one that is named keeps only the naming receipts.
  const two = [{ id: "r1", quote: "my boss is hard" }, { id: "r2", quote: "I rest at home" }];
  assertEquals(memberships({ area: "work", domains: ["work"], personLines: ["meaning", "work"], receipts: two }, LINE_ORDER),
    [{ line: "meaning", receipt_ids: ["r1", "r2"], source: "you" }, { line: "work", receipt_ids: ["r1"], source: "you" }]);
  const ms = memberships({ area: "work", domains: ["work"], personLines: null, receipts: rs }, LINE_ORDER);
  assertEquals(ms.length, 2);                                                  // at most two lines (PSY 14 Nov) until Q-ENG-KMV2-LINES
  assert(!ms.some((m) => m.line === "body"));
  assertEquals(ms.map((m) => m.line), ["work", "family"]);
  const body = memberships({ area: "body", domains: ["body_health"], personLines: null, receipts: [{ id: "r9", quote: "I never sleep before a deadline" }] }, LINE_ORDER);
  assertEquals(body, [{ line: "body", receipt_ids: ["r9"], source: "home" }, { line: "work", receipt_ids: ["r9"], source: "said" }]);
});
Deno.test("memberships, PSY 15 Nov: only family, relationships, work and money come from words; 'my partner' only; most receipts, then the more recent; harsh self gets none", () => {
  // morality, meaning, politics and body come only from the kenning's own domain, never from a word.
  const words = memberships({ area: "work", domains: ["work"], personLines: null, receipts: [
    { id: "r1", quote: "I was honest at church about the election and my health and my body" }] }, LINE_ORDER);
  assertEquals(words, [{ line: "work", receipt_ids: ["r1"], source: "home" }]);
  assertEquals(SAID_LINES, ["family", "relationships", "work", "money"]);
  // 'partner' alone is not the person naming a relationship; 'my partner' is.
  const p = (quote: string) => memberships({ area: "work", domains: ["work"], personLines: null, receipts: [{ id: "r1", quote }] }, LINE_ORDER).map((m) => m.line);
  assertEquals(p("my business partner and I split it"), ["work"]);
  assertEquals(p("I told my partner first"), ["work", "relationships"]);
  assertEquals(p("my friends were there"), ["work", "relationships"]);
  // Tie on receipts: the more recent receipt wins, whatever the line order.
  const tie = (bossAt: string, mumAt: string) => memberships({ area: "meaning", domains: ["meaning"], personLines: null, receipts: [
    { id: "r1", quote: "my boss never asks", said_at: bossAt }, { id: "r2", quote: "my mum was the same", said_at: mumAt }] }, LINE_ORDER)[1].line;
  assertEquals(tie("2026-11-01T00:00:00Z", "2026-11-05T00:00:00Z"), "family");
  assertEquals(tie("2026-11-05T00:00:00Z", "2026-11-01T00:00:00Z"), "work");
  // More receipts beat a more recent one.
  const most = memberships({ area: "meaning", domains: ["meaning"], personLines: null, receipts: [
    { id: "r1", quote: "my boss", said_at: "2026-11-01T00:00:00Z" }, { id: "r2", quote: "my job", said_at: "2026-11-02T00:00:00Z" },
    { id: "r3", quote: "my mum", said_at: "2026-11-09T00:00:00Z" }] }, LINE_ORDER);
  assertEquals(most[1], { line: "work", receipt_ids: ["r1", "r2"], source: "said" });
  // PSY 6(d): a harsh statement about the self never gets a second line from the engine; the person's own choice still stands.
  const rs = [{ id: "r1", quote: "my mum said it too" }];
  assertEquals(memberships({ area: "me", domains: ["self"], personLines: null, receipts: rs, harsh: true }, LINE_ORDER), [{ line: "me", receipt_ids: ["r1"], source: "home" }]);
  assertEquals(memberships({ area: "me", domains: ["self"], personLines: ["me", "family"], receipts: rs, harsh: true }, LINE_ORDER).length, 2);
});
Deno.test("groups: shared keyword or rests-on folds together; alone folds by home line and kind; deterministic", () => {
  const ks = [
    { id: "b", keyword: "Fine", home: "work", kind: "rule" }, { id: "a", keyword: "fine", home: "family", kind: "rule" },
    { id: "c", keyword: "Peace", home: "work", kind: "rule" }, { id: "d", keyword: "Counted", home: "work", kind: "everyday" },
    { id: "e", keyword: "Rules", home: "money", kind: "rule" }, { id: "f", keyword: "Rule", home: "money", kind: "rule" },
  ];
  const g = groupIds(ks, [["d", "c"]]);
  assertEquals(g.get("a"), "g:a"); assertEquals(g.get("b"), "g:a");
  assertEquals(g.get("c"), "g:c"); assertEquals(g.get("d"), "g:c");
  assertEquals(g.get("e"), "g:e"); assertEquals(g.get("f"), "g:e");
  assertEquals(groupIds([...ks].reverse(), [["c", "d"]]), g);
  assertEquals(groupIds([{ id: "z", keyword: "Alone", home: "work", kind: "rule" }], [["z", "missing"]]).get("z"), "k:work:rule");
});
Deno.test("turn reply: keyword is parsed and cleaned; a bad one is dropped, never repaired", () => {
  const reply = (kw: unknown) => readTurnReply(({ risk: { level: "none" }, reflection: "You stayed late.", question: "What happened next?",
    move: { kind: "follow" }, beliefs: [{ id: null, label: "Say it's fine", keyword: kw, statement: "Part of you says it's fine.", type: "a rule I live by", level: "L1",
      domains: ["work"], confidence: 0.8, receipt: "fine", links: [] }] }));
  assertEquals(reply("fine").reply!.beliefs[0].keyword, "Fine");
  assertEquals(reply("it is fine").reply!.beliefs[0].keyword, null);
  assertEquals(reply(undefined).reply!.beliefs[0].keyword, null);
});

// GET /kennings/map v2 fields on a fake database.
type Row = Record<string, unknown>;
const ME = "00000000-0000-4000-8000-000000000091";
const t: Record<string, Row[]> = {};
class T implements PromiseLike<{ data: unknown; error: null }> {
  eqs: Array<[string, unknown]> = []; ins: Array<[string, unknown[]]> = []; patch: Row | null = null;
  constructor(private n: string) { t[n] ??= []; }
  update(p: Row) { this.patch = p; return this; }
  select() { return this; } order() { return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  in(c: string, v: unknown[]) { this.ins.push([c, v]); return this; }
  maybeSingle() { return this; }
  // deno-lint-ignore no-explicit-any
  then(r: any) {
    const hit = t[this.n].filter((x) => this.eqs.every(([c, v]) => x[c] === v) && this.ins.every(([c, v]) => v.includes(x[c])));
    if (this.patch) for (const x of hit) Object.assign(x, this.patch);
    return Promise.resolve(r({ data: hit, error: null }));
  }
}
const kb = (id: string, area: string, over: Row = {}): Row => ({ id, owner: ME, label: `Label ${id}`, statement: `Part of you ${id}`, area, domains: [area], kind: "rule",
  level: "L1", status: "confirmed", rating: "very", created_at: "2026-11-01T00:00:00Z", confirmed_at: "2026-11-01T00:00:00Z", map_order: {}, ...over });
Deno.test("GET /kennings/map v2: keyword (made or label), memberships with receipt ids, group ids, lines; cited receipts only (v1.77)", async () => {
  for (const k of Object.keys(t)) delete t[k];
  t.beliefs = [kb("a", "work", { map_keyword: "Fine", label: "Say it's fine" }), kb("b", "family", { label: "Keep things smooth" }), kb("c", "work", { label: "Fine again", map_keyword: "fine" }),
    kb("d", "money", { map_lines: ["me"], label: "Counted" }), kb("e", "meaning", { label: "In my words", own_wording: "I do my best thinking on long walks." }),
    kb("h", "work", { hidden_from_map: true, label: "Hidden one" }),
    kb("g", "me", { label: "Enough", statement: "Part of you feels you're not enough." })];
  t.receipts = [{ id: "r1", owner: ME, belief_id: "a", said_at: "2026-11-02T00:00:00Z", quote: "at work and with my mum I say it's fine" },
    { id: "r2", owner: ME, belief_id: "b", said_at: "2026-11-03T00:00:00Z", quote: "nobody fights at dinner" },
    { id: "r3", owner: ME, belief_id: "h", said_at: "2026-11-04T00:00:00Z", quote: "kept off the map" },
    { id: "r4", owner: ME, belief_id: "g", said_at: "2026-11-05T00:00:00Z", quote: "my dad never thought so" }];
  t.belief_links = [{ owner: ME, from_belief: "b", to_belief: "d", kind: "rests_on" }, { owner: ME, from_belief: "a", to_belief: "b", kind: "tension" }];
  t.kenning_links = []; t.kenning_because = [];
  const url = new URL("https://x.invalid/kennings/map");
  const f = routes.find((r) => r.method === "GET" && r.pattern.test(url.pathname))!;
  const db = { from: (n: string) => new T(n) };
  const res = await (await f.handler({ env: {}, req: new Request(url), url, params: {}, body: () => Promise.resolve({}), caller: { id: ME, db }, service: db } as never)).json();
  const s = (id: string) => res.stations.find((x: Row) => x.belief_id === id);
  assertEquals(res.map_version, 2);
  assertEquals([s("a").keyword, s("a").keyword_source, s("b").keyword, s("b").keyword_source], ["Fine", "made", "Smooth", "label"]);
  assertEquals(s("a").memberships, [{ line: "work", receipt_ids: ["r1"], source: "home" }, { line: "family", receipt_ids: ["r1"], source: "said" }]);
  assertEquals(s("b").memberships, [{ line: "family", receipt_ids: ["r2"], source: "home" }]);
  assertEquals(s("d").memberships, [{ line: "me", receipt_ids: [], source: "you" }]);
  assertEquals([s("a").group_id, s("c").group_id], ["g:a", "g:a"]);            // shared keyword
  assertEquals([s("b").group_id, s("d").group_id], ["g:b", "g:b"]);            // rests on; the tension link a-b never folds
  assertEquals(s("e").keyword, "Thinking");                                    // own pen: from the wording, never "Words"
  assertEquals(res.lines, ["family", "work", "meaning", "me"]);                // a kept-off station adds no line (v1.80)
  assertEquals([s("h").hidden, s("a").hidden], [true, false]);
  assertEquals(res.stations.at(-1).belief_id, "h");
  assert(!String(s("h").group_id).startsWith("g:"), "a kept-off station never folds with a visible one");
  // v1.77: the person's exact words and date, only for receipts a membership cites (law 2); a hidden kenning's receipt never leaves.
  assertEquals(res.receipts, [
    { id: "r1", quote: "at work and with my mum I say it's fine", said_at: "2026-11-02T00:00:00.000Z" },
    { id: "r2", quote: "nobody fights at dinner", said_at: "2026-11-03T00:00:00.000Z" },
    { id: "r3", quote: "kept off the map", said_at: "2026-11-04T00:00:00.000Z" },   // v1.80: the List's sheet shows a kept-off station's own words (law 2)
    { id: "r4", quote: "my dad never thought so", said_at: "2026-11-05T00:00:00.000Z" }]);
  assertEquals(s("g").memberships, [{ line: "me", receipt_ids: ["r4"], source: "home" }]); // harsh self statement: no second line
});

Deno.test("memberships, PSY 15 Nov point 4: the second line never changes silently; it goes with its receipts, a wording edit or the person's lines", () => {
  const key = wordsKey("Part of you keeps the peace.");
  const rs = [{ id: "r1", quote: "my mum never argues", said_at: "2026-11-01T00:00:00Z" }];
  const first = memberships({ area: "work", domains: ["work"], personLines: null, receipts: rs, stored: null, wordsKey: key }, LINE_ORDER);
  assertEquals(first[1], { line: "family", receipt_ids: ["r1"], source: "said" });
  const stored = saidToStore(first, key);
  assertEquals(stored, { line: "family", w: key });
  // Two newer receipts name money: without the stored line money would win (more receipts); with it, family stays, its ids as they are now.
  const more = [...rs, { id: "r2", quote: "the rent again", said_at: "2026-11-09T00:00:00Z" }, { id: "r3", quote: "money is tight", said_at: "2026-11-10T00:00:00Z" }];
  assertEquals(memberships({ area: "work", domains: ["work"], personLines: null, receipts: more }, LINE_ORDER)[1].line, "money");
  const kept = memberships({ area: "work", domains: ["work"], personLines: null, receipts: more, stored, wordsKey: key }, LINE_ORDER);
  assertEquals(kept[1], { line: "family", receipt_ids: ["r1"], source: "said" });
  assertEquals(saidToStore(kept, key), stored);
  // The receipt naming family is deleted: the line goes, and the next one the words name takes the place.
  const gone = memberships({ area: "work", domains: ["work"], personLines: null, receipts: more.slice(1), stored, wordsKey: key }, LINE_ORDER);
  assertEquals(gone[1].line, "money");
  // The wording is edited: chosen afresh.
  const edited = memberships({ area: "work", domains: ["work"], personLines: null, receipts: more, stored, wordsKey: wordsKey("Part of you keeps quiet.") }, LINE_ORDER);
  assertEquals(edited[1].line, "money");
  // Whitespace alone is not an edit.
  assertEquals(wordsKey("Part of you  keeps the peace. "), key);
  // A stored line that is now the home line, or not a word line, is not kept.
  assertEquals(memberships({ area: "family", domains: ["family"], personLines: null, receipts: more, stored, wordsKey: key }, LINE_ORDER)[1].line, "money");
  assertEquals(memberships({ area: "work", domains: ["work"], personLines: null, receipts: more, stored: { line: "morality", w: key }, wordsKey: key }, LINE_ORDER)[1].line, "money");
  // The person's own lines stand alone; a harsh statement about the self still gets no second line.
  assertEquals(memberships({ area: "work", domains: ["work"], personLines: ["work"], receipts: more, stored, wordsKey: key }, LINE_ORDER).length, 1);
  assertEquals(memberships({ area: "work", domains: ["work"], personLines: null, receipts: more, stored, wordsKey: key, harsh: true }, LINE_ORDER).length, 1);
  // No second line before: a new receipt can add one (adding is not a change of a membership).
  assertEquals(saidToStore(memberships({ area: "work", domains: ["work"], personLines: null, receipts: [] }, LINE_ORDER), key), null);
  // Malformed stored values read as none.
  assertEquals(readStoredSaid({ line: 3 }), null);
  assertEquals(readStoredSaid("family"), null);
  assertEquals(readStoredSaid({ line: "family", w: "ab" }), { line: "family", w: "ab" });
});

Deno.test("GET /kennings/map: the second line is stored on first show and kept when newer receipts name another area (PSY 15 Nov point 4)", async () => {
  for (const k of Object.keys(t)) delete t[k];
  t.beliefs = [kb("a", "work", { label: "Say it's fine" })];
  t.receipts = [{ id: "r1", owner: ME, belief_id: "a", said_at: "2026-11-02T00:00:00Z", quote: "with my mum I say it's fine" }];
  t.belief_links = []; t.kenning_links = []; t.kenning_because = [];
  const url = new URL("https://x.invalid/kennings/map");
  const f = routes.find((r) => r.method === "GET" && r.pattern.test(url.pathname))!;
  const db = { from: (n: string) => new T(n) };
  const get = async () => (await (await f.handler({ env: {}, req: new Request(url), url, params: {}, body: () => Promise.resolve({}), caller: { id: ME, db }, service: db } as never)).json())
    .stations[0].memberships.map((m: Row) => m.line);
  assertEquals(await get(), ["work", "family"]);
  assertEquals((t.beliefs[0].map_said as Row).line, "family");
  t.receipts.push({ id: "r2", owner: ME, belief_id: "a", said_at: "2026-11-09T00:00:00Z", quote: "the rent is due" },
    { id: "r3", owner: ME, belief_id: "a", said_at: "2026-11-10T00:00:00Z", quote: "money again" });
  assertEquals(await get(), ["work", "family"]);
  // The receipt that named family is deleted: the line goes, and the stored choice follows.
  t.receipts.shift();
  assertEquals(await get(), ["work", "money"]);
  assertEquals((t.beliefs[0].map_said as Row).line, "money");
  // The wording is edited: chosen afresh from the receipts as they are.
  t.receipts.push({ id: "r4", owner: ME, belief_id: "a", said_at: "2026-11-11T00:00:00Z", quote: "my dad and my mum" },
    { id: "r5", owner: ME, belief_id: "a", said_at: "2026-11-12T00:00:00Z", quote: "my sister too" }, { id: "r6", owner: ME, belief_id: "a", said_at: "2026-11-12T01:00:00Z", quote: "my brother" });
  assertEquals(await get(), ["work", "money"]);
  t.beliefs[0].own_wording = "Part of you keeps it light.";
  assertEquals(await get(), ["work", "family"]);
});

// QA-B368 (QA 16:28Z): the dot is the renderer's fallback for a station with no passing word, never an engine keyword. Every station is
// either keyword null with source "none", or a plain word with source "made" or "label"; a dot or any other mark stored as a keyword never arrives.
Deno.test("GET /kennings/map: every station is null/none or a plain word with a real source; a stored dot or mark never arrives (QA-B368)", async () => {
  for (const k of Object.keys(t)) delete t[k];
  const marks = ["·", "•", "…", "-", ".", "—", "", "   ", "·x", "1", "a b", "·"];
  // Statements with no content word that can name a station (every word is a stop word), so a bad stored keyword has no fallback.
  t.beliefs = marks.map((m, i) => kb(`m${i}`, "work", { map_keyword: m, label: "It is not", statement: "Part of you is not it", own_wording: null }));
  t.beliefs.push(kb("ok", "family", { map_keyword: "Dinner", label: "Keep the peace" }), kb("nullkw", "work", { map_keyword: null, label: "Keep things smooth" }),
    // QA 17:21Z: a plain word the phone refuses (feeling, kind of person, private) never arrives; with no other word the station is a dot.
    ...["Peace", "Calm", "Pleaser", "Alcohol"].map((w) => kb(`ban${w}`, "work", { map_keyword: w, label: "It is not", statement: "Part of you is not it", own_wording: null })));
  t.receipts = []; t.belief_links = []; t.kenning_links = []; t.kenning_because = [];
  const url = new URL("https://x.invalid/kennings/map");
  const f = routes.find((r) => r.method === "GET" && r.pattern.test(url.pathname))!;
  const db = { from: (n: string) => new T(n) };
  const res = await (await f.handler({ env: {}, req: new Request(url), url, params: {}, body: () => Promise.resolve({}), caller: { id: ME, db }, service: db } as never)).json();
  assertEquals(res.stations.length, marks.length + 6);
  for (const x of res.stations as Row[]) {
    const ok = (x.keyword === null && x.keyword_source === "none")
      || (typeof x.keyword === "string" && /^[A-Za-z][A-Za-z'’-]*$/.test(x.keyword) && (x.keyword_source === "made" || x.keyword_source === "label"));
    assert(ok, `station ${x.belief_id}: ${JSON.stringify(x.keyword)}/${x.keyword_source}`);
  }
  const s = (id: string) => res.stations.find((x: Row) => x.belief_id === id);
  for (let i = 0; i < marks.length; i++) assertEquals([s(`m${i}`).keyword, s(`m${i}`).keyword_source], [null, "none"], `stored ${JSON.stringify(marks[i])}`);
  assertEquals([s("ok").keyword, s("ok").keyword_source], ["Dinner", "made"]);
  assertEquals([s("nullkw").keyword, s("nullkw").keyword_source], ["Smooth", "label"]);
  for (const w of ["Peace", "Calm", "Pleaser", "Alcohol"]) assertEquals([s(`ban${w}`).keyword, s(`ban${w}`).keyword_source], [null, "none"], w);
});

Deno.test("keyword, phone parity (QA 17:21Z, rejection 2): every word the phone's C2-C4 lists and verdicts refuse is refused here too", () => {
  // Peace first: this is the word the staging station 04162e76 carried while the phone drew a dot.
  for (const bad of ["Peace", "peace", "Calm", "Love", "Proud", "Tired", "Loss", "Comfort", "Stress", "Joy", "Pride",           // C3 feelings
    "Pleaser", "Fixer", "Hero", "Strong", "Kind", "Smart", "Responsible", "Independent", "Loyal",                             // C2 kinds of person
    "Alcohol", "Weight", "Face", "Hair", "Sex", "Cancer", "Looks", "Size",                         // C4 private
    "Good", "Best", "Normal", "Joke", "Fool", "Trauma", "Schema", "Therapy",                                                  // verdicts, clinical
    "Part", "Thing", "People", "Something", "Sense",                                                                          // weak nouns
    "Please", "Should", "Healthy", "Fix", "Improve", "Wrong", "Better"]) {                                                   // UI copy ban
    assertEquals(cleanKeyword(bad), null, bad);
  }
  for (const ok of ["Rest", "Enough", "Dinner", "Sundays", "Smooth", "Counting", "Afterthought"]) assertEquals(cleanKeyword(ok) !== null, true, ok);
  // A harsh self-statement and a name end as the topic or the dot, never the verdict.
  assertEquals(keywordFromLabel("I am worthless"), null);
  assertEquals(stationKeyword({ stored: "Peace", label: "Not me", wording: "I am worthless to Jan.", ownPen: false, lines: ["me"],
    texts: ["I am worthless to Jan."] }), { keyword: null, source: "none" });
});

Deno.test("keyword candidates (KM2-C3): up to six words from the person's own sentence and receipts, in order, each passing the station rules", () => {
  const ctx = { lines: ["work"] };
  // Order of appearance; the station's own word, the line's name, stop words, a feeling (Peace), a verdict and a trait are all left out.
  assertEquals(keywordCandidates(["Part of you keeps the peace at work with deadlines and dinner."], "Dinner", ctx), ["Keeps", "Deadlines"]);
  // A harsh self-statement offers the topic ("Enough"), never the verdict, and never "Worth" the person did not write.
  assertEquals(keywordCandidates(["Part of you feels you're not enough.", "I am worthless and useless."], null, {}), ["Enough"]);
  assertEquals(keywordCandidates(["I don't know my worth."], null, {}), ["Worth"]);
  // A name the person only ever writes capitalised mid-sentence is never offered.
  assertEquals(keywordCandidates(["I told Jan about the garden."], null, {}), ["Garden"]);
  // At most six, no repeats (plurals fold), and none when nothing passes.
  const many = keywordCandidates(["garden kitchen window ladder candle river garden gardens bridge"], null, {});
  assertEquals(many, ["Garden", "Kitchen", "Window", "Ladder", "Candle", "River"]);
  assertEquals(keywordCandidates(["Not me, it is so."], null, {}), []);
  assertEquals(keywordCandidates([], "Rest", {}), []);
});
Deno.test("GET /kennings/map: keyword_candidates ride each station on the owner's read, from the person's own words (KM2-C3, law 2)", async () => {
  for (const k of Object.keys(t)) delete t[k];
  t.beliefs = [kb("a", "work", { label: "Say it's fine", map_keyword: "Fine", statement: "Part of you says it's fine at work.", own_wording: null }),
    kb("g", "me", { label: "Enough", map_keyword: "Enough", statement: "Part of you feels you're not enough.", own_wording: null })];
  t.receipts = [{ id: "r1", owner: ME, belief_id: "a", said_at: "2026-11-02T00:00:00Z", quote: "I told Jan the deadline was fine" },
    { id: "r2", owner: ME, belief_id: "g", said_at: "2026-11-05T00:00:00Z", quote: "I am worthless next to my sister" }];
  t.belief_links = []; t.kenning_links = []; t.kenning_because = [];
  const url = new URL("https://x.invalid/kennings/map");
  const f = routes.find((r) => r.method === "GET" && r.pattern.test(url.pathname))!;
  const db = { from: (n: string) => new T(n) };
  const res = await (await f.handler({ env: {}, req: new Request(url), url, params: {}, body: () => Promise.resolve({}), caller: { id: ME, db }, service: db } as never)).json();
  const s = (id: string) => res.stations.find((x: Row) => x.belief_id === id);
  assertEquals(s("a").keyword_candidates, ["Deadline"]);                       // "Jan" a name, "fine" the station's own word, "work" its line
  assertEquals(s("g").keyword_candidates, ["Sister"]);                         // "worthless" never; "enough" is the station's word
  for (const x of res.stations as Row[]) {
    assert(Array.isArray(x.keyword_candidates) && x.keyword_candidates.length <= 6);
    for (const w of x.keyword_candidates) assertEquals(cleanKeyword(w, { lines: (x.memberships as Row[]).map((m) => String(m.line)) }) !== null, true, w);
  }
});

// QA-B368 rejection 3: the phone checks a word under itself, `-ies` -> `-y`, `-es` dropped and `-s` dropped (KenningSubwayFallback.forms).
// Every phone list word, in every plain inflection, must be refused here too, so the server never sends a word the phone draws as a dot.
Deno.test("keyword: phone parity: every banned word is refused in its singular, -s, -es and -ies forms (QA-B368)", () => {
  for (const w of ["therapy", "pregnancy", "diagnosis"]) assert(phoneForms(w).has(w));
  for (const bad of ["Therapies", "Pregnancies", "Diagnoses", "Therapy", "Pregnancy", "Diagnosis", "Diagnosis", "Symptoms", "Disorders"]) {
    assertEquals(cleanKeyword(bad), null, bad);
  }
  assertEquals(phoneForms("Therapies").has("therapy"), true);
  assertEquals(phoneForms("diagnoses").has("diagnosis"), true);
  const lists = [MAP_BANNED, PHONE_VERDICTS, PHONE_KINDS_OF_PERSON, PHONE_FEELINGS, PHONE_PRIVATE, PHONE_WEAK_NOUNS, PHONE_COPY_BANNED];
  const misses: string[] = [];
  for (const w of new Set(lists.flatMap((l) => [...l]))) {
    if (!/^[a-z][a-z'-]*$/.test(w) || w.length < 3 || w.length > 14) continue;
    const forms = [w, w + "s", w + "es"];
    if (w.endsWith("y")) forms.push(w.slice(0, -1) + "ies");
    for (const f of forms) if (keywordProblem(f) === null) misses.push(f);
  }
  assertEquals(misses, []);
  // Inflections of a line's own name and of a person's name, as the phone's `names()` folds them.
  assertEquals(keywordProblem("Families", { lines: ["family"] }), "the line's own name");
  assertEquals(keywordProblem("Bodies", { lines: ["body"] }), "a verdict, trait, feeling or map-banned word");
  assertEquals(keywordProblem("Janes", { names: ["Jane"] }), "a person's name");
  assertEquals(cleanKeyword("Rules"), "Rules");
  assertEquals(cleanKeyword("Tensions"), null);
});

// QA-B368 rejection 4: the phone's tagger lemma turns Loved/Hated/Feared/Panicked into banned words; the server refuses them too.
Deno.test("keyword: phone lemma parity: -ed, -ing, -er, -ly and irregular forms of a banned word are refused (QA-B368)", () => {
  for (const bad of ["Loved", "Hated", "Feared", "Panicked", "Hating", "Loving", "Fearing", "Panicking", "Fixed", "Fixing", "Wronged", "Hurt"]) {
    assertEquals(cleanKeyword(bad), null, bad);
  }
  for (const f of ["loved", "hated", "feared", "panicked"]) assertEquals(phoneForms(f).size > 1, true, f);
  assertEquals(phoneForms("panicked").has("panic"), true);
  assertEquals(phoneForms("loved").has("love"), true);
  // Everyday topic words stay available.
  for (const ok of ["Dinner", "Garden", "Deadlines", "Ladder", "Window", "Mother", "Kitchen"]) assertEquals(cleanKeyword(ok) !== null, true, ok);
  // Every banned word, in its -ed, -ing and -er forms.
  const lists = [MAP_BANNED, PHONE_VERDICTS, PHONE_KINDS_OF_PERSON, PHONE_FEELINGS, PHONE_PRIVATE, PHONE_WEAK_NOUNS, PHONE_COPY_BANNED];
  const misses: string[] = [];
  for (const w of new Set(lists.flatMap((l) => [...l]))) {
    if (!/^[a-z]+$/.test(w) || w.length < 4 || w.length > 12 || w === "ptsd") continue;   // an acronym has no inflections
    const base = w.endsWith("e") ? w.slice(0, -1) : w;
    const last = w[w.length - 1];
    const forms = [base + "ed", base + "ing", w.endsWith("e") ? w + "d" : w + "ed", w + "ing", w + last + "ed", w + last + "ing"];
    for (const f of forms) if (f.length <= 18 && keywordProblem(f) === null) misses.push(f + "<-" + w);
  }
  assertEquals(misses, []);
});
