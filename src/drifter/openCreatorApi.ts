export const MAX_OPENCREATOR_SRT_BYTES = 256 * 1024;
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
export type OpenCreatorScope = { id: string; sourceHash: string | null };
export type OpenCreatorFormat = 'horizontal' | 'vertical';
export interface OpenCreatorAssetRef { id: string; version: number; sha256: string }
export interface OpenCreatorVideo {
  recordRef: OpenCreatorAssetRef; assetHash: string; title: string; originalFilename: string; byteLength: number;
}
export interface OpenCreatorJob {
  id: string; requestId: string; projectId: string; sourceHash: string | null; format: OpenCreatorFormat;
  phase: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
  createdAt: string; finishedAt: string | null; error: string | null;
  output: { sha256: string; byteLength: number; filename: string } | null;
  cost: { providerCalls: 0; providerCharge: 0; totalCost: null; localCompute: 'UNMEASURED' };
  retainedAssetId: string | null;
}
export interface OpenCreatorCatalog {
  schemaVersion: 'qimovi-opencreator/v1'; projectId: string; sourceHash: string | null;
  runtime: { state: 'READY' | 'NOT_CONFIGURED' | 'MISSING_DEPENDENCIES'; message: string };
  videos: OpenCreatorVideo[]; jobs: OpenCreatorJob[];
}
export interface OpenCreatorRequest {
  projectId: string; sourceHash: string | null; requestId: string; assetRef: OpenCreatorAssetRef;
  format: OpenCreatorFormat; subtitles: string;
}
export interface OpenCreatorApi {
  load(project: OpenCreatorScope, signal?: AbortSignal): Promise<OpenCreatorCatalog>;
  create(project: OpenCreatorScope, request: OpenCreatorRequest): Promise<OpenCreatorJob>;
  job(project: OpenCreatorScope, id: string, signal?: AbortSignal): Promise<OpenCreatorJob>;
  cancel(project: OpenCreatorScope, id: string): Promise<OpenCreatorJob>;
  retain(project: OpenCreatorScope, id: string): Promise<OpenCreatorJob>;
  video(project: OpenCreatorScope, job: OpenCreatorJob, signal?: AbortSignal): Promise<Blob>;
  receipt(project: OpenCreatorScope, job: OpenCreatorJob, signal?: AbortSignal): Promise<Blob>;
}

