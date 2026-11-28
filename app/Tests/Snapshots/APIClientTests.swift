import Contract
import Flows
import Foundation
import XCTest
@testable import Presence

/// #108: the header builder, reading the configuration, and a round trip through a fake URLProtocol.
final class APIClientTests: XCTestCase {
    private let configuration = AppConfiguration(
        apiBase: URL(string: "https://example.supabase.co/functions/v1/api")!,
        anonKey: "anon-123",
        clientVersion: "ios/0.9+7"
    )
    private let tehran = TimeZone(identifier: "Asia/Tehran")!

    override func tearDown() {
        FakeServer.reset()
        super.tearDown()
    }

    // MARK: Header builder

    func testHeadersCarryEverythingContractSectionZeroRequires() {
        let fields = RequestHeaders(anonKey: "anon-123", client: "ios/0.9+7").fields(accessToken: "jwt", timeZone: tehran)
        XCTAssertEqual(fields[.authorization], "Bearer jwt")
        XCTAssertEqual(fields[HTTPField.Name("apikey")!], "anon-123")
        XCTAssertEqual(fields[.contentType], "application/json")
        XCTAssertEqual(fields[HTTPField.Name("X-Presence-Client")!], "ios/0.9+7")
        XCTAssertEqual(fields[HTTPField.Name("X-Presence-TZ")!], "Asia/Tehran")
    }

    func testNoAuthorizationWithoutASession() {
        let fields = RequestHeaders(anonKey: "anon-123", client: "ios/0.9+7").fields(accessToken: nil, timeZone: tehran)
        XCTAssertNil(fields[.authorization])
        XCTAssertEqual(fields[HTTPField.Name("apikey")!], "anon-123")
    }

    func testABodysOwnContentTypeIsKept() {
        var request = HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/auth/apple")
        request.headerFields[.contentType] = "application/json; charset=utf-8"
        RequestHeaders(anonKey: "a", client: "c").apply(to: &request, accessToken: nil, timeZone: tehran)
        XCTAssertEqual(request.headerFields[.contentType], "application/json; charset=utf-8")
    }

    // MARK: Configuration

    func testConfigurationReadsTheBuildSettings() throws {
        let config = try AppConfiguration(info: [
            "PresenceAPIBase": "https://hqtbaphcfwoaxeikytck.supabase.co/functions/v1/api",
            "SupabaseAnonKey": "anon",
            "CFBundleShortVersionString": "0.9",
            "CFBundleVersion": "142",
        ])
        XCTAssertEqual(config.apiBase.absoluteString, "https://hqtbaphcfwoaxeikytck.supabase.co/functions/v1/api")
        XCTAssertEqual(config.anonKey, "anon")
        XCTAssertEqual(config.clientVersion, "ios/0.9+142")
        XCTAssertEqual(config.authBase.absoluteString, "https://hqtbaphcfwoaxeikytck.supabase.co/auth/v1")
    }

    func testAnUnsetBuildSettingIsMissingNeverAValue() {
        XCTAssertThrowsError(try AppConfiguration(info: ["PresenceAPIBase": "", "SupabaseAnonKey": "anon"])) {
            XCTAssertEqual($0 as? AppConfiguration.Problem, .missing("PresenceAPIBase"))
        }
        XCTAssertThrowsError(try AppConfiguration(info: ["PresenceAPIBase": "https://x.co", "SupabaseAnonKey": "$(SUPABASE_ANON_KEY)"])) {
            XCTAssertEqual($0 as? AppConfiguration.Problem, .missing("SupabaseAnonKey"))
        }
        XCTAssertThrowsError(try AppConfiguration(info: ["PresenceAPIBase": "not a url", "SupabaseAnonKey": "anon"])) {
            XCTAssertEqual($0 as? AppConfiguration.Problem, .invalidURL("not a url"))
        }
    }

