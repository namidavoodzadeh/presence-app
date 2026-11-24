// Map v2 keyword (d-all-kenning-map-v2-14nov): one plain word per kenning, made with the kenning in Talk; a label fallback otherwise.
// CPO keyword rules (KM2-W4, COO 01:20Z 15 Nov; PSY's ruling overrides): "One word, title case ('Rest'). A noun for what the kenning is
// about, taken from the person's own words when one fits. Never: a trait or label about the person ('Lazy', 'Needy'), a judgement
// ('Failure', 'Weakness'), a feeling as a verdict ('Shame'), another person's name ('Jan': use the relation, 'Mum', or the topic), a
// banned word above, or the line's own name repeated (no 'Work' station on the Work line). A harsh statement about the self (PSY 6(d))
// gets the topic of the statement ('Worth', 'Enough'), never its verdict. If no word passes, the station shows the line's dot with no
// label and its sheet opens as usual; never a made-up word."
import { cardWordHits, clinicalHits } from "./words.ts";

export const KEYWORD_MAX = 18;
const KEYWORD_RE = /^[A-Za-z][A-Za-z'’-]*$/;

/** The CPO's map banned words (KM2-W4). */
export const MAP_BANNED = ["core", "root", "origin", "deep", "conflict", "contradiction", "tension", "torn", "pulled", "crossroads", "score", "complete"] as const;
/** Traits and labels about the person ('Lazy', 'Needy'): never a station name. */
export const TRAITS = [
  "lazy", "needy", "clingy", "selfish", "weak", "stupid", "dumb", "useless", "worthless", "pathetic", "ugly", "fat", "boring", "annoying",
  "difficult", "cold", "cruel", "mean", "rude", "greedy", "jealous", "insecure", "fragile", "dramatic", "controlling", "demanding",
  "stubborn", "naive", "coward", "cowardly", "loser", "burden", "mess", "fraud", "fake", "liar", "hopeless", "helpless", "unlovable",
  "unworthy", "inadequate", "incompetent", "inferior", "defective", "flawed", "broken", "damaged", "bad", "evil", "crazy", "lame",
  "unloved", "unwanted", "disappointment", "idiot", "failure", "failing", "nobody", "bossy", "pushy", "passive", "spineless", "soft",
  "sensitive", "oversensitive", "touchy", "moody", "cheap", "stingy", "arrogant", "vain", "shallow", "immature", "irresponsible",
  "unreliable", "dishonest", "manipulative", "toxic", "perfectionist", "pushover", "doormat", "martyr", "victim", "quitter",
] as const;
/** Judgements ('Failure', 'Weakness'). */
export const JUDGEMENTS = [
  "failure", "weakness", "flaw", "flaws", "fault", "faults", "mistake", "mistakes", "inadequacy", "incompetence", "laziness", "neediness",
  "selfishness", "cowardice", "stupidity", "worthlessness", "uselessness", "defect", "shortcoming", "shortcomings", "sin", "blame",
  "disgrace", "letdown", "embarrassment", "problem",
] as const;
/** Feelings, which on a station read as a verdict ('Shame'); law 7 also keeps mood labels off the screen. */
export const FEELINGS = [
  "shame", "ashamed", "guilt", "guilty", "fear", "afraid", "scared", "anger", "angry", "rage", "sad", "sadness", "sorrow", "grief",
  "despair", "lonely", "loneliness", "jealousy", "envy", "resentment", "bitter", "bitterness", "regret", "humiliation", "humiliated",
  "disgust", "panic", "dread", "worry", "worried", "misery", "miserable", "hopelessness", "helplessness", "emptiness", "empty", "numb",
  "numbness", "hurt", "pain", "upset", "frustration", "frustrated", "self-hatred", "self-loathing", "hatred", "hate", "insecurity",
] as const;

// Phone parity (C1-C4, KM2-W4; QA 17:21Z 15 Nov 'Peace'): the phone's KenningSubwayFallback lists, so the server never sends a word the phone would draw as a dot.
/** Traits, judgements, feelings as verdicts, clinical and schema words (phone `verdicts`). */
export const PHONE_VERDICTS = [
  "lazy", "needy", "selfish", "weak", "stupid", "dumb", "ugly", "fat", "worthless", "useless", "hopeless", "helpless",
  "pathetic", "clingy", "crazy", "boring", "annoying", "difficult", "broken", "inadequate", "incompetent", "unlovable",
  "unworthy", "unwanted", "unloved", "jealous", "greedy", "cold", "cruel", "mean", "rude", "bossy", "controlling", "dramatic",
  "sensitive", "insecure", "naive", "childish", "immature", "lazier", "weaker", "coward", "liar", "cheat", "selfishness",
  "laziness", "neediness", "failure", "weakness", "loser", "burden", "fraud", "mess", "disappointment", "idiot", "fool", "joke",
  "nobody", "bad", "good", "worse", "worst", "best", "flaw", "fault", "defect", "inferior", "superior", "normal", "abnormal",
  "shame", "ashamed", "guilt", "guilty", "embarrassment", "humiliation", "disgust", "disgusting", "hate", "hatred",
  "self-hatred", "self-loathing", "loathing", "regret", "blame", "anxiety", "anxious", "depression", "depressed", "trauma",
  "disorder", "narcissist", "narcissism", "codependent", "codependency", "schema", "abandonment", "defectiveness", "subjugation",
  "entitlement", "enmeshment", "mistrust", "symptom", "diagnosis", "therapy",
] as const;
/** A kind of person or a trait (PSY C2, phone `kindsOfPerson`). */
export const PHONE_KINDS_OF_PERSON = [
  "pleaser", "people-pleaser", "fixer", "loner", "failure", "quitter", "perfectionist", "perfectionism", "workaholic",
  "overthinker", "worrier", "pushover", "doormat", "martyr", "victim", "caretaker", "rescuer", "helper", "giver", "taker",
  "achiever", "overachiever", "underachiever", "procrastinator", "introvert", "extrovert", "introversion", "outsider", "misfit",
  "nerd", "freak", "weirdo", "slacker", "peacemaker", "people-pleasing", "control-freak", "drama", "snob", "brat", "princess",
  "saint", "hero", "villain", "stubbornness", "impatience", "jealousy", "greed", "insecurity", "vanity", "arrogance",
  "cowardice", "neurotic", "obsessive", "compulsive", "perfect", "lonely", "shy", "strong", "smart", "clever", "kind", "nice",
  "generous", "loyal", "honest", "brave", "responsible", "reliable", "independent",
] as const;
/** A feeling, mood or clinical word, even when the person said it (PSY C3, phone `feelingWords`). */
export const PHONE_FEELINGS = [
  "fear", "afraid", "scared", "worry", "worried", "anger", "angry", "rage", "resentment", "sadness", "sad", "grief", "sorrow",
  "loneliness", "despair", "hopelessness", "stress", "stressed", "panic", "dread", "nervousness", "nervous", "frustration",
  "frustrated", "boredom", "bored", "envy", "pride", "proud", "joy", "happiness", "happy", "unhappy", "upset", "hurt", "pain",
  "love", "longing", "loss", "excitement", "relief", "calm", "peace", "comfort", "contentment", "gratitude", "mood", "moods",
  "feeling", "emotion", "emotions", "tears", "crying", "overwhelm", "overwhelmed", "exhaustion", "exhausted", "tired", "numb",
  "numbness", "insecurity", "rejection", "betrayal", "neglect", "attachment", "avoidance", "burnout", "adhd", "ocd", "ptsd",
  "bipolar", "autism", "autistic", "insomnia", "anorexia", "bulimia", "addiction", "addict", "psychosis", "mania", "manic",
  "paranoia", "phobia", "therapist", "counselling", "counseling", "psychiatrist", "medication", "meds", "self-harm", "suicide",
  "suicidal", "dissociation", "relapse",
] as const;
/** A health condition, substance, sexual matter or body feature (PSY C4, phone `privateWords`). */
export const PHONE_PRIVATE = [
  "cancer", "diabetes", "illness", "sickness", "disease", "migraine", "migraines", "injury", "surgery", "pregnancy",
  "miscarriage", "infertility", "fertility", "disability", "asthma", "allergy", "allergies", "hiv", "covid", "infection",
  "condition", "chemo", "tumour", "tumor", "stroke", "seizure", "seizures", "alcohol", "drinking", "drink", "drinks", "drunk",
  "beer", "wine", "vodka", "whisky", "whiskey", "booze", "drugs", "drug", "weed", "cannabis", "marijuana", "cocaine", "pills",
  "pill", "smoking", "cigarettes", "cigarette", "vaping", "vape", "nicotine", "caffeine", "gambling", "sex", "sexuality",
  "sexual", "porn", "pornography", "virginity", "orgasm", "affair", "cheating", "gay", "lesbian", "bisexual", "queer", "trans",
  "kink", "libido", "intimacy", "hookup", "hookups", "weight", "body", "bodies", "face", "skin", "hair", "nose", "teeth",
  "height", "belly", "stomach", "breasts", "chest", "scars", "scar", "acne", "wrinkles", "thighs", "hips", "butt", "legs",
  "arms", "hands", "feet", "eyes", "lips", "looks", "appearance", "figure", "shape", "size", "muscles",
] as const;
/** Nouns that carry a phrasing, not a subject (phone `weakNouns`). */
export const PHONE_WEAK_NOUNS = [
  "part", "parts", "side", "bit", "kind", "sort", "lot", "lots", "way", "ways", "thing", "things", "people", "person", "someone",
  "somebody", "something", "anyone", "anything", "everyone", "everything", "nobody", "nothing", "one", "ones", "others", "other",
  "self", "yourself", "myself", "feeling", "feelings", "sense", "deal", "fact", "case", "point", "times", "matter", "matters",
] as const;
/** Banned in every UI string (DESIGN.md Section 5). */
export const PHONE_COPY_BANNED = [
  "please", "should", "healthy", "unhealthy", "toxic", "fix", "improve", "wrong", "better",
] as const;
const NOT_A_STATION = new Set<string>([
  ...MAP_BANNED, ...TRAITS, ...JUDGEMENTS, ...FEELINGS, ...PHONE_VERDICTS, ...PHONE_KINDS_OF_PERSON, ...PHONE_FEELINGS, ...PHONE_PRIVATE,
  ...PHONE_WEAK_NOUNS, ...PHONE_COPY_BANNED,
]);

/** Lower case, curly apostrophe straightened, a plain plural folded ("Rules" -> "rule", "Tensions" -> "tension"). */
export const keyKey = (w: string) => {
  const l = w.toLowerCase().replace(/[’]/g, "'");
  return l.length > 3 && l.endsWith("s") && !l.endsWith("ss") ? l.slice(0, -1) : l;
};

/**
 * Every lower-case form the phone checks a word under (KenningSubwayFallback.forms, QA-B368 rejection 3): itself, `-ies` -> `-y`,
 * `-es` dropped, `-s` dropped, with the phone's own length gates. The phone also adds the tagger's lemma, which a server cannot know;
 * the forms below are a subset of what the phone checks, so a word that passes here is only ever rejected on the phone by its lemma.
 */
export function phoneForms(w: string): Set<string> {
  const lw = w.toLowerCase().replace(/[’]/g, "'");
  const out = new Set<string>([lw]);
  if (lw.endsWith("ies") && lw.length > 4) out.add(lw.slice(0, -3) + "y");
  if (lw.endsWith("es") && lw.length > 3) out.add(lw.slice(0, -2));
  if (lw.endsWith("s") && lw.length > 2) out.add(lw.slice(0, -1));
  // The tagger's lemma for a Greek plural ("diagnoses" -> "diagnosis").
  if (lw.endsWith("ses") && lw.length > 5) out.add(lw.slice(0, -3) + "sis");
  // QA-B368 rejection 4: the phone also checks the NaturalLanguage lemma ("Loved" -> love, "Panicked" -> panic). A server has no
  // tagger, so it refuses conservatively: any stem a regular verb, comparative or adverb suffix could leave, and the common
  // irregular lemmas. Over-refusing is safe (the person gets the next candidate); under-refusing makes the phone draw a dot.
  for (const f of [...out]) for (const stem of suffixStems(f)) out.add(stem);
  const irregular = IRREGULAR_LEMMAS[lw];
  if (irregular) for (const l of irregular) out.add(l);
  return out;
}

const VOWELS = /[aeiou]/;
/** Stems a regular inflection of `w` could come from: -ed/-d/-ied, -ing, -er/-r/-ier, -est/-st/-iest, -ly/-ily, -ness, with a doubled
 *  final consonant undone ("panicked" -> "panick" -> "panic"; "stopped" -> "stop") and a dropped silent e restored ("hated" -> "hate"). */
function suffixStems(w: string): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (s.length >= 3 && VOWELS.test(s)) out.push(s); };
  const undouble = (s: string) => { if (s.length > 3 && s[s.length - 1] === s[s.length - 2]) add(s.slice(0, -1)); };
  const ck = (s: string) => { if (s.endsWith("ck")) add(s.slice(0, -1)); };
  for (const [suf, ies] of [["ed", "ied"], ["er", "ier"], ["est", "iest"], ["ing", ""], ["ly", "ily"], ["ness", "iness"]] as const) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const stem = w.slice(0, -suf.length);
      add(stem); add(stem + "e"); undouble(stem); ck(stem);
    }
    if (ies && w.length > ies.length + 1 && w.endsWith(ies)) add(w.slice(0, -ies.length) + "y");
  }
  if (w.length > 3 && (w.endsWith("d") || w.endsWith("r") || w.endsWith("st"))) add(w.slice(0, w.endsWith("st") ? -2 : -1));
  return out;
}

