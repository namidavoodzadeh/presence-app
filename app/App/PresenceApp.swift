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
        if let name = ScreenGallery.requested {
            ScreenGallery.view(name)
        } else {
            TemplateScreen(state: .loading, retry: {})
        }
        #else
        TemplateScreen(state: .loading, retry: {})
        #endif
    }
}
