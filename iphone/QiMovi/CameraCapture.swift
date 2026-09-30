import Foundation
import CoreMotion
import Combine
import UIKit

/// Raw phone orientation is a rehearsal input, never a DCC observation or video take.
struct PhoneRotationSample: Codable, Sendable {
    let timeSeconds: Double
    let quaternionXYZW: [Double]
}

struct PhoneRotationTake: Codable, Identifiable, Sendable {
    let schemaVersion: String
    let id: String
    let projectId: String
    let projectTitle: String?
    let sourceHash: String?
    let sceneId: String?
    let shotId: String
    let shotTitle: String?
    let recordedAt: Date
    let durationSeconds: Double
    let requestedSampleRateHz: Int
    let measurement: String
    let referenceFrame: String
    let deviceAxes: String
    let relativeAttitudeMethod: String
    let quaternionOrder: String
    let screenOrientationAtStart: String
    let referenceQuaternionXYZW: [Double]
    let stopReason: String
    let classification: String
    let desktopPlaybackReady: Bool
    let samples: [PhoneRotationSample]
}

struct SavedRotationTake: Identifiable {
    let take: PhoneRotationTake
    let url: URL
    var id: String { take.id }
}

enum PhoneRotationMath {
    static func normalized(_ values: [Double], following previous: [Double]? = nil) -> [Double]? {
        guard values.count == 4, values.allSatisfy(\.isFinite) else { return nil }
        let norm = sqrt(values.reduce(0) { $0 + $1 * $1 })
        guard norm.isFinite, norm > 0.000_001 else { return nil }
        let normalized = values.map { $0 / norm }
        guard let previous, previous.count == 4 else { return normalized }
        let dot = zip(previous, normalized).reduce(0) { $0 + $1.0 * $1.1 }
        return dot < 0 ? normalized.map { -$0 } : normalized
    }
}

@MainActor
final class CameraCapture: ObservableObject {
    // Retain a failed-to-save take across tab/project view replacement until the user retries.
    static let shared = CameraCapture()
    static let maximumDuration: TimeInterval = 180
    static let maximumSamples = 5_401
    static let sampleRate = 30

    @Published private(set) var isMonitoring = false
    @Published private(set) var isRecording = false
    @Published private(set) var hasReading = false
    @Published private(set) var yaw = 0.0
    @Published private(set) var pitch = 0.0
    @Published private(set) var roll = 0.0
    @Published private(set) var elapsed = 0.0
    @Published private(set) var sampleCount = 0
    @Published private(set) var message: String?
    @Published private(set) var savedTakes: [SavedRotationTake] = []
    @Published private(set) var hasUnsavedTake = false

    private let motion = CMMotionManager()
    private var pollTask: Task<Void, Never>?
    private var reference: CMAttitude?
    private var originTimestamp: TimeInterval?
    private var lastTimestamp: TimeInterval?
    private var samples: [PhoneRotationSample] = []
    private var context: RecordingContext?
    private var unsavedTake: PhoneRotationTake?
    private var monitorBeganAt = Date()
    private let directory: URL

    private struct RecordingContext {
        let id: String
        let projectId: String
        let projectTitle: String?
        let sourceHash: String?
        let sceneId: String?
        let shotId: String
        let shotTitle: String?
        let recordedAt: Date
        let orientation: String
        let referenceQuaternion: [Double]
    }

    init() {
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("QiMoviAlpha/Production/Camera", isDirectory: true)
        reloadTakes()
    }

    var isAvailable: Bool { motion.isDeviceMotionAvailable }

