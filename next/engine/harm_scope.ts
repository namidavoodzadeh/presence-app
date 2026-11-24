// Law 8, QA-B336 (QA pass 351, 21:39Z 14 Nov): who governs the harm.
//
// A harm phrase inside an intent frame is intent only when the frame reaches it. Three structures
// put the harm under something else, and each is decided here once, for both the matrix rows and
// the frame pass:
//   1. a counter-verb takes the harm as its object: "to prevent / stop / report / investigate /
//      avoid an assault on X", "to avoid inflicting pain on X";
//   2. a benign participle completes the harm after its target: "wants the assault on X
//      investigated", "plans for the violence against X to be discussed";
//   3. the harm noun is a modifier, not the event: "injury-prevention training", "an injury claim".
// A coordinated act still stands: "to find him and kill him" is not governed by "find".
// The verbs are a semantic class (prevent, report, study, mourn, heal), not phrases from a probe.

const COUNTER = String.raw`(?:prevent\w*|stop(?:s|ped|ping)?|end(?:s|ed|ing)?|put(?:s|ting)?\s+an\s+end\s+to|avoid\w*|reduc\w*|curb\w*|fight\w*|fought|combat\w*|oppos\w*|resist\w*|report\w*|investigat\w*|document\w*|discuss\w*|review\w*|stud(?:y|ies|ied|ying)|research\w*|analy[sz]\w*|examin\w*|understand\w*|understood|explain\w*|describ\w*|condemn\w*|denounc\w*|protest\w*|prosecut\w*|testif(?:y|ies|ied|ying)(?:\s+(?:about|to|on))?|(?:talk|speak|writ|read|learn|hear|ask|think|know|car)\w*\s+(?:about|of)|(?:wrote|spoke|thought|knew|heard|told)\s+(?:about|of)|solv\w*|mourn\w*|griev\w*|honou?r\w*|remember\w*|commemorat\w*|surviv\w*|recover\w*(?:\s+from)?|heal\w*|treat\w*|insur\w*(?:\s+against)?|rais\w*\s+awareness\s+(?:of|about)|expos\w*|uncover\w*|track\w*|measur\w*|address\w*|tackl\w*|punish\w*|ban(?:s|ned|ning)?|eliminat\w*|eradicat\w*|minimi[sz]\w*|lessen\w*|limit\w*|deter(?:s|red|ring)?|halt\w*|block\w*|outlaw\w*|escap\w*|flee\w*|fled|protect\w*\s+\w+\s+from|shield\w*\s+\w+\s+from|(?:stop|keep|prevent|save|discourage|deter|talk)\w*\s+(?:him|her|them|me|us|you|(?:my|his|her|their|our|your|the)\s+\w+)\s+(?:from|out\s+of))`;
// What may sit between the counter-verb and the harm while the harm stays its object.
const NP_FILL = String.raw`(?:\s+(?:the|a|an|any|all|more|further|future|such|this|that|these|those|his|her|their|my|our|your|its|of|about|on|into|against|from|for|every|further|new|serious|physical|bodily|violent|real|severe|sexual|domestic|gun|knife|street|workplace|online|ongoing|recent|past|possible|potential|\w+['’]s|\w+ly))*`;
const COUNTER_BEFORE = new RegExp(String.raw`(?<![a-z])` + COUNTER + NP_FILL + String.raw`\s*$`, "i");

// Participles that complete the harm noun phrase as an object of someone's report or response.
const BENIGN_PP = String.raw`(?:condemned|prosecuted|investigated|discussed|debated|reported|documented|reviewed|examined|studied|researched|analy[sz]ed|explained|described|stopped|prevented|ended|avoided|punished|recogni[sz]ed|acknowledged|addressed|looked\s+into|taken\s+seriously|heard|remembered|commemorated|understood|exposed|uncovered|solved|dropped|called\s+off|cancell?ed|filmed|recorded|written\s+(?:up|about)|mentioned|published|covered|tracked|counted|measured|banned|outlawed|forgiven|healed|treated|insured|compensated|settled|dismissed)`;
const BENIGN_AFTER = new RegExp(String.raw`^\s+(?:(?:to\s+be|be|being|been|get|got|gets|to\s+get|is|are|was|were|should\s+be|must\s+be|will\s+be)\s+)?(?:properly\s+|fully\s+|finally\s+|publicly\s+|seriously\s+)?` + BENIGN_PP + String.raw`\b`, "i");

