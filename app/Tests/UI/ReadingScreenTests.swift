// Issue #32: acceptance tests for the `reading` screen, written in the same session as the screen (#95, owner 27 Nov).
// Control ids from packages/01 screens.md (`reading`), states from states.md, behaviour from behaviour.md.
import XCTest

final class ReadingScreenTests: XCTestCase {
    /// `ReadingFixtures.reading` in the app: Jan's words, as the server's `final`.
    private static let words = "I went quiet last night because I didn't know how to say it. I'm not upset with you. Can we talk tonight?"

    override func setUp() { continueAfterFailure = false }

    private func open(_ state: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", "reading-\(state)"]
        app.launch()
        XCTAssertTrue(element(app, "reading.card").waitForExistence(timeout: 10))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func lastEvent(_ app: XCUIApplication) -> String {
        element(app, "gallery.lastEvent").label
    }

    /// loading: the folded card stays in place with the knot beside "Touch to open"; touching it does nothing.
    func testLoadingShowsTheFoldedCardAndTheKnot() throws {
        let app = open("loading")
        XCTAssertTrue(element(app, "reading.loading").exists)
        XCTAssertFalse(element(app, "reading.didntOpen").exists)
        XCTAssertFalse(element(app, "reading.card").label.contains(Self.words))
        try app.performAccessibilityAudit()
        element(app, "reading.card").tap()
        let sent = element(app, "gallery.lastEvent")
        XCTAssertEqual(sent.exists ? sent.label : "", "", "a touch while opening sends nothing")
    }

    /// empty is not used for `reading`: the folded card waits for a touch, which opens it.
    func testEmptyShowsTheFoldedCardThatOpensOnTouch() throws {
        let app = open("empty")
        XCTAssertFalse(element(app, "reading.loading").exists)
        XCTAssertFalse(element(app, "reading.didntOpen").exists)
        let card = element(app, "reading.card")
        XCTAssertTrue(card.isHittable)
        try app.performAccessibilityAudit()
        card.tap()
        XCTAssertEqual(lastEvent(app), "cardTouched")
    }

    /// failed: "Didn't open. Touch to try again." under the folded card; a touch opens it again.
    func testFailedTouchTriesAgain() throws {
        let app = open("failed")
        XCTAssertFalse(element(app, "reading.loading").exists)
        let card = element(app, "reading.card")
        XCTAssertTrue(card.label.contains("Didn't open. Touch to try again."), card.label)
        XCTAssertTrue(card.isHittable)
        try app.performAccessibilityAudit()
        card.tap()
        XCTAssertEqual(lastEvent(app), "cardTouched")
    }

    /// loaded: their words and their name, nothing else; a touch on the card ends the first reading.
    func testLoadedShowsOnlyTheWordsAndTheName() throws {
        let app = open("loaded")
        XCTAssertFalse(element(app, "reading.loading").exists)
        XCTAssertFalse(element(app, "reading.didntOpen").exists)
        let card = element(app, "reading.card")
        XCTAssertTrue(card.label.contains(Self.words), card.label)
        XCTAssertTrue(card.label.contains("Jan"), card.label)
        XCTAssertFalse(card.label.contains("Touch to open"), card.label)
        XCTAssertFalse(card.label.contains("A card, folded"), card.label)
        XCTAssertFalse(app.staticTexts["Touch to open"].exists)
        XCTAssertTrue(card.isHittable)
        try app.performAccessibilityAudit()
        card.tap()
        XCTAssertEqual(lastEvent(app), "touchedAnywhere")
    }

    /// loaded: a touch anywhere, not only on the card, ends the first reading.
    func testLoadedATouchAnywhereEndsTheReading() {
        let app = open("loaded")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        XCTAssertEqual(lastEvent(app), "touchedAnywhere")
    }
}
