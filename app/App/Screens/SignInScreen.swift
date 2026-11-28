import AuthenticationServices
import DesignKit
import Flows
import SwiftUI

/// packages/01 `signIn`: Sign in (not drawn; built simply, Q1).
/// Draws the state `SignInFlow` holds and sends its events; no flow logic and no network calls here.
/// The view has no server data of its own (states.md): its failure lines are flow states, so it holds no `LoadState`.
struct SignInScreen: View {
    let state: SignInFlow.State
    let send: (SignInFlow.Event) -> Void

    @Environment(\.colorScheme) private var scheme
    /// Apple and Google the same size (Q1), growing with the text size.
    @ScaledMetric(relativeTo: .headline) private var buttonHeight = Tokens.minTarget + Space.s

    var body: some View {
        ZStack {
            // The greenhouse's base. Its glow and curtain gradients fail the accessibility audit's contrast check
            // for text drawn straight on them, so the text sits on the flat base, as on You.
            Tokens.Colour.base.color(for: scheme).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Space.l) {
                    Text(SignInCopy.line)
                        .font(Tokens.TypeScale.greeting.font(relativeTo: .largeTitle))
                        .foregroundStyle(ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("signIn.line")
                        .padding(.top, Space.xxl)
                    content
                    footer
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, CGFloat(Tokens.Row.sideInset))
                .padding(.vertical, Space.l)
            }
        }
        .testerScreen("signIn")
    }

    private var ink: Color { Tokens.Colour.ink.color(for: scheme) }

    /// Controls are dimmed while the age check runs, a provider sheet is open or the exchange is on its way.
    static func isDimmed(_ state: SignInFlow.State) -> Bool {
        switch state {
        case .checkingAge, .appleSheet, .googleSheet, .exchanging, .checkingConsent: true
        case .launching, .signedOut, .underAge, .signInFailed, .aiConsent, .opened: false
        }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .signedOut:
            providers(dimmed: false)
        case .checkingAge, .appleSheet, .googleSheet, .exchanging, .checkingConsent:
            providers(dimmed: true)
        case .signInFailed(let failure):
            VStack(alignment: .leading, spacing: Space.m) {
                VStack(alignment: .leading, spacing: Space.xs) {
                    line(SignInCopy.failed(failure), id: "signIn.failed")
                    Button { send(.retryTapped) } label: {
                        Text(SignInCopy.retry)
                            .font(Tokens.TypeScale.rowName.font(relativeTo: .headline))
                            .foregroundStyle(ink)
                            .frame(minWidth: CGFloat(Tokens.minTarget), minHeight: CGFloat(Tokens.minTarget), alignment: .leading)
                    }
                    .buttonStyle(SignInButtonStyle())
                    .accessibilityIdentifier("signIn.retry")
                }
                providers(dimmed: false)
            }
        case .underAge:
            line(SignInCopy.underAge, id: "signIn.underAge")
        case .launching, .aiConsent, .opened:
            // Not this screen's states: the app shows the screen they lead to.
            EmptyView()
        }
    }

    private func providers(dimmed: Bool) -> some View {
        VStack(alignment: .leading, spacing: Space.m) {
            AppleButton(scheme: scheme, enabled: !dimmed) { send(.appleTapped) }
                .disabled(dimmed)
                .frame(maxWidth: .infinity)
                .frame(height: buttonHeight)
                .opacity(dimmed ? Tokens.dimmedOpacity : 1)
            Button { send(.googleTapped) } label: {
                Text(SignInCopy.google)
                    .font(Tokens.TypeScale.rowName.font(relativeTo: .headline))
                    .foregroundStyle(ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, minHeight: buttonHeight)
                    .background(glass)
            }
            .buttonStyle(SignInButtonStyle())
            .disabled(dimmed)
            .opacity(dimmed ? Tokens.dimmedOpacity : 1)
            .accessibilityIdentifier("signIn.google")
            line(SignInCopy.adult, id: "signIn.adult")
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(SignInCopy.ai)
                .font(Tokens.TypeScale.rowLine.font(relativeTo: .subheadline))
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("signIn.ai")
            let dimmed = Self.isDimmed(state)
            Button { send(.privacyTapped) } label: {
                Text(SignInCopy.privacy)
                    .font(Tokens.TypeScale.rowName.font(relativeTo: .headline))
                    .foregroundStyle(ink)
                    .underline()
                    .frame(minWidth: CGFloat(Tokens.minTarget), minHeight: CGFloat(Tokens.minTarget), alignment: .leading)
            }
            .buttonStyle(SignInButtonStyle())
            .disabled(dimmed)
            .opacity(dimmed ? Tokens.dimmedOpacity : 1)
            .accessibilityIdentifier("signIn.privacy")
        }
    }

    /// The quiet glass of a row (as You's rows): fill and edge, no shadow over the lines below.
    private var glass: some View {
        RoundedRectangle(cornerRadius: CGFloat(Tokens.Row.radius), style: .continuous)
            .fill(Tokens.Colour.glassFill.color(for: scheme))
            .overlay(
                RoundedRectangle(cornerRadius: CGFloat(Tokens.Row.radius), style: .continuous)
                    .strokeBorder(Tokens.Colour.glassEdge.color(for: scheme), lineWidth: CGFloat(Tokens.HandDrawn.stroke.lowerBound))
            )
    }

    private func line(_ text: String, id: String) -> some View {
        Text(text)
            .font(Tokens.TypeScale.message.font())
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(id)
    }
}

