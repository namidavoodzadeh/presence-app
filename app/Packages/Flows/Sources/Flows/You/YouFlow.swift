import Foundation

/// packages/01/flows/you.md: You (the list by kind) and the kenning card over it, one machine.
/// No UI, no networking: calls are effects the app performs, and their answers come back as events.
public struct YouFlow: Sendable {
    public enum State: Equatable, Sendable { case hidden, shown, sessionEnded }

    public struct Item: Equatable, Sendable {
        /// The belief id and the item id.
        public let id: String
        public let kind: String
        public let wording: String
        public init(id: String, kind: String, wording: String) {
            self.id = id
            self.kind = kind
            self.wording = wording
        }
    }

    public struct Group: Equatable, Sendable {
        public let kind: String
        public let heading: String
        public let items: [Item]
        public init(kind: String, heading: String, items: [Item]) {
            self.kind = kind
            self.heading = heading
            self.items = items
        }
    }

    public struct Person: Equatable, Sendable {
        public let id: String
        public let name: String
        public init(id: String, name: String) {
            self.id = id
            self.name = name
        }
    }

    public struct Visibility: Equatable, Sendable {
        public let person: Person
        public let sees: Bool
        public init(person: Person, sees: Bool) {
            self.person = person
            self.sees = sees
        }
    }

    public struct Receipt: Equatable, Sendable {
        /// nil: typed, not from Talk.
        public let quote: String?
        public let date: String
        public init(quote: String?, date: String) {
            self.quote = quote
            self.date = date
        }
    }

    public struct Detail: Equatable, Sendable {
        /// `receipts[0]`.
        public let receipt: Receipt?
        /// People with `sees: true`; nil when the visibility call failed and Seen by is left out.
        public let seenBy: [Person]?
        public init(receipt: Receipt?, seenBy: [Person]?) {
            self.receipt = receipt
            self.seenBy = seenBy
        }
    }

    public struct Kenning: Equatable, Sendable {
        /// Kind and words show at once, from the list.
        public let item: Item
        public let detail: LoadState<Detail>
        public init(item: Item, detail: LoadState<Detail>) {
            self.item = item
            self.detail = detail
        }
    }

    public enum Event: Equatable, Sendable {
        /// A pull from the left, a tap on `edge.left`, or You appearing again.
        case appeared
        case itemsLoaded([Group])
        case itemsFailed(CallFailure)
        case retryTapped
        case itemTapped(Item)
        case talkTapped
        case pulledLeft
        case sentFromBar(String)
        case beliefLoaded(receipts: [Receipt])
        case beliefFailed(CallFailure)
        case visibilityLoaded([Visibility])
        case visibilityFailed(CallFailure)
        case kenningRetryTapped
        case tappedOutside
    }

    public enum Effect: Equatable, Sendable {
        case call(Call)
        case haptic(Haptic)
        case moveToTalk
        case sendInTalk(String)
        case endSession
    }

    public enum Call: Equatable, Sendable {
        case getItems
        case getBelief(id: String)
        case getVisibility(itemId: String)
    }

    /// The kind package 01 does not show.
    static let hiddenKind = "this_week"

    public private(set) var state: State = .hidden
    public private(set) var list: LoadState<[Group]> = .loading
    public private(set) var kenning: Kenning?

    /// The open card's answers so far. `receipt` is set once the belief call answered 200.
    private enum Answer<Value: Sendable>: Sendable { case waiting, got(Value) }
    private var receiptAnswer: Answer<Receipt?> = .waiting
    /// `.got(nil)`: the visibility call failed, Seen by is left out.
    private var seenByAnswer: Answer<[Person]?> = .waiting

    public init() {}

    public mutating func handle(_ event: Event) -> [Effect] {
        if state == .sessionEnded { return [] }
        switch event {
        case .appeared:
            return loadList()

        case let .itemsLoaded(given):
            guard state == .shown, list == .loading else { return [] }
            let shown = given.filter { $0.kind != Self.hiddenKind && !$0.items.isEmpty }
            list = .from(shown)
            return []

        case let .itemsFailed(failure):
            guard state == .shown, list == .loading else { return [] }
            if failure.endsSession { return endSession() }
            list = .failed(failure.loadFailure)
            return []

        case .retryTapped:
            guard state == .shown, case let .failed(failure) = list, failure.canRetry else { return [] }
            return loadList()

        case let .itemTapped(item):
            guard state == .shown, case .loaded = list else { return [] }
            kenning = Kenning(item: item, detail: .loading)
            receiptAnswer = .waiting
            seenByAnswer = .waiting
            return [.call(.getBelief(id: item.id)), .call(.getVisibility(itemId: item.id)), .haptic(.softTick)]

        case .talkTapped:
            guard state == .shown, list == .empty else { return [] }
            return leave([.moveToTalk])

        case .pulledLeft:
            guard state == .shown else { return [] }
            return leave([.moveToTalk])

        case let .sentFromBar(words):
            guard state == .shown else { return [] }
            return leave([.moveToTalk, .sendInTalk(words)])

        case let .beliefLoaded(receipts):
            guard isLoadingKenning else { return [] }
            receiptAnswer = .got(receipts.first)
            settleKenning()
            return []

        case let .beliefFailed(failure):
            guard let card = kenning, isLoadingKenning else { return [] }
            if failure.endsSession { return endSession() }
            if case .http(404, _, _) = failure {
                // The card sinks; You reloads.
                closeKenning()
                return loadList()
            }
            kenning = Kenning(item: card.item, detail: .failed(failure.loadFailure))
            return []

        case let .visibilityLoaded(visibility):
            guard kenning != nil, case .waiting = seenByAnswer else { return [] }
            seenByAnswer = .got(visibility.filter(\.sees).map(\.person))
            settleKenning()
            return []

        case let .visibilityFailed(failure):
            guard kenning != nil, case .waiting = seenByAnswer else { return [] }
            if failure.endsSession { return endSession() }
            seenByAnswer = .got(nil)
            settleKenning()
            return []

        case .kenningRetryTapped:
            guard let card = kenning, case .failed = card.detail else { return [] }
            kenning = Kenning(item: card.item, detail: .loading)
            receiptAnswer = .waiting
            // The visibility answer, if one came, is kept; only the receipt is fetched again.
            return [.call(.getBelief(id: card.item.id))]

        case .tappedOutside:
            guard let card = kenning else { return [] }
            switch card.detail {
            case .loaded, .failed:
                closeKenning()
            case .loading, .empty:
                break
            }
            return []
        }
    }

    // MARK: Private

    private var isLoadingKenning: Bool {
        guard let card = kenning, case .loading = card.detail else { return false }
        return true
    }

    private mutating func loadList() -> [Effect] {
        state = .shown
        list = .loading
        closeKenning()
        return [.call(.getItems)]
    }

    private mutating func leave(_ effects: [Effect]) -> [Effect] {
        state = .hidden
        closeKenning()
        return effects
    }

    private mutating func endSession() -> [Effect] {
        state = .sessionEnded
        closeKenning()
        return [.endSession]
    }

    private mutating func closeKenning() {
        kenning = nil
        receiptAnswer = .waiting
        seenByAnswer = .waiting
    }

    /// Loaded only once both calls have answered.
    private mutating func settleKenning() {
        guard let card = kenning, case .loading = card.detail,
              case let .got(receipt) = receiptAnswer, case let .got(seenBy) = seenByAnswer else { return }
        kenning = Kenning(item: card.item, detail: .loaded(Detail(receipt: receipt, seenBy: seenBy)))
    }
}
