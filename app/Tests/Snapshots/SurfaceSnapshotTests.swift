import DesignKit
import Flows
import SwiftUI
import UIKit
import XCTest
@testable import Presence

/// #21, the surface. Written in the same session as the screen (owner, 27 Nov, #95); an independent pass follows.
/// Snapshots: light, dark and the largest text size; each shared state (states.md, "Shared look") and each bar
/// column (behaviour.md, the talk bar).
@MainActor
final class SurfaceSnapshotTests: XCTestCase {
    private enum Look { case light, dark, largest }

    private func surface(
        _ flow: SurfaceFlow = SurfaceFlow(),
        state: LoadState<[String]> = .loaded([]),
        look: Look = .light
    ) -> some View {
        Surface(model: SurfaceModel(flow)) { view in
            SurfaceLoad(
                state: state,
                unavailable: "Your kennings can't be shown right now.",
                retryId: "\(Surface<EmptyView, EmptyView>.name(view)).retry",
                retry: {},
                empty: { Color.clear },
                loaded: { _ in Color.clear },
                waitingPhase: .knot
            )
        }
        .environment(\.colorScheme, look == .dark ? .dark : .light)
        .environment(\.dynamicTypeSize, look == .largest ? .accessibility5 : .large)
    }

    private func flow(_ events: SurfaceFlow.Event...) -> SurfaceFlow {
        var flow = SurfaceFlow()
        for event in events { flow.handle(event) }
        return flow
    }

    // MARK: Talk, the bar empty

    func testTalkLight() { assertSnapshot(surface(look: .light), named: "surface-talk-light") }
    func testTalkDark() { assertSnapshot(surface(look: .dark), named: "surface-talk-dark") }
    func testTalkLargestText() { assertSnapshot(surface(look: .largest), named: "surface-talk-largest") }

    // MARK: The shared loading knot and failed line

    func testKnotLight() { assertSnapshot(surface(state: .loading), named: "surface-knot-light") }
    func testKnotDark() { assertSnapshot(surface(state: .loading, look: .dark), named: "surface-knot-dark") }
    func testKnotLargestText() { assertSnapshot(surface(state: .loading, look: .largest), named: "surface-knot-largest") }

    func testFailedLight() {
        assertSnapshot(surface(state: .failed(LoadFailure(kind: .offline))), named: "surface-failed-light")
    }
    func testFailedDark() {
        assertSnapshot(surface(state: .failed(LoadFailure(kind: .offline)), look: .dark), named: "surface-failed-dark")
    }
    func testFailedLargestText() {
        assertSnapshot(surface(state: .failed(LoadFailure(kind: .offline)), look: .largest), named: "surface-failed-largest")
    }

    // MARK: The bar's columns

    func testBarHasWordsLight() { assertSnapshot(surface(flow(.typed("I was hurt"))), named: "surface-words-light") }
    func testBarHasWordsDark() { assertSnapshot(surface(flow(.typed("I was hurt")), look: .dark), named: "surface-words-dark") }
    func testBarHasWordsLargestText() {
        assertSnapshot(surface(flow(.typed("I was hurt")), look: .largest), named: "surface-words-largest")
    }
    func testBarListening() { assertSnapshot(surface(flow(.micTapped)), named: "surface-listening-light") }
    func testBarSending() { assertSnapshot(surface(flow(.typed("I was hurt"), .sendTapped)), named: "surface-sending-light") }

    // MARK: The other views

    func testYouLight() { assertSnapshot(surface(flow(.pulled(.right))), named: "surface-you-light") }
    func testPeopleDark() { assertSnapshot(surface(flow(.pulled(.left)), look: .dark), named: "surface-people-dark") }
    func testThreadLight() {
        assertSnapshot(surface(flow(.pulled(.left), .threadOpened(name: "Jan"))), named: "surface-thread-light")
    }
}

