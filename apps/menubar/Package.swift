// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "FleetlensMenubar",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "FleetlensMenubar",
      path: "Sources/FleetlensMenubar"
    ),
    .testTarget(
      name: "FleetlensMenubarTests",
      dependencies: ["FleetlensMenubar"],
      path: "Tests/FleetlensMenubarTests"
    ),
  ]
)
