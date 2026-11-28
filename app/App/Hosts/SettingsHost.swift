import Flows
import Foundation

/// Hosts `SettingsFlow` (flows/privacy.md, second table): the AI row, download, log out and delete account.
@MainActor @Observable
final class SettingsHost {
    private(set) var flow: SettingsFlow
    /// The AI row's `GET /me` state (states.md). `.empty` while the reply carries no `ai_consent` (#8): the row is
    /// left out and the other rows still work.
    private(set) var ai: LoadState<Bool> = .loading
    /// `share`: the exported file, for the share sheet.
    var exported: ExportedFile?
    @ObservationIgnored let tasks = HostTasks()
    @ObservationIgnored private let context: HostContext

    struct ExportedFile: Identifiable, Equatable {
        let url: URL
        var id: URL { url }
    }

    init(context: HostContext) {
        self.context = context
        let lastKnown = context.defaults.object(forKey: HostContext.Keys.aiConsent) as? Bool
        flow = SettingsFlow(installationId: context.installationId, lastKnownAI: lastKnown)
    }

    var lastKnownAI: Bool? { context.defaults.object(forKey: HostContext.Keys.aiConsent) as? Bool }

    func send(_ event: SettingsFlow.Event) {
        for effect in flow.handle(event) { perform(effect) }
    }

    private func perform(_ effect: SettingsFlow.Effect) {
        switch effect {
        case let .call(call):
            perform(call)
        case let .openInSafari(url):
            context.open(url)
        case let .share(fileName, data):
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
            if (try? data.write(to: url, options: [.atomic, .completeFileProtection])) != nil {
                exported = ExportedFile(url: url)
            }
        case let .rememberAIConsent(given):
            context.defaults.set(given, forKey: HostContext.Keys.aiConsent)
        case .forgetSession:
            // The sign-out call has already ended the session; the root is back on sign-in.
            break
        case .forgetEverything:
            for key in [HostContext.Keys.aiConsent, HostContext.Keys.keptWords, HostContext.Keys.pendingInvite] {
                context.defaults.removeObject(forKey: key)
            }
            tasks.run { [context] in await context.api.session.logOut() }
        case .showDeletedLineOnSignIn:
            // Package gap (#128): copy.md has no deleted line on `signIn`; sign-in shows as it always does.
            break
        case let .retryDeviceRemovalAtNextSignIn(installationId):
            context.defaults.set(installationId, forKey: HostContext.Keys.deviceRemovalPending)
        case .endSession:
            tasks.run { [context] in await context.endSession() }
        }
    }

    private func perform(_ call: SettingsFlow.Call) {
        let api = context.api
        switch call {
        case .getMe:
            ai = .loading
            tasks.run {
                switch await api.getMe() {
                case .success:
                    // No `ai_consent` in the reply yet: nothing to show on the row.
                    self.ai = .empty
                case let .failure(failure):
                    self.ai = .failed(failure.loadFailure)
                    self.send(.meFailed(failure))
                }
            }
        case .withdrawConsent:
            // `DELETE /consent/ai` is not in the contract yet (#8): nothing is sent, and the row says it did not save.
            tasks.run { self.send(.withdrawFailed(APIClient.routeNotInContract)) }
        case .export:
            tasks.run {
                switch await api.export() {
                case let .success(data): self.send(.exported(data: data, at: Date()))
                case let .failure(failure): self.send(.exportFailed(failure))
                }
            }
        case let .removeDevice(installationId):
            tasks.run {
                switch await api.removeDevice(installationId: installationId) {
                case .success: self.send(.deviceRemoved)
                case let .failure(failure): self.send(.deviceRemovalFailed(failure))
                }
            }
        case .signOut:
            tasks.run {
                await api.session.logOut()
                self.send(.signOutFinished)
            }
        case .deleteAccount:
            tasks.run {
                switch await api.deleteAccount() {
                case .success: self.send(.accountDeleted)
                case let .failure(failure): self.send(.deleteFailed(failure))
                }
            }
        }
    }
}
