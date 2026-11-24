import SwiftUI
import UIKit
import XCTest

/// Renders a view at a fixed size and scale and compares its PNG with the committed reference.
/// Record references with SNAPSHOT_RECORD=1 (in CI: TEST_RUNNER_SNAPSHOT_RECORD=1). A missing reference fails.
@MainActor
func assertSnapshot<V: View>(_ view: V, named name: String, file: StaticString = #filePath, line: UInt = #line) {
    let size = CGSize(width: 393, height: 852)
    let host = UIHostingController(rootView: view.frame(width: size.width, height: size.height))
    host.view.bounds = CGRect(origin: .zero, size: size)
    let window = UIWindow(frame: host.view.bounds)
    window.rootViewController = host
    window.makeKeyAndVisible()
    host.view.layoutIfNeeded()
    let format = UIGraphicsImageRendererFormat()
    format.scale = 2
    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
        host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
    }
    guard let png = image.pngData() else { return XCTFail("could not encode snapshot", file: file, line: line) }
    let dir = URL(fileURLWithPath: "\(file)").deletingLastPathComponent().appendingPathComponent("__Snapshots__")
    let reference = dir.appendingPathComponent("\(name).png")
    if ProcessInfo.processInfo.environment["SNAPSHOT_RECORD"] == "1" {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? png.write(to: reference)
        return XCTFail("recorded \(name); run again without SNAPSHOT_RECORD", file: file, line: line)
    }
    guard let expected = try? Data(contentsOf: reference),
          let expectedImage = UIImage(data: expected)?.cgImage,
          let actualImage = UIImage(data: png)?.cgImage
    else { return XCTFail("no reference for \(name) at \(reference.path)", file: file, line: line) }
    if pixels(expectedImage) != pixels(actualImage) {
        let failed = FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-actual.png")
        try? png.write(to: failed)
        XCTFail("snapshot \(name) differs from reference; actual written to \(failed.path)", file: file, line: line)
    }
}

private func pixels(_ image: CGImage) -> [UInt8] {
    let width = image.width, height = image.height
    var data = [UInt8](repeating: 0, count: width * height * 4)
    let context = CGContext(
        data: &data, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
    context?.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return data + [UInt8(width & 0xFF), UInt8(height & 0xFF)]
}
