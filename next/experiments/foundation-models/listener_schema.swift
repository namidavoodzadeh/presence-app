// Not built or run anywhere (no ios/ or app/ target exists for it; see README.md).
// A direct translation of next/engine/talk/prompts/turn.md's JSON contract into the
// FoundationModels @Generable shape, for a future device-capable run to use verbatim.
// Field names and enum cases match the Claude-path schema exactly so the two paths'
// outputs diff without a remapping step.

import FoundationModels

@Generable
struct ListenerReply {
    @Guide(description: "One short line in the person's own terms, at most ~12 of their words copied in a row, inventing nothing. No question mark.")
    var reflection: String

    @Guide(description: "Exactly one question mark. Continues their story; never a quiz, never advice.")
    var question: String

    var move: Move
    @Guide(description: "Set only when move.kind is ask_permission; the domain being asked about.")
    var permissionDomain: Domain?
    var risk: Risk
    @Guide(description: "At most 3 proposed beliefs this turn, each backed by the person's own words.")
    var beliefs: [BeliefHypothesis]
    @Guide(description: "Two to four plain words naming the conversation so far; turns 1-3 only, else null.")
    var title: String?
    var feeling: Feeling
}

@Generable
struct Move {
    var kind: MoveKind
    @Guide(description: "Why this move, in a few words.")
    var why: String
    @Guide(description: "Which coverage gap it targets, e.g. 'close_relationships: needs and asking for them'.")
    var gap: String
}

@Generable
enum MoveKind: String {
    case follow, deepen, contrast, clarify, bridge, askPermission = "ask_permission", close
}

@Generable
struct RiskField {
    var level: RiskLevel
    var reason: String
}

@Generable
enum RiskLevel: String { case none, selfRisk = "self", others }

@Generable
enum Domain: String {
    case selfDomain = "self", closeRelationships = "close_relationships", family, work, money,
         society, politics, morality, meaning, bodyHealth = "body_health"
}

@Generable
enum BeliefType: String {
    case somethingIBelieveIsTrue = "something I believe is true"
    case aRuleILiveBy = "a rule I live by"
    case somethingIDoToCope = "something I do to cope"
    case aViewOrTaste = "a view or taste"
    case howITendToReact = "how I tend to react"
}

@Generable
enum Level: String { case l0 = "L0", l1 = "L1", l2 = "L2", l3 = "L3", l4 = "L4" }

@Generable
enum LinkType: String { case supports, under, tension }

@Generable
struct BeliefLink {
    var to: String
    var type: LinkType
}

@Generable
struct BeliefHypothesis {
    @Guide(description: "null for a new belief, or an existing belief's id when this is the same belief again.")
    var id: String?
    @Guide(description: "One to three plain words, the belief's name as the person might say it.")
    var label: String
    @Guide(description: "One gentle second-person sentence, never a copy of the receipt quote.")
    var statement: String
    var type: BeliefType
    var level: Level
    var domains: [Domain]
    @Guide(description: "0 to 1; 0.7+ only when a second receipt agrees or one receipt states it plainly.")
    var confidence: Double
    @Guide(description: "An EXACT substring of the person's latest turn, character for character.")
    var receipt: String
    var links: [BeliefLink]
}

@Generable
enum Feeling: String { case neutral, confused, sad, lonely, angry, happy, excited }