/// #21: each pull is reachable as a VoiceOver action, on the elements every view has.
@MainActor
final class SurfaceAccessibilityTests: XCTestCase {
    private var window: UIWindow?

    /// SwiftUI builds its accessibility elements only while an assistive client is on; turn on the one UI tests use.
    /// Off again afterwards, so the snapshot tests in this process render as they were recorded.
    override class func setUp() {
        super.setUp()
        setAutomation(true)
    }

    override class func tearDown() {
        setAutomation(false)
        super.tearDown()
    }

    private static func setAutomation(_ on: Bool) {
        guard let handle = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
              let symbol = dlsym(handle, "_AXSSetAutomationEnabled") else { return }
        typealias SetEnabled = @convention(c) (Int32) -> Void
        unsafeBitCast(symbol, to: SetEnabled.self)(on ? 1 : 0)
    }

    override func tearDown() {
        window?.isHidden = true
        window = nil
        super.tearDown()
    }

    private func host(_ flow: SurfaceFlow) -> UIView {
        let model = SurfaceModel(flow)
        let host = UIHostingController(rootView: Surface(model: model) { _ in Color.clear })
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 393, height: 852))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        self.window = window
        return host.view
    }

    /// Every accessibility element under `root`, depth first.
    private func elements(under root: NSObject) -> [NSObject] {
        var found: [NSObject] = []
        var seen = Set<ObjectIdentifier>()
        func visit(_ object: NSObject, depth: Int) {
            guard depth < 40, seen.insert(ObjectIdentifier(object)).inserted else { return }
            found.append(object)
            if let children = object.accessibilityElements as? [NSObject] {
                children.forEach { visit($0, depth: depth + 1) }
            } else {
                let count = object.accessibilityElementCount()
                if count != NSNotFound, count > 0 {
                    for index in 0..<count {
                        if let child = object.accessibilityElement(at: index) as? NSObject { visit(child, depth: depth + 1) }
                    }
                }
            }
            if let view = object as? UIView { view.subviews.forEach { visit($0, depth: depth + 1) } }
        }
        visit(root, depth: 0)
        return found
    }

    private func identifier(_ object: NSObject) -> String? {
        guard object.responds(to: NSSelectorFromString("accessibilityIdentifier")) else { return nil }
        return object.value(forKey: "accessibilityIdentifier") as? String
    }

    private func actionNames(on id: String, in root: UIView) -> Set<String> {
        let matches = elements(under: root).filter { identifier($0) == id }
        return Set(matches.flatMap { ($0.accessibilityCustomActions ?? []).map(\.name) })
    }

    private func flow(_ events: SurfaceFlow.Event...) -> SurfaceFlow {
        var flow = SurfaceFlow()
        for event in events { flow.handle(event) }
        return flow
    }

    func testTalkOffersBothPullsOnTheBarAndThePullMark() {
        let root = host(SurfaceFlow())
        for id in ["bar.field", "pull.mark"] {
            XCTAssertEqual(actionNames(on: id, in: root), ["Show your kennings", "Show people"], id)
        }
    }

    func testYouAndPeopleOfferBackToTalk() {
        XCTAssertEqual(actionNames(on: "bar.field", in: host(flow(.pulled(.right)))), ["Back to talk"])
        XCTAssertEqual(actionNames(on: "bar.field", in: host(flow(.pulled(.left)))), ["Back to talk"])
    }

    func testThreadOffersShowPeople() {
        XCTAssertEqual(actionNames(on: "bar.field", in: host(flow(.threadOpened(name: "Jan")))), ["Show people"])
    }

    func testEdgesCarryTheirVoiceOverLabels() {
        let all = elements(under: host(SurfaceFlow()))
        XCTAssertEqual(all.first { identifier($0) == "edge.left" }?.accessibilityLabel, "Your kennings")
        XCTAssertEqual(all.first { identifier($0) == "edge.right" }?.accessibilityLabel, "Your people")
    }
}
