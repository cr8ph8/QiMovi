using UnityEngine;
using System;
using System.Collections.Generic;
namespace CanIScreenwrite.Director
{
    [Serializable] public sealed class DirectorCameraBaseline
    {
        public Vector3 position; public Quaternion rotation;
        public bool physical, orthographic;
        public float lensMm, fieldOfView; public Vector2 sensorSize; public Camera.GateFitMode gateFit;
    }
    [Serializable] public sealed class DirectorMotionState
    {
        public string shotId, planJson, planSha256, kitManifestJson, kitFilesSha256;
        public Camera camera;
        public bool applied;
        public Vector3 startPosition; public Quaternion startRotation;
        public int sampledFrame = 1;
        public DirectorCameraBaseline beforeApply;
    }
    // Serialized lineage survives an explicitly saved scene. It grants no authority.
    [DisallowMultipleComponent]
    public sealed class DirectorStage : MonoBehaviour
    {
        [HideInInspector] public string envelopeJson;
        [HideInInspector] public string stageInstanceId;
        [TextArea(3, 8)] public string planningNotes = "Proposed blocking. Source camera transforms and lens values remain unknown.";
        [HideInInspector] public List<DirectorMotionState> cameraMotions = new List<DirectorMotionState>();
    }
}
