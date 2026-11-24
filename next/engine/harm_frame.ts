// Law 8, QA-B336 (COO 21:15Z 14 Nov): one compositional pass instead of phrase rows.
//
//   INTENT frame  x  HARM act  x  PERSON target, inside one sentence.
//
// A frame is any way of stating intent, wish, plan, threat or resolve (first person, reported
// "he told me he will", received "she says she'll"). An act is a verb from the harm family or a
// noun from it (harm, injury, pain, violence, death, attack). A target is a person: a pronoun,
// a relation, a name, or me/us. The three may combine in five shapes (verb→target, target←past
// participle, noun→prep→target, target→noun, possessive→death noun). Negation is decided once,
// on the stretch between the frame and the act. This pass runs after the existing floor and can
// only add a stop, never remove one.

import type { RiskResult } from "./safety.ts";
import { REL, TAIL } from "./harm_matrix.ts";
import { governedElsewhere } from "./harm_scope.ts";

const alt = (xs: string[]) => `(?:${xs.join("|")})`;

// ---- PERSON target ----------------------------------------------------------------------
const DET = alt(["my", "our", "his", "her", "their", "your", "the", "that", "this", "a", "some"]);
// One open modifier slot before the relation ("my business partner", "the head nurse"); QA-B336 round 3.
const MOD = String.raw`(?:(?!(?:and|or|but|to|with|for|of|in|on|at|from|by|about|the|a|an|my|our|his|her|their|your|its|this|that|no|not|never|very|so|too)\b)[a-z][a-z-]*\s+)?`;
const QUAL = String.raw`(?:(?:new|old|little|young|elder|older|younger|big|whole|own|former|late|current|future|dear|beloved|ex-?|step|\w+-in-law)\s*)?` + MOD;
const PRON = alt(["him", "her", "them", "someone", "somebody", "anyone", "anybody", "everyone", "everybody", "whoever"]);
const ME = alt(["me", "us", "myself"]);
const GROUP = alt(["neighbou?rs['’]?\\s+kids?", "people", "kids", "children"]);
// More people than the phrase floor names; the act and frame still have to be there.
const MORE = alt(["referee", "ref", "umpire", "driver", "waiter", "waitress", "cashier", "clerk", "bartender", "bouncer", "courier",
  "postman", "mailman", "priest", "imam", "rabbi", "nanny", "babysitter", "tenant", "soldier", "pilot", "child", "toddler", "infant",
  "teen", "teenager", "fianc[eé]e?", "spouse", "lover", "crush", "date", "twin", "nephew", "niece", "stepbrother", "stepsister",
  "half-brother", "half-sister", "grandson", "granddaughter", "grandchild", "therapist", "counsell?or", "dentist", "surgeon", "tutor",
  "mentor", "pupil", "ceo", "director", "mate", "mates", "buddy", "pal", "dude", "bloke", "lad", "lady", "men", "women", "people",
  "kids", "children", "family", "players?", "opponents?", "classmates?", "team-?mates?", "bosses", "parents", "in-laws", "husband|wife"]);
// QA-B336 round 4: an open role noun. People in a sentence are mostly named by role, and no list holds
// every role ("the union steward", "the shift lead", "the tow truck operator"). A role head is an
// agent-noun form (-er, -or, -ist, -ant, -ent, -ian, -ee, -ive, -man, -woman, -person, -ess) or one of a
// few short role words, after a determiner and at most two modifiers. Common thing-nouns of the same
// shapes are excluded, so "kill the printer", "beat the timer", "attack the corner" stay through.
const NOT_ROLE = alt(["computer", "printer", "paper", "water", "number", "letter", "order", "border", "corner", "dinner", "power",
  "tower", "poster", "folder", "timer", "router", "server", "monitor", "motor", "door", "floor", "mirror", "colou?r", "error", "sensor",
  "elevator", "tractor", "generator", "radiator", "calculator", "refrigerator", "freezer", "heater", "cooler", "blender", "toaster",
  "speaker", "controller", "charger", "player", "trailer", "chapter", "matter", "weather", "summer", "winter", "river", "silver",
  "butter", "flower", "finger", "shoulder", "liver", "bladder", "ladder", "hammer", "rubber", "sweater", "remote", "container", "banner",
  "cancer", "fever", "anger", "hunger", "danger", "pressure", "future", "picture", "furniture", "nature", "culture", "venture", "theater",
  "theatre", "center", "centre", "meter", "liter", "filter", "cluster", "layer", "buffer", "cursor", "processor", "reactor", "factor",
  "sector", "vector", "project", "plant", "event", "moment", "document", "content", "comment", "argument", "element", "equipment",
  "environment", "statement", "payment", "apartment", "department", "tournament", "instrument", "experiment", "government", "parliament",
  "restaurant", "agreement", "movement", "management", "assignment", "appointment", "investment", "treatment", "advertisement", "basement",
  "pavement", "segment", "fragment", "garment", "sentiment", "talent", "percent", "accident", "incident", "patent", "tent",
  "list", "playlist", "checklist", "twist", "wrist", "mist", "fist", "archive", "drive", "incentive", "initiative", "objective", "motive",
  "alternative", "perspective", "narrative", "exclusive", "plan", "fan", "van", "pan", "can", "scan", "span", "tan", "ban", "bran",
  "address", "process", "access", "success", "business", "progress", "dress", "mess", "stress", "press", "chess", "guess", "fitness",
  "illness", "darkness", "weakness", "wilderness", "mattress", "fortress", "inbox", "committee", "coffee", "toffee",
  "jubilee", "guarantee", "fee", "tee", "knee", "flea", "tree", "spree", "decree", "degree", "lawn", "dawn", "plane", "one",
  // adverbs, conjunctions, comparatives and adjectives of the same endings
  "after", "later", "never", "ever", "over", "under", "together", "either", "neither", "rather", "whether", "other", "another", "further",
  "forever", "however", "whatever", "whoever", "whenever", "wherever", "moreover", "wonder", "sooner", "faster", "better", "harder",
  "longer", "closer", "earlier", "louder", "quicker", "slower", "higher", "lower", "bigger", "smaller", "stronger", "weaker", "deeper",
  "wider", "farther", "easier", "tougher", "different", "recent", "current", "present", "silent", "urgent", "important", "constant",
  "distant", "instant", "pleasant", "apparent", "relevant", "frequent", "decent", "absent", "violent", "brilliant", "elegant",
  "massive", "positive", "negative", "active", "passive", "expensive", "aggressive", "defensive", "offensive", "major", "minor",
  "interior", "exterior", "favou?r", "labou?r", "honou?r", "humou?r", "flavou?r", "rumou?r", "terror", "horror", "behaviou?r",
  "unless", "regardless", "nevertheless", "less", "bless", "free", "three", "agree", "glee", "exist", "assist", "insist", "resist", "persist"]);
