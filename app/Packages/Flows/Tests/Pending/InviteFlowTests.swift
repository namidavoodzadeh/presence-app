// Issue #17. Acceptance tests written in C4 from packages/01 only: flows/invite.md (one test per row of its three state
// tables: People, Someone new, The invited person), flows/README.md (shared rules), states.md, behaviour.md, routes.md and
// copy.md. No implementation was read.
//
// Pending: Tests/Pending is not part of the FlowsTests target. First step of the build:
// `git mv app/Packages/Flows/Tests/Pending/InviteFlowTests.swift app/Packages/Flows/Tests/FlowsTests/` unchanged.
//
// ───────────────────────────── API the tests expect ─────────────────────────────
// Shared by every flow in the Flows module, exactly as in the #18 tests (WriteSendFlowTests.swift); not redefined here:
//   enum CallFailure: Equatable, Sendable { case http(status: Int, error: String? = nil, reason: String? = nil); case offline; case timeout }
//   A 401 from any call: the flow moves to its `.sessionEnded` state and emits `.endSession`; words in the bar are kept
//   (`.keepWordsOnPhone(text)` when there are any). Calls are effects the app performs; their answers come back as events.
//   `LoadState` / `LoadFailure` are the ones in Sources/Flows/LoadState.swift.
//
// struct PeopleFlow (value type), table "People":
//   init()
//   private(set) var state: State                         // starts at .hidden
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context: list: LoadState<[Person]>         // rows, most urgent first
//   Nested types (memberwise inits, fields in this order):
//     struct Person: Equatable, Sendable { id: String; name: String }
//     enum State: Equatable { hidden, loading, loaded, empty, failed, sessionEnded }
//     enum Event { shown, homeLoaded([Person]), homeFailed(CallFailure), retryTapped, rowTapped(Int), someoneNewTapped, pulledRight }
//       `shown` is the pull from the right or a tap on edge.right; `homeLoaded` carries GET /home's `people` in the
//       server's order (least urgent first).
//     enum Effect: Equatable { call(Call), openThread(personId: String), openSomeoneNew, showTalk, endSession }
//     enum Call: Equatable { getHome }
//
// struct SomeoneNewFlow (value type), table "Someone new (inviter)":
//   init(me: String)                                      // [Me], the signed-in person's first name
//   private(set) var state: State                         // starts at .opening
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context: relationship: Relationship?, name: String, words: String (the bar), gift: Item?, showsChange: Bool,
//     showsNameLine: Bool (someoneNew.line), canShare: Bool (someoneNew.share / bar.send enabled), line: Line?
//   Nested types:
//     struct Item: Equatable, Sendable { id: String; kind: String; wording: String; scope: Scope; status: String; datedAt: Date }
//     enum Scope: Equatable, Sendable { everyone, type(String), person(String) }
//     enum Relationship: String, Equatable { partner, friend, family }
//     enum Line: Equatable { notKept, notSent }             // copy someoneNew.notKept / someoneNew.notSent
//     enum State: Equatable { opening, picking, ready, writingOne, failed, savingOne, safetyStop, creating, sharing,
//                             closed, sessionEnded }
//     enum Event { opened, itemsLoaded([Item]), itemsFailed(CallFailure), retryTapped, changeTapped, whoTapped(Relationship),
//                  nameChanged(String), wordsChanged(String), shareTapped, itemCreated(Item), itemRefused(state: String),
//                  itemSaveFailed(CallFailure), safetyClosed, inviteCreated(code: String, link: String),
//                  inviteFailed(CallFailure), shared, shareCancelled, pulledAway }
//       `itemsLoaded` carries every item of GET /comm/items (This week and the groups, flattened, any order);
//       `shareTapped` is someoneNew.share, which is the bar's send (also in writingOne); `itemRefused` is a 200 from
//       POST /comm/items with `item: null` and its `state`; `pulledAway` is a pull down or right.
//     enum Effect: Equatable { call(Call), shareSheet(text: String), keepWordsOnPhone(String), endSession }
//     enum Call: Equatable { getItems, saveItem(NewItem), createInvite(InviteRequest) }
//     struct NewItem: Equatable { kind: String; wording: String; source: String; scopeType: String }
//     struct InviteRequest: Equatable { relationship: Relationship?; giftItemId: String }
//   Eligible gift: status "active", kind how_i_mean | feels_like_care | bring_up, scope not .person. Order: bring_up first,
//   then newest first by datedAt; Change steps through that order and wraps round to the first.
//
// struct InvitedFlow (value type), table "The invited person":
//   init(code: String, signedIn: Bool)
//   private(set) var state: State                         // starts at .idle
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context: invite: Invite?                    // what GET /invites/:code returned
//   Nested types:
//     struct Person: Equatable, Sendable { id: String; name: String }
//     struct Gift: Equatable, Sendable { kind: String; wording: String }
//     struct Invite: Equatable, Sendable { inviterName: String; gift: Gift?; wayIn: String }
//     enum TalkLine: Equatable { deadLink, ownLink, unavailable }   // copy invite.deadLink / invite.ownLink / the unavailable line
//     enum State: Equatable { idle, signingIn, peeking, accepting, arrived, deadLink, ownLink, peekFailed, closed, sessionEnded }
//     enum Event { opened, peeked(Invite), peekFailed(CallFailure), retryTapped, accepted(Person), acceptFailed(CallFailure),
//                  pulledAway }
//       `opened` is the app opened by the link; `pulledAway` is a pull right or down.
//     enum Effect: Equatable { call(Call), keepPendingInvite(String), clearPendingInvite, linkBecameActive,
//                              openThread(person: Person, gift: Gift?), showTalk(firstReply: TalkLine), showPeople,
//                              talkOpening(wayIn: String, aboutName: String), endSession }
//       `linkBecameActive` is handed to the notifications flow (read.md: ask for notification permission once).
//     enum Call: Equatable { peekInvite(code: String), acceptInvite(code: String) }
//
// Package gaps, simplest behaviour taken (recorded on #17):
//   - Someone new, "creating | fails | ready or writingOne": back to the state the share started from. Whether a second tap
//     after the typed line was already stored (201) saves it again or reuses it is not asserted.
//   - The invited person, "accepting | 409 | arrived | as above": a 409 carries no `person`, so which thread opens is not
//     asserted; only the state, clearing pendingInvite and the notification ask are.
//   - "any | type a first name": 40 characters at most is taken as "the name keeps its first 40 characters".
import XCTest
@testable import Flows

