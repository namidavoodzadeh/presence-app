import Foundation

/// The one shape for anything a screen loads from the server.
/// Screens switch over all four cases with no `default`, so a missing state fails the build.
public enum LoadState<Value: Sendable>: Sendable {
    case loading
    case empty
    case failed(LoadFailure)
    case loaded(Value)
}

/// What the screen may show about a failure. Never an empty or saved state.
public struct LoadFailure: Error, Equatable, Sendable {
    public enum Kind: Equatable, Sendable { case offline, server, notAllowed, unreadable }
    public let kind: Kind
    public let canRetry: Bool
    public init(kind: Kind, canRetry: Bool = true) {
        self.kind = kind
        self.canRetry = canRetry
    }
}

extension LoadState: Equatable where Value: Equatable {}

public extension LoadState where Value: Collection {
    /// Build from a fetched collection: an empty collection is `.empty`, never `.loaded([])`.
    static func from(_ items: Value) -> LoadState {
        items.isEmpty ? .empty : .loaded(items)
    }
}

/// A write is `saved` only after the server confirms.
public enum SaveState: Equatable, Sendable {
    case idle
    case saving
    case saved
    case failed(LoadFailure)
}
