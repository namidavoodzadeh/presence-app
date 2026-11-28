import Foundation

/// Writing in a thread, Before it goes, and sending (packages/01/flows/write-send.md).
///
/// A value-type state machine. The screen sends events; the flow answers with effects, which the app performs
/// (calls, haptics, sound). Answers to calls come back as events. Sending never depends on a model call.
public struct WriteSendFlow: Sendable {

    // MARK: Nested types

    public struct Person: Equatable, Sendable {
        public let id: String
        public let name: String
        public init(id: String, name: String) {
            self.id = id
            self.name = name
        }
    }

    public enum State: Equatable, Sendable {
        case entering
        case editing
        case reading
        case noteUp(Int)
        case refused
        case safetyStop
        case savingDraft
        case closed
        case pausing(Int)
        case final
        case sending
        case sent
        case notSent(NotSent)
        case sessionEnded
    }

    public enum NotSent: Equatable, Sendable {
        case failed
        case refused
        case notConnected
    }

    public enum TheyShared: Equatable, Sendable {
        case yes
        case no
        case unknown
    }

    /// What the notes say they are based on: copy `pause.basisNothing` or `pause.basisGeneral`.
    public enum Basis: Equatable, Sendable {
        case onlyYou
        case general
    }

    /// One highlight as the insight reply carries it.
    public struct Highlight: Equatable, Sendable {
        public let original: String
        public let suggested: String
        public let frictionKind: String?
        /// The server's `why_line` (copy `pause.noteWhy`).
        public let whyLine: String
        public init(original: String, suggested: String, frictionKind: String?, whyLine: String = "") {
            self.original = original
            self.suggested = suggested
            self.frictionKind = frictionKind
            self.whyLine = whyLine
        }
    }

    /// A highlight shown as a note. `id` is its index in the reply.
    public struct Note: Equatable, Sendable {
        public let id: Int
        public let original: String
        public let suggested: String
        public let frictionKind: String
        /// The server's `why_line`, shown on the note card (copy `pause.noteWhy`).
        public let whyLine: String
        public init(id: Int, original: String, suggested: String, frictionKind: String, whyLine: String = "") {
            self.id = id
            self.original = original
            self.suggested = suggested
            self.frictionKind = frictionKind
            self.whyLine = whyLine
        }
        /// A note whose suggestion equals the phrase (vague_ask) has no TRY and only "Keep mine".
        public var hasTry: Bool { suggested != original }
    }

    public struct FromMe: Equatable, Sendable {
        public let id: String
        public let wording: String
        public init(id: String, wording: String) {
            self.id = id
            self.wording = wording
        }
    }

    public struct Refusal: Equatable, Sendable {
        public let spans: [String]
        public let headline: String?
        public init(spans: [String], headline: String?) {
            self.spans = spans
            self.headline = headline
        }
    }

    public enum PauseCard: Equatable, Sendable {
        case note(Note)
        case fromMe(FromMe)
    }

    public enum InsightReply: Equatable, Sendable {
        case insight(highlights: [Highlight], fromMe: FromMe?)
        case risk
        case declined(spans: [String], headline: String?)
        case unavailable
    }

    public enum Event: Equatable, Sendable {
        case entered
        case draftLoaded(text: String?, replyTo: String?)
        case draftLoadFailed(CallFailure)
        case personMapLoaded
        case personMapFailed(CallFailure)
        case wordsChanged(String)
        /// The screen's 1.5 s timer with no change.
        case typingPaused
        case insightReturned(seq: Int, InsightReply)
        case insightFailed(seq: Int, CallFailure)
        case underlineTapped(noteId: Int)
        /// A swipe right or `pause.useIt`.
        case useIt
        /// A swipe left or `pause.keepMine`.
        case keepMine
        case tappedOutside
        case safetyClosed
        case leftThread
        case draftSaved
        case draftSaveFailed(CallFailure)
        case sendTapped
        case pulledDown
        /// `pause.send` on `pause.final`.
        case foldAndSendTapped
        case sendSucceeded(bridgeId: String)
        case sendFailed(CallFailure)
        case retryTapped
        case editTapped
    }

    public enum Effect: Equatable, Sendable {
        case call(Call)
        case cancelInsight
        case haptic(Haptic)
        case paperSound
        case keepWordsOnPhone(String)
        case markAskLineShown(personId: String)
        case endSession
    }

