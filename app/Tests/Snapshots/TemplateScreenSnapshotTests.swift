import Flows
import XCTest
@testable import Presence

@MainActor
final class TemplateScreenSnapshotTests: XCTestCase {
    func testEmpty() { assertSnapshot(TemplateScreen(state: .empty, retry: {}), named: "template-empty") }
    func testFailed() {
        assertSnapshot(TemplateScreen(state: .failed(LoadFailure(kind: .offline)), retry: {}), named: "template-failed")
    }
    func testLoaded() { assertSnapshot(TemplateScreen(state: .loaded(["One", "Two"]), retry: {}), named: "template-loaded") }
}
