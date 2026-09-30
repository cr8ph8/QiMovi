// Lightweight cross-component handoff between the Retrieval Trace panel
// and the next agent update proposal (ConceptEditor -> admit-concept).
//
// The Retrieval Trace panel stashes the id + summary of the trace it just
// wrote to `governance_events`. The next ConceptEditor commit reads it,
// shows it inline as "what the agent used", and — on successful commit —
// links the two by writing an `okf_retrieval_link` governance event.

export type PendingRetrievalTrace = {
  event_id: string;
  at: string;             // ISO timestamp when the trace was recorded
  query: string;
  tag_filter: string;
  top_k: number;
  hit_count: number;
  hits: Array<{ artifact_id: string; title: string; type: string; score: number }>;
};

const keyFor = (projectId: string) => `qi:pendingRetrievalTrace:${projectId}`;

export function setPendingTrace(projectId: string, trace: PendingRetrievalTrace) {
  try { localStorage.setItem(keyFor(projectId), JSON.stringify(trace)); } catch {}
}

export function getPendingTrace(projectId: string): PendingRetrievalTrace | null {
  try {
    const raw = localStorage.getItem(keyFor(projectId));
    if (!raw) return null;
    return JSON.parse(raw) as PendingRetrievalTrace;
  } catch { return null; }
}

export function clearPendingTrace(projectId: string) {
  try { localStorage.removeItem(keyFor(projectId)); } catch {}
}
