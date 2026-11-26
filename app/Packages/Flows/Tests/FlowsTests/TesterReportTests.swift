import XCTest
@testable import Flows

/// #61: the red Report button's queue, log, gate and flow.
final class TesterReportTests: XCTestCase {
    private var dir: URL!

    override func setUp() {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("reports-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
    }

    private func report(_ id: String, at seconds: TimeInterval, note: String = "n") -> TesterReport {
        TesterReport(
            reportId: id, note: note, screen: "talk", build: "0.9 (101)", device: "iPhone18,1", ios: "27.2",
            time: Date(timeIntervalSince1970: seconds), log: [], screenshot: Data([0xFF, 0xD8, 0xFF, 0xD9])
        )
    }

    // MARK: Gate

    func testGateNeverShowsWhenNotCompiledIn() {
        XCTAssertFalse(TesterReportGate.isShown(compiledIn: false, debugBuild: false, launchFlag: true))
        XCTAssertFalse(TesterReportGate.isShown(compiledIn: false, debugBuild: true, launchFlag: true))
    }

    func testGateDebugNeedsLaunchFlagTestFlightAlwaysShows() {
        XCTAssertFalse(TesterReportGate.isShown(compiledIn: true, debugBuild: true, launchFlag: false))
        XCTAssertTrue(TesterReportGate.isShown(compiledIn: true, debugBuild: true, launchFlag: true))
        XCTAssertTrue(TesterReportGate.isShown(compiledIn: true, debugBuild: false, launchFlag: false))
    }

    // MARK: Queue

    func testOfflineReportIsSavedAndNothingIsSent() async throws {
        let queue = TesterReportQueue(directory: dir)
        try await queue.save(report("a", at: 1))
        let waiting = try await queue.pending()
        XCTAssertEqual(waiting.map(\.reportId), ["a"])
    }

    func testSendsOldestFirst() async throws {
        let queue = TesterReportQueue(directory: dir)
        try await queue.save(report("late", at: 300))
        try await queue.save(report("early", at: 100))
        try await queue.save(report("middle", at: 200))
        let server = FakeServer()
        let result = await queue.flush(using: server)
        XCTAssertEqual(result.sent, ["early", "middle", "late"])
        let order = await server.received
        XCTAssertEqual(order, ["early", "middle", "late"])
        XCTAssertEqual(result.remaining, 0)
    }

    func testDeletedOnlyWhenServerAnswersWithItsId() async throws {
        let queue = TesterReportQueue(directory: dir)
        try await queue.save(report("a", at: 1))
        try await queue.save(report("b", at: 2))

        let wrongId = FakeServer(answer: { _ in "someone-else" })
        var result = await queue.flush(using: wrongId)
        XCTAssertEqual(result.sent, [])
        XCTAssertEqual(result.remaining, 2)

        let offline = FakeServer(answer: { _ in throw URLErrorLike() })
        result = await queue.flush(using: offline)
        XCTAssertEqual(result.remaining, 2)

        // First confirmed, second fails: only the first is deleted, and order is kept.
        let half = FakeServer(answer: { id in if id == "a" { return id }; throw URLErrorLike() })
        result = await queue.flush(using: half)
        XCTAssertEqual(result.sent, ["a"])
        let left = try await queue.pending()
        XCTAssertEqual(left.map(\.reportId), ["b"])
    }

    func testRepeatReportIdIsNotDuplicated() async throws {
        let queue = TesterReportQueue(directory: dir)
        try await queue.save(report("same", at: 1, note: "first"))
        try await queue.save(report("same", at: 2, note: "second"))
        let waiting = try await queue.pending()
        XCTAssertEqual(waiting.count, 1)
        XCTAssertEqual(waiting.first?.note, "second")
        let server = FakeServer()
        _ = await queue.flush(using: server)
        let received = await server.received
        XCTAssertEqual(received, ["same"])
    }

    func testRequestBodyShape() throws {
        let data = try report("r1", at: 0, note: "the button is hidden").requestBody()
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["report_id"] as? String, "r1")
        XCTAssertEqual(json["screenshot_base64"] as? String, Data([0xFF, 0xD8, 0xFF, 0xD9]).base64EncodedString())
        let body = try XCTUnwrap(json["body"] as? [String: Any])
        XCTAssertEqual(Set(body.keys), ["note", "screen", "build", "device", "ios", "time", "log"])
        XCTAssertEqual(body["note"] as? String, "the button is hidden")
        XCTAssertEqual(body["time"] as? String, "1970-01-01T00:00:00.000Z")
    }

    func testScreenshotOverTwoMegabytesIsDropped() {
        let big = Data(count: TesterReport.maxScreenshotBytes + 1)
        let r = TesterReport(
            reportId: "x", note: "", screen: "talk", build: "", device: "", ios: "", time: Date(), log: [], screenshot: big
        )
        XCTAssertNil(r.screenshot)
    }

    // MARK: Log

    func testLogKeepsAtMostTwentyLines() {
        let log = TesterLog()
        for i in 0..<35 { log.record(.api(method: "get", path: "/home/\(i)", status: 200, milliseconds: i)) }
        XCTAssertEqual(log.recent.count, 20)
        XCTAssertTrue(log.recent.last!.hasSuffix("api GET /home/34 200 34ms"))
        XCTAssertTrue(log.recent.first!.contains("/home/15 "))
    }

