import Contract
import Flows
import Foundation

/// What Sign in with Apple and the age check answered. The live one is `AppleSignIn`; the Debug journey stubs it.
@MainActor
struct SignInProvider {
    enum AppleOutcome: Equatable, Sendable {
        case credential(SignInFlow.AppleCredential)
        case cancelled
        case failed
    }

    /// compliance.md: Declared Age Range at the gate, where available; otherwise `.notDeclared` and the 18+ statement stands.
    var ageRange: (_ gate: Int) async -> SignInFlow.AgeAnswer
    /// Apple's sheet, given the SHA-256 of the raw nonce.
    var apple: (_ nonceSHA256: String) async -> AppleOutcome
}

/// Hosts `SignInFlow` (flows/sign-in.md): sends the screen's events to the flow, performs the calls and the sheets the
/// flow asks for, and feeds each answer back as an event. Where the app opens is the flow's state.
@MainActor @Observable
final class SignInHost {
    /// No `ai_consent` on `GET /me` means this server does not gate (lead decision on #128, until #8 is live): the
    /// flow hears that what was given matches what is required, so the app opens on Talk. Once the contract carries
    /// `ai_consent`, its `given` and `required_version` are passed instead.
    static let notGated = "not-gated"

    private(set) var flow = SignInFlow()
    /// The launch found a stored session: nothing of sign-in shows while the app routes.
    private(set) var resuming = false
    /// Called after every event, so the root can follow the flow to AI consent or the surface.
    @ObservationIgnored var changed: (SignInFlow.State) -> Void = { _ in }
    @ObservationIgnored let tasks = HostTasks()
    @ObservationIgnored private let context: HostContext
    @ObservationIgnored private let provider: SignInProvider

    init(context: HostContext, provider: SignInProvider) {
        self.context = context
        self.provider = provider
    }

    /// `launching`: the flow is made with the stored session, if any, and launched.
    func start() async {
        let stored = await context.api.session.current
        resuming = stored != nil
        flow = SignInFlow(
            storedRefreshToken: stored?.refreshToken,
            pendingInvite: context.defaults.string(forKey: HostContext.Keys.pendingInvite)
        )
        send(.launched)
    }

    /// Whether the sign-in screen shows: not while launching, nor while a resumed session routes.
    var showsSignIn: Bool {
        switch flow.state {
        case .launching: false
        case .checkingConsent: !resuming
        case .signedOut, .checkingAge, .appleSheet, .googleSheet, .underAge, .exchanging, .signInFailed: true
        case .aiConsent, .opened: false
        }
    }

    func send(_ event: SignInFlow.Event) {
        let effects = flow.handle(event)
        if case .signedOut = flow.state { resuming = false }
        for effect in effects { perform(effect) }
        changed(flow.state)
    }

    private func perform(_ effect: SignInFlow.Effect) {
        let api = context.api
        switch effect {
        case let .call(call):
            perform(call, api: api)
        case let .requestAgeRange(gate):
            tasks.run { [provider] in
                let answer = await provider.ageRange(gate)
                self.send(.ageAnswered(answer))
            }
        case let .presentApple(nonceSHA256):
            tasks.run { [provider] in
                switch await provider.apple(nonceSHA256) {
                case let .credential(credential): self.send(.appleCredential(credential))
                case .cancelled: self.send(.providerCancelled)
                case .failed: self.send(.providerFailed)
                }
            }
        case .presentGoogle:
            // Package gap (#128): no Google SDK in the app and `POST /auth/google` is not in the contract (staging
            // only, routes.md "Not ready" 5). The sheet cannot open, so the flow hears the provider failed.
            tasks.run { self.send(.providerFailed) }
        case .storeSession:
            // `APIClient.signInWithApple` and the session keeper already keep the session in the Keychain.
            break
        case let .keepPendingInvite(code):
            context.defaults.set(code, forKey: HostContext.Keys.pendingInvite)
        case .endSession:
            tasks.run { [context] in await context.endSession() }
        case let .openInSafari(url):
            context.open(url)
        }
    }

