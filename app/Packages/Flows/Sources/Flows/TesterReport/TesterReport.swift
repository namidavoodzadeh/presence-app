import Foundation

/// Tester tooling (#61), not product. One report a tester sends from the red Report button.
public struct TesterReport: Codable, Equatable, Sendable {
    /// The client's idempotency key for `POST /feedback` (CONTRACT §13).
    public let reportId: String
    public var note: String
    public let screen: String
    public let build: String
    public let device: String
    public let ios: String
    public let time: Date
    public let log: [String]
    /// JPEG, at most `TesterReport.maxScreenshotBytes`. Nil when none could be taken.
    public let screenshot: Data?

    public static let maxScreenshotBytes = 2 * 1024 * 1024

    public init(
        reportId: String, note: String, screen: String, build: String, device: String, ios: String,
        time: Date, log: [String], screenshot: Data?
    ) {
        self.reportId = reportId
        self.note = note
        self.screen = screen
        self.build = build
        self.device = device
        self.ios = ios
        self.time = time
        self.log = Array(log.suffix(TesterLog.capacity))
        self.screenshot = screenshot.flatMap { $0.count <= Self.maxScreenshotBytes ? $0 : nil }
    }

    /// The `POST /feedback` body: `{report_id, body: {note, screen, build, device, ios, time, log}, screenshot_base64}`.
    public func requestBody() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(FeedbackRequest(self))
    }
}

/// Where a report is made: filled by the app, never by a screen's content.
public struct TesterReportContext: Equatable, Sendable {
    public let build: String
    public let device: String
    public let ios: String
    public init(build: String, device: String, ios: String) {
        self.build = build
        self.device = device
        self.ios = ios
    }
}

struct FeedbackRequest: Encodable {
    struct Body: Encodable {
        let note, screen, build, device, ios, time: String
        let log: [String]
    }

    let report_id: String
    let body: Body
    let screenshot_base64: String?

    init(_ r: TesterReport) {
        report_id = r.reportId
        body = Body(
            note: r.note, screen: r.screen, build: r.build, device: r.device, ios: r.ios,
            time: TesterLog.stamp(r.time), log: r.log
        )
        screenshot_base64 = r.screenshot?.base64EncodedString()
    }
}

/// Sends one report to `POST /feedback`. Implemented outside Flows (Flows never touches the network).
public protocol FeedbackSending: Sendable {
    /// Returns the `report_id` the server answered with (`feedback.report_id`). Throws when there was no answer.
    func send(reportId: String, body: Data) async throws -> String
}

/// When a report shows: compiled in only for Debug and TestFlight builds (never App Store);
/// in Debug only with the `-testerReport YES` launch argument; in TestFlight always.
public enum TesterReportGate {
    public static func isShown(compiledIn: Bool, debugBuild: Bool, launchFlag: Bool) -> Bool {
        guard compiledIn else { return false }
        return debugBuild ? launchFlag : true
    }
}
