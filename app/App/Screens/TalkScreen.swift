import DesignKit
import Flows
import SwiftUI

/// packages/01 `talk`: Talk (Y4 first open, the conversation, Y5 a suggestion).
/// Draws what `TalkFlow` holds and sends it events; no flow logic and no network calls here. The talk bar, the
/// greenhouse and the pulls belong to the surface around it.
struct TalkScreen: View {
    /// A short line the host shows after an effect (`showKept`, `showNotKept`); not flow state.
    enum Notice: Equatable {
        case kept(TalkFlow.KeptReport)
        case notKept
    }

    let flow: TalkFlow
    /// The person's first name, for the greeting. Without one the greeting is the time of day alone.
    var name: String?
    var now: Date = .now
    var calendar: Calendar = .current
    var notice: Notice?
    /// Fixes the knot's look for previews and snapshots; without it the knot waits 300 ms (states.md).
    var waitingPhase: WaitingPhase?
    let send: (TalkFlow.Event) -> Void
    /// "Turn on Kenember's AI" in the declined state goes to the AI consent card (privacy.md).
    var turnOnAI: () -> Void = {}

    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ZStack(alignment: .topLeading) {
            Tokens.Colour.base.color(for: scheme).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Space.l) {
                    greeting
                    conversation
                    tail
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Row.sideInset)
                .padding(.vertical, Space.xl)
            }
        }
        .testerScreen("talk")
    }

    // MARK: Greeting

    private var greeting: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(TalkCopy.greeting(name: name, at: now, calendar: calendar))
                .typeStyle(Tokens.TypeScale.greeting, relativeTo: .largeTitle)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            // The real line only once the AI is on; the declined line takes its place below.
            if flow.state != .declined, let real = TalkCopy.realLine(flow.cardsFrom, underline: apricot) {
                Text(real)
                    .typeStyle(Tokens.TypeScale.reply, relativeTo: .body)
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("talk.greeting")
    }

    // MARK: The conversation

    private var conversation: some View {
        ForEach(Self.numbered(flow.turns)) { entry in
            switch entry.turn {
            case let .mine(words):
                message(words, index: entry.index)
            case let .reply(reflection, question):
                reply([reflection, question].compactMap { $0 }, index: entry.index)
            case .fallbackQuestion:
                reply([TalkCopy.fallbackQuestion], index: entry.index)
            }
        }
    }

    private func message(_ words: String, index: Int) -> some View {
        Text(words)
            .typeStyle(Tokens.TypeScale.message, relativeTo: .body)
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, Tokens.Row.paddingVertical)
            .padding(.horizontal, Tokens.Row.paddingHorizontal)
            .background(glass(radius: Tokens.Row.radius))
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, Space.xl)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("talk.message.\(index)")
    }

    private func reply(_ lines: [String], index: Int) -> some View {
        VStack(alignment: .leading, spacing: Space.s) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .typeStyle(Tokens.TypeScale.reply, relativeTo: .body)
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("talk.reply.\(index)")
    }

    // MARK: Under the last turn

    @ViewBuilder private var tail: some View {
        switch flow.state {
        case .opening, .sending:
            TalkKnot(phase: waitingPhase)
        case .suggesting:
            if let item = flow.offered { suggestion(item, answering: true) }
            noticeLine
        case .scoping, .keeping, .markingPartly, .granting:
            // The card stays, still, while `scope` is up over it (flows/talk.md notes).
            if let item = flow.offered { suggestion(item, answering: false) }
        case .turnFailed:
            failedLine(TalkCopy.turnFailed, id: "talk.turnFailed")
            retry
        case .limited:
            if let opensAt = flow.opensAt {
                failedLine(TalkCopy.limited(opensAt: opensAt, now: now, calendar: calendar), id: "talk.limited")
            }
        case .closedForAccount:
            failedLine(TalkCopy.notOpen, id: "talk.notOpen")
        case .declined:
            declined
        case .ready, .listening, .askingPermission:
            noticeLine
        case .entering, .safetyStop, .aiConsent, .sessionEnded:
            // `safety`, `aiConsent` and sign-in are drawn by their own screens over or instead of Talk.
            EmptyView()
        }
    }

    private func failedLine(_ text: String, id: String) -> some View {
        Text(text)
            .typeStyle(Tokens.TypeScale.rowLine, relativeTo: .callout)
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .multilineTextAlignment(.trailing)
            .accessibilityIdentifier(id)
    }

    private var retry: some View {
        quietWord(TalkCopy.retry, id: "talk.retry", alignment: .trailing) { send(.retryTapped) }
    }

    private var declined: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            Text(TalkCopy.declinedLine)
                .typeStyle(Tokens.TypeScale.reply, relativeTo: .body)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
            quietWord(TalkCopy.turnOn, id: "talk.turnOn", alignment: .leading, action: turnOnAI)
        }
    }

    /// "Kept for you" with an apricot dot under the reply, or the lines for what did not save.
    @ViewBuilder private var noticeLine: some View {
        switch notice {
        case let .kept(report):
            VStack(alignment: .leading, spacing: Space.xs) {
                HStack(spacing: Space.s) {
                    Circle()
                        .fill(apricot)
                        .frame(width: Tokens.Dot.size, height: Tokens.Dot.size)
                        .accessibilityHidden(true)
                    noticeText(report.partlyFailed ? TalkCopy.partlyFailed : TalkCopy.kept)
                }
                ForEach(report.notSharedWith, id: \.self) { person in
                    noticeText(TalkCopy.grantFailed(person))
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("talk.kept")
        case .notKept:
            noticeText(TalkCopy.notKept).accessibilityIdentifier("talk.notKept")
        case nil:
            EmptyView()
        }
    }

    private func noticeText(_ text: String) -> some View {
        Text(text)
            .typeStyle(Tokens.TypeScale.rowLine, relativeTo: .callout)
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: The suggestion card

    private func suggestion(_ item: TalkFlow.Item, answering: Bool) -> some View {
        VStack(alignment: .leading, spacing: Space.m) {
            Text(TalkCopy.kindHeading(item.kind).uppercased())
                .typeStyle(Tokens.TypeScale.caps, relativeTo: .caption)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(item.wording)
                .typeStyle(Tokens.TypeScale.cardWords, relativeTo: .title3)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(TalkCopy.suggestionFrom)
                .typeStyle(Tokens.TypeScale.rowLine, relativeTo: .callout)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
            if answering {
                // Three short words of equal size, on one line; stacked at the accessibility text sizes.
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: Space.none) { answers }
                } else {
                    HStack(alignment: .top, spacing: Space.s) { answers }
                }
            }
        }
        .padding(.vertical, Tokens.Row.paddingVertical)
        .padding(.horizontal, Tokens.Row.paddingHorizontal)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(glass(radius: Tokens.Card.radius.lowerBound))
        .contentShape(Rectangle())
        // Swipe right = That's me, left = Not now (behaviour.md, swipe to decide).
        .gesture(
            DragGesture(minimumDistance: Space.l).onEnded { drag in
                guard answering else { return }
                let across = drag.translation.width
                guard abs(across) > Tokens.Motion.pullCommit, abs(across) > abs(drag.translation.height) else { return }
                send(across > 0 ? .thatsMeTapped : .notNowTapped)
            }
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("talk.suggestion")
    }

    @ViewBuilder private var answers: some View {
        quietWord(TalkCopy.thatsMe, id: "talk.thatsMe", alignment: .leading) { send(.thatsMeTapped) }
        quietWord(TalkCopy.partly, id: "talk.partly", alignment: .center) { send(.partlyTapped) }
        quietWord(TalkCopy.notNow, id: "talk.notNow", alignment: .trailing) { send(.notNowTapped) }
    }

    private func quietWord(_ label: String, id: String, alignment: Alignment,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .typeStyle(Tokens.TypeScale.rowName, relativeTo: .headline)
                .foregroundStyle(ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                // Padding, not a fixed minimum, so the target grows with the text; 44 pt or more at default.
                .padding(.vertical, Space.s)
                .padding(.horizontal, Space.s)
                .frame(minWidth: Tokens.minTarget, minHeight: Tokens.minTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: alignment)
        .accessibilityIdentifier(id)
    }

    // MARK: Look

    private var ink: Color { Tokens.Colour.ink.color(for: scheme) }
    private var apricot: Color { Tokens.Colour.apricotDeep.color(for: scheme) }

    private func glass(radius: Double) -> some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Tokens.Colour.glassFill.color(for: scheme))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Tokens.Colour.glassEdge.color(for: scheme), lineWidth: Tokens.Glass.topEdge)
            )
    }

    /// Messages and replies are numbered separately, from 0, in the order they came: `talk.message.N`, `talk.reply.N`.
    static func numbered(_ turns: [TalkFlow.Turn]) -> [NumberedTurn] {
        var mine = 0, replies = 0
        return turns.enumerated().map { offset, turn in
            switch turn {
            case .mine:
                defer { mine += 1 }
                return NumberedTurn(id: offset, index: mine, turn: turn)
            case .reply, .fallbackQuestion:
                defer { replies += 1 }
                return NumberedTurn(id: offset, index: replies, turn: turn)
            }
        }
    }

    struct NumberedTurn: Identifiable {
        /// The turn's place in the whole conversation.
        let id: Int
        /// Its number among messages, or among replies.
        let index: Int
        let turn: TalkFlow.Turn
    }
}