    private func perform(_ call: SignInFlow.Call, api: APIClient) {
        switch call {
        case .refreshSession:
            tasks.run {
                switch await api.session.launch() {
                case .signedIn:
                    guard let session = await api.session.current else { return self.send(.refreshRefused) }
                    self.send(.refreshSucceeded(SignInFlow.Session(
                        accessToken: session.accessToken,
                        refreshToken: session.refreshToken,
                        expiresAt: ISO8601DateFormatter().string(from: session.expiresAt),
                        personId: ""
                    )))
                case .signedOut:
                    self.send(.refreshRefused)
                }
            }
        case let .authApple(request):
            tasks.run { [context] in
                let result = await api.signInWithApple(
                    identityToken: request.identityToken,
                    nonce: request.nonce,
                    name: request.name,
                    authorizationCode: request.authorizationCode,
                    adultConfirmed: request.adultConfirmed
                )
                switch result {
                case let .success(reply):
                    context.firstName = reply.me.person.name.firstWord
                    self.send(.exchangeSucceeded(SignInFlow.Session(
                        accessToken: reply.access_token,
                        refreshToken: reply.refresh_token,
                        expiresAt: reply.expires_at ?? "",
                        personId: reply.me.person.id
                    )))
                case let .failure(failure):
                    self.send(.exchangeFailed(failure))
                }
            }
        case .authGoogle:
            tasks.run { self.send(.exchangeFailed(APIClient.routeNotInContract)) }
        case .getMe:
            tasks.run { [context] in
                switch await api.getMe() {
                case let .success(reply):
                    context.firstName = reply.me.person.name.firstWord
                    self.send(.meLoaded(given: Self.notGated, requiredVersion: Self.notGated))
                case let .failure(failure):
                    self.send(.meFailed(failure))
                }
            }
        }
    }
}

/// Hosts the AI-consent part of the Privacy flow (flows/privacy.md, first table).
@MainActor @Observable
final class AIConsentHost {
    private(set) var flow: AIConsentFlow
    /// Called once the person agreed (true, after the server confirmed) or chose Not now (false).
    @ObservationIgnored var answered: (Bool) -> Void = { _ in }
    /// `resendTalkTurn`: the words Talk was refused for go again once.
    @ObservationIgnored var resend: (String) -> Void = { _ in }
    @ObservationIgnored let tasks = HostTasks()
    @ObservationIgnored private let context: HostContext

    init(context: HostContext, requiredVersion: String, refusedTalkTurn: String? = nil) {
        self.context = context
        flow = AIConsentFlow(requiredVersion: requiredVersion, refusedTalkTurn: refusedTalkTurn)
    }

    func send(_ event: AIConsentFlow.Event) {
        let before = flow.state
        for effect in flow.handle(event) { perform(effect) }
        guard flow.state != before else { return }
        switch flow.state {
        case .given: answered(true)
        case .declined: answered(false)
        case .showing, .saving, .sessionEnded: break
        }
    }

    private func perform(_ effect: AIConsentFlow.Effect) {
        let api = context.api
        switch effect {
        case .call(.postConsent):
            // Package gap (#128): `POST /consent/ai` is not in the contract and has no handler yet (#8). Nothing is
            // sent; the flow hears it did not save, so nothing shows as agreed that the server has not confirmed.
            tasks.run { self.send(.consentSaveFailed(APIClient.routeNotInContract)) }
        case .call(.getMe):
            tasks.run {
                // The reply carries no `ai_consent` yet, so there is no version to read; only a failure is news.
                if case let .failure(failure) = await api.getMe() { self.send(.meFailed(failure)) }
            }
        case let .openInSafari(url):
            context.open(url)
        case let .resendTalkTurn(words):
            resend(words)
        case let .rememberAIConsent(given):
            context.defaults.set(given, forKey: HostContext.Keys.aiConsent)
        case .endSession:
            tasks.run { [context] in await context.endSession() }
        }
    }
}
