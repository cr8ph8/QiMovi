import { hashCanonical } from './canonical';
import { blenderMcpClient } from './blenderMcpClient';
import type { DccStageOptions } from './DccApi';

export type DccRehearsalJob = { schemaVersion: 'caniscreenwrite-dcc-rehearsal/v1'; jobId: string; projectId: string; sourceHash: string; sceneId: string; shotId: string;
  phase: 'QUEUED'|'RUNNING'|'VERIFYING'|'STOPPING'|'RETAINED'|'FAILED'|'STOPPED'|'INTERRUPTED'|'EVIDENCE_MISSING'; version: number; createdAt: number; sha256: string; requestSha256:string;
  runtimePath: string; outputDirectory: string; error: string|null; reopenedVerified: boolean; approvalGranted: false; finalMedia: false; returnReceiptSha256: string|null };
export type DccRehearsalState = { schemaVersion: 'caniscreenwrite-dcc-rehearsals/v1'; projectId: string; sourceHash: string; sceneId: string; busy: boolean;
  runtime: { available: boolean; path: string|null; configurationSource?:string; interactiveEditor: false }; jobs: DccRehearsalJob[] };
export type DccRehearsalRequest = { jobId: string; options: DccStageOptions };
const phases = new Set(['QUEUED','RUNNING','VERIFYING','STOPPING','RETAINED','FAILED','STOPPED','INTERRUPTED','EVIDENCE_MISSING']);
export async function verifyDccRehearsalJob(value: unknown, projectId: string, sourceHash: string, sceneId: string): Promise<DccRehearsalJob> {
  const job = value as DccRehearsalJob;
  if (!job || job.schemaVersion !== 'caniscreenwrite-dcc-rehearsal/v1' || job.projectId !== projectId || job.sourceHash !== sourceHash || job.sceneId !== sceneId
    || !phases.has(job.phase) || job.approvalGranted !== false || job.finalMedia !== false || typeof job.jobId !== 'string' || typeof job.shotId !== 'string') throw new Error('Rehearsal belongs to different scene inputs.');
  const {sha256,...body} = job; if (await hashCanonical(body) !== sha256) throw new Error('Rehearsal receipt changed.');
  return job;
}
export const dccRehearsalsApi = {
  async load(projectId: string, sourceHash: string, sceneId: string, signal?: AbortSignal): Promise<DccRehearsalState> {
    const value = await blenderMcpClient.call('qimovi_blender_status', {expectedProjectId:projectId,expectedSourceHash:sourceHash,sceneId}, signal) as DccRehearsalState;
    if (value.schemaVersion !== 'caniscreenwrite-dcc-rehearsals/v1' || value.projectId !== projectId || value.sourceHash !== sourceHash || value.sceneId !== sceneId
      || typeof value.busy !== 'boolean' || typeof value.runtime?.available !== 'boolean' || value.runtime.interactiveEditor !== false || !Array.isArray(value.jobs) || value.jobs.length > 1000) throw new Error('Rehearsal status could not be verified.');
    await Promise.all(value.jobs.map(job => verifyDccRehearsalJob(job,projectId,sourceHash,sceneId))); return value;
  },
  async start(input: DccRehearsalRequest, projectId: string) {
    const prepared=await blenderMcpClient.call('qimovi_blender_prepare_rehearsal',{expectedProjectId:projectId,options:input.options}) as {schema:string;projectId:string;sourceHash:string;sceneId:string;shotId:string;kitSha256:string;basisSha256:string};
    if(prepared.schema!=='qimovi-blender-preparation/v1'||prepared.projectId!==projectId||prepared.sourceHash!==input.options.expectedSourceHash||prepared.sceneId!==input.options.sceneId||prepared.shotId!==input.options.shotId||prepared.basisSha256!==input.options.expectedBasisHash||!/^[a-f0-9]{64}$/.test(prepared.kitSha256))throw new Error('Prepared Blender kit does not match this camera plan.');
    const result=await verifyDccRehearsalJob(await blenderMcpClient.call('qimovi_blender_start_rehearsal',{...input,expectedProjectId:projectId,expectedKitSha256:prepared.kitSha256}),projectId,input.options.expectedSourceHash,input.options.sceneId);
    if(result.jobId!==input.jobId||result.shotId!==input.options.shotId||result.requestSha256!==await hashCanonical(input))throw new Error('The returned rehearsal does not match this exact request. Refresh status before retrying.');return result;
  },
  async stop(job: DccRehearsalJob) {
    const result=await verifyDccRehearsalJob(await blenderMcpClient.call('qimovi_blender_stop_rehearsal',{jobId:job.jobId,expectedProjectId:job.projectId,expectedSourceHash:job.sourceHash,sceneId:job.sceneId}),job.projectId,job.sourceHash,job.sceneId);
    if(result.jobId!==job.jobId||result.version<job.version)throw new Error('The stop response belongs to another rehearsal or earlier revision.');return result;
  },
};
