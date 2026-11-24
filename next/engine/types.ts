// Shared types for the Talk and Bridge engines (docs/NEXT-ENGINE.md, docs/ENGINE-V2.md §1–2).

export const LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type Level = typeof LEVELS[number];

export const DOMAINS = [
  "self",
  "close_relationships",
  "family",
  "work",
  "money",
  "society",
  "politics",
  "morality",
  "meaning",
  "body_health",
] as const;
export type Domain = typeof DOMAINS[number];

/** Plain-words belief types (law 7): shown on the card as a changeable pill. */
export const BELIEF_TYPES = [
  "something I believe is true",
  "a rule I live by",
  "something I do to cope",
  "a view or taste",
  "how I tend to react",
] as const;
export type BeliefType = typeof BELIEF_TYPES[number];

export const TYPE_FOR_LEVEL: Record<Level, BeliefType> = {
  L0: "something I believe is true",
  L1: "a rule I live by",
  L2: "something I do to cope",
  L3: "a view or taste",
  L4: "how I tend to react",
};

export const DIMENSIONS: Record<Domain, string[]> = {
  self: [
    "worth (am I enough)",
    "competence",
    "lovability",
    "control over my life",
    "how I treat my mistakes",
  ],
  close_relationships: [
    "is closeness safe",
    "are others reliable",
    "my role in conflict",
    "needs and asking for them",
    "trust after hurt",
  ],
  family: ["obligations", "roles I was given", "loyalty vs independence", "what I carry forward or reject"],
  work: ["worth tied to output", "control vs being controlled", "ambition and enough", "recognition"],
  money: ["security vs scarcity", "money and worth", "risk", "generosity"],
  society: [
    "trust in institutions",
    "fairness of the system",
    "individual vs collective responsibility",
    "change vs tradition",
    "us and them",
  ],
  politics: [
    "care",
    "fairness",
    "loyalty",
    "authority",
    "sanctity",
    "liberty",
    "how I treat people who disagree",
  ],
  morality: ["what makes something wrong", "rules vs outcomes", "forgiveness", "honesty and its limits"],
  meaning: ["purpose", "what matters most", "mortality", "faith or its absence"],
  body_health: ["control", "body and worth", "care vs neglect"],
};

/** Domains the engine must ask permission for before entering (ENGINE-V2 §1). */
export const SENSITIVE_DOMAINS: readonly Domain[] = ["body_health"];

/** The reading of the person's latest words, for the sculpture (Design Package v1; APP-V1-BUILD §5 item 1). "neutral" is
 *  the app's listening form. Thinking and understanding are app states, never read. */
export const FEELINGS = ["neutral", "confused", "sad", "lonely", "angry", "happy", "excited"] as const;
export type Feeling = typeof FEELINGS[number];

export type Consent = "unknown" | "ok" | "declined" | "ask_later";
export type Rating = "very_me" | "partly" | "not_me";
export type BeliefStatus = "inferred" | "endorsed" | "disputed";
export type LinkType = "supports" | "under" | "tension";
export type AnswerKind = "told" | "chip" | "consent";

export interface Receipt {
  quote: string; // exact substring of the person's turn
  sessionId: string;
  turn: number;
  date: string; // ISO date the person said it
  answerKind?: AnswerKind; // chip taps are episode answers, but are never presented as quotations
}

export interface Link {
  to: string; // belief id
  type: LinkType;
}

export interface Belief {
  id: string;
  label: string; // 1–2 words
  statement: string; // gentle one sentence
  offeredWording?: string | null; // Q-ENG-KENNING-VOICE (A): Talk's first-person offer for a guess, shown on the Y5 card only
  keyword?: string | null; // map v2 (d-all-kenning-map-v2-14nov): one plain word for its station, made with the kenning
  type: BeliefType;
  level: Level;
  domains: Domain[];
  confidence: number; // 0..1
  receipts: Receipt[];
  links: Link[];
  status: BeliefStatus;
  changed?: boolean; // the map marks a belief whose wording moved
  birthMood?: Feeling; // the feeling of the turn it took shape in (item 2): its dot color and its patch on the map
}

export interface PersonMap {
  beliefs: Belief[];
  consent: Partial<Record<Domain, Consent>>;
  openThreads: string[];
}

export interface Person {
  firstName: string;
  language: string;
  about: string[]; // anything they told us about themselves
}

export type Move = "follow" | "deepen" | "contrast" | "clarify" | "bridge" | "ask_permission" | "close";
export type Risk = "none" | "self" | "others";

export interface CardShown {
  beliefId: string;
  label: string;
  statement: string;
  type: BeliefType;
  rating?: Rating;
  birthMood?: Feeling;
}

export interface ShownTurn {
  // "unavailable" (PSY 16 Nov 2c): the safety reading could not answer; the turn is neither shown nor stored (api/talk.ts).
  state: "turn" | "permission" | "safety" | "unavailable";
  reflection?: string;
  question?: string;
  cards: CardShown[];
  permissionDomain?: Domain;
  safety?: { message: string; resources: { label: string; url: string }[] };
  earlyGuess?: CardShown;
  feeling?: Feeling; // read from the person's turn, never from the reply
}

export interface SessionTurn {
  index: number; // 1-based
  person: string; // what the person said
  answerKind?: AnswerKind;
  shown: ShownTurn;
}

export interface Session {
  id: string;
  date: string;
  turns: SessionTurn[];
}

/** One check's outcome, kept in the trace. */
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number; // billed output, including any thinking the model did before the text
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cents: number;
  ms: number;
  stopReason?: string | null;
  blocks?: string[]; // content block types in order (e.g. ["thinking", "text"]), so the trace shows where output tokens went
}

export interface ModelExchange {
  purpose: string; // turn | repair | finish | sim_user | analyse | rewrite | verify
  request: {
    model: string;
    system: string;
    messages: { role: string; content: string }[];
    maxTokens: number;
    cache?: "ephemeral";
    tools?: { name: string; description?: string; input_schema: Record<string, unknown> }[];
    thinking?: string;
    effort?: string | null;
  };
  rawResponse: string;
  usage: ModelUsage;
  error?: string;
}
