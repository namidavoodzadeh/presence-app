import Foundation

/// packages/01/screens.md, "One surface, not pages", and behaviour.md, the talk bar and edges.
/// Four views on one pane: Talk is home, You is pulled in from the left, People from the right,
/// Thread rises over People. The talk bar sits at the bottom of all of them; `pull.mark` opens Settings from any view.
/// No UI, no networking: what the bar sends and what the mic hears are effects the app performs.
public struct SurfaceFlow: Equatable, Sendable {
    public enum View: Equatable, Sendable { case talk, you, people, thread }

    /// Which way the finger travelled.
    public enum Direction: Equatable, Sendable { case left, right, down }

    /// Every pull also exists as a VoiceOver action (behaviour.md, Pulls).
    public enum Action: Equatable, Hashable, CaseIterable, Sendable {
        /// "Show your kennings".
        case toYou
        /// "Show people".
        case toPeople
        /// "Back to talk".
        case toTalk
    }

    /// The talk bar's columns in behaviour.md.
    public enum Bar: Equatable, Sendable { case empty, hasWords, listening, sending }

    public enum Placeholder: Equatable, Sendable {
        /// `bar.placeholderTalk`.
        case talk
        /// `bar.placeholderThread`, with the person's first name.
        case thread(name: String)
    }

    public enum Event: Equatable, Sendable {
        /// A drag released past the commit distance (see `Gesture`).
        case pulled(Direction)
        /// A VoiceOver action, or a flow moving the surface "as a pull, animated without a finger".
        case action(Action)
        /// `edge.left` / `edge.right`: run the pull to You / People.
        case edgeLeft, edgeRight
        /// `pull.mark`, or a drag down from the top 140 pt.
        case pullMark
        /// A touch outside the Settings rows.
        case settingsClosed
        /// A person opened from People: Thread rises over People.
        case threadOpened(name: String)
        case typed(String)
        /// `bar.mic`.
        case micTapped
        /// The words dictation produced; they land in the bar and nothing sends.
        case heard(String)
        /// `bar.send`.
        case sendTapped
        /// Talk's turn answered. `accepted`: the words left the bar.
        case sendFinished(accepted: Bool)
    }

    public enum Effect: Equatable, Sendable {
        case startListening
        case stopListening
        /// The bar's words, for the view they were sent from. The view's own flow takes it from here.
        case send(words: String, view: View)
        case haptic(Haptic)
    }

    public private(set) var view: View
    public private(set) var settingsOpen = false
    public private(set) var words = ""
    public private(set) var listening = false
    public private(set) var sending = false
    /// Thread's person, while Thread is in front.
    public private(set) var threadName: String?
    /// First launch: both edge lights breathe three times, until the first move.
    public private(set) var edgesBreathe: Bool

    public init(firstLaunch: Bool = false) {
        view = .talk
        edgesBreathe = firstLaunch
    }

    // MARK: What the surface shows

    /// The edge lights are shown on Talk.
    public var edgesShown: Bool { view == .talk }

    public var bar: Bar {
        if sending { return .sending }
        if listening { return .listening }
        return words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .empty : .hasWords
    }

    /// `bar.mic` shows while the bar is empty, and while listening (to stop).
    public var micShown: Bool { bar == .empty || bar == .listening }
    /// `bar.send` shows once the bar has words; dimmed while Talk sends.
    public var sendShown: Bool { bar == .hasWords || bar == .sending }
    public var sendEnabled: Bool { bar == .hasWords }
    public var fieldEditable: Bool { bar == .empty || bar == .hasWords }
    public var fieldHidden: Bool { bar == .listening }

    public var placeholder: Placeholder {
        if view == .thread, let threadName { return .thread(name: threadName) }
        return .talk
    }

    /// The VoiceOver actions the view in front offers, one per pull it allows.
    public var actions: [Action] { Self.actions(for: view) }

    public static func actions(for view: View) -> [Action] {
        switch view {
        case .talk: [.toYou, .toPeople]
        case .you: [.toTalk]
        case .people: [.toTalk]
        case .thread: [.toPeople]
        }
    }

    /// Where a pull in `direction` leads from `view`; nil when that view has no pull that way.
    public static func destination(from view: View, pulling direction: Direction) -> View? {
        switch (view, direction) {
        case (.talk, .right): .you
        case (.talk, .left): .people
        case (.you, .left): .talk
        case (.people, .right): .talk
        case (.thread, .right): .people
        default: nil
        }
    }

    static func destination(of action: Action) -> View {
        switch action {
        case .toYou: .you
        case .toPeople: .people
        case .toTalk: .talk
        }
    }

    // MARK: Events

    @discardableResult
    public mutating func handle(_ event: Event) -> [Effect] {
        switch event {
        case .pulled(.down):
            return handle(.pullMark)
        case let .pulled(direction):
            guard !settingsOpen, let next = Self.destination(from: view, pulling: direction) else { return [] }
            move(to: next)
            return []
        case let .action(action):
            guard !settingsOpen, actions.contains(action) else { return [] }
            move(to: Self.destination(of: action))
            return []
        case .edgeLeft:
            return edgesShown ? handle(.pulled(.right)) : []
        case .edgeRight:
            return edgesShown ? handle(.pulled(.left)) : []
        case .pullMark:
            settingsOpen = true
            return []
        case .settingsClosed:
            settingsOpen = false
            return []
        case let .threadOpened(name):
            threadName = name
            move(to: .thread)
            return []
        case let .typed(text):
            guard fieldEditable else { return [] }
            words = text
            return []
        case .micTapped:
            switch bar {
            case .empty:
                listening = true
                return [.startListening, .haptic(.lightTap)]
            case .listening:
                listening = false
                return [.stopListening]
            case .hasWords, .sending:
                return []
            }
        case let .heard(text):
            listening = false
            words = text
            return []
        case .sendTapped:
            guard sendEnabled else { return [] }
            let sent = words
            switch view {
            case .thread:
                return [.send(words: sent, view: .thread)]
            case .talk, .you, .people:
                // Words said on You or People are said to Talk: the surface goes home with them.
                move(to: .talk)
                sending = true
                return [.send(words: sent, view: .talk)]
            }
        case let .sendFinished(accepted):
            guard sending else { return [] }
            sending = false
            if accepted { words = "" }
            return []
        }
    }

    private mutating func move(to next: View) {
        if next != .thread { threadName = nil }
        view = next
        edgesBreathe = false
    }
}

extension SurfaceFlow {
    /// behaviour.md, Pulls: a drag starts after 10 pt sideways and more sideways than up or down;
    /// release past 90 pt commits, less springs back. A drag down from the top 140 pt opens Settings.
    public enum Gesture {
        public static let start: Double = 10
        public static let commit: Double = 90
        public static let topZone: Double = 140

        /// True once a drag has become a sideways pull.
        public static func isSideways(dx: Double, dy: Double) -> Bool {
            abs(dx) >= start && abs(dx) > abs(dy)
        }

        /// True once a drag from `startY` has become a pull down from the top.
        public static func isDown(startY: Double, dx: Double, dy: Double) -> Bool {
            startY <= topZone && dy >= start && dy > abs(dx)
        }

        /// The pull a released drag commits, or nil when it springs back.
        public static func release(startY: Double, dx: Double, dy: Double) -> Direction? {
            if isSideways(dx: dx, dy: dy), abs(dx) > commit { return dx > 0 ? .right : .left }
            if isDown(startY: startY, dx: dx, dy: dy), dy > commit { return .down }
            return nil
        }
    }
}
