import DesignKit
import Flows
import SwiftUI

/// `pause`, "Before it goes" (packages/01: screens.md, behaviour.md, copy.md `pause`).
/// No server data of its own: it draws what `WriteSendFlow` holds (the cards fixed when the pause rose, or the
/// final words) and sends the flow its events. Nothing is decided here.
struct PauseScreen: View {
    let flow: WriteSendFlow
    let send: (WriteSendFlow.Event) -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack {
            Tokens.Colour.base.color(for: scheme).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Space.l) {
                    Text(PauseCopy.title)
                        .manrope(Tokens.TypeScale.heading, relativeTo: .largeTitle)
                        .foregroundStyle(ink)
                        .accessibilityAddTraits(.isHeader)
                    content
                }
                .padding(.horizontal, Tokens.Row.sideInset)
                .padding(.vertical, Space.l)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        // Pulling down goes back to writing, with the words as they are now.
        .simultaneousGesture(
            DragGesture(minimumDistance: Space.l).onEnded { drag in
                let vertical = drag.translation.height
                if vertical > Tokens.Motion.pullCommit, vertical > abs(drag.translation.width) { send(.pulledDown) }
            }
        )
        .accessibilityAction(.escape) { send(.pulledDown) }
        .testerScreen("pause")
    }

    @ViewBuilder private var content: some View {
        switch flow.state {
        case let .pausing(index) where flow.pauseCards.indices.contains(index):
            VStack(alignment: .leading, spacing: Space.m) {
                card(flow.pauseCards[index], isFirst: index == 0)
                dots(current: index, count: flow.pauseCards.count)
                if flow.showsAskLine {
                    Text(PauseCopy.askLine(flow.person.name))
                        .manrope(Tokens.TypeScale.rowLine, relativeTo: .callout)
                        .foregroundStyle(ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        case .final:
            VStack(alignment: .leading, spacing: Space.m) {
                Text(flow.text)
                    .manrope(Tokens.TypeScale.cardWords, relativeTo: .title3)
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, Tokens.Row.paddingVertical)
                    .padding(.horizontal, Tokens.Row.paddingHorizontal)
                    .background(glass(radius: Tokens.Card.radius.lowerBound))
                    .accessibilityIdentifier("pause.final")
                foldAndSend
            }
        default:
            EmptyView()
        }
    }

    // MARK: Cards

    private func card(_ card: WriteSendFlow.PauseCard, isFirst: Bool) -> some View {
        let canUse: Bool
        switch card {
        case let .note(note): canUse = note.hasTry
        case .fromMe: canUse = true
        }
        return VStack(alignment: .leading, spacing: Space.m) {
            switch card {
            case let .note(note): noteWords(note, isFirst: isFirst)
            case let .fromMe(item): fromMeWords(item, isFirst: isFirst)
            }
            // Keep mine on the left, Use it on the right, each in its own half so large text wraps, never truncates.
            HStack(alignment: .top, spacing: Space.m) {
                choice(PauseCopy.keepMine, id: "pause.keepMine", alignment: .leading) { send(.keepMine) }
                if canUse { choice(PauseCopy.useIt, id: "pause.useIt", alignment: .trailing) { send(.useIt) } }
            }
        }
        .padding(.vertical, Tokens.Row.paddingVertical)
        .padding(.horizontal, Tokens.Row.paddingHorizontal)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(glass(radius: Tokens.Card.radius.lowerBound))
        .contentShape(Rectangle())
        // Swipe right = Use it (only where the card offers it), left = Keep mine.
        .gesture(
            DragGesture(minimumDistance: Space.l).onEnded { drag in
                let across = drag.translation.width
                guard abs(across) > Tokens.Motion.pullCommit, abs(across) > abs(drag.translation.height) else { return }
                if across > 0 { if canUse { send(.useIt) } } else { send(.keepMine) }
            }
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pause.note")
    }

    @ViewBuilder private func noteWords(_ note: WriteSendFlow.Note, isFirst: Bool) -> some View {
        caps(PauseCopy.noteLabel)
        if !note.whyLine.isEmpty {
            Text(note.whyLine)
                .manrope(Tokens.TypeScale.cardWords, relativeTo: .title3)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        if note.hasTry {
            caps(PauseCopy.tryLabel)
            Text(PauseCopy.trySuggested(note.suggested))
                .manrope(Tokens.TypeScale.cardWords, relativeTo: .title3)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        basis(isFirst: isFirst)
    }

    @ViewBuilder private func fromMeWords(_ item: WriteSendFlow.FromMe, isFirst: Bool) -> some View {
        Text(PauseCopy.fromMe(item.wording))
            .manrope(Tokens.TypeScale.cardWords, relativeTo: .title3)
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
        if isFirst, flow.basis == .onlyYou { basisLine(PauseCopy.basisNothing(flow.person.name)) }
    }

    /// When they have shared nothing, the first card says so; otherwise each note says it is general.
    @ViewBuilder private func basis(isFirst: Bool) -> some View {
        switch flow.basis {
        case .onlyYou: if isFirst { basisLine(PauseCopy.basisNothing(flow.person.name)) }
        case .general: basisLine(PauseCopy.basisGeneral(flow.person.name))
        }
    }

    private func basisLine(_ line: String) -> some View {
        Text(line)
            .manrope(Tokens.TypeScale.rowLine, relativeTo: .callout)
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func caps(_ label: String) -> some View {
        Text(label)
            .manrope(Tokens.TypeScale.caps, relativeTo: .caption)
            .foregroundStyle(ink)
    }

    private func choice(_ label: String, id: String, alignment: Alignment,
                        action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .choiceLabel()
                .foregroundStyle(ink)
                .multilineTextAlignment(alignment == .trailing ? .trailing : .leading)
                .fixedSize(horizontal: false, vertical: true)
                // Padding, not a fixed minimum, so the target grows with the text size; 44 pt or more at default.
                .padding(.vertical, Space.m)
                .padding(.horizontal, Space.s)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: alignment)
        .accessibilityIdentifier(id)
    }

    // MARK: Dots and the send

    /// Dots instead of counts. VoiceOver hears "More after this one" while cards remain.
    @ViewBuilder private func dots(current: Int, count: Int) -> some View {
        if count > 1 {
            HStack(spacing: Space.s) {
                ForEach(0..<count, id: \.self) { index in
                    Circle()
                        .fill(index == current ? apricot : faint)
                        .frame(width: Tokens.Dot.size, height: Tokens.Dot.size)
                }
            }
            .frame(maxWidth: .infinity, minHeight: Tokens.minTarget)
            .contentShape(.accessibility, Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(PauseCopy.dotsA11y)
            .accessibilityHidden(current >= count - 1)
        }
    }

    /// The bar's send on the final card: "Fold and send".
    private var foldAndSend: some View {
        Button { send(.foldAndSendTapped) } label: {
            HStack(spacing: Space.m) {
                Text(PauseCopy.foldAndSend)
                    .manrope(Tokens.TypeScale.message, relativeTo: .body)
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: Space.s)
                Circle()
                    .fill(LinearGradient(colors: Tokens.Send.gradient.map(\.color), startPoint: .top, endPoint: .bottom))
                    .frame(width: Tokens.Send.size, height: Tokens.Send.size)
                    .accessibilityHidden(true)
            }
            .padding(.leading, Tokens.Row.paddingHorizontal)
            .padding(.trailing, Space.s)
            .frame(maxWidth: .infinity, minHeight: Tokens.Bar.emptyHeight)
            .background(glass(radius: Tokens.Bar.radius))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("pause.send")
    }

    // MARK: Look

    private var ink: Color { Tokens.Colour.ink.color(for: scheme) }
    private var faint: Color { Tokens.Colour.inkFaint.color(for: scheme) }
    private var apricot: Color { Tokens.Colour.apricot.color(for: scheme) }

    private func glass(radius: Double) -> some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Tokens.Colour.glassFill.color(for: scheme))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Tokens.Colour.glassEdge.color(for: scheme), lineWidth: Tokens.Glass.topEdge)
            )
    }
}

/// copy.md `pause` and `bar.foldAndSend`, byte for byte. `[Name]` is the other person's first name.
enum PauseCopy {
    static let title = "Before it goes"
    static let noteLabel = "HOW IT MAY LAND"
    static let tryLabel = "TRY"
    static let keepMine = "‹ Keep mine"
    static let useIt = "Use it ›"
    static let dotsA11y = "More after this one"
    static let foldAndSend = "Fold and send"

    static func trySuggested(_ suggested: String) -> String { "“\(suggested)”" }
    static func basisNothing(_ name: String) -> String {
        "\(name) hasn't shared anything yet, so this is based only on you."
    }
    static func basisGeneral(_ name: String) -> String { "This is general, not about \(name)." }
    static func fromMe(_ wording: String) -> String { "You shared: “\(wording)” Want to say that here?" }
    static func askLine(_ name: String) -> String { "You could ask \(name) how they like hard things raised." }
}

private extension View {
    /// A package 01 type style, tracked, scaling with Dynamic Type.
    func manrope(_ style: Tokens.TypeStyle, relativeTo textStyle: Font.TextStyle) -> some View {
        font(style.font(relativeTo: textStyle)).tracking(style.trackingPoints)
    }

    /// "‹ Keep mine" and "Use it ›": `label` at the top of its range (600, 14.5 pt). At 11 pt the accessibility
    /// audit reports the buttons' Dynamic Type as partially unsupported.
    func choiceLabel() -> some View {
        let label = Tokens.TypeScale.label
        Fonts.register()
        return font(Font.custom(Tokens.manropeFamily, size: label.size.upperBound, relativeTo: .body)
            .weight(.semibold))
    }
}

#if DEBUG
/// Flows in each pause state, reached through events as the app would. Used by previews, snapshots and the
/// `-screen pause-…` launch argument for the UI tests.
enum PauseFixtures {
    typealias F = WriteSendFlow
    static let jan = F.Person(id: "p-jan", name: "Jan")
    static let words = "You never listen when I talk about work."
    static let absolute = F.Highlight(
        original: "never", suggested: "didn't seem to", frictionKind: "absolute",
        whyLine: "Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost."
    )
    static let vague = F.Highlight(
        original: "listen", suggested: "listen", frictionKind: "vague_ask",
        whyLine: "This says something has to change; it does not yet say what you want them to do."
    )
    static let gift = F.FromMe(id: "item-1", wording: "When I go quiet I'm thinking, not upset.")

    static func pausing(_ highlights: [F.Highlight], fromMe: F.FromMe? = nil, theyShared: Bool = true) -> F {
        var f = F(person: jan)
        _ = f.handle(.entered)
        _ = f.handle(theyShared ? .personMapLoaded : .personMapFailed(.http(status: 403, error: "forbidden")))
        _ = f.handle(.wordsChanged(words))
        _ = f.handle(.typingPaused)
        _ = f.handle(.insightReturned(seq: f.seq, .insight(highlights: highlights, fromMe: fromMe)))
        _ = f.handle(.sendTapped)
        return f
    }

    /// A note card with TRY, a fromMe card after it.
    static var note: F { pausing([absolute], fromMe: gift) }
    /// The first card when Jan has shared nothing, with the ask line under the cards.
    static var noteSharedNothing: F { pausing([absolute], theyShared: false) }
    /// A vague_ask note: no TRY, only "Keep mine".
    static var noteNoTry: F { pausing([vague]) }
    static var fromMe: F {
        var f = pausing([absolute], fromMe: gift)
        _ = f.handle(.keepMine)
        return f
    }
    static var final: F {
        var f = pausing([absolute])
        _ = f.handle(.useIt)
        return f
    }

    static func named(_ name: String) -> F? {
        switch name {
        case "pause-note": note
        case "pause-noteSharedNothing": noteSharedNothing
        case "pause-noteNoTry": noteNoTry
        case "pause-fromMe": fromMe
        case "pause-final": final
        default: nil
        }
    }
}

/// Holds a flow for the previews and the UI tests, handing each event to it. Effects are not performed.
struct PauseFixtureHost: View {
    @State var flow: WriteSendFlow
    var body: some View {
        PauseScreen(flow: flow) { event in _ = flow.handle(event) }
    }
}

#Preview("Note") { PauseFixtureHost(flow: PauseFixtures.note) }
#Preview("Shared nothing") { PauseFixtureHost(flow: PauseFixtures.noteSharedNothing) }
#Preview("From me") { PauseFixtureHost(flow: PauseFixtures.fromMe) }
#Preview("Final") { PauseFixtureHost(flow: PauseFixtures.final) }
#endif