    public enum Call: Equatable, Sendable {
        case getDraft(personId: String)
        case getPersonMap(personId: String)
        case putDraft(personId: String, text: String, replyTo: String?)
        case deleteDraft(personId: String)
        case insight(InsightRequest)
        case sendBridge(BridgeRequest)
    }

    /// `POST /bridge/insight`
    public struct InsightRequest: Equatable, Sendable {
        public let personId: String
        public let text: String
        public let seq: Int
        public let withWording: Bool
        public let replyTo: String?
        public let fromMeSkip: [String]
        public init(personId: String, text: String, seq: Int, withWording: Bool, replyTo: String?, fromMeSkip: [String]) {
            self.personId = personId
            self.text = text
            self.seq = seq
            self.withWording = withWording
            self.replyTo = replyTo
            self.fromMeSkip = fromMeSkip
        }
    }

    /// `POST /bridges`
    public struct BridgeRequest: Equatable, Sendable {
        public let personId: String
        public let original: String
        public let bridged: String?
        public let final: String
        public let used: Used
        public let showOriginal: Bool
        public let headsUp: Bool
        public let deliverAt: String
        public let tz: String
        public let replyTo: String?
        public init(personId: String, original: String, bridged: String?, final: String, used: Used, showOriginal: Bool,
                    headsUp: Bool, deliverAt: String, tz: String, replyTo: String?) {
            self.personId = personId
            self.original = original
            self.bridged = bridged
            self.final = final
            self.used = used
            self.showOriginal = showOriginal
            self.headsUp = headsUp
            self.deliverAt = deliverAt
            self.tz = tz
            self.replyTo = replyTo
        }
    }

    public enum Used: String, Equatable, Sendable {
        case mine
        case edited
    }

    /// The insight call is made only from this many characters.
    public static let insightMinimumCharacters = 12

    // MARK: State and context

    public let person: Person
    public private(set) var state: State = .entering
    public private(set) var replyTo: String?
    public private(set) var text: String = ""
    public private(set) var seq: Int = 0
    public private(set) var notes: [Note] = []
    public private(set) var fromMe: FromMe?
    public private(set) var changed = false
    public private(set) var theyShared: TheyShared = .unknown
    public private(set) var fromMeSkip: [String] = []
    public private(set) var refusal: Refusal?
    /// The cards of the pause, fixed when it rises.
    public private(set) var pauseCards: [PauseCard] = []
    /// Your card in the thread while sending, not sent, or sent.
    public private(set) var sentText: String?
    /// "Helped by Kenember" under your card.
    public private(set) var helped = false

    private let aiConsentGiven: Bool
    private var askLineShown: Bool
    private let tz: String
    private var askLineThisPause = false
    private var hasTyped = false
    private var draftWasLoaded = false
    private var answered: Set<Int> = []
    private var fromMeAnswered = false
    private var riskForThisDraft = false
    private var originalBeforeUse: String?
    private var lastBody: BridgeRequest?

    public init(person: Person, replyTo: String? = nil, aiConsentGiven: Bool = true, askLineShown: Bool = false,
                tz: String = "UTC") {
        self.person = person
        self.replyTo = replyTo
        self.aiConsentGiven = aiConsentGiven
        self.askLineShown = askLineShown
        self.tz = tz
    }

    /// The words before the first note was used. With nothing used, the words as they are.
    public var original: String { originalBeforeUse ?? text }

    public var unansweredNotes: [Note] { notes.filter { !answered.contains($0.id) } }

