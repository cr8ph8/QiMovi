import SwiftUI
import UniformTypeIdentifiers

@main
struct QiMoviApp: App {
    @State private var store = ProductionStore()
    var body: some Scene {
        WindowGroup {
            ProductionHome(store: store)
                .tint(QiStyle.gold)
                .preferredColorScheme(.dark)
        }
    }
}

enum QiStyle {
    static let gold = Color(red: 0.83, green: 0.66, blue: 0.32)
    static let background = Color(red: 0.055, green: 0.065, blue: 0.075)
    static let card = Color(red: 0.10, green: 0.115, blue: 0.13)
    static let phases = ["Pre-development", "Development", "Pre-production", "Production", "Wrap", "Post-production", "Marketing & release"]
}

enum ProductionTab: Hashable { case slate, shots, camera, tracker, connect }

struct ProductionHome: View {
    @Bindable var store: ProductionStore
    @State private var tab: ProductionTab = .slate
    @State private var cameraShotID: String?
    @State private var importError: String?
    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                SlateView(store: store, openShots: { tab = .shots }, openTracker: { tab = .tracker })
            }.tabItem { Label("Slate", systemImage: "film.stack") }.tag(ProductionTab.slate)
            NavigationStack {
                ShotsView(store: store, directShot: { id in cameraShotID = id; tab = .camera })
            }.tabItem { Label("Shots", systemImage: "rectangle.stack") }.tag(ProductionTab.shots)
            NavigationStack {
                PhoneCameraWorkspace(store: store, selectedShotID: $cameraShotID)
            }.tabItem { Label("Camera", systemImage: "viewfinder") }.tag(ProductionTab.camera)
            NavigationStack { TrackerView(store: store) }
                .tabItem { Label("Tracker", systemImage: "checklist") }.tag(ProductionTab.tracker)
            NavigationStack { ConnectionsView(store: store) }
                .tabItem { Label("Connect", systemImage: "arrow.triangle.branch") }.tag(ProductionTab.connect)
        }
        .onOpenURL { url in
            do { try store.importPackage(from: url); tab = .slate }
            catch { importError = error.localizedDescription }
        }
        .alert("Couldn't import production package", isPresented: Binding(get: { importError != nil }, set: { if !$0 { importError = nil } })) {
            Button("OK") { importError = nil }
        } message: { Text(importError ?? "") }
        .overlay(alignment: .top) {
            if let error = store.lastError {
                Text(error).font(.caption).padding().background(.red.opacity(0.9), in: RoundedRectangle(cornerRadius: 12)).padding()
            }
        }
    }
}

struct ProjectContext: View {
    @Bindable var store: ProductionStore
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "film").foregroundStyle(QiStyle.gold)
            Picker("Project", selection: Binding(get: { store.selectedProjectID ?? "" }, set: { store.selectProject($0) })) {
                ForEach(store.projects) { project in Text(project.title).tag(project.id) }
            }.labelsHidden().tint(.primary)
            Spacer(minLength: 0)
            if let project = store.selectedProject {
                Text(project.phase).font(.caption2.weight(.semibold)).foregroundStyle(QiStyle.gold).lineLimit(2)
            }
        }.padding(12).background(QiStyle.card, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct QiCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View { content.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(QiStyle.card, in: RoundedRectangle(cornerRadius: 20)) }
}

struct EmptyProductionView: View {
    let title: String
    let message: String
    var body: some View { ContentUnavailableView(title, systemImage: "film.stack", description: Text(message)) }
}
