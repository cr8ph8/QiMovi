import SwiftUI

struct CameraView: View {
    let projectID: String?
    let projectTitle: String?
    let sourceHash: String?
    let sceneID: String?
    let shotID: String?
    let shotTitle: String?
    var project: FilmProject? = nil
    var shot: FilmShot? = nil
    @State private var tool = "Movement"
    @StateObject private var capture = CameraCapture.shared
    @Environment(\.scenePhase) private var scenePhase

    private var linked: Bool { projectID != nil && shotID != nil }
    private var takes: [SavedRotationTake] {
        capture.savedTakes.filter { projectID == nil || $0.take.projectId == projectID }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(tool == "Clapper" ? "Slate the take" : "Rehearse the movement").font(.title2.bold())
                    Text(tool == "Clapper" ? "Mark the selected shot, then share its slate log with your desktop project." : "Use your iPhone to record a shot’s rotation. Hold it in the same orientation throughout the take.")
                        .foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Label(projectTitle ?? "Choose a film on the Slate", systemImage: "film")
                        .font(.subheadline.weight(.semibold))
                    Text(shotTitle ?? "Choose a shot in Shots, then open Camera.")
                        .font(.headline)
                    Text(tool == "Clapper" ? "Digital slate · no video recording" : "Rotation rehearsal · no video recording")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding()
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 18))

                Picker("Camera tool", selection: $tool) {
                    Text("Movement").tag("Movement")
                    Text("Clapper").tag("Clapper")
                }.pickerStyle(.segmented)

                if tool == "Clapper" {
                    if let project, let shot { ClapperView(project: project, shot: shot) }
                    else { Text("Select a shot above to prepare its clapper.").foregroundStyle(.secondary) }
                } else {
                rotationMonitor

                HStack(spacing: 12) {
                    if capture.isRecording {
                        Button { capture.stop() } label: {
                            Label("Stop & save", systemImage: "stop.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent).tint(.red)
                        .accessibilityIdentifier("camera-stop")
                    } else if !capture.isMonitoring {
                        Button { capture.enableMotion() } label: {
                            Label("Enable motion", systemImage: "gyroscope").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("camera-enable-motion")
                    } else {
                        Button {
                            capture.start(projectID: projectID, projectTitle: projectTitle, sourceHash: sourceHash,
                                sceneID: sceneID, shotID: shotID, shotTitle: shotTitle, shotSourceHash: shot?.sourceRecordHash)
                        } label: {
                            Label("Record movement", systemImage: "record.circle").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!linked || !capture.hasReading || capture.hasUnsavedTake)
                        .accessibilityIdentifier("camera-record")
                        Button("Recenter", systemImage: "scope") { capture.recenter() }
                            .labelStyle(.iconOnly).buttonStyle(.bordered)
                            .disabled(!capture.hasReading)
                    }
                }
                if let message = capture.message {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("camera-status")
                }
                if capture.hasUnsavedTake {
                    Button("Retry saving movement") { capture.savePendingTake() }
                        .buttonStyle(.borderedProminent)
                }
                Text("Up to 3 minutes per movement. Recording stops when you leave this screen or lock the phone. Check Saved movements before closing the app.")
                    .font(.caption).foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Saved movements").font(.headline)
                        Spacer()
                        Text("\(takes.count)").foregroundStyle(.secondary)
                    }
                    if takes.isEmpty {
                        Text("Your recorded movements will appear here, linked to their project and shot.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    ForEach(Array(takes.prefix(30))) { saved in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(saved.take.shotTitle ?? saved.take.shotId).font(.subheadline.bold())
                            HStack {
                                Text(saved.take.recordedAt, format: .dateTime.month(.abbreviated).day().hour().minute())
                                Spacer()
                                Text(String(format: "%.1f s", saved.take.durationSeconds)).monospacedDigit()
                            }.font(.caption).foregroundStyle(.secondary)
                            ShareLink(item: saved.url) {
                                Label("Export movement", systemImage: "square.and.arrow.up")
                            }.font(.subheadline)
                        }
                        .padding().frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 14))
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Label("Desktop camera handoff", systemImage: "desktopcomputer").font(.subheadline.bold())
                    Text("On Mac, open 3D & cameras → Phone rehearsals & clapper to review these files. Orientation and slate marks retain their shot links; live control, position tracking and calibrated playback remain separate.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                }
            }.padding()
        }
        .navigationTitle("Camera")
        .onDisappear { capture.pause() }
        .onChange(of: scenePhase) { _, value in if value != .active { capture.pause() } }
        .onChange(of: shotID) { _, _ in capture.pause() }
        .onChange(of: projectID) { _, _ in capture.pause() }
        .onChange(of: sourceHash) { _, _ in capture.pause() }
    }

    private var rotationMonitor: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 20).fill(Color.black.opacity(0.8))
                Path { path in
                    path.move(to: CGPoint(x: 0, y: 78)); path.addLine(to: CGPoint(x: 300, y: 78))
                    path.move(to: CGPoint(x: 150, y: 0)); path.addLine(to: CGPoint(x: 150, y: 156))
                }.stroke(.white.opacity(0.13), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                    .frame(width: 300, height: 156)
                Image(systemName: "viewfinder")
                    .font(.system(size: 72, weight: .ultraLight))
                    .foregroundStyle(capture.isRecording ? .red : Color.accentColor)
                    .rotationEffect(.degrees(capture.roll))
                    .offset(x: max(-80, min(80, capture.yaw)), y: max(-45, min(45, -capture.pitch)))
                VStack {
                    HStack {
                        Label(capture.isRecording ? "REC" : capture.hasReading ? "READY" : "MOTION OFF",
                              systemImage: capture.isRecording ? "circle.fill" : "circle")
                            .foregroundStyle(capture.isRecording ? .red : .white.opacity(0.65))
                        Spacer()
                        Text(String(format: "%02d:%02d", Int(capture.elapsed) / 60, Int(capture.elapsed) % 60))
                            .monospacedDigit().foregroundStyle(.white)
                    }
                    Spacer()
                    Text("Orientation monitor").foregroundStyle(.white.opacity(0.5))
                }.font(.caption.weight(.semibold)).padding()
            }.frame(height: 188).accessibilityElement(children: .ignore)
                .accessibilityLabel(capture.isRecording ? "Recording movement, \(Int(capture.elapsed)) seconds" : "Orientation monitor")
            HStack {
                angle("Yaw", value: capture.yaw)
                angle("Pitch", value: capture.pitch)
                angle("Roll", value: capture.roll)
            }
        }
    }

    private func angle(_ label: String, value: Double) -> some View {
        VStack(spacing: 4) {
            Text(String(format: "%+.0f°", value)).font(.title3.monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity)
    }
}