/// The knot where the first question or the reply goes: nothing for 300 ms, then the knot (states.md).
/// Never inside the send. Talk has no unavailable line of its own, so the knot stays while the call goes on;
/// the turn's own failure (30 s timeout) ends it.
private struct TalkKnot: View {
    @State private var phase: WaitingPhase
    private let runsClock: Bool

    init(phase: WaitingPhase?) {
        _phase = State(initialValue: phase ?? .nothing)
        runsClock = phase == nil
    }

    var body: some View {
        Group {
            switch phase {
            case .nothing:
                Color.clear.accessibilityHidden(true)
            case .knot, .unavailable:
                Knot(label: TalkCopy.waiting)
                    .accessibilityIdentifier("talk.loading")
            }
        }
        .frame(maxWidth: .infinity, minHeight: Tokens.minTarget)
        .task {
            guard runsClock else { return }
            try? await Task.sleep(for: .seconds(Waiting.showKnotAfter))
            phase = .knot
        }
    }
}

/// packages/01/copy.md, `talk` (with `aiConsent.declinedLine`, `aiConsent.turnOn` and `wait.a11y`), byte for byte.
/// `[Me]` is the person's first name, `[Name]` the name of someone who left a card.
enum TalkCopy {
    static let greetings = ["Morning, [Me].", "Afternoon, [Me].", "Evening, [Me]."]
    static let realOneTemplate = "[Name] left you a card. Nothing else needs you."
    static let realManyTemplate = "[Name] and [Name] left you cards. Nothing else needs you."
    static let realNone = "Say whatever's on your mind."
    static let fallbackQuestion = "What's one moment from this week that's still with you?"
    static let suggestionFrom = "From what you just said."
    static let thatsMe = "That's me"
    static let partly = "Partly"
    static let notNow = "Not now"
    static let kept = "Kept for you"
    static let notKept = "This one can't be kept."
    static let partlyFailed = "Kept as That's me. Partly didn't save."
    static let grantFailedTemplate = "Not shared with [Name]. Try again from You."
    static let turnFailed = "That didn't go through. Your words are still here."
    static let limitedTemplates = ["Talk opens again at [time].", "Talk opens again on [day]."]
    static let retry = "Try again"
    static let notOpen = "Talk isn't open on this account yet."
    static let declinedLine = "Talk and notes need Kenember's AI. Your people and their cards work without it."
    static let turnOn = "Turn on Kenember's AI"
    static let waiting = "Loading"

