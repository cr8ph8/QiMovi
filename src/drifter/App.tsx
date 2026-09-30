import { STORYBOARD_FRAME_ROLE } from './filmmakingLanguage';
import ProductionBudgetPanel from './ProductionBudgetPanel';
import type { BudgetFocusRequest, BudgetWorkRequest } from './budgetNavigation';
import ModelConnectionsPanel from './ModelConnectionsPanel';
import CreativeProjectWorkspace, { type CreativeAreaRequest } from './CreativeProjectWorkspace';
import type { ProductionDestination } from './ProductionAttachmentPanel';
import AssistantPanel, { type UniverseAssistantContext } from './AssistantPanel';
import type { WritingContext } from './ScreenwritingPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceApi, WorkspaceError } from './api';
import CellImage from './CellImage';
import CastingEditor from './CastingEditor';
import CellEditor from './CellEditor';
import DocumentsPanel from './DocumentsPanel';
import DreaminaPanel from './DreaminaPanel';
import type { ShotPreparationRequest } from './shotPreparation';
import MediaTakesPanel, { type MediaTakeShotRequest } from './MediaTakesPanel';
import ContextBundlePanel from './ContextBundlePanel';
import SessionRecovery from './SessionRecovery';
import { canonicalJson } from './canonical';
import { validateRecord } from './validation';
import { checkNodeRequest } from './nodeRecordRequests';
import type { NodeRecordRequest } from './nodeWorkflowModel';
import CanIScreenwriteWorkbench, { type WorkbenchDraftStatus, type WorkbenchModeRequest } from './CanIScreenwriteWorkbench';
import type { MovieWorkspaceView } from './movieWorkspaceRouting';
import StudioHeader from './StudioHeader';
import QiMoviBrand from './QiMoviBrand';
import type { WorkbenchMode } from './workbenchModel';
import DccPanel from './DccPanel';
import WorkflowPanel from './WorkflowPanel';
import WorkflowContextBar from './WorkflowContextBar';
import { getWorkflowContext, type WorkflowContext, type FlowContextProps, type WorkflowStage } from './workflowApi';
import type { Bootstrap, CreativeBootstrap, WorkspaceBootstrap, CastingDraft, CellRole, ContextBundle, Project, ProductionHandoff, Scene, ScenePlan, SourceSelectionRequest, SegmentMethod, StoryCell, WorkspaceApi, WorkspaceRecord } from './types';

