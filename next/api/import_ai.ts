// Import from your AI (DV-3): off by default. Raw text exists only for this request and is never persisted or traced.

import { AnthropicClient } from "../engine/model/client.ts";
import type { ModelClient } from "../engine/model/client.ts";
import type { ModelExchange } from "../engine/types.ts";
import { RESOURCES } from "../engine/safety.ts";
import { unreadBody } from "./lib/safety_gate.ts";
import { requireSafetyPass } from "./_shared/safety/gate.ts";
import {
  importConfidence,
  initialImportRound,
  isThinImportAnswer,
  preflightImportSafety,
  redactImportExchange,
  runImportStages,
} from "../engine/import_ai.ts";
import { type Ctx, route } from "./lib/router.ts";
import { ApiError, json, recordError } from "./lib/errors.ts";
import { dbError } from "./lib/db.ts";
import { ImportLedger, type LedgerScope, PostgresLedger, recordEngineCall } from "./lib/ledger.ts";
import {
  AREAS,
  type Area,
  DOMAIN_FOR_AREA,
  type FoundationLens,
  kindFor,
  lensForAbout,
  lensForArea,
  LEVEL_FOR_TYPE,
  statusForRating,
} from "./lib/map.ts";
import { BELIEF_TYPES, type BeliefType } from "../engine/types.ts";
import { beliefsFor, type Row } from "./lib/objects.ts";

const MODEL = "claude-haiku-5-5";
export const IMPORT_PROVIDER = "anthropic";
const RATINGS = ["not", "partly", "very"] as const;
const ROUND_RATINGS = [...RATINGS, "not_sure", "skip"] as const;
const RESOLUTION_CHOICES = ["first", "second", "both", "neither"] as const;
const FEEL_ANSWERS = ["yes", "partly", "not_really", "skipped"] as const;
const KNOWS_ME = ["a lot", "some", "a little"] as const;
const IMPORT_SOURCES = ["chatgpt", "claude", "gemini", "other"] as const;
const LOCAL_TOP_LEVEL_FIELDS = new Set(["assistant", "imported_at", "knows_me", "guesses"]);
const LOCAL_GUESS_FIELDS = new Set([
  "guess_id",
  "label",
  "statement",
  "type",
  "area",
  "about",
  "merge_key",
  "rating",
  "wording",
]);
export const hooks: { client: ((ctx: Ctx, ledger: PostgresLedger) => ModelClient) | null } = { client: null };

type ImportRating = typeof RATINGS[number];
type KnowsMe = typeof KNOWS_ME[number];

export interface LocalImportGuess {
  guessId: string;
  label: string;
  statement: string;
  type: BeliefType;
  area: typeof AREAS[number];
  about: string | null;
  mergeKey: string;
  rating: ImportRating | null;
  wording: string | null;
}

export interface LocalImportBody {
  assistant: string;
  importedAt: string;
  importDate: string;
  knowsMe: KnowsMe;
  guesses: LocalImportGuess[];
}

export interface ImportRoundRow extends Row {
  id: string;
  import_id: string;
  label: string;
  statement: string;
  type: string;
  area: string;
  about?: string | null;
  merge_key?: string | null;
  note?: string | null;
  priority?: number | null;
  source_assistant: string;
  source_date: string;
  source?: typeof IMPORT_SOURCES[number];
  imported_at?: string;
}

function invalid(field: string): never {
  throw new ApiError("invalid", "", { field });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function onlyFields(value: Record<string, unknown>, allowed: Set<string>, prefix: string) {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) invalid(prefix ? `${prefix}.${unexpected}` : unexpected);
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(field);
  const text = value.trim();
  if (!text || text.length > max) invalid(field);
  return text;
}

