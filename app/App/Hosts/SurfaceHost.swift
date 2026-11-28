import Flows
import Foundation

/// The surface with its views' hosts (#21, screens.md "One surface, not pages"): Talk home, You, People, Thread, and
/// Settings from the pull mark. `SurfaceModel` holds `SurfaceFlow`; this host performs what it hands out (the bar's
/// words) and keeps the views' hosts in step with the view in front.
@MainActor @Observable
final class SurfaceHost {
    let model: SurfaceModel
    private(set) var talk: TalkHost
    let you: YouHost
    let people: PeopleHost
    let settings: SettingsHost
    /// Thread's person and its writing flow, while Thread is in front.
    private(set) var thread: WriteSendHost?
    /// The AI consent card over the surface: Talk was refused for consent, or the person tapped Turn on.
    private(set) var consent: AIConsentHost?
    @ObservationIgnored let tasks = HostTasks()
    @ObservationIgnored private let context: HostContext
    @ObservationIgnored private var started = false

    init(context: HostContext, aiConsentGiven: Bool = true, firstLaunch: Bool = false, keptWords: String? = nil) {
        self.context = context
        model = SurfaceModel(SurfaceFlow(firstLaunch: firstLaunch))
        talk = TalkHost(context: context, aiConsentGiven: aiConsentGiven)
        you = YouHost(context: context)
        people = PeopleHost(context: context)
        settings = SettingsHost(context: context)
        model.perform = { [weak self] effect in self?.perform(effect) }
        you.moveToTalk = { [weak self] in self?.model.send(.action(.toTalk)) }
        you.sayInTalk = { [weak self] words in self?.say(words) }
        people.opened = { [weak self] person in self?.open(person) }
        if let keptWords, !keptWords.isEmpty { model.send(.typed(keptWords)) }
    }

    /// Talk opens (its first question) and People loads behind it.
    func start() {
        guard !started else { return }
        started = true
        talk.enter()
        people.load()
    }

    // MARK: The surface's effects

    private func perform(_ effect: SurfaceFlow.Effect) {
        switch effect {
        case let .send(words, .thread):
            guard let thread else { return }
            thread.send(.wordsChanged(words))
            thread.send(.sendTapped)
        case let .send(words, _):
            say(words)
        case .startListening, .stopListening:
            // Package gap (#128): on-device dictation for the bar needs the microphone and speech strings in the
            // Release Info.plist, which only the tester builds carry; the bar shows listening and stops on a tap.
            break
        case .haptic:
            break   // the surface model plays its own haptics
        }
    }

    private func say(_ words: String) {
        tasks.run {
            let accepted = await self.talk.say(words)
            self.model.send(.sendFinished(accepted: accepted))
        }
    }

    private func open(_ person: WriteSendFlow.Person) {
        let host = WriteSendHost(context: context, person: person)
        thread = host
        model.send(.threadOpened(name: person.name))
        host.send(.entered)
    }

    // MARK: Following the view in front

    func viewChanged(from old: SurfaceFlow.View, to new: SurfaceFlow.View) {
        if old == .thread, new != .thread {
            thread?.send(.leftThread)
            thread = nil
        }
        switch new {
        case .you: you.send(.appeared)
        case .people: people.load()
        case .talk, .thread: break
        }
    }

    func settingsOpenChanged(_ open: Bool) {
        settings.send(open ? .pulled : .touchedOutside)
    }

    /// Settings' own events; when it closes, the surface closes it too.
    func sendSettings(_ event: SettingsFlow.Event) {
        settings.send(event)
        if settings.flow.state == .closed, model.flow.settingsOpen { model.send(.settingsClosed) }
    }

    // MARK: Safety and AI consent over Talk

    var safety: TalkFlow.Safety? {
        talk.flow.state == .safetyStop ? talk.flow.safety : nil
    }

    func sendSafety(_ event: SafetyScreen.Event) {
        switch event {
        case let .resourceTapped(index): talk.send(.resourceTapped(index))
        case .closeTapped: talk.send(.safetyClosed)
        }
    }

    /// Talk answered `403 ai_consent_required`, or `talk.turnOn` was tapped.
    func askForConsent() {
        guard consent == nil else { return }
        let host = AIConsentHost(context: context, requiredVersion: "")
        host.answered = { [weak self] given in self?.consentAnswered(given) }
        consent = host
    }

    func talkStateChanged() {
        if talk.flow.state == .aiConsent { askForConsent() }
    }

    private func consentAnswered(_ given: Bool) {
        consent = nil
        guard given else { return }
        if talk.flow.state == .aiConsent {
            talk.send(.consentGiven)
        } else if talk.flow.state == .declined {
            talk = TalkHost(context: context, aiConsentGiven: true)
            talk.enter()
        }
    }
}
