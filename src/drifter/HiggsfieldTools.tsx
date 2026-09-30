import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, FileJson, Search } from 'lucide-react';
import { blobUrl, workspaceApi as localWorkspaceApi } from './api';
import { canonicalJson } from './canonical';
import { loadStudioOperations, type StudioOperation, type StudioOperationRecord, type StudioOperationTarget, type StudioWritingRef, type StudioCastingRef } from './studioOperationApi';
import AssetPicker from './AssetPicker';
import StandaloneMediaPicker from './StandaloneMediaPicker';
import { downloadLocalBlob } from './localDownload';
import { studioMediaActions, validateStudioOperationRequest, type StudioOperationRequest } from './studioOperationRequest';
import { projectLibraryApi } from './projectLibraryApi';
import { projectFileEntries, type ProjectFileEntry } from './projectLibraryModel';
import { higgsfieldRequestJson, higgsfieldToolsApi, type HiggsfieldCatalogModel, type HiggsfieldComposeInput, type HiggsfieldComposeResult, type HiggsfieldMediaRole, type HiggsfieldModelParameter, type HiggsfieldPlannedMedia, type HiggsfieldToolsApi, type HiggsfieldToolsCatalog, type HiggsfieldValue } from './higgsfieldToolsApi';
import type { GenerationBrief, Project, CreativeProject, WorkspaceProject, WorkspaceApi, WorkspaceRecord, CastingDraft } from './types';
import LiveModelRequirements from './LiveModelRequirements';
import StudioGenerationPanel from './StudioGenerationPanel';
import { useWritingOrigin } from './useWritingOrigin';
import { useCastingOrigin } from './useCastingOrigin';
import { operationReadiness } from './studioOperationReadiness';
import StudioReferencePanel from './StudioReferencePanel';
import ProviderReferencePicker from './ProviderReferencePicker';
import MarketingInputPicker, { type MarketingInputKind, type MarketingInputChoice } from './MarketingInputPicker';
import './higgsfield-tools.css';

const GROUPS = [{ id: 'frames', title: 'Frames & artwork' }, { id: 'cast', title: 'Casting & references' }, { id: 'video', title: 'Video & editing' }, { id: 'voice', title: 'Voice & sound' }, { id: 'sets', title: 'Sets & cameras' }, { id: 'review', title: 'Review & results' }, { id: 'marketing', title: 'Promotion & brands' }, { id: 'connections', title: 'Connections & planning' }];
const SOURCE_VIDEO_MODELS = ['topaz_video', 'video_upscale', 'video_deflicker', 'video_background_remover', 'sync_so'];
const COMPOSE_TASKS = ['generate_image', 'generate_video', 'generate_audio'];
const ELEMENT_MODELS = ['nano_banana_pro','nano_banana_2','gpt_image_2','seedream_v4_5','seedream_v5_lite','cinematic_studio_2_5','kling3_0','cinematic_studio_3_0','cinematic_studio_video_v2','seedance_2_0'];
const MARKETING_FIELDS: Record<MarketingInputKind,string> = { brand:'brand_kit_id',product:'product_ids',presenter:'avatar_ids',hook:'hook_id',setting:'setting_id',style:'style_id',format:'mode' };
const MARKETING_LABELS: Record<MarketingInputKind,string> = { brand:'Brand identity',product:'Featured products',presenter:'Presenter',hook:'Opening hook',setting:'Filming setting',style:'Artwork style',format:'Video format' };
const MARKETING_GUIDES: Record<string,MarketingInputKind> = { marketing_list_brand_kits:'brand',marketing_get_brand_kit:'brand',marketing_list_products:'product',marketing_list_avatars:'presenter',marketing_list_hooks:'hook',marketing_list_settings:'setting',marketing_list_ad_formats:'style',marketing_list_video_presets:'format' };
const HOOK_FORMATS = ['ugc','ugc_how_to','ugc_unboxing','ugc_virtual_try_on'];
const GROUP_START: Record<string,string> = { frames: 'generate_image', cast: 'show_reference_elements', video: 'generate_video', voice: 'generate_audio', sets: 'scene_builder_3d_create_project', review: 'video_analysis_create', marketing: 'marketing_create_brand_kit', connections: 'models_recommend' };
function isCreativeProject(project: WorkspaceProject): project is CreativeProject { return 'profile' in project && project.profile === 'caniscreenwrite-creative/v1' && project.sourceHash === null; }
const human = (name: string) => name.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const roleName = (role: string) => ({ image: 'Reference image', start_image: 'Opening frame', end_image: 'Ending frame', video: 'Driving / source video', audio: 'Audio reference' })[role] ?? human(role);
const errorText = (e: unknown) => e instanceof Error ? e.message.replace(/^HIGGSFIELD_/, '').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : 'The local request could not be prepared.';
const roleAliases: Record<string, HiggsfieldMediaRole> = { image: 'image', image_references: 'image', start_image: 'start_image', end_image: 'end_image', video: 'video', input_video: 'video', video_references: 'video', audio: 'audio', input_audio: 'audio', audio_references: 'audio' };
function ConciseCopy({ text, label, limit = 160 }: { text: string; label: string; limit?: number }) {
  if (text.length <= limit) return <p>{text}</p>;
  const end = text.lastIndexOf(' ', limit);
  return <div className="hf-concise-copy"><p>{text.slice(0, end > limit / 2 ? end : limit)}…</p><details><summary>{label}</summary><p>{text}</p></details></div>;
}
function rolesFor(model: HiggsfieldCatalogModel) { return [...new Set(model.medias.flatMap(row => row.roles ?? []).flatMap(role => roleAliases[role] ? [roleAliases[role]] : []))]; }
function initialSettings(model: HiggsfieldCatalogModel) {
  const values: Record<string, HiggsfieldValue> = {};
  for (const parameter of model.parameters) if (parameter.default !== undefined && parameter.default !== null && !(model.id === 'seedance_2_5' && parameter.name === 'extension_mode') && !(model.id === 'sync_so' && parameter.name === 'sync_mode') && !(SOURCE_VIDEO_MODELS.includes(model.id) && parameter.name === 'duration')) values[parameter.name] = parameter.default;
  if (model.output_type === 'image' || model.output_type === 'video') values.count = 1;
  return values;
}
function parametersFor(model: HiggsfieldCatalogModel, values?: Record<string, HiggsfieldValue>): HiggsfieldModelParameter[] {
  const result = model.parameters.map(parameter => (model.id === 'sync_so' && parameter.name === 'sync_mode' || model.id === 'marketing_studio_video' && parameter.name === 'mode') ? { ...parameter, required: 'required' as const } : parameter);
  if (model.output_type === 'video' && !result.some(p => p.name === 'duration') && (model.duration_range || model.durations?.length)) result.unshift({ name: 'duration', type: 'number', required: 'optional', description: 'Planned output length in seconds.', ...(model.duration_range ? model.duration_range : {}), ...(model.durations?.length ? { options: model.durations } : {}) });
  return result.filter(parameter => !(SOURCE_VIDEO_MODELS.includes(model.id) && parameter.name === 'duration') && !(model.id === 'topaz_video' && ['enhancement','frame_interpolation'].includes(parameter.name))).filter(parameter => model.id !== 'seedance_2_5' || !values || (parameter.name !== 'extension_mode' || values.mode === 'video_extension') && (parameter.name !== 'duration' || values.mode !== 'video_edit'));
}
function settingErrors(model: HiggsfieldCatalogModel, values: Record<string, HiggsfieldValue>) {
  const errors: string[] = [];
  for (const parameter of parametersFor(model, values)) {
    const value = values[parameter.name];
    if (value === undefined || value === null || value === '') {
      if (parameter.required === 'required' || (parameter.type === 'number' && value === '')) errors.push(`${human(parameter.name)} needs a value.`);
      continue;
    }
    const whole = ['duration', 'count', 'batch_size'].includes(parameter.name);
    if (parameter.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || (whole && !Number.isSafeInteger(value)) || (parameter.min !== undefined && Number(value) < parameter.min) || (parameter.max !== undefined && Number(value) > parameter.max))) errors.push(`${human(parameter.name)} must be ${whole ? 'a whole number' : 'a number'}${parameter.min !== undefined ? ` from ${parameter.min}` : ''}${parameter.max !== undefined ? ` to ${parameter.max}` : ''}.`);
    if (parameter.options && !parameter.options.includes(value as string | number)) errors.push(`Choose a listed ${human(parameter.name).toLowerCase()}.`);
  }
  return errors;
}
type Draft = { modelId: string; prompt: string; settings: Record<string, Record<string, HiggsfieldValue>>; medias: HiggsfieldPlannedMedia[]; detached?: boolean; title?: string; toolSettings?: string; target?: StudioOperationTarget; writingRef?: StudioWritingRef; castingRef?: StudioCastingRef };
const emptyDraft = (): Draft => ({ modelId: '', prompt: '', settings: {}, medias: [] });
type Props = { onDirty?: (value: boolean) => void; operationRequest?: StudioOperationRequest; open: boolean; record?: WorkspaceRecord | null; disabledReason?: string; project?: WorkspaceProject; toolsApi?: HiggsfieldToolsApi; onOpenDcc?: () => void; onOpenWriting?: () => void; onOpenBudget?: (targetId?: string) => void; workspaceApi?: WorkspaceApi; records?: WorkspaceRecord[]; onSaved?: (record: WorkspaceRecord) => void };

