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

    /// Replaces the record in place, so a failed write leaves the previous one rather than none; adds it only when absent.
    func save(_ session: Session) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        let update: [String: Any] = [kSecValueData as String: data,
                                     kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        guard status == errSecItemNotFound else { return }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    /// Log out: the record goes. If the delete fails, its contents are overwritten with nothing first, so no credential
    /// stays readable, and the delete is tried again.
    func clear() {
        let status = SecItemDelete(query as CFDictionary)
        guard status != errSecSuccess, status != errSecItemNotFound else { return }
        SecItemUpdate(query as CFDictionary, [kSecValueData as String: Data()] as CFDictionary)
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
///
/// One refresh runs at a time for a refresh token; every caller waiting on it shares its answer. Each sign-in and each
/// ending moves `generation` on, so a refresh that started before either can neither bring back a logged-out session,
/// overwrite a newer sign-in, nor end the session that replaced it.
actor SessionKeeper {
    typealias Refresh = @Sendable (_ refreshToken: String) async throws(RefreshFailure) -> Session
    private typealias Renewal = Task<Result<Session, RefreshFailure>, Never>

    /// A token this close to its expiry is refreshed before a call.
    static let refreshMargin: TimeInterval = 60

    private let storage: any SessionStorage
    private let refresh: Refresh
    private let now: @Sendable () -> Date
    private var session: Session?
    private var onEnded: (@Sendable () -> Void)?
    private var generation = 0
    private var renewal: (refreshToken: String, task: Renewal)?

    init(storage: any SessionStorage, refresh: @escaping Refresh, now: @escaping @Sendable () -> Date = { Date() }) {
        self.storage = storage
        self.refresh = refresh
        self.now = now
        self.session = storage.load()
    }

    var current: Session? { session }

    /// Called when the session ends, so the root can show `signIn` (keeping any words in the bar).
    func whenEnded(_ action: @escaping @Sendable () -> Void) { onEnded = action }

    /// `exchanging 200`: keep the session. Any refresh still running belongs to the session before it.
    func start(_ session: Session) {
        generation += 1
        renewal = nil
        keep(session)
    }

    /// A refused refresh, or log out: clear the stored session.
    func end() {
        generation += 1
        renewal = nil
        let hadSession = session != nil
        session = nil
        storage.clear()
        if hadSession { onEnded?() }
    }

    /// A 401: ends the session only if it is still the one whose token the call carried. A late 401 from a call made
    /// before a refresh or a new sign-in leaves the newer session alone.
    func end(ifAccessToken token: String?) {
        guard let token, session?.accessToken == token else { return }
        end()
    }

    /// The `launching` rows: refresh the stored session, or find none.
    func launch() async -> LaunchSession {
        guard let stored = session else { return .signedOut }
        do throws(RefreshFailure) {
            try await renew(stored)
        } catch .refused {
            return .signedOut
        } catch {
            // Offline or a server fault: the stored token stands until the first 401.
        }
        return session == nil ? .signedOut : .signedIn
    }

    /// The bearer for the next call, refreshed first when it is about to expire. Nil when signed out.
    func accessToken() async -> String? {
        guard let stored = session else { return nil }
        if stored.expiresAt.timeIntervalSince(now()) > Self.refreshMargin { return stored.accessToken }
        do throws(RefreshFailure) {
            try await renew(stored)
        } catch {
            // Offline: the stored token stands; refused: the session has ended.
        }
        return session?.accessToken
    }

    private func keep(_ session: Session) {
        self.session = session
        storage.save(session)
    }

    private func renew(_ stored: Session) async throws(RefreshFailure) {
        let started = generation
        let token = stored.refreshToken
        let task: Renewal
        if let running = renewal, running.refreshToken == token {
            task = running.task
        } else {
            let refresh = self.refresh
            task = Renewal {
                do throws(RefreshFailure) {
                    return .success(try await refresh(token))
                } catch {
                    return .failure(error)
                }
            }
            renewal = (token, task)
        }
        let result = await task.value
        if renewal?.refreshToken == token { renewal = nil }
        // Signed in again or ended while this ran: the answer belongs to a session that is gone.
        guard generation == started else { return }
        // Another caller sharing this refresh has already applied it.
        guard session?.refreshToken == token else { return }
        switch result {
        case let .success(renewed):
            keep(renewed)
        case .failure(.refused):
            end()
            throw .refused
        case .failure(.unavailable):
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