    public var canSend: Bool {
        refusal == nil && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public var basis: Basis { theyShared == .no ? .onlyYou : .general }

    /// "You could ask [Name] how they like hard things raised." under the cards, once per person.
    public var showsAskLine: Bool { askLineThisPause && theyShared == .no }

    // MARK: Transitions

    public mutating func handle(_ event: Event) -> [Effect] {
        switch event {
        case .entered:
            guard state == .entering else { return [] }
            state = .editing
            return [.call(.getDraft(personId: person.id)), .call(.getPersonMap(personId: person.id))]

        case let .draftLoaded(draftText, draftReplyTo):
            guard let draftText, !draftText.isEmpty else { return [] }
            draftWasLoaded = true
            if !hasTyped, isWritingState {
                text = draftText
                if replyTo == nil { replyTo = draftReplyTo }
            }
            return []

        case let .draftLoadFailed(failure):
            return failure.endsSession ? endSession() : []

        case .personMapLoaded:
            theyShared = .yes
            return []

        case let .personMapFailed(failure):
            if failure.endsSession { return endSession() }
            if case .http(status: 403, _, _) = failure { theyShared = .no } else { theyShared = .unknown }
            return []

        case let .wordsChanged(newText):
            return wordsChanged(newText)

        case .typingPaused:
            guard state == .editing, aiConsentGiven, !riskForThisDraft,
                  text.count >= Self.insightMinimumCharacters else { return [] }
            state = .reading
            return [.call(.insight(InsightRequest(personId: person.id, text: text, seq: seq, withWording: true,
                                                  replyTo: replyTo, fromMeSkip: fromMeSkip)))]

        case let .insightReturned(replySeq, reply):
            guard state == .reading, replySeq == seq else { return [] }
            return insightReturned(reply)

        case let .insightFailed(replySeq, failure):
            if failure.endsSession { return endSession() }
            guard state == .reading, replySeq == seq else { return [] }
            state = .editing
            return []

        case let .underlineTapped(noteId):
            guard state == .editing, unansweredNotes.contains(where: { $0.id == noteId }) else { return [] }
            state = .noteUp(noteId)
            return [.haptic(.doubleSoftPulse)]

        case .useIt:
            switch state {
            case let .noteUp(id):
                if let note = notes.first(where: { $0.id == id }) { use(note) }
                state = .editing
                return []
            case let .pausing(index):
                guard pauseCards.indices.contains(index) else { return [] }
                switch pauseCards[index] {
                case let .note(note): use(note)
                case let .fromMe(item): add(item)
                }
                return nextCard(after: index)
            default:
                return []
            }

        case .keepMine:
            switch state {
            case let .noteUp(id):
                answered.insert(id)
                state = .editing
                return []
            case let .pausing(index):
                guard pauseCards.indices.contains(index) else { return [] }
                switch pauseCards[index] {
                case let .note(note): answered.insert(note.id)
                case let .fromMe(item): skip(item)
                }
                return nextCard(after: index)
            default:
                return []
            }

        case .tappedOutside:
            guard case .noteUp = state else { return [] }
            state = .editing
            return []

        case .safetyClosed:
            guard state == .safetyStop else { return [] }
            state = .editing
            return []

        case .leftThread:
            return leftThread()

        case .draftSaved:
            guard state == .savingDraft else { return [] }
            state = .closed
            return []

        case let .draftSaveFailed(failure):
            guard state == .savingDraft else { return [] }
            if failure.endsSession { return endSession() }
            state = .closed
            return [.keepWordsOnPhone(text)]

        case .sendTapped:
            return sendTapped()

        case .pulledDown:
            switch state {
            case .pausing, .final:
                state = .editing
                pauseCards = []
                return []
            default:
                return []
            }

        case .foldAndSendTapped:
            guard state == .final else { return [] }
            return fold()

        case .sendSucceeded:
            guard state == .sending else { return [] }
            state = .sent
            helped = changed
            return []

        case let .sendFailed(failure):
            guard state == .sending else { return [] }
            if failure.endsSession { return endSession() }
            if case let .http(status: 403, _, reason) = failure {
                state = .notSent(reason == "wont_carry" ? .refused : .notConnected)
            } else {
                state = .notSent(.failed)
            }
            return []

        case .retryTapped:
            guard state == .notSent(.failed), let lastBody else { return [] }
            state = .sending
            return [.call(.sendBridge(lastBody))]

        case .editTapped:
            guard state == .notSent(.refused) else { return [] }
            sentText = nil
            lastBody = nil
            state = .editing
            return []
        }
    }

    // MARK: Writing

    /// States in which the bar is open for typing.
    private var isWritingState: Bool {
        switch state {
        case .editing, .reading, .refused: return true
        default: return false
        }
    }

    private mutating func wordsChanged(_ newText: String) -> [Effect] {
        guard isWritingState else { return [] }
        let wasReading = state == .reading
        text = newText
        hasTyped = true
        notes = []
        fromMe = nil
        fromMeAnswered = false
        answered = []
        refusal = nil
        seq += 1
        state = .editing
        return wasReading ? [.cancelInsight] : []
    }

    private mutating func insightReturned(_ reply: InsightReply) -> [Effect] {
        switch reply {
        case let .insight(highlights, item):
            // Owner's answer on #18 (a): a highlight whose suggestion equals the phrase (vague_ask) is a note too.
            notes = highlights.enumerated().compactMap { index, h in
                guard let kind = h.frictionKind else { return nil }
                return Note(id: index, original: h.original, suggested: h.suggested, frictionKind: kind, whyLine: h.whyLine)
            }
            answered = []
            if let item, !fromMeSkip.contains(item.id) { fromMe = item } else { fromMe = nil }
            fromMeAnswered = false
            state = .editing
        case .risk:
            riskForThisDraft = true
            state = .safetyStop
        case let .declined(spans, headline):
            refusal = Refusal(spans: spans, headline: headline)
            state = .refused
        case .unavailable:
            state = .editing
        }
        return []
    }

    /// Replace the phrase with the suggestion when the words there still match. The note is answered either way.
    private mutating func use(_ note: Note) {
        answered.insert(note.id)
        guard note.hasTry, let range = text.range(of: note.original) else { return }
        let before = text
        text.replaceSubrange(range, with: note.suggested)
        markChanged(from: before)
    }

    /// Add the item's words to the end of the message as their own sentence.
    private mutating func add(_ item: FromMe) {
        fromMeAnswered = true
        let before = text
        var base = text
        while let last = base.last, last.isWhitespace { base.removeLast() }
        if let last = base.last, !".!?".contains(last) { base += "." }
        text = base.isEmpty ? item.wording : base + " " + item.wording
        markChanged(from: before)
    }

    private mutating func skip(_ item: FromMe) {
        fromMeAnswered = true
        if !fromMeSkip.contains(item.id) { fromMeSkip.append(item.id) }
    }

    private mutating func markChanged(from before: String) {
        if originalBeforeUse == nil { originalBeforeUse = before }
        changed = true
    }

    private mutating func leftThread() -> [Effect] {
        var effects: [Effect] = []
        switch state {
        case .editing, .refused, .safetyStop, .noteUp: break
        case .reading: effects.append(.cancelInsight)
        default: return []
        }
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            state = .savingDraft
            effects.append(.call(.putDraft(personId: person.id, text: text, replyTo: replyTo)))
        } else {
            state = .closed
            if draftWasLoaded { effects.append(.call(.deleteDraft(personId: person.id))) }
        }
        return effects
    }

