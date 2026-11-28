// Issue #19. Acceptance tests written in C4 from packages/01 only: flows/read.md (one test per row of its two state tables:
// Notifications, Thread), flows/README.md (shared rules), states.md, behaviour.md, routes.md and copy.md. No implementation
// was read.
//
// Pending: Tests/Pending is not part of the FlowsTests target. First step of the build:
// `git mv app/Packages/Flows/Tests/Pending/ReadFlowTests.swift app/Packages/Flows/Tests/FlowsTests/` unchanged.
//
// ───────────────────────────── API the tests expect ─────────────────────────────
// Shared by every flow in the Flows module, exactly as in the #18 tests (WriteSendFlowTests.swift); not redefined here:
//   enum CallFailure: Equatable, Sendable { case http(status: Int, error: String? = nil, reason: String? = nil); case offline; case timeout }
//   A 401 from any call: the flow moves to its `.sessionEnded` state and emits `.endSession`. Calls are effects the app
//   performs; their answers come back as events. `LoadState` / `LoadFailure` are the ones in Sources/Flows/LoadState.swift.
//
// struct NotificationsFlow (value type), table "Notifications":
//   init(device: Device, state: State = .notAsked)        // the app restores the stored state
//   private(set) var state: State
//   mutating func handle(_ event: Event) -> [Effect]
//   Nested types (memberwise inits, fields in this order):
//     struct Device: Equatable, Sendable { installationId: String; environment: String; bundleId: String; locale: String }
//     struct Registration: Equatable, Sendable { installationId: String; token: String; environment: String; bundleId: String; locale: String }
//     enum State: Equatable { notAsked, asking, registering, on, off, sessionEnded }
//     enum Event { linkBecameActive, allowed, denied, tokenReceived(String), registered, registerFailed(CallFailure), appLaunched,
//                  pushReceived(personId: String), pushTapped(personId: String) }
//       `linkBecameActive` is the person's first active link (an accepted invite, or People first showing someone who accepted
//       theirs); `tokenReceived` is the APNs device token, after `registerForRemoteNotifications` and whenever it changes;
//       a push's `target_id` is the linked person's id (CONTRACT §12.4).
//     enum Effect: Equatable { requestPermission, registerForRemoteNotifications, call(Call), openThread(personId: String), endSession }
//     enum Call: Equatable { putDevice(Registration) }
//
// struct ThreadFlow (value type), table "Thread":
//   init(person: Person)
//   private(set) var state: State                         // starts at .loading
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context: cards: LoadState<[Card]>, reading: Reading? (what the reading view shows), keptIds: Set<String>
//     (cards labelled FROM [NAME] · KEPT), didntOpen: String? (the card showing thread.didntOpen), notSaved: String?
//     (the card showing thread.notSaved)
//   Nested types:
//     struct Person: Equatable, Sendable { id: String; name: String }
//     struct Card: Equatable, Sendable { id: String; mine: Bool; folded: Bool; words: String? }
//       `id` is the bridge id; `mine` is a card you sent (right side); `folded` is a ready, unopened card to you.
//     struct Reading: Equatable { words: String; name: String }
//     enum State: Equatable { loading, loaded, empty, failed, opening(String), reading(String), afterReading(String),
//                             keeping(String), closed, sessionEnded }      // the String is the bridge id
//     enum Event { opened, threadLoaded([Card]), threadFailed(CallFailure), retryTapped, cardTouched(String),
//                  bridgeOpened(id: String, final: String), openFailed(id: String, CallFailure), touchedAnywhere, keepTapped,
//                  keepSucceeded, keepFailed(CallFailure), replyTapped, pulledAway, pushArrived(personId: String) }
//       `opened` is the thread shown; `threadLoaded` carries the bridge items of GET /threads/:person in time order;
//       `pulledAway` is a pull right or down.
//     enum Effect: Equatable { call(Call), showPeople, startReply(replyTo: String), endSession }
//       `startReply` hands over to write-send.md `editing` with the bar focused and `replyTo` = that card.
//     enum Call: Equatable { getThread(personId: String), openBridge(id: String), keepCard(bridgeId: String) }   // keepCard = PATCH /cards/:bridge_id {state: "kept"}
//
// Not asserted:
//   - What a push does while `opening` or `keeping` is under way (the owner's answer on #19 covers `reading` and
//     `afterReading` only).
// Owner's answer on #19 (25 Nov, option a): a push for this person while `reading` or `afterReading` is on screen does not
// reload. The reload waits until the first reading and Keep · Reply are done (Keep, Reply or a pull), then the thread loads.
// A touch during the reading only settles the card; Keep · Reply is still up, so the reload still waits.
//   - "Keep and Reply wait under the card next time": a thread item carries no card state (gap recorded on #6), so where the
//     next load learns that a card was read but not kept is open. Keep's 200 is modelled as an event only.
// Package gap, simplest behaviour taken (recorded on #19): the token arrives after `registerForRemoteNotifications`, so
// `PUT /devices/apns` is made on `tokenReceived`, not on `allowed`.
import XCTest
@testable import Flows

