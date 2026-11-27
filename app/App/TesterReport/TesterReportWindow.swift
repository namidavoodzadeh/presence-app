#if TESTER_REPORT
import DesignKit
import Flows
import SwiftUI
import UIKit

/// Tester tooling (#61), not product. The red Report circle lives in its own window above the app.
/// Press and hold: screenshot first (app windows only), then on-device dictation with a live transcript.
/// Release: the transcript opens for editing. Send writes to the on-disk queue, then sends when it can.
/// Nothing on the press path touches the network.
@MainActor
final class TesterReportController {
    private static var installed: [ObjectIdentifier: TesterReportController] = [:]

    let flow: TesterReportFlow
    private(set) var window: ReportWindow!
    private weak var scene: UIWindowScene?
    private let dictation = TesterDictation()
    private var encoding: Task<Void, Never>?

    static func install(in scene: UIWindowScene) {
        guard TesterReportBuild.isShown, installed[ObjectIdentifier(scene)] == nil else { return }
        installed[ObjectIdentifier(scene)] = TesterReportController(scene: scene)
    }

    private init(scene: UIWindowScene) {
        self.scene = scene
        let defaults = UserDefaults.standard
        let introKey = "testerReport.introSeen"
        flow = TesterReportFlow(
            queue: TesterReportQueue(directory: Self.queueDirectory),
            log: TesterReportBuild.log,
            context: Self.context,
            // No sign-in yet, and contract/openapi.yaml has no POST /feedback route for the generated client,
            // so reports wait in the queue. Wire the Contract client here when both exist (#61).
            sender: nil,
            canSend: { false },
            introAlreadySeen: defaults.bool(forKey: introKey),
            introSeen: { defaults.set(true, forKey: introKey) }
        )
        let window = ReportWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.backgroundColor = .clear
        window.rootViewController = ReportViewController(controller: self)
        window.controller = self
        window.isHidden = false
        self.window = window
        Task { await flow.retryWaiting() }
    }

    /// True while the editor or a confirmation is up: the window then takes every touch.
    var takesAllTouches: Bool {
        switch flow.phase {
        case .editing, .sending, .sent, .saved, .failed: true
        case .idle, .listening: false
        }
    }

    func pressBegan() {
        switch flow.phase {
        case .idle, .sent, .saved, .failed: break
        case .listening, .editing, .sending: return
        }
        guard let scene else { return }
        // 1. Screenshot first, before anything else changes on screen.
        let image = TesterScreenshot.capture(in: scene, excluding: window)
        flow.pressBegan()
        // 2. Everything after runs off the main thread.
        nonisolated(unsafe) let shot = image
        let flow = flow
        encoding = Task.detached(priority: .userInitiated) {
            let data = shot.flatMap { TesterScreenshot.jpeg($0) }
            await flow.screenshotReady(data)
        }
        dictation.start { [weak flow] text in flow?.transcript(text) }
    }

    func pressEnded() {
        dictation.stop()
        flow.pressEnded()
        window.makeKey()
    }

    /// VoiceOver and Switch Control: no hold, straight to the editor.
    func reportWithoutHold() {
        pressBegan()
        flow.pressEnded()
        window.makeKey()
    }

    func send() {
        let encoding = encoding
        Task {
            await encoding?.value
            await flow.send()
        }
    }

    func close() {
        dictation.stop()
        switch flow.phase {
        case .sent, .saved, .failed: flow.dismiss()
        case .idle, .listening, .editing, .sending: flow.cancel()
        }
        window.endEditing(true)
        scene?.windows.first { $0 !== window && !$0.isHidden && $0.windowLevel == .normal }?.makeKey()
    }

    private static var queueDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("TesterReports", isDirectory: true)
    }

    private static var context: TesterReportContext {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["CFBundleVersion"] as? String ?? "?"
        return TesterReportContext(build: "\(version) (\(build))", device: deviceModel, ios: UIDevice.current.systemVersion)
    }

    private static var deviceModel: String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }
}

/// Passes every touch through to the app except on the red circle, until the editor is up.
final class ReportWindow: UIWindow {
    weak var controller: TesterReportController?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let hit = super.hitTest(point, with: event) else { return nil }
        if controller?.takesAllTouches == true { return hit }
        guard let button = (rootViewController as? ReportViewController)?.button else { return nil }
        return hit.isDescendant(of: button) ? hit : nil
    }
}

final class ReportViewController: UIViewController {
    let button = ReportButton()
    private let controller: TesterReportController

