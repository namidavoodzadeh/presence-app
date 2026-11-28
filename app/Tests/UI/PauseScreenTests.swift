import XCTest

/// #33 `pause`: control ids from screens.md, the primary control reachable, and the accessibility audit in each
/// state. Written in the same session as the screen (#95); an independent test pass follows.
final class PauseScreenTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch(_ fixture: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", fixture]
        app.launch()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    func testNoteCardHasItsControls() {
        let app = launch("pause-note")
        for id in ["pause.note", "pause.keepMine", "pause.useIt"] {
            XCTAssertTrue(element(app, id).waitForExistence(timeout: 10), "\(id) is present")
        }
        XCTAssertTrue(app.staticTexts["Before it goes"].exists)
    }

    func testNoteWithoutTryOffersOnlyKeepMine() {
        let app = launch("pause-noteNoTry")
        XCTAssertTrue(element(app, "pause.keepMine").waitForExistence(timeout: 10))
        XCTAssertFalse(element(app, "pause.useIt").exists)
    }

    /// Use it on the note, then on the fromMe card, reaches the final card and Fold and send.
    func testUseItReachesTheFinalCardAndFoldAndSend() {
        let app = launch("pause-note")
        XCTAssertTrue(element(app, "pause.useIt").waitForExistence(timeout: 10))
        element(app, "pause.useIt").tap()
        XCTAssertTrue(app.staticTexts["You shared: “When I go quiet I'm thinking, not upset.” Want to say that here?"]
            .waitForExistence(timeout: 5))
        element(app, "pause.useIt").tap()
        XCTAssertTrue(element(app, "pause.final").waitForExistence(timeout: 5))
        let send = element(app, "pause.send")
        XCTAssertTrue(send.exists)
        XCTAssertTrue(send.isHittable)
        XCTAssertFalse(element(app, "pause.note").exists)
    }

    func testFinalHasItsControls() {
        let app = launch("pause-final")
        XCTAssertTrue(element(app, "pause.final").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "pause.send").isHittable)
    }

    func testAccessibilityAuditEachState() throws {
        for fixture in ["pause-note", "pause-noteSharedNothing", "pause-noteNoTry", "pause-fromMe", "pause-final"] {
            let app = launch(fixture)
            XCTAssertTrue(app.staticTexts["Before it goes"].waitForExistence(timeout: 10), fixture)
            try app.performAccessibilityAudit()
            app.terminate()
        }
    }
}
