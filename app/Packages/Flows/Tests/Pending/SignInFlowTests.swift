// Issue #13. Acceptance tests written in C4 from packages/01 only: flows/sign-in.md (one test per row of the state
// table), flows/README.md (shared rules), behaviour.md (`signIn`), states.md and copy.md. No implementation was read.
//
// Pending: Tests/Pending is not part of the FlowsTests target. First step of the build:
// `git mv app/Packages/Flows/Tests/Pending/SignInFlowTests.swift app/Packages/Flows/Tests/FlowsTests/` unchanged.
//
// ───────────────────────────── API the tests expect ─────────────────────────────
// Shared by every flow in the Flows module, exactly as stated in WriteSendFlowTests.swift (#18): `CallFailure`
// (`.http(status:error:reason:)`, `.offline`, `.timeout`), `Haptic`, `Waiting`. Calls are effects the app performs;
// their answers come back as events.
//
// struct SignInFlow (value type):
//   init(storedRefreshToken: String? = nil, pendingInvite: String? = nil)
//   private(set) var state: State                         // starts at .launching
//   mutating func handle(_ event: Event) -> [Effect]
//   Read-only context:
//     nonce: String?            // the raw random nonce of the current provider attempt (fresh on every attempt)
//     pendingInvite: String?    // the invite code the app was opened with, kept until the invite flow uses it
//     appleName: String?        // Apple's name from the first authorization, kept for a retry
//   Nested types (memberwise inits, fields in this order):
//     enum Provider { apple, google }
//     enum State { launching, signedOut, checkingAge(Provider), appleSheet, googleSheet, underAge, exchanging,
//                  signInFailed(SignInFailure), checkingConsent, aiConsent(requiredVersion: String), opened(Destination) }
//       `routing` and `next` pass straight through: routing is the `GET /me` call made on the way into
//       .checkingConsent; next is the move to .opened(...). `.aiConsent` hands over to the privacy flow (#14) and waits.
//       This flow is the sign-in itself, so the shared 401 rule lands on its own .signedOut (no separate sessionEnded).
//     enum SignInFailure { provider, server, offline }      // copy signIn.providerFailed / serverFailed / offline
//     enum Destination { talk, invite(code: String) }      // invite = the invite flow at `peeking` (invite.md)
//     enum AgeAnswer { adult, underAge, notDeclared }       // notDeclared: declined, not available, or iOS before 26
//     struct Session { accessToken: String; refreshToken: String; expiresAt: String; personId: String }
//     struct AppleCredential { identityToken: String; authorizationCode: String?; name: String? }
//     struct GoogleCredential { idToken: String; serverAuthCode: String? }
//     struct AppleAuthRequest { identityToken: String; nonce: String; name: String?; adultConfirmed: Bool; authorizationCode: String? }
//     struct GoogleAuthRequest { idToken: String; nonce: String; adultConfirmed: Bool; serverAuthCode: String? }
//     enum Event { launched, refreshSucceeded(Session), refreshRefused, refreshOffline, openedByInviteLink(code: String),
//                  appleTapped, googleTapped, ageAnswered(AgeAnswer), appleCredential(AppleCredential),
//                  googleCredential(GoogleCredential), providerCancelled, providerFailed, exchangeSucceeded(Session),
//                  exchangeFailed(CallFailure), retryTapped, meLoaded(given: String?, requiredVersion: String),
//                  meFailed(CallFailure), consentAnswered }
//       `meLoaded.given` is `ai_consent.given.version` (null when none or behind); `consentAnswered` is the privacy
//       flow finishing (agreed or Not now).
//     enum Effect { call(Call), requestAgeRange(gate: Int), presentApple(nonceSHA256: String), presentGoogle(nonce: String),
//                   storeSession(Session), keepPendingInvite(String), endSession }
//       `presentApple` carries the lowercase hex SHA-256 of `nonce`; `presentGoogle` the raw nonce; `endSession`
//       forgets the stored session. The auth requests carry the raw nonce (CONTRACT `POST /auth/apple`).
//     enum Call { refreshSession(refreshToken: String), authApple(AppleAuthRequest), authGoogle(GoogleAuthRequest), getMe }
//   All nested types are Equatable.
//
// Not asserted (gaps recorded on #13): that the 400 `invalid` Ref is logged (CallFailure carries no Ref); what a 5xx
// from the Supabase refresh does (neither "refused" nor "offline"); what a 429 from /auth does.
import CryptoKit
import XCTest
@testable import Flows

