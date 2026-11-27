// Issue #16. Acceptance tests written in C4 from packages/01 only: flows/you.md (one test per row of both state tables:
// You rows 01-11, a kenning rows 12-18, in table order), flows/README.md (shared rules), states.md, behaviour.md and
// copy.md. No implementation was read.
//
// Pending: Tests/Pending is not part of the FlowsTests target. First step of the build:
// `git mv app/Packages/Flows/Tests/Pending/YouFlowTests.swift app/Packages/Flows/Tests/FlowsTests/` unchanged.
//
// ───────────────────────────── API the tests expect ─────────────────────────────
// Shared types exactly as in the #18 header (WriteSendFlowTests.swift): CallFailure, Haptic, Waiting; and LoadState /
// LoadFailure from Sources/Flows/LoadState.swift. A 401 from any call: the flow moves to `.sessionEnded` and emits
// `.endSession` (You holds no words of its own; the bar's words belong to Talk). A 403 code arrives as
// `.http(status: 403, error: "forbidden", reason: <code>)`. 429 `daily_limit` is not a You route (no model call).
//
// struct YouFlow (value type): You and the kenning card over it, one machine.
//   init()
//   private(set) var state: State                        // starts at .hidden
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context:
//     list: LoadState<[Group]>       // states.md `you`: loading / empty / failed / loaded. A 403 feature_off or owner_only
//                                    // is .failed(LoadFailure(kind: .notAllowed, canRetry: false)) (notOpen, no Try again);
//                                    // any other failure is .failed with canRetry true (.offline when offline, .server on 5xx)
//     kenning: Kenning?              // the card; nil when closed
//   Nested types (memberwise inits, fields in this order; all Equatable, Sendable):
//     enum State { hidden, shown, sessionEnded }
//     struct Item { id: String; kind: String; wording: String }      // id is the belief id and the item id
//     struct Group { kind: String; heading: String; items: [Item] }
//     struct Person { id: String; name: String }
//     struct Visibility { person: Person; sees: Bool }
//     struct Receipt { quote: String?; date: String }               // quote nil: typed, not from Talk
//     struct Detail { receipt: Receipt?; seenBy: [Person]? }        // receipts[0]; seenBy nil = left out (visibility failed)
//     struct Kenning { item: Item; detail: LoadState<Detail> }      // states.md `kenning`: kind and words show at once
//     enum Event { appeared, itemsLoaded([Group]), itemsFailed(CallFailure), retryTapped, itemTapped(Item),
//                  talkTapped, pulledLeft, sentFromBar(String),
//                  beliefLoaded(receipts: [Receipt]), beliefFailed(CallFailure),
//                  visibilityLoaded([Visibility]), visibilityFailed(CallFailure), kenningRetryTapped, tappedOutside }
//       `appeared` is a pull from the left, a tap on edge.left, or You appearing again.
//     enum Effect { call(Call), haptic(Haptic), moveToTalk, sendInTalk(String), endSession }
//     enum Call { getItems, getBelief(id: String), getVisibility(itemId: String) }
//
// Gaps, recorded on #16 (simplest behaviour consistent with the package): a 200 whose only items are `this_week` shows
// as empty; a 404 means the belief call's 404.
import XCTest
@testable import Flows

final class YouFlowTests: XCTestCase {
    typealias F = YouFlow
    let quiet = F.Item(id: "k-1", kind: "how_i_mean", wording: "When I go quiet, I'm thinking, not upset.")
    let plans = F.Item(id: "k-2", kind: "how_i_mean", wording: "When I ask about plans, I'm not checking up.")
    let care = F.Item(id: "k-3", kind: "feels_like_care", wording: "A cup of tea without asking.")
    let week = F.Item(id: "k-4", kind: "this_week", wording: "A big deadline on Friday.")
    var groups: [F.Group] {
        [F.Group(kind: "how_i_mean", heading: "How I mean things", items: [quiet, plans]),
         F.Group(kind: "feels_like_care", heading: "What feels like care", items: [care])]
    }
    let jan = F.Person(id: "p-jan", name: "Jan")
    let mia = F.Person(id: "p-mia", name: "Mia")
    let receipt = F.Receipt(quote: "I go quiet when I'm hurt.", date: "2026-11-20")

