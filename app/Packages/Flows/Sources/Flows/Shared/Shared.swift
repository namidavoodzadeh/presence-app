import Foundation

/// How a call failed, as the app reports it back to a flow.
/// A 403 carries its code in `reason` (`feature_off`, `owner_only`, `ai_consent_required`).
public enum CallFailure: Equatable, Sendable {
    case http(status: Int, error: String? = nil, reason: String? = nil)
    case offline
    case timeout

    /// 401 on any call ends the session (flows/README.md).
    var isUnauthorized: Bool {
        if case .http(401, _, _) = self { return true }
        return false
    }

    /// The 403 code, when there is one.
    var forbiddenReason: String? {
        if case let .http(403, _, reason) = self { return reason }
        return nil
    }

    /// 403 `feature_off` or `owner_only`: the feature is not open for this account.
    var isNotOpen: Bool {
        forbiddenReason == "feature_off" || forbiddenReason == "owner_only"
    }
}

/// The only haptics the app plays (behaviour.md).
public enum Haptic: Equatable, Sendable {
    case doubleSoftPulse, firm, softTick
}

public enum WaitingPhase: Equatable, Sendable {
    case nothing, knot, unavailable
}

/// The shared waiting rule (flows/README.md, states.md): nothing for 300 ms, then the knot for at least 500 ms,
/// and after 10 s the unavailable line while the call goes on.
public enum Waiting {
    public static let showKnotAfter: TimeInterval = 0.3
    public static let knotMinimum: TimeInterval = 0.5
    public static let unavailableAfter: TimeInterval = 10

    public static func phase(elapsed: TimeInterval) -> WaitingPhase {
        if elapsed < showKnotAfter { return .nothing }
        if elapsed < unavailableAfter { return .knot }
        return .unavailable
    }

    public static func mayHideKnot(shownFor: TimeInterval) -> Bool {
        shownFor >= knotMinimum
    }
}
