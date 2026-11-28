import DesignKit
import Flows
import SwiftUI

@main
struct PresenceApp: App {
    /// Where the app opens (#128): sign-in, AI consent, then the surface with Talk. It holds the one `APIClient`
    /// (#108). Nil only when the build carries no API base or anon key, which release.yml refuses to archive.
    @State private var root: AppRoot?

    init() {
        Fonts.register()
        guard let configuration = try? AppConfiguration.fromBundle() else { return }
        #if DEBUG
        if JourneyFixture.isOn {
            _root = State(initialValue: AppRoot(
                context: HostContext(api: JourneyFixture.api(configuration: configuration)),
                provider: JourneyFixture.provider
            ))
            return
        }
        #endif
        _root = State(initialValue: AppRoot(
            context: HostContext(api: APIClient(configuration: configuration)),
            provider: AppleSignIn.provider
        ))
    }

    var body: some Scene {
        WindowGroup {
            content.testerReportButton()
        }
    }

    @MainActor @ViewBuilder private var content: some View {
        #if DEBUG
        // `-screen pause-note` (and the other pause fixture names) opens one pause state, `-screen <name>` one gallery
        // screen, and `-surface YES` the bare surface (#21), for the UI tests.
        if let name = UserDefaults.standard.string(forKey: "screen"), let flow = PauseFixtures.named(name) {
            PauseFixtureHost(flow: flow)
        } else if let name = ScreenGallery.requested {
            ScreenGallery.view(name)
        } else if UserDefaults.standard.bool(forKey: "surface") {
            SurfaceRoot()
        } else {
            routed
        }
        #else
        routed
        #endif
    }

    @MainActor @ViewBuilder private var routed: some View {
        if let root {
            AppRootView(root: root)
        } else {
            TemplateScreen(state: .failed(LoadFailure(kind: .server, canRetry: false)), retry: {})
        }
    }
}

#if DEBUG
/// The surface with no view content of its own (#21), for its journey tests: each slot is empty.
struct SurfaceRoot: View {
    @State private var model = SurfaceModel(SurfaceFlow(firstLaunch: true))

    var body: some View {
        Surface(model: model) { view in
            Color.clear
                .testerScreen(view)
        }
    }
}

private extension View {
    func testerScreen(_ view: SurfaceFlow.View) -> some View {
        switch view {
        case .talk: AnyView(testerScreen("talk"))
        case .you: AnyView(testerScreen("you"))
        case .people: AnyView(testerScreen("people"))
        case .thread: AnyView(testerScreen("thread"))
        }
    }
}
#endif
