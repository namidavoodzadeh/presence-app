import XCTest
@testable import Flows

/// #21: the surface (screens.md "One surface, not pages"; behaviour.md, the talk bar and edges).
final class SurfaceFlowTests: XCTestCase {
    func testOpensOnTalkWithBothEdges() {
        let flow = SurfaceFlow()
        XCTAssertEqual(flow.view, .talk)
        XCTAssertTrue(flow.edgesShown)
        XCTAssertFalse(flow.settingsOpen)
        XCTAssertEqual(flow.placeholder, .talk)
    }

    func testYouFromTheLeftPeopleFromTheRight() {
        var flow = SurfaceFlow()
        flow.handle(.pulled(.right))
        XCTAssertEqual(flow.view, .you)
        XCTAssertFalse(flow.edgesShown)
        flow.handle(.pulled(.right))
        XCTAssertEqual(flow.view, .you, "no pull further right from You")
        flow.handle(.pulled(.left))
        XCTAssertEqual(flow.view, .talk)
        flow.handle(.pulled(.left))
        XCTAssertEqual(flow.view, .people)
        flow.handle(.pulled(.right))
        XCTAssertEqual(flow.view, .talk)
    }

    func testThreadRisesOverPeopleAndPullsBackToPeople() {
        var flow = SurfaceFlow()
        flow.handle(.pulled(.left))
        flow.handle(.threadOpened(name: "Jan"))
        XCTAssertEqual(flow.view, .thread)
        XCTAssertEqual(flow.placeholder, .thread(name: "Jan"))
        flow.handle(.pulled(.right))
        XCTAssertEqual(flow.view, .people)
        XCTAssertEqual(flow.placeholder, .talk)
    }

    func testEdgesRunThePullsOnlyOnTalk() {
        var flow = SurfaceFlow()
        flow.handle(.edgeLeft)
        XCTAssertEqual(flow.view, .you)
        flow.handle(.edgeRight)
        XCTAssertEqual(flow.view, .you, "edges are not shown on You")
        flow.handle(.action(.toTalk))
        flow.handle(.edgeRight)
        XCTAssertEqual(flow.view, .people)
    }

    func testEveryPullIsAVoiceOverAction() {
        let views: [SurfaceFlow.View] = [.talk, .you, .people, .thread]
        for view in views {
            for direction in [SurfaceFlow.Direction.left, .right] {
                guard let target = SurfaceFlow.destination(from: view, pulling: direction) else { continue }
                XCTAssertTrue(
                    SurfaceFlow.actions(for: view).contains { SurfaceFlow.destination(of: $0) == target },
                    "pull \(direction) from \(view) has no VoiceOver action"
                )
            }
        }
        XCTAssertEqual(SurfaceFlow.actions(for: .talk), [.toYou, .toPeople])
        XCTAssertEqual(SurfaceFlow.actions(for: .you), [.toTalk])
        XCTAssertEqual(SurfaceFlow.actions(for: .people), [.toTalk])
    }

    func testActionsMoveLikePullsAndIgnoreOnesTheViewHasNot() {
        var flow = SurfaceFlow()
        flow.handle(.action(.toTalk))
        XCTAssertEqual(flow.view, .talk)
        flow.handle(.action(.toPeople))
        XCTAssertEqual(flow.view, .people)
        flow.handle(.action(.toYou))
        XCTAssertEqual(flow.view, .people, "People offers no action to You")
    }

    func testPullMarkOpensSettingsFromAnyViewAndATouchOutsideCloses() {
        var flow = SurfaceFlow()
        flow.handle(.pulled(.left))
        flow.handle(.pullMark)
        XCTAssertTrue(flow.settingsOpen)
        flow.handle(.pulled(.right))
        XCTAssertEqual(flow.view, .people, "no pull under Settings")
        flow.handle(.settingsClosed)
        XCTAssertFalse(flow.settingsOpen)
        flow.handle(.pulled(.down))
        XCTAssertTrue(flow.settingsOpen, "a drag down from the top opens Settings too")
    }

