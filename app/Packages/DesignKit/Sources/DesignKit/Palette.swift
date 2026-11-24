import SwiftUI

/// V3 identity colours (design/v3/README.md). The only place colour values are typed.
public enum Palette {
    /// Teal `#173E40`.
    public static let teal = Color(hex: 0x173E40)
    /// Cream `#FFF2DE`.
    public static let cream = Color(hex: 0xFFF2DE)
    /// Apricot `#F2B18D`.
    public static let apricot = Color(hex: 0xF2B18D)

    /// The raw values, for tests and for anything that needs components.
    public static let hex: [String: UInt32] = ["teal": 0x173E40, "cream": 0xFFF2DE, "apricot": 0xF2B18D]
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
