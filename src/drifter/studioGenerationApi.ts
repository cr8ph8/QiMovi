import { studioGenerationDetails } from '../../local/contracts/studio-generation.mjs';
import { validateRecord } from './validation';
import { canonicalJson } from './canonical';
import type { StudioGeneration, WorkspaceRecord } from './types';

export type StudioGenerationRecord = WorkspaceRecord & { kind: 'studio-generation'; data: StudioGeneration };
export type GenerationScope = { projectId: string; sourceHash: string | null };
export type GenerationPrepare = { jobId: string; operationRef: StudioGeneration['operationRef']; workspaceId: string; paymentChoice: 'CREDITS' | 'UNLIMITED'; referenceUseConfirmed: true };
export type GenerationWorkspace = { id: string; name: string | null; is_selected: boolean; plan_type?: string | null };
export type GenerationOutput = { jobId: string; sha256: string; mimeType: string; byteLength: number; filename: string; status: 'UNREVIEWED' };
export type GenerationDetails = {
  title: string; modelId: string; outputType: string; workspaceId: string; workspaceName: string | null; paymentChoice: 'CREDITS' | 'UNLIMITED';
  quote: null | { credits: string; observedAtMs: number };
  jobs: { id: string; status: string; type: string; resultUrl?: string }[];
  outputs: GenerationOutput[]; error: string | null;
  providerReferences?: {voice:null|{voice_id:string;voice_type:'preset'|'element';name:string};elements:{id:string;name:string;category:string}[];marketing?:{kind:'brand'|'product'|'presenter'|'hook'|'setting'|'style'|'format';id:string;name:string}[]};
};
export interface StudioGenerationApi {
  list(scope: GenerationScope, signal?: AbortSignal): Promise<StudioGenerationRecord[]>;
  workspaces(scope: GenerationScope, signal?: AbortSignal): Promise<GenerationWorkspace[]>;
  prepare(scope: GenerationScope, input: GenerationPrepare): Promise<StudioGenerationRecord>;
  submit(scope: GenerationScope, record: StudioGenerationRecord, maximumCredits: string): Promise<StudioGenerationRecord>;
  poll(scope: GenerationScope, record: StudioGenerationRecord): Promise<StudioGenerationRecord>;
  retain(scope: GenerationScope, record: StudioGenerationRecord): Promise<StudioGenerationRecord>;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function need(value: unknown): asserts value { if (!value) throw Error('The generation response did not match this saved task. Refresh local status before continuing.'); }
const bounded = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max && !value.includes('\0');
export function generationMessage(code: string): string {
  const messages: Record<string,string> = {
    HIGGSFIELD_MCP_SIGN_IN_REQUIRED:'Connect Higgsfield and discover its tools in Connection before continuing.',
    HIGGSFIELD_LIFECYCLE_CAPABILITY_UNAVAILABLE:'This connection is missing a tool or input format needed to finish the generation. Refresh its tool discovery before preparing.',
    HIGGSFIELD_WORKSPACE_CHANGED:'The active Higgsfield workspace changed. Review the billing workspace and prepare this task again.',
    HIGGSFIELD_CONNECTION_CHANGED:'The Higgsfield sign-in changed. Prepare again using the current connection.',
    STUDIO_GENERATION_INPUTS_NEED_REVIEW:'The task has unresolved input or reference checks. Review its local preparation requirements.',
    STUDIO_GENERATION_ORIGINAL_INPUTS_REQUIRED:'Prepare the required crops or excerpts as actual media files before uploading.',
    SOURCE_ADMISSION_REQUIRED:'Review and admit the production screenplay before generating its shots.',
    STUDIO_GENERATION_OPERATION_CHANGED:'This saved task changed. Prepare its current version for a new cost review.',
    STUDIO_GENERATION_CASTING_CHANGED:'The linked casting candidate changed. Review and select its latest saved revision before preparing this task. Existing outputs remain available.',
    STUDIO_GENERATION_WRITING_CHANGED:'The linked writing changed. Open the latest saved screenplay, review the scene and prepare a new task before generation. Existing outputs remain available.',
    STUDIO_GENERATION_CONTEXT_CHANGED:'The linked scene, shot or frame changed. Review the inputs and prepare again.',
    STUDIO_GENERATION_PLAN_CHANGED:'The preparation changed. Check the current inputs before starting a new attempt.',
    HIGGSFIELD_LIVE_MODEL_CHANGED:'The model requirements changed. Check this model and prepare again.',
    HIGGSFIELD_REFERENCE_IDENTITY_CHANGED:'A selected production input changed at Higgsfield. Review its current identity and prepare a new cost review.',
    HIGGSFIELD_MARKETING_SELECTION_NOT_FOUND:'A selected production input is no longer listed in this workspace. Browse the current choices and revise the task.',
    HIGGSFIELD_MARKETING_SELECTION_NOT_READY:'A selected brand, product or presenter is still being prepared at Higgsfield. Review its status before generating.',
    HIGGSFIELD_MARKETING_BRAND_UNQUALIFIED:'Higgsfield did not return a verifiable brand record. Keep the draft and inspect the brand in the provider workspace.',
    HIGGSFIELD_MARKETING_FORMAT_DURATION:'The planned video length falls outside this format’s current range. Review the format and adjust the planned duration.',
    HIGGSFIELD_MARKETING_STYLE_SELECTION_REQUIRED:'Choose an artwork style before preparing promotional artwork.',
    HIGGSFIELD_MARKETING_FORMAT_SELECTION_REQUIRED:'Choose a video format before preparing a promotional video.',
    HIGGSFIELD_MARKETING_PRESENTER_SELECTION_REQUIRED:'Choose the presenter for this product video before preparing. The app will not choose a presenter for you.',
    HIGGSFIELD_MARKETING_SINGLE_IMAGE_REQUIRED:'Set model batch size to one. Separate take counts are supported; retaining multiple images inside one provider job is not qualified yet.',
    HIGGSFIELD_MARKETING_SETUP_MODE_CONFLICT:'The opening hook or filming setting is not supported by this video format. Remove it explicitly or choose a compatible format.',
    HIGGSFIELD_MARKETING_UNQUALIFIED_INPUT:'This task contains a provider asset or setting that the desktop runner cannot yet verify. Review its advanced settings.',
    HIGGSFIELD_SELECTED_VOICE_NOT_FOUND:'The chosen voice is not available in this Higgsfield workspace. Browse voices and choose the intended voice again.',
    HIGGSFIELD_SELECTED_VOICE_PAIR_REQUIRED:'Choose a voice from the voice browser before preparing speech.',
    HIGGSFIELD_VOICE_MODEL_UNSUPPORTED:'This model’s voice selection has not been qualified for the desktop runner. Keep this draft or explicitly choose a supported speech model.',
    HIGGSFIELD_ELEMENT_NOT_READY:'A selected character, prop or place is not ready at Higgsfield. Wait for it to complete or revise the task explicitly.',
    HIGGSFIELD_ELEMENT_MODEL_UNSUPPORTED:'This model does not support reusable character, prop or place markers. Choose a supported model or revise the prompt.',
    HIGGSFIELD_ELEMENT_MARKER_INVALID:'A reusable reference marker is incomplete or invalid. Choose the reference again from the browser.',
    HIGGSFIELD_AUDIO_FORMAT_NOT_RETAINABLE:'Choose WAV or MP3 for speech generation. This runner cannot yet retain the selected audio format.',
    HIGGSFIELD_AUDIO_SINGLE_SAMPLE_REQUIRED:'Prepare one speech take at a time. Set the model batch size to one before generation.',
    HIGGSFIELD_QUOTE_EXPIRED:'This estimate expired. Prepare again to review the current cost.',
    HIGGSFIELD_QUOTE_EXCEEDS_CEILING:'The estimated cost exceeds your credit ceiling. Review the cost before generating.',
    HIGGSFIELD_PAYMENT_CHOICE_REQUIRED:'Higgsfield requires a payment choice. Review credits or unlimited eligibility and prepare a new attempt.',
    HIGGSFIELD_ADJUSTMENTS_REQUIRE_REVIEW:'Higgsfield proposed different settings. Review and revise the task before generating.',
    HIGGSFIELD_RESULT_COUNT_CHANGED:'Higgsfield returned a different number of results than requested. Review the available takes.',
    HIGGSFIELD_RESULT_URL_MISSING:'A completed result has no download link yet. Check provider status to refresh it.',
    HIGGSFIELD_JOB_LOOKUP_UNRESOLVED:'The provider could not confirm this job lookup. Keep the existing attempt and check its status again.',
    STUDIO_GENERATION_RESTART_DURING_SUBMISSION:'The app restarted during submission. The provider may already have the job; this attempt will not be sent again.',
    STUDIO_GENERATION_PREPARATION_INTERRUPTED:'Preparation was interrupted. Its saved history remains available; no generation was submitted.',
  };
  return messages[code] ?? 'Higgsfield did not confirm this step. Review the saved job details and refresh its status before continuing.';
}
export function validCreditAmount(value: string): boolean { return /^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(value); }
export function creditCeilingCovers(ceiling: string, quote: string): boolean {
  if (!validCreditAmount(ceiling) || !validCreditAmount(quote)) return false;
  const units = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0')); };
  return units(ceiling) >= units(quote);
}
export function generationDetails(record: StudioGenerationRecord): GenerationDetails {
  const value: unknown = studioGenerationDetails(record.data.detailsJson);
  need(object(value) && bounded(value.title, 2000) && bounded(value.modelId, 200) && bounded(value.outputType, 100) && bounded(value.workspaceId, 200));
  need(value.workspaceName === null || bounded(value.workspaceName, 500));
  need(value.paymentChoice === 'CREDITS' || value.paymentChoice === 'UNLIMITED');
  need(value.quote === null || object(value.quote) && typeof value.quote.credits === 'string' && validCreditAmount(value.quote.credits) && Number.isSafeInteger(value.quote.observedAtMs) && Number(value.quote.observedAtMs) >= 0);
  need(Array.isArray(value.jobs) && value.jobs.length <= 1000 && value.jobs.every(row => object(row) && bounded(row.id, 200) && bounded(row.status, 100) && bounded(row.type, 100) && (row.resultUrl === undefined || bounded(row.resultUrl, 16384))));
  need(Array.isArray(value.outputs) && (value.error === null || bounded(value.error, 2000)));
  if(value.providerReferences!==undefined){
    need(object(value.providerReferences));const references=value.providerReferences;
    need(references.voice===null||object(references.voice)&&bounded(references.voice.voice_id,200)&&['preset','element'].includes(String(references.voice.voice_type))&&bounded(references.voice.name,500));
    need(Array.isArray(references.elements)&&references.elements.length<=16&&references.elements.every(row=>object(row)&&bounded(row.id,200)&&bounded(row.name,500)&&bounded(row.category,200)));
    if(references.marketing!==undefined)need(Array.isArray(references.marketing)&&references.marketing.length<=12&&references.marketing.every(row=>object(row)&&['brand','product','presenter','hook','setting','style','format'].includes(String(row.kind))&&bounded(row.id,200)&&bounded(row.name,500))&&new Set(references.marketing.map(row=>`${row.kind}:${row.id}`)).size===references.marketing.length);
  }
  return value as unknown as GenerationDetails;
}
function scopeMatches(value: unknown, scope: GenerationScope) { need(object(value) && value.projectId === scope.projectId && value.sourceHash === scope.sourceHash); }
async function validated(value: unknown, scope: GenerationScope): Promise<StudioGenerationRecord> {
  const record = await validateRecord(value);
  need(record.kind === 'studio-generation'); scopeMatches(record.data, scope);
  const result = record as StudioGenerationRecord; generationDetails(result); return result;
}
async function request(route: string, input?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/studio/generations${route}`, { credentials: 'same-origin', redirect: 'error', signal, ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}) });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw Error(object(value) && typeof value.error === 'string' ? generationMessage(value.error) : 'The app did not confirm this request. Refresh local status before retrying; do not duplicate a submission.');
  return value;
}
async function update(route: string, scope: GenerationScope, record: StudioGenerationRecord, extra: object = {}) {
  const captured = structuredClone(record), expectedScope = { ...scope };
  const input = { jobId: captured.id, ...(route === '/submit' ? { expectedVersion: captured.version, ...extra } : {}) };
  const result = await validated(await request(route, input), expectedScope);
  need(result.id === captured.id && canonicalJson(result.data.operationRef) === canonicalJson(captured.data.operationRef) && result.version >= captured.version);
  if (result.version === captured.version) need(result.sha256 === captured.sha256);
  return result;
}
export const studioGenerationApi: StudioGenerationApi = {
  async list(scope, signal) {
    const expected = { ...scope }, value = await request('', undefined, signal); scopeMatches(value, expected);
    need(object(value) && Array.isArray(value.records) && value.records.length <= 10000);
    const records = await Promise.all(value.records.map(row => validated(row, expected)));
    need(new Set(records.map(row => row.id)).size === records.length); return records;
  },
  async workspaces(scope, signal) {
    const expected = { ...scope }, value = await request('/workspaces', undefined, signal); scopeMatches(value, expected);
    need(object(value) && Array.isArray(value.workspaces) && value.workspaces.length <= 1000);
    need(value.workspaces.every(row => object(row) && bounded(row.id, 200) && Boolean(row.id) && (row.name === null || bounded(row.name, 500)) && typeof row.is_selected === 'boolean' && (row.plan_type === undefined || row.plan_type === null || bounded(row.plan_type, 200))));
    need(new Set(value.workspaces.map(row => row.id)).size === value.workspaces.length); return value.workspaces as GenerationWorkspace[];
  },
  async prepare(scope, input) {
    const captured = structuredClone(input), expected = { ...scope };
    const record = await validated(await request('/prepare', captured), expected);
    need(record.id === captured.jobId && canonicalJson(record.data.operationRef) === canonicalJson(captured.operationRef));
    const details = generationDetails(record); need(details.workspaceId === captured.workspaceId && details.paymentChoice === captured.paymentChoice); return record;
  },
  submit: (scope, record, maximumCredits) => { need(validCreditAmount(maximumCredits)); return update('/submit', scope, record, { maximumCredits }); },
  poll: (scope, record) => update('/poll', scope, record),
  retain: (scope, record) => update('/retain', scope, record),
};
