import DesignKit
import Flows
import SwiftUI

@main
struct PresenceApp: App {
    init() { Fonts.register() }

    /// `-surface YES` on launch opens the surface (#21). Without it the app still opens on the template screen
    /// that the launch journey checks, until the routing issue (sign-in, AI consent, Talk) makes Talk the home.
    private static var opensSurface: Bool { UserDefaults.standard.bool(forKey: "surface") }

    var body: some Scene {
        WindowGroup {
            root.testerReportButton()
        }
    }

    @MainActor @ViewBuilder private var root: some View {
        if Self.opensSurface {
            SurfaceRoot()
        } else {
            #if DEBUG
            // `-screen pause-note` (and the other pause fixture names) opens one pause state, for the UI tests.
            if let name = UserDefaults.standard.string(forKey: "screen"), let flow = PauseFixtures.named(name) {
                PauseFixtureHost(flow: flow)
            } else if let name = ScreenGallery.requested {
                ScreenGallery.view(name)
            } else {
                TemplateScreen(state: .loading, retry: {})
            }
            #else
            TemplateScreen(state: .loading, retry: {})
            #endif
        }
    }
}

/// The surface with no view content of its own yet: each view's screen fills its slot in its own issue.
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