const ROLE_WORD = alt(["lead", "leads", "chief", "chiefs", "guard", "guards", "steward", "stewards", "marshal", "marshals", "captain",
  "captains", "chef", "chefs", "cook", "cooks", "host", "hostess", "guest", "guests", "staff", "crew", "member", "members", "rep", "reps",
  "aide", "aides", "agent", "agents", "official", "officials", "pastor", "nurse", "medic", "medics", "maid", "nun", "monk", "king",
  "queen", "prince", "princess", "pope", "bishop", "vicar", "sheriff", "deputy", "pilot", "cadet", "intern", "interns", "temp", "nanny",
  "groom", "bride", "kid", "kids", "teen", "teens", "youth", "adult", "adults", "elder", "elders", "patient", "patients", "resident",
  "residents", "tenant", "tenants", "pupil", "pupils", "scout", "scouts", "porter", "janitor", "foreman", "boss", "bosses", "head",
  "heads", "clerk", "clerks", "mate", "mates", "cop", "cops", "vet", "doc", "ref"]);
const ROLE_HEAD = String.raw`(?:` + ROLE_WORD + String.raw`|(?!` + NOT_ROLE + String.raw`s?\b)[a-z]{2,}(?:er|or|ist|ant|ent|ian|ee|ive|man|woman|person|ess)s?)`;
const ROLE_MOD = String.raw`(?:(?!(?:and|or|but|to|with|for|of|in|on|at|from|by|about|the|a|an|my|our|his|her|their|your|its|this|that|no|not|never|very|so|too|is|was|be|been|will|would|left|badly|up|down|out|off|back|over|again|later|after|before|today|tonight|tomorrow|now|then|there|here|home|hard|first|soon|once|twice|right|all|some|any|just|really|also|even|when|if|until|while|because|as|than|like|into|onto|upon|through|across|around|behind|between|during|inside|outside|past|since|toward|towards|under|via|within|without|already|yet|still|every|each)\b)[a-z][a-z-]*\s+)`;
const OPEN_ROLE = String.raw`(?:the|my|our|his|her|their|your|that|this|a)\s+` + ROLE_MOD + String.raw`{0,2}(?:[a-z]+['’]s\s+` + ROLE_MOD + String.raw`?)?` + ROLE_HEAD + String.raw`(?![a-z'’-])`;
const PERSON = String.raw`(?:` + REL + "|" + MORE + String.raw`s?)`;
const RELN = String.raw`(?:` + DET + String.raw`\s+` + QUAL + String.raw`(?:\w+['’]s\s+)?` + PERSON + String.raw`|the\s+(?:guy|man|woman|girl|boy|kid|person|people|one|ones)\s+(?:who|that|from|next\s+door)\b[^,]{0,40}?)`;
const TARGET = String.raw`(?:` + ME + "|" + PRON + "|namex|" + RELN + "|" + OPEN_ROLE + "|" + GROUP + String.raw`)`;
// The closed lexicon alone, for acts that also have a game or idiom sense ("beat the defender to the ball",
// "hit the dealer for a card", "the striker is shot into the first team"): an open role noun is not enough there.
const TARGET_CLOSED = String.raw`(?:` + ME + "|" + PRON + "|namex|" + RELN + "|" + GROUP + String.raw`)`;
const AMBIG_V = String.raw`(?:hit|hits|hitting|beat|beats|beating|strike|strikes|striking|struck|kick|kicks|kicked|kicking|shoot|shoots|shooting|burn|burns|burned|burning|hang|hangs|hanging|attack|attacks|attacked|attacking|bash|bashes|bashed|bashing|knife|knifing|execute|executes|executing|punch|punches|punched|punching)`;
const AMBIG_PP = String.raw`(?:shot|hit|struck|beaten|beat|kicked|burn(?:ed|t)|attacked|executed|bashed|punched|battered)`;
const INTENSE = String.raw`(?:badly|severely|brutally|viciously|seriously|savagely|violently)`;
const POSS = String.raw`(?:my|our|his|her|their|your|namex['’]s|` + DET + String.raw`\s+` + QUAL + PERSON + String.raw`['’]s)`;

