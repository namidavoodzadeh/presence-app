import Foundation

/// How a call the app made on a flow's behalf failed. Shared by every flow (packages/01/flows/README.md).
public enum CallFailure: Equatable, Sendable {
    case http(status: Int, error: String? = nil, reason: String? = nil)
    case offline
    case timeout

    /// A 401 on any call ends the session.
    public var endsSession: Bool {
        if case .http(status: 401, _, _) = self { return true }
        return false
    }
}

/// kenember.com/privacy, opened in Safari from `aiConsent.privacy` and `settings.privacy`.
let privacyPolicyURL = URL(string: "https://kenember.com/privacy")!
