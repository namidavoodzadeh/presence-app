import Contract
import Foundation
import Security

/// The signed-in session (flows/sign-in.md, "exchanging 200": store access_token, refresh_token, expires_at).
struct Session: Codable, Equatable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
}

/// Where the session is kept between launches. The app keeps it in the Keychain; tests use memory.
protocol SessionStorage: Sendable {
    func load() -> Session?
    func save(_ session: Session)
    func clear()
}

/// The session in the Keychain, this device only, readable after the first unlock (pushes and refresh in the background).
struct KeychainSessionStorage: SessionStorage {
    var service = "com.namidavoodzadeh.presence.session"
    var account = "session"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    func load() -> Session? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    func save(_ session: Session) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

/// How a refresh of the stored session ended.
enum RefreshFailure: Error, Equatable {
    /// Expired or revoked: the stored session is cleared and the person signs in again.
    case refused
    /// Offline, a timeout or a server fault: the stored access token stands until the first 401.
    case unavailable
}

/// What launching found (flows/sign-in.md, the `launching` rows).
enum LaunchSession: Equatable {
    case signedIn
    case signedOut
}

/// Holds the session: hands out a fresh access token, refreshes it near expiry, and ends it on a 401.
actor SessionKeeper {
    typealias Refresh = @Sendable (_ refreshToken: String) async throws(RefreshFailure) -> Session

    /// A token this close to its expiry is refreshed before a call.
    static let refreshMargin: TimeInterval = 60

    private let storage: any SessionStorage
    private let refresh: Refresh
    private let now: @Sendable () -> Date
    private var session: Session?
    private var onEnded: (@Sendable () -> Void)?

    init(storage: any SessionStorage, refresh: @escaping Refresh, now: @escaping @Sendable () -> Date = { Date() }) {
        self.storage = storage
        self.refresh = refresh
        self.now = now
        self.session = storage.load()
    }

    var current: Session? { session }

    /// Called when the session ends, so the root can show `signIn` (keeping any words in the bar).
    func whenEnded(_ action: @escaping @Sendable () -> Void) { onEnded = action }

    /// `exchanging 200`: keep the session.
    func start(_ session: Session) {
        self.session = session
        storage.save(session)
    }

    /// A 401, a refused refresh, or log out: clear the stored session.
    func end() {
        let hadSession = session != nil
        session = nil
        storage.clear()
        if hadSession { onEnded?() }
    }

    /// The `launching` rows: refresh the stored session, or find none.
    func launch() async -> LaunchSession {
        guard let stored = session else { return .signedOut }
        do {
            try await renew(stored)
            return .signedIn
        } catch .refused {
            return .signedOut
        } catch {
            return .signedIn
        }
    }

    /// The bearer for the next call, refreshed first when it is about to expire. Nil when signed out.
    func accessToken() async -> String? {
        guard let stored = session else { return nil }
        if stored.expiresAt.timeIntervalSince(now()) > Self.refreshMargin { return stored.accessToken }
        do {
            try await renew(stored)
        } catch {
            // Offline: the stored token stands; refused: the session has ended.
        }
        return session?.accessToken
    }

    private func renew(_ stored: Session) async throws(RefreshFailure) {
        do {
            start(try await refresh(stored.refreshToken))
        } catch .refused {
            end()
            throw .refused
        } catch {
            throw .unavailable
        }
    }
}

/// The Supabase Auth refresh (`POST /auth/v1/token?grant_type=refresh_token`), sent over the same transport as the
/// generated client so the app never names a networking type of its own.
struct SupabaseRefresh: Sendable {
    let authBase: URL
    let anonKey: String
    let transport: any ClientTransport

    private struct Reply: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_at: Double?
        let expires_in: Double?
    }

    func callAsFunction(_ refreshToken: String) async throws(RefreshFailure) -> Session {
        var request = HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/token?grant_type=refresh_token")
        request.headerFields[RequestHeaders.apikey] = anonKey
        request.headerFields[.contentType] = "application/json"
        let payload: Data
        do {
            payload = try JSONEncoder().encode(["refresh_token": refreshToken])
        } catch {
            throw .unavailable
        }
        let response: HTTPResponse
        let data: Data
        do {
            let (reply, body) = try await transport.send(request, body: HTTPBody(payload), baseURL: authBase, operationID: "supabaseRefresh")
            response = reply
            var collected = Data()
            if let body { collected = try await Data(collecting: body, upTo: 1_000_000) }
            data = collected
        } catch {
            throw .unavailable
        }
        switch response.status.code {
        case 200..<300:
            guard let reply = try? JSONDecoder().decode(Reply.self, from: data) else { throw .unavailable }
            let expiry: Date = if let at = reply.expires_at {
                Date(timeIntervalSince1970: at)
            } else {
                Date().addingTimeInterval(reply.expires_in ?? 3600)
            }
            return Session(accessToken: reply.access_token, refreshToken: reply.refresh_token, expiresAt: expiry)
        case 400, 401, 403:
            throw .refused
        default:
            throw .unavailable
        }
    }
}