// MARK: - Notifications

final class NotificationsFlowTests: XCTestCase {
    typealias F = NotificationsFlow
    let device = F.Device(installationId: "inst-1", environment: "production", bundleId: "com.kenember.app", locale: "en-GB")
    func registration(_ token: String) -> F.Registration {
        F.Registration(installationId: "inst-1", token: token, environment: "production", bundleId: "com.kenember.app", locale: "en-GB")
    }
    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }
    func asking() -> F { var f = F(device: device); _ = f.handle(.linkBecameActive); return f }
    func registering() -> F { var f = asking(); _ = f.handle(.allowed); _ = f.handle(.tokenReceived("tok-1")); return f }
    func on() -> F { var f = registering(); _ = f.handle(.registered); return f }

    func test_row01_noPermissionAsked_firstLinkBecomesActive_asksOnce() {
        var f = F(device: device)
        XCTAssertEqual(f.state, .notAsked)
        let fx = f.handle(.linkBecameActive)
        XCTAssertEqual(f.state, .asking)
        XCTAssertEqual(fx, [.requestPermission])
        XCTAssertTrue(f.handle(.linkBecameActive).isEmpty, "once")
    }

    func test_row02_asking_allowed_registersAndPutsTheDevice() {
        var f = asking()
        let fx = f.handle(.allowed)
        XCTAssertEqual(f.state, .registering)
        XCTAssertEqual(fx, [.registerForRemoteNotifications])
        let tx = f.handle(.tokenReceived("tok-1"))
        XCTAssertEqual(f.state, .registering)
        XCTAssertEqual(calls(tx), [.putDevice(registration("tok-1"))])
    }

    func test_row03_asking_denied_offAndNothingMoreIsAsked() {
        var f = asking()
        let fx = f.handle(.denied)
        XCTAssertEqual(f.state, .off)
        XCTAssertTrue(fx.isEmpty)
        XCTAssertTrue(f.handle(.linkBecameActive).isEmpty)
        XCTAssertEqual(f.state, .off)

        var restored = F(device: device, state: .off)
        XCTAssertTrue(restored.handle(.linkBecameActive).isEmpty)
        XCTAssertTrue(restored.handle(.appLaunched).isEmpty)
    }

    func test_row04_registering_200_on() {
        var f = registering()
        let fx = f.handle(.registered)
        XCTAssertEqual(f.state, .on)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row05_registering_fails_onAndRetriedAtTheNextLaunch() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout, .http(status: 429, error: "daily_limit")] {
            var f = registering()
            let fx = f.handle(.registerFailed(failure))
            XCTAssertEqual(f.state, .on, "\(failure)")
            XCTAssertTrue(calls(fx).isEmpty, "not retried at once")
            let lx = f.handle(.appLaunched)
            XCTAssertEqual(f.state, .registering, "\(failure)")
            XCTAssertEqual(calls(lx), [.putDevice(registration("tok-1"))], "the same call")
        }
    }

    func test_row06_on_theTokenChanges_registersAgainWithTheSameCall() {
        var f = on()
        let fx = f.handle(.tokenReceived("tok-2"))
        XCTAssertEqual(f.state, .registering)
        XCTAssertEqual(calls(fx), [.putDevice(registration("tok-2"))])
    }

    func test_row07_on_bridgeReadyPushArrives_theSystemShowsItAndNothingChanges() {
        var f = on()
        let fx = f.handle(.pushReceived(personId: "p-jan"))
        XCTAssertEqual(f.state, .on)
        XCTAssertTrue(fx.isEmpty)
    }

    func test_row08_on_tapThePush_opensThatPersonsThread() {
        var f = on()
        let fx = f.handle(.pushTapped(personId: "p-jan"))
        XCTAssertEqual(fx, [.openThread(personId: "p-jan")])
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401OnPutDevice_endsTheSession() {
        var f = registering()
        let fx = f.handle(.registerFailed(.http(status: 401, error: "unauthorized")))
        XCTAssertEqual(f.state, .sessionEnded)
        XCTAssertTrue(fx.contains(.endSession))
    }
}

