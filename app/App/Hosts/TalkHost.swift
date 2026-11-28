import Contract
import Flows
import Foundation

/// Hosts `TalkFlow` (flows/talk.md): performs its calls with the generated client and feeds each answer back.
@MainActor @Observable
final class TalkHost {
    private(set) var flow: TalkFlow
    /// "Kept for you" or "This one can't be kept", for `TalkFlow.keptShownFor` after a keep.
    private(set) var notice: TalkScreen.Notice?
    @ObservationIgnored let tasks = HostTasks()
    @ObservationIgnored private let context: HostContext
    @ObservationIgnored private var noticeTask: Task<Void, Never>?

    init(context: HostContext, aiConsentGiven: Bool = true) {
        self.context = context
        flow = TalkFlow(aiConsentGiven: aiConsentGiven)
    }

    var name: String? { context.firstName }

    func enter() { send(.entered) }

    @discardableResult
    func send(_ event: TalkFlow.Event) -> [Task<Void, Never>] {
        flow.handle(event).compactMap(perform)
    }

    /// The talk bar's words, said to Talk. True when Talk took them (they left the bar); returns once Talk's turn
    /// has answered.
    func say(_ words: String) async -> Bool {
        notice = nil
        send(.wordsChanged(words))
        let calls = send(.sendTapped)
        guard flow.state == .sending else { return false }
        for call in calls { await call.value }
        return true
    }

    // MARK: Effects

    private func perform(_ effect: TalkFlow.Effect) -> Task<Void, Never>? {
        switch effect {
        case let .call(call):
            return perform(call)
        case let .haptic(haptic):
            context.haptic(haptic)
        case .startListening, .stopListening, .askMicPermission:
            // Talk's own mic is not drawn: the bar's mic belongs to the surface, which never sends Talk `micTapped`.
            break
        case let .openInSafari(link):
            if let url = URL(string: link) { context.open(url) }
        case let .showKept(report):
            show(.kept(report))
        case .showNotKept:
            show(.notKept)
        case let .keepWordsOnPhone(words):
            context.keepWords(words)
        case .endSession:
            return tasks.run { [context] in await context.endSession() }
        }
        return nil
    }

    private func show(_ shown: TalkScreen.Notice) {
        notice = shown
        noticeTask?.cancel()
        noticeTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(TalkFlow.keptShownFor))
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }

    private func perform(_ call: TalkFlow.Call) -> Task<Void, Never> {
        let api = context.api
        switch call {
        case .getHome:
            return tasks.run {
                switch await api.getHome() {
                case let .success(home): self.send(.homeLoaded(cardsFrom: Self.cardsFrom(home.people)))
                case let .failure(failure): self.send(.homeFailed(failure))
                }
            }
        case let .talkTurn(request):
            let body = Operations.commTalkTurn.Input.Body.jsonPayload(
                text: request.text,
                conversation_id: request.conversationId,
                way_in: .init(rawValue: request.wayIn.rawValue),
                name: request.name
            )
            return tasks.run {
                switch await api.talkTurn(body) {
                case let .success(turn): self.send(.turnReturned(Self.reply(turn, conversationId: self.flow.conversationId)))
                case let .failure(failure): self.send(.turnFailed(failure))
                }
            }
        case .getPeople:
            return tasks.run {
                switch await api.getPeople() {
                case let .success(reply):
                    self.send(.peopleLoaded(reply.people.compactMap { row in
                        guard let person = row.person, !person.deleted else { return nil }
                        return TalkFlow.Person(id: person.id, name: person.name)
                    }))
                case let .failure(failure):
                    self.send(.peopleFailed(failure))
                }
            }
        case let .createItem(item):
            let body = Operations.addCommItem.Input.Body.jsonPayload(
                kind: item.kind,
                wording: item.wording,
                scope: .init(_type: .init(rawValue: item.scope.type) ?? .everyone, value: item.scope.value),
                source: .init(rawValue: item.source)
            )
            return tasks.run {
                switch await api.addCommItem(body) {
                case let .success(.created(created)):
                    self.send(.keepReturned(.created(id: created.item.id)))
                case let .success(.notKept(notKept)):
                    if notKept.state == .safety, let resources = notKept.resources {
                        self.send(.keepReturned(.safety(Self.safety(resources, line: notKept.line))))
                    } else {
                        self.send(.keepReturned(.notKept))
                    }
                case let .failure(failure):
                    self.send(.keepFailed(failure))
                }
            }
        case let .markPartly(beliefId):
            return tasks.run {
                switch await api.markPartly(beliefId: beliefId) {
                case .success: self.send(.partlySaved)
                case let .failure(failure): self.send(.partlyFailed(failure))
                }
            }
        case let .share(personId, beliefId):
            return tasks.run {
                switch await api.share(personId: personId, beliefId: beliefId) {
                case .success: self.send(.grantSucceeded)
                case let .failure(failure): self.send(.grantFailed(failure))
                }
            }
        }
    }

    // MARK: Reading the replies

    /// The names of the people who left a card, most urgent first (`GET /home` ends with the most urgent).
    static func cardsFrom(_ rows: [Components.Schemas.HomeRow]) -> [String] {
        rows.reversed().compactMap { row in
            guard row.unread > 0, let person = row.person, !person.deleted else { return nil }
            return person.name
        }
    }

    static func reply(_ turn: Operations.commTalkTurn.Output.Ok.Body.jsonPayload, conversationId: String?) -> TalkFlow.TurnReply {
        let reply = turn.reply
        switch reply.state {
        case "safety":
            return .safety(safety(reply.resources, line: nil))
        case "done":
            return .done(reflection: reply.reflection.nonEmpty)
        default:
            return .ask(
                conversationId: turn.conversation?.id ?? conversationId ?? "",
                reflection: reply.reflection.nonEmpty,
                question: reply.question.nonEmpty,
                itemState: reply.item_state,
                item: reply.item.map { TalkFlow.Item(kind: $0.kind, wording: $0.wording) }
            )
        }
    }

    /// safety.md: the reply's message, or its line, with its resources.
    static func safety(_ resources: Components.Schemas.Resources?, line: String?) -> TalkFlow.Safety {
        TalkFlow.Safety(
            message: line?.nonEmpty ?? resources?.message ?? "",
            resources: (resources?.resources ?? []).map { TalkFlow.Resource(label: $0.label, url: $0.url) }
        )
    }
}

extension String {
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