export class OpenCreatorRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
const failureMessages: Record<string, string> = {
  OPENCREATOR_BUSY: 'Another local render is running. Check its result before trying this request again.',
  OPENCREATOR_PROJECT_CHANGED: 'The project or screenplay changed. Reopen this project and check local tools.',
  OPENCREATOR_SUBTITLES_INVALID: 'Check the SRT numbering, timestamps and subtitle text before rendering.',
  OPENCREATOR_SUBTITLE_TIMING: 'Check the SRT timing. Each subtitle must end after it starts and fit within 30 minutes.',
  OPENCREATOR_SUBTITLES_EXCEED_VIDEO: 'The subtitles extend past the selected video. Review their timing before rendering.',
  OPENCREATOR_VIDEO_REQUIRED: 'Choose a retained MP4 of 256 MiB or less.',
  OPENCREATOR_ASSET_CHANGED: 'The selected video changed. Check local tools and select its current version.',
  OPENCREATOR_RUNTIME_NOT_READY: 'The local rendering tools are not ready. Check local tools before rendering.',
  OPENCREATOR_RUNTIME_MISSING: 'The local rendering tools need setup.',
  OPENCREATOR_FONTS_MISSING: 'The subtitle fonts are unavailable. Check the local tool setup.',
  OPENCREATOR_PROBE_FAILED: 'The local tools could not read this MP4. Check the source video.',
  OPENCREATOR_MEDIA_MEASUREMENT: 'This video could not be measured within the supported size and 30-minute duration limits.',
  OPENCREATOR_RENDER_FAILED: 'The local render failed. Check local tools and review the source video and subtitles.',
  OPENCREATOR_TIMED_OUT: 'The local render exceeded its time limit.',
  OPENCREATOR_CANCELLED: 'The local render was cancelled.',
  OPENCREATOR_INTERRUPTED: 'The local render was interrupted when the service stopped.',
  OPENCREATOR_OUTPUT_NOT_READY: 'The finished MP4 is not available yet. Check result again.',
  OPENCREATOR_OUTPUT_CHANGED: 'The rendered MP4 changed after completion. Its download could not be verified.',
  OPENCREATOR_RECEIPT_CHANGED: 'The render receipt changed after completion. It could not be verified.',
  OPENCREATOR_JOB_NOT_FOUND: 'This render is no longer available. Check local tools for the current job list.',
  OPENCREATOR_REQUEST_REUSED: 'This request ID already belongs to different inputs. Check local tools to recover its original job.',
};
export function openCreatorErrorMessage(message: string) {
  return failureMessages[message] ?? (message.startsWith('OPENCREATOR_') ? 'Local finishing could not complete this request. Check local tools and the selected source.' : message);
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 16384): value is string => typeof value === 'string' && value.length <= max;
const identity = (value: unknown): value is string => text(value, 500) && value.length > 0;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max;
const timestamp = (value: unknown): value is string => text(value, 100) && Number.isFinite(Date.parse(value));
const format = (value: unknown): value is OpenCreatorFormat => value === 'horizontal' || value === 'vertical';
function check(condition: unknown, message = 'The local finishing response could not be verified. Check local tools again.'): asserts condition {
  if (!condition) throw new Error(message);
}
function scope(project: OpenCreatorScope) { check(identity(project?.id) && (project.sourceHash === null || digest(project.sourceHash)), 'Open a project before using local finishing.'); }
function assetRef(value: unknown): value is OpenCreatorAssetRef {
  return object(value) && identity(value.id) && positive(value.version) && digest(value.sha256);
}
function video(value: unknown): value is OpenCreatorVideo {
  return object(value) && assetRef(value.recordRef) && digest(value.assetHash) && text(value.title) && identity(value.originalFilename) && positive(value.byteLength, MAX_VIDEO_BYTES);
}
export function validateOpenCreatorRequest(value: unknown, project: OpenCreatorScope): OpenCreatorRequest {
  scope(project);
  check(object(value) && value.projectId === project.id && value.sourceHash === project.sourceHash && assetRef(value.assetRef)
    && identity(value.requestId) && format(value.format) && text(value.subtitles, MAX_OPENCREATOR_SRT_BYTES)
    && value.subtitles.trim().length > 0 && new TextEncoder().encode(value.subtitles).byteLength <= MAX_OPENCREATOR_SRT_BYTES,
  'Choose a retained MP4 and reviewed SRT of 256 KiB or less before rendering.');
  return { projectId: value.projectId as string, sourceHash: value.sourceHash as string | null, requestId: value.requestId,
    assetRef: { id: value.assetRef.id, version: value.assetRef.version, sha256: value.assetRef.sha256 }, format: value.format, subtitles: value.subtitles };
}
function validateJob(value: unknown, project: OpenCreatorScope, expectedId?: string): OpenCreatorJob {
  check(object(value) && identity(value.id) && identity(value.requestId) && (expectedId === undefined || value.id === expectedId)
    && value.projectId === project.id && value.sourceHash === project.sourceHash && format(value.format)
    && ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(String(value.phase))
    && timestamp(value.createdAt) && (value.finishedAt === null || timestamp(value.finishedAt))
    && (value.error === null || text(value.error)) && (value.retainedAssetId === null || identity(value.retainedAssetId)),
  'The finishing job does not match this project or has an invalid status. Refresh local tools.');
  check(object(value.cost) && value.cost.providerCalls === 0 && value.cost.providerCharge === 0 && value.cost.totalCost === null && value.cost.localCompute === 'UNMEASURED');
  if (value.output !== null) check(object(value.output) && digest(value.output.sha256) && positive(value.output.byteLength, MAX_VIDEO_BYTES)
    && identity(value.output.filename) && !/[\\/\0]/.test(value.output.filename) && /\.mp4$/i.test(value.output.filename));
  check(value.phase === 'COMPLETED' ? value.output !== null && value.finishedAt !== null : value.output === null && value.retainedAssetId === null);
  check(value.phase !== 'RUNNING' || value.finishedAt === null);
  return value as unknown as OpenCreatorJob;
}
async function response(path: string, options: RequestInit = {}) {
  const result = await fetch(path, { ...options, credentials: 'same-origin', redirect: 'error' });
  if (!result.ok) {
    const value: unknown = await result.json().catch(() => null);
    const message = result.status === 401 ? 'Restore your QiMovi session, then check local tools.'
      : object(value) && text(value.error, 1000) ? openCreatorErrorMessage(value.error) : 'The local finishing request was not confirmed.';
    throw new OpenCreatorRequestError(message, result.status);
  }
  return result;
}
async function json(path: string, options: RequestInit = {}) { return (await response(path, options)).json() as Promise<unknown>; }
function jobPath(id: string) { check(identity(id) && id !== '.' && id !== '..'); return `/api/opencreator/jobs/${encodeURIComponent(id)}`; }
async function jobResponse(project: OpenCreatorScope, path: string, options: RequestInit = {}, expectedId?: string) {
  scope(project);
  const value = await json(path, options);
  check(object(value));
  return validateJob(value.job, project, expectedId);
}
const post = (body: object): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const openCreatorApi: OpenCreatorApi = {
  async load(project, signal) {
    scope(project);
    const value = await json('/api/opencreator', { signal });
    check(object(value) && value.schemaVersion === 'qimovi-opencreator/v1' && value.projectId === project.id && value.sourceHash === project.sourceHash,
      'The local finishing tools returned a different project. Reopen this project before continuing.');
    check(object(value.runtime) && ['READY', 'NOT_CONFIGURED', 'MISSING_DEPENDENCIES'].includes(String(value.runtime.state)) && text(value.runtime.message)
      && Array.isArray(value.videos) && value.videos.length <= 1000 && value.videos.every(video) && Array.isArray(value.jobs) && value.jobs.length <= 1000);
    const videos = value.videos as unknown as OpenCreatorVideo[], jobs = value.jobs.map(job => validateJob(job, project));
    check(new Set(videos.map(item => item.recordRef.id)).size === videos.length && new Set(jobs.map(job => job.id)).size === jobs.length && new Set(jobs.map(job => job.requestId)).size === jobs.length);
    return { ...value, jobs } as unknown as OpenCreatorCatalog;
  },
  async create(project, request) {
    const snapshot = validateOpenCreatorRequest(request, project);
    const job = await jobResponse(project, '/api/opencreator/jobs', post(snapshot));
    check(job.requestId === snapshot.requestId && job.format === snapshot.format, 'The returned finishing job does not match this request. Check the job list before retrying.');
    return job;
  },
  job: (project, id, signal) => jobResponse(project, jobPath(id), { signal }, id),
  cancel: (project, id) => jobResponse(project, `${jobPath(id)}/cancel`, post({}), id),
  retain: async (project, id) => {
    const job = await jobResponse(project, `${jobPath(id)}/retain`, post({}), id);
    check(job.phase === 'COMPLETED' && job.retainedAssetId !== null, 'Keeping this output in the Library was not confirmed. Check its result before trying again.');
    return job;
  },
  async video(project, job, signal) {
    scope(project); validateJob(job, project); check(job.phase === 'COMPLETED' && job.output);
    const result = await response(`${jobPath(job.id)}/video`, { signal });
    check(result.headers.get('Content-Type')?.split(';')[0] === 'video/mp4', 'The finishing output was not an MP4.');
    const buffer = await result.arrayBuffer();
    check(buffer.byteLength === job.output.byteLength, 'The downloaded MP4 did not match the completed render. Check result again.');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    check(hash === job.output.sha256, 'The downloaded MP4 did not match the completed render. Check result again.');
    return new Blob([buffer], { type: 'video/mp4' });
  },
  async receipt(project, job, signal) {
    scope(project); validateJob(job, project); check(job.phase === 'COMPLETED' && job.output);
    const value = await json(`${jobPath(job.id)}/receipt`, { signal });
    check(object(value) && value.schemaVersion === 'qimovi-opencreator-receipt/v1');
    const receiptJob = validateJob(value.job, project, job.id);
    check(receiptJob.phase === 'COMPLETED' && receiptJob.requestId === job.requestId && receiptJob.format === job.format && receiptJob.output?.sha256 === job.output.sha256 && receiptJob.output?.byteLength === job.output.byteLength
      && object(value.source) && assetRef(value.source.recordRef) && digest(value.source.assetHash) && positive(value.source.byteLength, MAX_VIDEO_BYTES) && identity(value.source.originalFilename)
      && digest(value.subtitlesSha256) && digest(value.manifestSha256) && object(value.runtime) && value.runtime.interfaceRelease === '3.2.3'
      && [value.runtime.cliSha256, value.runtime.ffmpegSha256, value.runtime.ffprobeSha256].every(digest)
      && object(value.measurement) && positive(value.measurement.width) && positive(value.measurement.height) && Number.isFinite(value.measurement.durationMs) && Number(value.measurement.durationMs) > 0
      && value.network === 'DENIED_BY_OS_SANDBOX' && value.approval === 'PENDING_REVIEW', 'The finishing receipt does not match this completed render.');
    return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  },
};
