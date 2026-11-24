// One model client for every call. The Anthropic client reads the key from the protected config,
// never prints it, and goes through the ledger (reserve, then settle) before every paid request.
// The recorded client replays stored responses for $0 tests.

import type { ModelExchange, ModelUsage } from "../types.ts";
import type { Ledger } from "./ledger.ts";
import { NoopLedger, SAFETY_LEDGER_KIND, SAFETY_PURPOSE } from "./ledger.ts";

export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}
export interface ModelTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}
export interface ModelRequest {
  purpose: string;
  system: string;
  messages: ModelMessage[];
  maxTokens: number;
  model?: string;
  tools?: ModelTool[];
  /** Per-request override of the client's thinking setting (the semantic safety check runs Haiku with thinking off from a
   *  client built for Sonnet's between_tools, which Haiku rejects with a 400). */
  thinking?: ThinkingSetting;
  /** Per-request effort; null sends no effort field even when the client has one. */
  effort?: EffortSetting | null;
}
export interface ModelStreamObserver {
  /** Cancels the provider request when the SSE consumer sends barge-in by closing the response stream. */
  signal?: AbortSignal;
  /** Receives provider text only inside the server. Raw deltas are never forwarded to the app. */
  onDelta?: (delta: string, accumulated: string, elapsedMs: number) => void | Promise<void>;
  onFirstToken?: (elapsedMs: number) => void | Promise<void>;
}
export interface ModelClient {
  complete(req: ModelRequest, stream?: ModelStreamObserver): Promise<ModelExchange>;
}

/** Hard per-run ceiling for bounded evals. Admission uses the same worst-case price as the shared ledger,
 * while the running balance uses settled usage, so no request can take the run past its stated cap. */
export class CappedModelClient implements ModelClient {
  spent = 0;

  constructor(
    readonly inner: ModelClient,
    readonly cap: number,
    readonly defaultModel: string,
  ) {}

  async complete(req: ModelRequest): Promise<ModelExchange> {
    const model = req.model ?? this.defaultModel;
    const worst = worstCaseCents(req, model);
    if (this.spent + worst > this.cap) {
      return {
        purpose: req.purpose,
        request: { model, system: req.system, messages: req.messages, maxTokens: req.maxTokens },
        rawResponse: "",
        error:
          `budget_unavailable: run cap ${this.cap}¢; spent ${Number(this.spent.toFixed(2))}¢; next request reserves ${worst}¢`,
        usage: { model, inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 },
      };
    }
    const exchange = await this.inner.complete(req);
    // The provider's bill in fractional cents, not each call rounded up to a whole cent (a 600-token safety reading on Haiku
    // is 0.07¢; rounding counted it as 1¢, so a 200¢ run cap stopped after about 200 calls and every later reading came back
    // unavailable: the 16 Nov B336 x10 run). Admission above still uses the whole-cent worst case, so the cap holds.
    const u = exchange.usage;
    this.spent += u.inputTokens || u.outputTokens
      ? usageCentsExact(u.model, u.inputTokens, u.outputTokens, u.cacheCreationInputTokens ?? 0, u.cacheReadInputTokens ?? 0)
      : u.cents;
    return exchange;
  }
}

/** Cents per million tokens (input, output), confirmed by the director against the ledger's billed rate on 2026-10-26
 *  (A36(3), A47(4)). Unpriced IDs take the worst case in the table. Re-confirm this table (and the date above) whenever
 *  Anthropic's published per-model pricing changes; `engine_calls.cents` carries whatever this table says at call time. */
export const RATES_CENTS_PER_MILLION: Record<string, [number, number]> = {
  "claude-haiku-5-5": [100, 500],
  "claude-sonnet-5": [300, 1500],
  "claude-sonnet-5-5": [300, 1500], // assumed equal to claude-sonnet-5 until the ledger prices it
};
const WORST_RATE: [number, number] = [300, 1500];
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const FALLBACK_MODEL = "claude-sonnet-5";
const API_VERSION = "2026-10-21";

