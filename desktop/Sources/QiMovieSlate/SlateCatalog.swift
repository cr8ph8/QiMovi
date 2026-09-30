import Foundation
import Darwin

struct SlateProject: Equatable {
    let id: String
    let title: String
    let path: String
    let projectId: String?

    var directory: URL { URL(fileURLWithPath: path, isDirectory: true) }
}

/// The desktop slate indexes explicitly opened projects. Workspace contents stay
/// in their own folders; the catalog never reads configuration or database data.
final class SlateCatalog {
    static let storageKey = "slateProjectsV1"
    private let defaults: UserDefaults
    private(set) var entries: [SlateProject]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        var paths = Set<String>()
        var identifiers = Set<String>()
        entries = (defaults.array(forKey: Self.storageKey) ?? []).compactMap { raw in
            guard let row = raw as? [String: String],
                  let id = row["id"], UUID(uuidString: id) != nil,
                  let rawTitle = row["title"],
                  let title = try? CreativeProjectCreator.validatedTitle(rawTitle),
                  let path = row["path"], Self.validPath(path),
                  row["projectId"].map(Self.validProjectId) ?? true else { return nil }
            // Stored paths were resolved during explicit registration. Loading
            // metadata must not traverse old, removed, or unmounted workspaces.
            let normalizedPath = URL(fileURLWithPath: path).standardizedFileURL.path
            guard paths.insert(normalizedPath).inserted,
                  identifiers.insert(id).inserted else { return nil }
            return SlateProject(id: id, title: title, path: normalizedPath, projectId: row["projectId"])
        }
    }

    func entry(for directory: URL) -> SlateProject? {
        guard directory.isFileURL else { return nil }
        let path = directory.standardizedFileURL.resolvingSymlinksInPath().path
        return entries.first { $0.path == path }
    }

    @discardableResult
    func register(directory: URL, title: String? = nil, projectId: String? = nil) throws -> SlateProject {
        guard directory.isFileURL, Self.validPath(directory.path) else {
            throw CreativeProjectFailure(message: "Choose a local project folder to add to your slate.")
        }
        if let projectId, !Self.validProjectId(projectId) {
            throw CreativeProjectFailure(message: "This project has an invalid identifier. Its files are unchanged.")
        }
        let location = directory.standardizedFileURL.resolvingSymlinksInPath()
        // Read only the type with lstat. Foundation attributesOfItem also asks
        // file providers for extended attributes, which can stall app launch.
        var attributes = stat()
        guard location.path.withCString({ lstat($0, &attributes) }) == 0,
              attributes.st_mode & S_IFMT == S_IFDIR else {
            throw CreativeProjectFailure(message: "This project folder is unavailable. Choose its current location.")
        }
        try CreativeProjectCreator.requireCompletedCreation(in: location)
        for name in ["config.json", "workspace.sqlite", "canonical.sqlite"] {
            guard location.appendingPathComponent(name).path.withCString({ lstat($0, &attributes) }) == 0,
                  attributes.st_mode & S_IFMT == S_IFREG else {
                throw CreativeProjectFailure(message: "Choose a completed local workspace containing config.json, workspace.sqlite, and canonical.sqlite. Its files are unchanged.")
            }
        }
        let existingIndex = entries.firstIndex { $0.path == location.path }
        let existing = existingIndex.map { entries[$0] }
        let label = try title.map(CreativeProjectCreator.validatedTitle)
            ?? existing?.title ?? Self.fallbackTitle(for: location)
        let result = SlateProject(id: existing?.id ?? UUID().uuidString,
                                  title: label, path: location.path,
                                  projectId: projectId ?? existing?.projectId)
        if let existingIndex { entries[existingIndex] = result }
        else { entries.append(result) }
        persist()
        return result
    }

    private func persist() {
        defaults.set(entries.map { project -> [String: String] in
            var value = ["id": project.id, "title": project.title, "path": project.path]
            if let projectId = project.projectId { value["projectId"] = projectId }
            return value
        }, forKey: Self.storageKey)
    }

    private static func validPath(_ path: String) -> Bool {
        path.hasPrefix("/") && path != "/" &&
        !path.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
    }

    private static func validProjectId(_ id: String) -> Bool {
        !id.isEmpty && id.utf16.count <= 240 &&
        !id.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
    }

    private static func fallbackTitle(for directory: URL) throws -> String {
        let folder = directory.lastPathComponent.lowercased() == "workspace"
            ? directory.deletingLastPathComponent().lastPathComponent : directory.lastPathComponent
        let label = folder.contains(" ") ? folder : folder
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ").capitalized
        return try CreativeProjectCreator.validatedTitle(label)
    }
}
