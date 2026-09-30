import Foundation
import Observation

/// Phone production planning is saved separately from the connected writing app.
/// Source IDs survive exchange; status changes here never grant desktop approval.
@Observable @MainActor final class ProductionStore {
    private(set) var projects: [FilmProject] = []
    private(set) var selectedProjectID: String?
    private(set) var importedAt: String?
    var lastError: String?
    private let directory: URL
    private var writesBlocked = false
    private var file: URL { directory.appendingPathComponent("production-library.json") }
    var selectedProject: FilmProject? { projects.first { $0.id == selectedProjectID } }
    var asOf: String? { importedAt }

    init(directory: URL? = nil, seedURL: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("QiMoviAlpha/Production", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: file.path) {
                let library = try JSONDecoder().decode(ProductionLibrary.self, from: Data(contentsOf: file))
                guard library.schemaVersion == 1 else { throw ProductionFailure.invalid("This planning library uses a newer version. It was left unchanged.") }
                try Self.validate(library.projects)
                projects = library.projects
                selectedProjectID = projects.contains { $0.id == library.selectedProjectID } ? library.selectedProjectID : projects.first?.id
                importedAt = library.importedAt
            } else if let seed = seedURL ?? Bundle.main.url(forResource: "production-slate", withExtension: "json") {
                let package = try Self.decodePackage(from: seed)
                projects = package.projects
                importedAt = package.exportedAt
                selectedProjectID = projects.first?.id
                try persist()
            }
        } catch { writesBlocked = true; lastError = "Could not open the production library. Existing files are preserved; writing is disabled. \(error.localizedDescription)" }
    }

    func selectProject(_ id: String) {
        guard !writesBlocked else { return }
        guard projects.contains(where: { $0.id == id }) else { return }
        let previous = selectedProjectID
        selectedProjectID = id
        do { try persist(); lastError = nil } catch { selectedProjectID = previous; lastError = error.localizedDescription }
    }

    @discardableResult func addProject(title: String) -> String {
        guard !writesBlocked else { return "" }
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= 240 else { lastError = "Enter a project title of 1–240 characters."; return "" }
        let project = FilmProject(id: "phone-project:\(UUID().uuidString.lowercased())", title: clean, phase: "Pre-development", synopsis: nil,
                                  sourceHash: nil, shots: [], tasks: [], sourceStatus: "NO_SCREENPLAY", phaseOrigin: "PHONE_PLANNING")
        let prior = projects, oldSelection = selectedProjectID
        projects.append(project); selectedProjectID = project.id
        do { try Self.validate(projects); try persist(); lastError = nil; return project.id }
        catch { projects = prior; selectedProjectID = oldSelection; lastError = error.localizedDescription; return "" }
    }

    func updatePhase(projectID: String, phase: String) {
        guard FilmProject.phases.contains(phase) else { return }
        mutate(projectID) { $0.phase = phase; $0.phaseOrigin = "PHONE_PLANNING" }
    }

    func updateShot(projectID: String, shot: FilmShot) {
        mutate(projectID) { project in
            guard let index = project.shots.firstIndex(where: { $0.id == shot.id }) else { return }
            // Source bindings and storyboard provenance are immutable through the editor.
            var edited = project.shots[index]
            if edited.sceneId.isEmpty { edited.sceneHeading = shot.sceneHeading }
            edited.title = shot.title; edited.framing = shot.framing; edited.movement = shot.movement
            edited.durationSeconds = shot.durationSeconds; edited.notes = shot.notes; edited.status = shot.status
            project.shots[index] = edited
        }
    }

    @discardableResult func addShot(projectID: String, title: String) -> String {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= 300 else { lastError = "Enter a shot title of 1–300 characters."; return "" }
        let id = "phone-shot:\(UUID().uuidString.lowercased())"
        let saved = mutate(projectID) { project in
            project.shots.append(FilmShot(id: id, sceneId: "", sceneHeading: "Unassigned scene", title: clean,
                                         order: (project.shots.map(\.order).max() ?? 0) + 1, framing: "Unspecified", movement: "Unspecified",
                                         durationSeconds: nil, notes: "", status: "planned"))
        }
        return saved ? id : ""
    }

    func addTask(projectID: String, title: String) {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= 500 else { lastError = "Enter a task of 1–500 characters."; return }
        mutate(projectID) { project in
            project.tasks.append(ProductionTask(id: "phone-task:\(UUID().uuidString.lowercased())", title: clean, phase: project.phase, status: "todo"))
        }
    }

    func toggleTask(projectID: String, taskID: String) {
        mutate(projectID) { project in
            guard let index = project.tasks.firstIndex(where: { $0.id == taskID }) else { return }
            project.tasks[index].status = project.tasks[index].status == "done" ? "todo" : "done"
        }
    }

    /// Export proposes planning changes for review. It is not a desktop write or sync receipt.
    func exportReview(projectID: String) -> URL? {
        guard let project = projects.first(where: { $0.id == projectID }) else { return nil }
        do {
            let folder = directory.appendingPathComponent("Exports", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent("QiMovi-planning-\(UUID().uuidString.lowercased()).json")
            let data = try Self.encode(ProductionReviewPackage(exportedAt: Self.timestamp(), sourceSnapshotDate: importedAt, project: project))
            #if os(iOS)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
            try data.write(to: url, options: .atomic)
            #endif
            lastError = nil
            return url
        } catch { lastError = error.localizedDescription; return nil }
    }

    /// Duplicate IDs with different content are rejected atomically, including changed source hashes.
    func importPackage(from url: URL) throws {
        guard !writesBlocked else { throw ProductionFailure.invalid("Recover the existing library before importing; original files are preserved.") }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let package = try Self.decodePackage(from: url)
        var next = projects
        for project in package.projects {
            if let existing = next.first(where: { $0.id == project.id }) {
                guard existing == project else { throw ProductionFailure.conflict(project.title) }
            } else { next.append(project) }
        }
        let previous = projects, previousDate = importedAt, previousSelection = selectedProjectID
        projects = next; importedAt = package.exportedAt
        if selectedProjectID == nil { selectedProjectID = projects.first?.id }
        do { try persist(); lastError = nil }
        catch { projects = previous; importedAt = previousDate; selectedProjectID = previousSelection; throw error }
    }

    @discardableResult private func mutate(_ id: String, body: (inout FilmProject) -> Void) -> Bool {
        guard !writesBlocked, let index = projects.firstIndex(where: { $0.id == id }) else { return false }
        let previous = projects
        body(&projects[index])
        do { try Self.validate(projects); try persist(); lastError = nil; return true }
        catch { projects = previous; lastError = error.localizedDescription; return false }
    }

    private func persist() throws {
        guard !writesBlocked else { throw ProductionFailure.invalid("The existing library needs recovery; writing is disabled.") }
        let library = ProductionLibrary(importedAt: importedAt, selectedProjectID: selectedProjectID, projects: projects)
        let data = try Self.encode(library)
        #if os(iOS)
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: file, options: .atomic)
        #endif
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(value)
    }
    private static func timestamp() -> String { ISO8601DateFormatter().string(from: Date()) }
    private static func decodePackage(from url: URL) throws -> ProductionSlatePackage {
        guard url.isFileURL, (try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0 <= 20_000_000 else {
            throw ProductionFailure.invalid("Choose a QiMovi production package smaller than 20 MB.")
        }
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard data.count <= 20_000_000 else { throw ProductionFailure.invalid("This package is too large.") }
        let package = try JSONDecoder().decode(ProductionSlatePackage.self, from: data)
        guard package.schemaVersion == "qimovi-phone-production/v1", ISO8601DateFormatter().date(from: package.exportedAt) != nil,
              package.origin.count <= 500 else { throw ProductionFailure.invalid("This is not a supported QiMovi production package.") }
        try validate(package.projects)
        return package
    }

    static func validate(_ projects: [FilmProject]) throws {
        func validText(_ text: String, max: Int, empty: Bool = false) -> Bool {
            (empty || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) && text.count <= max && !text.contains("\0")
        }
        func hash(_ value: String?) -> Bool { value == nil || (value!.count == 64 && value!.allSatisfy { "0123456789abcdef".contains($0) }) }
        guard projects.count <= 100, Set(projects.map(\.id)).count == projects.count else { throw ProductionFailure.invalid("Project identifiers are duplicated or the slate exceeds 100 projects.") }
        for project in projects {
            guard validText(project.id, max: 240), validText(project.title, max: 240), FilmProject.phases.contains(project.phase), hash(project.sourceHash),
                  project.shots.count <= 5000, project.tasks.count <= 5000,
                  Set(project.shots.map(\.id)).count == project.shots.count, Set(project.tasks.map(\.id)).count == project.tasks.count else {
                throw ProductionFailure.invalid("A project has invalid or duplicate production data.")
            }
            for shot in project.shots {
                guard validText(shot.id,max: 240), validText(shot.sceneId,max: 240,empty: true), validText(shot.sceneHeading,max: 500),
                      validText(shot.title,max: 300), validText(shot.framing,max: 1000,empty: true), validText(shot.movement,max: 1000,empty: true),
                      validText(shot.notes,max: 50_000,empty: true), shot.order >= 0, shot.order <= 100_000, FilmShot.statuses.contains(shot.status), hash(shot.sourceHash),
                      shot.durationSeconds.map({ $0.isFinite && $0 > 0 && $0 <= 86400 }) ?? true else { throw ProductionFailure.invalid("A shot has invalid planning fields.") }
                if let thumbnail = shot.thumbnail {
                    guard thumbnail.hasPrefix("Thumbnails/"), !thumbnail.contains(".."), thumbnail.count < 240 else { throw ProductionFailure.invalid("Invalid storyboard thumbnail path.") }
                }
            }
            for task in project.tasks {
                guard validText(task.id,max: 240), validText(task.title,max: 500), FilmProject.phases.contains(task.phase), ["todo", "done"].contains(task.status) else {
                    throw ProductionFailure.invalid("A task has invalid planning fields.")
                }
            }
        }
    }
}
