import XCTest
@testable import DesignKit

final class DesignKitTests: XCTestCase {
    func testIdentityColours() {
        XCTAssertEqual(Palette.hex["teal"], 0x173E40)
        XCTAssertEqual(Palette.hex["cream"], 0xFFF2DE)
        XCTAssertEqual(Palette.hex["apricot"], 0xF2B18D)
    }

    func testSpacingScaleIsIncreasingOnFourPointGrid() {
        XCTAssertEqual(Space.scale, Space.scale.sorted())
        XCTAssertEqual(Set(Space.scale).count, Space.scale.count)
        for value in Space.scale.dropFirst() { XCTAssertEqual(value.truncatingRemainder(dividingBy: 4), 0) }
    }

    func testBundledFontsRegister() {
        XCTAssertTrue(Fonts.allAvailable)
    }

}
