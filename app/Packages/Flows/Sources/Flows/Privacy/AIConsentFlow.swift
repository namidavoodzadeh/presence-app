import Foundation

/// AI consent (packages/01/flows/privacy.md, first table). "asked" passes straight through to `.showing`.
public struct AIConsentFlow: Equatable, Sendable {
    public enum State: Equatable, Sendable { case showing, saving, given, declined, sessionEnded }

    public enum Event: Equatable, Sendable {
        case agreeTapped, notNowTapped, privacyTapped, turnOnTapped
        case consentSaved, consentSaveFailed(CallFailure)
        case meLoaded(given: String?, requiredVersion: String), meFailed(CallFailure)
    }

    public enum Effect: Equatable, Sendable {
        case call(Call)
        case openInSafari(URL)
        case resendTalkTurn(String)
        case rememberAIConsent(Bool)
        case endSession
    }

    public enum Call: Equatable, Sendable {
        case postConsent(version: String, providers: [String])
        case getMe
    }

    public static let providers = ["anthropic"]

    public private(set) var state: State = .showing
    public private(set) var requiredVersion: String
    /// Copy `aiConsent.notSaved`.
    public private(set) var showsNotSaved = false
    private var refusedTalkTurn: String?

    public init(requiredVersion: String, refusedTalkTurn: String? = nil) {
        self.requiredVersion = requiredVersion
        self.refusedTalkTurn = refusedTalkTurn
    }

    public mutating func handle(_ event: Event) -> [Effect] {
        switch (state, event) {
        case (.showing, .agreeTapped):
            state = .saving
            showsNotSaved = false
            return [.call(.postConsent(version: requiredVersion, providers: Self.providers))]

        case (.saving, .consentSaved):
            state = .given
            var effects: [Effect] = [.rememberAIConsent(true)]
            if let words = refusedTalkTurn {
                effects.append(.resendTalkTurn(words))
                refusedTalkTurn = nil   // sent again once
            }
            return effects

        case let (.saving, .consentSaveFailed(failure)):
            if failure.endsSession { return endSession() }
            state = .showing
            if case .http(status: 400, error: "invalid", _) = failure {
                return [.call(.getMe)]
            }
            showsNotSaved = true
            return []

        case (.showing, .notNowTapped):
            state = .declined
            return []

        case (.declined, .turnOnTapped):
            state = .showing
            return []

        case (.showing, .privacyTapped), (.saving, .privacyTapped):
            return [.openInSafari(privacyPolicyURL)]

        case let (.showing, .meLoaded(_, version)), let (.saving, .meLoaded(_, version)):
            requiredVersion = version
            return []

        case let (_, .meFailed(failure)) where state != .sessionEnded:
            // Gap (#14): a failed version check other than 401 leaves the same screen as it is.
            return failure.endsSession ? endSession() : []

        default:
            return []
        }
    }

    private mutating func endSession() -> [Effect] {
        state = .sessionEnded
        return [.endSession]
    }
}
