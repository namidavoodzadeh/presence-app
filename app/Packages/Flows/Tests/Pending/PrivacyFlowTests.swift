// Issue #14. Acceptance tests written in C4 from packages/01 only: flows/privacy.md (one test per row of both state
// tables), flows/README.md (shared rules), behaviour.md (`aiConsent`, `settings`), states.md (`settings`) and copy.md.
// No implementation was read.
//
// Pending: Tests/Pending is not part of the FlowsTests target. First step of the build:
// `git mv app/Packages/Flows/Tests/Pending/PrivacyFlowTests.swift app/Packages/Flows/Tests/FlowsTests/` unchanged.
//
// ───────────────────────────── API the tests expect ─────────────────────────────
// Shared by every flow in the Flows module, exactly as stated in WriteSendFlowTests.swift (#18): `CallFailure`
// (`.http(status:error:reason:)`, `.offline`, `.timeout`), `Haptic`, `Waiting`. A 401 from any call: the flow moves to
// its `.sessionEnded` state and emits `.endSession`. Calls are effects the app performs; their answers come back as events.
//
// privacy.md has two tables; they are two machines, one per table: AIConsentFlow and SettingsFlow. Settings hands over
// to AIConsentFlow by entering its `.aiConsent` state. All nested types are Equatable.
//
// struct AIConsentFlow (value type):
//   init(requiredVersion: String, refusedTalkTurn: String? = nil)   // refusedTalkTurn: the words of a Talk turn that
//                                                                   // answered 403 ai_consent_required
//   private(set) var state: State                         // starts at .showing ("asked" passes straight through)
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context: requiredVersion: String, showsNotSaved: Bool (copy aiConsent.notSaved)
//   enum State { showing, saving, given, declined, sessionEnded }
//   enum Event { agreeTapped, notNowTapped, privacyTapped, turnOnTapped, consentSaved, consentSaveFailed(CallFailure),
//                meLoaded(given: String?, requiredVersion: String), meFailed(CallFailure) }
//     `turnOnTapped` is the turn-on line in Talk or `settings.ai` while declined.
//   enum Effect { call(Call), openInSafari(URL), resendTalkTurn(String), rememberAIConsent(Bool), endSession }
//     `rememberAIConsent` tells the app the person's consent changed (WriteSendFlow and Talk read it).
//   enum Call { postConsent(version: String, providers: [String]), getMe }
//
// struct SettingsFlow (value type):
//   init(installationId: String, lastKnownAI: Bool? = nil, timeZone: TimeZone = .current)
//   private(set) var state: State                         // starts at .closed (any view, Settings not up)
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context:
//     ai: Bool?      // the AI row: true On, false Off, nil left out (GET /me failed); the last known value until it loads
//     line: Line?    // the line shown under the rows or on the confirming card
//   enum State { closed, open, withdrawing, aiConsent, exporting, loggingOut, confirming, deleting, loggedOut, deleted,
//                sessionEnded }       // loggedOut and deleted show `signIn`
//   enum Line { notSaved, exportFailed, notDeleted, testAccount }   // copy aiConsent.notSaved, settings.exportFailed,
//                                                                   // settings.notDeleted, settings.testAccount
//   enum Event { pulled, touchedOutside, meLoaded(given: String?, requiredVersion: String), meFailed(CallFailure),
//                aiTapped, withdrawn, withdrawFailed(CallFailure), privacyTapped, downloadTapped,
//                exported(data: Data, at: Date), exportFailed(CallFailure), logOutTapped, deviceRemoved,
//                deviceRemovalFailed(CallFailure), signOutFinished, deleteTapped, cancelDeleteTapped,
//                confirmDeleteTapped, accountDeleted, deleteFailed(CallFailure) }
//     `pulled` is a tap on `pull.mark` or a drag down from the top 140 pt; `signOutFinished` comes whether the Supabase
//     sign-out worked or not.
//   enum Effect { call(Call), openInSafari(URL), share(fileName: String, data: Data), rememberAIConsent(Bool),
//                 forgetSession, forgetEverything, showDeletedLineOnSignIn, retryDeviceRemovalAtNextSignIn(installationId: String),
//                 endSession }
//     `forgetSession`: the phone forgets the session, drafts and Talk turns it kept; `forgetEverything`: all it kept.
//   enum Call { getMe, withdrawConsent, export, removeDevice(installationId: String), signOut, deleteAccount }
//     `export` is GET /export; the share file is named `presence-YYYY-MM-DD.json` from `at` in `timeZone`.
//
// Not asserted (gaps recorded on #14): what AIConsentFlow does when the GET /me after a 400 fails (other than 401);
// where "back to where the person was going" leads (the app's job; the flow ends at .given).
import XCTest
@testable import Flows

