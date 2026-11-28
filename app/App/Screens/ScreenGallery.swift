#if DEBUG
import Flows
import SwiftUI
import DesignKit

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
        if name.hasPrefix("talk-"), let flow = TalkFixtures.named(String(name.dropFirst("talk-".count))) {
            GalleryTalk(flow: flow)
        } else {
            listed(name)
        }
    }

    @MainActor @ViewBuilder
    private static func listed(_ name: String) -> some View {
        switch name {
        case "you-loading": GalleryYou(list: .loading)
        case "you-empty": GalleryYou(list: .empty)
        case "you-failed": GalleryYou(list: .failed(LoadFailure(kind: .offline)))
        case "you-loaded": GalleryYou(list: .loaded(YouFixtures.groups))
        case "people-loading": GalleryPeople(list: .loading)
        case "people-empty": GalleryPeople(list: .empty)
        case "people-failed": GalleryPeople(list: .failed(LoadFailure(kind: .offline)))
        case "people-loaded": GalleryPeople(list: .loaded(PeopleFixtures.rows))
        case "signIn-signedOut": GallerySignIn(state: .signedOut)
        case "signIn-busy": GallerySignIn(state: .exchanging)
        case "signIn-failed": GallerySignIn(state: .signInFailed(.provider))
        case "signIn-underAge": GallerySignIn(state: .underAge)
        case "aiConsent-showing": GalleryAIConsent(flow: AIConsentFixtures.showing)
        case "aiConsent-saving": GalleryAIConsent(flow: AIConsentFixtures.saving)
        case "aiConsent-notSaved": GalleryAIConsent(flow: AIConsentFixtures.notSaved)
        case "safety-shown": GallerySafety(safety: SafetyFixtures.safety)
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

private struct GalleryPeople: View {
    let list: LoadState<[PeopleScreen.Row]>
    @State private var lastEvent = ""

    var body: some View {
        PeopleScreen(list: list) { event in lastEvent = "\(event)" }
            .overlay(alignment: .bottom) {
                Text(lastEvent)
                    .accessibilityIdentifier("gallery.lastEvent")
                    .accessibilityHidden(lastEvent.isEmpty)
            }
    }
}

/// Rows shaped like `GET /home`, most urgent first: a folded card, words started, nothing open.
enum PeopleFixtures {
    static let rows: [PeopleScreen.Row] = [
        PeopleScreen.Row(id: "p-jan", name: "Jan", line: .unread(when: "this morning"), time: "9:12", isNew: true),
        PeopleScreen.Row(id: "p-ben", name: "Ben", line: .draft, time: "Tuesday", isNew: false),
        PeopleScreen.Row(id: "p-ana", name: "Ana", line: .nothing, time: nil, isNew: false),
    ]
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

private struct GalleryTalk: View {
    let flow: TalkFlow
    @State private var lastEvent = ""

    var body: some View {
        TalkScreen(flow: flow, name: TalkFixtures.name, send: { event in lastEvent = "\(event)" },
                   turnOnAI: { lastEvent = "turnOnAI" })
            .overlay(alignment: .bottom) {
                Text(lastEvent)
                    .accessibilityIdentifier("gallery.lastEvent")
                    .accessibilityHidden(lastEvent.isEmpty)
            }
    }
}

private struct GallerySignIn: View {
    let state: SignInFlow.State
    @State private var lastEvent = ""

    var body: some View {
        SignInScreen(state: state) { event in lastEvent = "\(event)" }
            .overlay(alignment: .bottom) {
                Text(lastEvent)
                    .accessibilityIdentifier("gallery.lastEvent")
                    .accessibilityHidden(lastEvent.isEmpty)
            }
    }
}

private struct GalleryAIConsent: View {
    let flow: AIConsentFlow
    @State private var lastEvent = ""

    var body: some View {
        AIConsentScreen(flow: flow) { event in lastEvent = "\(event)" }
            .overlay(alignment: .bottom) {
                Text(lastEvent)
                    .accessibilityIdentifier("gallery.lastEvent")
                    .accessibilityHidden(lastEvent.isEmpty)
            }
    }
}

private struct GallerySafety: View {
    let safety: TalkFlow.Safety
    @State private var lastEvent = ""

    var body: some View {
        ZStack {
            Greenhouse()
            SafetyScreen(safety: safety) { event in lastEvent = "\(event)" }
        }
        .overlay(alignment: .bottom) {
            Text(lastEvent)
                .accessibilityIdentifier("gallery.lastEvent")
                .accessibilityHidden(lastEvent.isEmpty)
        }
    }
}

/// What a safety reply carries (`safety.message` and `resources`), with two resources.
enum SafetyFixtures {
    static let safety = TalkFlow.Safety(message: "You don't have to carry this alone. People are ready to listen, right now.", resources: [
        TalkFlow.Resource(label: "988 Suicide & Crisis Lifeline", url: "https://988lifeline.org"),
        TalkFlow.Resource(label: "Crisis Text Line", url: "https://www.crisistextline.org"),
    ])
}
#endif
