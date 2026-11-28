// Issue #22: acceptance tests for the `signIn` screen, written in the same session as the screen (#95, owner 27 Nov).
// Control ids from packages/01/screens.md (`signIn`), states from the sign-in flow (states.md: its failure lines are
// flow states), behaviour from behaviour.md (`signIn`).
import XCTest

final class SignInScreenTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func open(_ state: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", "signIn-\(state)"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["signIn.line"].waitForExistence(timeout: 10))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func lastEvent(_ app: XCUIApplication) -> String {
        element(app, "gallery.lastEvent").label
    }

    func testSignedOutOffersBothProvidersAndPrivacy() throws {
        let app = open("signedOut")
        for id in ["signIn.apple", "signIn.google", "signIn.privacy", "signIn.adult", "signIn.ai"] {
            XCTAssertTrue(element(app, id).exists, id)
        }
        XCTAssertFalse(element(app, "signIn.retry").exists)
        try app.performAccessibilityAudit()

        let apple = element(app, "signIn.apple")
        let google = element(app, "signIn.google")
        XCTAssertTrue(apple.isHittable)
        XCTAssertTrue(google.isHittable)
        // Q1: Apple and Google the same size.
        XCTAssertEqual(apple.frame.width, google.frame.width, accuracy: 1)
        XCTAssertEqual(apple.frame.height, google.frame.height, accuracy: 1)

        apple.tap()
        XCTAssertEqual(lastEvent(app), "appleTapped")
        google.tap()
        XCTAssertEqual(lastEvent(app), "googleTapped")
        element(app, "signIn.privacy").tap()
        XCTAssertEqual(lastEvent(app), "privacyTapped")
    }

    func testBusyDimsEveryControl() throws {
        let app = open("busy")
        for id in ["signIn.apple", "signIn.google", "signIn.privacy"] {
            XCTAssertTrue(element(app, id).exists, id)
            XCTAssertFalse(element(app, id).isEnabled, id)
        }
        XCTAssertFalse(element(app, "signIn.retry").exists)
        try app.performAccessibilityAudit()
    }

    func testFailedShowsTheLineAndTryAgain() throws {
        let app = open("failed")
        XCTAssertTrue(element(app, "signIn.failed").exists)
        for id in ["signIn.apple", "signIn.google", "signIn.privacy"] {
            XCTAssertTrue(element(app, id).isEnabled, id)
        }
        try app.performAccessibilityAudit()
        let retry = element(app, "signIn.retry")
        XCTAssertTrue(retry.isHittable)
        retry.tap()
        XCTAssertEqual(lastEvent(app), "retryTapped")
    }

    func testUnderAgeOffersNoSignIn() throws {
        let app = open("underAge")
        XCTAssertTrue(element(app, "signIn.underAge").exists)
        XCTAssertFalse(element(app, "signIn.apple").exists)
        XCTAssertFalse(element(app, "signIn.google").exists)
        XCTAssertFalse(element(app, "signIn.retry").exists)
        XCTAssertTrue(element(app, "signIn.privacy").isHittable)
        try app.performAccessibilityAudit()
    }
}
