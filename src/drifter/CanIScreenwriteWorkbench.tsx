import type { WorldRehearsalDraft } from './worldRehearsal';
import type { MediaTakeShotRequest } from './MediaTakesPanel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeDiff } from '@/lib/diff';
import ScreenwritingPanel, { type ScreenwritingHandle, type WritingContext } from './ScreenwritingPanel';
import { canonicalJson } from './canonical';
import AuthoringSourceLinks from './AuthoringSourceLinks';
import { universeDevelopmentNote } from './universeDevelopment';
import { AUTHORING_KINDS, WORKBENCH_MODES, TEMPLATES, buildAuthoringBundle, deriveAuthoring, emptyAuthoring, storyPlanFountain, type AuthoringKind, type EditableAuthoring, type WorkbenchMode } from './workbenchModel';
import type { ConceptDraft, PitchDraft, Project, ProjectAsset, ScreenplayDraft, StoryPlanDraft, WorkspaceApi, WorkspaceRecord, WritingNote } from './types';
import LocalContinuity from './LocalContinuity';
import LocalReviewExchange from './LocalReviewExchange';
import WorkflowContextBar from './WorkflowContextBar';
import type { FlowContextProps } from './workflowApi';
import LoreLibrary from './LoreLibrary';
import ProjectLibraryPanel from './ProjectLibraryPanel';
import UniverseLibrary from './UniverseLibrary';
import type { UniverseOperation } from './UniverseSlate';
import { universeApi, universeContextText, type UniverseCatalog, type UniverseCitation, type UniverseEntity, type UniverseEntityDraft, type UniverseClaimDraft, type UniverseLinkDraft, type UniverseAgentDraft, type UniverseProfileDraft, type UniverseProductionPlanDraft, type UniverseContinuityDraft } from './universeApi';
import type { UniverseAssistantContext } from './AssistantPanel';
import SceneWorkbench from './SceneWorkbench';
import type { ScreenplayConnectionAction } from './screenplayConnectionsModel';
import { retainedStoryPlan } from './retainedStoryPlan';
import AuthoringForm from './AuthoringForm';
import { sceneDraftFountain } from './localSceneTools';
import type { SourceSelectionRequest } from './types';
import { downloadLocalBlob } from './localDownload';
import StudioHome from './StudioHome';
import DeliveryOverview from './DeliveryOverview';
import { deriveStoryboardSequence } from './storyboardSequenceModel';
import ProjectDirectionPanel from './ProjectDirectionPanel';
import StudioHeader from './StudioHeader';
import ScriptAnalysis from './ScriptAnalysis';
import CreativeTools from './CreativeTools';
import MovieWorkspace from './MovieWorkspace';
import type { MovieWorkspaceContext, MovieWorkspaceView, MovieWorkspaceViewRequest } from './movieWorkspaceRouting';
import type { NodeRecordRequest } from './nodeWorkflowModel';
import type { AssetUsage } from './projectLibraryModel';
import { isCreativeRecord } from './creativeToolModel';
import PitchDocuments from './PitchDocuments';
import ProjectPitchEditor from './ProjectPitchEditor';
import { createPitchPdf, createPitchDocx } from './pitchExports';
import { writingExportScope } from './writingExports';
import { budgetWorkDestination, recordBudgetTarget, type BudgetWorkRequest } from './budgetNavigation';

export type WorkbenchModeRequest = { mode: WorkbenchMode; nonce: number; openEditors?: boolean; movieView?: MovieWorkspaceView; resumeDraftId?: string };
export type WorkbenchDraftStatus = { scope: string; dirty: boolean; areas: { id: string; label: string }[] };
type Props = { onOpenCreativeAuthoring?: (mode: WorkbenchMode) => void; onUniverseAssistant?: (context: UniverseAssistantContext) => void; onOpenModels?: () => void; onOpenBudget?: (targetId?: string) => void; budgetWorkRequest?: BudgetWorkRequest; onOpenAssistant?: () => void; onAssistantContext?: (context: WritingContext | null) => void; onDraftStatusChange?: (status: WorkbenchDraftStatus) => void; project: Project; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; sceneId: string; onClose: () => void; onSaved: (record: WorkspaceRecord) => void; onProduction: () => void; onSceneSelect?: (sceneId: string) => void; onProductionScene?: (sceneId: string) => void; onPrepareShot?: (sceneId: string, shotId: string) => void; onStoryboardShot?: (sceneId: string, shotId: string, cellId?: string) => void; onGenerationScene?: (sceneId: string, request?: NodeRecordRequest) => void; onTakes?: (sceneId: string, request?: NodeRecordRequest, shotRequest?: MediaTakeShotRequest) => void; onDcc: () => void; onDccScene?: (sceneId: string) => void; onDocuments?: () => void; onCasting?: (request?: NodeRecordRequest) => void; onGeneration?: () => void; onSourceSelection?: (request: SourceSelectionRequest) => void; onChooseContext?: (request?: NodeRecordRequest) => void; flow?: FlowContextProps; onHandoff?: (record: WorkspaceRecord) => void; modeRequest?: WorkbenchModeRequest; sourceStatus?: 'ADMITTED' | 'PENDING_OWNER_ADMISSION' };
type Editing = { id: string; data: EditableAuthoring; baseline: WorkspaceRecord | null; initial: string };
const isDirty = (edit: Editing) => canonicalJson(edit.data) !== edit.initial;
const message = (caught: unknown) => caught instanceof Error ? caught.message : 'The local operation was not confirmed.';
const titleOf = (record: WorkspaceRecord) => String((record.data as { title?: string }).title ?? record.id);
const kindLabel = (kind: string) => ({ 'screenplay-draft': 'Screenplay', 'writing-note': 'Note', 'concept-draft': 'Concept', 'story-plan-draft': 'Story plan', 'pitch-draft': 'Pitch', 'writing-session': 'Writing session' }[kind] ?? kind);
function download(value: string, filename: string, mime = 'application/json') {
  downloadLocalBlob(new Blob([value], { type: mime }), filename);
}

