import Contract
import CryptoKit
import Flows
import Foundation
import XCTest
@testable import Presence

/// #128: each host makes every call its flow asks for once, on the right route with the right body, and the answer
/// reaches the flow. Written in the builder's session (owner approval, #95); an independent test pass follows.
@MainActor
final class HostTests: XCTestCase {
    private let configuration = AppConfiguration(
        apiBase: URL(string: "https://example.supabase.co/functions/v1/api")!,
        anonKey: "anon-123",
        clientVersion: "ios/0.9+7"
    )

    private let person = #"{"id":"p-ava","name":"Ava Stone","initial":"A","color":"teal","deleted":false}"#

    private func context(_ transport: RecordingTransport, session: Session? = nil) -> HostContext {
        let api = APIClient(configuration: configuration, transport: transport, storage: MemorySessionStorage(session))
        let defaults = UserDefaults(suiteName: "presence.hosttests.\(UUID().uuidString)")!
        let context = HostContext(api: api, defaults: defaults)
        context.open = { _ in }
        context.haptic = { _ in }
        return context
    }

    private static let signedIn = Session(accessToken: "jwt", refreshToken: "r", expiresAt: .distantFuture)

    private func stubProvider(_ nonces: NonceBox = NonceBox()) -> SignInProvider {
        SignInProvider(
            ageRange: { _ in .notDeclared },
            apple: { sha in
                nonces.sha = sha
                return .credential(SignInFlow.AppleCredential(identityToken: "id-token", authorizationCode: "code-1", name: "Ava Stone"))
            }
        )
    }

    private var authReply: String {
        #"{"access_token":"jwt-1","refresh_token":"r-1","expires_at":"2099-01-01T00:00:00.000Z","created":true,"me":{"person":\#(person)}}"#
    }

    private var meReply: String {
        #"{"me":{"person":\#(person)},"plan":{"active":true,"source":"own","partner_name":null}}"#
    }

    private let refreshReply = #"{"access_token":"jwt-2","refresh_token":"r-2","expires_at":4070908800}"#

    private func turnReply(question: String = "What's still with you?", item: String = "null", itemState: String = "null") -> String {
        #"{"conversation":{"id":"c-1","status":"open","session_number":1},"message":null,"reply":{"state":"ask","reflection":"","question":"\#(question)","comm":null,"item":\#(item),"item_state":\#(itemState)},"latency_ms":3}"#
    }

    // MARK: Sign in

    func testASignedOutLaunchShowsSignInAndCallsNothing() async {
        let transport = RecordingTransport()
        let host = SignInHost(context: context(transport), provider: stubProvider())
        await host.start()
        await host.tasks.settle()
        XCTAssertEqual(host.flow.state, .signedOut)
        XCTAssertTrue(host.showsSignIn)
        XCTAssertTrue(transport.calls.isEmpty)
    }

    func testSignInWithAppleExchangesOnceThenReadsMeAndOpensTalk() async throws {
        let transport = RecordingTransport([
            Operations.signInWithApple.id: (200, authReply),
            Operations.getMe.id: (200, meReply),
        ])
        let context = context(transport)
        let nonces = NonceBox()
        let host = SignInHost(context: context, provider: stubProvider(nonces))
        await host.start()
        host.send(.appleTapped)
        await host.tasks.settle()

        XCTAssertEqual(transport.calls.map(\.operationID), [Operations.signInWithApple.id, Operations.getMe.id])
        let exchange = transport.calls[0]
        XCTAssertEqual(exchange.method, .post)
        XCTAssertEqual(exchange.path, "/auth/apple")
        let body = try exchange.json()
        let nonce = try XCTUnwrap(body["nonce"] as? String)
        XCTAssertEqual(nonces.sha, SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined(),
                       "Apple's sheet got the SHA-256 of the nonce the server receives")
        XCTAssertEqual(body["identity_token"] as? String, "id-token")
        XCTAssertEqual(body["authorization_code"] as? String, "code-1")
        XCTAssertEqual(body["name"] as? String, "Ava Stone")
        XCTAssertEqual(body["adult_confirmed"] as? Bool, true)
        XCTAssertEqual(transport.calls[1].method, .get)
        XCTAssertEqual(transport.calls[1].path, "/me")

        XCTAssertEqual(host.flow.state, .opened(.talk))
        XCTAssertEqual(context.firstName, "Ava")
        let kept = await context.api.session.current
        XCTAssertEqual(kept?.accessToken, "jwt-1")
    }