export function rate(model: string): [number, number] {
  return RATES_CENTS_PER_MILLION[model] ?? WORST_RATE;
}

/** IDs whose row in the table is an assumption, not a ledger price (A47(5): say so in every summary). */
export const ASSUMED_RATES = new Set(["claude-sonnet-5-5"]);

/** One line for a manifest: which rate row priced this model and whether it is listed, assumed or the worst case. */
export function rateNote(model: string): string {
  const [i, o] = rate(model);
  const how = ASSUMED_RATES.has(model)
    ? "assumed equal to claude-sonnet-5 until the ledger prices it"
    : model in RATES_CENTS_PER_MILLION
    ? "listed"
    : "unpriced ID, worst case in the table";
  return `rate: ${model} at ${i}/${o}¢ per million in/out (${how}); raw tokens per call are in every trace so cost can be re-priced`;
}

export function cents(model: string, inputTokens: number, outputTokens: number): number {
  const [i, o] = rate(model);
  return Math.ceil((inputTokens * i + outputTokens * o) / 1_000_000);
}

/** Provider-billed cost in fractional cents, including prompt-cache writes and reads. Five-minute writes are 1.25x base input;
 * Sonnet/Opus 5.5 reads are 0.05x and other models use Anthropic's standard 0.1x multiplier. The ledger settles this exact
 * figure (AI-COST finding 1: rounding every call up to a whole cent counted about twice the provider's bill). */
export function usageCentsExact(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens = 0,
  cacheReadInputTokens = 0,
): number {
  const [inputRate, outputRate] = rate(model);
  const readMultiplier = /claude-(?:sonnet|opus)-5-5/.test(model) ? 0.05 : 0.1;
  return (
    inputTokens * inputRate +
    cacheCreationInputTokens * inputRate * 1.25 +
    cacheReadInputTokens * inputRate * readMultiplier +
    outputTokens * outputRate
  ) / 1_000_000;
}

/** The same figure rounded up to a whole cent: what traces and `engine_calls.cents` show. Never what the ledger counts. */
export function usageCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens = 0,
  cacheReadInputTokens = 0,
): number {
  return Math.ceil(usageCentsExact(model, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens));
}

/** One UTF-8 byte per token is a deliberate overestimate for admission; usage settles the truth. */
export function worstCaseCents(req: ModelRequest, model: string): number {
  const bytes =
    new TextEncoder().encode(req.system + JSON.stringify(req.tools ?? []) + JSON.stringify(req.messages))
      .length;
  return cents(model, bytes, req.maxTokens);
}

const EPHEMERAL = { type: "ephemeral" } as const;

/** The wire shape is semantically identical to the string form. Explicit breakpoints cache the fixed tool/system prefix and
 * the conversation through its latest block; on the next turn that block is the stable earlier-turn prefix. */
export function cacheableBody(req: ModelRequest, model: string): Record<string, unknown> {
  const messages = req.messages.map((message, index) => ({
    role: message.role,
    content: [{
      type: "text",
      text: message.content,
      ...(index === req.messages.length - 1 ? { cache_control: EPHEMERAL } : {}),
    }],
  }));
  const tools = req.tools?.map((tool, index) => ({
    ...tool,
    ...(index === req.tools!.length - 1 ? { cache_control: EPHEMERAL } : {}),
  }));
  return {
    model,
    max_tokens: req.maxTokens,
    service_tier: "standard_only",
    system: [{ type: "text", text: req.system, cache_control: EPHEMERAL }],
    messages,
    ...(tools?.length ? { tools } : {}),
  };
}

/** Pull the first JSON object out of a model reply (fences and prose tolerated, nothing invented). */
export function extractJson(raw: string): unknown {
  const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
  try {
    return JSON.parse(stripped);
  } catch { /* fall through */ }
  const start = stripped.indexOf("{");
  if (start < 0) throw new Error("no JSON object in reply");
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return JSON.parse(stripped.slice(start, i + 1));
    }
  }
  throw new Error("unterminated JSON object in reply");
}

