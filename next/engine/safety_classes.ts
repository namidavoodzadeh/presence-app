// Law 8, QA-B336 under PSY 15 Nov rulings 1 and 2 (d-psy-engine-rulings-15nov, relayed by the COO 02:20Z 15 Nov).
//
// A floor stop from a row added in QA-B336 rounds 3 and later (INTENT_RE, the cue class, the matrix, the frame pass) is a
// CANDIDATE in four classes: negation, distant past, idiom, emotional hurt. It clears only with TWO KEYS, both
// required: (1) the turn fits the class's written condition (this file, deterministic), AND (2) the semantic check answers none
// and names that same class on two parallel readings by TWO DIFFERENT MODELS, one reading each (PSY 15 Nov 04:44Z, 1a-1e: the API
// refuses any temperature on the 5.5 models, so Sonnet and Haiku agreeing replace "temperature 0"). The answer list is closed:
// stop, none, or one named class; anything else is a stop. No second try: an error, a timeout, an unreadable reply, a missing
// reading, two readings from one model, or a disagreement is final and the stop stands.
//
// EMOTIONAL HURT is unconditional too (16 Nov, QA-B336 x10 at 00:06Z: 'make sure he bleeds' and 'hurt him back, physically' stopped 0/10,
// the floor let them through and both readings called them emotional hurt). The class's key 1 stays written below as the record of
// its condition and its tests, but candidateClasses no longer offers it; a body-harm wish in a hurt-feelings frame is a floor stop now
// (HURT_BACK_SHAPE in reopenRisk).
//
// PREVENTION is unconditional again (PSY 04:44Z, 2e: one clear of a must-stop sentence, 'the judge gave her the weekends', ends that
// class). Per 2b it may come back only when its condition also stops on every contact word (WITH_NOW below now lists them), ten NEW
// risky twins stop 10/10, and the per-class clear and disagreement counts are posted; until then key 1 never offers it. Clearing only means the floor row does not stop the turn: the surface's
// own model safety field still runs and its stop wins.
//
// Unconditional, never cleared: the original (pre-B336, Python-ported) phrase floor; any turn where the speaker could be
// harmed by their own hand (myself, ourselves: self-harm, fear of an accident); the counterfactual near-miss about a person
// ("if I had stayed I would have hurt him"); any fear or control phrase anywhere in the turn; the REOPEN row (reopenRisk).
//
// This file only narrows: with the semantic check off or failing, nothing clears and every stop stands as before.

import type { RiskResult } from "./safety.ts";
import { keywordRisk, originalFloorRisk, stops } from "./safety.ts";

export const CLEAR_CLASSES = ["negation", "prevention", "distant_past", "idiom", "emotional_hurt"] as const;
export type ClearClass = typeof CLEAR_CLASSES[number];
/** Classes whose floor stops are final whatever the readings say (PSY 15 Nov 04:44Z 2e). Moves out only under PSY's 2b. emotional_hurt joined
 *  on 16 Nov (QA-B336 00:06Z: two of its must-stop twins stopped 0/10; one clear of a must-stop sentence ends the class). */
export const UNCONDITIONAL_CLASSES: ReadonlyArray<ClearClass> = ["prevention", "emotional_hurt"];

/** The least the semantic check must report for key 2. A SemanticRisk satisfies it. `model` is the model that made the reading. */
export interface ClassReading { ok: boolean; risk: RiskResult["risk"]; class: string; model: string }

const norm = (t: string) => t.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const sentences = (t: string) => t.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

