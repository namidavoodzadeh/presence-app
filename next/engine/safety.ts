// Law 8 risk check: the keyword floor (ported word for word from engine/safety/__init__.py)
// plus the model's risk field. Either stops; a model answer can add a stop, never remove one.

import type { Risk } from "./types.ts";
import { DITRANS, IN_IDIOM, matrixRisk, POSSESSED, TAIL as IDIOM_TAIL } from "./harm_matrix.ts";
import { reopenRisk } from "./safety_classes.ts";
import { frameRisk } from "./harm_frame.ts";
import { governedElsewhere, negatedCue, negatesAct } from "./harm_scope.ts";

export interface RiskResult { risk: Risk; reason: string }
export const NONE: RiskResult = { risk: "none", reason: "no direct risk phrase" };

export const RESOURCES = {
  message: "It sounds like you may need immediate support from a person.",
  resources: [{ label: "Find a helpline", url: "https://findahelpline.com" }],
};

const SELF = String.raw`(?:myself|ourselves|my\s*self)`;
const OTHER = String.raw`(?:you|him|her|them|someone|somebody|anyone|people|my\s+(?:wife|husband|partner|girlfriend|boyfriend|kids?|child(?:ren)?|son|daughter|baby|mom|mother|dad|father|brother|sister|boss|family|neighbou?r|coworker|colleague))`;
const HARM = String.raw`(?:kill(?:s|ed|ing)?|hurt(?:s|ing)?|harm(?:s|ed|ing)?|cut(?:s|ting)?|shoot(?:s|ing)?|shot|stab(?:s|bed|bing)?|strangl(?:e|ed|ing))`;
const HARM_OTHER = String.raw`(?:kill|hurt|harm|shoot|stab|strangle|hit|beat|punch|slap|choke)`;
const PILLS = String.raw`(?:pills|meds|medication|tablets)`;

type Row = [Risk, string, string];
// Round 5 (PSY 14 Nov over-trigger controls: "I hurt his feelings"): hurting a person's feelings,
// pride or trust is an emotional hurt, never a harm to the person's body. Only these owned nouns.
const EMOTIONAL_OBJECT = String.raw`(?!(?:['’]s)?\s+(?:feelings?|pride|ego|trust|confidence|chances|reputation|career|heart)\b)`;
const PATTERNS: Row[] = [
  ["self", "reflexive harm", String.raw`\b` + HARM + String.raw`\s+` + SELF + String.raw`\b(?!\s+(?:a|an|another|some|the)\b)`],
  ["self", "self-harm", String.raw`\bself[\s-]?harm(?:s|ed|ing)?\b|\bcutting\s+again\b`],
  ["self", "suicide", String.raw`\b(?:suicidal|suicide)\b`],
  ["self", "overdose", String.raw`\b(?:take|taking|took)\s+(?:an\s+)?overdose\b|\boverdos(?:e|ing)\s+on\s+(?:my|pills|the\s+pills)\b`],
  ["self", "pills", String.raw`\bstockpil(?:e|ed|ing)\s+(?:my\s+|the\s+)?` + PILLS + String.raw`\b|\b(?:took|take|taking|swallowed)\s+(?:a\s+(?:bunch|lot|handful)\s+of|all\s+(?:of\s+)?)\s*(?:my\s+|the\s+)?` + PILLS + String.raw`\b`],
  ["self", "ending life", String.raw`\bend(?:s|ed|ing)?\s+(?:my|our)\s+(?:own\s+)?li(?:fe|ves)\b|\btak(?:e|ing)\s+my\s+(?:own\s+)?life\b|\bend(?:ing)?\s+it\s+all\b`],
  ["self", "ending it", String.raw`\b(?:want|going|plan|planning|ready|think(?:ing)?\s+about|thought\s+about|considering)\s+(?:to\s+)?end(?:ing)?\s+it\s*(?:[.!?,]|$|now|tonight|today|soon)`],
  ["self", "wanting to die", String.raw`\b(?:want(?:ed)?\s+to|wanna|going\s+to|gonna|ready\s+to|i\s+will|i'll)\s+die\b(?!\s+(?:of|from|laughing|with|for))|\b(?:ways|how)\s+to\s+(?:die|kill\s+myself|end\s+(?:it|my\s+life))\b`],
  ["self", "wishing to be dead", String.raw`\bwish\s+(?:i|we)\s+(?:was|were|could\s+be)\s+dead\b|\bwish\s+(?:i|we)\s+(?:had\s+never\s+been\s+born|wasn't\s+here|weren't\s+here)\b|\bdisappear\s+(?:forever|for\s+good|permanently)\b|\bwant\s+to\s+be\s+gone\b`],
  ["self", "others better off", String.raw`\bbetter\s+off\s+without\s+me\b|\b(?:better\s+off|happier|easier)\s+(?:if|when)\s+i(?:'m|\s+am|\s+was|\s+were)?\s*(?:gone|dead|(?:n't|\s?not)\s+(?:here|around)(?=\s*(?:[.!?,;]|$|any\s*more)))\b`],
  ["self", "no reason to live", String.raw`\b(?:no|nothing)\s+(?:reason|point)\s+(?:to|in)\s+(?:live|living|going\s+on)\b|\bnothing\s+(?:left\s+)?to\s+live\s+for\b|\bnot\s+worth\s+living\b|\bisn't\s+worth\s+living\b|\bcan(?:'t|not)\s+(?:keep\s+living|go\s+on\s+living|go\s+on\s+(?:like\s+this\s+)?any\s*more)\b`],
  ["self", "not wanting to be alive", String.raw`\b(?:don't|do\s+not|dont)\s+want\s+to\s+(?:be\s+alive|live|exist|be\s+here)\s*(?:any\s*more|$|[.!?,])|\b(?:don't|do\s+not|dont)\s+want\s+to\s+(?:be\s+alive|exist|wake\s+up)\b|\bhope\s+i\s+(?:don't|do\s+not|never)\s+wake\s+up\b|\bsleep\s+and\s+never\s+wake\s+up\b|\b(?:think(?:ing)?|thought)\s+(?:about|of)\s+not\s+(?:being\s+(?:here|alive|around)|waking\s+up|existing)\b`],
  ["self", "not safe", String.raw`\b(?:don't|do\s+not|dont)\s+feel\s+safe\s+(?:alone|by\s+myself|with\s+myself|around\s+myself|being\s+alone|tonight|right\s+now|anymore)\b|\b(?:i'm|i\s+am|im)\s+not\s+safe\s+(?:alone|by\s+myself|with\s+myself|around\s+myself|tonight|right\s+now)\b|\bnot\s+safe\s+(?:for\s+me\s+)?to\s+be\s+(?:alone|by\s+myself)\b`],
  ["self", "fear of self-harm", String.raw`\b(?:scared|afraid|worried)\s+(?:that\s+)?(?:i|i'm|i\s+am|i'll|i\s+will|i\s+might)\s+(?:going\s+to\s+|gonna\s+)?do\s+something\s+to\s+myself\b`],
  ["self", "plan or goodbye", String.raw`\b(?:goodbye|suicide)\s+(?:letter|note)s?\b|\bjump(?:ing)?\s+(?:off|from|in\s+front\s+of)\s+(?:the|a)\s+(?:bridge|roof|building|balcony|train|cliff|ledge)\b|\bdecided\s+(?:that\s+)?(?:this|today|tonight)\s+(?:is|will\s+be)\s+my\s+last\s+(?:day|night|week)\b|\b(?:i'm|i\s+am)\s+(?:just\s+)?a\s+burden\s+to\s+(?:everyone|everybody|my\s+family)\b`],
  ["others", "intent to harm", String.raw`\b(?:i|we)\s*(?:(?:am|are|'m|'re)\s+)?(?:going\s+to|gonna|planning\s+(?:to|on)|plan\s+to|intend\s+to|want\s+to|will|'ll|about\s+to|ready\s+to)\s+(?:really\s+)?` + HARM_OTHER + String.raw`\s+` + OTHER + String.raw`\b` + IDIOM_TAIL],
  ["others", "plan to harm", String.raw`\b(?:have|made|got)\s+(?:a\s+)?plan\s+to\s+(?:kill|hurt|harm|shoot|stab)\s+` + OTHER + String.raw`\b`],
  ["others", "thoughts of harm", String.raw`\b(?:think(?:ing)?|thought|considering|consider|imagin(?:e|ing)|fantasi[sz](?:e|ing))\s+(?:a\s+lot\s+)?(?:about|of)?\s*(?:killing|hurting|harming|shooting|stabbing)\s+` + OTHER + String.raw`\b`],
  ["others", "fear of harming", String.raw`\b(?:scared|afraid|worried)\s+(?:that\s+)?(?:i|i'm|i\s+am|i'll|i\s+will|i\s+might)\s+(?:going\s+to\s+|gonna\s+)?(?:` + HARM_OTHER + String.raw`\s+` + OTHER + String.raw`)\b` + EMOTIONAL_OBJECT],
  ["others", "violence at home", String.raw`\b(?:hit|beat|punched|slapped|choked|strangled)\s+my\s+(?:wife|husband|partner|girlfriend|boyfriend|kids?|child(?:ren)?|son|daughter|baby)\b`],
  ["others", "weapon or revenge", String.raw`\b(?:gun|rifle|pistol|weapon)\s+to\s+(?:deal\s+with|handle|settle|get|use\s+on|take\s+care\s+of)\b|\bshoot\s+up\s+(?:the|my|a|this)\s+(?:office|school|place|work|building|party|church|mall|class)\b|\bmake\s+(?:him|her|them)\s+pay\b(?=\s*(?:[.!,;]|$|for\s+(?:what|this|that|it)\b))`],
];