final class SignInFlowTests: XCTestCase {
    typealias F = SignInFlow
    let session = F.Session(accessToken: "at-1", refreshToken: "rt-1", expiresAt: "2026-12-01T18:00:00.000Z", personId: "me-1")
    let appleFirst = F.AppleCredential(identityToken: "apple-jwt", authorizationCode: "code-1", name: "Ava Stone")
    let appleAgain = F.AppleCredential(identityToken: "apple-jwt-2", authorizationCode: "code-2", name: nil)
    let google = F.GoogleCredential(idToken: "google-jwt", serverAuthCode: "server-code")

    // MARK: Helpers: reach each state through events, as the app would.
    func signedOut(invite: String? = nil) -> F {
        var f = F(storedRefreshToken: nil, pendingInvite: invite)
        _ = f.handle(.launched)
        return f
    }
    func sheet(_ provider: F.Provider, invite: String? = nil) -> F {
        var f = signedOut(invite: invite)
        _ = f.handle(provider == .apple ? .appleTapped : .googleTapped)
        _ = f.handle(.ageAnswered(.adult))
        return f
    }
    func exchanging(_ provider: F.Provider = .apple) -> F {
        var f = sheet(provider)
        _ = f.handle(provider == .apple ? .appleCredential(appleFirst) : .googleCredential(google))
        return f
    }
    func checkingConsent(invite: String? = nil) -> F {
        var f = sheet(.apple, invite: invite)
        _ = f.handle(.appleCredential(appleFirst))
        _ = f.handle(.exchangeSucceeded(session))
        return f
    }
    func calls(_ effects: [F.Effect]) -> [F.Call] {
        effects.compactMap { if case let .call(c) = $0 { return c } else { return nil } }
    }
    func appleRequest(_ effects: [F.Effect]) -> F.AppleAuthRequest? {
        for c in calls(effects) { if case let .authApple(r) = c { return r } }
        return nil
    }
    func googleRequest(_ effects: [F.Effect]) -> F.GoogleAuthRequest? {
        for c in calls(effects) { if case let .authGoogle(r) = c { return r } }
        return nil
    }
    func sha256Hex(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    func storesASession(_ effects: [F.Effect]) -> Bool {
        effects.contains { if case .storeSession = $0 { return true } else { return false } }
    }

    // MARK: Launch

    func test_row01_launching_storedSession_refreshesThenRoutes() {
        var f = F(storedRefreshToken: "rt-stored")
        XCTAssertEqual(f.state, .launching)
        let fx = f.handle(.launched)
        XCTAssertEqual(f.state, .launching)
        XCTAssertEqual(calls(fx), [.refreshSession(refreshToken: "rt-stored")])

        let rx = f.handle(.refreshSucceeded(session))
        XCTAssertEqual(f.state, .checkingConsent, "routing passes straight through to checkingConsent")
        XCTAssertTrue(rx.contains(.storeSession(session)))
        XCTAssertEqual(calls(rx), [.getMe])
    }

    func test_row02_launching_noStoredSession_signedOut() {
        var f = F(storedRefreshToken: nil)
        let fx = f.handle(.launched)
        XCTAssertEqual(f.state, .signedOut)
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row03_launching_refreshRefused_signedOutAndTheStoredSessionIsCleared() {
        var f = F(storedRefreshToken: "rt-stored")
        _ = f.handle(.launched)
        let fx = f.handle(.refreshRefused)
        XCTAssertEqual(f.state, .signedOut)
        XCTAssertTrue(fx.contains(.endSession))
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row04_launching_refreshOffline_routesOnTheStoredTokenAndTheFirst401SignsOut() {
        var f = F(storedRefreshToken: "rt-stored")
        _ = f.handle(.launched)
        let fx = f.handle(.refreshOffline)
        XCTAssertEqual(f.state, .checkingConsent)
        XCTAssertEqual(calls(fx), [.getMe])
        XCTAssertFalse(fx.contains(.endSession))

        let ux = f.handle(.meFailed(.http(status: 401, error: "unauthorized")))
        XCTAssertEqual(f.state, .signedOut)
        XCTAssertTrue(ux.contains(.endSession))
    }

    // MARK: Signed out

    func test_row05_signedOut_openedByAnInviteLink_keepsPendingInvite() {
        var f = signedOut()
        let fx = f.handle(.openedByInviteLink(code: "abc123"))
        XCTAssertEqual(f.state, .signedOut)
        XCTAssertEqual(f.pendingInvite, "abc123")
        XCTAssertTrue(fx.contains(.keepPendingInvite("abc123")))
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row06_signedOut_tapAppleOrGoogle_checksTheDeclaredAgeRangeAt18() {
        var a = signedOut()
        let ax = a.handle(.appleTapped)
        XCTAssertEqual(a.state, .checkingAge(.apple))
        XCTAssertEqual(ax, [.requestAgeRange(gate: 18)])

        var g = signedOut()
        let gx = g.handle(.googleTapped)
        XCTAssertEqual(g.state, .checkingAge(.google))
        XCTAssertEqual(gx, [.requestAgeRange(gate: 18)])
    }

    // MARK: Age

    func test_row07_checkingAge_adult_opensTheTappedProviderWithAFreshNonce() {
        var a = signedOut()
        _ = a.handle(.appleTapped)
        let ax = a.handle(.ageAnswered(.adult))
        XCTAssertEqual(a.state, .appleSheet)
        guard let nonce = a.nonce, !nonce.isEmpty else { return XCTFail("no nonce") }
        XCTAssertEqual(ax, [.presentApple(nonceSHA256: sha256Hex(nonce))], "Apple gets the nonce's SHA-256")

        var g = signedOut()
        _ = g.handle(.googleTapped)
        let gx = g.handle(.ageAnswered(.adult))
        XCTAssertEqual(g.state, .googleSheet)
        guard let gNonce = g.nonce, !gNonce.isEmpty else { return XCTFail("no nonce") }
        XCTAssertEqual(gx, [.presentGoogle(nonce: gNonce)])
    }

    func test_row07_everyAttemptHasAFreshNonce() {
        var f = sheet(.apple)
        let first = f.nonce
        _ = f.handle(.providerCancelled)
        _ = f.handle(.appleTapped)
        _ = f.handle(.ageAnswered(.adult))
        XCTAssertNotNil(f.nonce)
        XCTAssertNotEqual(f.nonce, first)
    }

    func test_row08_checkingAge_under18_underAgeWithNoSheetAndNothingSent() {
        for tap in [F.Event.appleTapped, .googleTapped] {
            var f = signedOut()
            _ = f.handle(tap)
            let fx = f.handle(.ageAnswered(.underAge))
            XCTAssertEqual(f.state, .underAge)
            XCTAssertTrue(fx.isEmpty, "no provider sheet, nothing sent")
        }
    }

    func test_row09_checkingAge_notDeclared_theOnScreenStatementStands() {
        var a = signedOut()
        _ = a.handle(.appleTapped)
        let ax = a.handle(.ageAnswered(.notDeclared))
        XCTAssertEqual(a.state, .appleSheet)
        XCTAssertEqual(ax, [.presentApple(nonceSHA256: sha256Hex(a.nonce ?? ""))])

        var g = signedOut()
        _ = g.handle(.googleTapped)
        _ = g.handle(.ageAnswered(.notDeclared))
        XCTAssertEqual(g.state, .googleSheet)
        let gx = g.handle(.googleCredential(google))
        XCTAssertEqual(googleRequest(gx)?.adultConfirmed, true, "the person's own declaration")
    }

    // MARK: Provider sheets

    func test_row10_appleSheet_credential_exchangesWithTheRawNonceAndTheName() {
        var f = sheet(.apple)
        let nonce = f.nonce
        let fx = f.handle(.appleCredential(appleFirst))
        XCTAssertEqual(f.state, .exchanging)
        XCTAssertEqual(calls(fx), [.authApple(F.AppleAuthRequest(identityToken: "apple-jwt", nonce: nonce ?? "-",
                                                                 name: "Ava Stone", adultConfirmed: true,
                                                                 authorizationCode: "code-1"))])
    }

    func test_row10_appleSheet_laterAuthorization_sendsNoName() {
        var f = sheet(.apple)
        let fx = f.handle(.appleCredential(appleAgain))
        guard let request = appleRequest(fx) else { return XCTFail("no POST /auth/apple") }
        XCTAssertNil(request.name)
    }

    func test_row11_googleSheet_idToken_exchanges() {
        var f = sheet(.google)
        let nonce = f.nonce
        let fx = f.handle(.googleCredential(google))
        XCTAssertEqual(f.state, .exchanging)
        XCTAssertEqual(calls(fx), [.authGoogle(F.GoogleAuthRequest(idToken: "google-jwt", nonce: nonce ?? "-",
                                                                   adultConfirmed: true, serverAuthCode: "server-code"))])
    }

    func test_row12_sheet_cancelled_signedOutWithNothingShown() {
        for provider in [F.Provider.apple, .google] {
            var f = sheet(provider)
            let fx = f.handle(.providerCancelled)
            XCTAssertEqual(f.state, .signedOut)
            XCTAssertTrue(fx.isEmpty)
        }
    }

    func test_row13_sheet_fails_signInFailedWithTheProviderLine() {
        for provider in [F.Provider.apple, .google] {
            var f = sheet(provider)
            let fx = f.handle(.providerFailed)
            XCTAssertEqual(f.state, .signInFailed(.provider))
            XCTAssertTrue(calls(fx).isEmpty)
        }
    }

    // MARK: Exchanging

    func test_row14_exchanging_200_storesTheSessionAndRoutes() {
        for provider in [F.Provider.apple, .google] {
            var f = exchanging(provider)
            let fx = f.handle(.exchangeSucceeded(session))
            XCTAssertEqual(f.state, .checkingConsent)
            XCTAssertTrue(fx.contains(.storeSession(session)))
            XCTAssertEqual(calls(fx), [.getMe])
        }
    }

    func test_row15_exchanging_401_providerLine() {
        for provider in [F.Provider.apple, .google] {
            var f = exchanging(provider)
            let fx = f.handle(.exchangeFailed(.http(status: 401, error: "unauthorized")))
            XCTAssertEqual(f.state, .signInFailed(.provider))
            XCTAssertFalse(storesASession(fx))
        }
    }

    func test_row16_exchanging_400Invalid_providerLine() {
        var f = exchanging()
        let fx = f.handle(.exchangeFailed(.http(status: 400, error: "invalid")))
        XCTAssertEqual(f.state, .signInFailed(.provider))
        XCTAssertFalse(storesASession(fx))
    }

    func test_row17_exchanging_5xxOrTimeout_serverLine() {
        for failure in [CallFailure.http(status: 500, error: "internal"), .http(status: 502), .http(status: 503), .timeout] {
            var f = exchanging()
            _ = f.handle(.exchangeFailed(failure))
            XCTAssertEqual(f.state, .signInFailed(.server), "\(failure)")
        }
    }

    func test_row17_appleNameIsKeptForTheRetry() {
        var f = exchanging(.apple)
        _ = f.handle(.exchangeFailed(.http(status: 500, error: "internal")))
        XCTAssertEqual(f.appleName, "Ava Stone")
        _ = f.handle(.retryTapped)
        _ = f.handle(.appleTapped)
        _ = f.handle(.ageAnswered(.adult))
        let fx = f.handle(.appleCredential(appleAgain))      // Apple does not give the name a second time
        XCTAssertEqual(appleRequest(fx)?.name, "Ava Stone")
        XCTAssertEqual(appleRequest(fx)?.identityToken, "apple-jwt-2")
    }

    func test_row18_exchanging_offline_offlineLine() {
        var f = exchanging()
        _ = f.handle(.exchangeFailed(.offline))
        XCTAssertEqual(f.state, .signInFailed(.offline))
    }

    func test_row19_signInFailed_retry_signedOut() {
        var f = exchanging()
        _ = f.handle(.exchangeFailed(.offline))
        let fx = f.handle(.retryTapped)
        XCTAssertEqual(f.state, .signedOut)
        XCTAssertTrue(fx.isEmpty)
    }

    // MARK: Routing and where the app opens

    func test_row20_routing_callsGetMe() {
        var f = exchanging()
        let fx = f.handle(.exchangeSucceeded(session))
        XCTAssertEqual(f.state, .checkingConsent)
        XCTAssertEqual(calls(fx), [.getMe])
    }

    func test_row21_checkingConsent_givenMatchesRequired_next_talk() {
        var f = checkingConsent()
        let fx = f.handle(.meLoaded(given: "2027-01", requiredVersion: "2027-01"))
        XCTAssertEqual(f.state, .opened(.talk))
        XCTAssertTrue(calls(fx).isEmpty)
    }

    func test_row22_checkingConsent_givenNullOrBehind_aiConsentAndTheNextStepWaits() {
        for given in [String?.none, "2026-06"] {
            var f = checkingConsent()
            _ = f.handle(.meLoaded(given: given, requiredVersion: "2027-01"))
            XCTAssertEqual(f.state, .aiConsent(requiredVersion: "2027-01"), "\(String(describing: given))")
            _ = f.handle(.consentAnswered)
            XCTAssertEqual(f.state, .opened(.talk))
        }
    }

    func test_row23_checkingConsent_getMeFails_next() {
        for failure in [CallFailure.http(status: 500), .http(status: 503), .offline, .timeout] {
            var f = checkingConsent()
            _ = f.handle(.meFailed(failure))
            XCTAssertEqual(f.state, .opened(.talk), "\(failure)")
        }
    }

    func test_row24_next_pendingInvite_inviteFlow() {
        var f = signedOut()
        _ = f.handle(.openedByInviteLink(code: "abc123"))
        _ = f.handle(.appleTapped)
        _ = f.handle(.ageAnswered(.adult))
        _ = f.handle(.appleCredential(appleFirst))
        _ = f.handle(.exchangeSucceeded(session))
        _ = f.handle(.meLoaded(given: "2027-01", requiredVersion: "2027-01"))
        XCTAssertEqual(f.state, .opened(.invite(code: "abc123")))

        // An invite kept on the phone from before, with a stored session.
        var g = F(storedRefreshToken: "rt-stored", pendingInvite: "kept-1")
        _ = g.handle(.launched)
        _ = g.handle(.refreshSucceeded(session))
        _ = g.handle(.meLoaded(given: nil, requiredVersion: "2027-01"))
        _ = g.handle(.consentAnswered)
        XCTAssertEqual(g.state, .opened(.invite(code: "kept-1")), "a new account from an invite: aiConsent, then the invite")
    }

    func test_row25_next_otherwise_talk() {
        var f = F(storedRefreshToken: "rt-stored")
        _ = f.handle(.launched)
        _ = f.handle(.refreshSucceeded(session))
        _ = f.handle(.meLoaded(given: "2027-01", requiredVersion: "2027-01"))
        XCTAssertEqual(f.state, .opened(.talk))
    }

    func test_row26_underAge_stays_signingInIsNotOffered() {
        var f = signedOut()
        _ = f.handle(.appleTapped)
        _ = f.handle(.ageAnswered(.underAge))
        for event in [F.Event.appleTapped, .googleTapped, .retryTapped, .ageAnswered(.adult), .appleCredential(appleFirst)] {
            let fx = f.handle(event)
            XCTAssertEqual(f.state, .underAge, "\(event)")
            XCTAssertTrue(fx.isEmpty, "\(event)")
        }
    }

    // MARK: Controls (behaviour.md `signIn`)

    func test_behaviour_providerButtonsAreDimmedWhileASheetIsOpenOrExchanging() {
        var s = sheet(.apple)
        let sx = s.handle(.googleTapped)
        XCTAssertEqual(s.state, .appleSheet)
        XCTAssertTrue(sx.isEmpty)

        var e = exchanging()
        for tap in [F.Event.appleTapped, .googleTapped] {
            let ex = e.handle(tap)
            XCTAssertEqual(e.state, .exchanging)
            XCTAssertTrue(ex.isEmpty)
        }
    }

    func test_behaviour_signInFailed_aProviderButtonStartsAgainAtTheAgeCheck() {
        var f = exchanging()
        _ = f.handle(.exchangeFailed(.offline))
        let fx = f.handle(.googleTapped)
        XCTAssertEqual(f.state, .checkingAge(.google))
        XCTAssertEqual(fx, [.requestAgeRange(gate: 18)])
    }

    // MARK: Shared rules (flows/README.md)

    func test_shared_401OnGetMe_endsTheSession() {
        var f = checkingConsent()
        let fx = f.handle(.meFailed(.http(status: 401, error: "unauthorized")))
        XCTAssertEqual(f.state, .signedOut)
        XCTAssertTrue(fx.contains(.endSession))
    }

    func test_shared_savedMeansConfirmed_theSessionIsStoredOnlyAfter200() {
        var f = sheet(.apple)
        let cx = f.handle(.appleCredential(appleFirst))
        XCTAssertFalse(storesASession(cx))
        XCTAssertEqual(f.state, .exchanging)
        let fx = f.handle(.exchangeSucceeded(session))
        XCTAssertTrue(fx.contains(.storeSession(session)))
    }
}