    func enableMotion() {
        guard !isMonitoring else { return }
        guard motion.isDeviceMotionAvailable,
              CMMotionManager.availableAttitudeReferenceFrames().contains(.xArbitraryZVertical) else {
            message = "Motion capture needs a supported iPhone. The Simulator cannot record a movement."
            return
        }
        message = nil
        reference = nil
        hasReading = false
        lastTimestamp = nil
        monitorBeganAt = Date()
        motion.deviceMotionUpdateInterval = 1.0 / Double(Self.sampleRate)
        motion.startDeviceMotionUpdates(using: .xArbitraryZVertical)
        isMonitoring = true
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.isMonitoring else { return }
                self.readMotion()
                do { try await Task.sleep(for: .milliseconds(33)) } catch { return }
            }
        }
    }

    func recenter() {
        guard !isRecording, let reading = motion.deviceMotion else { return }
        reference = reading.attitude.copy() as? CMAttitude
        yaw = 0; pitch = 0; roll = 0
        message = "Starting orientation reset. Each recording also starts from zero."
    }

    func start(projectID: String?, projectTitle: String?, sourceHash: String?,
               sceneID: String?, shotID: String?, shotTitle: String?) {
        guard !isRecording, !hasUnsavedTake else { return }
        guard let projectID, !projectID.isEmpty, let shotID, !shotID.isEmpty else {
            message = "Select a project and shot before recording a movement."
            return
        }
        guard isMonitoring, hasReading, let reading = motion.deviceMotion,
              let referenceCopy = reading.attitude.copy() as? CMAttitude,
              ProcessInfo.processInfo.systemUptime - reading.timestamp < 0.5 else {
            message = "Enable motion and wait for a current reading."
            return
        }
        reference = referenceCopy
        originTimestamp = reading.timestamp
        samples = [PhoneRotationSample(timeSeconds: 0, quaternionXYZW: [0, 0, 0, 1])]
        context = RecordingContext(id: UUID().uuidString.lowercased(), projectId: projectID,
            projectTitle: projectTitle, sourceHash: sourceHash, sceneId: sceneID, shotId: shotID,
            shotTitle: shotTitle, recordedAt: Date(), orientation: Self.orientationName,
            referenceQuaternion: Self.components(referenceCopy.quaternion))
        elapsed = 0; sampleCount = 1
        message = nil
        isRecording = true
    }

    func stop(reason: String = "USER_STOPPED") {
        guard isRecording else { return }
        isRecording = false
        guard let context, samples.count >= 2 else {
            samples = []; self.context = nil
            message = "No movement saved. Record at least two sensor samples."
            return
        }
        let take = PhoneRotationTake(schemaVersion: "qimovi-phone-rotation/v1", id: context.id,
            projectId: context.projectId, projectTitle: context.projectTitle, sourceHash: context.sourceHash,
            sceneId: context.sceneId, shotId: context.shotId, shotTitle: context.shotTitle,
            recordedAt: context.recordedAt, durationSeconds: samples.last!.timeSeconds,
            requestedSampleRateHz: Self.sampleRate, measurement: "DEVICE_ORIENTATION_ONLY",
            referenceFrame: "CORE_MOTION_X_ARBITRARY_Z_VERTICAL",
            deviceAxes: "RIGHT_HANDED_X_RIGHT_Y_TOP_Z_OUT_OF_DISPLAY_PORTRAIT",
            relativeAttitudeMethod: "CMAttitude.multiply(byInverseOf: startAttitude)", quaternionOrder: "XYZW",
            screenOrientationAtStart: context.orientation, referenceQuaternionXYZW: context.referenceQuaternion,
            stopReason: reason, classification: "ROTATION_REHEARSAL_PENDING_REVIEW",
            desktopPlaybackReady: false, samples: samples)
        unsavedTake = take
        hasUnsavedTake = true
        self.context = nil
        samples = []
        savePendingTake()
    }

    func pause() {
        stop(reason: "CAPTURE_VIEW_OR_APP_LEFT_FOREGROUND")
        pollTask?.cancel(); pollTask = nil
        motion.stopDeviceMotionUpdates()
        isMonitoring = false; hasReading = false
        reference = nil
    }

    func savePendingTake() {
        guard let take = unsavedTake else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            let bytes = try encoder.encode(take)
            let url = directory.appendingPathComponent("rotation-\(take.id).json")
            try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            unsavedTake = nil; hasUnsavedTake = false
            message = "Movement saved on this iPhone."
            reloadTakes()
        } catch {
            message = "The movement is still held here, but could not be saved. Keep this screen open and retry. \(error.localizedDescription)"
        }
    }

    private func readMotion() {
        guard let reading = motion.deviceMotion else {
            if Date().timeIntervalSince(monitorBeganAt) > 5 {
                pause()
                message = "No motion reading arrived. Check Motion & Fitness access in Settings, then try again."
            }
            return
        }
        guard ProcessInfo.processInfo.systemUptime - reading.timestamp < 0.5 else {
            pause()
            if !hasUnsavedTake { message = "Motion readings stopped. Review saved movements below, then enable motion to try again." }
            return
        }
        guard reading.timestamp != lastTimestamp else { return }
        if isRecording, let lastTimestamp, reading.timestamp - lastTimestamp > 0.5 {
            stop(reason: "SENSOR_GAP")
            if !hasUnsavedTake { message = "Recording stopped at a sensor gap. Review the saved movement below." }
        }
        lastTimestamp = reading.timestamp
        hasReading = true
        if reference == nil { reference = reading.attitude.copy() as? CMAttitude }
        guard let reference, let relative = reading.attitude.copy() as? CMAttitude else { return }
        relative.multiply(byInverseOf: reference)
        guard let components = PhoneRotationMath.normalized(Self.components(relative.quaternion), following: samples.last?.quaternionXYZW),
              [relative.yaw, relative.pitch, relative.roll].allSatisfy(\.isFinite) else {
            pause(); message = "The sensor returned an invalid reading. Enable motion to try again."
            return
        }
        yaw = relative.yaw * 180 / .pi
        pitch = relative.pitch * 180 / .pi
        roll = relative.roll * 180 / .pi
        guard isRecording, let originTimestamp else { return }
        let time = reading.timestamp - originTimestamp
        guard time > (samples.last?.timeSeconds ?? -1) else { return }
        if time > Self.maximumDuration || samples.count >= Self.maximumSamples {
            stop(reason: "THREE_MINUTE_LIMIT")
            return
        }
        samples.append(PhoneRotationSample(timeSeconds: time, quaternionXYZW: components))
        elapsed = time; sampleCount = samples.count
    }

    private func reloadTakes() {
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        do {
            let urls = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey])
            let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
            savedTakes = urls.compactMap { url in
                guard url.lastPathComponent.hasPrefix("rotation-"), url.pathExtension == "json",
                      let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
                      values.isRegularFile == true, let size = values.fileSize, size > 0, size < 4 * 1024 * 1024,
                      let data = try? Data(contentsOf: url),
                      let take = try? decoder.decode(PhoneRotationTake.self, from: data),
                      take.schemaVersion == "qimovi-phone-rotation/v1", take.samples.count <= Self.maximumSamples,
                      take.durationSeconds.isFinite, take.durationSeconds >= 0, take.durationSeconds <= Self.maximumDuration
                else { return nil }
                return SavedRotationTake(take: take, url: url)
            }.sorted { $0.take.recordedAt > $1.take.recordedAt }
        } catch { message = "Saved movements could not be read: \(error.localizedDescription)" }
    }

    private static func components(_ q: CMQuaternion) -> [Double] { [q.x, q.y, q.z, q.w] }

    private static var orientationName: String {
        switch UIDevice.current.orientation {
        case .portrait: "PORTRAIT"
        case .portraitUpsideDown: "PORTRAIT_UPSIDE_DOWN"
        case .landscapeLeft: "LANDSCAPE_LEFT"
        case .landscapeRight: "LANDSCAPE_RIGHT"
        case .faceUp: "FACE_UP"
        case .faceDown: "FACE_DOWN"
        default: "UNKNOWN"
        }
    }
}
