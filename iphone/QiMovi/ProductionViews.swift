import SwiftUI
import UniformTypeIdentifiers

struct SlateView: View {
    @Bindable var store: ProductionStore
    let openShots: () -> Void
    let openTracker: () -> Void
    @State private var creating = false
    @State private var title = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 14) {
                    Image("QiMoviBrandMark").resizable().scaledToFit().frame(width: 72, height: 54).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("QiMovi").font(.largeTitle.bold())
                        Text("YOUR FILM. FROM IDEA TO SCREEN.").font(.system(size: 10, weight: .semibold, design: .rounded)).tracking(1.2).foregroundStyle(QiStyle.gold)
                    }
                }
                ProjectContext(store: store)
                if let project = store.selectedProject {
                    QiCard {
                        VStack(alignment: .leading, spacing: 15) {
                            Text("ON YOUR SLATE").font(.caption2.weight(.bold)).tracking(1.5).foregroundStyle(QiStyle.gold)
                            Text(project.title).font(.title.bold()).fixedSize(horizontal: false, vertical: true)
                            if let thumbnail = project.shots.compactMap(\.thumbnail).first, let image = UIImage(named: thumbnail) {
                                Image(uiImage: image).resizable().scaledToFill().frame(height: 165).clipped().clipShape(RoundedRectangle(cornerRadius: 12))
                                Text("Storyboard reference · desktop snapshot").font(.caption2).foregroundStyle(.secondary)
                            }
                            if let synopsis = project.synopsis, !synopsis.isEmpty { Text(synopsis).font(.subheadline).foregroundStyle(.secondary).lineLimit(5) }
                            HStack(spacing: 22) {
                                metric("Shots", value: "\(project.shots.count)")
                                metric("Tasks complete", value: "\(project.tasks.filter { $0.status == "done" }.count)/\(project.tasks.count)")
                            }
                            Divider()
                            HStack {
                                Button(action: openShots) { Label("Plan shots", systemImage: "rectangle.stack") }.buttonStyle(.borderedProminent).tint(QiStyle.gold).foregroundStyle(.black)
                                Button(action: openTracker) { Label("Track work", systemImage: "checklist") }.buttonStyle(.bordered)
                            }
                        }
                    }
                    Text("Your projects").font(.title3.bold())
                    ForEach(store.projects) { item in
                        Button { store.selectProject(item.id) } label: {
                            HStack(spacing: 14) {
                                Image(systemName: item.id == project.id ? "play.rectangle.fill" : "film.stack").font(.title2).foregroundStyle(QiStyle.gold)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(item.title).font(.headline).foregroundStyle(.primary).multilineTextAlignment(.leading)
                                    Text("\(item.phase) · \(item.shots.count) shots").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if item.id == project.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(QiStyle.gold) }
                            }.padding(16).background(QiStyle.card, in: RoundedRectangle(cornerRadius: 16))
                        }.buttonStyle(.plain)
                    }
                } else {
                    EmptyProductionView(title: "Start a film", message: "Create a project or import a production package from QiMovi on your Mac.")
                }
                if let asOf = store.asOf { Text("Desktop snapshot: \(asOf.prefix(10))").font(.caption2).foregroundStyle(QiStyle.gold) }
                Text("Phone changes stay on this device until you share a review package. Desktop snapshots are reference material, not a live connection.").font(.caption).foregroundStyle(.secondary)
            }.padding(20)
        }.background(QiStyle.background).navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { title = ""; creating = true } label: { Label("New project", systemImage: "plus") } } }
        .alert("New film project", isPresented: $creating) {
            TextField("Project title", text: $title)
            Button("Create") { let name = title.trimmingCharacters(in: .whitespacesAndNewlines); if !name.isEmpty { let id = store.addProject(title: name); store.selectProject(id) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Begin with a local production plan. Add the screenplay through QiCanIScreenwrite when it is ready.") }
    }
    private func metric(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) { Text(value).font(.title2.bold()).monospacedDigit(); Text(label).font(.caption).foregroundStyle(.secondary) }
    }
}

