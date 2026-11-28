import AuthenticationServices
import DeclaredAgeRange
import Flows
import UIKit

/// The live `SignInProvider`: the Declared Age Range request and Sign in with Apple (flows/sign-in.md, compliance.md).
@MainActor
enum AppleSignIn {
    static var provider: SignInProvider {
        SignInProvider(ageRange: ageRange, apple: { nonceSHA256 in await AppleSheet().present(nonceSHA256: nonceSHA256) })
    }

    /// iOS 26 and later: the age range at the gate. Declined, not available, an error or an older iOS: `.notDeclared`,
    /// and the on-screen 18+ statement stands as the person's own declaration.
    static func ageRange(gate: Int) async -> SignInFlow.AgeAnswer {
        guard #available(iOS 26.0, *), let window = keyWindow, let controller = window.rootViewController else {
            return .notDeclared
        }
        do {
            switch try await AgeRangeService.shared.requestAgeRange(ageGates: gate, in: controller) {
            case .declinedSharing:
                return .notDeclared
            case let .sharing(range):
                if let lower = range.lowerBound, lower >= gate { return .adult }
                if let upper = range.upperBound, upper < gate { return .underAge }
                return .notDeclared
            @unknown default:
                return .notDeclared
            }
        } catch {
            return .notDeclared
        }
    }

    static var keyWindow: UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
    }
}

/// One Apple sheet: asks for the full name and email, with the nonce's SHA-256, and answers once.
@MainActor
private final class AppleSheet: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var answer: CheckedContinuation<SignInProvider.AppleOutcome, Never>?
    private var controller: ASAuthorizationController?

    func present(nonceSHA256: String) async -> SignInProvider.AppleOutcome {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName]
        request.nonce = nonceSHA256
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        return await withCheckedContinuation { continuation in
            answer = continuation
            controller.performRequests()
        }
    }

    private func finish(_ outcome: SignInProvider.AppleOutcome) {
        answer?.resume(returning: outcome)
        answer = nil
        controller = nil
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { AppleSignIn.keyWindow ?? ASPresentationAnchor() }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential
        let token = credential?.identityToken.flatMap { String(data: $0, encoding: .utf8) }
        let code = credential?.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        // Apple gives the name only on the first authorization.
        let name = credential?.fullName.map { PersonNameComponentsFormatter().string(from: $0) }.flatMap { $0.isEmpty ? nil : $0 }
        MainActor.assumeIsolated {
            guard let token else { return finish(.failed) }
            finish(.credential(SignInFlow.AppleCredential(identityToken: token, authorizationCode: code, name: name)))
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        MainActor.assumeIsolated { finish(cancelled ? .cancelled : .failed) }
    }
}