type View = 'room' | 'atlas' | 'score';
type Drawer = 'source' | 'casting' | 'reviews' | null;
const roles: CellRole[] = ['START', 'MOMENT', 'END'];
const duration = (ms: number) => `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(1).padStart(4, '0')}`;
const recordId = (sceneId: string) => `scene-plan:${sceneId}`;
const freshPlan = (scene: Scene, project: Project): ScenePlan => ({ sceneId: scene.id, sourceHash: project.sourceHash, notes: '', cellOverrides: [], timingObservations: [], segments: [], ...(project.cellBasisHashes?.[scene.id] ? { cellBasisHash: project.cellBasisHashes[scene.id] } : {}) });
function savedPlan(records: WorkspaceRecord[], sceneId: string) {
  return records.filter(record => record.kind === 'scene-plan' && record.id === recordId(sceneId)).sort((a, b) => b.version - a.version)[0];
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The local workspace did not confirm the request.';


function isFilmBootstrap(value: WorkspaceBootstrap): value is Bootstrap { return value.project.sourceHash !== null; }

export default function App({ api = workspaceApi }: { api?: WorkspaceApi }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [creativeBoot, setCreativeBoot] = useState<Pick<CreativeBootstrap, 'project' | 'records'> | null>(null);
  const [creativeOpen, setCreativeOpen] = useState(false);
  const [creativeDirty, setCreativeDirty] = useState(false);
  const [creativeAreaRequest, setCreativeAreaRequest] = useState<CreativeAreaRequest>();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantUniverse, setAssistantUniverse] = useState<UniverseAssistantContext | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetStarted, setBudgetStarted] = useState(false);
  const [budgetDirty, setBudgetDirty] = useState(false);
  const [budgetFocus, setBudgetFocus] = useState<BudgetFocusRequest>();
  const [budgetWorkRequest, setBudgetWorkRequest] = useState<BudgetWorkRequest>();
  const budgetNonce = useRef(0);
  const openBudget = (targetId?: string) => {
    if (boot) setBudgetFocus({ nonce: ++budgetNonce.current, projectId: boot.project.id, sourceHash: boot.project.sourceHash, ...(targetId ? { targetId } : {}) });
    setBudgetStarted(true); setBudgetOpen(true);
  };
  const [assistantWriting, setAssistantWriting] = useState<WritingContext | null>(null);
  const [assistantWritingScope, setAssistantWritingScope] = useState('');
  const [workbenchDraftStatus, setWorkbenchDraftStatus] = useState<WorkbenchDraftStatus>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsSession, setNeedsSession] = useState(false);
  const [token, setToken] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [cellId, setCellId] = useState('');
  const [view, setView] = useState<View>('room');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [documentsReturnToWorkbench, setDocumentsReturnToWorkbench] = useState(false);
  const [takesOpen, setTakesOpen] = useState(false);
  const [shotPreparationRequest, setShotPreparationRequest] = useState<ShotPreparationRequest>();
  const [generationRecordRequest, setGenerationRecordRequest] = useState<NodeRecordRequest>();
  const [takeRecordRequest, setTakeRecordRequest] = useState<NodeRecordRequest>();
  const [takeShotRequest, setTakeShotRequest] = useState<MediaTakeShotRequest>();
  const [takeReturnToWorkbench, setTakeReturnToWorkbench] = useState(false);
  const [castingTarget, setCastingTarget] = useState<{ characterId: string; record: WorkspaceRecord }>();
  const [nodeRouteError, setNodeRouteError] = useState('');
  const [screenwritingOpen, setScreenwritingOpen] = useState(true);
  const [modeRequest, setModeRequest] = useState<WorkbenchModeRequest>({ mode: 'library', nonce: 0 });
  const [dccOpen, setDccOpen] = useState(false);
  const [dccReturnToWorkbench, setDccReturnToWorkbench] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowStarted, setWorkflowStarted] = useState(false);
  const [workflowReturn, setWorkflowReturn] = useState<WorkflowStage>('film');
  const [workflowRequest, setWorkflowRequest] = useState<{ record: WorkspaceRecord; nonce: number }>();
  const [workflowContext, setWorkflowContext] = useState<{ scope: string; value: WorkflowContext } | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState('');
  const [screenwritingStarted, setScreenwritingStarted] = useState(true);
  const [dreaminaOpen, setDreaminaOpen] = useState(false);
  const [dreaminaScenes, setDreaminaScenes] = useState<string[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [sourceSelectionRequest, setSourceSelectionRequest] = useState<SourceSelectionRequest>();
  const [contextRequest, setContextRequest] = useState<{ sceneId: string; shotIds: string[]; returnTo: 'writing' | 'generation'; recordRequest?: NodeRecordRequest }>();
  const [contextBundleRequest, setContextBundleRequest] = useState<{ record: WorkspaceRecord; nonce: number }>();
  const [editingCell, setEditingCell] = useState<{ id: string | null; shotId?: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ScenePlan>>({});
  const [castingDrafts, setCastingDrafts] = useState<Record<string, CastingDraft>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const requestIds = useRef<Record<string, { fingerprint: string; id: string }>>({});
  const alive = useRef(true);
  const scope = useRef('');
  const loadSerial = useRef(0);
  const nodeNavigationSerial = useRef(0), currentBoot = useRef(boot);
  currentBoot.current = boot;

  const reload = useCallback(async () => {
    const serial = ++loadSerial.current;
    setLoading(true); setLoadError(null);
    try {
      const next = await (api.openWorkspace ? api.openWorkspace() : api.bootstrap());
      if (!alive.current || serial !== loadSerial.current) return;
      setNeedsSession(false);
      if (isFilmBootstrap(next)) { setCreativeBoot(next.project.creativeOrigin ? { project: next.project.creativeOrigin, records: next.records } : null); setBoot(next); setSceneId(previous => next.project.scenes.some(scene => scene.id === previous) ? previous : next.project.scenes[0]?.id ?? ''); }
      else { setBoot(null); setCreativeBoot(next); setSceneId(''); }
    } catch (error) {
      if (!alive.current || serial !== loadSerial.current) return;
      setNeedsSession(previous => previous || (error instanceof WorkspaceError && [401, 403].includes(error.status)));
      setLoadError(errorText(error));
    } finally { if (alive.current && serial === loadSerial.current) setLoading(false); }
  }, [api]);
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; }; }, [reload]);
  useEffect(() => {
    const restored = () => { void reload(); };
    window.addEventListener('qimovi-session-restored', restored);
    return () => window.removeEventListener('qimovi-session-restored', restored);
  }, [reload]);

  const project = boot?.project;
  const observeAssistantWriting = useCallback((context: WritingContext | null) => { setAssistantWriting(context); setAssistantWritingScope(project ? `${project.id}:${project.sourceHash}` : ''); }, [project]);
  scope.current = project ? `${project.id}:${project.sourceHash}` : '';
  const scene = project?.scenes.find(item => item.id === sceneId) ?? project?.scenes[0];
  useEffect(() => {
    if (drawer !== 'casting' || !castingTarget) return;
    const target = [...document.querySelectorAll<HTMLElement>('[data-casting-character]')].find(element => element.dataset.castingCharacter === castingTarget.characterId);
    target?.focus(); target?.scrollIntoView?.({ block: 'nearest' });
  }, [drawer, castingTarget]);
  const handoff = scene && boot ? boot.records.find(record => record.kind === 'production-handoff' && record.id === `production-handoff:${scene.id}`) : undefined;
  const workflowScope = project && scene ? `${project.id}:${project.sourceHash}:${scene.id}:${handoff?.sha256 ?? 'absent'}:${boot?.records.map(record => record.sha256).join(':')}` : '';
  useEffect(() => {
    if (!project || !scene || !handoff) { setWorkflowContext(null); setWorkflowError(''); setWorkflowLoading(false); return; }
    const controller = new AbortController(); let current = true;
    setWorkflowLoading(true); setWorkflowError('');
    void getWorkflowContext(project, scene.id, { handoffRef: { id: handoff.id, sha256: handoff.sha256 } }, controller.signal).then(value => { if (current) setWorkflowContext({ scope: workflowScope, value }); }).catch(caught => { if (current) setWorkflowError(errorText(caught)); }).finally(() => { if (current) setWorkflowLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [project, scene, handoff, workflowScope]);
  const stored = scene && boot ? savedPlan(boot.records, scene.id) : undefined;
  const plan = scene && project ? drafts[scene.id] ?? (stored?.data as ScenePlan | undefined) ?? freshPlan(scene, project) : null;
  const cells = (project?.cells.filter(item => item.sceneId === scene?.id) ?? []).sort((left, right) => {
    const shotOrder = (scene?.shots.findIndex(shot => shot.id === left.shotId) ?? -1) - (scene?.shots.findIndex(shot => shot.id === right.shotId) ?? -1);
    const role = (cell: StoryCell) => plan?.cellOverrides.find(item => item.cellId === cell.id)?.role ?? cell.role;
    return shotOrder || roles.indexOf(role(left)) - roles.indexOf(role(right));
  });
  const activeCell = cells.find(item => item.id === cellId) ?? cells.find(item => item.imageHash) ?? cells[0];
  const currentCellBasis = project?.cellBasisHashes?.[scene?.id ?? ''];
  const cellBasisStale = Boolean(plan && currentCellBasis && (plan.cellBasisHash ? plan.cellBasisHash !== currentCellBasis : project?.cellRevisionSceneIds?.includes(scene?.id ?? ''))) || Boolean(!drafts[scene?.id ?? ''] && stored?.reviewState?.status === 'NEEDS_REVIEW');
  const currentRole = (cell: StoryCell) => plan?.cellOverrides.find(item => item.cellId === cell.id)?.role ?? cell.role;
  const updatePlan = (updater: (current: ScenePlan) => ScenePlan) => {
    if (!scene || !plan || busy[scene.id]) return;
    setDrafts(previous => ({ ...previous, [scene.id]: updater(structuredClone(plan)) }));
    setSaveErrors(previous => ({ ...previous, [scene.id]: '' }));
    setNotice('');
  };
  const updateCell = (patch: { role?: CellRole; note?: string }) => {
    if (!activeCell) return;
    updatePlan(current => {
      const prior = current.cellOverrides.find(item => item.cellId === activeCell.id) ?? { cellId: activeCell.id, role: activeCell.role, note: '' };
      return { ...current, cellOverrides: [...current.cellOverrides.filter(item => item.cellId !== activeCell.id), { ...prior, ...patch }] };
    });
  };
  const save = async () => {
    if (!scene || !project || !plan || busy[scene.id] || loading || loadError || plan.sourceHash !== project.sourceHash || cellBasisStale) return;
    const target = scene.id;
    const capturedScope = scope.current;
    const payload = structuredClone(plan);
    const fingerprint = JSON.stringify({ payload, expectedVersion: stored?.version ?? null });
    if (requestIds.current[target]?.fingerprint !== fingerprint) requestIds.current[target] = { fingerprint, id: crypto.randomUUID() };
    setBusy(previous => ({ ...previous, [target]: true }));
    setSaveErrors(previous => ({ ...previous, [target]: '' }));
    try {
      const record = await api.saveRecord({ id: recordId(target), kind: 'scene-plan', expectedVersion: stored?.version ?? null, requestId: requestIds.current[target].id, data: payload });
      if (!alive.current || scope.current !== capturedScope) return;
      setBoot(previous => previous ? { ...previous, records: [...previous.records.filter(item => item.id !== record.id), record] } : previous);
      setDrafts(previous => { const next = { ...previous }; delete next[target]; return next; });
      setNotice(`Scene ${scene.index} proposal saved · version ${record.version}`);
    } catch (error) {
      if (alive.current && scope.current === capturedScope) setSaveErrors(previous => ({ ...previous, [target]: errorText(error) }));
    } finally { if (alive.current && scope.current === capturedScope) setBusy(previous => ({ ...previous, [target]: false })); }
  };
  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setLoadError(null);
    const supplied = token; setToken('');
    try { await api.login(supplied); await reload(); }
    catch (error) { setLoadError(errorText(error)); setLoading(false); }
  };

  function openCreativeAuthoring(mode: WorkbenchMode = 'write') {
    setCreativeAreaRequest(previous => ({ nonce: (previous?.nonce ?? 0) + 1, area: ['braindump', 'plan', 'pitch'].includes(mode) ? 'develop' : 'write',
      ...(mode === 'plan' ? { developmentKind: 'story-plan-draft' as const } : mode === 'pitch' ? { developmentKind: 'pitch-draft' as const } : mode === 'braindump' ? { developmentKind: 'writing-note' as const } : {}) }));
    setCreativeOpen(true);
  }
  const creativeSurface = creativeBoot ? <div key="creative-authoring" hidden={needsSession || Boolean(boot && !creativeOpen)}><CreativeProjectWorkspace key={creativeBoot.project.id} project={creativeBoot.project} attachedProject={boot?.project} records={boot?.records ?? creativeBoot.records} api={api} loading={loading} error={loadError} open={!needsSession && (!boot || creativeOpen)} areaRequest={creativeAreaRequest} onDirtyChange={setCreativeDirty} onRefresh={() => void reload()} onAttached={async () => { await reload(); setCreativeOpen(false); setScreenwritingOpen(true); setModeRequest(previous => ({ mode: 'nodes', movieView: 'storyboard', nonce: previous.nonce + 1 })); }} onOpenProduction={(destination: ProductionDestination) => {
    setCreativeOpen(false); setBudgetOpen(destination === 'budget'); if (destination === 'budget') setBudgetStarted(true);
    setDccOpen(destination === 'cameras'); setDreaminaOpen(false); setDocumentsOpen(false); setScreenwritingOpen(destination !== 'cameras');
    setModeRequest(previous => ({ mode: 'nodes', movieView: destination === 'timeline' ? 'timeline' : 'storyboard', nonce: previous.nonce + 1 }));
  }} onSaved={record => {
    const retain = (rows: WorkspaceRecord[]) => rows.some(item => item.id === record.id && item.version >= record.version) ? rows : [...rows.filter(item => item.id !== record.id), record];
    setCreativeBoot(previous => previous ? { ...previous, records: retain(previous.records) } : previous);
    setBoot(previous => previous ? { ...previous, records: retain(previous.records) } : previous);
  }}/></div> : null;
  if (creativeBoot && !boot) return <>{creativeSurface}{needsSession && <SessionRecovery loading={loading} error={loadError} token={token} onToken={setToken} onSubmit={login} onRetry={() => void reload()}/>}</>;

  if (needsSession && !project) return <SessionRecovery loading={loading} error={loadError} token={token} onToken={setToken} onSubmit={login} onRetry={() => void reload()}/>;

  if (!project || !scene || !plan) return <main className="session-page"><div className="session-copy"><span className="eyebrow">YOUR LOCAL CREATIVE STUDIO</span><h1><QiMoviBrand/></h1><p>Writing, worldbuilding and film preparation.</p></div>
    <div className="session-form">{needsSession ? <form onSubmit={login}><label htmlFor="session-token">Local owner session</label><input id="session-token" type="password" value={token} autoComplete="off" onChange={event => setToken(event.target.value)} placeholder="Enter the local session token"/><button className="primary" disabled={loading || !token}>Open workspace ↗</button></form> : loading ? <p role="status">Opening the local workspace…</p> : <button onClick={() => void reload()}>Retry local connection</button>}{loadError && <p role="alert" className="error-text">{loadError}</p>}<small>The screenplay and candidate records stay in this local workspace.</small></div></main>;

  function navigateWorkflow(stage: WorkflowStage, targetSceneId = scene.id) {
    if (!project.scenes.some(item => item.id === targetSceneId)) return;
    clearNodeRequests();
    setSceneId(targetSceneId);
    requestAnimationFrame(() => {
      const targets = [document.scrollingElement, document.querySelector('.canis-content'), document.querySelector('.dcc-panel'), document.querySelector('.dreamina-drawer')];
      targets.forEach(element => { if (element && typeof element.scrollTo === 'function') element.scrollTo({ top: 0, left: 0 }); });
    });
    setContextOpen(false); setWorkflowOpen(false); setScreenwritingOpen(false); setDccOpen(false); setDreaminaOpen(false); setTakesOpen(false); setDrawer(null);
    if (stage === 'writing' && project.creativeOrigin) { openCreativeAuthoring('write'); return; }
    if (stage === 'writing') { setScreenwritingStarted(true); setScreenwritingOpen(true); setModeRequest(value => ({ mode: 'write', nonce: value.nonce + 1 })); }
    else if (stage === 'cameras') { setDccReturnToWorkbench(screenwritingOpen); setDccOpen(true); }
    else if (stage === 'generation') { setDreaminaScenes(value => value.includes(targetSceneId) ? value : [...value, targetSceneId]); setDreaminaOpen(true); }
  }
  function clearNodeRequests() {
    ++nodeNavigationSerial.current;
    setShotPreparationRequest(undefined); setGenerationRecordRequest(undefined); setTakeRecordRequest(undefined); setTakeShotRequest(undefined); setCastingTarget(undefined); setNodeRouteError('');
    setContextRequest(previous => previous?.recordRequest ? { ...previous, recordRequest: undefined } : previous);
  }
  async function routeNodeRecord(request: NodeRecordRequest, targetSceneId: string, intent: NodeRecordRequest['intent'], kind: string, openRecord: (record: WorkspaceRecord) => void) {
    const serial = ++nodeNavigationSerial.current, captured = currentBoot.current, capturedScope = scope.current;
    setNodeRouteError('');
    const current = () => alive.current && serial === nodeNavigationSerial.current && capturedScope === scope.current;
    try {
      const targetScene = project.scenes.find(item => item.id === targetSceneId);
      if (!targetScene) throw new Error('The node scene is unavailable. Your open edits are retained.');
      checkNodeRequest(request, project, targetScene, intent, kind);
      const next = await api.bootstrap();
      if (!current()) return;
      if (next.project.id !== project.id || next.project.sourceHash !== project.sourceHash || !next.project.scenes.some(item => item.id === targetSceneId)) throw new Error('The node belongs to a different or changed project source. Your open edits are retained.');
      const record = next.records.filter(item => item.id === request.recordRef.id).sort((a, b) => b.version - a.version)[0];
      if (!record || record.kind !== kind || record.sha256 !== request.recordRef.sha256 || (record.data as { sourceHash?: string }).sourceHash !== project.sourceHash) throw new Error('That exact saved node version changed or is unavailable. Refresh the node and choose its current record; your open edits are retained.');
      if (kind === 'casting-draft') {
        if (!next.project.characters.some(character => character.id === (record.data as CastingDraft).characterId)) throw new Error('The requested casting character is unavailable.');
      } else if ((record.data as { sceneId?: string }).sceneId !== targetSceneId) throw new Error('The requested record belongs to another scene. Your open edits are retained.');
      await validateRecord(record, kind === 'generation-brief' ? undefined : next.project);
      if (!current()) return;
      if (currentBoot.current !== captured) throw new Error('Saved workspace records changed while opening the node. Retry the current selection; your edits are retained.');
      setBoot(next); openRecord(record);
    } catch (error) { if (current()) setNodeRouteError(errorText(error)); }
  }
  function openStoryboardShot(targetSceneId: string, targetShotId: string, targetCellId?: string) {
    const targetScene = project.scenes.find(item => item.id === targetSceneId);
    if (!targetScene?.shots.some(item => item.id === targetShotId)) { setNodeRouteError('That storyboard shot is no longer available. Reopen the sequence to inspect its current source.'); return; }
    const shotCells = project.cells.filter(item => item.sceneId === targetSceneId && item.shotId === targetShotId);
    const targetCell = targetCellId ? shotCells.find(item => item.id === targetCellId) : shotCells.find(item => item.role === 'START') ?? shotCells[0];
    if (targetCellId && !targetCell) { setNodeRouteError('That frame no longer belongs to the selected shot. Reopen the sequence before continuing.'); return; }
    navigateWorkflow('film', targetSceneId); setView('room');
    setCellId(targetCell?.id ?? '');
    setEditingCell(targetCell ? null : { id: null, shotId: targetShotId });
  }
  function prepareShot(targetSceneId: string, targetShotId: string) {
    if (!project.scenes.find(item => item.id === targetSceneId)?.shots.some(item => item.id === targetShotId)) {
      setNodeRouteError('That shot is no longer available. Reopen the storyboard to select it again.'); return;
    }
    navigateWorkflow('generation', targetSceneId);
    setSourceSelectionRequest(undefined); setContextBundleRequest(undefined);
    setShotPreparationRequest({ nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: targetSceneId, shotId: targetShotId });
  }
  function returnToStoryboard(targetSceneId: string) {
    navigateWorkflow('writing', targetSceneId);
    setModeRequest(value => ({ mode: 'nodes', nonce: value.nonce + 1 }));
  }
  function openGeneration(targetSceneId: string, request?: NodeRecordRequest) {
    if (!request) { navigateWorkflow('generation', targetSceneId); return; }
    void routeNodeRecord(request, targetSceneId, 'OPEN_RECORD', 'generation-brief', () => { navigateWorkflow('generation', targetSceneId); setGenerationRecordRequest(request); });
  }
  function openTakes(targetSceneId = scene.id, request?: NodeRecordRequest, shotRequest?: MediaTakeShotRequest) {
    if (shotRequest && (shotRequest.projectId !== project.id || shotRequest.sourceHash !== project.sourceHash || shotRequest.sceneId !== targetSceneId || !project.scenes.find(row => row.id === targetSceneId)?.shots.some(shot => shot.id === shotRequest.shotId))) { setNodeRouteError('That take target no longer belongs to this storyboard.'); return; }
    const show = () => {
      if (shotRequest) { clearNodeRequests(); setSceneId(targetSceneId); setTakeShotRequest(shotRequest); setTakeReturnToWorkbench(true); setScreenwritingOpen(false); }
      else { setTakeReturnToWorkbench(screenwritingOpen); navigateWorkflow('film', targetSceneId); }
      setTakeRecordRequest(request); setTakesOpen(true);
    };
    if (!request) { show(); return; }
    const kind = request.intent === 'IMPORT_RETURN' ? 'generation-brief' : 'measured-media-take';
    void routeNodeRecord(request, targetSceneId, request.intent === 'IMPORT_RETURN' ? 'IMPORT_RETURN' : 'OPEN_RECORD', kind, show);
  }
  function openCasting(request?: NodeRecordRequest) {
    if (!request) { navigateWorkflow('film'); setDrawer('casting'); void reload(); return; }
    void routeNodeRecord(request, request.sceneId, 'OPEN_RECORD', 'casting-draft', record => { navigateWorkflow('film', request.sceneId); setCastingTarget({ characterId: (record.data as CastingDraft).characterId, record }); setDrawer('casting'); });
  }
  function openNodeContext(request?: NodeRecordRequest) {
    if (!request) { chooseContext(activeCell ? [activeCell.shotId] : scene.shots.slice(0, 1).map(shot => shot.id), 'writing'); return; }
    void routeNodeRecord(request, request.sceneId, 'OPEN_RECORD', 'context-bundle', record => {
      navigateWorkflow('film', request.sceneId);
      setContextRequest({ sceneId: request.sceneId, shotIds: [...(record.data as ContextBundle).shotIds], returnTo: 'writing', recordRequest: request }); setContextOpen(true);
    });
  }
  function openAuthoring(mode: WorkbenchMode, openEditors = false, movieView?: MovieWorkspaceView) {
    if (project.creativeOrigin && ['write', 'braindump', 'plan', 'pitch', 'drafts', 'templates'].includes(mode)) { openCreativeAuthoring(mode); return; }
    navigateWorkflow('writing'); setModeRequest(value => ({ mode, nonce: value.nonce + 1, ...(openEditors ? { openEditors: true } : {}), ...(movieView ? { movieView } : {}) }));
  }
  function resumeWorkbenchDraft(id: string) {
    clearNodeRequests(); setDccOpen(false); setDreaminaOpen(false); setTakesOpen(false); setDocumentsOpen(false); setContextOpen(false); setWorkflowOpen(false); setDrawer(null); setScreenwritingOpen(true);
    setModeRequest(value => ({ mode: value.mode, nonce: value.nonce + 1, resumeDraftId: id }));
  }
  function openDocuments() {
    clearNodeRequests(); setDocumentsReturnToWorkbench(screenwritingOpen); setScreenwritingOpen(false); setDocumentsOpen(true);
  }
  function prepareSourceSelection(request: SourceSelectionRequest) {
    if (request.sourceHash !== project.sourceHash || !project.scenes.some(item => item.id === request.sceneId)) return;
    clearNodeRequests();
    setSourceSelectionRequest(request); setSceneId(request.sceneId);
    setContextOpen(false); setScreenwritingOpen(false); setDccOpen(false); setWorkflowOpen(false);
    setDreaminaScenes(value => value.includes(request.sceneId) ? value : [...value, request.sceneId]); setDreaminaOpen(true);
  }
  function chooseContext(shotIds: string[], returnTo: 'writing' | 'generation') {
    clearNodeRequests();
    setContextRequest({ sceneId: scene.id, shotIds: [...shotIds], returnTo });
    setScreenwritingOpen(false); setDreaminaOpen(false); setContextOpen(true);
  }
  function closeContext() {
    clearNodeRequests();
    setContextOpen(false);
    if (contextRequest?.returnTo === 'generation') { setSceneId(contextRequest.sceneId); setDreaminaOpen(true); }
    else setScreenwritingOpen(true);
  }
  function useContext(record: WorkspaceRecord) {
    const data = record.data as ContextBundle;
    if (!contextRequest || data.sourceHash !== project.sourceHash || data.sceneId !== contextRequest.sceneId || canonicalJson(data.shotIds) !== canonicalJson(contextRequest.shotIds)) return;
    setContextBundleRequest({ record, nonce: Date.now() }); closeContext();
  }
  function manageWorkflow(record?: WorkspaceRecord) {
    clearNodeRequests();
    setWorkflowReturn(screenwritingOpen ? 'writing' : dccOpen ? 'cameras' : dreaminaOpen ? 'generation' : 'film');
    setScreenwritingOpen(false); setDccOpen(false); setDreaminaOpen(false); setWorkflowStarted(true); setWorkflowOpen(true);
    if (record) setWorkflowRequest({ record, nonce: Date.now() }); else setWorkflowRequest(undefined);
  }
  function returnFromWorkflow() {
    if (workflowReturn !== 'writing') { navigateWorkflow(workflowReturn); return; }
    // Reopen the retained authoring view without issuing a new "write" request.
    // The mounted workbench still owns its selected mode, draft and unsaved edits.
    clearNodeRequests(); setWorkflowOpen(false); setScreenwritingOpen(true);
  }
  const retainRecord = (record: WorkspaceRecord) => {
    setBoot(previous => previous ? { ...previous, records: [...previous.records.filter(item => item.id !== record.id), record] } : previous);
    if (record.kind === 'storyboard-cell') void reload();
  };
  const flow: FlowContextProps = { project, sceneId: scene.id, handoff, records: boot.records, context: workflowContext?.scope === workflowScope ? workflowContext.value : null, loading: workflowLoading, error: workflowError, onNavigate: navigateWorkflow, onManage: () => manageWorkflow() };
  const dirty = Boolean(drafts[scene.id]);
  const stale = plan.sourceHash !== project.sourceHash;
  const studioDraftStatus = workbenchDraftStatus?.scope === `${project.id}:${project.sourceHash}` ? workbenchDraftStatus : undefined;
  const studioDirty = Boolean(Object.keys(drafts).length || Object.keys(castingDrafts).length || studioDraftStatus?.dirty || (assistantWritingScope === `${project.id}:${project.sourceHash}` && assistantWriting?.dirty) || budgetDirty);
  const sourceParagraphs = (project.prologue?.length ?? 0) + project.scenes.reduce((sum, item) => sum + item.paragraphs.length, 0);
  const observations = boot.records.filter(record => record.kind === 'review-observation');
  const sourceAdmitted = (boot.canonical?.sourceStatus ?? project.sourceStatus) === 'ADMITTED';
  return <>{creativeSurface}<div hidden={Boolean(creativeBoot && creativeOpen)} className="drifter-studio" data-unsaved={studioDirty ? 'true' : 'false'}>
    <div className="session-preserved-workspace" hidden={needsSession}>
    {project.creativeOrigin && <nav className="production-writing-link" aria-label="Production screenplay connection"><span>Production copy · screenplay v{project.productionDraftRef?.version} · plan v{project.productionPlanRef?.version}</span><button onClick={() => openCreativeAuthoring('write')}>Writing & development{creativeDirty ? ' · unsaved work' : ''}</button><button onClick={() => { setCreativeAreaRequest(previous => ({ area: 'scene-plan', nonce: (previous?.nonce ?? 0) + 1 })); setCreativeOpen(true); }}>Scene & shot plan</button></nav>}
    <StudioHeader production onEditors={() => openAuthoring('nodes', true)} onCasting={() => openCasting()} onTakes={() => openTakes(scene.id)} onDocuments={openDocuments} onChooseContext={() => openNodeContext()} onBudget={() => openBudget()} hidden={screenwritingOpen} projectTitle={project.title} mode="scenes" busy={loading || Boolean(loadError)} dirty={studioDirty} unsavedAreas={studioDraftStatus?.areas.map(area => ({ ...area, onOpen: () => resumeWorkbenchDraft(area.id) }))} writingDirty={Boolean(assistantWriting?.dirty)} onMode={openAuthoring} onProduction={() => openAuthoring('nodes', false, 'storyboard')} onDcc={() => navigateWorkflow('cameras')} onGeneration={() => navigateWorkflow('generation')} onAssistant={() => { setConnectionsOpen(false); setAssistantOpen(value => !value); }} onModels={() => { setAssistantOpen(false); setConnectionsOpen(true); }} onRefresh={() => void reload()}/>
    <div className="studio-layout" aria-hidden={screenwritingOpen || undefined}>
      <aside className="scene-rail"><div className="rail-heading"><span className="eyebrow">THE FILM</span><span>{project.scenes.length} scenes</span></div><nav aria-label="Scenes">{project.scenes.map(item => {
        const image = project.cells.find(cell => cell.sceneId === item.id && cell.imageHash);
        return <button key={item.id} className={`scene-item ${item.id === scene.id ? 'active' : ''}`} aria-current={item.id === scene.id ? 'page' : undefined} onClick={() => { clearNodeRequests(); setSceneId(item.id); setCellId(''); setEditingCell(null); setNotice(''); }}>
          <span className="scene-number">{String(item.index).padStart(2, '0')}</span><div><strong>{item.heading.replace(/^(int\.|ext\.)\s*/i, '')}</strong><small>{item.shots.length} shots · {savedPlan(boot.records, item.id) ? 'Draft saved' : 'Unreviewed'}</small></div>{image && <span className="scene-thumb"><CellImage cell={image} thumbnail/></span>}
        </button>;
      })}</nav><div className="rail-footer"><span className="status-dot"/>{sourceAdmitted ? 'Source admitted by owner' : 'Source pending owner admission'}<p>{project.scenes.reduce((sum, item) => sum + item.shots.length, 0)} planned shots<br/>Full screenplay preserved</p></div></aside>

      <main className="work-area">
        <nav className="production-toolbar" aria-label="Film preparation tools"><span className="eyebrow">FILM PREPARATION</span><button onClick={() => openBudget(`scene:${scene.id}`)}>Scene costs</button><button onClick={() => openAuthoring('scenes')}>Scene Workbench</button><button onClick={() => openAuthoring('nodes')}>Storyboard flow</button><button onClick={() => setDrawer('source')}>Screenplay <span>↗</span></button><button onClick={() => openCasting()}>Casting</button><button onClick={openDocuments}>Documents</button><button onClick={() => openTakes()}>Takes</button><button onClick={() => navigateWorkflow('cameras')}>3D & cameras</button><button onClick={() => setDrawer('reviews')}>Reviews <span>{observations.length}</span></button><button className="dreamina-entry" disabled={loading || Boolean(loadError)} onClick={() => navigateWorkflow('generation')}>Prepare for generation <span>↗</span></button></nav>
        <div className="work-heading"><div><span className="eyebrow">SCENE {String(scene.index).padStart(2, '0')} / {project.scenes.length}</span><h1>{scene.heading}</h1></div><div className="view-switch" role="tablist" aria-label="Workspace views">{(['room', 'atlas', 'score'] as View[]).map(name => <button key={name} role="tab" aria-selected={view === name} onClick={() => setView(name)}>{name === 'room' ? 'Storyboard' : name === 'atlas' ? 'Shot board' : 'Timing & clips'}</button>)}</div></div>
        {loadError && <p role="alert" className="error-bar">Workspace refresh failed: {loadError}<button onClick={() => void reload()}>Retry</button></p>}
        {stale && <p role="alert" className="error-bar">This draft belongs to an earlier source snapshot. It remains readable; saving is blocked.</p>}{cellBasisStale && <div role="alert" className="error-bar">Storyboard cells have changed. Review the current images and roles before saving this proposal.<button disabled={stale || loading || Boolean(loadError) || Boolean(busy[scene.id]) || !currentCellBasis} onClick={() => updatePlan(current => ({ ...current, cellBasisHash: currentCellBasis }))}>Use current cells for this proposal</button></div>}
        <WorkflowContextBar {...flow} stage="film"/>
        <div className="view-body" key={`${scene.id}:${view}`}>
          {view === 'room' && <>
            <div className="room-grid"><section className="storyboard-work"><div className="board-topline"><span>STORYBOARD / CANDIDATE</span><span>{activeCell ? `${currentRole(activeCell)} · ${scene.shots.find(shot => shot.id === activeCell.shotId)?.label ?? activeCell.shotId}` : 'No cell selected'}</span></div>
              {activeCell && <><div className="hero-board"><CellImage key={activeCell.id} cell={activeCell}/><span className="image-scope">INTERNAL PREVISUALIZATION</span></div><p className="image-description">{activeCell.description}</p></>}
              <div className="cell-strip-heading"><h2>Storyboard frames</h2><span>{cells.length} in this scene <button className="cell-add" disabled={loading || Boolean(loadError)} onClick={() => setEditingCell({ id: null })}>Add frame ＋</button></span></div><div className="cell-strip" aria-label="Storyboard frames">{cells.map(cell => <button key={cell.id} aria-pressed={activeCell?.id === cell.id} onClick={() => setCellId(cell.id)}><div className="cell-mini"><CellImage cell={cell} thumbnail/></div><span><b>{scene.shots.find(shot => shot.id === cell.shotId)?.label ?? cell.shotId}</b><small>{STORYBOARD_FRAME_ROLE[currentRole(cell)]}</small></span></button>)}</div>
            </section>
            <aside className="inspector"><div className="inspector-title"><span className="eyebrow">DIRECT THE MOMENT</span><h2>What matters here?</h2></div>{activeCell && <><label className="field-label" htmlFor="cell-role">Frame role</label><div className="role-switch" id="cell-role" role="group" aria-label="Frame role">{roles.map(role => <button key={role} disabled={Boolean(busy[scene.id]) || (role === 'START' && activeCell.shotId !== scene.shots[0]?.id)} title={role === 'START' && activeCell.shotId !== scene.shots[0]?.id ? 'A scene start must use its opening shot.' : undefined} aria-pressed={currentRole(activeCell) === role} onClick={() => updateCell({ role })}>{STORYBOARD_FRAME_ROLE[role]}</button>)}</div><label className="field-label" htmlFor="cell-note">Moment note</label><textarea id="cell-note" maxLength={2000} rows={4} value={plan.cellOverrides.find(item => item.cellId === activeCell.id)?.note ?? ''} disabled={Boolean(busy[scene.id])} onChange={event => updateCell({ note: event.target.value })} placeholder="A significant action, expression, or continuity detail…"/>{!activeCell.imageHash && <p className="quiet-warning">This storyboard frame needs an actual image before image-based generation.</p>}<button className="text-link" disabled={loading || Boolean(loadError)} onClick={() => setEditingCell({ id: activeCell.id })}>Edit frame image & source links <span>↗</span></button></>}
              <label className="field-label" htmlFor="scene-note">Scene direction</label><textarea id="scene-note" maxLength={2000} rows={4} value={plan.notes} disabled={Boolean(busy[scene.id])} onChange={event => updatePlan(current => ({ ...current, notes: event.target.value }))} placeholder="Notes for this candidate scene plan…"/><p className="scope-note">Notes change the production proposal. The screenplay stays unchanged.</p><button className="text-link" onClick={() => setView('score')}>Plan timing & segments <span>→</span></button>
            </aside></div>
            <section className="shots-section"><div className="section-topline"><h2>Scene coverage</h2><span>{scene.shots.length} prospective shots</span></div><div className="shot-list">{scene.shots.map(shot => <div key={shot.id}><strong>{shot.label}</strong><p>{shot.description}</p><span>{shot.plannedDurationMs === null ? 'Untimed' : `${(shot.plannedDurationMs / 1000).toFixed(1)}s plan`}</span></div>)}</div></section>
          </>}
          {view === 'atlas' && <Atlas scene={scene} cells={cells} plan={plan} onCell={id => { setCellId(id); setView('room'); }}/>}
          {view === 'score' && <Score key={scene.id} scene={scene} cells={cells} plan={plan} disabled={Boolean(busy[scene.id])} update={updatePlan}/>}
        </div>
        <footer className="save-bar"><div><span className={dirty ? 'unsaved-indicator' : ''}>{dirty ? 'Unsaved proposal' : stored ? `Saved proposal · v${stored.version}` : 'No scene proposal saved yet'}</span><small>{notice || 'Candidate plans · source and production authority unchanged'}</small>{saveErrors[scene.id] && <p role="alert">Save not confirmed: {saveErrors[scene.id]}</p>}</div><div className="save-actions">{saveErrors[scene.id] && <button disabled={loading || Boolean(busy[scene.id])} onClick={() => void reload()}>Reload saved version</button>}<button className="primary" onClick={() => void save()} disabled={loading || Boolean(loadError) || Boolean(busy[scene.id]) || stale || cellBasisStale || !dirty}>{busy[scene.id] ? 'Saving…' : 'Save proposal'} <span>↗</span></button></div></footer>
      </main>
    </div>
    {documentsOpen && <DocumentsPanel key={`documents:${project.id}:${project.sourceHash}`} project={project} api={api} onClose={() => { setDocumentsOpen(false); if (documentsReturnToWorkbench) setScreenwritingOpen(true); setDocumentsReturnToWorkbench(false); }} onSaved={() => void reload()}/>}
    {budgetStarted && <section className="production-budget-drawer" hidden={!budgetOpen} aria-label="Project budget workspace">
      <header className="production-budget-drawer-heading"><h2>Project budget</h2><button onClick={() => setBudgetOpen(false)} aria-label="Close project budget">Close{budgetDirty ? ' · draft kept' : ''}</button></header>
      <ProductionBudgetPanel key={`${project.id}:${project.sourceHash}`} project={project} records={boot.records} open={budgetOpen} focusRequest={budgetFocus} onOpenTarget={target => {
        setBudgetWorkRequest({ nonce: ++budgetNonce.current, projectId: project.id, sourceHash: project.sourceHash, target });
        setBudgetOpen(false); setScreenwritingStarted(true); setScreenwritingOpen(true);
      }} onSaved={retainRecord} onDirtyChange={setBudgetDirty}/>
    </section>}
    {screenwritingStarted && <CanIScreenwriteWorkbench onOpenCreativeAuthoring={project.creativeOrigin ? openCreativeAuthoring : undefined} onDraftStatusChange={setWorkbenchDraftStatus} budgetWorkRequest={budgetWorkRequest} onOpenBudget={openBudget} onOpenAssistant={() => { setConnectionsOpen(false); setAssistantOpen(value => !value); }} onUniverseAssistant={context => { setAssistantUniverse(context); setConnectionsOpen(false); setAssistantOpen(true); }} onOpenModels={() => { setAssistantOpen(false); setConnectionsOpen(true); }} onAssistantContext={observeAssistantWriting} key={`${project.id}:${project.sourceHash}`} project={project} records={boot.records} api={api} open={screenwritingOpen && !budgetOpen && !creativeOpen} sceneId={scene.id} flow={flow} modeRequest={modeRequest} sourceStatus={sourceAdmitted ? 'ADMITTED' : 'PENDING_OWNER_ADMISSION'} onGeneration={() => navigateWorkflow('generation')} onSceneSelect={id => { clearNodeRequests(); setSceneId(id); setCellId(''); setEditingCell(null); }} onProductionScene={id => navigateWorkflow('film', id)} onStoryboardShot={openStoryboardShot} onPrepareShot={prepareShot} onGenerationScene={openGeneration} onTakes={openTakes} onCasting={openCasting} onSourceSelection={prepareSourceSelection} onChooseContext={openNodeContext} onHandoff={manageWorkflow} onClose={() => { clearNodeRequests(); setScreenwritingOpen(false); }} onProduction={() => navigateWorkflow('film')} onDcc={() => navigateWorkflow('cameras')} onDccScene={id => navigateWorkflow('cameras', id)} onDocuments={openDocuments} onSaved={retainRecord}/>}
    <DccPanel onReviewTake={(targetSceneId,targetShotId,takeId) => { setDccOpen(false); openTakes(targetSceneId, {nonce:crypto.randomUUID(),projectId:project.id,sourceHash:project.sourceHash,sceneId:targetSceneId,intent:'OPEN_RECORD',recordRef:{id:takeId,sha256:takeId.slice('measured-media-take:'.length),kind:'measured-media-take'}}, {nonce:crypto.randomUUID(),projectId:project.id,sourceHash:project.sourceHash,sceneId:targetSceneId,shotId:targetShotId}); }} onOpenStoryboard={(targetSceneId,targetShotId,targetCellId) => { setDccOpen(false); openStoryboardShot(targetSceneId,targetShotId,targetCellId); }} project={project} scene={scene} flow={flow} api={api} onSaved={retainRecord} open={dccOpen} onClose={() => { setDccOpen(false); if (dccReturnToWorkbench) setScreenwritingOpen(true); setDccReturnToWorkbench(false); }}/>
    {dreaminaScenes.map(id => { const target = project.scenes.find(item => item.id === id); return target ? <DreaminaPanel onOpenBudget={openBudget} key={`${project.id}:${project.sourceHash}:${id}`} project={project} scene={target} api={api} records={boot.records} flow={flow} shotRequest={shotPreparationRequest?.sceneId === id ? shotPreparationRequest : undefined} onReturnToStoryboard={() => returnToStoryboard(id)} sourceSelectionRequest={sourceSelectionRequest?.sceneId === id ? sourceSelectionRequest : undefined} contextBundleRequest={contextBundleRequest && (contextBundleRequest.record.data as ContextBundle).sceneId === id ? contextBundleRequest : undefined} onChooseContext={shots => chooseContext(shots, 'generation')} recordRequest={generationRecordRequest?.sceneId === id ? generationRecordRequest : undefined} onTakes={request => openTakes(id, request)} open={dreaminaOpen && !budgetOpen && scene.id === id} sceneDirty={Boolean(drafts[id])} onClose={() => { clearNodeRequests(); setDreaminaOpen(false); }} onSaved={retainRecord}/> : null; })}
    <MediaTakesPanel key={`takes:${project.id}:${project.sourceHash}`} project={project} scene={scene} records={boot.records} recordRequest={takeRecordRequest} shotRequest={takeShotRequest} open={takesOpen} onClose={() => { clearNodeRequests(); setTakesOpen(false); if (takeReturnToWorkbench) setScreenwritingOpen(true); setTakeReturnToWorkbench(false); }} onSaved={retainRecord}/>
    {contextRequest && <ContextBundlePanel key={`context:${project.id}:${project.sourceHash}`} project={project} scene={project.scenes.find(item => item.id === contextRequest.sceneId)!} shotIds={contextRequest.shotIds} records={boot.records} api={api} recordRequest={contextRequest.recordRequest} open={contextOpen} lockShots={contextRequest.returnTo === 'generation'} onClose={closeContext} onSaved={retainRecord} onUse={contextRequest.returnTo === 'generation' ? useContext : undefined}/>}
    {workflowStarted && <WorkflowPanel project={project} sceneId={scene.id} records={boot.records} api={api} open={workflowOpen} requested={workflowRequest} onClose={returnFromWorkflow} onSaved={record => { retainRecord(record); const data = record.data as ProductionHandoff; setSceneId(data.sceneId); setCellId(project.cells.find(cell => cell.sceneId === data.sceneId && cell.shotId === data.shotIds[0])?.id ?? ''); setView('room'); navigateWorkflow('film'); }}/>}
    {editingCell && <CellEditor key={`${scene.id}:${editingCell.id ?? editingCell.shotId ?? "new"}`} initialShotId={editingCell.shotId} project={project} scene={scene} cell={project.cells.find(cell => cell.id === editingCell.id)} record={boot.records.find(record => record.id === `storyboard-cell:${editingCell.id}`)} api={api} disabled={loading || Boolean(loadError)} onReload={reload} onClose={() => setEditingCell(null)} onSaved={record => { setCellId((record.data as { cellId: string }).cellId); setEditingCell(null); setNotice("Cell candidate saved. Refreshing the current storyboard…"); void reload(); }}/>}
    {drawer && <div className="drawer-scrim" onClick={() => { clearNodeRequests(); setDrawer(null); }}><section className={`drawer ${drawer === 'source' ? 'source-drawer' : ''}`} role="dialog" aria-modal="true" aria-label={drawer === 'source' ? 'Exact screenplay' : drawer === 'casting' ? 'Casting references' : 'Imported review observations'} onClick={event => event.stopPropagation()}><div className="drawer-heading"><div><span className="eyebrow">{drawer === 'source' ? `${sourceParagraphs} PARAGRAPHS / READ ONLY` : drawer === 'casting' ? 'CHARACTER REFERENCES' : 'LOCAL REVIEW EXCHANGE'}</span><h2>{drawer === 'source' ? 'The screenplay' : drawer === 'casting' ? 'Casting & identity' : 'Review observations'}</h2></div><button aria-label="Close panel" onClick={() => { clearNodeRequests(); setDrawer(null); }}>×</button></div>
      {drawer === 'source' && <><p className="drawer-intro">Exact extracted source text. Production notes and continuity questions remain separate.</p><div className="screenplay">{project.prologue?.map(paragraph => <p key={paragraph.id} data-paragraph-id={paragraph.id} className={`paragraph ${paragraph.type.toLowerCase().replace(/\s+/g, '-')}`}>{paragraph.text}</p>)}{project.scenes.map(item => <section key={item.id} aria-label={`Source scene ${item.index}`}>{item.paragraphs.map(paragraph => <p key={paragraph.id} data-paragraph-id={paragraph.id} className={`paragraph ${paragraph.type.toLowerCase().replace(/\s+/g, '-')}`}>{paragraph.text}</p>)}</section>)}</div><details className="source-questions"><summary>Unresolved continuity questions · source unchanged</summary><ul>{project.continuityQuestions.map((question, index) => <li key={index}>{typeof question === 'string' ? question : question.question ?? question.text ?? 'Unresolved source question'}</li>)}</ul></details><p className="source-hash">Source SHA-256 {project.sourceHash}</p></>}
      {drawer === 'casting' && <><p className="drawer-intro">Appearance references are candidates. Their listed use scope does not establish a cast attachment or film-use permission.</p><div className="cast-grid">{project.characters.map(character => <article key={character.id} tabIndex={-1} data-casting-character={character.id} data-requested-record-hash={castingTarget?.characterId === character.id ? castingTarget.record.sha256 : undefined}><h3>{character.name}</h3>{castingTarget?.characterId === character.id && <p role="status">Selected saved candidate · v{castingTarget.record.version}.{castingDrafts[character.id] ? ' Your unsaved candidate edits are still shown below.' : ''}</p>}<p>{character.description}</p><CastingEditor project={project} character={character} api={api} disabled={loading || Boolean(loadError)} record={boot.records.find(item => item.id === `casting-draft:${character.id}` && item.kind === 'casting-draft')} draft={castingDrafts[character.id]} onDraft={value => setCastingDrafts(previous => { const next = { ...previous }; if (value) next[character.id] = value; else delete next[character.id]; return next; })} onSaved={record => setBoot(previous => previous ? { ...previous, records: [...previous.records.filter(item => item.id !== record.id), record] } : previous)} onReload={reload}/></article>)}</div></>}
      {drawer === 'reviews' && <><p className="drawer-intro">Imported reviewer comments are attributed observations. They do not approve the source or authorize production.</p>{observations.length ? observations.map(record => <ReviewObservation key={`${record.id}:${record.version}`} record={record}/>) : <div className="empty-state"><span>↔</span><h3>No imported reviews yet</h3><p>Reviewer packages are exported and imported through the local workspace. Comments will appear here after import.</p></div>}</>}
    </section></div>}
    </div>
    {!needsSession && <AssistantPanel universeContext={assistantUniverse} key={`assistant:${project.id}:${project.sourceHash}`} open={assistantOpen} project={project} records={boot.records} sceneId={scene.id} writing={assistantWritingScope === `${project.id}:${project.sourceHash}` ? assistantWriting : null} api={api} onSaved={retainRecord} onClose={() => setAssistantOpen(false)} onConnections={() => { setAssistantOpen(false); setConnectionsOpen(true); }} onGeneration={() => { setAssistantOpen(false); navigateWorkflow('generation'); }} />}
    {!needsSession && <ModelConnectionsPanel workspaceApi={api} records={boot.records} onSaved={retainRecord} onOpenDcc={() => { setConnectionsOpen(false); navigateWorkflow('cameras'); }} open={connectionsOpen} project={project} sceneId={scene.id} onClose={() => setConnectionsOpen(false)} onAssistant={() => { setConnectionsOpen(false); setAssistantOpen(true); }} onGeneration={() => { setConnectionsOpen(false); navigateWorkflow('generation'); }} onNodes={() => { setConnectionsOpen(false); openAuthoring('nodes'); }}/>}
    {nodeRouteError && <div role="alert" className="error-bar" style={{ position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 1200 }}>{nodeRouteError}<button onClick={() => setNodeRouteError('')}>Dismiss</button></div>}
    {needsSession && <SessionRecovery loading={loading} error={loadError} token={token} onToken={setToken} onSubmit={login} onRetry={() => void reload()}/>}
  </div></>;
}

function ReviewObservation({ record }: { record: WorkspaceRecord }) {
  const data = (record.data && typeof record.data === 'object' ? record.data : {}) as Record<string, unknown>;
  const basisAtImport = data.basisStateAtImport ?? data.basisState;
  return <article className="review-observation"><span className="eyebrow">OBSERVATION</span><h3>{typeof data.reviewerLabel === 'string' ? data.reviewerLabel : 'Imported reviewer'}</h3><p>{typeof data.note === 'string' ? data.note : 'Imported review record'}</p>{typeof data.sceneId === 'string' && <small>{data.sceneId}</small>}{typeof basisAtImport === 'string' && <small>Basis at import: {basisAtImport.toLowerCase()}. Currentness has not been rechecked.</small>}</article>;
}

function Atlas({ scene, cells, plan, onCell }: { scene: Scene; cells: StoryCell[]; plan: ScenePlan; onCell: (id: string) => void }) {
  return <section className="atlas-view"><div className="atlas-intro"><span className="eyebrow">LIVING ATLAS</span><h2>A scene, connected.</h2><p>These cells and segments are the same proposal shown in Room and Score.</p></div><div className="atlas-columns"><div><span className="atlas-column-label">SOURCE SCENE</span><div className="atlas-source"><span>{String(scene.index).padStart(2, '0')}</span><h3>{scene.heading}</h3><p>{scene.shots.length} planned shots</p>{plan.notes && <blockquote>{plan.notes}</blockquote>}</div></div><div><span className="atlas-column-label">STORY CELLS</span>{cells.map(cell => {
    const override = plan.cellOverrides.find(item => item.cellId === cell.id);
    return <button className="atlas-cell" key={cell.id} onClick={() => onCell(cell.id)}><span>{override?.role ?? cell.role}</span><strong>{scene.shots.find(shot => shot.id === cell.shotId)?.label ?? cell.shotId}</strong><small>{override?.note || cell.description}</small><b>↗</b></button>;
  })}</div><div><span className="atlas-column-label">GENERATION SEGMENTS</span>{plan.segments.length ? plan.segments.map((segment, index) => <div className="atlas-segment" key={segment.id}><span>SEGMENT {String(index + 1).padStart(2, '0')}</span><h3>{duration(segment.durationMs)}</h3><p>{segment.method.toLowerCase()} · {segment.cellIds.length} linked cells</p><small>{segment.cellIds.join(' → ')}</small></div>) : <p className="atlas-empty">No segment plans yet.<br/>Compose one in Score.</p>}</div></div><div className="atlas-boundary">Source → cells → segment plans. Media takes and selections will appear when they are recorded; no generation has run from this view.</div></section>;
}

function Score({ scene, cells, plan, disabled, update }: { scene: Scene; cells: StoryCell[]; plan: ScenePlan; disabled: boolean; update: (fn: (plan: ScenePlan) => ScenePlan) => void }) {
  const [seconds, setSeconds] = useState('');
  const [method, setMethod] = useState<SegmentMethod>('HYBRID');
  const [selectedCells, setSelectedCells] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [timingNote, setTimingNote] = useState('');
  const [timingWarning, setTimingWarning] = useState('');
  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setElapsed(Math.round(performance.now() - startedAt)), 100);
    const interrupt = () => { if (document.hidden) { setStartedAt(null); setElapsed(0); setTimingWarning('The table read was interrupted. No timing observation was recorded.'); } };
    document.addEventListener('visibilitychange', interrupt);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', interrupt); };
  }, [startedAt]);
  const requestedMs = Math.round(Number(seconds) * 1000);
  const canAdd = !disabled && seconds !== '' && Number.isFinite(requestedMs) && requestedMs > 0 && requestedMs <= 180000 && selectedCells.length > 0;
  const latestTiming = plan.timingObservations[plan.timingObservations.length - 1];
  const addSegment = () => { if (canAdd) { update(current => ({ ...current, segments: [...current.segments, { id: crypto.randomUUID(), durationMs: requestedMs, cellIds: cells.filter(cell => selectedCells.includes(cell.id)).map(cell => cell.id), method }] })); setSeconds(''); setSelectedCells([]); } };
  const stop = () => { if (startedAt === null) return; const observed = Math.max(1, Math.round(performance.now() - startedAt)); setStartedAt(null); setElapsed(observed); update(current => ({ ...current, timingObservations: [...current.timingObservations, { durationMs: observed, note: timingNote.trim() || 'Manual table read; no media captured.', recordedAt: new Date().toISOString() }] })); };
  return <section className="score-view"><div className="score-intro"><span className="eyebrow">THE SCORE</span><h2>Give the scene its time.</h2><p>180 seconds maximum per generation segment. Longer scenes use multiple segments.</p></div>
    <div className="score-ruler"><span>00:00</span><span>00:45</span><span>01:30</span><span>02:15</span><span>03:00 / segment cap</span></div><div className="segment-lanes">{plan.segments.length ? plan.segments.map((segment, index) => <div className="segment-lane" key={segment.id}><span>{String(index + 1).padStart(2, '0')}<small>{segment.method.toLowerCase()}</small></span><div className="segment-track"><div style={{ width: `${Math.max(1, segment.durationMs / 180000 * 100)}%` }}><strong>{duration(segment.durationMs)}</strong></div></div><button disabled={disabled} aria-label={`Remove segment ${index + 1}`} onClick={() => update(current => ({ ...current, segments: current.segments.filter(item => item.id !== segment.id) }))}>×</button></div>) : <div className="empty-lane">No segment plan yet. Add a duration and the cells it should cover.</div>}</div>
    <div className="score-editors"><div className="segment-editor"><h3>Plan a generation segment</h3><div className="segment-fields"><label>Duration in seconds<input aria-label="Segment duration in seconds" type="number" min="0.001" max="180" step="0.1" value={seconds} disabled={disabled} onChange={event => setSeconds(event.target.value)}/></label><label>Production method<select value={method} disabled={disabled} onChange={event => setMethod(event.target.value as SegmentMethod)}><option value="HYBRID">Supplied / filmed + AI</option><option value="AI">AI generation</option><option value="FILMED">Filmed material</option><option value="SUPPLIED">Supplied material</option></select></label></div><fieldset disabled={disabled}><legend>Include storyboard frames</legend>{cells.map(cell => <label className="cell-checkbox" key={cell.id}><input type="checkbox" checked={selectedCells.includes(cell.id)} onChange={event => setSelectedCells(previous => event.target.checked ? [...previous, cell.id] : previous.filter(id => id !== cell.id))}/><span>{scene.shots.find(shot => shot.id === cell.shotId)?.label} · {plan.cellOverrides.find(item => item.cellId === cell.id)?.role ?? cell.role}{!cell.imageHash && <small>Image needed</small>}</span></label>)}</fieldset>{seconds && requestedMs > 180000 && <p role="alert" className="error-text">A segment can be at most 180 seconds. Split the scene into additional segments.</p>}<button className="secondary" disabled={!canAdd} onClick={addSegment}>Add segment to proposal <span>＋</span></button><p className="scope-note">This is a duration request. Provider-specific limits and reviewed inputs must be checked before execution.</p></div>
      <div className="table-read"><span className="eyebrow">RUNTIME OBSERVATION</span><h3>Read it aloud.</h3><div className="read-clock" aria-live="off">{duration(elapsed)}</div><p>{latestTiming ? `Latest observation: ${duration(latestTiming.durationMs)}` : 'No table-read observation for this scene.'}</p><label className="field-label" htmlFor="timing-note">Observation note</label><input id="timing-note" value={timingNote} maxLength={2000} disabled={disabled || startedAt !== null} onChange={event => setTimingNote(event.target.value)} placeholder="Pace, pauses, performance…"/>{startedAt === null ? <button className="secondary" disabled={disabled} onClick={() => { setElapsed(0); setTimingWarning(''); setStartedAt(performance.now()); }}>Start table read <span>▷</span></button> : <button className="secondary recording" disabled={disabled} onClick={stop}>Stop and record time <span>□</span></button>}{timingWarning && <p role="status" className="quiet-warning">{timingWarning}</p>}<p className="scope-note">Manual timing only; no audio is captured. Save the proposal to keep the observation. Shot estimates do not establish the film’s runtime.</p></div>
    </div>
  </section>;
}
