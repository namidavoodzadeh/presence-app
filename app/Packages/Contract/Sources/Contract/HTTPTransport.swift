// Hand-written, beside the generated client (#108): the one transport the generated client runs over.
// It lives here because the app target never names Foundation's networking types (tools/lint-structure.sh);
// the app builds it with `HTTPTransport()` and adds its headers as middleware.
import Foundation

public struct HTTPTransport: ClientTransport {
    private let session: URLSession

    /// `configuration` is for tests (a fake URLProtocol); the app uses the default.
    public init(configuration: URLSessionConfiguration = .default) {
        self.session = URLSession(configuration: configuration)
    }

    public enum TransportError: Error, Equatable {
        case invalidURL
        case notHTTP
    }

    public func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        guard var url = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              let path = URLComponents(string: request.path ?? "")
        else { throw TransportError.invalidURL }
        url.percentEncodedPath += path.percentEncodedPath
        url.percentEncodedQuery = path.percentEncodedQuery
        guard let target = url.url else { throw TransportError.invalidURL }

        var urlRequest = URLRequest(url: target)
        urlRequest.httpMethod = request.method.rawValue
        for field in request.headerFields {
            urlRequest.addValue(field.value, forHTTPHeaderField: field.name.canonicalName)
        }
        if let body {
            urlRequest.httpBody = try await Data(collecting: body, upTo: .max)
        }

        let (data, response) = try await session.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { throw TransportError.notHTTP }
        var fields = HTTPFields()
        for (key, value) in http.allHeaderFields {
            guard let key = key as? String, let name = HTTPField.Name(key) else { continue }
            fields.append(HTTPField(name: name, value: "\(value)"))
        }
        return (HTTPResponse(status: .init(code: http.statusCode), headerFields: fields), data.isEmpty ? nil : HTTPBody(data))
    }
}
