// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "QiMovieSlate",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "QiMovieSlate", targets: ["QiMovieSlate"]), .executable(name: "CanIScreenwriteMediaProbe", targets: ["CanIScreenwriteMediaProbe"])],
    targets: [.executableTarget(name: "QiMovieSlate"), .executableTarget(name: "CanIScreenwriteMediaProbe")]
)