// MARK: - People

final class PeopleFlowTests: XCTestCase {
    typealias F = PeopleFlow
    let ana = F.Person(id: "p-ana", name: "Ana")     // least urgent (first in GET /home)
    let ben = F.Person(id: "p-ben", name: "Ben")
    let jan = F.Person(id: "p-jan", name: "Jan")     // most urgent (last in GET /home)

    func shown() -> F { var f = F(); _ = f.handle(.shown); return f }
    func loaded() -> F { var f = shown(); _ = f.handle(.homeLoaded([ana, ben, jan])); return f }
    func empty() -> F { var f = shown(); _ = f.handle(.homeLoaded([])); return f }
    func failed() -> F { var f = shown(); _ = f.handle(.homeFailed(.http(status: 500))); return f }
    func isFailed(_ s: LoadState<[F.Person]>) -> Bool { if case .failed = s { return true } else { return false } }
    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }

    func test_row01_anyView_pullFromTheRight_loadsHome() {
        var f = F()
        XCTAssertEqual(f.state, .hidden)
        let fx = f.handle(.shown)
        XCTAssertEqual(f.state, .loading)
        XCTAssertEqual(f.list, .loading)
        XCTAssertEqual(calls(fx), [.getHome])
    }

    func test_row02_loading_200WithPeople_loadedMostUrgentFirst() {
        var f = shown()
        let fx = f.handle(.homeLoaded([ana, ben, jan]))
        XCTAssertEqual(f.state, .loaded)
        XCTAssertEqual(f.list, .loaded([jan, ben, ana]), "the reverse of GET /home's array")
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row03_loading_200Nobody_empty() {
        var f = shown()
        _ = f.handle(.homeLoaded([]))
        XCTAssertEqual(f.state, .empty)
        XCTAssertEqual(f.list, .empty)
    }

    func test_row04_loading_fails_failed() {
        for failure in [CallFailure.http(status: 500), .http(status: 503), .offline, .timeout] {
            var f = shown()
            _ = f.handle(.homeFailed(failure))
            XCTAssertEqual(f.state, .failed, "\(failure)")
            XCTAssertTrue(isFailed(f.list), "\(failure)")
        }
    }

    func test_row05_failed_retry_loadsAgain() {
        var f = failed()
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(f.state, .loading)
        XCTAssertEqual(f.list, .loading)
        XCTAssertEqual(calls(fx), [.getHome])
    }

    func test_row06_loaded_tapARow_opensThatPersonsThread() {
        var f = loaded()
        XCTAssertEqual(f.handle(.rowTapped(0)), [.openThread(personId: "p-jan")])
        XCTAssertEqual(f.handle(.rowTapped(2)), [.openThread(personId: "p-ana")])
    }

    func test_row06_rowsAreNotTappableBeforeTheyAreLoaded() {
        var f = shown()
        XCTAssertTrue(f.handle(.rowTapped(0)).isEmpty)
        XCTAssertEqual(f.state, .loading)
    }

    func test_row07_any_tapSomeoneNew_opensSomeoneNew() {
        for var f in [shown(), loaded(), empty(), failed()] {
            let before = f.state
            let fx = f.handle(.someoneNewTapped)
            XCTAssertEqual(fx, [.openSomeoneNew], "\(before)")
            XCTAssertEqual(f.state, before, "People stays underneath")
        }
    }

    func test_row08_any_pullRight_showsTalk() {
        for var f in [shown(), loaded(), empty(), failed()] {
            let fx = f.handle(.pulledRight)
            XCTAssertEqual(fx, [.showTalk])
            XCTAssertEqual(f.state, .hidden)
        }
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401_endsTheSession() {
        var f = shown()
        let fx = f.handle(.homeFailed(.http(status: 401, error: "unauthorized")))
        XCTAssertEqual(f.state, .sessionEnded)
        XCTAssertTrue(fx.contains(.endSession))
    }

    func test_shared_429_isAnOrdinaryFailureAndTryAgainStillWorks() {
        var f = shown()
        _ = f.handle(.homeFailed(.http(status: 429, error: "daily_limit")))
        XCTAssertEqual(f.state, .failed)
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(f.state, .loading)
        XCTAssertEqual(calls(fx), [.getHome])
    }
}

// MARK: - Someone new (inviter)

final class SomeoneNewFlowTests: XCTestCase {
    typealias F = SomeoneNewFlow
    static func day(_ n: Double) -> Date { Date(timeIntervalSince1970: 1_790_000_000 + n * 86_400) }
    let mean = F.Item(id: "i-mean", kind: "how_i_mean", wording: "When I go quiet I'm thinking, not upset.",
                      scope: .everyone, status: "active", datedAt: SomeoneNewFlowTests.day(3))
    let care = F.Item(id: "i-care", kind: "feels_like_care", wording: "A message when you're running late.",
                      scope: .type("partner"), status: "active", datedAt: SomeoneNewFlowTests.day(5))
    let bring = F.Item(id: "i-bring", kind: "bring_up", wording: "Tell me early, not at bedtime.",
                       scope: .everyone, status: "active", datedAt: SomeoneNewFlowTests.day(1))
    let created = F.Item(id: "i-new", kind: "how_i_mean", wording: "I need a minute before I answer.",
                         scope: .everyone, status: "active", datedAt: SomeoneNewFlowTests.day(9))
    let words = "I need a minute before I answer."
    let link = "https://kenember.com/i/K7PM3Q"
    let shareText = "Nami wants you to know one thing. This link is for you only: https://kenember.com/i/K7PM3Q"

    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }
    func picking() -> F { var f = F(me: "Nami"); _ = f.handle(.opened); return f }
    func ready(_ items: [F.Item]? = nil, name: String? = "Jan", who: F.Relationship? = .partner) -> F {
        var f = picking()
        _ = f.handle(.itemsLoaded(items ?? [mean, care]))
        if let who { _ = f.handle(.whoTapped(who)) }
        if let name { _ = f.handle(.nameChanged(name)) }
        return f
    }
    func writingOne(name: String? = "Jan", words: String? = nil) -> F {
        var f = picking()
        _ = f.handle(.itemsLoaded([]))
        _ = f.handle(.whoTapped(.friend))
        if let name { _ = f.handle(.nameChanged(name)) }
        _ = f.handle(.wordsChanged(words ?? self.words))
        return f
    }
    func savingOne() -> F { var f = writingOne(); _ = f.handle(.shareTapped); return f }
    func creating() -> F { var f = ready(); _ = f.handle(.shareTapped); return f }
    func sharing() -> F { var f = creating(); _ = f.handle(.inviteCreated(code: "K7PM3Q", link: link)); return f }

    func test_row01_opening_loadsTheItems() {
        var f = F(me: "Nami")
        XCTAssertEqual(f.state, .opening)
        let fx = f.handle(.opened)
        XCTAssertEqual(f.state, .picking)
        XCTAssertEqual(calls(fx), [.getItems])
        XCTAssertFalse(f.canShare, "Share the link is dimmed while loading")
    }

    func test_row02_picking_200WithEligibleItems_readyWithTheNewestAsTheGiftAndChange() {
        var f = picking()
        _ = f.handle(.itemsLoaded([mean, care]))
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(f.gift, care, "newest eligible item")
        XCTAssertTrue(f.showsChange, "more than one eligible item")
    }

    func test_row02_howToBringSomethingUpComesFirstWhenThereIsOne() {
        var f = picking()
        _ = f.handle(.itemsLoaded([mean, care, bring]))
        XCTAssertEqual(f.gift, bring)
    }

    func test_row02_onlyOwnActiveItemsOfTheInviteKindsNotScopedToOnePersonAreEligible() {
        let later = SomeoneNewFlowTests.day(20)
        let ineligible = [
            F.Item(id: "x1", kind: "lands_hard", wording: "a", scope: .everyone, status: "active", datedAt: later),
            F.Item(id: "x2", kind: "this_week", wording: "b", scope: .everyone, status: "active", datedAt: later),
            F.Item(id: "x3", kind: "matters", wording: "c", scope: .everyone, status: "active", datedAt: later),
            F.Item(id: "x4", kind: "other", wording: "d", scope: .everyone, status: "active", datedAt: later),
            F.Item(id: "x5", kind: "how_i_mean", wording: "e", scope: .person("p-lea"), status: "active", datedAt: later),
            F.Item(id: "x6", kind: "how_i_mean", wording: "f", scope: .everyone, status: "set_aside", datedAt: later),
            F.Item(id: "x7", kind: "feels_like_care", wording: "g", scope: .everyone, status: "private_only", datedAt: later),
        ]
        var f = picking()
        _ = f.handle(.itemsLoaded(ineligible + [mean]))
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(f.gift, mean)
        XCTAssertFalse(f.showsChange, "only one eligible item: no Change")
    }

    func test_row03_picking_200NoneEligible_writingOne() {
        var f = picking()
        let other = F.Item(id: "x", kind: "lands_hard", wording: "a", scope: .everyone, status: "active", datedAt: SomeoneNewFlowTests.day(1))
        _ = f.handle(.itemsLoaded([other]))
        XCTAssertEqual(f.state, .writingOne)
        XCTAssertNil(f.gift)
        XCTAssertFalse(f.showsChange)
    }

    func test_row04_picking_fails_failedAndShareStaysDimmed() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout,
                        .http(status: 403, error: "forbidden", reason: "feature_off")] {
            var f = picking()
            _ = f.handle(.nameChanged("Jan"))
            _ = f.handle(.itemsFailed(failure))
            XCTAssertEqual(f.state, .failed, "\(failure)")
            XCTAssertFalse(f.canShare, "\(failure)")
            XCTAssertTrue(calls(f.handle(.shareTapped)).isEmpty)
        }
    }

    func test_row05_failed_retry_loadsAgain() {
        var f = picking()
        _ = f.handle(.itemsFailed(.offline))
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(f.state, .picking)
        XCTAssertEqual(calls(fx), [.getItems])
    }

    func test_row06_ready_change_nextEligibleNewestFirstThenRoundToTheFirst() {
        var f = picking()
        _ = f.handle(.itemsLoaded([mean, bring, care]))
        XCTAssertEqual(f.gift, bring)
        _ = f.handle(.changeTapped)
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(f.gift, care)
        _ = f.handle(.changeTapped)
        XCTAssertEqual(f.gift, mean)
        _ = f.handle(.changeTapped)
        XCTAssertEqual(f.gift, bring, "round to the first")
    }

    func test_row07_any_tapAWhoWord_underlinesIt_tapAgainClears() {
        var f = ready(name: nil, who: nil)
        XCTAssertNil(f.relationship)
        _ = f.handle(.whoTapped(.friend))
        XCTAssertEqual(f.relationship, .friend)
        XCTAssertEqual(f.state, .ready)
        _ = f.handle(.whoTapped(.family))
        XCTAssertEqual(f.relationship, .family, "one word at a time")
        _ = f.handle(.whoTapped(.family))
        XCTAssertNil(f.relationship)

        var g = writingOne()
        _ = g.handle(.whoTapped(.partner))
        XCTAssertEqual(g.relationship, .partner)
        XCTAssertEqual(g.state, .writingOne)
    }

    func test_row08_any_typeAFirstName_atMost40CharactersAndTheLineNamesThem() {
        var f = ready(name: nil)
        XCTAssertFalse(f.showsNameLine)
        _ = f.handle(.nameChanged("Jan"))
        XCTAssertEqual(f.name, "Jan")
        XCTAssertTrue(f.showsNameLine)
        XCTAssertEqual(f.state, .ready)
        _ = f.handle(.nameChanged(String(repeating: "a", count: 45)))
        XCTAssertEqual(f.name, String(repeating: "a", count: 40))
        _ = f.handle(.nameChanged(""))
        XCTAssertFalse(f.showsNameLine)
    }

    func test_row09_ready_shareWithAName_createsTheInviteWithTheGift() {
        var f = ready()
        XCTAssertTrue(f.canShare)
        let fx = f.handle(.shareTapped)
        XCTAssertEqual(f.state, .creating)
        XCTAssertEqual(calls(fx), [.createInvite(F.InviteRequest(relationship: .partner, giftItemId: "i-care"))])
    }

    func test_row09_ready_shareWithoutAName_isDimmed() {
        var f = ready(name: nil)
        XCTAssertFalse(f.canShare)
        let fx = f.handle(.shareTapped)
        XCTAssertEqual(f.state, .ready)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row09_theGiftSentIsTheOneShownAfterChange() {
        var f = ready()
        _ = f.handle(.changeTapped)
        let fx = f.handle(.shareTapped)
        XCTAssertEqual(calls(fx), [.createInvite(F.InviteRequest(relationship: .partner, giftItemId: "i-mean"))])
    }

    func test_row10_writingOne_sendWithANameAndWords_savesTheTypedLine() {
        var f = writingOne()
        XCTAssertTrue(f.canShare)
        let fx = f.handle(.shareTapped)
        XCTAssertEqual(f.state, .savingOne)
        XCTAssertEqual(calls(fx), [.saveItem(F.NewItem(kind: "how_i_mean", wording: words, source: "typed", scopeType: "everyone"))])
    }

    func test_row10_writingOne_sendWithoutWordsOrName_isDimmed() {
        var a = writingOne(words: "")
        XCTAssertFalse(a.canShare)
        XCTAssertTrue(calls(a.handle(.shareTapped)).isEmpty)
        XCTAssertEqual(a.state, .writingOne)

        var b = writingOne(name: nil)
        XCTAssertFalse(b.canShare)
        XCTAssertTrue(calls(b.handle(.shareTapped)).isEmpty)
        XCTAssertEqual(b.state, .writingOne)
    }

    func test_row11_savingOne_201_createsTheInviteWithTheNewItem() {
        var f = savingOne()
        let fx = f.handle(.itemCreated(created))
        XCTAssertEqual(f.state, .creating)
        XCTAssertEqual(calls(fx), [.createInvite(F.InviteRequest(relationship: .friend, giftItemId: "i-new"))])
        XCTAssertEqual(f.gift, created)
    }

    func test_row12_savingOne_safety_safetyStopAndTheWordsStay() {
        var f = savingOne()
        let fx = f.handle(.itemRefused(state: "safety"))
        XCTAssertEqual(f.state, .safetyStop)
        XCTAssertEqual(f.words, words)
        XCTAssertTrue(calls(fx).isEmpty, "nothing stored, no invite")
    }

    func test_row13_savingOne_anotherRefusal_writingOneWithTheNotKeptLine() {
        for state in ["not_kept", "offer_request", "offer_i_statement"] {
            var f = savingOne()
            let fx = f.handle(.itemRefused(state: state))
            XCTAssertEqual(f.state, .writingOne, state)
            XCTAssertEqual(f.line, .notKept, state)
            XCTAssertEqual(f.words, words, state)
            XCTAssertTrue(calls(fx).isEmpty)
        }
    }

    func test_row14_savingOne_fails_writingOneWithTheNotSentLine() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout] {
            var f = savingOne()
            let fx = f.handle(.itemSaveFailed(failure))
            XCTAssertEqual(f.state, .writingOne, "\(failure)")
            XCTAssertEqual(f.line, .notSent, "\(failure)")
            XCTAssertEqual(f.words, words)
            XCTAssertTrue(calls(fx).isEmpty)
        }
    }

    func test_row15_safetyStop_close_backToWritingOneWithTheWords() {
        var f = savingOne()
        _ = f.handle(.itemRefused(state: "safety"))
        _ = f.handle(.safetyClosed)
        XCTAssertEqual(f.state, .writingOne)
        XCTAssertEqual(f.words, words)
    }

    func test_row16_creating_200_theShareSheetWithTheShareTextAndLink() {
        var f = creating()
        let fx = f.handle(.inviteCreated(code: "K7PM3Q", link: link))
        XCTAssertEqual(f.state, .sharing)
        XCTAssertEqual(fx, [.shareSheet(text: shareText)])
    }

    func test_row17_creating_fails_backToReadyWithTheNotSentLine() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout,
                        .http(status: 403, error: "forbidden", reason: "not_giftable")] {
            var f = creating()
            _ = f.handle(.inviteFailed(failure))
            XCTAssertEqual(f.state, .ready, "\(failure)")
            XCTAssertEqual(f.line, .notSent, "\(failure)")
        }
    }

    func test_row17_creating_failsAfterATypedLine_backToWritingOneWithTheWords() {
        var f = savingOne()
        _ = f.handle(.itemCreated(created))
        _ = f.handle(.inviteFailed(.offline))
        XCTAssertEqual(f.state, .writingOne)
        XCTAssertEqual(f.line, .notSent)
        XCTAssertEqual(f.words, words)
    }

    func test_row18_sharing_shared_closed() {
        var f = sharing()
        let fx = f.handle(.shared)
        XCTAssertEqual(f.state, .closed)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row19_sharing_cancelled_readyAndTheSameInviteIsReused() {
        var f = sharing()
        _ = f.handle(.shareCancelled)
        XCTAssertEqual(f.state, .ready)
        let fx = f.handle(.shareTapped)
        XCTAssertTrue(calls(fx).isEmpty, "no second code")
        XCTAssertEqual(f.state, .sharing)
        XCTAssertEqual(fx, [.shareSheet(text: shareText)])
    }

    func test_row20_any_pullDownOrRight_closedAndNothingKept() {
        for var f in [picking(), ready(), writingOne(), creating(), sharing()] {
            let fx = f.handle(.pulledAway)
            XCTAssertEqual(f.state, .closed)
            XCTAssertTrue(calls(fx).isEmpty)
            XCTAssertFalse(fx.contains(.keepWordsOnPhone(words)), "nothing kept")
        }
    }

    // MARK: behaviour.md: while creating or sharing, WHO words are dimmed and the name is read-only

    func test_behaviour_whoAndNameAreFixedWhileCreatingAndSharing() {
        for var f in [creating(), sharing()] {
            _ = f.handle(.whoTapped(.family))
            _ = f.handle(.nameChanged("Lea"))
            XCTAssertEqual(f.relationship, .partner)
            XCTAssertEqual(f.name, "Jan")
        }
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401OnAnyCall_endsTheSessionAndKeepsTheWords() {
        let unauthorized = CallFailure.http(status: 401, error: "unauthorized")
        var a = picking()
        let ax = a.handle(.itemsFailed(unauthorized))
        XCTAssertEqual(a.state, .sessionEnded)
        XCTAssertTrue(ax.contains(.endSession))

        var b = savingOne()
        let bx = b.handle(.itemSaveFailed(unauthorized))
        XCTAssertEqual(b.state, .sessionEnded)
        XCTAssertTrue(bx.contains(.endSession))
        XCTAssertTrue(bx.contains(.keepWordsOnPhone(words)))

        var c = creating()
        let cx = c.handle(.inviteFailed(unauthorized))
        XCTAssertEqual(c.state, .sessionEnded)
        XCTAssertTrue(cx.contains(.endSession))
    }

    func test_shared_429_neverBreaksTheFlow_theWordsStayAndSendWorksAgain() {
        var f = savingOne()
        _ = f.handle(.itemSaveFailed(.http(status: 429, error: "daily_limit")))
        XCTAssertEqual(f.state, .writingOne)
        XCTAssertEqual(f.words, words)
        let fx = f.handle(.shareTapped)
        XCTAssertEqual(f.state, .savingOne)
        XCTAssertEqual(calls(fx).count, 1)
    }

    func test_shared_savedMeansConfirmed_theInviteIsMadeOnlyAfterTheItemIs201() {
        var f = savingOne()
        XCTAssertEqual(f.state, .savingOne)
        XCTAssertNil(f.gift, "no gift until the server stored the line")
        _ = f.handle(.itemCreated(created))
        XCTAssertEqual(f.state, .creating)
        XCTAssertEqual(f.gift, created)
    }
}

// MARK: - The invited person

final class InvitedFlowTests: XCTestCase {
    typealias F = InvitedFlow
    let lea = F.Person(id: "p-lea", name: "Lea")
    let gift = F.Gift(kind: "bring_up", wording: "Tell me early, not at bedtime.")
    let invite = F.Invite(inviterName: "Lea", gift: F.Gift(kind: "bring_up", wording: "Tell me early, not at bedtime."),
                          wayIn: "invited_by_partner")

    func peeking() -> F { var f = F(code: "K7PM3Q", signedIn: true); _ = f.handle(.opened); return f }
    func accepting() -> F { var f = peeking(); _ = f.handle(.peeked(invite)); return f }
    func arrived() -> F { var f = accepting(); _ = f.handle(.accepted(lea)); return f }
    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }

    func test_row01_openedByTheLinkSignedOut_signInAndThePendingInviteIsKept() {
        var f = F(code: "K7PM3Q", signedIn: false)
        XCTAssertEqual(f.state, .idle)
        let fx = f.handle(.opened)
        XCTAssertEqual(f.state, .signingIn)
        XCTAssertEqual(fx, [.keepPendingInvite("K7PM3Q")])
    }

    func test_row02_openedByTheLinkSignedIn_peeks() {
        var f = F(code: "K7PM3Q", signedIn: true)
        let fx = f.handle(.opened)
        XCTAssertEqual(f.state, .peeking)
        XCTAssertEqual(calls(fx), [.peekInvite(code: "K7PM3Q")])
    }

    func test_row03_peeking_200_acceptsAtOnce() {
        var f = peeking()
        let fx = f.handle(.peeked(invite))
        XCTAssertEqual(f.state, .accepting)
        XCTAssertEqual(calls(fx), [.acceptInvite(code: "K7PM3Q")])
        XCTAssertEqual(f.invite, invite)
    }

    func test_row04_peeking_404_deadLinkInTalk() {
        var f = peeking()
        let fx = f.handle(.peekFailed(.http(status: 404, error: "not_found")))
        XCTAssertEqual(f.state, .deadLink)
        XCTAssertEqual(fx, [.showTalk(firstReply: .deadLink)])
    }

    func test_row05_peeking_400OwnCode_ownLinkInTalk() {
        var f = peeking()
        let fx = f.handle(.peekFailed(.http(status: 400, error: "invalid")))
        XCTAssertEqual(f.state, .ownLink)
        XCTAssertEqual(fx, [.showTalk(firstReply: .ownLink)])
    }

    func test_row06_peeking_fails_peekFailedInTalkWithTryAgain() {
        for failure in [CallFailure.http(status: 500), .http(status: 503), .offline, .timeout] {
            var f = peeking()
            let fx = f.handle(.peekFailed(failure))
            XCTAssertEqual(f.state, .peekFailed, "\(failure)")
            XCTAssertEqual(fx, [.showTalk(firstReply: .unavailable)], "\(failure)")
        }
    }

    func test_row07_peekFailed_tryAgain_peeksAgain() {
        var f = peeking()
        _ = f.handle(.peekFailed(.offline))
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(f.state, .peeking)
        XCTAssertEqual(calls(fx), [.peekInvite(code: "K7PM3Q")])
    }

    func test_row08_accepting_200_arrivedInTheInvitersThreadWithTheGiftFirst() {
        var f = accepting()
        let fx = f.handle(.accepted(lea))
        XCTAssertEqual(f.state, .arrived)
        XCTAssertTrue(fx.contains(.clearPendingInvite))
        XCTAssertTrue(fx.contains(.linkBecameActive), "ask for notification permission (read.md)")
        XCTAssertTrue(fx.contains(.openThread(person: lea, gift: gift)))
    }

    func test_row08_aGiftSetAsideBeforeTheAccept_opensTheThreadWithoutIt() {
        var f = peeking()
        _ = f.handle(.peeked(F.Invite(inviterName: "Lea", gift: nil, wayIn: "invited_by_friend")))
        let fx = f.handle(.accepted(lea))
        XCTAssertEqual(f.state, .arrived)
        XCTAssertTrue(fx.contains(.openThread(person: lea, gift: nil)))
    }

    func test_row09_accepting_409AlreadyLinked_arrivedAsAbove() {
        var f = accepting()
        let fx = f.handle(.acceptFailed(.http(status: 409, error: "conflict")))
        XCTAssertEqual(f.state, .arrived)
        XCTAssertTrue(fx.contains(.clearPendingInvite))
        XCTAssertTrue(fx.contains(.linkBecameActive))
    }

    func test_row10_accepting_404_deadLink() {
        var f = accepting()
        _ = f.handle(.acceptFailed(.http(status: 404, error: "not_found")))
        XCTAssertEqual(f.state, .deadLink)
    }

    func test_row11_accepting_fails_peekFailed() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout] {
            var f = accepting()
            let fx = f.handle(.acceptFailed(failure))
            XCTAssertEqual(f.state, .peekFailed, "\(failure)")
            XCTAssertFalse(fx.contains(.clearPendingInvite), "\(failure)")
        }
    }

    func test_row12_arrived_pullRightOrDown_peopleAndTalkOpensFromTheInvite() {
        var f = arrived()
        let fx = f.handle(.pulledAway)
        XCTAssertEqual(f.state, .closed)
        XCTAssertTrue(fx.contains(.showPeople))
        XCTAssertTrue(fx.contains(.talkOpening(wayIn: "invited_by_partner", aboutName: "Lea")))
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401OnAnyCall_endsTheSession() {
        let unauthorized = CallFailure.http(status: 401, error: "unauthorized")
        var a = peeking()
        let ax = a.handle(.peekFailed(unauthorized))
        XCTAssertEqual(a.state, .sessionEnded)
        XCTAssertTrue(ax.contains(.endSession))

        var b = accepting()
        let bx = b.handle(.acceptFailed(unauthorized))
        XCTAssertEqual(b.state, .sessionEnded)
        XCTAssertTrue(bx.contains(.endSession))
    }

    func test_shared_429_isAnOrdinaryFailureAndTryAgainStillWorks() {
        var f = peeking()
        _ = f.handle(.peekFailed(.http(status: 429, error: "daily_limit")))
        XCTAssertEqual(f.state, .peekFailed)
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(calls(fx), [.peekInvite(code: "K7PM3Q")])
    }
}
