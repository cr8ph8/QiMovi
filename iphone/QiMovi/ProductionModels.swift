import Foundation

struct FilmProject: Identifiable, Codable, Equatable {
    var id: String
    var title: String
    var phase: String
    var synopsis: String?
    var sourceHash: String?
    var shots: [FilmShot]
    var tasks: [ProductionTask]
    var sourceStatus: String? = nil
    var phaseOrigin: String? = nil
    var sourceRecordHash: String? = nil
    var desktopBaseline: DesktopPlanningBaseline? = nil

    static let phases = ["Unassigned", "Pre-development", "Development", "Pre-production", "Production", "Wrap", "Post-production", "Marketing", "Distribution"]
}

struct FilmShot: Identifiable, Codable, Equatable {
    var id: String
    var sceneId: String
    var sceneHeading: String
    var title: String
    var order: Int
    var framing: String
    var movement: String
    var durationSeconds: Double?
    var notes: String
    var status: String
    var thumbnail: String? = nil
    var sourceHash: String? = nil
    var sourceRecordHash: String? = nil
    var storyboardRecordID: String? = nil
    var storyboardImageHash: String? = nil
    var storyboardReview: String? = nil

    static let statuses = ["planned", "ready", "captured", "reviewed"]
}

struct ProductionTask: Identifiable, Codable, Equatable {
    var id: String
    var title: String
    var phase: String
    var status: String
    var notes: String? = nil
}

struct ProductionSlatePackage: Codable, Equatable {
    var schemaVersion: String = "qimovi-phone-production/v1"
    var exportedAt: String
    var origin: String
    var projects: [FilmProject]
}

struct ProductionReviewPackage: Codable {
    var schemaVersion = "qimovi-production-review/v1"
    var exportedAt: String
    var origin = "QiMovi iPhone Alpha"
    var scope = "PHONE_PLANNING_REVIEW_ONLY"
    var desktopApplied = false
    var productionApproval = false
    var sourceSnapshotDate: String?
    var project: FilmProject
}

struct ProductionLibrary: Codable {
    var schemaVersion = 1
    var importedAt: String?
    var selectedProjectID: String?
    var projects: [FilmProject]
}

enum ProductionFailure: LocalizedError {
    case invalid(String)
    case conflict(String)
    var errorDescription: String? {
        switch self {
        case .invalid(let message): return message
        case .conflict(let title): return "\(title) is already on this phone and differs from this package. Existing planning notes are unchanged. Export them for review before reconciling the two versions."
        }
    }
}

/// Original desktop values travel unchanged with phone edits for conflict review.
struct DesktopRecordReference: Codable, Equatable {
    var id: String
    var version: Int
    var sha256: String
}
struct DesktopProjectBaseline: Codable, Equatable {
    var phase: String
    var tasks: [ProductionTask]
}
struct DesktopShotBaseline: Codable, Equatable {
    var sceneId: String
    var shotId: String
    var ref: DesktopRecordReference?
    var framing: String
    var movement: String
    var notes: String
    enum CodingKeys: String, CodingKey { case sceneId, shotId, ref, framing, movement, notes }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(sceneId, forKey: .sceneId); try c.encode(shotId, forKey: .shotId)
        try c.encode(ref, forKey: .ref)
        try c.encode(framing, forKey: .framing); try c.encode(movement, forKey: .movement); try c.encode(notes, forKey: .notes)
    }
}
struct DesktopPlanningBaseline: Codable, Equatable {
    var schemaVersion: Int
    var projectId: String
    var sourceHash: String?
    var sourceRecordHash: String
    var project: DesktopProjectBaseline
    var projectDirectionRef: DesktopRecordReference?
    var shotDirections: [DesktopShotBaseline]
    enum CodingKeys: String, CodingKey { case schemaVersion, projectId, sourceHash, sourceRecordHash, project, projectDirectionRef, shotDirections }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schemaVersion, forKey: .schemaVersion); try c.encode(projectId, forKey: .projectId)
        try c.encode(sourceHash, forKey: .sourceHash); try c.encode(sourceRecordHash, forKey: .sourceRecordHash)
        try c.encode(project, forKey: .project); try c.encode(projectDirectionRef, forKey: .projectDirectionRef)
        try c.encode(shotDirections, forKey: .shotDirections)
    }
}

struct ProductionImportPreview: Identifiable {
    let id = UUID()
    let package: ProductionSlatePackage
    let existing: [FilmProject]
    var replacements: [FilmProject] {
        package.projects.filter { incoming in existing.contains { $0.id == incoming.id && $0 != incoming } }
    }
    var additions: [FilmProject] { package.projects.filter { incoming in !existing.contains { $0.id == incoming.id } } }
}
