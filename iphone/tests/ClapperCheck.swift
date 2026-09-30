import Foundation

@main struct ClapperCheck {
    @MainActor static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("qimovi-clapper-check-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let shot = FilmShot(id: "shot-1", sceneId: "scene-1", sceneHeading: "INT. TEST ROOM - DAY", title: "Wide", order: 1,
            framing: "Wide", movement: "Static", notes: "", status: "planned", sourceRecordHash: String(repeating: "b", count: 64))
        let film = FilmProject(id: "test-film", title: "Synthetic film", phase: "Pre-production", sourceHash: String(repeating: "a", count: 64), shots: [shot], tasks: [])
        var shouldFail = true
        let store = ClapperStore(directory: root) { bytes, url in
            if shouldFail { throw CocoaError(.fileWriteOutOfSpace) }
            try bytes.write(to: url, options: .atomic)
        }
        let recording = UUID().uuidString.lowercased()
        let mark = store.mark(project: film, shot: shot, settings: ClapperSettings(), recordingId: recording, recordingTimeSeconds: 1.25)!
        precondition(store.pending?.id == mark.id && store.saved.isEmpty, "Failed mark must remain retryable")
        precondition(store.mark(project: film, shot: shot, settings: ClapperSettings()) == nil, "Never overwrite an unsaved mark")
        shouldFail = false
        precondition(store.retrySave() && store.pending == nil && store.saved.count == 1)
        precondition(store.retrySave() && store.saved.count == 1, "Retry must not duplicate a mark")
        let reopened = ClapperStore(directory: root)
        precondition(reopened.saved.count == 1 && reopened.saved[0].mark.id == mark.id)
        precondition(abs(reopened.saved[0].mark.markedAt.timeIntervalSince(mark.markedAt)) < 0.001)
        precondition(reopened.settings(project: film, shot: shot).takeNumber == 2)
        precondition(reopened.saved[0].mark.shotSourceHash == shot.sourceRecordHash)
        precondition(reopened.saved[0].mark.recordingId == recording && reopened.saved[0].mark.recordingTimeSeconds == 1.25)
        precondition(film.shots[0].status == "planned", "A clapper mark must not promote footage status")
        var invalid = ClapperSettings(); invalid.takeNumber = 0
        precondition(reopened.mark(project: film, shot: shot, settings: invalid) == nil)
        invalid = ClapperSettings(); invalid.frameRate = SlateFrameRate(numerator: 0, denominator: 0)
        precondition(reopened.mark(project: film, shot: shot, settings: invalid) == nil)
        precondition(reopened.mark(project: film, shot: shot, settings: ClapperSettings(), recordingId: recording) == nil)
        try Data("broken".utf8).write(to: root.appendingPathComponent("clapper-corrupt.json"))
        let damaged = ClapperStore(directory: root)
        precondition(damaged.saved.count == 1 && damaged.message?.contains("unreadable") == true)
        precondition(FileManager.default.fileExists(atPath: root.appendingPathComponent("clapper-corrupt.json").path))
        print("Clapper persistence, retry, binding, invalid-input and no-media-promotion checks passed.")
    }
}
