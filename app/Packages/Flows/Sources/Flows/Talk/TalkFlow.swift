import Foundation

/// Talk, its suggestions, and Who sees this (packages/01/flows/talk.md).
/// One state machine: events in, effects out. Calls are effects the app performs; their answers come back as events.
public struct TalkFlow: Equatable, Sendable {

    // MARK: Types

    public enum State: Equatable, Sendable {
        case entering, declined, opening, ready, closedForAccount, listening, askingPermission, sending,
             suggesting, safetyStop, aiConsent, limited, turnFailed, scoping, keeping, markingPartly, granting,
             sessionEnded
    }

    public enum WayIn: String, Equatable, Sendable {
        case ownDownload = "own_download"
        case invitedByPartner = "invited_by_partner"
        case invitedByFriend = "invited_by_friend"
    }

    public enum MicPermission: Equatable, Sendable { case notAsked, granted, denied }

    public enum Strength: Equatable, Sendable { case very, partly }

    public enum Turn: Equatable, Sendable {
        case mine(String)
        case reply(reflection: String?, question: String?)
        case fallbackQuestion
    }

    public struct Item: Equatable, Sendable {
        public var kind: String
        public var wording: String
        public init(kind: String, wording: String) {
            self.kind = kind
            self.wording = wording
        }
    }

    public struct Person: Equatable, Sendable {
        public var id: String
        public var name: String
        public init(id: String, name: String) {
            self.id = id
            self.name = name
        }
    }

    public struct Resource: Equatable, Sendable {
        public var label: String
        public var url: String
        public init(label: String, url: String) {
            self.label = label
            self.url = url
        }
    }

    public struct Safety: Equatable, Sendable {
        public var message: String
        public var resources: [Resource]
        public init(message: String, resources: [Resource]) {
            self.message = message
            self.resources = resources
        }
    }

    public enum Scope: Equatable, Sendable {
        case everyone, partner, family, friends, coworkers
        case only(personId: String)

        /// The wire `type`.
        public var type: String {
            switch self {
            case .everyone: return "everyone"
            case .partner, .family, .friends, .coworkers: return "type"
            case .only: return "person"
            }
        }

        /// The wire `value`.
        public var value: String? {
            switch self {
            case .everyone: return nil
            case .partner: return "partner"
            case .family: return "family"
            case .friends: return "friend"
            case .coworkers: return "coworker"
            case let .only(personId): return personId
            }
        }
    }

    public enum TurnReply: Equatable, Sendable {
        case ask(conversationId: String, reflection: String?, question: String?, itemState: String?, item: Item?)
        case done(reflection: String?)
        case safety(Safety)
    }

    /// `notKept` stands for `offer_request`, `offer_i_statement` and `not_kept`.
    public enum KeepReply: Equatable, Sendable {
        case created(id: String)
        case safety(Safety)
        case notKept
    }

    public struct KeptReport: Equatable, Sendable {
        public var partlyFailed: Bool
        public var notSharedWith: [String]
        public init(partlyFailed: Bool, notSharedWith: [String]) {
            self.partlyFailed = partlyFailed
            self.notSharedWith = notSharedWith
        }
    }

    public enum Event: Equatable, Sendable {
        case entered
        case homeLoaded(cardsFrom: [String])
        case homeFailed(CallFailure)
        case turnReturned(TurnReply)
        case turnFailed(CallFailure)
        case turnLimited(opensAt: Date)
        case micTapped, permissionGranted, permissionDenied, recognitionUnsupported
        case heard(String)
        case recognizerFailed
        case wordsChanged(String)
        case sendTapped, retryTapped, opensAtPassed, consentGiven
        case safetyClosed
        case resourceTapped(Int)
        case notNowTapped, thatsMeTapped, partlyTapped
        case peopleLoaded([Person])
        case peopleFailed(CallFailure)
        case scopeWordTapped(Scope)
        case personTapped(String)
        case onlyMeTapped, doneTapped, pulledDown
        case keepReturned(KeepReply)
        case keepFailed(CallFailure)
        case partlySaved
        case partlyFailed(CallFailure)
        case grantSucceeded
        case grantFailed(CallFailure)
    }