// Bridge's floor, kept whole so both lanes hold on one list.
const B_SUBJECT = String.raw`(?:i|we|i'm|we're|i\s+am|we\s+are)`;
const B_OTHER = String.raw`(?:you|him|her|them|someone|somebody|anyone|people|my\s+(?:wife|husband|partner|kids?|child(?:ren)?|son|daughter|baby|mom|mother|dad|father|brother|sister|boss|family))`;
const B_HARM = String.raw`(?:kill(?:s|ed|ing)?|hurt(?:s|ing)?|harm(?:s|ed|ing)?|cut(?:s|ting)?|shoot(?:s|ing)?|shot|stab(?:s|bed|bing)?|strangl(?:e|ed|ing)|attack(?:s|ed|ing)?)`;

const BRIDGE_SELF = [
  String.raw`\b` + B_HARM + String.raw`\s+` + SELF + String.raw`\b(?!\s+(?:a|an|another|some|the)\b)`,
  String.raw`\b(?:suicidal|suicide)\b`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:thinking|thought|considering|planning|plan|afraid|scared|worried)\s+(?:a\s+lot\s+)?(?:about|of|to|that)?\s*` + B_HARM + String.raw`\s+` + SELF + String.raw`\b`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:want|wanted|plan|planned|planning|intend|intended|ready|about|going|gonna|will|'ll)\s+(?:to\s+)?(?:end|ending|take|taking)\s+(?:my|our)\s+(?:own\s+)?li(?:fe|ves)\b`,
  String.raw`\b(?:end|ending|ended|take|taking|took)\s+(?:my|our)\s+(?:own\s+)?li(?:fe|ves)\b`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:just\s+)?(?:want|wanted|plan|planning|ready|going|gonna)\s+to\s+end\s+it\s+all\b`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:just\s+)?(?:want|wanted|wanna|going|gonna|ready|plan|planning)\s+to\s+die\b(?!\s+(?:of|from|laughing|with|for))`,
  String.raw`\b(?:i|we)\s+wish\s+(?:i|we)\s+(?:was|were|could\s+be)\s+dead\b`,
  String.raw`\b(?:i|we)\s+wish\s+(?:i|we)\s+(?:had\s+never\s+been\s+born|wasn't\s+here|weren't\s+here)\b`,
  String.raw`\b(?:i(?:'d|\s+would|\s+am|'m)?|we(?:'d|\s+would|\s+are|'re)?)\s*(?:be\s+)?better\s+off\s+dead\b`,
  String.raw`\b(?:everyone|they|you|my\s+family|the\s+world)\s+(?:would\s+be|is)\s+better\s+off\s+without\s+me\b`,
  String.raw`\b(?:no|nothing)\s+(?:reason|point)\s+(?:to|in)\s+(?:live|living|going\s+on)\b`,
  String.raw`\bnothing\s+(?:left\s+)?to\s+live\s+for\b`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:don't|do\s+not|dont)\s+want\s+to\s+(?:be\s+alive|live|exist|wake\s+up|be\s+here)\s*(?:any\s*more|anymore|$|[.!?,])`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:(?:don't|do\s+not|dont)\s+feel|not)\s+safe\s+(?:alone|by\s+myself|with\s+myself|around\s+myself|tonight|right\s+now|anymore)\b`,
  String.raw`\bnot\s+safe\s+(?:for\s+me\s+)?to\s+be\s+(?:alone|by\s+myself)\b`,
  String.raw`\b(?:i|we)\s+(?:am|'m|are|'re)?\s*(?:afraid|scared|worried)\s+(?:that\s+)?(?:i|we)?\s*(?:might|may|will|'ll|could)\s+(?:do\s+something\s+to\s+myself|` + B_HARM + String.raw`\s+` + SELF + String.raw`)\b`,
  String.raw`\b(?:i|we)\s+(?:have|made|got)\s+(?:a\s+)?plan\s+to\s+(?:die|` + B_HARM + String.raw`\s+` + SELF + String.raw`)\b`,
  String.raw`\b(?:i|we)\s+(?:am|'m|are|'re)?\s*(?:going\s+to|planning\s+to|about\s+to|want\s+to)\s+(?:take\s+an?\s+overdose|overdose)\b`,
];