/** An error that would repeat on every later call: the API rejecting the request shape (an unsupported thinking setting, a bad
 *  key, a workspace the key may not use) or the ledger refusing the budget (NEXT-ENGINE §1: refusal stops the run). A network
 *  failure, a timeout, an overloaded 529 or a failed content check is not one: the next call may well succeed. */
export function repeatingRefusal(error: string | undefined | null): boolean {
  return typeof error === "string" &&
    /(invalid_request_error|authentication_error|permission_error|budget_unavailable)/.test(error);
}

export interface ProtectedConfig {
  key: string;
  workspace: string;
}

/** Reads $PRESENCE_HOME_ROOT/.env.anthropic.local (mode 0600). The values never leave this object. */
export async function loadProtectedConfig(): Promise<ProtectedConfig> {
  const home = Deno.env.get("HOME") ?? "";
  const root = Deno.env.get("PRESENCE_HOME_ROOT") ?? `${home}/Library/Application Support/PresenceHome`;
  const path = `${root}/.env.anthropic.local`;
  const info = await Deno.stat(path);
  if (info.mode !== null && (info.mode & 0o777) !== 0o600) {
    throw new Error("provider_not_configured: key file mode");
  }
  const values: Record<string, string> = {};
  for (const line of (await Deno.readTextFile(path)).split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (!values.ANTHROPIC_API_KEY || !values.ANTHROPIC_WORKSPACE_ID) throw new Error("provider_not_configured");
  return { key: values.ANTHROPIC_API_KEY, workspace: values.ANTHROPIC_WORKSPACE_ID };
}

/** How the model may think before the JSON. "default" sends no field (adaptive thinking on the 5.5 generation, billed
 *  as output tokens); "between_tools" is the off switch the API names for claude-sonnet-5-5; "adaptive" says it explicitly;
 *  "disabled" is the classic off switch for models that take it (claude-haiku-5-5 rejects between_tools with a 400 and thought
 *  through every Bridge call of run 041743Z, five of them cut off at the 1,200-token rewrite limit). */
export type ThinkingSetting = "default" | "between_tools" | "adaptive" | "disabled";
export const THINKING_SETTINGS: readonly ThinkingSetting[] = [
  "default",
  "between_tools",
  "adaptive",
  "disabled",
];
export type EffortSetting = "low" | "medium" | "high";

/** The thinking setting each model's run of record uses, taken when the command line names none: claude-sonnet-5-5 →
 *  between_tools (Talk 072112Z, Bridge 101508Z; with no field it thinks adaptively and the Bridge writer's 1,200-token
 *  reply was all thinking on 114004Z b04, 3¢ for no text); claude-haiku-5-5 → disabled (Bridge 101346Z); anything else
 *  → default (no field). The API's clients set the same values by hand (api/talk.ts, api/bridge_engine.ts, api/mirror.ts). */
export function defaultThinking(model: string): ThinkingSetting {
  if (model.startsWith("claude-sonnet-5-5")) return "between_tools";
  if (model.startsWith("claude-haiku-5-5")) return "disabled";
  return "default";
}
export const EFFORT_SETTINGS: readonly EffortSetting[] = ["low", "medium", "high"];

/** A --thinking / --effort value must be one of the known settings; anything else stops the run before a paid call. */
export function modelSetting<T extends string, D extends T | null>(
  value: string | boolean | undefined,
  allowed: readonly T[],
  fallback: D,
): T | D {
  if (value === undefined) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`unknown setting "${String(value)}"; use one of ${allowed.join(", ")}`);
}

export interface AnthropicOptions {
  config: ProtectedConfig;
  ledger?: Ledger;
  defaultModel?: string;
  fallbackModel?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  thinking?: ThinkingSetting;
  effort?: EffortSetting;
}

