// swift-tools-version: 5.10
// Pins Apple's Swift OpenAPI Generator for ../generate.sh. Not part of the app.
import PackageDescription

let package = Package(
    name: "ContractGenerator",
    platforms: [.macOS(.v14)],
    dependencies: [.package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.9.0")],
    targets: []
)
