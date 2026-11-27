#if TESTER_REPORT
import Flows
import UIKit

/// Tester tooling (#61). The screenshot is of the app's own windows; the Report window is never in it.
enum TesterScreenshot {
    /// The windows to draw, back to front, without the Report window.
    static func windowsToCapture(_ windows: [UIWindow], excluding report: UIWindow?) -> [UIWindow] {
        windows
            .filter { $0 !== report && !$0.isHidden && $0.alpha > 0 }
            .sorted { $0.windowLevel < $1.windowLevel }
    }

    /// Draws the app's windows. Runs on the main thread (UIKit), and is the only work done there on press.
    @MainActor
    static func capture(in scene: UIWindowScene, excluding report: UIWindow?) -> UIImage? {
        let windows = windowsToCapture(scene.windows, excluding: report)
        guard let bounds = windows.first?.screen.bounds ?? scene.windows.first?.bounds, !bounds.isEmpty else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = scene.screen.scale
        format.opaque = true
        return UIGraphicsImageRenderer(bounds: bounds, format: format).image { _ in
            for window in windows {
                window.drawHierarchy(in: window.frame, afterScreenUpdates: false)
            }
        }
    }

    /// JPEG at most 2 MB: lowers quality, then size, until it fits. Call off the main thread.
    static func jpeg(_ image: UIImage, limit: Int = TesterReport.maxScreenshotBytes) -> Data? {
        var current = image
        for _ in 0..<4 {
            for quality in [0.7, 0.5, 0.3] as [CGFloat] {
                if let data = current.jpegData(compressionQuality: quality), data.count <= limit { return data }
            }
            let size = CGSize(width: current.size.width * 0.7, height: current.size.height * 0.7)
            let format = UIGraphicsImageRendererFormat()
            format.scale = current.scale
            current = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                current.draw(in: CGRect(origin: .zero, size: size))
            }
        }
        return nil
    }
}
#endif
