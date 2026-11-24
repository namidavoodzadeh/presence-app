import CoreGraphics

/// Spacing scale on a 4-point grid. Screens use these, never a typed number.
public enum Space {
    public static let xxs: CGFloat = 2
    public static let xs: CGFloat = 4
    public static let s: CGFloat = 8
    public static let m: CGFloat = 16
    public static let l: CGFloat = 24
    public static let xl: CGFloat = 32
    public static let xxl: CGFloat = 48

    public static let scale: [CGFloat] = [xxs, xs, s, m, l, xl, xxl]
}

/// Corner radii.
public enum Radius {
    public static let s: CGFloat = 8
    public static let m: CGFloat = 14
    public static let l: CGFloat = 22
}