const BRIDGE_OTHERS_RAW = [
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:going\s+to|gonna|planning\s+(?:to|on)|plan\s+to|intend\s+to|want\s+to|will|'ll|about\s+to|ready\s+to|might|may)\s+` + B_HARM + String.raw`\s+` + B_OTHER + String.raw`\b`,
  // \"I could kill him for forgetting the milk\" is idiom (PSY 14 Nov control); \"could\" still stops unless it is that for-clause.
  String.raw`\b` + B_SUBJECT + String.raw`\s+could\s+` + B_HARM + String.raw`\s+` + B_OTHER + String.raw`\b(?!\s+for\s+\w+ing\b)`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:have|made|got)\s+(?:a\s+)?plan\s+to\s+` + B_HARM + String.raw`\s+` + B_OTHER + String.raw`\b`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:(?:keep|kept)\s+)?(?:thinking|thought|considering|consider|imagining|imagine|fantasi[sz](?:e|ing))\s+(?:a\s+lot\s+)?(?:about|of)?\s*` + B_HARM + String.raw`\s+` + B_OTHER + String.raw`\b`,
  String.raw`\bi(?:'ve|\s+have)\s+been\s+(?:thinking|considering|imagining|fantasi[sz]ing)\s+(?:about|of)?\s*` + B_HARM + String.raw`\s+` + B_OTHER + String.raw`\b`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+(?:afraid|scared|worried)\s+(?:that\s+)?(?:i|we)?\s*(?:might|may|will|'ll|could)\s+` + B_HARM + String.raw`\s+` + B_OTHER + String.raw`\b`,
  String.raw`\b` + B_SUBJECT + String.raw`\s+` + B_HARM + String.raw`\s+` + B_OTHER + String.raw`\s+(?:and|but|because)\s+(?:i|we)\b`,
];

const BRIDGE_OTHERS = BRIDGE_OTHERS_RAW.map((p, i) => (i < BRIDGE_OTHERS_RAW.length - 1 ? p + IDIOM_TAIL : p));

function compile(rows: [string, string][]): [string, RegExp][] {
  return rows.map(([reason, pattern]) => [reason, new RegExp(pattern, "i")]);
}

const OTHERS_PATTERNS = compile([
  ...PATTERNS.filter(([risk]) => risk === "others").map(([, reason, p]) => [reason, p] as [string, string]),
  ...BRIDGE_OTHERS.map((p) => ["direct harm-to-others language", p] as [string, string]),
]);
const SELF_PATTERNS = compile([
  ...PATTERNS.filter(([risk]) => risk === "self").map(([, reason, p]) => [reason, p] as [string, string]),
  ...BRIDGE_SELF.map((p) => ["direct self-harm language", p] as [string, string]),
]);