// ---- HARM act ---------------------------------------------------------------------------
const VERB = alt([
  "kill\\w*", "murder\\w*", "hurt(?:s|ing)?", "harm(?:s|ed|ing)?", "injur(?:e|es|ed|ing)", "wound(?:s|ed|ing)?", "maim\\w*",
  "cripple\\w*", "stab(?:s|bed|bing)?", "shoot(?:s|ing)?", "strangl\\w*", "chok(?:e|es|ed|ing)", "smother\\w*", "suffocat\\w*",
  "poison\\w*", "drown\\w*", "tortur\\w*", "punch(?:es|ed|ing)?", "slap(?:s|ped|ping)?", "kick(?:s|ed|ing)?", "stomp\\w*",
  "whip(?:s|ped|ping)?", "beat(?:s|ing)?", "batter\\w*", "bash(?:es|ed|ing)?", "pummel\\w*", "thrash\\w*", "assault\\w*",
  "attack(?:s|ed|ing)?", "hit(?:s|ting)?", "strik(?:e|es|ing)", "struck", "rap(?:e|es|ed|ing)", "burn(?:s|ed|ing)?", "knife|knifing",
  "execut(?:e|es|ing)", "hang(?:s|ing)?",
  // round 6: acts that need no instrument word and only ever take a living target
  "scald(?:s|ed|ing)?", "blind(?:s|ed|ing)?", "electrocut\\w*", "drug(?:s|ged|ging)?", "chloroform\\w*", "mutilat\\w*", "disfigur\\w*",
  "dismember\\w*", "behead\\w*", "decapitat\\w*", "lynch\\w*", "bludgeon\\w*", "maul(?:s|ed|ing)?", "trampl\\w*", "impal\\w*",
  "starv(?:e|es|ed|ing)", "immolat\\w*", "rough(?:s|ed|ing)?\\s+up",
]);
// Between the verb and the target: adverbs and the particles that keep the harm sense.
const VGAP = String.raw`(?:\s+(?:up|down|badly|really|seriously|severely|brutally|senseless|to\s+death))?`;
// After a past participle the harm still reads as harm unless these follow.
const PP = alt([
  "hurt", "harmed", "injured", "killed", "murdered", "dead", "beaten(?:\\s+up)?", "beat\\s+up", "attacked", "assaulted", "stabbed",
  "shot", "strangled", "choked", "poisoned", "drowned", "tortured", "maimed", "crippled", "wounded", "raped", "punched", "kicked",
  "slapped", "hit(?!\\s+up)", "struck", "burn(?:ed|t)", "run\\s+(?:over|down)", "hospitali[sz]ed", "battered", "bashed", "smothered", "executed",
  "roughed\\s+up", "worked\\s+over", "blinded", "scalded", "drugged", "electrocuted", "mutilated", "disfigured", "set\\s+on\\s+fire",
]);
const PP_TAIL = String.raw`(?!\s+(?:by\s+(?:the|this|that|what|it|his|her|their|my|your)\s+(?!car|truck|bus|train|knife|gun)\w+|if\b|when\b|that\b|because\b|to\s+(?:hear|see|learn|know|find|read)|at\s+(?:work|school|practice|football|soccer|training|the\s+game)|on\s+(?:the\s+)?(?:field|pitch|court|job)|playing|in\s+(?:the\s+|a\s+)?(?:game|match|race|story|movie|film|show|book|play|novel|scene|accident|crash)|out\b|with\s+(?:a\s+)?(?:fine|cold|flu|bill|ticket)|about\b|feelings))`;
const AUX = String.raw`(?:\s+(?:to|be|been|being|get|gets|got|getting|end|ends|ended|up|will|would|should|must|might|could|can|is|are|was|were|gonna|going|so|really|badly|seriously|severely|finally|properly|just|all|permanently|actually|very|terribly))`;
const NOUN = alt(["harm", "injur(?:y|ies)", "pain", "violence", "damage", "suffering", "an?\\s+injury", "wounds?", "(?:physical\\s+|brute\\s+|deadly\\s+|lethal\\s+|excessive\\s+)?force"]);
const DEATH = alt(["death", "murder", "killing", "demise", "execution", "assassination", "destruction"]);
const ATTACK = alt(["an?\\s+attack", "an?\\s+assault", "violence", "harm", "injury", "pain", "revenge\\s+attack", "an?\\s+beating"]);
// How a harm noun reaches its target in the passive or with a light verb: "violence should be done to",
// "an assault carried out against", "harm visited upon", "pain will come to", "a beating handed out to".
const CARRY = String.raw`(?:(?:(?:to|should|must|will|would|could|might|shall|can|is\s+to|are\s+to|is|are|was|were|be|been|being|get|gets|got)\s+)*(?:done|used|applied|directed|aimed|turned|carried\s+out|inflicted|committed|made|visited|brought(?:\s+down)?|launched|handed\s+out|dealt(?:\s+out)?|dished\s+out|delivered|unleashed|meted\s+out|rained(?:\s+down)?|wreaked|perpetrated|directed|come|coming|comes)\s+)`;
const BODY = alt(["face", "head", "skull", "teeth", "nose", "jaw", "ribs?", "neck", "throat", "legs?", "arms?", "fingers?", "hands?", "bones?", "knees?", "kneecaps?", "spine", "wrists?", "ankles?", "eyes?", "body", "windpipe"]);
const WEAPON = alt(["hammer", "bat", "baseball\\s+bat", "knife", "axe", "crowbar", "gun", "pistol", "rifle", "pipe", "wrench", "machete", "club", "chain", "brick", "blade", "razor", "screwdriver", "tire\\s+iron"]);
const NADJ = String.raw`(?:(?:serious|physical|bodily|real|great|severe|grievous|lasting|permanent|some|actual|violent|terrible|real)\s+)*`;
const END = alt([
  "dead", "in\\s+(?:a|the)\\s+(?:hospital|grave|coma|wheelchair|morgue|body\\s+bag|icu|ground|er|emergency\\s+room)(?:\\s+bed)?", "under\\s+the\\s+ground", "in\\s+(?:a|his|her|their)\\s+coffin", "six\\s+feet\\s+under", "bleeding",
  "in\\s+pieces", "in\\s+(?:\\w+\\s+)?(?:pain|agony)",
  // round 4: a hurt body as the result ("leave X badly hurt", "with a broken jaw", "with serious injuries")
  "(?:badly\\s+|seriously\\s+|severely\\s+|critically\\s+|permanently\\s+|gravely\\s+|brutally\\s+)?(?:hurt|injured|wounded|maimed|crippled|disfigured|paraly[sz]ed|bloodied|bleeding|unconscious|killed|stabbed)(?![a-z])(?!\\s+(?:by\\s+(?:the\\s+)?(?:news|words|comments?|joke|remark|rejection|loss|breakup)|feelings|in\\s+(?:the|a)\\s+(?:game|story|movie|film|show|book|play|novel)))",
  "(?:(?:badly|severely|brutally|viciously|seriously|savagely|violently)\\s+(?:beaten|shot|burn(?:ed|t)|kicked|attacked|battered)|beaten\\s+up)(?![a-z])(?!\\s+(?:by\\s+(?:the\\s+)?(?:news|words|comments?|joke|remark|rejection|loss|breakup)|feelings|in\\s+(?:the|a)\\s+(?:game|story|movie|film|show|book|play|novel)))",
  "with\\s+(?:an?\\s+)?(?:\\w+\\s+)?(?:broken|shattered|fractured|cracked|smashed|bloody|bleeding)\\s+(?:\\w+\\s+)?" + BODY,
  "with\\s+(?:\\w+\\s+)?(?:injuries|wounds|burns|bruises|fractures|stab\\s+wounds|broken\\s+bones)",
  // round 6: a lost capacity as the result ("leave the coach unable to walk", "leave him blind")
  "(?:unable|too\\s+weak|too\\s+broken|too\\s+hurt)\\s+to\\s+(?:walk|stand|see|breathe|move|crawl)", "(?:permanently\\s+)?blind(?:ed)?(?![a-z-])(?!\\s+(?:date|spot|eye|faith|trust|side|copy|test|tasting|man['’]s))",
  "bleed(?:ing)?", "suffer(?:s|ed|ing)?(?!\\s+(?:less|anymore|any\\s+more|no\\s+more|through|from|with))(?:\\s+(?:serious|physical|bodily|real|great|severe|lasting)?\\s*(?:harm|injury|pain|damage))?",
]);

// ---- MEANS: harm by a hazard (QA-B336 round 6) ----------------------------------------------
// No list of harm verbs holds every way to hurt a person. Most of the rest put a person in contact with a
// hazard: a corrosive or scalding substance, a drug in their drink, a height, deep water, fire, cold, a
// moving vehicle, an animal. These rows compose an everyday contact verb ("push", "lock", "drive",
// "slip") x a person x a hazard, so no row needs the act word to be a harm word.
const SUBST = alt(["(?:battery\\s+|hydrochloric\\s+|sulfuric\\s+|sulphuric\\s+)?acid", "bleach", "lye", "drain\\s+cleaner", "ammonia",
  "(?:toxic\\s+)?chemicals", "(?:boiling|scalding|burning|red-hot|searing|hot)\\s+(?:water|oil|coffee|tea|grease|wax|tar|soup|fat)", "petrol",
  "gasoline", "kerosene", "lighter\\s+fluid", "paint\\s+thinner", "pepper\\s+spray", "mace", "(?:rat\\s+)?poison", "antifreeze"]);
const SUBST_Q = String.raw`(?:(?:some|a\s+(?:bottle|cup|pot|bucket|kettle|jar|can|pan|mug)\s+of|the)\s+)?`;
const LETHAL = alt(["(?:rat\\s+)?poison", "antifreeze", "bleach", "cyanide", "arsenic", "ground\\s+glass", "drain\\s+cleaner"]);
const DOSE = alt(["(?:rat\\s+)?poison", "antifreeze", "bleach", "drugs", "(?:sleeping\\s+)?pills", "roofies", "rohypnol", "sedatives?",
  "tranquili[sz]ers?", "laxatives", "something", "ground\\s+glass", "cyanide", "arsenic", "a\\s+(?:sedative|drug|pill|roofie|tranquili[sz]er)"]);
