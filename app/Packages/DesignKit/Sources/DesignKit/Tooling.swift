import CoreGraphics
import SwiftUI

/// Tester tooling only (#61): the red Report button in Debug and TestFlight builds. Not part of the V3 identity.
public enum Tooling {
    /// The Report button's red `#D7263D`.
    public static let reportRed = Color(hex: 0xD7263D)
    public static let reportRedHex: UInt32 = 0xD7263D
    /// The Report button's diameter.
    public static let reportButtonSize: CGFloat = 52
    /// Distance from the trailing and bottom edges.
    public static let reportInset: CGFloat = 20
    /// Height of the note editor.
    public static let reportEditorHeight: CGFloat = 160
}
