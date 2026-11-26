import Foundation

/// Tester tooling (#61), not product. Reports wait here, on disk with file protection, until the server
/// confirms each one. Sends oldest first, stops at the first report the server does not confirm, and
/// deletes a report only when the server answers with its own `report_id`.
public actor TesterReportQueue {
    public struct FlushResult: Equatable, Sendable {
        /// Report ids the server confirmed, in the order sent.
        public let sent: [String]
        /// Reports still waiting.
        public let remaining: Int
    }

    private let directory: URL
    private var flushing = false

    public init(directory: URL) {
        self.directory = directory
    }

    /// Writes the report. Saving a `report_id` already waiting replaces it, never adds a second copy.
    public func save(_ report: TesterReport) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for existing in try files() where Self.reportId(of: existing) == report.reportId {
            try FileManager.default.removeItem(at: existing)
        }
        let millis = max(0, Int64((report.time.timeIntervalSince1970 * 1000).rounded()))
        let name = String(format: "%015lld", millis) + "_" + Self.safe(report.reportId) + ".json"
        let data = try JSONEncoder().encode(report)
        #if os(iOS)
        try data.write(to: directory.appendingPathComponent(name), options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: directory.appendingPathComponent(name), options: [.atomic])
        #endif
    }

    /// Waiting reports, oldest first.
    public func pending() throws -> [TesterReport] {
        try files().compactMap { url in
            guard let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder().decode(TesterReport.self, from: data)
        }
    }

    /// Sends waiting reports, oldest first. A second call while one runs does nothing.
    public func flush(using sender: any FeedbackSending) async -> FlushResult {
        guard !flushing else { return FlushResult(sent: [], remaining: (try? files().count) ?? 0) }
        flushing = true
        defer { flushing = false }
        var sent: [String] = []
        for url in (try? files()) ?? [] {
            guard let data = try? Data(contentsOf: url),
                  let report = try? JSONDecoder().decode(TesterReport.self, from: data),
                  let body = try? report.requestBody()
            else { continue }
            guard let answered = try? await sender.send(reportId: report.reportId, body: body),
                  answered == report.reportId
            else { break }
            try? FileManager.default.removeItem(at: url)
            sent.append(report.reportId)
        }
        return FlushResult(sent: sent, remaining: (try? files().count) ?? 0)
    }

    private func files() throws -> [URL] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    private static func reportId(of url: URL) -> String? {
        guard let data = try? Data(contentsOf: url),
              let report = try? JSONDecoder().decode(TesterReport.self, from: data) else { return nil }
        return report.reportId
    }

    private static func safe(_ id: String) -> String {
        let kept = id.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" }
        return String(String.UnicodeScalarView(kept)).prefix(64).description
    }
}
