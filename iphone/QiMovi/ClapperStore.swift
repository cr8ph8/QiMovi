import Foundation
import Observation

struct SlateFrameRate: Codable, Equatable, Hashable {
    let numerator: Int
    let denominator: Int
    var label: String {
        denominator == 1 ? "\(numerator) fps" : String(format: "%.3f fps", Double(numerator) / Double(denominator))
    }
    static let choices = [SlateFrameRate(numerator: 24_000, denominator: 1001), .init(numerator: 24, denominator: 1),
        .init(numerator: 25, denominator: 1), .init(numerator: 30_000, denominator: 1001), .init(numerator: 30, denominator: 1),
        .init(numerator: 48, denominator: 1), .init(numerator: 50, denominator: 1),
        .init(numerator: 60_000, denominator: 1001), .init(numerator: 60, denominator: 1)]
}

struct ClapperSettings {
    var takeNumber = 1
    var roll = "A001"
    var camera = "A"
    var frameRate = SlateFrameRate(numerator: 24, denominator: 1)
    var soundMode = "SYNC"
    var slatePosition = "HEAD"
    var purpose = "PREVIZ"
    var soundCue = false
    var notes = ""
}

struct ClapperMark: Codable, Identifiable, Equatable {
    var schemaVersion = "qimovi-clapper/v1"
    let id: String
    let projectId: String
    let projectTitle: String
    let sourceHash: String?
    let sceneId: String
    let shotId: String
    let shotTitle: String
    let shotSourceHash: String?
    let takeNumber: Int
    let roll: String
    let camera: String
    let frameRate: SlateFrameRate
    let soundMode: String
    let slatePosition: String
    let purpose: String
    let markedAt: Date
    var clock = "DEVICE_WALL_CLOCK_NOT_TIMECODE"
    let cue: String
    let notes: String
    var classification = "SLATE_MARK_ONLY"
    let recordingId: String?
    let recordingTimeSeconds: Double?

    func validate() throws {
        func need(_ value: Bool) throws { if !value { throw ProductionFailure.invalid("The slate mark contains invalid or unsupported values.") } }
        func validText(_ value: String, _ limit: Int, required: Bool = false) -> Bool {
            value.utf16.count <= limit && (!required || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) && $0 != "\n" && $0 != "\t" }
        }
        func identifier(_ value: String) -> Bool { value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$", options: .regularExpression) != nil }
        func hash(_ value: String?) -> Bool { value == nil || value?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
        try need(schemaVersion == "qimovi-clapper/v1" && UUID(uuidString: id) != nil)
        try need(identifier(projectId) && identifier(shotId) && (sceneId.isEmpty || identifier(sceneId)))
        try need(hash(sourceHash) && hash(shotSourceHash) && validText(projectTitle, 300, required: true) && validText(shotTitle, 300, required: true))
        try need((1...9999).contains(takeNumber) && validText(roll, 40, required: true) && validText(camera, 40, required: true))
        try need(SlateFrameRate.choices.contains(frameRate) && ["SYNC", "MOS"].contains(soundMode)
            && ["HEAD", "TAIL"].contains(slatePosition) && ["PREVIZ", "PRODUCTION"].contains(purpose))
        try need(clock == "DEVICE_WALL_CLOCK_NOT_TIMECODE" && classification == "SLATE_MARK_ONLY"
            && ["VISUAL", "VISUAL_AND_SOUND_REQUESTED"].contains(cue) && validText(notes, 2000))
        try need(markedAt.timeIntervalSince1970.isFinite && (recordingId == nil) == (recordingTimeSeconds == nil))
        if let recordingId, let seconds = recordingTimeSeconds {
            try need(UUID(uuidString: recordingId) != nil && seconds.isFinite && (0...180).contains(seconds))
        }
    }
}

struct SavedClapperMark: Identifiable {
    let mark: ClapperMark
    let url: URL
    var id: String { mark.id }
}

/// Slate marks identify a moment. They do not mark a shot captured or accept a media take.
@MainActor @Observable final class ClapperStore {
    static let shared = ClapperStore()
    private(set) var saved: [SavedClapperMark] = []
    private(set) var pending: ClapperMark?
    private(set) var message: String?
    var drafts: [String: ClapperSettings] = [:]
    private let directory: URL
    private let writer: (Data, URL) throws -> Void

