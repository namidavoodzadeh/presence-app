// Issue #20. Acceptance test written in C4 from packages/01/tokens.md only.
// Every token named in tokens.md exists in DesignKit with the stated value.
//
// Pending: this file is outside the DesignKitTests target (Tests/Pending is not compiled). First step of the build:
// `git mv` it to Tests/DesignKitTests/ unchanged.
//
// API the tests expect (all in DesignKit, public, plain values so they test without a simulator):
//   struct Tokens.Tone: Equatable { let hex: UInt32; let opacity: Double }          // init(_ hex: UInt32, _ opacity: Double = 1)
//   struct Tokens.ModeColour: Equatable { let day: Tone; let night: Tone }
//   struct Tokens.Curve: Equatable { let x1, y1, x2, y2: Double }                     // init(_ x1:_ y1:_ x2:_ y2:)
//   struct Tokens.TypeStyle: Equatable { let weight: ClosedRange<Int>; let size: ClosedRange<Double>; let tracking: ClosedRange<Double>? }
//   enum Tokens.Colour: ink, inkSoft, inkFaint, glassFill, glassEdge, base, apricot, apricotDeep, rust, youCardTint (ModeColour)
//   enum Tokens.KindColour: CaseIterable, cases below, `hex: UInt32`
//   enum Tokens.Greenhouse, Curtain, DayLight, NightLight, Sway, Bar, Glass, Send, ListeningLamp, Card, Row, Ring, Dot,
//        EdgeLight, TypeScale, HandDrawn, Motion: static lets as named below; sizes in points, times in seconds, Double.
//   Tokens.minTarget: Double
//   Tokens.Motion.pullProgress(distance:) -> Double: p = min(distance / 260, 1), eased 1 − (1 − p)²
//   Tokens.Motion.pullArriving(_ p:) = p^1.4, pullLeaving(_ p:) = (1 − p)^2.2
//
// Not asserted, pending the owner's answer on #20: the weight of `rowLine` (tokens.md gives 300 at 14.5 pt, and also says
// nothing under 16 pt uses weight 200 or 300).
import XCTest
@testable import DesignKit

final class GreenhouseTokensTests: XCTestCase {
    typealias T = Tokens

    // MARK: Colour
    func testInkAndItsSoftAndFaintSteps() {
        XCTAssertEqual(T.Colour.ink, T.ModeColour(day: T.Tone(0x173E40), night: T.Tone(0xF1F5EC)))
        XCTAssertEqual(T.Colour.inkSoft, T.ModeColour(day: T.Tone(0x173E40, 0.66), night: T.Tone(0xF1F5EC, 0.72)))
        XCTAssertEqual(T.Colour.inkFaint, T.ModeColour(day: T.Tone(0x173E40, 0.42), night: T.Tone(0xF1F5EC, 0.45)))
    }

    func testGlassAndBase() {
        XCTAssertEqual(T.Colour.glassFill, T.ModeColour(day: T.Tone(0xFFFFFF, 0.38), night: T.Tone(0xFFFFFF, 0.08)))
        XCTAssertEqual(T.Colour.glassEdge, T.ModeColour(day: T.Tone(0xFFFFFF, 0.75), night: T.Tone(0xFFFFFF, 0.22)))
        XCTAssertEqual(T.Colour.base, T.ModeColour(day: T.Tone(0xEEF3E8), night: T.Tone(0x0A1712)))
    }

    func testWarmColoursAreTheSameDayAndNight() {
        XCTAssertEqual(T.Colour.apricot, T.ModeColour(day: T.Tone(0xF2B18D), night: T.Tone(0xF2B18D)))
        XCTAssertEqual(T.Colour.apricotDeep, T.ModeColour(day: T.Tone(0xE3936B), night: T.Tone(0xE3936B)))
        XCTAssertEqual(T.Colour.rust, T.ModeColour(day: T.Tone(0xC9622E), night: T.Tone(0xC9622E)))
        XCTAssertEqual(T.Colour.youCardTint, T.ModeColour(day: T.Tone(0xF2B18D, 0.30), night: T.Tone(0xF2B18D, 0.30)))
    }

