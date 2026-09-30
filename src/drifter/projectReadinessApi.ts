import { hashCanonical } from './canonical';
import type { Project } from './types';

export interface Readiness {
  schema: 'caniscreenwrite-project-readiness/v1'; scope: 'RECORDS_DERIVED_PREPARATION';
  bindings: { projectId: string; sourceHash: string; readinessHash: string; [key: string]: unknown };
  scenes: { sceneId: string; index: number; heading: string; nextAction: string; measuredTakes: number; generationBriefs: number; briefsWithCurrentSceneBasis: number; keptCandidates: number; initialFramePresent: boolean }[];
  gates: { id: string; result: string; reason: string; nextAction: string }[];
  documents: { id: string; name: string; materialization: 'NOT_MATERIALIZED' | 'DRAFT_CURRENT' | 'DRAFT_NEEDS_REBUILD'; canBuildDraft: boolean }[];
  outcomes: Record<string, string>; LOCAL_PILOT_COMPLETE: string; HOSTED_RELEASE: string;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function matchesScenes(value: unknown, project: Project): boolean {
  if (!Array.isArray(value) || value.length !== project.scenes.length) return false;
  const ids = new Set<string>();
  return value.every((scene: unknown, index) => {
    const expected = project.scenes[index];
    if (!object(scene) || scene.sceneId !== expected.id || scene.index !== expected.index || scene.heading !== expected.heading || ids.has(expected.id)) return false;
    ids.add(expected.id);
    return typeof scene.nextAction === 'string' && typeof scene.initialFramePresent === 'boolean' && [scene.measuredTakes, scene.generationBriefs, scene.briefsWithCurrentSceneBasis, scene.keptCandidates].every(count);
  });
}
export async function loadProjectReadiness(project: Project, signal?: AbortSignal): Promise<Readiness> {
  const response = await fetch('/api/readiness', { credentials: 'same-origin', redirect: 'error', signal });
  const data = await response.json();
  if (!response.ok || data?.schema !== 'caniscreenwrite-project-readiness/v1' || data.scope !== 'RECORDS_DERIVED_PREPARATION' || data.bindings?.projectId !== project.id || data.bindings?.sourceHash !== project.sourceHash || !Array.isArray(data.gates) || !matchesScenes(data.scenes, project)
    || !Array.isArray(data.documents) || !data.documents.every((row: unknown) => object(row) && typeof row.id === 'string' && typeof row.name === 'string' && ['NOT_MATERIALIZED', 'DRAFT_CURRENT', 'DRAFT_NEEDS_REBUILD'].includes(String(row.materialization)) && typeof row.canBuildDraft === 'boolean')) throw new Error('Readiness could not be verified for this project.');
  const { readinessHash, ...bindings } = data.bindings;
  if (await hashCanonical({ ...data, bindings }) !== readinessHash) throw new Error('The readiness report changed in transit. Refresh the project.');
  return data;
}
