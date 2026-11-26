import Foundation

/// Tester tooling (#61), not product: the last app log lines a tester report carries.
/// A line is built only from a view name or an API call's method, path, status and time,
/// so nobody's words can reach it. Keeps at most `capacity` lines, newest last.
public final class TesterLog: @unchecked Sendable {
    public static let capacity = 20

    public enum Entry: Equatable, Sendable {
        /// The screen the person moved to (`talk`, `you`, `people`, `thread`, …).
        case view(String)
        /// An API call: method, path (query dropped), HTTP status (nil when no answer), milliseconds.
        case api(method: String, path: String, status: Int?, milliseconds: Int)
    }

    private let lock = NSLock()
    private var lines: [String] = []
    private var screen = "unknown"
    private let now: @Sendable () -> Date

    public init(now: @escaping @Sendable () -> Date = Date.init) {
        self.now = now
    }

    /// The screen shown when the report was made.
    public var currentScreen: String {
        lock.lock(); defer { lock.unlock() }
        return screen
    }

    /// The kept lines, oldest first, at most `capacity`.
    public var recent: [String] {
        lock.lock(); defer { lock.unlock() }
        return lines
    }

    public func record(_ entry: Entry) {
        let stamp = Self.stamp(now())
        let line: String
        switch entry {
        case .view(let name):
            let safe = Self.token(name)
            line = "\(stamp) view \(safe)"
            lock.lock(); screen = safe; lock.unlock()
        case .api(let method, let path, let status, let milliseconds):
            let code = status.map(String.init) ?? "none"
            line = "\(stamp) api \(Self.token(method).uppercased()) \(Self.path(path)) \(code) \(max(0, milliseconds))ms"
        }
        lock.lock()
        lines.append(line)
        if lines.count > Self.capacity { lines.removeFirst(lines.count - Self.capacity) }
        lock.unlock()
    }

    /// A view or method name: letters, digits, `_` and `-` only, at most 32 characters.
    static func token(_ raw: String) -> String {
        let kept = raw.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-" }
        let s = String(String.UnicodeScalarView(kept)).prefix(32)
        return s.isEmpty ? "unknown" : String(s)
    }

    /// A path with the query and fragment dropped, so no text sent in a query reaches the log.
    static func path(_ raw: String) -> String {
        let cut = raw.split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map(String.init) ?? ""
        let kept = cut.unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0) || "/_-.:".unicodeScalars.contains($0)
        }
        let s = String(String.UnicodeScalarView(kept)).prefix(120)
        return s.isEmpty ? "/" : String(s)
    }

    static func stamp(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }
}
