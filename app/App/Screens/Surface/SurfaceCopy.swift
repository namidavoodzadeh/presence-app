import Flows

/// packages/01/copy.md, "The talk bar" and "Shared". Byte for byte.
enum SurfaceCopy {
    static let placeholderTalk = "Say what's on your mind"
    static func placeholderThread(_ name: String) -> String { "Write to \(name)" }
    static let micTalk = "Talk"
    static let micStop = "Stop"
    static let send = "Send"
    static let edgeLeft = "Your kennings"
    static let edgeRight = "Your people"
    static let toYou = "Show your kennings"
    static let toPeople = "Show people"
    static let toTalk = "Back to talk"
    static let wait = "Loading"
    static let retry = "Try again"
    /// copy.md has no VoiceOver label for `pull.mark` (package gap, recorded on #21): the screen's own name.
    static let pullMark = "Settings"

    static func placeholder(_ placeholder: SurfaceFlow.Placeholder) -> String {
        switch placeholder {
        case .talk: placeholderTalk
        case let .thread(name): placeholderThread(name)
        }
    }

    static func action(_ action: SurfaceFlow.Action) -> String {
        switch action {
        case .toYou: toYou
        case .toPeople: toPeople
        case .toTalk: toTalk
        }
    }
}
