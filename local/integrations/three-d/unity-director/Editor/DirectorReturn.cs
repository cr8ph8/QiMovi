using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace CanIScreenwrite.Director.Editor
{
    [Serializable] internal sealed class ReturnOrigin
    {
        public string projectId, sourceHash, sceneId, shotId, target, basisSha256, exchangeSha256, planFileSha256, exchangeFileSha256;
    }
    [Serializable] internal sealed class ReturnApplication { public string name = "Unity", version; }
    [Serializable] internal sealed class ReturnArtifact { public string path, sha256; }
    [Serializable] internal sealed class ReturnMedia { public string path, sha256, role; public int frame; }
    [Serializable] internal sealed class ReturnInventory { public string path, sha256; public long byteLength; }
    [Serializable] internal sealed class ReturnReceipt
    {
        public string schemaVersion = "caniscreenwrite-dcc-stage-return/v1", authority = "DCC_RETURN_PENDING_REVIEW";
        public string kitFilesSha256;
        public ReturnOrigin origin;
        public ReturnApplication application;
        public ReturnArtifact observation, sceneFile;
        public ReturnMedia[] media = new ReturnMedia[0];
        public ReturnInventory[] files;
        public string rightsStatus = "UNKNOWN";
        public bool reopenedVerified = false, approvalGranted = false, finalMedia = false;
    }

    // A current clean scene plus the original kit. No automatic scene saving,
    // camera-plan application, provider execution or approval.
    public static class DirectorReturn
    {
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static void Require(bool ok, string reason) { if (!ok) throw new InvalidDataException(reason); }
        private static byte[] Read(string path, long max)
        {
            var info = new FileInfo(path);
            Require(info.Exists && (info.Attributes & FileAttributes.ReparsePoint) == 0 && info.Length > 0 && info.Length <= max, "Missing, linked, or oversized return input: " + info.Name);
            var bytes = File.ReadAllBytes(path);
            Require(bytes.LongLength == info.Length, "Return input changed while reading: " + info.Name);
            return bytes;
        }
        public static string Export(DirectorStage stage, string originalPlanPath, string outputDirectory)
        {
            return ExportCore(stage, originalPlanPath, outputDirectory, false);
        }
        public static string ExportRendered(DirectorStage stage, string originalPlanPath, string outputDirectory)
        {
            return ExportCore(stage, originalPlanPath, outputDirectory, true);
        }
        private static string WithUnknownDuration(string json)
        {
            return json.Substring(0, json.LastIndexOf('}')) + ",\n  \"measuredMediaDurationMs\": null\n}\n";
        }
        private static string ExportCore(DirectorStage stage, string originalPlanPath, string outputDirectory, bool render)
        {
            Require(stage && !EditorApplication.isPlayingOrWillChangePlaymode, "Choose a Director stage in Edit mode.");
            Require(Path.GetFileName(originalPlanPath) == "stage-plan.json", "Choose the original stage-plan.json beside files.json.");
            var scene = stage.gameObject.scene;
            Require(!string.IsNullOrEmpty(scene.path) && !scene.isDirty, "Save this scene with Unity's Save As before returning it. Unsaved changes are never saved automatically.");
            string kit = Path.GetDirectoryName(Path.GetFullPath(originalPlanPath));
            string output = Path.GetFullPath(outputDirectory);
            Require(!Directory.Exists(output) && !File.Exists(output), "Choose a new return folder; existing files are never replaced.");
            Require(Directory.Exists(Path.GetDirectoryName(output)), "The return parent folder must already exist.");
            var planBytes = Read(Path.Combine(kit, "stage-plan.json"), 128 * 1024);
            var manifestBytes = Read(Path.Combine(kit, "files.json"), 128 * 1024);
            var exchangeBytes = Read(Path.Combine(kit, "camera-exchange.json"), 1024 * 1024);
            var envelopeBytes = Read(Path.Combine(kit, "unity-scene.json"), 2 * 1024 * 1024);
            string planText = Utf8.GetString(planBytes), manifestText = Utf8.GetString(manifestBytes);
            var plan = DirectorMotion.Validate(stage, planText, manifestText);
            Require(Utf8.GetString(envelopeBytes) == stage.envelopeJson, "The original kit handoff does not match this stage.");
            var manifest = JsonUtility.FromJson<KitManifest>(manifestText);
            Require(manifest.files.Count(file => file.path == "camera-exchange.json" && file.sha256 == DirectorMotion.Digest(exchangeBytes)) == 1, "Original camera exchange bytes no longer match their kit.");
            var exchange = JsonUtility.FromJson<Exchange>(Utf8.GetString(exchangeBytes));
            Require(exchange != null && exchange.sha256 == plan.exchangeSha256 && exchange.source != null && exchange.source.projectId == plan.projectId && exchange.source.sourceHash == plan.sourceHash && exchange.scene != null && exchange.scene.id == plan.sceneId && exchange.basis != null && exchange.basis.sha256 == plan.basisSha256, "Camera exchange source differs from this plan.");
            var observed = DirectorWindow.ReadObservation(stage);
            Require(observed.sceneFile.status == "FILE_PRESENT_NOT_REOPEN_VERIFIED" && !observed.sceneFile.dirty, "Only a saved clean scene can be returned.");
            var sceneBytes = Read(scene.path, 63L * 1024 * 1024);
            Require(DirectorMotion.Digest(sceneBytes) == observed.sceneFile.sha256, "The saved scene changed while it was being observed.");
            RenderedRehearsal rehearsal = null;
            if (render)
            {
                var state = stage.cameraMotions == null ? null : stage.cameraMotions.SingleOrDefault(item => item.shotId == plan.shotId);
                Require(state != null && state.applied && state.planJson == planText && state.kitManifestJson == manifestText, "Load and apply this exact original plan to its shot before rendering the return.");
                rehearsal = DirectorRender.Read(stage, state);
                Require(JsonUtility.ToJson(rehearsal.observation.directorObservation) == JsonUtility.ToJson(observed), "The scene observation changed before rendering.");
            }
            var files = new Dictionary<string, byte[]> {
                { "stage-plan.json", planBytes }, { "camera-exchange.json", exchangeBytes }, { "kit-files.json", manifestBytes },
                { "observation.json", Utf8.GetBytes(rehearsal == null ? JsonUtility.ToJson(observed, true) + "\n" : WithUnknownDuration(JsonUtility.ToJson(rehearsal.observation, true))) }, { "returned-scene.unity", sceneBytes }
            };
            if (rehearsal != null) foreach (var image in rehearsal.media) files.Add(image.Key, image.Value);
            var receipt = new ReturnReceipt {
                kitFilesSha256 = DirectorMotion.Digest(manifestBytes),
                origin = new ReturnOrigin { projectId = plan.projectId, sourceHash = plan.sourceHash, sceneId = plan.sceneId, shotId = plan.shotId, target = "UNITY", basisSha256 = plan.basisSha256, exchangeSha256 = plan.exchangeSha256, planFileSha256 = DirectorMotion.Digest(planBytes), exchangeFileSha256 = DirectorMotion.Digest(exchangeBytes) },
                application = new ReturnApplication { version = Application.unityVersion },
                observation = new ReturnArtifact { path = "observation.json", sha256 = DirectorMotion.Digest(files["observation.json"]) },
                sceneFile = new ReturnArtifact { path = "returned-scene.unity", sha256 = DirectorMotion.Digest(sceneBytes) },
                media = rehearsal == null ? new ReturnMedia[0] : rehearsal.observation.observedFrames.Select(frame => new ReturnMedia { path = frame.media.filename, sha256 = frame.media.sha256, frame = frame.frame, role = frame.label == "opening" ? "OPENING" : frame.label == "midpoint" ? "MOMENT" : "ENDING" }).ToArray(),
                files = files.Select(file => new ReturnInventory { path = file.Key, sha256 = DirectorMotion.Digest(file.Value), byteLength = file.Value.LongLength }).ToArray()
            };
            // JsonUtility has no JSON-null scalar representation. Duration remains
            // explicitly unknown instead of being coerced to zero or planned time.
            string json = JsonUtility.ToJson(receipt, true);
            files.Add("stage-return.json", Utf8.GetBytes(WithUnknownDuration(json)));
            Require(files.Sum(file => file.Value.LongLength) <= 64L * 1024 * 1024, "The return exceeds QiMovi's 64 MiB import limit.");
            Require(!scene.isDirty && DirectorMotion.Digest(Read(scene.path, 63L * 1024 * 1024)) == observed.sceneFile.sha256, "Scene changed before return export.");
            Directory.CreateDirectory(output);
            foreach (var file in files)
                using (var stream = new FileStream(Path.Combine(output, file.Key), FileMode.CreateNew, FileAccess.Write)) stream.Write(file.Value, 0, file.Value.Length);
            return output;
        }
    }
}