    init(controller: TesterReportController) {
        self.controller = controller
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        let overlay = UIHostingController(rootView: TesterReportOverlay(flow: controller.flow, controller: controller))
        overlay.view.backgroundColor = .clear
        addChild(overlay)
        overlay.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(overlay.view)
        overlay.didMove(toParent: self)

        button.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(button)
        NSLayoutConstraint.activate([
            overlay.view.topAnchor.constraint(equalTo: view.topAnchor),
            overlay.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            overlay.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlay.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            button.widthAnchor.constraint(equalToConstant: Tooling.reportButtonSize),
            button.heightAnchor.constraint(equalToConstant: Tooling.reportButtonSize),
            button.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -Tooling.reportInset),
            button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -Tooling.reportInset),
        ])
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
        hold.minimumPressDuration = 0
        button.addGestureRecognizer(hold)
        button.onActivate = { [weak self] in self?.controller.reportWithoutHold() }
    }

    @objc private func held(_ gesture: UILongPressGestureRecognizer) {
        switch gesture.state {
        case .began: controller.pressBegan()
        case .ended, .cancelled, .failed: controller.pressEnded()
        default: break
        }
    }
}

final class ReportButton: UIView {
    var onActivate: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(Tooling.reportRed)
        layer.cornerRadius = Tooling.reportButtonSize / 2
        isAccessibilityElement = true
        accessibilityLabel = "Report"
        accessibilityHint = TesterReportFlow.intro
        accessibilityTraits = .button
        accessibilityIdentifier = "report.button"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func accessibilityActivate() -> Bool {
        onActivate?()
        return true
    }
}

/// The live transcript while holding, then the note editor and its confirmation.
struct TesterReportOverlay: View {
    let flow: TesterReportFlow
    let controller: TesterReportController

    var body: some View {
        switch flow.phase {
        case .idle:
            Color.clear.allowsHitTesting(false)
        case .listening(let transcript):
            VStack {
                Spacer()
                Text(transcript.isEmpty ? "Listening…" : transcript)
                    .textStyle(.body)
                    .foregroundStyle(Palette.teal)
                    .padding(Space.m)
                    .background(Palette.cream, in: RoundedRectangle(cornerRadius: Radius.m))
                    .padding(Space.l)
                    .accessibilityIdentifier("report.transcript")
            }
            .allowsHitTesting(false)
        case .editing(let note):
            panel {
                if flow.showsIntro {
                    Text(TesterReportFlow.intro)
                        .textStyle(.caption)
                        .foregroundStyle(Palette.teal)
                        .accessibilityIdentifier("report.intro")
                }
                TextEditor(text: Binding(get: { note }, set: { flow.edit($0) }))
                    .textStyle(.body)
                    .foregroundStyle(Palette.teal)
                    .scrollContentBackground(.hidden)
                    .frame(height: Tooling.reportEditorHeight)
                    .accessibilityIdentifier("report.note")
                HStack(spacing: Space.m) {
                    Button("Cancel") { controller.close() }
                        .accessibilityIdentifier("report.cancel")
                    Spacer()
                    Button("Send") { controller.send() }
                        .accessibilityIdentifier("report.send")
                }
                .textStyle(.label)
                .tint(Palette.teal)
            }
        case .sending:
            panel {
                ProgressView().tint(Palette.teal).accessibilityIdentifier("report.sending")
            }
        case .sent:
            confirmation("Sent.")
        case .saved:
            confirmation(TesterReportFlow.savedLine)
        case .failed:
            confirmation("This report couldn't be saved.")
        }
    }

    private func confirmation(_ line: String) -> some View {
        panel {
            Text(line)
                .textStyle(.body)
                .foregroundStyle(Palette.teal)
                .accessibilityIdentifier("report.status")
            Button("Done") { controller.close() }
                .textStyle(.label)
                .tint(Palette.teal)
                .accessibilityIdentifier("report.done")
        }
    }

    private func panel<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ZStack {
            Palette.teal.opacity(0.4).ignoresSafeArea()
            VStack(alignment: .leading, spacing: Space.s) { content() }
                .padding(Space.m)
                .background(Palette.cream, in: RoundedRectangle(cornerRadius: Radius.l))
                .padding(Space.m)
        }
    }
}

/// Finds the scene this app's root view is in, and installs the Report window there.
struct TesterReportInstaller: UIViewRepresentable {
    func makeUIView(context: Context) -> SceneProbe { SceneProbe() }
    func updateUIView(_ view: SceneProbe, context: Context) {}

    final class SceneProbe: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            isUserInteractionEnabled = false
            if let scene = window?.windowScene { TesterReportController.install(in: scene) }
        }
    }
}
#endif