private let privacyURL = URL(string: "https://kenember.com/privacy")!

final class AIConsentFlowTests: XCTestCase {
    typealias F = AIConsentFlow
    let turn = "I keep going quiet when Sam brings up money."

    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }
    func resends(_ effects: [F.Effect]) -> [String] {
        effects.compactMap { if case let .resendTalkTurn(w) = $0 { return w } else { return nil } }
    }
    func saving(refused: String? = nil) -> F {
        var f = F(requiredVersion: "2027-01", refusedTalkTurn: refused)
        _ = f.handle(.agreeTapped)
        return f
    }

    func test_row01_asked_showsTheConsentScreen() {
        let f = F(requiredVersion: "2027-01")
        XCTAssertEqual(f.state, .showing)
        XCTAssertEqual(f.requiredVersion, "2027-01")
        XCTAssertFalse(f.showsNotSaved)
    }

    func test_row02_showing_agree_postsTheRequiredVersionForAnthropic() {
        var f = F(requiredVersion: "2027-01")
        let fx = f.handle(.agreeTapped)
        XCTAssertEqual(f.state, .saving)
        XCTAssertEqual(calls(fx), [.postConsent(version: "2027-01", providers: ["anthropic"])])
    }

    func test_row03_saving_200_givenAndARefusedTalkTurnIsSentAgainOnceWithTheSameWords() {
        var f = saving(refused: turn)
        let fx = f.handle(.consentSaved)
        XCTAssertEqual(f.state, .given)
        XCTAssertEqual(resends(fx), [turn])
        XCTAssertTrue(fx.contains(.rememberAIConsent(true)))

        var g = saving()
        let gx = g.handle(.consentSaved)
        XCTAssertEqual(g.state, .given)
        XCTAssertTrue(resends(gx).isEmpty, "no refused turn, nothing to send again")
    }

    func test_row04_saving_400Invalid_getsTheCurrentVersionAndShowsTheSameScreen() {
        var f = saving()
        let fx = f.handle(.consentSaveFailed(.http(status: 400, error: "invalid")))
        XCTAssertEqual(f.state, .showing)
        XCTAssertEqual(calls(fx), [.getMe])
        XCTAssertFalse(f.showsNotSaved)

        _ = f.handle(.meLoaded(given: nil, requiredVersion: "2027-02"))
        XCTAssertEqual(f.requiredVersion, "2027-02")
        let ax = f.handle(.agreeTapped)
        XCTAssertEqual(calls(ax), [.postConsent(version: "2027-02", providers: ["anthropic"])])
    }

    func test_row05_saving_fails_notSavedLineAndNothingIsSentToTheAI() {
        for failure in [CallFailure.http(status: 500), .http(status: 503), .http(status: 429, error: "rate_limited"),
                        .offline, .timeout] {
            var f = saving(refused: turn)
            let fx = f.handle(.consentSaveFailed(failure))
            XCTAssertEqual(f.state, .showing, "\(failure)")
            XCTAssertTrue(f.showsNotSaved, "\(failure)")
            XCTAssertTrue(resends(fx).isEmpty, "\(failure)")
            XCTAssertFalse(fx.contains(.rememberAIConsent(true)), "\(failure)")
        }
    }

    func test_row06_showing_notNow_declinedWithNoCall() {
        var f = F(requiredVersion: "2027-01", refusedTalkTurn: turn)
        let fx = f.handle(.notNowTapped)
        XCTAssertEqual(f.state, .declined)
        XCTAssertTrue(calls(fx).isEmpty)
        XCTAssertTrue(resends(fx).isEmpty)
    }

    func test_row07_declined_turnOn_showingAgain() {
        var f = F(requiredVersion: "2027-01")
        _ = f.handle(.notNowTapped)
        let fx = f.handle(.turnOnTapped)
        XCTAssertEqual(f.state, .showing)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row08_showing_privacy_opensThePolicyInSafari() {
        var f = F(requiredVersion: "2027-01")
        let fx = f.handle(.privacyTapped)
        XCTAssertEqual(f.state, .showing)
        XCTAssertEqual(fx, [.openInSafari(privacyURL)])
    }

    func test_behaviour_agreeAndNotNowAreDimmedWhileSaving() {
        var f = saving()
        for tap in [F.Event.agreeTapped, .notNowTapped] {
            let fx = f.handle(tap)
            XCTAssertEqual(f.state, .saving)
            XCTAssertTrue(fx.isEmpty)
        }
    }

    func test_shared_401WhileSaving_endsTheSession() {
        var f = saving(refused: turn)
        let fx = f.handle(.consentSaveFailed(.http(status: 401, error: "unauthorized")))
        XCTAssertEqual(f.state, .sessionEnded)
        XCTAssertTrue(fx.contains(.endSession))
        XCTAssertTrue(resends(fx).isEmpty)
    }

    func test_shared_401OnTheVersionCheck_endsTheSession() {
        var f = saving()
        _ = f.handle(.consentSaveFailed(.http(status: 400, error: "invalid")))
        let fx = f.handle(.meFailed(.http(status: 401, error: "unauthorized")))
        XCTAssertEqual(f.state, .sessionEnded)
        XCTAssertTrue(fx.contains(.endSession))
    }

    func test_shared_savedMeansConfirmed_consentIsGivenOnlyAfter2xx() {
        var f = F(requiredVersion: "2027-01", refusedTalkTurn: turn)
        let fx = f.handle(.agreeTapped)
        XCTAssertEqual(f.state, .saving)
        XCTAssertFalse(fx.contains(.rememberAIConsent(true)))
        XCTAssertTrue(resends(fx).isEmpty)
    }
}

