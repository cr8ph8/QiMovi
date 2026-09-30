import { blenderMcpClient } from './blenderMcpClient';
import { verifyDccStagePlan, type DccStageOptions } from './DccApi';
import { canonicalJson, hashCanonical } from './canonical';

export type DccOperationPreparation = {
  schema: 'qimovi-blender-preparation/v1'; projectId: string; sourceHash: string; sceneId: string; shotId: string;
  kitSha256: string; basisSha256: string; planSha256: string; expiresAt: string;
  plan: Record<string, unknown>; planContent: string;
  operation: {
    schema: 'qimovi-local-operation/v1'; id: 'qimovi.blender.rehearsal'; version: string;
    implementation: { sha256: string; files: { path: string; sha256: string }[]; basis: 'CURRENT_SOURCE_FILES_ON_DISK'; runtimeBinaryIncluded: false; loadedModulesAttested: false };
    outputs: { role: string; format: string }[]; limits: string[]; approvalGranted: false; finalMedia: false;
  };
  qualification: {
    status: 'NOT_RUN' | 'NEEDS_REQUALIFICATION' | 'RECORDED_REOPEN'; reason: string;
    jobId: string | null; recordedAt: number | null; implementationSha256: string;
    receiptSha256: string | null; reopenEvidenceSha256: string | null;
    runtime: { status: 'EXECUTABLE_AVAILABLE' | 'UNAVAILABLE'; currentBinaryRehashed: false; recordedSha256: string | null };
    approvalGranted: false; finalMedia: false;
  };
};
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 2000;
const nullableHash = (value: unknown) => value === null || digest(value);
const invalidEvidence = () => new Error('Operation evidence does not match this camera setup. Refresh the plan and check again.');

/** Inspection uses the existing read-only prepare operation. It never starts a job. */
export async function inspectDccOperation(projectId: string, options: DccStageOptions, signal?: AbortSignal): Promise<DccOperationPreparation> {
  const value = await blenderMcpClient.call('qimovi_blender_prepare_rehearsal', { expectedProjectId: projectId, options }, signal) as DccOperationPreparation;
  const operation = value?.operation, qualification = value?.qualification;
  if (!value || value.schema !== 'qimovi-blender-preparation/v1' || options.target !== 'BLENDER'
    || value.projectId !== projectId || value.sourceHash !== options.expectedSourceHash || value.sceneId !== options.sceneId
    || value.shotId !== options.shotId || value.basisSha256 !== options.expectedBasisHash
    || !digest(value.kitSha256) || !digest(value.planSha256) || !Number.isFinite(Date.parse(value.expiresAt))
    || operation?.schema !== 'qimovi-local-operation/v1' || operation.id !== 'qimovi.blender.rehearsal' || !text(operation.version)
    || !digest(operation.implementation?.sha256) || operation.implementation.runtimeBinaryIncluded !== false
    || operation.implementation.basis !== 'CURRENT_SOURCE_FILES_ON_DISK' || operation.implementation.loadedModulesAttested !== false
    || !Array.isArray(operation.implementation.files) || !operation.implementation.files.length || operation.implementation.files.length > 50
    || !operation.implementation.files.every(file => file && text(file.path) && digest(file.sha256))
    || !Array.isArray(operation.outputs) || operation.outputs.length > 12 || !operation.outputs.every(output => output && text(output.role) && text(output.format))
    || !['OPENING', 'MOMENT', 'ENDING'].every(role => operation.outputs.filter(output => output.role === role && output.format === 'PNG').length === 1)
    || !Array.isArray(operation.limits) || operation.limits.length > 30 || !operation.limits.every(text)
    || operation.approvalGranted !== false || operation.finalMedia !== false
    || !['NOT_RUN', 'NEEDS_REQUALIFICATION', 'RECORDED_REOPEN'].includes(qualification?.status) || !text(qualification.reason)
    || !digest(qualification.implementationSha256) || qualification.implementationSha256 !== operation.implementation.sha256
    || !(qualification.jobId === null || text(qualification.jobId)) || !(qualification.recordedAt === null || Number.isFinite(qualification.recordedAt))
    || !nullableHash(qualification.receiptSha256) || !nullableHash(qualification.reopenEvidenceSha256)
    || !['EXECUTABLE_AVAILABLE', 'UNAVAILABLE'].includes(qualification.runtime?.status)
    || qualification.runtime.currentBinaryRehashed !== false || !nullableHash(qualification.runtime.recordedSha256)
    || qualification.approvalGranted !== false || qualification.finalMedia !== false
    || (qualification.status === 'RECORDED_REOPEN' && (!qualification.jobId || qualification.recordedAt === null || !digest(qualification.receiptSha256) || !digest(qualification.reopenEvidenceSha256)))) {
    throw invalidEvidence();
  }
  try {
    if (typeof value.planContent !== 'string' || value.planContent.length > 750000) throw invalidEvidence();
    const planDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.planContent))), byte => byte.toString(16).padStart(2, '0')).join('');
    if (planDigest !== value.planSha256 || canonicalJson(JSON.parse(value.planContent)) !== canonicalJson(value.plan)) throw invalidEvidence();
    verifyDccStagePlan(value.plan, projectId, options);
    if (new Set(operation.implementation.files.map(file => file.path)).size !== operation.implementation.files.length
      || await hashCanonical({ id: operation.id, version: operation.version, files: operation.implementation.files }) !== operation.implementation.sha256) throw invalidEvidence();
  } catch { throw invalidEvidence(); }
  return value;
}
