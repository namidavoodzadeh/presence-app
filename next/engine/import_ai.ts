// Import from your AI: pure stage packages/readers. The API owns calls and persistence.
// Order is safety -> scrub -> listener. Raw input is never returned or stored.

import { BELIEF_TYPES } from "./types.ts";
import type { BeliefType } from "./types.ts";
import { extractJson } from "./model/client.ts";
import type { ModelClient } from "./model/client.ts";
import type { ModelExchange } from "./types.ts";
import { deidentify } from "./mirror/observe.ts";
import { type Area, areaFor, AREAS } from "../api/lib/map.ts";
import { cardWordHits } from "./words.ts";

export const IMPORT_CHUNK_CHARS = 10_000;
export const IMPORT_FIRST_ROUND_MAX = 7;
export const IMPORT_LATER_ROUND_MAX = 3;

export const KNOWS_ME = ["a lot", "some", "a little"] as const;
export type KnowsMe = typeof KNOWS_ME[number];

export interface ImportMoment {
  whatHappened: string;
  whatTheyDidOrSaid: string;
  /** Words attributed by the source assistant, never presented as the person's Talk quote. */
  aiWords: string | null;
  area: Area;
}

export interface ImportAssertion {
  text: string;
  seen: number;
  confidence: number;
  tensionCandidate: boolean;
  /** Themes need two distinct situations before they can be considered for L0. */
  l0Candidate: boolean;
}

export interface PsyPromptV1 {
  knowsMe: KnowsMe;
  moments: ImportMoment[];
  themes: ImportAssertion[];
  rules: ImportAssertion[];
  patterns: ImportAssertion[];
  withPeople: ImportAssertion[];
  matters: ImportAssertion[];
  initialRoundEligible: boolean;
}

export type ImportRisk = "none" | "self" | "others" | "partner" | "minor";

