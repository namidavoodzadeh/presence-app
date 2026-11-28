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

    var body: some Scene {
        WindowGroup {
            root.testerReportButton()
        }
    }

    // The sign-in, Talk, You, Thread and Settings flows are injected with `api` as their screens land
    // (#13, #14, #15, #16, #18 on the surface of #21); until then the template stands.
    @MainActor @ViewBuilder private var root: some View {
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
