// Issue #23: acceptance tests for the `aiConsent` screen, written in the same session as the screen (#95, owner 27 Nov).
// `aiConsent` has no server data of its own (states.md), so its states are the flow's (flows/privacy.md):
// showing, saving, and showing with the not-saved line. Strings from copy.md (`aiConsent`).
import Flows
import SwiftUI
import XCTest
@testable import Presence

@MainActor
final class AIConsentScreenSnapshotTests: XCTestCase {
    private enum Look: String, CaseIterable { case light, dark, largestText }

    private func assertAllLooks(_ flow: AIConsentFlow, named state: String,
                                file: StaticString = #filePath, line: UInt = #line) {
        for look in Look.allCases {
            let screen = AIConsentScreen(flow: flow, send: { _ in })
            let view = switch look {
            case .light: AnyView(screen.environment(\.colorScheme, .light))
            case .dark: AnyView(screen.environment(\.colorScheme, .dark))
            case .largestText: AnyView(screen.environment(\.colorScheme, .light).environment(\.dynamicTypeSize, .accessibility5))
            }
            assertSnapshot(view, named: "aiConsent-\(state)-\(look.rawValue)", file: file, line: line)
        }
    }

    func testShowing() { assertAllLooks(AIConsentFixtures.showing, named: "showing") }
    func testSaving() { assertAllLooks(AIConsentFixtures.saving, named: "saving") }
    func testNotSaved() { assertAllLooks(AIConsentFixtures.notSaved, named: "notSaved") }

    func testFixturesHoldTheStatesTheyName() {
        XCTAssertEqual(AIConsentFixtures.showing.state, .showing)
        XCTAssertFalse(AIConsentFixtures.showing.showsNotSaved)
        XCTAssertEqual(AIConsentFixtures.saving.state, .saving)
        XCTAssertEqual(AIConsentFixtures.notSaved.state, .showing)
        XCTAssertTrue(AIConsentFixtures.notSaved.showsNotSaved)
    }

    /// Every string the screen types comes from packages/01/copy.md (`aiConsent`).
    func testEveryStringComesFromCopy() throws {
        let copy = try Self.copyStrings()
        XCTAssertEqual(AIConsentCopy.title, copy["aiConsent.title"])
        XCTAssertEqual(AIConsentCopy.what, copy["aiConsent.what"])
        XCTAssertEqual(AIConsentCopy.not, copy["aiConsent.not"])
        XCTAssertEqual(AIConsentCopy.off, copy["aiConsent.off"])
        XCTAssertEqual(AIConsentCopy.ai, copy["aiConsent.ai"])
        XCTAssertEqual(AIConsentCopy.agree, copy["aiConsent.agree"])
        XCTAssertEqual(AIConsentCopy.notNow, copy["aiConsent.notNow"])
        XCTAssertEqual(AIConsentCopy.privacy, copy["aiConsent.privacy"])
        XCTAssertEqual(AIConsentCopy.notSaved, copy["aiConsent.notSaved"])
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
