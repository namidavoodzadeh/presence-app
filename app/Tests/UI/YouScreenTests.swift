// Issue #27: acceptance tests for the `you` screen, written in the same session as the screen (#95, owner 27 Nov).
// Control ids from packages/01/screens.md (`you`), states from states.md, behaviour from behaviour.md.
import XCTest

final class YouScreenTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func open(_ state: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", "you-\(state)"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["you.title"].waitForExistence(timeout: 10))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func lastEvent(_ app: XCUIApplication) -> String {
        element(app, "gallery.lastEvent").label
    }

    func testLoadingShowsTheKnotAndNoControls() throws {
        let app = open("loading")
        XCTAssertTrue(element(app, "you.loading").exists)
        XCTAssertFalse(element(app, "you.retry").exists)
        XCTAssertFalse(element(app, "you.talk").exists)
        try app.performAccessibilityAudit()
    }

    func testEmptyTalkGoesBackToTalk() throws {
        let app = open("empty")
        XCTAssertTrue(element(app, "you.empty").exists)
        XCTAssertFalse(element(app, "you.retry").exists)
        let talk = element(app, "you.talk")
        XCTAssertTrue(talk.isHittable)
        try app.performAccessibilityAudit()
        talk.tap()
        XCTAssertEqual(lastEvent(app), "talkTapped")
    }

    func testFailedTryAgainLoadsAgain() throws {
        let app = open("failed")
        XCTAssertTrue(element(app, "you.unavailable").exists)
        XCTAssertFalse(element(app, "you.talk").exists)
        let retry = element(app, "you.retry")
        XCTAssertTrue(retry.isHittable)
        try app.performAccessibilityAudit()
        retry.tap()
        XCTAssertEqual(lastEvent(app), "retryTapped")
    }

    func testLoadedItemsOpenTheirCard() throws {
        let app = open("loaded")
        for n in 0..<4 { XCTAssertTrue(element(app, "you.item.\(n)").exists, "you.item.\(n)") }
        XCTAssertFalse(element(app, "you.retry").exists)
        XCTAssertFalse(element(app, "you.talk").exists)
        try app.performAccessibilityAudit()
        let first = element(app, "you.item.0")
        XCTAssertTrue(first.isHittable)
        first.tap()
        XCTAssertTrue(lastEvent(app).hasPrefix("itemTapped"), lastEvent(app))
    }
}