// MARK: - Thread

final class ThreadFlowTests: XCTestCase {
    typealias F = ThreadFlow
    let jan = F.Person(id: "p-jan", name: "Jan")
    let old = F.Card(id: "b-old", mine: false, folded: false, words: "Thanks for last night.")
    let sent = F.Card(id: "b-sent", mine: true, folded: false, words: "See you at eight.")
    let folded = F.Card(id: "b-new", mine: false, folded: true, words: nil)
    let theirWords = "I didn't mean it the way it sounded."

    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }
    func isFailed(_ s: LoadState<[F.Card]>) -> Bool { if case .failed = s { return true } else { return false } }
    func loadedCards(_ f: F) -> [F.Card] { if case let .loaded(c) = f.cards { return c } else { return [] } }

    func opened() -> F { var f = F(person: jan); _ = f.handle(.opened); return f }
    func loaded() -> F { var f = opened(); _ = f.handle(.threadLoaded([old, sent, folded])); return f }
    func empty() -> F { var f = opened(); _ = f.handle(.threadLoaded([])); return f }
    func failed() -> F { var f = opened(); _ = f.handle(.threadFailed(.http(status: 500))); return f }
    func opening() -> F { var f = loaded(); _ = f.handle(.cardTouched("b-new")); return f }
    func reading() -> F { var f = opening(); _ = f.handle(.bridgeOpened(id: "b-new", final: theirWords)); return f }
    func afterReading() -> F { var f = reading(); _ = f.handle(.touchedAnywhere); return f }
    func keeping() -> F { var f = afterReading(); _ = f.handle(.keepTapped); return f }

    func test_row01_loading_loadsTheThread() {
        var f = F(person: jan)
        XCTAssertEqual(f.state, .loading)
        let fx = f.handle(.opened)
        XCTAssertEqual(f.state, .loading)
        XCTAssertEqual(f.cards, .loading)
        XCTAssertEqual(calls(fx), [.getThread(personId: "p-jan")])
    }

    func test_row02_loading_200WithBridgeItems_loadedWithAReadyUnopenedCardFirst() {
        var f = opened()
        let fx = f.handle(.threadLoaded([old, sent, folded]))
        XCTAssertEqual(f.state, .loaded)
        let cards = loadedCards(f)
        XCTAssertEqual(cards.first, folded)
        XCTAssertEqual(Set(cards.map(\.id)), ["b-old", "b-sent", "b-new"])
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row03_loading_200NothingYet_empty() {
        var f = opened()
        _ = f.handle(.threadLoaded([]))
        XCTAssertEqual(f.state, .empty)
        XCTAssertEqual(f.cards, .empty)
    }

    func test_row04_loading_fails_failed() {
        for failure in [CallFailure.http(status: 500), .http(status: 503), .offline, .timeout] {
            var f = opened()
            _ = f.handle(.threadFailed(failure))
            XCTAssertEqual(f.state, .failed, "\(failure)")
            XCTAssertTrue(isFailed(f.cards), "\(failure)")
        }
    }

    func test_row05_failed_retry_loadsAgain() {
        var f = failed()
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(f.state, .loading)
        XCTAssertEqual(calls(fx), [.getThread(personId: "p-jan")])
    }

    func test_row06_loaded_touchAFoldedCard_opensIt() {
        var f = loaded()
        let fx = f.handle(.cardTouched("b-new"))
        XCTAssertEqual(f.state, .opening("b-new"))
        XCTAssertEqual(calls(fx), [.openBridge(id: "b-new")])
    }

    func test_row06_touchingAnyOtherCard_doesNothing() {
        for id in ["b-old", "b-sent"] {
            var f = loaded()
            let fx = f.handle(.cardTouched(id))
            XCTAssertEqual(f.state, .loaded, id)
            XCTAssertTrue(calls(fx).isEmpty, id)
        }
    }

    func test_row07_opening_200_theReadingShowsTheWordsAndTheNameOnly() {
        var f = opening()
        let fx = f.handle(.bridgeOpened(id: "b-new", final: theirWords))
        XCTAssertEqual(f.state, .reading("b-new"))
        XCTAssertEqual(f.reading, F.Reading(words: theirWords, name: "Jan"))
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row08_opening_404WithdrawnOrDeleted_reloads() {
        var f = opening()
        let fx = f.handle(.openFailed(id: "b-new", .http(status: 404, error: "not_found")))
        XCTAssertEqual(f.state, .loading)
        XCTAssertEqual(calls(fx), [.getThread(personId: "p-jan")])
        XCTAssertNil(f.didntOpen)
    }

    func test_row09_opening_403Sealed_reloadsQuietly() {
        var f = opening()
        let fx = f.handle(.openFailed(id: "b-new", .http(status: 403, error: "forbidden", reason: "sealed")))
        XCTAssertEqual(f.state, .loading)
        XCTAssertEqual(calls(fx), [.getThread(personId: "p-jan")])
        XCTAssertNil(f.didntOpen, "quietly: no line")
    }

    func test_row10_opening_fails_loadedWithDidntOpenUnderThatCardAndATouchTriesAgain() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout] {
            var f = opening()
            let fx = f.handle(.openFailed(id: "b-new", failure))
            XCTAssertEqual(f.state, .loaded, "\(failure)")
            XCTAssertEqual(f.didntOpen, "b-new", "\(failure)")
            XCTAssertTrue(calls(fx).isEmpty)
            let again = f.handle(.cardTouched("b-new"))
            XCTAssertEqual(f.state, .opening("b-new"))
            XCTAssertEqual(calls(again), [.openBridge(id: "b-new")])
        }
    }

    func test_row11_reading_touchAnywhere_theCardSettlesIntoTheThreadWithKeepAndReply() {
        var f = reading()
        let fx = f.handle(.touchedAnywhere)
        XCTAssertEqual(f.state, .afterReading("b-new"))
        XCTAssertNil(f.reading)
        XCTAssertEqual(loadedCards(f).first { $0.id == "b-new" },
                       F.Card(id: "b-new", mine: false, folded: false, words: theirWords))
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row12_afterReading_keep_patchesTheCard() {
        var f = afterReading()
        let fx = f.handle(.keepTapped)
        XCTAssertEqual(f.state, .keeping("b-new"))
        XCTAssertEqual(calls(fx), [.keepCard(bridgeId: "b-new")])
    }

    func test_row13_keeping_200_keptAndKeepReplyGo() {
        var f = keeping()
        let fx = f.handle(.keepSucceeded)
        XCTAssertEqual(f.state, .loaded)
        XCTAssertEqual(f.keptIds, ["b-new"])
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row14_keeping_fails_backToAfterReadingWithTheNotSavedLine() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout] {
            var f = keeping()
            _ = f.handle(.keepFailed(failure))
            XCTAssertEqual(f.state, .afterReading("b-new"), "\(failure)")
            XCTAssertEqual(f.notSaved, "b-new", "\(failure)")
            XCTAssertTrue(f.keptIds.isEmpty, "\(failure)")
        }
    }

    func test_row15_afterReading_reply_startsWritingAReplyToThisCard() {
        var f = afterReading()
        let fx = f.handle(.replyTapped)
        XCTAssertEqual(fx, [.startReply(replyTo: "b-new")])
    }

    func test_row16_afterReading_pullRightOrDown_people() {
        var f = afterReading()
        let fx = f.handle(.pulledAway)
        XCTAssertEqual(f.state, .closed)
        XCTAssertEqual(fx, [.showPeople])
    }

    func test_row17_any_pullRightOrDown_people() {
        for var f in [opened(), loaded(), empty(), failed()] {
            let fx = f.handle(.pulledAway)
            XCTAssertEqual(f.state, .closed)
            XCTAssertEqual(fx, [.showPeople])
        }
    }

    func test_row18_any_aPushForThisPersonWhileOpen_reloads() {
        for var f in [loaded(), empty(), failed()] {
            let fx = f.handle(.pushArrived(personId: "p-jan"))
            XCTAssertEqual(f.state, .loading)
            XCTAssertEqual(calls(fx), [.getThread(personId: "p-jan")])
        }
    }

    func test_row18_aPushDuringTheFirstReading_doesNotReload() {
        // Owner's answer on #19 (a): nothing moves while someone reads.
        var f = reading()
        let fx = f.handle(.pushArrived(personId: "p-jan"))
        XCTAssertEqual(f.state, .reading("b-new"))
        XCTAssertEqual(f.reading, F.Reading(words: theirWords, name: "Jan"))
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row18_aPushDuringKeepReply_doesNotReload() {
        var f = afterReading()
        let fx = f.handle(.pushArrived(personId: "p-jan"))
        XCTAssertEqual(f.state, .afterReading("b-new"))
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row18_aPushDuringTheReading_stillWaitsAfterTheTouch() {
        var f = reading()
        _ = f.handle(.pushArrived(personId: "p-jan"))
        let fx = f.handle(.touchedAnywhere)
        XCTAssertEqual(f.state, .afterReading("b-new"), "Keep · Reply is up: the reload still waits")
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row18_aPushThatWaited_reloadsOnceKeepIsDone() {
        var f = reading()
        _ = f.handle(.pushArrived(personId: "p-jan"))
        _ = f.handle(.touchedAnywhere)
        let kx = f.handle(.keepTapped)
        XCTAssertEqual(calls(kx), [.keepCard(bridgeId: "b-new")], "Keep's own call goes first")
        let fx = f.handle(.keepSucceeded)
        XCTAssertEqual(f.state, .loading)
        XCTAssertEqual(calls(fx), [.getThread(personId: "p-jan")])
    }

    func test_row18_aPushThatWaited_reloadsOnceReplyIsTapped() {
        var f = afterReading()
        _ = f.handle(.pushArrived(personId: "p-jan"))
        let fx = f.handle(.replyTapped)
        XCTAssertTrue(fx.contains(.startReply(replyTo: "b-new")))
        XCTAssertEqual(calls(fx), [.getThread(personId: "p-jan")])
    }

    func test_row18_aPushThatWaited_aPullStillGoesToPeople() {
        var f = afterReading()
        _ = f.handle(.pushArrived(personId: "p-jan"))
        let fx = f.handle(.pulledAway)
        XCTAssertEqual(f.state, .closed)
        XCTAssertTrue(fx.contains(.showPeople))
    }

    func test_row18_noPushWhileReading_keepDoesNotReload() {
        var f = keeping()
        let fx = f.handle(.keepSucceeded)
        XCTAssertEqual(f.state, .loaded)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row18_aPushForSomeoneElse_changesNothing() {
        var f = loaded()
        let fx = f.handle(.pushArrived(personId: "p-ana"))
        XCTAssertEqual(f.state, .loaded)
        XCTAssertTrue(fx.isEmpty)
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401OnAnyCall_endsTheSession() {
        let unauthorized = CallFailure.http(status: 401, error: "unauthorized")
        var a = opened()
        let ax = a.handle(.threadFailed(unauthorized))
        XCTAssertEqual(a.state, .sessionEnded)
        XCTAssertTrue(ax.contains(.endSession))

        var b = opening()
        let bx = b.handle(.openFailed(id: "b-new", unauthorized))
        XCTAssertEqual(b.state, .sessionEnded)
        XCTAssertTrue(bx.contains(.endSession))

        var c = keeping()
        let cx = c.handle(.keepFailed(unauthorized))
        XCTAssertEqual(c.state, .sessionEnded)
        XCTAssertTrue(cx.contains(.endSession))
    }

    func test_shared_429_neverBreaksTheFlow() {
        let limit = CallFailure.http(status: 429, error: "daily_limit")
        var a = opening()
        _ = a.handle(.openFailed(id: "b-new", limit))
        XCTAssertEqual(a.state, .loaded)
        XCTAssertEqual(calls(a.handle(.cardTouched("b-new"))), [.openBridge(id: "b-new")])

        var b = keeping()
        _ = b.handle(.keepFailed(limit))
        XCTAssertEqual(b.state, .afterReading("b-new"))
        XCTAssertEqual(calls(b.handle(.keepTapped)), [.keepCard(bridgeId: "b-new")])
    }

    func test_shared_savedMeansConfirmed_keptOnlyAfterThe200() {
        var f = afterReading()
        _ = f.handle(.keepTapped)
        XCTAssertEqual(f.state, .keeping("b-new"))
        XCTAssertFalse(f.keptIds.contains("b-new"), "KEPT shows only after the server answers")
        _ = f.handle(.keepSucceeded)
        XCTAssertTrue(f.keptIds.contains("b-new"))
    }
}