    /// Morning before noon, Afternoon before 6 pm, Evening after (copy.md gives the words, not the hours: #25).
    static func greeting(name: String?, at date: Date, calendar: Calendar) -> String {
        let hour = calendar.component(.hour, from: date)
        let template = hour < 12 ? greetings[0] : hour < 18 ? greetings[1] : greetings[2]
        guard let name, !name.isEmpty else { return template.replacingOccurrences(of: ", [Me]", with: "") }
        return template.replacingOccurrences(of: "[Me]", with: name)
    }

    /// The line about what is real now, from `GET /home`'s cards; `nil` (left out) when `GET /home` failed.
    /// Names, the two most recent first, carry the apricot underline.
    static func realLine(_ cardsFrom: [String]?, underline: Color = .clear) -> AttributedString? {
        guard let cardsFrom else { return nil }
        let names = Array(cardsFrom.prefix(2))
        let template: String
        switch names.count {
        case 0: return AttributedString(realNone)
        case 1: template = realOneTemplate
        default: template = realManyTemplate
        }
        var line = AttributedString()
        var rest = Substring(template)
        for name in names {
            guard let at = rest.range(of: "[Name]") else { break }
            line += AttributedString(String(rest[..<at.lowerBound]))
            var underlined = AttributedString(name)
            underlined.swiftUI.underlineStyle = Text.LineStyle(pattern: .solid, color: underline)
            line += underlined
            rest = rest[at.upperBound...]
        }
        line += AttributedString(String(rest))
        return line
    }