export class AnthropicClient implements ModelClient {
  readonly #config: ProtectedConfig;
  readonly #ledger: Ledger;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly thinking: ThinkingSetting;
  readonly effort: EffortSetting | null;
  defaultModel: string;
  fallbackModel: string | null;
  /** Set when a model ID was refused and the fallback took over, so later calls skip the probe. */
  resolvedModel: string | null = null;

  constructor(options: AnthropicOptions) {
    this.#config = options.config;
    this.#ledger = options.ledger ?? new NoopLedger();
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.thinking = options.thinking ?? "default";
    this.effort = options.effort ?? null;
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.fallbackModel = options.fallbackModel === undefined ? FALLBACK_MODEL : options.fallbackModel;
  }

  async complete(req: ModelRequest, stream?: ModelStreamObserver): Promise<ModelExchange> {
    if (stream?.signal?.aborted) {
      const model = req.model ?? this.resolvedModel ?? this.defaultModel;
      return {
        purpose: req.purpose,
        request: { model, system: req.system, messages: req.messages, maxTokens: req.maxTokens },
        rawResponse: "",
        error: "cancelled",
        usage: { model, inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 },
      };
    }
    const model = req.model ?? this.resolvedModel ?? this.defaultModel;
    const first = await this.#once(req, model, stream);
    if (first.error?.startsWith("model_not_found") && this.fallbackModel && model !== this.fallbackModel) {
      this.resolvedModel = this.fallbackModel;
      const second = await this.#once(req, this.fallbackModel, stream);
      second.error = second.error ?? `fell back from ${model}: ${first.error}`;
      return second;
    }
    return first;
  }

