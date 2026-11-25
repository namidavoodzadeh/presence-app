// Issue #18. Acceptance tests written in C4 from packages/01 only: flows/write-send.md (one test per row of the state
// table), flows/README.md (shared rules), states.md and copy.md. No implementation was read.
//
// Pending: Tests/Pending is not part of the FlowsTests target. First step of the build:
// `git mv app/Packages/Flows/Tests/Pending/WriteSendFlowTests.swift app/Packages/Flows/Tests/FlowsTests/` unchanged.
//
// ───────────────────────────── API the tests expect ─────────────────────────────
// Shared by every flow in the Flows module (no SwiftUI, no networking; calls are effects the app performs, and their
// answers come back as events):
//   enum CallFailure: Equatable, Sendable { case http(status: Int, error: String? = nil, reason: String? = nil); case offline; case timeout }
//   enum Haptic: Equatable, Sendable { case doubleSoftPulse, firm, softTick }
//   enum WaitingPhase: Equatable { case nothing, knot, unavailable }
//   enum Waiting { static let showKnotAfter: TimeInterval /*0.3*/; static let knotMinimum /*0.5*/; static let unavailableAfter /*10*/
//                  static func phase(elapsed: TimeInterval) -> WaitingPhase; static func mayHideKnot(shownFor: TimeInterval) -> Bool }
//   A 401 from any call: the flow moves to its `.sessionEnded` state and emits `.endSession`; words in the bar are kept
//   (`.keepWordsOnPhone(text)` when there are any).
//
// struct WriteSendFlow (value type):
//   init(person: Person, replyTo: String? = nil, aiConsentGiven: Bool = true, askLineShown: Bool = false, tz: String = "UTC")
//   private(set) var state: State                         // starts at .entering
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context: text, original, seq: Int, notes: [Note], unansweredNotes: [Note], fromMe: FromMe?, changed: Bool,
//     theyShared: TheyShared, fromMeSkip: [String], refusal: Refusal?, canSend: Bool, pauseCards: [PauseCard], basis: Basis,
//     showsAskLine: Bool, sentText: String?  (your card in the thread while sending / not sent / sent), helped: Bool
//   Nested types (memberwise inits, fields in this order):
//     struct Person { id: String; name: String }
//     enum State { entering, editing, reading, noteUp(Int), refused, safetyStop, savingDraft, closed, pausing(Int), final,
//                  sending, sent, notSent(NotSent), sessionEnded }      // "folding" and "ended" pass straight through
//     enum NotSent { failed, refused, notConnected }
//     enum TheyShared { yes, no, unknown }
//     enum Basis { onlyYou, general }                       // copy pause.basisNothing / pause.basisGeneral
//     struct Highlight { original: String; suggested: String; frictionKind: String? }
//     struct Note { id: Int; original: String; suggested: String; frictionKind: String }   // id = index in the reply
//     struct FromMe { id: String; wording: String }
//     struct Refusal { spans: [String]; headline: String? }
//     enum PauseCard { note(Note), fromMe(FromMe) }
//     enum InsightReply { insight(highlights: [Highlight], fromMe: FromMe?), risk, declined(spans: [String], headline: String?), unavailable }
//     enum Event { entered, draftLoaded(text: String?, replyTo: String?), draftLoadFailed(CallFailure), personMapLoaded,
//                  personMapFailed(CallFailure), wordsChanged(String), typingPaused, insightReturned(seq: Int, InsightReply),
//                  insightFailed(seq: Int, CallFailure), underlineTapped(noteId: Int), useIt, keepMine, tappedOutside,
//                  safetyClosed, leftThread, draftSaved, draftSaveFailed(CallFailure), sendTapped, pulledDown,
//                  foldAndSendTapped, sendSucceeded(bridgeId: String), sendFailed(CallFailure), retryTapped, editTapped }
//       `useIt` is a swipe right or pause.useIt; `keepMine` a swipe left or pause.keepMine; `typingPaused` is the screen's
//       1.5 s timer; `foldAndSendTapped` is pause.send on pause.final.
//     enum Effect { call(Call), cancelInsight, haptic(Haptic), paperSound, keepWordsOnPhone(String),
//                   markAskLineShown(personId: String), endSession }
//     enum Call { getDraft(personId: String), getPersonMap(personId: String), putDraft(personId: String, text: String, replyTo: String?),
//                 deleteDraft(personId: String), insight(InsightRequest), sendBridge(BridgeRequest) }
//     struct InsightRequest { personId: String; text: String; seq: Int; withWording: Bool; replyTo: String?; fromMeSkip: [String] }
//     struct BridgeRequest { personId: String; original: String; bridged: String?; final: String; used: Used; showOriginal: Bool;
//                            headsUp: Bool; deliverAt: String; tz: String; replyTo: String? }
//     enum Used: String { mine, edited }
//
// Not asserted, pending the owner's answer on #18: whether a highlight whose `suggested` equals its `original` (a vague_ask
// note) is a note. flows/write-send.md leaves it out; copy.md says its card offers "Keep mine" only.
import XCTest
@testable import Flows

