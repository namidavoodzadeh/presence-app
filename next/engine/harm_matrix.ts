// Law 8, QA-B336 round 9: the wish / plan / intent class as a matrix, not a phrase list.
//   a cue (any way of saying "intends, wants, plans, might, imagines, threatened, talked about")
//   x a harm event (verb stem x person target, body part, means, wish-for-death)
// in one sentence. Targets are people (pronouns, relations, names) and pets; objects never match,
// so "break the record", "cut the cake", "burn calories" stay through. Adds stops only.

import type { RiskResult } from "./safety.ts";
import { governedElsewhere, negatedCue, negatesAct } from "./harm_scope.ts";

export const REL = String.raw`(?:wife|husband|partner|girlfriend|boyfriend|ex|exes|kids?|child(?:ren)?|son|daughter|baby|mom|mum|mother|dad|father|brother|sister|boss|manager|supervisor|landlord|landlady|employer|teacher|professor|principal|coach|pastor|doctor|nurse|neighbou?rs?|coworkers?|colleagues?|classmates?|roommates?|flatmates?|friends?|enemy|enemies|rival|rivals|stepmother|stepfather|stepmom|stepdad|stepson|stepdaughter|sibling|siblings|parents?|grand(?:mother|father|ma|pa|parents?)|aunt|uncle|cousin|in-laws?|mother-in-law|father-in-law|family|guy|girl|man|woman|boy|kid|student|students|stranger|customer|client|bully|bullies|officer|cop|guard|witness(?:es)?|victim|informant|judge|lawyer|reporter|journalist|politician|senator|president|mayor|hostage|prisoner|dog|cat|puppy|kitten|pet|horse|bird)`;
// One open modifier slot before the relation ("my business partner", "the football coach", "his work
// colleague"); the relation noun itself still has to be a person (QA-B336 held-out round 3).
const MOD = String.raw`(?:(?!(?:and|or|but|to|with|for|of|in|on|at|from|by|about|the|a|an|my|our|his|her|their|your|its|this|that|no|not|never|very|so|too)\b)[a-z][a-z-]*\s+)?`;
const QUAL = String.raw`(?:(?:new|old|little|young|elder|older|younger|big|whole|entire|own|former|late|\w+ing)\s+)?` + MOD;
const PRON = String.raw`(?:him|her|them|someone|somebody|anyone|anybody|everyone|everybody|whoever|himself|herself|themselves?)`;
// NAMEX stands for a capitalised name (swapped in before matching so verbs can stay case-insensitive).
const TGT = String.raw`(?:` + PRON + String.raw`|namex|(?:my|our|his|her|their|your|the|that|this)\s+` + QUAL + REL + String.raw`)`;
const POSS = String.raw`(?:his|her|their|namex['’]?s|(?:my|our|his|her|their|your|the|that)\s+` + QUAL + REL + String.raw`['’]?s?)`;
const BODY = String.raw`(?:face|head|skull|teeth|nose|jaw|ribs?|neck|throat|legs?|arms?|fingers?|hands?|bones?|knees?|kneecaps?|back|spine|wrists?|ankles?|eyes?|ears?|windpipe)`;

