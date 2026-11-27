import Foundation
import Observation

/// Tester tooling (#61), not product. The red Report button's flow:
/// hold (screenshot already taken) → live transcript → release → edit → send.
/// Send always writes to the queue first; it shows `sent` only after the server confirms the report's id.
@MainActor
@Observable
public final class TesterReportFlow {
    public enum Phase: Equatable, Sendable {
        case idle
        case listening(transcript: String)
        case editing(note: String)
        case sending
        /// The server confirmed this report.
        case sent
        /// Written to the queue; "Saved, will send when online".
        case saved
        /// Could not even be written to disk.
        case failed
    }

    public static let intro = "Sends a screenshot and what you say to the Kenember team."
    public static let savedLine = "Saved, will send when online"

    public private(set) var phase: Phase = .idle
    /// True until the first report has been opened for editing once.
    public private(set) var showsIntro: Bool

    private let queue: TesterReportQueue
    private let log: TesterLog
    private let context: TesterReportContext
    private let sender: (any FeedbackSending)?
    private let canSend: @Sendable () async -> Bool
    private let newId: @Sendable () -> String
    private let now: @Sendable () -> Date
    private let introSeen: @MainActor () -> Void
    private var draft: (screenshot: Data?, screen: String, log: [String], time: Date)?
    private var lastHeard = ""

    public init(
        queue: TesterReportQueue,
        log: TesterLog,
        context: TesterReportContext,
        sender: (any FeedbackSending)?,
        canSend: @escaping @Sendable () async -> Bool,
        introAlreadySeen: Bool,
        introSeen: @escaping @MainActor () -> Void = {},
        newId: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() },
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.queue = queue
        self.log = log
        self.context = context
        self.sender = sender
        self.canSend = canSend
        self.showsIntro = !introAlreadySeen
        self.introSeen = introSeen
        self.newId = newId
        self.now = now
    }

    /// Press began. The screenshot was taken before this call, of the app's windows only.
    public func pressBegan(screenshot: Data? = nil) {
        switch phase {
        case .idle, .sent, .saved, .failed: break
        case .listening, .editing, .sending: return
        }
        draft = (screenshot, log.currentScreen, log.recent, now())
        lastHeard = ""
        phase = .listening(transcript: "")
    }

    /// The screenshot, once encoded off the main thread. Kept only for the report it was taken for.
    public func screenshotReady(_ jpeg: Data?) {
        guard draft != nil else { return }
        draft?.screenshot = jpeg
    }

    /// Live on-device dictation. A result that arrives just after release still fills the note,
    /// unless the tester has already changed it.
    public func transcript(_ text: String) {
        switch phase {
        case .listening:
            phase = .listening(transcript: text)
            lastHeard = text
        case .editing(let note) where note == lastHeard:
            phase = .editing(note: text)
            lastHeard = text
        case .idle, .editing, .sending, .sent, .saved, .failed:
            return
        }
    }

    /// Press released: the transcript opens for editing.
    public func pressEnded() {
        guard case .listening(let text) = phase else { return }
        phase = .editing(note: text)
    }

    public func edit(_ note: String) {
        guard case .editing = phase else { return }
        phase = .editing(note: note)
    }

    public func cancel() {
        switch phase {
        case .sending: return
        case .idle, .listening, .editing, .sent, .saved, .failed: break
        }
        draft = nil
        phase = .idle
    }

    /// Closes the confirmation after `sent`, `saved` or `failed`.
    public func dismiss() {
        switch phase {
        case .sent, .saved, .failed: phase = .idle
        case .idle, .listening, .editing, .sending: return
        }
    }

    public func send() async {
        guard case .editing(let note) = phase, let draft else { return }
        let report = TesterReport(
            reportId: newId(), note: note, screen: draft.screen, build: context.build, device: context.device,
            ios: context.ios, time: draft.time, log: draft.log, screenshot: draft.screenshot
        )
        self.draft = nil
        if showsIntro {
            showsIntro = false
            introSeen()
        }
        phase = .sending
        do {
            try await queue.save(report)
        } catch {
            phase = .failed
            return
        }
        guard let sender, await canSend() else {
            phase = .saved
            return
        }
        let result = await queue.flush(using: sender)
        phase = result.sent.contains(report.reportId) ? .sent : .saved
    }

    /// Sends what is waiting, when signed in and online. Called by the app on launch and when the network returns.
    public func retryWaiting() async {
        guard let sender, await canSend() else { return }
        _ = await queue.flush(using: sender)
    }
}
