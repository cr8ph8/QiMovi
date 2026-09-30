import type { NodeRecordRequest } from './nodeWorkflowModel';
import type { Project, Scene, WorkspaceRecord } from './types';
import { validateRecord } from './validation';

export function checkNodeRequest(request: NodeRecordRequest, project: Project, scene: Scene, intent: NodeRecordRequest['intent'], kind: string) {
  if (!request || request.projectId !== project.id || request.sourceHash !== project.sourceHash || request.sceneId !== scene.id || request.intent !== intent || typeof request.nonce !== 'string' || !request.nonce || request.recordRef?.kind !== kind || typeof request.recordRef.id !== 'string' || !/^[a-f0-9]{64}$/.test(request.recordRef.sha256)) {
    throw new Error('The requested node record does not match this project, scene or action. Your open edits are retained.');
  }
}

export async function verifyNodeRequestedRecord(request: NodeRecordRequest, project: Project, scene: Scene, record: WorkspaceRecord | undefined, intent: NodeRecordRequest['intent'], kind: string) {
  checkNodeRequest(request, project, scene, intent, kind);
  if (!record || record.id !== request.recordRef.id || record.sha256 !== request.recordRef.sha256 || record.kind !== kind || (record.data as { sourceHash?: string }).sourceHash !== project.sourceHash || (record.data as { sceneId?: string }).sceneId !== scene.id) {
    throw new Error('That exact saved version changed or is unavailable. Refresh the node and choose its saved revision; your open edits are retained.');
  }
  // A saved brief may legitimately retain earlier cell identities. Opening it
  // does not certify current dependencies; preview/export recheck those separately.
  await validateRecord(record, kind === 'generation-brief' ? undefined : project);
  return record;
}