    init(directory: URL? = nil, writer: ((Data, URL) throws -> Void)? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("QiMoviAlpha/Production/Clapper", isDirectory: true)
        self.writer = writer ?? { data, url in
            #if os(iOS)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
            try data.write(to: url, options: .atomic)
            #endif
        }
        reload()
    }

    static func scope(project: FilmProject, shot: FilmShot) -> String {
        "\(project.id)|\(project.sourceHash ?? "local")|\(shot.sceneId)|\(shot.id)"
    }
    func settings(project: FilmProject, shot: FilmShot) -> ClapperSettings {
        let scope = Self.scope(project: project, shot: shot)
        if let draft = drafts[scope] { return draft }
        var result = ClapperSettings()
        result.takeNumber = min(9999, (saved.filter { $0.mark.projectId == project.id && $0.mark.shotId == shot.id
            && $0.mark.sceneId == shot.sceneId && $0.mark.sourceHash == project.sourceHash }.map { $0.mark.takeNumber }.max() ?? 0) + 1)
        return result
    }

    @discardableResult func mark(project: FilmProject, shot: FilmShot, settings: ClapperSettings,
                               recordingId: String? = nil, recordingTimeSeconds: Double? = nil) -> ClapperMark? {
        guard pending == nil else { message = "Retry saving the previous mark before making another."; return nil }
        let value = ClapperMark(id: UUID().uuidString.lowercased(), projectId: project.id, projectTitle: project.title,
            sourceHash: project.sourceHash, sceneId: shot.sceneId, shotId: shot.id, shotTitle: shot.title,
            shotSourceHash: shot.sourceRecordHash, takeNumber: settings.takeNumber, roll: settings.roll, camera: settings.camera,
            frameRate: settings.frameRate, soundMode: settings.soundMode, slatePosition: settings.slatePosition,
            purpose: settings.purpose, markedAt: Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970 * 1000) / 1000), cue: settings.soundCue ? "VISUAL_AND_SOUND_REQUESTED" : "VISUAL",
            notes: settings.notes, recordingId: recordingId, recordingTimeSeconds: recordingTimeSeconds)
        do { try value.validate() } catch { message = error.localizedDescription; return nil }
        drafts[Self.scope(project: project, shot: shot)] = settings
        pending = value
        _ = retrySave()
        return value
    }

    @discardableResult func retrySave() -> Bool {
        guard let value = pending else { return true }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .custom { date, encoder in
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                var container = encoder.singleValueContainer(); try container.encode(formatter.string(from: date))
            }
            let data = try encoder.encode(value), url = directory.appendingPathComponent("clapper-\(value.id).json")
            if FileManager.default.fileExists(atPath: url.path) {
                guard try Data(contentsOf: url) == data else { throw ProductionFailure.invalid("A different mark already uses this file. The existing file was preserved.") }
            } else { try writer(data, url) }
            pending = nil; reload(); message = "Take \(value.takeNumber) marked and saved. Use Next take when ready."
            return true
        } catch { message = "Mark not saved. Keep QiMovi open and retry. \(error.localizedDescription)"; return false }
    }

    private func reload() {
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        do {
            let urls = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .isSymbolicLinkKey])
                .filter { $0.lastPathComponent.hasPrefix("clapper-") && $0.pathExtension == "json" }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .custom { decoder in
                let text = try decoder.singleValueContainer().decode(String.self)
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text) { return date }
                throw ProductionFailure.invalid("Unreadable slate timestamp")
            }
            var rows: [SavedClapperMark] = [], rejected = 0
            for url in urls {
                do {
                    let info = try url.resourceValues(forKeys: [.fileSizeKey, .isSymbolicLinkKey])
                    guard info.isSymbolicLink != true && (info.fileSize ?? Int.max) <= 32_768 else { throw ProductionFailure.invalid("Unsupported mark file") }
                    let mark = try decoder.decode(ClapperMark.self, from: Data(contentsOf: url)); try mark.validate()
                    guard url.lastPathComponent == "clapper-\(mark.id).json" else { throw ProductionFailure.invalid("Mark filename mismatch") }
                    rows.append(SavedClapperMark(mark: mark, url: url))
                } catch { rejected += 1 }
            }
            saved = rows.sorted { $0.mark.markedAt > $1.mark.markedAt }
            if rejected > 0 { message = "\(rejected) unreadable mark files were left untouched." }
        } catch { message = "Could not read slate history. Existing files are preserved. \(error.localizedDescription)" }
    }
}
