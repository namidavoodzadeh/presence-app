import XCTest
@testable import Flows

/// #33: the pause shows each note's `why_line` (copy `pause.noteWhy`, server text), so the flow must keep it.
final class WriteSendWhyLineTests: XCTestCase {
    typealias F = WriteSendFlow

    func test_aNoteKeepsTheServersWhyLine() {
        let why = "Always and never tend to be heard as a verdict on the whole person, so the one time you mean can get lost."
        var f = F(person: F.Person(id: "p-jan", name: "Jan"))
        _ = f.handle(.entered)
        _ = f.handle(.personMapLoaded)
        _ = f.handle(.wordsChanged("You never listen when I talk about work."))
        _ = f.handle(.typingPaused)
        _ = f.handle(.insightReturned(seq: f.seq, .insight(
            highlights: [F.Highlight(original: "never", suggested: "didn't", frictionKind: "absolute", whyLine: why)],
            fromMe: nil)))
        XCTAssertEqual(f.notes.first?.whyLine, why)
        _ = f.handle(.sendTapped)
        guard case let .note(note)? = f.pauseCards.first else { return XCTFail("the pause shows the note") }
        XCTAssertEqual(note.whyLine, why)
    }
}
