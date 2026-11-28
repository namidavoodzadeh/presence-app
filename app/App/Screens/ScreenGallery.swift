#if DEBUG
import DesignKit
import Flows
import SwiftUI

/// Debug builds only: UI tests open one screen in a fixed state with `-screen <name>-<state>`.
/// The last event the screen sent shows in `gallery.lastEvent`, so a test can see a control was reached.
enum ScreenGallery {
    /// The value after `-screen` in the launch arguments, if any.
    static var requested: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let at = args.firstIndex(of: "-screen"), args.indices.contains(at + 1) else { return nil }
        return args[at + 1]
    }

    @MainActor @ViewBuilder
    static func view(_ name: String) -> some View {
        switch name {
        case "you-loading": GalleryYou(list: .loading)
        case "you-empty": GalleryYou(list: .empty)
        case "you-failed": GalleryYou(list: .failed(LoadFailure(kind: .offline)))
        case "you-loaded": GalleryYou(list: .loaded(YouFixtures.groups))
        case "settings-loading": GallerySettings(state: .open, ai: .loading, lastKnownAI: true)
        case "settings-failed": GallerySettings(state: .open, ai: .failed(LoadFailure(kind: .offline)))
        case "settings-loaded": GallerySettings(state: .open, ai: .loaded(true))
        case "settings-off": GallerySettings(state: .open, ai: .loaded(false))
        case "settings-confirming": GallerySettings(state: .confirming, ai: .loaded(true))
        case "settings-exporting": GallerySettings(state: .exporting, ai: .loaded(true))
        default: Text(name)
        }
    }
}

private struct GalleryYou: View {
    let list: LoadState<[YouFlow.Group]>
    @State private var lastEvent = ""

    var body: some View {
        YouScreen(list: list) { event in lastEvent = "\(event)" }
            .overlay(alignment: .bottom) {
                Text(lastEvent)
                    .accessibilityIdentifier("gallery.lastEvent")
                    .accessibilityHidden(lastEvent.isEmpty)
            }
    }
}

private struct GallerySettings: View {
    let state: SettingsFlow.State
    let ai: LoadState<Bool>
    var lastKnownAI: Bool?
    @State private var lastEvent = ""
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        SettingsScreen(state: state, ai: ai, lastKnownAI: lastKnownAI) { event in lastEvent = "\(event)" }
            .background(Tokens.Colour.base.color(for: scheme).ignoresSafeArea())
            .overlay(alignment: .bottom) {
                Text(lastEvent)
                    .accessibilityIdentifier("gallery.lastEvent")
                    .accessibilityHidden(lastEvent.isEmpty)
            }
    }
}

/// A list shaped like `GET /comm/items`: groups in the You order, newest first inside a kind.
enum YouFixtures {
    static let groups: [YouFlow.Group] = [
        YouFlow.Group(kind: "how_i_mean", heading: "How I mean things", items: [
            YouFlow.Item(id: "b1", kind: "how_i_mean", wording: "When I go quiet, I'm thinking, not upset."),
            YouFlow.Item(id: "b2", kind: "how_i_mean", wording: "\"Fine\" from me usually means fine."),
        ]),
        YouFlow.Group(kind: "feels_like_care", heading: "What feels like care", items: [
            YouFlow.Item(id: "b3", kind: "feels_like_care", wording: "A message in the morning, even a short one."),
        ]),
        YouFlow.Group(kind: "lands_hard", heading: "What lands hard", items: [
            YouFlow.Item(id: "b4", kind: "lands_hard", wording: "Being told I'm overreacting."),
        ]),
    ]
}
#endif