    public struct TurnRequest: Equatable, Sendable {
        public var text: String?
        public var conversationId: String?
        public var wayIn: WayIn
        public var name: String?
        public init(text: String?, conversationId: String?, wayIn: WayIn, name: String?) {
            self.text = text
            self.conversationId = conversationId
            self.wayIn = wayIn
            self.name = name
        }
    }

    public struct ItemRequest: Equatable, Sendable {
        public var kind: String
        public var wording: String
        public var source: String
        public var scope: Scope
        public init(kind: String, wording: String, source: String, scope: Scope) {
            self.kind = kind
            self.wording = wording
            self.source = source
            self.scope = scope
        }
    }

    public enum Call: Equatable, Sendable {
        case getHome
        case talkTurn(TurnRequest)
        case getPeople
        case createItem(ItemRequest)
        case markPartly(beliefId: String)
        case share(personId: String, beliefId: String)
    }

    public enum Effect: Equatable, Sendable {
        case call(Call)
        case haptic(Haptic)
        case startListening(onDeviceOnly: Bool)
        case stopListening
        case askMicPermission
        case openInSafari(String)
        case showKept(KeptReport)
        case showNotKept
        case keepWordsOnPhone(String)
        case endSession
    }

    /// How long "Kept for you" stays under the reply.
    public static let keptShownFor: TimeInterval = 3.2

    /// Offered kinds whose protection is not built yet: no card (law 10, compliance.md).
    static let kindsWithoutCard: Set<String> = ["lands_hard", "this_week"]

    // MARK: Context

    public private(set) var state: State = .entering
    public private(set) var conversationId: String?
    public let wayIn: WayIn
    public let aboutName: String?
    public private(set) var turns: [Turn]
    public private(set) var offered: Item?
    public private(set) var text: String = ""
    public private(set) var micShown: Bool
    public private(set) var cardsFrom: [String]?
    public private(set) var safety: Safety?
    public private(set) var opensAt: Date?
    public private(set) var strength: Strength?
    public private(set) var scope: Scope?
    public private(set) var people: [Person] = []
    public private(set) var picked: [String] = []
    public private(set) var onlyMe: Bool = false
    public private(set) var notSaved: Bool = false

    /// Who sees this: the linked people, limited to one person by "Only with [Name]". "Only me" always shows.
    public var whoSeesChoices: [Person] {
        if case let .only(personId) = scope { return people.filter { $0.id == personId } }
        return people
    }

    private let aiConsentGiven: Bool
    private var micPermission: MicPermission
    private var lastTurn: TurnRequest?
    private var limitOpen = false
    private var beliefId: String?
    private var grantQueue: [Person] = []
    private var notSharedWith: [String] = []
    private var partlyDidFail = false

    public init(aiConsentGiven: Bool = true, wayIn: WayIn = .ownDownload, aboutName: String? = nil,
                conversationId: String? = nil, turns: [Turn] = [], micPermission: MicPermission = .notAsked) {
        self.aiConsentGiven = aiConsentGiven
        self.wayIn = wayIn
        self.aboutName = aboutName
        self.conversationId = conversationId
        self.turns = turns
        self.micPermission = micPermission
        self.micShown = micPermission != .denied
    }

    // MARK: Transitions

