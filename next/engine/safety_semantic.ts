// Law 8, QA-B336 round 7: the semantic safety check. The keyword floor (safety.ts) is a list of forms and can only
// ever sample an open meaning class (a wish, plan, intent or threat that a person's body be harmed, by ANY means, in
// the first person, reported of someone, or received as a threat). This check reads the meaning: one small, fast model
// call with a fixed prompt that defines the class by categories, never by example sentences, so it is not tuned on any
// test set. It runs beside the surface's main call (Talk turn, Bridge analyse) and can only ADD a stop, never clear
// one. It fails closed: an error, a timeout or an unreadable reply is `ok: false` ("unavailable"), never "none", and
// the surface then falls to its remaining model-read layer; nothing is ever mapped or bridged on the floor alone.

import type { ModelExchange } from "./types.ts";
import type { ModelClient, ThinkingSetting } from "./model/client.ts";
import { defaultThinking, extractJson } from "./model/client.ts";
import type { RiskResult } from "./safety.ts";
import { NONE } from "./safety.ts";

// PSY 15 Nov ruling 2: "class" takes one of five fixed names for the benign classes; the floor's candidate rows clear only when the
// class key in safety_classes.ts and this named class agree (two keys). The check still only ever adds a stop by itself.
// Round 8: Sonnet 5.5, not Haiku. On held-out 8b (minimal pairs, same plan form, same object) Haiku misread the words
// themselves at any prompt (a swap read in reverse, "up" read as "under"; 5/5 repeats each); Sonnet read them as written
// and made no false stop of its own on sets 5-8b, at about 0.8 s more per call (beside the main call, not after it).
export const SEMANTIC_MODEL = "claude-sonnet-5-5";
export const SEMANTIC_MAX_TOKENS = 120;
export const SEMANTIC_PURPOSE = "safety";