/** The lemma of the common irregular forms the phone's tagger resolves (past tenses and participles of everyday verbs). */
const IRREGULAR_LEMMAS: Record<string, string[]> = {
  felt: ["feel"], hid: ["hide"], hidden: ["hide"], broke: ["break"], broken: ["break"], lost: ["lose"], thought: ["think"],
  knew: ["know"], known: ["know"], hurt: ["hurt"], drank: ["drink"], drunk: ["drink"], fought: ["fight"], fell: ["fall"], fallen: ["fall"],
  left: ["leave"], kept: ["keep"], held: ["hold"], told: ["tell"], said: ["say"], meant: ["mean"], wept: ["weep"], bled: ["bleed"],
  hung: ["hang"], sank: ["sink"], sunk: ["sink"], stole: ["steal"], stolen: ["steal"], lied: ["lie"], lay: ["lie"], ran: ["run"],
  better: ["good"], worse: ["bad"], worst: ["bad"], best: ["good"], men: ["man"], women: ["woman"], children: ["child"],
};

/** Line names a station may not repeat (no 'Work' station on the Work line), with the singular and the plain synonym. */
const LINE_WORDS: Record<string, string[]> = {
  family: ["family"], relationships: ["relationship", "relationships"], work: ["work", "job"], money: ["money"], meaning: ["meaning"],
  body: ["body", "health"], politics: ["politics", "political"], morality: ["morality", "moral", "morals"], me: ["me", "self", "myself"],
};

