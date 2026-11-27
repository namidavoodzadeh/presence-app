import Foundation

/// How a call the app performed for a flow failed. Shared by every flow: calls are effects the app performs,
/// and their answers come back to the flow as events.
public enum CallFailure: Error, Equatable, Sendable {
    /// The server answered with a non-2xx status. `error` is the body's `error` code, `reason` its `reason`.
    case http(status: Int, error: String? = nil, reason: String? = nil)
    case offline
    case timeout

    /// A 401 from any call ends the session (flows/README.md).
    public var isUnauthorized: Bool {
        if case .http(status: 401, _, _) = self { return true }
        return false
    }
}