    public mutating func handle(_ event: Event) -> [Effect] {
        switch event {
        case .wordsChanged(let words):
            if state != .sessionEnded { text = words }
            return []
        case .homeLoaded(let names):
            cardsFrom = names
            return []
        case .homeFailed(let failure):
            cardsFrom = nil
            return failure.isUnauthorized ? endSession() : []
        case .recognitionUnsupported:
            micShown = false
            return []
        default:
            break
        }

        switch (state, event) {
        // Opening and talking
        case (.entering, .entered):
            if !aiConsentGiven {
                state = .declined
                return []
            }
            if conversationId == nil {
                state = .opening
                let opener = TurnRequest(text: nil, conversationId: nil, wayIn: wayIn, name: aboutName)
                lastTurn = opener
                return [.call(.getHome), .call(.talkTurn(opener))]
            }
            state = .ready
            return []

        case (.opening, .turnReturned(let reply)), (.sending, .turnReturned(let reply)):
            return turnReturned(reply)

        case (.opening, .turnFailed(let failure)):
            if failure.isUnauthorized { return endSession() }
            if failure.isNotOpen {
                state = .closedForAccount
                return []
            }
            if failure.forbiddenReason == "ai_consent_required" {
                state = .aiConsent
                return []
            }
            turns.append(.fallbackQuestion)
            lastTurn = nil
            state = .ready
            return []

        case (.ready, .micTapped):
            guard micShown else { return [] }
            switch micPermission {
            case .granted:
                state = .listening
                return [.startListening(onDeviceOnly: true)]
            case .notAsked:
                state = .askingPermission
                return [.askMicPermission]
            case .denied:
                return []
            }

        case (.askingPermission, .permissionGranted):
            micPermission = .granted
            state = .listening
            return [.startListening(onDeviceOnly: true)]

        case (.askingPermission, .permissionDenied):
            micPermission = .denied
            micShown = false
            state = .ready
            return []

        case (.listening, .heard(let words)):
            text = words
            return []

        case (.listening, .micTapped):
            state = .ready
            return [.stopListening]

        case (.listening, .recognizerFailed):
            state = .ready
            return []

        case (.ready, .sendTapped):
            return send()

        case (.suggesting, .sendTapped):
            guard hasWords else { return [] }
            offered = nil
            return send()

        case (.limited, .sendTapped):
            guard limitOpen else { return [] }
            return send()

        case (.limited, .opensAtPassed):
            limitOpen = true
            return []

        case (.sending, .turnFailed(let failure)):
            if failure.isUnauthorized { return endSession() }
            if failure.isNotOpen {
                state = .closedForAccount
            } else if failure.forbiddenReason == "ai_consent_required" {
                state = .aiConsent
            } else {
                state = .turnFailed
            }
            return []

        case (.sending, .turnLimited(let at)), (.opening, .turnLimited(let at)):
            opensAt = at
            limitOpen = false
            state = .limited
            return []

        case (.aiConsent, .consentGiven), (.turnFailed, .retryTapped):
            guard let request = lastTurn else {
                state = .ready
                return []
            }
            state = request.text == nil ? .opening : .sending
            return [.call(.talkTurn(request))]

        case (.safetyStop, .safetyClosed):
            safety = nil
            state = .ready
            return []

        case (.safetyStop, .resourceTapped(let index)):
            guard let resources = safety?.resources, resources.indices.contains(index) else { return [] }
            return [.openInSafari(resources[index].url)]

        // The suggestion and Who sees this
        case (.suggesting, .notNowTapped):
            offered = nil
            state = .ready
            return []

        case (.suggesting, .thatsMeTapped):
            return startScoping(.very)

        case (.suggesting, .partlyTapped):
            return startScoping(.partly)

        case (.scoping, .peopleLoaded(let found)):
            people = found
            return []

        case (.scoping, .peopleFailed(let failure)):
            if failure.isUnauthorized { return endSession() }
            people = []
            return []

        case (.scoping, .scopeWordTapped(let word)):
            scope = word
            let allowed = Set(whoSeesChoices.map(\.id))
            picked = picked.filter { allowed.contains($0) }
            return []

        case (.scoping, .personTapped(let id)):
            guard whoSeesChoices.contains(where: { $0.id == id }) else { return [] }
            if let at = picked.firstIndex(of: id) {
                picked.remove(at: at)
            } else {
                picked.append(id)
                onlyMe = false
            }
            return []

        case (.scoping, .onlyMeTapped):
            onlyMe.toggle()
            if onlyMe { picked = [] }
            return []

        case (.scoping, .doneTapped):
            // Nothing is pre-ticked: Done waits for a scope word (gap recorded on #15).
            guard let item = offered, let chosen = scope else { return [] }
            notSaved = false
            state = .keeping
            return [.call(.createItem(ItemRequest(kind: item.kind, wording: item.wording,
                                                  source: "talk_said", scope: chosen)))]

        case (.scoping, .pulledDown):
            resetScoping()
            state = .suggesting
            return []

        case (.keeping, .keepReturned(let reply)):
            switch reply {
            case .created(let id):
                beliefId = id
                grantQueue = picked.compactMap { id in people.first { $0.id == id } }
                notSharedWith = []
                partlyDidFail = false
                if strength == .partly {
                    state = .markingPartly
                    return [.call(.markPartly(beliefId: id))]
                }
                return nextGrantOrKept()
            case .safety(let content):
                safety = content
                offered = nil
                resetScoping()
                state = .safetyStop
                return []
            case .notKept:
                offered = nil
                resetScoping()
                state = .ready
                return [.showNotKept]
            }

        case (.keeping, .keepFailed(let failure)):
            if failure.isUnauthorized { return endSession() }
            if failure.isNotOpen {
                offered = nil
                resetScoping()
                state = .closedForAccount
                return []
            }
            notSaved = true
            state = .scoping
            return []

        case (.markingPartly, .partlySaved):
            return nextGrantOrKept()

        case (.markingPartly, .partlyFailed(let failure)):
            if failure.isUnauthorized { return endSession() }
            partlyDidFail = true
            return nextGrantOrKept()

        case (.granting, .grantSucceeded):
            grantQueue.removeFirst()
            return nextGrantOrKept()

        case (.granting, .grantFailed(let failure)):
            if failure.isUnauthorized { return endSession() }
            notSharedWith.append(grantQueue.removeFirst().name)
            return nextGrantOrKept()

        default:
            return []
        }
    }