// A harm noun used as a modifier: "injury-prevention", "harm reduction", "an injury claim".
const HARM_NOUN = /(?<![a-z])(?:harm|injur(?:y|ies)|pain|violence|damage|death|murder|demise|destruction|attacks?|assaults?|beatings?|abuse)(?![a-z])/i;
const HARM_NOUN_END = /(?:harm|injur(?:y|ies)|pain|violence|damage|death|attacks?|assaults?|abuse)\s*$/i;
const COMPOUND_AFTER = /^(?:\s*-\s*\w|\s+(?:prevention|reduction|awareness|claims?|lawyers?|attorneys?|insurance|statistics|rates?|research|training|course|class|clinic|relief|management|specialists?|survivors?|victims?|charity|hotline|scene|costume|anniversary|certificate|notice|benefits?|leave|report|reports|cases?|ward|unit)\b)/i;

const REL_BEFORE = /(?<![a-z])(?:who|that|which|whom)\s*$/i;
const PAST_ACT = /^\s*(?:\w+ed|hurt|hit|beat|shot|struck|cut|broke|threw|ran|fought|stole|stabbed|choked)(?![a-z])/i;
const HYPOTHETICAL = /(?<![a-z])(?:if|in\s+case|whenever|should)\s+(?:someone|somebody|anyone|anybody|a\s+stranger)\s+(?:ever\s+)?\w+\s+(?:me|us|myself)(?![a-z])\s*$/i;
/** True when the harm in `hit` is governed by something other than the intent frame. */
export function governedElsewhere(gap: string, hit: string, after: string): boolean {
  // 1. counter-verb right before the harm, with only its noun-phrase material between
  if (COUNTER_BEFORE.test(gap)) return true;
  // 2. a benign participle completes the harm phrase after its target
  //    (noun events only: "the assault on him investigated"; a verb act has no such completion)
  if (HARM_NOUN.test(hit) && BENIGN_AFTER.test(after)) return true;
  // 3. the harm noun is a modifier
  if (HARM_NOUN_END.test(hit) && COMPOUND_AFTER.test(after)) return true;
  // 4. round 5: a past act in a relative clause describes the noun the frame takes ("to report the
  //    man who attacked my neighbor"); the frame's verb governs that noun, not the act. A future or
  //    present act ("someone who will hurt him", "be the one who kills him") is not exempt.
  if (REL_BEFORE.test(gap) && PAST_ACT.test(hit)) return true;
  // 5. round 5: a hypothetical attack on the speaker by nobody in particular ("learn to defend myself
  //    if someone attacks me") is not a threat received; a named or known attacker still is.
  if (HYPOTHETICAL.test(`${gap} ${hit}`)) return true;
  return false;
}

// QA-B336 round 4: an intent noun or verb negated by its own determiner or adverb states the absence
// of intent: "I have no plan to injure X", "she has no wish to see X hurt", "he never intended to".
// Only "no" and "never" right before the cue (one optional adjective) count; "don't want to" is left
// stopping (an ambivalent wish keeps the conservative reading, law 8), and a later cue in the same
// sentence ("no plan to hurt him, I want him dead") is still read on its own.
const NEGATED_CUE = /(?:(?<![a-z])(?:no|never))\s+(?:(?:real|actual|such|serious|intention|interest|desire)\s+(?:of\s+|in\s+)?)?$/i;
/** True when `before` (the text just before a cue) negates that cue. */
export function negatedCue(before: string): boolean {
  return NEGATED_CUE.test(before.slice(-24));
}

// A negator between a cue and the act negates the act only inside one clause: "he would never harm X"
// yes; "I want him to not be able to walk after I beat him" no (the act opens a new clause after "after").
const NEG_WORD = /(?:(?<![a-z])(?:no|not|never|zero|without)(?![a-z])|n['’]t(?![a-z]))/gi;
const CLAUSE_OPEN = /(?:,|(?<![a-z])(?:after|before|when|whenever|once|until|till|so|because|and|but|then|if|unless|while|since|or)(?![a-z]))/i;
/** True when `gap` (cue end to act start) holds a negator that still governs the act. */
export function negatesAct(gap: string): boolean {
  let last = -1;
  NEG_WORD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NEG_WORD.exec(gap)) !== null) last = m.index + m[0].length;
  return last !== -1 && !CLAUSE_OPEN.test(gap.slice(last));
}
