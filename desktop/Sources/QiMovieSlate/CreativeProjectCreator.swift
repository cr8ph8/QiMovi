import Foundation
import CoreFoundation
import Darwin

struct CreativeProjectFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct CreatedCreativeProject {
    let directory: URL
    let projectId: String
    let title: String
}

/// Creates an independent workspace with the bundled CLI. It never opens, deletes,
/// or writes the current project, and never treats a project title as a path.
enum CreativeProjectCreator {
    static func validatedTitle(_ input: String) throws -> String {
        let title = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.utf16.count <= 240,
              !title.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
            throw CreativeProjectFailure(message: "Enter a project title of 1–240 characters without line breaks or control characters.")
        }
        return title
    }

    static func destination(in parent: URL, identifier: UUID = UUID()) throws -> URL {
        guard parent.isFileURL else { throw CreativeProjectFailure(message: "Choose a folder on this Mac.") }
        let directory = parent.standardizedFileURL.appendingPathComponent("CanIScreenwrite Project-" + identifier.uuidString, isDirectory: true)
        var attributes = stat()
        guard directory.path.withCString({ lstat($0, &attributes) }) != 0, errno == ENOENT else {
            throw CreativeProjectFailure(message: "The new project folder already exists. Choose a new destination.")
        }
        return directory
    }

    static func requireCompletedCreation(in directory: URL) throws {
        var attributes = stat()
        let marker = directory.appendingPathComponent("project-creation.json")
        guard marker.path.withCString({ lstat($0, &attributes) }) != 0, errno == ENOENT else {
            throw CreativeProjectFailure(message: "This project has an unfinished creation marker. Its files are preserved; choose a completed project folder.")
        }
    }

    static func verifyReceipt(_ data: Data, directory: URL, title: String) throws -> CreatedCreativeProject {
        let failure = CreativeProjectFailure(message: "The new project did not return a verified creation receipt. Its folder is preserved for inspection.")
        guard data.count <= 65_536,
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(value.keys) == Set(["status", "directory", "projectId", "title", "profile", "sourceHash", "sourceStatus", "sourceRequired"]),
              value["status"] as? String == "CREATIVE_PROJECT_CREATED",
              value["directory"] as? String == directory.standardizedFileURL.path,
              value["title"] as? String == title,
              value["profile"] as? String == "caniscreenwrite-creative/v1",
              value["sourceHash"] is NSNull,
              value["sourceStatus"] as? String == "NO_SCREENPLAY",
              let required = value["sourceRequired"] as? NSNumber,
              CFGetTypeID(required) == CFBooleanGetTypeID(), !required.boolValue,
              let id = value["projectId"] as? String, !id.isEmpty, id.utf16.count <= 240 else { throw failure }

        var attributes = stat()
        guard directory.path.withCString({ lstat($0, &attributes) }) == 0,
              attributes.st_mode & S_IFMT == S_IFDIR else { throw failure }
        try requireCompletedCreation(in: directory)
        for name in ["config.json", "workspace.sqlite", "canonical.sqlite"] {
            let path = directory.appendingPathComponent(name).path
            guard path.withCString({ lstat($0, &attributes) }) == 0,
                  attributes.st_mode & S_IFMT == S_IFREG,
                  name != "config.json" || attributes.st_mode & 0o077 == 0 else { throw failure }
        }
        return CreatedCreativeProject(directory: directory, projectId: id, title: title)
    }

    static func create(directory: URL, title: String, resources: URL) async throws -> CreatedCreativeProject {
        let normalizedTitle = try validatedTitle(title)
        guard normalizedTitle == title else { throw CreativeProjectFailure(message: "Confirm the trimmed project title before creating its folder.") }
        var attributes = stat()
        guard directory.path.withCString({ lstat($0, &attributes) }) != 0, errno == ENOENT else {
            throw CreativeProjectFailure(message: "The destination already exists. Existing projects are never replaced.")
        }
        let captureURL = FileManager.default.temporaryDirectory.appendingPathComponent("caniscreenwrite-create-" + UUID().uuidString + ".json")
        let descriptor = captureURL.path.withCString { open($0, O_CREAT | O_EXCL | O_WRONLY, 0o600) }
        guard descriptor >= 0 else { throw CreativeProjectFailure(message: "The creation receipt could not be prepared.") }
        let capture = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer {
            try? capture.close()
            try? FileManager.default.removeItem(at: captureURL)
        }
        let child = Process()
        child.executableURL = resources.appendingPathComponent("node")
        child.arguments = [resources.appendingPathComponent("runtime/local/server/cli.mjs").path,
                           "create-project", "--data", directory.path, "--title", title]
        child.currentDirectoryURL = resources.appendingPathComponent("runtime")
        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "NODE_OPTIONS"); environment.removeValue(forKey: "NODE_PATH")
        child.environment = environment
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = capture
        // Diagnostics may include private configuration. Report a bounded local
        // error and exit code, never raw CLI output or owner credentials.
        child.standardError = FileHandle.nullDevice
        let code: Int32
        do {
            code = try await withCheckedThrowingContinuation { continuation in
                child.terminationHandler = { task in continuation.resume(returning: task.terminationStatus) }
                do { try child.run() }
                catch { child.terminationHandler = nil; continuation.resume(throwing: error) }
            }
        } catch {
            throw CreativeProjectFailure(message: "The bundled project creator could not start. The current project is unchanged.")
        }
        guard code == 0 else {
            throw CreativeProjectFailure(message: "Project creation did not finish (exit \(code)). The current project is unchanged; any partial new folder is preserved.")
        }
        try capture.synchronize()
        guard captureURL.path.withCString({ lstat($0, &attributes) }) == 0, attributes.st_size <= 65_536 else {
            throw CreativeProjectFailure(message: "The new project returned an invalid creation receipt. Its folder is preserved.")
        }
        return try verifyReceipt(Data(contentsOf: captureURL), directory: directory, title: title)
    }
}
