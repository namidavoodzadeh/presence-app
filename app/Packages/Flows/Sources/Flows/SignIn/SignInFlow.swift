import CryptoKit
import Foundation

/// Sign in with Apple or Google, and where the app opens (packages/01/flows/sign-in.md).
///
/// A value-type state machine: the app feeds it events and performs the effects it returns.
/// `routing` and `next` from the package's table pass straight through: routing is the `GET /me` call made on the
/// way into `.checkingConsent`; next is the move to `.opened(...)`.
public struct SignInFlow: Sendable {
    public enum Provider: Equatable, Sendable { case apple, google }

    public enum State: Equatable, Sendable {
        case launching
        case signedOut
        case checkingAge(Provider)
        case appleSheet
        case googleSheet
        case underAge
        case exchanging
        case signInFailed(SignInFailure)
        case checkingConsent
        case aiConsent(requiredVersion: String)
        case opened(Destination)
    }

    /// Which line `signIn` shows: copy `signIn.providerFailed`, `signIn.serverFailed`, `signIn.offline`.
    public enum SignInFailure: Equatable, Sendable { case provider, server, offline }

    public enum Destination: Equatable, Sendable {
        case talk
        /// The invite flow at `peeking` (invite.md).
        case invite(code: String)
    }

    /// `notDeclared`: declined, not available, or iOS before 26.
    public enum AgeAnswer: Equatable, Sendable { case adult, underAge, notDeclared }

    public struct Session: Equatable, Sendable {
        public var accessToken: String
        public var refreshToken: String
        public var expiresAt: String
        public var personId: String
        public init(accessToken: String, refreshToken: String, expiresAt: String, personId: String) {
            self.accessToken = accessToken
            self.refreshToken = refreshToken
            self.expiresAt = expiresAt
            self.personId = personId
        }
    }

    public struct AppleCredential: Equatable, Sendable {
        public var identityToken: String
        public var authorizationCode: String?
        public var name: String?
        public init(identityToken: String, authorizationCode: String?, name: String?) {
            self.identityToken = identityToken
            self.authorizationCode = authorizationCode
            self.name = name
        }
    }

    public struct GoogleCredential: Equatable, Sendable {
        public var idToken: String
        public var serverAuthCode: String?
        public init(idToken: String, serverAuthCode: String?) {
            self.idToken = idToken
            self.serverAuthCode = serverAuthCode
        }
    }

    /// `POST /auth/apple`. `nonce` is the raw nonce; Apple's sheet got its SHA-256.
    public struct AppleAuthRequest: Equatable, Sendable {
        public var identityToken: String
        public var nonce: String
        public var name: String?
        public var adultConfirmed: Bool
        public var authorizationCode: String?
        public init(identityToken: String, nonce: String, name: String?, adultConfirmed: Bool, authorizationCode: String?) {
            self.identityToken = identityToken
            self.nonce = nonce
            self.name = name
            self.adultConfirmed = adultConfirmed
            self.authorizationCode = authorizationCode
        }
    }

    /// `POST /auth/google`.
    public struct GoogleAuthRequest: Equatable, Sendable {
        public var idToken: String
        public var nonce: String
        public var adultConfirmed: Bool
        public var serverAuthCode: String?
        public init(idToken: String, nonce: String, adultConfirmed: Bool, serverAuthCode: String?) {
            self.idToken = idToken
            self.nonce = nonce
            self.adultConfirmed = adultConfirmed
            self.serverAuthCode = serverAuthCode
        }
    }

    public enum Event: Equatable, Sendable {
        case launched
        case refreshSucceeded(Session)
        case refreshRefused
        case refreshOffline
        case openedByInviteLink(code: String)
        case appleTapped
        case googleTapped
        case ageAnswered(AgeAnswer)
        case appleCredential(AppleCredential)
        case googleCredential(GoogleCredential)
        case providerCancelled
        case providerFailed
        case exchangeSucceeded(Session)
        case exchangeFailed(CallFailure)
        case retryTapped
        /// `given` is `ai_consent.given.version` (nil when none).
        case meLoaded(given: String?, requiredVersion: String)
        case meFailed(CallFailure)
        /// The privacy flow finished (agreed or Not now).
        case consentAnswered
    }

    public enum Effect: Equatable, Sendable {
        case call(Call)
        case requestAgeRange(gate: Int)
        /// Lowercase hex SHA-256 of `nonce`.
        case presentApple(nonceSHA256: String)
        /// The raw nonce.
        case presentGoogle(nonce: String)
        case storeSession(Session)
        case keepPendingInvite(String)
        /// Forget the stored session.
        case endSession
    }

    public enum Call: Equatable, Sendable {
        /// The Supabase Auth refresh with the stored refresh token.
        case refreshSession(refreshToken: String)
        case authApple(AppleAuthRequest)
        case authGoogle(GoogleAuthRequest)
        case getMe
    }

    /// Kenember is for adults only.
    public static let ageGate = 18