    static func grantFailed(_ name: String) -> String {
        grantFailedTemplate.replacingOccurrences(of: "[Name]", with: name)
    }

    /// The server's `opens_at`, formatted on the phone: a time when it is today, the day otherwise.
    static func limited(opensAt: Date, now: Date, calendar: Calendar) -> String {
        if calendar.isDate(opensAt, inSameDayAs: now) {
            var style = Date.FormatStyle(date: .omitted, time: .shortened, locale: calendar.locale ?? .current,
                                         calendar: calendar, timeZone: calendar.timeZone)
            style.capitalizationContext = .middleOfSentence
            return limitedTemplates[0].replacingOccurrences(of: "[time]", with: opensAt.formatted(style))
        }
        let style = Date.FormatStyle(locale: calendar.locale ?? .current, calendar: calendar, timeZone: calendar.timeZone)
            .weekday(.wide)
        return limitedTemplates[1].replacingOccurrences(of: "[day]", with: opensAt.formatted(style))
    }

    /// The kind's heading for the card (`item.kind` → heading, from the server's `COMM_KIND_COPY`).
    static func kindHeading(_ kind: String) -> String {
        switch kind {
        case "how_i_mean": "How I mean things"
        case "feels_like_care": "What feels like care"
        case "bring_up": "How to bring something up with me"
        case "lands_hard": "What lands hard"
        case "gets_heated": "When it gets heated"
        case "coming_back": "Coming back after"
        case "matters": "What matters to me"
        case "this_week": "This week"
        default: "Other things about me"
        }
    }
}

#if DEBUG
/// Talk in each state the package lists, built by sending the flow its events (no state is set by hand).
enum TalkFixtures {
    static let name = "Nami"
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.locale = Locale(identifier: "en_US_POSIX")
        return calendar
    }
    /// Thursday 26 Nov 2026, 19:30 UTC: "Evening".
    static let now = Date(timeIntervalSince1970: 1_795_721_400)

    static let question = "What's been sitting with you today?"
    static let words = "I keep going quiet when Jan asks how I am."
    static let item = TalkFlow.Item(kind: "how_i_mean", wording: "When I go quiet, I'm thinking, not upset.")

    private static func flow(_ base: TalkFlow = TalkFlow(), _ events: TalkFlow.Event...) -> TalkFlow {
        var flow = base
        for event in events { _ = flow.handle(event) }
        return flow
    }

    static var opening: TalkFlow { flow(TalkFlow(), .entered, .homeLoaded(cardsFrom: ["Jan"])) }
    static var ready: TalkFlow {
        flow(opening, .turnReturned(.ask(conversationId: "c1", reflection: nil, question: question, itemState: nil, item: nil)))
    }
    static var sending: TalkFlow { flow(ready, .wordsChanged(words), .sendTapped) }
    static var conversation: TalkFlow {
        flow(sending, .turnReturned(.ask(conversationId: "c1", reflection: "Going quiet sounds like your way of taking care.",
                                         question: "What do you wish Jan knew when that happens?", itemState: nil, item: nil)))
    }
    static var suggesting: TalkFlow {
        flow(sending, .turnReturned(.ask(conversationId: "c1", reflection: "You go quiet to think it through.",
                                         question: "What helps you come back to it?", itemState: "offered", item: item)))
    }
    static var turnFailed: TalkFlow { flow(sending, .turnFailed(.offline)) }
    static var limited: TalkFlow { flow(sending, .turnLimited(opensAt: now.addingTimeInterval(2 * 3600))) }
    static var notOpen: TalkFlow {
        flow(TalkFlow(), .entered, .homeLoaded(cardsFrom: []), .turnFailed(.http(status: 403, error: "forbidden", reason: "feature_off")))
    }
    static var declined: TalkFlow { flow(TalkFlow(aiConsentGiven: false), .entered) }

    static func named(_ state: String) -> TalkFlow? {
        switch state {
        case "opening": opening
        case "ready": ready
        case "sending": sending
        case "conversation": conversation
        case "suggesting": suggesting
        case "turnFailed": turnFailed
        case "limited": limited
        case "notOpen": notOpen
        case "declined": declined
        default: nil
        }
    }
}

#Preview("First open") { TalkScreen(flow: TalkFixtures.ready, name: "Nami", send: { _ in }) }
#Preview("Suggestion") { TalkScreen(flow: TalkFixtures.suggesting, name: "Nami", send: { _ in }) }
#Preview("Failed") { TalkScreen(flow: TalkFixtures.turnFailed, name: "Nami", send: { _ in }) }
#endif
