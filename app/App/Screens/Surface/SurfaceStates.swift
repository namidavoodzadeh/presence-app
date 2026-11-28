import DesignKit
import Flows
import SwiftUI

/// packages/01/states.md, "Shared look": what every view on the surface shows while it loads and when it fails.
/// Centred where the content will appear; the greenhouse, curtain and talk bar stay usable around it.

/// loading: nothing for the first 300 ms, then the knot; after 10 s the view's unavailable line replaces it
/// while the call goes on. (Holding the knot at least 500 ms is the view's flow: `Waiting.mayHideKnot`.)
struct WaitingKnot: View {
    let unavailable: String
    @State private var phase: WaitingPhase
    private let runsClock: Bool

    /// `phase` fixes the look (previews and snapshots); without it the clock runs from `.nothing`.
    init(unavailable: String, phase: WaitingPhase? = nil) {
        self.unavailable = unavailable
        _phase = State(initialValue: phase ?? .nothing)
        runsClock = phase == nil
    }

    var body: some View {
        Group {
            switch phase {
            case .nothing:
                Color.clear.accessibilityHidden(true)
            case .knot:
                Knot(label: SurfaceCopy.wait)
            case .unavailable:
                UnavailableLine(text: unavailable)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            guard runsClock else { return }
            try? await Task.sleep(for: .seconds(Waiting.showKnotAfter))
            phase = Waiting.phase(elapsed: Waiting.showKnotAfter)
            try? await Task.sleep(for: .seconds(Waiting.unavailableAfter - Waiting.showKnotAfter))
            phase = Waiting.phase(elapsed: Waiting.unavailableAfter)
        }
    }
}

/// failed: the view's unavailable line where the content would be, and "Try again" under it as a quiet word.
/// No codes and no Ref. `retryId` is `<view>.retry`; with no retry (a 403 not open), no Try again.
struct UnavailableLine: View {
    @Environment(\.colorScheme) private var scheme
    let text: String
    var retryId: String?
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: Space.s) {
            Text(text)
                .typeStyle(Tokens.TypeScale.reply)
                .foregroundStyle(Tokens.Colour.ink.color(for: scheme))
                .multilineTextAlignment(.center)
            if let retry, let retryId {
                Button(SurfaceCopy.retry, action: retry)
                    .typeStyle(Tokens.TypeScale.label, relativeTo: .subheadline)
                    .foregroundStyle(Tokens.Colour.inkSoft.color(for: scheme))
                    .frame(minWidth: Tokens.minTarget, minHeight: Tokens.minTarget)
                    .accessibilityIdentifier(retryId)
            }
        }
        .padding(.horizontal, Space.l)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// One `LoadState`, all four cases, no `default`: the shared loading and failed looks around a view's own
/// empty and loaded content. A failure that can't be retried shows `notOpen` when the view gives one.
struct SurfaceLoad<Value: Sendable, Empty: View, Loaded: View>: View {
    let state: LoadState<Value>
    /// The view's unavailable line (`you.unavailable`, `people.unavailable`, …).
    let unavailable: String
    var notOpen: String?
    /// `<view>.retry`.
    let retryId: String
    let retry: () -> Void
    @ViewBuilder let empty: () -> Empty
    @ViewBuilder let loaded: (Value) -> Loaded
    /// Fixes the loading look for previews and snapshots.
    var waitingPhase: WaitingPhase?

    var body: some View {
        switch state {
        case .loading:
            WaitingKnot(unavailable: unavailable, phase: waitingPhase)
        case .empty:
            empty()
        case let .failed(failure):
            if failure.canRetry {
                UnavailableLine(text: unavailable, retryId: retryId, retry: retry)
            } else {
                UnavailableLine(text: notOpen ?? unavailable)
            }
        case let .loaded(value):
            loaded(value)
        }
    }
}
