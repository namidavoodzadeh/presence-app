import DesignKit
import Flows
import SwiftUI

/// packages/01 `reading`: the first reading (P3). Their words and their name, nothing else.
/// Draws the state its flow holds and sends its events; no flow logic and no network calls here.
///
/// The thread flow (#19, `ThreadFlow`) is not built yet, so the screen takes the `POST /bridges/:id/open` result as
/// one `LoadState` and sends events named as in #19's tests (`cardTouched`, `touchedAnywhere`). The host maps them.
struct ReadingScreen: View {
    /// What the reading shows: `final` from `POST /bridges/:id/open` and the sender's first name.
    struct Reading: Equatable, Sendable {
        let words: String
        let name: String
    }

    enum Event: Equatable {
        /// The folded card was touched: open it (again, after "Didn't open").
        case cardTouched
        /// A touch anywhere during the reading: the first reading ends.
        case touchedAnywhere
    }

    let state: LoadState<Reading>
    let send: (Event) -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack {
            Greenhouse(camera: Tokens.Greenhouse.cameraThread)
            GeometryReader { proxy in
                ScrollView {
                    content
                        .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                        .padding(.horizontal, CGFloat(Tokens.Row.sideInset))
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { if case .loaded = state { send(.touchedAnywhere) } }
        .testerScreen("reading")
    }

    private var ink: Color { Tokens.Colour.ink.color(for: scheme) }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            // The open call is under way: the card stays folded, with the knot beside "Touch to open".
            card { folded(waiting: true) }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("reading.card")
        case .empty:
            // Not used by the package for `reading`; the card stays folded and opens on a touch.
            Button { send(.cardTouched) } label: { card { folded(waiting: false) } }
                .buttonStyle(.plain)
                .accessibilityIdentifier("reading.card")
        case .failed(let failure):
            if failure.canRetry {
                Button { send(.cardTouched) } label: {
                    VStack(alignment: .leading, spacing: Space.m) {
                        card { folded(waiting: false) }
                        Text(ReadingCopy.didntOpen)
                            .font(Tokens.TypeScale.message.font())
                            .foregroundStyle(ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("reading.didntOpen")
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("reading.card")
            } else {
                card { folded(waiting: false) }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("reading.card")
            }
        case .loaded(let reading):
            Button { send(.touchedAnywhere) } label: {
                card {
                    VStack(alignment: .leading, spacing: Space.l) {
                        Text(reading.words)
                            .font(Tokens.TypeScale.cardWords.font())
                            .foregroundStyle(ink)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(reading.name)
                            .font(Tokens.TypeScale.rowName.font(relativeTo: .headline))
                            .foregroundStyle(ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("reading.card")
        }
    }

    /// The folded card's face: "A card, folded", and "Touch to open" with the knot beside it while it opens.
    private func folded(waiting: Bool) -> some View {
        VStack(alignment: .leading, spacing: Space.m) {
            Text(ReadingCopy.folded)
                .font(Tokens.TypeScale.cardWords.font())
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Space.s) {
                if waiting {
                    Knot(label: ReadingCopy.wait)
                        .accessibilityIdentifier("reading.loading")
                }
                Text(ReadingCopy.touch)
                    .font(Tokens.TypeScale.message.font())
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// One glass card, at most 84% of the width (tokens.md `card`).
    private func card<Content: View>(@ViewBuilder _ inside: () -> Content) -> some View {
        inside()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Space.l)
            .glass(radius: Tokens.Card.radius.lowerBound)
            .containerRelativeFrame(.horizontal) { width, _ in width * Tokens.Card.maxWidthFraction }
            .contentShape(Rectangle())
    }
}

/// packages/01/copy.md, `thread` and `reading` (and `wait.a11y`). Byte for byte.
/// `reading.words` and `reading.name` are the server's `final` and [Name]; the screen types nothing else.
enum ReadingCopy {
    static let folded = "A card, folded"
    static let touch = "Touch to open"
    static let didntOpen = "Didn't open. Touch to try again."
    static let wait = "Loading"
}

#if DEBUG
/// A reading shaped like `POST /bridges/:id/open` for Jan's card.
enum ReadingFixtures {
    static let reading = ReadingScreen.Reading(
        words: "I went quiet last night because I didn't know how to say it. I'm not upset with you. Can we talk tonight?",
        name: "Jan"
    )
}
#endif