    // MARK: Before it goes

    private mutating func sendTapped() -> [Effect] {
        guard state == .editing || state == .reading, canSend else { return [] }
        var effects: [Effect] = state == .reading ? [.cancelInsight] : []
        var cards = unansweredNotes.map(PauseCard.note)
        if let fromMe, !fromMeAnswered, !fromMeSkip.contains(fromMe.id) { cards.append(.fromMe(fromMe)) }
        guard !cards.isEmpty else { return effects + fold() }
        pauseCards = cards
        state = .pausing(0)
        if theyShared == .no, !askLineShown {
            askLineShown = true
            askLineThisPause = true
            effects.append(.markAskLineShown(personId: person.id))
        }
        return effects
    }

    /// Next card, or the end of the pause: `final` when the words changed, else fold and send.
    private mutating func nextCard(after index: Int) -> [Effect] {
        if index + 1 < pauseCards.count {
            state = .pausing(index + 1)
            return []
        }
        pauseCards = []
        if changed {
            state = .final
            return []
        }
        return fold()
    }

    // MARK: Sending

    private mutating func fold() -> [Effect] {
        let body = BridgeRequest(personId: person.id, original: original, bridged: nil, final: text,
                                 used: changed ? .edited : .mine, showOriginal: false, headsUp: true,
                                 deliverAt: "now", tz: tz, replyTo: replyTo)
        lastBody = body
        sentText = text
        state = .sending
        return [.haptic(.firm), .paperSound, .call(.sendBridge(body))]
    }

    // MARK: Shared rules

    /// A 401 on any call ends the session; words in the bar are kept on the phone.
    private mutating func endSession() -> [Effect] {
        state = .sessionEnded
        var effects: [Effect] = [.endSession]
        if !text.isEmpty { effects.append(.keepWordsOnPhone(text)) }
        return effects
    }
}