    func testTheDebugBuildCarriesTheFixtureNeverProduction() throws {
        let config = try AppConfiguration.fromBundle()
        XCTAssertEqual(config.apiBase.absoluteString, "http://127.0.0.1:8821")
        XCTAssertEqual(config.anonKey, "fixture-anon-key")
    }

    // MARK: Round trip through a fake URLProtocol

    private func makeClient(storage: MemoryStorage, now: Date = Date()) -> APIClient {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [FakeServer.self]
        return APIClient(
            configuration: configuration,
            transport: HTTPTransport(configuration: sessionConfiguration),
            storage: storage,
            timeZone: { TimeZone(identifier: "Asia/Tehran")! },
            now: { now }
        )
    }

    func testSignInKeepsTheSessionAndLaterCallsCarryItsToken() async throws {
        FakeServer.answer { request in
            switch request.url?.path {
            case "/functions/v1/api/auth/apple":
                return (200, #"{"access_token":"jwt-1","refresh_token":"r-1","expires_at":"2030-01-01T00:00:00.000Z","created":true,"me":{"person":{"id":"p1","name":"Ava","initial":"A","color":"teal","deleted":false}}}"#)
            default:
                return (200, #"{"order":"Hi","people":[]}"#)
            }
        }
        let storage = MemoryStorage()
        let api = makeClient(storage: storage)

        let signedIn = await api.signInWithApple(identityToken: "id-token", nonce: "nonce", name: "Ava", authorizationCode: nil, adultConfirmed: true)
        XCTAssertEqual(try signedIn.get().me.person.id, "p1")
        XCTAssertEqual(storage.load()?.accessToken, "jwt-1")

        let signIn = try XCTUnwrap(FakeServer.requests.first)
        XCTAssertEqual(signIn.httpMethod, "POST")
        XCTAssertNil(signIn.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(signIn.value(forHTTPHeaderField: "apikey"), "anon-123")
        XCTAssertEqual(signIn.value(forHTTPHeaderField: "X-Presence-Client"), "ios/0.9+7")
        XCTAssertEqual(signIn.value(forHTTPHeaderField: "X-Presence-TZ"), "Asia/Tehran")
        let body = try XCTUnwrap(FakeServer.bodies.first)
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(sent["identity_token"] as? String, "id-token")
        XCTAssertEqual(sent["adult_confirmed"] as? Bool, true)

        _ = try await api.client.getHome()
        let home = try XCTUnwrap(FakeServer.requests.last)
        XCTAssertEqual(home.url?.absoluteString, "https://example.supabase.co/functions/v1/api/home")
        XCTAssertEqual(home.value(forHTTPHeaderField: "Authorization"), "Bearer jwt-1")
        XCTAssertEqual(home.value(forHTTPHeaderField: "Content-Type"), "application/json")
    }

    func testA401EndsTheSession() async throws {
        FakeServer.answer { _ in (401, #"{"error":"unauthorized","ref":"7F3K"}"#) }
        let storage = MemoryStorage(Session(accessToken: "jwt", refreshToken: "r", expiresAt: .distantFuture))
        let api = makeClient(storage: storage)

        let output = try await api.client.getHome()
        guard case let .default(status, _) = output else { return XCTFail("expected the error reply") }
        XCTAssertEqual(status, 401)
        XCTAssertNil(storage.load())
        let current = await api.session.current
        XCTAssertNil(current)
    }

    func testARefusedSignInDoesNotCountAsASessionEnding() async {
        FakeServer.answer { _ in (401, #"{"error":"unauthorized","ref":"7F3K","message":"Apple couldn't verify this sign-in."}"#) }
        let api = makeClient(storage: MemoryStorage())
        let result = await api.signInWithApple(identityToken: "bad", nonce: "n", name: nil, authorizationCode: nil, adultConfirmed: true)
        XCTAssertEqual(result.failure, .http(status: 401, error: "unauthorized"))
    }

    func testAnExpiringTokenIsRefreshedThroughSupabaseAuthFirst() async throws {
        FakeServer.answer { request in
            if request.url?.path == "/auth/v1/token" {
                return (200, #"{"access_token":"jwt-2","refresh_token":"r-2","expires_at":1893456000,"expires_in":3600}"#)
            }
            return (200, #"{"order":"Hi","people":[]}"#)
        }
        let now = Date()
        let storage = MemoryStorage(Session(accessToken: "jwt-1", refreshToken: "r-1", expiresAt: now.addingTimeInterval(10)))
        let api = makeClient(storage: storage, now: now)

        _ = try await api.client.getHome()
        let refresh = try XCTUnwrap(FakeServer.requests.first)
        XCTAssertEqual(refresh.url?.absoluteString, "https://example.supabase.co/auth/v1/token?grant_type=refresh_token")
        XCTAssertEqual(refresh.value(forHTTPHeaderField: "apikey"), "anon-123")
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(FakeServer.bodies.first)) as? [String: String])
        XCTAssertEqual(sent, ["refresh_token": "r-1"])
        XCTAssertEqual(FakeServer.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer jwt-2")
        XCTAssertEqual(storage.load()?.refreshToken, "r-2")
    }

    func testLaunchingWithARevokedSessionSignsOut() async {
        FakeServer.answer { _ in (400, #"{"error":"invalid_grant"}"#) }
        let storage = MemoryStorage(Session(accessToken: "jwt", refreshToken: "revoked", expiresAt: .distantFuture))
        let launched = await makeClient(storage: storage).session.launch()
        XCTAssertEqual(launched, .signedOut)
        XCTAssertNil(storage.load())
    }

    func testLaunchingOfflineKeepsTheStoredToken() async {
        FakeServer.fail(with: URLError(.notConnectedToInternet))
        let storage = MemoryStorage(Session(accessToken: "jwt", refreshToken: "r", expiresAt: .distantFuture))
        let launched = await makeClient(storage: storage).session.launch()
        XCTAssertEqual(launched, .signedIn)
        XCTAssertEqual(storage.load()?.accessToken, "jwt")
    }

    func testAThrownCallIsOfflineOrATimeout() {
        XCTAssertEqual(APIClient.failure(for: URLError(.notConnectedToInternet)), .offline)
        XCTAssertEqual(APIClient.failure(for: URLError(.timedOut)), .timeout)
    }

    // MARK: Review round 1 of PR #110

    func testWithoutTheAdultConfirmationNothingIsSent() async {
        FakeServer.answer { _ in (200, "{}") }
        let api = makeClient(storage: MemoryStorage())
        let result = await api.signInWithApple(identityToken: "id", nonce: "n", name: nil, authorizationCode: nil, adultConfirmed: false)
        XCTAssertEqual(result.failure, APIClient.adultConfirmationMissing)
        XCTAssertTrue(FakeServer.requests.isEmpty)
    }

    func testConcurrentCallsShareOneRefresh() async {
        let counter = RefreshCounter()
        let now = Date()
        let keeper = SessionKeeper(
            storage: MemoryStorage(Session(accessToken: "a-1", refreshToken: "r-1", expiresAt: now.addingTimeInterval(5))),
            refresh: { _ throws(RefreshFailure) in
                await counter.tick()
                try? await Task.sleep(nanoseconds: 50_000_000)
                return Session(accessToken: "a-2", refreshToken: "r-2", expiresAt: now.addingTimeInterval(3600))
            },
            now: { now }
        )
        async let first = keeper.accessToken()
        async let second = keeper.accessToken()
        let one = await first
        let two = await second
        XCTAssertEqual(one, "a-2")
        XCTAssertEqual(two, "a-2")
        let calls = await counter.count
        XCTAssertEqual(calls, 1)
    }

    func testALateRefreshDoesNotBringBackALoggedOutSession() async {
        let gate = RefreshGate()
        let now = Date()
        let storage = MemoryStorage(Session(accessToken: "a-1", refreshToken: "r-1", expiresAt: now.addingTimeInterval(5)))
        let keeper = SessionKeeper(
            storage: storage,
            refresh: { _ throws(RefreshFailure) in
                await gate.wait()
                return Session(accessToken: "a-2", refreshToken: "r-2", expiresAt: now.addingTimeInterval(3600))
            },
            now: { now }
        )
        let pending = Task { await keeper.accessToken() }
        await gate.waitUntilStarted()
        await keeper.end()
        await gate.open()
        let token = await pending.value
        XCTAssertNil(token)
        XCTAssertNil(storage.load())
    }

    func testALateRefreshDoesNotOverwriteANewerSignIn() async {
        let gate = RefreshGate()
        let now = Date()
        let keeper = SessionKeeper(
            storage: MemoryStorage(Session(accessToken: "a-1", refreshToken: "r-1", expiresAt: now.addingTimeInterval(5))),
            refresh: { _ throws(RefreshFailure) in
                await gate.wait()
                throw .refused
            },
            now: { now }
        )
        let pending = Task { await keeper.accessToken() }
        await gate.waitUntilStarted()
        let newer = Session(accessToken: "b-1", refreshToken: "s-1", expiresAt: now.addingTimeInterval(3600))
        await keeper.start(newer)
        await gate.open()
        _ = await pending.value
        let current = await keeper.current
        XCTAssertEqual(current, newer)
    }

    func testACallWaitingOnARefreshDoesNotCarryTheNextPersonsToken() async {
        let gate = RefreshGate()
        let now = Date()
        let keeper = SessionKeeper(
            storage: MemoryStorage(Session(accessToken: "a-1", refreshToken: "r-1", expiresAt: now.addingTimeInterval(5))),
            refresh: { _ throws(RefreshFailure) in
                await gate.wait()
                return Session(accessToken: "a-2", refreshToken: "r-2", expiresAt: now.addingTimeInterval(3600))
            },
            now: { now }
        )
        let pending = Task { await keeper.accessToken() }
        await gate.waitUntilStarted()
        await keeper.start(Session(accessToken: "b-1", refreshToken: "s-1", expiresAt: now.addingTimeInterval(3600)))
        await gate.open()
        let token = await pending.value
        XCTAssertNil(token)
    }

    func testALateSignInReplyIsNotKeptAfterLogOut() async {
        let keeper = SessionKeeper(storage: MemoryStorage(), refresh: { _ throws(RefreshFailure) in throw .unavailable })
        let started = await keeper.beginSignIn()
        await keeper.logOut()
        let kept = await keeper.start(Session(accessToken: "a", refreshToken: "r", expiresAt: .distantFuture), ifSignIn: started)
        XCTAssertFalse(kept)
        let current = await keeper.current
        XCTAssertNil(current)
    }

    func testStartingASignInDoesNotSpendTheSameRefreshTokenTwice() async {
        let gate = RefreshGate()
        let counter = RefreshCounter()
        let now = Date()
        let keeper = SessionKeeper(
            storage: MemoryStorage(Session(accessToken: "a-1", refreshToken: "r-1", expiresAt: now.addingTimeInterval(5))),
            refresh: { _ throws(RefreshFailure) in
                await counter.tick()
                await gate.wait()
                return Session(accessToken: "a-2", refreshToken: "r-2", expiresAt: now.addingTimeInterval(3600))
            },
            now: { now }
        )
        let first = Task { await keeper.accessToken() }
        await gate.waitUntilStarted()
        _ = await keeper.beginSignIn()
        let second = Task { await keeper.accessToken() }
        // Let the second call reach the keeper while the first refresh is still held (it then shares that refresh).
        try? await Task.sleep(nanoseconds: 100_000_000)
        await gate.open()
        _ = await first.value
        _ = await second.value
        let calls = await counter.count
        XCTAssertEqual(calls, 1)
    }

    func testA401FromThePreviousAccountDoesNotVoidASignIn() async {
        let keeper = SessionKeeper(
            storage: MemoryStorage(Session(accessToken: "old", refreshToken: "r", expiresAt: .distantFuture)),
            refresh: { _ throws(RefreshFailure) in throw .unavailable }
        )
        let ticket = await keeper.beginSignIn()
        await keeper.end(ifAccessToken: "old")
        let kept = await keeper.start(Session(accessToken: "new", refreshToken: "s", expiresAt: .distantFuture), ifSignIn: ticket)
        XCTAssertTrue(kept)
        let current = await keeper.current
        XCTAssertEqual(current?.accessToken, "new")
    }

    func testAFailedSignInLeavesTheRefreshedSessionInPlace() async {
        let gate = RefreshGate()
        let now = Date()
        let keeper = SessionKeeper(
            storage: MemoryStorage(Session(accessToken: "a-1", refreshToken: "r-1", expiresAt: now.addingTimeInterval(5))),
            refresh: { _ throws(RefreshFailure) in
                await gate.wait()
                return Session(accessToken: "a-2", refreshToken: "r-2", expiresAt: now.addingTimeInterval(3600))
            },
            now: { now }
        )
        let pending = Task { await keeper.accessToken() }
        await gate.waitUntilStarted()
        _ = await keeper.beginSignIn()   // the sign-in then fails: nothing is started
        await gate.open()
        let token = await pending.value
        XCTAssertEqual(token, "a-2")
        let current = await keeper.current
        XCTAssertEqual(current?.refreshToken, "r-2")
    }

    func testOfOverlappingSignInsTheNewerOneStands() async {
        let keeper = SessionKeeper(storage: MemoryStorage(), refresh: { _ throws(RefreshFailure) in throw .unavailable })
        let older = await keeper.beginSignIn()
        let newer = await keeper.beginSignIn()
        let olderKept = await keeper.start(Session(accessToken: "old", refreshToken: "r", expiresAt: .distantFuture), ifSignIn: older)
        let newerKept = await keeper.start(Session(accessToken: "new", refreshToken: "s", expiresAt: .distantFuture), ifSignIn: newer)
        XCTAssertFalse(olderKept)
        XCTAssertTrue(newerKept)
        let current = await keeper.current
        XCTAssertEqual(current?.accessToken, "new")
    }

    func testAFailedWriteDoesNotLeaveThePreviousAccountOnDisk() async {
        let storage = FlakyStorage()
        let keeper = SessionKeeper(storage: storage, refresh: { _ throws(RefreshFailure) in throw .unavailable })
        await keeper.start(Session(accessToken: "account-a", refreshToken: "r", expiresAt: .distantFuture))
        storage.failNextSave = true
        await keeper.start(Session(accessToken: "account-b", refreshToken: "s", expiresAt: .distantFuture))
        XCTAssertNil(storage.load())
        let current = await keeper.current
        XCTAssertEqual(current?.accessToken, "account-b")
    }

    func testAnUnsavedSessionIsWrittenBeforeTheNextCall() async {
        let storage = FlakyStorage()
        let keeper = SessionKeeper(storage: storage, refresh: { _ throws(RefreshFailure) in throw .unavailable })
        storage.failNextSave = true
        await keeper.start(Session(accessToken: "a", refreshToken: "r", expiresAt: .distantFuture))
        XCTAssertNil(storage.load())
        _ = await keeper.accessToken()
        XCTAssertEqual(storage.load()?.accessToken, "a")
    }

    func testA401FromAnOlderTokenLeavesTheNewerSessionAlone() async {
        let keeper = SessionKeeper(
            storage: MemoryStorage(Session(accessToken: "b-1", refreshToken: "s-1", expiresAt: .distantFuture)),
            refresh: { _ throws(RefreshFailure) in throw .unavailable }
        )
        await keeper.end(ifAccessToken: "a-1")
        let kept = await keeper.current
        XCTAssertEqual(kept?.accessToken, "b-1")
        await keeper.end(ifAccessToken: "b-1")
        let ended = await keeper.current
        XCTAssertNil(ended)
    }

    func testTheKeychainReplacesTheSessionInPlace() {
        let keychain = KeychainSessionStorage(service: "com.namidavoodzadeh.presence.tests", account: UUID().uuidString)
        let first = Session(accessToken: "a", refreshToken: "r", expiresAt: Date(timeIntervalSince1970: 1_893_456_000))
        let second = Session(accessToken: "b", refreshToken: "s", expiresAt: Date(timeIntervalSince1970: 1_893_459_600))
        XCTAssertTrue(keychain.save(first))
        XCTAssertTrue(keychain.save(second))
        XCTAssertEqual(keychain.load(), second)
        keychain.clear()
        XCTAssertNil(keychain.load())
    }

    func testTheKeychainKeepsTheSession() {
        let keychain = KeychainSessionStorage(service: "com.namidavoodzadeh.presence.tests", account: UUID().uuidString)
        let session = Session(accessToken: "a", refreshToken: "r", expiresAt: Date(timeIntervalSince1970: 1_893_456_000))
        keychain.save(session)
        XCTAssertEqual(keychain.load(), session)
        keychain.clear()
        XCTAssertNil(keychain.load())
    }
}

private extension Result {
    var failure: Failure? {
        if case let .failure(failure) = self { return failure }
        return nil
    }
}

private actor RefreshCounter {
    private(set) var count = 0
    func tick() { count += 1 }
}

/// Holds a refresh mid-flight until the test opens it.
private actor RefreshGate {
    private var started = false
    private var isOpen = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private var openWaiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        started = true
        startWaiters.forEach { $0.resume() }
        startWaiters = []
        if isOpen { return }
        await withCheckedContinuation { openWaiters.append($0) }
    }

    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }

    func open() {
        isOpen = true
        openWaiters.forEach { $0.resume() }
        openWaiters = []
    }
}

private final class FlakyStorage: SessionStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var session: Session?
    var failNextSave = false
    func load() -> Session? { lock.withLock { session } }
    func save(_ session: Session) -> Bool {
        lock.withLock {
            if failNextSave { failNextSave = false; return false }
            self.session = session
            return true
        }
    }
    func clear() -> Bool { lock.withLock { session = nil }; return true }
}

private final class MemoryStorage: SessionStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var session: Session?
    init(_ session: Session? = nil) { self.session = session }
    func load() -> Session? { lock.withLock { session } }
    func save(_ session: Session) -> Bool { lock.withLock { self.session = session }; return true }
    func clear() -> Bool { lock.withLock { session = nil }; return true }
}

/// A server inside URLSession: records each request and its body, and answers from the test's handler.
final class FakeServer: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) -> (Int, String)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: Handler?
    nonisolated(unsafe) private static var thrown: (any Error)?
    nonisolated(unsafe) private static var recorded: [(URLRequest, Data)] = []

    static var requests: [URLRequest] { lock.withLock { recorded.map(\.0) } }
    static var bodies: [Data] { lock.withLock { recorded.map(\.1) } }

    static func answer(_ handler: @escaping Handler) { lock.withLock { self.handler = handler; thrown = nil } }
    static func fail(with error: any Error) { lock.withLock { thrown = error; handler = nil } }
    static func reset() { lock.withLock { handler = nil; thrown = nil; recorded = [] } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body = Self.readBody(request)
        let (handler, thrown) = Self.lock.withLock {
            Self.recorded.append((request, body))
            return (Self.handler, Self.thrown)
        }
        if let thrown {
            client?.urlProtocol(self, didFailWithError: thrown)
            return
        }
        let (status, json) = handler?(request) ?? (500, #"{"error":"internal","ref":"TEST"}"#)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func readBody(_ request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
