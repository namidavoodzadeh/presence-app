import Foundation

/// How an injected call failed. Every flow takes the answer of a call back as an event carrying this.
public enum CallFailure: Error, Equatable, Sendable {
    case http(status: Int, error: String? = nil, reason: String? = nil)
    case offline
    case timeout

    /// A 401 from any call ends the session (flows/README.md).
    public var endsSession: Bool {
        if case .http(status: 401, _, _) = self { return true }
        return false
    }

    /// The failure a screen may show. A 403 `feature_off` or `owner_only` is "not open": no Try again.
    public var loadFailure: LoadFailure {
        switch self {
        case .offline, .timeout:
            return LoadFailure(kind: .offline)
        case let .http(status, _, reason):
            if status == 403, reason == "feature_off" || reason == "owner_only" {
                return LoadFailure(kind: .notAllowed, canRetry: false)
            }
            return LoadFailure(kind: .server)
        }
    }
}

/// The haptics a flow asks the app to play.
public enum Haptic: Equatable, Sendable {
    case doubleSoftPulse
    case firm
    case softTick
}