final class SettingsFlowTests: XCTestCase {
    typealias F = SettingsFlow
    let utc = TimeZone(identifier: "UTC")!

    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }
    func forgets(_ effects: [F.Effect]) -> Bool {
        effects.contains(.forgetSession) || effects.contains(.forgetEverything)
    }
    func open(ai: Bool? = true) -> F {
        var f = F(installationId: "inst-1", lastKnownAI: nil, timeZone: utc)
        _ = f.handle(.pulled)
        switch ai {
        case true?: _ = f.handle(.meLoaded(given: "2027-01", requiredVersion: "2027-01"))
        case false?: _ = f.handle(.meLoaded(given: nil, requiredVersion: "2027-01"))
        case nil: _ = f.handle(.meFailed(.offline))
        }
        return f
    }
    func confirming() -> F {
        var f = open()
        _ = f.handle(.deleteTapped)
        return f
    }
    func deleting() -> F {
        var f = confirming()
        _ = f.handle(.confirmDeleteTapped)
        return f
    }

    func test_row09_anyView_pull_opensSettingsAndReadsTheAIRow() {
        var f = F(installationId: "inst-1", lastKnownAI: true, timeZone: utc)
        XCTAssertEqual(f.state, .closed)
        let fx = f.handle(.pulled)
        XCTAssertEqual(f.state, .open)
        XCTAssertEqual(calls(fx), [.getMe])
        XCTAssertEqual(f.ai, true, "the AI row reads its last known value while GET /me loads")
    }

    func test_row09_theAIRowFollowsGetMeAndIsLeftOutWhenItFails() {
        XCTAssertEqual(open(ai: true).ai, true)
        XCTAssertEqual(open(ai: false).ai, false)
        var behind = F(installationId: "inst-1", timeZone: utc)
        _ = behind.handle(.pulled)
        _ = behind.handle(.meLoaded(given: "2026-06", requiredVersion: "2027-01"))
        XCTAssertEqual(behind.ai, false, "a consent behind the required version is not On")
        let failed = open(ai: nil)
        XCTAssertNil(failed.ai)
        XCTAssertEqual(failed.state, .open, "the other rows work")
    }

    func test_row10_open_touchOutside_closed() {
        var f = open()
        let fx = f.handle(.touchedOutside)
        XCTAssertEqual(f.state, .closed)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row11_open_aiWhileOn_withdraws() {
        var f = open(ai: true)
        let fx = f.handle(.aiTapped)
        XCTAssertEqual(f.state, .withdrawing)
        XCTAssertEqual(calls(fx), [.withdrawConsent])
    }

    func test_row12_withdrawing_200_rowReadsOffAndNothingElseIsDeleted() {
        var f = open(ai: true)
        _ = f.handle(.aiTapped)
        let fx = f.handle(.withdrawn)
        XCTAssertEqual(f.state, .open)
        XCTAssertEqual(f.ai, false)
        XCTAssertTrue(fx.contains(.rememberAIConsent(false)))
        XCTAssertTrue(calls(fx).isEmpty, "nothing already kept is deleted")
        XCTAssertFalse(forgets(fx))
    }

    func test_row13_withdrawing_fails_notSavedAndTheRowStillReadsOn() {
        for failure in [CallFailure.http(status: 500), .http(status: 429, error: "rate_limited"), .offline, .timeout] {
            var f = open(ai: true)
            _ = f.handle(.aiTapped)
            let fx = f.handle(.withdrawFailed(failure))
            XCTAssertEqual(f.state, .open, "\(failure)")
            XCTAssertEqual(f.ai, true, "\(failure)")
            XCTAssertEqual(f.line, .notSaved, "\(failure)")
            XCTAssertFalse(fx.contains(.rememberAIConsent(false)), "\(failure)")
        }
    }

    func test_row14_open_aiWhileOff_aiConsent() {
        var f = open(ai: false)
        let fx = f.handle(.aiTapped)
        XCTAssertEqual(f.state, .aiConsent)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row15_open_privacy_opensThePolicyInSafari() {
        var f = open()
        let fx = f.handle(.privacyTapped)
        XCTAssertEqual(f.state, .open)
        XCTAssertEqual(fx, [.openInSafari(privacyURL)])
    }

    func test_row16_open_download_exports() {
        var f = open()
        let fx = f.handle(.downloadTapped)
        XCTAssertEqual(f.state, .exporting)
        XCTAssertEqual(calls(fx), [.export])
    }

    func test_row17_exporting_200_theShareSheetWithTheDatedFile() {
        var f = open()
        _ = f.handle(.downloadTapped)
        let data = Data("{\"exported_at\":\"2026-11-25T12:00:00Z\"}".utf8)
        let noon = Date(timeIntervalSince1970: 1_795_608_000)    // 2026-11-25T12:00:00Z
        let fx = f.handle(.exported(data: data, at: noon))
        XCTAssertEqual(f.state, .open)
        XCTAssertEqual(fx, [.share(fileName: "presence-2026-11-25.json", data: data)])
    }

    func test_row18_exporting_fails_notReadyLine() {
        for failure in [CallFailure.http(status: 500), .http(status: 503), .offline, .timeout] {
            var f = open()
            _ = f.handle(.downloadTapped)
            let fx = f.handle(.exportFailed(failure))
            XCTAssertEqual(f.state, .open, "\(failure)")
            XCTAssertEqual(f.line, .exportFailed, "\(failure)")
            XCTAssertTrue(calls(fx).isEmpty)
        }
    }

    func test_row19_open_logOut_removesTheDeviceThenSignsOut() {
        var f = open()
        let fx = f.handle(.logOutTapped)
        XCTAssertEqual(f.state, .loggingOut)
        XCTAssertEqual(calls(fx), [.removeDevice(installationId: "inst-1")])
        let dx = f.handle(.deviceRemoved)
        XCTAssertEqual(f.state, .loggingOut)
        XCTAssertEqual(calls(dx), [.signOut])
        let sx = f.handle(.signOutFinished)
        let all = fx + dx + sx
        XCTAssertTrue(all.contains(.forgetSession), "the phone forgets the session, drafts and Talk turns")
        XCTAssertFalse(all.contains(.retryDeviceRemovalAtNextSignIn(installationId: "inst-1")))
    }

    func test_row20_loggingOut_done_signInEvenWhenACallFails() {
        for failure in [CallFailure.http(status: 500), .offline, .timeout] {
            var f = open()
            let fx = f.handle(.logOutTapped)
            let dx = f.handle(.deviceRemovalFailed(failure))
            XCTAssertEqual(calls(dx), [.signOut], "\(failure)")
            let sx = f.handle(.signOutFinished)
            XCTAssertEqual(f.state, .loggedOut, "\(failure)")
            let all = fx + dx + sx
            XCTAssertTrue(all.contains(.forgetSession), "\(failure)")
            XCTAssertTrue(all.contains(.retryDeviceRemovalAtNextSignIn(installationId: "inst-1")), "\(failure)")
        }
        var ok = open()
        _ = ok.handle(.logOutTapped)
        _ = ok.handle(.deviceRemoved)
        _ = ok.handle(.signOutFinished)
        XCTAssertEqual(ok.state, .loggedOut)
    }

    func test_row21_open_delete_confirmingCardWithNoCall() {
        var f = open()
        let fx = f.handle(.deleteTapped)
        XCTAssertEqual(f.state, .confirming)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row22_confirming_keepMyAccount_open() {
        var f = confirming()
        let fx = f.handle(.cancelDeleteTapped)
        XCTAssertEqual(f.state, .open)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row23_confirming_delete_deletesTheAccount() {
        var f = confirming()
        let fx = f.handle(.confirmDeleteTapped)
        XCTAssertEqual(f.state, .deleting)
        XCTAssertEqual(calls(fx), [.deleteAccount])
    }

    func test_row24_deleting_200_signInWithTheDeletedLineOnceAndThePhoneForgetsEverything() {
        var f = deleting()
        let fx = f.handle(.accountDeleted)
        XCTAssertEqual(f.state, .deleted)
        XCTAssertTrue(fx.contains(.forgetEverything))
        XCTAssertTrue(fx.contains(.showDeletedLineOnSignIn))
    }

    func test_row25_deleting_403TestAccount_openWithTheTestAccountLine() {
        for reason in ["preview_account", "example_account"] {
            var f = deleting()
            let fx = f.handle(.deleteFailed(.http(status: 403, error: "forbidden", reason: reason)))
            XCTAssertEqual(f.state, .open, reason)
            XCTAssertEqual(f.line, .testAccount, reason)
            XCTAssertFalse(forgets(fx), "nothing is deleted")
        }
    }

    func test_row26_deleting_fails_confirmingWithTheNotDeletedLine() {
        for failure in [CallFailure.http(status: 500), .http(status: 503), .http(status: 403, error: "forbidden"),
                        .offline, .timeout] {
            var f = deleting()
            let fx = f.handle(.deleteFailed(failure))
            XCTAssertEqual(f.state, .confirming, "\(failure)")
            XCTAssertEqual(f.line, .notDeleted, "\(failure)")
            XCTAssertFalse(forgets(fx), "nothing changed")
        }
    }

    // MARK: Controls (behaviour.md `settings`)

    func test_behaviour_rowsAreDimmedWhileBusy() {
        var f = open(ai: true)
        _ = f.handle(.aiTapped)
        for tap in [F.Event.aiTapped, .downloadTapped, .logOutTapped, .deleteTapped, .privacyTapped] {
            let fx = f.handle(tap)
            XCTAssertEqual(f.state, .withdrawing, "\(tap)")
            XCTAssertTrue(fx.isEmpty, "\(tap)")
        }
    }

    func test_behaviour_rowsAreDimmedWhileConfirming() {
        var f = confirming()
        for tap in [F.Event.aiTapped, .downloadTapped, .logOutTapped, .privacyTapped] {
            let fx = f.handle(tap)
            XCTAssertEqual(f.state, .confirming, "\(tap)")
            XCTAssertTrue(fx.isEmpty, "\(tap)")
        }
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401OnAnyCall_endsTheSession() {
        let unauthorized = CallFailure.http(status: 401, error: "unauthorized")

        var a = open(ai: true)
        _ = a.handle(.aiTapped)
        let ax = a.handle(.withdrawFailed(unauthorized))
        XCTAssertEqual(a.state, .sessionEnded)
        XCTAssertTrue(ax.contains(.endSession))

        var b = open()
        _ = b.handle(.downloadTapped)
        let bx = b.handle(.exportFailed(unauthorized))
        XCTAssertEqual(b.state, .sessionEnded)
        XCTAssertTrue(bx.contains(.endSession))

        var c = deleting()
        let cx = c.handle(.deleteFailed(unauthorized))
        XCTAssertEqual(c.state, .sessionEnded)
        XCTAssertTrue(cx.contains(.endSession))

        var d = F(installationId: "inst-1", timeZone: utc)
        _ = d.handle(.pulled)
        let dx = d.handle(.meFailed(unauthorized))
        XCTAssertEqual(d.state, .sessionEnded)
        XCTAssertTrue(dx.contains(.endSession))
    }

    func test_shared_savedMeansConfirmed_theAIRowChangesOnlyAfter2xx() {
        var f = open(ai: true)
        let fx = f.handle(.aiTapped)
        XCTAssertEqual(f.state, .withdrawing)
        XCTAssertEqual(f.ai, true, "still reads On while the call is out")
        XCTAssertFalse(fx.contains(.rememberAIConsent(false)))
    }

    func test_shared_savedMeansConfirmed_theAccountIsGoneOnlyAfter2xx() {
        var f = confirming()
        let fx = f.handle(.confirmDeleteTapped)
        XCTAssertEqual(f.state, .deleting)
        XCTAssertFalse(forgets(fx))
        XCTAssertFalse(fx.contains(.showDeletedLineOnSignIn))
    }
}
