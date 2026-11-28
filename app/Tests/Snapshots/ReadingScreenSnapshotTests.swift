// Issue #32: acceptance tests for the `reading` screen, written in the same session as the screen (#95, owner 27 Nov).
// From packages/01 states.md (`reading`: loading, empty not used, failed, loaded) and copy.md (`thread` and `reading`).
import Flows
import SwiftUI
import XCTest
@testable import Presence

@MainActor
final class ReadingScreenSnapshotTests: XCTestCase {
    private enum Look: String, CaseIterable { case light, dark, largestText }

    private func assertAllLooks(_ state: LoadState<ReadingScreen.Reading>, named name: String,
                                file: StaticString = #filePath, line: UInt = #line) {
        for look in Look.allCases {
            let screen = ReadingScreen(state: state, send: { _ in })
            let view = switch look {
            case .light: AnyView(screen.environment(\.colorScheme, .light))
            case .dark: AnyView(screen.environment(\.colorScheme, .dark))
            case .largestText: AnyView(screen.environment(\.colorScheme, .light).environment(\.dynamicTypeSize, .accessibility5))
            }
            assertSnapshot(view, named: "reading-\(name)-\(look.rawValue)", file: file, line: line)
        }
    }

    func testLoading() { assertAllLooks(.loading, named: "loading") }
    func testEmpty() { assertAllLooks(.empty, named: "empty") }
    func testFailed() { assertAllLooks(.failed(LoadFailure(kind: .offline)), named: "failed") }
    func testLoaded() { assertAllLooks(.loaded(ReadingFixtures.reading), named: "loaded") }

    /// Every string the screen types is in copy.md, byte for byte; the words and the name come from the server.
    func testStringsComeFromCopy() {
        XCTAssertEqual(ReadingCopy.folded, "A card, folded")
        XCTAssertEqual(ReadingCopy.touch, "Touch to open")
        XCTAssertEqual(ReadingCopy.didntOpen, "Didn't open. Touch to try again.")
        XCTAssertEqual(ReadingCopy.wait, "Loading")
    }
}
