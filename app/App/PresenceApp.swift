import DesignKit
import Flows
import SwiftUI

@main
struct PresenceApp: App {
    init() { Fonts.register() }

    var body: some Scene {
        WindowGroup {
            root
                .testerReportButton()
        }
    }

    @ViewBuilder private var root: some View {
        #if DEBUG
        // `-screen pause-note` (and the other fixture names) opens one screen in a fixed state, for the UI tests.
        if let name = UserDefaults.standard.string(forKey: "screen"), let flow = PauseFixtures.named(name) {
            PauseFixtureHost(flow: flow)
        } else {
            TemplateScreen(state: .loading, retry: {})
        }
        #else
        TemplateScreen(state: .loading, retry: {})
        #endif
    }
}
