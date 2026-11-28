import DesignKit
import Flows
import SwiftUI

/// packages/01 `settings`: Settings (Y9, only the rows package 01 needs).
/// Draws what `SettingsFlow` holds and sends its events; no flow logic and no network calls here.
/// `ai` is the AI row's `GET /me` state (states.md): while loading the row reads `lastKnownAI`, when it fails
/// the row is left out and the other rows still work.
struct SettingsScreen: View {
    let state: SettingsFlow.State
    let ai: LoadState<Bool>
    var lastKnownAI: Bool?
    var line: SettingsFlow.Line?
    let send: (SettingsFlow.Event) -> Void

    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ZStack {
            ScrollView {
                rows
                    .disabled(dimmed)
                    .accessibilityHidden(confirming)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, CGFloat(Tokens.Row.sideInset))
                    .padding(.vertical, Space.xxl)
            }
            // A touch anywhere outside the rows closes Settings (screens.md); the rows' own taps win.
            .contentShape(Rectangle())
            .onTapGesture { send(.touchedOutside) }
            if confirming {
                // The confirming card over the dimmed rows (flows/privacy.md).
                ScrollView {
                    confirmCard
                        .padding(.horizontal, CGFloat(Tokens.Row.sideInset))
                        .padding(.vertical, Space.xxl)
                }
            }
        }
        .testerScreen("settings")
    }

    private var confirming: Bool { state == .confirming }

    /// behaviour.md: every row is dimmed while confirming and while busy.
    private var dimmed: Bool {
        switch state {
        case .open: false
        case .closed, .withdrawing, .aiConsent, .exporting, .loggingOut, .confirming, .deleting,
             .loggedOut, .deleted, .sessionEnded: true
        }
    }

    private var ink: Color { (dimmed ? Tokens.Colour.inkFaint : Tokens.Colour.ink).color(for: scheme) }

    @ViewBuilder private var rows: some View {
        VStack(alignment: .leading, spacing: CGFloat(Tokens.Row.gap)) {
            switch ai {
            case .loading:
                aiRow(lastKnownAI)
            case .empty, .failed:
                EmptyView()   // the AI row is left out; the other rows work
            case .loaded(let on):
                aiRow(on)
            }
            Text(SettingsCopy.aiLine)
                .typeStyle(Tokens.TypeScale.rowLine, relativeTo: .subheadline)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, CGFloat(Tokens.Row.paddingHorizontal))
                .accessibilityIdentifier("settings.aiLine")
            row(SettingsCopy.privacy, id: "settings.privacy", event: .privacyTapped)
            row(SettingsCopy.download, id: "settings.download", event: .downloadTapped)
            row(SettingsCopy.logOut, id: "settings.logOut", event: .logOutTapped)
            row(SettingsCopy.delete, id: "settings.delete", event: .deleteTapped)
            if let line, !confirming { lineText(line) }
            Text(SettingsCopy.close)
                .typeStyle(Tokens.TypeScale.rowLine, relativeTo: .subheadline)
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity)
                .padding(.top, Space.m)
                .accessibilityIdentifier("settings.close")
        }
    }

    private func aiRow(_ on: Bool?) -> some View {
        Button { send(.aiTapped) } label: {
            // At the accessibility sizes On/Off goes under the name, so neither word breaks.
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.xs))
                : AnyLayout(HStackLayout(spacing: Space.m))
            layout {
                Text(SettingsCopy.ai)
                    .typeStyle(Tokens.TypeScale.rowName, relativeTo: .headline)
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                if !typeSize.isAccessibilitySize { Spacer(minLength: Space.s) }
                if let on {
                    Text(SettingsCopy.drawn(on ? SettingsCopy.aiOn : SettingsCopy.aiOff))
                        .typeStyle(Tokens.TypeScale.rowLine, relativeTo: .subheadline)
                        .foregroundStyle(ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .layoutPriority(1)
                }
            }
            .rowShape(scheme)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SettingsCopy.ai)
        .accessibilityValue(on.map { $0 ? SettingsCopy.aiOn : SettingsCopy.aiOff } ?? "")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("settings.ai")
    }

    private func row(_ title: String, id: String, event: SettingsFlow.Event) -> some View {
        Button { send(event) } label: {
            Text(title)
                .typeStyle(Tokens.TypeScale.rowName, relativeTo: .headline)
                .foregroundStyle(ink)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .rowShape(scheme)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    private func lineText(_ line: SettingsFlow.Line, inset: Bool = true) -> some View {
        Text(SettingsCopy.text(for: line))
            .typeStyle(Tokens.TypeScale.message)
            .foregroundStyle(Tokens.Colour.ink.color(for: scheme))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, inset ? CGFloat(Tokens.Row.paddingHorizontal) : Space.none)
            .accessibilityIdentifier("settings.line")
    }

    /// One glass card: what goes and what stays, with "Delete" and "Keep my account", the same size (flows/privacy.md).
    private var confirmCard: some View {
        let busy = state == .deleting
        let cardInk = (busy ? Tokens.Colour.inkFaint : Tokens.Colour.ink).color(for: scheme)
        return VStack(alignment: .leading, spacing: Space.m) {
            Text(SettingsCopy.confirmTitle)
                .typeStyle(Tokens.TypeScale.threadName, relativeTo: .title2)
                .foregroundStyle(cardInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("settings.confirmTitle")
            Text(SettingsCopy.confirmBody)
                .typeStyle(Tokens.TypeScale.message)
                .foregroundStyle(cardInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("settings.confirmBody")
            if line == .notDeleted { lineText(.notDeleted, inset: false) }
            // Side by side; stacked at the accessibility sizes. Either way the same size.
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: Space.m))
                : AnyLayout(HStackLayout(alignment: .top, spacing: Space.m))
            layout { confirmButtons(cardInk) }
                .disabled(busy)
        }
        .padding(CGFloat(Tokens.Row.paddingHorizontal))
        .background {
            // Opaque under the glass, so the dimmed rows don't show through the card.
            RoundedRectangle(cornerRadius: CGFloat(Tokens.Card.radius.lowerBound), style: .continuous)
                .fill(Tokens.Colour.base.color(for: scheme))
            PlainGlass(radius: Tokens.Card.radius.lowerBound, scheme: scheme)
        }
    }

    @ViewBuilder private func confirmButtons(_ cardInk: Color) -> some View {
        confirmButton(SettingsCopy.confirmDelete, id: "settings.confirmDelete", event: .confirmDeleteTapped, ink: cardInk)
        confirmButton(SettingsCopy.cancelDelete, id: "settings.cancelDelete", event: .cancelDeleteTapped, ink: cardInk)
    }

    private func confirmButton(_ title: String, id: String, event: SettingsFlow.Event, ink: Color) -> some View {
        Button { send(event) } label: {
            Text(title)
                .typeStyle(Tokens.TypeScale.rowName, relativeTo: .headline)
                .foregroundStyle(ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: CGFloat(Tokens.minTarget))
                .padding(.vertical, CGFloat(Tokens.Row.paddingVertical))
                .background(PlainGlass(radius: Tokens.Row.radius, scheme: scheme))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }
}

private extension View {
    /// One Settings row: full width, at least the minimum target, on glass.
    func rowShape(_ scheme: ColorScheme) -> some View {
        frame(maxWidth: .infinity, minHeight: CGFloat(Tokens.minTarget), alignment: .leading)
            .padding(.horizontal, CGFloat(Tokens.Row.paddingHorizontal))
            .padding(.vertical, CGFloat(Tokens.Row.paddingVertical))
            .background(PlainGlass(radius: Tokens.Row.radius, scheme: scheme))
            .contentShape(Rectangle())
    }
}

/// The glass fill and edge the You rows use; it keeps the text's contrast measurable (no blur or shadow under it).
private struct PlainGlass: View {
    let radius: Double
    let scheme: ColorScheme

    var body: some View {
        RoundedRectangle(cornerRadius: CGFloat(radius), style: .continuous)
            .fill(Tokens.Colour.glassFill.color(for: scheme))
            .overlay(
                RoundedRectangle(cornerRadius: CGFloat(radius), style: .continuous)
                    .stroke(Tokens.Colour.glassEdge.color(for: scheme), lineWidth: CGFloat(Tokens.HandDrawn.stroke.lowerBound))
            )
    }
}

/// packages/01/copy.md, `settings` (and `aiConsent.notSaved`, the line when withdrawing fails).
enum SettingsCopy {
    static let ai = "Kenember's AI"
    static let aiOn = "On"
    static let aiOff = "Off"
    static let privacy = "Privacy policy"
    static let download = "Download your data"
    static let logOut = "Log out"
    static let delete = "Delete my account"
    static let close = "Touch anywhere to close"
    static let aiLine = "Kenember is an AI, not a person."
    static let confirmTitle = "Delete your account?"
    static let confirmBody = "Your kennings, your talks and your Mirror link go now. Cards you sent that were already opened stay with the people who read them, under \"Deleted account\". This can't be undone."
    static let confirmDelete = "Delete"
    static let cancelDelete = "Keep my account"
    static let notSaved = "Not saved. Try again."
    static let notDeleted = "Nothing was deleted. Try again."
    static let testAccount = "This is a test account, so it can't be deleted here."
    static let exportFailed = "Your data isn't ready to download. Try again."

    /// Manrope draws "ff" as one ligature glyph, and the accessibility audit then reads "Off" as clipped text.
    /// A zero-width non-joiner keeps the two f's apart when drawn; the row's accessibility value stays the plain word.
    static func drawn(_ word: String) -> String {
        word.replacingOccurrences(of: "ff", with: "f\u{200C}f")
    }

    static func text(for line: SettingsFlow.Line) -> String {
        switch line {
        case .notSaved: notSaved
        case .exportFailed: exportFailed
        case .notDeleted: notDeleted
        case .testAccount: testAccount
        }
    }
}

#Preview("Loaded") { SettingsScreen(state: .open, ai: .loaded(true), send: { _ in }) }
#Preview("Failed") { SettingsScreen(state: .open, ai: .failed(LoadFailure(kind: .offline)), send: { _ in }) }
#Preview("Confirming") { SettingsScreen(state: .confirming, ai: .loaded(true), send: { _ in }) }
