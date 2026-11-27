import Contract
import Foundation

/// The headers every call sends (next/api/CONTRACT.md §0): Authorization, apikey, Content-Type,
/// X-Presence-Client and X-Presence-TZ.
struct RequestHeaders: Equatable, Sendable {
    let anonKey: String
    let client: String

    static let presenceClient = HTTPField.Name("X-Presence-Client")!
    static let presenceTZ = HTTPField.Name("X-Presence-TZ")!
    static let apikey = HTTPField.Name("apikey")!

    /// `accessToken` is nil only for the calls that run before a session exists (`POST /auth/apple`).
    func fields(accessToken: String?, timeZone: TimeZone) -> HTTPFields {
        var fields = HTTPFields()
        if let accessToken { fields[.authorization] = "Bearer \(accessToken)" }
        fields[Self.apikey] = anonKey
        fields[.contentType] = "application/json"
        fields[Self.presenceClient] = client
        fields[Self.presenceTZ] = timeZone.identifier
        return fields
    }

    /// Adds the headers to `request`. A body's own Content-Type, set by the generated client, is kept.
    func apply(to request: inout HTTPRequest, accessToken: String?, timeZone: TimeZone) {
        for field in fields(accessToken: accessToken, timeZone: timeZone) {
            if field.name == .contentType, request.headerFields[.contentType] != nil { continue }
            request.headerFields[field.name] = field.value
        }
    }
}

/// Runs before every call of the generated client: adds the headers with the session's access token, and ends the
/// session on a 401 (flows/README.md). The calls that sign in carry no bearer and their 401 is the provider's refusal.
struct SessionMiddleware: ClientMiddleware {
    static let unauthenticated: Set<String> = [Operations.signInWithApple.id]

    let headers: RequestHeaders
    let session: SessionKeeper
    let timeZone: @Sendable () -> TimeZone

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let signsIn = Self.unauthenticated.contains(operationID)
        var request = request
        let token = signsIn ? nil : await session.accessToken()
        headers.apply(to: &request, accessToken: token, timeZone: timeZone())
        let (response, responseBody) = try await next(request, body, baseURL)
        if response.status.code == 401, !signsIn {
            await session.end()
        }
        return (response, responseBody)
    }
}
