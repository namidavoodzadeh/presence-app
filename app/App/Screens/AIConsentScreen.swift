import DesignKit
import Flows
import SwiftUI

/// packages/01 `aiConsent`: before Kenember's AI reads your words (not drawn; built simply, Q6).
/// One glass card over the greenhouse: what is sent and to whom, what is never done with it, how to turn it off;
/// "Not now" and "Agree and continue" the same size, nothing pre-chosen (behaviour.md).
/// Draws the state `AIConsentFlow` holds and sends its events; no flow logic and no network calls here.
/// No server data of its own (states.md), so no `LoadState`.
struct AIConsentScreen: View {
    let flow: AIConsentFlow
    let send: (AIConsentFlow.Event) -> Void

    @Environment(\.colorScheme) private var scheme

    private var saving: Bool { flow.state == .saving }

    var body: some View {
        ZStack {
            Greenhouse()
            ScrollView {
                card
                    .padding(.horizontal, Tokens.Bar.sideInset)
                    .padding(.vertical, Space.xl)
                    .frame(maxWidth: .infinity)
            }
        }
        .testerScreen("aiConsent")
    }

    private var ink: Color { Tokens.Colour.ink.color(for: scheme) }

    private var card: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            Text(AIConsentCopy.title)
                .typeStyle(Tokens.TypeScale.heading, relativeTo: .largeTitle)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("aiConsent.title")
            line(AIConsentCopy.what, id: "aiConsent.what")
            line(AIConsentCopy.not, id: "aiConsent.not")
            line(AIConsentCopy.off, id: "aiConsent.off")
            line(AIConsentCopy.ai, id: "aiConsent.ai")
            if flow.showsNotSaved {
                Text(AIConsentCopy.notSaved)
                    .typeStyle(Tokens.TypeScale.rowName, relativeTo: .headline)
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("aiConsent.notSaved")
            }
            Button { send(.privacyTapped) } label: {
                Text(AIConsentCopy.privacy)
                    .typeStyle(Tokens.TypeScale.rowLine, relativeTo: .subheadline)
                    .underline()
                    .foregroundStyle(ink)
                    .frame(minWidth: Tokens.minTarget, minHeight: Tokens.minTarget, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
            .accessibilityIdentifier("aiConsent.privacy")
            VStack(spacing: Space.s) {
                choice(AIConsentCopy.agree, id: "aiConsent.agree") { send(.agreeTapped) }
                choice(AIConsentCopy.notNow, id: "aiConsent.notNow") { send(.notNowTapped) }
            }
        }
        .padding(Space.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(pane(radius: Tokens.Card.radius.upperBound))
    }

    /// The glass as one even pane: the base under the glass fill, with the glass edge. The blurred, graded glass
    /// lets the greenhouse glow through unevenly behind the words, and the contrast audit misreads ink on it
    /// (measured 9.9:1 in the simulator, flagged all the same); an even pane reads the same to people and to the audit.
    private func pane(radius: Double) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return shape.fill(Tokens.Colour.base.color(for: scheme))
            .overlay(shape.fill(Tokens.Colour.glassFill.color(for: scheme)))
            .overlay(shape.stroke(Tokens.Colour.glassEdge.color(for: scheme), lineWidth: Tokens.Glass.topEdge))
    }

    private func line(_ text: String, id: String) -> some View {
        Text(text)
            .typeStyle(Tokens.TypeScale.message)
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(id)
    }

    /// Agree and Not now: the same size and the same look, so neither is pre-chosen. Dimmed while saving:
    /// the pane fades and the control is disabled; the words keep full ink so they stay readable.
    private func choice(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .typeStyle(Tokens.TypeScale.rowName, relativeTo: .headline)
                .foregroundStyle(ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, Tokens.Row.paddingHorizontal)
                .padding(.vertical, Tokens.Row.paddingVertical)
                .frame(maxWidth: .infinity, minHeight: Tokens.minTarget)
                .background(pane(radius: Tokens.Row.radius).opacity(saving ? Tokens.Colour.inkFaint.day.opacity : 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(ChoiceStyle())
        .disabled(saving)
        .accessibilityIdentifier(id)
    }
}

/// Draws the label as it is: `.plain` greys a disabled label below the contrast the audit asks for.
private struct ChoiceStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label }
}

/// packages/01/copy.md, `aiConsent`. `declinedLine` and `turnOn` are drawn by Talk, not here.
enum AIConsentCopy {
    static let title = "Before Kenember's AI reads your words"
    static let what = "When you talk or write here, your words go to Anthropic's Claude so Kenember can reply and offer notes."
    static let not = "Kenember never uses your words to train AI, never sells them and never uses them for ads. Speech is turned into text on this iPhone; no audio is sent."
    static let off = "You can turn this off in Settings at any time. What you kept stays until you delete it."
    static let ai = "Kenember is an AI, not a person."
    static let agree = "Agree and continue"
    static let notNow = "Not now"
    static let privacy = "Privacy"
    static let notSaved = "Not saved. Try again."
}

/// Flows in each state the view draws: showing, saving, and showing with the not-saved line.
enum AIConsentFixtures {
    static let version = "2026-11"

    static var showing: AIConsentFlow { AIConsentFlow(requiredVersion: version) }

    static var saving: AIConsentFlow {
        var flow = showing
        _ = flow.handle(.agreeTapped)
        return flow
    }

    static var notSaved: AIConsentFlow {
        var flow = saving
        _ = flow.handle(.consentSaveFailed(.offline))
        return flow
    }
}

#Preview("Showing") { AIConsentScreen(flow: AIConsentFixtures.showing, send: { _ in }) }
#Preview("Saving") { AIConsentScreen(flow: AIConsentFixtures.saving, send: { _ in }) }
#Preview("Not saved") { AIConsentScreen(flow: AIConsentFixtures.notSaved, send: { _ in }) }
