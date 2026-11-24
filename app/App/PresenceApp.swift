import DesignKit
import Flows
import SwiftUI

@main
struct PresenceApp: App {
    init() { Fonts.register() }

    var body: some Scene {
        WindowGroup {
            TemplateScreen(state: .loading, retry: {})
        }
    }
}