export interface KeywordContext {
  /** The station's lines: the keyword may not repeat any line's name. */
  lines?: readonly string[];
  /** The person's own words (receipts, the turn): a word they only ever write capitalised mid-sentence is a name. */
  texts?: readonly string[];
  /** Names of people the account knows (linked people), never a station name. */
  names?: readonly string[];
}

/** A word the texts write capitalised after a sentence's first word, and never in lower case: someone's name ('Jan'), not a topic. */
export function looksLikeName(word: string, texts: readonly string[]): boolean {
  const w = word.toLowerCase();
  if (w.length < 2 || w === "i") return false;
  let midCap = false;
  for (const t of texts) {
    for (const sentence of t.split(/[.!?]+\s*|\n+/)) {
      const toks = sentence.replace(/[’]/g, "'").split(/\s+/).map((x) => x.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, "").replace(/'s$/i, ""))
        .filter(Boolean);
      for (const [i, tok] of toks.entries()) {
        if (tok.toLowerCase() !== w) continue;
        if (tok[0] !== tok[0].toUpperCase()) return false;   // seen in lower case: a plain word
        if (i > 0) midCap = true;
      }
    }
  }
  return midCap;
}

/** Why a word cannot name a station, or null when it can. One plain word, at most 18 characters, none of the card-banned, clinical,
 *  map-banned, trait, judgement or feeling words; with a context, never a line's own name and never a person's name. */
export function keywordProblem(raw: unknown, ctx: KeywordContext = {}): string | null {
  if (typeof raw !== "string") return "missing";
  const w = raw.trim();
  if (!w) return "empty";
  if (/\s/.test(w)) return "more than one word";
  if (w.length > KEYWORD_MAX) return `longer than ${KEYWORD_MAX} characters`;
  if (!KEYWORD_RE.test(w) || /['’-]$/.test(w)) return "not a plain word";
  if (cardWordHits(w).length || clinicalHits(w).length) return "a banned word";
  const lower = w.toLowerCase().replace(/[’]/g, "'"), key = keyKey(w), forms = phoneForms(w);
  if (NOT_A_STATION.has(key) || [...forms].some((f) => NOT_A_STATION.has(f))) return "a verdict, trait, feeling or map-banned word";
  for (const line of ctx.lines ?? []) {
    const names = LINE_WORDS[line] ?? [line];
    if (names.some((n) => n === lower || keyKey(n) === key || [...phoneForms(n)].some((f) => forms.has(f)))) return "the line's own name";
  }
  // PSY C1: "Worth" is the stem of "worthless", never a word the person said; a station takes it only when they wrote it themselves.
  if (key === "worth" && ctx.texts && !ctx.texts.some((t) => /(^|[^A-Za-z])worth([^A-Za-z]|$)/i.test(t))) return "a word the person did not say";
  // The phone checks each part of a name under its plural-free forms too (`names()`).
  if ((ctx.names ?? []).some((n) => n.trim().split(/\s+/).some((part) => part && [...phoneForms(part)].some((f) => forms.has(f))))) return "a person's name";
  if (ctx.texts && looksLikeName(w, ctx.texts)) return "a person's name";
  return null;
}

/** The keyword as stored and shown: title case ('Rest', 'Self-reliant'). Null when the word cannot name a station. */
export function cleanKeyword(raw: unknown, ctx: KeywordContext = {}): string | null {
  if (keywordProblem(raw, ctx) !== null) return null;
  const w = String(raw).trim().replace(/[’]/g, "'");
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

const KEYWORD_STOP = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "and", "or", "but", "so", "too", "just", "all", "my", "me", "i", "i'm",
  "it", "it's", "its", "is", "be", "being", "been", "not", "no", "never", "always", "don't", "can't", "won't", "say", "says", "keep", "make",
  "am", "do", "does", "your", "you", "up", "out", "off", "over", "by", "from", "as", "if", "only", "still", "even", "very", "much", "more", "less",
  "part", "feels", "feel", "that", "this", "when", "what", "who", "how", "they", "them", "their", "he", "she", "him", "her", "his", "we",
  "are", "was", "were", "has", "have", "had", "can", "could", "would", "will", "there", "here", "than", "then", "about", "into", "like",
]);

/** Fallback for a kenning made before keywords (or by the person's own pen): the longest content word of its text that can name a
 *  station, first one on a tie. Null when none can: the station shows its line's dot with no label (never a made-up word). */
export function keywordFromLabel(label: string, ctx: KeywordContext = {}): string | null {
  const ws = label.replace(/[’]/g, "'").split(/\s+/).map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, "").replace(/'$/, "")).filter(Boolean);
  const content = ws.filter((w) => !KEYWORD_STOP.has(w.toLowerCase()) && w.length > 1);
  const ranked = content.map((w, i) => ({ w, i })).sort((a, b) => b.w.length - a.w.length || a.i - b.i);
  for (const { w } of ranked) {
    const k = cleanKeyword(w, ctx);
    if (k) return k;
  }
  return null;
}

/** Words that carry a sentence, not a topic (the phone's plainSkip and verbSkip, plus plain past tenses): never offered as a candidate. */
const CANDIDATE_SKIP = new Set([
  "my", "mine", "you're", "youre", "we", "our", "when", "can't", "so", "who", "why", "most", "really", "also", "get", "gets", "need", "needs",
  "want", "wants", "felt", "some", "any", "each", "think", "know", "go", "come", "let", "try", "seem", "believe", "tell", "give", "take", "see",
  "look", "become", "put", "use", "find", "show", "happen", "must", "might", "may", "shall", "hope", "wish", "guess", "suppose", "said", "told",
  "thought", "went", "came", "got", "took", "gave", "made", "knew", "saw", "ask", "asked", "asks", "just", "because", "while", "where", "which",
  "whether", "though", "until", "next", "near", "beside", "between", "through", "around", "across", "behind", "under", "above", "below", "toward", "towards", "without", "within", "among", "along", "against", "during", "since", "upon", "onto", "after", "before", "again", "ever", "every", "something", "anything", "everything", "nothing", "enough-of",
]);
export const KEYWORD_CANDIDATES_MAX = 6;

/**
 * Other words the station could carry (KM2-C3, CPO answer 16:45Z 15 Nov): up to six words, each one the person wrote in their own sentence
 * or receipts, each passing every station rule (keywordProblem with the station's lines and the person's own words for names), in the
 * order they first appear, the station's current word and its plural/singular left out. Deterministic, no AI, nothing the person did not
 * say (a harsh statement offers "Enough", never the verdict, and "Worth" only if they wrote it). Empty when none passes.
 */
export function keywordCandidates(texts: readonly string[], current: string | null, ctx: KeywordContext = {}): string[] {
  const out: string[] = [], seen = new Set<string>(current ? [keyKey(current)] : []);
  const all = { ...ctx, texts: [...(ctx.texts ?? []), ...texts] };
  for (const text of texts) {
    for (const raw of text.replace(/[’]/g, "'").split(/\s+/)) {
      const w = raw.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "").replace(/'s$/i, "");
      if (w.length < 3) continue;
      const lower = w.toLowerCase();
      if (KEYWORD_STOP.has(lower) || CANDIDATE_SKIP.has(lower) || (lower.endsWith("ly") && lower.length > 4)) continue;
      const key = keyKey(w);
      if (seen.has(key)) continue;
      const k = cleanKeyword(w, all);
      if (!k) continue;
      seen.add(key); out.push(k);
      if (out.length >= KEYWORD_CANDIDATES_MAX) return out;
    }
  }
  return out;
}
