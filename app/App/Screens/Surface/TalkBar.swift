import DesignKit
import Flows
import SwiftUI

/// The talk bar at the bottom of every view (behaviour.md, "The talk bar"): `bar.field`, `bar.mic`, `bar.send`.
struct TalkBar: View {
    @Environment(\.colorScheme) private var scheme
    let flow: SurfaceFlow
    let send: (SurfaceFlow.Event) -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: Space.s) {
            field
            if flow.micShown { mic }
            if flow.sendShown { sendButton }
        }
        .padding(.leading, Tokens.Surface.barTextInset)
        .padding(.trailing, Tokens.Surface.barControlInset)
        .padding(.vertical, Tokens.Surface.barControlInset / 2)
        .frame(minHeight: Tokens.Bar.emptyHeight)
        .glass(radius: Tokens.Bar.radius)
        .padding(.horizontal, Tokens.Bar.sideInset)
    }

    private var field: some View {
        TextField(
            "",
            text: Binding(get: { flow.words }, set: { send(.typed($0)) }),
            prompt: Text(SurfaceCopy.placeholder(flow.placeholder))
                .foregroundStyle(Tokens.Colour.inkSoft.color(for: scheme)),
            axis: .vertical
        )
        .lineLimit(1...Tokens.Bar.maxLines)
        .typeStyle(Tokens.TypeScale.message)
        .foregroundStyle(Tokens.Colour.ink.color(for: scheme))
        .tint(Tokens.Colour.apricotDeep.color(for: scheme))
        .disabled(!flow.fieldEditable)
        .opacity(flow.fieldHidden ? 0 : 1)
        .frame(minHeight: Tokens.minTarget)
        .accessibilityIdentifier("bar.field")
        .accessibilityLabel(SurfaceCopy.placeholder(flow.placeholder))
        .pullActions(flow.actions, send: send)
    }

    private var mic: some View {
        let listening = flow.bar == .listening
        return Button { send(.micTapped) } label: {
            Image(systemName: listening ? "mic.fill" : "mic")
                .typeStyle(Tokens.Surface.barSymbol)
                // The symbol stays inside its fixed circle; the large content viewer shows it bigger.
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .foregroundStyle(listening ? Tokens.Colour.rust.color(for: scheme) : Tokens.Colour.ink.color(for: scheme))
                .frame(width: Tokens.minTarget, height: Tokens.minTarget)
                .contentShape(Rectangle())
        }
        .accessibilityShowsLargeContentViewer()
        .accessibilityIdentifier("bar.mic")
        .accessibilityLabel(listening ? SurfaceCopy.micStop : SurfaceCopy.micTalk)
    }

    private var sendButton: some View {
        Button { send(.sendTapped) } label: {
            Image(systemName: "arrow.up")
                .typeStyle(Tokens.Surface.barSymbol)
                // The symbol stays inside its fixed circle; the large content viewer shows it bigger.
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .foregroundStyle(Tokens.Colour.ink.day.color)
                .frame(width: Tokens.Send.size, height: Tokens.Send.size)
                .background(Circle().fill(LinearGradient(
                    colors: Tokens.Send.gradient.map(\.color), startPoint: .top, endPoint: .bottom
                )))
                .frame(width: Tokens.minTarget, height: Tokens.minTarget)
                .contentShape(Rectangle())
        }
        .disabled(!flow.sendEnabled)
        .opacity(flow.sendEnabled ? 1 : Tokens.Colour.inkFaint.day.opacity)
        .accessibilityShowsLargeContentViewer()
        .accessibilityIdentifier("bar.send")
        .accessibilityLabel(SurfaceCopy.send)
    }
}

extension View {
    /// Every pull also exists as a VoiceOver action (behaviour.md, Pulls).
    func pullActions(_ actions: [SurfaceFlow.Action], send: @escaping (SurfaceFlow.Event) -> Void) -> some View {
        accessibilityActions {
            ForEach(actions, id: \.self) { action in
                Button(SurfaceCopy.action(action)) { send(.action(action)) }
            }
        }
    }
}