const DRINK = alt(["drinks?", "coffee", "tea", "food", "wine", "beer", "water", "meal", "dinner", "lunch", "soup", "juice", "smoothie",
  "cocktail", "bottle", "glass", "cup", "medicine", "medication", "pills", "inhaler", "insulin"]);
// A place a person cannot be put without harm.
const INTO = alt(["(?:the\\s+|a\\s+)?(?:oncoming\\s+|rush-hour\\s+|heavy\\s+|moving\\s+)?traffic", "(?:the|a)\\s+(?:icy\\s+|freezing\\s+|frozen\\s+|deep\\s+)?(?:river|canal|well|pit|ravine|quarry|furnace|oven|freezer|walk-in\\s+freezer|incinerator|wood\\s*chipper|fire|bonfire|flames|sea|ocean|rapids)",
  "(?:the|a)\\s+(?:car\\s+)?trunk", "the\\s+boot\\s+of\\s+(?:a|the|my|his|her|their|our)\\s+car", "(?:icy|freezing|boiling)\\s+water", "(?:the\\s+)?(?:train\\s+|subway\\s+|railway\\s+)?tracks"]);
const FRONT = String.raw`in\s+front\s+of\s+(?:a|an|the|that)\s+(?:oncoming\s+|moving\s+|speeding\s+|passing\s+)?(?:bus|train|truck|lorry|car|tram|subway|van|semi)`;
const OFF = String.raw`off\s+(?:a|the|that|this|our|his|her|my)\s+(?:\w+\s+)?(?:cliff|bridge|balcony|roof|ledge|building|overpass|platform|tower|pier|top\s+floor|rooftop|edge)`;
const DOWNH = String.raw`down\s+(?:a|the|that)\s+(?:stairs|stairwell|staircase|well|cliff|elevator\s+shaft|mine\s+shaft|shaft|ravine)`;
const OUT_IN = String.raw`out\s+in\s+the\s+(?:snow|cold|freezing\s+cold|freezing|heat|blizzard|storm|desert)`;
const CONTACT = alt(["push(?:es|ed|ing)?", "shov(?:e|es|ed|ing)", "throw(?:s|n|ing)?", "threw", "toss(?:es|ed|ing)?", "chuck(?:s|ed|ing)?",
  "drop(?:s|ped|ping)?", "dump(?:s|ed|ing)?", "kick(?:s|ed|ing)?", "knock(?:s|ed|ing)?", "drag(?:s|ged|ging)?", "pull(?:s|ed|ing)?",
  "lock(?:s|ed|ing)?", "shut(?:s|ting)?", "trap(?:s|ped|ping)?", "tie(?:s|d)?", "tying", "chain(?:s|ed|ing)?", "leav(?:e|es|ing)", "left",
  "hold(?:s|ing)?", "held", "forc(?:e|es|ed|ing)", "put(?:s|ting)?", "stick(?:s|ing)?", "stuck", "send(?:s|ing)?", "sent", "seal(?:s|ed|ing)?",
  "strand(?:s|ed|ing)?", "abandon(?:s|ed|ing)?", "lower(?:s|ed|ing)?", "dangl(?:e|es|ed|ing)"]);
const HAZARD_PLACE = String.raw`(?:(?:into|in|under|onto)\s+` + INTO + "|" + FRONT + "|" + OFF + "|" + DOWNH + "|" + OUT_IN + String.raw`)`;
const ANIMAL = alt(["dogs?", "pit\\s*bulls?", "rottweilers?", "dobermans?", "german\\s+shepherds?", "mastiffs?", "hounds?", "wolf", "wolves", "snakes?", "bees", "hornets", "wasps", "bull"]);
const VEHICLE = alt(["car", "truck", "van", "suv", "jeep", "bus", "lorry", "motorbike", "motorcycle", "bike", "vehicle", "tractor", "pickup", "forklift", "scooter", "cab", "taxi", "semi"]);
// A vehicle is driven into things far more often than people ("the barrier", "the garage door opener"), so the
// open role noun is not enough here: the closed person lexicon, or the people a road or a crowd holds.
const VTARGET = String.raw`(?:` + TARGET_CLOSED + String.raw`|(?:the|a|that|those|these|some)\s+(?:\w+\s+)?(?:crowds?|line\s+of\s+people|pedestrians?|marchers|parade|bus\s+stop|playground|schoolyard|joggers?|runners?|walkers?|cyclists?|bikers?|riders?|protesters?|protestors?|demonstrators?|shoppers?|officers?|cops?|police(?:man|woman|men|women)?|students?|workers?|crossing\s+guard|kids?|children|people|families|tourists?|fans|worshippers|mourners|picketers|strikers|hitchhikers?|motorcyclists?|scooter\s+riders?|delivery\s+(?:guy|driver|rider)))`;
const HOTTOOL = String.raw`(?:(?:a|an|the|my|his|her)\s+)?(?:blowtorch|lighter|hot\s+iron|curling\s+iron|clothes\s+iron|branding\s+iron|soldering\s+iron|cigarettes?|cigars?|taser|stun\s+gun|cattle\s+prod|hot\s+poker|poker|fire)`;
// Losing a capacity is the harm: "make sure he never walks again", "can never see again".
const CAP = alt(["walk", "walks", "stand", "stands", "see", "sees", "breathe", "breathes", "move", "moves", "wake\\s+up", "wakes\\s+up",
  "use\\s+(?:his|her|their|my|your)\\s+(?:legs|arms|hands)", "uses\\s+(?:his|her|their)\\s+(?:legs|arms|hands)"]);
const SUBJ = String.raw`(?:he|she|they|you|i|we|namex|` + TARGET_CLOSED + String.raw`)`;