    func testKindColours() {
        let expected: [T.KindColour: UInt32] = [
            .howIMeanThings: 0x2F7F73,
            .whatFeelsLikeCare: 0xE3936B,
            .howToBringSomethingUp: 0x8E7CC3,
            .whatLandsHard: 0x9A6A86,
            .whenItGetsHeated: 0xC9A24A,
            .comingBackAfter: 0x6FA39A,
            .whatMattersToMe: 0x3F6E8C,
            .otherThingsAboutMe: 0x8A9A96,
        ]
        XCTAssertEqual(Set(T.KindColour.allCases), Set(expected.keys))
        for (kind, hex) in expected { XCTAssertEqual(kind.hex, hex, "\(kind)") }
    }

    // MARK: Greenhouse and curtain
    func testGreenhouseLayers() {
        XCTAssertEqual(T.Greenhouse.layerBlurFar, 18)
        XCTAssertEqual(T.Greenhouse.layerBlurMiddle, 11)
        XCTAssertEqual(T.Greenhouse.layerBlurNear, 7)
        XCTAssertEqual(T.Greenhouse.layerWidth, 570)
        XCTAssertEqual(T.Greenhouse.layerHeight, 884)
        XCTAssertEqual(T.Greenhouse.layerScale, 3)
        XCTAssertEqual(T.Greenhouse.layerFactorFar, -0.55)
        XCTAssertEqual(T.Greenhouse.layerFactorMiddle, -0.20)
        XCTAssertEqual(T.Greenhouse.layerFactorNear, 0.35)
        XCTAssertEqual(T.Greenhouse.layerFactorLights, 0.55)
    }

    func testCamera() {
        XCTAssertEqual(T.Greenhouse.cameraTalk, 0)
        XCTAssertEqual(T.Greenhouse.cameraYou, 60)
        XCTAssertEqual(T.Greenhouse.cameraPeople, -60)
        XCTAssertEqual(T.Greenhouse.cameraThread, -60)
    }

    func testCurtain() {
        XCTAssertEqual(T.Curtain.blur, 16)
        XCTAssertEqual(T.Curtain.saturation, 1.1)
        XCTAssertEqual(T.Curtain.dayTint, [T.Tone(0xFFFFFF, 0.26), T.Tone(0xFFFFFF, 0.08), T.Tone(0xFFFFFF, 0.30)])
        XCTAssertEqual(T.Curtain.nightTint, [T.Tone(0x08140F, 0.30), T.Tone(0x08140F, 0.18), T.Tone(0x08140F, 0.55)])
    }

    func testDayAndNightLight() {
        XCTAssertEqual(T.DayLight.glow, T.Tone(0xFFFCEC, 0.95))
        XCTAssertEqual(T.DayLight.glowWidthFraction, 0.70)
        XCTAssertEqual(T.DayLight.glowHeightFraction, 0.30)
        XCTAssertEqual(T.DayLight.bandAngle, 105)
        XCTAssertEqual(T.DayLight.bandOpacity, 0.16)
        XCTAssertEqual(T.DayLight.drift, 40)
        XCTAssertEqual(T.DayLight.driftPeriod, 18)
        XCTAssertEqual(T.NightLight.glow, T.Tone(0xFFC48C, 0.55))
        XCTAssertEqual(T.NightLight.lampCount, 9)
        XCTAssertEqual(T.NightLight.lampFrom, 0xFFE2A8)
        XCTAssertEqual(T.NightLight.lampTo, 0xFFB560)
        XCTAssertEqual(T.NightLight.breathing, 0.06)
        XCTAssertEqual(T.NightLight.breathingPeriod, 5...8)
    }

    func testSway() {
        XCTAssertEqual(T.Sway.angle, 0.6)
        XCTAssertEqual(T.Sway.distance, 4)
        XCTAssertEqual(T.Sway.periodMiddle, 11)
        XCTAssertEqual(T.Sway.periodNear, 8)
    }

    // MARK: The bar and glass
    func testBar() {
        XCTAssertEqual(T.Bar.sideInset, 12)
        XCTAssertEqual(T.Bar.bottomInset, 24)
        XCTAssertEqual(T.Bar.radius, 28)
        XCTAssertEqual(T.Bar.emptyHeight, 56)
        XCTAssertEqual(T.Bar.heightPerLine, 24)
        XCTAssertEqual(T.Bar.maxLines, 4)
    }