struct ShotsView: View {
    @Bindable var store: ProductionStore
    let directShot: (String) -> Void
    @State private var query = ""
    @State private var adding = false
    @State private var title = ""
    var body: some View {
        VStack(spacing: 0) {
            ProjectContext(store: store).padding(.horizontal).padding(.bottom, 8)
            if let project = store.selectedProject {
                let shots = project.shots.sorted { $0.order < $1.order }.filter { query.isEmpty || "\($0.title) \($0.sceneHeading)".localizedCaseInsensitiveContains(query) }
                if shots.isEmpty {
                    EmptyProductionView(title: query.isEmpty ? "Build your shot list" : "No matching shots", message: "Plan coverage, framing and movement for each scene. These are planned shots; captured camera takes stay separate.")
                } else {
                    List(shots) { shot in
                        NavigationLink {
                            ShotDetailView(store: store, projectID: project.id, shot: shot, directShot: directShot)
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                VStack(spacing: 6) {
                                if let thumbnail = shot.thumbnail, let image = UIImage(named: thumbnail) {
                                    Image(uiImage: image).resizable().scaledToFill().frame(width: 70, height: 42).clipped().clipShape(RoundedRectangle(cornerRadius: 5))
                                }
                                Text(String(format: "%02d", shot.order)).font(.system(.title3, design: .monospaced).bold()).foregroundStyle(QiStyle.gold).frame(width: 70)
                                }
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(shot.title).font(.headline)
                                    Text(shot.sceneHeading).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    Text([shot.framing, shot.movement].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption2).foregroundStyle(QiStyle.gold)
                                    Text(shot.status.capitalized).font(.caption2).foregroundStyle(.secondary)
                                }
                            }.padding(.vertical, 7)
                        }.listRowBackground(QiStyle.card)
                    }.scrollContentBackground(.hidden)
                }
            } else { EmptyProductionView(title: "Select a project", message: "Choose a film from your Slate.") }
        }.background(QiStyle.background).navigationTitle("Shot list")
        .searchable(text: $query, prompt: "Scene or shot")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { title = ""; adding = true } label: { Label("Add shot", systemImage: "plus") }.disabled(store.selectedProject == nil) } }
        .alert("Plan a shot", isPresented: $adding) {
            TextField("Shot description", text: $title)
            Button("Add") { if let id = store.selectedProjectID, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { _ = store.addShot(projectID: id, title: title) } }
            Button("Cancel", role: .cancel) {}
        }
    }
}