    // MARK: Steps

    private var hasWords: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The message rises into the conversation and the turn is posted.
    private mutating func send() -> [Effect] {
        guard hasWords else { return [] }
        let words = text
        let request = TurnRequest(text: words, conversationId: conversationId, wayIn: wayIn, name: aboutName)
        turns.append(.mine(words))
        text = ""
        lastTurn = request
        state = .sending
        return [.call(.talkTurn(request))]
    }

    private mutating func turnReturned(_ reply: TurnReply) -> [Effect] {
        switch reply {
        case let .ask(id, reflection, question, itemState, item):
            conversationId = id
            turns.append(.reply(reflection: reflection, question: question))
            if itemState == "offered", let item, !Self.kindsWithoutCard.contains(item.kind) {
                offered = item
                state = .suggesting
            } else {
                offered = nil
                state = .ready
            }
        case .done(let reflection):
            turns.append(.reply(reflection: reflection, question: nil))
            conversationId = nil
            offered = nil
            state = .ready
        case .safety(let content):
            safety = content
            offered = nil
            state = .safetyStop
        }
        return []
    }

    private mutating func startScoping(_ chosen: Strength) -> [Effect] {
        resetScoping()
        strength = chosen
        state = .scoping
        return [.call(.getPeople)]
    }

    private mutating func resetScoping() {
        strength = nil
        scope = nil
        people = []
        picked = []
        onlyMe = false
        notSaved = false
    }

    /// Grants one at a time; when none are left, kept passes straight through to ready.
    private mutating func nextGrantOrKept() -> [Effect] {
        if let next = grantQueue.first, let beliefId {
            state = .granting
            return [.call(.share(personId: next.id, beliefId: beliefId))]
        }
        let report = KeptReport(partlyFailed: partlyDidFail, notSharedWith: notSharedWith)
        offered = nil
        resetScoping()
        beliefId = nil
        state = .ready
        return [.showKept(report)]
    }

    /// 401 on any call: the session ends and words not yet through stay on the phone.
    private mutating func endSession() -> [Effect] {
        var kept: [String] = []
        if state == .sending || state == .turnFailed || state == .aiConsent, let words = lastTurn?.text {
            kept.append(words)
        }
        if hasWords, !kept.contains(text) { kept.append(text) }
        state = .sessionEnded
        return kept.map { .keepWordsOnPhone($0) } + [.endSession]
    }
}
