import DesignKit
import Flows
import SwiftUI

@main
struct PresenceApp: App {
    /// The real client the flows' calls run on (#108). Nil only when the build carries no API base or anon key,
    /// which release.yml refuses to archive.
    private let api: APIClient?

    init() {
        Fonts.register()
        api = (try? AppConfiguration.fromBundle()).map { APIClient(configuration: $0) }
    }

    /// `-surface YES` on launch opens the surface (#21). Without it the app still opens on the template screen
    /// that the launch journey checks, until the routing issue (sign-in, AI consent, Talk) makes Talk the home.
    private static var opensSurface: Bool { UserDefaults.standard.bool(forKey: "surface") }

    var body: some Scene {
        WindowGroup {
            root.testerReportButton()
        }
    }

    // The sign-in, Talk, You, Thread and Settings flows are injected with `api` as their screens land
    // (#13, #14, #15, #16, #18 on the surface of #21); until then the template stands.
    @MainActor @ViewBuilder private var root: some View {
        if Self.opensSurface {
            SurfaceRoot()
        } else {
            #if DEBUG
            if let name = ScreenGallery.requested {
                ScreenGallery.view(name)
            } else {
                TemplateScreen(state: api == nil ? .failed(LoadFailure(kind: .server, canRetry: false)) : .loading, retry: {})
            }
            #else
            TemplateScreen(state: api == nil ? .failed(LoadFailure(kind: .server, canRetry: false)) : .loading, retry: {})
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
