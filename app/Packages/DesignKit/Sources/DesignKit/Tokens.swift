import Foundation
import SwiftUI

/// Package 01 tokens (packages/01/tokens.md): the greenhouse, the bar and glass, type, hand-drawn marks and motion.
/// Plain values so they test without a simulator; views use the names, never the numbers.
/// Sizes are in points, times in seconds.
public enum Tokens {
    // MARK: Value types

    /// One colour: a hex value at an opacity.
    public struct Tone: Equatable, Hashable, Sendable {
        public let hex: UInt32
        public let opacity: Double

        public init(_ hex: UInt32, _ opacity: Double = 1) {
            self.hex = hex
            self.opacity = opacity
        }

        public var color: Color { Color(hex: hex).opacity(opacity) }
    }

    /// A colour with a day value and a night value. Night follows the iPhone's appearance setting.
    public struct ModeColour: Equatable, Hashable, Sendable {
        public let day: Tone
        public let night: Tone

        public init(day: Tone, night: Tone) {
            self.day = day
            self.night = night
        }

        public func tone(for scheme: ColorScheme) -> Tone { scheme == .dark ? night : day }
        public func color(for scheme: ColorScheme) -> Color { tone(for: scheme).color }
    }

    /// A cubic Bézier timing curve.
    public struct Curve: Equatable, Hashable, Sendable {
        public let x1, y1, x2, y2: Double

        public init(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) {
            self.x1 = x1
            self.y1 = y1
            self.x2 = x2
            self.y2 = y2
        }

        public func animation(duration: Double) -> Animation {
            .timingCurve(x1, y1, x2, y2, duration: duration)
        }
    }

    /// A type style: Manrope weight and size (ranges where the package gives a range), tracking in em.
    public struct TypeStyle: Equatable, Hashable, Sendable {
        public let weight: ClosedRange<Int>
        public let size: ClosedRange<Double>
        public let tracking: ClosedRange<Double>?

        public init(weight: ClosedRange<Int>, size: ClosedRange<Double>, tracking: ClosedRange<Double>?) {
            self.weight = weight
            self.size = size
            self.tracking = tracking
        }

        /// Manrope at the lower weight and size, scaling with Dynamic Type (up to AX5) relative to `textStyle`.
        public func font(relativeTo textStyle: Font.TextStyle = .body) -> Font {
            Fonts.register()
            return Font.custom(Tokens.manropeFamily, size: size.lowerBound, relativeTo: textStyle)
                .weight(Tokens.fontWeight(weight.lowerBound))
        }

        /// Tracking in points at the lower size (tracking is given in em).
        public var trackingPoints: Double { (tracking?.lowerBound ?? 0) * size.lowerBound }
    }

    /// The only type family in package 01.
    public static let manropeFamily = "Manrope ExtraLight"

    static func fontWeight(_ value: Int) -> Font.Weight {
        switch value {
        case ..<150: .thin
        case ..<250: .ultraLight
        case ..<350: .light
        case ..<450: .regular
        case ..<550: .medium
        case ..<650: .semibold
        case ..<750: .bold
        case ..<850: .heavy
        default: .black
        }
    }

    // MARK: Colour

    public enum Colour {
        public static let ink = ModeColour(day: Tone(0x173E40), night: Tone(0xF1F5EC))
        public static let inkSoft = ModeColour(day: Tone(0x173E40, 0.66), night: Tone(0xF1F5EC, 0.72))
        public static let inkFaint = ModeColour(day: Tone(0x173E40, 0.42), night: Tone(0xF1F5EC, 0.45))
        public static let glassFill = ModeColour(day: Tone(0xFFFFFF, 0.38), night: Tone(0xFFFFFF, 0.08))
        public static let glassEdge = ModeColour(day: Tone(0xFFFFFF, 0.75), night: Tone(0xFFFFFF, 0.22))
        public static let base = ModeColour(day: Tone(0xEEF3E8), night: Tone(0x0A1712))
        /// Send, dots, underlines.
        public static let apricot = ModeColour(day: Tone(0xF2B18D), night: Tone(0xF2B18D))
        public static let apricotDeep = ModeColour(day: Tone(0xE3936B), night: Tone(0xE3936B))
        /// Mic while listening, voice line.
        public static let rust = ModeColour(day: Tone(0xC9622E), night: Tone(0xC9622E))
        /// Your cards in a thread.
        public static let youCardTint = ModeColour(day: Tone(0xF2B18D, 0.30), night: Tone(0xF2B18D, 0.30))
    }

    /// Kind colours: labels and the colour tick.
    public enum KindColour: CaseIterable, Hashable, Sendable {
        case howIMeanThings, whatFeelsLikeCare, howToBringSomethingUp, whatLandsHard
        case whenItGetsHeated, comingBackAfter, whatMattersToMe, otherThingsAboutMe

