import AppKit
import WebKit

@MainActor final class StudioAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private let studio = StudioWebView()
    private let service = LocalService()
    private let slate = SlateCatalog()
    private let projectPicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let statusLabel = NSTextField(labelWithString: "Opening your local studio…")
    private var workspace: URL?
    private var terminating = false
    private var connecting = false
    private var backupRunning = false
    private var quitAfterBackup = false
    private var operationBusy = false
    private var connectionAttempt = UUID()
    private var createdProjectOpening: (directory: URL, completion: CheckedContinuation<Void, Error>)?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenus()
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: min(1440, screen.width - 60), height: min(940, screen.height - 70)),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "QiMovi — Hampton’s Slate"
        window.appearance = NSAppearance(named: .darkAqua)
        window.subtitle = "Writing · Worldbuilding · Film preparation"
        window.minSize = NSSize(width: 960, height: 680)
        window.isReleasedWhenClosed = false; window.delegate = self
        window.setFrameAutosaveName("QiMovieSlateMainWindow")
        window.backgroundColor = NSColor(calibratedRed: 0.035, green: 0.043, blue: 0.052, alpha: 1)
        let root = NSView(); root.translatesAutoresizingMaskIntoConstraints = false
        let slateBar = NSStackView(); slateBar.orientation = .horizontal; slateBar.spacing = 12
        slateBar.edgeInsets = NSEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        let slateTitle = NSTextField(labelWithString: "Hampton’s Slate")
        slateTitle.font = .systemFont(ofSize: 14, weight: .semibold)
        projectPicker.target = self; projectPicker.action = #selector(selectSlateProject)
        projectPicker.setAccessibilityLabel("Project on Hampton’s Slate")
        projectPicker.toolTip = "Switch films in this studio. Each film keeps its own drafts, budget and sources."
        projectPicker.widthAnchor.constraint(greaterThanOrEqualToConstant: 260).isActive = true
        let slateSpacer = NSView(); slateSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        for view in [slateTitle, projectPicker, slateSpacer] { slateBar.addArrangedSubview(view) }
        for (title, action) in [("New film", #selector(newCreativeProject)), ("Add existing film", #selector(chooseProject))] {
            let button = NSButton(title: title, target: self, action: action); button.bezelStyle = .rounded
            slateBar.addArrangedSubview(button)
        }
        let controls = NSStackView(); controls.orientation = .horizontal; controls.spacing = 12
        controls.edgeInsets = NSEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        statusLabel.font = .systemFont(ofSize: 11); statusLabel.textColor = .secondaryLabelColor
        statusLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let spacer = NSView(); spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        controls.addArrangedSubview(statusLabel); controls.addArrangedSubview(spacer)
        for (title, action) in [("Project home", #selector(revealProject)), ("Reconnect", #selector(reconnect))] {
            let button = NSButton(title: title, target: self, action: action); button.bezelStyle = .rounded; button.controlSize = .small
            controls.addArrangedSubview(button)
        }
        for view in [slateBar, studio.view, controls] { view.translatesAutoresizingMaskIntoConstraints = false; root.addSubview(view) }
        NSLayoutConstraint.activate([
            slateBar.topAnchor.constraint(equalTo: root.topAnchor), slateBar.leadingAnchor.constraint(equalTo: root.leadingAnchor), slateBar.trailingAnchor.constraint(equalTo: root.trailingAnchor), slateBar.heightAnchor.constraint(equalToConstant: 48),
            studio.view.topAnchor.constraint(equalTo: slateBar.bottomAnchor), studio.view.leadingAnchor.constraint(equalTo: root.leadingAnchor), studio.view.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            studio.view.bottomAnchor.constraint(equalTo: controls.topAnchor), controls.leadingAnchor.constraint(equalTo: root.leadingAnchor), controls.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            controls.bottomAnchor.constraint(equalTo: root.bottomAnchor), controls.heightAnchor.constraint(equalToConstant: 38)
        ])
        window.contentView = root; window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        studio.onStatus = { [weak self] text in self?.statusLabel.stringValue = text }
        studio.onRestoreSession = { [weak self] in
            guard let self, !self.operationBusy else { throw LocalFailure(message: "Finish the current project operation first.") }
            try await self.renewSessionInPlace()
        }
        service.onReady = { [weak self] _ in self?.openSession() }
        service.onFailure = { [weak self] message in
            guard let self else { return }
            self.connectionAttempt = UUID()
            self.connecting = false
            self.statusLabel.stringValue = message
            self.finishCreatedProjectOpening(.failure(LocalFailure(message: message)))
        }
        service.onStopped = { [weak self] in if self?.terminating == true { NSApp.reply(toApplicationShouldTerminate: true) } }
        do {
            if let index = CommandLine.arguments.firstIndex(of: "--project") {
                guard index + 1 < CommandLine.arguments.count, CommandLine.arguments[index + 1].hasPrefix("/") else {
                    throw LocalFailure(message: "Pass an absolute local project folder after --project.")
                }
                workspace = URL(fileURLWithPath: CommandLine.arguments[index + 1], isDirectory: true)
            } else if let saved = UserDefaults.standard.string(forKey: "workspacePath") { workspace = URL(fileURLWithPath: saved, isDirectory: true) }
            else if let file = Bundle.main.url(forResource: "desktop-defaults", withExtension: "json"),
                    let defaults = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: String],
                    let path = defaults["workspace"] { workspace = URL(fileURLWithPath: path, isDirectory: true) }
            if let workspace { try slate.register(directory: workspace) }
            refreshSlate()
            guard workspace != nil else { welcomeToStudio(); return }
            try launchService()
        } catch { refreshSlate(); statusLabel.stringValue = error.localizedDescription }
    }

    private func buildMenus() {
        let menu = NSMenu()
        let appItem = NSMenuItem(); let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About QiMovi", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide QiMovi", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit QiMovi", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(appItem)
        let fileItem = NSMenuItem(); let fileMenu = NSMenu(title: "File"); fileItem.submenu = fileMenu
        fileMenu.addItem(withTitle: "New Creative Project…", action: #selector(newCreativeProject), keyEquivalent: "n")
        fileMenu.addItem(withTitle: "Open Local Project…", action: #selector(chooseProject), keyEquivalent: "o")
        fileMenu.addItem(withTitle: "Open Project Home", action: #selector(revealProject), keyEquivalent: "")
        fileMenu.addItem(withTitle: "Reveal Workspace Data", action: #selector(revealWorkspace), keyEquivalent: "")
        fileMenu.addItem(withTitle: "Create Workspace Milestone…", action: #selector(backup), keyEquivalent: "")
        fileMenu.addItem(.separator()); fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        menu.addItem(fileItem)
        let editItem = NSMenuItem(); let editMenu = NSMenu(title: "Edit"); editItem.submenu = editMenu
        for (title, action, key) in [("Undo", Selector(("undo:")), "z"), ("Cut", #selector(NSText.cut(_:)), "x"),
                                    ("Copy", #selector(NSText.copy(_:)), "c"), ("Paste", #selector(NSText.paste(_:)), "v"),
                                    ("Select All", #selector(NSText.selectAll(_:)), "a")] {
            editMenu.addItem(withTitle: title, action: action, keyEquivalent: key)
        }
        menu.addItem(editItem)
        let viewItem = NSMenuItem(); let viewMenu = NSMenu(title: "View"); viewItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "Reconnect to Local Workspace", action: #selector(reconnect), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "Show Studio", action: #selector(showStudio), keyEquivalent: "1")
        menu.addItem(viewItem)
        let helpItem = NSMenuItem(); let helpMenu = NSMenu(title: "Help"); helpItem.submenu = helpMenu
        helpMenu.addItem(withTitle: "QiMovi Workflow Guide", action: #selector(openWorkflowGuide), keyEquivalent: "")
        helpMenu.addItem(withTitle: "Production Templates", action: #selector(revealProductionTemplates), keyEquivalent: "")
        helpMenu.addItem(withTitle: "CanIScreenwrite & Integration Guides", action: #selector(revealIntegrationGuides), keyEquivalent: "")
        menu.addItem(helpItem); NSApp.mainMenu = menu; NSApp.helpMenu = helpMenu
        for item in [appMenu, fileMenu, viewMenu, helpMenu].flatMap({ $0.items }) where item.action != #selector(NSApplication.terminate(_:)) && item.action != #selector(NSApplication.hide(_:)) && item.action != #selector(NSWindow.performClose(_:)) { item.target = self }
    }

    @objc private func openWorkflowGuide() {
        guard let resources = Bundle.main.resourceURL else { return }
        NSWorkspace.shared.open(resources.appendingPathComponent("runtime/local/docs/QIMOVI_WORKFLOW_GUIDE.md"))
    }
    @objc private func revealProductionTemplates() {
        guard let resources = Bundle.main.resourceURL else { return }
        NSWorkspace.shared.open(resources.appendingPathComponent("runtime/local/production-template-library", isDirectory: true))
    }
    @objc private func revealIntegrationGuides() {
        guard let resources = Bundle.main.resourceURL else { return }
        NSWorkspace.shared.open(resources.appendingPathComponent("runtime/local/docs", isDirectory: true))
    }

    private func launchService() throws {
        guard let workspace, !connecting else { return }
        try CreativeProjectCreator.requireCompletedCreation(in: workspace)
        connecting = true; statusLabel.stringValue = "Opening your project folder on this Mac…"
        let attempt = UUID(); connectionAttempt = attempt
        Task {
            do { try await service.start(workspace: workspace) }
            catch {
                guard connectionAttempt == attempt else { return }
                connecting = false; statusLabel.stringValue = error.localizedDescription
                finishCreatedProjectOpening(.failure(error))
            }
        }
    }
    private func openSession() {
        guard let workspace else { return }
        let attempt = UUID(); connectionAttempt = attempt; connecting = true
        Task {
            do {
                let origin = try await service.authenticate(workspace: workspace, cookies: studio.view.configuration.websiteDataStore.httpCookieStore)
                guard connectionAttempt == attempt, self.workspace == workspace else { return }
                studio.origin = origin
                studio.view.load(URLRequest(url: origin.appendingPathComponent("drifter.html")))
                UserDefaults.standard.set(workspace.path, forKey: "workspacePath")
                refreshSlate()
                window.subtitle = "\(slate.entry(for: workspace)?.title ?? projectHome(for: workspace).lastPathComponent) · Writing · Storyboard · Edit preparation"
                window.representedURL = workspace
                statusLabel.toolTip = "Saved project data: \(workspace.path)"
                statusLabel.stringValue = "Opening your saved project…"
                finishCreatedProjectOpening(.success(()))
            } catch {
                if connectionAttempt == attempt {
                    statusLabel.stringValue = error.localizedDescription
                    finishCreatedProjectOpening(.failure(error))
                }
            }
            if connectionAttempt == attempt { connecting = false }
        }
    }
    private func renewSessionInPlace() async throws {
        guard !connecting, !terminating, let workspace,
              service.process?.isRunning == true, let origin = service.origin,
              let page = studio.view.url, page.scheme == origin.scheme,
              page.host == origin.host, page.port == origin.port else {
            throw LocalFailure(message: "Keep this window open. The local service is not ready to restore access.")
        }
        connecting = true
        defer { connecting = false }
        statusLabel.stringValue = "Restoring local access…"
        do {
            let authenticatedOrigin = try await service.authenticate(workspace: workspace, cookies: studio.view.configuration.websiteDataStore.httpCookieStore)
            guard self.workspace == workspace, studio.view.url == page, authenticatedOrigin == origin else {
                throw LocalFailure(message: "The project changed while restoring access.")
            }
            // Refresh only the HTTP-only cookie. The document and all mounted
            // draft editors stay alive; the renderer re-reads saved records.
            statusLabel.stringValue = "Local session renewed · open drafts preserved"
        } catch { statusLabel.stringValue = "Access was not restored. Keep this window open and retry."; throw error }
    }
    private func mayLeaveDrafts(_ title: String) async -> Bool {
        guard studio.view.url != nil else { return true }
        // Read one explicit UI flag. No native credentials or filesystem bridge are injected into JavaScript.
        let dirty = (try? await studio.view.evaluateJavaScript("Boolean(document.querySelector('[data-unsaved=\"true\"]'))")) as? Bool
        if dirty == false { return true }
        let alert = NSAlert(); alert.messageText = title
        alert.informativeText = "Save any open drafts first. Saved revisions and the original screenplay stay on disk."
        alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Stay in Studio")
        return alert.runModal() == .alertFirstButtonReturn
    }
    private func welcomeToStudio() {
        statusLabel.stringValue = "Create a creative project or open an existing local project."
        let alert = NSAlert(); alert.messageText = "Welcome to QiMovi"
        alert.informativeText = "Start a new creative project on this Mac, or continue working in an existing local project folder. You can add a screenplay later."
        alert.addButton(withTitle: "New Creative Project…")
        alert.addButton(withTitle: "Open Existing Project…")
        alert.addButton(withTitle: "Not Now")
        switch alert.runModal() {
        case .alertFirstButtonReturn: newCreativeProject()
        case .alertSecondButtonReturn: chooseProject()
        default: break
        }
    }
    private func projectTitle() -> String? {
        let alert = NSAlert(); alert.messageText = "New Creative Project"
        alert.informativeText = "Add a film to Hampton’s Slate. Its drafts, research and budget stay together in this app. You can add a screenplay later."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 380, height: 26))
        field.placeholderString = "Project title"; field.setAccessibilityLabel("Project title")
        alert.accessoryView = field; alert.window.initialFirstResponder = field
        alert.addButton(withTitle: "Choose Location…"); alert.addButton(withTitle: "Cancel")
        while alert.runModal() == .alertFirstButtonReturn {
            do { return try CreativeProjectCreator.validatedTitle(field.stringValue) }
            catch { alert.informativeText = error.localizedDescription }
        }
        return nil
    }
    @objc private func newCreativeProject() {
        guard !connecting, !operationBusy, !terminating else { return }
        operationBusy = true
        Task {
            defer { operationBusy = false }
            guard let title = projectTitle() else { return }
            let panel = NSOpenPanel(); panel.title = "Choose where to keep \(title)"
            panel.message = "A new uniquely named project folder will be created here. Existing folders and projects are preserved."
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
            panel.allowsMultipleSelection = false; panel.prompt = "Create Project"
            guard panel.runModal() == .OK, let parent = panel.url else { return }
            var destination: URL?
            do {
                guard let resources = Bundle.main.resourceURL else { throw LocalFailure(message: "The app bundle has no runtime resources.") }
                let newDirectory = try CreativeProjectCreator.destination(in: parent); destination = newDirectory
                statusLabel.stringValue = "Creating \(title)… Your current project stays open."
                let project = try await CreativeProjectCreator.create(directory: newDirectory, title: title, resources: resources)
                try slate.register(directory: project.directory, title: project.title, projectId: project.projectId)
                refreshSlate()
                guard await mayLeaveDrafts("Open the new creative project?") else {
                    showCreatedProjectLocation(project.directory, message: "\(title) was created. Your current project is still open.")
                    return
                }
                await openCreatedProject(project)
            } catch {
                statusLabel.stringValue = "Project creation did not finish. The current workspace is unchanged."
                let alert = NSAlert(); alert.messageText = "Could not create the project"
                alert.informativeText = error.localizedDescription + (destination.map { "\n\nNew folder (if created):\n" + $0.path } ?? "")
                alert.addButton(withTitle: "OK"); alert.runModal()
            }
        }
    }
    private func finishCreatedProjectOpening(_ result: Result<Void, Error>) {
        guard let pending = createdProjectOpening, pending.directory == workspace else { return }
        createdProjectOpening = nil
        pending.completion.resume(with: result)
    }
    private func openCreatedProject(_ project: CreatedCreativeProject) async {
        await switchProject(to: project.directory)
    }
    private func switchProject(to directory: URL) async {
        let previous = workspace
        await stopService(); connecting = false; workspace = directory
        do {
            try await withCheckedThrowingContinuation { continuation in
                createdProjectOpening = (directory, continuation)
                do { try launchService() }
                catch { finishCreatedProjectOpening(.failure(error)) }
            }
        } catch {
            // Creation and opening are separate: retain the newly created files
            // and restore the prior service if startup or authentication failed.
            await stopService(); connecting = false; workspace = previous
            var recovery = "This film could not open. Its saved files are preserved."
            if previous != nil {
                do { try launchService(); recovery += " Your previous project is reopening." }
                catch { recovery += " Reopen your previous folder from File → Open Local Project." }
            }
            statusLabel.stringValue = recovery
        }
        refreshSlate()
    }
    private func refreshSlate() {
        projectPicker.removeAllItems()
        if slate.entries.isEmpty {
            projectPicker.addItem(withTitle: "Add your first film")
            projectPicker.isEnabled = false
            return
        }
        projectPicker.isEnabled = true
        for entry in slate.entries {
            projectPicker.addItem(withTitle: entry.title)
            projectPicker.lastItem?.representedObject = entry.id
            projectPicker.lastItem?.toolTip = entry.path
        }
        if let workspace, let active = slate.entry(for: workspace),
           let index = slate.entries.firstIndex(where: { $0.id == active.id }) {
            projectPicker.selectItem(at: index)
        } else { projectPicker.select(nil) }
    }
    @objc private func selectSlateProject() {
        let selectedID = projectPicker.selectedItem?.representedObject as? String
        refreshSlate()
        guard !connecting, !operationBusy, !terminating,
              let entry = slate.entries.first(where: { $0.id == selectedID }),
              workspace.map({ slate.entry(for: $0)?.id }) != entry.id else { return }
        operationBusy = true
        Task {
            defer { operationBusy = false; refreshSlate() }
            do { try slate.register(directory: entry.directory) }
            catch { statusLabel.stringValue = error.localizedDescription; return }
            guard await mayLeaveDrafts("Open \(entry.title) on Hampton’s Slate?") else { return }
            await switchProject(to: entry.directory)
        }
    }
    private func showCreatedProjectLocation(_ directory: URL, message: String) {
        statusLabel.stringValue = message
        let alert = NSAlert(); alert.messageText = "New project saved"
        alert.informativeText = message + "\n\n" + directory.path + "\n\nChoose this film from Hampton’s Slate at the top of the window."
        alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Show Folder")
        if alert.runModal() == .alertSecondButtonReturn { NSWorkspace.shared.activateFileViewerSelecting([directory]) }
    }
    @objc private func reconnect() {
        guard !connecting, !operationBusy else { return }
        operationBusy = true
        Task {
            defer { operationBusy = false }
            let currentURL = studio.view.url
            if service.process?.isRunning == true, let origin = service.origin,
               currentURL?.scheme == origin.scheme, currentURL?.host == origin.host,
               currentURL?.port == origin.port {
                do {
                    try await renewSessionInPlace()
                    _ = try? await studio.view.evaluateJavaScript("window.dispatchEvent(new Event('qimovi-session-restored'))")
                } catch { statusLabel.stringValue = error.localizedDescription }
                return
            }
            guard await mayLeaveDrafts("Reconnect to the local workspace?") else { return }
            if service.process?.isRunning == true { connecting = true; openSession() }
            else { do { try launchService() } catch { statusLabel.stringValue = error.localizedDescription } }
        }
    }
    @objc private func chooseProject() {
        guard !connecting, !operationBusy else { return }
        operationBusy = true
        Task {
        defer { operationBusy = false }
        if workspace != nil { guard await mayLeaveDrafts("Open a different local project?") else { return } }
        let panel = NSOpenPanel(); panel.title = "Choose an existing local project folder"; panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.message = "Choose the folder containing config.json, workspace.sqlite and canonical.sqlite. The app keeps the original files here."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard ["config.json", "workspace.sqlite", "canonical.sqlite"].allSatisfy({ FileManager.default.fileExists(atPath: url.appendingPathComponent($0).path) }) else {
            statusLabel.stringValue = "That folder is not an initialized local project."; return
        }
        do { try CreativeProjectCreator.requireCompletedCreation(in: url) }
        catch { statusLabel.stringValue = error.localizedDescription; return }
        do { try slate.register(directory: url) }
        catch { statusLabel.stringValue = error.localizedDescription; return }
        await switchProject(to: url)
        }
    }
    private func projectHome(for workspace: URL) -> URL {
        let parent = workspace.deletingLastPathComponent()
        // Recognize the existing organized project layout; ordinary workspaces stay their own home.
        guard workspace.lastPathComponent == "Workspace",
              FileManager.default.fileExists(atPath: parent.appendingPathComponent("START HERE.md").path),
              FileManager.default.fileExists(atPath: parent.appendingPathComponent("Library").path),
              FileManager.default.fileExists(atPath: parent.appendingPathComponent("Catalog").path) else { return workspace }
        return parent
    }
    @objc private func revealProject() { if let workspace { NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: projectHome(for: workspace).path) } }
    @objc private func revealWorkspace() { if let workspace { NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: workspace.path) } }
    @objc private func showStudio() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc private func about() {
        let project = workspace?.path ?? "No project open"
        let build = Bundle.main.url(forResource: "desktop-build", withExtension: "json")
            .flatMap { try? Data(contentsOf: $0) }
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
        let identity = build?["builtAt"] ?? "Build date unavailable"
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "QiMovi", .applicationVersion: "Local development 0.1",
                                                    .credits: NSAttributedString(string: "One local studio: CanIScreenwrite + storyboards + movie timeline + editor preparation.\n\nApplication: \(Bundle.main.bundlePath)\nProject data: \(project)\nBuilt: \(identity)\n\nStoryboard Review is a development preview of this app. Preview workspaces are separate copies; they do not sync automatically.")])
    }
    @objc private func backup() {
        guard let workspace, !connecting, !operationBusy else { return }
        operationBusy = true
        Task {
        defer { operationBusy = false }
        guard await mayLeaveDrafts("Create a milestone backup?") else { return }
        let panel = NSOpenPanel(); panel.title = "Choose a folder for the new milestone"; panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.message = "This backs up workspace records and owned media. Sibling Library, Catalog and Editable packages folders need a separate project-home backup."
        guard panel.runModal() == .OK, let parent = panel.url, let resources = Bundle.main.resourceURL else { return }
        let name = "QiMovieSlate-Milestone-" + ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-") + "-" + UUID().uuidString.prefix(8)
        let destination = parent.appendingPathComponent(name, isDirectory: true)
        connecting = true; backupRunning = true
            await stopService(); statusLabel.stringValue = "Creating a checksummed milestone…"
            let child = Process(); child.executableURL = resources.appendingPathComponent("node")
            child.arguments = [resources.appendingPathComponent("runtime/local/server/cli.mjs").path, "backup", "--data", workspace.path, "--output", destination.path]
            child.currentDirectoryURL = resources.appendingPathComponent("runtime")
            var environment = ProcessInfo.processInfo.environment; environment.removeValue(forKey: "NODE_OPTIONS"); environment.removeValue(forKey: "NODE_PATH"); child.environment = environment
            let output = Pipe(); child.standardOutput = output; child.standardError = output
            output.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
            do {
                let result: Int32 = try await withCheckedThrowingContinuation { continuation in
                    child.terminationHandler = { task in continuation.resume(returning: task.terminationStatus) }
                    do { try child.run() } catch { continuation.resume(throwing: error) }
                }
                output.fileHandleForReading.readabilityHandler = nil
                connecting = false; backupRunning = false
                if quitAfterBackup { NSApp.reply(toApplicationShouldTerminate: true); return }
                try launchService()
                if result == 0 { NSWorkspace.shared.activateFileViewerSelecting([destination]) }
                else { statusLabel.stringValue = "Backup did not pass verification. The original workspace is preserved." }
            } catch {
                connecting = false; backupRunning = false
                if quitAfterBackup { NSApp.reply(toApplicationShouldTerminate: true); return }
                statusLabel.stringValue = error.localizedDescription; try? launchService()
            }
        }
    }
    private func stopService() async {
        connectionAttempt = UUID()
        service.stop()
        while service.process != nil { try? await Task.sleep(for: .milliseconds(50)) }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if backupRunning { quitAfterBackup = true; return .terminateLater }
        if operationBusy { statusLabel.stringValue = "Finishing the current workspace operation. Quit again when it completes."; return .terminateCancel }
        if terminating { return .terminateLater }
        Task {
            guard await mayLeaveDrafts("Quit with unsaved drafts?") else { NSApp.reply(toApplicationShouldTerminate: false); return }
            terminating = true
            if service.process == nil { NSApp.reply(toApplicationShouldTerminate: true) }
            else { service.stop() }
        }
        return .terminateLater
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showStudio(); return true }
}
