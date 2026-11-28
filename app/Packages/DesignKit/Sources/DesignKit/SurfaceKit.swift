import Foundation
import SwiftUI

// Shared pieces of the one surface (packages/01/screens.md "One surface, not pages"; tokens.md).
// Views use these by name; every value comes from `Tokens`.

public extension Tokens {
    /// Sizes the surface needs that tokens.md does not give (package gap, recorded on #21):
    /// the simplest values consistent with the package, kept here so no screen types them.
    enum Surface {
        /// The hand-drawn pull mark at the top: one short stroke.
        public static let pullMarkWidth: Double = 36
        /// Distance of the pull mark from the top safe edge.
        public static let pullMarkTop: Double = 6
        /// The waiting knot's drawn size.
        public static let knotSize: Double = 28
        /// The mic and send symbols inside their 40 pt circle.
        public static let barSymbol = TypeStyle(weight: 600...600, size: 17...17, tracking: nil)
        /// Text inset inside the bar.
        public static let barTextInset: Double = 18
        /// Inset of the mic and send from the bar's trailing end ((56 − 40) ÷ 2).
        public static let barControlInset: Double = 8
    }
}

// MARK: Hand-drawn

/// One stroke, `sk()` from the prototype: resample every 5 pt, two slow sine waves, amplitude 0.75 pt, seeded,
/// so each mark is the same every time.
public enum HandDrawnStroke {
    /// Resamples `points` every `Tokens.HandDrawn.resampleStep` and moves each sample along the normal
    /// by two slow sine waves of `Tokens.HandDrawn.amplitude` in total.
    public static func wobble(_ points: [CGPoint], seed: UInt64) -> [CGPoint] {
        guard points.count > 1 else { return points }
        var rng = Seeded(seed)
        let phase1 = rng.unit() * 2 * .pi, phase2 = rng.unit() * 2 * .pi
        let length1 = 40 + rng.unit() * 40, length2 = 90 + rng.unit() * 60
        let amplitude = Tokens.HandDrawn.amplitude / Double(Tokens.HandDrawn.waveCount)
        var out: [CGPoint] = []
        var travelled = 0.0
        for (a, b) in zip(points, points.dropFirst()) {
            let dx = b.x - a.x, dy = b.y - a.y
            let segment = max(hypot(dx, dy), 0.0001)
            let steps = max(Int((segment / Tokens.HandDrawn.resampleStep).rounded(.up)), 1)
            let nx = -dy / segment, ny = dx / segment
            for step in 0..<steps {
                let t = Double(step) / Double(steps)
                let s = travelled + segment * t
                let offset = amplitude * (sin(s / length1 * 2 * .pi + phase1) + sin(s / length2 * 2 * .pi + phase2))
                out.append(CGPoint(x: a.x + dx * t + nx * offset, y: a.y + dy * t + ny * offset))
            }
            travelled += segment
        }
        out.append(points[points.count - 1])
        return out
    }

    public static func path(_ points: [CGPoint], seed: UInt64) -> Path {
        var path = Path()
        let wobbled = wobble(points, seed: seed)
        guard let first = wobbled.first else { return path }
        path.move(to: first)
        for point in wobbled.dropFirst() { path.addLine(to: point) }
        return path
    }

    /// A small deterministic generator (SplitMix64).
    struct Seeded {
        var state: UInt64
        init(_ seed: UInt64) { state = seed }
        mutating func next() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
        mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
    }
}

/// A short hand-drawn line across its rect (the pull mark, underlines).
public struct HandDrawnLine: Shape {
    public var seed: UInt64
    public init(seed: UInt64) { self.seed = seed }
    public func path(in rect: CGRect) -> Path {
        HandDrawnStroke.path([CGPoint(x: rect.minX, y: rect.midY), CGPoint(x: rect.maxX, y: rect.midY)], seed: seed)
    }
}

