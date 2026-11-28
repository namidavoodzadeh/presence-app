// Issue #34: acceptance tests for the `safety` screen, written in the same session as the screen (#95, owner 27 Nov).
// Control ids from packages/01/screens.md (`safety`), states from states.md, behaviour from behaviour.md.
import XCTest

final class SafetyScreenTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func open(_ state: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", "safety-\(state)"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["safety.message"].waitForExistence(timeout: 10))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func lastEvent(_ app: XCUIApplication) -> String {
        element(app, "gallery.lastEvent").label
    }

    /// The one state: what the triggering reply carried (states.md), every control from screens.md, the audit.
    func testShownHasEveryControlAndPassesTheAudit() throws {
        let app = open("shown")
        XCTAssertTrue(element(app, "safety.resource.0").exists)
        XCTAssertTrue(element(app, "safety.resource.1").exists)
        XCTAssertFalse(element(app, "safety.resource.2").exists)
        XCTAssertTrue(element(app, "safety.close").exists)
        try app.performAccessibilityAudit()
    }

    /// behaviour.md: a resource opens in Safari (the flow's effect); the view sends which one.
    func testResourceSendsItsIndex() {
        let app = open("shown")
        let second = element(app, "safety.resource.1")
        XCTAssertTrue(second.isHittable)
        second.tap()
        XCTAssertEqual(lastEvent(app), "resourceTapped(1)")
    }

    /// behaviour.md: Close closes; the view below goes on as its flow says.
    func testCloseIsReachable() {
        let app = open("shown")
        let close = element(app, "safety.close")
        XCTAssertTrue(close.isHittable)
        close.tap()
        XCTAssertEqual(lastEvent(app), "closeTapped")
    }
}
