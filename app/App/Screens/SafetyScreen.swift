import DesignKit
import Flows
import SwiftUI

/// packages/01 `safety`: the safety stop, shared by Talk, the pause and Someone new (law 8). Not drawn; built simply (Q2):
/// one glass card with the triggering reply's message, its help links and Close.
/// Draws what the flow holds and sends its events; no flow logic and no network calls here. The flow that shows it
/// maps `resourceTapped(N)` to opening the resource in Safari and `closeTapped` to going on as it says (behaviour.md).
/// It appears at once with no transition; no hand-drawn touch and no apricot on it.
struct SafetyScreen: View {
    enum Event: Equatable {
        case resourceTapped(Int)
        case closeTapped
    }

    /// What the triggering reply carried: `safety.message`, `line` or `resources.message`, and the resources.
    let safety: TalkFlow.Safety
    let send: (Event) -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.l) {
                Text(safety.message)
                    .font(Tokens.TypeScale.message.font())
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("safety.message")
                VStack(alignment: .leading, spacing: CGFloat(Tokens.Row.gap)) {
                    ForEach(Array(safety.resources.enumerated()), id: \.offset) { index, resource in
                        button(resource.label, id: "safety.resource.\(index)") { send(.resourceTapped(index)) }
                            .accessibilityAddTraits(.isLink)
                    }
                }
                button(SafetyCopy.close, id: "safety.close") { send(.closeTapped) }
            }
            .padding(CGFloat(Tokens.Row.paddingHorizontal))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(card)
            .padding(.horizontal, CGFloat(Tokens.Row.sideInset))
            .padding(.vertical, Space.xxl)
        }
        .transaction { $0.animation = nil }
    }

    private var ink: Color { Tokens.Colour.ink.color(for: scheme) }

    private func button(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Tokens.TypeScale.rowName.font(relativeTo: .headline))
                .foregroundStyle(ink)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: CGFloat(Tokens.minTarget), alignment: .leading)
                .padding(.horizontal, CGFloat(Tokens.Row.paddingHorizontal))
                .padding(.vertical, CGFloat(Tokens.Row.paddingVertical))
                .background(row)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    /// One control's row: the glass fill and edge, solid, on the card.
    private var row: some View {
        RoundedRectangle(cornerRadius: CGFloat(Tokens.Row.radius), style: .continuous)
            .fill(Tokens.Colour.glassFill.color(for: scheme))
            .overlay(
                RoundedRectangle(cornerRadius: CGFloat(Tokens.Row.radius), style: .continuous)
                    .stroke(Tokens.Colour.glassEdge.color(for: scheme), lineWidth: CGFloat(Tokens.Glass.topEdge))
            )
    }

    /// The glass card: the glass fill and edge on the base colour, solid rather than the live blur or a gradient,
    /// so the words of a safety stop sit on one known colour (contrast) and render the same every time.
    private var card: some View {
        RoundedRectangle(cornerRadius: CGFloat(Tokens.Card.radius.lowerBound), style: .continuous)
            .fill(Tokens.Colour.base.color(for: scheme))
            .overlay(RoundedRectangle(cornerRadius: CGFloat(Tokens.Card.radius.lowerBound), style: .continuous)
                .fill(Tokens.Colour.glassFill.color(for: scheme)))
            .overlay(
                RoundedRectangle(cornerRadius: CGFloat(Tokens.Card.radius.lowerBound), style: .continuous)
                    .stroke(Tokens.Colour.glassEdge.color(for: scheme), lineWidth: CGFloat(Tokens.Glass.topEdge))
            )
    }
}

/// packages/01/copy.md, `safety`. The message and the resource labels come from the server.
enum SafetyCopy {
    static let close = "Close"
}

#Preview("Shown") {
    ZStack {
        Greenhouse()
        SafetyScreen(safety: TalkFlow.Safety(message: "You don't have to carry this alone.", resources: [
            TalkFlow.Resource(label: "988 Suicide & Crisis Lifeline", url: "https://988lifeline.org"),
        ]), send: { _ in })
    }
}
