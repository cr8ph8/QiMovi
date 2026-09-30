import type { BudgetTarget } from '../../local/contracts/production-budget.mjs';
import type { Project, WorkspaceRecord } from './types';

/** A navigation request, never a budget edit or production authorization. */
export type BudgetFocusRequest = { nonce: number; projectId: string; sourceHash: string | null; targetId?: string };
export type BudgetWorkRequest = { nonce: number; projectId: string; sourceHash: string; target: BudgetTarget };
export const shotBudgetTarget = (sceneId: string, shotId: string) => `shot:${sceneId}:${shotId}`;
export const recordBudgetTarget = (record: WorkspaceRecord) => record.kind === 'studio-operation' ? `operation:${record.id}:v${record.version}` : `work:${record.id}`;

type Destination = { kind: 'shot'; sceneId: string; shotId: string } | { kind: 'scene'; sceneId: string }
  | { kind: 'asset'; sha256: string } | { kind: 'record'; record: WorkspaceRecord }
  | { kind: 'world'; entityId: string } | { kind: 'project' } | { kind: 'unavailable'; reason: string };

export function budgetWorkDestination(request: BudgetWorkRequest, project: Project, records: WorkspaceRecord[]): Destination {
  const unavailable = (reason: string): Destination => ({ kind: 'unavailable', reason });
  if (request.projectId !== project.id || request.sourceHash !== project.sourceHash) return unavailable('This budget link belongs to a different project revision.');
  const target = request.target;
  if (target.kind === 'world' || target.kind === 'world-need') {
    const entityId = target.entityId, ref = target.sourceRefs?.[0] as { id?: string; version?: number; sha256?: string } | undefined;
    const record = records.find(row => row.kind === 'universe-production-plan' && row.id === `universe-production-plan:${entityId}`
      && row.id === ref?.id && row.sha256 === ref.sha256 && row.version === ref.version);
    const data = record?.data as import('./universeApi').UniverseProductionPlanDraft | undefined;
    const matches = data?.sourceHash === project.sourceHash && data.entityId === entityId && data.review !== 'SET_ASIDE'
      && (target.kind === 'world' ? target.id === `world:${entityId}` : target.id === `world-need:${entityId}:${target.needId}` && data.needs.some(need => need.id === target.needId && need.review !== 'SET_ASIDE'));
    return matches ? { kind: 'world', entityId: String(entityId) } : unavailable('This world plan changed. Refresh budget coverage before reopening its Story Bible entry.');
  }
  if (target.kind === 'project' && target.id === `project:${project.id}`) return { kind: 'project' };
  const scene = project.scenes.find(row => row.id === target.sceneId);
  if (target.kind === 'scene' && scene && target.id === `scene:${scene.id}`) return { kind: 'scene', sceneId: scene.id };
  if (target.kind === 'shot' && scene?.shots.some(row => row.id === target.shotId) && target.id === shotBudgetTarget(scene.id, String(target.shotId))) return { kind: 'shot', sceneId: scene.id, shotId: String(target.shotId) };
  if (target.kind === 'asset' && typeof target.assetHash === 'string' && /^[a-f0-9]{64}$/.test(target.assetHash) && target.id === `asset:${target.assetHash}`) return { kind: 'asset', sha256: target.assetHash };
  // Never silently open the newest record when the cost belongs to an older revision.
  if (Array.isArray(target.sourceRefs) && target.sourceRefs.length) {
    const ref = target.sourceRefs[0] as { id: string; version: number; sha256: string };
    if (ref && typeof ref.id === 'string') {
      const record = records.find(row => row.id === ref.id && row.version === ref.version && row.sha256 === ref.sha256);
      if (record) return { kind: 'record', record };
    }
    return unavailable('The saved work behind this cost has changed. Refresh budget coverage to inspect its current revision.');
  }
  return unavailable('This cost groups project overhead or evidence and has no separate work editor.');
}