const MEANS: [string, RegExp][] = [
  // a person put into, under, off or in front of a hazard: "shove him in front of a train", "lock her in the freezer"
  ["act", new RegExp(String.raw`\b` + CONTACT + String.raw`\s+` + TARGET + String.raw`\s+(?:(?:straight|right|headfirst|head-first|back|out|all\s+the\s+way)\s+)?(?:(?:\w+\s+){0,3}?)` + HAZARD_PLACE + String.raw`\b`, "i")],
  // held under water: "hold her under", "hold his head under the water"
  ["act", new RegExp(String.raw`\b(?:hold(?:s|ing)?|held|push(?:es|ed|ing)?|keep(?:s|ing)?|kept|dunk(?:s|ed|ing)?)\s+(?:` + TARGET + "|" + POSS + String.raw`\s+(?:head|face))\s+under(?:\s+(?:the\s+)?water)?(?!\s+(?:the\s+)?(?:covers|blankets?|umbrella|tree|table|bed|arm|wing|control))\b`, "i")],
  // a corrosive or scalding substance thrown at a person or a body part: "splash acid in my face"
  ["act", new RegExp(String.raw`\b(?:throw\w*|threw|pour\w*|spray\w*|splash\w*|squirt\w*|dump\w*|tip\w*|fling\w*|flung|rub\w*|inject\w*|flick\w*|drip\w*|dous\w*)\s+` + SUBST_Q + SUBST + String.raw`\s+(?:on|at|over|onto|into|in|across)\s+(?:` + POSS + String.raw`\s+(?:\w+\s+)?` + BODY + "|" + TARGET + String.raw`)\b`, "i")],
  // a person treated with a substance or a hot tool: "scald the sitter with hot oil", "burn him with cigarettes"
  ["act", new RegExp(String.raw`\b(?:scald\w*|burn(?:s|ed|ing)?|blind(?:s|ed|ing)?|dous\w*|drench\w*|spray\w*|soak\w*|attack\w*|splash\w*|disfigur\w*|scar(?:s|red|ring)?|brand(?:s|ed|ing)?|hit(?:s|ting)?|shock(?:s|ed|ing)?|zap\w*|tortur\w*)\s+` + TARGET + String.raw`\s+(?:with|in|using)\s+` + SUBST_Q + String.raw`(?:` + SUBST + "|" + HOTTOOL + String.raw`)\b`, "i")],
  // an animal set on a person: "set the dogs on him", "let my rottweiler loose on the courier", "sic my brothers on her"
  ["act", new RegExp(String.raw`\b(?:set(?:s|ting)?|sic(?:s|ced|cing)?|sick(?:s|ed|ing)?|let(?:s|ting)?|turn(?:s|ed|ing)?|unleash\w*|releas\w*|send(?:s|ing)?|sent)\s+(?:(?:the|my|our|his|her|their|a|an|that|this|those|these)\s+)?(?:\w+\s+){0,2}?` + ANIMAL + String.raw`(?:\s+loose)?\s+(?:on|onto|at|after)\s+` + TARGET + String.raw`\b`, "i")],
  ["act", new RegExp(String.raw`\b(?:sic(?:s|ced|cing)?)\s+(?:\w+\s+){1,3}?(?:on|onto)\s+` + TARGET + String.raw`\b`, "i")],
  ["act", new RegExp(String.raw`\bfeed(?:s|ing)?\s+` + TARGET + String.raw`\s+to\s+(?:the|my|his|her|our|some)\s+(?:dogs|sharks|pigs|crocodiles|alligators|gators|lions|wolves|fish)\b`, "i")],
  // a vehicle driven at a person: "ram my car into her boyfriend", "plough into the crowd", "drive the van at them"
  ["act", new RegExp(String.raw`\b(?:(?:drive|drives|driving|drove|driven|steer\w*|crash\w*|aim\w*|smash\w*|run|runs|running|ran|speed\w*|accelerat\w*|ram|rams|rammed|ramming|plough\w*|plow\w*|slam\w*|swerv\w*)\s+(?:the|my|our|his|her|their|a|an|this|that)\s+(?:\w+\s+)?` + VEHICLE + String.raw`|ram|rams|rammed|ramming|plough\w*|plow\w*|swerv\w*|mow\w*)(?:\s+(?:straight|right|directly|head-on|full\s+speed|on\s+purpose|deliberately))?\s+(?:into|at|toward|towards|through|over)\s+` + VTARGET + String.raw`\b`, "i")],
  // dragged or tied to a moving thing: "drag him down the road", "tie her to the back of the truck"
  ["act", new RegExp(String.raw`\bdrag(?:s|ged|ging)?\s+` + TARGET + String.raw`\s+(?:behind|along\s+(?:the\s+)?(?:road|street|ground|gravel|highway|tracks)|down\s+(?:the|a)\s+(?:road|street|highway|gravel|stairs)|across\s+(?:the|a)\s+(?:road|street|gravel|ground|parking\s+lot|concrete)|through\s+the\s+(?:streets|gravel|mud|woods|glass))\b`, "i")],
  ["act", new RegExp(String.raw`\b(?:tie(?:s|d)?|tying|chain(?:s|ed|ing)?|strap(?:s|ped|ping)?)\s+` + TARGET + String.raw`\s+(?:up\s+)?to\s+(?:the\s+(?:back|bumper)\s+of\s+)?(?:a|the|my|his|her|our|their)\s+(?:\w+\s+)?(?:car|truck|horse|tracks|train\s+tracks|railway|bumper|tow\s+hitch|motorbike|bike|tractor)\b`, "i")],
  // something put in a person's drink or food: "slip something into her drink", "lace his tea with poison"
  ["act", new RegExp(String.raw`\b(?:slip\w*|put(?:s|ting)?|drop(?:s|ped|ping)?|mix\w*|stir\w*|sprinkl\w*|crush\w*|add(?:s|ed|ing)?|pour\w*|tip\w*|sneak\w*|snuck)\s+(?:(?:some|a\s+few|a\s+little|a\s+bit\s+of)\s+)?(?:` + DOSE + String.raw`\s+(?:in|into)\s+(?!(?:my|our)\s+(?:\w+\s+)?` + DRINK + String.raw`\b)|` + LETHAL + String.raw`\s+(?:in|into)\s+)` + POSS + String.raw`\s+(?:\w+\s+)?` + DRINK + String.raw`\b`, "i")],
  ["act", new RegExp(String.raw`\b(?:spik(?:e|es|ed|ing)|lac(?:e|es|ed|ing)|dos(?:e|es|ed|ing)|poison\w*|doctor\w*|tamper\w*\s+with|contaminat\w*)\s+` + POSS + String.raw`\s+(?:\w+\s+)?` + DRINK + String.raw`\s+with\s+` + DOSE + String.raw`\b`, "i")],
  ["act", new RegExp(String.raw`\b(?:spik(?:e|es|ed|ing)|dos(?:e|es|ed|ing)|poison\w*|contaminat\w*)\s+(?!(?:my|our)\s)` + POSS + String.raw`\s+(?:\w+\s+)?` + DRINK + String.raw`\b`, "i")],
  // fire on a person, or alive: "set me on fire", "burn them alive"
  ["act", new RegExp(String.raw`\b(?:set(?:s|ting)?|light(?:s|ing)?|lit)\s+` + TARGET + String.raw`\s+(?:on\s+fire|alight|ablaze|aflame)\b`, "i")],
  ["act", new RegExp(String.raw`\b(?:burn\w*|bur(?:y|ies|ied|ying)|boil\w*|skin\w*|cook\w*|eat\w*|ate)\s+` + TARGET + String.raw`\s+alive\b`, "i")],
  // a capacity lost for good: "he never walks again", "she can never see again", "so he won't be able to stand"
  ["loss", new RegExp(String.raw`\b` + SUBJ + String.raw`(?:\s*['’](?:ll|d))?(?:\s+(?:to|will|can|could|would|shall|should|might))?\s+(?:never|not\s+ever|n['’]t\s+ever|no\s+longer)\s+(?:(?:be|is|are)\s+able\s+to\s+)?(?:` + CAP + String.raw`)(?:\s+(?:properly|right|straight|normally|on\s+(?:his|her|their|my)\s+own))?\s+again\b`, "i")],
  ["loss", new RegExp(String.raw`\b` + SUBJ + String.raw`(?:\s*['’](?:ll|d|s|re))?(?:\s+(?:to|will|would|is|are|be|ends?\s+up))*\s+(?:(?:can['’]?t|cannot|won['’]t\s+be\s+able\s+to|(?:never|not)\s+(?:be\s+)?able\s+to)\s+(?:ever\s+)?(?:` + CAP + String.raw`)\s+again|(?:unable|too\s+weak|too\s+broken|too\s+hurt)\s+to\s+(?:` + CAP + String.raw`|cry|scream|lift|crawl|talk))\b`, "i")],
];

