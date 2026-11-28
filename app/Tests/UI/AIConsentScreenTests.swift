// Issue #23: acceptance tests for the `aiConsent` screen, written in the same session as the screen (#95, owner 27 Nov).
// Control ids from packages/01/screens.md (`aiConsent`), behaviour from behaviour.md, states from flows/privacy.md.
import XCTest

final class AIConsentScreenTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private static let controls = ["aiConsent.agree", "aiConsent.notNow", "aiConsent.privacy"]

    private func open(_ state: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", "aiConsent-\(state)"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["aiConsent.title"].waitForExistence(timeout: 10))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func lastEvent(_ app: XCUIApplication) -> String {
        element(app, "gallery.lastEvent").label
    }

    func testShowingHasEveryControlAndAgreeGivesConsent() throws {
        let app = open("showing")
        for id in Self.controls { XCTAssertTrue(element(app, id).exists, id) }
        XCTAssertFalse(element(app, "aiConsent.notSaved").exists)
        try app.performAccessibilityAudit()
        let agree = element(app, "aiConsent.agree")
        XCTAssertTrue(agree.isHittable)
        agree.tap()
        XCTAssertEqual(lastEvent(app), "agreeTapped")
    }

    /// Agree and Not now are the same size; nothing is pre-chosen (behaviour.md).
    func testAgreeAndNotNowAreTheSameSize() {
        let app = open("showing")
        let agree = element(app, "aiConsent.agree").frame.size
        let notNow = element(app, "aiConsent.notNow").frame.size
        XCTAssertEqual(agree, notNow)
    }

    func testNotNowGoesOnWithoutTheAI() {
        let app = open("showing")
        let notNow = element(app, "aiConsent.notNow")
        XCTAssertTrue(notNow.isHittable)
        notNow.tap()
        XCTAssertEqual(lastEvent(app), "notNowTapped")
    }

    func testPrivacyOpensThePolicy() {
        let app = open("showing")
        let privacy = element(app, "aiConsent.privacy")
        XCTAssertTrue(privacy.isHittable)
        privacy.tap()
        XCTAssertEqual(lastEvent(app), "privacyTapped")
    }

    /// Saving: Agree and Not now dimmed; Privacy the same.
    func testSavingDimsAgreeAndNotNow() throws {
        let app = open("saving")
        for id in Self.controls { XCTAssertTrue(element(app, id).exists, id) }
        XCTAssertFalse(element(app, "aiConsent.agree").isEnabled)
        XCTAssertFalse(element(app, "aiConsent.notNow").isEnabled)
        XCTAssertTrue(element(app, "aiConsent.privacy").isEnabled)
        try app.performAccessibilityAudit()
    }

    func testNotSavedShowsTheLineAndAgreeAgain() throws {
        let app = open("notSaved")
        XCTAssertTrue(element(app, "aiConsent.notSaved").exists)
        for id in Self.controls { XCTAssertTrue(element(app, id).exists, id) }
        try app.performAccessibilityAudit()
        let agree = element(app, "aiConsent.agree")
        XCTAssertTrue(agree.isHittable)
        agree.tap()
        XCTAssertEqual(lastEvent(app), "agreeTapped")
    }
}