/// The hand-drawn knot: the mark for "something on its way". One stroke that loops once around itself.
public struct KnotShape: Shape {
    public init() {}
    public func path(in rect: CGRect) -> Path {
        let r = min(rect.width, rect.height) / 2
        let c = CGPoint(x: rect.midX, y: rect.midY)
        var points: [CGPoint] = []
        // A trefoil-like loop: in from the left, round once, out to the right.
        let turns = 48
        for i in 0...turns {
            let t = Double(i) / Double(turns) * 2 * .pi
            let x = sin(t) + 2 * sin(2 * t)
            let y = cos(t) - 2 * cos(2 * t)
            points.append(CGPoint(x: c.x + r * x / 3.1, y: c.y + r * y / 3.1))
        }
        return HandDrawnStroke.path(points, seed: 21)
    }
}

/// The knot, in apricot, at the hand-drawn stroke. `label` is the view's `wait.a11y` string.
public struct Knot: View {
    let label: String
    public init(label: String) { self.label = label }
    public var body: some View {
        KnotShape()
            .stroke(Tokens.Colour.apricotDeep.day.color, style: StrokeStyle(
                lineWidth: Tokens.HandDrawn.stroke.upperBound, lineCap: .round, lineJoin: .round
            ))
            .frame(width: Tokens.Surface.knotSize, height: Tokens.Surface.knotSize)
            .accessibilityElement()
            .accessibilityLabel(label)
    }
}

// MARK: Greenhouse and glass

/// The greenhouse under the frosted curtain. The pre-rendered greenhouse layers are not in the repository yet,
/// so this paints the base, the top glow and the curtain tint (tokens.md), which the layers sit between.
public struct Greenhouse: View {
    @Environment(\.colorScheme) private var scheme
    /// Camera offset for the view in front (`Tokens.Greenhouse.camera*`).
    let camera: Double

    public init(camera: Double = Tokens.Greenhouse.cameraTalk) { self.camera = camera }

    public var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let glow = scheme == .dark ? Tokens.NightLight.glow : Tokens.DayLight.glow
            let tint = scheme == .dark ? Tokens.Curtain.nightTint : Tokens.Curtain.dayTint
            ZStack {
                Tokens.Colour.base.color(for: scheme)
                Ellipse()
                    .fill(RadialGradient(
                        colors: [glow.color, glow.color.opacity(0)],
                        center: .center, startRadius: 0,
                        endRadius: size.width * Tokens.DayLight.glowWidthFraction / 2
                    ))
                    .frame(
                        width: size.width * Tokens.DayLight.glowWidthFraction * 2,
                        height: size.height * Tokens.DayLight.glowHeightFraction * 2
                    )
                    .position(x: size.width / 2 + camera * Tokens.Greenhouse.layerFactorLights, y: 0)
                LinearGradient(colors: tint.map(\.color), startPoint: .top, endPoint: .bottom)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// The glass recipe (tokens.md "glass"): blur, a top-to-bottom white fill, a bright top edge and a soft ink shadow.
public struct GlassBackground: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let radius: Double

    public func body(content: Content) -> some View {
        let fill = scheme == .dark ? Tokens.Glass.nightFill : Tokens.Glass.dayFill
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                shape.fill(.ultraThinMaterial)
                    .overlay(shape.fill(LinearGradient(colors: fill.map(\.color), startPoint: .top, endPoint: .bottom)))
                    .overlay(
                        shape.strokeBorder(
                            LinearGradient(
                                colors: [Tokens.Colour.glassEdge.color(for: scheme), .clear],
                                startPoint: .top, endPoint: .center
                            ),
                            lineWidth: Tokens.Glass.topEdge
                        )
                    )
                    .shadow(
                        color: Tokens.Colour.ink.day.color.opacity(Tokens.Glass.shadowInkOpacity * shadowScale),
                        radius: Tokens.Glass.shadowBlur / 2, x: 0, y: Tokens.Glass.shadowY
                    )
            }
    }

    /// The shadow's −16 pt spread has no SwiftUI equivalent; a lighter shadow stands in for it.
    private var shadowScale: Double { 0.5 }
}

public extension View {
    func glass(radius: Double) -> some View { modifier(GlassBackground(radius: radius)) }

    /// A Tokens type style, scaling with Dynamic Type.
    func typeStyle(_ style: Tokens.TypeStyle, relativeTo textStyle: Font.TextStyle = .body) -> some View {
        font(style.font(relativeTo: textStyle)).tracking(style.trackingPoints)
    }
}
