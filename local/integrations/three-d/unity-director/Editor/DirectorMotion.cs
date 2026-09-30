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

namespace CanIScreenwrite.Director.Editor
{
    [Serializable] internal sealed class MotionTemplate
    {
        public string status, motion, coordinateConvention;
        public int lensMm, sensorWidthMm, durationSeconds, travelMm, frameRate, widthPixels, heightPixels;
    }
    [Serializable] internal sealed class MotionPlan
    {
        public string schemaVersion, authority, projectId, sourceHash, sceneId, shotId, exchangeSha256, basisSha256, target, blockingNotes, sourceDescription, sourceRefsStatus;
        public string[] sourceRefs; public MotionTemplate cameraTemplate; public bool approvalGranted, finalMedia;
    }
    [Serializable] internal sealed class KitFile { public string path, sha256; }
    [Serializable] internal sealed class KitManifest { public string schemaVersion; public KitFile[] files; }
    [Serializable] internal sealed class MotionSample
    {
        public int frame; public string elapsedSeconds, focalLengthMm, sensorWidthMm, sensorHeightMm, gateFit;
        public string[] worldPositionMeters, worldQuaternionXYZW;
    }
    [Serializable] internal sealed class MotionReadback
    {
        public string schemaVersion = "caniscreenwrite-unity-camera-motion-observation/v1";
        public string authority = "CONTROLLED_PLAN_SAMPLING_PENDING_REVIEW";
        public string projectId, sourceHash, sceneId, shotId, basisSha256, exchangeSha256, payloadSha256, stageInstanceId;
        public string planJson, planSha256, kitFilesSha256, cameraMarkerId, cameraObjectGlobalId, applicationVersion;
        public string coordinates = "UNITY_LEFT_HANDED_X_RIGHT_Y_UP_Z_FORWARD;WORLD;ONE_UNIT_ONE_METER_PROPOSED;QUATERNION_XYZW";
        public string motionInterpretation = "LINEAR_WORLD_TRAVEL_ALONG_CAPTURED_CAMERA_FORWARD;FIXED_CAPTURED_ROTATION;NO_BLENDER_CONVERSION";
        public string timing = "FRAME_1_AT_ZERO_SECONDS;LAST_SAMPLE_AT_(FRAME_COUNT-1)/FPS;NOT_MEASURED_MEDIA_DURATION";
        public string sourceRefsStatus; public string[] sourceRefs;
        public int frameStart, frameEnd, frameRate;
        public string[] appliedStartPositionMeters, appliedStartQuaternionXYZW;
        public MotionSample[] samples;
        public string scenePath, sceneFileSha256; public bool sceneDirty;
        public bool approvalGranted = false, finalMedia = false, reopenedVerified = false, renderedMedia = false;
    }
    internal static class DirectorMotion
    {
        internal static void Require(bool value, string message) { if (!value) throw new InvalidDataException(message); }
        internal static string Digest(string value) { return Digest(new UTF8Encoding(false, true).GetBytes(value)); }
        internal static string Digest(byte[] value) { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(value)).Replace("-", "").ToLowerInvariant(); }
        private static bool Hash(string value) { return value != null && Regex.IsMatch(value, "^[a-f0-9]{64}$"); }
        private static bool Finite(float value) { return !float.IsNaN(value) && !float.IsInfinity(value) && Mathf.Abs(value) <= 1000000; }
        private static bool Finite(Vector3 value) { return Finite(value.x) && Finite(value.y) && Finite(value.z); }
        private static bool RotationValid(Quaternion value) { return Finite(value.x) && Finite(value.y) && Finite(value.z) && Finite(value.w) && Mathf.Abs(Quaternion.Dot(value, value) - 1) < 0.001f; }
        internal static StagePayload Payload(DirectorStage stage, out Envelope envelope)
        {
            Require(stage && !EditorApplication.isPlayingOrWillChangePlaymode, "Choose an imported Director stage in Edit mode.");
            return DirectorWindow.ReadEnvelope(stage.envelopeJson, out envelope);
        }
        internal static Camera ShotCamera(DirectorStage stage, string shotId)
        {
            var markers = stage.GetComponentsInChildren<DirectorMarker>(true).Where(item => item.markerId == "camera:" + shotId && item.kind == "CAMERA" && item.shotId == shotId).ToArray();
            Require(markers.Length == 1 && markers[0].GetComponent<Camera>(), "The imported shot camera is missing or ambiguous.");
            return markers[0].GetComponent<Camera>();
        }
        internal static MotionPlan Validate(DirectorStage stage, string planJson, string manifestJson)
        {
            Envelope envelope; var payload = Payload(stage, out envelope);
            Require(planJson != null && Encoding.UTF8.GetByteCount(planJson) <= 128 * 1024 && manifestJson != null && Encoding.UTF8.GetByteCount(manifestJson) <= 128 * 1024, "Plan files exceed the local limit.");
            var manifest = JsonUtility.FromJson<KitManifest>(manifestJson);
            Require(manifest != null && manifest.schemaVersion == "caniscreenwrite-dcc-stage-files/v1" && manifest.files != null && manifest.files.Length <= 32
                && manifest.files.All(file => file != null && Hash(file.sha256)) && manifest.files.Select(file => file.path).Distinct().Count() == manifest.files.Length, "Invalid original kit manifest.");
            Require(manifest.files.Count(file => file.path == "stage-plan.json" && file.sha256 == Digest(planJson)) == 1, "The exact stage plan does not match its original kit manifest.");
            Require(manifest.files.Count(file => file.path == "unity-scene.json" && file.sha256 == Digest(stage.envelopeJson)) == 1, "The plan kit does not contain this exact imported scene handoff.");
            var plan = JsonUtility.FromJson<MotionPlan>(planJson);
            Require(plan != null && plan.schemaVersion == "caniscreenwrite-dcc-stage-plan/v1" && plan.authority == "AUTHORED_TEMPLATE_PENDING_REVIEW" && plan.target == "UNITY" && !plan.approvalGranted && !plan.finalMedia, "Choose a pending Unity camera plan.");
            Require(plan.projectId == payload.projectId && plan.sourceHash == payload.sourceHash && plan.sceneId == payload.sceneId && plan.basisSha256 == payload.basisSha256 && plan.exchangeSha256 == payload.exchangeSha256 && payload.shots.Any(shot => shot.id == plan.shotId), "Camera plan belongs to different source, scene, shot or basis.");
            Require(plan.sourceRefs != null && plan.sourceRefs.Length <= 2000 && plan.sourceRefs.Distinct().Count() == plan.sourceRefs.Length && plan.sourceRefs.All(id => payload.paragraphs.Any(paragraph => paragraph.id == id)) && plan.sourceRefsStatus == "EXISTING_CELL_LINKS_NOT_COMPLETE_COVERAGE", "Camera plan source links are invalid.");
            var t = plan.cameraTemplate;
            foreach (string key in new[] { "lensMm", "sensorWidthMm", "durationSeconds", "travelMm", "frameRate", "widthPixels", "heightPixels" })
                Require(Regex.Matches(planJson, "(?<!\\\\)\"" + key + "\"\\s*:").Count == 1 && Regex.Matches(planJson, "(?<!\\\\)\"" + key + "\"\\s*:\\s*-?(?:0|[1-9]\\d*)(?=\\s*[,}])").Count == 1, "Camera template requires one explicit integer for " + key + ".");
            foreach (string key in new[] { "approvalGranted", "finalMedia" }) Require(Regex.Matches(planJson, "(?<!\\\\)\"" + key + "\"\\s*:").Count == 1 && Regex.Matches(planJson, "(?<!\\\\)\"" + key + "\"\\s*:\\s*false(?=\\s*[,}])").Count == 1, "Plan must explicitly retain " + key + " = false.");
            Require(t != null && t.status == "EXPLICIT_REHEARSAL_PROPOSAL_NOT_SOURCE_MEASUREMENT" && t.coordinateConvention == "UNITY_EDIT_MANUALLY_NO_BLENDER_TRANSFORM_CONVERSION"
                && t.lensMm >= 10 && t.lensMm <= 200 && t.sensorWidthMm == 36 && t.durationSeconds >= 1 && t.durationSeconds <= 180 && t.frameRate == 24 && t.widthPixels == 1920 && t.heightPixels == 1080
                && (t.motion == "STATIC" || t.motion == "DOLLY_IN" || t.motion == "DOLLY_OUT") && t.travelMm >= 0 && t.travelMm <= 5000 && (t.motion != "STATIC" || t.travelMm == 0), "Unsupported camera template values.");
            return plan;
        }
        internal static DirectorMotionState Load(DirectorStage stage, string planJson, string manifestJson)
        {
            var plan = Validate(stage, planJson, manifestJson);
            if (stage.cameraMotions == null) stage.cameraMotions = new List<DirectorMotionState>();
            var old = stage.cameraMotions.SingleOrDefault(item => item.shotId == plan.shotId);
            Require(old == null || !old.applied, "Restore this shot's applied camera before replacing its plan.");
            Undo.RecordObject(stage, "Load immutable camera plan");
            var state = new DirectorMotionState { shotId = plan.shotId, planJson = planJson, planSha256 = Digest(planJson), kitManifestJson = manifestJson, kitFilesSha256 = Digest(manifestJson), camera = ShotCamera(stage, plan.shotId) };
            if (old != null) stage.cameraMotions.Remove(old); stage.cameraMotions.Add(state); EditorSceneManager.MarkSceneDirty(stage.gameObject.scene); return state;
        }
        internal static MotionPlan Checked(DirectorStage stage, DirectorMotionState state)
        {
            Require(state != null && stage && stage.cameraMotions != null && stage.cameraMotions.Contains(state) && state.camera && state.camera == ShotCamera(stage, state.shotId) && Digest(state.planJson) == state.planSha256 && Digest(state.kitManifestJson) == state.kitFilesSha256, "Camera plan or camera identity changed.");
            return Validate(stage, state.planJson, state.kitManifestJson);
        }
        internal static DirectorCameraBaseline Capture(Camera camera)
        {
            return new DirectorCameraBaseline { position = camera.transform.position, rotation = camera.transform.rotation, physical = camera.usePhysicalProperties, orthographic = camera.orthographic, lensMm = camera.focalLength, fieldOfView = camera.fieldOfView, sensorSize = camera.sensorSize, gateFit = camera.gateFit };
        }
        internal static void PutBack(Camera camera, DirectorCameraBaseline prior)
        {
            camera.transform.SetPositionAndRotation(prior.position, prior.rotation); camera.usePhysicalProperties = prior.physical; camera.orthographic = prior.orthographic;
            camera.sensorSize = prior.sensorSize; camera.focalLength = prior.lensMm; camera.gateFit = prior.gateFit; if (!prior.physical) camera.fieldOfView = prior.fieldOfView;
        }
        internal static void Apply(DirectorStage stage, DirectorMotionState state)
        {
            var plan = Checked(stage, state); Require(!state.applied, "Restore the current application before applying a new starting pose.");
            Require(Finite(state.camera.transform.position) && RotationValid(state.camera.transform.rotation), "Camera pose is not finite or exceeds the rehearsal scale.");
            Undo.RecordObjects(new UnityEngine.Object[] { stage, state.camera, state.camera.transform }, "Apply proposed camera move");
            state.beforeApply = Capture(state.camera); state.startPosition = state.camera.transform.position; state.startRotation = state.camera.transform.rotation;
            state.camera.usePhysicalProperties = true; state.camera.orthographic = false; state.camera.sensorSize = new Vector2(plan.cameraTemplate.sensorWidthMm, plan.cameraTemplate.sensorWidthMm * plan.cameraTemplate.heightPixels / (float)plan.cameraTemplate.widthPixels);
            state.camera.focalLength = plan.cameraTemplate.lensMm; state.camera.gateFit = Camera.GateFitMode.Horizontal;
            state.applied = true; state.sampledFrame = 1; EditorSceneManager.MarkSceneDirty(stage.gameObject.scene);
        }
        internal static Vector3 Position(DirectorMotionState state, MotionTemplate template, int frame)
        {
            int last = template.durationSeconds * template.frameRate;
            Require(frame >= 1 && frame <= last && Finite(state.startPosition) && RotationValid(state.startRotation), "Frame or captured starting pose is invalid.");
            float fraction = (frame - 1) / (float)(last - 1), direction = template.motion == "DOLLY_IN" ? 1 : template.motion == "DOLLY_OUT" ? -1 : 0;
            return state.startPosition + (state.startRotation * Vector3.forward) * (direction * template.travelMm / 1000f * fraction);
        }
        internal static void Sample(DirectorStage stage, DirectorMotionState state, int frame, bool undo)
        {
            var plan = Checked(stage, state); Require(state.applied, "Apply the selected plan first.");
            var position = Position(state, plan.cameraTemplate, frame);
            if (undo) Undo.RecordObjects(new UnityEngine.Object[] { stage, state.camera.transform }, "Scrub proposed camera move");
            state.camera.transform.SetPositionAndRotation(position, state.startRotation); state.sampledFrame = frame;
            if (undo) EditorSceneManager.MarkSceneDirty(stage.gameObject.scene);
        }
        internal static void Restore(DirectorStage stage, DirectorMotionState state)
        {
            Checked(stage, state); Require(state.applied && state.beforeApply != null, "No applied baseline is available to restore.");
            Undo.RecordObjects(new UnityEngine.Object[] { stage, state.camera, state.camera.transform }, "Restore camera before plan application");
            PutBack(state.camera, state.beforeApply); state.applied = false; state.sampledFrame = 1; EditorSceneManager.MarkSceneDirty(stage.gameObject.scene);
        }
        private static string Decimal(float value) { Require(Finite(value), "Camera readback is not finite."); return value.ToString("R", CultureInfo.InvariantCulture); }
        private static string[] Vector(Vector3 value) { return new[] { Decimal(value.x), Decimal(value.y), Decimal(value.z) }; }
        private static string[] Rotation(Quaternion value) { return new[] { Decimal(value.x), Decimal(value.y), Decimal(value.z), Decimal(value.w) }; }
        internal static MotionReadback ReadFrames(DirectorStage stage, DirectorMotionState state)
        {
            var plan = Checked(stage, state); Require(state.applied, "Apply the selected plan before sampling."); Envelope envelope; var payload = Payload(stage, out envelope);
            var camera = state.camera; var prior = Capture(camera); int previousFrame = state.sampledFrame;
            var result = new MotionReadback { projectId = plan.projectId, sourceHash = plan.sourceHash, sceneId = plan.sceneId, shotId = plan.shotId, basisSha256 = plan.basisSha256, exchangeSha256 = plan.exchangeSha256,
                payloadSha256 = envelope.payloadSha256, stageInstanceId = stage.stageInstanceId, planJson = state.planJson, planSha256 = state.planSha256, kitFilesSha256 = state.kitFilesSha256,
                cameraMarkerId = "camera:" + state.shotId, cameraObjectGlobalId = GlobalObjectId.GetGlobalObjectIdSlow(camera).ToString(), applicationVersion = Application.unityVersion,
                sourceRefs = plan.sourceRefs, sourceRefsStatus = plan.sourceRefsStatus, frameStart = 1, frameEnd = plan.cameraTemplate.durationSeconds * plan.cameraTemplate.frameRate, frameRate = plan.cameraTemplate.frameRate,
                appliedStartPositionMeters = Vector(state.startPosition), appliedStartQuaternionXYZW = Rotation(state.startRotation), scenePath = stage.gameObject.scene.path ?? "", sceneDirty = stage.gameObject.scene.isDirty, sceneFileSha256 = "" };
            if (result.scenePath.Length > 0 && File.Exists(result.scenePath)) result.sceneFileSha256 = Digest(File.ReadAllBytes(result.scenePath));
            var samples = new List<MotionSample>();
            try {
                for (int frame = 1; frame <= result.frameEnd; frame++) {
                    camera.transform.SetPositionAndRotation(Position(state, plan.cameraTemplate, frame), state.startRotation);
                    samples.Add(new MotionSample { frame = frame, elapsedSeconds = Decimal((frame-1)/(float)result.frameRate), worldPositionMeters = Vector(camera.transform.position), worldQuaternionXYZW = Rotation(camera.transform.rotation),
                        focalLengthMm = Decimal(camera.focalLength), sensorWidthMm = Decimal(camera.sensorSize.x), sensorHeightMm = Decimal(camera.sensorSize.y), gateFit = camera.gateFit.ToString() });
                }
            } finally { PutBack(camera, prior); state.sampledFrame = previousFrame; }
            result.samples = samples.ToArray(); return result;
        }
    }
}
