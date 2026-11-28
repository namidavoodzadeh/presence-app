// Issue #24: acceptance tests for the `settings` screen, written in the same session as the screen (#95, owner 27 Nov).
// Control ids from packages/01/screens.md (`settings`), states from states.md, behaviour from behaviour.md.
import XCTest

final class SettingsScreenTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func open(_ state: String, waitingFor id: String = "settings.privacy") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", "settings-\(state)"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)[id].waitForExistence(timeout: 10), id)
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func lastEvent(_ app: XCUIApplication) -> String {
        element(app, "gallery.lastEvent").label
    }

    private let rowIds = ["settings.ai", "settings.privacy", "settings.download", "settings.logOut", "settings.delete"]

    func testLoadedShowsEveryRow() throws {
        let app = open("loaded")
        for id in rowIds { XCTAssertTrue(element(app, id).exists, id) }
        XCTAssertEqual(element(app, "settings.ai").value as? String, "On")
        XCTAssertFalse(element(app, "settings.confirmDelete").exists)
        XCTAssertFalse(element(app, "settings.cancelDelete").exists)
        try app.performAccessibilityAudit()
    }

    func testLoadedRowsSendTheirEvents() {
        let app = open("loaded")
        let expected = [
            "settings.ai": "aiTapped", "settings.privacy": "privacyTapped", "settings.download": "downloadTapped",
            "settings.logOut": "logOutTapped", "settings.delete": "deleteTapped",
        ]
        for id in rowIds {
            let row = element(app, id)
            XCTAssertTrue(row.isHittable, id)
            row.tap()
            XCTAssertEqual(lastEvent(app), expected[id], id)
        }
    }

    func testAIOffReadsOff() throws {
        let app = open("off")
        XCTAssertEqual(element(app, "settings.ai").value as? String, "Off")
        try app.performAccessibilityAudit()
    }

    func testLoadingShowsTheRowsAtOnceWithTheLastKnownAI() throws {
        let app = open("loading")
        for id in rowIds { XCTAssertTrue(element(app, id).exists, id) }
        XCTAssertEqual(element(app, "settings.ai").value as? String, "On")
        try app.performAccessibilityAudit()
    }

    func testFailedLeavesOutTheAIRowAndTheOthersWork() throws {
        let app = open("failed")
        XCTAssertFalse(element(app, "settings.ai").exists)
        for id in rowIds.dropFirst() { XCTAssertTrue(element(app, id).exists, id) }
        try app.performAccessibilityAudit()
        element(app, "settings.download").tap()
        XCTAssertEqual(lastEvent(app), "downloadTapped")
    }

    func testConfirmingShowsTheCardWithBothChoices() throws {
        let app = open("confirming", waitingFor: "settings.confirmDelete")
        let confirm = element(app, "settings.confirmDelete")
        let cancel = element(app, "settings.cancelDelete")
        XCTAssertTrue(confirm.isHittable)
        XCTAssertTrue(cancel.isHittable)
        XCTAssertEqual(confirm.frame.width, cancel.frame.width, accuracy: 0.5, "Delete and Keep my account are the same size")
        XCTAssertEqual(confirm.frame.height, cancel.frame.height, accuracy: 0.5, "Delete and Keep my account are the same size")
        try app.performAccessibilityAudit()
        cancel.tap()
        XCTAssertEqual(lastEvent(app), "cancelDeleteTapped")
        confirm.tap()
        XCTAssertEqual(lastEvent(app), "confirmDeleteTapped")
    }

    func testBusyDimsEveryRow() {
        let app = open("exporting")
        for id in rowIds { XCTAssertFalse(element(app, id).isEnabled, id) }
    }

    func testTouchOutsideTheRowsCloses() {
        let app = open("loaded")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)).tap()
        XCTAssertEqual(lastEvent(app), "touchedOutside")
    }
}