    public private(set) var state: State = .launching
    /// The raw random nonce of the current provider attempt, fresh on every attempt.
    public private(set) var nonce: String?
    /// The invite code the app was opened with, kept until the invite flow uses it.
    public private(set) var pendingInvite: String?
    /// Apple's name from the first authorization, kept for a retry (Apple gives it only once).
    public private(set) var appleName: String?

    private let storedRefreshToken: String?

    public init(storedRefreshToken: String? = nil, pendingInvite: String? = nil) {
        self.storedRefreshToken = storedRefreshToken
        self.pendingInvite = pendingInvite
    }

    public mutating func handle(_ event: Event) -> [Effect] {
        // An invite link may open the app at any point before it opens; the code is kept on the phone.
        if case let .openedByInviteLink(code) = event {
            pendingInvite = code
            return [.keepPendingInvite(code)]
        }

        switch (state, event) {
        // Launch
        case (.launching, .launched):
            guard let token = storedRefreshToken else {
                state = .signedOut
                return []
            }
            return [.call(.refreshSession(refreshToken: token))]
        case let (.launching, .refreshSucceeded(session)):
            return [.storeSession(session)] + route()
        case (.launching, .refreshRefused):
            state = .signedOut
            return [.endSession]
        case (.launching, .refreshOffline):
            // Use the stored access token; the first 401 goes to signedOut.
            return route()

        // Signed out, or after a failure: a provider button starts at the age check.
        case (.signedOut, .appleTapped), (.signInFailed, .appleTapped):
            state = .checkingAge(.apple)
            return [.requestAgeRange(gate: Self.ageGate)]
        case (.signedOut, .googleTapped), (.signInFailed, .googleTapped):
            state = .checkingAge(.google)
            return [.requestAgeRange(gate: Self.ageGate)]

        // Age
        case let (.checkingAge(provider), .ageAnswered(answer)):
            switch answer {
            case .underAge:
                state = .underAge
                return []
            case .adult, .notDeclared:
                return presentSheet(provider)
            }

        // Provider sheets
        case let (.appleSheet, .appleCredential(credential)):
            if let name = credential.name { appleName = name }
            state = .exchanging
            return [.call(.authApple(AppleAuthRequest(
                identityToken: credential.identityToken,
                nonce: nonce ?? "",
                name: appleName,
                adultConfirmed: true,
                authorizationCode: credential.authorizationCode
            )))]
        case let (.googleSheet, .googleCredential(credential)):
            state = .exchanging
            return [.call(.authGoogle(GoogleAuthRequest(
                idToken: credential.idToken,
                nonce: nonce ?? "",
                adultConfirmed: true,
                serverAuthCode: credential.serverAuthCode
            )))]
        case (.appleSheet, .providerCancelled), (.googleSheet, .providerCancelled):
            state = .signedOut
            return []
        case (.appleSheet, .providerFailed), (.googleSheet, .providerFailed):
            state = .signInFailed(.provider)
            return []

        // Exchanging
        case let (.exchanging, .exchangeSucceeded(session)):
            appleName = nil
            return [.storeSession(session)] + route()
        case let (.exchanging, .exchangeFailed(failure)):
            state = .signInFailed(Self.line(for: failure))
            return []

        case (.signInFailed, .retryTapped):
            state = .signedOut
            return []

        // Checking consent
        case let (.checkingConsent, .meLoaded(given, requiredVersion)):
            if given == requiredVersion {
                next()
            } else {
                state = .aiConsent(requiredVersion: requiredVersion)
            }
            return []
        case let (.checkingConsent, .meFailed(failure)):
            if failure.isUnauthorized {
                state = .signedOut
                return [.endSession]
            }
            // The first model call answers 403 ai_consent_required if consent is missing.
            next()
            return []
        case (.aiConsent, .consentAnswered):
            next()
            return []

        default:
            // Anything else does nothing: underAge stays, and provider buttons are dimmed while a sheet is open
            // or the exchange is on its way.
            return []
        }
    }

    // MARK: - Private

    /// `routing`: `GET /me` on the way into checkingConsent.
    private mutating func route() -> [Effect] {
        state = .checkingConsent
        return [.call(.getMe)]
    }

    /// `next`: where the app opens.
    private mutating func next() {
        if let code = pendingInvite {
            state = .opened(.invite(code: code))
        } else {
            state = .opened(.talk)
        }
    }

    private mutating func presentSheet(_ provider: Provider) -> [Effect] {
        let fresh = Self.randomNonce()
        nonce = fresh
        switch provider {
        case .apple:
            state = .appleSheet
            return [.presentApple(nonceSHA256: Self.sha256Hex(fresh))]
        case .google:
            state = .googleSheet
            return [.presentGoogle(nonce: fresh)]
        }
    }

    /// 401 and 400 (and any other 4xx): the provider line. 5xx or timeout: the server line. Offline: the offline line.
    private static func line(for failure: CallFailure) -> SignInFailure {
        switch failure {
        case .offline: return .offline
        case .timeout: return .server
        case let .http(status, _, _): return status >= 500 ? .server : .provider
        }
    }

    private static func randomNonce() -> String {
        var generator = SystemRandomNumberGenerator()
        return (0..<32).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max, using: &generator)) }.joined()
    }

    private static func sha256Hex(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