struct ShotDetailView: View {
    @Bindable var store: ProductionStore
    let projectID: String
    @State var shot: FilmShot
    let directShot: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var saved = false
    var body: some View {
        Form {
            if let thumbnail = shot.thumbnail, let image = UIImage(named: thumbnail) {
                Section {
                    Image(uiImage: image).resizable().scaledToFit()
                    Text("Storyboard reference from the desktop. Check continuity before recording.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("Shot \(shot.order) · \(shot.sceneHeading)") {
                TextField("Shot description", text: $shot.title, axis: .vertical)
                if shot.sceneId.isEmpty { TextField("Scene heading", text: $shot.sceneHeading) } else { Text(shot.sceneHeading).foregroundStyle(.secondary) }
            }
            Section("Camera plan") {
                TextField("Framing, e.g. medium close-up", text: $shot.framing)
                TextField("Movement, e.g. pan right", text: $shot.movement)
                TextField("Planned seconds", value: $shot.durationSeconds, format: .number).keyboardType(.decimalPad)
                Text("Framing describes what fills the image. Camera movement describes how the view changes. Planned timing is not measured footage.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Direction & continuity") {
                TextEditor(text: $shot.notes).frame(minHeight: 120)
            }
            Section("Planning progress") {
                Picker("Status", selection: $shot.status) {
                    ForEach(Array(Set(FilmShot.statuses + [shot.status])).sorted(), id: \.self) { Text($0.replacingOccurrences(of: "-", with: " ").capitalized).tag($0) }
                }
            }
            Section {
                Button { store.updateShot(projectID: projectID, shot: shot); saved = store.lastError == nil } label: { Label(saved ? "Saved on this iPhone" : "Save shot plan", systemImage: saved ? "checkmark.circle" : "square.and.arrow.down") }
                Button { store.updateShot(projectID: projectID, shot: shot); if store.lastError == nil { directShot(shot.id); dismiss() } } label: { Label("Rehearse camera movement", systemImage: "viewfinder") }
            }
        }.navigationTitle("Shot plan").navigationBarTitleDisplayMode(.inline)
        .onChange(of: shot.title) { _, _ in saved = false }
        .onChange(of: shot.notes) { _, _ in saved = false }
        .onChange(of: shot.sceneHeading) { _, _ in saved = false }
        .onChange(of: shot.framing) { _, _ in saved = false }
        .onChange(of: shot.movement) { _, _ in saved = false }
        .onChange(of: shot.durationSeconds) { _, _ in saved = false }
        .onChange(of: shot.status) { _, _ in saved = false }
    }
}

struct TrackerView: View {
    @Bindable var store: ProductionStore
    @State private var adding = false
    @State private var title = ""
    var body: some View {
        VStack(spacing: 0) {
            ProjectContext(store: store).padding()
            if let project = store.selectedProject {
                Form {
                    Section("Project phase") {
                        Picker("Current phase", selection: Binding(get: { project.phase }, set: { store.updatePhase(projectID: project.id, phase: $0) })) {
                            ForEach(FilmProject.phases, id: \.self) { Text($0).tag($0) }
                        }
                        Text("Track the work your production team needs next. Changing phase doesn't approve a budget, rights or delivery.").font(.caption).foregroundStyle(.secondary)
                    }
                    Section("Production checklist") {
                        if project.tasks.isEmpty { Text("Add the work you need for this phase.").foregroundStyle(.secondary) }
                        ForEach(project.tasks) { task in
                            Button { store.toggleTask(projectID: project.id, taskID: task.id) } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: task.status == "done" ? "checkmark.circle.fill" : "circle").foregroundStyle(task.status == "done" ? QiStyle.gold : .secondary)
                                    VStack(alignment: .leading, spacing: 4) { Text(task.title).foregroundStyle(.primary).strikethrough(task.status == "done"); Text(task.phase).font(.caption).foregroundStyle(.secondary) }
                                }.padding(.vertical, 4)
                            }.buttonStyle(.plain)
                        }
                        Button { title = ""; adding = true } label: { Label("Add production task", systemImage: "plus.circle") }
                    }
                }.scrollContentBackground(.hidden)
            } else { EmptyProductionView(title: "No film selected", message: "Start with a project on your Slate.") }
        }.background(QiStyle.background).navigationTitle("Production tracker")
        .alert("Add production task", isPresented: $adding) {
            TextField("Task", text: $title)
            Button("Add") { if let id = store.selectedProjectID, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { store.addTask(projectID: id, title: title) } }
            Button("Cancel", role: .cancel) {}
        }
    }
    private func phaseOrder(_ phase: String) -> Int { QiStyle.phases.firstIndex(of: phase) ?? 99 }
}

struct PhoneCameraWorkspace: View {
    @Bindable var store: ProductionStore
    @Binding var selectedShotID: String?
    private var shot: FilmShot? { store.selectedProject?.shots.first { $0.id == selectedShotID } }
    var body: some View {
        VStack(spacing: 0) {
            ProjectContext(store: store).padding(.horizontal)
            if let project = store.selectedProject {
                Picker("Shot for this take", selection: Binding(get: { selectedShotID ?? "" }, set: { selectedShotID = $0.isEmpty ? nil : $0 })) {
                    Text("Select a shot").tag("")
                    ForEach(project.shots.sorted { $0.order < $1.order }) { shot in Text("\(shot.order). \(shot.title)").tag(shot.id) }
                }.padding(.horizontal).padding(.vertical, 6)
            }
            CameraView(projectID: store.selectedProject?.id, projectTitle: store.selectedProject?.title, sourceHash: store.selectedProject?.sourceHash, sceneID: shot?.sceneId, shotID: shot?.id, shotTitle: shot?.title, project: store.selectedProject, shot: shot)
                .id("\(store.selectedProjectID ?? "")/\(store.selectedProject?.sourceHash ?? "")/\(selectedShotID ?? "")")
        }.navigationTitle("Camera & clapper").navigationBarTitleDisplayMode(.inline).background(QiStyle.background)
        .onChange(of: store.selectedProjectID) { _, _ in selectedShotID = nil }
    }
}

