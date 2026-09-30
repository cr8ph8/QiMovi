using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace CanIScreenwrite.Director.Editor
{
    [Serializable] internal sealed class Envelope { public string schemaVersion, payloadJson, payloadSha256; }
    [Serializable] internal sealed class ParagraphData { public string id, type, text; }
    [Serializable] internal sealed class CellData { public string id, role, description, imageHash, timestampBasis; public string[] actionRefs; public bool timestampKnown; public long plannedTimestampMs; }
    [Serializable] internal sealed class ShotData { public string id, label, description; public bool durationKnown; public long plannedDurationMs; public CellData[] cells; }
    [Serializable] internal sealed class StagePayload
    {
        public string schemaVersion, authority, projectId, sourceHash, sceneId, heading, basisSha256, exchangeSha256, exchangeJson;
        public ParagraphData[] paragraphs; public ShotData[] shots;
        public string sourceCameraStatus, editorDefaultsStatus, sceneCreation; public bool approvalGranted;
    }
    [Serializable] internal sealed class ExchangeSource { public string projectId, sourceHash; }
    [Serializable] internal sealed class ExchangeBasis { public string sha256; }
    [Serializable] internal sealed class ExchangeScene { public string id; public ShotData[] shots; }
    [Serializable] internal sealed class ExchangeExecution { public bool canExecute; }
    [Serializable] internal sealed class ExchangePose { public string status; }
    [Serializable] internal sealed class ExchangePlanned { public ExchangePose pose; }
    [Serializable] internal sealed class ExchangeActual { public string status; }
    [Serializable] internal sealed class ExchangeCamera { public string shotId; public ExchangePlanned planned; public ExchangeActual actual; }
    [Serializable] internal sealed class Exchange { public string schemaVersion, sha256; public ExchangeSource source; public ExchangeBasis basis; public ExchangeScene scene; public ExchangeExecution execution; public ExchangeCamera[] cameras; }
    [Serializable] internal sealed class AppObservation { public string name, version, projectPath; }
    [Serializable] internal sealed class SceneFileObservation { public string status, path, sha256; public bool dirty; }
    [Serializable] internal sealed class CameraObservation
    {
        public bool enabled, physical, orthographic;
        public string fieldOfViewDegrees, orthographicSize, focalLengthMm, sensorWidthMm, sensorHeightMm, lensShiftX, lensShiftY, nearClipMeters, farClipMeters, gateFit;
    }
    [Serializable] internal sealed class ObjectObservation
    {
        public string id, kind, shotId, cellId, name, globalObjectId;
        public string[] position, rotation, scale;
        public CameraObservation[] camera;
    }
    [Serializable] internal sealed class Observation
    {
        public string schemaVersion = "caniscreenwrite-unity-director-observation/v1";
        public string authority = "EDITOR_OBSERVATION_PENDING_REVIEW";
        public string payloadSha256, projectId, sourceHash, sceneId, basisSha256, exchangeSha256, stageInstanceId;
        public AppObservation application; public SceneFileObservation sceneFile;
        public string coordinates = "UNITY_LEFT_HANDED_X_RIGHT_Y_UP_Z_FORWARD;WORLD;METERS_PER_UNIT_1_PROPOSED;QUATERNION_XYZW";
        public ObjectObservation[] objects; public string notes;
        public bool approvalGranted = false, finalMedia = false, reopenedVerified = false;
    }

    public sealed class DirectorWindow : EditorWindow
    {
        private DirectorStage stage;
        private Vector2 scroll;
        private DirectorStage playbackStage;
        private DirectorMotionState playback;
        private DirectorCameraBaseline playbackBaseline;
        private int playbackFrame;
        private double playbackStarted;
        [SerializeField] private string selectedShotId;
        private Texture2D previewImage;
        private bool livePreview, showNotes;
        private double nextPreviewAt;
        private string message = "Import a CanIScreenwrite handoff to create a new, unsaved additive scene.";
        [MenuItem("Window/CanIScreenwrite/Director")]
        public static void ShowWindow() { GetWindow<DirectorWindow>("CanIScreenwrite Director"); }

        private static void Require(bool value, string message) { if (!value) throw new InvalidDataException(message); }
        private static bool Hash(string value) { return value != null && Regex.IsMatch(value, "^[a-f0-9]{64}$"); }
        private static bool Id(string value) { return value != null && Regex.IsMatch(value, "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"); }
        private static string Digest(byte[] bytes)
        {
            using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }
        private static string Digest(string value) { return Digest(new UTF8Encoding(false, true).GetBytes(value)); }
        internal static StagePayload ReadEnvelope(string json, out Envelope envelope)
        {
            Require(json != null && Encoding.UTF8.GetByteCount(json) <= 2 * 1024 * 1024, "Handoff exceeds the local size limit.");
            envelope = JsonUtility.FromJson<Envelope>(json);
            Require(envelope != null && envelope.schemaVersion == "caniscreenwrite-unity-director-envelope/v1" && Hash(envelope.payloadSha256) && envelope.payloadJson != null && Digest(envelope.payloadJson) == envelope.payloadSha256, "Handoff hash does not match its exact payload.");
            var data = JsonUtility.FromJson<StagePayload>(envelope.payloadJson);
            Require(data != null && data.schemaVersion == "caniscreenwrite-unity-director/v1" && data.authority == "PROPOSED_BLOCKING_ONLY" && !data.approvalGranted, "This is not a proposed director handoff.");
            Require(Id(data.projectId) && Id(data.sceneId) && Hash(data.sourceHash) && Hash(data.basisSha256) && Hash(data.exchangeSha256), "Source identity is missing.");
            Require(data.sceneCreation == "NEW_ADDITIVE_UNSAVED" && data.sourceCameraStatus == "UNKNOWN" && data.editorDefaultsStatus == "PLACEHOLDERS_NOT_SOURCE_MEASUREMENTS", "The handoff cannot supply an approved camera pose.");
            var exchange = JsonUtility.FromJson<Exchange>(data.exchangeJson);
            Require(exchange != null && exchange.schemaVersion == "filmstack-camera-exchange/v1" && exchange.sha256 == data.exchangeSha256 && exchange.source != null && exchange.source.projectId == data.projectId && exchange.source.sourceHash == data.sourceHash && exchange.basis != null && exchange.basis.sha256 == data.basisSha256 && exchange.scene != null && exchange.scene.id == data.sceneId && exchange.execution != null && !exchange.execution.canExecute, "Embedded camera exchange is inconsistent.");
            Require(data.shots != null && data.shots.Length > 0 && data.shots.Length <= 100 && exchange.scene.shots != null && exchange.scene.shots.Length == data.shots.Length && exchange.cameras != null && exchange.cameras.Length == data.shots.Length, "Shot list is invalid.");
            Require(data.paragraphs != null && data.paragraphs.Length <= 2000, "Paragraph list is invalid.");
            var paragraphs = new HashSet<string>();
            foreach (var paragraph in data.paragraphs) Require(paragraph != null && Id(paragraph.id) && paragraphs.Add(paragraph.id), "Duplicate or missing source paragraph.");
            var shots = new HashSet<string>(); var cells = new HashSet<string>();
            for (int i = 0; i < data.shots.Length; i++)
            {
                var shot = data.shots[i]; var original = exchange.scene.shots[i]; var camera = exchange.cameras[i];
                Require(shot != null && Id(shot.id) && shots.Add(shot.id) && original != null && original.id == shot.id && camera != null && camera.shotId == shot.id && camera.planned != null && camera.planned.pose != null && camera.planned.pose.status == "UNKNOWN" && camera.actual != null && camera.actual.status == "NOT_OBSERVED", "Shot or camera identity changed.");
                Require(shot.cells != null && original.cells != null && shot.cells.Length == original.cells.Length, "Cell list changed.");
                Require(shot.plannedDurationMs >= 0 && shot.plannedDurationMs <= 86400000 && (shot.durationKnown || shot.plannedDurationMs == 0), "Planned duration is invalid.");
                for (int j = 0; j < shot.cells.Length; j++)
                {
                    var cell = shot.cells[j]; var originalCell = original.cells[j];
                    Require(cell != null && Id(cell.id) && cells.Add(cell.id) && originalCell != null && originalCell.id == cell.id && originalCell.role == cell.role && (cell.role == "START" || cell.role == "MOMENT" || cell.role == "END") && (cell.role != "START" || i == 0), "Orphan or incorrectly mapped storyboard cell.");
                    Require(cell.actionRefs != null && cell.actionRefs.All(paragraphs.Contains) && cell.actionRefs.Distinct().Count() == cell.actionRefs.Length && cell.timestampBasis == "UNCONFIRMED" && cell.plannedTimestampMs >= 0 && cell.plannedTimestampMs <= 86400000 && (cell.timestampKnown || cell.plannedTimestampMs == 0), "Cell source or planned timing is invalid.");
                }
            }
            Require(cells.Count <= 400, "Too many storyboard cells.");
            return data;
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField("QiMovi · Unity Director", EditorStyles.boldLabel);
            if (GUILayout.Button("Import checked handoff into a new scene")) Run(Import);
            var nextStage = (DirectorStage)EditorGUILayout.ObjectField("Director stage", stage, typeof(DirectorStage), true);
            if (nextStage != stage) { StopAllPreviews(); stage = nextStage; selectedShotId = null; }
            if (!stage && Selection.activeGameObject) stage = Selection.activeGameObject.GetComponentInParent<DirectorStage>();
            if (playback != null && stage != playbackStage) StopPlayback();
            EditorGUILayout.HelpBox(message, MessageType.None);
            if (!stage) return;
            try
            {
                Envelope envelope; var data = ReadEnvelope(stage.envelopeJson, out envelope);
                EditorGUILayout.LabelField(data.heading, EditorStyles.boldLabel);
                EditorGUILayout.LabelField("Source", data.sourceHash.Substring(0, 16));
                EditorGUILayout.LabelField("Scene", data.sceneId);
                EditorGUILayout.LabelField("State", stage.gameObject.scene.isDirty || string.IsNullOrEmpty(stage.gameObject.scene.path) ? "Unsaved changes — proposal only" : "Saved locally — reopening not verified");
                int selected = Array.FindIndex(data.shots, item => item.id == selectedShotId); if (selected < 0) selected = 0;
                EditorGUI.BeginChangeCheck();
                int next = EditorGUILayout.Popup("Direct this shot", selected, data.shots.Select(item => item.label + " · " + item.id).ToArray());
                if (EditorGUI.EndChangeCheck()) StopAllPreviews();
                selectedShotId = data.shots[next].id; var shot = data.shots[next];
                EditorGUILayout.LabelField(shot.description ?? "", EditorStyles.wordWrappedLabel);
                EditorGUILayout.LabelField(shot.durationKnown ? "Source plan: " + (shot.plannedDurationMs / 1000.0).ToString("0.###", CultureInfo.InvariantCulture) + " s" : "Source planned duration unknown");
                scroll = EditorGUILayout.BeginScrollView(scroll);
                EditorGUILayout.LabelField("1 · Frame and block", EditorStyles.boldLabel);
                EditorGUILayout.HelpBox("Objects are unassigned stand-ins. Framing and optics are your proposed direction, separate from the unchanged screenplay and original camera plan.", MessageType.Info);
                var motion = stage.cameraMotions == null ? null : stage.cameraMotions.SingleOrDefault(item => item.shotId == shot.id);
                EditorGUILayout.BeginHorizontal();
                if (GUILayout.Button("Select camera")) SelectMarker("camera:" + shot.id);
                using (new EditorGUI.DisabledScope(motion != null && motion.applied))
                    if (GUILayout.Button("Frame from Scene view")) Run(() => AlignCamera(shot.id));
                EditorGUILayout.EndHorizontal();
                if (motion != null && motion.applied) EditorGUILayout.LabelField("Restore the applied plan before changing its starting framing.", EditorStyles.wordWrappedMiniLabel);
                DrawOptics(shot.id);
                EditorGUILayout.BeginHorizontal();
                if (GUILayout.Button("Add blocking cube")) Run(() => AddBlock(shot.id));
                if (GUILayout.Button("Add performer stand-in")) Run(() => AddStandIn(shot.id, PrimitiveType.Capsule, "Unassigned performer stand-in", new Vector3(0.55f, 0.9f, 0.55f)));
                EditorGUILayout.EndHorizontal();
                EditorGUILayout.BeginHorizontal();
                if (GUILayout.Button("Add floor stand-in")) Run(() => AddStandIn(shot.id, PrimitiveType.Cube, "Proposed floor stand-in", new Vector3(8, 0.1f, 8)));
                if (GUILayout.Button("Add preview light")) Run(() => AddPreviewLight(shot.id));
                EditorGUILayout.EndHorizontal();
                foreach (var blocking in stage.GetComponentsInChildren<DirectorMarker>(true).Where(item => item.kind == "BLOCKING" && item.shotId == shot.id))
                    if (GUILayout.Button("Select " + blocking.name, EditorStyles.miniButton)) SelectMarker(blocking.markerId);
                DrawPreview(shot.id);
                EditorGUILayout.Space(); EditorGUILayout.LabelField("2 · Apply and rehearse", EditorStyles.boldLabel);
                if (GUILayout.Button("Load camera plan from exported Unity kit")) Run(LoadMotionPlan);
                if (motion != null) DrawMotion(motion);
                else EditorGUILayout.LabelField("Load this shot's exact stage-plan.json to unlock source-bound motion and preview return.", EditorStyles.wordWrappedLabel);
                EditorGUILayout.Space(); EditorGUILayout.LabelField("Storyboard moments", EditorStyles.boldLabel);
                foreach (var cell in shot.cells) if (GUILayout.Button(cell.role + "  " + cell.id + " — " + cell.description)) SelectMarker("cell:" + cell.id);
                showNotes = EditorGUILayout.Foldout(showNotes, "Scene direction notes", true);
                if (showNotes) {
                    EditorGUI.BeginChangeCheck(); var notes = EditorGUILayout.TextArea(stage.planningNotes ?? "", GUILayout.MinHeight(45));
                    if (EditorGUI.EndChangeCheck()) { Undo.RecordObject(stage, "Edit director planning note"); stage.planningNotes = notes.Substring(0, Math.Min(notes.Length, 8000)); EditorSceneManager.MarkSceneDirty(stage.gameObject.scene); }
                }
                EditorGUILayout.Space(); EditorGUILayout.LabelField("3 · Save and return to QiMovi", EditorStyles.boldLabel);
                EditorGUILayout.HelpBox("Save this scene with Unity's normal Save As. Returns require a saved, clean scene and a new output folder. Three rendered PNGs are still previews, not a video or an approved take.", MessageType.Info);
                using (new EditorGUI.DisabledScope(motion == null || !motion.applied || stage.gameObject.scene.isDirty || string.IsNullOrEmpty(stage.gameObject.scene.path)))
                    if (GUILayout.Button("Render opening / midpoint / ending return to QiMovi")) Run(() => ExportReturn(true));
                if (GUILayout.Button("Export current Unity observations")) Run(Export);
                if (GUILayout.Button("Export editable scene return to QiMovi")) Run(() => ExportReturn(false));
                EditorGUILayout.EndScrollView();
            }
            catch (Exception error) { EditorGUILayout.HelpBox(error.Message, MessageType.Error); }
        }

        private void OnEnable() { EditorApplication.update += PlaybackTick; EditorApplication.update += PreviewTick; Undo.undoRedoPerformed += CancelPlaybackAfterUndo; AssemblyReloadEvents.beforeAssemblyReload += StopAllPreviews; }
        private void OnDisable() { StopAllPreviews(); EditorApplication.update -= PlaybackTick; EditorApplication.update -= PreviewTick; Undo.undoRedoPerformed -= CancelPlaybackAfterUndo; AssemblyReloadEvents.beforeAssemblyReload -= StopAllPreviews; }
        private void CancelPlaybackAfterUndo() { playback = null; playbackStage = null; playbackBaseline = null; ClearPreview(); Repaint(); }
        private void ClearPreview() { livePreview = false; if (previewImage) DestroyImmediate(previewImage); previewImage = null; }
        private void StopAllPreviews() { StopPlayback(); ClearPreview(); }
        private void DrawOptics(string shotId)
        {
            var camera = DirectorMotion.ShotCamera(stage, shotId);
            using (new EditorGUI.DisabledScope(playback != null)) {
                EditorGUI.BeginChangeCheck(); float lens = EditorGUILayout.Slider("Current lens (mm)", camera.focalLength, 10, 200);
                if (EditorGUI.EndChangeCheck()) {
                    Undo.RecordObject(camera, "Direct camera optics"); camera.usePhysicalProperties = true; camera.orthographic = false; camera.focalLength = lens;
                    EditorSceneManager.MarkSceneDirty(stage.gameObject.scene); SceneView.RepaintAll();
                }
            }
            EditorGUILayout.LabelField("Actual sensor / gate", camera.sensorSize.x.ToString("0.##") + " × " + camera.sensorSize.y.ToString("0.##") + " mm · " + camera.gateFit);
        }
        private void DrawPreview(string shotId)
        {
            string unsupported = DirectorRender.UnsupportedReason();
            if (unsupported != null) { ClearPreview(); EditorGUILayout.HelpBox(unsupported, MessageType.Warning); return; }
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Refresh shot preview")) Run(() => RefreshPreview(shotId));
            livePreview = GUILayout.Toggle(livePreview, "Live preview · up to 5 fps", "Button");
            EditorGUILayout.EndHorizontal();
            if (previewImage) {
                var rect = GUILayoutUtility.GetAspectRect(16f / 9f, GUILayout.MaxHeight(260));
                GUI.DrawTexture(rect, previewImage, ScaleMode.ScaleToFit, false);
                EditorGUILayout.LabelField("Current framing · 640 × 360 preview · source scene only", EditorStyles.miniLabel);
            }
        }
        private void RefreshPreview(string shotId)
        {
            var next = DirectorRender.Preview(stage, DirectorMotion.ShotCamera(stage, shotId));
            if (previewImage) DestroyImmediate(previewImage); previewImage = next; Repaint();
        }
        private void PreviewTick()
        {
            if (!livePreview || EditorApplication.timeSinceStartup < nextPreviewAt) return;
            nextPreviewAt = EditorApplication.timeSinceStartup + 0.2;
            if (!stage || string.IsNullOrEmpty(selectedShotId) || EditorApplication.isPlayingOrWillChangePlaymode) { ClearPreview(); return; }
            try { RefreshPreview(selectedShotId); }
            catch (Exception error) { ClearPreview(); message = error.Message; Repaint(); }
        }
        private void LoadMotionPlan()
        {
            StopPlayback();
            string file = EditorUtility.OpenFilePanel("Choose stage-plan.json from the same Unity kit", "", "json"); if (string.IsNullOrEmpty(file)) return;
            Require(Path.GetFileName(file) == "stage-plan.json", "Choose the original stage-plan.json.");
            string manifest = Path.Combine(Path.GetDirectoryName(file), "files.json");
            Require(new FileInfo(file).Length <= 128 * 1024 && File.Exists(manifest) && new FileInfo(manifest).Length <= 128 * 1024, "The original kit files.json is missing or oversized.");
            var motion = DirectorMotion.Load(stage, File.ReadAllText(file, new UTF8Encoding(false, true)), File.ReadAllText(manifest, new UTF8Encoding(false, true)));
            ClearPreview(); selectedShotId = motion.shotId;
            SelectMarker("camera:" + motion.shotId); message = "Exact camera plan retained for shot " + motion.shotId + ". Frame its starting pose, then apply explicitly.";
        }
        private void DrawMotion(DirectorMotionState motion)
        {
            var plan = DirectorMotion.Checked(stage, motion); var t = plan.cameraTemplate;
            EditorGUILayout.LabelField("Plan: " + t.motion + " · " + t.lensMm + " mm · " + t.durationSeconds + " s · " + t.travelMm + " mm");
            EditorGUILayout.LabelField("Original plan SHA", motion.planSha256.Substring(0, 16));
            EditorGUI.BeginDisabledGroup(playback != null);
            if (!motion.applied && GUILayout.Button("Apply plan from this camera pose")) Run(() => DirectorMotion.Apply(stage, motion));
            if (motion.applied)
            {
                EditorGUI.BeginChangeCheck(); int frame = EditorGUILayout.IntSlider("Planned frame", motion.sampledFrame, 1, t.durationSeconds * t.frameRate);
                if (EditorGUI.EndChangeCheck()) Run(() => { DirectorMotion.Sample(stage, motion, frame, true); SceneView.RepaintAll(); });
                if (GUILayout.Button("Rehearse camera move")) Run(() => StartPlayback(motion));
                if (GUILayout.Button("Restore camera before applying plan")) Run(() => DirectorMotion.Restore(stage, motion));
                if (GUILayout.Button("Export sampled camera readback")) Run(() => ExportMotion(motion));
            }
            EditorGUI.EndDisabledGroup();
            if (playback == motion && GUILayout.Button("Stop rehearsal and restore preview pose")) StopPlayback();
        }
        private void StartPlayback(DirectorMotionState motion)
        {
            StopPlayback(); DirectorMotion.Checked(stage, motion); Require(motion.applied, "Apply the plan first.");
            playbackStage = stage; playback = motion; playbackBaseline = DirectorMotion.Capture(motion.camera); playbackFrame = motion.sampledFrame;
            playbackStarted = EditorApplication.timeSinceStartup;
        }
        private void PlaybackTick()
        {
            if (playback == null) return;
            try
            {
                if (!playbackStage || EditorApplication.isPlayingOrWillChangePlaymode) { StopPlayback(); return; }
                var t = DirectorMotion.Checked(playbackStage, playback).cameraTemplate;
                int frame = 1 + (int)Math.Floor((EditorApplication.timeSinceStartup - playbackStarted) * t.frameRate), last = t.durationSeconds * t.frameRate;
                if (frame > last) { StopPlayback(); return; }
                DirectorMotion.Sample(playbackStage, playback, frame, false); SceneView.RepaintAll(); Repaint();
            }
            catch (Exception error) { message = error.Message; StopPlayback(); }
        }
        private void StopPlayback()
        {
            if (playback != null && playback.camera && playbackBaseline != null) { DirectorMotion.PutBack(playback.camera, playbackBaseline); playback.sampledFrame = playbackFrame; }
            playback = null; playbackStage = null; playbackBaseline = null; Repaint();
        }
        private void ExportMotion(DirectorMotionState motion)
        {
            string output = EditorUtility.SaveFilePanel("Export proposed camera frame readback", "", motion.shotId + "-unity-motion", "json"); if (string.IsNullOrEmpty(output)) return;
            var result = DirectorMotion.ReadFrames(stage, motion);
            using (var stream = new FileStream(output, FileMode.CreateNew, FileAccess.Write)) using (var writer = new StreamWriter(stream, new UTF8Encoding(false))) writer.Write(JsonUtility.ToJson(result, true) + "\n");
            message = "Every planned frame sampled from the Unity camera; its previous pose was restored. This JSON is separate from the v1 return importer. No rendered media, independent reopening or approval was claimed.";
        }

        private void Run(Action action)
        {
            try { Require(!EditorApplication.isPlayingOrWillChangePlaymode, "Director staging is available in Edit mode only."); action(); }
            catch (Exception error) { message = error.Message; Debug.LogWarning("CanIScreenwrite Director: " + error.Message); }
        }
        private static GameObject Child(Scene scene, Transform parent, string name)
        {
            var go = new GameObject(name); SceneManager.MoveGameObjectToScene(go, scene);
            if (parent) go.transform.SetParent(parent, false);
            Undo.RegisterCreatedObjectUndo(go, "Create proposed director object"); return go;
        }
        private static DirectorMarker Marker(GameObject go, string id, string kind, string shotId, string cellId, string description)
        {
            var marker = go.AddComponent<DirectorMarker>(); marker.markerId = id; marker.kind = kind; marker.shotId = shotId; marker.cellId = cellId; marker.sourceDescription = description ?? ""; return marker;
        }
        private void Import()
        {
            StopAllPreviews();
            string file = EditorUtility.OpenFilePanel("Select CanIScreenwrite director handoff", "", "json"); if (string.IsNullOrEmpty(file)) return;
            Require(new FileInfo(file).Length <= 2 * 1024 * 1024, "Handoff is too large.");
            string json = File.ReadAllText(file, new UTF8Encoding(false, true));
            stage = CreateStage(json); selectedShotId = null; Selection.activeGameObject = stage.gameObject;
            message = "Created proposed shot/cell markers and disabled camera placeholders in a new unsaved scene. No source camera pose was inferred.";
        }
        internal static DirectorStage CreateStage(string json)
        {
            Envelope envelope; var data = ReadEnvelope(json, out envelope);
            for (int i = 0; i < SceneManager.sceneCount; i++) Require(!string.IsNullOrEmpty(SceneManager.GetSceneAt(i).path), "Save untitled scenes with Unity Save As before importing an additive Director stage. Existing work was not changed.");
            // Empty additive scene preserves all existing scenes and dirty user content.
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
            try
            {
                var root = Child(scene, null, "CanIScreenwrite — " + data.sceneId + " — PROPOSED");
                var created = root.AddComponent<DirectorStage>(); created.envelopeJson = json; created.stageInstanceId = Guid.NewGuid().ToString("N");
                foreach (var shot in data.shots)
                {
                    var group = Child(scene, root.transform, shot.label + " — " + shot.id);
                    Marker(group, "shot:" + shot.id, "SHOT", shot.id, "", shot.description);
                    var camera = Child(scene, group.transform, "Camera placeholder — source pose UNKNOWN");
                    camera.AddComponent<Camera>().enabled = false;
                    Marker(camera, "camera:" + shot.id, "CAMERA", shot.id, "", "Unity default transform/lens; disabled placeholder. Set framing explicitly before use.");
                    foreach (var cell in shot.cells) Marker(Child(scene, group.transform, cell.role + " — " + cell.id), "cell:" + cell.id, "CELL", shot.id, cell.id, cell.description);
                }
                EditorSceneManager.MarkSceneDirty(scene); return created;
            }
            catch { EditorSceneManager.CloseScene(scene, true); throw; }
        }
        private DirectorMarker FindMarker(string id) { return stage.GetComponentsInChildren<DirectorMarker>(true).SingleOrDefault(m => m.markerId == id); }
        private void SelectMarker(string id) { var marker = FindMarker(id); if (marker) { Selection.activeGameObject = marker.gameObject; EditorGUIUtility.PingObject(marker); } }
        private void AlignCamera(string shotId)
        {
            StopPlayback();
            var marker = FindMarker("camera:" + shotId); Require(marker && marker.GetComponent<Camera>(), "Camera placeholder is missing.");
            var view = SceneView.lastActiveSceneView; Require(view && view.camera, "Open a Scene view and choose the proposed framing first.");
            Undo.RecordObject(marker.transform, "Propose camera framing from Scene view"); marker.transform.SetPositionAndRotation(view.camera.transform.position, view.camera.transform.rotation);
            // Lens remains the editable Unity placeholder. No render or lens conversion.
            EditorSceneManager.MarkSceneDirty(stage.gameObject.scene); SelectMarker(marker.markerId); message = "Proposed position and rotation copied from Scene view. Inspect the camera lens separately; this is not an observed source pose.";
        }
        private void AddBlock(string shotId)
        {
            AddStandIn(shotId, PrimitiveType.Cube, "Proposed blocking cube", Vector3.one);
        }
        private void AddStandIn(string shotId, PrimitiveType type, string label, Vector3 scale)
        {
            Require(stage.GetComponentsInChildren<DirectorMarker>(true).Count(m => m.kind == "BLOCKING") < 200, "This stage has reached its blocking-object limit.");
            var shot = FindMarker("shot:" + shotId); Require(shot, "Shot marker is missing.");
            var camera = DirectorMotion.ShotCamera(stage, shotId);
            var go = GameObject.CreatePrimitive(type); SceneManager.MoveGameObjectToScene(go, stage.gameObject.scene); go.transform.SetParent(shot.transform, false); go.name = label + " — no character identity";
            go.transform.localScale = scale;
            var location = camera.transform.position + camera.transform.forward * 4;
            location.y = type == PrimitiveType.Capsule ? scale.y : scale.y / 2; go.transform.position = location;
            Undo.RegisterCreatedObjectUndo(go, "Add proposed blocking stand-in"); Marker(go, "blocking:" + Guid.NewGuid().ToString("N"), "BLOCKING", shotId, "", "Explicit unassigned " + label + ". Proposed scale: one meter per unit. No cast/reference identity or film-use permission inferred.");
            EditorSceneManager.MarkSceneDirty(stage.gameObject.scene); Selection.activeGameObject = go;
        }
        private void AddPreviewLight(string shotId)
        {
            Require(stage.GetComponentsInChildren<DirectorMarker>(true).Count(m => m.kind == "BLOCKING") < 200, "This stage has reached its blocking-object limit.");
            var shot = FindMarker("shot:" + shotId); Require(shot, "Shot marker is missing.");
            var go = Child(stage.gameObject.scene, shot.transform, "Proposed preview key light");
            var light = go.AddComponent<Light>(); light.type = LightType.Directional; light.intensity = 1.2f;
            go.transform.rotation = Quaternion.Euler(40, -30, 0);
            Marker(go, "blocking:" + Guid.NewGuid().ToString("N"), "BLOCKING", shotId, "", "Explicit proposed preview illumination; not observed or approved production lighting.");
            EditorSceneManager.MarkSceneDirty(stage.gameObject.scene); Selection.activeGameObject = go;
        }
        private static string Decimal(float value) { Require(!float.IsNaN(value) && !float.IsInfinity(value), "Observation contains a non-finite value."); return value.ToString("R", CultureInfo.InvariantCulture); }
        private static string[] Vector(Vector3 value) { return new[] { Decimal(value.x), Decimal(value.y), Decimal(value.z) }; }
        private static CameraObservation ReadCamera(Camera camera)
        {
            return new CameraObservation { enabled = camera.enabled, physical = camera.usePhysicalProperties, orthographic = camera.orthographic, fieldOfViewDegrees = Decimal(camera.fieldOfView), orthographicSize = Decimal(camera.orthographicSize), focalLengthMm = Decimal(camera.focalLength), sensorWidthMm = Decimal(camera.sensorSize.x), sensorHeightMm = Decimal(camera.sensorSize.y), lensShiftX = Decimal(camera.lensShift.x), lensShiftY = Decimal(camera.lensShift.y), nearClipMeters = Decimal(camera.nearClipPlane), farClipMeters = Decimal(camera.farClipPlane), gateFit = camera.gateFit.ToString() };
        }
        internal static Observation ReadObservation(DirectorStage stage)
        {
            Envelope envelope; var data = ReadEnvelope(stage.envelopeJson, out envelope);
            Require(Regex.IsMatch(stage.stageInstanceId ?? "", "^[a-f0-9]{32}$"), "Stage instance is missing.");
            var expected = new Dictionary<string, string>();
            foreach (var shot in data.shots) { expected.Add("shot:" + shot.id, "SHOT|" + shot.id + "|"); expected.Add("camera:" + shot.id, "CAMERA|" + shot.id + "|"); foreach (var cell in shot.cells) expected.Add("cell:" + cell.id, "CELL|" + shot.id + "|" + cell.id); }
            var markers = stage.GetComponentsInChildren<DirectorMarker>(true); var ids = new HashSet<string>(); var objects = new List<ObjectObservation>();
            Require(markers.Length >= expected.Count && markers.Length <= expected.Count + 200, "Required shot or cell markers are missing, or object limit exceeded.");
            foreach (var marker in markers)
            {
                Require(ids.Add(marker.markerId ?? ""), "Duplicate marker identity.");
                if (marker.kind == "BLOCKING") Require(Regex.IsMatch(marker.markerId ?? "", "^blocking:[a-f0-9]{32}$") && data.shots.Any(shot => shot.id == marker.shotId) && string.IsNullOrEmpty(marker.cellId), "Blocking marker is orphaned.");
                else Require(expected.ContainsKey(marker.markerId) && expected[marker.markerId] == marker.kind + "|" + marker.shotId + "|" + marker.cellId, "Source marker is orphaned or changed.");
                var camera = marker.GetComponent<Camera>(); Require((marker.kind == "CAMERA") == (camera != null), "Camera component does not match source marker kind.");
                var t = marker.transform; var q = t.rotation;
                objects.Add(new ObjectObservation { id = marker.markerId, kind = marker.kind, shotId = marker.shotId, cellId = marker.cellId ?? "", name = marker.name, globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(marker).ToString(), position = Vector(t.position), rotation = new[] { Decimal(q.x), Decimal(q.y), Decimal(q.z), Decimal(q.w) }, scale = Vector(t.lossyScale), camera = camera ? new[] { ReadCamera(camera) } : new CameraObservation[0] });
            }
            Require(expected.Keys.All(ids.Contains), "A required source marker is missing.");
            var scene = stage.gameObject.scene; string scenePath = scene.path ?? "";
            var file = new SceneFileObservation { status = "UNSAVED", path = "", sha256 = "", dirty = scene.isDirty };
            if (!string.IsNullOrEmpty(scenePath)) { Require(File.Exists(scenePath), "Saved scene file is missing."); file.path = scenePath; file.sha256 = Digest(File.ReadAllBytes(scenePath)); file.status = scene.isDirty ? "SAVED_FILE_WITH_UNSAVED_CHANGES" : "FILE_PRESENT_NOT_REOPEN_VERIFIED"; }
            var observation = new Observation { payloadSha256 = envelope.payloadSha256, projectId = data.projectId, sourceHash = data.sourceHash, sceneId = data.sceneId, basisSha256 = data.basisSha256, exchangeSha256 = data.exchangeSha256, stageInstanceId = stage.stageInstanceId, application = new AppObservation { name = "Unity", version = Application.unityVersion, projectPath = Path.GetFullPath(Path.Combine(Application.dataPath, "..")) }, sceneFile = file, objects = objects.ToArray(), notes = stage.planningNotes ?? "" };
            Require(observation.notes.Length <= 8000, "Planning note exceeds the observation limit.");
            return observation;
        }
        private void Export()
        {
            var observation = ReadObservation(stage);
            string output = EditorUtility.SaveFilePanel("Export proposed Unity observations", "", observation.sceneId + "-unity-observation", "json"); if (string.IsNullOrEmpty(output)) return;
            // FileMode.CreateNew never overwrites an earlier evidence file or scene.
            using (var stream = new FileStream(output, FileMode.CreateNew, FileAccess.Write)) using (var writer = new StreamWriter(stream, new UTF8Encoding(false))) writer.Write(JsonUtility.ToJson(observation, true) + "\n");
            message = "Observation exported for current-source validation and owner review. No render, measured duration, reopened-scene proof or production approval was claimed.";
        }
        private void ExportReturn(bool render)
        {
            StopAllPreviews();
            string plan = EditorUtility.OpenFilePanel("Choose stage-plan.json from the original Unity kit", "", "json");
            if (string.IsNullOrEmpty(plan)) return;
            string output = EditorUtility.SaveFilePanel("Create a new QiMovi return folder", "", "unity-scene-return", "");
            if (string.IsNullOrEmpty(output)) return;
            if (render) {
                var selectedPlan = JsonUtility.FromJson<MotionPlan>(File.ReadAllText(plan, new UTF8Encoding(false, true)));
                Require(selectedPlan != null && selectedPlan.shotId == selectedShotId, "Choose the original kit plan for the currently selected shot.");
                DirectorReturn.ExportRendered(stage, plan, output);
                message = "Three 1920 × 1080 still previews and the editable scene exported. In QiMovi choose all nine files under Return the rehearsal. Frames remain pending review; no video duration, final take or approval was claimed.";
            }
            else {
                DirectorReturn.Export(stage, plan, output);
                message = "Editable scene return exported. In QiMovi, choose all six files in this new folder under Return the rehearsal. No rendered frames or final takes are included.";
            }
        }
    }
}
