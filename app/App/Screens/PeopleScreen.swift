import DesignKit
import Flows
import SwiftUI

/// packages/01 `people`: Your people (H1).
/// Draws the list its flow holds and sends taps as events; no flow logic and no network calls here.
/// The rows come already ordered (most urgent first) and their time already worded; the screen only draws them.
struct PeopleScreen: View {
    /// One person on the list, as drawn: name, the line under it, the time, and the dot.
    struct Row: Equatable, Sendable {
        enum Line: Equatable, Sendable {
            /// `people.lineUnread`: a folded card is waiting; `when` fills "[when]".
            case unread(when: String)
            /// `people.lineDraft`: words started and not sent.
            case draft
            /// `people.lineNothing`.
            case nothing
        }

        let id: String
        let name: String
        let line: Line
        /// "[time]", already worded; nil when there has been no activity.
        let time: String?
        /// The apricot dot shows.
        let isNew: Bool
    }

    /// The taps the view sends; named as `PeopleFlow.Event` names them (flows/invite.md, "People").
    enum Event: Equatable, Sendable {
        case rowTapped(Int)
        case someoneNewTapped
        case retryTapped
    }

    let list: LoadState<[Row]>
    let send: (Event) -> Void

    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ZStack(alignment: .topLeading) {
            Tokens.Colour.base.color(for: scheme).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Space.l) {
                    Text(PeopleCopy.title)
                        .font(Tokens.TypeScale.heading.font(relativeTo: .largeTitle))
                        .foregroundStyle(ink)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("people.title")
                    content
                    someoneNew
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, CGFloat(Tokens.Row.sideInset))
                .padding(.vertical, Space.l)
            }
        }
        .testerScreen("people")
    }

    private var ink: Color { Tokens.Colour.ink.color(for: scheme) }

    @ViewBuilder private var content: some View {
        switch list {
        case .loading:
            PeopleKnot()
                .frame(maxWidth: .infinity)
                .padding(.vertical, Space.xxl)
        case .empty:
            // Only "Someone new".
            EmptyView()
        case .failed(let failure):
            VStack(alignment: .leading, spacing: Space.m) {
                Text(PeopleCopy.unavailable)
                    .font(Tokens.TypeScale.message.font())
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("people.unavailable")
                if failure.canRetry {
                    Button { send(.retryTapped) } label: {
                        quietWord(PeopleCopy.retry)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("people.retry")
                }
            }
        case .loaded(let rows):
            VStack(alignment: .leading, spacing: CGFloat(Tokens.Row.gap)) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    Button { send(.rowTapped(index)) } label: { label(for: row) }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(PeopleCopy.a11y(row))
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("people.row.\(index)")
                }
            }
        }
    }

    private func label(for row: Row) -> some View {
        let stacked = typeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.xs))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: Space.s))
        return HStack(alignment: .center, spacing: Space.m) {
            layout {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(row.name)
                        .font(Tokens.TypeScale.rowName.font(relativeTo: .headline))
                        .foregroundStyle(ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(PeopleCopy.line(row.line))
                        .font(Tokens.TypeScale.rowLine.font(relativeTo: .subheadline))
                        .foregroundStyle(ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !stacked { Spacer(minLength: Space.s) }
                if let time = row.time {
                    Text(time)
                        .font(Tokens.TypeScale.rowLine.font(relativeTo: .subheadline))
                        .foregroundStyle(ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if row.isNew {
                Circle()
                    .fill(Tokens.Colour.apricot.color(for: scheme))
                    .frame(width: CGFloat(Tokens.Dot.size), height: CGFloat(Tokens.Dot.size))
                    .shadow(color: Tokens.Colour.apricot.color(for: scheme), radius: CGFloat(Tokens.Dot.size) / 2)
                    .accessibilityHidden(true)
            }
        }
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, minHeight: CGFloat(Tokens.minTarget), alignment: .leading)
        .padding(.horizontal, CGFloat(Tokens.Row.paddingHorizontal))
        .padding(.vertical, CGFloat(Tokens.Row.paddingVertical))
        .background(glass)
        .contentShape(Rectangle())
    }

    /// "Someone new" shows in every state.
    private var someoneNew: some View {
        Button { send(.someoneNewTapped) } label: {
            quietWord(PeopleCopy.new)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("people.new")
    }

    private func quietWord(_ text: String) -> some View {
        Text(text)
            .font(Tokens.TypeScale.rowName.font(relativeTo: .headline))
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, CGFloat(Tokens.Row.paddingHorizontal))
            .padding(.vertical, CGFloat(Tokens.Row.paddingVertical))
            .frame(minWidth: CGFloat(Tokens.minTarget), minHeight: CGFloat(Tokens.minTarget))
            .background(glass)
    }

    private var glass: some View {
        RoundedRectangle(cornerRadius: CGFloat(Tokens.Row.radius), style: .continuous)
            .fill(Tokens.Colour.glassFill.color(for: scheme))
            .overlay(
                RoundedRectangle(cornerRadius: CGFloat(Tokens.Row.radius), style: .continuous)
                    .stroke(Tokens.Colour.glassEdge.color(for: scheme), lineWidth: CGFloat(Tokens.HandDrawn.stroke.lowerBound))
            )
    }
}

/// The knot where the list goes while it loads (a still mark; `wait.a11y` reads "Loading").
private struct PeopleKnot: View {
    var body: some View {
        Circle()
            .stroke(Tokens.Colour.apricot.day.color, lineWidth: CGFloat(Tokens.HandDrawn.stroke.upperBound))
            .frame(width: CGFloat(Tokens.Ring.size), height: CGFloat(Tokens.Ring.size))
            .accessibilityElement()
            .accessibilityLabel(PeopleCopy.waiting)
            .accessibilityIdentifier("people.loading")
    }
}

/// packages/01/copy.md, `people` (and `wait.a11y`). Names and times come from the server.
enum PeopleCopy {
    static let title = "Your people"
    static let lineUnread = "A card, folded, from [when]"
    static let lineDraft = "You started writing"
    static let lineNothing = "Nothing open"
    static let new = "Someone new"
    static let unavailable = "Your people can't be shown right now."
    static let retry = "Try again"
    static let waiting = "Loading"
    /// `people.row.a11y`: "[Name], [line], [time]; plus "new" when the dot shows".
    static let newWord = "new"

    static func line(_ line: PeopleScreen.Row.Line) -> String {
        switch line {
        case let .unread(when): lineUnread.replacingOccurrences(of: "[when]", with: when)
        case .draft: lineDraft
        case .nothing: lineNothing
        }
    }

    static func a11y(_ row: PeopleScreen.Row) -> String {
        var parts = [row.name, line(row.line)]
        if let time = row.time { parts.append(time) }
        if row.isNew { parts.append(newWord) }
        return parts.joined(separator: ", ")
    }
}

#if DEBUG
#Preview("Loaded") { PeopleScreen(list: .loaded(PeopleFixtures.rows), send: { _ in }) }
#Preview("Empty") { PeopleScreen(list: .empty, send: { _ in }) }
#Preview("Failed") { PeopleScreen(list: .failed(LoadFailure(kind: .offline)), send: { _ in }) }
#endif
