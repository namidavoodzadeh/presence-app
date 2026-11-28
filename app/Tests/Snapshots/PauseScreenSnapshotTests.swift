import Flows
import SwiftUI
import XCTest
@testable import Presence

/// #33 `pause`: one snapshot per state behaviour.md lists (a note card, the fromMe card, final), in light, dark
/// and the largest text size; plus the note card when [Name] has shared nothing and the note with no TRY.
/// Written in the same session as the screen (#95); an independent test pass follows.
@MainActor
final class PauseScreenSnapshotTests: XCTestCase {
    private func render(_ flow: WriteSendFlow, _ name: String, file: StaticString = #filePath, line: UInt = #line) {
        let screen = PauseScreen(flow: flow, send: { _ in })
        assertSnapshot(screen.environment(\.colorScheme, .light), named: "pause-\(name)-light", file: file, line: line)
        assertSnapshot(screen.environment(\.colorScheme, .dark), named: "pause-\(name)-dark", file: file, line: line)
        assertSnapshot(screen.environment(\.colorScheme, .light).environment(\.dynamicTypeSize, .accessibility5),
                       named: "pause-\(name)-ax5", file: file, line: line)
    }

    func testNoteCard() { render(PauseFixtures.note, "note") }
    func testNoteCardSharedNothing() { render(PauseFixtures.noteSharedNothing, "noteSharedNothing") }
    func testNoteCardNoTry() { render(PauseFixtures.noteNoTry, "noteNoTry") }
    func testFromMeCard() { render(PauseFixtures.fromMe, "fromMe") }
    func testFinal() { render(PauseFixtures.final, "final") }

    /// The fixtures are in the states the snapshots name.
    func testFixturesAreInTheirStates() {
        XCTAssertEqual(PauseFixtures.note.state, .pausing(0))
        XCTAssertEqual(PauseFixtures.fromMe.state, .pausing(1))
        XCTAssertEqual(PauseFixtures.final.state, .final)
        XCTAssertTrue(PauseFixtures.noteSharedNothing.showsAskLine)
    }

    /// Every string the screen types is in copy.md `pause` (or `bar.foldAndSend`), byte for byte.
    func testStringsComeFromCopy() {
        XCTAssertEqual(PauseCopy.title, "Before it goes")
        XCTAssertEqual(PauseCopy.noteLabel, "HOW IT MAY LAND")
        XCTAssertEqual(PauseCopy.tryLabel, "TRY")
        XCTAssertEqual(PauseCopy.keepMine, "‹ Keep mine")
        XCTAssertEqual(PauseCopy.useIt, "Use it ›")
        XCTAssertEqual(PauseCopy.dotsA11y, "More after this one")
        XCTAssertEqual(PauseCopy.foldAndSend, "Fold and send")
        XCTAssertEqual(PauseCopy.trySuggested("x"), "“x”")
        XCTAssertEqual(PauseCopy.basisNothing("Jan"), "Jan hasn't shared anything yet, so this is based only on you.")
        XCTAssertEqual(PauseCopy.basisGeneral("Jan"), "This is general, not about Jan.")
        XCTAssertEqual(PauseCopy.fromMe("w"), "You shared: “w” Want to say that here?")
        XCTAssertEqual(PauseCopy.askLine("Jan"), "You could ask Jan how they like hard things raised.")
    }
}