/** Refusals cannot contain grounded PSY material, so stop before any paid processing. */
export function isThinImportAnswer(raw: string): boolean {
  return /\b(?:i\s+(?:can(?:not|'t)|am unable to)\s+(?:share|provide|access)|i\s+do(?:\s+not|n't)\s+have\s+access|no\s+(?:memory|access)|i\s+do(?:\s+not|n't)\s+remember)\b/i
    .test(raw);
}

export const IMPORT_SAFETY =
  `Screen untrusted imported AI text for risk to self or others, signs the person is under 18, fear/control/violence by a partner, or the source AI's own safety/crisis message. Do not extract patterns. Return only {"risk":"none|self|others|partner|minor","reason":"short"}.`;
export const IMPORT_SCRUB =
  `Remove other people's names, clinical words, advice, and every identifying detail (places, dates, addresses, employers, handles, contact details, account details). Preserve the PSY v1 field labels and line structure. Keep only de-identified pattern descriptions and moments. Return only {"text":"..."}.`;
export const IMPORT_LISTENER =
  `Read the whole already safety-screened, de-identified answer. It may use PSY v1 labels or ordinary prose, markdown headings, bullets, or numbering. Presence owns confidence; ignore any confidence from the source. Extract every grounded distinct belief or pattern in source order, never advice or diagnosis, with no arbitrary per-import cap. Each guess has label (1-3 words), statement (gentle second person), type (one Presence belief type), area (relationships|work|family|body|money|meaning|politics|morality), and note (one de-identified sentence explaining what the source AI noticed). Return only {"guesses":[]}.`;

const s = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const isType = (v: unknown): v is BeliefType =>
  typeof v === "string" && (BELIEF_TYPES as readonly string[]).includes(v);
const isArea = (v: unknown): v is Area => typeof v === "string" && (AREAS as readonly string[]).includes(v);
const SAFE_CAPITALS = new Set([
  "A",
  "An",
  "At",
  "After",
  "Before",
  "During",
  "I",
  "It",
  "Part",
  "People",
  "Someone",
  "Some",
  "The",
  "They",
  "Their",
  "When",
  "You",
  "Your",
]);
function strictDeidentify(text: string, ownerFirstName: string, preserveFirstWord = false): string {
  let first = true;
  return deidentify(text, ownerFirstName).replace(/\b[A-Z][a-z]{2,}\b/g, (word) => {
    if (preserveFirstWord && first) {
      first = false;
      return word;
    }
    first = false;
    return SAFE_CAPITALS.has(word) || word === ownerFirstName ? word : "someone";
  });
}

const CLINICAL =
  /\b(?:anxiety|depression|trauma|therapy|therapist|burnout|impostor syndrome|codependency|anxious perfectionism|attachment avoidance)\b/gi;
export function stripImportClinical(text: string): string {
  return text.replace(CLINICAL, "").replace(/\s{2,}/g, " ").trim();
}

export function preflightImportSafety(raw: string): { risk: ImportRisk; reason: string } {
  if (
    /\b(?:i am|i['’]m|you are|you['’]re)\s+(?:[0-9]|1[0-7])\b/i.test(raw) ||
    /\b(?:under[- ]?18|a minor)\b/i.test(raw)
  ) {
    return { risk: "minor", reason: "under_18" };
  }
  if (
    /\b(?:call emergency services|suicide hotline|crisis line|immediate danger|contact a crisis)\b/i.test(raw)
  ) {
    return { risk: "self", reason: "source_ai_safety_message" };
  }
  if (
    /\b(?:afraid|scared|fearful)\s+of\s+(?:my|your|their)\s+(?:partner|husband|wife|boyfriend|girlfriend)\b/i
      .test(raw) ||
    /\b(?:partner|husband|wife|boyfriend|girlfriend)\s+(?:controls?|threatens?|hits?|hurts?|chokes?|strangles?)\b/i
      .test(raw)
  ) return { risk: "partner", reason: "partner_fear_control_violence" };
  return { risk: "none", reason: "none" };
}

function cleanLine(line: string): string {
  return line.trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function field(line: string): { key: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z (),]+?)(?:\s+\d+)?\s*(?::|[—–-])\s*(.*)$/.exec(cleanLine(line));
  return match ? { key: match[1].trim().toUpperCase(), value: match[2].trim() } : null;
}

/** Confidence belongs to Presence, not the source assistant. */
export function importConfidence(knowsMe: KnowsMe, seen: number): number {
  const familiarity = knowsMe === "a lot" ? 0.15 : knowsMe === "some" ? 0.05 : 0;
  const evidence = seen >= 3 ? 0.6 : seen === 2 ? 0.5 : 0.35;
  return Math.min(0.8, evidence + familiarity);
}

function assertion(text: string, seen: number, knowsMe: KnowsMe): ImportAssertion {
  return {
    text,
    seen,
    confidence: importConfidence(knowsMe, seen),
    tensionCandidate:
      /(?:time|went)\s+(?:it\s+)?went\s+the\s+other\s+way|time\s+it\s+went\s+the\s+other\s+way/i.test(text),
    l0Candidate: false,
  };
}

/** Parse the labelled PSY prompt v1 answer without trusting any model-supplied confidence. */
export function parsePsyPromptV1(raw: string): PsyPromptV1 {
  const lines = raw.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const knows = lines.map(field).find((value) =>
    value?.key === "KNOWS ME" && (KNOWS_ME as readonly string[]).includes(value.value.toLowerCase())
  );
  if (!knows) throw new Error("psy_v1_knows_me_missing");
  const knowsMe = knows.value.toLowerCase() as KnowsMe;
  const moments: ImportMoment[] = [];
  const groups: Record<"THEME" | "RULE" | "PATTERN" | "WITH PEOPLE" | "MATTERS", ImportAssertion[]> = {
    THEME: [],
    RULE: [],
    PATTERN: [],
    "WITH PEOPLE": [],
    MATTERS: [],
  };
  let moment: Partial<ImportMoment> | null = null;
  let pending: { group: keyof typeof groups; text: string; seen: number } | null = null;
  const flushMoment = () => {
    if (moment?.whatHappened && moment.whatTheyDidOrSaid && moment.area) {
      moments.push({
        whatHappened: moment.whatHappened,
        whatTheyDidOrSaid: moment.whatTheyDidOrSaid,
        aiWords: moment.aiWords || null,
        area: moment.area,
      });
    }
    moment = null;
  };
  const flushAssertion = () => {
    if (pending?.text) {
      groups[pending.group].push(assertion(pending.text, pending.seen, knowsMe));
    }
    pending = null;
  };
  for (const line of lines) {
    const parsed = field(line);
    const bareSection = /^(MOMENT|THEME|RULE|PATTERN|WITH PEOPLE|MATTERS)(?:\s+\d+)?$/i.exec(line);
    if (!parsed && bareSection) {
      const key = bareSection[1].toUpperCase();
      flushMoment();
      flushAssertion();
      if (key === "MOMENT") moment = {};
      else pending = { group: key as keyof typeof groups, text: "", seen: 1 };
      continue;
    }
    if (!parsed) continue;
    const key = parsed.key.replace(/\s+/g, " ");
    if (key === "MOMENT") {
      flushAssertion();
      flushMoment();
      moment = {};
      continue;
    }
    if (key === "WHAT HAPPENED" && moment) moment.whatHappened = parsed.value;
    else if (
      (key === "WHAT I DID OR SAID" || key === "WHAT YOU DID OR SAID" || key === "WHAT THEY DID OR SAID") &&
      moment
    ) {
      moment.whatTheyDidOrSaid = parsed.value;
    } else if ((key === "MY WORDS" || key === "YOUR WORDS") && moment) {
      moment.aiWords = /^(?:none|n\/a|—|-)$/i.test(parsed.value) ? null : parsed.value;
    } else if (key === "AREA" && moment && isArea(parsed.value.toLowerCase())) {
      moment.area = parsed.value.toLowerCase() as Area;
    } else if (key in groups) {
      flushMoment();
      flushAssertion();
      pending = { group: key as keyof typeof groups, text: parsed.value, seen: 1 };
    } else if (key === "SEEN" && pending) {
      const n = Number.parseInt(parsed.value, 10);
      pending.seen = Number.isFinite(n) && n > 0
        ? n
        : /often/i.test(parsed.value)
        ? 3
        : /few/i.test(parsed.value)
        ? 2
        : 1;
    } else if (pending && parsed.value) {
      pending.text += `${pending.text ? "\n" : ""}${key}: ${parsed.value}`;
    }
  }
  flushMoment();
  flushAssertion();
  const distinctSituations = new Set(moments.map((value) => value.whatHappened.toLowerCase())).size;
  return {
    knowsMe,
    moments,
    themes: groups.THEME.map((value) => ({
      ...value,
      l0Candidate: value.seen >= 2 && distinctSituations >= 2,
    })),
    rules: groups.RULE,
    patterns: groups.PATTERN,
    withPeople: groups["WITH PEOPLE"],
    matters: groups.MATTERS,
    // Prompt v2 keeps KNOWS ME "a little" after the assistant interviews the person. Completed
    // evidence sections distinguish that answer from the genuinely thin pre-interview response.
    initialRoundEligible: knowsMe !== "a little" ||
      moments.length + Object.values(groups).reduce((sum, values) => sum + values.length, 0) > 0,
  };
}

export interface ImportGuess {
  id: string;
  label: string;
  statement: string;
  type: BeliefType;
  area: Area;
  note: string;
  priority: number;
  mergeKey: string;
  confidence: number;
}
export interface ImportStages {
  risk: ImportRisk;
  thin: boolean;
  guesses: ImportGuess[];
  psy: PsyPromptV1 | null;
  exchanges: ModelExchange[];
}

export function readSafety(raw: string): { risk: ImportRisk; reason: string } {
  const v = extractJson(raw) as Record<string, unknown>;
  const risk = v.risk === "self" || v.risk === "others" || v.risk === "partner" || v.risk === "minor"
    ? v.risk
    : "none";
  return { risk, reason: s(v.reason, 200) };
}

export function readScrub(raw: string, ownerFirstName: string): string {
  const v = extractJson(raw) as Record<string, unknown>;
  const text = typeof v.text === "string" ? v.text.trim() : "";
  return text.split(/\r?\n/).map((line) => {
    const heading = cleanLine(line);
    if (/^(?:MOMENT|THEME|RULE|PATTERN|WITH PEOPLE|MATTERS)(?:\s+\d+)?$/i.test(heading)) return heading;
    if (/^MORE TO COME$/i.test(heading)) return heading;
    const colon = line.indexOf(":");
    if (colon < 0) return strictDeidentify(line, ownerFirstName, true);
    const label = line.slice(0, colon + 1);
    const value = stripImportClinical(line.slice(colon + 1).trim());
    return value ? `${label} ${strictDeidentify(value, ownerFirstName, true)}` : label;
  }).join("\n");
}

/** Split only for model context. Every source character is retained and every resulting chunk is processed. */
export function chunkImportText(raw: string, maxChars = IMPORT_CHUNK_CHARS): string[] {
  if (raw.length <= maxChars) return [raw];
  const paragraphs = raw.split("\n\n");
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current) chunks.push(current);
    current = "";
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      push();
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        chunks.push(paragraph.slice(offset, offset + maxChars));
      }
      continue;
    }
    const joined = current ? `${current}\n\n${paragraph}` : paragraph;
    if (joined.length > maxChars) push();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  push();
  return chunks;
}

