import DesignKit
import Flows
import SwiftUI
import UIKit

/// Draws where `AppRoot` says the app is: sign-in, AI consent, or the surface. No logic of its own.
struct AppRootView: View {
    let root: AppRoot

    var body: some View {
        Group {
            switch root.screen {
            case .waiting:
                Greenhouse().ignoresSafeArea()
            case .signIn:
                SignInScreen(state: root.signIn.flow.state) { root.signIn.send($0) }
            case .aiConsent:
                if let consent = root.consent {
                    AIConsentScreen(flow: consent.flow) { consent.send($0) }
                }
            case .surface:
                if let surface = root.surface {
                    SurfaceHostView(host: surface)
                }
            }
        }
        .task { await root.start() }
    }
}

/// The surface with each view's screen in its slot (#21): Talk (#25), You (#27), People (#29), Thread empty until
/// #19, Settings (#24) from the pull mark; the safety stop (#34), AI consent and the pause (#33) over it when their
/// flows ask.
struct SurfaceHostView: View {
    let host: SurfaceHost

    var body: some View {
        Surface(model: host.model) { view in
            slot(view)
        } settings: {
            SettingsScreen(
                state: host.settings.flow.state,
                ai: host.settings.ai,
                lastKnownAI: host.settings.lastKnownAI,
                line: host.settings.flow.line
            ) { host.sendSettings($0) }
        }
        .overlay { over }
        .onChange(of: host.model.flow.view) { old, new in host.viewChanged(from: old, to: new) }
        .onChange(of: host.model.flow.settingsOpen) { _, open in host.settingsOpenChanged(open) }
        .onChange(of: host.talk.flow.state) { _, _ in host.talkStateChanged() }
        .sheet(item: Binding(get: { host.settings.exported }, set: { host.settings.exported = $0 })) { file in
            ShareSheet(items: [file.url])
        }
        .task { host.start() }
    }

    @ViewBuilder private func slot(_ view: SurfaceFlow.View) -> some View {
        switch view {
        case .talk:
            TalkScreen(flow: host.talk.flow, name: host.talk.name, notice: host.talk.notice,
                       send: { host.talk.send($0) }, turnOnAI: { host.askForConsent() })
        case .you:
            YouScreen(list: host.you.flow.list) { host.you.send($0) }
        case .people:
            PeopleScreen(list: host.people.list) { host.people.send($0) }
        case .thread:
            Color.clear.testerScreen("thread")
        }
    }

    @ViewBuilder private var over: some View {
        if let consent = host.consent {
            AIConsentScreen(flow: consent.flow) { consent.send($0) }
        } else if let safety = host.safety {
            ZStack {
                Greenhouse().ignoresSafeArea()
                SafetyScreen(safety: safety) { host.sendSafety($0) }
            }
        } else if let thread = host.thread, thread.pauseShown {
            PauseScreen(flow: thread.flow) { thread.send($0) }
        }
    }
}

/// The system share sheet, for the exported data file.
private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
