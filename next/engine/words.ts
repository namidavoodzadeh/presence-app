// Word lists the thesis forbids on screen (laws 4, 5, 7) and the checks that use them.
// Carried over from engine/talk.py and engine/listener.py; the lists are the same.

export const EVALUATIVE = ["should", "healthy", "unhealthy", "toxic", "fix", "improve", "wrong", "better"] as const;
export const CLINICAL = [
  "diagnosis", "diagnose", "depressed", "depression", "anxiety", "anxious", "trauma", "traumatic", "disorder",
  "therapist", "therapy", "schema", "narcissist", "narcissistic", "borderline", "bipolar", "ocd", "ptsd", "adhd",
  "codependent", "attachment style", "avoidant", "dysfunctional", "pathological", "symptom", "symptoms",
] as const;
export const ADVICE = ["try", "must", "need", "ought", "avoid", "change", "stop", "start"] as const;
export const HARSH = ["broken", "damaged", "weak", "failure", "failing", "selfish"] as const;

const UNSAFE_FOR_CARDS = new Set<string>([...EVALUATIVE, ...CLINICAL, ...HARSH, "must", "need", "ought"]);
const UNSAFE_FOR_QUESTIONS = new Set<string>([...EVALUATIVE, ...CLINICAL]);

const ADVICE_QUESTION_PATTERNS = [
  /\byou (?:must|ought)\b/i, /\byou should\b/i,
  /\bhave you tried\b/i, /\b(?:could|would|will) you try\b/i,
  /\b(?:could|would|will) you (?:avoid|change|stop|start)\b/i,
  /\bwhy don't you\b/i,
];

export function words(text: string): string[] {
  return text.toLowerCase().replace(/[’']/g, "'").match(/[a-z][a-z'-]*/g) ?? [];
}

function hits(text: string, list: Set<string>): string[] {
  const lower = " " + text.toLowerCase().replace(/[’]/g, "'") + " ";
  const found = new Set<string>();
  for (const w of words(text)) if (list.has(w)) found.add(w);
  for (const phrase of list) if (phrase.includes(" ") && lower.includes(" " + phrase + " ")) found.add(phrase);
  return [...found].sort();
}

/** Words that may never appear in a card label or statement. */
export function cardWordHits(text: string): string[] {
  return hits(text, UNSAFE_FOR_CARDS);
}

/** Words that may never appear in a reflection or question the app writes itself. */
export function questionWordHits(text: string): string[] {
  return hits(text, UNSAFE_FOR_QUESTIONS);
}

export function clinicalHits(text: string): string[] {
  return hits(text, new Set<string>(CLINICAL));
}

export function advicePatternHit(text: string): string | null {
  for (const p of ADVICE_QUESTION_PATTERNS) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

/** Question marks the app itself asks. A quoted span of the person's own words ('for what?') keeps its mark without counting as a
 *  second question; a quote only opens after a space or bracket and closes before a space or punctuation, so apostrophes never pair. */
export function countQuestions(text: string, personSaid: string[] = []): number {
  let t = normalise(text);
  if (personSaid.length) {
    const said = personSaid.map((x) => normalise(x).toLowerCase());
    t = t.replace(/(^|[\s(])(['"])([^'"]{1,120}?)\2(?=$|[\s).,;:!?])/g, (m, lead, _q, inner: string) =>
      said.some((x) => x.includes(inner.toLowerCase())) ? lead : m);
  }
  return (t.match(/\?/g) ?? []).length;
}

/** Whitespace and curly-quote normalisation only; the receipt must still be an exact substring. */
export function normalise(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

export function isExactSubstring(quote: string, source: string): boolean {
  const q = normalise(quote);
  return q.length > 0 && normalise(source).includes(q);
}
