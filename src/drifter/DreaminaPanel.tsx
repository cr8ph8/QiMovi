import { readShotDirection, appendShotDirections } from './shotDirectionModel';
import { formatShotDirection } from '../../local/contracts/shot-direction.mjs';
import './shot-direction.css';
import { readShotKeyframeRecord, keyframePlanCurrentness } from './storyboardPlanningModel';
import { applyKeyframesToBrief } from './keyframeBrief';
import { useCallback, useEffect, useRef, useState } from 'react';
import { blobUrl, WorkspaceError } from './api';
import { canonicalJson } from './canonical';
import { downloadDreamina, getDreaminaContext, previewDreamina, type DreaminaContext, type DreaminaPreview, type SavedBrief } from './dreaminaApi';
import type { CastingDraft, GenerationBrief, Project, Scene, ScenePlan, WorkspaceApi, WorkspaceRecord } from './types';
import WorkflowContextBar from './WorkflowContextBar';
import type { FlowContextProps } from './workflowApi';
import type { ProductionHandoff } from './types';
import HiggsfieldPreparation from './HiggsfieldPreparation';
import { getContextBundles, previewContextBundle } from './contextBundleApi';
import { validateRecord } from './validation';
import type { ContextBundle, ContextBundlePreview } from './types';
import type { SourceSelectionRequest } from './types';
import { passageBlock, verifySourceRefs } from './sceneWorkbenchModel';
import type { NodeRecordRequest } from './nodeWorkflowModel';
import { verifyNodeRequestedRecord } from './nodeRecordRequests';
import { prepareStoryboardShot, type ShotPreparationRequest } from './shotPreparation';
import './shot-preparation.css';
import './generation-controls.css';
import GenerationMediaInputs from './GenerationMediaInputs';
import ContextBundlePanel from './ContextBundlePanel';
import CellImage from './CellImage';
import FrameExtractionControl from './FrameExtractionControl';
import type { FrameExtractionResult } from './storyboardFrameApi';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'The preparation request was not confirmed.';
const copy = <T,>(value: T): T => structuredClone(value);
function leaseExportUrl(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const release = () => { window.removeEventListener('pagehide', release); URL.revokeObjectURL(url); };
  // A native Save sheet can remain open indefinitely. Component changes and a
  // short timeout cannot establish that WebKit has finished consuming the blob.
  window.addEventListener('pagehide', release, { once: true });
  return { url, release };
}
function freshBrief(context: DreaminaContext): GenerationBrief {
  const shotIds = context.scene.shots.slice(0, 1).map(shot => shot.id);
  return { schemaVersion: 1, sourceHash: context.sourceHash, sceneId: context.sceneId, title: `Scene ${context.scene.index} · first clip`, shotIds, cellIds: context.cells.filter(cell => shotIds.includes(cell.shotId)).map(cell => cell.id), initialFrameCellId: null, characterIds: context.characters.map(character => character.id), prompt: '', settings: { model: '', mode: 'UNCONFIRMED', durationMs: null, aspectRatio: '', resolution: '' }, basisHash: context.basisHash, status: 'DRAFT' };
}

