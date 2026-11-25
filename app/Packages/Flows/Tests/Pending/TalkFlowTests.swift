// Issue #15. Acceptance tests written in C4 from packages/01 only: flows/talk.md (one test per row of both state
// tables, numbered 01-48 in table order), flows/README.md (shared rules), states.md, behaviour.md and copy.md.
// No implementation was read.
//
// Pending: Tests/Pending is not part of the FlowsTests target. First step of the build:
// `git mv app/Packages/Flows/Tests/Pending/TalkFlowTests.swift app/Packages/Flows/Tests/FlowsTests/` unchanged.
//
// ───────────────────────────── API the tests expect ─────────────────────────────
// Shared types exactly as in the #18 header (WriteSendFlowTests.swift): CallFailure, Haptic, Waiting. A 401 from any
// call: the flow moves to `.sessionEnded` and emits `.endSession`; words not yet through are kept (`.keepWordsOnPhone`).
// A 403 code (`feature_off`, `owner_only`, `ai_consent_required`) arrives as `.http(status: 403, error: "forbidden",
// reason: <code>)`. A 429 `daily_limit` on a turn arrives as its own event, `.turnLimited(opensAt:)`, because the
// flow needs `opens_at`.
//
// struct TalkFlow (value type):
//   init(aiConsentGiven: Bool = true, wayIn: WayIn = .ownDownload, aboutName: String? = nil,
//        conversationId: String? = nil, turns: [Turn] = [], micPermission: MicPermission = .notAsked)
//   private(set) var state: State                        // starts at .entering
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context: conversationId: String?, wayIn: WayIn, aboutName: String?, turns: [Turn], offered: Item?,
//     text: String (the bar), micShown: Bool, cardsFrom: [String]? (names from GET /home; nil when it failed, so the
//     greeting's second line is left out), safety: Safety?, opensAt: Date?, strength: Strength?, scope: Scope?,
//     people: [Person], whoSeesChoices: [Person], picked: [String] (person ids), onlyMe: Bool, notSaved: Bool
//   static let keptShownFor: TimeInterval                // 3.2: how long "Kept for you" stays
//   Nested types (memberwise inits, fields in this order; all Equatable):
//     enum State { entering, declined, opening, ready, closedForAccount, listening, askingPermission, sending,
//                  suggesting, safetyStop, aiConsent, limited, turnFailed, scoping, keeping, markingPartly, granting,
//                  sessionEnded }                        // "kept" passes straight through to .ready with `.showKept`
//     enum WayIn: String { ownDownload = "own_download", invitedByPartner = "invited_by_partner",
//                          invitedByFriend = "invited_by_friend" }
//     enum MicPermission { notAsked, granted, denied }
//     enum Strength { very, partly }
//     enum Turn { mine(String), reply(reflection: String?, question: String?), fallbackQuestion }
//     struct Item { kind: String; wording: String }
//     struct Person { id: String; name: String }
//     struct Safety { message: String; resources: [Resource] }
//     struct Resource { label: String; url: String }
//     enum Scope { everyone, partner, family, friends, coworkers, only(personId: String) }
//       var type: String { "everyone" | "type" | "person" };  var value: String? { nil | "partner" ... | person id }
//     enum TurnReply { ask(conversationId: String, reflection: String?, question: String?, itemState: String?, item: Item?),
//                      done(reflection: String?), safety(Safety) }
//     enum KeepReply { created(id: String), safety(Safety), notKept }   // notKept: offer_request, offer_i_statement, not_kept
//     struct KeptReport { partlyFailed: Bool; notSharedWith: [String] } // names, for talk.partlyFailed / talk.grantFailed
//     enum Event { entered, homeLoaded(cardsFrom: [String]), homeFailed(CallFailure),
//                  turnReturned(TurnReply), turnFailed(CallFailure), turnLimited(opensAt: Date),
//                  micTapped, permissionGranted, permissionDenied, recognitionUnsupported, heard(String), recognizerFailed,
//                  wordsChanged(String), sendTapped, retryTapped, opensAtPassed, consentGiven,
//                  safetyClosed, resourceTapped(Int),
//                  notNowTapped, thatsMeTapped, partlyTapped, peopleLoaded([Person]), peopleFailed(CallFailure),
//                  scopeWordTapped(Scope), personTapped(String), onlyMeTapped, doneTapped, pulledDown,
//                  keepReturned(KeepReply), keepFailed(CallFailure), partlySaved, partlyFailed(CallFailure),
//                  grantSucceeded, grantFailed(CallFailure) }
//       `notNowTapped` is a swipe left or talk.notNow; `thatsMeTapped` a swipe right or talk.thatsMe; `doneTapped` is
//       scope.done (the bar's send); `opensAtPassed` is the screen's timer at opens_at; grants answer in the order sent.
//     enum Effect { call(Call), haptic(Haptic), startListening(onDeviceOnly: Bool), stopListening, askMicPermission,
//                   openInSafari(String), showKept(KeptReport), showNotKept, keepWordsOnPhone(String), endSession }
//     enum Call { getHome, talkTurn(TurnRequest), getPeople, createItem(ItemRequest), markPartly(beliefId: String),
//                 share(personId: String, beliefId: String) }
//     struct TurnRequest { text: String?; conversationId: String?; wayIn: WayIn; name: String? }   // name = aboutName
//     struct ItemRequest { kind: String; wording: String; source: String; scope: Scope }
//
// Not asserted (gaps, recorded on #15): the wire codes of the kinds that never reach another person (When it gets
// heated, Coming back after, Other) are not in the package, so "only Only me for those kinds" is not tested; what
// Done does before a scope word is chosen; the light tap when listening starts (the shared Haptic has no case for it).
import XCTest
@testable import Flows

