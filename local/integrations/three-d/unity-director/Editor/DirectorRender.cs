using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace CanIScreenwrite.Director.Editor
{
    [Serializable] internal sealed class RehearsalMedia
    {
        public string filename, sha256;
        public string role = "REHEARSAL_PREVIEW_PENDING_REVIEW";
    }
    [Serializable] internal sealed class RenderedFrame
    {
        public string label; public int frame;
        public ObjectObservation camera; public RehearsalMedia media;
    }
    [Serializable] internal sealed class RehearsalObservation
    {
        public string schemaVersion = "caniscreenwrite-unity-rehearsal-observation/v1";
        public string authority = "CONTROLLED_PLAN_RENDER_PENDING_REVIEW";
        public Observation directorObservation;
        public string projectId, sourceHash, sceneId, shotId, basisSha256, exchangeSha256;
        public string planJson, planSha256, kitFilesSha256, cameraMarkerId, cameraObjectGlobalId;
        public string[] appliedStartPositionMeters, appliedStartQuaternionXYZW;
        public int frameRate; public int[] frameRange, resolution;
        public RenderedFrame[] observedFrames;
        public bool reopenedVerified = false, approvalGranted = false, finalMedia = false;
    }
    internal sealed class RenderedRehearsal
    {
        internal RehearsalObservation observation;
        internal readonly Dictionary<string, byte[]> media = new Dictionary<string, byte[]>();
    }

    // Bounded built-in-pipeline stills. No Play mode, scene saving, Timeline or provider calls.
    internal static class DirectorRender
    {
        internal static string UnsupportedReason()
        {
            if (GraphicsSettings.currentRenderPipeline != null) return "UNITY_RENDER_PIPELINE_UNSUPPORTED: This Director renderer supports Unity's Built-in pipeline. URP/HDRP requires a separately qualified render-request adapter; keep using the editable-scene return.";
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null) return "UNITY_GRAPHICS_UNAVAILABLE: Open this film project in a graphics-enabled Unity Editor; -nographics cannot render previews.";
            return null;
        }
        private static void Require(bool value, string message) { if (!value) throw new InvalidDataException(message); }
        private static string Number(float value) { Require(!float.IsNaN(value) && !float.IsInfinity(value), "Camera readback is not finite."); return value.ToString("R", CultureInfo.InvariantCulture); }
        private static string[] Position(Vector3 value) { return new[] { Number(value.x), Number(value.y), Number(value.z) }; }
        private static string[] Rotation(Quaternion value) { return new[] { Number(value.x), Number(value.y), Number(value.z), Number(value.w) }; }

        internal static Texture2D Preview(DirectorStage stage, Camera camera, int width = 640, int height = 360)
        {
            Require(stage && camera && camera.gameObject.scene == stage.gameObject.scene && !EditorApplication.isPlayingOrWillChangePlaymode, "Choose this stage's shot camera in Edit mode.");
            string unsupported = UnsupportedReason(); Require(unsupported == null, unsupported);
            Require(camera.gameObject.activeInHierarchy, "Activate the shot camera GameObject before previewing. Its Camera component can remain disabled.");
            Require(width > 0 && height > 0 && width <= 1920 && height <= 1080, "Unsupported preview size.");
            var priorTarget = camera.targetTexture; var priorActive = RenderTexture.active;
            bool priorEnabled = camera.enabled; float priorAspect = camera.aspect;
            ulong priorCameraMask = camera.overrideSceneCullingMask, priorSceneMask = EditorSceneManager.GetSceneCullingMask(stage.gameObject.scene);
            ulong isolatedMask = EditorSceneManager.CalculateAvailableSceneCullingMask();
            Require(isolatedMask != 0, "No isolated scene-render mask is available. Close unneeded preview windows and retry.");
            RenderTexture target = null; Texture2D pixels = null;
            try
            {
                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { name = "QiMovi temporary shot preview", hideFlags = HideFlags.HideAndDontSave };
                Require(target.Create(), "Unity could not allocate the preview render target.");
                EditorSceneManager.SetSceneCullingMask(stage.gameObject.scene, isolatedMask);
                camera.overrideSceneCullingMask = isolatedMask;
                camera.enabled = false; camera.targetTexture = target; camera.aspect = width / (float)height;
                RenderTexture.active = target; GL.Clear(true, true, Color.clear);
                camera.Render();
                RenderTexture.active = target;
                pixels = new Texture2D(width, height, TextureFormat.RGB24, false) { hideFlags = HideFlags.HideAndDontSave };
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0); pixels.Apply(false, false);
                var returned = pixels; pixels = null; return returned;
            }
            finally
            {
                camera.targetTexture = priorTarget; camera.aspect = priorAspect; camera.enabled = priorEnabled; camera.overrideSceneCullingMask = priorCameraMask;
                EditorSceneManager.SetSceneCullingMask(stage.gameObject.scene, priorSceneMask);
                RenderTexture.active = priorActive;
                if (pixels) UnityEngine.Object.DestroyImmediate(pixels);
                if (target) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
            }
        }

        private static void CheckVisiblePixels(Texture2D texture, string label)
        {
            var pixels = texture.GetPixels32(); int minimum = 255, maximum = 0;
            // Reject blank/unlit/flat frames instead of claiming that any PNG is a successful rehearsal.
            for (int i = 0; i < pixels.Length; i += 31)
            {
                int brightness = (pixels[i].r + pixels[i].g + pixels[i].b) / 3;
                minimum = Math.Min(minimum, brightness); maximum = Math.Max(maximum, brightness);
            }
            Require(maximum > 8 && maximum - minimum > 3, "UNITY_PREVIEW_BLANK: " + label + " has no visible scene detail. Check camera framing, blocking objects and lights; no return was written.");
        }

        internal static RenderedRehearsal Read(DirectorStage stage, DirectorMotionState state)
        {
            var plan = DirectorMotion.Checked(stage, state);
            Require(state.applied, "Apply the selected shot's camera plan before rendering a return.");
            Require(!stage.gameObject.scene.isDirty && !string.IsNullOrEmpty(stage.gameObject.scene.path), "Save the directed scene explicitly before rendering its return.");
            Require(state.camera.usePhysicalProperties && !state.camera.orthographic && state.camera.focalLength > 0 && state.camera.sensorSize.x > 0 && state.camera.sensorSize.y > 0, "Use a physical perspective camera with positive lens and sensor values.");
            string unsupported = UnsupportedReason(); Require(unsupported == null, unsupported);
            var camera = state.camera; var prior = DirectorMotion.Capture(camera); int priorFrame = state.sampledFrame;
            var original = DirectorWindow.ReadObservation(stage);
            var identity = original.objects.Single(item => item.id == "camera:" + state.shotId);
            int last = plan.cameraTemplate.durationSeconds * plan.cameraTemplate.frameRate;
            var result = new RenderedRehearsal { observation = new RehearsalObservation {
                directorObservation = original, projectId = plan.projectId, sourceHash = plan.sourceHash, sceneId = plan.sceneId, shotId = plan.shotId,
                basisSha256 = plan.basisSha256, exchangeSha256 = plan.exchangeSha256, planJson = state.planJson, planSha256 = state.planSha256, kitFilesSha256 = state.kitFilesSha256,
                cameraMarkerId = identity.id, cameraObjectGlobalId = identity.globalObjectId, appliedStartPositionMeters = Position(state.startPosition), appliedStartQuaternionXYZW = Rotation(state.startRotation),
                frameRate = plan.cameraTemplate.frameRate, frameRange = new[] { 1, last }, resolution = new[] { 1920, 1080 }
            } };
            var observed = new List<RenderedFrame>(); string[] labels = { "opening", "midpoint", "ending" }; int[] frames = { 1, 1 + (last - 1) / 2, last };
            try
            {
                for (int i = 0; i < frames.Length; i++)
                {
                    DirectorMotion.Sample(stage, state, frames[i], false);
                    var actual = DirectorWindow.ReadObservation(stage).objects.Single(item => item.id == identity.id);
                    Texture2D pixels = null;
                    try
                    {
                        pixels = Preview(stage, camera, 1920, 1080); CheckVisiblePixels(pixels, labels[i]);
                        byte[] png = pixels.EncodeToPNG(); Require(png != null && png.Length > 0, "Unity did not encode the preview PNG.");
                        string filename = labels[i] + ".png"; result.media.Add(filename, png);
                        observed.Add(new RenderedFrame { label = labels[i], frame = frames[i], camera = actual, media = new RehearsalMedia { filename = filename, sha256 = DirectorMotion.Digest(png) } });
                    }
                    finally { if (pixels) UnityEngine.Object.DestroyImmediate(pixels); }
                }
            }
            finally { DirectorMotion.PutBack(camera, prior); state.sampledFrame = priorFrame; }
            Require(!stage.gameObject.scene.isDirty, "The scene changed during rendering. Save deliberately and create a fresh return.");
            result.observation.observedFrames = observed.ToArray(); return result;
        }
    }
}