// What may follow a person target without being harm: idioms, games, kindness.
export const IN_IDIOM = String.raw`in\s+(?:the\s+|a\s+)?(?:compliments|praise|paperwork|work|gifts|questions|snacks|flowers|detail|details|debt|love|baked|cookies|cakes?|chocolate|sauce|syrup|food|quiz|contest|competition|tournament|match|debate|race|election|league|exam|test|karaoke|trivia)\b`;
export const DITRANS = String.raw`(?:a|an|another)\s+(?!(?:few|couple|lot|bit|little|number|dozen|hundred)\b)`;
export const POSSESSED = String.raw`\s+(?:own\b|(?:` + REL + String.raw`)\b|(?:class|team|group|staff|crew|squad|rival|rivals)\b|[a-z]+['’]s\b)`;
export const TAIL = String.raw`(?!` + POSSESSED + String.raw`|['’]s\s+(?!(?:` + BODY + String.raw`|` + REL + String.raw`|coffee|tea|drink|drinks|food|water|meal|dinner|lunch|breakfast|soup|wine|beer|juice|cup|glass|plate|medicine|medication|pills)\b)|(?:['’]s)?\s+(?:into\s+shape\b|` + IN_IDIOM + String.raw`|against\s|through\s|to\s+(?:the\s+)?(?:station|stop|store|shop|party|meeting|office|gym|checkout|exit|elevator|lift|bathroom|toilet|kitchen|fridge|couch|seat|front)\b|for\s+(?:\w+ing|not)\b|` + DITRANS + String.raw`|some\s|back\b|later\b|up\b|off\b|out\b|some\s+slack|a\s+(?:text|call|line|message|note|email|dm|ring|photo|picture|video|link|reminder)\b|another\s+(?:text|call|message)|at\s+(?:chess|cards|poker|golf|tennis|checkers|monopoly|scrabble|trivia|bowling|darts|pool|cricket|football|soccer|basketball|the\s+game|it|this|that)\b|to\s+(?:the\s+)?(?:punch|door|chase|finish|line|top|bus|train|airport|school|work)\b|with\s+(?:a\s+)?(?:pillow|joke|jokes|question|text|call|plan|idea|news|surprise|cake|coffee|laughter|kindness|love|love\s+and\s+kindness|compliments?|politeness|boredom|stories|my\s+(?:charm|humou?r))\b|in\s+(?:the\s+|a\s+)?(?:game|video\s*game|fictional|story|movie|film|show|book|play|novel|race|election|contest|vote|debate|argument|chess|quiz|poll|league|ranking|sales|score|class|exam|test)\b|by\s+(?:laughter|boredom|a\s+(?:point|mile|lot|nose)|kindness)\b|(?:feelings?|chances|pride|reputation|career|prospects|odds|score|record|mood|day|plans?|grades?|image|business|case|ego|heart|confidence)\b))`;

const V = String.raw`(?:kill|murder|slaughter|hurt|harm|injure|wound|maim|cripple|stab|shoot|strangle|choke|suffocate|smother|poison|drown|torture|starve|punch|slap|kick|stomp|trample|whip|flog|lynch|hang|electrocute|behead|decapitate|rape|assault|attack|batter|bash|smash|pummel|thrash|clobber|club|stone|gas|burn)`;
// Verbs that are idiomatic with people unless extra material follows get their own rows below.
const ADV = String.raw`(?:(?:really|actually|definitely|finally|seriously|just|probably|literally|slowly|painfully|badly|brutally|someday|one\s+day)\s+)?`;
const ING = (v: string) => v; // verb stems below carry their own endings via \w* where safe

function stem(words: string[]): string {
  return `(?:${words.join("|")})`;
}

// Person-targeted direct verbs: stem + any inflection, then a person target.
const DIRECT_STEMS = stem([
  "kill\\w*", "murder\\w*", "slaughter\\w*", "hurt\\w*", "harm\\w*", "injur\\w*", "wound\\w*", "maim\\w*", "cripple\\w*",
  "stab\\w*", "shoot\\w*", "shot", "strangl\\w*", "chok(?:e|es|ed|ing)", "suffocat\\w*", "smother\\w*", "poison\\w*", "drown\\w*",
  "tortur\\w*", "starv\\w*", "punch\\w*", "slap\\w*", "kick\\w*", "stomp\\w*", "trampl\\w*", "whip\\w*", "flog\\w*", "lynch\\w*",
  "hang\\w*", "electrocut\\w*", "behead\\w*", "decapitat\\w*", "rap(?:e|es|ed|ing)", "assault\\w*", "attack\\w*", "batter\\w*",
  "pummel\\w*", "thrash\\w*", "clobber\\w*", "beat(?:s|ing)?(?:\\s+up)?", "beaten(?:\\s+up)?", "hit(?:s|ting)?", "burn(?:s|ed|ing|t)?(?:\\s+alive)?",
  "gas(?:s|sed|sing)?", "strik\\w*", "struck",
]);

