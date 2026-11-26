import UIKit
import XCTest
@testable import Presence

/// #61: the Report button's compile-time flag and its screenshot.
@MainActor
final class TesterReportBuildTests: XCTestCase {
    /// The Presence target's build settings per configuration, read from the project the archive builds.
    private func appConfigurations(file: StaticString = #filePath) throws -> [String: String] {
        let project = URL(fileURLWithPath: "\(file)")
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Presence.xcodeproj/project.pbxproj")
        let text = try String(contentsOf: project, encoding: .utf8)
        var result: [String: String] = [:]
        for block in text.components(separatedBy: "isa = XCBuildConfiguration;").dropFirst() {
            let body = block.components(separatedBy: "\n\t\t};").first ?? block
            guard body.contains("PRODUCT_BUNDLE_IDENTIFIER = com.namidavoodzadeh.presence;"),
                  let name = body.range(of: #"name = ([A-Za-z]+);"#, options: .regularExpression)
            else { continue }
            let key = String(body[name]).replacingOccurrences(of: "name = ", with: "").replacingOccurrences(of: ";", with: "")
            result[key] = body
        }
        return result
    }

    func testFlagIsInTestFlightAndDebugAndNeverInRelease() throws {
        let configs = try appConfigurations()
        XCTAssertEqual(Set(configs.keys), ["Debug", "TestFlight", "Release"])
        XCTAssertTrue(try XCTUnwrap(configs["TestFlight"]).contains("TESTER_REPORT"))
        XCTAssertTrue(try XCTUnwrap(configs["Debug"]).contains("TESTER_REPORT"))
        XCTAssertFalse(try XCTUnwrap(configs["Release"]).contains("TESTER_REPORT"))
        XCTAssertFalse(try XCTUnwrap(configs["Release"]).contains("NSMicrophoneUsageDescription"))
    }

    func testDebugBuildCompilesItInButShowsItOnlyWithLaunchFlag() {
        XCTAssertTrue(TesterReportBuild.compiledIn)
        XCTAssertTrue(TesterReportBuild.isDebug)
        XCTAssertFalse(TesterReportBuild.isShown, "tests launch without -testerReport YES")
    }

    func testScreenshotLeavesOutTheReportWindow() throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let app = UIWindow(windowScene: scene)
        app.rootViewController = UIViewController()
        app.rootViewController?.view.backgroundColor = .green
        app.isHidden = false
        let report = UIWindow(windowScene: scene)
        report.windowLevel = .alert + 1
        report.rootViewController = UIViewController()
        report.rootViewController?.view.backgroundColor = .red
        report.isHidden = false
        defer { app.isHidden = true; report.isHidden = true }

        let chosen = TesterScreenshot.windowsToCapture(scene.windows, excluding: report)
        XCTAssertTrue(chosen.contains { $0 === app })
        XCTAssertFalse(chosen.contains { $0 === report })

        let image = try XCTUnwrap(TesterScreenshot.capture(in: scene, excluding: report))
        let center = try XCTUnwrap(pixel(of: image, atX: image.size.width / 2, y: image.size.height / 2))
        XCTAssertFalse(center.r > 200 && center.g < 60 && center.b < 60, "the red report window is in the screenshot")

        let jpeg = try XCTUnwrap(TesterScreenshot.jpeg(image))
        XCTAssertLessThanOrEqual(jpeg.count, 2 * 1024 * 1024)
        XCTAssertEqual(Array(jpeg.prefix(2)), [0xFF, 0xD8])
    }

    private func pixel(of image: UIImage, atX x: CGFloat, y: CGFloat) -> (r: UInt8, g: UInt8, b: UInt8)? {
        guard let cg = image.cgImage else { return nil }
        var data = [UInt8](repeating: 0, count: 4)
        guard let context = CGContext(
            data: &data, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        let px = Int(x * image.scale), py = Int(y * image.scale)
        context.draw(cg, in: CGRect(x: -px, y: py - cg.height + 1, width: cg.width, height: cg.height))
        return (data[0], data[1], data[2])
    }
}