/** The class, by category. No sentence from any held-out or QA set appears here (safety_semantic_test proves it). */
export const SEMANTIC_SAFETY_PROMPT = `You are the safety reader inside Presence. You read one message a person typed or spoke and answer one question only: does it state a wish, plan, intent, decision or threat that a person's body be harmed?

Reply with ONE JSON object and nothing else:
{"act":"<what is done or meant toward the person, at most eight words, in your own words>","purpose":"harm"|"help"|"neither","risk":"none"|"self"|"others","class":"<one word>","reason":"<at most twelve words; never quote the message>"}

"class" names what kind of message it is. When "risk" is "none" and the message is one of these five, "class" is that word exactly:
- "negation": the speaker says they do not want to, or did not mean to, hurt another person, and nothing in the message takes that back;
- "prevention": the speaker means to stop, prevent or report a harm, keep someone safe from it, or keep a dangerous person away;
- "distant_past": a wish or urge to hurt someone from long ago (childhood, years back) that the message places wholly in the past;
- "idiom": a fixed figure of speech with its ordinary everyday cause, where no body is meant;
- "emotional_hurt": the speaker's feelings were hurt and the whole answer is silence, distance or ending contact; never when the message also wishes the person hurt, hurt back, bleeding or in pain in the body, or says the speaker will see to it.
Otherwise "class" is one word of your own. Never use one of the five when "risk" is "self" or "others", or when the message holds a fear, a threat, control over a person, a plan, a weapon or a time beside it.

Decide by the PURPOSE of the act toward the person, never by the objects, dangers or verbs it names. First write "act": restate exactly what is done or meant, keeping its direction (on or off, in or out, up or under, toward or away); for a swap, a replacement or an exchange, say which thing the person is left with ("swap A for B" leaves B in place of A). Then set "purpose": "harm" when the act is meant to cause hurt, injury or death to a person's body; "help" when it is meant to prevent, stop, repair, make safe, rescue, treat, protect, supervise or care for a person; "neither" otherwise. The same object serves both: a rope, a blade, a vehicle, gas, fire, water, a pill, a needle, oxygen, a heater, an animal, a height. A "help" act is NONE even when it is written as a plan or a decision, even when it names a danger, an injury, a hazard or a harm verb (cutting someone free, breaking a door down, smashing a window, killing an engine, crushing medicine to swallow, an injection, setting a broken bone), and even when the danger it guards against is vivid. Read every word as written: the small words that set the direction of an act (on or off, in or out, toward or away, giving or withholding, up or under, fixing or loosening) decide it; never assume the harmful twin of a protective act: judge the act you restated, not one it resembles. Medicine given, placed, reminded or fetched as meant is care. Putting worn, broken, tampered or wrong equipment, medicine or food in place of the sound one a person relies on is harm.

STOP (risk is "self" or "others") when the message states, in any words at all, that someone wishes, plans, intends, has decided, or threatens that a person be physically harmed. Harm to a body means hurt, struck, killed, or made to die or be injured by any means: a weapon or a blow; something put in food, drink or medicine; a swapped, withheld or hidden medicine or device the person needs; poison, chemicals, acid or a scalding liquid; fire, gas, smoke or electricity; cold, heat or being shut in; a fall, a height, a vehicle, traffic or sabotage of a vehicle or equipment; deep water or being held under; an animal set on them; being deprived of food, water or air; deliberate infection; hired or proxy violence; or any other means, named or only implied. A harm verb is not required: a predicted "accident", "won't wake up", "won't be around much longer", "disappear", "never walk again", "stop breathing", and similar outcomes count when they are what the speaker or the reported person means to bring about. So do a chosen method, place or time for self-harm stated as decided, and gathered means with that plain purpose. Lying in wait for a person, alone or with others, in a hidden or lonely place, or cornering or following them there, is "harm" by its plain reading even when no harm is named; meeting or waiting for someone in an ordinary place for an ordinary reason is not.
Three forms count equally: (a) first person, the speaker about what they will do to another person or to themselves; (b) reported, the speaker tells what someone else says they want, plan or threaten to do to any person; (c) received, a threat aimed at the speaker or the speaker's household, direct or indirect, including warnings and predictions about the speaker's safety that only make sense as threats.
A person is anyone: partner, child, parent, relative, colleague, a named or pointed-at person, a group, or the speaker.
"self" when the harm would fall on the speaker (own body, or a threat received by the speaker or aimed at the speaker's household); "others" when it would fall on another person.

NONE for:
- prevention and protection: wanting to stop, prevent, report or keep someone safe from harm, or to keep a dangerous person away;
- reporting news, history, documentaries, fiction, films, books, games and sport, and a past wish or urge that the speaker says is over or that they acted to avoid;
- negation and counterfactuals: would never, don't want to, if I had stayed I might have;
- figures of speech and hyperbole about effort, stress, fatigue, excitement, winning or embarrassment, where no body is meant;
- emotional hurt, blame, grief, silence, revenge by withdrawal, or ending a relationship (a wish that the person be hurt in the body, hurt back or made to bleed is harm even when the speaker was hurt first);
- medical, veterinary and care acts: surgery, injections, hospice, sedation, a pet put down;
- harm aimed at objects, food, plants, software or one's own effort and comfort;
- fear of an accident, with no intent;
- protective, rescuing, repairing, medical and caring acts toward a person, planned or done (removing them from a danger, removing or disposing of a danger, replacing or repairing worn or broken equipment, reconnecting or restoring what they need, first aid, giving their medicine, keeping them warm, fed or breathing): none, even with a dangerous object or a harm verb in the words;
- ordinary household, practical or social acts around a person (checking their car, running their heating or equipment, cooking for them, waiting for or meeting them): none, unless the message itself states or plainly implies the harmful purpose or outcome. A dangerous means being merely present in the words is not intent.
Stop when "purpose" is "harm" and that is the plain reading of the words, even when the means or the outcome is only implied. When the harm reading needs an assumption the message does not give, or only strain, anger or sadness is expressed and no body is harmed, choose none.`;

export interface SemanticRisk extends RiskResult {
  /** False when the check could not answer (error, timeout, unreadable): unavailable, never "none". */
  ok: boolean;
  class: string;
  ms: number;
  cents: number;
  model: string;
  exchange: ModelExchange | null;
}

export function unavailable(reason: string, exchange: ModelExchange | null = null, ms = 0): SemanticRisk {
  return { ...NONE, reason: `semantic check unavailable: ${reason}`.slice(0, 200), ok: false, class: "", ms, cents: exchange?.usage.cents ?? 0,
    model: exchange?.usage.model ?? SEMANTIC_MODEL, exchange };
}

/** The check switched off by config (PRESENCE_SAFETY_SEMANTIC is not "true" on the API): no call, recorded as not run. The
 *  floor and the surface's own model risk field still decide, exactly as before round 7. */
export function semanticOff(): SemanticRisk {
  return { ...NONE, reason: "semantic check off by config", ok: false, class: "", ms: 0, cents: 0, model: "", exchange: null };
}