    func testGestureStartsAfterTenSidewaysAndCommitsPastNinety() {
        typealias G = SurfaceFlow.Gesture
        XCTAssertFalse(G.isSideways(dx: 9, dy: 0))
        XCTAssertTrue(G.isSideways(dx: 10, dy: 2))
        XCTAssertFalse(G.isSideways(dx: 20, dy: 25), "more up or down than sideways is not a pull")
        XCTAssertNil(G.release(startY: 400, dx: 90, dy: 0), "90 springs back")
        XCTAssertEqual(G.release(startY: 400, dx: 91, dy: 0), .right)
        XCTAssertEqual(G.release(startY: 400, dx: -120, dy: 10), .left)
        XCTAssertEqual(G.release(startY: 100, dx: 0, dy: 120), .down)
        XCTAssertNil(G.release(startY: 200, dx: 0, dy: 120), "a drag down starting below 140 pt is not the Settings pull")
    }

    func testMicWhileEmptySendOnceThereAreWords() {
        var flow = SurfaceFlow()
        XCTAssertEqual(flow.bar, .empty)
        XCTAssertTrue(flow.micShown)
        XCTAssertFalse(flow.sendShown)
        flow.handle(.typed("   "))
        XCTAssertEqual(flow.bar, .empty, "spaces are not words")
        flow.handle(.typed("I was hurt"))
        XCTAssertEqual(flow.bar, .hasWords)
        XCTAssertFalse(flow.micShown)
        XCTAssertTrue(flow.sendShown)
        XCTAssertTrue(flow.sendEnabled)
    }

    func testListeningLandsWordsInTheBarAndSendsNothing() {
        var flow = SurfaceFlow()
        XCTAssertEqual(flow.handle(.micTapped), [.startListening, .haptic(.lightTap)])
        XCTAssertEqual(flow.bar, .listening)
        XCTAssertTrue(flow.fieldHidden)
        XCTAssertTrue(flow.micShown)
        XCTAssertEqual(flow.handle(.heard("Hello")), [])
        XCTAssertEqual(flow.words, "Hello")
        XCTAssertEqual(flow.bar, .hasWords)

        var stopped = SurfaceFlow()
        stopped.handle(.micTapped)
        XCTAssertEqual(stopped.handle(.micTapped), [.stopListening])
        XCTAssertEqual(stopped.bar, .empty)
    }

    func testSendInTalkDimsSendAndKeepsTheFieldReadOnlyUntilTheReply() {
        var flow = SurfaceFlow()
        flow.handle(.typed("Hi"))
        XCTAssertEqual(flow.handle(.sendTapped), [.send(words: "Hi", view: .talk)])
        XCTAssertEqual(flow.bar, .sending)
        XCTAssertTrue(flow.sendShown)
        XCTAssertFalse(flow.sendEnabled)
        XCTAssertFalse(flow.fieldEditable)
        XCTAssertEqual(flow.handle(.sendTapped), [], "a dimmed send does nothing")
        flow.handle(.typed("more"))
        XCTAssertEqual(flow.words, "Hi", "read-only while sending")
        flow.handle(.sendFinished(accepted: false))
        XCTAssertEqual(flow.words, "Hi")
        flow.handle(.sendTapped)
        flow.handle(.sendFinished(accepted: true))
        XCTAssertEqual(flow.bar, .empty)
    }

    func testWordsSaidOnYouOrPeopleGoToTalk() {
        var flow = SurfaceFlow()
        flow.handle(.pulled(.right))
        flow.handle(.typed("Hi"))
        XCTAssertEqual(flow.handle(.sendTapped), [.send(words: "Hi", view: .talk)])
        XCTAssertEqual(flow.view, .talk)
    }

    func testSendInAThreadIsTheThreadsOwn() {
        var flow = SurfaceFlow()
        flow.handle(.threadOpened(name: "Jan"))
        flow.handle(.typed("Hi Jan"))
        XCTAssertEqual(flow.handle(.sendTapped), [.send(words: "Hi Jan", view: .thread)])
        XCTAssertEqual(flow.view, .thread)
        XCTAssertEqual(flow.bar, .hasWords, "the thread's flow decides what happens to the words")
    }

    func testEdgesBreatheOnFirstLaunchUntilTheFirstMove() {
        var flow = SurfaceFlow(firstLaunch: true)
        XCTAssertTrue(flow.edgesBreathe)
        flow.handle(.edgeLeft)
        XCTAssertFalse(flow.edgesBreathe)
        XCTAssertFalse(SurfaceFlow().edgesBreathe)
    }
}