function normaliseText(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

// Q12 (2026-11-07): the patterns above assume the speaker is the one who might cause harm. A
// disclosure that the person this message is about has hurt, threatened, or controlled the
// speaker (coercive-control / fear-of-partner-violence, law 8) is risk to the speaker from
// someone else, and slipped through every one of the W3.3 positive_safety fixtures onto a
// single, unbacked model call. Each needs a concrete controlling or violent act AND a fear or
// unsafe word in the same message, so an ordinary complaint ("you took my charger") can't trip it.
const PARTNER_HARMED_ME = String.raw`\byou\s+(?:hit|hurt|beat|choked|strangled|slapped|punched)\s+me\b`;
const PARTNER_THREATENED_ME = String.raw`\b(?:you\s+)?(?:said\s+(?:you'd|you\s+would|you'll|you\s+will)|threatened\s+to)\s+(?:kill|hurt|harm|hit|beat|choke|strangle|punch|slap)\s+(?:me|my\s+(?:dog|cat|pet))\b`;
const PARTNER_CONTROL = String.raw`\b(?:took\s+my\s+keys|blocked\s+the\s+door|track(?:s|ed|ing)?\s+my\s+location|decide(?:s|d)?\s+who\s+i\s+can\s+see|take(?:s|n)?\s+my\s+phone|keep(?:s|ing)?\s+my\s+(?:bank\s+card|phone|keys|id|passport)|throw(?:s|n|ing)?\s+me\s+out)\b`;
const PARTNER_RISK_ACT = new RegExp(`(?:${PARTNER_HARMED_ME}|${PARTNER_THREATENED_ME}|${PARTNER_CONTROL})`, "i");
const PARTNER_RISK_FEAR = /\b(?:scared|afraid|frightened|terrified|trapped|unsafe|not\s+safe|don't\s+feel\s+safe|do\s+not\s+feel\s+safe)\b/i;

// PSY 14 Nov (HQ d-psy-askme-hostile-14nov, point 3): a wish, plan or intent to hurt a person, in three
// forms: (a) first person, (b) reported of someone, (c) received as a threat. These only ADD stops; every
// pattern above is untouched. "could", "would" and "might" are left out of (a) so idiom ("I could kill him
// for forgetting the milk") stays through; a threat verb or a said/told frame is required for (b) and (c).
const H_VERB = String.raw`(?:kill|murder|hurt|harm|hit(?!\s+(?:[\w']+\s+){1,2}up\b)|beat(?:\s+up)?|punch|slap|stab|shoot|strangle|choke)`;
const WHO_REL = String.raw`(?:wife|husband|partner|girlfriend|boyfriend|ex|kids?|child(?:ren)?|son|daughter|baby|mom|mother|dad|father|brother|sister|boss|family|neighbou?r|coworker|colleague|teacher|roommate|friend|cousin|uncle|aunt|aunty|nephew|niece|grand(?:ma|pa|mother|father|child|son|daughter)|in-laws?|mother-in-law|father-in-law|stepson|stepdaughter|stepdad|stepmom|fianc[eé]e?|spouse)`;
const WHO = String.raw`(?:(?:him|her|them)(?!\s+(?:own|class|team|group|staff|crew|squad|rival|rivals|` + WHO_REL + String.raw`|back|neck|knee|knees|ankle|leg|legs|arm|arms|shoulder|foot|feet|head|hand|hands|wrist|eyes?|pride|own|chances|feelings?|reputation|career|prospects|odds|case|image|eyes|style|business)\b)|someone|somebody|anyone|(?:my|your|his|her|their|our|the)\s+` + WHO_REL + String.raw`|(?:that|this|the)\s+(?:guy|man|woman|girl|boy|person|bastard|idiot|jerk))`;
const WHO_OR_YOU = String.raw`(?:` + WHO + String.raw`|you)`;
const INTENT = String.raw`(?:going\s+to|gonna|want(?:s|ed)?\s+to|plan(?:s|ned|ning)?\s+(?:to|on)|intend(?:s|ed)?\s+to|will|'ll|about\s+to|ready\s+to)`;
const NAME_SP = String.raw`[A-Z][a-z]+`;
const SPEAKER = String.raw`(?:he|she|they|you|my\s+` + WHO_REL + String.raw`|` + NAME_SP + String.raw`)`;
// Self-directed targets in a reported or received clause.
const ME = String.raw`(?:me|us|my\s+(?!(?:feelings?|pride|ego|chances|reputation|career)\b)\w+|our\s+\w+|the\s+kids)(?!\s+(?:back|later|(?:a|an|another)\s+(?:text|call|line|message|note|email|dm|ring|buzz)|at\s+(?:chess|cards|poker|golf|tennis|checkers|monopoly|scrabble|the\s+game|it|this|that)|with\s+(?:a\s+)?(?:pillow|joke|question|text|call|plan|idea|news|surprise|cake|coffee)))`;
const REFL = String.raw`(?:himself|herself|themselves?|yourself|themself)`;
const FRAME = String.raw`(?:said|says|told|tells|mentioned|admitted|texted|wrote|messaged|emailed|promised|swore|warned|threatened|confessed|announced|declared)(?:\s+(?:to\s+)?(?:me|us|her|him|them|you))?(?:\s+saying)?`;
const SUBJ = String.raw`(?:you|he|she|they)`;
const MODAL = String.raw`(?:'d|'ll|\s+would|\s+will|\s+was\s+going\s+to|\s+were\s+going\s+to|\s+is\s+going\s+to|\s+are\s+going\s+to|\s+(?:was|were|is|are)\s+gonna|\s+gonna|\s+going\s+to|\s+wants?\s+to|\s+wanted\s+to|\s+plan(?:s|ned)?\s+(?:to|on)|\s+intend(?:s|ed)?\s+to)`;

const FL_SUBJ = String.raw`(?:he|she|they|you|my\s+` + WHO_REL + String.raw`)`;
const FL_INTENT = String.raw`(?:(?:'s|'re|\s+(?:is|are|was|were|has\s+been|have\s+been|had\s+been|has|have|had))?\s+(?:really\s+|actually\s+|seriously\s+)?(?:want(?:s|ed|ing)?|plan(?:s|ned|ning)?|intend(?:s|ed|ing)?|decided|decides|threaten(?:s|ed|ing)?)\s+(?:to|on)|\s+wish(?:es|ed)?\s+(?:that\s+)?(?:he|she|they|you)\s+could)\s+(?:really\s+)?`;
const FL_PREFIX = String.raw`(?<![a-z])` + FL_SUBJ + FL_INTENT;
const FL_CLAUSE = FL_PREFIX + H_VERB + String.raw`(?:ting|bing|ing)?\s+`;
// Meaning-class additions (QA-B336 round 4): the wish/plan/intent is the class, not one phrasing.
const HAVE_DONE = String.raw`(?:have|having|get|getting)\s+`;
const DONE_VERB = String.raw`(?:killed|murdered|hurt|harmed|beaten(?:\s+up)?|shot|stabbed|strangled|choked|hit)`;
const FRAME2 = String.raw`(?:decided|resolved|vowed|determined|swore|promised|planned|intended|announced|declared|warned|threatened|said|says|told|mentioned|admitted|confessed|texted|wrote|messaged|emailed|heard|knows?|knew|claims?|claimed|saying)(?:\s+(?:to\s+)?(?:me|us|her|him|them|you))?(?:\s+saying)?(?:\s+that)?`;
const DEAD_END = String.raw`dead(?=\s*(?:[.!?,;]|$|\s(?:and|but|because|so|if|when|since|or)\b))`;

const INTENT_RE: [string, string][] = [
  // (a) first person, beyond the pronoun/relation targets the floor already holds: "my ex", "that guy", "your wife" ...
  ["intent to harm a person", String.raw`\b(?:i|we)\s*(?:(?:am|are|'m|'re)\s+)?` + INTENT + String.raw`\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + WHO + String.raw`\b`],
  ["wish a person dead", String.raw`\b(?:i|we)\s+(?:want|wanted|wish)\s+(?:him|her|them|you)\s+(?:was\s+|were\s+|to\s+be\s+)?dead\b`],
  // (b) reported of someone: "you said you want to hurt your wife", "he told me he would hurt her"
  ["reported intent to harm a person", String.raw`\b` + SPEAKER + String.raw`\s+(?:said|says|told\s+me|tells\s+me|told\s+us|mentioned|admitted)\s+(?:that\s+)?(?:you|he|she|they)(?:'re|'s|\s+(?:are|is))?(?:'d|'ll|\s+would|\s+` + INTENT + String.raw`|\s+(?:are|is)\s+` + INTENT + String.raw`)\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + WHO_OR_YOU + String.raw`\b`],
  ["reported intent to harm a person", String.raw`\b(?:he|she|they|you)(?:'re|'s|\s+(?:are|is))?\s+(?:planning|plans|plan|intend(?:s|ing)?|want(?:s|ing)?)\s+to\s+` + H_VERB + String.raw`\s+` + WHO_OR_YOU + String.raw`\b`],
  ["reported intent to harm a person", String.raw`\b(?:he|she|they|you)\s+(?:keeps?\s+)?(?:talk(?:s|ing)?|think(?:s|ing)?|fantasi[sz](?:es|ing))\s+(?:about|of)\s+(?:killing|hurting|harming|stabbing|shooting|strangling|beating)\s+` + WHO_OR_YOU + String.raw`\b`],
  // (c) received as a threat: "you said you'd hurt me if I left", "he threatened to kill me"
  ["threat received", String.raw`\b(?:threaten(?:s|ed|ing)?)\s+(?:to\s+)?` + H_VERB + String.raw`\s+` + ME + String.raw`\b`],
  ["threat received", String.raw`\b(?:you|he|she|they)\s+(?:said|says|told\s+me|tells\s+me|promised|swore)\s+(?:that\s+)?(?:you|he|she|they)(?:'d|'ll|\s+would|\s+will)\s+` + H_VERB + String.raw`\s+` + ME + String.raw`\b`],
  ["threat received", String.raw`\byou(?:'ll|\s+will|'d|\s+would)\s+` + H_VERB + String.raw`\s+(?:me|us)\s+if\s+(?:i|we)\b`],
  // Wider reported/received frames (QA-B336): named or relational speaker, "threatened that", past-tense intent, me/self targets.
  ["threat received", String.raw`(?<![a-z])` + SPEAKER + String.raw`\s+` + FRAME + String.raw`\s+(?:that\s+)?` + SUBJ + MODAL + String.raw`\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + ME + String.raw`\b`],
  ["threat received", String.raw`\b` + SUBJ + MODAL + String.raw`\s+(?:really\s+)?` + H_VERB + String.raw`\s+(?:me|us)\s+(?:if|unless|when|so)\b`],
  ["reported intent to harm self", String.raw`(?<![a-z])` + SPEAKER + String.raw`\s+` + FRAME + String.raw`\s+(?:that\s+)?` + SUBJ + MODAL + String.raw`\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + REFL + String.raw`\b`],
  ["reported intent to harm a person", String.raw`(?<![a-z])` + SPEAKER + String.raw`\s+` + FRAME + String.raw`\s+(?:that\s+)?` + SUBJ + MODAL + String.raw`\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + WHO_OR_YOU + String.raw`\b`],
  ["reported intent to harm a person", String.raw`\b` + SUBJ + String.raw`(?:'re|'s|\s+(?:are|is|was|were))?\s+(?:planning|plans|planned|plan|intend(?:s|ed|ing)?|want(?:s|ed|ing)?)\s+(?:to|on)\s+(?:really\s+)?` + H_VERB + String.raw`(?:ing)?\s+` + WHO_OR_YOU + String.raw`\b`],
  ["reported intent to harm self", String.raw`\b(?:you|he|she|they)(?:'re|'s|\s+(?:are|is|was|were))?\s+(?:planning|plans|planned|plan|intend(?:s|ed|ing)?|want(?:s|ed|ing)?|going\s+to|gonna)\s+(?:to\s+|on\s+)?(?:hurt|harm|kill|hit|stab|shoot|strangle|choke)(?:ing)?\s+` + REFL + String.raw`\b`],
  // "confessed to wanting to hurt me", "admitted to planning to kill her"
  ["threat received", String.raw`(?<![a-z])` + SPEAKER + String.raw`\s+` + FRAME + String.raw`\s+(?:to\s+)?(?:wanting|planning|intending|going)\s+to\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + ME + String.raw`\b`],
  ["reported intent to harm a person", String.raw`(?<![a-z])` + SPEAKER + String.raw`\s+` + FRAME + String.raw`\s+(?:to\s+)?(?:wanting|planning|intending)\s+to\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + WHO_OR_YOU + String.raw`\b`],
  // first person: gerund after "plan on", and the wider relation list
  ["intent to harm a person", String.raw`\b(?:i|we)\s*(?:(?:am|are|'m|'re)\s+)?(?:plan(?:ning)?\s+on|intend(?:ing)?\s+on)\s+(?:really\s+)?(?:killing|murdering|hurting|harming|hitting|beating|punching|slapping|stabbing|shooting|strangling|choking)\s+` + WHO + String.raw`\b`],
  // QA-B336 round 3, changed strategy: the reporting frame is incidental. Whatever introduces the clause
  // ("messaged me saying", "heard that", nothing at all), a person-subject + intent verb + harm verb + person
  // target is the stop. Frameless rules use explicit intent verbs only, so "my mom will kill me" stays through.
  ["threat received", FL_CLAUSE + ME + String.raw`\b`],
  ["reported intent to harm self", FL_CLAUSE + REFL + String.raw`\b`],
  ["reported intent to harm a person", FL_CLAUSE + WHO_OR_YOU + String.raw`\b`],
  // round 4: "has been planning to", "wishes she could", "intends to have someone beat me up", "wants me dead", "his plan is to"
  ["threat received", FL_PREFIX + HAVE_DONE + WHO_OR_YOU + String.raw`\s+` + H_VERB + String.raw`\s+` + ME + String.raw`\b`],
  ["threat received", FL_PREFIX + HAVE_DONE + String.raw`(?:me|us)\s+` + DONE_VERB + String.raw`\b`],
  ["reported intent to harm a person", FL_PREFIX + HAVE_DONE + WHO_OR_YOU + String.raw`\s+` + DONE_VERB + String.raw`\b`],
  ["reported intent to harm a person", FL_PREFIX + HAVE_DONE + WHO_OR_YOU + String.raw`\s+` + H_VERB + String.raw`\s+` + WHO_OR_YOU + String.raw`\b`],
  ["threat received", String.raw`(?<![a-z])` + FL_SUBJ + String.raw`(?:'s|\s+(?:has|have|had))?\s+(?:want(?:s|ed)?|wish(?:es|ed)?)\s+(?:me|us|my\s+\w+)\s+(?:to\s+be\s+)?` + DEAD_END],
  ["reported intent to harm a person", String.raw`(?<![a-z])` + FL_SUBJ + String.raw`(?:'s|\s+(?:has|have|had))?\s+(?:want(?:s|ed)?|wish(?:es|ed)?)\s+` + WHO + String.raw`\s+(?:to\s+be\s+)?` + DEAD_END],
  ["threat received", String.raw`\b(?:his|her|their|my|the)\s+(?:plan|intention|idea|goal)\s+(?:is|was)\s+to\s+` + H_VERB + String.raw`\s+` + ME + String.raw`\b`],
  ["reported intent to harm a person", String.raw`\b(?:his|her|their|my|the)\s+(?:plan|intention|idea|goal)\s+(?:is|was)\s+to\s+` + H_VERB + String.raw`\s+` + WHO_OR_YOU + String.raw`\b`],
  ["threat received", String.raw`(?<![a-z])` + FRAME2 + String.raw`\s+` + SUBJ + MODAL + String.raw`\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + ME + String.raw`\b`],
  ["reported intent to harm self", String.raw`(?<![a-z])` + FRAME2 + String.raw`\s+` + SUBJ + MODAL + String.raw`\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + REFL + String.raw`\b`],
  ["reported intent to harm a person", String.raw`(?<![a-z])` + FRAME2 + String.raw`\s+` + SUBJ + MODAL + String.raw`\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + WHO_OR_YOU + String.raw`\b`],
];
const INTENT_PATTERNS = compile(INTENT_RE);
// A named person (capitalised, so case-sensitive), minus words that are capitalised but are not people.
const NOT_A_NAME = String.raw`(?!(?:Send|Reply|Enter|Save|Delete|Submit|Cancel|Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)(?:day)?\b|(?:January|February|March|April|May|June|July|August|September|October|November|December)\b)`;
const NAMED_PERSON = new RegExp(String.raw`\b[Ii]\s*(?:(?:am|are|'m|'re)\s+)?(?:going\s+to|gonna|want\s+to|plan\s+to|planning\s+to|intend\s+to|will|'ll)\s+(?:really\s+)?` + H_VERB + String.raw`\s+` + NOT_A_NAME + String.raw`[A-Z][a-z]+\b` + IDIOM_TAIL);


// QA-B336 round 5, structural (not an enumerated phrase list). A sentence stops when it holds (1) a
// wish/plan/intent/goal/threat cue, then (2) within a short span after it a harm event whose target is a person:
// an active harm verb + person, "have/get <person> <harmed>", "<person> dead", "for me to be harmed", "that I be killed".
// Non-person objects (time, lights, a movie, a record, chances) and idiom tails (with laughter, in the game,
// me an email, up) never count. Only adds stops.
const CUE_RE = /\b(?:intentions?|intend(?:s|ed|ing)?|intent\s+on|plan(?:s|ned|ning)?|goals?|means?\s+to|meant\s+to|wish(?:es|ed)?|want(?:s|ed|ing)?|resolved|decided|determined|vowed|swore|announced|threaten(?:s|ed|ing)?|threats?|aims?|hop(?:es|ed|ing)\s+to|dream(?:s|ed)?\s+of|make\s+(?:sure|certain)|see\s+to\s+it|ensure)\b/gi;
const SC_TAIL = String.raw`(?!\s+(?:back|later|(?:a|an|another|the)\s+(?:text|call|line|message|note|email|e-mail|dm|ring|buzz|photo|picture|video|link|reminder)|at\s+(?:chess|cards|poker|golf|tennis|checkers|monopoly|scrabble|trivia|bowling|darts|pool|cricket|football|soccer|basketball|the\s+game|it|this|that)|with\s+(?:a\s+)?(?:pillow|joke|question|text|call|plan|idea|news|surprise|cake|coffee|laughter|kindness|boredom)|in\s+(?:the\s+|a\s+)?(?:game|video\s*game|fictional|story|movie|film|show|book|play|novel)|by\s+(?:laughter|boredom)))`;
const SC_TAILX = String.raw`(?!` + POSSESSED + String.raw`|['’]s\b|\s+(?:` + DITRANS + String.raw`|` + IN_IDIOM + String.raw`|into\s+shape\b|to\s+(?:the\s+)?(?:station|stop|store|shop|party|meeting|office|gym)\b))` + SC_TAIL;
const SC_REL2 = String.raw`(?:` + WHO_REL + String.raw`|manager|supervisor|landlord|landlady|employer|principal|coach|pastor|doctor|nurse|classmate|enemy|enemies|rival|stepmother|stepfather|sibling|siblings|parents?)`;
const SC_OBJ2 = String.raw`(?:me|us|him|her|them|someone|somebody|anyone|(?:my|our|his|her|their|your|the)\s+` + SC_REL2 + String.raw`)`;
const SC_HV = String.raw`(?:kill(?:ing)?|murder(?:ing)?|hurt(?:ing)?|harm(?:ing)?|hit(?:ting)?(?!\s+(?:[\w']+\s+){1,2}up\b)|beat(?:ing)?(?:\s+up)?|punch(?:ing)?|slap(?:ping)?|stab(?:bing)?|shoot(?:ing)?|strangl(?:e|ing)|chok(?:e|ing)|attack(?:ing)?|assault(?:ing)?)`;
const SC_PP = String.raw`(?:killed|murdered|hurt|harmed|beaten(?:\s+up)?|shot|stabbed|strangled|choked|hit|attacked|assaulted)`;
const PP_TAIL = String.raw`(?!\s+(?:(?:with|in|by)\s+(?:laughter|boredom|kindness|(?:the\s+|a\s+)?(?:fictional|video\s*game|game|story|movie|film|joke))|at\s+(?:chess|cards|poker|golf|tennis|checkers|monopoly|scrabble|trivia|bowling|darts|pool|cricket|football|soccer|basketball|the\s+game|it|this|that)))`;
const PASSIVE = String.raw`(?:(?:would|will|should|could|might)\s+be\s+|to\s+be\s+|be\s+)?`;
const SC_OBJ3 = String.raw`(?:` + SC_OBJ2 + String.raw`|whoever|everyone|everybody)`;
const SC_HARM_RES = [
  new RegExp(String.raw`\b` + SC_HV + String.raw`\s+(?:` + SC_OBJ3 + String.raw`|` + REFL + String.raw`)\b(?!\s+(?:feelings?|chances|pride|back|neck|knees?|ankles?|legs?|arms?|shoulders?|feet|foot|heads?|hands?|wrists?|eyes?))` + SC_TAILX, "i"),
  new RegExp(String.raw`\b(?:have|having|get|getting|see|seeing)\s+` + SC_OBJ3 + String.raw`\s+` + PASSIVE + SC_PP + String.raw`\b` + PP_TAIL, "i"),
  new RegExp(String.raw`\b` + SC_OBJ3 + String.raw`\s+` + PASSIVE + String.raw`(?:` + SC_PP + String.raw`\b` + PP_TAIL + String.raw`|` + DEAD_END + String.raw`)`, "i"),
  new RegExp(String.raw`\b(?:whoever|anyone\s+who|everyone\s+who)\s+(?:[\w']+\s+){1,3}?(?:would|will|should|could|might|must)\s+be\s+` + SC_PP + String.raw`\b` + PP_TAIL, "i"),
  new RegExp(String.raw`\b(?:i|we)\s+(?:to\s+)?be\s+` + SC_PP + String.raw`\b` + PP_TAIL, "i"),
];
// Named targets are capitalised, so these are case-sensitive; verbs are lowercase.
const NAMED = NOT_A_NAME + String.raw`[A-Z][a-z]+`;
const SC_HV_LC = SC_HV.replace(/\(\?!/g, "(?!");
const SC_NAMED_RES = [
  new RegExp(String.raw`\b` + SC_HV_LC + String.raw`\s+` + NAMED + String.raw`(?!(?:'s|’s|s)?\s+(?:chances|feelings?|pride|reputation|career|prospects|odds|score|record|mood|day|plans?|grades?|image|business|case)\b)\b` + SC_TAILX),
  new RegExp(String.raw`\b` + NAMED + String.raw`\s+` + PASSIVE + SC_PP + String.raw`\b` + PP_TAIL),
];

// QA-B336 round 8: the class is wish/plan/intent + any way of hurting a person, not a verb list.
// Wider harm verbs (poison, smash, push down stairs, make X suffer), harm to a body part of a person,
// "get hit" forms, "were dead" with a qualifier. Person targets only; idiom tails stay through.
const H2_TAIL = String.raw`(?!` + POSSESSED + String.raw`|['’]s\b|\s+(?:against\b|` + IN_IDIOM + String.raw`|into\s+shape\b|out|off\b|a\s|an\s|some\b|to\s+the\s+curb|from\b|for\b|back\b|with\s+(?:a|the)\b|in\s+the\s+(?:game|group|chat)))`;
const H2_VERB = String.raw`(?:smash(?:ing)?|bash(?:ing)?|kick(?:ing)?|stomp(?:ing)?|trampl(?:e|ing)|poison(?:ing)?|drown(?:ing)?|suffocat(?:e|ing)|smother(?:ing)?|tortur(?:e|ing)|burn(?:ing)?|injur(?:e|ing)|wound(?:ing)?|maim(?:ing)?|cripple|crippling|lynch(?:ing)?|behead(?:ing)?|decapitat(?:e|ing)|massacr(?:e|ing)|slaughter(?:ing)?|run(?:ning)?\s+over|run\s+down|ruin\s+physically)`;
const POSS_REL = String.raw`(?:(?:my|our|his|her|their|your|the)\s+(?:` + WHO_REL + String.raw`|manager|supervisor|landlord|boss|coach|enemy|rival|stepmother|stepfather)|[A-Z][a-z]+)(?:'s|’s|s)?`;
const BODY = String.raw`(?:face|head|skull|teeth|nose|jaw|ribs|neck|legs?|arms?|fingers|hands?|bones|knees|kneecaps)`;
const SC_HARM_R8 = [
  new RegExp(String.raw`\b` + H2_VERB + String.raw`\s+(?:(?:` + SC_OBJ3 + String.raw`)|(?:` + SC_OBJ3 + String.raw`|the\s+\w+)\s+and\s+(?:` + SC_OBJ3 + String.raw`))\b` + H2_TAIL, "i"),
  new RegExp(String.raw`\b(?:smash|bash|break|punch|kick|slam|cave|crush|bust|knock)(?:ing)?\s+(?:` + POSS_REL.replace(/\[A-Z\]\[a-z\]\+/, "\\b[A-Za-z]+") + String.raw`)\s+` + BODY + String.raw`\b`, "i"),
  new RegExp(String.raw`\b(?:push|shove|throw|toss|drag|knock|force|run)(?:ing)?\s+(?:` + SC_OBJ3 + String.raw`)\s+(?:down\s+(?:the\s+)?(?:stairs|steps|hill|cliff|well)|off\s+(?:a|the)\s+(?:cliff|bridge|roof|balcony|building|ledge|stairs|train|platform)|in\s+front\s+of\s+(?:a|the)\s+(?:car|bus|train|truck|traffic)|into\s+(?:traffic|the\s+(?:road|street|river|lake|fire|water|ocean|sea)))`, "i"),
  new RegExp(String.raw`\b(?:put|send|get)\s+(?:` + SC_OBJ3 + String.raw`)\s+(?:in|into|to)\s+(?:the\s+)?(?:hospital|grave|morgue|icu)\b`, "i"),
  new RegExp(String.raw`\bmake\s+(?:` + SC_OBJ3 + String.raw`)\s+(?:suffer|bleed|pay\s+with\s+(?:their|his|her)\s+life)\b(?!\s+(?:through|less|no\s+more|any\s*more)\b)`, "i"),
  new RegExp(String.raw`\b(?:` + SC_OBJ3 + String.raw`|he|she|they|i|we)\s+(?:to\s+)?(?:gets?|got|getting|ends?\s+up|ended\s+up)\s+(?:being\s+)?` + SC_PP + String.raw`\b` + PP_TAIL + String.raw`(?!\s+by\s+(?:the\s+)?(?:rain|wave|surprise|luck|lightning|inspiration|a\s+wave|discount|sale|bill|tax|fee|price|trend|bug|email|notification|deadline|flu|cold)\b)`, "i"),
  new RegExp(String.raw`\b` + SC_OBJ3 + String.raw`(?:\s+(?:in|at|on|from)\s+(?:that|this|the|my|our|his|her|their)\s+\w+(?:\s+\w+)?)?\s+(?:(?:was|were|is|be|being|would\s+be|will\s+be|to\s+be)\s+)?` + DEAD_END, "i"),
  new RegExp(String.raw`\b` + SC_OBJ3 + String.raw`\s+in\s+(?:that|this|the|my|our|his|her|their)\s+\w+(?:\s+\w+)?\s+(?:(?:would|will|to)\s+be\s+)?` + SC_PP + String.raw`\b` + PP_TAIL, "i"),
];
const SC_NAMED_R8 = [
  new RegExp(String.raw`\bmake\s+` + NAMED + String.raw`\s+(?:suffer|bleed)\b(?!\s+(?:through|less|no\s+more|any\s*more)\b)`),
  new RegExp(String.raw`\b` + H2_VERB + String.raw`\s+` + NAMED + String.raw`\b` + H2_TAIL),
  new RegExp(String.raw`\b(?:push|shove|throw|toss|drag|knock)(?:ing)?\s+` + NAMED + String.raw`\s+(?:down\s+(?:the\s+)?(?:stairs|steps|hill|cliff|well)|off\s+(?:a|the)\s+(?:cliff|bridge|roof|balcony|building|ledge|stairs|train|platform)|in\s+front\s+of\s+(?:a|the)\s+(?:car|bus|train|truck|traffic))`),
  new RegExp(String.raw`\b` + NAMED + String.raw`\s+(?:was|were|is|be|to\s+be|being)\s+` + DEAD_END),
  new RegExp(String.raw`\b` + NAMED + String.raw`\s+(?:to\s+)?(?:gets?|got|getting|ends?\s+up)\s+(?:being\s+)?` + SC_PP + String.raw`\b` + PP_TAIL),
];
function cueClassRisk(normal: string): RiskResult | null {
  for (const sentence of normal.split(/[.!?;\n]+/)) {
    CUE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CUE_RE.exec(sentence)) !== null) {
      if (negatedCue(sentence.slice(0, m.index))) continue;
      const rest = sentence.slice(m.index + m[0].length, m.index + m[0].length + 90);
      for (const re of [...SC_HARM_RES, ...SC_NAMED_RES, ...SC_HARM_R8, ...SC_NAMED_R8]) {
        // Every match of the row, not only the first: a governed act ("stop him from hurting the
        // kids") must not hide a later one in the same stretch ("... and then kill him").
        const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
        let h: RegExpExecArray | null;
        while ((h = g.exec(rest)) !== null) {
        if (h[0].length === 0) { g.lastIndex++; continue; }
        // Round 4: a negator between the cue and the act ("swore he would never hurt anyone") negates it.
        if (negatesAct(rest.slice(0, h.index))) continue;
        // Round 5: the same scope rules as the matrix and the frame pass (counter-verb, past relative
        // clause, hypothetical attack on the speaker).
        if (governedElsewhere(rest.slice(0, h.index), h[0], rest.slice(h.index + h[0].length))) continue;
        {
          const toMe = /\b(?:me|us|i|we)\b/i.test(h[0]) || /\b(?:me|us)\b/i.test(rest.slice(0, h.index + h[0].length));
          return toMe ? { risk: "self", reason: "threat received" } : { risk: "others", reason: "reported intent to harm a person" };
        }
        }
      }
    }
  }
  return null;
}

/** The fast floor: runs before any model call. Harm to others is checked first. */
export function keywordRisk(text: string): RiskResult {
  const floor = phraseFloorRisk(text);
  if (stops(floor)) return floor;
  // QA-B336: the compositional pass (intent frame x harm act x person), then the REOPEN row (PSY 15 Nov 2: a prevention, idiom
  // or negation shape whose class condition fails). Last, so they only add stops.
  return frameRisk(normaliseText(text)) ?? reopenRisk(text) ?? floor;
}

/** The phrase floor alone, before the compositional pass (kept so tests can prove the pass only adds). */
export function phraseFloorRisk(text: string): RiskResult {
  const normal = normaliseText(text);
  for (const [risk, patterns] of [["others", OTHERS_PATTERNS], ["self", SELF_PATTERNS]] as const) {
    for (const [reason, re] of patterns) {
      if (re.test(normal)) return { risk, reason };
    }
  }
  const IDIOM_AFTER = new RegExp("^(?:" + SC_TAIL.replace("(?!", "(?=").replace(/\)$/, ")") + "|\\s+" + DITRANS + ")", "i");
  for (const [reason, re] of INTENT_PATTERNS) {
    const m = re.exec(normal);
    if (m && !IDIOM_AFTER.test(normal.slice(m.index + m[0].length))) return { risk: reason === "threat received" || reason === "reported intent to harm self" ? "self" : "others", reason };
  }
  const cue = cueClassRisk(normal);
  if (cue) return cue;
  const matrix = matrixRisk(normal);
  if (matrix) return matrix;
  if (NAMED_PERSON.test(normal)) return { risk: "others", reason: "intent to harm a named person" };
  if (PARTNER_RISK_ACT.test(normal) && PARTNER_RISK_FEAR.test(normal)) {
    return { risk: "self", reason: "fear of harm or control from the person this concerns" };
  }
  return { ...NONE };
}

/** The original (pre-QA-B336, Python-ported) phrase floor alone: these rows stay unconditional under PSY 15 Nov ruling 2. */
export function originalFloorRisk(text: string): RiskResult {
  const normal = normaliseText(text);
  for (const [risk, patterns] of [["others", OTHERS_PATTERNS], ["self", SELF_PATTERNS]] as const) {
    for (const [reason, re] of patterns) if (re.test(normal)) return { risk, reason };
  }
  return { ...NONE };
}

export function stops(result: RiskResult): boolean {
  return result.risk !== "none";
}

/** Tolerant read of the model's risk field: unreadable is none (the floor has already run). */
export function readModelRisk(risk: unknown, reason: unknown = ""): RiskResult {
  let folded = typeof risk === "string" ? risk.trim().toLowerCase() : "none";
  if (folded === "stop" || folded === "risk" || folded === "unsafe") folded = "self";
  if (folded !== "self" && folded !== "others") return { ...NONE };
  return { risk: folded, reason: typeof reason === "string" ? reason.trim().slice(0, 200) : "" };
}

/** Either layer stops; the model can add a stop, never remove one. */
export function combinedRisk(text: string, modelRisk?: unknown, modelReason?: unknown): RiskResult {
  const floor = keywordRisk(text);
  if (stops(floor)) return floor;
  return readModelRisk(modelRisk, modelReason);
}
