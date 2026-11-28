// Issue #22: acceptance tests for the `signIn` screen, written in the same session as the screen (#95, owner 27 Nov).
// States from the sign-in flow (states.md: `signIn`'s failure lines are flow states) and copy.md (`signIn`).
import Flows
import SwiftUI
import XCTest
@testable import Presence

@MainActor
final class SignInScreenSnapshotTests: XCTestCase {
    private enum Look: String, CaseIterable { case light, dark, largestText }

    private func assertAllLooks(_ state: SignInFlow.State, named name: String,
                                file: StaticString = #filePath, line: UInt = #line) {
        for look in Look.allCases {
            let screen = SignInScreen(state: state, send: { _ in })
            let view = switch look {
            case .light: AnyView(screen.environment(\.colorScheme, .light))
            case .dark: AnyView(screen.environment(\.colorScheme, .dark))
            case .largestText: AnyView(screen.environment(\.colorScheme, .light).environment(\.dynamicTypeSize, .accessibility5))
            }
            assertSnapshot(view, named: "signIn-\(name)-\(look.rawValue)", file: file, line: line)
        }
    }

    func testSignedOut() { assertAllLooks(.signedOut, named: "signedOut") }
    func testBusy() { assertAllLooks(.exchanging, named: "busy") }
    func testFailed() { assertAllLooks(.signInFailed(.provider), named: "failed") }
    func testUnderAge() { assertAllLooks(.underAge, named: "underAge") }

    /// Each failure shows its own line (sign-in.md: provider, server, offline).
    func testFailureLines() {
        XCTAssertEqual(SignInCopy.failed(.provider), SignInCopy.providerFailed)
        XCTAssertEqual(SignInCopy.failed(.server), SignInCopy.serverFailed)
        XCTAssertEqual(SignInCopy.failed(.offline), SignInCopy.offline)
    }

    /// Controls are live in signedOut and signInFailed, dimmed while a sheet is open or the exchange is on its way.
    func testDimmedStates() {
        XCTAssertFalse(SignInScreen.isDimmed(.signedOut))
        XCTAssertFalse(SignInScreen.isDimmed(.signInFailed(.server)))
        for state: SignInFlow.State in [.checkingAge(.apple), .appleSheet, .googleSheet, .exchanging] {
            XCTAssertTrue(SignInScreen.isDimmed(state), "\(state)")
        }
    }

    /// Every string the screen types comes from packages/01/copy.md (`signIn`).
    func testEveryStringComesFromCopy() throws {
        let copy = try Self.copyStrings()
        XCTAssertEqual(SignInCopy.line, copy["signIn.line"])
        XCTAssertEqual(SignInCopy.adult, copy["signIn.adult"])
        XCTAssertEqual(SignInCopy.ai, copy["signIn.ai"])
        XCTAssertEqual(SignInCopy.privacy, copy["signIn.privacy"])
        XCTAssertEqual(SignInCopy.providerFailed, copy["signIn.providerFailed"])
        XCTAssertEqual(SignInCopy.serverFailed, copy["signIn.serverFailed"])
        XCTAssertEqual(SignInCopy.offline, copy["signIn.offline"])
        XCTAssertEqual(SignInCopy.retry, copy["signIn.retry"])
        XCTAssertEqual(SignInCopy.underAge, copy["signIn.underAge"])
        // `signIn.apple`, `signIn.google`: "the providers' own button text" (source: system).
        XCTAssertEqual(copy["signIn.apple`, `signIn.google"], "the providers' own button text")
    }

    /// `| \`id\` | String | Source |` rows of copy.md, by id.
    private static func copyStrings(file: String = #filePath) throws -> [String: String] {
        let root = URL(fileURLWithPath: file)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let text = try String(contentsOf: root.appendingPathComponent("packages/01/copy.md"), encoding: .utf8)
        var strings: [String: String] = [:]
        for row in text.split(separator: "\n") where row.hasPrefix("| `") {
            let cells = row.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
            guard cells.count >= 3 else { continue }
            strings[cells[1].trimmingCharacters(in: CharacterSet(charactersIn: "`"))] = cells[2]
        }
        return strings
    }
}