function ReferenceChooser({ project, roles, onChoose, disabled }: { disabled?: boolean; project: Project; roles: HiggsfieldMediaRole[]; onChoose: (row: HiggsfieldPlannedMedia) => void }) {
  const [rows, setRows] = useState<ProjectFileEntry[]>([]), [query, setQuery] = useState(''), [role, setRole] = useState<HiggsfieldMediaRole>(roles[0] ?? 'image'), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const prefix = role === 'video' ? 'video/' : role === 'audio' ? 'audio/' : 'image/';
  useEffect(() => {
    setError('');
    if (prefix === 'image/') { setLoading(false); return; }
    setLoading(true);
    const controller = new AbortController(); let live = true;
    projectLibraryApi.load(project, controller.signal).then(catalog => { if (live) setRows(projectFileEntries(catalog, [], project.sourceHash, project.id, project)); }).catch(e => { if (live) setError(errorText(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [project, prefix]);
  const filtered = rows.filter(row => row.asset && row.mimeType.startsWith(prefix) && `${row.title} ${row.filename}`.toLowerCase().includes(query.toLowerCase()));
  return <fieldset disabled={disabled} className="hf-reference-chooser">
    <div className="hf-reference-filters"><label>Use as<select aria-label="Reference role" value={role} onChange={e => setRole(e.target.value as HiggsfieldMediaRole)}>{roles.map(value => <option key={value} value={value}>{roleName(value)}</option>)}</select></label>{prefix !== 'image/' && <label>Find a retained file<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Shot or filename…"/></label>}</div>
    {loading && <p role="status">Reading project assets…</p>}{error && <p role="alert">{error}</p>}
    {prefix === 'image/' ? <AssetPicker project={project} label="Choose a project image" onSelect={selection => onChoose({ role, sha256: selection.imageHash, label: selection.title, mimeType: selection.mimeType })}/> : <div className="hf-reference-results">{filtered.slice(0, 24).map(row => <button type="button" key={row.id} onClick={() => onChoose({ role, sha256: row.sha256, label: row.title, mimeType: row.mimeType })}><span>{row.title}<small>{row.filename}</small></span><ArrowRight size={14}/></button>)}</div>}
    {prefix !== 'image/' && !loading && !error && !filtered.length && <p>No retained {role === 'video' ? 'video' : 'audio'} files match. Import supplied material through the project Library first.</p>}
    {prefix !== 'image/' && filtered.length > 24 && <small>{filtered.length} matches. Narrow the search to find another file.</small>}
  </fieldset>;
}

export default function HiggsfieldTools({ open, operationRequest, record = null, disabledReason = '', project, toolsApi = higgsfieldToolsApi, workspaceApi = localWorkspaceApi, records = [], onSaved, onOpenDcc, onOpenWriting, onOpenBudget, onDirty }: Props) {
  const [catalog, setCatalog] = useState<HiggsfieldToolsCatalog | null>(null), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0), [loading, setLoading] = useState(false);
  const [group, setGroup] = useState(record ? 'video' : 'frames'), [query, setQuery] = useState(''), [modelQuery, setModelQuery] = useState(''), [limit, setLimit] = useState(12);
  const [selection, setSelection] = useState<Record<string, string>>({}), [drafts, setDrafts] = useState<Record<string, Draft>>({}), [referencePicker, setReferencePicker] = useState(false);
  const [referenceModes, setReferenceModes] = useState<Record<string, 'browse' | 'create'>>({});
  const [marketingKind, setMarketingKind] = useState<MarketingInputKind>('style'), [marketingNames, setMarketingNames] = useState<Record<string,string>>({});
  const [result, setResult] = useState<{ key: string; value: HiggsfieldComposeResult } | null>(null), [busyKey, setBusyKey] = useState(''), [failure, setFailure] = useState<{ key: string; message: string } | null>(null), [notice, setNotice] = useState('');
  const [operationRecords, setOperationRecords] = useState<StudioOperationRecord[]>([]), [baselines, setBaselines] = useState<Record<string, StudioOperationRecord>>({}), [savedDrafts, setSavedDrafts] = useState<Record<string,string>>({}), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(''), [pendingOpen, setPendingOpen] = useState<StudioOperationRecord | null>(null);
  const [pendingRequest, setPendingRequest] = useState<{ request: StudioOperationRequest; baseScope: string } | null>(null), [requestError, setRequestError] = useState('');
  const handledRequests = useRef(new Map<string, string>());
  const headingId = useId(), sequence = useRef(0), alive = useRef(true), attempts = useRef<Record<string, { fingerprint: string; id: string; requestId: string }>>({});
  const baseScope = `${project?.id ?? 'free'}:${project?.sourceHash ?? 'draft'}:${record ? `${record.id}:${record.sha256}` : 'standalone'}`;
  const baseScopeRef = useRef(baseScope); baseScopeRef.current = baseScope;
  const taskId = selection[baseScope] ?? (record ? 'generate_video' : 'generate_image');
  const referenceMode = referenceModes[baseScope] ?? 'browse', referenceCreation = taskId === 'show_reference_elements' && referenceMode === 'create';
  const scope = `${baseScope}:${taskId}${taskId === 'show_reference_elements' ? ':' + referenceMode : ''}`, draft = drafts[scope] ?? emptyDraft(), brief = record?.data as GenerationBrief | undefined;
  const writingOrigin = useWritingOrigin({ reference: draft.writingRef, project, records, api: workspaceApi, open });
  const castingOrigin = useCastingOrigin({ reference: draft.castingRef, project, records, api: workspaceApi, open });
  const castingChoices = project?.sourceHash ? records.filter(row => row.kind === 'casting-draft' && (row.data as CastingDraft).sourceHash === project.sourceHash && (project as Project).characters.some(character => character.id === (row.data as CastingDraft).characterId)) : [];
  const action = catalog?.actions.find(row => row.id === taskId), composable = COMPOSE_TASKS.includes(taskId), modelDiscovery = taskId.startsWith('models_');
  const useBrief = Boolean(record && !draft.detached && !referenceCreation), prompt = useBrief ? (typeof brief?.prompt === 'string' ? brief.prompt : '') : draft.prompt;
  const selectedId = draft.modelId || action?.modelIds.find(id => catalog?.composerModelIds.includes(id)) || action?.modelIds[0] || '';
  const selected = catalog?.models.find(model => model.id === selectedId), supported = Boolean(composable && selected && catalog?.composerModelIds.includes(selected.id));
  const values = selected ? (draft.settings[selected.id] ?? { ...initialSettings(selected), ...(useBrief && selected.id === 'seedance_2_5' ? { mode: 'omni_reference' } : {}) }) : {};
  const marketingModel = composable && ['ms_image','marketing_studio_video'].includes(selectedId);
  const marketingKinds: MarketingInputKind[] = marketingModel ? selectedId === 'ms_image' ? ['style','brand','product'] : ['format','product','presenter',...(HOOK_FORMATS.includes(String(values.mode)) ? ['hook','setting'] as MarketingInputKind[] : [])] : MARKETING_GUIDES[taskId] ? [MARKETING_GUIDES[taskId]] : [];
  const activeMarketingKind = marketingKinds.includes(marketingKind) ? marketingKind : marketingKinds[0];
  const recordProblem = disabledReason || (project?.sourceHash === null && record ? 'A standalone creative task cannot inherit a screenplay clip binding.' : '') || (useBrief && (record?.kind !== 'generation-brief' || !prompt.trim()) ? 'Open a saved clip with a nonempty prompt before preparing its call.' : '');
  const key = JSON.stringify({ scope, open, selectedId, prompt, values, medias: draft.medias, snapshot: catalog?.snapshot.catalogSha256, recordProblem, useBrief });
  const currentKey = useRef(key); if (currentKey.current !== key) { currentKey.current = key; sequence.current++; }
  const current = result?.key === key ? result.value : null, busy = busyKey === key;
  const errors = selected && composable ? settingErrors(selected, values) : [];
  const visibleActions = catalog?.actions.filter(row => (query ? true : row.group === group) && `${row.title} ${row.purpose} ${row.inputs.join(' ')} ${row.toolSuffix}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const modelOptions = catalog?.models.filter(model => (modelDiscovery || model.output_type === ({ generate_image: 'image', generate_video: 'video', generate_audio: 'audio' } as Record<string,string>)[taskId]) && `${model.name} ${model.id} ${model.description} ${model.provider_name}`.toLowerCase().includes(modelQuery.toLowerCase())) ?? [];
  const presets = catalog?.modelPresets.filter(row => row.taskId === taskId) ?? [];
  const pendingChecks = current?.checks.filter(row => row.status !== 'PASS') ?? [];
  const knownOperations = [...new Map([...records.filter(row => row.kind === 'studio-operation') as StudioOperationRecord[], ...operationRecords].filter(row => row.data.schemaVersion === 2 ? project?.sourceHash === null && row.data.projectId === project.id : project?.sourceHash !== null && row.data.sourceHash === project?.sourceHash).sort((a,b) => a.version - b.version).map(row => [row.id, row])).values()];
  let operationData: StudioOperation | null = null, operationError = '';
  let operationDetails: Record<string,unknown> = {};
  try {
    const toolData = JSON.parse(draft.toolSettings || (referenceCreation ? '{"action":"create","category":"auto"}' : '{}'));
    if (!toolData || typeof toolData !== 'object' || Array.isArray(toolData)) throw new Error('Expected object');
    operationDetails = toolData;
    const settingsJson = composable ? higgsfieldRequestJson(values) : higgsfieldRequestJson(toolData);
    if (project && catalog && action) {
      const common = { title: draft.title ?? action.title, taskId, modelId: composable ? selectedId : '', prompt, settingsJson, medias: useBrief ? [] : draft.medias, catalogSha256: catalog.snapshot.catalogSha256, status: 'DRAFT' as const, ...(draft.writingRef ? { writingRef: draft.writingRef } : {}), ...(draft.castingRef ? { castingRef: draft.castingRef } : {}) };
      operationData = project.sourceHash === null ? { ...common, schemaVersion: 2, projectId: project.id, sourceHash: null, target: { kind: 'PROJECT' }, briefRef: null } : { ...common, schemaVersion: 1, sourceHash: project.sourceHash,
        target: useBrief && brief?.sceneId ? brief.shotIds?.length === 1 ? { kind: 'SHOT', sceneId: brief.sceneId, shotId: brief.shotIds[0] } : { kind: 'SCENE', sceneId: brief.sceneId } : draft.target ?? { kind: 'PROJECT' },
        briefRef: useBrief && record ? { id: record.id, sha256: record.sha256 } : null };
    }
  } catch { operationError = 'Additional operation data must be a JSON object.'; }
  const referenceErrors = referenceCreation ? [
    ...(Object.keys(operationDetails).some(key => !['action','name','category'].includes(key)) || operationDetails.action !== 'create' ? ['Reference creation settings must contain only action, name and category.'] : []),
    ...(operationDetails.name !== undefined && (typeof operationDetails.name !== 'string' || !operationDetails.name.trim() || operationDetails.name.length > 32 || Array.from(operationDetails.name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) ? ['Use a reference name of 1–32 characters, or leave it blank.'] : []),
    ...(operationDetails.category !== undefined && !['auto','character','environment','prop'].includes(String(operationDetails.category)) ? ['Choose a listed reference category.'] : []),
    ...(prompt.length > 16000 ? ['Reference descriptions are limited to 16,000 characters.'] : []),
    ...(draft.medias.length < 1 || draft.medias.length > 8 || draft.medias.some(row => row.role !== 'image' || !['image/png','image/jpeg','image/webp'].includes(row.mimeType)) || new Set(draft.medias.map(row => row.sha256)).size !== draft.medias.length ? ['Choose 1–8 different original PNG, JPEG or WebP images. Video, audio and cropped-frame roles cannot create this reference.'] : []),
  ] : [];
  const operationPreflight = operationReadiness(taskId, operationDetails, draft.medias);
  const baseline = baselines[scope];
  const currentDirty = baseline ? Boolean(operationData && canonicalJson(operationData) !== canonicalJson(baseline.data)) : Boolean(drafts[scope] && (draft.prompt || draft.title || draft.toolSettings || draft.medias.length || Object.keys(draft.settings).length));
  function hasUnsavedDraft(destination: string) {
    const row = drafts[destination];
    return Boolean(row && (savedDrafts[destination] ? higgsfieldRequestJson(row) !== savedDrafts[destination] : Boolean(row.prompt || row.title || row.toolSettings || row.medias.length || Object.keys(row.settings).length)));
  }
  const hasDraft = currentDirty || Object.keys(drafts).some(id => id !== scope && hasUnsavedDraft(id));
  useEffect(() => { onDirty?.(hasDraft); }, [hasDraft, onDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let live = true; setLoading(true); setLoadError('');
    toolsApi.load(controller.signal).then(value => { if (live) setCatalog(value); }).catch(e => { if (live) setLoadError(errorText(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [open, reload, toolsApi]);
  useEffect(() => {
    if (!open || !project) return;
    const controller = new AbortController(); let live = true;
    loadStudioOperations(project, controller.signal).then(rows => { if (live) setOperationRecords(rows); }).catch(error => { if (live) setSaveError(errorText(error)); });
    return () => { live = false; controller.abort(); };
  }, [open, project]);
  function applyOperationRequest(request: StudioOperationRequest) {
    if (!project || !catalog || saving || busy) return;
    try {
      const checked = validateStudioOperationRequest(request, project, catalog);
      const task = catalog.actions.find(row => row.id === checked.taskId)!;
      const modelId = checked.modelId ?? task.modelIds.find(id => catalog.composerModelIds.includes(id)) ?? '';
      const model = catalog.models.find(row => row.id === modelId);
      const settings = { ...(model ? initialSettings(model) : {}), ...(checked.settings ?? {}) };
      if (modelId === 'seedance_2_5') {
        if (settings.mode !== 'video_extension') delete settings.extension_mode;
        if (settings.mode === 'video_edit') delete settings.duration;
        if (settings.mode === 'video_edit' || settings.mode === 'video_extension') delete settings.aspect_ratio;
      }
      const nextScope = `${baseScope}:${checked.taskId}`;
      // A contextual asset starts a separate task; an existing clip stays frozen.
      const next: Draft = { modelId, title: checked.title ?? task.title, prompt: checked.prompt ?? '',
        medias: checked.medias, target: checked.target, ...(checked.writingRef ? { writingRef: checked.writingRef } : {}), ...(checked.castingRef ? { castingRef: checked.castingRef } : {}), detached: true, settings: modelId ? { [modelId]: settings } : {} };
      setDrafts(old => ({ ...old, [nextScope]: next }));
      setBaselines(old => { const value = { ...old }; delete value[nextScope]; return value; });
      setSavedDrafts(old => { const value = { ...old }; delete value[nextScope]; return value; });
      delete attempts.current[nextScope]; setPendingOpen(null); setPendingRequest(null); setRequestError('');
      setSelection(old => ({ ...old, [baseScope]: checked.taskId })); setGroup(task.group); setQuery(''); setModelQuery('');
      setReferencePicker(false); setResult(null); setSaveError('');
      setNotice(`Selected assets opened as a separate preparation draft. Originals${record ? ' and the saved clip' : ''} remain unchanged.`);
    } catch (error) { setRequestError(errorText(error)); setPendingRequest(null); }
  }
  function receiveOperationRequest(incoming: StudioOperationRequest) {
    if (!open || !project || !catalog || loading || disabledReason || saving || busy) return;
    const requestId = `${project.id}:${project.sourceHash ?? 'no-source'}:${incoming.nonce}`;
    let fingerprint: string;
    try { fingerprint = higgsfieldRequestJson(Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined))); }
    catch { setRequestError('The task selection could not be read.'); return; }
    const previous = handledRequests.current.get(requestId);
    if (previous !== undefined) { if (previous !== fingerprint) { setPendingRequest(null); setRequestError('A previously handled task selection changed. Choose the asset again.'); } return; }
    handledRequests.current.set(requestId, fingerprint);
    setPendingRequest(null); setPendingOpen(null);
    try {
      const checked = validateStudioOperationRequest(incoming, project, catalog);
      const destination = `${baseScope}:${checked.taskId}`;
      setRequestError('');
      if (currentDirty || hasUnsavedDraft(destination)) setPendingRequest({ request: checked, baseScope });
      else applyOperationRequest(checked);
    } catch (error) { setRequestError(errorText(error)); }
  }
  useEffect(() => {
    if (operationRequest) receiveOperationRequest(operationRequest);
    // Every nonce is handled once; field edits after acceptance never replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, operationRequest, project, catalog, loading, disabledReason, saving, busy, baseScope]);
  function update(change: (current: Draft) => Draft) { setDrafts(old => ({ ...old, [scope]: change(old[scope] ?? emptyDraft()) })); setNotice(''); setSaveError(''); }
  function chooseAction(id: string) { if (saving) return; if (id === 'show_reference_elements' && draft.target) { const destination = `${baseScope}:${id}:${referenceModes[baseScope] ?? 'browse'}`; setDrafts(old => old[destination] ? old : { ...old, [destination]: { ...emptyDraft(), target: structuredClone(draft.target) } }); } setSelection(old => ({ ...old, [baseScope]: id })); const next = catalog?.actions.find(row => row.id === id); if (next) setGroup(next.group); setModelQuery(''); setReferencePicker(false); setNotice(''); setSaveError(''); }
  function chooseGroup(id: string) { setGroup(id); setQuery(''); const first = catalog?.actions.find(row => row.id === GROUP_START[id]) ?? catalog?.actions.find(row => row.group === id); if (first) chooseAction(first.id); }
  function chooseModel(id: string) { if (modelDiscovery && operationError) { setSaveError(operationError); return; } update(row => ({ ...row, modelId: id, ...(modelDiscovery ? { toolSettings: higgsfieldRequestJson({ ...operationDetails, requestedModel: id }) } : {}) })); setReferencePicker(false); }
  function chooseReferenceMode(mode: 'browse' | 'create') {
    if (saving || disabledReason) return;
    if (mode === 'create') {
      const target: StudioOperationTarget = draft.target ?? (useBrief && brief?.sceneId ? brief.shotIds?.length === 1 ? { kind: 'SHOT', sceneId: brief.sceneId, shotId: brief.shotIds[0] } : { kind: 'SCENE', sceneId: brief.sceneId } : { kind: 'PROJECT' });
      const destination = `${baseScope}:show_reference_elements:create`;
      // Separate mode drafts preserve browsing notes and never inherit clip dialogue.
      setDrafts(old => old[destination] ? old : { ...old, [destination]: { ...emptyDraft(), detached: true, target, ...(draft.castingRef ? { castingRef: draft.castingRef } : {}), toolSettings: higgsfieldRequestJson({ action: 'create', category: 'auto' }) } });
    }
    setReferenceModes(old => ({ ...old, [baseScope]: mode })); setReferencePicker(false); setSaveError(''); setNotice('');
  }
  function chooseReferenceName(name: string) {
    const next = { ...operationDetails }; if (name) next.name = name; else delete next.name;
    update(row => ({ ...row, toolSettings: higgsfieldRequestJson(next) }));
  }
  function addReference(row: HiggsfieldPlannedMedia) {
    if (referenceCreation && (row.role !== 'image' || !['image/png','image/jpeg','image/webp'].includes(row.mimeType) || draft.medias.length >= 8 && !draft.medias.some(media => media.sha256 === row.sha256))) { setNotice('Choose up to eight different original PNG, JPEG or WebP images.'); return; }
    update(value => ({ ...value, medias: [...value.medias.filter(existing => existing.sha256 !== row.sha256 || existing.role !== row.role), row] })); setReferencePicker(false);
  }
  function choosePlanningData(value: Record<string,unknown>) { if (operationError) { setSaveError(operationError); return; } update(row => ({ ...row, toolSettings: higgsfieldRequestJson({ ...operationDetails, ...value }) })); }
  function changeSetting(name: string, value: HiggsfieldValue) {
    if (!selected) return;
    const settings = { ...values, [name]: value };
    if (selected.id === 'seedance_2_5' && name === 'mode') { if (value !== 'video_extension') delete settings.extension_mode; if (value === 'video_edit') delete settings.duration; if (value === 'video_edit' || value === 'video_extension') delete settings.aspect_ratio; }
    update(row => ({ ...row, settings: { ...row.settings, [selected.id]: settings } }));
  }
  function marketingIds(kind: MarketingInputKind): string[] {
    const input = composable ? values : operationDetails, value = input[MARKETING_FIELDS[kind]] ?? (!composable && kind === 'format' ? input.format : !composable && kind === 'style' ? input.adStyle : undefined);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && Boolean(id)) : typeof value === 'string' && value ? [value] : [];
  }
  function setMarketingIds(kind: MarketingInputKind, ids: string[]) {
    if (saving || recordProblem || (!composable && operationError)) return;
    const field = MARKETING_FIELDS[kind], next = { ...(composable ? values : operationDetails) };
    if (!composable && kind === 'format') delete next.format;
    if (!composable && kind === 'style') delete next.adStyle;
    if (ids.length) next[field] = ['product','presenter'].includes(kind) ? ids : ids[0]; else delete next[field];
    if (composable && selected) update(row => ({ ...row, settings: { ...row.settings, [selected.id]: next as Record<string,HiggsfieldValue> } }));
    else update(row => ({ ...row, toolSettings: higgsfieldRequestJson(next) }));
  }
  function chooseMarketing(item: MarketingInputChoice) {
    if (!marketingKinds.includes(item.kind) || saving || recordProblem || (!composable && operationError)) return;
    const ids = marketingIds(item.kind);
    if (item.kind === 'product' && !ids.includes(item.id) && ids.length >= 4) { setNotice('Choose up to four featured products. Remove a current product before adding another.'); return; }
    setMarketingIds(item.kind, item.kind === 'product' ? [...new Set([...ids,item.id])] : [item.id]);
    setMarketingNames(old => ({ ...old, [JSON.stringify([scope,selectedId,item.kind,item.id])]:item.name }));
    setNotice(`Selected ${item.name}. Save the task to retain this choice; its identity is checked again during cost review.`);
  }
  function chooseVoice(voice: {voice_id:string;voice_type:'preset'|'element';name:string}) {
    if(saving||recordProblem)return;
    if(composable&&selected)update(row=>({...row,settings:{...row.settings,[selected.id]:{...values,voice_id:voice.voice_id,voice_type:voice.voice_type}}}));
    else choosePlanningData({voice_id:voice.voice_id,voice_type:voice.voice_type,voiceName:voice.name});
    setNotice(`Selected ${voice.name}. Save this task to retain the voice choice; generation rechecks it in the chosen workspace.`);
  }
  function chooseElement(element:{id:string;name:string;category:string}) {
    if(saving||recordProblem||useBrief)return;
    if(composable){
      if(!selected||!ELEMENT_MODELS.includes(selected.id))return;
      const marker=`<<<${element.id}>>>`;
      if(!prompt.includes(marker))update(row=>({...row,prompt:`${prompt}${prompt&&!/\s$/.test(prompt)?'\n':''}${marker}`}));
    }else choosePlanningData({element_id:element.id,elementName:element.name,elementCategory:element.category});
    setNotice(`Selected ${element.name}. Its exact reference is retained in this draft; saving does not approve its use.`);
  }
  function clear() { setDrafts(old => { const next = { ...old }; delete next[scope]; return next; }); setBaselines(old => { const next = { ...old }; delete next[scope]; return next; }); setSavedDrafts(old => { const next = { ...old }; delete next[scope]; return next; }); delete attempts.current[scope]; setResult(null); setNotice('Draft inputs cleared. Saved operations and source remain unchanged.'); }
  function requestOpenOperation(saved: StudioOperationRecord) {
    const mode = JSON.parse(saved.data.settingsJson).action === 'create' ? 'create' : 'browse';
    const destination = `${baseScope}:${saved.data.taskId}${saved.data.taskId === 'show_reference_elements' ? ':' + mode : ''}`;
    if (currentDirty || hasUnsavedDraft(destination)) setPendingOpen(saved);
    else openOperation(saved);
  }
  function openOperation(saved: StudioOperationRecord) {
    const data = saved.data;
    if (data.briefRef && (!record || data.briefRef.id !== record.id || data.briefRef.sha256 !== record.sha256)) { setSaveError('Open this operation from its exact saved clip to retain the frozen prompt and reference binding.'); return; }
    const settings = JSON.parse(data.settingsJson) as Record<string, HiggsfieldValue>;
    const mode = settings.action === 'create' ? 'create' : 'browse';
    const nextScope = `${baseScope}:${data.taskId}${data.taskId === 'show_reference_elements' ? ':' + mode : ''}`;
    if (data.taskId === 'show_reference_elements') setReferenceModes(old => ({ ...old, [baseScope]: mode }));
    const reopened: Draft = { modelId: data.modelId || (data.taskId.startsWith('models_') && typeof settings.requestedModel === 'string' ? settings.requestedModel : ''), title: data.title, prompt: data.prompt, settings: data.modelId ? { [data.modelId]: settings } : {}, toolSettings: data.settingsJson, medias: structuredClone(data.medias), detached: !data.briefRef, target: structuredClone(data.target), ...(data.writingRef ? { writingRef: structuredClone(data.writingRef) } : {}), ...(data.castingRef ? { castingRef: structuredClone(data.castingRef) } : {}) };
    setDrafts(old => ({ ...old, [nextScope]: reopened })); setSavedDrafts(old => ({ ...old, [nextScope]: higgsfieldRequestJson(reopened) }));
    setBaselines(old => ({ ...old, [nextScope]: saved })); chooseAction(data.taskId); setPendingOpen(null); setNotice(`Opened saved operation · v${saved.version}. Re-prepare against the current catalog before use.`);
  }
  async function saveOperation() {
    if (!operationData || operationError || referenceErrors.length || saving || recordProblem) return;
    const data = structuredClone(operationData), captured = scope, projectScope = baseScope, savedDraft = higgsfieldRequestJson(draft);
    const fingerprint = canonicalJson({ data, expectedVersion: baseline?.version ?? null });
    if (attempts.current[captured]?.fingerprint !== fingerprint) attempts.current[captured] = { fingerprint, id: baseline?.id ?? `studio-operation:${crypto.randomUUID()}`, requestId: crypto.randomUUID() };
    const attempt = attempts.current[captured]; setSaving(true); setSaveError('');
    try {
      const saved = await workspaceApi.saveRecord({ id: attempt.id, kind: 'studio-operation', data, expectedVersion: baseline?.version ?? null, requestId: attempt.requestId }) as StudioOperationRecord;
      if (saved.id !== attempt.id || saved.kind !== 'studio-operation' || saved.version !== (baseline?.version ?? 0) + 1 || canonicalJson(saved.data) !== canonicalJson(data)) throw new Error('Saved operation did not match the submitted draft.');
      if (alive.current && baseScopeRef.current === projectScope) { setBaselines(old => ({ ...old, [captured]: saved })); setSavedDrafts(old => ({ ...old, [captured]: savedDraft })); setOperationRecords(old => [...old.filter(row => row.id !== saved.id), saved]); onSaved?.(saved); setNotice(`Operation saved · v${saved.version}. No provider call was made.`); }
    } catch (error) { if (alive.current && baseScopeRef.current === projectScope) setSaveError(`${errorText(error)} Your inputs remain here. An unchanged retry reuses the same request.`); }
    finally { if (alive.current) setSaving(false); }
  }
  async function compose(event: React.FormEvent) {
    event.preventDefault(); if (!selected || !catalog || !supported || recordProblem || errors.length || !prompt.trim() || busy || saving) return;
    const captured = key, attempt = ++sequence.current;
    const input: HiggsfieldComposeInput = { catalogSha256: catalog.snapshot.catalogSha256, taskId, modelId: selected.id, prompt, settings: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && value !== null)), medias: useBrief ? [] : structuredClone(draft.medias), ...(useBrief && record ? { brief: { id: record.id, sha256: record.sha256 } } : {}) };
    setBusyKey(captured); setFailure(null); setNotice('');
    try { const value = await toolsApi.compose(input, catalog); if (alive.current && currentKey.current === captured && sequence.current === attempt) setResult({ key: captured, value }); }
    catch (e) { if (alive.current && currentKey.current === captured && sequence.current === attempt) setFailure({ key: captured, message: errorText(e) }); }
    finally { setBusyKey(old => old === captured ? '' : old); }
  }
  async function copy(value: unknown, label: string) {
    const captured = key;
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); if (currentKey.current === captured) setNotice(`${label} copied. No provider call was made.`); }
    catch { if (currentKey.current === captured) setNotice('Clipboard unavailable. Open the exact JSON below to copy it.'); }
  }
  function exportPlan() { if (!current) return; try { downloadLocalBlob(new Blob([JSON.stringify(current, null, 2) + '\n'], { type: 'application/json' }), `higgsfield-${selectedId}-preparation.json`); setNotice('Save requested for the preparation JSON. Complete the Save dialog; no generation was submitted.'); } catch (e) { setNotice(errorText(e)); } }
  function renderParameter(parameter: HiggsfieldModelParameter) {
    const value = values[parameter.name], label = human(parameter.name), id = `${headingId}-${parameter.name}`;
    const common = { id, disabled: Boolean(recordProblem) || saving, 'aria-label': `Higgsfield ${label.toLowerCase()}` };
    let field;
    const retainedChoices = selected?.id === 'ms_image' && parameter.name === 'style_id' ? catalog?.marketingStyles.map(row => ({ id: row.id, title: `${row.title} · ${row.category}` })) : selected?.id === 'marketing_studio_video' && parameter.name === 'mode' ? catalog?.marketingFormats.map(row => ({ id: row.slug, title: `${row.title} · ${row.minDurationSeconds}–${row.maxDurationSeconds}s` })) : undefined;
    if (retainedChoices) field = <select {...common} value={typeof value === 'string' ? value : ''} onChange={event => changeSetting(parameter.name,event.target.value)}><option value="">Choose a retained format…</option>{retainedChoices.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select>;
    else if (parameter.options) field = <select {...common} value={value == null ? '' : String(value)} onChange={e => changeSetting(parameter.name, e.target.value === '' ? '' : parameter.type === 'number' ? Number(e.target.value) : e.target.value)}><option value="">{parameter.required === 'required' ? 'Choose…' : 'Not specified'}</option>{parameter.options.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select>;
    else if (parameter.type === 'bool') field = <select {...common} value={value === undefined ? '' : String(value)} onChange={e => changeSetting(parameter.name, e.target.value === '' ? null : e.target.value === 'true')}><option value="">Model default</option><option value="true">On</option><option value="false">Off</option></select>;
    else if (parameter.type === 'number') field = <input {...common} type="number" min={parameter.min} max={parameter.max} step={['duration', 'count', 'batch_size'].includes(parameter.name) ? '1' : 'any'} value={typeof value === 'number' || typeof value === 'string' ? value : ''} onChange={e => changeSetting(parameter.name, e.target.value === '' ? '' : Number(e.target.value))}/>;
    else if (parameter.type === 'string_array') field = <textarea {...common} value={Array.isArray(value) ? value.join('\n') : ''} placeholder="One value per line" onChange={e => changeSetting(parameter.name, e.target.value.split('\n'))}/>;
    else field = <input {...common} value={typeof value === 'string' ? value : ''} autoComplete="off" onChange={e => changeSetting(parameter.name, e.target.value)}/>;
    return <div className="hf-field" key={parameter.name}><label htmlFor={id}>{label}{parameter.required === 'required' && <span aria-label="required"> *</span>}{field}</label>{parameter.description && (parameter.description.length > 100 ? <details className="hf-field-help"><summary>{label} notes</summary><p>{parameter.description}</p></details> : <small>{parameter.description}</small>)}</div>;
  }
  const promptField = <label>{referenceCreation ? 'Reference description' : composable ? 'Prompt' : 'Operation notes'}{useBrief ? ' · saved clip text' : ''}<textarea aria-label="Higgsfield prompt" maxLength={referenceCreation ? 16000 : undefined} value={prompt} readOnly={useBrief} disabled={Boolean(recordProblem) || saving} onChange={event => update(row => ({ ...row, prompt: event.target.value }))} placeholder={taskId === 'generate_audio' ? 'Exact words to speak…' : composable ? 'Subject, camera, ordered action, lighting and exact dialogue…' : 'Describe the intended result and record the inputs still needed…'} rows={5}/></label>;
  const referenceRoles = referenceCreation ? ['image'] as HiggsfieldMediaRole[] : ['video_analysis_create','voice_change'].includes(taskId) ? ['video'] as HiggsfieldMediaRole[] : selected && composable ? rolesFor(selected) : ['image', 'video', 'audio'] as HiggsfieldMediaRole[];
  const references = <details className="hf-references"><summary>Reference inputs · {useBrief ? 'from saved clip' : draft.medias.length ? `${draft.medias.length} retained files` : 'none chosen'}</summary><p>{referenceRoles.length ? `Planned roles: ${referenceRoles.map(roleName).join(', ')}.` : 'No reference role is stated for this model.'}</p><p className="hf-scope">{referenceCreation ? 'Choose 1–8 original PNG, JPEG or WebP images. Crops must first be retained as separate images. These inputs describe the reusable reference; they are not uploaded until you prepare it.' : 'An opening frame is the first instant; moments describe later action. Retained files are not provider upload IDs.'}</p>{useBrief ? <p>The server derives references from the exact saved clip. Review every role in the prepared plan.</p> : <>{draft.medias.map((row, index) => <div className="hf-planned-reference" key={`${row.sha256}:${row.role}:${index}`}>{row.mimeType.startsWith('image/') && <img src={blobUrl(row.sha256)} alt=""/>}<span>{row.label}<small>{roleName(row.role)} · retained original</small></span><div className="hf-reference-actions">{project && !isCreativeProject(project) && row.mimeType.startsWith('image/') && studioMediaActions(row).map(action => <button type="button" key={action.label} disabled={Boolean(recordProblem) || saving || busy || loading} aria-label={`${action.label} from ${row.label}`} onClick={() => receiveOperationRequest({ nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, taskId: action.taskId, target: draft.target ?? { kind: 'PROJECT' }, medias: [{ ...row, role: action.role }], title: `${action.label} · ${row.label}`.slice(0, 240), modelId: action.modelId, ...(action.settings ? { settings: action.settings } : {}) })}>{action.label}</button>)}<button type="button" disabled={saving} aria-label={`Remove ${row.label}`} onClick={() => update(value => ({ ...value, medias: value.medias.filter((_, i) => i !== index) }))}>Remove</button></div></div>)}{project && referenceRoles.length > 0 && <button type="button" disabled={Boolean(recordProblem) || saving} onClick={() => setReferencePicker(value => !value)}>{referencePicker ? 'Close reference choices' : 'Choose retained reference'}</button>}{referencePicker && project && (isCreativeProject(project) ? <StandaloneMediaPicker disabled={saving || Boolean(recordProblem)} key={`${scope}:${selectedId}`} project={project} roles={referenceRoles} onChoose={addReference}/> : <ReferenceChooser disabled={saving} key={`${scope}:${selectedId}`} project={project} roles={referenceRoles} onChoose={addReference}/>) }</>}</details>;
  const marketingPanel = activeMarketingKind && <section className="hf-marketing-inputs" aria-label="Production choices">
    <div className="hf-marketing-heading"><div><strong>{marketingModel ? 'Production choices' : 'Choose a saved production input'}</strong><p>{selectedId === 'ms_image' && composable ? 'Choose an artwork style, then add a brand and up to four featured products if needed.' : selectedId === 'marketing_studio_video' && composable ? 'Choose a video format and the people or products featured. A product video needs an explicit presenter.' : 'Browse the connected workspace and save the intended choice in this task.'}</p></div>{marketingKinds.length > 1 && <label>Choose input<select aria-label="Production input" value={activeMarketingKind} disabled={saving || Boolean(recordProblem)} onChange={event => setMarketingKind(event.target.value as MarketingInputKind)}>{marketingKinds.map(kind => <option key={kind} value={kind}>{MARKETING_LABELS[kind]}</option>)}</select></label>}</div>
    <ul className="hf-marketing-selected" aria-label="Selected production choices">{(Object.keys(MARKETING_FIELDS) as MarketingInputKind[]).flatMap(kind => marketingIds(kind).map((id,index) => {
      const name = marketingNames[JSON.stringify([scope,selectedId,kind,id])] ?? (kind === 'style' ? catalog?.marketingStyles.find(row => row.id === id)?.title : kind === 'format' ? catalog?.marketingFormats.find(row => row.slug === id)?.title : null);
      return <li key={`${kind}:${id}`}><span><small>{MARKETING_LABELS[kind]}</small>{name ?? `Saved choice ${index + 1}`}<details><summary>Exact saved identity</summary><code>{id}</code></details></span><button type="button" disabled={saving || Boolean(recordProblem)} aria-label={`Remove ${MARKETING_LABELS[kind]} ${index + 1}`} onClick={() => setMarketingIds(kind,marketingIds(kind).filter(value => value !== id))}>Remove</button></li>;
    }))}</ul>
    <MarketingInputPicker open={open} kind={activeMarketingKind} contextKey={JSON.stringify([scope,selectedId,baseline?.sha256,values.mode,useBrief])} selectedIds={marketingIds(activeMarketingKind)} disabled={saving || Boolean(recordProblem) || (!composable && Boolean(operationError))} onChoose={chooseMarketing}/>
    <small>Samples explain a style or format. Selecting one keeps your prompt and media unchanged. Provider inputs are checked again before generation.</small>
  </section>;
  const advancedParameters = ['folder_id','batch_size','extension_mode','voice_id','voice_type',...(marketingModel ? [...Object.values(MARKETING_FIELDS),'assets'] : [])];
  return <section className="hf-tools" aria-labelledby={headingId} hidden={!open} data-unsaved={hasDraft ? 'true' : undefined}>
    <div className="hf-tools-heading"><div><h3 id={headingId}>Higgsfield production tools</h3><p>Choose a filmmaking task. Prepare, save and reopen its inputs here.</p></div><button type="button" onClick={() => setReload(value => value + 1)} disabled={loading || saving}>Reload snapshot</button></div>
    {catalog && <p className="hf-observed">{catalog.models.length} models · {catalog.tools.length} Codex tools · observed <time dateTime={catalog.snapshot.observedAt}>{new Date(catalog.snapshot.observedAt).toLocaleString()}</time><span>Retained catalog · check live requirements before generation</span></p>}
    {loading && <p role="status">Reading the retained model catalog…</p>}{loadError && <p role="alert" className="hf-error">{loadError} Reload after the retained catalog is refreshed.</p>}
    {project && <details className="hf-saved-operations"><summary>Saved operations ({knownOperations.length})</summary>{!knownOperations.length && <p>No saved operations yet. Save the current preparation to return to it later.</p>}<div>{knownOperations.map(row => <button type="button" disabled={saving} key={row.id} onClick={() => requestOpenOperation(row)}><span>{row.data.title}</span><small>{catalog?.actions.find(action => action.id === row.data.taskId)?.title ?? human(row.data.taskId)} · v{row.version}</small></button>)}</div></details>}
    {requestError && <p role="alert" className="hf-error">{requestError}</p>}
    {pendingRequest?.baseScope === baseScope && <div className="hf-open-confirm" role="alert"><p>Keep your current inputs or open “{pendingRequest.request.title ?? 'Selected asset'}”. Opening replaces inputs in that destination task; drafts in other tasks stay here.</p><button disabled={saving || busy} onClick={() => { setPendingRequest(null); setNotice('Current draft kept. Choose the asset again when ready.'); }}>Keep current draft</button><button disabled={saving || busy || Boolean(disabledReason)} onClick={() => applyOperationRequest(pendingRequest.request)}>Replace with selected asset</button></div>}
    {pendingOpen && <div className="hf-open-confirm" role="alert"><p>The current or destination task has unsaved inputs. Opening “{pendingOpen.data.title}” replaces its destination inputs; drafts in other tasks stay here.</p><button onClick={() => setPendingOpen(null)}>Keep editing</button><button onClick={() => openOperation(pendingOpen)}>Discard inputs and open saved</button></div>}
    {catalog && <div className="hf-browser"><aside className="hf-browser-list" aria-label="Filmmaking tasks"><label className="hf-group-label">Work on<select aria-label="Higgsfield task group" disabled={saving} value={group} onChange={event => chooseGroup(event.target.value)}>{GROUPS.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label><label className="hf-search"><Search size={14} aria-hidden="true"/><input aria-label="Find a Higgsfield task" disabled={saving} value={query} onChange={event => setQuery(event.target.value)} placeholder="Task, input or result…"/></label><small>{visibleActions.length} actions{query ? ' across all groups' : ''}</small><div className="hf-action-results">{visibleActions.map(row => <button type="button" key={row.id} className="hf-model-option" aria-pressed={taskId === row.id} disabled={saving} onClick={() => chooseAction(row.id)}><span>{row.title}</span><small>{COMPOSE_TASKS.includes(row.id) ? 'Model request preparation' : row.id === 'show_reference_elements' ? 'Browse or create reusable references' : MARKETING_GUIDES[row.id] ? 'Browse & save production choices' : 'Input planning & handoff'}</small></button>)}</div>{!visibleActions.length && <p>No task matches. Search for a subject, source video or desired result.</p>}</aside>
    <div className="hf-inspector" aria-label="Higgsfield model and call inspector">{action ? <>
      <span className="hf-kicker">{GROUPS.find(row => row.id === action.group)?.title} · preparation</span><h4>{action.title}</h4><ConciseCopy text={action.purpose} label="About this task"/>{draft.detached && draft.target && <p className="hf-scope" aria-label="Task source selection">{draft.target.kind === 'PROJECT' ? 'Project task' : draft.target.kind === 'SCENE' ? `Scene ${draft.target.sceneId}` : `Shot ${draft.target.shotId}${draft.target.kind === 'CELL' ? ` · cell ${draft.target.cellId}` : ''}`} · {draft.medias.length ? draft.medias.map(media => `${media.label} (${roleName(media.role).toLowerCase()})`).join(', ') : 'No media chosen'} · reference review pending</p>}
      <dl className="hf-task-flow"><div><dt>Bring</dt><dd>{action.inputs.join(' · ')}</dd></div><div><dt>Get</dt><dd>{action.output}</dd></div><div><dt>Then</dt><dd>{action.nextStep}</dd></div></dl>
      {action.group === 'sets' && onOpenDcc && <button type="button" className="hf-context-link" disabled={saving} onClick={onOpenDcc}>Open sets & cameras <ArrowRight size={13}/></button>}
      {draft.writingRef && <section className="hf-writing-origin" aria-label="Writing origin">
        <div><strong>{writingOrigin.status === 'CURRENT' ? 'Linked to current saved writing' : writingOrigin.status === 'CHANGED' ? 'Writing changed · review needed' : writingOrigin.status === 'CHECKING' ? 'Checking saved writing…' : 'Writing origin needs attention'}</strong><small>{writingOrigin.record ? `${(writingOrigin.record.data as { title: string }).title} · v${draft.writingRef.version}` : `Writing v${draft.writingRef.version}`}{writingOrigin.scene ? ` · scene ${writingOrigin.scene.index}: ${writingOrigin.scene.heading}` : ''}</small></div>
        {writingOrigin.blockedReason && <p>{writingOrigin.blockedReason}</p>}
        {writingOrigin.scene && <details><summary>Original scene from v{draft.writingRef.version}</summary><pre>{writingOrigin.scene.text}</pre></details>}
        <p>Your prompt is a separate interpretation. This link preserves its writing origin.</p>
        <div className="hf-writing-origin-actions"><button type="button" disabled={writingOrigin.status === 'CHECKING' || saving} onClick={writingOrigin.refresh}>Refresh writing link</button>{onOpenWriting && <button type="button" onClick={onOpenWriting}>Open writing</button>}</div>
      </section>}
      {useBrief && record && <div className="hf-bound">Saved clip v{record.version} · {brief?.title ?? record.id}<small>The saved prompt stays exact. This operation does not change the clip.</small>{taskId === 'generate_image' && <button type="button" disabled={saving || Boolean(disabledReason)} onClick={() => update(row => ({ ...row, detached: true, prompt: '', medias: [], target: brief?.sceneId ? brief.shotIds?.length === 1 ? { kind: 'SHOT', sceneId: brief.sceneId, shotId: brief.shotIds[0] } : { kind: 'SCENE', sceneId: brief.sceneId } : { kind: 'PROJECT' } }))}>Create a separate frame draft</button>}</div>}
      {record && draft.detached && <p className="hf-scope">Separate preparation draft. The saved clip is unchanged; choose references explicitly.</p>}
      {(composable || modelDiscovery) && <details className="hf-model-picker" open={modelDiscovery}><summary>Model · {selected?.name ?? 'choose a model'}</summary><div aria-label="Higgsfield model catalog"><label className="hf-search"><Search size={14} aria-hidden="true"/><input aria-label="Find a Higgsfield model" disabled={saving} value={modelQuery} onChange={event => { setModelQuery(event.target.value); setLimit(12); }} placeholder="Name, provider or model ID…"/></label><small>{modelOptions.length} matching models</small><div className="hf-model-results">{modelOptions.slice(0, limit).map(model => <button type="button" disabled={saving} key={model.id} className="hf-model-option" aria-pressed={selectedId === model.id} onClick={() => chooseModel(model.id)}><span>{model.name}</span><small>{model.provider_name} · {catalog.composerModelIds.includes(model.id) ? 'Request builder available' : 'Catalog only'}</small></button>)}</div>{!modelOptions.length && <p>No matching model for this action.</p>}{modelOptions.length > limit && <button type="button" onClick={() => setLimit(value => value + 12)}>Show more models</button>}</div></details>}
      {selected && (composable || modelDiscovery) && <LiveModelRequirements open={open} modelId={selected.id} modelName={selected.name} contextKey={key + JSON.stringify(draft.target ?? null) + (baseline?.sha256 ?? '')} disabled={saving || Boolean(recordProblem)}/>}
      {['list_voices','voice_change'].includes(taskId)&&<ProviderReferencePicker open={open} contextKey={JSON.stringify([scope,baseline?.sha256])} mode="voice" disabled={saving||Boolean(recordProblem)||Boolean(operationError)} selectedVoice={typeof operationDetails.voice_id==='string'&&['preset','element'].includes(String(operationDetails.voice_type))?{voice_id:operationDetails.voice_id,voice_type:operationDetails.voice_type as 'preset'|'element'}:null} onChooseVoice={chooseVoice}/>}
      {!composable && marketingPanel}
      {taskId === 'video_analysis_create' && <section className="hf-writing-origin" aria-label="Footage analysis preparation"><label>YouTube source (optional)<input aria-label="Analysis YouTube source" type="url" value={typeof operationDetails.youtube_url === 'string' ? operationDetails.youtube_url : ''} placeholder="https://www.youtube.com/watch?v=…" disabled={saving || Boolean(recordProblem) || Boolean(operationError)} onChange={event => { const next = { ...operationDetails }; if (event.target.value) next.youtube_url = event.target.value; else delete next.youtube_url; update(row => ({ ...row, toolSettings: higgsfieldRequestJson(next) })); }}/></label><p>Use this link or choose one retained video below. The link is saved locally; this screen does not fetch it. Short clips give more reliable scene breakdowns; accuracy decreases with longer videos.</p></section>}
      {operationPreflight && <section className="hf-writing-origin" aria-label="Operation readiness"><strong>{operationPreflight.title} · preparation only</strong><ul>{operationPreflight.checks.map(check => <li key={check.code}><strong>{check.status === 'PASS' ? 'Prepared' : check.status === 'NEEDED' ? 'Input needed' : 'Execution blocked'}</strong> · {check.message}</li>)}</ul><p>{operationPreflight.next}</p><small>Source-selection checks run locally. Connected tools and real billing remain separately qualified.</small></section>}

      {taskId === 'show_reference_elements' && <label>Reference task<select aria-label="Reference task" disabled={saving || Boolean(disabledReason)} value={referenceMode} onChange={event => chooseReferenceMode(event.target.value as 'browse' | 'create')}><option value="browse">Browse existing references</option><option value="create">Create a new reference</option></select><small>Creation starts a separate draft with explicit image choices. Browsing notes and saved clip text stay unchanged.</small></label>}
      {taskId==='show_reference_elements'&&!referenceCreation&&<ProviderReferencePicker open={open} contextKey={JSON.stringify([scope,baseline?.sha256])} mode="element" disabled={saving||Boolean(recordProblem)||Boolean(operationError)||useBrief} onChooseElement={chooseElement}/>}
      {project?.sourceHash && (referenceCreation || composable) && <section className="hf-writing-origin" aria-label="Shared casting link">
        <label>Link a saved casting candidate<select aria-label="Saved casting candidate" disabled={saving || Boolean(recordProblem)} value={draft.castingRef ? JSON.stringify([draft.castingRef.id,draft.castingRef.version,draft.castingRef.sha256]) : ''} onChange={event => {
          const chosen = castingChoices.find(row => JSON.stringify([row.id,row.version,row.sha256]) === event.target.value);
          update(row => { const next = { ...row }; if (chosen) next.castingRef = { id: chosen.id, version: chosen.version, sha256: chosen.sha256, characterId: (chosen.data as CastingDraft).characterId }; else delete next.castingRef; return next; });
        }}><option value="">No casting link</option>{draft.castingRef && !castingChoices.some(row => row.id === draft.castingRef?.id && row.version === draft.castingRef.version && row.sha256 === draft.castingRef.sha256) && <option value={JSON.stringify([draft.castingRef.id,draft.castingRef.version,draft.castingRef.sha256])}>Retained candidate · v{draft.castingRef.version}</option>}{castingChoices.map(row => { const cast = row.data as CastingDraft; return <option key={row.id} value={JSON.stringify([row.id,row.version,row.sha256])}>{(project as Project).characters.find(character => character.id === cast.characterId)?.name ?? cast.characterId} · {cast.performer || 'Unnamed candidate'} · v{row.version}</option>; })}</select></label>
        {draft.castingRef ? <><p>{castingOrigin.status === 'CURRENT' ? 'Linked to current saved casting' : castingOrigin.blockedReason}</p>{castingOrigin.record && <small>{castingOrigin.record.data.performer} · {castingOrigin.record.data.referenceHashes.length} reference images · {castingOrigin.record.data.useScope === 'INTERNAL_STORYBOARD_REFERENCE_ONLY' ? 'Internal storyboard reference only' : 'Film use requested; approval not established'}</small>}<button type="button" disabled={saving || Boolean(recordProblem)} onClick={castingOrigin.refresh}>Refresh casting link</button></> : <p>{castingChoices.length ? 'Choose the character and performer this task represents.' : 'Save a character candidate in Casting to link it here.'}</p>}
        <small>The exact casting revision travels with this task and its results. Choose the intended images separately below. This link does not approve likeness or film-use rights.</small>
      </section>}
      {presets.length > 0 && <details className="hf-model-presets"><summary>Starting recipes ({presets.length})</summary>{presets.map(preset => <button type="button" disabled={saving} key={preset.id} onClick={() => { if (!composable && operationError) { setSaveError(operationError); return; } const model = catalog.models.find(row => row.id === preset.modelId); update(row => ({ ...row, modelId: preset.modelId, settings: { ...row.settings, [preset.modelId]: { ...(model ? initialSettings(model) : {}), ...preset.settings } }, ...(!composable ? { toolSettings: higgsfieldRequestJson({ ...operationDetails, requestedModel: preset.modelId, preset: preset.id }) } : {}) })); setNotice(preset.purpose); }}><span>{preset.title}</span><small>{preset.purpose}</small></button>)}</details>}
      {modelDiscovery && selected && <div className="hf-model-discovery"><strong>{selected.name}</strong><ConciseCopy text={selected.description} label="Full model description"/><p className="hf-scope">{catalog.composerModelIds.includes(selected.id) ? 'A local request builder is available for this model. Select its production task to prepare inputs.' : selected.output_type === '3d' ? 'Catalog discovery only. This model is not an executable remote scene-builder parameter.' : 'Catalog discovery only. No local request builder has been qualified for this model.'}</p>{catalog.composerModelIds.includes(selected.id) && <button type="button" disabled={saving} onClick={() => { const nextTask = `generate_${selected.output_type}`, nextScope = `${baseScope}:${nextTask}`; setDrafts(old => ({ ...old, [nextScope]: { ...(old[nextScope] ?? emptyDraft()), modelId: selected.id } })); chooseAction(nextTask); }}>Prepare inputs for {selected.name}</button>}</div>}
      {['marketing_list_video_presets', 'marketing_list_ad_formats'].includes(taskId) && <details className="hf-format-guide"><summary>Retained {taskId === 'marketing_list_video_presets' ? 'video formats' : 'ad styles'} ({taskId === 'marketing_list_video_presets' ? catalog.marketingFormats.length : catalog.marketingStyles.length})</summary><p>Save a format choice in this operation. This does not select a brand, product or provider workspace.</p><label>Find a format<input aria-label="Find a marketing format" value={modelQuery} onChange={event => setModelQuery(event.target.value)}/></label><div>{taskId === 'marketing_list_video_presets' ? catalog.marketingFormats.filter(row => `${row.title} ${row.description}`.toLowerCase().includes(modelQuery.toLowerCase())).map(row => <button type="button" disabled={saving} key={row.slug} aria-pressed={marketingIds('format').includes(row.slug)} onClick={() => chooseMarketing({kind:'format',id:row.slug,name:row.title})}><strong>{row.title}</strong><small>{row.minDurationSeconds}–{row.maxDurationSeconds}s · {row.description}</small></button>) : catalog.marketingStyles.filter(row => `${row.title} ${row.category}`.toLowerCase().includes(modelQuery.toLowerCase())).map(row => <button type="button" disabled={saving} key={row.id} aria-pressed={marketingIds('style').includes(row.id)} onClick={() => chooseMarketing({kind:'style',id:row.id,name:row.title})}><strong>{row.title}</strong><small>{row.category}</small></button>)}</div></details>}
      {composable && selected && !supported ? <div className="hf-catalog-only"><strong>Catalog only</strong><p>{selected.output_type === 'audio' ? 'This speech builder does not establish music or sound-effect generation. Save your intent; this model has no local request builder.' : 'This model is discoverable, but its exact request contract is not yet supported by this local builder.'}</p>{promptField}{references}</div> : composable && selected ? <form onSubmit={compose}>
        {promptField}
        {marketingPanel}
        {selected.output_type === 'audio' && <ProviderReferencePicker open={open} contextKey={JSON.stringify([scope,selected.id,baseline?.sha256,useBrief])} mode="voice" selectedVoice={typeof values.voice_id==='string'&&['preset','element'].includes(String(values.voice_type))?{voice_id:values.voice_id,voice_type:values.voice_type as 'preset'|'element'}:null} disabled={saving||Boolean(recordProblem)} onChooseVoice={chooseVoice}/>}
        {selected.output_type==='audio'&&<p className="hf-scope">Speech generation creates one take at a time and retains WAV or MP3 output. Other output formats remain preparation only.</p>}
        {!marketingModel&&['image','video'].includes(selected.output_type)&&<><ProviderReferencePicker open={open} contextKey={JSON.stringify([scope,selected.id,baseline?.sha256,draft.target,useBrief])} mode="element" disabled={saving||Boolean(recordProblem)||useBrief||!ELEMENT_MODELS.includes(selected.id)} onChooseElement={chooseElement}/>{useBrief?<p className="hf-scope">This prompt is bound to the saved clip. Add reusable references when editing that clip before saving its next revision.</p>:!ELEMENT_MODELS.includes(selected.id)&&<p className="hf-scope">Reusable characters, props and places are not supported by this model in the retained tool contract. Original file references remain available below.</p>}</>}
        <div className="hf-settings">{parametersFor(selected, values).filter(parameter => !advancedParameters.includes(parameter.name)).map(renderParameter)}{selected.aspect_ratios.length > 0 && !(selected.id === 'seedance_2_5' && ['video_edit', 'video_extension'].includes(String(values.mode))) && <label>Aspect ratio<select aria-label="Higgsfield aspect ratio" disabled={Boolean(recordProblem) || saving} value={String(values.aspect_ratio ?? '')} onChange={event => changeSetting('aspect_ratio', event.target.value)}><option value="">Model default</option>{selected.aspect_ratios.map(value => <option key={value}>{value}</option>)}</select></label>}</div>
        {parametersFor(selected, values).some(parameter => advancedParameters.includes(parameter.name)) && <details><summary>{selected.output_type === 'audio' ? 'Exact voice identity & advanced settings' : marketingModel ? 'Exact production identities & advanced settings' : 'Additional model settings'}</summary><div className="hf-settings">{parametersFor(selected, values).filter(parameter => advancedParameters.includes(parameter.name)).map(renderParameter)}</div></details>}
        {references}{errors.length > 0 && <p role="alert" className="hf-error">{errors.join(' ')}</p>}{failure?.key === key && <p role="alert" className="hf-error">{failure.message}</p>}
        <div className="hf-compose-actions"><button className={current ? '' : 'assistant-primary'} type="submit" disabled={Boolean(recordProblem) || !prompt.trim() || errors.length > 0 || busy || saving || loading || Boolean(loadError)}>{busy ? 'Checking local inputs…' : 'Prepare request'}</button></div><p className="hf-scope">Checks local inputs. No upload, credit spend or job submission.</p>
      </form> : <>{taskId === 'voice_change' && <p className="hf-scope">Revoice needs a confirmed source video and a selected voice ID/type. It does not generate new speech through the speech model.</p>}{taskId === 'show_reference_elements' && <p className="hf-scope">Completed Elements use &lt;&lt;&lt;UUID&gt;&gt;&gt; on supported models; names alone do not bind identity or permission.</p>}{referenceCreation && <div className="hf-settings"><label>Reference name (optional)<input aria-label="Reference name" maxLength={32} value={typeof operationDetails.name === 'string' ? operationDetails.name : ''} disabled={saving || Boolean(recordProblem) || Boolean(operationError)} onChange={event => chooseReferenceName(event.target.value)}/></label><label>Category<select aria-label="Reference category" value={String(operationDetails.category ?? 'auto')} disabled={saving || Boolean(recordProblem) || Boolean(operationError)} onChange={event => choosePlanningData({ category: event.target.value })}><option value="auto">Classify automatically</option><option value="character">Character</option><option value="environment">Place</option><option value="prop">Prop</option></select></label></div>}{promptField}{references}{referenceCreation ? <details><summary>Exact reference settings</summary><pre>{draft.toolSettings ?? higgsfieldRequestJson(operationDetails)}</pre></details> : <details><summary>Additional operation data</summary><p>Optional JSON notes for the handoff. These are not a validated executable call.</p><textarea aria-label="Higgsfield operation data" disabled={saving || Boolean(recordProblem)} value={draft.toolSettings ?? '{}'} onChange={event => update(row => ({ ...row, toolSettings: event.target.value }))}/></details>}</>}
      {referenceErrors.length > 0 && <p className="hf-scope">{referenceErrors.join(' ')}</p>}
      {recordProblem && <p role="alert" className="hf-error">{recordProblem}</p>}{operationError && <p role="alert" className="hf-error">{operationError}</p>}
      {current && <section className="hf-call-result" aria-label="Prepared Higgsfield request"><div className="hf-result-heading"><h5>Local plan prepared</h5><span>Preparation only</span></div><p className="hf-result-summary">{current.mediaRequirements.length} reference roles · {pendingChecks.filter(row => row.status === 'BLOCKED').length} items needed · {pendingChecks.filter(row => row.status === 'UNKNOWN').length} unconfirmed</p><details className="hf-readiness"><summary>Review requirements ({pendingChecks.length})</summary><ul>{pendingChecks.map(row => <li key={row.code}><strong>{row.status === 'BLOCKED' ? 'Needed' : 'Unconfirmed'}</strong> · {row.message}</li>)}</ul></details>{current.mediaRequirements.length > 0 && <details className="hf-reference-plan"><summary>Reference plan ({current.mediaRequirements.length})</summary>{current.mediaRequirements.map((row,index) => <p key={`${row.role}:${index}`}><strong>{roleName(row.role)}</strong> · {row.label}<small>{human(row.status)}{row.crop ? ' · crop must be rendered explicitly' : ''}</small></p>)}</details>}<div className="hf-compose-actions"><button type="button" className="assistant-primary" onClick={exportPlan}><FileJson size={14}/>Export plan</button><button type="button" onClick={() => void copy(current,'Preparation JSON')}>Copy preparation JSON</button>{current.estimateCall && <button type="button" onClick={() => void copy(current.estimateCall,'Estimate request')}>Copy estimate request</button>}</div><details><summary>Exact JSON and evidence</summary><pre>{JSON.stringify(current,null,2)}</pre></details></section>}
      <div className="hf-save-operation">{project && <><label>Operation name<input aria-label="Operation name" disabled={saving || Boolean(recordProblem)} value={draft.title ?? action.title} onChange={event => update(row => ({...row,title:event.target.value}))}/></label><button type="button" disabled={!operationData || !operationData.title.trim() || referenceErrors.length > 0 || Boolean(operationError || recordProblem) || saving || Boolean(baseline && !currentDirty)} onClick={() => void saveOperation()}>{saving ? 'Saving operation…' : saveError && attempts.current[scope] ? 'Retry operation save' : 'Save operation'}</button>{baseline && onOpenBudget && <button type="button" disabled={saving} onClick={() => onOpenBudget(`operation:${baseline.id}:v${baseline.version}`)}>Costs for saved preparation</button>}<small>{currentDirty ? baseline && onOpenBudget ? `Unsaved inputs · costs use saved v${baseline.version}` : 'Unsaved inputs' : baseline ? `Saved · v${baseline.version}` : 'Project draft · no scene required'}</small></>}<button type="button" disabled={saving} onClick={clear}>Clear draft inputs</button></div>
      {saveError && <p role="alert" className="hf-error">{saveError}</p>}{notice && <p role="status" className="hf-notice">{notice}</p>}
      {project && referenceCreation && <StudioReferencePanel open={open} projectId={project.id} operation={baseline ?? null} dirty={currentDirty || Boolean(operationError) || referenceErrors.length > 0} preparationBlockedReason={castingOrigin.blockedReason} disabled={saving || busy || Boolean(recordProblem)} onUseElement={element => {
        if (!baseline || currentDirty || saving || recordProblem) return;
        receiveOperationRequest({ nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, taskId: 'generate_image', modelId: 'nano_banana_pro', target: structuredClone(baseline.data.target), title: `Image with ${element.name}`.split('').map(char => char.charCodeAt(0) < 32 ? ' ' : char).join('').slice(0, 240), prompt: `<<<${element.id}>>>`, medias: [], ...(baseline.data.castingRef ? { castingRef: baseline.data.castingRef } : {}) });
      }}/>}
      {project && composable && <StudioGenerationPanel open={open} preparationBlockedReason={writingOrigin.blockedReason || castingOrigin.blockedReason} projectId={project.id} operation={baseline ?? null} dirty={currentDirty || Boolean(operationError)} disabled={saving || busy || Boolean(recordProblem)} onReuseOutput={(output, next, job) => receiveOperationRequest({ nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, taskId: next.taskId, modelId: next.modelId, target: baseline && job.data.operationRef.id === baseline.id && job.data.operationRef.version === baseline.version && job.data.operationRef.sha256 === baseline.sha256 ? baseline.data.target : { kind: 'PROJECT' }, ...(baseline?.data.castingRef && job.data.operationRef.id === baseline.id && job.data.operationRef.version === baseline.version && job.data.operationRef.sha256 === baseline.sha256 ? { castingRef: baseline.data.castingRef } : {}), ...(baseline?.data.writingRef && job.data.operationRef.id === baseline.id && job.data.operationRef.version === baseline.version && job.data.operationRef.sha256 === baseline.sha256 ? { writingRef: baseline.data.writingRef } : {}), title: `${next.label} · ${output.filename}`.slice(0, 240), medias: [{ role: next.role, sha256: output.sha256, mimeType: output.mimeType, label: output.filename }], ...(next.settings ? { settings: next.settings } : {}) })}/>}
      <details className="hf-technical"><summary>Tool contract & connection status</summary><code>{action.tool}</code><p>{composable ? 'Saved tasks use the generation controls above for upload, cost review, submission and returned files. Availability depends on the connected provider and reviewed inputs.' : taskId === 'show_reference_elements' ? referenceCreation ? 'Save the image inputs, prepare uploads, then explicitly authorize one reference creation below. A provider record is usable only after its own status is completed; creation does not approve its rights or creative use.' : 'Browse reads existing references in the connected Higgsfield workspace. Create a new reference switches to a separate saved task with explicit upload and creation steps.' : MARKETING_GUIDES[taskId] ? 'Browse reads the connected provider catalog. Choose an input to save its identity in this task. This does not create a provider asset or submit a generation.' : `${action.executionStatus}. This task currently prepares an input handoff.`}</p><p>{catalog.tools.find(row => row.suffix === action.toolSuffix)?.description}</p>{selected && composable && <pre>{JSON.stringify({model:selected.id,parameters:selected.parameters,medias:selected.medias,aspect_ratios:selected.aspect_ratios},null,2)}</pre>}</details>
    </> : <p>Choose a filmmaking task to inspect its inputs and next step.</p>}</div></div>}
    {catalog && <details className="hf-catalog-evidence"><summary>Catalog source & connection limits</summary><p>Observed through Codex at {new Date(catalog.snapshot.observedAt).toLocaleString()}. Reload reads retained evidence; availability and costs need a fresh provider check.</p><small>Models: {catalog.snapshot.catalogSha256}</small><small>Action guide: {catalog.actionCatalogSha256}</small>{catalog.snapshot.sources.map(row => <p key={row.name}>{row.name}<small>{row.sha256}</small></p>)}<p>Referenced tools missing from this connector snapshot:</p><ul>{catalog.missingTools.map(name => <li key={name}>{name.replace(/^mcp__codex_apps__higgsfield_/, '')}</li>)}</ul><p>Remote scene tools are separate from local Blender, Unity and Houdini. Workflow connections describe preparation; they do not execute it.</p></details>}
  </section>;
}
