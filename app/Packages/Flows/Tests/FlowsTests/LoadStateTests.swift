import XCTest
@testable import Flows

final class LoadStateTests: XCTestCase {
    func testEmptyCollectionIsEmptyNotLoaded() {
        XCTAssertEqual(LoadState<[Int]>.from([]), .empty)
    }

    func testNonEmptyCollectionIsLoaded() {
        XCTAssertEqual(LoadState<[Int]>.from([1]), .loaded([1]))
    }

    func testFailureIsNeverEqualToEmpty() {
        let failed: LoadState<[Int]> = .failed(LoadFailure(kind: .server))
        XCTAssertNotEqual(failed, .empty)
    }

    /// No `default`: adding or removing a case fails this file's build.
    func testSwitchIsExhaustive() {
        let state: LoadState<[Int]> = .loading
        let label: String
        switch state {
        case .loading: label = "loading"
        case .empty: label = "empty"
        case .failed: label = "failed"
        case .loaded: label = "loaded"
        }
        XCTAssertEqual(label, "loading")
    }
}
