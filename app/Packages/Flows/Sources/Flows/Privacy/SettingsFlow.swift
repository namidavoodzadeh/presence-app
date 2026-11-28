import Foundation

/// Settings: AI, privacy, download, log out, delete account (packages/01/flows/privacy.md, second table).
public struct SettingsFlow: Equatable, Sendable {
    public enum State: Equatable, Sendable {
        case closed, open, withdrawing, aiConsent, exporting, loggingOut, confirming, deleting
        case loggedOut, deleted   // both show `signIn`
        case sessionEnded
    }

    /// Copy aiConsent.notSaved, settings.exportFailed, settings.notDeleted, settings.testAccount.
    public enum Line: Equatable, Sendable { case notSaved, exportFailed, notDeleted, testAccount }

    public enum Event: Equatable, Sendable {
        case pulled, touchedOutside
        case meLoaded(given: String?, requiredVersion: String), meFailed(CallFailure)
        case aiTapped, withdrawn, withdrawFailed(CallFailure)
        case privacyTapped
        case downloadTapped, exported(data: Data, at: Date), exportFailed(CallFailure)
        case logOutTapped, deviceRemoved, deviceRemovalFailed(CallFailure), signOutFinished
        case deleteTapped, cancelDeleteTapped, confirmDeleteTapped, accountDeleted, deleteFailed(CallFailure)
    }

    public enum Effect: Equatable, Sendable {
        case call(Call)
        case openInSafari(URL)
        case share(fileName: String, data: Data)
        case rememberAIConsent(Bool)
        case forgetSession
        case forgetEverything
        case showDeletedLineOnSignIn
        case retryDeviceRemovalAtNextSignIn(installationId: String)
        case endSession
    }

    public enum Call: Equatable, Sendable {
        case getMe, withdrawConsent, export, removeDevice(installationId: String), signOut, deleteAccount
    }

    public private(set) var state: State = .closed
    /// The AI row: true On, false Off, nil left out (GET /me failed).
    public private(set) var ai: Bool?
    public private(set) var line: Line?

    private let installationId: String
    private let timeZone: TimeZone
    private var deviceRemovalFailed = false

    public init(installationId: String, lastKnownAI: Bool? = nil, timeZone: TimeZone = .current) {
        self.installationId = installationId
        self.ai = lastKnownAI
        self.timeZone = timeZone
    }

    public mutating func handle(_ event: Event) -> [Effect] {
        switch (state, event) {
        // any view → open
        case (.closed, .pulled), (.aiConsent, .pulled):
            state = .open
            line = nil
            return [.call(.getMe)]

        case let (_, .meLoaded(given, required)) where state != .withdrawing && !isEnded:
            ai = given == required
            return []

        case let (_, .meFailed(failure)) where !isEnded:
            if failure.endsSession { return endSession() }
            if state != .withdrawing { ai = nil }
            return []

        case (.open, .touchedOutside):
            state = .closed
            line = nil
            return []

        // AI row
        case (.open, .aiTapped):
            switch ai {
            case true?:
                state = .withdrawing
                line = nil
                return [.call(.withdrawConsent)]
            case false?:
                state = .aiConsent
                line = nil
                return []
            case nil:
                return []   // the row is left out
            }

        case (.withdrawing, .withdrawn):
            state = .open
            ai = false
            return [.rememberAIConsent(false)]

        case let (.withdrawing, .withdrawFailed(failure)):
            if failure.endsSession { return endSession() }
            state = .open
            line = .notSaved
            return []

        case (.open, .privacyTapped):
            return [.openInSafari(privacyPolicyURL)]

        // Download
        case (.open, .downloadTapped):
            state = .exporting
            line = nil
            return [.call(.export)]

        case let (.exporting, .exported(data, at)):
            state = .open
            return [.share(fileName: exportFileName(at: at), data: data)]

        case let (.exporting, .exportFailed(failure)):
            if failure.endsSession { return endSession() }
            state = .open
            line = .exportFailed
            return []

        // Log out: either call may fail
        case (.open, .logOutTapped):
            state = .loggingOut
            line = nil
            deviceRemovalFailed = false
            return [.call(.removeDevice(installationId: installationId))]

        case (.loggingOut, .deviceRemoved):
            return [.call(.signOut)]

        case (.loggingOut, .deviceRemovalFailed):
            deviceRemovalFailed = true
            return [.call(.signOut)]

        case (.loggingOut, .signOutFinished):
            state = .loggedOut
            var effects: [Effect] = [.forgetSession]
            if deviceRemovalFailed {
                effects.append(.retryDeviceRemovalAtNextSignIn(installationId: installationId))
            }
            return effects

        // Delete account
        case (.open, .deleteTapped):
            state = .confirming
            line = nil
            return []

        case (.confirming, .cancelDeleteTapped):
            state = .open
            line = nil
            return []

        case (.confirming, .confirmDeleteTapped):
            state = .deleting
            line = nil
            return [.call(.deleteAccount)]

        case (.deleting, .accountDeleted):
            state = .deleted
            return [.forgetEverything, .showDeletedLineOnSignIn]

        case let (.deleting, .deleteFailed(failure)):
            if failure.endsSession { return endSession() }
            if case let .http(status: 403, _, reason?) = failure,
               reason == "preview_account" || reason == "example_account" {
                state = .open
                line = .testAccount
            } else {
                state = .confirming
                line = .notDeleted
            }
            return []

        default:
            return []   // dimmed, or not an event this state answers
        }
    }

    private var isEnded: Bool {
        state == .loggedOut || state == .deleted || state == .sessionEnded
    }

    private mutating func endSession() -> [Effect] {
        state = .sessionEnded
        return [.endSession]
    }

    private func exportFileName(at date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return "presence-\(formatter.string(from: date)).json"
    }
}
