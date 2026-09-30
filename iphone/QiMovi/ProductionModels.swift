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

    static let phases = ["Unassigned", "Pre-development", "Development", "Pre-production", "Production", "Wrap", "Post-production", "Marketing"]
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
