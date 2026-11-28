// Issue #22: `signIn.privacy` (packages/01/behaviour.md, `signIn`): opens kenember.com/privacy in Safari
// when signed out or after a failure; dimmed while a sheet is open or the exchange is on its way.
import Foundation
import Testing
@testable import Flows

@Suite struct SignInPrivacyTests {
    private let privacy = SignInFlow.Effect.openInSafari(URL(string: "https://kenember.com/privacy")!)

    private func signedOut() -> SignInFlow {
        var flow = SignInFlow()
        _ = flow.handle(.launched)
        return flow
    }

    @Test func signedOutOpensPrivacy() {
        var flow = signedOut()
        #expect(flow.handle(.privacyTapped) == [privacy])
        #expect(flow.state == .signedOut)
    }

    @Test func failedOpensPrivacy() {
        var flow = signedOut()
        _ = flow.handle(.appleTapped)
        _ = flow.handle(.ageAnswered(.adult))
        _ = flow.handle(.providerFailed)
        #expect(flow.handle(.privacyTapped) == [privacy])
        #expect(flow.state == .signInFailed(.provider))
    }

    @Test func underAgeOpensPrivacy() {
        var flow = signedOut()
        _ = flow.handle(.googleTapped)
        _ = flow.handle(.ageAnswered(.underAge))
        #expect(flow.handle(.privacyTapped) == [privacy])
        #expect(flow.state == .underAge)
    }

    @Test func dimmedWhileTheSheetIsOpenOrExchanging() {
        var flow = signedOut()
        _ = flow.handle(.appleTapped)
        #expect(flow.handle(.privacyTapped).isEmpty)
        _ = flow.handle(.ageAnswered(.adult))
        #expect(flow.handle(.privacyTapped).isEmpty)
        _ = flow.handle(.appleCredential(.init(identityToken: "t", authorizationCode: nil, name: nil)))
        #expect(flow.state == .exchanging)
        #expect(flow.handle(.privacyTapped).isEmpty)
    }
}
