import Foundation

/// Where the app talks to, read from Info.plist, which the xcconfig of the build fills (#108). Never hard-coded:
/// Debug and CI builds carry a fixture value (app/Config/Debug.xcconfig); release.yml passes the repository
/// variables `PRESENCE_API_BASE` and `SUPABASE_ANON_KEY` to the archive.
struct AppConfiguration: Equatable, Sendable {
    static let apiBaseKey = "PresenceAPIBase"
    static let anonKeyKey = "SupabaseAnonKey"

    enum Problem: Error, Equatable {
        case missing(String)
        case invalidURL(String)
    }

    /// Every route is relative to this (CONTRACT §0).
    let apiBase: URL
    /// The gateway's `apikey` header.
    let anonKey: String
    /// `X-Presence-Client: ios/<version>+<build>`.
    let clientVersion: String

    /// Supabase Auth, on the same origin as the API (the refresh in flows/sign-in.md).
    var authBase: URL {
        var parts = URLComponents()
        parts.scheme = apiBase.scheme
        parts.host = apiBase.host
        parts.port = apiBase.port
        parts.path = "/auth/v1"
        return parts.url ?? apiBase
    }

    init(apiBase: URL, anonKey: String, clientVersion: String) {
        self.apiBase = apiBase
        self.anonKey = anonKey
        self.clientVersion = clientVersion
    }

    init(info: [String: Any]) throws {
        func value(_ key: String) throws -> String {
            let text = (info[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            // An unset build setting reaches the plist empty, or as its own `$(NAME)` when not substituted.
            guard !text.isEmpty, !text.hasPrefix("$(") else { throw Problem.missing(key) }
            return text
        }
        let base = try value(Self.apiBaseKey)
        // Release and TestFlight builds talk over HTTPS only; plain HTTP is for a local server in Debug.
        #if DEBUG
        let allowed: Set<String> = ["https", "http"]
        #else
        let allowed: Set<String> = ["https"]
        #endif
        guard let url = URL(string: base), let scheme = url.scheme, allowed.contains(scheme), url.host != nil else {
            throw Problem.invalidURL(base)
        }
        let version = (info["CFBundleShortVersionString"] as? String) ?? "0"
        let build = (info["CFBundleVersion"] as? String) ?? "0"
        self.init(apiBase: url, anonKey: try value(Self.anonKeyKey), clientVersion: "ios/\(version)+\(build)")
    }

    static func fromBundle(_ bundle: Bundle = .main) throws -> AppConfiguration {
        try AppConfiguration(info: bundle.infoDictionary ?? [:])
    }
}
