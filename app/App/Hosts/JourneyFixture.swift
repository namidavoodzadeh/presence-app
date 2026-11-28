#if DEBUG
import Contract
import Flows
import Foundation

/// Debug builds only: `-journeyFixture YES` runs the app against a server inside the app, with a fresh session in
/// memory and a stubbed Apple credential, so the launch journey goes sign-in → Talk with no network and no Apple
/// sheet. Nothing here is in Release.
enum JourneyFixture {
    static var isOn: Bool { UserDefaults.standard.bool(forKey: "journeyFixture") }

    @MainActor
    static func api(configuration: AppConfiguration) -> APIClient {
        APIClient(configuration: configuration, transport: FixtureTransport(), storage: MemorySessionStorage())
    }

    @MainActor
    static var provider: SignInProvider {
        SignInProvider(
            ageRange: { _ in .notDeclared },
            apple: { _ in .credential(SignInFlow.AppleCredential(identityToken: "fixture-identity-token", authorizationCode: "fixture-code", name: "Ava")) }
        )
    }
}

/// The session in memory: every launch starts signed out.
final class MemorySessionStorage: SessionStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var session: Session?

    init(_ session: Session? = nil) { self.session = session }

    func load() -> Session? { lock.withLock { session } }
    func save(_ session: Session) -> Bool { lock.withLock { self.session = session }; return true }
    func clear() -> Bool { lock.withLock { session = nil }; return true }
}

/// Answers each operation of the first loop with a fixed reply shaped like the contract's.
struct FixtureTransport: ClientTransport {
    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        let (status, json) = Self.reply(operationID)
        var fields = HTTPFields()
        fields[.contentType] = "application/json"
        return (HTTPResponse(status: .init(code: status), headerFields: fields), HTTPBody(json))
    }

    static func reply(_ operationID: String) -> (Int, String) {
        let person = #"{"id":"p-ava","name":"Ava","initial":"A","color":"teal","deleted":false}"#
        switch operationID {
        case Operations.signInWithApple.id:
            return (200, #"{"access_token":"fixture-access","refresh_token":"fixture-refresh","expires_at":"2099-01-01T00:00:00.000Z","created":true,"me":{"person":\#(person)}}"#)
        case Operations.getMe.id:
            return (200, #"{"me":{"person":\#(person)},"plan":{"active":true,"source":"own","partner_name":null}}"#)
        case Operations.getHome.id:
            return (200, #"{"order":"","people":[]}"#)
        case Operations.getPeople.id:
            return (200, #"{"people":[]}"#)
        case Operations.commTalkTurn.id:
            return (200, #"{"conversation":{"id":"c-1","status":"open","session_number":1},"message":null,"reply":{"state":"ask","reflection":"","question":"What's one moment from this week that's still with you?","comm":{"kind":"how_i_mean","question_from":"bank"},"item":null,"item_state":null},"latency_ms":0}"#)
        case Operations.getCommItems.id:
            return (200, #"{"this_week":[],"groups":[]}"#)
        default:
            return (404, #"{"error":"not_found","ref":"FIXTURE"}"#)
        }
    }
}
#endif