export function readGuesses(
  raw: string,
  ownerFirstName: string,
  idFor = () => crypto.randomUUID(),
): ImportGuess[] {
  const v = extractJson(raw) as Record<string, unknown>;
  const rows = Array.isArray(v.guesses) ? v.guesses : [];
  const out: ImportGuess[] = [];
  for (const [index, value] of rows.entries()) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const label = strictDeidentify(s(row.label, 60).replace(/[.!?]+$/, ""), ownerFirstName, true);
    const statement = strictDeidentify(s(row.statement, 400), ownerFirstName);
    const note = strictDeidentify(s(row.note, 500), ownerFirstName);
    if (
      !label || label.split(/\s+/).length > 4 || !statement || !note ||
      cardWordHits(`${label} ${statement}`).length
    ) continue;
    const type = isType(row.type) ? row.type : "how I tend to react";
    const area = isArea(row.area) ? row.area : areaFor(["self"]);
    out.push({
      id: idFor(),
      label,
      statement,
      type,
      area,
      note,
      priority: rows.length - index,
      mergeKey: importMergeKey(area, label, statement),
      confidence: importConfidence("a little", 1),
    });
  }
  return out;
}

export function importMergeKey(area: Area, label: string, statement: string): string {
  const words = `${label} ${statement}`.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return `${area}:${[...new Set(words)].slice(0, 12).join("-")}`;
}

