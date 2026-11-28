import DesignKit
import Flows
import SwiftUI
import UIKit

/// Holds the surface's state machine for the views on it. No logic of its own: events go to `SurfaceFlow`,
/// effects go to `perform`.
@MainActor @Observable
final class SurfaceModel {
    private(set) var flow: SurfaceFlow
    /// The effects the screen does not perform itself (send, listening). Set by whoever hosts the surface.
    @ObservationIgnored var perform: (SurfaceFlow.Effect) -> Void = { _ in }

    init(_ flow: SurfaceFlow = SurfaceFlow()) { self.flow = flow }

    func send(_ event: SurfaceFlow.Event) {
        for effect in flow.handle(event) {
            switch effect {
            case let .haptic(haptic): Self.play(haptic)
            case .startListening, .stopListening, .send: perform(effect)
            }
        }
    }

    /// Also plays the haptics other flows ask for (the hosts, #128).
    static func play(_ haptic: Haptic) {
        switch haptic {
        case .lightTap: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case .softTick: UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        case .doubleSoftPulse:
            let generator = UIImpactFeedbackGenerator(style: .soft)
            generator.impactOccurred()
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(120))
                generator.impactOccurred()
            }
        case .firm: UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        }
    }
}

/// packages/01/screens.md, "One surface, not pages" and "Everywhere": four views on one frosted pane over the
/// greenhouse (Talk home, You from the left, People from the right, Thread rising over People), the talk bar at the
/// bottom of all of them, the edge lights on Talk and the pull mark at the top. Each view's own content comes from
/// its screen; Settings is drawn over the surface while open.
struct Surface<Content: View, Settings: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    let model: SurfaceModel
    @ViewBuilder let content: (SurfaceFlow.View) -> Content
    @ViewBuilder let settings: () -> Settings

    @GestureState private var drag: CGSize = .zero
    @State private var breathing = false

    private var flow: SurfaceFlow { model.flow }

    var body: some View {
        ZStack {
            Greenhouse(camera: camera)
                .animation(cameraAnimation, value: flow.view)
            GeometryReader { proxy in
                VStack(spacing: Space.none) {
                    pane
                    // 24 pt from the bottom, or the safe edge (home indicator, keyboard) when that is higher.
                    TalkBar(flow: flow, send: model.send)
                        .padding(.bottom, max(Tokens.Bar.bottomInset - proxy.safeAreaInsets.bottom, Space.none))
                }
            }
            if flow.edgesShown { edges }
            pullMark
            if flow.settingsOpen { settingsLayer }
        }
        .simultaneousGesture(pullGesture)
    }

    // MARK: The pane

    private var pane: some View {
        ZStack {
            content(flow.view)
                .id(flow.view)
                .transition(transition(for: flow.view))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .offset(x: followOffset)
        .animation(viewAnimation, value: flow.view)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(Self.name(flow.view))
        .pullActions(flow.actions, send: model.send)
    }

    static func name(_ view: SurfaceFlow.View) -> String {
        switch view {
        case .talk: "talk"
        case .you: "you"
        case .people: "people"
        case .thread: "thread"
        }
    }

    private func transition(for view: SurfaceFlow.View) -> AnyTransition {
        if reduceMotion { return .opacity }
        switch view {
        case .talk: return .opacity
        case .you: return .move(edge: .leading).combined(with: .opacity)
        case .people: return .move(edge: .trailing).combined(with: .opacity)
        case .thread: return .move(edge: .bottom).combined(with: .opacity)
        }
    }

    private var camera: Double {
        switch flow.view {
        case .talk: Tokens.Greenhouse.cameraTalk
        case .you: Tokens.Greenhouse.cameraYou
        case .people: Tokens.Greenhouse.cameraPeople
        case .thread: Tokens.Greenhouse.cameraThread
        }
    }

    private var viewAnimation: Animation {
        reduceMotion
            ? .easeInOut(duration: Tokens.Motion.reduceMotionCrossFade)
            : Tokens.Motion.layerCurve.animation(duration: Tokens.Motion.layerSettles)
    }

    private var cameraAnimation: Animation? {
        reduceMotion ? nil : Tokens.Motion.cameraCurve.animation(duration: Tokens.Motion.cameraSettles)
    }

    // MARK: Pulls

    /// The pane follows the finger while a sideways pull is under way and the view has a pull that way.
    private var followOffset: Double {
        let dx = drag.width, dy = drag.height
        guard !reduceMotion, SurfaceFlow.Gesture.isSideways(dx: dx, dy: dy),
              SurfaceFlow.destination(from: flow.view, pulling: dx > 0 ? .right : .left) != nil
        else { return 0 }
        return (dx > 0 ? 1 : -1) * Tokens.Motion.pullProgress(distance: abs(dx)) * Tokens.Motion.pullCommit
    }

    private var pullGesture: some Gesture {
        DragGesture(minimumDistance: SurfaceFlow.Gesture.start, coordinateSpace: .global)
            .updating($drag) { value, state, _ in state = value.translation }
            .onEnded { value in
                guard let direction = SurfaceFlow.Gesture.release(
                    startY: value.startLocation.y, dx: value.translation.width, dy: value.translation.height
                ) else { return }
                model.send(.pulled(direction))
            }
    }

    // MARK: Edges and the pull mark

    private var edges: some View {
        HStack(spacing: Space.none) {
            edge(id: "edge.left", label: SurfaceCopy.edgeLeft, tones: Tokens.EdgeLight.left, event: .edgeLeft, alignment: .leading)
            Spacer(minLength: Space.none)
            edge(id: "edge.right", label: SurfaceCopy.edgeRight, tones: Tokens.EdgeLight.right, event: .edgeRight, alignment: .trailing)
        }
        .padding(.vertical, Tokens.EdgeLight.endInset)
        .ignoresSafeArea()
        .onAppear(perform: breathe)
    }

    private func edge(
        id: String, label: String, tones: [Tokens.Tone], event: SurfaceFlow.Event, alignment: Alignment
    ) -> some View {
        Button { model.send(event) } label: {
            // A straight 3 pt light (tokens.md "edgeLight"), on whole points so it draws the same every time.
            Rectangle()
                .fill(LinearGradient(colors: (tones.count > 1 ? tones : tones + tones).map(\.color), startPoint: .top, endPoint: .bottom))
                .frame(width: Tokens.EdgeLight.width)
                .opacity(Tokens.EdgeLight.opacity * (breathing ? Tokens.EdgeLight.opacity : 1))
                .padding(alignment == .leading ? .leading : .trailing, Tokens.EdgeLight.edgeInset)
                .frame(width: Tokens.minTarget, alignment: alignment)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .accessibilityIdentifier(id)
        .accessibilityLabel(label)
    }

    /// First launch: both edge lights breathe three times (2.4 s each). Not under Reduce Motion.
    private func breathe() {
        guard flow.edgesBreathe, !reduceMotion else { return }
        let half = Tokens.Motion.edgeLightsFirstLaunch / 2
        withAnimation(.easeInOut(duration: half).repeatCount(Tokens.Motion.edgeLightsFirstLaunchRepeats * 2, autoreverses: true)) {
            breathing = true
        }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(Tokens.Motion.edgeLightsFirstLaunch * Double(Tokens.Motion.edgeLightsFirstLaunchRepeats)))
            breathing = false
        }
    }

    private var pullMark: some View {
        VStack {
            Button { model.send(.pullMark) } label: {
                HandDrawnLine(seed: 7)
                    .stroke(Tokens.Colour.inkSoft.color(for: scheme), style: StrokeStyle(
                        lineWidth: Tokens.HandDrawn.stroke.upperBound, lineCap: .round
                    ))
                    .frame(width: Tokens.Surface.pullMarkWidth, height: Tokens.HandDrawn.stroke.upperBound)
                    .padding(.top, Tokens.Surface.pullMarkTop)
                    .frame(minWidth: Tokens.minTarget, minHeight: Tokens.minTarget, alignment: .top)
                    .contentShape(Rectangle())
            }
            .accessibilityIdentifier("pull.mark")
            .accessibilityLabel(SurfaceCopy.pullMark)
            .pullActions(flow.actions, send: model.send)
            Spacer()
        }
    }

    /// Settings over the surface. A touch anywhere outside its rows closes it.
    private var settingsLayer: some View {
        ZStack {
            Color.clear
                .contentShape(Rectangle())
                .ignoresSafeArea()
                .onTapGesture { model.send(.settingsClosed) }
                .accessibilityHidden(true)
            settings()
        }
    }
}

extension Surface where Settings == EmptyView {
    init(model: SurfaceModel, @ViewBuilder content: @escaping (SurfaceFlow.View) -> Content) {
        self.init(model: model, content: content, settings: { EmptyView() })
    }
}