    func testGlass() {
        XCTAssertEqual(T.Glass.blur, 26)
        XCTAssertEqual(T.Glass.saturation, 1.8)
        XCTAssertEqual(T.Glass.brightness, 1.05)
        XCTAssertEqual(T.Glass.dayFill, [T.Tone(0xFFFFFF, 0.52), T.Tone(0xFFFFFF, 0.20)])
        XCTAssertEqual(T.Glass.nightFill, [T.Tone(0xFFFFFF, 0.13), T.Tone(0xFFFFFF, 0.04)])
        XCTAssertEqual(T.Glass.topEdge, 1.5)
        XCTAssertEqual(T.Glass.shadowY, 22)
        XCTAssertEqual(T.Glass.shadowBlur, 40)
        XCTAssertEqual(T.Glass.shadowSpread, -16)
        XCTAssertEqual(T.Glass.shadowInkOpacity, 0.38)
    }

    func testSendAndListeningLamp() {
        XCTAssertEqual(T.Send.size, 40)
        XCTAssertEqual(T.Send.gradient, [T.Tone(0xF8CBAE), T.Tone(0xEFA57F)])
        XCTAssertEqual(T.ListeningLamp.width, 230)
        XCTAssertEqual(T.ListeningLamp.height, 120)
        XCTAssertEqual(T.ListeningLamp.travel, 90)
        XCTAssertEqual(T.ListeningLamp.period, 3.4)
        XCTAssertEqual(T.ListeningLamp.scale, 0.8...1.1)
        XCTAssertEqual(T.ListeningLamp.opacity, 0.35...1)
    }

    func testCardRowRingDotEdgeAndTarget() {
        XCTAssertEqual(T.Card.radius, 22...26)
        XCTAssertEqual(T.Card.maxWidthFraction, 0.84)
        XCTAssertEqual(T.Row.radius, 22)
        XCTAssertEqual(T.Row.gap, 10)
        XCTAssertEqual(T.Row.sideInset, 18)
        XCTAssertEqual(T.Row.paddingVertical, 14)
        XCTAssertEqual(T.Row.paddingHorizontal, 16)
        XCTAssertEqual(T.Ring.size, 44)
        XCTAssertEqual(T.Ring.stroke, 1.8)
        XCTAssertEqual(T.Dot.size, 8)
        XCTAssertEqual(T.EdgeLight.width, 3)
        XCTAssertEqual(T.EdgeLight.endInset, 250)
        XCTAssertEqual(T.EdgeLight.edgeInset, 5)
        XCTAssertEqual(T.EdgeLight.opacity, 0.60)
        XCTAssertEqual(T.minTarget, 44)
    }

    // MARK: Type
    func testTypeScale() {
        XCTAssertEqual(T.TypeScale.greeting, T.TypeStyle(weight: 200...200, size: 32...32, tracking: -0.02 ... -0.02))
        XCTAssertEqual(T.TypeScale.heading, T.TypeStyle(weight: 200...200, size: 28...28, tracking: nil))
        XCTAssertEqual(T.TypeScale.threadName, T.TypeStyle(weight: 300...300, size: 24...24, tracking: nil))
        XCTAssertEqual(T.TypeScale.reply, T.TypeStyle(weight: 300...300, size: 17...17, tracking: nil))
        XCTAssertEqual(T.TypeScale.cardWords, T.TypeStyle(weight: 300...300, size: 19...20, tracking: nil))
        XCTAssertEqual(T.TypeScale.kenningCardWords, T.TypeStyle(weight: 300...300, size: 20...20, tracking: nil))
        XCTAssertEqual(T.TypeScale.message, T.TypeStyle(weight: 400...400, size: 16.5...16.5, tracking: nil))
        XCTAssertEqual(T.TypeScale.rowName, T.TypeStyle(weight: 700...700, size: 17...17, tracking: nil))
        XCTAssertEqual(T.TypeScale.rowLine.size, 14.5...14.5)
        XCTAssertNil(T.TypeScale.rowLine.tracking)
        XCTAssertEqual(T.TypeScale.label, T.TypeStyle(weight: 500...600, size: 11...14.5, tracking: nil))
        XCTAssertEqual(T.TypeScale.caps, T.TypeStyle(weight: 700...800, size: 10...11, tracking: 0.08...0.14))
    }

