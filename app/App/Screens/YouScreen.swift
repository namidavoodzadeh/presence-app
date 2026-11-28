import DesignKit
import Flows
import SwiftUI

/// packages/01 `you`: You, as the list by kind (Y1 list).
/// Draws the list `YouFlow` holds and sends its events; no flow logic and no network calls here.
struct YouScreen: View {
    let list: LoadState<[YouFlow.Group]>
    let send: (YouFlow.Event) -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack(alignment: .topLeading) {
            Tokens.Colour.base.color(for: scheme).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Space.l) {
                    Text(YouCopy.title)
                        .font(Tokens.TypeScale.heading.font(relativeTo: .largeTitle))
                        .foregroundStyle(ink)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("you.title")
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, CGFloat(Tokens.Row.sideInset))
                .padding(.vertical, Space.l)
            }
        }
        .testerScreen("you")
    }

    private var ink: Color { Tokens.Colour.ink.color(for: scheme) }

    @ViewBuilder private var content: some View {
        switch list {
        case .loading:
            YouKnot()
                .frame(maxWidth: .infinity)
                .padding(.top, Space.xxl)
        case .empty:
            VStack(alignment: .leading, spacing: Space.m) {
                Text(YouCopy.empty)
                    .font(Tokens.TypeScale.message.font())
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("you.empty")
                Button { send(.talkTapped) } label: {
                    Text(YouCopy.talk)
                        .font(Tokens.TypeScale.rowName.font(relativeTo: .headline))
                        .foregroundStyle(ink)
                        .padding(.horizontal, CGFloat(Tokens.Row.paddingHorizontal))
                        .padding(.vertical, CGFloat(Tokens.Row.paddingVertical))
                        .frame(minWidth: CGFloat(Tokens.minTarget), minHeight: CGFloat(Tokens.minTarget))
                        .background(glass)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("you.talk")
            }
        case .failed(let failure):
            VStack(alignment: .leading, spacing: Space.m) {
                Text(YouCopy.unavailable)
                    .font(Tokens.TypeScale.message.font())
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("you.unavailable")
                if failure.canRetry {
                    Button { send(.retryTapped) } label: {
                        Text(YouCopy.retry)
                            .font(Tokens.TypeScale.rowName.font(relativeTo: .headline))
                            .foregroundStyle(ink)
                            .padding(.horizontal, CGFloat(Tokens.Row.paddingHorizontal))
                            .padding(.vertical, CGFloat(Tokens.Row.paddingVertical))
                            .frame(minWidth: CGFloat(Tokens.minTarget), minHeight: CGFloat(Tokens.minTarget))
                            .background(glass)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("you.retry")
                }
            }
        case .loaded(let groups):
            VStack(alignment: .leading, spacing: Space.l) {
                Text(YouCopy.line)
                    .font(Tokens.TypeScale.rowLine.font(relativeTo: .subheadline))
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("you.line")
                ForEach(Self.numbered(groups), id: \.group.kind) { entry in
                    group(entry.group, firstIndex: entry.firstIndex)
                }
            }
        }
    }

    private func group(_ group: YouFlow.Group, firstIndex: Int) -> some View {
        VStack(alignment: .leading, spacing: CGFloat(Tokens.Row.gap)) {
            HStack(spacing: Space.s) {
                Circle()
                    .fill(YouKind.colour(group.kind))
                    .frame(width: CGFloat(Tokens.Dot.size), height: CGFloat(Tokens.Dot.size))
                    .accessibilityHidden(true)
                Text(group.heading)
                    .font(Tokens.TypeScale.label.font(relativeTo: .subheadline))
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            ForEach(Array(group.items.enumerated()), id: \.element.id) { offset, item in
                Button { send(.itemTapped(item)) } label: {
                    Text(item.wording)
                        .font(Tokens.TypeScale.message.font())
                        .foregroundStyle(ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, minHeight: CGFloat(Tokens.minTarget), alignment: .leading)
                        .padding(.horizontal, CGFloat(Tokens.Row.paddingHorizontal))
                        .padding(.vertical, CGFloat(Tokens.Row.paddingVertical))
                        .background(glass)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("you.item.\(firstIndex + offset)")
            }
        }
    }

    private var glass: some View {
        RoundedRectangle(cornerRadius: CGFloat(Tokens.Row.radius), style: .continuous)
            .fill(Tokens.Colour.glassFill.color(for: scheme))
            .overlay(
                RoundedRectangle(cornerRadius: CGFloat(Tokens.Row.radius), style: .continuous)
                    .stroke(Tokens.Colour.glassEdge.color(for: scheme), lineWidth: CGFloat(Tokens.HandDrawn.stroke.lowerBound))
            )
    }

    /// Items are numbered across the whole list, from 0, so `you.item.N` is stable for a given list.
    static func numbered(_ groups: [YouFlow.Group]) -> [(group: YouFlow.Group, firstIndex: Int)] {
        var next = 0
        return groups.map { group in
            defer { next += group.items.count }
            return (group, next)
        }
    }
}

/// The knot where the list goes while it loads (a still mark; `wait.a11y` reads "Loading").
private struct YouKnot: View {
    var body: some View {
        Circle()
            .stroke(Tokens.Colour.apricot.day.color, lineWidth: CGFloat(Tokens.HandDrawn.stroke.upperBound))
            .frame(width: CGFloat(Tokens.Ring.size), height: CGFloat(Tokens.Ring.size))
            .accessibilityElement()
            .accessibilityLabel(YouCopy.waiting)
            .accessibilityIdentifier("you.loading")
    }
}

/// The colour tick for a server kind (`next/engine/comm.ts` COMM_KIND_ORDER).
enum YouKind {
    static func colour(_ kind: String) -> Color {
        let colour: Tokens.KindColour = switch kind {
        case "how_i_mean": .howIMeanThings
        case "feels_like_care": .whatFeelsLikeCare
        case "bring_up": .howToBringSomethingUp
        case "lands_hard": .whatLandsHard
        case "gets_heated": .whenItGetsHeated
        case "coming_back": .comingBackAfter
        case "matters": .whatMattersToMe
        default: .otherThingsAboutMe
        }
        return colour.color
    }
}

/// packages/01/copy.md, `you` (and `wait.a11y`). The kind headings and item words come from the server.
enum YouCopy {
    static let title = "You"
    static let line = "Something true about you, in your words. You choose who sees it."
    static let empty = "Say one thing that's true for you. It stays here until you share it."
    static let talk = "Talk"
    static let unavailable = "Your kennings can't be shown right now."
    static let retry = "Try again"
    static let waiting = "Loading"
}

#Preview("Loaded") {
    YouScreen(list: .loaded([
        YouFlow.Group(kind: "how_i_mean", heading: "How I mean things", items: [
            YouFlow.Item(id: "1", kind: "how_i_mean", wording: "When I go quiet I'm thinking, not upset."),
        ]),
    ]), send: { _ in })
}
#Preview("Empty") { YouScreen(list: .empty, send: { _ in }) }
#Preview("Failed") { YouScreen(list: .failed(LoadFailure(kind: .offline)), send: { _ in }) }
