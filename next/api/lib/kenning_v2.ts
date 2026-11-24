// Kenning map v2 (HQ d-all-kenning-map-v2-14nov; Nami 15:38 PT 14 Nov: a real subway map, one word per station, interchanges,
// folding, pan; layout on the phone, no AI). The server sends, per kenning: one keyword, its line memberships (each with the receipt
// ids that justify it) and a fold group id. Pure and deterministic; no model call happens at map time.
//   keyword:     made with the kenning (Talk's turn reply carries it, beliefs.map_keyword); until a kenning has one (older rows,
//                own-written and imported kennings), a one-word fallback is taken from its label, never invented.
//   memberships: the person's own line choice wins and stands alone (law 3). Otherwise the kenning's home line (its area from
//                extraction) plus at most one more line the person's OWN words name (family, relationships, work, money only; PSY 15 Nov),
//                receipt by receipt (receipts hold only what the person said; Mirror input never sits there, law 12).
//   group_id:    kennings that share a keyword or that the extraction linked as resting on one another fold together; a kenning
//                with neither folds with the same kind on its home line. Tension links never fold (law 6: tensions stay visible).
import { cleanKeyword, keyKey, keywordCandidates, keywordFromLabel, keywordProblem, type KeywordContext } from "../../engine/keyword.ts";
export { cleanKeyword, keywordCandidates, keywordFromLabel, keywordProblem };

// Words with which a person names an area themselves. Whole words only. PSY 15 Nov (Q-ENG-KMV2-LINES (a) with changes): the list adds a
// second line ONLY for family, relationships, work and money; morality, meaning, politics, body and Me come only from the kenning's own
// domain (its home line), never from a word. "work" counts only as the place ("at work", "my work"), never the verb ("it didn't work").
// "partner" counts only as "my partner" ("friends" is fine).
const NAMES: Record<string, RegExp> = {
  family: /\b(?:family|families|mum|mums|mom|moms|mother|mothers|dad|dads|father|fathers|parents?|brothers?|sisters?|siblings?|sons?|daughters?|kids?|child|children|grandma|grandmother|grandpa|grandfather|grandparents?|aunts?|uncles?|cousins?|nieces?|nephews?|in-laws?|stepmom|stepmum|stepdad|stepfather|stepmother)\b/i,
  relationships: /\b(?:my partner|boyfriends?|girlfriends?|husbands?|wife|wives|spouses?|fianc[eé]e?s?|relationships?|dating|friends?|friendships?|marriage|married|my ex)\b/i,
  work: /\b(?:(?:at|my|from|to|for|after|before|of|off|the|about|back to) work|workplace|jobs?|boss(?:es)?|managers?|colleagues?|co-?workers?|office|career|clients?|shifts?|deadlines?|promotion|interview)\b/i,
  money: /\b(?:money|salary|salaries|rent|debts?|bills?|savings?|afford|budget|loans?|mortgage|income|cash|wages?|paycheck|expensive|spending)\b/i,
};
/** The only lines a word in the person's receipts can add (PSY 15 Nov). */
export const SAID_LINES = Object.keys(NAMES);

export interface ReceiptIn { id: string; quote: string; said_at?: string }
/** The engine's second line as stored in beliefs.map_said (migration 0065): the line and the key of the wording it was chosen under. */
export interface StoredSaid { line: string; w: string }

/** A short stable key of a kenning's wording (FNV-1a, hex), so map_said holds no copy of the person's words. */
export function wordsKey(words: string): string {
  let h = 0x811c9dc5;
  for (const ch of words.replace(/\s+/g, " ").trim()) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** What map_said should hold after this GET: the engine's "said" line with the wording key, or null (none, or the person's own lines). */
export function saidToStore(ms: Membership[], key: string): StoredSaid | null {
  const s = ms.find((m) => m.source === "said");
  return s ? { line: s.line, w: key } : null;
}

/** Parse a stored map_said value; anything malformed reads as none. */
export function readStoredSaid(v: unknown): StoredSaid | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o.line === "string" && typeof o.w === "string" ? { line: o.line, w: o.w } : null;
}
export interface Membership { line: string; receipt_ids: string[]; source: "you" | "home" | "said" }
/** At most two lines per kenning: the home line plus one (PSY 14 and 15 Nov). */
export const MAX_MEMBERSHIPS = 2;

/** The lines the person's own words name, each with the receipts that name it. */
export function namedLines(receipts: ReceiptIn[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of receipts) {
    for (const [line, re] of Object.entries(NAMES)) if (re.test(r.quote)) out.set(line, [...(out.get(line) ?? []), r.id]);
  }
  return out;
}