// The five shapes. Each names where the act sits so negation can be scoped to it.
const SHAPES: [string, RegExp][] = [
  // 1. verb → target: "hurt my stepdad", "beat up my cousin", "attack him with a knife"
  ["act", new RegExp(String.raw`\b` + VERB + VGAP + String.raw`\s+` + TARGET_CLOSED + String.raw`\b` + TAIL, "i")],
  ["act", new RegExp(String.raw`\b(?!` + AMBIG_V + String.raw`\b)` + VERB + VGAP + String.raw`\s+` + OPEN_ROLE + String.raw`\b` + TAIL, "i")],
  // 1b. particle verbs whose particle comes after the target and keeps the harm sense (round 5):
  //     "beat him up", "rough her up", "run him over", "mow them down", "knock him out". The plain
  //     act row cannot take these: its tail drops a target followed by "up" ("hit him up" = contact).
  ["act", new RegExp(String.raw`\b(?:(?:beat|beats|beating|rough|roughs|roughing|roughed)\s+` + TARGET + String.raw`\s+up|(?:run|runs|running|ran)\s+` + TARGET + String.raw`\s+(?:over|down)|(?:mow|mows|mowing|gun|guns|gunning)\s+` + TARGET + String.raw`\s+down|(?:knock|knocks|knocking)\s+` + TARGET + String.raw`\s+(?:out|unconscious|senseless)|(?:work|works|working|worked)\s+` + TARGET + String.raw`\s+over)\b`, "i")],
  // 1c. a corrosive or burning substance thrown at a person (round 5): "throw acid on her".
  ["act", new RegExp(String.raw`\b(?:throw|throws|throwing|threw|pour|pours|pouring|poured|spray|sprays|spraying|sprayed|splash|splashes|splashing|splashed)\s+(?:some\s+)?(?:acid|bleach|lye|boiling\s+(?:water|oil)|petrol|gasoline|gas|lighter\s+fluid)\s+(?:on|at|over|onto|in\s+the\s+face\s+of)\s+` + TARGET + String.raw`\b`, "i")],
  // 2. target ← participle: "my ex to get hurt", "my sister must be hurt", "my coworker gets badly hurt"
  ["passive", new RegExp(String.raw`\b` + TARGET_CLOSED + AUX + String.raw`{0,4}\s+` + PP + String.raw`\b` + PP_TAIL, "i")],
  ["passive", new RegExp(String.raw`\b` + OPEN_ROLE + AUX + String.raw`{0,4}\s+(?:(?!` + AMBIG_PP + String.raw`\b)` + PP + String.raw`|(?:beaten|beat)\s+up|` + INTENSE + String.raw`\s+` + AMBIG_PP + String.raw`)\b` + PP_TAIL, "i")],
  // a causative has no game sense: "have the head chef attacked", "get the courier beaten" (not hit/shot/struck: blackjack, photo)
  ["passive", new RegExp(String.raw`\b(?:have|has|had|having|get|gets|got|getting)\s+` + OPEN_ROLE + String.raw`\s+(?:` + INTENSE + String.raw`\s+)?(?:beaten|attacked|kicked|punched|executed|bashed|battered|burn(?:ed|t))\b` + PP_TAIL, "i")],
  // 3. noun → prep → target: "harm to my mother", "violence against me", "the death of my partner", "pain on the man"
  ["noun", new RegExp(String.raw`\b` + NADJ + String.raw`(?:` + NOUN + "|" + DEATH + "|" + ATTACK + String.raw`)\s+(?:` + CARRY + String.raw`?(?:to|on|upon|against|toward|towards|of)|(?:(?:to|be|been|being|is|are|was|were|should|must|will|would|could|might|get|gets|got)\s+)*(?:directed|aimed|turned)\s+at|befall(?:s|ing)?)\s+` + TARGET + String.raw`\b` + TAIL, "i")],
  // 4. target → noun: "cause my brother an injury", "do his father bodily harm", "means us harm"
  ["ditrans", new RegExp(String.raw`\b(?:caus\w*|do|does|did|doing|done|inflict\w*|mean|means|meant|wish\w*|bring\w*|give|gives|giving)\s+` + TARGET + String.raw`\s+(?:an?\s+)?` + NADJ + NOUN + String.raw`\b`, "i")],
  // 4b. bare noun as the object of a causative frame: "cause serious harm", "inflict pain"
  ["ditrans", new RegExp(String.raw`\b(?:caus\w*|inflict\w*|do|does|did|doing|wreak\w*)\s+(?:an?\s+)?` + NADJ + NOUN + String.raw`\s+(?:to|on|upon)\s+` + TARGET + String.raw`\b`, "i")],
  // 5. possessive → death noun: "his purpose was my sister's death", "plan my father's death"
  ["death", new RegExp(String.raw`\b` + POSS + String.raw`\s+(?:own\s+)?` + DEATH + String.raw`\b(?!\s*[- ]?(?:scene|costume|mask|metal|row|valley|anniversary|certificate|notice|was|in\s+the\s+(?:book|film|movie|show|story)))`, "i")],
  // 1b. verbs that only ever take a living target: "injure the referee", "murder the landlord's son"
  ["act", new RegExp(String.raw`\b(?:injur(?:e|es|ing)|murder(?:s|ing)?|strangl(?:e|es|ing)|maim(?:s|ing)?|assault(?:s|ing)?|rap(?:e|es|ing)|stab(?:s|bing)?\s+(?:and\s+kill\s+)?|wound(?:s|ing)?)\s+(?:` + DET + String.raw`\s+)(?!(?:at|in|on|to|for|with|from|and|or|of|by)\b)(?!(?:` + "song|track|tune|karaoke|beat|lyrics|joke|mood|vibe|time|ball|chances?|reputation|feelings?|pride|ego|budget|deal|plan|idea|record|steak|meat|potato|turkey|cake|pie|bread|vegetables|data" + String.raw`)\b)[a-z]+\b` + TAIL, "i")],
  // 5b. a body part of a person: "break my landlord's arm", "smash his face in"
  ["act", new RegExp(String.raw`\b(?:break\w*|broke|snap\w*|smash\w*|crack\w*|crush\w*|slit\w*|slash\w*|cut(?:s|ting)?|stab\w*|punch\w*|kick\w*|bust\w*|knock\w*|gouge\w*|stomp\w*|burn\w*|hit(?:s|ting)?|strik\w*|shatter\w*|twist\w*)\s+(?:in\s+|out\s+)?(?:every\s+bone\s+in\s+)?` + POSS + String.raw`\s+(?:\w+\s+)?` + BODY + String.raw`\b`, "i")],
  // 5c. a weapon brought to a person: "take a hammer to my boss", "come at me with a knife"
  ["act", new RegExp(String.raw`\b(?:tak\w*|took|bring\w*|brought|go\w*|went|com\w*|came)\s+(?:a|an|the|my|his|her|their)\s+(?:\w+\s+)?` + WEAPON + String.raw`\s+(?:to|at)\s+` + TARGET + String.raw`\b` + TAIL, "i")],
  ["act", new RegExp(String.raw`\b(?:go\w*|went|com\w*|came|run\w*|ran)\s+(?:at|after)\s+` + TARGET + String.raw`\s+with\s+(?:a|an|the|my|his|her|their)\s+(?:\w+\s+)?` + WEAPON + String.raw`\b`, "i")],
  // 5d. fire with a person inside: "burn my car with me in it", "torch the house while they sleep"
  ["act", new RegExp(String.raw`\b(?:burn\w*|torch\w*|set\w*\s+fire\s+to|blow\w*\s+up)\s+(?:down\s+)?(?:\w+\s+){0,2}(?:house|home|car|flat|apartment|room|building|place|truck|tent|caravan|trailer)\s+(?:down\s+)?(?:with|while)\s+` + TARGET + String.raw`\b`, "i")],
  // 6. target → end state: "I want my boss dead", "see me in a hospital bed"
  ["end", new RegExp(String.raw`\b` + TARGET + String.raw`\s+(?:to\s+)?(?:(?:be|get)\s+)?(?:(?:left|lying|laid|ending\s+up|ends?\s+up)\s+)?` + END + String.raw`\b`, "i")],
  // 6b. a subject clause in the harmed state: "won't stop until he is hurt", "hopes she gets killed",
  //     "won't rest until I'm dead" (round 4, engine's own find). Strong frames only, like the passive.
  ["clause", new RegExp(String.raw`\b(?:he|she|they|you|i|we)\s*(?:['’](?:s|m|re)|\s+(?:is|am|are|was|were|gets?|got|ends?\s+up|winds?\s+up|lies|lie))\s+(?:(?:badly|seriously|severely|finally|really|properly)\s+)?(?:` + PP + String.raw`\b` + PP_TAIL + String.raw`|dead\b)`, "i")],
  // 7. left with harm: "leave my roommate with a serious injury", "the umpire to be left with injuries"
  ["ditrans", new RegExp(String.raw`\b(?:leav(?:e|es|ing)|left)\s+` + TARGET + String.raw`\s+with\s+(?:an?\s+)?` + NADJ + NOUN + String.raw`\b`, "i")],
  ["ditrans", new RegExp(String.raw`\b` + TARGET + AUX + String.raw`{0,4}\s+left\s+with\s+(?:an?\s+)?` + NADJ + NOUN + String.raw`\b`, "i")],
  // 8. come to harm: "for her husband to come to serious harm"
  ["ditrans", new RegExp(String.raw`\b` + TARGET + AUX + String.raw`{0,4}\s+(?:come|comes|came|coming)\s+to\s+` + NADJ + NOUN + String.raw`\b`, "i")],
];