export default function DreaminaPanel({ project, scene, api, records, open, sceneDirty, onClose, onSaved, flow, onChooseContext, contextBundleRequest, sourceSelectionRequest, onTakes, recordRequest, shotRequest, onReturnToStoryboard, onOpenBudget, onDirty, embedded = false, presentation, stepRequest, onDraftChange }: {
  presentation?: 'inspector'; stepRequest?: { nonce: number; step: 'frames'|'references'|'prompt'|'review' }; onDraftChange?: (draft: GenerationBrief | null) => void;
  embedded?: boolean; onDirty?: (value: boolean) => void;
  flow?: FlowContextProps; project: Project; scene: Scene; api: WorkspaceApi; records?: WorkspaceRecord[]; open: boolean; sceneDirty: boolean; onClose: () => void; onSaved: (record: WorkspaceRecord) => void;
  onChooseContext?: (shotIds: string[]) => void; contextBundleRequest?: { record: WorkspaceRecord; nonce: number };
  shotRequest?: ShotPreparationRequest; onReturnToStoryboard?: () => void;
  onOpenBudget?: (targetId?: string) => void;
  sourceSelectionRequest?: SourceSelectionRequest; onTakes?: (request?: NodeRecordRequest) => void; recordRequest?: NodeRecordRequest;
}) {
  const [prepStep, setPrepStep] = useState<'frames'|'references'|'prompt'|'review'>('frames');
  const [localContextOpen, setLocalContextOpen] = useState(false);
  const [localContextShots, setLocalContextShots] = useState<string[] | null>(null);
  const [localContextRequest, setLocalContextRequest] = useState<{ record: WorkspaceRecord; nonce: number }>();
  const selectedContextRequest = contextBundleRequest ?? localContextRequest;
  const [context, setContext] = useState<DreaminaContext | null>(null);
  const [draft, setDraft] = useState<GenerationBrief | null>(null);
  const [record, setRecord] = useState<WorkspaceRecord | null>(null);
  const [draftId, setDraftId] = useState(() => `generation-brief:${crypto.randomUUID()}`);
  const [preview, setPreview] = useState<{ value: DreaminaPreview; fingerprint: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [promptCopyNotice, setPromptCopyNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [linkChoice, setLinkChoice] = useState(false);
  const [switchTo, setSwitchTo] = useState<{ target: SavedBrief | null; request?: NodeRecordRequest } | null>(null);
  const handledRecordRequest = useRef<string>();
  const handledShotRequest = useRef<string>();
  const [pendingShot, setPendingShot] = useState<ShotPreparationRequest | null>(null);
  const [mediaEditing, setMediaEditing] = useState(false);
  const [extractionBusy, setExtractionBusy] = useState(false);
  const [seconds, setSeconds] = useState('');
  const [bundle, setBundle] = useState<{ ref: string; record: WorkspaceRecord; preview: ContextBundlePreview } | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState('');
  const [bundleRefresh, setBundleRefresh] = useState(0);
  const appliedBundleRequest = useRef<number>();
  const [handledSourceRequest, setHandledSourceRequest] = useState<number>();
  const alive = useRef(true), serial = useRef(0), panel = useRef<HTMLElement | null>(null);
  const promptEditor = useRef<HTMLTextAreaElement | null>(null);
  const scope = useRef('');
  scope.current = `${project.id}:${project.sourceHash}:${scene.id}`;
  const currentDraft = useRef(draft); currentDraft.current = draft;
  const draftObserver = useRef(onDraftChange); draftObserver.current = onDraftChange;
  useEffect(() => { draftObserver.current?.(draft ? copy(draft) : null); }, [draft]);
  const appliedStep = useRef<number>();
  useEffect(() => { if (open && stepRequest && stepRequest.nonce !== appliedStep.current) { appliedStep.current = stepRequest.nonce; setPrepStep(stepRequest.step); } }, [open, stepRequest]);
  const currentDraftId = useRef(draftId); currentDraftId.current = draftId;
  const freshBaseline = useRef<string | null>(null);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const currentOpen = useRef(open); currentOpen.current = open;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const previousFocus = useRef<HTMLElement | null>(null);
  const sequence = () => {
    const captured = scope.current, requestSerial = ++serial.current;
    return () => alive.current && captured === scope.current && requestSerial === serial.current;
  };
  const load = useCallback(async () => {
    const captured = `${project.id}:${project.sourceHash}:${scene.id}`, requestSerial = ++serial.current;
    const current = () => alive.current && captured === scope.current && requestSerial === serial.current;
    setBusy(true); setError(''); setPreview(null);
    try {
      const next = await getDreaminaContext(project, scene);
      if (!current()) return;
      setContext(next);
      if (!currentDraft.current) { const initial = freshBrief(next); freshBaseline.current = canonicalJson(initial); setDraft(initial); setSeconds(''); }
      setNotice(currentDraft.current ? 'Saved scene inputs refreshed. Your clip edits are retained.' : 'Choose the shots for one clip. Settings remain unconfirmed.');
    } catch (caught) { if (current()) setError(errorText(caught)); }
    finally { if (current()) setBusy(false); }
  // Workspace refreshes must not reset an edited clip. Its saved input basis is refreshed explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.sourceHash, scene.id]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => {
    if (!open || embedded) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = Array.from(document.querySelectorAll<HTMLElement>('.studio-header,.studio-layout'));
    const priorInert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]') ?? []).filter(element => !element.closest('[hidden]') && !Array.from(panel.current?.querySelectorAll('details:not([open])') ?? []).some(details => details.contains(element) && !details.querySelector(':scope > summary')?.contains(element)));
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = bodyOverflow; background.forEach((element, index) => { element.inert = priorInert[index]; }); document.removeEventListener('keydown', keyboard); previousFocus.current?.focus(); };
  }, [open, embedded]);
  const update = (change: (value: GenerationBrief) => GenerationBrief) => {
    setDraft(value => value ? change(copy(value)) : null); setPreview(null); setError(''); setNotice(''); setPromptCopyNotice('');
  };
  const dirty = Boolean(draft && (!record || canonicalJson(record.data) !== canonicalJson(draft)));
  const hasUnsavedEdits = mediaEditing || Boolean(draft && (record ? canonicalJson(record.data) !== canonicalJson(draft) : freshBaseline.current !== null && freshBaseline.current !== canonicalJson(draft)));
  useEffect(() => { onDirty?.(hasUnsavedEdits || extractionBusy); }, [hasUnsavedEdits, extractionBusy, onDirty]);
  const stale = Boolean(draft && context && draft.basisHash !== context.basisHash);
  const currentHandoff = flow?.context?.handoff.record;
  const linkedNeedsReview = Boolean(draft?.handoffRef && (flow?.loading || flow?.error || flow?.context?.readiness !== 'READY_FOR_PLANNING' || !currentHandoff || currentHandoff.id !== draft.handoffRef.id || currentHandoff.sha256 !== draft.handoffRef.sha256));
  const durationLimit = draft?.settings.mode === 'STANDARD' ? 30000 : 180000;
  const requestedMs = Math.round(Number(seconds) * 1000);
  const invalidDuration = seconds !== '' && (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0 || requestedMs / 1000 !== Number(seconds) || requestedMs > durationLimit);
  const bundleRef = draft?.contextBundleRef ? canonicalJson(draft.contextBundleRef) : '';
  const bundleMatches = Boolean(draft && bundle && bundle.ref === bundleRef && (bundle.record.data as ContextBundle).sceneId === scene.id && canonicalJson((bundle.record.data as ContextBundle).shotIds) === canonicalJson(draft.shotIds) && bundle.preview.compiled.characterSelections.every(item => draft.characterIds.includes((item.record.data as CastingDraft).characterId)));
  const bundleNeedsReview = Boolean(bundleRef && (bundleLoading || bundleError || !bundleMatches));
  const validInput = Boolean(draft?.title.trim() && draft.shotIds.length && !invalidDuration && !mediaEditing && !extractionBusy && !sceneDirty && !stale && !linkedNeedsReview && !bundleNeedsReview && !conflict);
  const previewCurrent = Boolean(draft && preview?.fingerprint === canonicalJson(draft));
  const initialFrame = context?.cells.find(cell => cell.id === draft?.initialFrameCellId);
  const savedDirections = (draft?.shotIds ?? []).flatMap(shotId => { const found = readShotDirection(project, records ?? [], scene.id, shotId); return found ? [found] : []; });
  const keyframeRecord = draft?.shotIds.length === 1 ? readShotKeyframeRecord(project, records, scene.id, draft.shotIds[0]) : null;
  const keyframeCurrent = keyframeRecord && keyframePlanCurrentness(keyframeRecord.data, project).status === 'CURRENT';
  function useSavedKeyframes() {
    if (!draft || !context || !keyframeRecord || busy || extractionBusy) return;
    try {
      const next = applyKeyframesToBrief(draft, keyframeRecord, project);
      if (next.cellIds.some(id => !context.cells.some(cell => cell.id === id && cell.imageHash === project.cells.find(row => row.id === id)?.imageHash))) throw new Error('Refresh clip inputs to include the current shared frames.');
      update(() => next); setSeconds(next.settings.durationMs === null ? '' : String(next.settings.durationMs / 1000));
      setNotice('Copied the saved keyframes, planned duration and direction into this clip draft. Review the inputs and save the brief.');
    } catch (caught) { setError(errorText(caught)); }
  }
  const selectedCells = draft?.cellIds.flatMap(id => context?.cells.filter(cell => cell.id === id && draft.shotIds.includes(cell.shotId)) ?? []) ?? [];
  // Saved and unsaved clips share the same explicit cell selection. Do not
  // borrow an earlier beat's illustration when this clip's image is missing.
  const visual = initialFrame ?? selectedCells.find(cell => cell.imageHash) ?? selectedCells[0];
  async function retainExtractedFrame(result: FrameExtractionResult) {
    onSaved(result.assetRecord); onSaved(result.provenanceRecord); onSaved(result.cellRecord);
    await load();
  }
  const bundleDependencies = flow?.records.map(item => item.sha256).join(':') ?? '';
  useEffect(() => {
    if (!draft?.contextBundleRef) { setBundleLoading(false); return; }
    if (!open) return;
    const selectedRef = copy(draft.contextBundleRef), captured = scope.current, controller = new AbortController(); let current = true;
    setBundleLoading(true); setBundleError('');
    void getContextBundles(project, scene.id, controller.signal).then(async catalog => {
      const selected = catalog.bundles.find(item => item.record.id === selectedRef.id);
      if (!selected || selected.record.sha256 !== selectedRef.sha256 || selected.currentness !== 'CURRENT') throw new Error('The selected context changed or needs review. Its earlier reference is retained. Choose a reviewed saved bundle to replace it.');
      const value = await previewContextBundle(project, selected.record.data as ContextBundle, controller.signal);
      if (current && captured === scope.current) setBundle({ ref: canonicalJson(selectedRef), record: selected.record, preview: value });
    }).catch(caught => { if (current && captured === scope.current) setBundleError(errorText(caught)); }).finally(() => { if (current && captured === scope.current) setBundleLoading(false); });
    return () => { current = false; controller.abort(); };
    // Exact references are retained when records change; only their readiness is refreshed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, scene.id, bundleRef, bundleDependencies, bundleRefresh, open]);
  useEffect(() => {
    if (!selectedContextRequest || !draft || !context || !open || appliedBundleRequest.current === selectedContextRequest.nonce) return;
    appliedBundleRequest.current = selectedContextRequest.nonce;
    const requested = selectedContextRequest.record, captured = scope.current, requestedClip = currentDraftId.current;
    let current = true;
    setBundleLoading(true); setBundleError('');
    void (async () => {
      const checked = await validateRecord(requested, project), data = checked.data as ContextBundle;
      if (checked.kind !== 'context-bundle' || data.sceneId !== scene.id || canonicalJson(data.shotIds) !== canonicalJson(currentDraft.current?.shotIds)) throw new Error('Choose context saved for this clip’s exact shots. Your clip edits are unchanged.');
      const catalog = await getContextBundles(project, scene.id);
      if (!catalog.bundles.some(item => item.record.id === checked.id && item.record.sha256 === checked.sha256 && item.currentness === 'CURRENT')) throw new Error('This saved context needs review before it can be attached. Your clip edits are unchanged.');
      const value = await previewContextBundle(project, data);
      if (!value.compiled.characterSelections.every(item => currentDraft.current?.characterIds.includes((item.record.data as CastingDraft).characterId))) throw new Error('This bundle includes a character that is not selected for the clip. Select that character yourself, or choose a different bundle.');
      if (!current || captured !== scope.current || requestedClip !== currentDraftId.current || canonicalJson(data.shotIds) !== canonicalJson(currentDraft.current?.shotIds)) return;
      update(previous => ({ ...previous, contextBundleRef: { id: checked.id, sha256: checked.sha256 } }));
      setBundle({ ref: canonicalJson({ id: checked.id, sha256: checked.sha256 }), record: checked, preview: value });
      setNotice('Saved context attached. Your prompt and clip settings are unchanged.');
    })().catch(caught => { if (current && captured === scope.current) setBundleError(errorText(caught)); }).finally(() => { if (current && captured === scope.current) setBundleLoading(false); });
    return () => { current = false; };
    // Apply a deliberate handoff once. Ordinary edits must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContextRequest, context, open]);
  const contextBlock = bundleMatches && bundle ? `[SELECTED CLIP CONTEXT]\n${bundle.preview.contextText}\n[/SELECTED CLIP CONTEXT]` : '';
  const contextInserted = Boolean(bundleMatches && bundle && draft?.prompt.includes(bundle.preview.contextText));
  const pendingSource = sourceSelectionRequest && sourceSelectionRequest.nonce !== handledSourceRequest ? sourceSelectionRequest : undefined;
  const sourceShotsMatch = Boolean(pendingSource && draft && canonicalJson(pendingSource.shotIds) === canonicalJson(draft.shotIds));
  const selectedSourceBlock = draft?.sourcePassages ? passageBlock(scene, draft.sourcePassages) : '';
  async function attachSourceSelection(asCopy: boolean) {
    if (!pendingSource || !context || !draft || busy || (asCopy ? !sourceShotsMatch : hasUnsavedEdits)) return;
    const requested = copy(pendingSource), captured = scope.current, clipId = draftId;
    setBusy(true); setError('');
    try {
      if (requested.sourceHash !== project.sourceHash || requested.sceneId !== scene.id || !requested.shotIds.length || canonicalJson(context.scene.shots.filter(shot => requested.shotIds.includes(shot.id)).map(shot => shot.id)) !== canonicalJson(requested.shotIds)) throw new Error('This selection does not match the current scene and shot order.');
      await verifySourceRefs(scene, requested.passages);
      if (!alive.current || captured !== scope.current || clipId !== currentDraftId.current) return;
      const next = asCopy ? copy(draft) : freshBrief(context);
      next.sourcePassages = requested.passages;
      if (!asCopy) { next.shotIds = requested.shotIds; next.cellIds = context.cells.filter(cell => requested.shotIds.includes(cell.shotId)).map(cell => cell.id); next.title = `Scene ${scene.index} · selected screenplay passages`; setSeconds(''); }
      setDraft(next); setDraftId(`generation-brief:${crypto.randomUUID()}`); setRecord(null); freshBaseline.current = '';
      setPreview(null); setConflict(false); attempt.current = null; setHandledSourceRequest(requested.nonce);
      setNotice(asCopy ? 'Source passages attached to a separate clip copy. Existing prompt, settings, references and starting frame are preserved.' : 'New clip from the source selection. Choose its starting frame and settings; prompt text remains empty.');
    } catch (caught) { if (alive.current) setError(errorText(caught)); }
    finally { if (alive.current) setBusy(false); }
  }
  function insertSourcePassages() {
    if (!selectedSourceBlock || !draft || draft.prompt.includes(selectedSourceBlock)) return;
    const prompt = draft.prompt ? `${draft.prompt}\n\n${selectedSourceBlock}` : selectedSourceBlock;
    if (prompt.length > 40000) { setError('The combined prompt exceeds 40,000 characters. Shorten the prompt or source selection.'); return; }
    update(value => ({ ...value, prompt })); setNotice('Exact selected screenplay passages appended once. Existing prompt text is preserved.');
  }
  function insertContext() {
    if (!contextBlock || bundleNeedsReview || contextInserted || !draft) return;
    const prompt = draft.prompt ? `${draft.prompt}\n\n${contextBlock}` : contextBlock;
    if (prompt.length > 40000) { setError('The combined prompt exceeds 40,000 characters. Shorten the prompt or the selected passages before inserting.'); return; }
    update(value => ({ ...value, prompt })); setNotice('Selected context appended once. Your existing prompt text is preserved.');
  }
  function cloneClip() {
    if (!draft || busy) return;
    setDraftId(`generation-brief:${crypto.randomUUID()}`); setRecord(null); freshBaseline.current = '';
    setPreview(null); setConflict(false); attempt.current = null; setNotice('New unsaved clip copy. The previous saved clip remains unchanged.');
  }
  const applyRecord = (item: SavedBrief | null) => {
    if (!context) return;
    const next = item ? copy(item.data as GenerationBrief) : freshBrief(context);
    freshBaseline.current = item ? null : canonicalJson(next);
    setDraft(next); setRecord(item); setDraftId(item?.id ?? `generation-brief:${crypto.randomUUID()}`); setSeconds(next.settings.durationMs === null ? '' : String(next.settings.durationMs / 1000));
    setPreview(null); setError(''); setPromptCopyNotice(''); setNotice(item ? `Opened saved brief · v${item.version}` : 'New clip draft.'); setConflict(false); setSwitchTo(null); attempt.current = null;
  };
  const requestSwitch = (item: SavedBrief | null) => { if (hasUnsavedEdits) setSwitchTo({ target: item }); else applyRecord(item); };
  async function openRequestedRecord(request: NodeRecordRequest, discard = false) {
    const current = sequence(); setBusy(true); setError('');
    try {
      const next = await getDreaminaContext(project, scene);
      const selected = next.savedBriefs.find(item => item.id === request.recordRef.id && item.sha256 === request.recordRef.sha256);
      const retained = selected ? { id: selected.id, kind: selected.kind, version: selected.version, sha256: selected.sha256, data: selected.data } : undefined;
      await verifyNodeRequestedRecord(request, project, scene, retained, 'OPEN_RECORD', 'generation-brief');
      if (!current() || !currentOpen.current) return;
      setContext(next);
      if (hasUnsavedEdits && !discard) setSwitchTo({ target: selected!, request });
      else applyRecord(selected!);
    } catch (caught) { if (current()) { setError(errorText(caught)); setSwitchTo(null); } }
    finally { if (current()) setBusy(false); }
  }
  useEffect(() => {
    if (!open || !context || busy || !recordRequest || handledRecordRequest.current === recordRequest.nonce) return;
    handledRecordRequest.current = recordRequest.nonce;
    void openRequestedRecord(recordRequest);
    // A deliberate request runs once, after loading; ordinary edits cannot replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordRequest, open, Boolean(context), busy]);
  function applyShotRequest(request: ShotPreparationRequest) {
    if (!context) return;
    try {
      const next = prepareStoryboardShot(project, context, request);
      // Selecting a shot is intentional work; protect it on later draft switches.
      freshBaseline.current = '';
      setDraft(next); setRecord(null); setDraftId(`generation-brief:${crypto.randomUUID()}`); setSeconds(next.settings.durationMs === null ? '' : String(next.settings.durationMs / 1000));
      setPreview(null); setConflict(false); setError(''); setPromptCopyNotice(''); setSwitchTo(null); setLinkChoice(false);
      setPendingShot(null); attempt.current = null;
      setNotice(`Prepared shot ${scene.shots.find(shot => shot.id === request.shotId)?.label}. Choose its opening frame, then compose the prompt.`);
    } catch (caught) { setError(errorText(caught)); setPendingShot(null); }
  }
  useEffect(() => {
    if (!open || !context || busy || !shotRequest || handledShotRequest.current === shotRequest.nonce) return;
    handledShotRequest.current = shotRequest.nonce;
    setPendingShot(null);
    try {
      prepareStoryboardShot(project, context, shotRequest);
      if (draft?.shotIds.length === 1 && draft.shotIds[0] === shotRequest.shotId && (record || hasUnsavedEdits)) {
        setNotice('This clip already uses the selected shot. Your prompt, settings and frame choices are retained.');
      } else if (record || hasUnsavedEdits) setPendingShot(shotRequest);
      else applyShotRequest(shotRequest);
    } catch (caught) { setError(errorText(caught)); }
    // Consume deliberate navigation once; hide/reopen and normal edits cannot replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotRequest, open, Boolean(context), busy]);
  const applyLinkedShots = () => {
    const linked=flow?.context?.handoff.record;
    if(!context||!linked||flow?.context?.readiness!=='READY_FOR_PLANNING')return;
    const handoff=linked.data as ProductionHandoff;
    if(handoff.sceneId!==scene.id)return;
    const next=freshBrief(context);next.shotIds=[...handoff.shotIds];next.cellIds=context.cells.filter(cell=>next.shotIds.includes(cell.shotId)).map(cell=>cell.id);next.handoffRef={id:linked.id,sha256:linked.sha256};next.title=`Scene ${scene.index} · linked camera preparation`;
    setDraft(next);setRecord(null);setDraftId(`generation-brief:${crypto.randomUUID()}`);freshBaseline.current=canonicalJson(freshBrief(context));setSeconds('');setPreview(null);setPromptCopyNotice('');setConflict(false);setError('');setNotice('New clip draft uses the linked shots and exact saved writing revision. Select its opening frame and review the cells.');setLinkChoice(false);setSwitchTo(null);attempt.current=null;
  };
  async function makePreview() {
    if (!draft || !context || !validInput || busy) return;
    const current = sequence(), payload = copy(draft);
    setBusy(true); setError(''); setPreview(null); setNotice('');
    try { const value = await previewDreamina(payload, context, project); if (current()) setPreview({ value, fingerprint: canonicalJson(payload) }); }
    catch (caught) { if (current()) setError(errorText(caught)); }
    finally { if (current()) setBusy(false); }
  }
  async function save() {
    if (!draft || !context || !previewCurrent || !validInput || busy) return;
    const current = sequence(), data = copy(draft);
    const fingerprint = canonicalJson({ id: draftId, data, expectedVersion: record?.version ?? null });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await api.saveRecord({ id: draftId, kind: 'generation-brief', data, expectedVersion: record?.version ?? null, requestId: attempt.current.requestId });
      if (!current()) return;
      setRecord(saved); setContext(value => value ? { ...value, savedBriefs: [...value.savedBriefs.filter(item => item.id !== saved.id), { ...saved, briefState: { status: 'CURRENT_BASIS' } }] } : value);
      setNotice(`Clip draft saved · v${saved.version}`); onSaved(saved);
    } catch (caught) {
      if (!current()) return;
      setError(errorText(caught));
      if (caught instanceof WorkspaceError && caught.status === 409 && caught.message !== 'STALE_DREAMINA_BASIS') setConflict(true);
    } finally { if (current()) setBusy(false); }
  }
  async function download() {
    if (!record || dirty || stale || linkedNeedsReview || bundleNeedsReview || busy || conflict || sceneDirty) return;
    const current = sequence(); setBusy(true); setError('');
    try {
      const blob = await downloadDreamina(record);
      if (!current() || !currentOpen.current) return;
      const lease = leaseExportUrl(blob), anchor = document.createElement('a');
      anchor.href = lease.url; anchor.download = `generation-scene-${scene.index}-v${record.version}.zip`;
      try { anchor.click(); } catch (caught) { lease.release(); throw caught; }
      setNotice('Save requested. Finish the Save dialog, then confirm the ZIP is in your chosen folder.');
    } catch (caught) { if (current()) setError(errorText(caught)); }
    finally { if (current()) setBusy(false); }
  }
  async function copyPrompt() {
    if (!draft?.prompt || !context) return;
    const text = draft.prompt, capturedScope = scope.current;
    const current = () => alive.current && currentOpen.current && capturedScope === scope.current && currentDraft.current?.prompt === text;
    setPromptCopyNotice('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (current()) setPromptCopyNotice('Prompt copied exactly as shown.');
    } catch {
      if (!current()) return;
      promptEditor.current?.focus(); promptEditor.current?.select();
      setPromptCopyNotice('Clipboard access is unavailable. The prompt is selected; press ⌘C or Ctrl+C to copy it.');
    }
  }
  async function copyPreviewPrompt() {
    if (!previewCurrent || !preview) return;
    try { await navigator.clipboard.writeText(preview.value.promptText); setNotice('Draft prompt copied.'); }
    catch { setNotice('Copy is unavailable. Select the prompt text below to copy it.'); }
  }
  return <div className={embedded ? "generation-inline" : "drawer-scrim dreamina-scrim"} data-presentation={presentation} data-step={prepStep} hidden={!open} data-unsaved={hasUnsavedEdits || extractionBusy ? 'true' : 'false'}><section ref={panel} className={embedded ? "dreamina-drawer generation-inline-editor" : "drawer dreamina-drawer"} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label="Prepare for generation">
    <div className="drawer-heading"><div><span className="eyebrow">{project.title} / SCENE {String(scene.index).padStart(2, '0')}</span><h2>Prepare for generation</h2></div><div className="dreamina-inline-actions">{onOpenBudget && <button type="button" className="secondary" disabled={busy} onClick={() => onOpenBudget(`scene:${scene.id}`)}>Scene costs</button>}<button aria-label="Close generation preparation" onClick={onClose}>×</button></div></div>
    {draft && <div className="clip-shot-context" aria-label="Current clip shots"><div><span>SCENE {String(scene.index).padStart(2, '0')}</span><strong>{draft.shotIds.length ? `Shot${draft.shotIds.length === 1 ? '' : 's'} ${draft.shotIds.map(id => scene.shots.find(shot => shot.id === id)?.label ?? id).join(' · ')}` : 'Choose shots'}</strong></div>{onReturnToStoryboard && <button className="text-link" onClick={onReturnToStoryboard}>← Storyboard</button>}</div>}
    {flow && <section className="clip-workflow-details generation-control-section" aria-label="Writing and production links"><h3>Writing & production links</h3><WorkflowContextBar {...flow} stage="generation"/></section>}
    <p className="drawer-intro">Prepare a clip from the shot plan or existing footage. Opening, pivotal moments, cuts, references and prompt travel together.</p>
    <div className="dreamina-state"><span>GENERATION PREPARATION</span><small>Choose a route · generation has not been submitted</small></div>
    {sceneDirty && <p className="quiet-warning" role="status">Room has unsaved changes. Close this panel and save the scene proposal to include them. Your clip draft stays here.</p>}
    {error && <div className="error-bar" role="alert">{error}<p>Your clip edits are retained. Refresh saved inputs after a conflict; open the latest saved brief before replacing it.</p></div>}
    {notice && <p className="dreamina-notice" role="status">{notice}</p>}
    <details className="generation-saved-options generation-control-section" aria-label="Saved clips and alternatives"><summary>Saved clips & alternatives</summary><p className="scope-note">Open another saved clip or branch a new alternative. Your current project stays the same.</p><div className="dreamina-library"><button className="secondary" disabled={busy} onClick={() => void load()}>Refresh saved inputs</button><button className="secondary" disabled={busy || !context} onClick={() => requestSwitch(null)}>New clip</button><button className="secondary" disabled={busy || !draft} onClick={cloneClip}>Make a new clip from this draft</button>{context && <label>Saved clips<select aria-label="Open saved clip" disabled={busy} value="" onChange={event => { const item = context.savedBriefs.find(item => item.id === event.target.value); if (item) requestSwitch(item); }}><option value="">Choose a saved clip…</option>{context.savedBriefs.map(item => <option key={item.id} value={item.id}>{(item.data as GenerationBrief).title} · v{item.version}{item.briefState.status === 'NEEDS_REVIEW' ? ' · Needs review' : ''}</option>)}</select></label>}</div></details>
    {embedded && <nav className="generation-steps" aria-label="Clip preparation steps">{(['frames','references','prompt','review'] as const).map((step,index) => <button key={step} aria-pressed={prepStep === step} onClick={() => setPrepStep(step)}>{index+1}. {step === 'frames' ? 'Opening & moments' : step === 'references' ? 'Video & references' : step === 'prompt' ? 'Prompt & model' : 'Review & save'}</button>)}</nav>}
    {flow?.context?.readiness==='READY_FOR_PLANNING' && <button className="secondary" disabled={busy||!context} onClick={()=>{if(hasUnsavedEdits)setLinkChoice(true);else applyLinkedShots();}}>New clip from linked shots</button>}
    {draft?.handoffRef && <p className="scope-note">Writing handoff retained · {draft.handoffRef.sha256.slice(0,12)} · planning context only.</p>}
    {linkedNeedsReview && <p className="quiet-warning" role="status">This clip retains an earlier or unverified writing link. Its exact reference is preserved. Review the current planning link, then explicitly start a new clip from linked shots; this clip will not update automatically.</p>}
    {linkChoice && <div className="dreamina-switch" role="alert"><p>Start a new clip from the saved planning link? The current unsaved clip edits will be replaced.</p><button onClick={()=>setLinkChoice(false)}>Keep editing</button><button onClick={applyLinkedShots}>Discard edits and use linked shots</button></div>}
    {switchTo && <div className="dreamina-switch" role="alert"><p>Replace the unsaved clip edits with {switchTo.target ? 'the selected saved version' : 'a new clip'}?</p><button className="secondary" disabled={busy} onClick={() => setSwitchTo(null)}>Keep editing</button><button className="secondary" disabled={busy} onClick={() => switchTo.request ? void openRequestedRecord(switchTo.request, true) : applyRecord(switchTo.target)}>Discard edits and open</button></div>}
    {stale && <div className="quiet-warning">This clip references earlier scene inputs. Review the refreshed cells, references and saved notes below.<button className="text-link" disabled={busy || conflict} onClick={() => update(value => ({ ...value, basisHash: context!.basisHash }))}>Use refreshed inputs for this draft →</button></div>}
    {conflict && context?.savedBriefs.some(item => item.id === draftId) && <button className="secondary" disabled={busy} onClick={() => requestSwitch(context.savedBriefs.find(item => item.id === draftId)!)}>Open latest saved brief</button>}
    {draft && context && <>
      {pendingShot && <div className="dreamina-switch" role="status"><p>Prepare shot {scene.shots.find(shot => shot.id === pendingShot.shotId)?.label} as a new clip.</p><p>{hasUnsavedEdits ? 'Save your current clip before switching. Its prompt and settings stay here.' : 'Your saved clip will remain available in Saved clips.'}</p><button className="secondary" onClick={() => setPendingShot(null)}>Keep current clip</button><button className="primary" disabled={busy || hasUnsavedEdits} onClick={() => applyShotRequest(pendingShot)}>Start the selected shot</button></div>}
      {pendingSource && <section className="dreamina-source-selection" aria-label="Passages from Scene Workbench"><h3>{pendingSource.passages.length} passages from Scene Workbench</h3><p>The selection has proposed shots {pendingSource.shotIds.map(id => scene.shots.find(shot => shot.id === id)?.label ?? id).join(', ')}. Review how to use it before changing the open clip.</p><div className="sw-actions"><button className="primary" disabled={busy || !sourceShotsMatch} onClick={() => void attachSourceSelection(true)}>Attach passages to a new copy</button><button className="secondary" disabled={busy || hasUnsavedEdits} onClick={() => void attachSourceSelection(false)}>Start a new clip from selection</button><button className="secondary" disabled={busy} onClick={() => setHandledSourceRequest(pendingSource.nonce)}>Keep current clip</button></div>{!sourceShotsMatch && <p className="scope-note">To retain a clip’s references and settings, open a clip with the same selected shots, then attach a separate copy.</p>}{hasUnsavedEdits && <p className="scope-note">Save current edits before starting a fresh clip. Attaching a copy retains the open draft’s text and settings.</p>}</section>}
      {keyframeRecord && <section className="generation-control-section" aria-label="Saved shot keyframes"><h3>Shot keyframes · v{keyframeRecord.version}</h3><p>{keyframeRecord.data.frames.length} visual anchors from the shared storyboard. Applying them replaces this clip’s frame choices and keyframe direction block; your other prompt text stays.</p><button className="secondary" disabled={busy || extractionBusy || !keyframeCurrent || !keyframeRecord.data.frames.length} onClick={useSavedKeyframes}>Use saved keyframes</button>{!keyframeCurrent && <p>Shared frames changed. Review and save the keyframe plan in Storyboard first.</p>}</section>}
      <fieldset className="dreamina-fields" disabled={busy || extractionBusy}><label className="field-label">Clip title<input aria-label="Clip title" value={draft.title} maxLength={200} onChange={event => update(value => ({ ...value, title: event.target.value }))}/></label>
        <div className="dreamina-compose"><div className="dreamina-visual"><div className="board-topline"><span>{initialFrame ? 'CLIP INITIAL FRAME / CANDIDATE' : 'SHOT REFERENCE / NOT A CLIP INITIAL FRAME'}</span><span>{visual ? context.scene.shots.find(shot => shot.id === visual.shotId)?.label : 'IMAGE NEEDED'}</span></div><CellImage key={`${visual?.id}:${visual?.imageHash}`} cell={visual ?? { id: 'missing', sceneId: scene.id, shotId: draft.shotIds[0] ?? '', role: 'START', review: 'MISSING', description: 'Clip starting image needed' }}/><p className="image-description">{visual?.description ?? 'Choose the opening image for this clip.'}</p>
          <label className="field-label">Clip initial frame<select aria-label="Clip initial frame" value={draft.initialFrameCellId ?? ''} onChange={event => update(value => ({ ...value, initialFrameCellId: event.target.value || null, cellIds: event.target.value ? [event.target.value, ...value.cellIds.filter(id => id !== event.target.value)] : value.cellIds }))}><option value="">Not selected — needs an opening frame</option>{context.cells.filter(cell => draft.cellIds.includes(cell.id) && cell.shotId === draft.shotIds[0]).map(cell => <option key={cell.id} value={cell.id}>{context.scene.shots.find(shot => shot.id === cell.shotId)?.label} · {cell.role} · {cell.description.slice(0, 75)}{cell.imageHash ? '' : ' (image missing)'}</option>)}</select></label><p className="scope-note">Use the first instant of this clip, even if the clip begins mid-scene. This choice does not change a cell’s scene role.</p>
          {visual?.crop && <FrameExtractionControl project={project} cell={visual} record={records?.find(item => item.id === `storyboard-cell:${visual.id}`)} disabled={busy || sceneDirty || conflict} onBusy={setExtractionBusy} onExtracted={retainExtractedFrame}/>}
        </div><section className="dreamina-sequence generation-control-section" aria-label="Shots in this clip"><h3>Shots in this clip · {draft.shotIds.length} selected</h3><p className="scope-note">Selected shots retain their screenplay plan order.</p><div className="dreamina-shot-list">{context.scene.shots.map(shot => <label className="dreamina-shot" key={shot.id}><input type="checkbox" checked={draft.shotIds.includes(shot.id)} onChange={event => update(value => {
          const shotIds = context.scene.shots.filter(item => item.id === shot.id ? event.target.checked : value.shotIds.includes(item.id)).map(item => item.id);
          const cellIds = context.cells.filter(cell => shotIds.includes(cell.shotId) && (cell.shotId === shot.id && event.target.checked || value.cellIds.includes(cell.id))).map(cell => cell.id);
          const initialFrameCellId = context.cells.some(cell => cell.id === value.initialFrameCellId && cell.shotId === shotIds[0] && cellIds.includes(cell.id)) ? value.initialFrameCellId : null;
          return { ...value, shotIds, cellIds: initialFrameCellId ? [initialFrameCellId, ...cellIds.filter(id => id !== initialFrameCellId)] : cellIds, initialFrameCellId };
        })}/><span><strong>{shot.label}</strong>{shot.description}</span></label>)}</div></section></div>
        <section data-prep-section="frames" className="dreamina-section"><h3>Ordered storyboard frames</h3><div className="dreamina-cell-list">{context.cells.filter(cell => draft.shotIds.includes(cell.shotId)).map(cell => <label className="cell-checkbox" key={cell.id}><input type="checkbox" checked={draft.cellIds.includes(cell.id)} onChange={event => update(value => {
          const cellIds = context.cells.filter(item => draft.shotIds.includes(item.shotId) && (item.id === cell.id ? event.target.checked : value.cellIds.includes(item.id))).map(item => item.id);
          const initialFrameCellId = cellIds.includes(value.initialFrameCellId ?? '') ? value.initialFrameCellId : null;
          return { ...value, cellIds: initialFrameCellId ? [initialFrameCellId, ...cellIds.filter(id => id !== initialFrameCellId)] : cellIds, initialFrameCellId };
        })}/><span><b>{context.scene.shots.find(shot => shot.id === cell.shotId)?.label} · {cell.role}</b>{cell.description}<small>{cell.imageHash ? 'Image candidate' : 'Image needed'}</small></span></label>)}</div>{!draft.shotIds.length && <p className="quiet-warning">Select at least one shot.</p>}</section>
        <section data-prep-section="references" className="dreamina-section"><h3>Character references</h3><div className="dreamina-characters">{context.characters.map(character => {
          const casting = context.casting.find(item => (item.data as CastingDraft).characterId === character.id)?.data as CastingDraft | undefined;
          const references = casting ? casting.referenceHashes : character.referenceImageHash ? [character.referenceImageHash] : [];
          return <label className="dreamina-character" key={character.id}><input type="checkbox" checked={draft.characterIds.includes(character.id)} onChange={event => update(value => ({ ...value, characterIds: context.characters.filter(item => item.id === character.id ? event.target.checked : value.characterIds.includes(item.id)).map(item => item.id) }))}/>{references.map(hash => <img key={hash} src={blobUrl(hash)} alt={`${character.name} saved reference candidate`}/>)}<span><strong>{character.name}{casting ? ` / ${casting.performer}` : ''}</strong><small>{references.length ? `${references.length} reference candidate${references.length > 1 ? 's' : ''}` : 'No saved reference image'}</small><small>{(casting?.useScope ?? character.useScope ?? 'Use scope not established').replace(/_/g, ' ')}</small></span></label>;
        })}</div><p className="scope-note">References come from saved casting records. Appearance candidates do not establish permission for film use.</p></section>
        {draft.sourcePassages && <section data-prep-section="prompt" className="dreamina-source-selection" aria-label="Selected screenplay passages"><h3>Selected screenplay passages · {draft.sourcePassages.length}</h3><p className="scope-note">Exact source text retained for this clip. These associations describe planned coverage; they do not verify the resulting film.</p><pre>{selectedSourceBlock}</pre><div className="sw-actions"><button className="secondary" disabled={draft.prompt.includes(selectedSourceBlock)} onClick={insertSourcePassages}>{draft.prompt.includes(selectedSourceBlock) ? 'Selected passages are in the prompt' : 'Insert exact passages into prompt'}</button><button className="secondary" onClick={() => update(value => { const next = { ...value }; delete next.sourcePassages; return next; })}>Detach source selection</button></div><p className="scope-note">Detaching preserves text already inserted into the prompt.</p></section>}
        <section data-prep-section="references" className="dreamina-section dreamina-selected-context"><div className="section-topline"><h3>Selected context</h3><span>{bundleMatches && bundle ? (bundle.record.data as ContextBundle).title : draft.contextBundleRef ? 'Needs review' : 'None selected'}</span></div><p className="scope-note">Attach exact lore passages, saved writing notes and individual casting images for these shots. Existing prompt text changes only when you insert context. A blank prompt can use it in the suggested starter.</p><div className="dreamina-context-actions"><button className="secondary" disabled={!draft.shotIds.length || bundleLoading} onClick={() => { if (onChooseContext) onChooseContext([...draft.shotIds]); else { setLocalContextShots([...draft.shotIds]); setLocalContextOpen(true); } }}>Choose context</button>{draft.contextBundleRef && <><button className="text-link" disabled={bundleLoading} onClick={() => setBundleRefresh(value => value + 1)}>Check selected context</button><button className="text-link" onClick={() => { update(value => { const next = { ...value }; delete next.contextBundleRef; return next; }); setBundle(null); setBundleError(''); }}>Detach context</button></>}</div>{bundleLoading && <p role="status">Checking the saved context selection…</p>}{bundleError && <p role="alert" className="quiet-warning">{bundleError}</p>}{bundleNeedsReview && !bundleLoading && !bundleError && <p className="quiet-warning">The context must match this clip’s exact shots and selected characters. Review the selection before previewing or saving.</p>}{bundle && bundle.ref === bundleRef && <section className="generation-control-section" aria-label="Saved context for prompt"><h3>Saved context · revision {bundle.record.version}</h3><p>{bundle.preview.compiled.loreSelections.length} lore passages or images · {bundle.preview.compiled.noteSelections.length} writing notes · {bundle.preview.compiled.characterSelections.reduce((count, item) => count + item.referenceHashes.length, 0)} character images</p><pre>{bundle.preview.contextText}</pre><button className="secondary" disabled={bundleNeedsReview || contextInserted} onClick={insertContext}>{contextInserted ? 'Selected context is in the prompt' : 'Insert selected context into prompt'}</button></section>}<p className="scope-note">Detaching preserves any context text already inserted in the prompt. Edit that text yourself if needed.</p></section>
        <div data-prep-section="references"><GenerationMediaInputs project={project} inputs={draft.mediaInputs ?? []} disabled={busy} onEditingChange={setMediaEditing} onChange={inputs => update(value => ({ ...value, mediaInputs: inputs }))}/></div>
        <section data-prep-section="prompt" className="dreamina-section"><h3>Generation destination & settings</h3><p className="scope-note">Prepare the same clip for any route. Each model's actual formats, reference types and duration limits are checked before execution.</p><div className="dreamina-settings"><label>Destination<select aria-label="Generation destination" value={draft.settings.route ?? 'UNSELECTED'} onChange={event => update(value => ({ ...value, settings: { ...value.settings, route: event.target.value as GenerationBrief['settings']['route'] } }))}><option value="UNSELECTED">Choose later</option><option value="HIGGSFIELD">Higgsfield · request preparation</option><option value="DREAMINA">Dreamina / Seedance · manual handoff</option><option value="COMFYUI">ComfyUI · local workflow preparation</option><option value="OTHER">Other video model / editor</option></select></label><label>Model<input aria-label="Generation model" value={draft.settings.model} maxLength={120} placeholder="Unconfirmed" onChange={event => update(value => ({ ...value, settings: { ...value.settings, model: event.target.value } }))}/></label><label>Mode<select aria-label="Generation mode" value={draft.settings.mode} onChange={event => update(value => ({ ...value, settings: { ...value.settings, mode: event.target.value as GenerationBrief['settings']['mode'] } }))}><option value="UNCONFIRMED">Unconfirmed</option><option value="CLIP">Clip · up to 180 seconds</option><option value="STANDARD">Legacy standard · up to 30 seconds</option><option value="LONG_VIDEO">Legacy long video · up to 180 seconds</option></select></label><label>Duration in seconds<input aria-label="Generation duration in seconds" type="number" min="0.001" step="0.001" max={durationLimit / 1000} value={seconds} placeholder="Untimed" onChange={event => { setSeconds(event.target.value); update(value => ({ ...value, settings: { ...value.settings, durationMs: event.target.value === '' || !Number.isFinite(Number(event.target.value)) ? null : Math.round(Number(event.target.value) * 1000) } })); }}/></label><label>Aspect ratio<input aria-label="Generation aspect ratio" value={draft.settings.aspectRatio} maxLength={120} placeholder="Unconfirmed" onChange={event => update(value => ({ ...value, settings: { ...value.settings, aspectRatio: event.target.value } }))}/></label><label>Resolution<input aria-label="Generation resolution" value={draft.settings.resolution} maxLength={120} placeholder="Unconfirmed" onChange={event => update(value => ({ ...value, settings: { ...value.settings, resolution: event.target.value } }))}/></label></div>{invalidDuration && <p role="alert" className="quiet-warning">Enter a duration greater than zero and at most {durationLimit / 1000} seconds, with millisecond precision. Shorter account limits still apply.</p>}</section>
        {savedDirections.length > 0 && <section data-prep-section="prompt" className="saved-shot-direction" aria-label="Saved shot direction for clip"><h3>Saved shot direction</h3><p className="scope-note">Blank prompts use this direction in their starter. Add it explicitly to an authored prompt after reviewing the current revision.</p>{savedDirections.map(item => <article key={item.id}><h4>{scene.shots.find(shot => shot.id === item.data.shotId)?.label} · v{item.version}</h4><pre>{formatShotDirection(item.data)}</pre></article>)}<button type="button" className="secondary" disabled={busy || !draft.prompt} onClick={() => { try { const prompt = appendShotDirections(draft.prompt, savedDirections); if (prompt === draft.prompt) { setNotice('These direction revisions are already included.'); return; } update(value => ({ ...value, prompt })); setNotice('Saved shot direction added. Your existing prompt text is preserved.'); } catch (caught) { setError(errorText(caught)); } }}>Add saved direction to my prompt</button></section>}
        <section data-prep-section="prompt" className="dreamina-section"><h3>Prompt draft</h3><p className="scope-note">Write in order: opening state, pivotal movements and exact dialogue, camera, sound, ending state and intended cut. Source footage can supply motion or an edit/extension reference.</p><label className="field-label" htmlFor={`dreamina-prompt-${scene.id}`}>Your production instructions<textarea ref={promptEditor} id={`dreamina-prompt-${scene.id}`} aria-label="Generation prompt draft" rows={8} maxLength={40000} value={draft.prompt} onChange={event => update(value => ({ ...value, prompt: event.target.value }))} placeholder="Leave blank to preview a starter from the saved shot plan and exact source. Or write your own clip instructions."/></label><div className="dreamina-inline-actions"><button className="secondary" disabled={!draft.prompt} onClick={() => void copyPrompt()}>Copy prompt</button></div>{promptCopyNotice && <p className="dreamina-notice" role="status">{promptCopyNotice}</p>}<p className="scope-note">Copy includes the text shown above, including unsaved edits. Prompt edits stay separate from the frozen screenplay. Exact dialogue remains available below and in the ZIP.</p>{context.scenePlan && <details className="dreamina-notes"><summary>Saved scene direction · v{context.scenePlan.version}</summary><pre>{(context.scenePlan.data as ScenePlan).notes || 'No scene direction saved.'}</pre></details>}</section>
      </fieldset>
      {embedded && prepStep !== 'review' && <div className="generation-next"><button className="primary" onClick={() => setPrepStep(prepStep === 'frames' ? 'references' : prepStep === 'references' ? 'prompt' : 'review')}>Continue to {prepStep === 'frames' ? 'video & references' : prepStep === 'references' ? 'prompt & model' : 'review'} →</button></div>}
      <button className="primary dreamina-preview-button" disabled={busy || !validInput} onClick={() => void makePreview()}>{busy ? 'Working…' : 'Preview preparation'} <span aria-hidden="true">→</span></button>
      {previewCurrent && preview && <section className="dreamina-section dreamina-preview"><div className="section-topline"><h2>Preparation preview</h2><span>DRAFT / NEEDS INPUTS</span></div><ul className="dreamina-requirements">{preview.value.requirements.map((item, index) => <li key={`${item.code}:${index}`}>{item.message}</li>)}</ul><section className="generation-control-section" aria-label="Copyable draft prompt"><h3>Copyable draft prompt</h3><pre>{preview.value.promptText}</pre><div className="dreamina-inline-actions"><button className="secondary" disabled={busy} onClick={() => void copyPreviewPrompt()}>Copy draft prompt</button>{draft.prompt === '' && <button className="secondary" disabled={busy} onClick={() => update(value => ({ ...value, prompt: preview.value.promptText }))}>Use starter in editor</button>}</div></section><details><summary>Exact screenplay context — entire scene</summary><p className="scope-note">Retained for context; selected shots do not establish complete dialogue or action coverage.</p><pre>{preview.value.sourceText}</pre></details><details><summary>Upload sheet · {preview.value.uploadSheet.length} entries</summary>{preview.value.uploadSheet.map((item, index) => <div className="dreamina-upload" key={`${item.role}:${index}`}><strong>{item.label}</strong><small>{item.role.replace(/_/g, ' ')} · {item.status.replace(/_/g, ' ')}</small><p>{item.path ?? 'No retained asset'}</p>{item.crop && <p>Original image plus crop coordinates. Crop before upload.</p>}</div>)}</details></section>}
      <HiggsfieldPreparation project={project} record={record} workspaceApi={api} records={records} onSaved={onSaved} open={open} onOpenBudget={onOpenBudget} disabledReason={busy ? 'Wait for the current clip operation to finish.' : sceneDirty ? 'Save Room changes and refresh the clip inputs first.' : conflict ? 'Resolve the saved clip conflict before preparing a provider request.' : bundleNeedsReview ? 'Review the selected context before preparing a provider request.' : linkedNeedsReview ? 'Review the retained writing link before preparing a provider request.' : stale ? 'Review the changed scene inputs and save a current clip revision first.' : dirty ? 'Save the current clip edits before preparing a provider request.' : ''}/>
      {record && onOpenBudget && <div className="dreamina-inline-actions"><button type="button" className="secondary" disabled={busy} onClick={() => onOpenBudget(`work:${record.id}`)}>Costs for saved clip</button>{dirty && <small>Costs use the retained clip v{record.version}; current edits stay here.</small>}</div>}
      {onTakes && <div><button className="text-link" onClick={() => onTakes()}>Review or import footage for this scene →</button>{record && <button className="secondary" disabled={busy || dirty || stale || linkedNeedsReview || bundleNeedsReview || conflict || sceneDirty} onClick={() => onTakes({ nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: scene.id, recordRef: { id: record.id, sha256: record.sha256, kind: record.kind }, intent: 'IMPORT_RETURN' })}>Import return for this saved brief</button>}</div>}<footer className="dreamina-footer"><div><strong>{dirty ? 'Unsaved clip draft' : `Saved clip draft · v${record?.version}`}</strong><small>{busy ? 'Working… your clip stays here.' : !validInput ? 'Resolve the marked inputs before previewing and saving.' : dirty && !previewCurrent ? 'Preview preparation to enable Save clip draft.' : dirty ? 'Preview is current. Save to retain this clip locally.' : 'Retained locally. Changes require a new preview before saving.'}</small></div><div><button className="secondary" disabled={busy || !record || dirty || stale || linkedNeedsReview || bundleNeedsReview || conflict || sceneDirty} onClick={() => void download()}>Download draft ZIP</button><button className="primary" disabled={busy || !dirty || !previewCurrent || !validInput} onClick={() => void save()}>Save clip draft</button></div></footer>
    </>}
  </section>{localContextShots && <ContextBundlePanel project={project} scene={scene} shotIds={localContextShots} records={records ?? []} api={api} lockShots open={open && localContextOpen} onClose={() => setLocalContextOpen(false)} onSaved={onSaved} onUse={chosen => { setLocalContextRequest({ record: chosen, nonce: Date.now() }); setLocalContextOpen(false); }}/>}</div>;
}
