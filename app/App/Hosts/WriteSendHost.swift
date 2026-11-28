import Contract
import Flows
import Foundation

/// Hosts `WriteSendFlow` (flows/write-send.md) for one person's thread: drafts, the person map, the insight at a
/// pause, and sending. The Thread view stays its empty state until #19; the pause shows where the flow asks.
@MainActor @Observable
final class WriteSendHost {
    private(set) var flow: WriteSendFlow
    @ObservationIgnored let tasks = HostTasks()
    @ObservationIgnored private let context: HostContext
    @ObservationIgnored private var insightTask: Task<Void, Never>?

    init(context: HostContext, person: WriteSendFlow.Person, aiConsentGiven: Bool = true, tz: String = TimeZone.current.identifier) {
        self.context = context
        flow = WriteSendFlow(
            person: person,
            aiConsentGiven: aiConsentGiven,
            askLineShown: context.defaults.bool(forKey: HostContext.Keys.askLineShown + person.id),
            tz: tz
        )
    }

    /// The pause is up: its cards, or the final words.
    var pauseShown: Bool {
        switch flow.state {
        case .pausing, .final: true
        default: false
        }
    }

    func send(_ event: WriteSendFlow.Event) {
        for effect in flow.handle(event) { perform(effect) }
    }

    private func perform(_ effect: WriteSendFlow.Effect) {
        switch effect {
        case let .call(call):
            perform(call)
        case .cancelInsight:
            insightTask?.cancel()
            insightTask = nil
        case let .haptic(haptic):
            context.haptic(haptic)
        case .paperSound:
            // No sound asset in DesignKit yet; the firm haptic plays with it.
            break
        case let .keepWordsOnPhone(words):
            context.keepWords(words)
        case let .markAskLineShown(personId):
            context.defaults.set(true, forKey: HostContext.Keys.askLineShown + personId)
        case .endSession:
            tasks.run { [context] in await context.endSession() }
        }
    }

    private func perform(_ call: WriteSendFlow.Call) {
        let api = context.api
        switch call {
        case let .getDraft(personId):
            tasks.run {
                switch await api.getDraft(personId: personId) {
                case let .success(reply): self.send(.draftLoaded(text: reply.draft?.text, replyTo: reply.draft?.reply_to))
                case let .failure(failure): self.send(.draftLoadFailed(failure))
                }
            }
        case let .getPersonMap(personId):
            tasks.run {
                switch await api.getPersonMap(personId: personId) {
                case .success: self.send(.personMapLoaded)
                case let .failure(failure): self.send(.personMapFailed(failure))
                }
            }
        case let .putDraft(personId, text, replyTo):
            tasks.run {
                switch await api.putDraft(personId: personId, text: text, replyTo: replyTo) {
                case .success: self.send(.draftSaved)
                case let .failure(failure): self.send(.draftSaveFailed(failure))
                }
            }
        case let .deleteDraft(personId):
            // The flow takes no answer for this call; a 401 ends the session in the middleware.
            tasks.run { _ = await api.deleteDraft(personId: personId) }
        case let .insight(request):
            let body = Operations.bridgeInsight.Input.Body.jsonPayload(
                person_id: request.personId,
                text: request.text,
                seq: request.seq,
                with_wording: request.withWording,
                reply_to: request.replyTo,
                from_me_skip: request.fromMeSkip
            )
            insightTask = tasks.run {
                let answer = await api.insight(body)
                guard !Task.isCancelled else { return }
                switch answer {
                case let .success(reply): self.send(.insightReturned(seq: reply.seq, Self.insight(reply, text: request.text)))
                case let .failure(failure): self.send(.insightFailed(seq: request.seq, failure))
                }
            }
        case let .sendBridge(request):
            let body = Operations.sendBridge.Input.Body.jsonPayload(
                person_id: request.personId,
                original: request.original,
                bridged: request.bridged,
                final: request.final,
                used: request.used == .edited ? .edited : .mine,
                show_original: request.showOriginal,
                heads_up: request.headsUp,
                deliver_at: request.deliverAt,
                tz: request.tz,
                reply_to: request.replyTo
            )
            tasks.run {
                switch await api.sendBridge(body) {
                case let .success(reply): self.send(.sendSucceeded(bridgeId: reply.bridge.id))
                case let .failure(failure): self.send(.sendFailed(failure))
                }
            }
        }
    }

    /// The insight reply in the flow's terms (flows/write-send.md, the `reading` rows).
    static func insight(_ reply: Operations.bridgeInsight.Output.Ok.Body.jsonPayload, text: String) -> WriteSendFlow.InsightReply {
        switch reply.state {
        case "insight":
            return .insight(
                highlights: (reply.highlights ?? []).map {
                    WriteSendFlow.Highlight(original: $0.original, suggested: $0.suggested, frictionKind: $0.friction_kind, whyLine: $0.why_line)
                },
                fromMe: reply.from_me.map { WriteSendFlow.FromMe(id: $0.item_id, wording: $0.wording) }
            )
        case "risk":
            return .risk
        case "declined":
            return .declined(spans: reply.spans.compactMap { span(of: text, start: $0.start, end: $0.end) }, headline: reply.headline)
        default:
            return .unavailable
        }
    }

    /// The words a span covers; nil when it falls outside the text.
    static func span(of text: String, start: Int, end: Int) -> String? {
        let characters = Array(text)
        guard start >= 0, start < end, end <= characters.count else { return nil }
        return String(characters[start..<end])
    }
}
