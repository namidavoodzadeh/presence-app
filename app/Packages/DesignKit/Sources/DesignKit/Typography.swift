import CoreText
import Foundation
import SwiftUI

/// Font files shipped in this package (copied from design/v3/fonts).
public enum FontFace: String, CaseIterable, Sendable {
    case manropeSemiBold = "ManropeExtraLight-SemiBold"
    case newsreaderRegular = "Newsreader16pt16pt-Regular"
    case newsreaderMedium = "Newsreader16pt16pt-Medium"
    case caveat = "Caveat-Regular"

    var file: String {
        switch self {
        case .manropeSemiBold: "Manrope-SemiBold"
        case .newsreaderRegular: "Newsreader-400"
        case .newsreaderMedium: "Newsreader-500"
        case .caveat: "Caveat"
        }
    }
}

public enum Fonts {
    private static let once: Void = {
        for face in FontFace.allCases {
            guard let url = Bundle.module.url(forResource: face.file, withExtension: "ttf", subdirectory: "Fonts") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()

    /// Registers the bundled fonts for this process. Safe to call more than once.
    public static func register() { _ = once }

    /// True when every bundled face can be created by name.
    public static var allAvailable: Bool {
        register()
        return FontFace.allCases.allSatisfy { face in
            let font = CTFontCreateWithName(face.rawValue as CFString, 12, nil)
            return (CTFontCopyPostScriptName(font) as String) == face.rawValue
        }
    }
}

/// Text styles. Each one scales with the system text size (Dynamic Type) via `relativeTo:`.
public enum TextStyle: CaseIterable, Sendable {
    case display, title, body, bodyEmphasis, caption, label, handwritten

    public var face: FontFace {
        switch self {
        case .display, .title: .newsreaderMedium
        case .body, .caption: .newsreaderRegular
        case .bodyEmphasis: .newsreaderMedium
        case .label: .manropeSemiBold
        case .handwritten: .caveat
        }
    }

    public var size: CGFloat {
        switch self {
        case .display: 34
        case .title: 24
        case .body, .bodyEmphasis: 17
        case .caption: 13
        case .label: 15
        case .handwritten: 22
        }
    }

    public var relativeTo: Font.TextStyle {
        switch self {
        case .display: .largeTitle
        case .title: .title2
        case .body, .bodyEmphasis: .body
        case .caption: .caption
        case .label: .subheadline
        case .handwritten: .title3
        }
    }

    public var font: Font {
        Fonts.register()
        return .custom(face.rawValue, size: size, relativeTo: relativeTo)
    }
}

public extension View {
    /// Applies a DesignKit text style.
    func textStyle(_ style: TextStyle) -> some View { font(style.font) }
}
