import Foundation

/// How a call the app performed for a flow failed. Calls are effects; their answers come back as events.
public enum CallFailure: Error, Equatable, Sendable {
    case http(status: Int, error: String? = nil, reason: String? = nil)
    case offline
    case timeout

    /// flows/README.md: a 401 on any call ends the session.
    public var endsSession: Bool {
        if case .http(401, _, _) = self { return true }
        return false
    }

    /// The same as `endsSession` (the name some flows use).
    public var isUnauthorized: Bool { endsSession }

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

public enum Haptic: Equatable, Sendable {
    /// `lightTap`: listening starts (behaviour.md, Haptics).
    case doubleSoftPulse, firm, lightTap, softTick
}

public enum WaitingPhase: Equatable, Sendable {
    case nothing, knot, unavailable
}

/// flows/README.md, Waiting: nothing for 300 ms, then the knot for at least 500 ms; after 10 s the unavailable line.
public enum Waiting {
    public static let showKnotAfter: TimeInterval = 0.3
    public static let knotMinimum: TimeInterval = 0.5
    public static let unavailableAfter: TimeInterval = 10

    public static func phase(elapsed: TimeInterval) -> WaitingPhase {
        if elapsed >= unavailableAfter { return .unavailable }
        if elapsed >= showKnotAfter { return .knot }
        return .nothing
    }

    public static func mayHideKnot(shownFor: TimeInterval) -> Bool {
        shownFor >= knotMinimum
    }
}

extension CallFailure {
    /// The 403 code, when there is one (`feature_off`, `owner_only`, `ai_consent_required`).
    public var forbiddenReason: String? {
        if case let .http(403, _, reason) = self { return reason }
        return nil
    }

    /// 403 `feature_off` or `owner_only`: the feature is not open for this account.
    public var isNotOpen: Bool {
        forbiddenReason == "feature_off" || forbiddenReason == "owner_only"
    }
}
