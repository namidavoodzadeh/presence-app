import Flows
import SwiftUI

/// Tester tooling (#61), not product. `TESTER_REPORT` is set for the Debug and TestFlight configurations
/// in app/project.yml and never for Release, so no App Store build contains the Report button.
enum TesterReportBuild {
    #if TESTER_REPORT
    static let compiledIn = true
    #else
    static let compiledIn = false
    #endif

    #if DEBUG
    static let isDebug = true
    #else
    static let isDebug = false
    #endif

    /// `-testerReport YES` on launch (launch arguments land in the argument domain of UserDefaults).
    static var launchFlag: Bool { UserDefaults.standard.bool(forKey: "testerReport") }

    static var isShown: Bool {
        TesterReportGate.isShown(compiledIn: compiledIn, debugBuild: isDebug, launchFlag: launchFlag)
    }

    /// View changes and API calls for the report. Exists in every build; costs twenty short strings.
    static let log = TesterLog()
}

extension View {
    /// Records that this screen is showing, for the tester report's `screen` and log. Use a fixed name
    /// (`talk`, `you`, `people`, `thread`, …), never anything a person wrote.
    func testerScreen(_ name: StaticString) -> some View {
        onAppear { TesterReportBuild.log.record(.view("\(name)")) }
    }

    /// Puts the red Report button above this scene's windows when the build allows it.
    func testerReportButton() -> some View {
        #if TESTER_REPORT
        background(TesterReportInstaller().accessibilityHidden(true))
        #else
        self
        #endif
    }
}
