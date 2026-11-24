// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "Flows",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "Flows", targets: ["Flows"])],
    targets: [
        .target(name: "Flows"),
        .testTarget(name: "FlowsTests", dependencies: ["Flows"]),
    ]
)
