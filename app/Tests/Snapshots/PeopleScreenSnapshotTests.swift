// Issue #29: acceptance tests for the `people` screen, written in the same session as the screen (#95, owner 27 Nov).
// From packages/01 states.md (`people`: loading, empty, failed, loaded), copy.md (`people`) and behaviour.md (the row's
// VoiceOver line).
import Flows
import SwiftUI
import XCTest
@testable import Presence

@MainActor
final class PeopleScreenSnapshotTests: XCTestCase {
    private enum Look: String, CaseIterable { case light, dark, largestText }

    private func assertAllLooks(_ list: LoadState<[PeopleScreen.Row]>, named state: String,
                                file: StaticString = #filePath, line: UInt = #line) {
        for look in Look.allCases {
            let screen = PeopleScreen(list: list, send: { _ in })
            let view = switch look {
            case .light: AnyView(screen.environment(\.colorScheme, .light))
            case .dark: AnyView(screen.environment(\.colorScheme, .dark))
            case .largestText: AnyView(screen.environment(\.colorScheme, .light).environment(\.dynamicTypeSize, .accessibility5))
            }
            assertSnapshot(view, named: "people-\(state)-\(look.rawValue)", file: file, line: line)
        }
    }

    func testLoading() { assertAllLooks(.loading, named: "loading") }
    func testEmpty() { assertAllLooks(.empty, named: "empty") }
    func testFailed() { assertAllLooks(.failed(LoadFailure(kind: .offline)), named: "failed") }
    func testLoaded() { assertAllLooks(.loaded(PeopleFixtures.rows), named: "loaded") }

    /// Every string the screen types comes from packages/01/copy.md (`people`, and `wait.a11y`).
    func testEveryStringComesFromCopy() throws {
        let copy = try Self.copyStrings()
        XCTAssertEqual(PeopleCopy.title, copy["people.title"])
        XCTAssertEqual(PeopleCopy.lineUnread, copy["people.lineUnread"])
        XCTAssertEqual(PeopleCopy.lineDraft, copy["people.lineDraft"])
        XCTAssertEqual(PeopleCopy.lineNothing, copy["people.lineNothing"])
        XCTAssertEqual(PeopleCopy.new, copy["people.new"])
        XCTAssertEqual(PeopleCopy.unavailable, copy["people.unavailable"])
        XCTAssertEqual(PeopleCopy.retry, copy["people.retry"])
        XCTAssertEqual(PeopleCopy.waiting, copy["wait.a11y"])
        XCTAssertEqual(copy["people.row.a11y"], "[Name], [line], [time]; plus \"new\" when the dot shows")
    }

    /// behaviour.md: VoiceOver reads a row as "[Name], [line], [time]", plus "new" when the dot shows.
    func testRowReadsAsOneLine() {
        let rows = PeopleFixtures.rows
        XCTAssertEqual(PeopleCopy.a11y(rows[0]), "Jan, A card, folded, from this morning, 9:12, new")
        XCTAssertEqual(PeopleCopy.a11y(rows[1]), "Ben, You started writing, Tuesday")
        XCTAssertEqual(PeopleCopy.a11y(rows[2]), "Ana, Nothing open")
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
