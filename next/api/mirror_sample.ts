// The preview's Mirror sample (CONTRACT §3 `POST /preview/mirror-sample`): the five example people describe moments about the
// signed-in preview account's owner. `{name}` is the owner's first name. Example data, never shown raw (law 12); it exists so the
// owner can see an outside perspective arrive on his own map. Two themes converge (four and three people), one moment stands
// alone (held unseen), one is a label with no moment (asked for a moment, not used).
export interface SampleContribution { persona: string; name: string; how_known: "partner" | "friend" | "family" | "coworker" | "other"; moment: string }

export const MIRROR_SAMPLE: SampleContribution[] = [
  { persona: "lea", name: "Lea", how_known: "partner", moment: "We had friends coming for dinner and one couple cancelled an hour before. {name} just went quiet, kept cooking, and said almost nothing for the rest of the evening. When I asked, he said it was fine." },
  { persona: "mom", name: "Mom", how_known: "family", moment: "At my birthday lunch his brother changed the restaurant at the last minute. {name} didn't argue, he went very quiet in the car and barely spoke at the table. I could tell it had landed." },
  { persona: "sam", name: "Sam", how_known: "friend", moment: "We'd planned a hike for weeks and I moved it the night before. He said sure, no problem, but then he was short and quiet all day and left early." },
  { persona: "dara", name: "Dara", how_known: "friend", moment: "I was late to our coffee by about forty minutes. {name} said it was fine, but he went quiet and kept checking his phone, and the conversation never really started." },
  { persona: "lea", name: "Lea", how_known: "partner", moment: "When I told him my parents were coming a day earlier than planned, he nodded, said okay, and then was silent for most of the evening. The next day he was back to normal." },
  { persona: "ari", name: "Ari", how_known: "coworker", moment: "A client moved a deadline up by two days and {name} took it on without a word. Later in the kitchen he said it was fine, but you could see he was carrying it. He stayed late three nights." },
  { persona: "sam", name: "Sam", how_known: "friend", moment: "His landlord raised the rent and when I asked how he was doing with it he said it's fine, it's manageable, and changed the subject. He does that a lot: says it's fine and moves on." },
  { persona: "lea", name: "Lea", how_known: "partner", moment: "I asked if the long week had got to him and he said it was fine, really. He always says it's fine, even when I can see it isn't. Then he went to bed early." },
  { persona: "dara", name: "Dara", how_known: "friend", moment: "When we were planning the trip to the coast {name} lit up, had the map out, found the little places nobody knew about. He was a different person for that hour." },
  { persona: "mom", name: "Mom", how_known: "family", moment: "He's just stubborn, always has been." },
];