        public var hex: UInt32 {
            switch self {
            case .howIMeanThings: 0x2F7F73
            case .whatFeelsLikeCare: 0xE3936B
            case .howToBringSomethingUp: 0x8E7CC3
            case .whatLandsHard: 0x9A6A86
            case .whenItGetsHeated: 0xC9A24A
            case .comingBackAfter: 0x6FA39A
            case .whatMattersToMe: 0x3F6E8C
            case .otherThingsAboutMe: 0x8A9A96
            }
        }

        public var color: Color { Color(hex: hex) }
    }

    // MARK: Greenhouse and curtain

    public enum Greenhouse {
        public static let layerBlurFar: Double = 18
        public static let layerBlurMiddle: Double = 11
        public static let layerBlurNear: Double = 7
        public static let layerWidth: Double = 570
        public static let layerHeight: Double = 884
        public static let layerScale: Double = 3

        public static let layerFactorFar: Double = -0.55
        public static let layerFactorMiddle: Double = -0.20
        public static let layerFactorNear: Double = 0.35
        public static let layerFactorLights: Double = 0.55

        public static let cameraTalk: Double = 0
        public static let cameraYou: Double = 60
        public static let cameraPeople: Double = -60
        public static let cameraThread: Double = -60
    }

    public enum Curtain {
        public static let blur: Double = 16
        public static let saturation: Double = 1.1
        /// Top, middle, bottom.
        public static let dayTint = [Tone(0xFFFFFF, 0.26), Tone(0xFFFFFF, 0.08), Tone(0xFFFFFF, 0.30)]
        /// Top, middle, bottom.
        public static let nightTint = [Tone(0x08140F, 0.30), Tone(0x08140F, 0.18), Tone(0x08140F, 0.55)]
    }

    public enum DayLight {
        public static let glow = Tone(0xFFFCEC, 0.95)
        public static let glowWidthFraction: Double = 0.70
        public static let glowHeightFraction: Double = 0.30
        /// Degrees.
        public static let bandAngle: Double = 105
        public static let bandOpacity: Double = 0.16
        public static let drift: Double = 40
        public static let driftPeriod: Double = 18
    }

    public enum NightLight {
        public static let glow = Tone(0xFFC48C, 0.55)
        public static let lampCount = 9
        public static let lampFrom: UInt32 = 0xFFE2A8
        public static let lampTo: UInt32 = 0xFFB560
        public static let breathing: Double = 0.06
        public static let breathingPeriod: ClosedRange<Double> = 5...8
    }

    /// Middle and near layers.
    public enum Sway {
        /// Degrees.
        public static let angle: Double = 0.6
        public static let distance: Double = 4
        public static let periodMiddle: Double = 11
        public static let periodNear: Double = 8
    }

    // MARK: The bar and glass

    public enum Bar {
        public static let sideInset: Double = 12
        public static let bottomInset: Double = 24
        public static let radius: Double = 28
        public static let emptyHeight: Double = 56
        public static let heightPerLine: Double = 24
        public static let maxLines = 4

        /// Bar height for a number of text lines (one line is the empty height), capped at `maxLines`.
        public static func height(lines: Int) -> Double {
            emptyHeight + heightPerLine * Double(min(max(lines, 1), maxLines) - 1)
        }
    }

    public enum Glass {
        public static let blur: Double = 26
        public static let saturation: Double = 1.8
        public static let brightness: Double = 1.05
        /// Top to bottom.
        public static let dayFill = [Tone(0xFFFFFF, 0.52), Tone(0xFFFFFF, 0.20)]
        /// Top to bottom.
        public static let nightFill = [Tone(0xFFFFFF, 0.13), Tone(0xFFFFFF, 0.04)]
        public static let topEdge: Double = 1.5
        public static let shadowY: Double = 22
        public static let shadowBlur: Double = 40
        public static let shadowSpread: Double = -16
        public static let shadowInkOpacity: Double = 0.38
    }

    public enum Send {
        public static let size: Double = 40
        /// Top to bottom.
        public static let gradient = [Tone(0xF8CBAE), Tone(0xEFA57F)]
    }

    public enum ListeningLamp {
        public static let width: Double = 230
        public static let height: Double = 120
        public static let travel: Double = 90
        public static let period: Double = 3.4
        public static let scale: ClosedRange<Double> = 0.8...1.1
        public static let opacity: ClosedRange<Double> = 0.35...1
    }

    public enum Card {
        public static let radius: ClosedRange<Double> = 22...26
        public static let maxWidthFraction: Double = 0.84
    }

    public enum Row {
        public static let radius: Double = 22
        public static let gap: Double = 10
        public static let sideInset: Double = 18
        public static let paddingVertical: Double = 14
        public static let paddingHorizontal: Double = 16
    }

    public enum Ring {
        public static let size: Double = 44
        public static let stroke: Double = 1.8
    }

