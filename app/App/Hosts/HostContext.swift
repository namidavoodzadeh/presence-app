import Flows
import Foundation
import UIKit

/// What every host shares: the one `APIClient`, and the few things the app does outside a flow (open a link, play a
/// haptic, keep words on the phone). The root sets the hooks; tests replace them.
@MainActor
final class HostContext {
    let api: APIClient
    let defaults: UserDefaults
    var open: (URL) -> Void = { UIApplication.shared.open($0) }
    var haptic: (Haptic) -> Void = { SurfaceModel.play($0) }
    /// flows/README.md: words not yet through when a session ends stay on the phone.
    var keepWords: (String) -> Void = { _ in }
    /// The person's first name, from the sign-in reply or `GET /me`, for Talk's greeting.
    var firstName: String?

    init(api: APIClient, defaults: UserDefaults = .standard) {
        self.api = api
        self.defaults = defaults
    }

    /// This phone's id for `DELETE /devices/apns/{installation_id}`, made once and kept.
    var installationId: String {
        if let kept = defaults.string(forKey: Keys.installationId) { return kept }
        let made = UUID().uuidString
        defaults.set(made, forKey: Keys.installationId)
        return made
    }

    func endSession() async {
        await api.session.end()
    }

    enum Keys {
        static let installationId = "presence.installationId"
        static let keptWords = "presence.keptWords"
        static let pendingInvite = "presence.pendingInvite"
        static let aiConsent = "presence.aiConsent"
        static let askLineShown = "presence.askLineShown."
        static let deviceRemovalPending = "presence.deviceRemovalPending"
    }
}

/// The calls a host started. Each host hands its work here, so a test can wait until every call the flow asked for
/// has answered and its answer has reached the flow (`settle`).
@MainActor
final class HostTasks {
    private var running: [Int: Task<Void, Never>] = [:]
    private var next = 0

    @discardableResult
    func run(_ work: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let id = next
        next += 1
        let task = Task { @MainActor [weak self] in
            await work()
            self?.running[id] = nil
        }
        running[id] = task
        return task
    }

    /// Waits until no work is left, including work that answers started.
    func settle() async {
        while let task = running.values.first {
            await task.value
        }
    }
}

extension String {
    /// The first word of a name, for the greeting.
    var firstWord: String? {
        split(separator: " ").first.map(String.init)
    }
}
