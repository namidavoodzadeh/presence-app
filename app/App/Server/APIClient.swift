import Contract
import Flows
import Foundation

/// The app's one connection to the server (#108): the generated Contract client over `HTTPTransport`, with the
/// headers of CONTRACT §0 and the signed-in session. Flows never see it; the app performs their calls with it and
/// hands the answers back as events (flows/README.md).
struct APIClient: Sendable {
    let configuration: AppConfiguration
    let session: SessionKeeper
    let client: Client

    init(
        configuration: AppConfiguration,
        transport: any ClientTransport = HTTPTransport(),
        storage: any SessionStorage = KeychainSessionStorage(),
        timeZone: @escaping @Sendable () -> TimeZone = { TimeZone.current },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.configuration = configuration
        let refresh = SupabaseRefresh(authBase: configuration.authBase, anonKey: configuration.anonKey, transport: transport)
        let session = SessionKeeper(storage: storage, refresh: { token throws(RefreshFailure) in try await refresh(token) }, now: now)
        self.session = session
        self.client = Client(
            serverURL: configuration.apiBase,
            transport: transport,
            middlewares: [SessionMiddleware(
                headers: RequestHeaders(anonKey: configuration.anonKey, client: configuration.clientVersion),
                session: session,
                timeZone: timeZone
            )]
        )
    }

    /// The reply when the person has not confirmed they are 18 or over: nothing is sent (flows/sign-in.md).
    static let adultConfirmationMissing = CallFailure.http(status: 403, error: "forbidden", reason: "adult_confirmation_required")

    /// `appleSheet` credential → `exchanging` (flows/sign-in.md): `POST /auth/apple`, then keep the session.
    /// `adultConfirmed` comes from the age check: true only when the age range says 18 or over, or the range is not
    /// available and the person continued past the 18+ statement. Without it the call is not made.
    func signInWithApple(
        identityToken: String,
        nonce: String,
        name: String?,
        authorizationCode: String?,
        adultConfirmed: Bool
    ) async -> Result<Operations.signInWithApple.Output.Ok.Body.jsonPayload, CallFailure> {
        guard adultConfirmed else { return .failure(Self.adultConfirmationMissing) }
        let input = Operations.signInWithApple.Input(body: .json(.init(
            identity_token: identityToken,
            nonce: nonce,
            name: name,
            adult_confirmed: adultConfirmed,
            authorization_code: authorizationCode
        )))
        do {
            switch try await client.signInWithApple(input) {
            case let .ok(ok):
                let reply = try ok.body.json
                guard let expiry = reply.expires_at.flatMap(Self.parseDate) else { return .failure(.http(status: 500)) }
                await session.start(Session(accessToken: reply.access_token, refreshToken: reply.refresh_token, expiresAt: expiry))
                return .success(reply)
            case let .default(status, reply):
                return .failure(Self.failure(status: status, reply: reply))
            }
        } catch {
            return .failure(Self.failure(for: error))
        }
    }

    /// A documented error reply (`{error, ref, message?, reason?}`), in the terms every flow takes.
    static func failure(status: Int, reply: Components.Responses._Error) -> CallFailure {
        let body = try? reply.body.json
        return .http(status: status, error: body?.error, reason: body?.reason)
    }

    /// How a thrown call failed, in the terms every flow takes (`CallFailure`).
    static func failure(for error: any Error) -> CallFailure {
        var error = error
        if let client = error as? ClientError { error = client.underlyingError }
        if let url = error as? URLError {
            return url.code == .timedOut ? .timeout : .offline
        }
        return .http(status: 500)
    }

    /// CONTRACT §0: ISO 8601 in UTC with milliseconds; a reply without them is read too.
    static func parseDate(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}