    public enum Dot {
        public static let size: Double = 8
    }

    public enum EdgeLight {
        public static let width: Double = 3
        public static let endInset: Double = 250
        public static let edgeInset: Double = 5
        public static let opacity: Double = 0.60
        /// Left edge: teal, apricot, lilac.
        public static let left = [Tone(0x173E40), Tone(0xF2B18D), Tone(0x8E7CC3)]
        /// Right edge: glassy white.
        public static let right = [Tone(0xFFFFFF)]
    }

    public static let minTarget: Double = 44
    /// A dimmed control (behaviour.md "Dimmed"). tokens.md names no value; 0.75 is the lowest that keeps ink on the
    /// base at 4.5:1, so a dimmed control still reads.
    public static let dimmedOpacity: Double = 0.75

    // MARK: Type (Manrope only; Dynamic Type up to AX5)

    public enum TypeScale {
        public static let greeting = TypeStyle(weight: 200...200, size: 32...32, tracking: -0.02 ... -0.02)
        public static let heading = TypeStyle(weight: 200...200, size: 28...28, tracking: nil)
        public static let threadName = TypeStyle(weight: 300...300, size: 24...24, tracking: nil)
        public static let reply = TypeStyle(weight: 300...300, size: 17...17, tracking: nil)
        public static let cardWords = TypeStyle(weight: 300...300, size: 19...20, tracking: nil)
        public static let kenningCardWords = TypeStyle(weight: 300...300, size: 20...20, tracking: nil)
        public static let message = TypeStyle(weight: 400...400, size: 16.5...16.5, tracking: nil)
        public static let rowName = TypeStyle(weight: 700...700, size: 17...17, tracking: nil)
        /// Weight 400, not 300: nothing under 16 pt is light (owner's answer on #20).
        public static let rowLine = TypeStyle(weight: 400...400, size: 14.5...14.5, tracking: nil)
        public static let label = TypeStyle(weight: 500...600, size: 11...14.5, tracking: nil)
        public static let caps = TypeStyle(weight: 700...800, size: 10...11, tracking: 0.08...0.14)
    }

    // MARK: Hand-drawn

    /// One stroke (`sk()` from the prototype): resample every 5 pt, two slow sine waves, amplitude 0.75 pt, seeded.
    public enum HandDrawn {
        public static let resampleStep: Double = 5
        public static let waveCount = 2
        public static let amplitude: Double = 0.75
        public static let stroke: ClosedRange<Double> = 1.6...1.8
    }

    // MARK: Motion

    public enum Motion {
        public static let cameraSettles: Double = 1.4
        public static let cameraCurve = Curve(0.22, 0.9, 0.2, 1)

        public static let layerSettles: Double = 0.8
        public static let layerOpacity: Double = 0.6
        public static let layerCurve = Curve(0.2, 0.9, 0.2, 1)

        public static let pullDistance: Double = 260
        public static let pullCommit: Double = 90

        /// p = min(distance ÷ 260, 1), eased 1 − (1 − p)².
        public static func pullProgress(distance: Double) -> Double {
            let p = min(max(distance / pullDistance, 0), 1)
            return 1 - (1 - p) * (1 - p)
        }

        public static func pullArriving(_ p: Double) -> Double { pow(p, 1.4) }
        public static func pullLeaving(_ p: Double) -> Double { pow(1 - p, 2.2) }

        public static let peopleRowDuration: Double = 0.7
        public static let peopleRowFrom: Double = 80
        public static let peopleRowStagger: Double = 0.05

        public static let threadCardDuration: Double = 0.8
        public static let threadCardFrom: Double = 60
        public static let threadCardStagger: Double = 0.08

        public static let arriveCurve = Curve(0.2, 0.95, 0.25, 1.05)

        public static let messageDuration: ClosedRange<Double> = 0.6...0.8
        public static let messageFrom: Double = 24
        public static let messageBlur: Double = 6
        public static let messageCurve = Curve(0.2, 0.9, 0.2, 1)

        public static let cardRiseDuration: Double = 0.5
        public static let cardRiseFrom: Double = 16
        public static let cardRiseCurve = Curve(0.2, 0.9, 0.2, 1)

        public static let keptForYou: Double = 3.2
        public static let edgeLightsFirstLaunch: Double = 2.4
        public static let edgeLightsFirstLaunchRepeats = 3

        public static let knotDelay: Double = 0.3
        public static let knotMinimum: Double = 0.5
        public static let knotReplacedAfter: Double = 10

        public static let insightPause: Double = 1.5
        public static let reduceMotionCrossFade: Double = 0.2

        /// Sway and lamp loops pause after this long idle (and in Low Power Mode).
        public static let idleLoopsPauseAfter: Double = 10
        public static let framesPerSecondPulling = 120
        public static let framesPerSecondAtRest = 60
    }
}