  async #once(req: ModelRequest, model: string, stream?: ModelStreamObserver): Promise<ModelExchange> {
    // claude-sonnet-5-5 rejects thinking {type:"disabled"} with a 400 whose message names {type:"between_tools"} as the
    // off switch. With no field at all the smoke 143353Z billed ~1,200 output tokens per ~350-token JSON reply (thinking
    // on by default, its blocks dropped below), so the setting is explicit and recorded in every trace.
    const body = cacheableBody(req, model);
    const thinking = req.thinking ?? this.thinking;
    const effort = req.effort === undefined ? this.effort : req.effort;
    if (thinking !== "default") body.thinking = { type: thinking };
    if (effort) body.output_config = { effort };
    if (stream?.onDelta) body.stream = true;
    const request = {
      model,
      system: req.system,
      messages: req.messages,
      maxTokens: req.maxTokens,
      cache: "ephemeral" as const,
      ...(req.tools?.length ? { tools: req.tools } : {}),
      ...(thinking !== "default" ? { thinking } : {}),
      ...(effort ? { effort } : {}),
    };
    const nonce = crypto.randomUUID();
    const worst = worstCaseCents(req, model);
    // QA-B336 (COO 03:20Z): a safety reading has its own ledger kind, so it never counts against the person's allowance (migration 0073).
    const admitted = await this.#ledger.reserve(nonce, req.purpose === SAFETY_PURPOSE ? SAFETY_LEDGER_KIND : "next-engine", worst);
    if (!admitted.ok) {
      return {
        purpose: req.purpose,
        request,
        rawResponse: "",
        error: `budget_unavailable: ${admitted.error ?? ""}`.trim(),
        usage: { model, inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 },
      };
    }
    const started = performance.now();
    let response: Response;
    try {
      response = await this.#fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": this.#config.key,
          "anthropic-version": API_VERSION,
          "anthropic-workspace-id": this.#config.workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: stream?.signal
          ? AbortSignal.any([AbortSignal.timeout(this.#timeoutMs), stream.signal])
          : AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      const cancelled = stream?.signal?.aborted === true;
      // A timeout or client cancellation after admission has an unknown provider outcome and settles conservatively.
      await this.#ledger.settle(nonce, timedOut || cancelled ? worst : 0, null, model);
      return {
        purpose: req.purpose,
        request,
        rawResponse: "",
        error: timedOut ? "timeout" : cancelled ? "cancelled" : `network: ${String(error)}`,
        usage: {
          model,
          inputTokens: 0,
          outputTokens: 0,
          cents: timedOut || cancelled ? worst : 0,
          ms: performance.now() - started,
        },
      };
    }
    if (response.status === 200 && stream?.onDelta) {
      try {
        const streamed = await readAnthropicStream(response, stream, started);
        const spent = usageCents(
          model,
          streamed.inputTokens,
          streamed.outputTokens,
          streamed.cacheCreationInputTokens,
          streamed.cacheReadInputTokens,
        );
        await this.#ledger.settle(nonce, usageCentsExact(
          model,
          streamed.inputTokens,
          streamed.outputTokens,
          streamed.cacheCreationInputTokens,
          streamed.cacheReadInputTokens,
        ), streamed.receipt, model);
        return {
          purpose: req.purpose,
          request,
          rawResponse: streamed.text,
          usage: {
            model,
            inputTokens: streamed.inputTokens,
            outputTokens: streamed.outputTokens,
            cacheCreationInputTokens: streamed.cacheCreationInputTokens,
            cacheReadInputTokens: streamed.cacheReadInputTokens,
            cents: spent,
            ms: performance.now() - started,
            stopReason: streamed.stopReason,
            blocks: streamed.blocks,
          },
          ...(streamed.error ? { error: streamed.error } : {}),
        };
      } catch (error) {
        const cancelled = stream.signal?.aborted === true;
        await this.#ledger.settle(nonce, worst, null, model);
        return {
          purpose: req.purpose,
          request,
          rawResponse: "",
          error: cancelled ? "cancelled" : `network: ${String(error)}`,
          usage: {
            model,
            inputTokens: 0,
            outputTokens: 0,
            cents: worst,
            ms: performance.now() - started,
          },
        };
      }
    }

    const ms = performance.now() - started;
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch { /* keep raw text */ }
    const usageIn = (parsed.usage as Record<string, number> | undefined)?.input_tokens ?? 0;
    const usageOut = (parsed.usage as Record<string, number> | undefined)?.output_tokens ?? 0;
    const cacheCreation = (parsed.usage as Record<string, number> | undefined)?.cache_creation_input_tokens ??
      0;
    const cacheRead = (parsed.usage as Record<string, number> | undefined)?.cache_read_input_tokens ?? 0;
    const spent = usageCents(model, usageIn, usageOut, cacheCreation, cacheRead); // for display; the ledger settles spentExact
    const spentExact = usageCentsExact(model, usageIn, usageOut, cacheCreation, cacheRead); // never clamped: the ledger row carries the true spend
    const receipt = typeof parsed.id === "string" ? parsed.id : null;
    const stopReason = typeof parsed.stop_reason === "string" ? parsed.stop_reason : null;
    const blocks = Array.isArray(parsed.content)
      ? (parsed.content as { type?: string }[]).map((c) => String(c.type ?? "?"))
      : [];
    const usage: ModelUsage = {
      model,
      inputTokens: usageIn,
      outputTokens: usageOut,
      cacheCreationInputTokens: cacheCreation,
      cacheReadInputTokens: cacheRead,
      cents: spent,
      ms,
      stopReason,
      blocks,
    };
    if (response.status !== 200) {
      await this.#ledger.settle(nonce, receipt ? spentExact : 0, receipt, model);
      const apiError = (parsed.error as Record<string, string> | undefined) ?? {};
      const kind = apiError.type === "not_found_error" ? "model_not_found" : (apiError.type ?? "http_error");
      return {
        purpose: req.purpose,
        request,
        rawResponse: text.slice(0, 4000),
        usage,
        error: `${kind} ${response.status}: ${apiError.message ?? ""}`.trim(),
      };
    }
    await this.#ledger.settle(nonce, spentExact, receipt, model);
    const content = Array.isArray(parsed.content) ? parsed.content as { type: string; text?: string }[] : [];
    const raw = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    return { purpose: req.purpose, request, rawResponse: raw, usage };
  }
}

