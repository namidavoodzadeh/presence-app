// swift-tools-version: 5.10
// Client for contract/openapi.yaml. Sources/Contract/Generated is written by ./generate.sh, never by hand.
import PackageDescription

let package = Package(
    name: "Contract",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "Contract", targets: ["Contract"])],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.9.0"),
    ],
    targets: [
        .target(
            name: "Contract",
            dependencies: [.product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")]
        ),
    ]
)
