import SwiftUI
import AVFoundation

struct ClapperView: View {
    let project: FilmProject
    let shot: FilmShot
    @State private var ledger = ClapperStore.shared
    @ObservedObject private var capture = CameraCapture.shared
    @State private var flashing = false
    @State private var cuePlayer: AVAudioPlayer?
    @State private var cueError: String?

    private var scope: String { ClapperStore.scope(project: project, shot: shot) }
    private var settings: ClapperSettings { ledger.settings(project: project, shot: shot) }
    private func binding<T>(_ key: WritableKeyPath<ClapperSettings, T>) -> Binding<T> {
        Binding(get: { settings[keyPath: key] }, set: { value in
            var draft = settings; draft[keyPath: key] = value; ledger.drafts[scope] = draft
        })
    }
    private var history: [SavedClapperMark] {
        ledger.saved.filter { $0.mark.projectId == project.id && $0.mark.sceneId == shot.sceneId && $0.mark.shotId == shot.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(spacing: 0) {
                Canvas { context, size in
                    for index in -1...12 {
                        let x = CGFloat(index) * size.width / 10
                        var stripe = Path()
                        stripe.move(to: CGPoint(x: x, y: 0)); stripe.addLine(to: CGPoint(x: x + size.width / 18, y: 0))
                        stripe.addLine(to: CGPoint(x: x, y: size.height)); stripe.addLine(to: CGPoint(x: x - size.width / 18, y: size.height))
                        stripe.closeSubpath(); context.fill(stripe, with: .color(.white))
                    }
                }.frame(height: 32).background(.black).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 14) {
                    HStack { Text("QIMOVI").font(.caption.bold()).tracking(3); Spacer(); Text(settings.purpose == "PREVIZ" ? "PREVIZ" : "PRODUCTION").font(.caption.bold()) }
                    Text(project.title).font(.title3.bold()).lineLimit(2)
                    Divider().overlay(.black.opacity(0.25))
                    HStack(alignment: .top) {
                        VStack(alignment: .leading) { Text("SCENE / SHOT").font(.caption2.bold()); Text(shot.title).font(.title2.bold()).lineLimit(2); Text(shot.sceneHeading.isEmpty ? "Unassigned scene" : shot.sceneHeading).font(.subheadline).lineLimit(3) }
                        Spacer()
                        VStack(alignment: .trailing) { Text("TAKE").font(.caption2.bold()); Text("\(settings.takeNumber)").font(.system(size: 52, weight: .bold, design: .monospaced)) }
                    }
                    HStack { Text("ROLL \(settings.roll)"); Spacer(); Text("CAM \(settings.camera)") }.font(.subheadline.bold())
                    HStack { Text(settings.frameRate.label); Spacer(); Text("\(settings.soundMode) · \(settings.slatePosition)") }.font(.caption.bold())
                }.padding(18).background(flashing ? Color.white : Color(red: 0.92, green: 0.9, blue: 0.83)).foregroundStyle(.black)
            }.clipShape(RoundedRectangle(cornerRadius: 14))
                .accessibilityElement(children: .combine)
            Button(action: mark) {
                Label(flashing ? "MARK" : "Clap · mark take \(settings.takeNumber)", systemImage: "movieclapper.fill")
                    .font(.title3.bold()).frame(maxWidth: .infinity).padding(.vertical, 12)
            }.buttonStyle(.borderedProminent).disabled(flashing || ledger.pending != nil)
                .accessibilityIdentifier("clapper-mark")
            if let message = ledger.message { Text(message).font(.footnote).foregroundStyle(ledger.pending == nil ? Color.secondary : Color.red).accessibilityIdentifier("clapper-status") }
            if let pending = ledger.pending {
                Text("Unsaved mark: \(pending.projectTitle) · \(pending.shotTitle) · take \(pending.takeNumber)").font(.caption)
                Button("Retry saving mark") { _ = ledger.retrySave() }.buttonStyle(.borderedProminent)
            }
            if let cueError { Text(cueError).font(.caption).foregroundStyle(.orange) }
            if capture.isRecording {
                Label("Rotation recording · mark uses the latest sensor sample", systemImage: "record.circle").font(.caption).foregroundStyle(.red)
                Button("Stop & save movement") { capture.stop() }.buttonStyle(.bordered)
            }
            VStack(alignment: .leading, spacing: 14) {
                Stepper("Take \(settings.takeNumber)", value: binding(\.takeNumber), in: 1...9999)
                Button("Next take") { var draft = settings; draft.takeNumber = min(9999, draft.takeNumber + 1); ledger.drafts[scope] = draft }
                    .disabled(settings.takeNumber == 9999 || ledger.pending != nil)
                HStack {
                    VStack(alignment: .leading) { Text("Roll").font(.caption); TextField("Roll", text: binding(\.roll)).textFieldStyle(.roundedBorder) }
                    VStack(alignment: .leading) { Text("Camera").font(.caption); TextField("Camera", text: binding(\.camera)).textFieldStyle(.roundedBorder) }
                }
                Picker("Frame rate", selection: binding(\.frameRate)) { ForEach(SlateFrameRate.choices, id: \.self) { rate in Text(rate.label).tag(rate) } }
                Picker("Sound", selection: binding(\.soundMode)) { Text("Sync sound").tag("SYNC"); Text("MOS · no sync sound").tag("MOS") }.pickerStyle(.segmented)
                Picker("Slate", selection: binding(\.slatePosition)) { Text("Head slate").tag("HEAD"); Text("Tail slate").tag("TAIL") }.pickerStyle(.segmented)
                Picker("Work", selection: binding(\.purpose)) { Text("PreViz rehearsal").tag("PREVIZ"); Text("Production").tag("PRODUCTION") }.pickerStyle(.segmented)
                Toggle("Play a short sound cue", isOn: binding(\.soundCue))
                TextField("Take notes", text: binding(\.notes), axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(2...4)
            }.font(.subheadline)
            Text("Match the frame rate to your camera. The clock is a device timestamp, not jam-synced timecode. A mark identifies a take; it does not record video or confirm a captured shot. MOS means sound is not being synchronized.")
                .font(.caption).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 10) {
                Text("Slate log · \(history.count)").font(.headline)
                ForEach(Array(history.prefix(20))) { saved in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Take \(saved.mark.takeNumber) · \(saved.mark.slatePosition) · \(saved.mark.purpose)").font(.subheadline.bold())
                            Text(saved.mark.markedAt, format: .dateTime.month(.abbreviated).day().hour().minute().second()).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        ShareLink(item: saved.url) { Label("Share mark", systemImage: "square.and.arrow.up") }.font(.caption)
                    }
                }
                Text("On Mac: 3D & cameras → Phone rehearsals & clapper. Import the JSON to review and retain it with this shot.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func mark() {
        let recording = capture.clapperContext(projectID: project.id, sourceHash: project.sourceHash, sceneID: shot.sceneId, shotID: shot.id)
        guard let value = ledger.mark(project: project, shot: shot, settings: settings,
                                      recordingId: recording?.id, recordingTimeSeconds: recording?.seconds) else { return }
        capture.addClapperMark(value)
        flashing = true; cueError = nil
        if settings.soundCue { playCue() }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(650))
            flashing = false
        }
    }

    private func playCue() {
        do {
            let rate = 44_100, count = 4_410
            var pcm = Data()
            func u16(_ value: UInt16, into bytes: inout Data) { var little = value.littleEndian; withUnsafeBytes(of: &little) { bytes.append(contentsOf: $0) } }
            func u32(_ value: UInt32, into bytes: inout Data) { var little = value.littleEndian; withUnsafeBytes(of: &little) { bytes.append(contentsOf: $0) } }
            for index in 0..<count {
                let envelope = min(1, Double(index) / 80) * min(1, Double(count - index) / 200)
                let sample = Int16(sin(Double(index) * 2 * .pi * 1000 / Double(rate)) * envelope * 12_000)
                u16(UInt16(bitPattern: sample), into: &pcm)
            }
            var wav = Data("RIFF".utf8); u32(UInt32(pcm.count + 36), into: &wav); wav.append(Data("WAVEfmt ".utf8))
            u32(16, into: &wav); u16(1, into: &wav); u16(1, into: &wav); u32(UInt32(rate), into: &wav)
            u32(UInt32(rate * 2), into: &wav); u16(2, into: &wav); u16(16, into: &wav); wav.append(Data("data".utf8)); u32(UInt32(pcm.count), into: &wav); wav.append(pcm)
            let player = try AVAudioPlayer(data: wav); cuePlayer = player
            guard player.play() else { throw ProductionFailure.invalid("The phone could not play the cue.") }
        } catch { cueError = "Sound cue unavailable. The visual mark and log remain available." }
    }
}
