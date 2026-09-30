import { WorkspaceError } from './api';

export type HiggsfieldValue = string | number | boolean | string[] | null;
export type HiggsfieldMediaRole = 'image' | 'start_image' | 'end_image' | 'video' | 'audio';
export interface HiggsfieldModelParameter {
  name: string; type: 'string' | 'number' | 'bool' | 'string_array'; required: 'required' | 'optional';
  description?: string; default?: HiggsfieldValue; options?: (string | number)[];
  min?: number; max?: number; nullable?: boolean; format?: string; pattern?: string; item_format?: string; item_pattern?: string;
}
export interface HiggsfieldCatalogModel {
  id: string; name: string; description: string; provider_name: string; output_type: 'image' | 'video' | 'audio' | '3d';
  parameters: HiggsfieldModelParameter[]; medias: { name: string; type: string; roles?: string[]; max?: number; required?: boolean; description?: string }[];
  aspect_ratios: string[]; durations?: number[]; duration_range?: { min: number; max: number }; tags?: string[]; supports_unlim?: boolean;
}
export interface HiggsfieldToolsSnapshot { catalogSha256: string; observedAt: string; status: 'RETAINED_SNAPSHOT_NOT_LIVE'; sources: { name: string; sha256: string }[] }
export type HiggsfieldActionGroup = 'frames' | 'cast' | 'video' | 'voice' | 'sets' | 'review' | 'marketing' | 'connections';
export interface HiggsfieldAction {
  id: string; group: HiggsfieldActionGroup; title: string; purpose: string; inputs: string[]; output: string; nextStep: string;
  toolSuffix: string; tool: string; executionStatus: string; executable: false; modelIds: string[];
}
export interface HiggsfieldModelPreset {
  id: string; taskId: string; title: string; purpose: string; modelId: string; settings: Record<string, HiggsfieldValue>;
  mediaRoles: string[]; executionStatus: 'PREPARATION_ONLY' | 'DISCOVERY_ONLY';
}
export interface HiggsfieldToolsCatalog {
  snapshot: HiggsfieldToolsSnapshot; models: HiggsfieldCatalogModel[]; composerModelIds: string[];
  limits: { localPlanningMaxSeconds: number; maxPlannedMedia: number; maxPromptCharacters?: number }; readiness: 'PREPARATION_ONLY'; executable: false;
  tools: { name: string; suffix: string; description: string }[];
  groups: Record<string, string[]>; missingTools: string[];
  actions: HiggsfieldAction[]; modelPresets: HiggsfieldModelPreset[]; actionCatalogSha256: string;
  marketingFormats: { slug: string; title: string; description: string; minDurationSeconds: number; maxDurationSeconds: number }[];
  marketingStyles: { id: string; title: string; category: string }[];
}
export interface HiggsfieldPlannedMedia { role: HiggsfieldMediaRole; sha256: string; label: string; mimeType: string }
export interface HiggsfieldComposeInput {
  catalogSha256: string; modelId: string; prompt: string; settings: Record<string, HiggsfieldValue>;
  medias: HiggsfieldPlannedMedia[]; brief?: { id: string; sha256: string };
  taskId?: string;
}
export interface HiggsfieldComposeResult {
  snapshot: HiggsfieldToolsSnapshot; requestSha256: string; model: HiggsfieldCatalogModel;
  params: Record<string, HiggsfieldValue>; mediaRequirements: { role: string; sha256: string | null; label: string; mimeType: string | null; status: string; crop?: unknown; scope?: string; cellId?: string | null; characterId?: string | null }[];
  checks: { code: string; status: 'PASS' | 'BLOCKED' | 'UNKNOWN'; message: string }[];
  estimateCall: { tool: string; arguments: { params: Record<string, HiggsfieldValue> }; scope: 'PARAMETERS_ONLY_NO_MEDIA' } | null;
  generationCall: null; readiness: 'PREPARATION_ONLY'; executable: false;
  taskId?: string; actionCatalogSha256?: string;
  briefBinding?: { id: string; sha256: string; version: number; sourceHash: string; sceneId: string; basisHash: string; promptSha256: string } | null;
}
export interface HiggsfieldToolsApi {
  load(signal?: AbortSignal): Promise<HiggsfieldToolsCatalog>;
  compose(input: HiggsfieldComposeInput, catalog: HiggsfieldToolsCatalog): Promise<HiggsfieldComposeResult>;
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const digest = (v: unknown): v is string => text(v) && /^[a-f0-9]{64}$/.test(v);
function check(value: unknown): asserts value { if (!value) throw new Error('The Higgsfield preparation response did not match this request. Reload the catalog before continuing.'); }
/** Provider numbers can be fractional; canonical screenplay/workspace records stay unchanged. */
export function higgsfieldRequestJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isFinite(value)); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(higgsfieldRequestJson).join(',')}]`;
  check(object(value));
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${higgsfieldRequestJson(value[key])}`).join(',')}}`;
}
async function hashText(value: string) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''); }
function snapshot(value: unknown): asserts value is HiggsfieldToolsSnapshot {
  check(object(value) && value.status === 'RETAINED_SNAPSHOT_NOT_LIVE' && digest(value.catalogSha256) && text(value.observedAt) && Number.isFinite(Date.parse(value.observedAt)));
  check(Array.isArray(value.sources) && value.sources.every(row => object(row) && text(row.name) && digest(row.sha256)));
}
function model(value: unknown): asserts value is HiggsfieldCatalogModel {
  check(object(value) && ['id', 'name', 'description', 'provider_name'].every(key => text(value[key])) && ['image', 'video', 'audio', '3d'].includes(String(value.output_type)));
  check(Array.isArray(value.parameters) && value.parameters.every(p => object(p) && text(p.name) && ['string', 'number', 'bool', 'string_array'].includes(String(p.type)) && ['required', 'optional'].includes(String(p.required)) && (p.options === undefined || (Array.isArray(p.options) && p.options.every(o => text(o) || typeof o === 'number')))));
  check(Array.isArray(value.medias) && value.medias.every(m => object(m) && text(m.name) && text(m.type) && (m.roles === undefined || (Array.isArray(m.roles) && m.roles.every(text)))));
  check(Array.isArray(value.aspect_ratios) && value.aspect_ratios.every(text));
}
async function read(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', redirect: 'error' });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(object(value) && text(value.error) ? value.error : 'Higgsfield preparation could not be read.', response.status);
  return value;
}
export const higgsfieldToolsApi: HiggsfieldToolsApi = {
  async load(signal) {
    const value = await read('/api/higgsfield/tools', { signal });
    check(object(value)); snapshot(value.snapshot);
    check(value.readiness === 'PREPARATION_ONLY' && value.executable === false && Array.isArray(value.models) && value.models.length <= 2000);
    const models = value.models;
    models.forEach(model); check(new Set(models.map(m => m.id)).size === models.length);
    check(Array.isArray(value.composerModelIds) && value.composerModelIds.every(id => text(id) && models.some((m: HiggsfieldCatalogModel) => m.id === id)));
    check(object(value.limits) && Number.isSafeInteger(value.limits.localPlanningMaxSeconds) && Number.isSafeInteger(value.limits.maxPlannedMedia));
    check(Array.isArray(value.tools) && value.tools.every(t => object(t) && text(t.name) && text(t.suffix) && text(t.description)) && new Set(value.tools.map(t => t.name)).size === value.tools.length);
    check(object(value.groups) && Object.values(value.groups).every(rows => Array.isArray(rows) && rows.every(text)) && Array.isArray(value.missingTools) && value.missingTools.every(text));
    check(digest(value.actionCatalogSha256) && Array.isArray(value.actions) && value.actions.length === value.tools.length);
    const actions = value.actions, toolRows = value.tools;
    check(actions.every(row => object(row) && ['id', 'title', 'purpose', 'output', 'nextStep', 'toolSuffix', 'tool', 'executionStatus'].every(key => text(row[key])) && ['frames', 'cast', 'video', 'voice', 'sets', 'review', 'marketing', 'connections'].includes(String(row.group)) && row.executable === false && Array.isArray(row.inputs) && row.inputs.every(text) && Array.isArray(row.modelIds) && row.modelIds.every(id => text(id) && models.some(model => model.id === id)) && row.id === row.toolSuffix && toolRows.some(tool => tool.suffix === row.id && tool.name === row.tool)));
    check(new Set(actions.map(row => row.id)).size === actions.length);
    check(Array.isArray(value.modelPresets) && value.modelPresets.every(row => object(row) && ['id', 'taskId', 'title', 'purpose', 'modelId'].every(key => text(row[key])) && actions.some(action => action.id === row.taskId) && models.some(model => model.id === row.modelId) && object(row.settings) && Array.isArray(row.mediaRoles) && row.mediaRoles.every(text) && ['PREPARATION_ONLY', 'DISCOVERY_ONLY'].includes(String(row.executionStatus))));
    check(Array.isArray(value.marketingFormats) && value.marketingFormats.every(row => object(row) && ['slug', 'title', 'description'].every(key => text(row[key])) && Number.isFinite(row.minDurationSeconds) && Number.isFinite(row.maxDurationSeconds)));
    check(Array.isArray(value.marketingStyles) && value.marketingStyles.every(row => object(row) && ['id', 'title', 'category'].every(key => text(row[key]))));
    return value as unknown as HiggsfieldToolsCatalog;
  },
  async compose(input, catalog) {
    // Capture before any async work: later typing must never change the attempted call.
    const body = higgsfieldRequestJson(input), captured: HiggsfieldComposeInput = JSON.parse(body);
    const requestSha256 = await hashText(body);
    const value = await read('/api/higgsfield/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    check(object(value)); snapshot(value.snapshot); model(value.model);
    check(value.requestSha256 === requestSha256 && value.snapshot.catalogSha256 === captured.catalogSha256 && JSON.stringify(value.snapshot) === JSON.stringify(catalog.snapshot));
    const selected = catalog.models.find(row => row.id === captured.modelId);
    check(selected && JSON.stringify(value.model) === JSON.stringify(selected));
    check(value.readiness === 'PREPARATION_ONLY' && value.executable === false && value.generationCall === null);
    if (captured.taskId) check(value.taskId === captured.taskId && value.actionCatalogSha256 === catalog.actionCatalogSha256);
    check(object(value.params) && value.params.model === captured.modelId && value.params.prompt === captured.prompt && !('medias' in value.params));
    check(Object.entries(captured.settings).every(([key, val]) => JSON.stringify(value.params[key]) === JSON.stringify(val)));
    check(Array.isArray(value.mediaRequirements) && value.mediaRequirements.every(row => object(row) && text(row.role) && text(row.label) && text(row.status) && (row.sha256 === null || digest(row.sha256)) && (row.mimeType === null || text(row.mimeType))));
    check(Array.isArray(value.checks) && value.checks.every(row => object(row) && text(row.code) && text(row.message) && ['PASS', 'BLOCKED', 'UNKNOWN'].includes(String(row.status))));
    if (value.estimateCall !== null) {
      check(object(value.estimateCall) && value.estimateCall.scope === 'PARAMETERS_ONLY_NO_MEDIA' && object(value.estimateCall.arguments) && object(value.estimateCall.arguments.params));
      const expectedTool = selected.output_type === 'image' ? 'higgsfield_estimate_image_cost' : selected.output_type === 'video' ? 'higgsfield_estimate_video_cost' : 'higgsfield_generate_audio';
      check(value.estimateCall.tool === expectedTool);
      const { prompt: _prompt, ...estimateParams } = value.params;
      check(selected.output_type !== 'audio' && higgsfieldRequestJson(value.estimateCall.arguments.params) === higgsfieldRequestJson(estimateParams));
    }
    if (captured.brief) {
      check(object(value.briefBinding) && value.briefBinding.id === captured.brief.id && value.briefBinding.sha256 === captured.brief.sha256 && Number.isSafeInteger(value.briefBinding.version) && Number(value.briefBinding.version) > 0 && digest(value.briefBinding.sourceHash) && digest(value.briefBinding.basisHash) && text(value.briefBinding.sceneId));
      const promptHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(captured.prompt));
      check(value.briefBinding.promptSha256 === Array.from(new Uint8Array(promptHash), byte => byte.toString(16).padStart(2, '0')).join(''));
    } else check(value.briefBinding === undefined || value.briefBinding === null);
    return value as unknown as HiggsfieldComposeResult;
  },
};
