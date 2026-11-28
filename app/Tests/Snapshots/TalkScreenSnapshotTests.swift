// Issue #25: acceptance tests for the `talk` screen, written in the same session as the screen (#95, owner 27 Nov).
// From packages/01 states.md (`talk`, opening and a turn), behaviour.md (`talk`) and copy.md (`talk`).
import Flows
import SwiftUI
import XCTest
@testable import Presence

@MainActor
final class TalkScreenSnapshotTests: XCTestCase {
    private enum Look: String, CaseIterable { case light, dark, largestText }

    private func assertAllLooks(_ flow: TalkFlow, notice: TalkScreen.Notice? = nil, named state: String,
                                file: StaticString = #filePath, line: UInt = #line) {
        for look in Look.allCases {
            let screen = TalkScreen(
                flow: flow, name: TalkFixtures.name, now: TalkFixtures.now, calendar: TalkFixtures.calendar,
                notice: notice, waitingPhase: .knot, send: { _ in }, turnOnAI: {}
            )
            let view = switch look {
            case .light: AnyView(screen.environment(\.colorScheme, .light))
            case .dark: AnyView(screen.environment(\.colorScheme, .dark))
            case .largestText: AnyView(screen.environment(\.colorScheme, .light).environment(\.dynamicTypeSize, .accessibility5))
            }
            assertSnapshot(view, named: "talk-\(state)-\(look.rawValue)", file: file, line: line)
        }
    }

    // loading (opening, and a turn on its way)
    func testOpening() { assertAllLooks(TalkFixtures.opening, named: "opening") }
    func testSending() { assertAllLooks(TalkFixtures.sending, named: "sending") }
    // loaded (first open, a conversation, a suggestion, kept)
    func testReady() { assertAllLooks(TalkFixtures.ready, named: "ready") }
    func testConversation() { assertAllLooks(TalkFixtures.conversation, named: "conversation") }
    func testSuggesting() { assertAllLooks(TalkFixtures.suggesting, named: "suggesting") }
    func testKept() { assertAllLooks(TalkFixtures.conversation, notice: .kept(.init(partlyFailed: false, notSharedWith: [])), named: "kept") }
    // failed (a turn that didn't go through, the limit, not open); empty is not used (states.md)
    func testTurnFailed() { assertAllLooks(TalkFixtures.turnFailed, named: "turnFailed") }
    func testLimited() { assertAllLooks(TalkFixtures.limited, named: "limited") }
    func testNotOpen() { assertAllLooks(TalkFixtures.notOpen, named: "notOpen") }
    // AI consent declined (privacy.md)
    func testDeclined() { assertAllLooks(TalkFixtures.declined, named: "declined") }

    /// Messages and replies are numbered separately, so `talk.message.N` and `talk.reply.N` are each unique.
    func testMessagesAndRepliesAreNumberedSeparately() {
        let numbered = TalkScreen.numbered(TalkFixtures.conversation.turns)
        XCTAssertEqual(numbered.map(\.index), [0, 0, 1])
        XCTAssertEqual(numbered.map(\.id), [0, 1, 2])
    }

    // MARK: Copy

    /// The greeting follows the time of day and the name.
    func testGreetingFollowsTheTimeOfDay() {
        let calendar = TalkFixtures.calendar
        func at(_ hour: Int) -> Date { calendar.date(bySettingHour: hour, minute: 0, second: 0, of: TalkFixtures.now)! }
        XCTAssertEqual(TalkCopy.greeting(name: "Nami", at: at(8), calendar: calendar), "Morning, Nami.")
        XCTAssertEqual(TalkCopy.greeting(name: "Nami", at: at(14), calendar: calendar), "Afternoon, Nami.")
        XCTAssertEqual(TalkCopy.greeting(name: "Nami", at: at(20), calendar: calendar), "Evening, Nami.")
    }

    /// The real line: none, one name, or the two most recent names.
    func testRealLine() {
        XCTAssertEqual(TalkCopy.realLine([]).map { String($0.characters) }, "Say whatever's on your mind.")
        XCTAssertEqual(TalkCopy.realLine(["Jan"]).map { String($0.characters) }, "Jan left you a card. Nothing else needs you.")
        XCTAssertEqual(TalkCopy.realLine(["Jan", "Ben", "Ana"]).map { String($0.characters) },
                       "Jan and Ben left you cards. Nothing else needs you.")
        XCTAssertNil(TalkCopy.realLine(nil), "the second line is left out when GET /home fails")
    }

    /// The limit line: a time on the same day, the day otherwise.
    func testLimitLine() {
        let calendar = TalkFixtures.calendar
        let later = calendar.date(byAdding: .hour, value: 2, to: TalkFixtures.now)!
        XCTAssertTrue(TalkCopy.limited(opensAt: later, now: TalkFixtures.now, calendar: calendar).hasPrefix("Talk opens again at "))
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: TalkFixtures.now)!
        XCTAssertTrue(TalkCopy.limited(opensAt: tomorrow, now: TalkFixtures.now, calendar: calendar).hasPrefix("Talk opens again on "))
    }

    /// Every fixed string the screen types comes from packages/01/copy.md (`talk`, `aiConsent`, `wait.a11y`).
    func testEveryStringComesFromCopy() throws {
        let copy = try Self.copyStrings()
        XCTAssertEqual(TalkCopy.greetings.joined(separator: " / "), copy["talk.greeting"])
        XCTAssertEqual(TalkCopy.realOneTemplate, copy["talk.realOne"])
        XCTAssertEqual(TalkCopy.realManyTemplate, copy["talk.realMany"])
        XCTAssertEqual(TalkCopy.realNone, copy["talk.realNone"])
        XCTAssertEqual(TalkCopy.fallbackQuestion, copy["talk.fallbackQuestion"])
        XCTAssertEqual(TalkCopy.suggestionFrom, copy["talk.suggestionFrom"])
        XCTAssertEqual(TalkCopy.thatsMe, copy["talk.thatsMe"])
        XCTAssertEqual(TalkCopy.partly, copy["talk.partly"])
        XCTAssertEqual(TalkCopy.notNow, copy["talk.notNow"])
        XCTAssertEqual(TalkCopy.kept, copy["talk.kept"])
        XCTAssertEqual(TalkCopy.notKept, copy["talk.notKept"])
        XCTAssertEqual(TalkCopy.partlyFailed, copy["talk.partlyFailed"])
        XCTAssertEqual(TalkCopy.grantFailedTemplate, copy["talk.grantFailed"])
        XCTAssertEqual(TalkCopy.turnFailed, copy["talk.turnFailed"])
        XCTAssertEqual(TalkCopy.limitedTemplates.joined(separator: " / "), copy["talk.limited"])
        XCTAssertEqual(TalkCopy.retry, copy["talk.retry"])
        XCTAssertEqual(TalkCopy.notOpen, copy["notOpen"])
        XCTAssertEqual(TalkCopy.declinedLine, copy["aiConsent.declinedLine"])
        XCTAssertEqual(TalkCopy.turnOn, copy["aiConsent.turnOn"])
        XCTAssertEqual(TalkCopy.waiting, copy["wait.a11y"])
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