// ---- INTENT frame -----------------------------------------------------------------------
// Volitional frames: someone wants, plans, decides or threatens. These license every shape.
const WILL = alt([
  "want(?:s|ed|ing)?", "wish(?:es|ed|ing)?", "hop(?:e|es|ed|ing)", "plan(?:s|ned|ning)?", "plot(?:s|ted|ting)?", "intend(?:s|ed|ing)?",
  "intentions?", "intent\\s+on", "goals?", "aims?", "aim(?:ed|ing)", "purpose", "objective", "mission", "desires?", "desired?",
  "decided?", "decision", "determined", "resolved?", "set\\s+on", "bent\\s+on", "designs?\\s+on", "(?:made|make|makes|set|sets)\\s+up\\s+(?:my|his|her|their|our)\\s+mind",
  "(?:made|make|makes|set|sets)\\s+(?:my|his|her|their|our)\\s+mind(?:\\s+up)?(?:\\s+on)?", "made\\s+it\\s+clear", "make\\s+sure", "see\\s+to\\s+it",
  "ensure", "insist(?:s|ed|ing)?", "arrang\\w+", "pay(?:ing)?\\s+someone", "threat(?:s|en|ens|ened|ening)?", "swear(?:s)?", "swore", "sworn", "vow(?:s|ed)?",
  "promis(?:e|es|ed)", "means?(?=\\s+(?:to|me|us|him|her|them)\\b)", "meant\\s+to", "would\\s+love", "'d\\s+love", "love\\s+to",
  "like\\s+to\\s+see", "can'?t\\s+wait", "dream(?:s|ed)?\\s+of", "ready\\s+to", "about\\s+to", "fully\\s+intend",
  "every\\s+(?:intention|plan)", "need(?:s)?\\s+to", "must", "has\\s+to", "have\\s+to", "gotta",
  // round 4 (engine's own find): resolve stated through a negation of stopping or of choice
  "(?:won'?t|will\\s+not|can'?t|cannot|not\\s+going\\s+to)\\s+(?:stop|rest|quit|sleep|give\\s+up)\\s+until", "no\\s+(?:other\\s+)?(?:choice|option|way\\s+out)\\s+but\\s+to",
  "(?:no\\s+one|nobody|nothing)\\s+(?:can|will|could|is\\s+going\\s+to)\\s+stop\\s+me\\s+from",
]);
// Future and modal frames: someone will act. These license the agent shapes (1, 3, 4) only,
// because "my son will get hurt" is a fear or a forecast, not an intent.
const MODAL = alt(["will", "'ll", "won'?t\\s+stop\\s+until", "going\\s+to", "gonna", "'m\\s+going", "would", "'d", "shall", "next\\s+time"]);
const FRAME = new RegExp(String.raw`(?:(?<![a-z])|(?=['’]))(?:(` + WILL + String.raw`)|(` + MODAL + String.raw`))(?![a-z])`, "gi");

