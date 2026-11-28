import DesignKit
import Flows
import SwiftUI

@main
struct PresenceApp: App {
    init() { Fonts.register() }

    var body: some Scene {
        WindowGroup {
            root.testerReportButton()
        }
    }

    @MainActor @ViewBuilder private var root: some View {
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
