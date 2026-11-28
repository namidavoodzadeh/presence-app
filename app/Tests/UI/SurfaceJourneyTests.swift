import XCTest

/// #21, the surface. Written in the same session as the screen (owner, 27 Nov, #95); an independent pass follows.
/// The app opens the surface with `-surface YES` until routing makes Talk the home.
final class SurfaceJourneyTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-surface", "YES"]
        app.launch()
        XCTAssertTrue(element(app, "talk").waitForExistence(timeout: 10), "the surface opens on Talk")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    func testControlIdsPresentOnTalk() {
        let app = launch()
        for id in ["bar.field", "bar.mic", "edge.left", "edge.right", "pull.mark"] {
            XCTAssertTrue(element(app, id).exists, "\(id) missing")
        }
        XCTAssertFalse(element(app, "bar.send").exists, "send shows only once the bar has words")
    }

    func testSendReplacesMicOnceThereAreWords() {
        let app = launch()
        let field = element(app, "bar.field")
        field.tap()
        field.typeText("I was hurt")
        XCTAssertTrue(element(app, "bar.send").waitForExistence(timeout: 5))
        XCTAssertFalse(element(app, "bar.mic").exists)
    }

    func testEdgesRunThePullsAndTheBarStays() {
        let app = launch()
        element(app, "edge.left").tap()
        XCTAssertTrue(element(app, "you").waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "bar.field").exists, "the talk bar is on every view")
        XCTAssertFalse(element(app, "edge.left").exists, "edges are shown on Talk")

        app.swipeLeft()
        XCTAssertTrue(element(app, "talk").waitForExistence(timeout: 5))
        element(app, "edge.right").tap()
        XCTAssertTrue(element(app, "people").waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "pull.mark").exists)
        app.swipeRight()
        XCTAssertTrue(element(app, "talk").waitForExistence(timeout: 5))
    }

    func testPullMarkIsReachable() {
        let app = launch()
        let mark = element(app, "pull.mark")
        XCTAssertTrue(mark.isHittable)
        mark.tap()
        XCTAssertTrue(element(app, "talk").exists)
    }

    func testAccessibilityAuditOnEveryView() throws {
        let app = launch()
        try app.performAccessibilityAudit()
        element(app, "edge.left").tap()
        XCTAssertTrue(element(app, "you").waitForExistence(timeout: 5))
        try app.performAccessibilityAudit()
        app.swipeLeft()
        XCTAssertTrue(element(app, "talk").waitForExistence(timeout: 5))
        element(app, "edge.right").tap()
        XCTAssertTrue(element(app, "people").waitForExistence(timeout: 5))
        try app.performAccessibilityAudit()
    }
}