const RE: [string, RegExp][] = [];
function add(reason: string, src: string) { RE.push([reason, new RegExp(src, "i")]); }
const NEGATED = /\b(?:no|not|never|zero|without)\b|n['’]t\b/i;

// 1. direct verb + person target (+ idiom tail). "hit" and "beat" lose "up/back/at chess" idioms via TAIL.
add("intent to harm a person", String.raw`\b` + DIRECT_STEMS + String.raw`\s+(?:down\s+)?` + TGT + String.raw`\b` + TAIL);
// 2. body part of a person
add("intent to harm a person", String.raw`\b(?:break|breaking|snap|snapping|twist|twisting|smash|smashing|bash|crack|cracking|crush|crushing|rip|ripping|tear|tearing|slit|slitting|slash|slashing|cut|cutting|stab|stabbing|punch|punching|kick|kicking|slam|slamming|bust|busting|knock|knocking|pull|pulling|gouge|gouging|puncture|stomp|stomping|burn|burning|smack|smacking|hit|hitting|shatter|shattering)\s+(?:out\s+|off\s+|in\s+)?` + POSS + String.raw`\s+(?:\w+\s+)?` + BODY + String.raw`\b`);
// 3. weapon or means on a person
add("intent to harm a person", String.raw`\bcut(?:s|ting)?\s+` + TGT + String.raw`\s+(?:with\s+(?:a|an|the|my)\s+(?:\w+\s+)?(?:knife|blade|razor|glass|scissors|axe|machete|shard|box\s*cutter)|up\b|open\b)`);
add("intent to harm a person", String.raw`\b(?:hold|holding|keep|keeping|push|pushing|shove|shoving|force|forcing|drag|dragging|pin|pinning)\s+` + TGT + String.raw`\s+(?:under\s+(?:the\s+)?water|underwater|under\s+until|down\s+until|into\s+(?:the\s+)?(?:water|fire|oven|river|lake)|face\s*down\s+in)`);
add("intent to harm a person", String.raw`\b(?:push|pushing|shove|shoving|throw|throwing|toss|tossing|drag|dragging|knock|knocking|force|forcing|run|running)\s+` + String.raw`(?:` + TGT + String.raw`|me|us)` + String.raw`\s+(?:down\s+(?:the\s+)?(?:stairs|steps|hill|cliff|well)|(?:off|from)\s+(?:a|the)\s+(?:cliff|bridge|roof|balcony|building|ledge|stairs|train|platform|boat|ship|window|tower|overpass)|in\s+front\s+of\s+(?:a|the)\s+(?:car|bus|train|truck|traffic)|into\s+(?:traffic|oncoming|the\s+(?:road|street|river|lake|fire|water|ocean|sea|path\s+of)))`);
add("intent to harm a person", String.raw`\brun(?:s|ning)?\s+` + TGT + String.raw`\s+(?:over|down)\b(?!\s+(?:to|with|for|in\s+(?:the\s+)?(?:game|race)))|\brun(?:s|ning)?\s+over\s+` + TGT + String.raw`\b(?!\s+(?:to|with|for))`);
add("intent to harm a person", String.raw`\block(?:s|ing)?\s+` + TGT + String.raw`\s+(?:in|inside|into|up\s+in|away\s+in)\s+(?:the\s+|a\s+|my\s+|his\s+|her\s+)?(?:cellar|basement|attic|closet|trunk|cage|freezer|shed|garage|room|bathroom|cupboard|dungeon|car|house)\b(?:[^.]{0,40}\b(?:starve|until|so\s+(?:he|she|they)\s+(?:can't|cannot|can\s+not)|and\s+(?:leave|let)))`);
add("intent to harm a person", String.raw`\b(?:put|putting|send|sending|get|getting|land|landing|beat|beating|hurt|hurting|leave|leaving|have|having)\s+` + TGT + String.raw`\s+(?:in|into|to)\s+(?:the\s+|a\s+)?(?:hospital|grave|morgue|icu|er|emergency\s+room|coma|a\s+coma|wheelchair|body\s+bag)\b`);
add("intent to harm a person", String.raw`\b(?:make|making|watch|watching|see|seeing|let|letting)\s+` + TGT + String.raw`\s+(?:suffer|bleed|beg\s+for\s+(?:their|his|her)\s+life|pay\s+with\s+(?:their|his|her)\s+(?:life|blood)|regret\s+being\s+born|wish\s+(?:they|he|she)\s+(?:were|was)\s+dead|cry\s+blood|choke|gasp\s+for\s+(?:air|breath))\b(?!\s+(?:through|less|no\s+more|any\s*more)\b)`);
// 4. arson against a person's home or car, or with them inside
add("intent to harm a person", String.raw`\b(?:burn|burning|torch|torching|set\s+fire\s+to|setting\s+fire\s+to|blow|blowing\s+up|blow\s+up)(?:\s+(?:down|up))?\s+` + POSS + String.raw`(?:\s+ex['’]?s?)?\s+(?:house|home|apartment|flat|car|place|room|office|shop|building|bedroom|truck)\b`);
add("intent to harm a person", String.raw`\b(?:burn|burning|torch|torching|blow\s+up|blowing\s+up)\s+(?:down\s+)?(?:the\s+)?(?:house|home|building|car|apartment|room)\s+(?:with|while)\s+` + TGT + String.raw`\b`);
// 5. wish for a person's death or suffering
add("wish that a person dies", String.raw`\b` + TGT + String.raw`\s+(?:would|will|could|should|might|to|can|must|gonna|going\s+to|was\s+to|were\s+to)\s+(?:just\s+)?(?:die|suffer|burn|rot|bleed|drop\s+dead|choke|disappear\s+forever|never\s+(?:wake\s+up|come\s+back|come\s+home)|be\s+dead)\b(?!\s+(?:peacefully|laughing|of\s+(?:laughter|embarrassment|boredom)|inside\s+a\s+little|a\s+little))`);
add("wish that a person dies", String.raw`\b(?:hope|hoped|hoping|wish|wished|pray|prayed|praying|want|wanted)\s+(?:that\s+)?` + TGT + String.raw`\s+(?:dies|die|suffers|suffer|burns|burn|rots|rot|bleeds|chokes|gets\s+(?:hurt|hit|killed|beaten))\b`);
add("wish that a person dies", String.raw`\b(?:wish|wished|wishing|hope|hoped|hoping|want|wanted|wanting|pray|prayed|praying)\s+(?:that\s+)?` + TGT + String.raw`\s+(?:was|were|is|are|be|being|got|get|gets|had)\s+(?:dead|killed|hurt|harmed|in\s+pain|gone\s+forever)\b`);
add("intent to harm a person", String.raw`\b(?:help(?:s|ed|ing)?|try(?:ing)?|trying|figure|figuring)\s+(?:to\s+|out\s+how\s+to\s+)?(?:kill|murder|poison|hurt|harm|drown|strangle|stab|shoot)\s+` + TGT + String.raw`\b`);

// 6. passive and have-done forms: "my brother should be poisoned", "have my neighbor poisoned",
//    "for the guard to be run over", "her colleague to be locked in a cellar and starved".
const PP_STRONG = String.raw`(?:killed|murdered|slaughtered|poisoned|drowned|strangled|shot|stabbed|tortured|starved|executed|hanged|hung|lynched|raped|assaulted|attacked|beaten|burn(?:ed|t)|run\s+(?:over|down)|pushed\s+(?:down|off|in\s+front|into)|thrown\s+(?:down|off|from|into|in\s+front)|locked\s+(?:up\s+)?in\s+(?:a|the|an)\s+\w+|smothered|suffocated|whipped|stoned|crippled|maimed|injured|wounded|put\s+down|made\s+to\s+suffer)`;
const PP_WEAK = String.raw`(?:hurt|harmed|hit|punched|kicked|slapped|stomped)`;
const PP_AFTER = String.raw`(?!\s+(?:by\s+(?:the|this|that|my|what|it|a)\b|if\b|when\b|that\b|because\b|to\s+(?:hear|see|learn|know|find)|at\b|out\b|up\b|with\b|in\s+(?:the\s+|a\s+)?(?:game|race|fictional|story|movie|film|show|book|play|novel|video)|about\b|so\b))`;
add("intent to harm a person", String.raw`\b` + TGT + String.raw`\s+(?:(?:would|will|should|could|might|must|shall|to|gonna|going\s+to|is\s+going\s+to|are\s+going\s+to)\s+)?(?:be|get|being|gets)\s+` + ADV + String.raw`(?:` + PP_STRONG + String.raw`\b` + PP_AFTER + String.raw`|` + PP_WEAK + String.raw`\b` + PP_AFTER + String.raw`)`);
add("intent to harm a person", String.raw`\b(?:have|having|get|getting|see|seeing|watch|watching)\s+` + TGT + String.raw`\s+(?:` + PP_STRONG + String.raw`\b` + PP_AFTER + String.raw`|` + PP_WEAK + String.raw`\b` + PP_AFTER + String.raw`)`);
add("intent to harm a person", String.raw`\b(?:want|wants|wanted|wish|wished|hope|hoped|plan|plans|planned|intend|intends|intended|aim|aims|order|ordered|decided|resolved)\s+(?:to\s+(?:have|see)\s+)?(?:for\s+)?` + TGT + String.raw`\s+(?:run\s+(?:over|down)|killed|murdered|poisoned|drowned|strangled|shot|stabbed|tortured|starved|executed|hanged|lynched|beaten|burn(?:ed|t))\b(?!\s+(?:it|the|my|his|her|their|a|an|that|this|them|him|up|out|off)\b)`);


// 7. harm as a noun, death as a goal, tools and attacks (QA-B336 round 10, pass 336).
const ME = String.raw`(?:` + TGT + String.raw`|me|us)`;
const HADJ = String.raw`(?:(?:serious|physical|bodily|real|great|severe|grievous|lasting|permanent|some)\s+)`;
const HNOUN = String.raw`(?:harm|injur(?:y|ies)|pain|violence|damage)`;
add("intent to harm a person", String.raw`\b(?:caus\w+|inflict\w*|do|does|did|doing|bring\w*|wreak\w*)\s+(?:` + ME + String.raw`\s+)?` + HADJ + String.raw`*` + HNOUN + String.raw`\b`);
add("intent to harm a person", String.raw`\b` + ME + String.raw`\s+` + HADJ + String.raw`+` + HNOUN + String.raw`\b`);
add("intent to harm a person", String.raw`(?<!\b(?:no|not|never)\s+)\b(?:harm|injury|violence|pain)\s+(?:to\s+)?(?:come|befall|befalls|coming)\s+(?:to|upon)\s+` + ME + String.raw`\b`);
add("intent to harm a person", String.raw`\b(?:violence|force)\s+(?:be\s+done|is\s+done|done|against|on|upon)\s+(?:to\s+)?` + ME + String.raw`\b`);
add("intent to harm a person", String.raw`\bsee\s+` + ME + String.raw`\s+suffer\s+` + HADJ + String.raw`*` + HNOUN + String.raw`\b`);
add("intent to harm a person", String.raw`\b(?:is|was|be|are|were)\s+(?:(?:my|our|his|her|their|your)\s+(?:own\s+)?|` + POSS + String.raw`\s+)(?:death|murder|demise|destruction)\b(?!\s*[- ]?(?:scene|costume|mask|metal|row|valley))`);
add("intent to harm a person", String.raw`\b(?:an?|the)\s+(?:attack|assault|strike)\s+(?:against|on|upon)\s+` + ME + String.raw`\b` + TAIL);
add("intent to harm a person", String.raw`\b(?:take|taking|took|go|going|come|coming)\s+(?:a|an|the|my|his|her)\s+(?:hammer|bat|baseball\s+bat|knife|axe|crowbar|gun|pipe|wrench|machete|club|chain|brick)\s+(?:to|at)\s+` + ME + String.raw`\b` + TAIL);
add("intent to harm a person", String.raw`\b(?:injur\w*|harm\w*|beat\w*|punch\w*|strik\w*|attack\w*)\s+(?:me|us)\b` + TAIL);

// Self-harm means. The cue gate is the same; these name a way of dying or hurting oneself.
const SELF_RE: [string, RegExp][] = [
  ["self-harm means", new RegExp(String.raw`\b(?:swallow|swallowing|swallowed|take|taking|took|down|downing|gulp|gulping)\s+(?:all|every|the\s+whole|a\s+whole|the\s+entire|an\s+entire|a\s+full|the\s+full)\b[^.]{0,20}?\b(?:pills|meds|medication|tablets|capsules|bottle)\b(?!\s+(?:of\s+(?:water|juice|wine)))`, "i")],
  ["self-harm means", new RegExp(String.raw`\b(?:swallow|swallowing|swallowed|take|taking|took)\s+(?:my\s+|the\s+)?(?:whole\s+|entire\s+)?bottle\s+of\s+(?:pills|meds|medication|tablets|sleeping\s+pills|painkillers)\b`, "i")],
  ["self-harm means", new RegExp(String.raw`\b(?:jump|jumping|leap|leaping|throw(?:ing)?\s+(?:myself|himself|herself|themselves))\s+(?:off|from|in\s+front\s+of|into\s+(?:the\s+)?(?:river|lake|sea|ocean|traffic))\s*(?:of\s+)?(?:a\s+|the\s+)?(?:bridge|roof|building|balcony|cliff|ledge|tower|window|train|car|bus|traffic|river|lake|sea|ocean|highway|overpass|top)\b`, "i")],
  ["self-harm means", new RegExp(String.raw`\bhang(?:s|ing)?\s+(?:myself|himself|herself|themselves)\b|\bend(?:s|ing)?\s+(?:my|his|her|their)\s+(?:own\s+)?life\b|\btake\s+(?:my|his|her|their)\s+own\s+life\b|\bslit(?:ting)?\s+(?:my|his|her|their)\s+(?:wrists?|throat)\b|\bcut(?:ting)?\s+(?:my|his|her|their)\s+(?:wrists?|throat)\b|\bdrive\s+(?:my\s+car\s+)?(?:off|into)\s+(?:a\s+|the\s+)?(?:cliff|bridge|wall|tree|river|lake)\b[^.]{0,20}\b(?:on\s+purpose|and\s+not\s+stop|to\s+die)`, "i")],
];

// Cue: any way of stating intent, wish, plan, threat, fantasy, willingness or report of one.
const CUE = new RegExp(
  String.raw`\b(?:designs?\s+on|means\s+(?:me|us|him|her|them)\s|purpose|objective|bent\s+on|(?:set|made\s+up|makes?|made)\s+(?:his|her|their|my|our)\s+mind(?:\s+up)?|desire[sd]?|mission|resolve[sd]?\s+to|is\s+determined|intentions?|intend(?:s|ed|ing)?|intent\s+on|plan(?:s|ned|ning)?|goals?|means?\s+to|meant\s+to|wish(?:es|ed)?|want(?:s|ed|ing)?|resolved|decided|determined|vowed|swore|sworn|announced|threaten(?:s|ed|ing)?|threats?|aims?|hop(?:e|es|ed|ing)(?:\s+to)?|dream(?:s|ed|ing)?\s+(?:of|about)|make\s+(?:sure|certain)|see\s+to\s+it|ensure|going\s+to|gonna|about\s+to|ready\s+to|will|won't\s+stop\s+until|'ll|'d|would|might|may|could|should|must|need(?:s|ed)?\s+to|have\s+to|has\s+to|imagin\w*|fantasi[sz]\w*|picture|picturing|think(?:s|ing)?\s+(?:about|of)|thought\s+(?:about|of)|talk(?:s|ed|ing)?\s+(?:about|of)|joke[sd]?\s+about|ways?\s+to|how\s+to|like\s+to|love\s+to|feel(?:s|ing)?\s+like|felt\s+like|urge|temptation|tempted|keep\s+\w+ing|can\s+see\s+(?:myself|him|her|them)|someday|one\s+day|if\s+(?:i|he|she|they|you|we)\s+\w+|unless|until|before\s+(?:i|he|she|they|we)|so\s+(?:that\s+)?(?:i|he|she|they)\s+can|am\s+(?:going|planning|ready)|is\s+(?:going|planning|ready)|are\s+(?:going|planning|ready)|promis\w+|warn(?:s|ed|ing)?|told\s+(?:me|us)|said\s+(?:he|she|they|i|we))\b`,
  "gi",
);

const NAME_SWAP = /\b(?!(?:Send|Reply|Enter|Save|Delete|Submit|Cancel|Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)(?:day)?\b|(?:January|February|March|April|May|June|July|August|September|October|November|December)\b|I\b|I'[a-z]+\b)[A-Z][a-z]+(?=\W|$)/g;

export function matrixRisk(normal: string): RiskResult | null {
  for (const raw of normal.split(/[.!?;\n]+/)) {
    const sentence = raw.trim();
    if (sentence.length < 6) continue;
    // Names after the first word become NAMEX; the first word is a subject or a verb, never the object.
    const first = sentence.search(/\s/);
    const head = first === -1 ? sentence : sentence.slice(0, first);
    const tail = first === -1 ? "" : sentence.slice(first).replace(NAME_SWAP, "NAMEX");
    const s = head + tail;
    CUE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CUE.exec(s)) !== null) {
      if (negatedCue(s.slice(0, m.index))) continue;
      const rest = s.slice(m.index, m.index + m[0].length + 160);
      for (const [reason, re] of RE) {
        // Round 5: every match of the row, so a governed act ("the man who hurt her") never hides a
        // later one in the same stretch ("... and kill him").
        const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
        let h: RegExpExecArray | null;
        while ((h = g.exec(rest)) !== null) {
        if (h[0].length === 0) { g.lastIndex++; continue; }
        // A negator just before the cue or the hit ("no intention of causing X harm") is not intent.
        if (NEGATED.test(s.slice(Math.max(0, m.index - 20), m.index + h.index)) && /^(?:caus|inflict|do\b|does|did|doing|bring|wreak)/i.test(h[0])) continue;
        // Round 4: a negator between the cue and the act negates that act ("he would never harm X",
        // "she will not hurt X"); a later cue in the sentence ("until I kill him") is still read on its own.
        if (h.index > m[0].length && negatesAct(rest.slice(m[0].length, h.index))) continue;
        // QA-B336 pass 351: a counter-verb, a benign participle or a compound governs the harm, not the cue.
        if (governedElsewhere(h.index > m[0].length ? rest.slice(m[0].length, h.index) : "", h[0], s.slice(m.index + h.index + h[0].length))) continue;
        const before = rest.slice(0, h.index + h[0].length);
        const toMe = /\b(?:me|us|my\s+(?:own\s+)?(?:life|body|arm|arms))\b/i.test(h[0]) && !/\bmy\s+(?:wife|husband|partner|girlfriend|boyfriend|kids?|child|son|daughter|baby|mom|mum|mother|dad|father|brother|sister|boss|manager|neighbou?r|teacher|stepfather|stepmother|coach|dog|cat)/i.test(h[0]);
        void before;
        return toMe ? { risk: "self", reason: "threat received" } : { risk: "others", reason };
        }
      }
      for (const [reason, re] of SELF_RE) {
        if (re.test(rest)) return { risk: "self", reason };
      }
    }
  }
  return null;
}
void ING; void V; void ADV;
