// Issue #27: acceptance tests for the `you` screen, written in the same session as the screen (#95, owner 27 Nov).
// From packages/01 states.md (`you`: loading, empty, failed, loaded) and copy.md (`you`).
import Flows
import SwiftUI
import XCTest
@testable import Presence

@MainActor
final class YouScreenSnapshotTests: XCTestCase {
    private enum Look: String, CaseIterable { case light, dark, largestText }

    private func assertAllLooks(_ list: LoadState<[YouFlow.Group]>, named state: String,
                                file: StaticString = #filePath, line: UInt = #line) {
        for look in Look.allCases {
            let screen = YouScreen(list: list, send: { _ in })
            let view = switch look {
            case .light: AnyView(screen.environment(\.colorScheme, .light))
            case .dark: AnyView(screen.environment(\.colorScheme, .dark))
            case .largestText: AnyView(screen.environment(\.colorScheme, .light).environment(\.dynamicTypeSize, .accessibility5))
            }
            assertSnapshot(view, named: "you-\(state)-\(look.rawValue)", file: file, line: line)
        }
    }

    func testLoading() { assertAllLooks(.loading, named: "loading") }
    func testEmpty() { assertAllLooks(.empty, named: "empty") }
    func testFailed() { assertAllLooks(.failed(LoadFailure(kind: .offline)), named: "failed") }
    func testLoaded() { assertAllLooks(.loaded(YouFixtures.groups), named: "loaded") }

    /// Items are numbered across the whole list, so each `you.item.N` is unique.
    func testItemsAreNumberedAcrossGroups() {
        let firsts = YouScreen.numbered(YouFixtures.groups).map(\.firstIndex)
        XCTAssertEqual(firsts, [0, 2, 3])
    }

    /// Every string the screen types comes from packages/01/copy.md (`you`, and `wait.a11y`).
    func testEveryStringComesFromCopy() throws {
        let copy = try Self.copyStrings()
        XCTAssertEqual(YouCopy.title, copy["you.title"])
        XCTAssertEqual(YouCopy.line, copy["you.line"])
        XCTAssertEqual(YouCopy.empty, copy["you.empty"])
        XCTAssertEqual(YouCopy.talk, copy["you.talk"])
        XCTAssertEqual(YouCopy.unavailable, copy["you.unavailable"])
        XCTAssertEqual(YouCopy.retry, copy["you.retry"])
        XCTAssertEqual(YouCopy.waiting, copy["wait.a11y"])
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