    func testLogCarriesNoMessageText() {
        let log = TesterLog()
        log.record(.api(method: "POST", path: "/talk/turn?text=I%20feel%20alone#I feel alone", status: nil, milliseconds: 12))
        log.record(.api(method: "PATCH", path: "/drafts/42", status: 200, milliseconds: 3))
        let all = log.recent.joined(separator: "\n")
        XCTAssertFalse(all.contains("feel"))
        XCTAssertFalse(all.contains("alone"))
        XCTAssertTrue(log.recent[0].hasSuffix("api POST /talk/turn none 12ms"))
        XCTAssertTrue(log.recent[1].hasSuffix("api PATCH /drafts/42 200 3ms"))
        // A view name is one token: no spaces, so no sentence fits in it.
        log.record(.view("thread view"))
        XCTAssertEqual(log.currentScreen, "threadview")
    }

    func testLogTracksCurrentScreen() {
        let log = TesterLog()
        log.record(.view("talk"))
        log.record(.view("people"))
        XCTAssertEqual(log.currentScreen, "people")
    }

    // MARK: Flow

    @MainActor
    func testOfflineSendSavesAndSaysSo() async throws {
        let queue = TesterReportQueue(directory: dir)
        let flow = makeFlow(queue: queue, sender: FakeServer(), online: false)
        flow.pressBegan(screenshot: Data([1]))
        flow.transcript("the save button")
        flow.pressEnded()
        XCTAssertEqual(flow.phase, .editing(note: "the save button"))
        flow.edit("the save button does nothing")
        await flow.send()
        XCTAssertEqual(flow.phase, .saved)
        let waiting = try await queue.pending()
        XCTAssertEqual(waiting.map(\.note), ["the save button does nothing"])
    }

    @MainActor
    func testOnlineSendShowsSentOnlyAfterServerConfirms() async throws {
        let queue = TesterReportQueue(directory: dir)
        let confirms = makeFlow(queue: queue, sender: FakeServer(), online: true)
        confirms.pressBegan(screenshot: nil)
        confirms.pressEnded()
        await confirms.send()
        XCTAssertEqual(confirms.phase, .sent)

        let refuses = makeFlow(queue: queue, sender: FakeServer(answer: { _ in throw URLErrorLike() }), online: true)
        refuses.pressBegan(screenshot: nil)
        refuses.pressEnded()
        await refuses.send()
        XCTAssertEqual(refuses.phase, .saved)
    }

    @MainActor
    func testReportTakesScreenAndLogAtPressTime() async throws {
        let queue = TesterReportQueue(directory: dir)
        let log = TesterLog()
        log.record(.view("talk"))
        let flow = makeFlow(queue: queue, sender: nil, online: true, log: log)
        flow.pressBegan(screenshot: nil)
        log.record(.view("you"))
        flow.pressEnded()
        await flow.send()
        let saved = try await queue.pending()
        XCTAssertEqual(saved.first?.screen, "talk")
        XCTAssertEqual(saved.first?.log.count, 1)
    }

    @MainActor
    func testLateTranscriptFillsUneditedNoteOnly() {
        let flow = makeFlow(queue: TesterReportQueue(directory: dir), sender: nil, online: false)
        flow.pressBegan()
        flow.transcript("the map")
        flow.pressEnded()
        flow.transcript("the map is blank")
        XCTAssertEqual(flow.phase, .editing(note: "the map is blank"))
        flow.edit("my words")
        flow.transcript("the map is blank today")
        XCTAssertEqual(flow.phase, .editing(note: "my words"))
    }

    @MainActor
    func testScreenshotEncodedAfterPressIsSent() async throws {
        let queue = TesterReportQueue(directory: dir)
        let flow = makeFlow(queue: queue, sender: nil, online: false)
        flow.pressBegan()
        flow.screenshotReady(Data([0xFF, 0xD8, 0xFF, 0xD9]))
        flow.pressEnded()
        await flow.send()
        let saved = try await queue.pending()
        XCTAssertEqual(saved.first?.screenshot, Data([0xFF, 0xD8, 0xFF, 0xD9]))
    }

    @MainActor
    func testIntroShowsUntilFirstSend() async {
        var seen = 0
        let flow = TesterReportFlow(
            queue: TesterReportQueue(directory: dir), log: TesterLog(),
            context: TesterReportContext(build: "b", device: "d", ios: "i"),
            sender: nil, canSend: { false }, introAlreadySeen: false, introSeen: { seen += 1 }
        )
        XCTAssertTrue(flow.showsIntro)
        flow.pressBegan(screenshot: nil)
        flow.pressEnded()
        await flow.send()
        XCTAssertFalse(flow.showsIntro)
        XCTAssertEqual(seen, 1)
    }

    @MainActor
    private func makeFlow(
        queue: TesterReportQueue, sender: (any FeedbackSending)?, online: Bool, log: TesterLog = TesterLog()
    ) -> TesterReportFlow {
        TesterReportFlow(
            queue: queue, log: log, context: TesterReportContext(build: "b", device: "d", ios: "i"),
            sender: sender, canSend: { online }, introAlreadySeen: true
        )
    }
}

private struct URLErrorLike: Error {}

private actor FakeServer: FeedbackSending {
    private(set) var received: [String] = []
    private let answer: @Sendable (String) throws -> String

    init(answer: @escaping @Sendable (String) throws -> String = { $0 }) {
        self.answer = answer
    }

    func send(reportId: String, body: Data) async throws -> String {
        received.append(reportId)
        return try answer(reportId)
    }
}