/**
 * A kenning's line memberships, home line first. `personLines` (beliefs.map_lines) is the person's own choice and stands alone.
 * Otherwise: the home line (receipt ids: those naming it, else every receipt, the words the extraction read), then at most one other
 * line from SAID_LINES that the person's words name: the one named in more receipts; a tie goes to the more recent receipt (then the
 * fixed line order, so the same rows give the same answer). A harsh statement about the self (`harsh`) never gets a second line (PSY 6(d)).
 */
export function memberships(k: { area: string; domains: string[]; personLines: string[] | null; receipts: ReceiptIn[]; harsh?: boolean;
  stored?: StoredSaid | null; wordsKey?: string }, lineOrder: readonly string[]): Membership[] {
  const named = namedLines(k.receipts);
  if (k.personLines && k.personLines.length) {
    // QA-B362 (law 2): a line the person picked rests on the receipts naming it, else on every receipt of the kenning (their own words
    // that made it), so the station sheet always has the person's exact words to show; a kenning with no receipt at all still cites none.
    const own = k.receipts.map((r) => r.id);
    return k.personLines.slice(0, MAX_MEMBERSHIPS).map((line) => ({ line, receipt_ids: named.get(line) ?? own, source: "you" as const }));
  }
  const home: Membership = { line: k.area, receipt_ids: named.get(k.area) ?? k.receipts.map((r) => r.id), source: "home" };
  if (k.harsh) return [home];
  // PSY 15 Nov point 4: a membership never changes silently. The second line chosen earlier stays while a receipt of this kenning still
  // names it and the wording is the one it was chosen under; it goes only when its receipts are deleted, the wording is edited, or the
  // person picks the lines themselves (personLines above). A new receipt can add a second line where there was none; it never swaps one.
  const kept = k.stored && k.stored.line !== k.area && SAID_LINES.includes(k.stored.line) && k.stored.w === (k.wordsKey ?? "")
    ? named.get(k.stored.line) : undefined;
  if (k.stored && kept && kept.length) return [home, { line: k.stored.line, receipt_ids: kept, source: "said" }];
  const rank = (l: string) => { const i = lineOrder.indexOf(l); return i < 0 ? lineOrder.length : i; };
  const said = new Map(k.receipts.map((r) => [r.id, r.said_at ?? ""]));
  const latest = (ids: string[]) => ids.map((i) => said.get(i) ?? "").sort().at(-1) ?? "";
  const others = [...named.entries()].filter(([line]) => line !== k.area)
    .sort((a, b) => b[1].length - a[1].length || latest(b[1]).localeCompare(latest(a[1])) || rank(a[0]) - rank(b[0]))
    .slice(0, MAX_MEMBERSHIPS - 1)
    .map(([line, ids]) => ({ line, receipt_ids: ids, source: "said" as const }));
  return [home, ...others];
}

/**
 * The station's keyword under the CPO rules (KM2-W4): the stored one made with the kenning when it passes for this station (its lines,
 * the person's own words for names), else the label's own word, else the wording's (a kenning the person wrote skips its fixed label);
 * null when no word passes: the station shows its line's dot with no label. `source` says which one: "made", "label" or "none".
 */
export function stationKeyword(k: { stored: unknown; label: string; wording: string; ownPen: boolean; lines: readonly string[];
  texts: readonly string[] }): { keyword: string | null; source: "made" | "label" | "none" } {
  const ctx: KeywordContext = { lines: k.lines, texts: k.texts };
  const made = cleanKeyword(k.stored, ctx);
  if (made) return { keyword: made, source: "made" };
  const fallback = (k.ownPen ? null : keywordFromLabel(k.label, ctx)) ?? keywordFromLabel(k.wording, ctx);
  return fallback ? { keyword: fallback, source: "label" } : { keyword: null, source: "none" };
}

export interface GroupIn { id: string; keyword: string | null; home: string; kind: string }
/**
 * Fold groups: union of kennings sharing a keyword, and of kennings the extraction linked as one resting on the other
 * (`restsOn` pairs). A group of two or more is "g:<smallest id>"; a kenning alone is "k:<home line>:<kind>". Same input, same ids.
 */
export function groupIds(ks: GroupIn[], restsOn: Array<[string, string]>): Map<string, string> {
  const parent = new Map(ks.map((k) => [k.id, k.id]));
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  const join = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const byKey = new Map<string, string>();
  for (const k of [...ks].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!k.keyword) continue;
    const key = keyKey(k.keyword), first = byKey.get(key);
    if (first) join(first, k.id); else byKey.set(key, k.id);
  }
  for (const [a, b] of restsOn) join(a, b);
  const size = new Map<string, number>();
  for (const k of ks) size.set(find(k.id), (size.get(find(k.id)) ?? 0) + 1);
  return new Map(ks.map((k) => {
    const root = find(k.id);
    return [k.id, (size.get(root) ?? 1) > 1 ? `g:${root}` : `k:${k.home}:${k.kind}`];
  }));
}