/** Tolerant read of the reply: only "none" | "self" | "others" is an answer; anything else is unreadable. */
export function readSemantic(raw: string): { risk: RiskResult["risk"]; class: string; reason: string } | null {
  let parsed: unknown;
  try { parsed = extractJson(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const risk = typeof o.risk === "string" ? o.risk.trim().toLowerCase() : "";
  if (risk !== "none" && risk !== "self" && risk !== "others") return null;
  return { risk, class: typeof o.class === "string" ? o.class.trim().slice(0, 40) : "", reason: typeof o.reason === "string" ? o.reason.trim().slice(0, 200) : "" };
}

export interface SemanticOptions { signal?: AbortSignal; model?: string }

/** Thinking off for the check's model: Haiku takes {type:"disabled"}; Sonnet 5.5 rejects that with a 400 and names
 *  between_tools as its off switch (client.ts defaultThinking); any other model takes the classic "disabled". */
export function semanticThinking(model: string): ThinkingSetting {
  const t = defaultThinking(model);
  return t === "default" ? "disabled" : t;
}

/** One call, one answer. Never throws: every failure is `ok: false`. */
export async function semanticRisk(client: ModelClient, text: string, options: SemanticOptions = {}): Promise<SemanticRisk> {
  const model = options.model ?? SEMANTIC_MODEL;
  const started = performance.now();
  let exchange: ModelExchange;
  try {
    exchange = await client.complete(
      { purpose: SEMANTIC_PURPOSE, system: SEMANTIC_SAFETY_PROMPT, messages: [{ role: "user", content: `MESSAGE:\n${text}` }],
        maxTokens: SEMANTIC_MAX_TOKENS, model, thinking: semanticThinking(model), effort: null },
      options.signal ? { signal: options.signal } : undefined,
    );
  } catch (error) {
    return unavailable(String(error instanceof Error ? error.message : error), null, performance.now() - started);
  }
  const ms = performance.now() - started;
  // PSY 16 Nov 2b: a reader that REFUSED the message is a stop (usual stop with resources), not an outage.
  if (exchange.usage.stopReason === "refusal") {
    return { risk: "self", reason: "semantic: the reader declined to read the message", ok: true, class: "", ms, cents: exchange.usage.cents, model: exchange.usage.model, exchange };
  }
  if (exchange.error && !exchange.rawResponse) return unavailable(exchange.error, exchange, ms);
  const read = readSemantic(exchange.rawResponse);
  if (!read) return unavailable(`unreadable reply${exchange.error ? ` (${exchange.error})` : ""}`, exchange, ms);
  return { risk: read.risk, reason: read.risk === "none" ? "no risk read" : `semantic: ${read.reason || read.class || "intent to harm a person"}`,
    ok: true, class: read.class, ms, cents: exchange.usage.cents, model: exchange.usage.model, exchange };
}

/** The two models of key 2 (PSY 15 Nov 04:44Z 1a): one reading each, different models. */
export const CLASS_READING_MODELS: readonly [string, string] = [SEMANTIC_MODEL, "claude-haiku-5-5"];

/** PSY 15 Nov ruling 2, key 2: the class reading for a candidate floor stop. The API refuses a temperature on claude-sonnet-5-5 and
 *  claude-haiku-5-5 (400 "`temperature` is deprecated for this model", checked 15 Nov 02:55Z), so PSY's ruling (HQ d-psy-b336-temp0-15nov,
 *  04:44Z, 1a-1c) replaces "temperature 0" with two parallel readings by two DIFFERENT models, one reading each, both of which must
 *  answer none and name the class. One unavailable = stop; no second try (each call is made once). */
export function classReadings(client: ModelClient, text: string, options: SemanticOptions = {}): Promise<[SemanticRisk, SemanticRisk]> {
  const [a, b] = CLASS_READING_MODELS;
  return Promise.all([semanticRisk(client, text, { ...options, model: a }), semanticRisk(client, text, { ...options, model: b })]);
}

/** Floor, then the semantic check, then the surface's own model risk field. Any layer can add a stop; none can clear one. */
export function layeredRisk(floor: RiskResult, semantic: SemanticRisk | null, modelRisk?: unknown, modelReason?: unknown): RiskResult {
  if (floor.risk !== "none") return floor;
  if (semantic && semantic.ok && semantic.risk !== "none") return { risk: semantic.risk, reason: semantic.reason };
  return readModelRiskLocal(modelRisk, modelReason);
}

function readModelRiskLocal(risk: unknown, reason: unknown): RiskResult {
  let folded = typeof risk === "string" ? risk.trim().toLowerCase() : "none";
  if (folded === "stop" || folded === "risk" || folded === "unsafe") folded = "self";
  if (folded !== "self" && folded !== "others") return { ...NONE };
  return { risk: folded, reason: typeof reason === "string" ? reason.trim().slice(0, 200) : "" };
}

export function semanticCheckDetail(s: SemanticRisk): string {
  return s.ok ? `${s.risk}${s.class ? ` (${s.class})` : ""}: ${s.reason}; ${Math.round(s.ms)} ms, ${s.model}` : `${s.reason}; ${Math.round(s.ms)} ms`;
}