struct ConnectionsView: View {
    @Bindable var store: ProductionStore
    @State private var importing = false
    @State private var exported: URL?
    @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ProjectContext(store: store)
                QiCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("QiMovi desktop", systemImage: "desktopcomputer").font(.title3.bold())
                        Text("One film, across your devices").font(.headline)
                        Text("On Mac, open Phone and export this film. Import it here, plan your shots and tasks, then share your changes back to the Mac for review.").font(.subheadline).foregroundStyle(.secondary)
                        Button { importing = true } label: { Label("Import production package", systemImage: "square.and.arrow.down") }.buttonStyle(.borderedProminent).foregroundStyle(.black)
                        Button { if let id = store.selectedProjectID { exported = store.exportReview(projectID: id) } } label: { Label("Prepare phone review package", systemImage: "square.and.arrow.up") }.buttonStyle(.bordered).disabled(store.selectedProject == nil)
                        if let exported { ShareLink(item: exported) { Label("Share review package", systemImage: "airplayvideo") } }
                        if store.selectedProject?.desktopBaseline == nil {
                            Text("For desktop apply, start with a fresh export from Phone in QiMovi on Mac. Your current phone plan can still be shared for reference.").font(.caption).foregroundStyle(.secondary)
                        } else {
                            Label("Desktop review references retained", systemImage: "link").font(.caption).foregroundStyle(QiStyle.gold)
                        }
                        if let archive = store.lastImportArchive { ShareLink(item: archive) { Label("Share previous phone plan", systemImage: "clock.arrow.circlepath") } }
                        Text("File exchange · review each change on Mac").font(.caption).foregroundStyle(QiStyle.gold)
                    }
                }
                QiCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("QiCanIScreenwrite", systemImage: "text.book.closed").font(.title3.bold())
                        Text("Your separate writing partner").font(.headline)
                        Text("Write and revise in QiCanIScreenwrite. In QiMovi on Mac, link the approved screenplay to its production project, then refresh this phone's production package.").font(.subheadline).foregroundStyle(.secondary)
                        Text("Your existing writing app and copied draft files are preserved. QiMovi's phone tools work on film planning and production.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                QiCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Blender & Unity", systemImage: "cube.transparent").font(.title3.bold())
                        Text("Capture movement ideas").font(.headline)
                        Text("Record phone rotation against a selected shot. Share the take with its timing and source links. Live camera control and conversion to a 3D camera path still need the desktop adapter.").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Text("QiMovi Alpha · 0.6.0\nFilmmaking and production tracking").font(.caption).foregroundStyle(.secondary)
            }.padding(20)
        }.background(QiStyle.background).navigationTitle("Connected workflow")
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, UTType(filenameExtension: "qimovi") ?? .json]) { result in
            do { try store.prepareImport(from: result.get()) } catch { self.error = error.localizedDescription }
        }
        .alert("Import needs attention", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
    }
}


struct ProductionImportReview: View {
    @Bindable var store: ProductionStore
    let preview: ProductionImportPreview
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Review this desktop snapshot before changing the plan on your phone.")
                    LabeledContent("New films", value: "\(preview.additions.count)")
                    LabeledContent("Updated films", value: "\(preview.replacements.count)")
                    if !preview.replacements.isEmpty {
                        Text("Updated films replace this phone's shot plans and tasks. A copy of the previous phone slate will be saved first and can be shared from Connect. Camera recordings and writing-app drafts stay separate.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
                Section("Incoming films") {
                    ForEach(preview.package.projects) { project in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(project.title).font(.headline)
                            Text("\(project.shots.count) shots · \(project.tasks.count) tasks · \(project.phase)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Section {
                    Button { if store.confirmImport() { dismiss() } } label: {
                        Label(preview.replacements.isEmpty ? "Import plan" : "Archive old plan and import", systemImage: "square.and.arrow.down")
                    }
                    if let message = store.lastError { Text(message).foregroundStyle(.red).font(.caption) }
                }
            }.navigationTitle("Import film plan").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { store.pendingImport = nil; dismiss() } } }
        }.tint(QiStyle.gold).preferredColorScheme(.dark)
    }
}