// PSY 2: "a fear or control phrase anywhere in the turn (scared, afraid, threaten, 'won't let me', 'if you leave') = stop".
const FEAR_CONTROL = /\b(?:scared|afraid|frightened|terrified|petrified|threat(?:s|en(?:s|ed|ing)?)?|won'?t\s+let\s+(?:me|him|her|them|us)|(?:will\s+not|doesn'?t|does\s+not|didn'?t|did\s+not)\s+let\s+(?:me|us)|if\s+(?:you|i|he|she|we)\s+leaves?|controls?\s+(?:me|us|my)|in\s+control\s+of\s+me)\b/i;
// The speaker's own body: self-harm, or fear of an accident (PSY 2: unconditional).
const SPEAKER_SELF = /\b(?:myself|ourselves|my\s*self|kill\s+me\b(?!\s+if\b)|end\s+(?:it|my\s+life)|suicid\w*|overdose)\b/i;
// The counterfactual near-miss about a specific person (PSY 2: unconditional).
const COUNTERFACTUAL = /\b(?:if\s+(?:i|we)\s+(?:had|hadn'?t)\b[^.;!?]*\b(?:would|might|could)(?:\s+have|'ve)\b|(?:would|might|could)(?:\s+have|'ve)\s+(?:\w+\s+){0,2}(?:hurt|hit|killed|harmed|beaten|stabbed|strangled|choked)\b)/i;
// A first-person intent to harm anywhere in the turn: no class covers it.
const FIRST_PERSON_HARM = /\b(?:i|we)(?:'ll|\s+will|'m\s+going\s+to|\s+am\s+going\s+to|'re\s+going\s+to|'m\s+gonna|\s+want\s+to|\s+plan\s+to|\s+intend\s+to|'d\s+like\s+to|\s+need\s+to)\s+(?:\w+\s+){0,2}?(?:kill|murder|hurt|harm|hit|beat|punch|slap|stab|shoot|strangle|choke|attack|smash|kick|injure|poison|burn|drown|make\s+\w+\s+(?:pay|suffer|bleed)|get\s+(?:him|her|them|back\s+at)|teach\s+(?:him|her|them))\b/i;
const OTHER_HARM_VERB = /\b(?:kill\w*|murder\w*|harm\w*|hit|hits|hitting|beat\w*|punch\w*|slap\w*|stab\w*|shoot\w*|shot|strangl\w*|chok\w*|attack\w*|smash\w*|kick\w*|injur\w*|poison\w*|burn\w*|drown\w*|break|broke|broken)\b/i;
const WEAPON = /\b(?:knife|knives|gun|guns|rifle|pistol|blade|razor|hammer|axe|machete|crowbar|bat|rope|acid|poison|pills|weapon\w*|petrol|lighter)\b/i;
const BODY = /\b(?:face|head|skull|neck|throat|arm|arms|leg|legs|hand|hands|ribs|teeth|nose|jaw|body|eyes?|knees?|back)\b/i;
const END_STATE = /\b(?:dead|die|dies|died|death|hospital|blood|bleed\w*|bruis\w*|scar\w*|can'?t\s+walk|cannot\s+walk|badly|seriously|for\s+good)\b/i;
const TIME = /\b(?:tonight|tomorrow|today|later|soon|this\s+(?:weekend|week|evening|morning|afternoon)|next\s+(?:week|weekend|time)|after\s+dark|when\s+(?:he|she|they)\s+gets?\s+(?:home|back)|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at\s+\d)\b/i;
const PLAN = /\b(?:plan\w*|worked\s+out|figured\s+out|i\s+mean\s+it|do\s+it|i'?ll\s+do|where\s+(?:he|she|they)\s+(?:lives?|parks?|works?|sleeps?)|wait(?:ing)?\s+for|outside|follow\w*|how\s+to)\b/i;

// (1) Negation (PSY 1): a negated plain 'hurt' of another person.
const NEG_HURT = /\b(?:[Ii]|[Ww]e)\s+(?:don'?t|do\s+not|didn'?t|did\s+not|won'?t|will\s+not|wouldn'?t|would\s+not|never)\s+(?:(?:really\s+)?(?:want|wanted|mean|meant|intend|intended|wish|plan|planned)\s+to\s+)?hurt\s+(?!(?:myself|ourselves|me|us)\b)(?:him|her|them|you|anyone|anybody|someone|somebody|(?:my|our|his|her|their|the)\s+\w+|[A-Z][a-z]+)\b/;
const NEG_REOPEN = /\b(?:but|might|could|going\s+to|gonna|again|any\s*more|this\s+time|can'?t\s+stop|cannot\s+stop|lose\s+control|losing\s+control|lose\s+it|losing\s+it|(?:afraid|scared|worried)\s+(?:that\s+)?i\s*(?:will|'ll|might|would|'d))\b/i;

function negation(t: string): boolean {
  const m = NEG_HURT.exec(t);
  if (!m) return false;
  if (NEG_REOPEN.test(t) || OTHER_HARM_VERB.test(t) || WEAPON.test(t) || BODY.test(t) || END_STATE.test(t)) return false;
  // (v) no other floor row fires in the turn once the negated clause is taken out.
  const rest = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length);
  return !stops(keywordRisk(rest));
}

// (2) Prevention (PSY 2): stopping, preventing, keeping someone safe from harm or keeping a dangerous person away; still stops
// if anyone (above all a child) is with that person now or going back, or the speaker was harmed and is still in contact.
const PREVENT = /\b(?:keep(?:s|ing)?\s+(?:[\w']+\s+){1,4}?(?:away|safe|from)|stop(?:s|ping)?\s+(?:[\w']+\s+){1,3}?from|prevent(?:s|ing)?|protect(?:s|ing)?|shield(?:s|ing)?|make\s+sure\s+(?:nobody|no\s+one|no-one))\b/i;
const WITH_NOW = /\b(?:with\s+(?:him|her|them)|stay(?:s|ing)?\s+(?:with|at|over)|lives?\s+with|living\s+with|back\s+to|go(?:es|ing)?\s+back|has\s+(?:her|him|them|the\s+(?:kids|baby|children))|visit\w*|custody|right\s+now|now|still|again|keeps?\s+(?:turning|coming|texting|calling|showing|messaging)|turn(?:s|ing)?\s+up|shar(?:e|es|ing)\s+(?:the|a|our|my)|every\s+day|at\s+home|in\s+the\s+house|same\s+house|tonight|tomorrow|this\s+weekend|next\s+week|visitation|custody|court(?:-ordered)?|judge|weekends?|overnights?|picks?\s+(?:\w+\s+)?up|drops?\s+(?:\w+\s+)?off|stays?\s+with|sees?\s+(?:him|her|them)|supervised|shared|has\s+to\s+go)\b/i;
const SPEAKER_HARMED = /\b(?:hurt|hurts|hurting|hit|hits|hitting|harm\w*|beat\w*|abus\w*|attack\w*)\s+(?:me|us)\b/i;

function prevention(t: string): boolean {
  if (!PREVENT.test(t) || WITH_NOW.test(t) || SPEAKER_HARMED.test(t) || FIRST_PERSON_HARM.test(t) || WEAPON.test(t) || TIME.test(t)) return false;
  return true;
}

// (3) Distant past (PSY 2): 'used to', a childhood age or 'years ago', past tense throughout; stops with still, sometimes,
// lately, any present tense, or an adult event within about a year.
const AGE_WORD = String.raw`(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|kid|child|teen|teenager|little|small|young|boy|girl)`;
const DISTANT = new RegExp(String.raw`\b(?:used\s+to|when\s+(?:i|we)\s+(?:was|were)\s+(?:a\s+)?` + AGE_WORD + String.raw`|as\s+(?:a\s+)?(?:kid|child|teen|teenager|boy|girl|little\s+\w+)|(?:many\s+|a\s+few\s+|several\s+|\d+\s+|ten\s+|twenty\s+)?years\s+ago|in\s+(?:primary|secondary|high|middle|junior)\s+school)\b`, "i");
const PAST_WISH = /\b(?:used\s+to\s+(?:want|wish|think|dream|fantasi[sz]e)|wanted\s+to|wished|thought\s+about|dreamed\s+of|dreamt\s+of)\b/i;
const NOT_OVER = /\b(?:still|sometimes|lately|these\s+days|nowadays|now|again|recently|any\s+more|anymore|comes?\s+back|came\s+back|every\s+(?:day|night|week|time|morning)|last\s+(?:week|month|year|night|summer|winter|spring|autumn|fall|christmas)|(?:days|weeks|months)\s+ago|this\s+(?:year|month|week)|a\s+year\s+ago|today|tonight)\b/i;
// Present tense about the urge or the person (PSY: any present tense stops). A present feeling about it being over is not the urge.
const PRESENT = /\b(?:(?:i|we)\s+(?:want|wish|feel|think|plan|need|hate|do|can'?t|keep|get)\b|(?:i|we)(?:'m|\s+am|'re|\s+are)\s+(?!(?:so\s+|really\s+|very\s+)?(?:glad|happy|relieved|grateful|proud|thankful|ashamed|sorry|embarrassed)\b)|(?:he|she|they)\s+(?:is|are|'s|'re|keeps|lives|comes|cries|gets|does|still|says|wants)\b)/i;

function distantPast(t: string): boolean {
  if (!DISTANT.test(t) || !PAST_WISH.test(t)) return false;
  return !(NOT_OVER.test(t) || PRESENT.test(t) || FIRST_PERSON_HARM.test(t) || WEAPON.test(t) || PLAN.test(t) || TIME.test(t));
}

// (4) Idiom (PSY 2): a fixed list of WHOLE phrases with their ordinary cause; stops if the phrase stands without its cause, or
// sits beside a plan, weapon or time.
const IDIOMS: RegExp[] = [
  /^(?:honestly,?\s+|god,?\s+|ugh,?\s+)?(?:i|we)\s+could\s+(?:kill|murder|strangle|throttle)\s+(?:him|her|them|you|my\s+\w+|[A-Z][a-z]+)\s+for\s+(?:\w+ing|being)\b[^.;!?]*[.!?]?$/i,
  /^[^.;!?]*\b(?:will|'ll|is\s+going\s+to|'s\s+going\s+to)\s+be\s+the\s+death\s+of\s+me\s+(?:with|over)\s+[^.;!?]+[.!?]?$/i,
  /^[^.;!?]*\b(?:my\s+\w+|mum|mom|dad|he|she|they)\s+(?:will|'ll|is\s+going\s+to|'s\s+going\s+to|is\s+gonna)\s+kill\s+me\s+if\s+(?:i|we)\s+[^.;!?]+[.!?]?$/i,
  /^(?:i|we)\s+could\s+murder\s+an?\s+(?:pizza|curry|burger|coffee|drink|beer|pint|kebab|sandwich|cup\s+of\s+tea|tea|takeaway)\b[^.;!?]*[.!?]?$/i,
  /^[^.;!?]*\b(?:my\s+(?:back|feet|head|knees)|these\s+(?:shoes|boots|heels))\s+(?:is|are)\s+killing\s+me\b[^.;!?]*[.!?]?$/i,
];

function idiom(t: string): boolean {
  const ss = sentences(t);
  if (ss.length !== 1) return false;   // the whole turn is the phrase with its cause, nothing beside it
  if (!IDIOMS.some((re) => re.test(ss[0]))) return false;
  if (WEAPON.test(t) || TIME.test(t) || PLAN.test(t) || END_STATE.test(t.replace(/\bthe\s+death\s+of\s+me\b/i, "")) || FIRST_PERSON_HARM.test(t)) return false;
  return true;
}

// (5) Emotional hurt (PSY 2): the speaker's feelings; the response is silence or distance; stops with any body, hitting, fear or
// control word, or any plan beyond silence ("I'll make him pay").
const HURT_ME = /\b(?:he|she|they|you|my\s+\w+|[A-Z][a-z]+)\s+(?:hurt|hurts|has\s+hurt|had\s+hurt)\s+me\b|\bhow\s+much\s+(?:he|she|they|you|it)\s+hurt\s+me\b/;
const SILENCE = /\b(?:not\s+(?:answering|replying|responding|calling|texting|visiting|going|coming|speaking|talking|seeing|picking\s+up)|stop(?:ped)?\s+(?:answering|replying|responding|calling|texting|talking|speaking|seeing)|keep(?:ing)?\s+my\s+distance|keep(?:ing)?\s+away|stay(?:ing)?\s+away|ignor(?:e|ing)|block(?:ed|ing)?\s+(?:him|her|them|his|their)|unfollow\w*|mut(?:e|ed|ing)\s+(?:him|her|them)|silence|silent|some\s+space|taking\s+(?:a\s+)?break\s+from)\b/i;
const BEYOND_SILENCE = /\b(?:pay|bleed\w*|blood|physically|hit\w*|punch\w*|kick\w*|slap\w*|beat\w*|wait(?:ing)?\s+for|outside|plan\w*|scared|afraid|won'?t\s+let|keys|phone|lock\w*|make\s+sure|suffer\w*|where\s+(?:he|she|they)\s+(?:lives?|works?|parks?)|follow\w*|revenge|get\s+back\s+at|teach\s+(?:him|her|them)|regret|kill\w*|hurt\s+(?:him|her|them)\s+back|back,?\s+physically|ruin\w*|destroy\w*|expose|tell\s+everyone)\b/i;

function emotionalHurt(t: string): boolean {
  if (!(HURT_ME.test(t) || /\b(?:feel|know|see)\s+(?:it|how\s+much)\b/i.test(t) && /\bhurt\s+me\b/i.test(t))) return false;
  if (!SILENCE.test(t) || BEYOND_SILENCE.test(t) || FIRST_PERSON_HARM.test(t) || WEAPON.test(t) || BODY.test(t)) return false;
  return true;
}

// REOPEN (PSY 15 Nov ruling 2, 2e run on d5948a52): a class's shape whose written condition FAILS is a stop in its own right, not
// only a turn that cannot clear. Without this row the floor let 13 of PSY's must-stop twins through (the child is with him right
// now, the milk line beside a knife, a negated hurt of his face) and the semantic check read them as benign. Each shape is the
// class's own trigger; the row fires only when that class's condition (above) does not fit, so the floor and key 1 never disagree.
const PERSON = String.raw`(?:me|us|him|her|them|you|the\s+(?:kids|baby|children|boy|girl|twins)|(?:my|our|his|her|their|your)\s+(?:little\s+|baby\s+|older\s+|younger\s+)?\w+|[A-Z][a-z]+)`;
const P_HARM = String.raw`(?:hurt|hurts|hurting|hit|hits|hitting|harm|harms|harming|beat|beats|beating|beaten|abus\w*|attack\w*|kill\w*|strangl\w*|chok\w*|punch\w*|slap\w*)`;
const PREVENT_SHAPE = new RegExp(String.raw`\b(?:from\s+` + P_HARM + String.raw`\s+` + PERSON + String.raw`\b|who\s+(?:\w+\s+)?` + P_HARM + String.raw`\b)`);
const IDIOM_SHAPE = new RegExp(String.raw`\b(?:[Ii]|[Ww]e)\s+could\s+(?:kill|murder|strangle|throttle|choke)\s+(?:him|her|them|you|(?:my|our|his|her|their)\s+\w+|[A-Z][a-z]+)\b`);
const NEG_SHAPE = /\b(?:[Ii]|[Ww]e)\s+(?:don'?t|do\s+not|didn'?t|did\s+not|won'?t|will\s+not|wouldn'?t|would\s+not|never)\s+(?:(?:really\s+)?(?:want|wanted|mean|meant|intend|intended|wish|plan|planned)\s+to\s+)?(?:hurt|break|hit|harm|injure|cut|burn|smash)\s+(?:him|her|them|you|(?:his|her|their|your)\s+\w+|[A-Z][a-z]+)\b/;

// The hurt-feelings frame's own body-harm tails: 'hurt him back', 'make sure he bleeds', 'hurt him ... physically'. Always a stop.
const HURT_BACK_SHAPE = new RegExp(
  String.raw`\b(?:hurt|harm|hit|beat|punch|slap|injure|smash|break)\s+(?:him|her|them)\s*,?\s+back\s*(?:[.,;!?]|$|\s+(?:physically|so|and|but|because|too|just|for|the\s+way|like)\b)` +
  String.raw`|\bmake\s+(?:sure|certain)\s+(?:he|she|they)\s+(?:bleeds?|suffers?|dies?|(?:gets?|is|are)\s+(?:hurt|injured|beaten))\b` +
  String.raw`|\b(?:hurt|harm|injure|hit|beat)\w*\s+(?:him|her|them)\b[^.;!?]{0,24}\bphysically\b` +
  String.raw`|\bphysically\s+(?:hurt|harm|injure|hit|beat)\w*\s+(?:him|her|them)\b` +
  String.raw`|\b(?:feel|taste)\s+(?:the\s+)?(?:pain|hurt)\s+(?:he|she|they)\s+(?:caused|gave)\b[^.;!?]*\b(?:bleed\w*|blood|physically)\b`,
  "i",
);

// CONTINUED CONTACT (QA-B336 attempt 2, changed strategy, 15 Nov 14:16Z). The first attempt keyed the stop on a prevention word
// ("stop ... from", "keep ... away"). QA's fresh set showed the danger does not live in the verb: "I am stopping the man who harmed
// my family, while the children stay with him tonight" has no 'from'. The class is a PAIR, whatever the syntax or the verb:
//   (1) the turn says a person harmed someone (the speaker, a child, the family): a harm verb with a person object, an abuser word,
//       or "was hurt by him"; AND
//   (2) it says a dependent is, or the speaker is, with that person now or soon: a child with him/her/them, or an ordered-contact
//       word (custody, visitation, a court, an overnight, a handover, "has the kids").
// The two may sit in different sentences. No prevention word is needed, and none clears it. A harm that the turn places years ago
// stops only on a child's contact or an order (a present, dependent-facing risk), never on a bare "I visit him".
const NOT_BODY = String.raw`(?!\s+(?:back|neck|knees?|ankles?|legs?|arms?|shoulders?|feet|foot|heads?|hands?|wrists?|eyes?|feelings?|pride|chances|career|reputation)\b)`;
const HARM_V = String.raw`(?:harm(?:ed|s)?|hurt(?:s)?|hit(?:s)?|beat(?:s|en)?|abus(?:ed|es)|attack(?:ed|s)?|assault(?:ed|s)?|strangl(?:ed|es)|chok(?:ed|es)|batter(?:ed|s)?|punch(?:ed|es)?|slap(?:ped|s)?|kick(?:ed|s)?|stab(?:bed|s)?|injur(?:ed|es)|threaten(?:ed|s)?|terroris(?:ed|es)|terroriz(?:ed|es)|shook|shoved|pushed|locked\s+(?:me|us|her|him|them)\s+in)`;
const BODY_W = String.raw`(?:back|neck|knees?|ankles?|legs?|arms?|shoulders?|feet|foot|heads?|hands?|wrists?|eyes?|feelings?|pride|chances|career|reputation)`;
const HARM_OBJ = String.raw`(?:me|us|(?:my|our)\s+(?!` + BODY_W + String.raw`\b)\w+|the\s+(?:kids|children|baby|boy|girl|twins)|her|him|them|family)`;
const HARMED_BY = [
  new RegExp(String.raw`\b` + HARM_V + String.raw`\s+(?:\w+\s+){0,1}?` + HARM_OBJ + String.raw`\b(?!\s+up\b)` + NOT_BODY, "i"),
  /\bput\s+(?:\w+\s+){1,3}?in\s+(?:the\s+)?(?:hospital|icu)\b/i,
  /\b(?:who|that|he|she)\s+(?:has\s+|had\s+)?(?:broke|broken|burn(?:ed|t)|cut|bit|bitten|pinned|dragged|choked|locked|starved|whipped|scalded)\s+(?:\w+\s+){0,2}?(?:me|us|my|our|her|his|their|the\s+(?:kids|children|baby|boy|girl))\b/i,
  /\b(?:is|was|gets|can\s+be|becomes|turns)\s+violent\b(?!\s+(?:in|on)\s+(?:that|the|this|a)\s+(?:movie|film|show|game|book|story|screen))/i,
  /\b(?:abusive|abuser|abusers|batterer|assaulted|dangerous\s+(?:man|woman|person|ex|father|mother|dad|mum|mom|partner|husband|wife|boyfriend|girlfriend))\b/i,
  /\b(?:was|were|got|been|get|being)\s+(?:\w+\s+)?(?:hurt|hit|beaten|abused|attacked|harmed|assaulted|threatened|strangled|choked|injured)\s+by\s+(?:him|her|them|my\s+\w+|our\s+\w+|the\s+\w+|[A-Z][a-z]+)\b/i,
  /\bwho\s+(?:has\s+|had\s+|have\s+)?(?:\w+\s+){0,1}?(?:harm|hurt|hit|beat|abuse|attack|assault|strangle|choke|batter|threaten)(?:ed|s|en)?\b(?!\s+(?:feelings?|my\s+(?:feelings?|pride)))/i,
];
const CONTACT_DEP = new RegExp(
  String.raw`\b(?:children|kids?|child|baby|babies|son|sons|daughter|daughters|twins|toddler|boy|girl|teen\w*|niece|nephew|grand(?:kids?|children|son|daughter)|family)\b[^.;!?]{0,80}?` +
  String.raw`\b(?:with|to|at|beside|near|alone\s+with|over\s+at|back\s+to)\s+(?:him|her|them|(?:his|her|their)\s+\w+|(?:their|his|her|the)\s+(?:father|mother|dad|mum|mom|dad|stepdad|stepmum|ex|uncle|aunt)(?:'s|s)\b|the\s+(?:man|woman|person|ex|father|mother|dad|mum|mom|husband|wife|partner|boyfriend|girlfriend))\b` +
  String.raw`|\b(?:with|to|at)\s+(?:him|her|them)\b[^.;!?]{0,40}?\b(?:children|kids?|child|baby|son|daughter|twins)\b`, "i");
const CONTACT_ORDER = /\b(?:court[- ]ordered|custody|visitation|supervised\s+visit\w*|overnights?|weekends?\s+(?:with|at)|hand-?overs?|hand-?off|exchanges?\s+(?:the\s+)?(?:kids|children)|(?:he|she|they)\s+(?:has|have|gets?|take|takes|keeps?)\s+(?:the\s+)?(?:kids|children|baby|babies|twins|them)|(?:sees?|visits?)\s+(?:the\s+)?(?:kids|children)|judge\s+(?:gave|said|ruled|ordered|decided|granted)|court\b|(?:gives?|gave|giving|grants?)\s+(?:him|her|them)\s+(?:\w+\s+){0,2}?(?:weekends?|saturdays?|sundays?|fridays?|nights?|holidays?|time|access)|(?:going|goes|go|went)\s+back\s+to\s+(?:him|her|them)|move(?:s|d)?\s+back\s+in|lives?\s+with\s+(?:him|her|them)|living\s+with\s+(?:him|her|them)|stay(?:s|ing)?\s+with\s+(?:him|her|them)|(?:he|she)(?:'s|\s+is)\s+coming\s+(?:over|home|back|round|around)|drop(?:s|ping)?\s+(?:\w+\s+){0,2}off\s+(?:at|with)|pick(?:s|ing)?\s+(?:\w+\s+){0,2}up\s+from\s+(?:him|her|them))\b/i;

function continuedContact(t: string): boolean {
  if (!HARMED_BY.some((re) => re.test(t))) return false;
  if (CONTACT_DEP.test(t)) return true;
  if (!CONTACT_ORDER.test(t)) return false;
  // A harm placed long ago, with nothing present or ordered about a child, is the distant-past class, not this one.
  const farBack = DISTANT.test(t) && !NOT_OVER.test(t) && !/\b(?:kids|children|child|baby|custody|visitation|court|judge|overnights?)\b/i.test(t);
  return !farBack;
}

/** The REOPEN floor row: null unless a prevention, idiom or negation shape stands with its class's condition failing, or a harm and a present contact stand together. */
export function reopenRisk(text: string): RiskResult | null {
  const t = norm(text);
  const fired = (PREVENT.test(t) && PREVENT_SHAPE.test(t) && !prevention(t)) || (IDIOM_SHAPE.test(t) && !idiom(t)) ||
    (NEG_SHAPE.test(t) && !negation(t)) || continuedContact(t) || HURT_BACK_SHAPE.test(t);
  if (!fired) return null;
  return SPEAKER_HARMED.test(t) ? { risk: "self", reason: "harm still close" } : { risk: "others", reason: "harm still close" };
}

const CONDITIONS: Record<ClearClass, (t: string) => boolean> = {
  negation, prevention, distant_past: distantPast, idiom, emotional_hurt: emotionalHurt,
};

/**
 * Key 1. The classes whose written condition this turn fits, given the floor's stop. Empty when the floor did not stop, when the
 * stop is unconditional (original floor row, the speaker's own body, a counterfactual near-miss, a fear or control phrase), or when
 * no condition fits.
 */
export function candidateClasses(text: string, floor: { risk: string }): ClearClass[] {
  if (floor.risk === "none") return [];
  const t = norm(text);
  if (stops(originalFloorRisk(t)) || SPEAKER_SELF.test(t) || COUNTERFACTUAL.test(t) || FEAR_CONTROL.test(t) || reopenRisk(t)) return [];
  return CLEAR_CLASSES.filter((c) => !UNCONDITIONAL_CLASSES.includes(c) && CONDITIONS[c](t));
}

/**
 * Both keys. The class that clears this floor stop, or null (the stop stands). `readings` are the class reading of each of the TWO
 * models (PSY 04:44Z 1a): exactly two, from two different models, every one ok, read none, and naming the same class, which must be
 * one key 1 found. A missing or unavailable reading, one model twice, a stop, another class or a disagreement is null. Closed list:
 * only a class name from CLEAR_CLASSES counts as a class.
 */
export function twoKeyClear(text: string, floor: { risk: string }, readings: ReadonlyArray<ClassReading | null>): ClearClass | null {
  const cands = candidateClasses(text, floor);
  if (!cands.length || readings.length !== 2) return null;
  const named = new Set<string>(), models = new Set<string>();
  for (const r of readings) {
    if (!r || !r.ok || r.risk !== "none" || !r.model) return null;
    named.add(r.class.trim().toLowerCase());
    models.add(r.model);
  }
  if (named.size !== 1 || models.size !== 2) return null;
  const c = [...named][0] as ClearClass;
  return cands.includes(c) ? c : null;
}

/**
 * The surfaces' entry: twoKeyClear plus PSY's counts (1e: clears and disagreements per class, nothing else). A disagreement is two
 * available readings that do not both say none and the same class; an unavailable reading is not one.
 */
export function settleClear(text: string, floor: { risk: string }, readings: ReadonlyArray<ClassReading | null>): ClearClass | null {
  const cleared = twoKeyClear(text, floor, readings);
  if (cleared) { countClear(cleared); return cleared; }
  const cands = candidateClasses(text, floor);
  if (cands.length && readings.length === 2 && readings.every((r) => r && r.ok)) {
    const key = (r: ClassReading | null) => r ? `${r.risk}/${r.class.trim().toLowerCase()}` : "";
    if (key(readings[0]) !== key(readings[1]) || readings.some((r) => r!.risk !== "none")) for (const c of cands) countDisagreement(c);
  }
  return null;
}

// Counts of clears per class since the process started (PSY: count clears per class, no text).
const clears = new Map<ClearClass, number>();
export function countClear(c: ClearClass): void {
  clears.set(c, (clears.get(c) ?? 0) + 1);
  console.log(JSON.stringify({ at: "safety.clear", class: c, count: clears.get(c) }));
}
const disagreements = new Map<ClearClass, number>();
export function countDisagreement(c: ClearClass): void {
  disagreements.set(c, (disagreements.get(c) ?? 0) + 1);
  console.log(JSON.stringify({ at: "safety.disagree", class: c, count: disagreements.get(c) }));
}
export function clearCounts(): Record<string, number> {
  return Object.fromEntries(CLEAR_CLASSES.map((c) => [c, clears.get(c) ?? 0]));
}
export function disagreementCounts(): Record<string, number> {
  return Object.fromEntries(CLEAR_CLASSES.map((c) => [c, disagreements.get(c) ?? 0]));
}