/** The local boundary is deliberately closed: raw answers and AI notes are unknown fields and are refused. */
export function parseLocalImportBody(value: unknown): LocalImportBody {
  const body = record(value, "body");
  onlyFields(body, LOCAL_TOP_LEVEL_FIELDS, "");
  const assistant = boundedString(body.assistant, "assistant", 60);
  const importedText = typeof body.imported_at === "string" ? body.imported_at : "";
  const imported = /^\d{4}-\d{2}-\d{2}T/.test(importedText) ? Date.parse(importedText) : NaN;
  if (!Number.isFinite(imported)) invalid("imported_at");
  if (!(KNOWS_ME as readonly unknown[]).includes(body.knows_me)) invalid("knows_me");
  if (!Array.isArray(body.guesses)) invalid("guesses");
  const mergeKeys = new Set<string>();
  const guesses = body.guesses.map((value, index): LocalImportGuess => {
    const prefix = `guesses.${index}`;
    const guess = record(value, prefix);
    onlyFields(guess, LOCAL_GUESS_FIELDS, prefix);
    const guessId = boundedString(guess.guess_id, `${prefix}.guess_id`, 64);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(guessId)) {
      invalid(`${prefix}.guess_id`);
    }
    const type = guess.type;
    if (!(BELIEF_TYPES as readonly unknown[]).includes(type)) invalid(`${prefix}.type`);
    const area = guess.area;
    if (!(AREAS as readonly unknown[]).includes(area)) invalid(`${prefix}.area`);
    const rating = guess.rating;
    if (rating !== null && !(RATINGS as readonly unknown[]).includes(rating)) invalid(`${prefix}.rating`);
    const mergeKey = boundedString(guess.merge_key, `${prefix}.merge_key`, 240);
    if (mergeKeys.has(mergeKey)) invalid(`${prefix}.merge_key`);
    mergeKeys.add(mergeKey);
    const about = guess.about === null ? null : boundedString(guess.about, `${prefix}.about`, 240);
    const wording = guess.wording === undefined
      ? null
      : boundedString(guess.wording, `${prefix}.wording`, 400);
    return {
      guessId,
      label: boundedString(guess.label, `${prefix}.label`, 80),
      statement: boundedString(guess.statement, `${prefix}.statement`, 400),
      type: type as BeliefType,
      area: area as typeof AREAS[number],
      about,
      mergeKey,
      rating: rating as ImportRating | null,
      wording,
    };
  });
  const importedAt = new Date(imported).toISOString();
  return {
    assistant,
    importedAt,
    importDate: importedText.slice(0, 10),
    knowsMe: body.knows_me as KnowsMe,
    guesses,
  };
}

function reading(row: ImportRoundRow) {
  return {
    label: row.label,
    statement: row.statement,
    type: row.type,
    area: row.area,
    about: row.about ?? null,
    merge_key: row.merge_key ?? row.id,
  };
}

function readingKey(row: ImportRoundRow): string {
  return JSON.stringify(reading(row));
}

const semanticText = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A confirmed Talk belief is the person's evidence and outranks matching imported wording. */
export function matchingTalkBelief(
  beliefs: readonly Row[],
  reading: Pick<Row, "area" | "label" | "statement">,
): Row | undefined {
  return beliefs.find((belief) =>
    belief.source === "talk" && belief.status === "confirmed" && belief.area === reading.area &&
    semanticText(belief.label) === semanticText(reading.label) &&
    semanticText(belief.statement) === semanticText(reading.statement)
  );
}

/** First round targets 5-7 items; later rounds collapse to at most 3 (COO Q4 2026-11-05, E17). */
export const PERSON_ROUND_FIRST_MAX = 7;
export const PERSON_ROUND_LATER_MAX = 3;

