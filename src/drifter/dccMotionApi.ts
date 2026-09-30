import { hashCanonical } from './canonical';

export type DccMotionPhase = 'QUEUED'|'RENDERING'|'MEASURING'|'RETAINED'|'STOPPING'|'STOPPED'|'FAILED'|'INTERRUPTED'|'EVIDENCE_MISSING';
export interface DccMotionScope { projectId:string; sourceHash:string; sceneId:string }
export interface DccMotionRequest extends DccMotionScope { jobId:string; shotId:string; returnReceiptSha256:string }
export interface DccMotionJob extends DccMotionRequest {
  schemaVersion:'qimovi-dcc-motion/v1'; version:number; sha256:string; phase:DccMotionPhase; error:string|null;
  createdAt:number; updatedAt:number; progress:{completedFrames:number|null;totalFrames:number|null};
  takeRef:{id:string;sha256:string}|null; approvalGranted:false; finalMedia:false;
}
export interface DccMotionState extends DccMotionScope {
  schemaVersion:'qimovi-dcc-motion-jobs/v1'; busy:boolean; runtime:{available:boolean;interactiveEditor:false}; jobs:DccMotionJob[];
}
export interface DccMotionApi {
  load(scope:DccMotionScope, signal?:AbortSignal):Promise<DccMotionState>;
  start(request:DccMotionRequest):Promise<DccMotionJob>;
  stop(job:DccMotionJob):Promise<DccMotionJob>;
}
const phases = new Set<DccMotionPhase>(['QUEUED','RENDERING','MEASURING','RETAINED','STOPPING','STOPPED','FAILED','INTERRUPTED','EVIDENCE_MISSING']);
const object = (value:unknown):value is Record<string,unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value:unknown, max=1000):value is string => typeof value === 'string' && value.length > 0 && value.length <= max && ![...value].some(character=>character.charCodeAt(0)<32 || character.charCodeAt(0)===127);
const digest = (value:unknown):value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value:unknown, min=0):value is number => Number.isSafeInteger(value) && Number(value) >= min;
function need(condition:unknown, message='Motion render status could not be verified. Refresh render status before continuing.'):asserts condition { if(!condition)throw new Error(message); }
function validScope(value:DccMotionScope) { need(text(value?.projectId) && digest(value.sourceHash) && text(value.sceneId)); }
function request(value:DccMotionRequest):DccMotionRequest {
  validScope(value);
  need(text(value.jobId,160) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.jobId) && text(value.shotId) && digest(value.returnReceiptSha256));
  return {jobId:value.jobId,projectId:value.projectId,sourceHash:value.sourceHash,sceneId:value.sceneId,shotId:value.shotId,returnReceiptSha256:value.returnReceiptSha256};
}
export function sameDccMotionRequest(job:DccMotionRequest, expected:DccMotionRequest):boolean {
  return job.jobId === expected.jobId && job.projectId === expected.projectId && job.sourceHash === expected.sourceHash && job.sceneId === expected.sceneId && job.shotId === expected.shotId && job.returnReceiptSha256 === expected.returnReceiptSha256;
}
export async function verifyDccMotionJob(value:unknown, scope:DccMotionScope):Promise<DccMotionJob> {
  validScope(scope);
  need(object(value) && value.schemaVersion === 'qimovi-dcc-motion/v1' && value.projectId === scope.projectId && value.sourceHash === scope.sourceHash && value.sceneId === scope.sceneId,
    'This motion render belongs to different scene inputs. Refresh the selected scene.');
  const job=value as unknown as DccMotionJob;
  request(job);
  need(phases.has(job.phase) && integer(job.version,1) && digest(job.sha256) && integer(job.createdAt,1) && integer(job.updatedAt,job.createdAt)
    && (job.error === null || text(job.error,4000)) && job.approvalGranted === false && job.finalMedia === false);
  need(object(job.progress) && (job.progress.completedFrames === null || integer(job.progress.completedFrames)) && (job.progress.totalFrames === null || integer(job.progress.totalFrames,1))
    && (job.progress.completedFrames === null || job.progress.totalFrames === null || job.progress.completedFrames <= job.progress.totalFrames));
  need(job.takeRef === null || object(job.takeRef) && text(job.takeRef.id) && digest(job.takeRef.sha256));
  need(job.phase !== 'RETAINED' || job.takeRef !== null);
  const {sha256,...body}=job;
  need(await hashCanonical(body) === sha256,'The motion render receipt changed. Refresh render status before continuing.');
  return job;
}
async function json(path:string, options:RequestInit={}) {
  const response=await fetch(path,{...options,credentials:'same-origin',redirect:'error'});
  if(!response.ok) {
    const message=response.status === 401 ? 'Reconnect your local owner session before rendering motion.'
      : response.status === 409 ? 'The camera plan changed or another local render is running. Refresh the returns and render status.'
      : 'The local service did not confirm the motion render request. Refresh render status, then retry the same request.';
    throw Object.assign(new Error(message),{confirmedRejection:response.status >= 400 && response.status < 500});
  }
  return response.json() as Promise<unknown>;
}
const post=(body:object):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export const dccMotionApi:DccMotionApi = {
  async load(scope, signal) {
    const captured={...scope};validScope(captured);
    const value=await json(`/api/dcc/motion?sceneId=${encodeURIComponent(captured.sceneId)}`,{signal});
    need(object(value) && value.schemaVersion === 'qimovi-dcc-motion-jobs/v1' && value.projectId === captured.projectId && value.sourceHash === captured.sourceHash && value.sceneId === captured.sceneId
      && typeof value.busy === 'boolean' && object(value.runtime) && typeof value.runtime.available === 'boolean' && value.runtime.interactiveEditor === false && Array.isArray(value.jobs) && value.jobs.length <= 1000);
    const jobs=await Promise.all(value.jobs.map(job=>verifyDccMotionJob(job,captured)));
    need(new Set(jobs.map(job=>job.jobId)).size === jobs.length);
    return {...value,jobs} as unknown as DccMotionState;
  },
  async start(input) {
    const captured=request(input),job=await verifyDccMotionJob(await json('/api/dcc/motion',post(captured)),captured);
    need(sameDccMotionRequest(job,captured),'The motion render response does not match this exact request. Refresh render status before retrying.');
    return job;
  },
  async stop(input) {
    const captured=structuredClone(input);
    await verifyDccMotionJob(captured,captured);
    const job=await verifyDccMotionJob(await json('/api/dcc/motion/stop',post({jobId:captured.jobId})),captured);
    need(sameDccMotionRequest(job,captured) && job.version >= captured.version,'The cancellation response belongs to another render or an earlier revision. Refresh render status.');
    return job;
  },
};
