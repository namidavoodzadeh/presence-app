import Contract
import Flows
import Foundation

/// Hosts `YouFlow` (flows/you.md): the list by kind and the kenning card's two calls.
@MainActor @Observable
final class YouHost {
    private(set) var flow = YouFlow()
    /// `moveToTalk`: the surface runs the pull back to Talk.
    @ObservationIgnored var moveToTalk: () -> Void = {}
    /// `sendInTalk`: the words are said to Talk.
    @ObservationIgnored var sayInTalk: (String) -> Void = { _ in }
    @ObservationIgnored let tasks = HostTasks()
    @ObservationIgnored private let context: HostContext

    init(context: HostContext) {
        self.context = context
    }

    func send(_ event: YouFlow.Event) {
        for effect in flow.handle(event) { perform(effect) }
    }

    private func perform(_ effect: YouFlow.Effect) {
        let api = context.api
        switch effect {
        case .call(.getItems):
            tasks.run {
                switch await api.getCommItems() {
                case let .success(reply): self.send(.itemsLoaded(reply.groups.map(Self.group)))
                case let .failure(failure): self.send(.itemsFailed(failure))
                }
            }
        case let .call(.getBelief(id)):
            tasks.run {
                switch await api.getBelief(id: id) {
                case let .success(reply):
                    self.send(.beliefLoaded(receipts: reply.receipts.map { YouFlow.Receipt(quote: $0.quote.nonEmpty, date: $0.said_at) }))
                case let .failure(failure):
                    self.send(.beliefFailed(failure))
                }
            }
        case let .call(.getVisibility(itemId)):
            tasks.run {
                switch await api.getVisibility(itemId: itemId) {
                case let .success(reply):
                    self.send(.visibilityLoaded(reply.people.map {
                        YouFlow.Visibility(person: YouFlow.Person(id: $0.person_id, name: $0.name), sees: $0.sees)
                    }))
                case let .failure(failure):
                    self.send(.visibilityFailed(failure))
                }
            }
        case let .haptic(haptic):
            context.haptic(haptic)
        case .moveToTalk:
            moveToTalk()
        case let .sendInTalk(words):
            sayInTalk(words)
        case .endSession:
            tasks.run { [context] in await context.endSession() }
        }
    }

    static func group(_ group: Components.Schemas.CommGroup) -> YouFlow.Group {
        YouFlow.Group(kind: group.kind, heading: group.heading, items: group.items.map {
            YouFlow.Item(id: $0.id, kind: $0.kind, wording: $0.wording)
        })
    }
}

/// The People slot: the rows of `GET /home`, most urgent first. There is no People flow in package 01's Flows yet
/// (flows/invite.md names its events); this host only loads the list and passes taps on.
@MainActor @Observable
final class PeopleHost {
    private(set) var list: LoadState<[PeopleScreen.Row]> = .loading
    /// A row tapped: Thread rises over People for that person.
    @ObservationIgnored var opened: (WriteSendFlow.Person) -> Void = { _ in }
    @ObservationIgnored let tasks = HostTasks()
    @ObservationIgnored private let context: HostContext
    @ObservationIgnored private var people: [WriteSendFlow.Person] = []
    @ObservationIgnored var now: () -> Date = { Date() }
    @ObservationIgnored var calendar = Calendar.current

    init(context: HostContext) {
        self.context = context
    }

    func load() {
        if case .loaded = list {} else { list = .loading }
        let api = context.api
        tasks.run {
            switch await api.getHome() {
            case let .success(home):
                let rows = home.people.reversed().compactMap { row -> (WriteSendFlow.Person, PeopleScreen.Row)? in
                    guard let person = row.person, !person.deleted else { return nil }
                    return (WriteSendFlow.Person(id: person.id, name: person.name),
                            PeopleRows.row(row, person: person, now: self.now(), calendar: self.calendar))
                }
                self.people = rows.map(\.0)
                self.list = .from(rows.map(\.1))
            case let .failure(failure):
                // A 401 has already ended the session (SessionMiddleware); the root shows sign-in.
                self.list = .failed(failure.loadFailure)
            }
        }
    }

    func send(_ event: PeopleScreen.Event) {
        switch event {
        case let .rowTapped(index):
            guard people.indices.contains(index) else { return }
            opened(people[index])
        case .someoneNewTapped:
            // Package gap (#128): Someone new is the invite flow (flows/invite.md), not built in Flows yet.
            break
        case .retryTapped:
            guard case let .failed(failure) = list, failure.canRetry else { return }
            load()
        }
    }
}

/// How a `GET /home` row is worded on People: the line, the time and the dot.
enum PeopleRows {
    static func row(_ row: Components.Schemas.HomeRow, person: Components.Schemas.PersonOrNull, now: Date, calendar: Calendar) -> PeopleScreen.Row {
        let at = row.activity_at.flatMap(APIClient.parseDate)
        let line: PeopleScreen.Row.Line = if row.unread > 0 {
            .unread(when: at.map { when($0, now: now, calendar: calendar) } ?? "")
        } else if row.draft {
            .draft
        } else {
            .nothing
        }
        return PeopleScreen.Row(
            id: person.id,
            name: person.name,
            line: line,
            time: at.map { time($0, now: now, calendar: calendar) },
            isNew: row.unread > 0
        )
    }

    /// "[time]": the clock today, the weekday this week, else the date.
    static func time(_ date: Date, now: Date, calendar: Calendar) -> String {
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(calendar.locale ?? .current))
        }
        if let days = calendar.dateComponents([.day], from: date, to: now).day, days < 7 {
            return date.formatted(Date.FormatStyle().weekday(.wide).locale(calendar.locale ?? .current))
        }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(calendar.locale ?? .current))
    }

    /// "[when]" in "A card, folded, from [when]": today, yesterday, the weekday, or the date.
    static func when(_ date: Date, now: Date, calendar: Calendar) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return "today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return "yesterday"
        }
        return time(date, now: now, calendar: calendar)
    }
}
