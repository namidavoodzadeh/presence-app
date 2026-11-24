// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "DesignKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "DesignKit", targets: ["DesignKit"])],
    targets: [
        .target(name: "DesignKit", resources: [.copy("Resources/Fonts")]),
        .testTarget(name: "DesignKitTests", dependencies: ["DesignKit"]),
    ]
)