    func testNothingUnderSixteenPointsIsLight() {
        // tokens.md: "Nothing under 16 pt uses weight 200 or 300." rowLine is left out until #20's question is answered.
        let styles: [(String, T.TypeStyle)] = [
            ("greeting", T.TypeScale.greeting), ("heading", T.TypeScale.heading), ("threadName", T.TypeScale.threadName),
            ("reply", T.TypeScale.reply), ("cardWords", T.TypeScale.cardWords), ("kenningCardWords", T.TypeScale.kenningCardWords),
            ("message", T.TypeScale.message), ("rowName", T.TypeScale.rowName), ("label", T.TypeScale.label), ("caps", T.TypeScale.caps),
        ]
        for (name, style) in styles where style.size.lowerBound < 16 {
            XCTAssertGreaterThanOrEqual(style.weight.lowerBound, 400, name)
        }
    }

    // MARK: Hand-drawn
    func testHandDrawnStroke() {
        XCTAssertEqual(T.HandDrawn.resampleStep, 5)
        XCTAssertEqual(T.HandDrawn.waveCount, 2)
        XCTAssertEqual(T.HandDrawn.amplitude, 0.75)
        XCTAssertEqual(T.HandDrawn.stroke, 1.6...1.8)
    }

    // MARK: Motion
    func testMotionDurationsAndCurves() {
        XCTAssertEqual(T.Motion.cameraSettles, 1.4)
        XCTAssertEqual(T.Motion.cameraCurve, T.Curve(0.22, 0.9, 0.2, 1))
        XCTAssertEqual(T.Motion.layerSettles, 0.8)
        XCTAssertEqual(T.Motion.layerOpacity, 0.6)
        XCTAssertEqual(T.Motion.layerCurve, T.Curve(0.2, 0.9, 0.2, 1))
        XCTAssertEqual(T.Motion.peopleRowDuration, 0.7)
        XCTAssertEqual(T.Motion.peopleRowFrom, 80)
        XCTAssertEqual(T.Motion.peopleRowStagger, 0.05)
        XCTAssertEqual(T.Motion.threadCardDuration, 0.8)
        XCTAssertEqual(T.Motion.threadCardFrom, 60)
        XCTAssertEqual(T.Motion.threadCardStagger, 0.08)
        XCTAssertEqual(T.Motion.arriveCurve, T.Curve(0.2, 0.95, 0.25, 1.05))
        XCTAssertEqual(T.Motion.messageDuration, 0.6...0.8)
        XCTAssertEqual(T.Motion.messageFrom, 24)
        XCTAssertEqual(T.Motion.messageBlur, 6)
        XCTAssertEqual(T.Motion.messageCurve, T.Curve(0.2, 0.9, 0.2, 1))
        XCTAssertEqual(T.Motion.cardRiseDuration, 0.5)
        XCTAssertEqual(T.Motion.cardRiseFrom, 16)
        XCTAssertEqual(T.Motion.cardRiseCurve, T.Curve(0.2, 0.9, 0.2, 1))
        XCTAssertEqual(T.Motion.keptForYou, 3.2)
        XCTAssertEqual(T.Motion.edgeLightsFirstLaunch, 2.4)
        XCTAssertEqual(T.Motion.edgeLightsFirstLaunchRepeats, 3)
        XCTAssertEqual(T.Motion.knotDelay, 0.3)
        XCTAssertEqual(T.Motion.knotMinimum, 0.5)
        XCTAssertEqual(T.Motion.knotReplacedAfter, 10)
        XCTAssertEqual(T.Motion.insightPause, 1.5)
        XCTAssertEqual(T.Motion.reduceMotionCrossFade, 0.2)
        XCTAssertEqual(T.Motion.idleLoopsPauseAfter, 10)
        XCTAssertEqual(T.Motion.framesPerSecondPulling, 120)
        XCTAssertEqual(T.Motion.framesPerSecondAtRest, 60)
    }

    func testPull() {
        XCTAssertEqual(T.Motion.pullDistance, 260)
        XCTAssertEqual(T.Motion.pullCommit, 90)
        XCTAssertEqual(T.Motion.pullProgress(distance: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(T.Motion.pullProgress(distance: 130), 0.75, accuracy: 1e-9)   // p 0.5 → 1 − 0.25
        XCTAssertEqual(T.Motion.pullProgress(distance: 260), 1, accuracy: 1e-9)
        XCTAssertEqual(T.Motion.pullProgress(distance: 520), 1, accuracy: 1e-9)      // never past 1
        XCTAssertEqual(T.Motion.pullArriving(0.5), pow(0.5, 1.4), accuracy: 1e-9)
        XCTAssertEqual(T.Motion.pullLeaving(0.5), pow(0.5, 2.2), accuracy: 1e-9)
    }
}
