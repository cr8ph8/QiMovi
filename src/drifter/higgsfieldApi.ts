import { WorkspaceError } from './api';
import { canonicalJson } from './canonical';
import type { GenerationBrief, StoryCell, WorkspaceRecord } from './types';

export interface HiggsfieldSettings {
  duration: number; resolution: string; aspectRatio: string; generateAudio: boolean; bitrateMode: string;
}
export interface HiggsfieldParams {
  model: 'seedance_2_5'; mode: 'omni_reference'; duration: number; resolution: string;
  aspect_ratio: string; generate_audio: boolean; bitrate_mode: string; count: 1;
}
export interface HiggsfieldObservation {
  status: 'OBSERVED_SNAPSHOT_NOT_LIVE' | 'NOT_OBSERVED'; observedAt: string | null;
  snapshotSha256: string | null; workspaceId: string | null;
}
export interface HiggsfieldContext {
  schemaVersion: 1; provider: 'HIGGSFIELD'; observation: HiggsfieldObservation;
  account: { credits: number | null; plan: string | null; unlimAvailable: boolean | null } | null;
  supported: { model: 'seedance_2_5'; mode: 'omni_reference'; duration: { min: number; max: number; integer: true }; resolutions: string[]; aspectRatios: string[]; bitrateModes: string[]; count: 1; maxReferences: null };
  localPlanningMaxSeconds: number;
  estimates: { observedAt: string; params: HiggsfieldParams; cost: { credits: number; credits_exact?: number }; scope: string; workspaceId: string; snapshotSha256: string }[];
}
export interface HiggsfieldMedia {
  id: string; role: string; providerRole: 'start_image' | 'image'; sha256: string | null;
  label: string; mimeType: string | null; byteLength: number | null; status: string;
  crop: StoryCell['crop']; scope: string; cellId: string | null; characterId: string | null;
}
export interface HiggsfieldPreview {
  readiness: 'BLOCKED'; observation: HiggsfieldObservation; account: HiggsfieldContext['account'];
  brief: { id: string; version: number; sha256: string; basisHash: string; sourceHash: string };
  settings: HiggsfieldSettings; requiredMedia: HiggsfieldMedia[];
  estimate: { status: 'OBSERVED_PARAMETER_QUOTE' | 'NOT_QUOTED'; credits: number | null; scope: 'PARAMETERS_ONLY_NO_MEDIA'; observedAt: string | null; workspaceId: string | null; snapshotSha256: string | null };
  estimateCall: { tool: 'higgsfield_estimate_video_cost'; arguments: { params: HiggsfieldParams } };
  generationCall: null;
  generationPlan: { executable: false; params: HiggsfieldParams & { prompt: string }; requiredMedia: HiggsfieldMedia[] };
  checks: { code: string; status: 'PASS' | 'BLOCKED' | 'UNKNOWN'; message: string }[];
  requirements: { code: string; message: string }[];
}
const string = (value: unknown): value is string => typeof value === 'string';
const digest = (value: unknown) => string(value) && /^[a-f0-9]{64}$/.test(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string) && new Set(value).size === value.length;
const date = (value: unknown) => string(value) && Number.isFinite(Date.parse(value));
function requireValue(value: unknown): asserts value { if (!value) throw new Error('The retained Higgsfield observation did not match this preparation. Refresh through Codex before continuing.'); }
function observation(value: HiggsfieldObservation) {
  requireValue(value && ['OBSERVED_SNAPSHOT_NOT_LIVE', 'NOT_OBSERVED'].includes(value.status));
  if (value.status === 'OBSERVED_SNAPSHOT_NOT_LIVE') requireValue(date(value.observedAt) && digest(value.snapshotSha256) && string(value.workspaceId));
  else requireValue(value.observedAt === null && value.snapshotSha256 === null && value.workspaceId === null);
}
async function json(url: string, body?: unknown) {
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(body) } : {}) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(string(value?.error) ? value.error : 'The local Higgsfield preparation request was not confirmed.', response.status);
  return value;
}
export function higgsfieldParams(settings: HiggsfieldSettings): HiggsfieldParams {
  return { model: 'seedance_2_5', mode: 'omni_reference', duration: settings.duration, resolution: settings.resolution, aspect_ratio: settings.aspectRatio, generate_audio: settings.generateAudio, bitrate_mode: settings.bitrateMode, count: 1 };
}
export function validHiggsfieldSettings(settings: HiggsfieldSettings, context: HiggsfieldContext) {
  return context.observation.status === 'OBSERVED_SNAPSHOT_NOT_LIVE' && Number.isSafeInteger(settings.duration)
    && settings.duration >= context.supported.duration.min && settings.duration <= context.supported.duration.max
    && context.supported.resolutions.includes(settings.resolution) && context.supported.aspectRatios.includes(settings.aspectRatio)
    && context.supported.bitrateModes.includes(settings.bitrateMode) && typeof settings.generateAudio === 'boolean';
}
export async function getHiggsfieldContext(): Promise<HiggsfieldContext> {
  const value = await json('/api/higgsfield/context');
  requireValue(value?.schemaVersion === 1 && value.provider === 'HIGGSFIELD'); observation(value.observation);
  requireValue(value.account === null || ((value.account.credits === null || (Number.isFinite(value.account.credits) && value.account.credits >= 0)) && (value.account.plan === null || string(value.account.plan)) && (value.account.unlimAvailable === null || typeof value.account.unlimAvailable === 'boolean')));
  requireValue(value.supported?.model === 'seedance_2_5' && value.supported.mode === 'omni_reference' && value.supported.count === 1 && value.supported.maxReferences === null);
  requireValue(Number.isSafeInteger(value.supported.duration?.min) && Number.isSafeInteger(value.supported.duration?.max) && value.supported.duration.min > 0 && value.supported.duration.max >= value.supported.duration.min && value.supported.duration.integer === true);
  requireValue(strings(value.supported.resolutions) && strings(value.supported.aspectRatios) && strings(value.supported.bitrateModes) && Array.isArray(value.estimates));
  requireValue(value.estimates.every((item: HiggsfieldContext['estimates'][number]) => date(item.observedAt) && item.params && Number.isFinite(item.cost?.credits) && item.cost.credits >= 0 && item.scope === 'PARAMETERS_ONLY_NO_MEDIA' && item.workspaceId === value.observation.workspaceId && item.snapshotSha256 === value.observation.snapshotSha256));
  return value;
}
export async function previewHiggsfield(record: WorkspaceRecord, settings: HiggsfieldSettings, context: HiggsfieldContext): Promise<HiggsfieldPreview> {
  const brief = record.data as GenerationBrief;
  requireValue(record.kind === 'generation-brief' && string(brief?.prompt) && brief.prompt.trim() && validHiggsfieldSettings(settings, context));
  const value = await json('/api/higgsfield/preview', { briefId: record.id, briefSha256: record.sha256, settings });
  const params = higgsfieldParams(settings);
  requireValue(value?.readiness === 'BLOCKED' && value.generationCall === null && value.generationPlan?.executable === false);
  requireValue(value.brief?.id === record.id && value.brief.sha256 === record.sha256 && value.brief.version === record.version && value.brief.basisHash === brief.basisHash && value.brief.sourceHash === brief.sourceHash);
  requireValue(canonicalJson(value.settings) === canonicalJson(settings) && canonicalJson(value.observation) === canonicalJson(context.observation));
  requireValue(value.account?.credits === context.account?.credits && value.account?.plan === context.account?.plan && value.account?.unlimAvailable === context.account?.unlimAvailable);
  requireValue(value.estimateCall?.tool === 'higgsfield_estimate_video_cost' && canonicalJson(value.estimateCall.arguments) === canonicalJson({ params }));
  requireValue(canonicalJson(value.generationPlan.params) === canonicalJson({ ...params, prompt: brief.prompt }));
  requireValue(Array.isArray(value.requiredMedia) && value.requiredMedia.every((item: HiggsfieldMedia) => string(item.id) && string(item.role) && ['start_image', 'image'].includes(item.providerRole) && string(item.label) && string(item.status) && (item.sha256 === null || digest(item.sha256)) && (item.mimeType === null || string(item.mimeType)) && (item.byteLength === null || (Number.isSafeInteger(item.byteLength) && item.byteLength > 0))));
  requireValue(canonicalJson(value.generationPlan.requiredMedia) === canonicalJson(value.requiredMedia));
  requireValue(Array.isArray(value.checks) && value.checks.every((item: HiggsfieldPreview['checks'][number]) => string(item.code) && ['PASS', 'BLOCKED', 'UNKNOWN'].includes(item.status) && string(item.message)));
  requireValue(Array.isArray(value.requirements) && value.requirements.every((item: HiggsfieldPreview['requirements'][number]) => string(item.code) && string(item.message)));
  requireValue(value.estimate?.scope === 'PARAMETERS_ONLY_NO_MEDIA' && ['OBSERVED_PARAMETER_QUOTE', 'NOT_QUOTED'].includes(value.estimate.status));
  if (value.estimate.status === 'OBSERVED_PARAMETER_QUOTE') requireValue(Number.isFinite(value.estimate.credits) && value.estimate.credits >= 0 && date(value.estimate.observedAt) && value.estimate.workspaceId === context.observation.workspaceId && value.estimate.snapshotSha256 === context.observation.snapshotSha256 && context.estimates.some(item => canonicalJson(item.params) === canonicalJson(params) && item.observedAt === value.estimate.observedAt && item.cost.credits === value.estimate.credits));
  else requireValue(value.estimate.credits === null && value.estimate.observedAt === null);
  return value;
}