/** Collapse person-wide waiting guesses into review round items (E17: 5-7 first round, 3 later). */
export function personImportRound(
  rows: readonly ImportRoundRow[],
  first = false,
  options?: { thinAreas?: ReadonlySet<string> },
) {
  const groups = new Map<string, ImportRoundRow[]>();
  for (const row of rows) {
    const key = row.merge_key?.trim() || row.id;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const sourceKey = (row: ImportRoundRow) =>
    row.source ?? String(row.source_assistant).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const depth = (row: ImportRoundRow) =>
    row.type === "something I believe is true"
      ? 5
      : row.type === "a rule I live by"
      ? 4
      : row.type === "something I do to cope"
      ? 3
      : row.type === "a view or taste"
      ? 2
      : 1;
  const ranked = [...groups.values()].sort((a, b) => {
    const aSources = new Set(a.map(sourceKey)).size, bSources = new Set(b.map(sourceKey)).size;
    return Math.max(...b.map(depth)) - Math.max(...a.map(depth)) ||
      Math.max(...b.map((row) => Number(row.confidence ?? 0.35))) -
        Math.max(...a.map((row) => Number(row.confidence ?? 0.35))) ||
      bSources - aSources ||
      Math.max(...b.map((row) => Number(row.priority ?? 0))) -
        Math.max(...a.map((row) => Number(row.priority ?? 0))) ||
      String(a[0].id).localeCompare(String(b[0].id));
  });
  const groupLens = (group: ImportRoundRow[]): FoundationLens =>
    lensForAbout(group[0].about) ?? lensForArea(group[0].area as Area);

  const limit = first ? PERSON_ROUND_FIRST_MAX : PERSON_ROUND_LATER_MAX;
  let ordered = ranked;
  if (!first && options?.thinAreas?.size) {
    const thin = options.thinAreas;
    ordered = ranked
      .map((group, index) => ({ group, index }))
      .sort((a, b) =>
        (thin.has(String(a.group[0].area)) ? 0 : 1) - (thin.has(String(b.group[0].area)) ? 0 : 1) ||
        a.index - b.index
      )
      .map(({ group }) => group);
  }

  const spread: ImportRoundRow[][] = [];
  const areas = new Map<string, number>();
  if (first) {
    // Pass 1: the top-ranked group from each distinct area, before any area gets a second.
    for (const group of ordered) {
      if (spread.length >= limit) break;
      const area = String(group[0].area);
      if (areas.has(area)) continue;
      spread.push(group);
      areas.set(area, 1);
    }
    // Pass 2: at least one me-lens and one others-lens item, when one is available.
    const lensesPresent = new Set(spread.map(groupLens));
    for (const neededLens of ["me", "others"] as const) {
      if (spread.length >= limit || lensesPresent.has(neededLens)) continue;
      const candidate = ordered.find((group) =>
        !spread.includes(group) && groupLens(group) === neededLens &&
        (areas.get(String(group[0].area)) ?? 0) < 2
      );
      if (!candidate) continue;
      spread.push(candidate);
      areas.set(String(candidate[0].area), (areas.get(String(candidate[0].area)) ?? 0) + 1);
      lensesPresent.add(neededLens);
    }
  }
  // Pass 3: fill the rest by priority, at most two items per area.
  for (const group of ordered) {
    if (spread.length >= limit) break;
    if (spread.includes(group)) continue;
    const area = String(group[0].area);
    if ((areas.get(area) ?? 0) >= 2) continue;
    spread.push(group);
    areas.set(area, (areas.get(area) ?? 0) + 1);
  }
  const items = spread.map((group) => {
    const distinct = [...new Map(group.map((row) => [readingKey(row), row])).values()];
    const chosen = distinct.length > 1 ? distinct.slice(0, 2) : group;
    const sourceCount = new Set(group.map(sourceKey)).size;
    const confidence = Math.round(
      Math.min(
        0.8,
        Math.max(...group.map((row) => Number(row.confidence ?? 0.35))) + Math.max(0, sourceCount - 1) * 0.1,
      ) * 100,
    ) / 100;
    const sources = chosen.map((row) => ({
      guess_id: row.id,
      import_id: row.import_id,
      assistant: row.source_assistant,
      date: String(row.source_date).slice(0, 10),
      ...(row.note ? { note: row.note } : {}),
    }));
    if (distinct.length > 1) {
      return {
        item_id: chosen[0].id,
        kind: "disagreement" as const,
        guess_ids: chosen.map((row) => row.id),
        sources,
        readings: chosen.map(reading),
        confidence,
      };
    }
    return {
      item_id: group[0].id,
      kind: group.length > 1 ? "merged" as const : "ordinary" as const,
      guess_ids: group.map((row) => row.id),
      sources,
      reading: reading(group[0]),
      confidence,
      ...(sourceCount >= 2
        ? { agreement: { sources: sourceCount, line: `${sourceCount} of your AIs noticed this` } }
        : {}),
    };
  });
  return { items, has_waiting: rows.length > 0 };
}

/** A score is withheld until three generic-check-surviving guesses have a definite owner rating. */
export function importScoreEligible(rows: readonly Row[]): boolean {
  return rows.filter((row) => (RATINGS as readonly unknown[]).includes(row.rating)).length >= 3;
}

/** Imported core guesses wait at the reaction ring until a Talk receipt promotes the pending level. */
export function importPlacement(type: BeliefType) {
  const wanted = LEVEL_FOR_TYPE[type];
  return wanted === "L0"
    ? { kind: "everyday", level: "L4", pending_level: "L0" }
    : { kind: kindFor(type), level: wanted, pending_level: null };
}

function localBeliefRow(owner: string, id: string, body: LocalImportBody, guess: LocalImportGuess): Row {
  const rating = guess.rating!;
  const now = new Date().toISOString();
  return {
    id,
    owner,
    label: guess.label,
    statement: guess.wording || guess.statement,
    type: guess.type,
    ...importPlacement(guess.type),
    area: guess.area,
    domains: [DOMAIN_FOR_AREA[guess.area]],
    birth_mood: "neutral",
    status: statusForRating(rating),
    rating,
    confidence: importConfidence(body.knowsMe, 1),
    source: "import",
    rated_at: now,
    ...(rating === "not"
      ? { set_aside_at: now, confirmed_at: null }
      : { confirmed_at: now, set_aside_at: null }),
    import_assistant: body.assistant,
    import_date: body.importDate,
    import_merge_key: guess.mergeKey,
  };
}

/** Retire the caller's whole waiting set, regardless of which imports supplied it. */
export async function clearAllWaitingImports(
  service: Ctx["service"],
  owner: string,
  at = new Date().toISOString(),
) {
  const { data, error } = await service.from("ai_import_guesses").select("import_id").eq("owner", owner).eq(
    "status",
    "waiting",
  );
  if (error) dbError(error, "ai_import_guesses.clear_all.read");
  const importIds = [...new Set((data ?? []).map((row) => String(row.import_id)))];
  if (importIds.length) {
    const { error: ge } = await service.from("ai_import_guesses").update({
      status: "retired",
      retired_at: at,
    }).eq("owner", owner).eq("status", "waiting");
    if (ge) dbError(ge, "ai_import_guesses.clear_all");
    const { error: ie } = await service.from("ai_imports").update({
      status: "cleared",
      answered_at: at,
    }).eq("owner", owner).in("id", importIds);
    if (ie) dbError(ie, "ai_imports.clear_all");
  }
  return { cleared: true, has_waiting: false as const };
}

export function requireImportAccess(ctx: Pick<Ctx, "env" | "caller">) {
  if (!ctx.env.importFromAi) throw new ApiError("forbidden", "", { reason: "feature_off" });
  if (!ctx.caller || !ctx.env.importOwnerId || ctx.caller.id !== ctx.env.importOwnerId) {
    throw new ApiError("forbidden", "", { reason: "owner_only" });
  }
}

/** Import requires evidence that the one-time provider disclosure was shown. */
export function requireImportProviderDisclosure(value: unknown) {
  const disclosure = value && typeof value === "object"
    ? (value as Record<string, unknown>).provider_disclosure
    : null;
  const disclosedAt = disclosure && typeof disclosure === "object"
    ? (disclosure as Record<string, unknown>).disclosed_at
    : null;
  if (
    !disclosure || typeof disclosure !== "object" ||
    (disclosure as Record<string, unknown>).provider !== IMPORT_PROVIDER ||
    typeof disclosedAt !== "string" || !disclosedAt.trim() ||
    !Number.isFinite(Date.parse(disclosedAt))
  ) {
    throw new ApiError("forbidden", "", {
      reason: "import_provider_disclosure_required",
      provider: IMPORT_PROVIDER,
    });
  }
}

function clientFor(ctx: Ctx, ledger: PostgresLedger): ModelClient {
  if (hooks.client) return hooks.client(ctx, ledger);
  if (!ctx.env.anthropicKey || !ctx.env.anthropicWorkspace) {
    throw new ApiError("unreachable", "Can't reach Presence right now.");
  }
  return new AnthropicClient({
    config: { key: ctx.env.anthropicKey, workspace: ctx.env.anthropicWorkspace },
    ledger,
    defaultModel: MODEL,
    fallbackModel: null,
    thinking: "disabled",
    timeoutMs: 30_000,
  });
}

async function firstName(ctx: Ctx) {
  const { data } = await ctx.service.from("profiles").select("name").eq("id", ctx.caller!.id).maybeSingle();
  return String(data?.name ?? "there").trim().split(/\s+/)[0] || "there";
}

async function redactedTrace(
  ctx: Ctx,
  scope: LedgerScope,
  ledger: PostgresLedger,
  exchanges: ModelExchange[],
) {
  const ids = [...ledger.ids.values()];
  for (let i = 0; i < exchanges.length; i++) {
    const e = exchanges[i];
    await recordEngineCall(ctx.service, scope, redactImportExchange(e), ids[i] ?? null);
  }
}

route("POST", "/imports/local", async (ctx) => {
  requireImportAccess(ctx);
  const parsed = parseLocalImportBody(await ctx.body());
  const owner = ctx.caller!.id;
  const { data: batch, error } = await ctx.service.from("ai_imports").insert({
    owner,
    source_assistant: parsed.assistant,
    source_date: parsed.importDate,
    knows_me: parsed.knowsMe,
    imported_at: parsed.importedAt,
    processed_on_device: true,
    status: "answered",
    answered_at: new Date().toISOString(),
  }).select("id").single();
  if (error) dbError(error, "ai_imports.local.insert");

  const mergeKeys = parsed.guesses.map((guess) => guess.mergeKey);
  let waiting: Row[] = [], existingBeliefs: Row[] = [];
  if (mergeKeys.length) {
    const [{ data: waitingData, error: waitingError }, { data: beliefData, error: beliefError }] =
      await Promise.all([
        ctx.service.from("ai_import_guesses").select("id,merge_key,status").eq("owner", owner).eq(
          "status",
          "waiting",
        ).in("merge_key", mergeKeys),
        ctx.service.from("beliefs").select("*").eq("owner", owner).neq("status", "deleted"),
      ]);
    if (waitingError) dbError(waitingError, "ai_import_guesses.local.merge");
    if (beliefError) dbError(beliefError, "beliefs.local.merge");
    waiting = waitingData ?? [];
    existingBeliefs = beliefData ?? [];
  }

  if (parsed.guesses.length) {
    const { error: ge } = await ctx.service.from("ai_import_guesses").insert(parsed.guesses.map((guess) => ({
      id: guess.guessId,
      import_id: batch.id,
      owner,
      label: guess.label,
      statement: guess.statement,
      type: guess.type,
      area: guess.area,
      about: guess.about,
      note: "",
      status: guess.rating === null ? "retired" : "rated",
      rating: guess.rating,
      priority: 0,
      merge_key: guess.mergeKey,
      confidence: importConfidence(parsed.knowsMe, 1),
      ...(guess.rating === null
        ? { retired_at: new Date().toISOString() }
        : { rated_at: new Date().toISOString() }),
    })));
    if (ge) dbError(ge, "ai_import_guesses.local.insert");
  }

  const resultRows: Row[] = [];
  for (const guess of parsed.guesses) {
    const matches = waiting.filter((row) => row.merge_key === guess.mergeKey);
    if (matches.length) {
      const ids = matches.map((row) => String(row.id));
      const { error: me } = await ctx.service.from("ai_import_guesses").update(
        guess.rating === null
          ? { status: "retired", rating: null, retired_at: new Date().toISOString() }
          : { status: "rated", rating: guess.rating, rated_at: new Date().toISOString() },
      ).eq("owner", owner).in("id", ids);
      if (me) dbError(me, "ai_import_guesses.local.resolve_merge");
    }
    if (guess.rating === null) continue;

    const talk = matchingTalkBelief(existingBeliefs, guess);
    if (talk) {
      resultRows.push(talk);
      continue;
    }
    const existing = existingBeliefs.find((row) =>
      row.source === "import" && row.import_merge_key === guess.mergeKey
    );
    const beliefId = String(existing?.id ?? matches[0]?.id ?? guess.guessId);
    const belief = localBeliefRow(owner, beliefId, parsed, guess);
    if (existing) {
      const { id: _id, owner: _owner, ...changes } = belief;
      const { data, error: be } = await ctx.service.from("beliefs").update(changes).eq("id", beliefId).eq(
        "owner",
        owner,
      ).select("*").single();
      if (be) dbError(be, "beliefs.local.update");
      resultRows.push(data);
    } else {
      const { data, error: be } = await ctx.service.from("beliefs").insert(belief).select("*").single();
      if (be) dbError(be, "beliefs.local.insert");
      resultRows.push(data);
      existingBeliefs.push(data);
    }
  }

  return json({ import_id: batch.id, beliefs: await beliefsFor(ctx.caller!.db, resultRows) });
});

route("POST", "/imports/ai", async (ctx) => {
  requireImportAccess(ctx);
  const b = await ctx.body();
  requireImportProviderDisclosure(b);
  const raw = typeof b.text === "string" ? b.text.trim() : "";
  if (!raw) throw new ApiError("invalid", "", { field: "text" });
  if (!(IMPORT_SOURCES as readonly unknown[]).includes(b.source)) invalid("source");
  const importedAtMillis = typeof b.imported_at === "string" ? Date.parse(b.imported_at) : NaN;
  if (!Number.isFinite(importedAtMillis)) invalid("imported_at");
  const source = b.source as typeof IMPORT_SOURCES[number];
  const importedAt = new Date(importedAtMillis).toISOString();
  const sourceDate = importedAt.slice(0, 10);
  const sourceAssistant = source === "chatgpt"
    ? "ChatGPT"
    : source === "claude"
    ? "Claude"
    : source === "gemini"
    ? "Gemini"
    : "Other";
  if (isThinImportAnswer(raw)) {
    return json({ state: "thin", import_id: null, created_at: null, guesses: [], score_eligible: false });
  }
  const importFloor = preflightImportSafety(raw);
  if (importFloor.risk !== "none") {
    return json({ state: "safety", guesses: [], resources: RESOURCES, import_id: null, private: true });
  }
  const floor = await requireSafetyPass(ctx, raw, "import_ai");
  if (floor.routed === "unavailable") return json(unreadBody({ guesses: [], import_id: null }));
  if (floor.stop) return json({ state: "safety", guesses: [], resources: RESOURCES, import_id: null });

  const owner = ctx.caller!.id;
  const scope: LedgerScope = { person: owner, ownerPreview: ctx.caller!.isPreview, conversationId: null, feature: "import" };
  const ledger = new ImportLedger(ctx.service, scope), client = clientFor(ctx, ledger);
  let exchanges: ModelExchange[] = [];
  try {
    const name = await firstName(ctx);
    let stages;
    try {
      stages = await runImportStages(client, raw, name);
    } catch (error) {
      if (String(error).includes("budget_unavailable")) throw ledger.refusalError("import");
      if (error instanceof ApiError) throw error;
      // A stage that answers in prose instead of JSON ("no JSON object in reply"), or a provider call that fails, is the unavailable
      // state with its Try again line, never a 500 (QA 01:40Z 17 Nov: c3, c5, c10, c15 ordinary lines; DIRECTOR: degrade, never raise).
      // Nothing is saved and nothing passes: the words were not read, so they are not mapped. Only the error's name and message are kept.
      await recordError(ctx.service, owner, "POST /imports/ai", "unavailable", error instanceof Error ? `${error.name}: ${error.message}` : "unreadable stage");
      return json(unreadBody({ guesses: [], import_id: null }));
    }
    exchanges = stages.exchanges;
    if (stages.risk !== "none") {
      return json({ state: "safety", guesses: [], resources: RESOURCES, import_id: null });
    }
    const guesses = stages.guesses;
    if (stages.thin || stages.psy?.initialRoundEligible === false || guesses.length === 0) {
      return json({
        state: "thin",
        import_id: null,
        created_at: null,
        guesses: [],
        score_eligible: false,
      });
    }
    const { data: batch, error } = await ctx.service.from("ai_imports").insert({
      owner,
      source,
      source_assistant: sourceAssistant || "other",
      source_date: sourceDate,
      imported_at: importedAt,
      status: "active",
    }).select("id,created_at,source,source_assistant,source_date,imported_at").single();
    if (error) dbError(error, "ai_imports.insert");
    if (stages.psy?.moments.length) {
      const { error: me } = await ctx.service.from("ai_import_moments").insert(
        stages.psy.moments.map((moment) => ({
          import_id: batch.id,
          owner,
          what_happened: moment.whatHappened,
          what_they_did_or_said: moment.whatTheyDidOrSaid,
          ai_words: moment.aiWords,
          area: moment.area,
        })),
      );
      if (me) dbError(me, "ai_import_moments.insert");
    }
    if (guesses.length) {
      const { error: ge } = await ctx.service.from("ai_import_guesses").insert(guesses.map((g) => ({
        id: g.id,
        import_id: batch.id,
        owner,
        label: g.label,
        statement: g.statement,
        type: g.type,
        area: g.area,
        note: g.note,
        status: "waiting",
        priority: g.priority,
        merge_key: g.mergeKey,
        confidence: g.confidence,
      })));
      if (ge) dbError(ge, "ai_import_guesses.insert");
    }
    return json({
      state: "ready",
      import_id: batch.id,
      created_at: batch.created_at,
      source_assistant: batch.source_assistant,
      source_date: batch.source_date,
      source: batch.source,
      imported_at: batch.imported_at,
      guesses: initialImportRound(guesses, stages.psy).map((g) => ({
        guess_id: g.id,
        label: g.label,
        statement: g.statement,
        type: g.type,
        area: g.area,
        note: g.note,
      })),
      score_eligible: false,
    });
  } finally {
    await redactedTrace(ctx, scope, ledger, exchanges);
  }
});

route("GET", "/imports/ai/round", async (ctx) => {
  requireImportAccess(ctx);
  const owner = ctx.caller!.id;
  const { data, error: ge } = await ctx.service.from("ai_import_guesses").select("*").eq("owner", owner);
  if (ge) dbError(ge, "ai_import_guesses.round");
  const allGuesses = data ?? [];
  const guesses = allGuesses.filter((guess) => guess.status === "waiting");
  const scoreEligible = importScoreEligible(allGuesses);
  if (!guesses.length) return json({ items: [], has_waiting: false, score_eligible: scoreEligible });
  const isFirstRound = !allGuesses.some((guess) => guess.status === "rated");
  const importIds = [...new Set(guesses.map((guess) => String(guess.import_id)))];
  const { data: batches, error } = await ctx.service.from("ai_imports").select(
    "id,source,source_assistant,source_date,imported_at",
  ).eq("owner", owner).in("id", importIds);
  if (error) dbError(error, "ai_imports.round");
  const byId = new Map((batches ?? []).map((batch) => [String(batch.id), batch]));
  const { error: ue } = await ctx.service.from("ai_imports").update({
    last_opened_at: new Date().toISOString(),
  }).eq("owner", owner).in("id", importIds);
  if (ue) dbError(ue, "ai_imports.opened");
  const rows = guesses.flatMap((guess) => {
    const batch = byId.get(String(guess.import_id));
    return batch
      ? [{
        ...guess,
        source_assistant: String(batch.source_assistant),
        source_date: String(batch.source_date),
        source: String(batch.source) as ImportRoundRow["source"],
        imported_at: String(batch.imported_at),
      } as ImportRoundRow]
      : [];
  });
  let thinAreas: Set<string> | undefined;
  if (!isFirstRound) {
    const { data: rated, error: re } = await ctx.service.from("beliefs").select("area").eq("owner", owner).eq(
      "status",
      "confirmed",
    );
    if (re) dbError(re, "beliefs.round_thin_areas");
    const coveredAreas = new Set((rated ?? []).map((row) => String(row.area)));
    thinAreas = new Set(AREAS.filter((area) => !coveredAreas.has(area)));
  }
  return json({ ...personImportRound(rows, isFirstRound, { thinAreas }), score_eligible: scoreEligible });
});

route("POST", "/imports/ai/clear-rest", async (ctx) => {
  requireImportAccess(ctx);
  return json(await clearAllWaitingImports(ctx.service, ctx.caller!.id));
});

route("POST", "/imports/ai/round/answers", async (ctx) => {
  requireImportAccess(ctx);
  const owner = ctx.caller!.id;
  const body = await ctx.body();
  if (!Array.isArray(body.answers)) invalid("answers");
  if (!Array.isArray(body.resolutions)) invalid("resolutions");

  const { data: guesses, error: ge } = await ctx.service.from("ai_import_guesses").select("*").eq(
    "owner",
    owner,
  ).eq("status", "waiting");
  if (ge) dbError(ge, "ai_import_guesses.round_answers");
  const importIds = [...new Set((guesses ?? []).map((guess) => String(guess.import_id)))];
  const { data: batches, error: ie } = importIds.length
    ? await ctx.service.from("ai_imports").select("id,source,source_assistant,source_date,imported_at").eq(
      "owner",
      owner,
    ).in(
      "id",
      importIds,
    )
    : { data: [], error: null };
  if (ie) dbError(ie, "ai_imports.round_answers");
  const batchById = new Map((batches ?? []).map((batch) => [String(batch.id), batch]));
  const rows = (guesses ?? []).flatMap((guess) => {
    const batch = batchById.get(String(guess.import_id));
    return batch
      ? [{
        ...guess,
        source_assistant: String(batch.source_assistant),
        source_date: String(batch.source_date),
        source: String(batch.source) as ImportRoundRow["source"],
        imported_at: String(batch.imported_at),
      } as ImportRoundRow]
      : [];
  });
  const byGuess = new Map(rows.map((guess) => [guess.id, guess]));
  const round = personImportRound(rows);
  const byItem = new Map(round.items.map((item) => [item.item_id, item]));
  const operations: Array<Record<string, unknown>> = [];
  const tensions: Array<{ first: string; second: string }> = [];
  const seen = new Set<string>();

  for (let index = 0; index < body.answers.length; index++) {
    const answer = record(body.answers[index], `answers.${index}`);
    onlyFields(answer, new Set(["guess_id", "rating", "wording"]), `answers.${index}`);
    const guessId = typeof answer.guess_id === "string" ? answer.guess_id : "";
    if (!byGuess.has(guessId)) throw new ApiError("not_found", "", { where: "import_guess" });
    if (seen.has(guessId)) invalid(`answers.${index}.guess_id`);
    if (!(ROUND_RATINGS as readonly unknown[]).includes(answer.rating)) invalid(`answers.${index}.rating`);
    const wording = answer.wording === undefined
      ? null
      : boundedString(answer.wording, `answers.${index}.wording`, 400);
    seen.add(guessId);
    operations.push({ guess_id: guessId, rating: answer.rating, wording });
  }

  for (let index = 0; index < body.resolutions.length; index++) {
    const resolution = record(body.resolutions[index], `resolutions.${index}`);
    onlyFields(resolution, new Set(["item_id", "choice"]), `resolutions.${index}`);
    const itemId = typeof resolution.item_id === "string" ? resolution.item_id : "";
    const item = byItem.get(itemId);
    if (!item || item.kind !== "disagreement") {
      throw new ApiError("not_found", "", { where: "import_round_item" });
    }
    if (!(RESOLUTION_CHOICES as readonly unknown[]).includes(resolution.choice)) {
      invalid(`resolutions.${index}.choice`);
    }
    const [first, second] = item.guess_ids;
    if (!first || !second || seen.has(first) || seen.has(second)) invalid(`resolutions.${index}.item_id`);
    seen.add(first);
    seen.add(second);
    const choice = resolution.choice as typeof RESOLUTION_CHOICES[number];
    const ratings: [ImportRating, ImportRating] = choice === "first"
      ? ["very", "not"]
      : choice === "second"
      ? ["not", "very"]
      : choice === "both"
      ? ["very", "very"]
      : ["not", "not"];
    for (const [offset, guessId] of [first, second].entries()) {
      const guess = byGuess.get(guessId)!;
      operations.push({
        guess_id: guessId,
        rating: ratings[offset],
        wording: null,
        belief_key: `${guess.merge_key ?? guess.id}:${guess.id}`,
      });
    }
    if (choice === "both") tensions.push({ first, second });
  }

  const { data, error } = await ctx.service.rpc("rate_import_round_v2", {
    p_owner: owner,
    p_answers: operations,
    p_tensions: tensions,
  });
  if (error) dbError(error, "ai_import_guesses.round_answers.transaction");
  const result = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const beliefIds = Array.isArray(result.belief_ids) ? result.belief_ids.map(String) : [];
  let beliefRows: Row[] = [];
  if (beliefIds.length) {
    const { data: saved, error: be } = await ctx.service.from("beliefs").select("*").eq("owner", owner).in(
      "id",
      beliefIds,
    );
    if (be) dbError(be, "beliefs.round_answers");
    beliefRows = saved ?? [];
  }
  return json({
    beliefs: await beliefsFor(ctx.caller!.db, beliefRows),
    saved: Number(result.saved ?? beliefRows.length),
    has_waiting: result.has_waiting === true,
    score_eligible: result.score_eligible === true,
  });
});

route("POST", "/imports/ai/:id/feel", async (ctx) => {
  requireImportAccess(ctx);
  const body = await ctx.body();
  onlyFields(body, new Set(["answer"]), "");
  if (!(FEEL_ANSWERS as readonly unknown[]).includes(body.answer)) invalid("answer");
  const owner = ctx.caller!.id;
  const { error } = await ctx.service.rpc("answer_import_feel", {
    p_owner: owner,
    p_import: ctx.params.id,
    p_answer: body.answer,
  });
  if (error && /already_answered/.test(error.message ?? "")) {
    throw new ApiError("conflict", "", { reason: "already_answered" });
  }
  if (error) dbError(error, "ai_imports.feel.write");
  return json({ saved: true });
});

route("POST", "/imports/ai/:id/answers", async (ctx) => {
  requireImportAccess(ctx);
  const owner = ctx.caller!.id, b = await ctx.body();
  if (!Array.isArray(b.answers)) throw new ApiError("invalid", "", { field: "answers" });
  const { data: batch, error } = await ctx.service.from("ai_imports").select("*").eq("id", ctx.params.id).eq(
    "owner",
    owner,
  ).maybeSingle();
  if (error) dbError(error, "ai_imports");
  if (!batch) throw new ApiError("not_found", "", { where: "import" });
  if (batch.status !== "ready" && batch.status !== "active") {
    throw new ApiError("conflict", "", { reason: "already_answered" });
  }
  const { data: guesses, error: ge } = await ctx.service.from("ai_import_guesses").select("*").eq(
    "import_id",
    batch.id,
  ).eq("owner", owner).eq("status", "waiting");
  if (ge) dbError(ge, "ai_import_guesses");
  const byId = new Map((guesses ?? []).map((g) => [g.id as string, g]));
  const inserts: Row[] = [];
  const ratedIds: string[] = [];
  const ratingsById = new Map<string, ImportRating>();
  const seen = new Set<string>();
  for (const value of b.answers) {
    if (!value || typeof value !== "object") throw new ApiError("invalid", "", { field: "answers" });
    const answer = value as Record<string, unknown>,
      id = typeof answer.guess_id === "string" ? answer.guess_id : "";
    const guess = byId.get(id);
    if (!guess || seen.has(id)) throw new ApiError("invalid", "", { field: "guess_id" });
    seen.add(id);
    if (answer.rating === null) {
      const { error: ne } = await ctx.service.from("ai_import_guesses").update({
        status: "retired",
        retired_at: new Date().toISOString(),
      }).eq("id", id).eq("owner", owner);
      if (ne) dbError(ne, "ai_import_guesses.retire.not_sure");
      continue;
    }
    if (!(RATINGS as readonly unknown[]).includes(answer.rating)) {
      throw new ApiError("invalid", "", { field: "rating" });
    }
    const rating = answer.rating as typeof RATINGS[number], now = new Date().toISOString();
    const wording = typeof answer.wording === "string" ? answer.wording.trim() : "";
    if (wording.length > 400) throw new ApiError("invalid", "", { field: "wording" });
    const type = guess.type as BeliefType;
    inserts.push({
      id,
      owner,
      label: guess.label,
      statement: wording || guess.statement,
      type,
      ...importPlacement(type),
      area: guess.area,
      domains: [DOMAIN_FOR_AREA[guess.area as keyof typeof DOMAIN_FOR_AREA]],
      birth_mood: "neutral",
      status: statusForRating(rating),
      rating,
      confidence: Math.max(0, Math.min(1, Number(guess.confidence ?? 0.35))),
      source: "import",
      import_assistant: batch.source_assistant,
      import_date: batch.source_date,
      import_merge_key: guess.merge_key,
      rated_at: now,
      ...(rating === "not" ? { set_aside_at: now } : { confirmed_at: now }),
    });
    ratedIds.push(id);
    ratingsById.set(id, rating);
  }
  let rows: Row[] = [];
  if (inserts.length) {
    const { data, error: ie } = await ctx.service.from("beliefs").insert(inserts).select("*");
    if (ie) dbError(ie, "beliefs.insert.import");
    rows = data ?? [];
  }
  if (ratedIds.length) {
    for (const [id, rating] of ratingsById) {
      const { error: re } = await ctx.service.from("ai_import_guesses").update({
        status: "rated",
        rating,
        rated_at: new Date().toISOString(),
      }).eq("owner", owner).eq("id", id);
      if (re) dbError(re, "ai_import_guesses.rate");
    }
  }
  if (b.clear_rest === true) {
    await clearAllWaitingImports(ctx.service, owner);
  }
  const { data: waiting, error: we } = await ctx.service.from("ai_import_guesses").select("id").eq(
    "import_id",
    batch.id,
  ).eq("owner", owner).eq("status", "waiting").limit(1);
  if (we) dbError(we, "ai_import_guesses.waiting");
  const complete = !(waiting ?? []).length;
  const { error: ue } = await ctx.service.from("ai_imports").update(
    complete
      ? { status: b.clear_rest === true ? "cleared" : "answered", answered_at: new Date().toISOString() }
      : { status: "active" },
  ).eq("id", batch.id).eq("owner", owner);
  if (ue) dbError(ue, "ai_imports.update");
  return json({
    import_id: batch.id,
    beliefs: await beliefsFor(ctx.caller!.db, rows),
    saved: rows.length,
    remaining: complete ? 0 : null,
  });
});
