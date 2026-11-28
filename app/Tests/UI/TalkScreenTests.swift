// Issue #25: acceptance tests for the `talk` screen, written in the same session as the screen (#95, owner 27 Nov).
// Control ids from packages/01/screens.md (`talk`), states from states.md and behaviour.md (`talk`).
import XCTest

final class TalkScreenTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func open(_ state: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", "talk-\(state)"]
        app.launch()
        XCTAssertTrue(element(app, "talk.greeting").waitForExistence(timeout: 10), "talk.greeting")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func lastEvent(_ app: XCUIApplication) -> String {
        element(app, "gallery.lastEvent").label
    }

    private func assertAbsent(_ app: XCUIApplication, _ ids: [String], file: StaticString = #filePath, line: UInt = #line) {
        for id in ids { XCTAssertFalse(element(app, id).exists, "\(id) is not shown", file: file, line: line) }
    }

    private let cardControls = ["talk.suggestion", "talk.thatsMe", "talk.partly", "talk.notNow"]

    /// opening (loading): the greeting at once, the knot where the first question goes, nothing to press.
    func testOpeningShowsTheGreetingAndTheKnot() throws {
        let app = open("opening")
        XCTAssertTrue(element(app, "talk.loading").waitForExistence(timeout: 5))
        assertAbsent(app, cardControls + ["talk.retry", "talk.reply.0"])
        try app.performAccessibilityAudit()
    }

    /// First open, loaded: the greeting, the real line and the first question.
    func testReadyShowsTheFirstQuestion() throws {
        let app = open("ready")
        XCTAssertTrue(element(app, "talk.reply.0").exists)
        XCTAssertTrue(app.staticTexts["Jan left you a card. Nothing else needs you."].exists)
        assertAbsent(app, cardControls + ["talk.retry", "talk.loading"])
        try app.performAccessibilityAudit()
    }

    /// A conversation: your messages and the replies, each numbered.
    func testConversationNumbersMessagesAndReplies() throws {
        let app = open("conversation")
        for id in ["talk.reply.0", "talk.message.0", "talk.reply.1"] {
            XCTAssertTrue(element(app, id).exists, id)
        }
        assertAbsent(app, cardControls + ["talk.retry"])
        try app.performAccessibilityAudit()
    }

    /// A turn on its way: your message, the knot where the reply goes.
    func testSendingShowsYourMessageAndTheKnot() throws {
        let app = open("sending")
        XCTAssertTrue(element(app, "talk.message.0").exists)
        XCTAssertTrue(element(app, "talk.loading").waitForExistence(timeout: 5))
        assertAbsent(app, cardControls + ["talk.retry"])
        try app.performAccessibilityAudit()
    }

    /// suggesting: the card with its three answers; each reaches the flow.
    func testSuggestionCardAnswersReachTheFlow() throws {
        let app = open("suggesting")
        for id in cardControls { XCTAssertTrue(element(app, id).exists, id) }
        XCTAssertFalse(element(app, "talk.retry").exists)
        try app.performAccessibilityAudit()
        let thatsMe = element(app, "talk.thatsMe")
        XCTAssertTrue(thatsMe.isHittable)
        thatsMe.tap()
        XCTAssertEqual(lastEvent(app), "thatsMeTapped")
        element(app, "talk.partly").tap()
        XCTAssertEqual(lastEvent(app), "partlyTapped")
        element(app, "talk.notNow").tap()
        XCTAssertEqual(lastEvent(app), "notNowTapped")
    }

    /// Swipe right on the card is That's me; left is Not now.
    func testSuggestionCardSwipes() {
        let app = open("suggesting")
        let card = element(app, "talk.suggestion")
        XCTAssertTrue(card.exists)
        card.swipeRight()
        XCTAssertEqual(lastEvent(app), "thatsMeTapped")
        card.swipeLeft()
        XCTAssertEqual(lastEvent(app), "notNowTapped")
    }

    /// turnFailed: the failed line and Try again under your message; Try again sends the same words.
    func testTurnFailedTryAgainReachesTheFlow() throws {
        let app = open("turnFailed")
        XCTAssertTrue(element(app, "talk.message.0").exists)
        XCTAssertTrue(app.staticTexts["That didn't go through. Your words are still here."].exists)
        assertAbsent(app, cardControls)
        try app.performAccessibilityAudit()
        let retry = element(app, "talk.retry")
        XCTAssertTrue(retry.isHittable)
        retry.tap()
        XCTAssertEqual(lastEvent(app), "retryTapped")
    }

    /// limited (429): the limit line, no Try again.
    func testLimitedShowsTheLimitLineAndNoTryAgain() throws {
        let app = open("limited")
        XCTAssertTrue(element(app, "talk.limited").exists)
        assertAbsent(app, cardControls + ["talk.retry"])
        try app.performAccessibilityAudit()
    }

    /// 403 feature_off: the not-open line, no Try again.
    func testNotOpenShowsTheLineAndNoTryAgain() throws {
        let app = open("notOpen")
        XCTAssertTrue(app.staticTexts["Talk isn't open on this account yet."].exists)
        assertAbsent(app, cardControls + ["talk.retry", "talk.loading"])
        try app.performAccessibilityAudit()
    }

    /// AI consent declined: the greeting, the not-agreed line and the turn-on line in place of the first question.
    func testDeclinedShowsTheTurnOnLine() throws {
        let app = open("declined")
        XCTAssertTrue(app.staticTexts["Talk and notes need Kenember's AI. Your people and their cards work without it."].exists)
        assertAbsent(app, cardControls + ["talk.retry", "talk.reply.0", "talk.loading"])
        try app.performAccessibilityAudit()
        let turnOn = element(app, "talk.turnOn")
        XCTAssertTrue(turnOn.isHittable)
        turnOn.tap()
        XCTAssertEqual(lastEvent(app), "turnOnAI")
    }
}