    func testAFailedExchangeShowsTheProviderLine() async {
        let transport = RecordingTransport([Operations.signInWithApple.id: (401, #"{"error":"unauthorized","ref":"R1"}"#)])
        let host = SignInHost(context: context(transport), provider: stubProvider())
        await host.start()
        host.send(.appleTapped)
        await host.tasks.settle()
        XCTAssertEqual(transport.calls.map(\.operationID), [Operations.signInWithApple.id])
        XCTAssertEqual(host.flow.state, .signInFailed(.provider))
    }

    func testAStoredSessionRefreshesThenRoutesWithoutShowingSignIn() async {
        let transport = RecordingTransport(["supabaseRefresh": (200, refreshReply), Operations.getMe.id: (200, meReply)])
        let host = SignInHost(context: context(transport, session: Self.signedIn), provider: stubProvider())
        await host.start()
        XCTAssertFalse(host.showsSignIn, "a resumed session routes behind the greenhouse")
        await host.tasks.settle()
        XCTAssertEqual(transport.calls.map(\.operationID), ["supabaseRefresh", Operations.getMe.id])
        XCTAssertEqual(host.flow.state, .opened(.talk))
    }

    func testARefusedRefreshSignsOut() async {
        let transport = RecordingTransport(["supabaseRefresh": (400, #"{"error":"invalid_grant"}"#)])
        let host = SignInHost(context: context(transport, session: Self.signedIn), provider: stubProvider())
        await host.start()
        await host.tasks.settle()
        XCTAssertEqual(host.flow.state, .signedOut)
        XCTAssertTrue(host.showsSignIn)
    }

    // MARK: The root

    func testTheRootOpensTheSurfaceAndASessionEndingReturnsToSignInKeepingTheBarsWords() async throws {
        let transport = RecordingTransport([
            "supabaseRefresh": (200, refreshReply),
            Operations.getMe.id: (200, meReply),
            Operations.signInWithApple.id: (200, authReply),
            Operations.getHome.id: (200, #"{"order":"","people":[]}"#),
            Operations.commTalkTurn.id: (200, turnReply()),
        ])
        let context = context(transport, session: Self.signedIn)
        let root = AppRoot(context: context, provider: stubProvider())
        await root.start()
        await root.signIn.tasks.settle()
        XCTAssertEqual(root.screen, .surface)
        let surface = try XCTUnwrap(root.surface)
        surface.model.send(.typed("I was hurt"))

        await context.api.session.logOut()
        try await waitFor { root.restarting != nil }
        await root.restarting?.value
        XCTAssertEqual(root.screen, .signIn)
        XCTAssertNil(root.surface)

        root.signIn.send(.appleTapped)
        await root.signIn.tasks.settle()
        XCTAssertEqual(root.screen, .surface)
        XCTAssertEqual(root.surface?.model.flow.words, "I was hurt", "the words in the bar came back")
    }

    func testA401OnMeEndsTheSessionAndShowsSignIn() async throws {
        let transport = RecordingTransport([
            "supabaseRefresh": (200, refreshReply),
            Operations.getMe.id: (401, #"{"error":"unauthorized","ref":"R2"}"#),
        ])
        let context = context(transport, session: Self.signedIn)
        let root = AppRoot(context: context, provider: stubProvider())
        await root.start()
        await root.signIn.tasks.settle()
        try await waitFor { root.restarting != nil }
        await root.restarting?.value
        XCTAssertEqual(root.screen, .signIn)
        let current = await context.api.session.current
        XCTAssertNil(current)
    }

    // MARK: Talk

    func testTalkOpensWithHomeAndOneOpenerTurn() async throws {
        let home = #"{"order":"","people":[{"person":\#(person),"reasons":[],"unread":1,"draft":false,"activity_at":null}]}"#
        let transport = RecordingTransport([
            Operations.getHome.id: (200, home),
            Operations.commTalkTurn.id: (200, turnReply()),
        ])
        let talk = TalkHost(context: context(transport, session: Self.signedIn))
        talk.enter()
        await talk.tasks.settle()

        XCTAssertEqual(transport.calls.map(\.operationID).sorted(), [Operations.commTalkTurn.id, Operations.getHome.id].sorted())
        let turn = try XCTUnwrap(transport.calls.first { $0.operationID == Operations.commTalkTurn.id })
        XCTAssertEqual(turn.path, "/comm/talk/turn")
        let body = try turn.json()
        XCTAssertNil(body["text"], "the opener carries no text")
        XCTAssertEqual(body["way_in"] as? String, "own_download")
        XCTAssertEqual(talk.flow.turns, [.reply(reflection: nil, question: "What's still with you?")])
        XCTAssertEqual(talk.flow.state, .ready)
        XCTAssertEqual(talk.flow.cardsFrom, ["Ava Stone"])
        XCTAssertEqual(talk.flow.conversationId, "c-1")
    }

    func testWordsSaidToTalkPostOneTurnInTheConversation() async throws {
        let transport = RecordingTransport([
            Operations.getHome.id: (200, #"{"order":"","people":[]}"#),
            Operations.commTalkTurn.id: (200, turnReply()),
        ])
        let talk = TalkHost(context: context(transport, session: Self.signedIn))
        talk.enter()
        await talk.tasks.settle()
        let accepted = await talk.say("I was hurt")
        XCTAssertTrue(accepted)
        let turns = transport.calls.filter { $0.operationID == Operations.commTalkTurn.id }
        XCTAssertEqual(turns.count, 2)
        let body = try turns[1].json()
        XCTAssertEqual(body["text"] as? String, "I was hurt")
        XCTAssertEqual(body["conversation_id"] as? String, "c-1")
        XCTAssertEqual(talk.flow.turns.count, 3)
        XCTAssertEqual(talk.flow.state, .ready)
    }

    func testThatsMeKeepsTheOfferedItemWithItsScope() async throws {
        let item = #"{"kind":"how_i_mean","wording":"When I go quiet, I'm thinking."}"#
        let created = #"{"item":{"id":"b-1","kind":"how_i_mean","wording":"When I go quiet, I'm thinking.","scope":{"type":"everyone","value":null},"when":null,"expires_at":null,"last_confirmed_at":null,"status":"active","topic":null,"still_true_due":false,"source":"talk_said","dated_at":"2026-11-28T00:00:00.000Z"},"state":"created"}"#
        let transport = RecordingTransport([
            Operations.getHome.id: (200, #"{"order":"","people":[]}"#),
            Operations.commTalkTurn.id: (200, turnReply(item: item, itemState: #""offered""#)),
            Operations.getPeople.id: (200, #"{"people":[]}"#),
            Operations.addCommItem.id: (201, created),
        ])
        let talk = TalkHost(context: context(transport, session: Self.signedIn))
        talk.enter()
        await talk.tasks.settle()
        XCTAssertEqual(talk.flow.state, .suggesting)

        talk.send(.thatsMeTapped)
        await talk.tasks.settle()
        XCTAssertEqual(transport.calls.filter { $0.operationID == Operations.getPeople.id }.count, 1)
        talk.send(.scopeWordTapped(.everyone))
        talk.send(.doneTapped)
        await talk.tasks.settle()

        let keeps = transport.calls.filter { $0.operationID == Operations.addCommItem.id }
        XCTAssertEqual(keeps.count, 1)
        XCTAssertEqual(keeps[0].path, "/comm/items")
        let body = try keeps[0].json()
        XCTAssertEqual(body["kind"] as? String, "how_i_mean")
        XCTAssertEqual(body["wording"] as? String, "When I go quiet, I'm thinking.")
        XCTAssertEqual(body["source"] as? String, "talk_said")
        XCTAssertEqual((body["scope"] as? [String: Any])?["type"] as? String, "everyone")
        XCTAssertEqual(talk.notice, .kept(TalkFlow.KeptReport(partlyFailed: false, notSharedWith: [])))
        XCTAssertEqual(talk.flow.state, .ready)
    }

    func testA401OnATurnEndsTheSession() async {
        let transport = RecordingTransport([
            Operations.getHome.id: (200, #"{"order":"","people":[]}"#),
            Operations.commTalkTurn.id: (401, #"{"error":"unauthorized","ref":"R3"}"#),
        ])
        let context = context(transport, session: Self.signedIn)
        let talk = TalkHost(context: context)
        talk.enter()
        await talk.tasks.settle()
        XCTAssertEqual(talk.flow.state, .sessionEnded)
        let current = await context.api.session.current
        XCTAssertNil(current)
    }

    // MARK: You

    func testYouLoadsTheListAndAKenningMakesBothCallsOnce() async throws {
        let items = #"{"this_week":[],"groups":[{"kind":"how_i_mean","heading":"How I mean things","starter":"","items":[{"id":"b1","kind":"how_i_mean","wording":"Quiet means thinking.","scope":{"type":"everyone","value":null},"when":null,"expires_at":null,"last_confirmed_at":null,"status":"active","topic":null,"still_true_due":false,"source":"talk_said","dated_at":"2026-11-28T00:00:00.000Z"}]}]}"#
        let belief = #"{"belief":{"belief_id":"b1","statement":"Quiet means thinking.","own_wording":null,"rating":null,"status":"active"},"receipts":[{"quote":"I go quiet","said_at":"2026-11-27T10:00:00.000Z"}]}"#
        let visibility = #"{"item_id":"b1","scope":{"type":"everyone","value":null},"people":[{"person_id":"p-jan","name":"Jan","sees":true},{"person_id":"p-ben","name":"Ben","sees":false}]}"#
        let transport = RecordingTransport([
            Operations.getCommItems.id: (200, items),
            Operations.getBelief.id: (200, belief),
            Operations.getCommItemVisibility.id: (200, visibility),
        ])
        let you = YouHost(context: context(transport, session: Self.signedIn))
        you.send(.appeared)
        await you.tasks.settle()
        let item = YouFlow.Item(id: "b1", kind: "how_i_mean", wording: "Quiet means thinking.")
        XCTAssertEqual(you.flow.list, .loaded([YouFlow.Group(kind: "how_i_mean", heading: "How I mean things", items: [item])]))

        you.send(.itemTapped(item))
        await you.tasks.settle()
        // The card's two calls run side by side; each is made once.
        XCTAssertEqual(transport.calls.map(\.path).sorted(), ["/beliefs/b1", "/comm/items", "/comm/items/b1/visibility"])
        XCTAssertEqual(you.flow.kenning?.detail, .loaded(YouFlow.Detail(
            receipt: YouFlow.Receipt(quote: "I go quiet", date: "2026-11-27T10:00:00.000Z"),
            seenBy: [YouFlow.Person(id: "p-jan", name: "Jan")]
        )))
    }

    // MARK: People

    func testPeopleListsTheHomeRowsMostUrgentFirst() async {
        let jan = #"{"id":"p-jan","name":"Jan","initial":"J","color":"teal","deleted":false}"#
        let ben = #"{"id":"p-ben","name":"Ben","initial":"B","color":"teal","deleted":false}"#
        let home = #"{"order":"","people":[{"person":\#(ben),"reasons":[],"unread":0,"draft":true,"activity_at":null},{"person":\#(jan),"reasons":["unread"],"unread":1,"draft":false,"activity_at":null}]}"#
        let transport = RecordingTransport([Operations.getHome.id: (200, home)])
        let people = PeopleHost(context: context(transport, session: Self.signedIn))
        people.load()
        await people.tasks.settle()
        XCTAssertEqual(transport.calls.map(\.path), ["/home"])
        XCTAssertEqual(people.list, .loaded([
            PeopleScreen.Row(id: "p-jan", name: "Jan", line: .unread(when: ""), time: nil, isNew: true),
            PeopleScreen.Row(id: "p-ben", name: "Ben", line: .draft, time: nil, isNew: false),
        ]))
        var opened: WriteSendFlow.Person?
        people.opened = { opened = $0 }
        people.send(.rowTapped(0))
        XCTAssertEqual(opened, WriteSendFlow.Person(id: "p-jan", name: "Jan"))
    }

    // MARK: Thread

    func testAThreadLoadsItsDraftAndMapThenSendsOnce() async throws {
        let transport = RecordingTransport([
            Operations.getDraft.id: (200, #"{"draft":{"text":"I was hurt on Sunday","reply_to":null,"updated_at":"2026-11-28T00:00:00.000Z"}}"#),
            Operations.getPersonMap.id: (403, #"{"error":"forbidden","ref":"R4"}"#),
            Operations.sendBridge.id: (200, #"{"bridge":{"id":"br-1","from":null,"deliver_at":"2026-11-28T00:00:00.000Z","opened_at":null,"reply_to":null}}"#),
        ])
        let thread = WriteSendHost(context: context(transport, session: Self.signedIn), person: .init(id: "p1", name: "Jan"), tz: "Asia/Tehran")
        thread.send(.entered)
        await thread.tasks.settle()
        XCTAssertEqual(transport.calls.map(\.path).sorted(), ["/drafts/p1", "/people/p1/map"])
        XCTAssertEqual(thread.flow.text, "I was hurt on Sunday")
        XCTAssertEqual(thread.flow.theyShared, .no)

        thread.send(.sendTapped)
        await thread.tasks.settle()
        let sends = transport.calls.filter { $0.operationID == Operations.sendBridge.id }
        XCTAssertEqual(sends.count, 1)
        let body = try sends[0].json()
        XCTAssertEqual(body["person_id"] as? String, "p1")
        XCTAssertEqual(body["final"] as? String, "I was hurt on Sunday")
        XCTAssertEqual(body["used"] as? String, "mine")
        XCTAssertEqual(body["deliver_at"] as? String, "now")
        XCTAssertEqual(body["tz"] as? String, "Asia/Tehran")
        XCTAssertEqual(thread.flow.state, .sent)
    }

    // MARK: AI consent and Settings

    func testAgreeingSendsNothingWhileTheConsentRouteIsNotInTheContract() async {
        let transport = RecordingTransport()
        let consent = AIConsentHost(context: context(transport, session: Self.signedIn), requiredVersion: "2026-11")
        var answered: Bool?
        consent.answered = { answered = $0 }
        consent.send(.agreeTapped)
        await consent.tasks.settle()
        XCTAssertTrue(transport.calls.isEmpty)
        XCTAssertEqual(consent.flow.state, .showing)
        XCTAssertTrue(consent.flow.showsNotSaved, "never shown as agreed without the server's confirmation")
        XCTAssertNil(answered)
        consent.send(.notNowTapped)
        XCTAssertEqual(answered, false)
    }

    func testSettingsDownloadsTheExportOnce() async throws {
        let transport = RecordingTransport([
            Operations.getMe.id: (200, meReply),
            Operations.exportData.id: (200, #"{"exported_at":"2026-11-28T00:00:00.000Z","me":{"person":\#(person)}}"#),
        ])
        let settings = SettingsHost(context: context(transport, session: Self.signedIn))
        settings.send(.pulled)
        await settings.tasks.settle()
        XCTAssertEqual(settings.ai, .empty, "no ai_consent on GET /me yet: the AI row is left out")
        settings.send(.downloadTapped)
        await settings.tasks.settle()
        XCTAssertEqual(transport.calls.map(\.path), ["/me", "/export"])
        let file = try XCTUnwrap(settings.exported?.url)
        let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
        XCTAssertEqual(saved?["exported_at"] as? String, "2026-11-28T00:00:00.000Z")
        XCTAssertEqual(settings.flow.state, .open)
    }

    func testLogOutRemovesTheDeviceThenEndsTheSession() async {
        let transport = RecordingTransport([
            Operations.getMe.id: (200, meReply),
            Operations.removeApnsDevice.id: (200, #"{"removed":true,"installation_id":"x"}"#),
        ])
        let context = context(transport, session: Self.signedIn)
        let settings = SettingsHost(context: context)
        settings.send(.pulled)
        settings.send(.logOutTapped)
        await settings.tasks.settle()
        XCTAssertEqual(transport.calls.filter { $0.operationID == Operations.removeApnsDevice.id }.map(\.path),
                       ["/devices/apns/\(context.installationId)"])
        XCTAssertEqual(settings.flow.state, .loggedOut)
        let current = await context.api.session.current
        XCTAssertNil(current)
    }

    // MARK: Helpers

    private func waitFor(_ condition: @MainActor () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("condition never held", file: file, line: line)
    }
}

/// What Apple's sheet was given.
private final class NonceBox: @unchecked Sendable {
    var sha: String?
}

/// A transport that records every call (operation, method, path and body) and answers from a table by operation.
private final class RecordingTransport: ClientTransport, @unchecked Sendable {
    struct Call {
        let operationID: String
        let method: HTTPRequest.Method
        let path: String
        let body: Data

        func json() throws -> [String: Any] {
            try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        }
    }

    private let lock = NSLock()
    private var recorded: [Call] = []
    private let answers: [String: (Int, String)]

    init(_ answers: [String: (Int, String)] = [:]) {
        self.answers = answers
    }

    var calls: [Call] { lock.withLock { recorded } }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        var data = Data()
        if let body { data = try await Data(collecting: body, upTo: 1_000_000) }
        let path = String((request.path ?? "").split(separator: "?").first ?? "")
        let call = Call(operationID: operationID, method: request.method, path: path, body: data)
        let (status, json) = lock.withLock {
            recorded.append(call)
            return answers[operationID] ?? (500, #"{"error":"internal","ref":"TEST"}"#)
        }
        var fields = HTTPFields()
        fields[.contentType] = "application/json"
        return (HTTPResponse(status: .init(code: status), headerFields: fields), HTTPBody(json))
    }
}
