import Flows
import Foundation

/// Where the app opens (flows/sign-in.md): sign-in while signed out, AI consent when the flow asks, then the surface
/// with Talk as home. A session ending (a 401, log out) returns to sign-in, keeping any words in the bar.
@MainActor @Observable
final class AppRoot {
    enum Screen: Equatable {
        /// Launching, or a resumed session on its way to the surface: nothing of sign-in shows.
        case waiting
        case signIn
        case aiConsent
        case surface
    }

    private(set) var signIn: SignInHost
    private(set) var consent: AIConsentHost?
    private(set) var surface: SurfaceHost?
    @ObservationIgnored let context: HostContext
    @ObservationIgnored private let provider: SignInProvider
    @ObservationIgnored private var aiConsentGiven = true
    @ObservationIgnored private var firstLaunch = true
    /// The fresh sign-in after a session ended, launching (tests wait on it).
    @ObservationIgnored private(set) var restarting: Task<Void, Never>?

    init(context: HostContext, provider: SignInProvider) {
        self.context = context
        self.provider = provider
        signIn = SignInHost(context: context, provider: provider)
        context.keepWords = { [weak context] words in
            context?.defaults.set(words, forKey: HostContext.Keys.keptWords)
        }
        follow(signIn)
    }

    var screen: Screen {
        if surface != nil { return .surface }
        if consent != nil { return .aiConsent }
        return signIn.showsSignIn ? .signIn : .waiting
    }

    /// `session.launch()` through the sign-in flow; the session keeper tells the root when a session ends.
    func start() async {
        await context.api.session.whenEnded { [weak self] in
            Task { @MainActor in self?.sessionEnded() }
        }
        await signIn.start()
    }

    // MARK: Following the sign-in flow

    private func follow(_ host: SignInHost) {
        host.changed = { [weak self] state in self?.signInChanged(state) }
    }

    private func signInChanged(_ state: SignInFlow.State) {
        switch state {
        case let .aiConsent(requiredVersion):
            guard consent == nil else { return }
            let host = AIConsentHost(context: context, requiredVersion: requiredVersion)
            host.answered = { [weak self] given in
                self?.aiConsentGiven = given
                self?.signIn.send(.consentAnswered)
            }
            consent = host
        case .opened:
            // The invite flow (flows/invite.md) is not built yet: an invite link opens Talk too (#128).
            consent = nil
            guard surface == nil else { return }
            let kept = context.defaults.string(forKey: HostContext.Keys.keptWords)
            context.defaults.removeObject(forKey: HostContext.Keys.keptWords)
            surface = SurfaceHost(context: context, aiConsentGiven: aiConsentGiven, firstLaunch: firstLaunch, keptWords: kept)
            firstLaunch = false
        case .launching, .signedOut, .checkingAge, .appleSheet, .googleSheet, .underAge, .exchanging, .signInFailed,
             .checkingConsent:
            break
        }
    }

    /// The session ended: back to sign-in. The bar's words stay on the phone for the next surface.
    func sessionEnded() {
        if let words = surface?.model.flow.words, !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            context.keepWords(words)
        }
        surface = nil
        consent = nil
        aiConsentGiven = true
        let fresh = SignInHost(context: context, provider: provider)
        follow(fresh)
        signIn = fresh
        restarting = Task { await fresh.start() }
    }
}
