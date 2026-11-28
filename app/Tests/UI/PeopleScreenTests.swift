// Issue #29: acceptance tests for the `people` screen, written in the same session as the screen (#95, owner 27 Nov).
// Control ids from packages/01/screens.md (`people`), states from states.md, behaviour from behaviour.md.
import XCTest

final class PeopleScreenTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func open(_ state: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", "people-\(state)"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["people.title"].waitForExistence(timeout: 10))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func lastEvent(_ app: XCUIApplication) -> String {
        element(app, "gallery.lastEvent").label
    }

    /// states.md: "Someone new" shows in every state and opens Someone new (behaviour.md).
    private func assertSomeoneNewOpens(_ app: XCUIApplication) {
        let new = element(app, "people.new")
        XCTAssertTrue(new.isHittable)
        new.tap()
        XCTAssertEqual(lastEvent(app), "someoneNewTapped")
    }

    func testLoadingShowsTheKnotAndSomeoneNew() throws {
        let app = open("loading")
        XCTAssertTrue(element(app, "people.loading").exists)
        XCTAssertFalse(element(app, "people.retry").exists)
        XCTAssertFalse(element(app, "people.row.0").exists)
        try app.performAccessibilityAudit()
        assertSomeoneNewOpens(app)
    }

    func testEmptyShowsOnlySomeoneNew() throws {
        let app = open("empty")
        XCTAssertFalse(element(app, "people.retry").exists)
        XCTAssertFalse(element(app, "people.row.0").exists)
        XCTAssertFalse(element(app, "people.loading").exists)
        try app.performAccessibilityAudit()
        assertSomeoneNewOpens(app)
    }

    func testFailedTryAgainLoadsAgain() throws {
        let app = open("failed")
        XCTAssertTrue(element(app, "people.unavailable").exists)
        XCTAssertFalse(element(app, "people.row.0").exists)
        XCTAssertTrue(element(app, "people.new").exists)
        let retry = element(app, "people.retry")
        XCTAssertTrue(retry.isHittable)
        try app.performAccessibilityAudit()
        retry.tap()
        XCTAssertEqual(lastEvent(app), "retryTapped")
        assertSomeoneNewOpens(app)
    }

    func testLoadedRowsOpenTheirThread() throws {
        let app = open("loaded")
        for n in 0..<3 { XCTAssertTrue(element(app, "people.row.\(n)").exists, "people.row.\(n)") }
        XCTAssertFalse(element(app, "people.retry").exists)
        XCTAssertTrue(element(app, "people.new").exists)
        XCTAssertEqual(element(app, "people.row.0").label, "Jan, A card, folded, from this morning, 9:12, new")
        try app.performAccessibilityAudit()
        let first = element(app, "people.row.0")
        XCTAssertTrue(first.isHittable)
        first.tap()
        XCTAssertEqual(lastEvent(app), "rowTapped(0)")
        assertSomeoneNewOpens(app)
    }
}
