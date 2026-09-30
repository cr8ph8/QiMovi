using UnityEngine;
namespace CanIScreenwrite.Director
{
    [DisallowMultipleComponent]
    public sealed class DirectorMarker : MonoBehaviour
    {
        [HideInInspector] public string markerId;
        [HideInInspector] public string kind;
        [HideInInspector] public string shotId;
        [HideInInspector] public string cellId;
        [TextArea(2, 6)] public string sourceDescription;
        private void OnDrawGizmosSelected()
        {
            Gizmos.color = kind == "BLOCKING" ? Color.yellow : Color.cyan;
            Gizmos.DrawWireSphere(transform.position, 0.15f);
        }
    }
}
