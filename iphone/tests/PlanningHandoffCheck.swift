import Foundation

@main struct PlanningHandoffCheck {
    @MainActor static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("qimovi-planning-check-\(UUID().uuidString)")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let store = ProductionStore(directory: root.appendingPathComponent("library"))
        let id = store.addProject(title: "Synthetic Camera Study")
        precondition(!id.isEmpty && store.lastError == nil)
        _ = store.addShot(projectID: id, title: "Wide establishing shot")
        store.addTask(projectID: id, title: "Confirm the location")
        let original = store.projects
        var updated = original[0]
        updated.phase = "Distribution"
        updated.desktopBaseline = DesktopPlanningBaseline(schemaVersion: 1, projectId: id, sourceHash: nil,
            sourceRecordHash: String(repeating: "a", count: 64), project: DesktopProjectBaseline(phase: "Distribution", tasks: []), projectDirectionRef: nil, shotDirections: [])
        let package = ProductionSlatePackage(exportedAt: "2026-09-29T19:00:00.123Z", origin: "Synthetic check", projects: [updated])
        let input = root.appendingPathComponent("snapshot.qimovi")
        try JSONEncoder().encode(package).write(to: input)
        try store.prepareImport(from: input)
        precondition(store.projects == original && store.pendingImport?.replacements.count == 1)
        store.addTask(projectID: id, title: "New phone work after preview")
        precondition(!store.confirmImport(), "A stale import review must not overwrite new work")
        let beforeRefresh = store.projects
        try store.prepareImport(from: input)
        precondition(store.confirmImport())
        let archive = try JSONDecoder().decode(ProductionSlatePackage.self, from: Data(contentsOf: store.lastImportArchive!))
        precondition(archive.projects == beforeRefresh)
        let reopened = ProductionStore(directory: root.appendingPathComponent("library"))
        precondition(reopened.selectedProject?.desktopBaseline == updated.desktopBaseline)
        reopened.updatePhase(projectID: id, phase: "Marketing")
        let exported = reopened.exportReview(projectID: id)!
        let review = try JSONDecoder().decode(ProductionReviewPackage.self, from: Data(contentsOf: exported))
        precondition(review.project.phase == "Marketing" && review.project.desktopBaseline?.project.phase == "Distribution")
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: exported)) as! [String: Any]
        let baseline = (json["project"] as! [String: Any])["desktopBaseline"] as! [String: Any]
        precondition(baseline["projectDirectionRef"] is NSNull && baseline["sourceHash"] is NSNull)
        print("Phone planning checks passed: reviewed import, stale protection, prior-plan archive, persistence and baseline export.")
    }
}