final class TalkFlowTests: XCTestCase {
    typealias F = TalkFlow
    let jan = F.Person(id: "p-jan", name: "Jan")
    let mia = F.Person(id: "p-mia", name: "Mia")
    let words = "I go quiet when I'm hurt."
    let item = F.Item(kind: "how_i_mean", wording: "When I go quiet, I'm thinking, not upset.")
    let safetyContent = F.Safety(message: "You don't have to carry this alone.",
                                 resources: [F.Resource(label: "Call 988", url: "https://988lifeline.org")])
    let opensAt = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: Helpers: reach each state through events, as the app would.
    func ready(_ conversationId: String? = "c-1") -> F {
        var f = F(conversationId: conversationId, turns: [.reply(reflection: nil, question: "What's on your mind?")])
        _ = f.handle(.entered)
        return f
    }
    func sending(_ conversationId: String? = "c-1") -> F {
        var f = ready(conversationId)
        _ = f.handle(.wordsChanged(words))
        _ = f.handle(.sendTapped)
        return f
    }
    func suggesting() -> F {
        var f = sending()
        _ = f.handle(.turnReturned(.ask(conversationId: "c-1", reflection: "That sounds heavy.",
                                        question: "What happens next?", itemState: "offered", item: item)))
        return f
    }
    func scoping(partly: Bool = false, people: [F.Person] = []) -> F {
        var f = suggesting()
        _ = f.handle(partly ? .partlyTapped : .thatsMeTapped)
        _ = f.handle(.peopleLoaded(people))
        return f
    }
    func keeping(partly: Bool = false, pick: [F.Person] = []) -> F {
        var f = scoping(partly: partly, people: [jan, mia])
        _ = f.handle(.scopeWordTapped(.everyone))
        for p in pick { _ = f.handle(.personTapped(p.id)) }
        _ = f.handle(.doneTapped)
        return f
    }
    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }
    func turnCalls(_ effects: [F.Effect]) -> [F.Call] {
        calls(effects).filter { if case .talkTurn = $0 { return true } else { return false } }
    }
    func turn(_ text: String?, _ conversationId: String?, _ wayIn: F.WayIn = .ownDownload, _ name: String? = nil) -> F.Call {
        .talkTurn(F.TurnRequest(text: text, conversationId: conversationId, wayIn: wayIn, name: name))
    }
    func kept(_ effects: [F.Effect]) -> F.KeptReport? {
        for e in effects { if case let .showKept(r) = e { return r } }
        return nil
    }

    // MARK: Opening and talking

    func test_row01_entering_consentDeclined_declinedAndNothingIsSent() {
        var f = F(aiConsentGiven: false)
        XCTAssertEqual(f.state, .entering)
        let fx = f.handle(.entered)
        XCTAssertEqual(f.state, .declined)
        XCTAssertTrue(turnCalls(fx).isEmpty, "nothing is sent")
    }

    func test_row02_entering_noConversation_openingWithHomeAndTheOpenerTogether() {
        var f = F(wayIn: .invitedByPartner, aboutName: "Jan")
        let fx = f.handle(.entered)
        XCTAssertEqual(f.state, .opening)
        XCTAssertTrue(calls(fx).contains(.getHome))
        XCTAssertTrue(calls(fx).contains(turn(nil, nil, .invitedByPartner, "Jan")), "no text: no model call")
        XCTAssertEqual(calls(fx).count, 2)
    }

    func test_row02_greeting_namesFromHome_orNoSecondLineWhenHomeFails() {
        var f = F()
        _ = f.handle(.entered)
        _ = f.handle(.homeLoaded(cardsFrom: ["Jan"]))
        XCTAssertEqual(f.cardsFrom, ["Jan"])
        XCTAssertEqual(f.state, .opening)

        var g = F()
        _ = g.handle(.entered)
        _ = g.handle(.homeFailed(.offline))
        XCTAssertNil(g.cardsFrom)
        XCTAssertEqual(g.state, .opening)
    }

    func test_row03_entering_conversationSet_readyWithTheTurnsAsTheyWere() {
        let turns: [F.Turn] = [.reply(reflection: nil, question: "Q1"), .mine("A1"), .reply(reflection: "R", question: "Q2")]
        var f = F(conversationId: "c-1", turns: turns)
        let fx = f.handle(.entered)
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(f.turns, turns)
        XCTAssertTrue(turnCalls(fx).isEmpty)
    }

    func test_row04_opening_200Ask_theQuestionIsTheFirstReplyAndTheConversationIsKept() {
        var f = F()
        _ = f.handle(.entered)
        _ = f.handle(.turnReturned(.ask(conversationId: "c-9", reflection: nil, question: "What's been on your mind?",
                                        itemState: nil, item: nil)))
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(f.conversationId, "c-9")
        XCTAssertEqual(f.turns, [.reply(reflection: nil, question: "What's been on your mind?")])
    }

    func test_row05_opening_403FeatureOffOrOwnerOnly_closedForAccount() {
        for reason in ["feature_off", "owner_only"] {
            var f = F()
            _ = f.handle(.entered)
            _ = f.handle(.turnFailed(.http(status: 403, error: "forbidden", reason: reason)))
            XCTAssertEqual(f.state, .closedForAccount, reason)
        }
    }

    func test_row06_opening_5xxOfflineTimeout_theFixedFirstQuestionAndTheFirstWordsStartTheConversation() {
        for failure in [CallFailure.http(status: 500), .http(status: 503), .offline, .timeout] {
            var f = F()
            _ = f.handle(.entered)
            _ = f.handle(.turnFailed(failure))
            XCTAssertEqual(f.state, .ready, "\(failure)")
            XCTAssertEqual(f.turns, [.fallbackQuestion])
            XCTAssertNil(f.conversationId)
            _ = f.handle(.wordsChanged(words))
            let fx = f.handle(.sendTapped)
            XCTAssertEqual(calls(fx), [turn(words, nil)])
        }
    }

    func test_row07_ready_micWithPermission_listeningOnDeviceOnly() {
        var f = F(conversationId: "c-1", micPermission: .granted)
        _ = f.handle(.entered)
        let fx = f.handle(.micTapped)
        XCTAssertEqual(f.state, .listening)
        XCTAssertTrue(fx.contains(.startListening(onDeviceOnly: true)), "no audio leaves the phone")
    }

    func test_row08_ready_onDeviceRecognitionUnsupported_micHiddenTypingWorks() {
        var f = ready()
        XCTAssertTrue(f.micShown)
        _ = f.handle(.recognitionUnsupported)
        XCTAssertEqual(f.state, .ready)
        XCTAssertFalse(f.micShown)
        _ = f.handle(.wordsChanged(words))
        XCTAssertEqual(f.text, words)
    }

    func test_row09_ready_micPermissionNotAsked_askingPermission() {
        var f = ready()
        let fx = f.handle(.micTapped)
        XCTAssertEqual(f.state, .askingPermission)
        XCTAssertTrue(fx.contains(.askMicPermission))
        XCTAssertFalse(fx.contains(.startListening(onDeviceOnly: true)))
    }

    func test_row10_askingPermission_granted_listening() {
        var f = ready()
        _ = f.handle(.micTapped)
        let fx = f.handle(.permissionGranted)
        XCTAssertEqual(f.state, .listening)
        XCTAssertTrue(fx.contains(.startListening(onDeviceOnly: true)))
    }

    func test_row11_askingPermission_denied_readyMicHiddenTypingWorks() {
        var f = ready()
        _ = f.handle(.micTapped)
        _ = f.handle(.permissionDenied)
        XCTAssertEqual(f.state, .ready)
        XCTAssertFalse(f.micShown)
        _ = f.handle(.wordsChanged(words))
        XCTAssertEqual(f.text, words)
    }

    func test_row12_listening_micAgain_wordsLandInTheBarAndNothingSends() {
        var f = F(conversationId: "c-1", micPermission: .granted)
        _ = f.handle(.entered)
        _ = f.handle(.micTapped)
        _ = f.handle(.heard(words))
        let fx = f.handle(.micTapped)
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(f.text, words)
        XCTAssertTrue(fx.contains(.stopListening))
        XCTAssertTrue(calls(fx).isEmpty, "nothing sends by itself")
    }

    func test_row13_listening_recognizerFails_wordsHeardSoFarStay() {
        var f = F(conversationId: "c-1", micPermission: .granted)
        _ = f.handle(.entered)
        _ = f.handle(.micTapped)
        _ = f.handle(.heard("I go quiet"))
        let fx = f.handle(.recognizerFailed)
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(f.text, "I go quiet")
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row14_ready_type_staysReadyWithTheWordsInTheBar() {
        var f = ready()
        let fx = f.handle(.wordsChanged(words))
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(f.text, words)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row15_ready_send_theMessageRisesAndTheTurnIsPosted() {
        var f = F(wayIn: .invitedByFriend, aboutName: "Mia", conversationId: "c-1")
        _ = f.handle(.entered)
        _ = f.handle(.wordsChanged(words))
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertEqual(f.turns.last, .mine(words))
        XCTAssertEqual(calls(fx), [turn(words, "c-1", .invitedByFriend, "Mia")])
    }

    func test_row15_ready_sendWithEmptyWords_nothingHappens() {
        var f = ready()
        _ = f.handle(.wordsChanged(""))
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .ready)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row16_sending_offeredLandsHardOrThisWeek_theReplyOnlyAndNoCard() {
        for kind in ["lands_hard", "this_week"] {
            var f = sending()
            _ = f.handle(.turnReturned(.ask(conversationId: "c-1", reflection: "R", question: "Q", itemState: "offered",
                                            item: F.Item(kind: kind, wording: "Raised voices."))))
            XCTAssertEqual(f.state, .ready, kind)
            XCTAssertNil(f.offered, "law 10: no card for \(kind)")
            XCTAssertEqual(f.turns.last, .reply(reflection: "R", question: "Q"))
        }
    }

    func test_row17_sending_offered_suggestingWithTheReplyThenTheCard() {
        let f = suggesting()
        XCTAssertEqual(f.state, .suggesting)
        XCTAssertEqual(f.turns.last, .reply(reflection: "That sounds heavy.", question: "What happens next?"))
        XCTAssertEqual(f.offered, item)
    }

    func test_row18_sending_anyOtherItemState_theReplyAndNoCard() {
        for itemState in [String?.none, "none", "kept"] {
            var f = sending()
            _ = f.handle(.turnReturned(.ask(conversationId: "c-1", reflection: "R", question: "Q", itemState: itemState,
                                            item: itemState == nil ? nil : item)))
            XCTAssertEqual(f.state, .ready, "\(String(describing: itemState))")
            XCTAssertNil(f.offered)
            XCTAssertEqual(f.turns.last, .reply(reflection: "R", question: "Q"))
        }
    }

    func test_row19_sending_done_theReflectionWithNoQuestionAndTheNextWordsStartANewConversation() {
        var f = sending()
        _ = f.handle(.turnReturned(.done(reflection: "Thank you for telling me.")))
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(f.turns.last, .reply(reflection: "Thank you for telling me.", question: nil))
        XCTAssertNil(f.conversationId)
        _ = f.handle(.wordsChanged("Something else."))
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(calls(fx), [turn("Something else.", nil)])
    }

    func test_row20_sending_safety_safetyStopAtOnce() {
        var f = sending()
        let fx = f.handle(.turnReturned(.safety(safetyContent)))
        XCTAssertEqual(f.state, .safetyStop)
        XCTAssertEqual(f.safety, safetyContent)
        XCTAssertNil(f.offered)
        XCTAssertTrue(calls(fx).isEmpty, "nothing was stored")
    }

    func test_row21_sending_403AIConsentRequired_aiConsentThenTheSameWordsAreSentOnce() {
        var f = sending()
        _ = f.handle(.turnFailed(.http(status: 403, error: "forbidden", reason: "ai_consent_required")))
        XCTAssertEqual(f.state, .aiConsent)
        let fx = f.handle(.consentGiven)
        XCTAssertEqual(f.state, .sending)
        XCTAssertEqual(calls(fx), [turn(words, "c-1")])
    }

    func test_row22_sending_429DailyLimit_limitedAndSaysWhenItOpensAgain() {
        var f = sending()
        _ = f.handle(.turnLimited(opensAt: opensAt))
        XCTAssertEqual(f.state, .limited)
        XCTAssertEqual(f.opensAt, opensAt)
        XCTAssertEqual(f.turns.last, .mine(words), "the words were kept")
    }

    func test_row23_sending_403FeatureOffOrOwnerOnly_closedForAccount() {
        for reason in ["feature_off", "owner_only"] {
            var f = sending()
            _ = f.handle(.turnFailed(.http(status: 403, error: "forbidden", reason: reason)))
            XCTAssertEqual(f.state, .closedForAccount, reason)
        }
    }

    func test_row24_sending_5xxOfflineTimeout_turnFailedAndTheMessageStays() {
        for failure in [CallFailure.http(status: 500), .http(status: 502), .offline, .timeout] {
            var f = sending()
            _ = f.handle(.turnFailed(failure))
            XCTAssertEqual(f.state, .turnFailed, "\(failure)")
            XCTAssertEqual(f.turns.last, .mine(words))
        }
    }

    func test_row25_turnFailed_retry_theSameWordsTheSameCall() {
        var f = sending()
        _ = f.handle(.turnFailed(.offline))
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertEqual(calls(fx), [turn(words, "c-1")])
    }

    func test_row26_limited_sendBeforeOpensAt_noCall_thenAfterOpensAt_sends() {
        var f = sending()
        _ = f.handle(.turnLimited(opensAt: opensAt))
        _ = f.handle(.wordsChanged("Later words."))
        let early = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .limited)
        XCTAssertTrue(calls(early).isEmpty)
        _ = f.handle(.opensAtPassed)
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertEqual(calls(fx), [turn("Later words.", "c-1")])
    }

    func test_row27_safetyStop_close_talkGoesOn() {
        var f = sending()
        _ = f.handle(.turnReturned(.safety(safetyContent)))
        _ = f.handle(.safetyClosed)
        XCTAssertEqual(f.state, .ready)
    }

    func test_row28_safetyStop_tapAResource_opensInSafari() {
        var f = sending()
        _ = f.handle(.turnReturned(.safety(safetyContent)))
        let fx = f.handle(.resourceTapped(0))
        XCTAssertEqual(f.state, .safetyStop)
        XCTAssertEqual(fx, [.openInSafari("https://988lifeline.org")])
    }

    // MARK: The suggestion and Who sees this

    func test_row29_suggesting_notNow_cardSinksAndNothingIsStored() {
        var f = suggesting()
        let fx = f.handle(.notNowTapped)
        XCTAssertEqual(f.state, .ready)
        XCTAssertNil(f.offered)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row30_suggesting_thatsMe_scopingVeryAndPeopleAreFetched() {
        var f = suggesting()
        let fx = f.handle(.thatsMeTapped)
        XCTAssertEqual(f.state, .scoping)
        XCTAssertEqual(f.strength, .very)
        XCTAssertEqual(calls(fx), [.getPeople])
        XCTAssertNil(f.scope)
        XCTAssertEqual(f.picked, [], "nothing is pre-ticked")
        XCTAssertFalse(f.onlyMe, "nothing is pre-ticked")
    }

    func test_row31_suggesting_partly_scopingPartlyAndPeopleAreFetched() {
        var f = suggesting()
        let fx = f.handle(.partlyTapped)
        XCTAssertEqual(f.state, .scoping)
        XCTAssertEqual(f.strength, .partly)
        XCTAssertEqual(calls(fx), [.getPeople])
    }

    func test_row32_suggesting_newWordsInstead_sendingAndNothingIsStored() {
        var f = suggesting()
        _ = f.handle(.wordsChanged("Actually, something else."))
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertNil(f.offered)
        XCTAssertEqual(calls(fx), [turn("Actually, something else.", "c-1")])
    }

    func test_row33_scoping_tapAScopeWord_oneAtATime_andOnlyWithLimitsWhoSeesThis() {
        var f = scoping(people: [jan, mia])
        _ = f.handle(.scopeWordTapped(.friends))
        XCTAssertEqual(f.state, .scoping)
        XCTAssertEqual(f.scope, .friends)
        XCTAssertEqual(f.whoSeesChoices, [jan, mia])
        _ = f.handle(.scopeWordTapped(.only(personId: "p-jan")))
        XCTAssertEqual(f.scope, .only(personId: "p-jan"), "one at a time")
        XCTAssertEqual(f.whoSeesChoices, [jan], "Only with Jan limits Who sees this to Jan or Only me")
    }

    func test_row33_whoSeesThis_onlyOnlyMeWhenNobodyIsLinkedOrPeopleFailed() {
        let f = scoping(people: [])
        XCTAssertEqual(f.whoSeesChoices, [])
        var g = suggesting()
        _ = g.handle(.thatsMeTapped)
        _ = g.handle(.peopleFailed(.offline))
        XCTAssertEqual(g.state, .scoping)
        XCTAssertEqual(g.whoSeesChoices, [])
    }

    func test_row34_scoping_tapAPersonOrOnlyMe_toggles() {
        var f = scoping(people: [jan, mia])
        _ = f.handle(.personTapped("p-jan"))
        XCTAssertEqual(f.state, .scoping)
        XCTAssertEqual(f.picked, ["p-jan"])
        _ = f.handle(.personTapped("p-jan"))
        XCTAssertEqual(f.picked, [])
        _ = f.handle(.personTapped("p-mia"))
        _ = f.handle(.onlyMeTapped)
        XCTAssertTrue(f.onlyMe)
        XCTAssertEqual(f.picked, [], "Only me clears the people")
    }

    func test_row35_scoping_done_postsTheItemWithItsScope() {
        var f = scoping(people: [jan])
        _ = f.handle(.scopeWordTapped(.partner))
        let fx = f.handle(.doneTapped)
        XCTAssertEqual(f.state, .keeping)
        XCTAssertEqual(calls(fx), [.createItem(F.ItemRequest(kind: item.kind, wording: item.wording, source: "talk_said",
                                                              scope: .partner))])
    }

    func test_row35_scopeValues_onTheWire() {
        XCTAssertEqual(F.Scope.everyone.type, "everyone")
        XCTAssertNil(F.Scope.everyone.value)
        XCTAssertEqual(F.Scope.partner.type, "type")
        XCTAssertEqual(F.Scope.partner.value, "partner")
        XCTAssertEqual(F.Scope.family.type, "type")
        XCTAssertEqual(F.Scope.family.value, "family")
        XCTAssertEqual(F.Scope.friends.type, "type")
        XCTAssertEqual(F.Scope.friends.value, "friend")
        XCTAssertEqual(F.Scope.coworkers.type, "type")
        XCTAssertEqual(F.Scope.coworkers.value, "coworker")
        XCTAssertEqual(F.Scope.only(personId: "p-jan").type, "person")
        XCTAssertEqual(F.Scope.only(personId: "p-jan").value, "p-jan")
    }

    func test_row36_keeping_201VeryNobodyPicked_keptThenReadyWithKeptForYou() {
        var f = keeping()
        let fx = f.handle(.keepReturned(.created(id: "b-1")))
        XCTAssertEqual(f.state, .ready, "kept passes straight through")
        XCTAssertEqual(kept(fx), F.KeptReport(partlyFailed: false, notSharedWith: []))
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row37_keeping_201Partly_markingPartly() {
        var f = keeping(partly: true)
        let fx = f.handle(.keepReturned(.created(id: "b-1")))
        XCTAssertEqual(f.state, .markingPartly)
        XCTAssertEqual(calls(fx), [.markPartly(beliefId: "b-1")])
        XCTAssertNil(kept(fx), "not done until the PATCH answers")
    }

    func test_row38_markingPartly_200_keptOrGranting() {
        var f = keeping(partly: true)
        _ = f.handle(.keepReturned(.created(id: "b-1")))
        let fx = f.handle(.partlySaved)
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(kept(fx), F.KeptReport(partlyFailed: false, notSharedWith: []))

        var g = keeping(partly: true, pick: [jan])
        _ = g.handle(.keepReturned(.created(id: "b-1")))
        let gx = g.handle(.partlySaved)
        XCTAssertEqual(g.state, .granting)
        XCTAssertEqual(calls(gx), [.share(personId: "p-jan", beliefId: "b-1")])
    }

    func test_row39_markingPartly_fails_keptAsThatsMeWithTheLine() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout] {
            var f = keeping(partly: true)
            _ = f.handle(.keepReturned(.created(id: "b-1")))
            let fx = f.handle(.partlyFailed(failure))
            XCTAssertEqual(f.state, .ready, "\(failure)")
            XCTAssertEqual(kept(fx), F.KeptReport(partlyFailed: true, notSharedWith: []))
        }
        var g = keeping(partly: true, pick: [jan])
        _ = g.handle(.keepReturned(.created(id: "b-1")))
        let gx = g.handle(.partlyFailed(.offline))
        XCTAssertEqual(g.state, .granting)
        XCTAssertEqual(calls(gx), [.share(personId: "p-jan", beliefId: "b-1")])
        let hx = g.handle(.grantSucceeded)
        XCTAssertEqual(g.state, .ready)
        XCTAssertEqual(kept(hx), F.KeptReport(partlyFailed: true, notSharedWith: []))
    }

    func test_row40_keeping_201PeoplePicked_grantingOneAtATime() {
        var f = keeping(pick: [jan, mia])
        let fx = f.handle(.keepReturned(.created(id: "b-1")))
        XCTAssertEqual(f.state, .granting)
        XCTAssertEqual(calls(fx), [.share(personId: "p-jan", beliefId: "b-1")], "one at a time")
        let gx = f.handle(.grantSucceeded)
        XCTAssertEqual(f.state, .granting)
        XCTAssertEqual(calls(gx), [.share(personId: "p-mia", beliefId: "b-1")])
        XCTAssertNil(kept(gx))
    }

    func test_row41_granting_all200_kept() {
        var f = keeping(pick: [jan, mia])
        _ = f.handle(.keepReturned(.created(id: "b-1")))
        _ = f.handle(.grantSucceeded)
        let fx = f.handle(.grantSucceeded)
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(kept(fx), F.KeptReport(partlyFailed: false, notSharedWith: []))
    }

    func test_row42_granting_oneFails_keptWithALineForEachThatFailed() {
        var f = keeping(pick: [jan, mia])
        _ = f.handle(.keepReturned(.created(id: "b-1")))
        let fx = f.handle(.grantFailed(.http(status: 500)))
        XCTAssertEqual(calls(fx), [.share(personId: "p-mia", beliefId: "b-1")], "the next grant still goes")
        let gx = f.handle(.grantSucceeded)
        XCTAssertEqual(f.state, .ready)
        XCTAssertEqual(kept(gx), F.KeptReport(partlyFailed: false, notSharedWith: ["Jan"]))
    }

    func test_row43_keeping_200Safety_safetyStopAndNothingStored() {
        var f = keeping()
        let fx = f.handle(.keepReturned(.safety(safetyContent)))
        XCTAssertEqual(f.state, .safetyStop)
        XCTAssertEqual(f.safety, safetyContent)
        XCTAssertNil(kept(fx))
    }

    func test_row44_keeping_200NotKept_theNotKeptLineThenReady() {
        var f = keeping()
        let fx = f.handle(.keepReturned(.notKept))
        XCTAssertEqual(f.state, .ready)
        XCTAssertTrue(fx.contains(.showNotKept))
        XCTAssertNil(kept(fx))
        XCTAssertNil(f.offered, "the card sinks")
    }

    func test_row45_keeping_403FeatureOffOrOwnerOnly_closedForAccount() {
        for reason in ["feature_off", "owner_only"] {
            var f = keeping()
            let fx = f.handle(.keepFailed(.http(status: 403, error: "forbidden", reason: reason)))
            XCTAssertEqual(f.state, .closedForAccount, reason)
            XCTAssertNil(kept(fx))
        }
    }

    func test_row46_keeping_5xxOfflineTimeout_backToScopingWithTheNotSavedLineAndTheChoices() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout] {
            var f = keeping(pick: [jan])
            let fx = f.handle(.keepFailed(failure))
            XCTAssertEqual(f.state, .scoping, "\(failure)")
            XCTAssertTrue(f.notSaved)
            XCTAssertEqual(f.scope, .everyone, "the choices stay")
            XCTAssertEqual(f.picked, ["p-jan"])
            XCTAssertNil(kept(fx))
        }
    }

    func test_row47_scoping_pullDown_theCardAgainAsItWas() {
        var f = scoping(people: [jan])
        let fx = f.handle(.pulledDown)
        XCTAssertEqual(f.state, .suggesting)
        XCTAssertEqual(f.offered, item)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row48_kept_readyAndKeptForYouFor3point2Seconds() {
        XCTAssertEqual(F.keptShownFor, 3.2)
        var f = keeping()
        _ = f.handle(.keepReturned(.created(id: "b-1")))
        XCTAssertEqual(f.state, .ready)
        XCTAssertNil(f.offered, "scope and the card sink")
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401OnAnyCall_endsTheSession() {
        let unauthorized = CallFailure.http(status: 401, error: "unauthorized")

        var a = F()
        _ = a.handle(.entered)
        let ax = a.handle(.turnFailed(unauthorized))
        XCTAssertEqual(a.state, .sessionEnded)
        XCTAssertTrue(ax.contains(.endSession))

        var b = sending()
        let bx = b.handle(.turnFailed(unauthorized))
        XCTAssertEqual(b.state, .sessionEnded)
        XCTAssertTrue(bx.contains(.endSession))
        XCTAssertTrue(bx.contains(.keepWordsOnPhone(words)), "the words that did not go through stay on the phone")

        var c = keeping()
        let cx = c.handle(.keepFailed(unauthorized))
        XCTAssertEqual(c.state, .sessionEnded)
        XCTAssertTrue(cx.contains(.endSession))

        var d = suggesting()
        _ = d.handle(.thatsMeTapped)
        let dx = d.handle(.peopleFailed(unauthorized))
        XCTAssertEqual(d.state, .sessionEnded)
        XCTAssertTrue(dx.contains(.endSession))

        var e = keeping(pick: [jan])
        _ = e.handle(.keepReturned(.created(id: "b-1")))
        let ex = e.handle(.grantFailed(unauthorized))
        XCTAssertEqual(e.state, .sessionEnded)
        XCTAssertTrue(ex.contains(.endSession))
    }

    func test_shared_401_wordsInTheBarAreKept() {
        var f = F()
        _ = f.handle(.entered)
        _ = f.handle(.wordsChanged(words))
        let fx = f.handle(.turnFailed(.http(status: 401, error: "unauthorized")))
        XCTAssertEqual(f.state, .sessionEnded)
        XCTAssertTrue(fx.contains(.keepWordsOnPhone(words)))
    }

    func test_shared_429DailyLimit_neverBreaksTheFlow() {
        var f = sending()
        let fx = f.handle(.turnLimited(opensAt: opensAt))
        XCTAssertEqual(f.state, .limited)
        XCTAssertFalse(fx.contains(.endSession))
        XCTAssertEqual(f.opensAt, opensAt, "Talk says when it opens again")
        _ = f.handle(.wordsChanged("More."))
        XCTAssertEqual(f.text, "More.", "the bar still works")
    }

    func test_shared_savedMeansConfirmed_keptForYouOnlyAfter201() {
        var f = scoping()
        _ = f.handle(.scopeWordTapped(.everyone))
        let done = f.handle(.doneTapped)
        XCTAssertEqual(f.state, .keeping)
        XCTAssertNil(kept(done), "nothing shows as kept before the server answers")
        for failure in [CallFailure.http(status: 500), .offline] {
            var g = f
            XCTAssertNil(kept(g.handle(.keepFailed(failure))))
        }
        XCTAssertNotNil(kept(f.handle(.keepReturned(.created(id: "b-1")))))
    }
}
