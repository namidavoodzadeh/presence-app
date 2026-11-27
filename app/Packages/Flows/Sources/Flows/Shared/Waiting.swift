import Foundation

/// What a view shows while a call is out (flows/README.md, "Waiting").
public enum WaitingPhase: Equatable, Sendable {
    case nothing
    case knot
    case unavailable
}

/// Nothing for the first 300 ms; then the knot, kept for at least 500 ms; after 10 s the view's unavailable line.
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