    // MARK: Helpers: reach each state through events, as the app would.
    func loaded() -> F {
        var f = F()
        _ = f.handle(.appeared)
        _ = f.handle(.itemsLoaded(groups))
        return f
    }
    func empty() -> F {
        var f = F()
        _ = f.handle(.appeared)
        _ = f.handle(.itemsLoaded([]))
        return f
    }
    func failed() -> F {
        var f = F()
        _ = f.handle(.appeared)
        _ = f.handle(.itemsFailed(.http(status: 500)))
        return f
    }
    func opened() -> F {
        var f = loaded()
        _ = f.handle(.itemTapped(quiet))
        return f
    }
    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }
    func failureOf(_ list: LoadState<[F.Group]>) -> LoadFailure? {
        if case let .failed(f) = list { return f } else { return nil }
    }

    // MARK: You

    func test_row01_anyView_pullOrEdge_loadingAndTheItemsAreFetched() {
        var f = F()
        XCTAssertEqual(f.state, .hidden)
        let fx = f.handle(.appeared)
        XCTAssertEqual(f.state, .shown)
        XCTAssertEqual(f.list, .loading)
        XCTAssertEqual(calls(fx), [.getItems])
    }

    func test_row02_loading_200WithItems_groupsInTheOrderGiven_emptyKindsAbsent_thisWeekNotShown() {
        var f = F()
        _ = f.handle(.appeared)
        let given = [F.Group(kind: "how_i_mean", heading: "How I mean things", items: [quiet, plans]),
                     F.Group(kind: "heated", heading: "When it gets heated", items: []),
                     F.Group(kind: "this_week", heading: "This week", items: [week]),
                     F.Group(kind: "feels_like_care", heading: "What feels like care", items: [care])]
        _ = f.handle(.itemsLoaded(given))
        XCTAssertEqual(f.list, .loaded(groups), "server order kept, newest first inside a kind; empty kinds and this_week absent")
    }

    func test_row02_onlyThisWeekItems_showsAsEmpty() {
        var f = F()
        _ = f.handle(.appeared)
        _ = f.handle(.itemsLoaded([F.Group(kind: "this_week", heading: "This week", items: [week])]))
        XCTAssertEqual(f.list, .empty)
    }

    func test_row03_loading_200NoItems_empty() {
        let f = empty()
        XCTAssertEqual(f.state, .shown)
        XCTAssertEqual(f.list, .empty)
    }

    func test_row04_loading_403FeatureOffOrOwnerOnly_failedNotOpenWithNoTryAgain() {
        for reason in ["feature_off", "owner_only"] {
            var f = F()
            _ = f.handle(.appeared)
            _ = f.handle(.itemsFailed(.http(status: 403, error: "forbidden", reason: reason)))
            XCTAssertEqual(f.list, .failed(LoadFailure(kind: .notAllowed, canRetry: false)), reason)
        }
    }

    func test_row05_loading_fails_failedWithTryAgain() {
        for failure in [CallFailure.http(status: 500), .http(status: 503), .offline, .timeout] {
            var f = F()
            _ = f.handle(.appeared)
            _ = f.handle(.itemsFailed(failure))
            XCTAssertEqual(failureOf(f.list)?.canRetry, true, "\(failure)")
        }
        var o = F(); _ = o.handle(.appeared); _ = o.handle(.itemsFailed(.offline))
        XCTAssertEqual(failureOf(o.list)?.kind, .offline)
        var s = F(); _ = s.handle(.appeared); _ = s.handle(.itemsFailed(.http(status: 500)))
        XCTAssertEqual(failureOf(s.list)?.kind, .server)
    }

    func test_row06_failed_retry_loadingAgain() {
        var f = failed()
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(f.list, .loading)
        XCTAssertEqual(calls(fx), [.getItems])
    }

    func test_row07_loaded_tapAnItem_theKenningCardRisesLoading() {
        var f = loaded()
        _ = f.handle(.itemTapped(quiet))
        XCTAssertEqual(f.kenning, F.Kenning(item: quiet, detail: .loading), "kind and words show at once")
        XCTAssertEqual(f.list, .loaded(groups), "You stays under the card")
    }

    func test_row08_empty_tapTalk_theMoveToTalk() {
        var f = empty()
        let fx = f.handle(.talkTapped)
        XCTAssertEqual(f.state, .hidden)
        XCTAssertTrue(fx.contains(.moveToTalk))
    }

    func test_row09_any_pullLeft_backToTalk() {
        for start in [loaded(), empty(), failed(), opened()] {
            var f = start
            _ = f.handle(.pulledLeft)
            XCTAssertEqual(f.state, .hidden)
        }
    }

    func test_row10_any_sendWordsFromTheBar_moveToTalkThenTheSend() {
        for start in [loaded(), empty(), failed()] {
            var f = start
            let fx = f.handle(.sentFromBar("I go quiet when I'm hurt."))
            XCTAssertEqual(f.state, .hidden)
            XCTAssertTrue(fx.contains(.sendInTalk("I go quiet when I'm hurt.")))
            XCTAssertTrue(calls(fx).isEmpty, "the send itself is Talk's")
        }
    }

    func test_row11_any_youAppearsAgain_loadingSoANewKenningShows() {
        var f = loaded()
        _ = f.handle(.pulledLeft)
        let fx = f.handle(.appeared)
        XCTAssertEqual(f.state, .shown)
        XCTAssertEqual(f.list, .loading)
        XCTAssertEqual(calls(fx), [.getItems])
        let newer = F.Item(id: "k-9", kind: "how_i_mean", wording: "New words.")
        let again = [F.Group(kind: "how_i_mean", heading: "How I mean things", items: [newer, quiet, plans])]
        _ = f.handle(.itemsLoaded(again))
        XCTAssertEqual(f.list, .loaded(again))
    }

    // MARK: A kenning

    func test_row12_kenningLoading_bothCallsTogetherAndASoftTick() {
        var f = loaded()
        let fx = f.handle(.itemTapped(quiet))
        XCTAssertEqual(f.kenning?.detail, .loading)
        XCTAssertEqual(Set(calls(fx).map { "\($0)" }),
                       Set([F.Call.getBelief(id: "k-1"), .getVisibility(itemId: "k-1")].map { "\($0)" }))
        XCTAssertEqual(calls(fx).count, 2)
        XCTAssertTrue(fx.contains(.haptic(.softTick)))
    }

    func test_row13_kenningLoading_both200_loadedWithTheReceiptAndSeenBy() {
        var f = opened()
        _ = f.handle(.beliefLoaded(receipts: [receipt, F.Receipt(quote: nil, date: "2026-11-01")]))
        XCTAssertEqual(f.kenning?.detail, .loading, "still loading until both have answered")
        _ = f.handle(.visibilityLoaded([F.Visibility(person: jan, sees: true), F.Visibility(person: mia, sees: false)]))
        XCTAssertEqual(f.kenning, F.Kenning(item: quiet, detail: .loaded(F.Detail(receipt: receipt, seenBy: [jan]))))
    }

    func test_row13_kenningLoading_both200InTheOtherOrder_loaded() {
        var f = opened()
        _ = f.handle(.visibilityLoaded([F.Visibility(person: jan, sees: false)]))
        XCTAssertEqual(f.kenning?.detail, .loading)
        _ = f.handle(.beliefLoaded(receipts: [receipt]))
        XCTAssertEqual(f.kenning?.detail, .loaded(F.Detail(receipt: receipt, seenBy: [])), "nobody sees it: Only you")
    }

    func test_row14_kenningLoading_visibilityFails_loadedWithoutSeenBy() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout, .http(status: 403, error: "forbidden")] {
            var f = opened()
            _ = f.handle(.visibilityFailed(failure))
            _ = f.handle(.beliefLoaded(receipts: [receipt]))
            XCTAssertEqual(f.kenning?.detail, .loaded(F.Detail(receipt: receipt, seenBy: nil)), "\(failure)")
        }
    }

    func test_row15_kenningLoading_receiptCallFails_failedAndTheCardKeepsKindAndWords() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout] {
            var f = opened()
            _ = f.handle(.visibilityLoaded([F.Visibility(person: jan, sees: true)]))
            _ = f.handle(.beliefFailed(failure))
            XCTAssertEqual(f.kenning?.item, quiet, "\(failure)")
            guard case .failed? = f.kenning?.detail else { return XCTFail("not failed for \(failure)") }
        }
    }

    func test_row16_kenningLoading_404_theCardSinksAndYouReloads() {
        var f = opened()
        let fx = f.handle(.beliefFailed(.http(status: 404, error: "not_found")))
        XCTAssertNil(f.kenning)
        XCTAssertEqual(f.list, .loading)
        XCTAssertEqual(calls(fx), [.getItems])
    }

    func test_row17_kenningFailed_retry_loadingAndTheReceiptIsFetchedAgain() {
        var f = opened()
        _ = f.handle(.visibilityLoaded([]))
        _ = f.handle(.beliefFailed(.offline))
        let fx = f.handle(.kenningRetryTapped)
        XCTAssertEqual(f.kenning?.detail, .loading)
        XCTAssertEqual(f.kenning?.item, quiet)
        XCTAssertTrue(calls(fx).contains(.getBelief(id: "k-1")))
    }

    func test_row18_kenningLoadedOrFailed_tapOutside_closed() {
        var a = opened()
        _ = a.handle(.beliefLoaded(receipts: [receipt]))
        _ = a.handle(.visibilityLoaded([]))
        _ = a.handle(.tappedOutside)
        XCTAssertNil(a.kenning)
        XCTAssertEqual(a.list, .loaded(groups))

        var b = opened()
        _ = b.handle(.visibilityLoaded([]))
        _ = b.handle(.beliefFailed(.offline))
        _ = b.handle(.tappedOutside)
        XCTAssertNil(b.kenning)
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401OnAnyCall_endsTheSession() {
        let unauthorized = CallFailure.http(status: 401, error: "unauthorized")

        var a = F()
        _ = a.handle(.appeared)
        let ax = a.handle(.itemsFailed(unauthorized))
        XCTAssertEqual(a.state, .sessionEnded)
        XCTAssertTrue(ax.contains(.endSession))

        var b = opened()
        let bx = b.handle(.beliefFailed(unauthorized))
        XCTAssertEqual(b.state, .sessionEnded)
        XCTAssertTrue(bx.contains(.endSession))

        var c = opened()
        let cx = c.handle(.visibilityFailed(unauthorized))
        XCTAssertEqual(c.state, .sessionEnded)
        XCTAssertTrue(cx.contains(.endSession))
    }

    func test_states_failedIsNeverEmptyOrLoaded() {
        let f = failed()
        XCTAssertNotEqual(f.list, .empty)
        XCTAssertNotNil(failureOf(f.list))
    }
}