// ---- negation, decided once --------------------------------------------------------------
const NEG = /(?<![a-z])(?:no|not|never|nobody|none|nothing|n't|without|(?:stop|stops|stopped|stopping|quit|quits|quitting)(?=\s+\w+ing\b)|prevent\w*|protect\w*|spar(?:e|es|ed|ing)|avoid\w*|stop\w*\s+(?:\w+\s+)?from|keep\w*\s+\w+\s+(?:safe|from)|sav(?:e|es|ed|ing)\s+\w+\s+from|recover\w*|heal\w*|eas(?:e|es|ed|ing)|reliev\w*|treat\w*|soothe\w*|insur\w*|refus\w*|worr\w*|afraid|scared|fear\w*|nervous|anxious|concerned|pretend\w*|in\s+(?:the|a|my|his|her)\s+(?:game|novel|story|book|film|movie|play|script|dream))(?![a-z])/i;

// What follows the act can turn it into play, fiction, figure of speech or a minor upset:
// "in the video game", "at chess", "with laughter", "dead tired", "will kill me if I'm late".
const AFTER_SOFT = new RegExp(String.raw`^(?:\s+(?:\w+\s+){0,3}?(?:in|inside|during)\s+(?:the|a|an|my|his|her|our|their|this|that)\s+(?:\w+\s+)?(?:game|games|story|stories|novel|book|film|movie|show|play|script|dream|scene|episode|series|level|match|tournament|round|debate|argument|election|race|quiz|karaoke|trivia|contest|competition|exam|test|class|league|draft|polls?|vote|sim|simulation|roleplay|role-play|campaign)\b|\s+(?:at|on|during)\s+(?:the\s+)?(?:karaoke|quiz|trivia|game|open\s+mic)(?:\s+night)?\b|\s+at\s+(?:chess|cards|poker|golf|tennis|checkers|monopoly|scrabble|trivia|bowling|darts|pool|cricket|football|soccer|basketball|mario\s+kart|fifa|the\s+game|it|this|that|\w+ing)\b|\s+(?:with|by)\s+(?:a\s+|an\s+|my\s+|his\s+|her\s+|their\s+|so\s+much\s+)?(?:jokes?|laughter|kindness|cuteness|love|compliments?|questions?|boredom|science|jargon|numbers|data|details|stats|statistics|facts|stories|sarcasm|puns?|charm|humou?r|smiles?|looks?|stares?|glares?|words|paperwork|work|homework|chores|gifts|attention|niceness|praise|hugs?|kisses)\b)`, "i");
// "dead tired", "dead set on", "dead serious": dead as an intensifier, only right after "dead".
const DEAD_SOFT = /^\s*(?:tired|asleep|on\s+(?:my|his|her|their|our)\s+feet|to\s+the\s+world|serious|set\s+on|last|cent(?:er|re)|wrong|ahead|quiet|even|broke|beat|exhausted|bored)\b/i;
// Hyperbole: "my mom will kill me when she sees the dent". The phrase floor keeps the real threats
// ("he'll kill me if I leave"); this pass does not add a stop on kill-me plus a minor condition.
const HYPERBOLE = /^(?:kill\w*|murder\w*)\s+(?:me|us)$/i;
const MINOR_AFTER = /^\s+(?:when|if|for|once|after)\b/i;

const NAME_SWAP = /\b(?!(?:Send|Reply|Enter|Save|Delete|Submit|Cancel|Honestly|Next|Our|Her|His|Their|The|My|She|He|They|We|You|It|This|That|Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)(?:day)?\b|(?:January|February|March|April|May|June|July|August|September|October|November|December)\b|I\b|I'[a-z]+\b)[A-Z][a-z]+(?=\W|$)/g;

const MAX_GAP = 140;
// Words that open a new clause between the frame and the act: the frame no longer governs it
// ("I want to know why he hurt my mom", "I want to talk about how she hit him").
const BLOCK = /(?<![a-z])(?:how|why|who|whom|which|what|where|when|whenever|after|before|since|while|because|about|whether|than|unless)(?![a-z])/i;
// Death and end-state shapes need the frame to reach them directly ("his goal is my death",
// "I want my boss dead"), so grief talk ("I want to write about my dad's death") stays through.
const DIRECT_GAP = /^(?:\s*(?:is|was|be|been|will|would|to|see|seeing|put|putting|send|sending|land|landing|leave|leaving|get|getting|make|making|watch|watching|bring\s+about|cause|causing|arrange|arranging|for|that|the|an?|nothing\s+less\s+than|simply|just|always|has|have|plan|plot|order|ordering|[=:,-]))*\s*$/i;
const NEG_PRE = /(?:(?<![a-z])(?:no|not|never)|n't)(?:\s+\w+)?\s*$/i;

export function frameRisk(normal: string): RiskResult | null {
  for (const raw of normal.split(/[.!?;\n]+/)) {
    // The first word is a subject or a sentence opener ("No one", "Nothing"), never the object: not swapped.
    const t = raw.trim();
    const sp = t.search(/\s/);
    const s = sp === -1 ? t : t.slice(0, sp) + t.slice(sp).replace(NAME_SWAP, "namex");
    if (s.length < 6) continue;
    const frames: { at: number; end: number; strong: boolean }[] = [];
    FRAME.lastIndex = 0;
    let f: RegExpExecArray | null;
    while ((f = FRAME.exec(s)) !== null) {
      frames.push({ at: f.index, end: f.index + f[0].length, strong: f[1] !== undefined });
      if (f[0].length === 0) FRAME.lastIndex++;
    }
    if (frames.length === 0) continue;
    for (const [shape, re] of [...SHAPES, ...MEANS]) {
      const g = new RegExp(re.source, "gi");
      let h: RegExpExecArray | null;
      while ((h = g.exec(s)) !== null) {
        const start = h.index, stop = h.index + h[0].length;
        const agent = shape === "act" || shape === "noun" || shape === "ditrans";
        // A lost capacity carries its own "never" / "can't"; only the frame side may negate it.
        // The nearest frame that opens before the act ends and is close enough to govern it.
        const usable = frames.filter((x) => x.at < stop && start - x.end <= MAX_GAP && (x.strong || agent));
        if (usable.length === 0) continue;
        const fr = usable[usable.length - 1];
        // "This will hit my dad hard": a thing, not a person, is the one who will act.
        if (!fr.strong && /(?:^|\s)(?:this|that|it|which|news|loss|move|change|decision|result|truth)\s*$/i.test(s.slice(0, fr.at).replace(/['’]$/, ""))) continue;
        const gap = fr.end <= start ? s.slice(fr.end, start) : "";
        if (BLOCK.test(gap) || gap.trim().split(/\s+/).length > 8) continue;
        const direct = shape === "death" || shape === "end" || shape === "clause" || shape === "loss" || (shape === "noun" && new RegExp(DEATH, "i").test(h[0]));
        if (direct && !DIRECT_GAP.test(gap.replace(/['’]s\b/g, " is"))) continue;
        // Negation once: just before the frame ("no intention of", "doesn't want to"), or anywhere
        // between the frame and the end of the act ("never hurt", "no harm to come", "protect from").
        if (NEG_PRE.test(s.slice(Math.max(0, fr.at - 16), fr.at))) continue;
        const scope = shape === "loss" ? s.slice(fr.end <= start ? fr.end : start, start) : s.slice(fr.end <= start ? fr.end : Math.max(0, start - 24), stop);
        if (NEG.test(scope)) continue;
        if (governedElsewhere(gap, h[0], s.slice(stop))) continue;
        if (AFTER_SOFT.test(s.slice(stop))) continue;
        if (/dead$/i.test(h[0]) && DEAD_SOFT.test(s.slice(stop))) continue;
        if (!fr.strong && HYPERBOLE.test(h[0].trim()) && MINOR_AFTER.test(s.slice(stop)) && !/\b(?:leave|tell|talk|go\s+to\s+the\s+police|report|call)\b/i.test(s.slice(stop))) continue;
        const toMe = /(?<![a-z])(?:me|us|myself)(?![a-z])/i.test(h[0]) || (shape === "clause" && /^(?:i|we)(?![a-z])/i.test(h[0]));
        return toMe ? { risk: "self", reason: "threat received" } : { risk: "others", reason: "intent to harm a person" };
      }
    }
  }
  return null;
}
