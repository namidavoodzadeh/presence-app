import XCTest

/// Journey set. Permissions the journeys need are granted before the run with `xcrun simctl privacy`
/// (list in app/Tests/UI/permissions.txt), so no system alert interrupts a journey.
/// #128: a plain launch opens where the app routes; signed out, that is `signIn`. `-journeyFixture YES` runs the app
/// against its in-app fixture server with a stubbed Apple credential.
final class JourneyTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    func testLaunchSignedOutShowsSignIn() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(element(app, "signIn.apple").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "signIn.adult").exists, "the 18+ statement shows with the providers")
    }

    func testSignInOpensTalk() {
        let app = XCUIApplication()
        app.launchArguments += ["-journeyFixture", "YES"]
        app.launch()
        let apple = element(app, "signIn.apple")
        XCTAssertTrue(apple.waitForExistence(timeout: 10))
        apple.tap()
        // No `ai_consent` on `GET /me` yet: the server does not gate, so Talk opens next (lead decision, #128).
        XCTAssertTrue(element(app, "talk").waitForExistence(timeout: 10), "Talk is home")
        XCTAssertTrue(element(app, "talk.reply.0").waitForExistence(timeout: 10), "Talk asked its first question")
        XCTAssertTrue(element(app, "bar.field").exists)
        XCTAssertFalse(element(app, "signIn.apple").exists)
    }

    func testAccessibilityAudit() throws {
        let app = XCUIApplication()
        app.launch()
        _ = element(app, "signIn.apple").waitForExistence(timeout: 10)
        try app.performAccessibilityAudit()
    }
}