final class WriteSendFlowTests: XCTestCase {
    typealias F = WriteSendFlow
    let jan = F.Person(id: "p-jan", name: "Jan")
    let words = "You never listen when I talk about work."          // 40 characters, over the 12-character floor
    let absolute = F.Highlight(original: "never", suggested: "didn't", frictionKind: "absolute")
    let mind = F.Highlight(original: "when I talk about work", suggested: "when I talk about work tonight", frictionKind: "mind_reading")
    let fromMe = F.FromMe(id: "item-1", wording: "When I go quiet I'm thinking, not upset.")

    // MARK: Helpers: reach each state through events, as the app would.
    func entered(_ replyTo: String? = nil, consent: Bool = true, askLineShown: Bool = false) -> F {
        var f = F(person: jan, replyTo: replyTo, aiConsentGiven: consent, askLineShown: askLineShown)
        _ = f.handle(.entered)
        _ = f.handle(.draftLoaded(text: nil, replyTo: nil))
        _ = f.handle(.personMapLoaded)
        return f
    }
    func editing(_ text: String? = nil, theyShared: Bool = true, askLineShown: Bool = false) -> F {
        var f = F(person: jan, aiConsentGiven: true, askLineShown: askLineShown)
        _ = f.handle(.entered)
        _ = f.handle(.draftLoaded(text: nil, replyTo: nil))
        _ = theyShared ? f.handle(.personMapLoaded) : f.handle(.personMapFailed(.http(status: 403, error: "forbidden")))
        _ = f.handle(.wordsChanged(text ?? words))
        return f
    }
    func reading(_ text: String? = nil) -> F {
        var f = editing(text)
        _ = f.handle(.typingPaused)
        return f
    }
    func withNotes(_ highlights: [F.Highlight]? = nil, fromMe: F.FromMe? = nil, theyShared: Bool = true, askLineShown: Bool = false) -> F {
        var f = editing(nil, theyShared: theyShared, askLineShown: askLineShown)
        _ = f.handle(.typingPaused)
        _ = f.handle(.insightReturned(seq: f.seq, .insight(highlights: highlights ?? [absolute], fromMe: fromMe)))
        return f
    }
    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }
    func bridge(_ effects: [F.Effect]) -> F.BridgeRequest? {
        for c in calls(effects) { if case let .sendBridge(b) = c { return b } }
        return nil
    }

    // MARK: Writing

    func test_row01_enteringTheThread_loadsDraftAndMapTogether() {
        var f = F(person: jan)
        XCTAssertEqual(f.state, .entering)
        let fx = f.handle(.entered)
        XCTAssertEqual(f.state, .editing)
        XCTAssertEqual(Set(calls(fx).map { "\($0)" }), Set([F.Call.getDraft(personId: "p-jan"), .getPersonMap(personId: "p-jan")].map { "\($0)" }))
        XCTAssertEqual(calls(fx).count, 2)
    }

    func test_row01_aDraftFillsTheBarIfThePersonHasNotTyped() {
        var f = F(person: jan)
        _ = f.handle(.entered)
        _ = f.handle(.draftLoaded(text: "Saved words", replyTo: nil))
        XCTAssertEqual(f.text, "Saved words")

        var g = F(person: jan)
        _ = g.handle(.entered)
        _ = g.handle(.wordsChanged("Typed first"))
        _ = g.handle(.draftLoaded(text: "Saved words", replyTo: nil))
        XCTAssertEqual(g.text, "Typed first")
    }

    func test_row01_theySharedIsFalseOn403TrueOn200UnknownOnAnyFailure() {
        var a = F(person: jan); _ = a.handle(.entered); _ = a.handle(.personMapLoaded)
        XCTAssertEqual(a.theyShared, .yes)
        var b = F(person: jan); _ = b.handle(.entered); _ = b.handle(.personMapFailed(.http(status: 403, error: "forbidden")))
        XCTAssertEqual(b.theyShared, .no)
        for failure in [CallFailure.http(status: 500), .offline, .timeout, .http(status: 404, error: "not_found")] {
            var c = F(person: jan); _ = c.handle(.entered); _ = c.handle(.personMapFailed(failure))
            XCTAssertEqual(c.theyShared, .unknown, "\(failure)")
        }
    }

    func test_row02_editing_wordsChange_underlinesGoAndSeqMovesOn() {
        var f = withNotes()
        XCTAssertFalse(f.notes.isEmpty)
        let seq = f.seq
        _ = f.handle(.wordsChanged(words + " Really."))
        XCTAssertEqual(f.state, .editing)
        XCTAssertTrue(f.notes.isEmpty)
        XCTAssertEqual(f.seq, seq + 1)
    }

    func test_row03_editing_pauseWithTwelveCharactersOrMore_callsInsight() {
        var f = editing("Twelve chars")                                // exactly 12
        let fx = f.handle(.typingPaused)
        XCTAssertEqual(f.state, .reading)
        XCTAssertEqual(calls(fx), [.insight(F.InsightRequest(personId: "p-jan", text: "Twelve chars", seq: f.seq,
                                                             withWording: true, replyTo: nil, fromMeSkip: []))])
    }

    func test_row03_editing_pauseUnderTwelveCharacters_noCall() {
        var f = editing("Eleven char")                                 // 11
        let fx = f.handle(.typingPaused)
        XCTAssertEqual(f.state, .editing)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row03_replyToIsSentWithTheInsightCall() {
        var f = entered("bridge-9")
        _ = f.handle(.wordsChanged(words))
        let fx = f.handle(.typingPaused)
        guard case let .insight(req)? = calls(fx).first else { return XCTFail("no insight call") }
        XCTAssertEqual(req.replyTo, "bridge-9")
    }

    func test_row04_reading_wordsChange_backToEditingAndTheCallInFlightIsCancelled() {
        var f = reading()
        let seq = f.seq
        let fx = f.handle(.wordsChanged(words + "!"))
        XCTAssertEqual(f.state, .editing)
        XCTAssertTrue(fx.contains(.cancelInsight))
        XCTAssertEqual(f.seq, seq + 1)
        XCTAssertTrue(f.notes.isEmpty)
    }

    func test_row05_reading_insightForTheCurrentSeq_notesAndFromMe() {
        var f = reading()
        let plain = F.Highlight(original: "about work", suggested: "about the project", frictionKind: nil)
        _ = f.handle(.insightReturned(seq: f.seq, .insight(highlights: [absolute, plain, mind], fromMe: fromMe)))
        XCTAssertEqual(f.state, .editing)
        // Only highlights with a friction_kind (and a suggestion different from the phrase) are notes.
        XCTAssertEqual(f.notes.map(\.original), ["never", "when I talk about work"])
        XCTAssertEqual(f.notes.map(\.frictionKind), ["absolute", "mind_reading"])
        XCTAssertEqual(f.fromMe, fromMe)
    }

    func test_row06_reading_insightForAnOldSeq_isDropped() {
        var f = reading()
        let fx = f.handle(.insightReturned(seq: f.seq - 1, .insight(highlights: [absolute], fromMe: nil)))
        XCTAssertEqual(f.state, .reading)
        XCTAssertTrue(f.notes.isEmpty)
        XCTAssertTrue(fx.isEmpty)
    }

    func test_row07_reading_risk_safetyStopAndNoMoreInsightForThisDraft() {
        var f = reading()
        _ = f.handle(.insightReturned(seq: f.seq, .risk))
        XCTAssertEqual(f.state, .safetyStop)
        _ = f.handle(.safetyClosed)
        _ = f.handle(.wordsChanged(words + " And more."))
        let fx = f.handle(.typingPaused)
        XCTAssertTrue(calls(fx).isEmpty, "no more insight for this draft")
    }

    func test_row08_reading_declined_refusedWithSpansAndHeadlineAndSendDisabled() {
        var f = reading()
        _ = f.handle(.insightReturned(seq: f.seq, .declined(spans: ["never listen"], headline: "This reads as a threat.")))
        XCTAssertEqual(f.state, .refused)
        XCTAssertEqual(f.refusal, F.Refusal(spans: ["never listen"], headline: "This reads as a threat."))
        XCTAssertFalse(f.canSend)
        let fx = f.handle(.sendTapped)
        XCTAssertNil(bridge(fx), "Send is disabled while refused")
    }

    func test_row09_reading_unavailableOrAnyFailure_backToEditingWithNothingShown() {
        let failures: [CallFailure] = [.http(status: 403, error: "forbidden", reason: "ai_consent_required"),
                                       .http(status: 429, error: "daily_limit"), .http(status: 500), .http(status: 503),
                                       .offline, .timeout]
        for failure in failures {
            var f = reading()
            let fx = f.handle(.insightFailed(seq: f.seq, failure))
            XCTAssertEqual(f.state, .editing, "\(failure)")
            XCTAssertTrue(f.notes.isEmpty)
            XCTAssertTrue(fx.isEmpty, "nothing shown for \(failure)")
        }
        var u = reading()
        _ = u.handle(.insightReturned(seq: u.seq, .unavailable))
        XCTAssertEqual(u.state, .editing)
        XCTAssertTrue(u.notes.isEmpty)
    }

    func test_row09_withAIConsentOff_noInsightCallIsEverMade() {
        var f = entered(consent: false)
        _ = f.handle(.wordsChanged(words))
        let fx = f.handle(.typingPaused)
        XCTAssertEqual(f.state, .editing)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row10_editing_tapAnUnderline_noteUpWithADoubleSoftPulse() {
        var f = withNotes()
        let id = f.notes[0].id
        let fx = f.handle(.underlineTapped(noteId: id))
        XCTAssertEqual(f.state, .noteUp(id))
        XCTAssertTrue(fx.contains(.haptic(.doubleSoftPulse)))
    }

    func test_row11_noteUp_useIt_replacesThePhraseAndAnswersTheNote() {
        var f = withNotes()
        _ = f.handle(.underlineTapped(noteId: f.notes[0].id))
        _ = f.handle(.useIt)
        XCTAssertEqual(f.state, .editing)
        XCTAssertEqual(f.text, "You didn't listen when I talk about work.")
        XCTAssertTrue(f.changed)
        XCTAssertTrue(f.unansweredNotes.isEmpty)
        XCTAssertEqual(f.original, words, "original is the words before the first note was used")
    }

    func test_row11_noteUp_useIt_whenThePhraseNoLongerMatches_wordsStayAndTheNoteIsAnswered() {
        // Two notes over the same words: once the first is used, the second's phrase is no longer there.
        let overlapping = F.Highlight(original: "never listen", suggested: "don't always listen", frictionKind: "absolute")
        var f = withNotes([absolute, overlapping])
        _ = f.handle(.underlineTapped(noteId: f.notes[0].id))
        _ = f.handle(.useIt)
        XCTAssertEqual(f.text, "You didn't listen when I talk about work.")
        _ = f.handle(.underlineTapped(noteId: f.notes[1].id))
        _ = f.handle(.useIt)
        XCTAssertEqual(f.state, .editing)
        XCTAssertEqual(f.text, "You didn't listen when I talk about work.", "the phrase no longer matches: words stay")
        XCTAssertTrue(f.unansweredNotes.isEmpty)
    }

    func test_row12_noteUp_keepMine_answersTheNoteAndKeepsTheWords() {
        var f = withNotes()
        _ = f.handle(.underlineTapped(noteId: f.notes[0].id))
        _ = f.handle(.keepMine)
        XCTAssertEqual(f.state, .editing)
        XCTAssertEqual(f.text, words)
        XCTAssertFalse(f.changed)
        XCTAssertTrue(f.unansweredNotes.isEmpty)
    }

    func test_row13_noteUp_tapOutside_cardSinksAndTheNoteStaysOpen() {
        var f = withNotes()
        _ = f.handle(.underlineTapped(noteId: f.notes[0].id))
        _ = f.handle(.tappedOutside)
        XCTAssertEqual(f.state, .editing)
        XCTAssertEqual(f.unansweredNotes.count, 1)
    }

    func test_row14_refused_wordsChange_refusalGoesAndInsightResumesAtTheNextPause() {
        var f = reading()
        _ = f.handle(.insightReturned(seq: f.seq, .declined(spans: ["x"], headline: nil)))
        _ = f.handle(.wordsChanged("I'd like you to listen when I talk about work."))
        XCTAssertEqual(f.state, .editing)
        XCTAssertNil(f.refusal)
        XCTAssertTrue(f.canSend)
        let fx = f.handle(.typingPaused)
        XCTAssertEqual(f.state, .reading)
        XCTAssertEqual(calls(fx).count, 1)
    }

    func test_row15_safetyStop_close_wordsStay() {
        var f = reading()
        _ = f.handle(.insightReturned(seq: f.seq, .risk))
        _ = f.handle(.safetyClosed)
        XCTAssertEqual(f.state, .editing)
        XCTAssertEqual(f.text, words)
    }

    func test_row16_editing_leaveWithWords_savesTheDraft() {
        var f = entered("bridge-9")
        _ = f.handle(.wordsChanged(words))
        let fx = f.handle(.leftThread)
        XCTAssertEqual(f.state, .savingDraft)
        XCTAssertEqual(calls(fx), [.putDraft(personId: "p-jan", text: words, replyTo: "bridge-9")])
    }

    func test_row17_editing_leaveWithAnEmptyBarAfterADraftWasLoaded_deletesIt() {
        var f = F(person: jan)
        _ = f.handle(.entered)
        _ = f.handle(.draftLoaded(text: "Old words", replyTo: nil))
        _ = f.handle(.wordsChanged(""))
        let fx = f.handle(.leftThread)
        XCTAssertEqual(f.state, .closed)
        XCTAssertEqual(calls(fx), [.deleteDraft(personId: "p-jan")])
    }

    func test_row17_editing_leaveWithAnEmptyBarAndNoDraft_noCall() {
        var f = entered()
        let fx = f.handle(.leftThread)
        XCTAssertEqual(f.state, .closed)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row18_savingDraft_200_closed() {
        var f = editing()
        _ = f.handle(.leftThread)
        _ = f.handle(.draftSaved)
        XCTAssertEqual(f.state, .closed)
    }

    func test_row19_savingDraft_fails_closedAndTheWordsStayOnThePhone() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout] {
            var f = editing()
            _ = f.handle(.leftThread)
            let fx = f.handle(.draftSaveFailed(failure))
            XCTAssertEqual(f.state, .closed)
            XCTAssertTrue(fx.contains(.keepWordsOnPhone(words)), "\(failure)")
        }
    }

    // MARK: Before it goes

    func test_row20_send_withUnansweredNotes_pauseRisesOnTheFirstCard() {
        var f = withNotes([absolute, mind])
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .pausing(0))
        XCTAssertEqual(f.pauseCards.count, 2)
        XCTAssertNil(bridge(fx), "nothing is sent while the pause is up")
    }

    func test_row20_send_withOnlyFromMe_pauseRises() {
        var f = withNotes([], fromMe: fromMe)
        _ = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .pausing(0))
        XCTAssertEqual(f.pauseCards, [.fromMe(fromMe)])
    }

    func test_row21_send_withNothingUnanswered_foldsAndSends() {
        var f = withNotes()
        _ = f.handle(.underlineTapped(noteId: f.notes[0].id))
        _ = f.handle(.keepMine)
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertNotNil(bridge(fx))
    }

    func test_row21_send_beforeInsightIsBack_foldsAndSends() {
        var f = reading()
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertNotNil(bridge(fx))
    }

    func test_row22_pausing_useItOnANote_appliesItAndMovesToTheNextCard() {
        var f = withNotes([absolute, mind])
        _ = f.handle(.sendTapped)
        _ = f.handle(.useIt)
        XCTAssertEqual(f.state, .pausing(1))
        XCTAssertEqual(f.text, "You didn't listen when I talk about work.")
        XCTAssertTrue(f.changed)
    }

    func test_row23_pausing_keepMine_movesToTheNextCard() {
        var f = withNotes([absolute, mind])
        _ = f.handle(.sendTapped)
        _ = f.handle(.keepMine)
        XCTAssertEqual(f.state, .pausing(1))
        XCTAssertEqual(f.text, words)
    }

    func test_row24_pausing_useItOnFromMe_addsItsWordsAsTheirOwnSentence() {
        var f = withNotes([], fromMe: fromMe)
        _ = f.handle(.sendTapped)
        _ = f.handle(.useIt)
        XCTAssertEqual(f.text, words + " " + fromMe.wording)
        XCTAssertTrue(f.changed)
        XCTAssertEqual(f.state, .final, "the last card answered with a change ends on pause.final")
    }

    func test_row25_pausing_keepMineOnFromMe_skipsItForThisDraft() {
        var f = withNotes([], fromMe: fromMe)
        _ = f.handle(.sendTapped)
        _ = f.handle(.keepMine)
        XCTAssertEqual(f.fromMeSkip, ["item-1"])
        // The next insight call for this draft carries it.
        // Nothing changed, so the card folds and sends; refused as written, Edit brings the same draft back.
        var h = f
        XCTAssertEqual(h.state, .sending)
        _ = h.handle(.sendFailed(.http(status: 403, error: "forbidden", reason: "wont_carry")))
        _ = h.handle(.editTapped)
        _ = h.handle(.wordsChanged(words + " Please."))
        let fx = h.handle(.typingPaused)
        guard case let .insight(req)? = calls(fx).first else { return XCTFail("no insight call") }
        XCTAssertEqual(req.fromMeSkip, ["item-1"])
    }

    func test_row26_pausing_pullDown_backToEditingWithTheWordsAsTheyAreNow() {
        var f = withNotes([absolute, mind])
        _ = f.handle(.sendTapped)
        _ = f.handle(.useIt)
        let fx = f.handle(.pulledDown)
        XCTAssertEqual(f.state, .editing)
        XCTAssertEqual(f.text, "You didn't listen when I talk about work.")
        XCTAssertNil(bridge(fx))
    }

    func test_row27_ended_changed_showsTheFinalWords() {
        var f = withNotes([absolute])
        _ = f.handle(.sendTapped)
        let fx = f.handle(.useIt)
        XCTAssertEqual(f.state, .final)
        XCTAssertNil(bridge(fx), "pause.final shows the words before the fold")
    }

    func test_row28_ended_notChanged_foldsAndSends() {
        var f = withNotes([absolute])
        _ = f.handle(.sendTapped)
        let fx = f.handle(.keepMine)
        XCTAssertEqual(f.state, .sending)
        XCTAssertNotNil(bridge(fx))
    }

    func test_row29_final_foldAndSend_sends() {
        var f = withNotes([absolute])
        _ = f.handle(.sendTapped)
        _ = f.handle(.useIt)
        let fx = f.handle(.foldAndSendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertEqual(bridge(fx)?.final, "You didn't listen when I talk about work.")
    }

    func test_row30_final_pullDown_backToEditing() {
        var f = withNotes([absolute])
        _ = f.handle(.sendTapped)
        _ = f.handle(.useIt)
        _ = f.handle(.pulledDown)
        XCTAssertEqual(f.state, .editing)
    }

    func test_basis_whenTheyHaveSharedNothing_basedOnlyOnYouAndTheAskLineOncePerPerson() {
        var f = withNotes([absolute], theyShared: false)
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.basis, .onlyYou)
        XCTAssertTrue(f.showsAskLine)
        XCTAssertTrue(fx.contains(.markAskLineShown(personId: "p-jan")))

        var g = withNotes([absolute], theyShared: false, askLineShown: true)
        let gx = g.handle(.sendTapped)
        XCTAssertEqual(g.basis, .onlyYou)
        XCTAssertFalse(g.showsAskLine)
        XCTAssertFalse(gx.contains(.markAskLineShown(personId: "p-jan")))
    }

    func test_basis_whenTheyShared_orUnknown_eachNoteSaysItIsGeneral() {
        var f = withNotes([absolute], theyShared: true)
        _ = f.handle(.sendTapped)
        XCTAssertEqual(f.basis, .general)
        XCTAssertFalse(f.showsAskLine)

        var g = F(person: jan)
        _ = g.handle(.entered)
        _ = g.handle(.personMapFailed(.offline))
        _ = g.handle(.wordsChanged(words))
        _ = g.handle(.typingPaused)
        _ = g.handle(.insightReturned(seq: g.seq, .insight(highlights: [absolute], fromMe: nil)))
        _ = g.handle(.sendTapped)
        XCTAssertEqual(g.basis, .general)
    }

    // MARK: Sending

    func test_row31_folding_firmHapticPaperSoundAndTheSendCall() {
        var f = entered("bridge-9")
        _ = f.handle(.wordsChanged(words))
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertTrue(fx.contains(.haptic(.firm)))
        XCTAssertTrue(fx.contains(.paperSound))
        XCTAssertEqual(f.sentText, words, "your card shows on the right while sending")
        XCTAssertEqual(bridge(fx), F.BridgeRequest(personId: "p-jan", original: words, bridged: nil, final: words, used: .mine,
                                                   showOriginal: false, headsUp: true, deliverAt: "now", tz: "UTC",
                                                   replyTo: "bridge-9"))
    }

    func test_row31_afterANoteWasUsed_originalIsTheWordsBeforeAndUsedIsEdited() {
        var f = withNotes([absolute])
        _ = f.handle(.sendTapped)
        _ = f.handle(.useIt)
        let fx = f.handle(.foldAndSendTapped)
        let b = bridge(fx)
        XCTAssertEqual(b?.original, words)
        XCTAssertEqual(b?.final, "You didn't listen when I talk about work.")
        XCTAssertEqual(b?.used, .edited)
    }

    func test_row32_sending_200_sentAndHelpedWhenChanged() {
        var f = withNotes([absolute])
        _ = f.handle(.sendTapped)
        _ = f.handle(.useIt)
        _ = f.handle(.foldAndSendTapped)
        _ = f.handle(.sendSucceeded(bridgeId: "b-1"))
        XCTAssertEqual(f.state, .sent)
        XCTAssertTrue(f.helped)

        var g = editing()
        _ = g.handle(.sendTapped)
        _ = g.handle(.sendSucceeded(bridgeId: "b-2"))
        XCTAssertEqual(g.state, .sent)
        XCTAssertFalse(g.helped)
    }

    func test_row33_sending_403WontCarry_notSentRefused() {
        var f = editing()
        _ = f.handle(.sendTapped)
        _ = f.handle(.sendFailed(.http(status: 403, error: "forbidden", reason: "wont_carry")))
        XCTAssertEqual(f.state, .notSent(.refused))
    }

    func test_row34_sending_403AnotherReason_notSentNotConnected() {
        for reason in [String?.none, "blocked", "not_linked"] {
            var f = editing()
            _ = f.handle(.sendTapped)
            _ = f.handle(.sendFailed(.http(status: 403, error: "forbidden", reason: reason)))
            XCTAssertEqual(f.state, .notSent(.notConnected), "\(String(describing: reason))")
        }
    }

    func test_row35_sending_429_5xx_offline_timeout_notSentFailed() {
        for failure in [CallFailure.http(status: 429, error: "daily_limit"), .http(status: 500), .http(status: 502),
                        .offline, .timeout] {
            var f = editing()
            _ = f.handle(.sendTapped)
            _ = f.handle(.sendFailed(failure))
            XCTAssertEqual(f.state, .notSent(.failed), "\(failure)")
            XCTAssertEqual(f.sentText, words, "your card stays, with Not sent and Try again")
        }
    }

    func test_row36_notSentFailed_tryAgain_sendsTheSameBody() {
        var f = entered("bridge-9")
        _ = f.handle(.wordsChanged(words))
        let first = bridge(f.handle(.sendTapped))
        _ = f.handle(.sendFailed(.offline))
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertEqual(bridge(fx), first)
    }

    func test_row37_notSentRefused_edit_theWordsReturnToTheBar() {
        var f = editing()
        _ = f.handle(.sendTapped)
        _ = f.handle(.sendFailed(.http(status: 403, error: "forbidden", reason: "wont_carry")))
        _ = f.handle(.editTapped)
        XCTAssertEqual(f.state, .editing)
        XCTAssertEqual(f.text, words)
        XCTAssertNil(f.sentText, "the card goes")
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401OnAnyCall_endsTheSessionAndKeepsTheWords() {
        let unauthorized = CallFailure.http(status: 401, error: "unauthorized")
        var a = reading()
        let ax = a.handle(.insightFailed(seq: a.seq, unauthorized))
        XCTAssertEqual(a.state, .sessionEnded)
        XCTAssertTrue(ax.contains(.endSession))
        XCTAssertTrue(ax.contains(.keepWordsOnPhone(words)))

        var b = editing()
        _ = b.handle(.sendTapped)
        let bx = b.handle(.sendFailed(unauthorized))
        XCTAssertEqual(b.state, .sessionEnded)
        XCTAssertTrue(bx.contains(.endSession))
        XCTAssertTrue(bx.contains(.keepWordsOnPhone(words)))

        var c = editing()
        _ = c.handle(.leftThread)
        let cx = c.handle(.draftSaveFailed(unauthorized))
        XCTAssertTrue(cx.contains(.endSession))
        XCTAssertTrue(cx.contains(.keepWordsOnPhone(words)))

        var d = F(person: jan)
        _ = d.handle(.entered)
        let dx = d.handle(.draftLoadFailed(unauthorized))
        XCTAssertEqual(d.state, .sessionEnded)
        XCTAssertTrue(dx.contains(.endSession))
    }

    func test_shared_429DailyLimit_writingShowsNoNotesAndSendingStillWorks() {
        var f = reading()
        _ = f.handle(.insightFailed(seq: f.seq, .http(status: 429, error: "daily_limit")))
        XCTAssertEqual(f.state, .editing)
        XCTAssertTrue(f.notes.isEmpty)
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertNotNil(bridge(fx))
    }

    func test_shared_sendingNeverDependsOnAModelCall() {
        var f = entered(consent: false)
        _ = f.handle(.wordsChanged(words))
        let fx = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertNotNil(bridge(fx))
    }

    func test_shared_savedMeansConfirmed_aSendIsDoneOnlyAfter2xx() {
        var f = editing()
        _ = f.handle(.sendTapped)
        XCTAssertEqual(f.state, .sending)
        XCTAssertNotEqual(f.state, .sent)
        _ = f.handle(.sendSucceeded(bridgeId: "b-1"))
        XCTAssertEqual(f.state, .sent)
    }

    func test_shared_savedMeansConfirmed_aDraftIsSavedOnlyAfter2xx() {
        var f = editing()
        _ = f.handle(.leftThread)
        XCTAssertEqual(f.state, .savingDraft)
        _ = f.handle(.draftSaved)
        XCTAssertEqual(f.state, .closed)
    }

    func test_shared_waiting_nothingFor300ms_thenTheKnotForAtLeast500ms_thenTheUnavailableLineAfter10s() {
        XCTAssertEqual(Waiting.showKnotAfter, 0.3)
        XCTAssertEqual(Waiting.knotMinimum, 0.5)
        XCTAssertEqual(Waiting.unavailableAfter, 10)
        XCTAssertEqual(Waiting.phase(elapsed: 0), .nothing)
        XCTAssertEqual(Waiting.phase(elapsed: 0.299), .nothing)
        XCTAssertEqual(Waiting.phase(elapsed: 0.3), .knot)
        XCTAssertEqual(Waiting.phase(elapsed: 9.99), .knot)
        XCTAssertEqual(Waiting.phase(elapsed: 10), .unavailable)
        XCTAssertFalse(Waiting.mayHideKnot(shownFor: 0.49))
        XCTAssertTrue(Waiting.mayHideKnot(shownFor: 0.5))
    }
}