export function importRound<T extends { priority: number }>(rows: readonly T[], first: boolean): T[] {
  const limit = first ? IMPORT_FIRST_ROUND_MAX : IMPORT_LATER_ROUND_MAX;
  return [...rows].sort((a, b) => b.priority - a.priority).slice(0, limit);
}

export function initialImportRound<T extends { priority: number }>(
  rows: readonly T[],
  psy: Pick<PsyPromptV1, "initialRoundEligible"> | null,
): T[] {
  return psy === null || psy.initialRoundEligible ? importRound(rows, true) : [];
}

export function repeatImportPrompt(thinAreas: readonly Area[]): string | null {
  const areas = [...new Set(thinAreas)].filter(isArea);
  if (!areas.length) return null;
  return `Ask your AI only about moments in these areas where your map is still thin: ${areas.join(", ")}.`;
}

export async function runImportStages(
  client: ModelClient,
  raw: string,
  ownerFirstName: string,
): Promise<ImportStages> {
  const exchanges: ModelExchange[] = [];
  const call = async (purpose: string, system: string, content: string, maxTokens: number) => {
    const exchange = await client.complete({
      purpose,
      system,
      messages: [{ role: "user", content }],
      maxTokens,
    });
    exchanges.push(exchange);
    if (exchange.error && !exchange.rawResponse) throw new Error(exchange.error);
    return exchange.rawResponse;
  };
  const chunks = chunkImportText(raw);
  const allGuesses: ImportGuess[] = [];
  for (const chunk of chunks) {
    const safety = readSafety(await call("import_safety", IMPORT_SAFETY, chunk, 200));
    if (safety.risk !== "none") {
      return { risk: safety.risk, thin: false, guesses: [], psy: null, exchanges };
    }
  }
  const scrubbedChunks: string[] = [];
  for (const chunk of chunks) {
    scrubbedChunks.push(readScrub(await call("import_scrub", IMPORT_SCRUB, chunk, 4000), ownerFirstName));
  }
  let psy: PsyPromptV1 | null = null;
  try {
    // Continuations after MORE TO COME need not repeat KNOWS ME. Parse the reassembled answer so
    // later pasted parts remain one import even though model calls stay within bounded contexts.
    psy = parsePsyPromptV1(scrubbedChunks.join("\n\n"));
  } catch {
    // Missing or reordered labels still fall through to whole-answer extraction chunk by chunk.
  }
  for (const scrubbed of scrubbedChunks) {
    let chunkPsy: PsyPromptV1 | null = null;
    try {
      chunkPsy = parsePsyPromptV1(scrubbed);
    } catch {
      // Real assistants often omit or reorder the requested labels. The listener still receives the whole
      // de-identified answer; absence of formatting is not evidence that the answer is thin.
    }
    const assertions = chunkPsy
      ? [
        ...chunkPsy.themes,
        ...chunkPsy.rules,
        ...chunkPsy.patterns,
        ...chunkPsy.withPeople,
        ...chunkPsy.matters,
      ]
      : [];
    const listenerInput = chunkPsy ? JSON.stringify(chunkPsy) : scrubbed;
    const guesses = readGuesses(
      await call("import_listener", IMPORT_LISTENER, listenerInput, 4000),
      ownerFirstName,
    ).map((guess, index) => {
      const source = assertions[index];
      const type = guess.type === "something I believe is true" && chunkPsy && !source?.l0Candidate
        ? "how I tend to react"
        : guess.type;
      return {
        ...guess,
        type,
        confidence: source?.confidence ?? importConfidence(chunkPsy?.knowsMe ?? psy?.knowsMe ?? "some", 1),
      };
    });
    allGuesses.push(...guesses);
  }
  const byMergeKey = new Map<string, ImportGuess>();
  for (const guess of allGuesses) if (!byMergeKey.has(guess.mergeKey)) byMergeKey.set(guess.mergeKey, guess);
  return { risk: "none", thin: byMergeKey.size === 0, guesses: [...byMergeKey.values()], psy, exchanges };
}

export function redactImportExchange(exchange: ModelExchange): ModelExchange {
  return {
    ...exchange,
    rawResponse: "[deleted after import stage]",
    request: {
      ...exchange.request,
      messages: exchange.request.messages.map((m) => ({ ...m, content: "[deleted after import stage]" })),
    },
  };
}

/** At session end only explicitly rated cards keep their de-identified source receipt row. */
export function discardedImportGuessIds(allIds: string[], ratedIds: Iterable<string>): string[] {
  const kept = new Set(ratedIds);
  return allIds.filter((id) => !kept.has(id));
}
