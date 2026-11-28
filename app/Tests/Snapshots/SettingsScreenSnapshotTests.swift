// Issue #24: acceptance tests for the `settings` screen, written in the same session as the screen (#95, owner 27 Nov).
// From packages/01 states.md (`settings`: loading, failed, loaded; no empty state), behaviour.md (open, confirming,
// busy) and copy.md (`settings`).
import DesignKit
import Flows
import SwiftUI
import XCTest
@testable import Presence

@MainActor
final class SettingsScreenSnapshotTests: XCTestCase {
    private enum Look: String, CaseIterable { case light, dark, largestText }

    private func assertAllLooks(_ state: SettingsFlow.State, ai: LoadState<Bool>, lastKnownAI: Bool? = nil,
                                showing line: SettingsFlow.Line? = nil, named name: String,
                                file: StaticString = #filePath, line sourceLine: UInt = #line) {
        for look in Look.allCases {
            let screen = SettingsSnapshotHost(state: state, ai: ai, lastKnownAI: lastKnownAI, line: line)
            let view = switch look {
            case .light: AnyView(screen.environment(\.colorScheme, .light))
            case .dark: AnyView(screen.environment(\.colorScheme, .dark))
            case .largestText: AnyView(screen.environment(\.colorScheme, .light).environment(\.dynamicTypeSize, .accessibility5))
            }
            assertSnapshot(view, named: "settings-\(name)-\(look.rawValue)", file: file, line: sourceLine)
        }
    }

    func testLoading() { assertAllLooks(.open, ai: .loading, lastKnownAI: true, named: "loading") }
    func testFailed() { assertAllLooks(.open, ai: .failed(LoadFailure(kind: .offline)), named: "failed") }
    func testLoaded() { assertAllLooks(.open, ai: .loaded(true), named: "loaded") }
    func testConfirming() { assertAllLooks(.confirming, ai: .loaded(true), named: "confirming") }
    func testBusy() { assertAllLooks(.exporting, ai: .loaded(true), named: "busy") }
    func testNotDeleted() { assertAllLooks(.confirming, ai: .loaded(true), showing: .notDeleted, named: "notDeleted") }
    func testExportFailed() { assertAllLooks(.open, ai: .loaded(false), showing: .exportFailed, named: "exportFailed") }

    /// Every string the screen types comes from packages/01/copy.md (`settings`, and `aiConsent.notSaved`).
    func testEveryStringComesFromCopy() throws {
        let copy = try Self.copyStrings()
        XCTAssertEqual(SettingsCopy.ai, copy["settings.ai"])
        XCTAssertEqual("\(SettingsCopy.aiOn) / \(SettingsCopy.aiOff)", copy["settings.aiOn` / `settings.aiOff"])
        XCTAssertEqual(SettingsCopy.privacy, copy["settings.privacy"])
        XCTAssertEqual(SettingsCopy.download, copy["settings.download"])
        XCTAssertEqual(SettingsCopy.logOut, copy["settings.logOut"])
        XCTAssertEqual(SettingsCopy.delete, copy["settings.delete"])
        XCTAssertEqual(SettingsCopy.close, copy["settings.close"])
        XCTAssertEqual(SettingsCopy.aiLine, copy["settings.ai.line"])
        XCTAssertEqual(SettingsCopy.confirmTitle, copy["settings.confirmTitle"])
        XCTAssertEqual(SettingsCopy.confirmBody, copy["settings.confirmBody"])
        XCTAssertEqual(SettingsCopy.confirmDelete, copy["settings.confirmDelete"])
        XCTAssertEqual(SettingsCopy.cancelDelete, copy["settings.cancelDelete"])
        XCTAssertEqual(SettingsCopy.notSaved, copy["aiConsent.notSaved"])
        XCTAssertEqual(SettingsCopy.notDeleted, copy["settings.notDeleted"])
        XCTAssertEqual(SettingsCopy.testAccount, copy["settings.testAccount"])
        XCTAssertEqual(SettingsCopy.exportFailed, copy["settings.exportFailed"])
    }

    /// `| \`id\` | String | Source |` rows of copy.md, by id.
    private static func copyStrings(file: String = #filePath) throws -> [String: String] {
        let root = URL(fileURLWithPath: file)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let text = try String(contentsOf: root.appendingPathComponent("packages/01/copy.md"), encoding: .utf8)
        var strings: [String: String] = [:]
        for row in text.split(separator: "\n") where row.hasPrefix("| `") {
            let cells = row.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
            guard cells.count >= 3 else { continue }
            strings[cells[1].trimmingCharacters(in: CharacterSet(charactersIn: "`"))] = cells[2]
        }
        return strings
    }
}

/// Settings over the base colour, as it is drawn over the clouded surface.
private struct SettingsSnapshotHost: View {
    let state: SettingsFlow.State
    let ai: LoadState<Bool>
    let lastKnownAI: Bool?
    let line: SettingsFlow.Line?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        SettingsScreen(state: state, ai: ai, lastKnownAI: lastKnownAI, line: line, send: { _ in })
            .background(Tokens.Colour.base.color(for: scheme).ignoresSafeArea())
    }
}
