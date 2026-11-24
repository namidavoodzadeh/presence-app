// V3 communication model, Bridge Write (CPO spec P4): which one of the sender's own "How I mean things" items fits the draft they are writing.
// Deterministic, no model, nothing leaves the server but the item's id and the person's own wording. It only ever reads the sender's OWN items,
// so there is no consent question; it is offered to the sender ("You shared that ... Want to say that here?") and never sent anywhere by itself.
// The fit is shared content words (4+ letters, no stop words, a trailing s ignored). No shared word, no item: the app then draws nothing.

const STOP = new Set([
  "that", "this", "with", "have", "from", "they", "them", "then", "than", "what", "when", "your", "yours", "about", "would", "could", "should",
  "there", "their", "were", "been", "just", "like", "really", "very", "into", "also", "some", "more", "much", "only", "even", "will", "dont",
  "doesnt", "didnt", "cant", "wont", "because", "while", "where", "which", "still", "being", "does", "make", "makes", "feel", "feels", "know",
]);

export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[’']/g, "").match(/[a-z]+/g) ?? []) {
    const t = w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w;
    if (t.length >= 4 && !STOP.has(t) && !STOP.has(w)) out.add(t);
  }
  return out;
}

export interface FitCandidate { id: string; wording: string; datedAt: string }

/** The one candidate that shares the most content words with the draft (at least one); a tie goes to the most recently dated. Null when none fits. */
export function pickFromMe(draft: string, items: readonly FitCandidate[]): FitCandidate | null {
  const d = contentWords(draft);
  if (!d.size) return null;
  let best: { c: FitCandidate; score: number } | null = null;
  for (const c of items) {
    let score = 0;
    for (const w of contentWords(c.wording)) if (d.has(w)) score++;
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && c.datedAt > best.c.datedAt)) best = { c, score };
  }
  return best?.c ?? null;
}