/// A plain label that SwiftUI does not fade when disabled: the screen dims with `Tokens.dimmedOpacity`, which keeps
/// the text at 4.5:1 (the plain style's own fade does not).
private struct SignInButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.contentShape(Rectangle())
    }
}

/// Apple's own Sign in with Apple control. A tap only tells the flow; the flow asks for the sheet (`presentApple`).
private struct AppleButton: UIViewRepresentable {
    let scheme: ColorScheme
    let enabled: Bool
    let tap: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(tap: tap) }

    func makeUIView(context: Context) -> UIView {
        let holder = UIView()
        holder.backgroundColor = .clear
        install(in: holder, context: context)
        return holder
    }

    func updateUIView(_ holder: UIView, context: Context) {
        context.coordinator.tap = tap
        if context.coordinator.scheme != scheme { install(in: holder, context: context) }
        if let button = context.coordinator.button { show(enabled: enabled, on: button) }
    }

    /// Apple's button does not report itself dimmed to accessibility, so the holder speaks for it:
    /// one element with Apple's own label, the button trait, and "dimmed" while the flow is busy.
    private func show(enabled: Bool, on button: ASAuthorizationAppleIDButton) {
        button.isEnabled = enabled
        button.isAccessibilityElement = false
        guard let holder = button.superview else { return }
        holder.isAccessibilityElement = true
        holder.accessibilityLabel = button.accessibilityLabel
        holder.accessibilityTraits = enabled ? .button : [.button, .notEnabled]
        holder.accessibilityIdentifier = "signIn.apple"
    }

    /// The button's style is fixed when it is made, so a change of light and dark makes a new one.
    private func install(in holder: UIView, context: Context) {
        holder.subviews.forEach { $0.removeFromSuperview() }
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: scheme == .dark ? .white : .black)
        button.cornerRadius = CGFloat(Tokens.Row.radius)
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        holder.addSubview(button)
        show(enabled: enabled, on: button)
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: holder.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: holder.trailingAnchor),
            button.topAnchor.constraint(equalTo: holder.topAnchor),
            button.bottomAnchor.constraint(equalTo: holder.bottomAnchor),
        ])
        context.coordinator.button = button
        context.coordinator.scheme = scheme
    }

    final class Coordinator: NSObject {
        var tap: () -> Void
        var button: ASAuthorizationAppleIDButton?
        var scheme: ColorScheme?
        init(tap: @escaping () -> Void) { self.tap = tap }
        @objc func tapped() { tap() }
    }
}

/// packages/01/copy.md, `signIn` and `signIn`, age.
enum SignInCopy {
    static let line = "Say hard things the way you mean them."
    static let adult = "Kenember is for adults. By continuing, you confirm you're 18 or over."
    static let ai = "Kenember is an AI, not a person."
    static let privacy = "Privacy"
    static let providerFailed = "That sign-in didn't go through."
    static let serverFailed = "Signing in didn't finish."
    static let offline = "You're offline."
    static let retry = "Try again"
    static let underAge = "Kenember is for adults, so it can't be used on this account."
    /// `signIn.google`: Google's own button text (copy.md source: system). Apple's control draws its own.
    static let google = "Sign in with Google"

    static func failed(_ failure: SignInFlow.SignInFailure) -> String {
        switch failure {
        case .provider: providerFailed
        case .server: serverFailed
        case .offline: offline
        }
    }
}

#Preview("Signed out") { SignInScreen(state: .signedOut, send: { _ in }) }
#Preview("Exchanging") { SignInScreen(state: .exchanging, send: { _ in }) }
#Preview("Failed") { SignInScreen(state: .signInFailed(.server), send: { _ in }) }
#Preview("Under age") { SignInScreen(state: .underAge, send: { _ in }) }
