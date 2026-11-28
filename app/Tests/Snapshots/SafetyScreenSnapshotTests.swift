// Issue #34: acceptance tests for the `safety` screen, written in the same session as the screen (#95, owner 27 Nov).
// From packages/01 states.md (`safety` has no server data of its own: it shows what the triggering reply carried)
// and copy.md (`safety`).
import DesignKit
import Flows
import SwiftUI
import XCTest
@testable import Presence

@MainActor
final class SafetyScreenSnapshotTests: XCTestCase {
    private enum Look: String, CaseIterable { case light, dark, largestText }

    private func assertAllLooks(_ safety: TalkFlow.Safety, named state: String,
                                file: StaticString = #filePath, line: UInt = #line) {
        for look in Look.allCases {
            let screen = ZStack { Greenhouse(); SafetyScreen(safety: safety, send: { _ in }) }
            let view = switch look {
            case .light: AnyView(screen.environment(\.colorScheme, .light))
            case .dark: AnyView(screen.environment(\.colorScheme, .dark))
            case .largestText: AnyView(screen.environment(\.colorScheme, .light).environment(\.dynamicTypeSize, .accessibility5))
            }
            assertSnapshot(view, named: "safety-\(state)-\(look.rawValue)", file: file, line: line)
        }
    }

    func testShown() { assertAllLooks(SafetyFixtures.safety, named: "shown") }

    /// Every string the screen types comes from packages/01/copy.md (`safety`); the rest is the server's.
    func testEveryStringComesFromCopy() throws {
        let copy = try Self.copyStrings()
        XCTAssertEqual(SafetyCopy.close, copy["safety.close"])
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