interface AnthropicStreamResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  receipt: string | null;
  stopReason: string | null;
  blocks: string[];
  error: string | null;
}

/** Consume Anthropic's event stream while keeping every raw delta server-side. */
async function readAnthropicStream(
  response: Response,
  observer: ModelStreamObserver,
  started: number,
): Promise<AnthropicStreamResult> {
  if (!response.body) throw new Error("stream response had no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let receipt: string | null = null;
  let stopReason: string | null = null;
  let error: string | null = null;
  const blocks: string[] = [];
  let first = true;

  const dispatch = async () => {
    if (!dataLines.length) return;
    const payload = dataLines.join("\n");
    dataLines = [];
    if (payload === "[DONE]") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(event.type ?? "");
    if (type === "message_start") {
      const message = (event.message ?? {}) as Record<string, unknown>;
      const usage = (message.usage ?? {}) as Record<string, unknown>;
      receipt = typeof message.id === "string" ? message.id : receipt;
      inputTokens = Number(usage.input_tokens ?? inputTokens);
      cacheCreationInputTokens = Number(usage.cache_creation_input_tokens ?? cacheCreationInputTokens);
      cacheReadInputTokens = Number(usage.cache_read_input_tokens ?? cacheReadInputTokens);
    } else if (type === "content_block_start") {
      const content = (event.content_block ?? {}) as Record<string, unknown>;
      blocks.push(String(content.type ?? "?"));
    } else if (type === "content_block_delta") {
      const delta = (event.delta ?? {}) as Record<string, unknown>;
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        text += delta.text;
        const elapsed = performance.now() - started;
        if (first) {
          first = false;
          await observer.onFirstToken?.(elapsed);
        }
        await observer.onDelta?.(delta.text, text, elapsed);
      }
    } else if (type === "message_delta") {
      const delta = (event.delta ?? {}) as Record<string, unknown>;
      const usage = (event.usage ?? {}) as Record<string, unknown>;
      stopReason = typeof delta.stop_reason === "string" ? delta.stop_reason : stopReason;
      outputTokens = Number(usage.output_tokens ?? outputTokens);
    } else if (type === "error") {
      const detail = (event.error ?? {}) as Record<string, unknown>;
      error = `${String(detail.type ?? "stream_error")}: ${String(detail.message ?? "")}`.trim();
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line) await dispatch();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trimStart());
  await dispatch();
  return {
    text,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    receipt,
    stopReason,
    blocks,
    error,
  };
}

/** Replays recorded replies in order per purpose. Throws when a purpose runs dry: a test must never invent a reply. */
export class RecordedClient implements ModelClient {
  readonly #queues: Map<string, string[]>;
  readonly exchanges: ModelExchange[] = [];
  model: string;
  constructor(recorded: Record<string, string[]>, model = "recorded") {
    this.#queues = new Map(Object.entries(recorded).map(([k, v]) => [k, [...v]]));
    this.model = model;
  }
  async complete(req: ModelRequest): Promise<ModelExchange> {
    await Promise.resolve();
    const queue = this.#queues.get(req.purpose);
    if (!queue || queue.length === 0) {
      throw new Error(`recorded client has no reply left for '${req.purpose}'`);
    }
    const raw = queue.shift()!;
    const exchange: ModelExchange = {
      purpose: req.purpose,
      request: { model: req.model ?? this.model, system: req.system, messages: req.messages, maxTokens: req.maxTokens },
      rawResponse: raw,
      usage: { model: req.model ?? this.model, inputTokens: 0, outputTokens: 0, cents: 0, ms: 0 },
    };
    this.exchanges.push(exchange);
    return exchange;
  }
}