export default function CanIScreenwriteWorkbench({ onOpenCreativeAuthoring, onUniverseAssistant, onOpenBudget, budgetWorkRequest, onOpenModels, onOpenAssistant, onAssistantContext, onDraftStatusChange, project, records, api, open, sceneId, onClose, onSaved, onProduction, onSceneSelect, onStoryboardShot, onGenerationScene, onTakes, onDcc, onDccScene, onDocuments, onCasting, onGeneration, onSourceSelection, onChooseContext, flow, onHandoff, modeRequest, sourceStatus }: Props) {
  const [coverageSceneId, setCoverageSceneId] = useState(sceneId);
  const [passageRequest, setPassageRequest] = useState<{ sceneId: string; paragraphId: string; nonce: number; work?: 'breakdown' }>();
  const [coverageDirty, setCoverageDirty] = useState(false);
  const [creativeDirty, setCreativeDirty] = useState(false);
  const [nodeDirty, setNodeDirty] = useState(false);
  const [directionDirty, setDirectionDirty] = useState(false);
  const [assetDirty, setAssetDirty] = useState(false);
  const [universeDirty, setUniverseDirty] = useState(false);
  const [libraryView, setLibraryView] = useState<'universe' | 'sources'>('universe');
  const [libraryAssetRequest, setLibraryAssetRequest] = useState<{ sha256: string; nonce: number }>();
  const [worldEntryRequest, setWorldEntryRequest] = useState<{ id: string; nonce: number }>();
  const [universe, setUniverse] = useState<UniverseCatalog>();
  const [universeLoading, setUniverseLoading] = useState(false), [universeError, setUniverseError] = useState('');
  const [universeRefresh, setUniverseRefresh] = useState(0);
  const universeClaims = useRef(new Map<string, { id: string; requestId: string }>());
  const [contextVisible, setContextVisible] = useState(false);
  useEffect(() => setCoverageSceneId(sceneId), [sceneId]);
  const [mode, setMode] = useState<WorkbenchMode>(modeRequest?.mode ?? 'write');
  const [movieContext, setMovieContext] = useState<MovieWorkspaceContext>('storyboard');
  const [movieViewRequest, setMovieViewRequest] = useState<MovieWorkspaceViewRequest>(() => modeRequest?.openEditors || modeRequest?.movieView ? { view: modeRequest.movieView ?? 'timeline', ...(modeRequest.openEditors ? { openEditors: true } : {}), nonce: 1 } : undefined);
  const movieViewNonce = useRef(modeRequest?.openEditors || modeRequest?.movieView ? 1 : 0);
  const appliedModeRequest = useRef(modeRequest);
  const appliedBudgetWork = useRef<number>();
  const [captureKind, setCaptureKind] = useState<'writing-note' | 'concept-draft'>('writing-note');
  const [localRecords, setLocalRecords] = useState<WorkspaceRecord[]>([]);
  const [editors, setEditors] = useState<Partial<Record<AuthoringKind, Editing>>>({});
  const [pending, setPending] = useState<{ kind: AuthoringKind; edit: Editing } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [pitchSourcesVisible, setPitchSourcesVisible] = useState(false);
  const [loreRequest, setLoreRequest] = useState<{ id: string; nonce: number; pageNumber?: number; sha256?: string; textSha256?: string }>();
  const [writing, setWriting] = useState<WritingContext | null>(null);
  const [history, setHistory] = useState<WorkspaceRecord[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const writer = useRef<ScreenwritingHandle>(null);
  const workbench = useRef<HTMLDivElement>(null);
  const closeWorkbench = useRef(onClose); closeWorkbench.current = onClose;
  const workbenchBusy = useRef(busy); workbenchBusy.current = busy;
  const attempts = useRef<Record<string, { fingerprint: string; requestId: string }>>({});
  const operation = useRef(0);
  const alive = useRef(true);
  const scope = `${project.id}:${project.sourceHash}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const allRecords = useMemo(() => {
    const map = new Map<string, WorkspaceRecord>();
    for (const record of [...records, ...localRecords]) if (!map.has(record.id) || map.get(record.id)!.version < record.version) map.set(record.id, record);
    return [...map.values()];
  }, [records, localRecords]);
  useEffect(() => {
    if (!open || mode !== 'library') return;
    const controller = new AbortController(); setUniverseLoading(true); setUniverseError('');
    universeApi.load(project, controller.signal).then(value => { if (!controller.signal.aborted) setUniverse(value); }).catch(caught => { if (!controller.signal.aborted) setUniverseError(message(caught)); }).finally(() => { if (!controller.signal.aborted) setUniverseLoading(false); });
    return () => controller.abort();
  }, [open, mode, libraryView, project, allRecords, universeRefresh]);
  const authoring = allRecords.filter(record => AUTHORING_KINDS.includes(record.kind) && !isCreativeRecord(record));
  const kind: AuthoringKind | null = mode === 'braindump' ? captureKind : mode === 'knowledge' ? 'writing-note' : mode === 'plan' ? 'story-plan-draft' : mode === 'pitch' ? 'pitch-draft' : null;
  const edit = kind ? editors[kind] : undefined;
  const dirty = Boolean(coverageDirty || creativeDirty || nodeDirty || assetDirty || universeDirty || directionDirty || writing?.dirty || writing?.sessionDirty || Object.values(editors).some(item => item && isDirty(item)));
  const unsavedAreas = [
    ...(writing?.dirty || writing?.sessionDirty ? [{ id: 'writing', label: `${writing?.title ?? 'Writing'}${writing?.sessionDirty ? ' · unfinished session' : ' · writing draft'}`, onOpen: () => go('write') }] : []),
    ...(nodeDirty ? [{ id: 'movie', label: 'Movie drafts · sequence, clips & frames', onOpen: () => go('nodes') }] : []),
    ...(coverageDirty ? [{ id: 'coverage', label: 'Scene coverage', onOpen: () => go('scenes') }] : []),
    ...(creativeDirty ? [{ id: 'creative', label: 'Creative tools', onOpen: () => go('creative') }] : []),
    ...(directionDirty ? [{ id: 'direction', label: 'Production direction', onOpen: () => go('pipeline') }] : []),
    ...(assetDirty ? [{ id: 'assets', label: 'Library asset edits', onOpen: () => { setLibraryView('sources'); go('library'); } }] : []),
    ...(universeDirty ? [{ id: 'universe', label: 'Universe & Story Bible drafts', onOpen: () => { setLibraryView('universe'); go('library'); } }] : []),
    ...Object.entries(editors).flatMap(([target, item]) => item && isDirty(item) ? [{ id: target, label: `${item.data.title || kindLabel(target)} · ${kindLabel(target).toLowerCase()}`, onOpen: () => editorMode(target as AuthoringKind) }] : []),
  ];
  const unsavedAreaRoutes = useRef(unsavedAreas); unsavedAreaRoutes.current = unsavedAreas;
  // Send only stable draft metadata; the mounted workbench keeps ownership of edits and routes.
  const draftStatusKey = canonicalJson({ scope, dirty, areas: unsavedAreas.map(({ id, label }) => ({ id, label })) });
  useEffect(() => { onDraftStatusChange?.(JSON.parse(draftStatusKey) as WorkbenchDraftStatus); }, [draftStatusKey, onDraftStatusChange]);
  const savedForEdit = edit?.baseline ?? undefined;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.querySelectorAll<HTMLElement>('.studio-header,.studio-layout'));
    const priorInert = background.map(element => element.inert);
    document.body.style.overflow = 'hidden'; background.forEach(element => { element.inert = true; });
    (workbench.current?.querySelector<HTMLButtonElement>('.studio-phase-tabs [role="tab"][aria-selected="true"], .maker-workspace-nav > button[aria-current="page"], .maker-primary-workspaces button[aria-current="step"]') ?? workbench.current?.querySelector<HTMLButtonElement>('.canis-project'))?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !workbenchBusy.current) { event.preventDefault(); closeWorkbench.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(workbench.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]') ?? []).filter(element => {
        if (element.tabIndex < 0) return false;
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (current.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
          if (current instanceof HTMLDetailsElement && !current.open && !current.querySelector(':scope > summary')?.contains(element)) return false;
          if (current === workbench.current) break;
        }
        return true;
      });
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !workbench.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !workbench.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; background.forEach((element, index) => { element.inert = priorInert[index]; }); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [open]);
  useEffect(() => {
    if (!modeRequest || modeRequest === appliedModeRequest.current || busy) return;
    appliedModeRequest.current = modeRequest;
    if (modeRequest.resumeDraftId) unsavedAreaRoutes.current.find(area => area.id === modeRequest.resumeDraftId)?.onOpen();
    else {
      if (onOpenCreativeAuthoring && ['write', 'braindump', 'plan', 'pitch', 'drafts', 'templates'].includes(modeRequest.mode)) onOpenCreativeAuthoring(modeRequest.mode);
      else setMode(modeRequest.mode);
      if (modeRequest.openEditors || modeRequest.movieView) setMovieViewRequest({ view: modeRequest.movieView ?? 'timeline', ...(modeRequest.openEditors ? { openEditors: true } : {}), nonce: ++movieViewNonce.current });
    }
  }, [modeRequest, busy, onOpenCreativeAuthoring]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty && !workbench.current?.querySelector('[data-unsaved="true"]')) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const retain = useCallback((record: WorkspaceRecord) => {
    setLocalRecords(previous => [...previous.filter(item => item.id !== record.id), record]); onSaved(record);
  }, [onSaved]);
  const observeWriting = useCallback((context: WritingContext) => { setWriting(context); onAssistantContext?.(context); }, [onAssistantContext]);
  function selectScene(id: string) {
    if (id === '__prologue__' && project.prologue?.length) setCoverageSceneId(id);
    else if (project.scenes.some(scene => scene.id === id)) { setCoverageSceneId(id); onSceneSelect?.(id); }
  }
  function openMovieView(view: MovieWorkspaceView, targetSceneId?: string, shotId?: string, cellId?: string, openEditors = false) {
    if (busy) return;
    if (targetSceneId && !project.scenes.some(scene => scene.id === targetSceneId)) { setError('That scene is unavailable in this project.'); return; }
    if (shotId && !project.scenes.find(scene => scene.id === targetSceneId)?.shots.some(shot => shot.id === shotId)
      || cellId && (!shotId || !project.cells.some(cell => cell.id === cellId && cell.sceneId === targetSceneId && cell.shotId === shotId))) {
      setError('That storyboard shot or frame is unavailable in this project. Reopen its current source link.'); return;
    }
    setMovieViewRequest({ view, sceneId: targetSceneId, ...(shotId ? { shotId } : {}), ...(cellId ? { cellId } : {}), ...(openEditors ? { openEditors: true } : {}), nonce: ++movieViewNonce.current });
    go('nodes');
  }
  function readMovieSource(sourceSceneId: string, paragraphId: string) {
    const paragraphs = sourceSceneId === '__prologue__' ? project.prologue ?? [] : project.scenes.find(scene => scene.id === sourceSceneId)?.paragraphs ?? [];
    if (!paragraphs.some(paragraph => paragraph.id === paragraphId)) { setError('That passage is unavailable in the retained screenplay. Reopen its current source link.'); return; }
    selectScene(sourceSceneId);
    writer.current?.focusSourcePassage(sourceSceneId, paragraphId);
    go('write');
  }
  function openElementTool(action: ScreenplayConnectionAction, sourceSceneId: string, paragraphId: string) {
    if (busy) return;
    const sourceScene = project.scenes.find(item => item.id === sourceSceneId);
    const paragraphs = sourceSceneId === '__prologue__' ? project.prologue ?? [] : sourceScene?.paragraphs ?? [];
    if (!paragraphs.some(item => item.id === paragraphId)) { setError('That passage is unavailable in the retained source. Reopen the scene before continuing.'); return; }
    // The writer supplies the retained source identity, never a draft's positional scene number.
    if (action === 'library') { setLibraryView('sources'); go('library'); return; }
    if (action === 'review') { go('collaborate'); return; }
    if (action === 'project') { go('pipeline'); return; }
    if (action === 'documents') { if (onDocuments) onDocuments(); else setNotice('Open Documents from film preparation to work with project documents.'); return; }
    if (action === 'casting') { if (sourceScene) selectScene(sourceScene.id); if (onCasting) onCasting(); else setNotice('Casting is available from film preparation.'); return; }
    if (!sourceScene) { setNotice('Opening text has no production scene. Choose a scene to plan its shots, camera or clips.'); return; }
    selectScene(sourceScene.id);
    if (action === 'generation') { setPassageRequest({ sceneId: sourceScene.id, paragraphId, nonce: Date.now() }); go('scenes'); }
    else if (action === 'storyboard') {
      const matches = deriveStoryboardSequence(project, allRecords).shots.filter(shot => shot.sceneId === sourceScene.id).flatMap(shot => shot.cells.filter(cell => cell.actionRefs?.includes(paragraphId)).map(cell => ({ shotId: shot.id, cellId: cell.id })));
      const shotIds = [...new Set(matches.map(match => match.shotId))];
      openMovieView('storyboard', sourceScene.id, shotIds.length === 1 ? shotIds[0] : undefined, matches.length === 1 ? matches[0].cellId : undefined);
      if (matches.length !== 1) setNotice(matches.length ? `This passage has ${matches.length} linked storyboard frames. Choose the moment to review.` : 'This passage has no linked storyboard frame yet. Choose a shot and add its source link.');
    }
    else if (action === 'camera') { if (onDccScene) onDccScene(sourceScene.id); else onDcc(); }
    else if (action === 'takes') { if (onTakes) onTakes(sourceScene.id); else setNotice('Takes are available from film preparation.'); }
  }
  function go(next: WorkbenchMode) { if (!busy) { if (onOpenCreativeAuthoring && ['write', 'braindump', 'plan', 'pitch', 'drafts', 'templates'].includes(next)) { onOpenCreativeAuthoring(next); return; } setMode(next); setNotice(''); setError(''); const content = document.querySelector('.canis-content'); if (content && typeof content.scrollTo === 'function') content.scrollTo({ top: 0, left: 0 }); } }
  function openUniverseOperation(action: UniverseOperation) {
    if (busy) return;
    // Universe collection selection never changes this working film or its scene IDs.
    if (action === 'overview') go('pipeline');
    else if (action === 'writing') go('write');
    else if (action === 'planning') go('plan');
    else if (action === 'casting') onCasting?.();
    else if (action === 'storyboard') openMovieView('storyboard', coverageSceneId);
    else if (action === 'generation') { if (onGenerationScene) onGenerationScene(coverageSceneId); else onGeneration?.(); }
    else if (action === 'camera') { if (onDccScene) onDccScene(coverageSceneId); else onDcc(); }
    else if (action === 'timeline') openMovieView('timeline', coverageSceneId, undefined, undefined, true);
    else if (action === 'comic') openMovieView('comic', coverageSceneId);
    else if (action === 'documents') onDocuments?.();
    else if (action === 'marketing') go('pitch');
    else if (action === 'delivery') go('submit');
    else if (action === 'assets') { setLibraryView('sources'); go('library'); }
    else if (action === 'models') onOpenModels?.();
    else if (action === 'assistant') onOpenAssistant?.();
  }
  function editorMode(target: AuthoringKind) {
    if (target === 'story-plan-draft') setMode('plan'); else if (target === 'pitch-draft') setMode('pitch');
    else { setMode('braindump'); setCaptureKind(target); }
  }
  function begin(target: AuthoringKind, data = emptyAuthoring(target, project.sourceHash), baseline: WorkspaceRecord | null = null) {
    const initial = baseline ? canonicalJson(baseline.data) : canonicalJson(emptyAuthoring(target, project.sourceHash));
    const next: Editing = { id: baseline?.id ?? `${target}:${crypto.randomUUID()}`, data: structuredClone(data), baseline, initial };
    editorMode(target); setError(''); setNotice('');
    if (editors[target] && isDirty(editors[target]!)) setPending({ kind: target, edit: next }); else setEditors(previous => ({ ...previous, [target]: next }));
  }
  async function developUniverse(entity: UniverseEntity, rights = false) {
    if (!universe || busy) return;
    const capturedScope = scope, serial = ++operation.current;
    setBusy(true); setError('');
    const current = () => alive.current && currentScope.current === capturedScope && operation.current === serial;
    try {
      const note = await universeDevelopmentNote(project, entity, universe, allRecords, api.history, rights);
      if (current()) { begin('writing-note', note); setNotice('Story Bible context and saved source links copied into a development draft. Save the note to retain it.'); }
    } catch (caught) { if (current()) setError(message(caught)); }
    finally { if (current()) setBusy(false); }
  }
  function openSourceRecord(record: WorkspaceRecord) {
    if (record.kind.startsWith('universe-')) {
      const data = record.data as { entityId?: string; fromEntityId?: string };
      const entityId = data.entityId ?? data.fromEntityId;
      if (!entityId) { setError('Open this relationship in the Story Bible to inspect its endpoints.'); return; }
      setWorldEntryRequest({ id: entityId, nonce: Date.now() }); setLibraryView('universe'); go('library');
    } else openRecord(record);
  }

  function askUniverse(entity: UniverseEntity | null) {
    if (!universe || !entity) return;
    const profile = universe.drafts.find(record => record.kind === 'universe-profile' && record.data.sourceHash === project.sourceHash && 'entityId' in record.data && record.data.entityId === entity.id);
    onUniverseAssistant?.({ projectId: project.id, sourceHash: project.sourceHash, title: entity.name, text: universeContextText(entity, universe), ...(profile ? { profileRef: { id: profile.id, sha256: profile.sha256 } } : {}), nonce: crypto.randomUUID() });
  }
  async function createUniverse(data: UniverseEntityDraft) {
    const id = `universe-entity:${data.entityId}`, fingerprint = canonicalJson(data);
    if (attempts.current[id]?.fingerprint !== fingerprint) attempts.current[id] = { fingerprint, requestId: crypto.randomUUID() };
    const record = await universeApi.save(project, id, 'universe-entity', data, null, attempts.current[id].requestId);
    if (alive.current && currentScope.current === scope) retain(record);
    return record;
  }
  async function saveUniverseClaim(data: UniverseClaimDraft) {
    const fingerprint = canonicalJson(data); let attempt = universeClaims.current.get(fingerprint);
    if (!attempt) { attempt = { id: `universe-claim:${crypto.randomUUID()}`, requestId: crypto.randomUUID() }; universeClaims.current.set(fingerprint, attempt); }
    const record = await universeApi.save(project, attempt.id, 'universe-claim', data, null, attempt.requestId);
    if (alive.current && currentScope.current === scope) retain(record);
    return record;
  }
  async function saveUniverseLink(data: UniverseLinkDraft) {
    const fingerprint = canonicalJson(data); let attempt = universeClaims.current.get(`link:${fingerprint}`);
    if (!attempt) { attempt = { id: `universe-link:${crypto.randomUUID()}`, requestId: crypto.randomUUID() }; universeClaims.current.set(`link:${fingerprint}`, attempt); }
    const record = await universeApi.save(project, attempt.id, 'universe-link', data, null, attempt.requestId);
    if (alive.current && currentScope.current === scope) retain(record);
    return record;
  }
  async function saveUniverseAgent(data: UniverseAgentDraft, expectedVersion: number | null, requestId: string) {
    const record = await universeApi.save(project, `universe-agent:${data.entityId}`, 'universe-agent', data, expectedVersion, requestId);
    if (alive.current && currentScope.current === scope) retain(record);
    return record;
  }
  async function saveUniverseContinuity(data: UniverseContinuityDraft, expectedVersion: number | null, requestId: string) {
    const record = await universeApi.save(project, `universe-continuity-plan:${data.sourceHash ?? data.projectId}`, 'universe-continuity-plan', data, expectedVersion, requestId);
    if (alive.current && currentScope.current === scope) retain(record);
    return record;
  }
  async function saveUniverseProductionPlan(data: UniverseProductionPlanDraft, expectedVersion: number | null, requestId: string) {
    const record = await universeApi.save(project, `universe-production-plan:${data.entityId}`, 'universe-production-plan', data, expectedVersion, requestId);
    if (alive.current && currentScope.current === scope) retain(record);
    return record;
  }
  async function saveUniverseProfile(data: UniverseProfileDraft, expectedVersion: number | null, requestId: string) {
    const record = await universeApi.save(project, `universe-profile:${data.entityId}`, 'universe-profile', data, expectedVersion, requestId);
    if (alive.current && currentScope.current === scope) retain(record);
    return record;
  }
  async function saveWorldRehearsal(id: string, data: WorldRehearsalDraft, expectedVersion: number | null, requestId: string) {
    const record = await universeApi.save(project, id, 'universe-rehearsal', data, expectedVersion, requestId);
    if (alive.current && currentScope.current === scope) retain(record);
    return record;
  }
  function readUniverseSource(citation: UniverseCitation) {
    if (citation.kind === 'LORE_SOURCE' || citation.kind === 'LORE_PAGE') { setLoreRequest({ id: citation.sourceId, sha256: citation.sourceSha256, ...(citation.pageNumber !== null ? { pageNumber: citation.pageNumber } : {}), ...(citation.textSha256 ? { textSha256: citation.textSha256 } : {}), nonce: Date.now() }); go('lore'); }
    else if (citation.kind === 'ASSET_IMAGE') {
      const asset = allRecords.find(record => record.kind === 'project-asset' && record.id === citation.sourceId && record.sha256 === citation.sourceSha256);
      if (!asset) { setNotice('This exact source asset revision is unavailable. Refresh saved records before opening it.'); return; }
      setLibraryAssetRequest({ sha256: (asset.data as ProjectAsset).asset.sha256, nonce: Date.now() });
      setLibraryView('sources');
    }
    else if (citation.kind === 'SOURCE_PARAGRAPH' && citation.paragraphId) readMovieSource(citation.sceneId ?? '__prologue__', citation.paragraphId);
    else if (citation.sceneId) { selectScene(citation.sceneId); go('scenes'); }
    else { setNotice('This citation belongs to the frozen character profile. Its exact description appears in casting.'); onCasting?.(); }
  }
  function castUniverse(entity: UniverseEntity) {
    const ids = entity.citations.filter(citation => citation.kind === 'SOURCE_CHARACTER').map(citation => citation.sourceId);
    const record = allRecords.find(item => item.kind === 'casting-draft' && ids.includes((item.data as { characterId: string }).characterId));
    const targetScene = entity.sceneIds[0] ?? coverageSceneId;
    if (record) openNodeTool('casting', targetScene, { nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: targetScene, recordRef: { id: record.id, kind: record.kind, sha256: record.sha256 }, intent: 'OPEN_RECORD' });
    else if (ids.length) onCasting?.();
    else developUniverse(entity);
  }
  function update(data: EditableAuthoring) { if (kind && edit && !busy) { setEditors(previous => ({ ...previous, [kind]: { ...edit, data } })); setNotice(''); } }
  async function save() {
    if (!kind || !edit || busy || !edit.data.title.trim()) return;
    const targetKind = kind, captured = edit;
    const data = structuredClone(edit.data), expectedVersion = edit.baseline?.version ?? null;
    const fingerprint = canonicalJson({ id: edit.id, data, expectedVersion });
    if (attempts.current[edit.id]?.fingerprint !== fingerprint) attempts.current[edit.id] = { fingerprint, requestId: crypto.randomUUID() };
    const serial = ++operation.current; setBusy(true); setError('');
    const current = () => alive.current && currentScope.current === scope && operation.current === serial;
    try {
      const record = await api.saveRecord({ id: edit.id, kind, data, expectedVersion, requestId: attempts.current[edit.id].requestId });
      if (record.id !== edit.id || record.kind !== kind || record.version !== (expectedVersion ?? 0) + 1 || canonicalJson(record.data) !== canonicalJson(data)) throw new Error('The save response did not match the submitted draft.');
      if (current()) { retain(record); setEditors(previous => ({ ...previous, [targetKind]: { ...captured, data, baseline: record, initial: canonicalJson(data) } })); setNotice(`${kindLabel(kind)} saved · v${record.version}`); }
    } catch (caught) { if (current()) setError(`${message(caught)} Your open edits are retained. Refresh the library to inspect saved versions.`); }
    finally { if (current()) setBusy(false); }
  }
  async function refresh() {
    if (busy) return;
    const serial = ++operation.current; setBusy(true); setError('');
    try {
      const boot = await api.bootstrap();
      if (boot.project.id !== project.id || boot.project.sourceHash !== project.sourceHash) throw new Error('Workspace source changed. Reopen the studio.');
      if (alive.current && currentScope.current === scope && serial === operation.current) { setLocalRecords(boot.records); setNotice('Saved records refreshed. Open edits are retained.'); }
    } catch (caught) { if (alive.current && serial === operation.current) setError(message(caught)); }
    finally { if (alive.current && serial === operation.current) setBusy(false); }
  }
  function openRecord(record: WorkspaceRecord) {
    if (onOpenCreativeAuthoring && isCreativeRecord(record)) { onOpenCreativeAuthoring(record.kind === 'story-plan-draft' ? 'plan' : record.kind === 'pitch-draft' ? 'pitch' : record.kind === 'screenplay-draft' ? 'write' : 'braindump'); return; }
    if (record.kind === 'screenplay-draft') { setMode('write'); writer.current?.openDraft(record.id); }
    else if (['writing-note', 'concept-draft', 'story-plan-draft', 'pitch-draft'].includes(record.kind)) begin(record.kind as AuthoringKind, record.data as EditableAuthoring, record);
  }
  function openNodeTool(tool: string, id: string, request?: NodeRecordRequest) {
    const selectedRecord = request && allRecords.find(record => record.id === request.recordRef.id && record.sha256 === request.recordRef.sha256 && record.kind === request.recordRef.kind);
    if (request && (request.projectId !== project.id || request.sourceHash !== project.sourceHash || request.sceneId !== id || !selectedRecord)) { setError('That exact saved version is unavailable. Refresh its node or asset uses before opening it.'); return; }
    selectScene(id);
    if (tool === 'writing') { if (selectedRecord) openRecord(selectedRecord); else go('write'); }
    else if (tool === 'scene') go('scenes');
    else if (tool === 'lore' && selectedRecord?.kind === 'lore-source') { setLoreRequest({ id: selectedRecord.id, sha256: selectedRecord.sha256, nonce: Date.now() }); go('lore'); }
    else if (tool === 'context') { if (onChooseContext) onChooseContext(request); else setError('Clip context is unavailable in this client.'); }
    else if (tool === 'casting') { if (onCasting) onCasting(request); else onProduction(); }
    else if (tool === 'dcc') { if (onDccScene) onDccScene(id); else onDcc(); }
    else if (tool === 'generation') { if (onGenerationScene) onGenerationScene(id, request); else (onGeneration ?? onProduction)(); }
    else if (tool === 'takes') { if (onTakes) onTakes(id, request); else onProduction(); }
  }
  const routeBudgetWork = useRef<() => void>();
  routeBudgetWork.current = () => {
    if (!open || busy || !budgetWorkRequest || appliedBudgetWork.current === budgetWorkRequest.nonce) return;
    appliedBudgetWork.current = budgetWorkRequest.nonce;
    const destination = budgetWorkDestination(budgetWorkRequest, project, allRecords);
    if (destination.kind === 'unavailable') { setError(destination.reason); return; }
    setError('');
    if (destination.kind === 'shot') openMovieView('storyboard', destination.sceneId, destination.shotId);
    else if (destination.kind === 'scene') { selectScene(destination.sceneId); go('scenes'); }
    else if (destination.kind === 'asset') { setLibraryAssetRequest({ sha256: destination.sha256, nonce: budgetWorkRequest.nonce }); setLibraryView('sources'); go('library'); }
    else if (destination.kind === 'world') { setWorldEntryRequest({ id: destination.entityId, nonce: budgetWorkRequest.nonce }); setLibraryView('universe'); go('library'); }
    else if (destination.kind === 'project') go('pipeline');
    else {
      const record = destination.record;
      if (AUTHORING_KINDS.includes(record.kind) && (!isCreativeRecord(record) || onOpenCreativeAuthoring)) openRecord(record);
      else if (record.kind === 'coverage-draft') {
        const paragraphId = (record.data as { paragraphId: string }).paragraphId;
        const sourceSceneId = project.scenes.find(scene => scene.paragraphs.some(paragraph => paragraph.id === paragraphId))?.id ?? (project.prologue?.some(paragraph => paragraph.id === paragraphId) ? '__prologue__' : undefined);
        if (!sourceSceneId) { setError('This breakdown passage is no longer available. Refresh the project.'); return; }
        selectScene(sourceSceneId); setPassageRequest({ sceneId: sourceSceneId, paragraphId, nonce: budgetWorkRequest.nonce, work: 'breakdown' }); go('scenes');
      } else if (record.kind === 'movie-sequence') openMovieView('timeline');
      else if (['generation-brief', 'casting-draft', 'scene-plan'].includes(record.kind)) {
        const targetScene = (record.data as { sceneId?: string }).sceneId ?? coverageSceneId;
        openNodeTool(record.kind === 'generation-brief' ? 'generation' : record.kind === 'casting-draft' ? 'casting' : 'scene', targetScene, { nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: targetScene, recordRef: { id: record.id, sha256: record.sha256, kind: record.kind }, intent: 'OPEN_RECORD' });
      } else { setHistory([record]); setHistoryIndex(0); go('drafts'); }
    }
  };
  useEffect(() => { routeBudgetWork.current?.(); }, [open, busy, budgetWorkRequest, project, allRecords]);
  function openAssetUsage(usage: AssetUsage) {
    const record = allRecords.find(item => item.id === usage.record.id && item.sha256 === usage.record.sha256 && item.kind === usage.record.kind);
    if (!record) { setError('This usage has changed. Refresh project files to inspect its current saved revision.'); return; }
    if (record.kind === 'comic-draft' || record.kind === 'comic-package') { openMovieView('comic'); return; }
    if (record.kind === 'shot-keyframes' || record.kind === 'storyboard-cell') {
      const target = record.data as { sceneId: string; shotId: string; cellId?: string };
      openMovieView('storyboard', target.sceneId, target.shotId, record.kind === 'storyboard-cell' ? target.cellId : undefined); return;
    }
    const kindToTool: Record<string, string> = { 'generation-brief': 'generation', 'measured-media-take': 'takes', 'casting-draft': 'casting', 'context-bundle': 'context', 'lore-source': 'lore', 'screenplay-draft': 'writing', 'writing-note': 'writing', 'concept-draft': 'writing', 'story-plan-draft': 'writing', 'pitch-draft': 'writing' };
    const tool = kindToTool[record.kind];
    if (!tool) { setHistory([record]); setHistoryIndex(0); go('drafts'); return; }
    const dataScene = (record.data as { sceneId?: string }).sceneId;
    const targetScene = project.scenes.find(scene => scene.id === dataScene)?.id ?? usage.sceneIds[0] ?? coverageSceneId;
    openNodeTool(tool, targetScene, { nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: targetScene, recordRef: { id: record.id, kind: record.kind, sha256: record.sha256 }, intent: 'OPEN_RECORD' });
  }
  async function showHistory(record: WorkspaceRecord) {
    if (!api.history) { setError('History transport is unavailable in this client.'); return; }
    const serial = ++operation.current; setBusy(true); setError('');
    try {
      const rows = await api.history(record.id);
      if (alive.current && serial === operation.current) { setHistory(rows); setHistoryIndex(rows.length - 1); setMode('drafts'); }
    } catch (caught) { if (alive.current && serial === operation.current) setError(message(caught)); }
    finally { if (alive.current && serial === operation.current) setBusy(false); }
  }
  async function exportBundle() {
    setBusy(true); setError('');
    try { const bundle = await buildAuthoringBundle(project, allRecords); download(JSON.stringify(bundle, null, 2), 'caniscreenwrite-authoring-bundle.json'); setNotice('Saved authoring bundle prepared for download. Unsaved edits are excluded.'); }
    catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  async function exportPitch(format: 'pdf' | 'docx') {
    if (kind !== 'pitch-draft' || !edit || busy) return;
    const snapshot = structuredClone(edit.data) as PitchDraft;
    const description = writingExportScope(isDirty(edit), edit.baseline?.version);
    setBusy(true); setError('');
    try {
      const artifact = format === 'pdf' ? createPitchPdf(snapshot, description) : await createPitchDocx(snapshot, description);
      if (!alive.current || currentScope.current !== scope) return;
      downloadLocalBlob(artifact.blob, artifact.filename);
      setNotice(`${format.toUpperCase()} pitch prepared · ${description}. Confirm the save destination to finish exporting.${artifact.warnings?.length ? ` ${artifact.warnings.join(' ')}` : ''}`);
    } catch (caught) { if (alive.current) setError(message(caught)); }
    finally { if (alive.current) setBusy(false); }
  }
  const modeLabel = WORKBENCH_MODES.find(item => item[0] === mode)?.[1] ?? 'Write';
  const visibleLibrary = authoring.filter(record => record.kind !== 'writing-session' && titleOf(record).toLowerCase().includes(query.toLowerCase()));
  const selectedHistory = history[historyIndex];
  const currentAuthoring = authoring.filter(record => record.kind === kind && (mode !== 'knowledge' || (record.data as WritingNote).category === 'RESEARCH'));
  const diffBody = (record: WorkspaceRecord | undefined) => record && 'body' in (record.data as object) ? String((record.data as { body: string }).body) : record ? JSON.stringify(record.data, null, 2) : '';
  const contextRecord = edit ? savedForEdit : writing?.saved;
  const writingActions = <nav aria-label="Script workflow">{([['write', 'Edit script'], ['insights', 'Analyze script'], ['creative', 'AI assistance']] as const).map(([target, label]) => <button key={target} disabled={busy} aria-current={mode === target ? 'page' : undefined} onClick={() => go(target)}>{label}</button>)}{onOpenBudget && writing?.saved && <button onClick={() => onOpenBudget(recordBudgetTarget(writing.saved!))}>Writing costs</button>}</nav>;

  return <div ref={workbench} className="canis-workbench" data-mode={mode} data-context={contextVisible ? 'open' : 'closed'} hidden={!open} data-unsaved={dirty ? 'true' : 'false'} role={open ? 'dialog' : undefined} aria-modal={false} aria-label="CanIScreenwrite local studio">
    <StudioHeader movieContext={movieContext} onEditors={() => openMovieView('timeline', undefined, undefined, undefined, true)} onCasting={onCasting ? () => onCasting() : undefined} onDocuments={onDocuments} onTakes={onTakes ? () => onTakes(coverageSceneId) : undefined} onChooseContext={onChooseContext ? () => onChooseContext() : undefined} projectTitle={project.title} mode={mode} busy={busy} dirty={dirty} unsavedAreas={unsavedAreas} writingDirty={Boolean(writing?.dirty)} onMode={next => { if (next === 'library') setLibraryView('universe'); go(next); }} onProduction={() => openMovieView('storyboard', coverageSceneId)} onDcc={onDcc} onGeneration={onGeneration} onAssistant={onOpenAssistant} onModels={onOpenModels} onBudget={onOpenBudget ? () => onOpenBudget() : undefined} onRefresh={() => void refresh()} onProjectDetails={() => setContextVisible(value => !value)} projectDetailsOpen={contextVisible} onStoryboard={() => openMovieView('storyboard', coverageSceneId)}/>
    <section className="canis-main">{!['pipeline', 'library', 'write', 'scenes', 'nodes'].includes(mode) && <header className="canis-top"><span className="eyebrow">CREATIVE WORKSPACE</span><h1>{modeLabel}</h1>{onOpenBudget && contextRecord && <button className="secondary" onClick={() => onOpenBudget(recordBudgetTarget(contextRecord))}>Costs for this work</button>}</header>}
      <div className="canis-content">{error && <p role="alert" className="error-bar">{error}</p>}{notice && <p role="status" className="canis-notice">{notice}</p>}{pending && <div className="screenwriting-switch" role="alert"><p>There are unsaved {kindLabel(pending.kind).toLowerCase()} edits. Keep editing or discard them before opening another record.</p><button className="secondary" onClick={() => setPending(null)}>Keep current edits</button><button className="secondary" onClick={() => { setEditors(previous => ({ ...previous, [pending.kind]: pending.edit })); setPending(null); }}>Discard and open record</button></div>}
        {['insights', 'creative'].includes(mode) && <section className="maker-script-workflow" aria-label="Current script workflow"><div><strong>{writing?.title || 'Choose your working script'}</strong><small>{writing?.dirty ? 'Unsaved changes retained in the writer' : writing?.saved ? `Working draft · saved v${writing.saved.version}` : 'Open a saved draft or start writing'}</small></div>{writingActions}</section>}
        <ScreenwritingPanel ref={writer} project={project} records={allRecords} api={api} open={open && mode === 'write'} sceneId={sceneId} onClose={onClose} onSaved={retain} embedded onOpenSource={openSourceRecord} workflowActions={writingActions} onContextChange={observeWriting} onElementAction={openElementTool}/>
        <MovieWorkspace onContextChange={setMovieContext} onOpenBudget={onOpenBudget} onReadSource={readMovieSource} key={`${project.id}:${project.sourceHash}`} api={api} onOpenShot={onStoryboardShot} project={project} records={allRecords} sceneId={coverageSceneId} open={open && mode === 'nodes'} viewRequest={movieViewRequest} onScene={selectScene} onSaved={retain} onDirty={setNodeDirty} onOpenTool={openNodeTool} onTakes={onTakes}/>
        <SceneWorkbench onBudget={onOpenBudget} onDocuments={onDocuments} project={project} records={allRecords} api={api} open={open && mode === 'scenes'} sceneId={coverageSceneId} onScene={selectScene} onSaved={retain} onPrepare={onSourceSelection} onDirty={setCoverageDirty} onElementAction={openElementTool} passageRequest={passageRequest} onOpenStoryboardFlow={() => openMovieView('storyboard', coverageSceneId)} onOpenStoryboard={(id, shotId, cellId) => openMovieView('storyboard', id, shotId, cellId)}/>
        <div hidden={!open || mode !== 'pipeline'}><StudioHome active={open && mode === 'pipeline'} onDocuments={onDocuments} onBudget={onOpenBudget ? () => onOpenBudget() : undefined} onConnections={onOpenModels} directionDirty={directionDirty} onUniverse={() => { setLibraryView('universe'); go('library'); }} direction={<ProjectDirectionPanel project={project} records={allRecords} api={api} onSaved={retain} onDirty={setDirectionDirty} onOpenWorkspace={workspace => { if (workspace === 'documents') onDocuments?.(); else if (workspace === 'storyboard' || workspace === 'timeline') openMovieView(workspace, coverageSceneId); else go(workspace); }} onOpenStage={stage => { if (stage === 'PREDEVELOPMENT' || stage === 'DEVELOPMENT') go('write'); else if (stage === 'PREPRODUCTION') openMovieView('storyboard', coverageSceneId); else if (stage === 'PRODUCTION' || stage === 'FINISHING') openMovieView('timeline', coverageSceneId); else if (stage === 'WRAP' || stage === 'DISTRIBUTION') onDocuments?.(); else go('pitch'); }}/>} project={project} records={allRecords} activeDraftId={writing?.saved?.id} sceneId={coverageSceneId} sourceStatus={sourceStatus} onMode={homeMode => { if (homeMode === 'library') setLibraryView('sources'); go(homeMode); }} onMovieView={openMovieView} onScene={selectScene} onStoryboard={id => openMovieView('storyboard', id)} onGeneration={id => onGenerationScene ? onGenerationScene(id) : (onGeneration ?? onProduction)()} onOpenDraft={openRecord} onTakes={onTakes}/></div>
        <CreativeTools activeWriting={writing} project={project} records={allRecords} api={api} open={open && mode === 'creative'} onDirty={setCreativeDirty} onSaved={retain} onPrepareDraft={data => { writer.current?.prepareDraft(data); go('write'); }} onPreparePlan={data => begin('story-plan-draft', data)} onPrepareNote={data => begin('writing-note', { ...emptyAuthoring('writing-note', project.sourceHash), ...data, category: 'REVISION', tags: ['ai-shot-proposal'] } as WritingNote)}/>
        {mode === 'library' && <nav className="canis-subnav" aria-label="Universe and source library"><button aria-pressed={libraryView === 'universe'} onClick={() => setLibraryView('universe')}>Worlds & canon</button><button aria-pressed={libraryView === 'sources'} onClick={() => setLibraryView('sources')}>Sources & assets</button></nav>}
        <div hidden={!open || mode !== 'library' || libraryView !== 'universe'}><UniverseLibrary onSaveContinuity={saveUniverseContinuity} onOpenBudget={onOpenBudget} onSaveProductionPlan={saveUniverseProductionPlan} entityRequest={worldEntryRequest} initialView="slate" onOperation={openUniverseOperation} project={project} records={allRecords} model={universe} loading={universeLoading} error={universeError} onRetry={() => setUniverseRefresh(value => value + 1)} onOpenSources={() => setLibraryView('sources')} onReadSource={readUniverseSource} onSceneSelect={id => { selectScene(id); go('scenes'); }} onCasting={castUniverse} onChooseContext={entity => developUniverse(entity)} onDevelopRights={entity => developUniverse(entity, true)} onNodes={id => openMovieView('storyboard', id)} onGenerate={id => onGenerationScene ? onGenerationScene(id) : onGeneration?.()} onAssistant={askUniverse} onCreateEntity={createUniverse} onSaveClaim={saveUniverseClaim} onSaveLink={saveUniverseLink} onSaveAgent={saveUniverseAgent} onSaveProfile={saveUniverseProfile} onSaveRehearsal={saveWorldRehearsal} onAgentResult={record => { if (alive.current && currentScope.current === scope) retain(record); }} onDirty={setUniverseDirty}/></div>
        <ProjectLibraryPanel onOpenBudget={onOpenBudget} assetRequest={libraryAssetRequest} universe={universe} universeLoading={universeLoading} universeError={universeError} onOpenWorld={id => { setWorldEntryRequest({ id, nonce: Date.now() }); setLibraryView('universe'); }} project={project} records={allRecords} open={open && mode === 'library' && libraryView === 'sources'} onSaved={retain} onDirty={setAssetDirty} onOpenUsage={openAssetUsage} onReadLore={(id, pageNumber, citation) => { setLoreRequest({ id, pageNumber, ...citation, nonce: Date.now() }); go('lore'); }}/>
        <LoreLibrary project={project} records={allRecords} api={api} open={open && mode === 'lore'} sourceRequest={loreRequest} onSaved={retain} onCreateResearch={note => begin('writing-note', note)}/>
        <div hidden={!open || mode !== 'pitch' || (Boolean(editors['pitch-draft']) && !pitchSourcesVisible)}><PitchDocuments project={project} records={allRecords} disabled={busy} onOpenDraft={data => { begin('pitch-draft', data); setPitchSourcesVisible(false); }}/></div>
        {kind && <section className="canis-editing"><div className="canis-section-top"><p className="canis-lead">{mode === 'plan' ? 'Arrange the beats and define what each scene changes.' : mode === 'pitch' ? 'Develop the whole project pitch and its presentation deck.' : mode === 'knowledge' ? 'Keep research and sources connected to your project.' : 'Capture a thought, then develop it into a concept.'}</p><>{mode === 'plan' && <button className="secondary" disabled={busy} onClick={() => { try { begin('story-plan-draft', retainedStoryPlan(project)); } catch (caught) { setError(message(caught)); } }}>Start plan from retained screenplay</button>}{mode === 'pitch' && edit && <button className="secondary" aria-expanded={pitchSourcesVisible} disabled={busy} onClick={() => setPitchSourcesVisible(value => !value)}>{pitchSourcesVisible ? 'Close source builder' : 'Build from saved sources'}</button>}<button className="primary" disabled={busy} onClick={() => begin(kind, mode === 'knowledge' ? { ...emptyAuthoring('writing-note', project.sourceHash), category: 'RESEARCH' } as WritingNote : kind === 'pitch-draft' ? { ...emptyAuthoring(kind, project.sourceHash), title: project.title } : undefined)}>New {kindLabel(kind).toLowerCase()}</button></></div>{mode === 'braindump' && <div className="canis-subnav"><button aria-pressed={captureKind === 'writing-note'} onClick={() => setCaptureKind('writing-note')}>Notes</button><button aria-pressed={captureKind === 'concept-draft'} onClick={() => setCaptureKind('concept-draft')}>Concepts</button></div>}
          <details className="development-draft-browser" open={!edit || undefined}><summary>Saved {kindLabel(kind).toLowerCase()} drafts · {currentAuthoring.length}</summary><p>Continue an existing draft here. Use Drafts to inspect earlier revisions.</p><div className="canis-record-list">{currentAuthoring.map(record => <button key={record.id} aria-pressed={edit?.id === record.id} onClick={() => begin(kind, record.data as EditableAuthoring, record)}><strong>{titleOf(record)}</strong><small>v{record.version}</small></button>)}{!currentAuthoring.length && <p>No saved {kindLabel(kind).toLowerCase()} yet.</p>}</div></details>
          {edit ? <><AuthoringSourceLinks key={`${edit.id}:sources`} project={project} inputRefs={edit.data.inputRefs ?? []} records={allRecords} api={api} disabled={busy} onOpenCurrent={openSourceRecord}/><>{kind === 'pitch-draft' ? <ProjectPitchEditor key={edit.id} imageAssets={allRecords.filter(record => record.kind === 'project-asset' && (record.data as ProjectAsset).family === 'IMAGE').map(record => record.data as ProjectAsset)} draft={edit.data as PitchDraft} disabled={busy} onChange={update} scope={writingExportScope(isDirty(edit), edit.baseline?.version)}/> : <AuthoringForm key={edit.id} kind={kind} data={edit.data} disabled={busy} onChange={update} onOpenScene={kind === 'story-plan-draft' && savedForEdit && !isDirty(edit) ? draftSceneId => { const savedPlan = savedForEdit.data as StoryPlanDraft; writer.current?.prepareDraft({ title: `${savedPlan.title} · scene ${savedPlan.sceneIndex.find(item => item.id === draftSceneId)?.index}`, body: sceneDraftFountain(savedPlan, draftSceneId), inputRefs: [{ id: savedForEdit.id, sha256: savedForEdit.sha256 }] }); setMode('write'); } : undefined}/>}</><div className="canis-edit-footer"><span title={edit.baseline ? `Saved revision ${edit.baseline.version}` : undefined}>{isDirty(edit) ? 'Unsaved changes' : edit.baseline ? 'Saved locally' : 'New draft'}</span><button className="primary" disabled={busy || !edit.data.title.trim() || (!isDirty(edit) && Boolean(edit.baseline))} onClick={() => void save()}>Save {kindLabel(kind).toLowerCase()}</button></div>{kind === 'pitch-draft' && <div className="maker-pitch-exports"><div><strong>Companion written documents</strong><span>{writingExportScope(isDirty(edit), edit.baseline?.version)}</span></div><button className="secondary" disabled={busy || !edit.data.title.trim()} onClick={() => void exportPitch('pdf')}>Pitch PDF</button><button className="secondary" disabled={busy || !edit.data.title.trim()} onClick={() => void exportPitch('docx')}>Pitch DOCX</button></div>}{savedForEdit && !isDirty(edit) && <div className="canis-next"><span>Continue from this saved revision</span>{kind === 'writing-note' && <button onClick={() => begin('concept-draft', deriveAuthoring('concept-draft', savedForEdit, project))}>Develop as concept →</button>}{kind === 'concept-draft' && <button onClick={() => begin('story-plan-draft', deriveAuthoring('story-plan-draft', savedForEdit, project))}>Develop story plan →</button>}{kind === 'story-plan-draft' && <><button onClick={() => { const plan = savedForEdit.data as StoryPlanDraft; writer.current?.prepareDraft({ title: plan.title, body: storyPlanFountain(plan), inputRefs: [{ id: savedForEdit.id, sha256: savedForEdit.sha256 }] }); setMode('write'); }}>Open writing scaffold →</button><button onClick={() => begin('pitch-draft', deriveAuthoring('pitch-draft', savedForEdit, project))}>Prepare pitch →</button></>}{kind === 'pitch-draft' && <button onClick={() => go('bundle')}>Prepare export →</button>}</div>}</> : <p className="canis-empty">Choose a saved {kindLabel(kind).toLowerCase()} or start a new one.</p>}
        </section>}
        {mode === 'drafts' && <section><p className="canis-lead">Your saved writing and development records, with their versions.</p><label className="canis-search">Find a saved record<input aria-label="Search saved authoring records" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by title"/></label><div className="canis-library">{visibleLibrary.map(record => <article key={record.id}><div><small>{kindLabel(record.kind)} · v{record.version}</small><h2>{titleOf(record)}</h2></div><button disabled={record.kind === 'writing-session'} onClick={() => openRecord(record)}>Open →</button><button disabled={busy} onClick={() => void showHistory(record)}>History</button></article>)}{!visibleLibrary.length && <p className="canis-empty">No saved records match. Start in Write or Capture.</p>}</div>{selectedHistory && <section className="canis-history"><div className="canis-section-top"><h2>Version history · {titleOf(selectedHistory)}</h2><button onClick={() => setHistory([])}>Close history</button></div><div className="canis-subnav">{history.map((record, index) => <button key={record.version} aria-pressed={index === historyIndex} onClick={() => setHistoryIndex(index)}>v{record.version}</button>)}</div><p className="scope-note">Exact retained version. This view does not replace a newer record.</p><pre>{diffBody(selectedHistory)}</pre>{historyIndex > 0 && <details><summary>Changes from previous version</summary><div className="canis-diff">{boundedDiff(diffBody(history[historyIndex - 1]), diffBody(selectedHistory)).map((line, index) => <p key={index} data-change={line.type}>{line.type === 'add' ? '+ ' : line.type === 'remove' ? '− ' : '  '}{line.text}</p>)}</div></details>}{selectedHistory.kind === 'screenplay-draft' && <button className="secondary" onClick={() => { const data = selectedHistory.data as ScreenplayDraft; writer.current?.prepareDraft({ title: `${data.title} · from v${selectedHistory.version}`, body: data.body, inputRefs: [{ id: selectedHistory.id, sha256: selectedHistory.sha256 }] }); setMode('write'); }}>Fork this version into a new writing draft</button>}</section>}</section>}
        {mode === 'templates' && <section><p className="canis-lead">Start a separate draft with a structure you can change.</p><div className="canis-template-list">{TEMPLATES.map((template, index) => <article key={template.id}><span>0{index + 1}</span><div><h2>{template.title}</h2><p>{template.detail}</p><details><summary>Preview scaffold</summary><pre>{template.body || 'Empty Fountain draft'}</pre></details></div><button className="secondary" onClick={() => { writer.current?.prepareDraft({ title: template.title, body: template.body }); setMode('write'); }}>Use template →</button></article>)}</div><p className="scope-note">Template text is editable scaffolding, not material from the retained screenplay.</p></section>}
        {mode === 'insights' && <ScriptAnalysis body={writing?.body ?? ''} title={writing?.title ?? 'No draft selected'} dirty={writing?.dirty} savedVersion={writing?.saved?.version} onWrite={() => go('write')} onScene={index => { go('write'); requestAnimationFrame(() => writer.current?.focusScene(index)); }}/>}
        <LocalContinuity project={project} records={allRecords} api={api} open={open && mode === 'continuity'} onSaved={retain}/>
        {mode === 'bundle' && <section className="canis-bundle">{onChooseContext && <div className="canis-context-entry"><h2>Context for a clip</h2><p>Choose exact lore passages, saved writing notes and character reference images. Save a selection, then attach it in generation preparation.</p><button className="primary" onClick={() => onChooseContext()}>Choose clip context</button></div>}<h2>Authoring snapshot</h2><p className="canis-lead">Prepare a portable snapshot of the work saved in this project.</p><div className="canis-export-lines"><div><span>Saved authoring records</span><strong>{authoring.length}</strong></div><div><span>Retained screenplay reading view</span><strong>{project.scenes.length} scenes</strong></div><div><span>Reviewer observations</span><strong>{allRecords.filter(record => record.kind === 'review-observation').length}</strong></div></div><p>Exported records retain their version, source binding and content hash. Original FDX and media files remain in owned storage and milestone backups.</p><button className="primary" disabled={busy} onClick={() => void exportBundle()}>Export authoring bundle</button><button className="text-link" onClick={() => openMovieView('timeline', coverageSceneId)}>Prepare images, prompts and generation packages <span>↗</span></button></section>}
        <LocalReviewExchange project={project} records={allRecords} api={api} open={open && mode === 'collaborate'} onSaved={retain} onRefresh={refresh}/>
        {mode === 'submit' && <DeliveryOverview project={project} records={allRecords} onEditors={() => openMovieView('timeline', undefined, undefined, undefined, true)} onMode={go} onDocuments={onDocuments} onLibrary={() => { setLibraryView('sources'); go('library'); }}/>}
      </div></section>
    <aside className="canis-inspector" id="maker-project-details" hidden={!contextVisible}><span className="eyebrow">PROJECT CONTEXT</span><h2>{project.title}</h2><p>{mode === 'pitch' ? 'Whole-project pitch · story and production package' : `${project.scenes.length} source scenes · ${project.scenes.reduce((sum, scene) => sum + scene.shots.length, 0)} planned shots`}</p><div className="canis-context-section"><small>AUTHORING</small><strong>{writing?.title ?? 'No writing draft open'}</strong><span>{writing?.dirty ? 'Unsaved writing' : writing?.saved ? `Saved · v${writing.saved.version}` : 'New draft'}</span></div>{contextRecord && <div className="canis-context-section"><small>SELECTED SAVED RECORD</small><strong>{titleOf(contextRecord)}</strong><span>{kindLabel(contextRecord.kind)} · v{contextRecord.version}</span><details><summary>Revision details</summary><code>{contextRecord.sha256}</code></details>{'inputRefs' in (contextRecord.data as object) && ((contextRecord.data as { inputRefs?: { id: string; sha256: string }[] }).inputRefs ?? []).map(input => <p key={input.id}>{titleOf(allRecords.find(record => record.id === input.id) ?? { id: input.id, data: {} } as WorkspaceRecord)}<small>{allRecords.find(record => record.id === input.id)?.sha256 === input.sha256 ? 'Linked current revision' : allRecords.some(record => record.id === input.id) ? 'Source has a different revision; read its linked version' : 'Referenced revision not loaded'}</small></p>)}</div>}{onHandoff && contextRecord && ['write', 'plan', 'pitch', 'braindump', 'knowledge'].includes(mode) && <div className="canis-next workflow-authoring-action"><span>{titleOf(contextRecord)} · saved v{contextRecord.version}</span><button disabled={busy || (edit ? isDirty(edit) : Boolean(writing?.dirty))} onClick={() => onHandoff(contextRecord)}>Link this saved revision to production →</button>{(edit ? isDirty(edit) : Boolean(writing?.dirty)) && <small>Save open edits before linking them to production.</small>}</div>}{flow && mode !== 'pitch' && <section className="maker-flow-details"><h3>Production link · {project.scenes.find(item => item.id === sceneId)?.heading}</h3><WorkflowContextBar {...flow} stage="writing"/></section>}<div className="canis-context-section"><small>FILM SOURCE</small><p>Retained separately from writing drafts.</p><details><summary>Source fingerprint</summary><code>{project.sourceHash}</code></details></div><button className="text-link" onClick={() => openMovieView('storyboard', coverageSceneId)}>Movie storyboard <span>↗</span></button><button className="text-link" onClick={onDcc}>3D & cameras <span>↗</span></button></aside>
  </div>;
}


function boundedDiff(before: string, after: string) {
  if (before.split('\n').length * after.split('\n').length > 250000) return [{ type: 'equal' as const, text: 'This version is too large for an inline comparison. The exact retained text is available above.' }];
  return computeDiff(before, after);
}
