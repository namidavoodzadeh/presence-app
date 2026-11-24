import XCTest

/// Journey set. Permissions the journeys need are granted before the run with `xcrun simctl privacy`
/// (list in app/Tests/UI/permissions.txt), so no system alert interrupts a journey.
final class JourneyTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testLaunchShowsTemplateScreen() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["template.loading"].waitForExistence(timeout: 10))
    }

    func testAccessibilityAudit() throws {
        let app = XCUIApplication()
        app.launch()
        _ = app.descendants(matching: .any)["template.loading"].waitForExistence(timeout: 10)
        try app.performAccessibilityAudit()
    }
}
