import Foundation
import AVFoundation
import CoreMedia
import CoreVideo

// A separate process keeps decoding failures and long media inspection away
// from the desktop UI and the local HTTP event loop. Hashing stays in Node.
@main enum MediaProbe {
    enum Failure: Error { case invalid(String) }
    static func require(_ condition: Bool, _ message: String) throws {
        if !condition { throw Failure.invalid(message) }
    }
    static func fourCC(_ code: FourCharCode) -> String {
        String(bytes: [24,16,8,0].map { UInt8((code >> $0) & 255) }, encoding: .ascii)?.trimmingCharacters(in: .whitespaces) ?? String(code)
    }
    static func gcd(_ a: Int64, _ b: Int64) -> Int64 {
        var x = abs(a), y = abs(b)
        while y != 0 { let t = x % y; x = y; y = t }; return x
    }
    static func containerMIME(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let bytes = Array(try handle.read(upToCount: 16) ?? Data())
        // Uploaded files are deliberately temporary or content-addressed. The
        // client filename is descriptive metadata, never the decoding format.
        if bytes.count >= 12 && String(bytes: bytes[4..<8], encoding: .ascii) == "ftyp" {
            return String(bytes: bytes[8..<12], encoding: .ascii) == "qt  " ? "video/quicktime" : "video/mp4"
        }
        if bytes.count >= 4 && Array(bytes[0..<4]) == [0x1a, 0x45, 0xdf, 0xa3] { return "video/webm" }
        if bytes.count >= 8 && ["wide", "mdat", "moov"].contains(String(bytes: bytes[4..<8], encoding: .ascii) ?? "") { return "video/quicktime" }
        throw Failure.invalid("Unsupported local media container")
    }
    static func main() async {
        do {
            try require(CommandLine.arguments.count == 2, "One media path is required")
            let file = CommandLine.arguments[1]
            try require(file.hasPrefix("/"), "Absolute media path required")
            let url = URL(fileURLWithPath: file)
            let asset = AVURLAsset(url: url, options: [AVURLAssetOverrideMIMETypeKey: try containerMIME(url)])
            let duration = try await asset.load(.duration)
            let seconds = CMTimeGetSeconds(duration)
            try require(seconds.isFinite && seconds > 0 && seconds <= 86400, "Invalid media duration")
            let tracks = try await asset.loadTracks(withMediaType: .video)
            try require(tracks.count == 1, "Exactly one video track is supported")
            let track = tracks[0]
            let trackRange = try await track.load(.timeRange)
            let formats = try await track.load(.formatDescriptions)
            try require(formats.count == 1, "One stable video format is required")
            let dims = CMVideoFormatDescriptionGetDimensions(formats[0])
            try require(dims.width > 0 && dims.height > 0 && Int64(dims.width) * Int64(dims.height) <= 33554432, "Video dimensions exceed local inspection limits")
            let reader = try AVAssetReader(asset: asset)
            let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
            output.alwaysCopiesSampleData = false
            try require(reader.canAdd(output), "Video cannot be decoded locally")
            reader.add(output)
            try require(reader.startReading(), "Video decoding could not start")
            var count: Int64 = 0
            var previous: CMTime?
            while let sample = output.copyNextSampleBuffer() {
                try require(CMSampleBufferDataIsReady(sample) && CMSampleBufferGetImageBuffer(sample) != nil, "Incomplete decoded frame")
                let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                try require(pts.isNumeric && (previous == nil || CMTimeCompare(pts, previous!) > 0), "Frame timing could not be measured")
                previous = pts
                count += Int64(CMSampleBufferGetNumSamples(sample))
                try require(count <= 10000000, "Frame count exceeds local inspection limits")
            }
            try require(reader.status == .completed && count > 0, "Video decoding did not complete")
            // Average decoded frames over the video's measured track duration.
            // Decoded AVFoundation buffers may omit per-frame durations.
            let span = trackRange.duration
            try require(span.isNumeric && span.value > 0, "Invalid measured frame span")
            let numerator = count * Int64(span.timescale), denominator = span.value
            let divisor = gcd(numerator, denominator)
            var audio: [[String: Any]] = []
            for audioTrack in try await asset.loadTracks(withMediaType: .audio) {
                let descriptions = try await audioTrack.load(.formatDescriptions)
                try require(descriptions.count == 1, "One stable format per audio track is required")
                let format = descriptions[0]
                guard let basic = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else { throw Failure.invalid("Audio format unavailable") }
                try require(basic.mChannelsPerFrame > 0 && basic.mSampleRate.isFinite && basic.mSampleRate > 0, "Invalid audio format")
                audio.append(["codec": fourCC(CMFormatDescriptionGetMediaSubType(format)), "channels": Int(basic.mChannelsPerFrame), "sampleRate": String(Int(basic.mSampleRate.rounded()))])
            }
            let value: [String: Any] = ["schema": "caniscreenwrite-native-media-probe/v1", "durationMs": Int((seconds * 1000).rounded()), "videoFrameCount": count, "width": Int(dims.width), "height": Int(dims.height), "frameRate": "\(numerator / divisor)/\(denominator / divisor)", "videoCodec": fourCC(CMFormatDescriptionGetMediaSubType(formats[0])), "audio": audio]
            let json = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            FileHandle.standardOutput.write(json); FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            // No path or media tags are copied into the UI-facing diagnostic.
            FileHandle.standardError.write(Data("Local media inspection failed: \(error)\n".utf8))
            exit(1)
        }
    }
}
