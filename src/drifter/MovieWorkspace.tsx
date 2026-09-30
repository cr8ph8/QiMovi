import ShotKeyframePlanner from './ShotKeyframePlanner';
import type { MediaTakeShotRequest } from './MediaTakesPanel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { blobUrl } from './api';
import CellImage from './CellImage';
import CellEditor, { type StoryboardCellSeed } from './CellEditor';
import DccPanel, { type DccShotRequest } from './DccPanel';
import ShotWorkInspector from './ShotWorkInspector';
import ComicDeliveryWorkspace from './ComicDeliveryWorkspace';
import { deriveStoryboardSequence } from './storyboardSequenceModel';
import { canonicalJson } from './canonical';
import { validateRecord } from './validation';
import { useFilmGenerationPlan, movieClipFromProposal, validateMovieSequence, type MovieClip, type MovieSequence } from './generationPlan';
import MovieTimeline, { type MovieTimelineHandle } from './MovieTimeline';
import MovieAnimatic from './MovieAnimatic';
import { FilmcraftDisclosure, FilmcraftNote } from './FilmcraftGuide';
import EditorHandoff from './EditorHandoff';
import MovieTimingProposal from './MovieTimingProposal';
import { deriveMovieClipVisual } from './movieSequenceModel';
import { resolveClipEditSelection } from './movieEditSelectionModel';
import { deriveClipPreparationReadiness, type ClipPreparationStep } from './clipPreparationReadiness';
import FrameExtractionControl from './FrameExtractionControl';
import type { FrameExtractionResult } from './storyboardFrameApi';
import ShotSequenceCanvas from './ShotSequenceCanvas';
import NodeWorkspacePanel from './NodeWorkspacePanel';
import DreaminaPanel from './DreaminaPanel';
import HiggsfieldTools from './HiggsfieldTools';
import { selectedStoryboardCell, storyboardOperationRequest, type StoryboardCellAction } from './storyboardOperationRequest';
import type { StudioOperationRequest } from './studioOperationRequest';
import type { NodeRecordRequest } from './nodeWorkflowModel';
import { MOVIE_WORKSPACE_CONTEXT, type MovieWorkspaceContext, type MovieWorkspaceView, type MovieWorkspaceViewRequest } from './movieWorkspaceRouting';
import type { GenerationBrief, Project, WorkspaceApi, WorkspaceRecord } from './types';
import './movie-workspace.css';
import { shotBudgetTarget } from './budgetNavigation';

type Props = { project: Project; records: WorkspaceRecord[]; api: WorkspaceApi; sceneId: string; open: boolean;
  viewRequest?: MovieWorkspaceViewRequest;
  onContextChange?: (context: MovieWorkspaceContext) => void;
  onScene: (id: string) => void; onSaved: (record: WorkspaceRecord) => void; onDirty?: (value: boolean) => void;
  onOpenBudget?: (targetId?: string) => void;
  onReadSource?: (sceneId: string, paragraphId: string) => void;
  onOpenShot?: (sceneId: string, shotId: string, cellId?: string) => void;
  onTakes?: (sceneId: string, request?: NodeRecordRequest, shotRequest?: MediaTakeShotRequest) => void;
  onOpenTool: (tool: string, sceneId: string, request?: NodeRecordRequest) => void };

export default function MovieWorkspace({ project, records, api, sceneId, open, viewRequest, onContextChange, onScene, onSaved, onDirty, onTakes, onOpenTool, onReadSource, onOpenShot, onOpenBudget }: Props) {
  const scope = `${project.id}:${project.sourceHash}`, currentScope = useRef(scope); currentScope.current = scope;
  const recordId = 'movie-sequence:main';
  const saved = records.find(record => record.kind === 'movie-sequence' && record.id === recordId);
  const { plan, loading, error: planError, asset } = useFilmGenerationPlan(project, records);
  const initial = (): MovieSequence => saved ? structuredClone(saved.data as MovieSequence) : { sourceHash: project.sourceHash, title: `${project.title} · movie sequence`, clips: [], status: 'DRAFT' };
  const [draft, setDraft] = useState<MovieSequence>(initial), [baseline, setBaseline] = useState<WorkspaceRecord | undefined>(saved);
  const [view, setView] = useState<MovieWorkspaceView>('storyboard'), [selectedId, setSelectedId] = useState<string | null>('');
  const [shotSelection, setShotSelection] = useState<{ sceneId: string; shotId: string; cellId?: string }>();
  const [cameraRequest, setCameraRequest] = useState<DccShotRequest>(), [cameraOpen, setCameraOpen] = useState(false);
  const [cellEditing, setCellEditing] = useState<{ nonce: string; sceneId: string; shotId: string; cellId?: string; seed?: StoryboardCellSeed }>();
  const [cellDirty, setCellDirty] = useState(false);
  const [keyframeDirty, setKeyframeDirty] = useState(false);
  const [directionDirty, setDirectionDirty] = useState(false);
  const appliedViewRequest = useRef<number>();
  const [editorOpenRequest, setEditorOpenRequest] = useState<number>();
  const [editingClips, setEditingClips] = useState<string[]>([]), [editor, setEditor] = useState<string>();
  const [clipDrafts, setClipDrafts] = useState<Record<string, GenerationBrief | null>>({});
  const [stepRequests, setStepRequests] = useState<Record<string, { nonce: number; step: ClipPreparationStep }>>({});
  const stepNonce = useRef(0);
  const [imageOperation, setImageOperation] = useState<StudioOperationRequest>(), [imageEditor, setImageEditor] = useState(false), [imageDirty, setImageDirty] = useState(false), [preparingCellId, setPreparingCellId] = useState<string>();
  const mediaRead = useRef<AbortController>(), latestProject = useRef(project); latestProject.current = project;
  const showingEditor = imageEditor;
  const movieView = view === 'timeline' || view === 'movie-nodes';
  const sequenceView = movieView || view === 'storyboard';
  const context: MovieWorkspaceContext = cameraOpen ? 'camera' : cellEditing ? 'storyboard' : imageEditor || (movieView && editor) ? 'generation' : view;
  useEffect(() => { if (open) onContextChange?.(context); }, [open, context, onContextChange]);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [extractionBusy, setExtractionBusy] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [inspectTab, setInspectTab] = useState<'direction'|'source'|'inputs'>('direction');
  const graph = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const timelineHandle = useRef<MovieTimelineHandle>(null);
  const inspector = useRef<HTMLElement>(null);
  const [comicDirty, setComicDirty] = useState(false);
  const [nodeDirty, setNodeDirty] = useState(false);
  const [timingDirty, setTimingDirty] = useState(false);
  const [playbackPauseRequest, setPlaybackPauseRequest] = useState(0);
  const [clipEdits, setClipEdits] = useState<Record<string,boolean>>({});
  const generationDirty = Object.values(clipEdits).some(Boolean);
  const attempt = useRef<{ fingerprint: string; requestId: string }>();
  const touched = useRef(false);
  const dirty = baseline ? canonicalJson(baseline.data) !== canonicalJson(draft) : touched.current;
  const selected = selectedId === null ? undefined : draft.clips.find(clip => clip.id === selectedId) ?? draft.clips[0];
  const scene = project.scenes.find(item => item.id === selected?.sceneId);
  const shot = scene?.shots.find(item => item.id === selected?.shotId);
  const proposed = plan?.scenes.find(item => item.sceneId === selected?.sceneId)?.shots.find(item => item.shotId === selected?.shotId);
  const storyboard = useMemo(() => deriveStoryboardSequence(project, records), [project, records]);
  const cells = storyboard.shots.find(row => row.sceneId === selected?.sceneId && row.id === selected?.shotId)?.cells ?? [];
  const selectedVisual = selected ? deriveMovieClipVisual(selected, project, records) : undefined;
  const image = selectedVisual?.cell;
  const activeBrief = selected?.briefRef ? records.find(record => record.id === selected.briefRef!.id && record.sha256 === selected.briefRef!.sha256) : undefined;
  const readiness = selected ? deriveClipPreparationReadiness(selected, project, records,
    Object.prototype.hasOwnProperty.call(clipDrafts, selected.id) ? { draft: clipDrafts[selected.id], unsaved: Boolean(clipEdits[selected.id]) } : undefined) : undefined;
  const edits = useMemo(() => editingClips.map(id => draft.clips.find(clip => clip.id === id)).filter((clip): clip is MovieClip => Boolean(clip)), [editingClips, draft.clips]);
  useEffect(() => { onDirty?.(Boolean(dirty || nodeDirty || timingDirty || generationDirty || imageDirty || comicDirty || cellDirty || keyframeDirty || directionDirty)); }, [dirty, nodeDirty, timingDirty, generationDirty, imageDirty, comicDirty, cellDirty, keyframeDirty, directionDirty, onDirty]);
  useEffect(() => {
    if (!touched.current && saved && saved.version > (baseline?.version ?? 0) && saved.sha256 !== baseline?.sha256) {
      setDraft(structuredClone(saved.data as MovieSequence)); setBaseline(saved);
    }
  }, [saved, baseline?.sha256, baseline?.version]);
  useEffect(() => {
    if (view === 'movie-nodes') {
      const button = Array.from(graph.current?.querySelectorAll<HTMLElement>('[data-movie-clip]') ?? []).find(item => item.dataset.movieClip === selected?.id);
      button?.scrollIntoView?.({block:'nearest',inline:'center'});
    }
  }, [selected?.id, view, editor]);
  useEffect(() => { if (inspector.current) inspector.current.scrollTop = 0; }, [selected?.id, editor]);
  useEffect(() => () => { mediaRead.current?.abort(); }, []);
  useEffect(() => { if (!open) { mediaRead.current?.abort(); setPreparingCellId(undefined); } }, [open, scope]);
  useEffect(() => {
    if (!open || !viewRequest || viewRequest.nonce === appliedViewRequest.current || busy || extractionBusy) return;
    appliedViewRequest.current = viewRequest.nonce;
    if (timingDirty) { setError('Apply or discard the timeline edit before changing views, then choose the destination again.'); return; }
    if (viewRequest.sceneId && !project.scenes.some(row => row.id === viewRequest.sceneId)) { setError('That movie scene is unavailable. Choose a scene from the current project.'); return; }
    if (viewRequest.shotId && !project.scenes.find(row => row.id === viewRequest.sceneId)?.shots.some(shot => shot.id === viewRequest.shotId) || viewRequest.cellId && !project.cells.some(cell => cell.sceneId === viewRequest.sceneId && cell.shotId === viewRequest.shotId && cell.id === viewRequest.cellId)) { setError('That storyboard shot or frame is unavailable in this scene.'); return; }
    mediaRead.current?.abort(); setPreparingCellId(undefined);
    setCameraOpen(false);
    if (viewRequest.view === 'timeline') setTimelineExpanded(true);
    setView(viewRequest.openEditors ? 'editors' : viewRequest.view); setEditor(undefined); setImageEditor(false); setError('');
    if (viewRequest.openEditors) { setTimelineExpanded(false); setEditorOpenRequest(viewRequest.nonce); }
    if (viewRequest.sceneId) {
      const candidates = draft.clips.filter(clip => clip.sceneId === viewRequest.sceneId && (!viewRequest.shotId || clip.shotId === viewRequest.shotId)
        && (!viewRequest.cellId || deriveMovieClipVisual(clip, project, records).cell?.id === viewRequest.cellId));
      const target = candidates.find(clip => clip.id === selectedId) ?? candidates[0];
      const targetShot = viewRequest.shotId ?? target?.shotId ?? project.scenes.find(row => row.id === viewRequest.sceneId)?.shots[0]?.id;
      if (targetShot) setShotSelection({ sceneId: viewRequest.sceneId, shotId: targetShot, cellId: viewRequest.cellId });
      // An empty requested scene must not silently show a different scene's clip.
      setSelectedId(target?.id ?? null); onScene(viewRequest.sceneId);
    }
  }, [open, viewRequest, busy, extractionBusy, timingDirty, project, records, draft.clips, selectedId, onScene]);
  async function prepareCell(targetSceneId: string, targetShotId: string, targetCellId: string, action: StoryboardCellAction) {
    if (busy || timingDirty) return;
    mediaRead.current?.abort(); const controller = new AbortController(); mediaRead.current = controller;
    const captured = scope;
    setError(''); setPreparingCellId(targetCellId);
    try {
      const cellBasis = canonicalJson(selectedStoryboardCell(project, targetSceneId, targetShotId, targetCellId));
      const request = await storyboardOperationRequest(project, targetSceneId, targetShotId, targetCellId, action, controller.signal);
      if (controller.signal.aborted || captured !== currentScope.current) return;
      if (canonicalJson(selectedStoryboardCell(latestProject.current, targetSceneId, targetShotId, targetCellId)) !== cellBasis) throw new Error('This storyboard frame changed while its image was being read. Choose the current frame again.');
      setImageOperation(request); setEditor(undefined); setImageEditor(true);
    } catch (caught) { if (!controller.signal.aborted && captured === currentScope.current) setError(caught instanceof Error ? caught.message : 'The selected frame could not be prepared.'); }
    finally { if (mediaRead.current === controller) setPreparingCellId(undefined); }
  }
  function changeView(next: MovieWorkspaceView) {
    if (busy || extractionBusy) return;
    if (timingDirty) { setError('Apply or discard the timeline edit before changing views.'); return; }
    mediaRead.current?.abort(); setPreparingCellId(undefined); setView(next);
    if (next === 'timeline') setTimelineExpanded(true);
    returnToMovie();
  }
  function returnToMovie() { setEditor(undefined); setImageEditor(false); setCameraOpen(false); }
  function openTakeTrim(clipId: string) {
    if (busy || extractionBusy) return;
    if (timingDirty) { setError('Apply or discard the current take or duration edit before choosing another clip.'); return; }
    if (!draft.clips.some(clip => clip.id === clipId)) { setError('That clip is no longer in the movie draft.'); return; }
    returnToMovie(); setView('timeline'); setTimelineExpanded(true);
    setPlaybackPauseRequest(value => value + 1); select(clipId, false);
    locateExisting('.movie-take-selection');
  }
  function update(change: (value: MovieSequence) => MovieSequence) { if (busy) return; touched.current = true; setDraft(value => change(structuredClone(value))); setNotice(''); setError(''); }
  function select(id: string, prepare = Boolean(editor)) { if (extractionBusy) return; const clip = draft.clips.find(item => item.id === id); setSelectedId(id); if (prepare && clip) openClip(id); else if (!prepare) setEditor(undefined); if (clip) { setShotSelection({ sceneId: clip.sceneId, shotId: clip.shotId, cellId: deriveMovieClipVisual(clip, project, records).cell?.id }); onScene(clip.sceneId); } }
  function selectStoryboard(targetSceneId: string, targetShotId: string, cellId?: string) {
    if (timingDirty) { setError('Apply or discard the timeline edit before changing storyboard shots.'); return; }
    setPlaybackPauseRequest(value => value + 1);
    mediaRead.current?.abort(); setPreparingCellId(undefined);
    setShotSelection({ sceneId: targetSceneId, shotId: targetShotId, cellId });
    const matches = draft.clips.filter(clip => clip.sceneId === targetSceneId && clip.shotId === targetShotId
      && (!cellId || deriveMovieClipVisual(clip, project, records).cell?.id === cellId));
    const match = matches.find(clip => clip.id === selected?.id) ?? matches[0];
    setSelectedId(match?.id ?? null); onScene(targetSceneId);
  }
  function editFrame(targetSceneId: string, targetShotId: string, cellId?: string, seed?: StoryboardCellSeed) {
    if (cellDirty) { setError('Save or finish the open frame before opening another. Your frame edits are still here.'); return; }
    if (timingDirty) { setError('Apply or discard the timeline edit before editing a storyboard frame.'); return; }
    const target = project.scenes.find(row => row.id === targetSceneId);
    if (!target?.shots.some(shot => shot.id === targetShotId) || cellId && !project.cells.some(cell => cell.id === cellId && cell.sceneId === targetSceneId && cell.shotId === targetShotId)) { setError('That frame is no longer available for this shot.'); return; }
    selectStoryboard(targetSceneId, targetShotId, cellId);
    setCellEditing({ nonce: crypto.randomUUID(), sceneId: targetSceneId, shotId: targetShotId, cellId, seed });
  }
  function rehearseShot(targetSceneId: string, targetShotId: string) {
    if (directionDirty) { setError('Save shot direction before preparing a camera rehearsal. Your edits are still in the storyboard inspector.'); return; }
    if (busy || extractionBusy) return;
    if (timingDirty) { setError('Apply or discard the timeline edit before opening the camera rehearsal.'); return; }
    if (!project.scenes.find(row => row.id === targetSceneId)?.shots.some(shot => shot.id === targetShotId)) return;
    selectStoryboard(targetSceneId, targetShotId);
    setCameraRequest({ nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: targetSceneId, shotId: targetShotId }); setCameraOpen(true);
  }
  function move(id: string, delta: -1 | 1) { update(value => { const index = value.clips.findIndex(clip => clip.id === id), next = index + delta; if (index >= 0 && next >= 0 && next < value.clips.length) [value.clips[index], value.clips[next]] = [value.clips[next], value.clips[index]]; return value; }); }
  function chooseShot(targetSceneId: string, targetShotId: string) {
    if (directionDirty) { setError('Save shot direction before preparing a clip. Your edits are still in the storyboard inspector.'); return; }
    if (busy || timingDirty) return;
    if (!project.scenes.find(item => item.id === targetSceneId)?.shots.some(item => item.id === targetShotId)) { setError('That storyboard shot is no longer available. Choose its current setup before preparing a clip.'); return; }
    const existing = selected?.sceneId === targetSceneId && selected.shotId === targetShotId ? selected : draft.clips.find(clip => clip.sceneId === targetSceneId && clip.shotId === targetShotId);
    if (existing) { select(existing.id); openClip(existing.id); return; }
    const id = `clip:${crypto.randomUUID()}`;
    update(value => ({ ...value, clips: [...value.clips, { id, sceneId: targetSceneId, shotId: targetShotId, plannedDurationMs: null, sourceRefs: [], note: 'Additional coverage instance. Map source and choose its position before generation.' }] }));
    setSelectedId(id); onScene(targetSceneId); openClip(id);
  }
  function useProposal() {
    if (!plan?.initialMovieClips?.length || busy || dirty || draft.clips.length) return;
    const next: MovieSequence = { sourceHash: project.sourceHash, title: `${project.title} · source cut proposal`, clips: plan.initialMovieClips.map(movieClipFromProposal), status: 'DRAFT' };
    validateMovieSequence(next, project); touched.current = true; setDraft(next); setSelectedId(next.clips[0].id);
    const first = next.clips[0]; setShotSelection({ sceneId: first.sceneId, shotId: first.shotId, cellId: deriveMovieClipVisual(first, project, records).cell?.id }); onScene(first.sceneId);
    setNotice('Source cut proposal loaded for editing. Review the unresolved source questions and clip boundaries before generation.');
  }
  async function save() {
    if (busy || timingDirty || !dirty) return;
    const data = structuredClone(draft), captured = scope;
    setError('');
    try {
      validateMovieSequence(data, project);
      for (const clip of data.clips) { const edit = resolveClipEditSelection(clip, project, records); if (edit.state === 'NEEDS_REVIEW') throw new Error(edit.reason); }
      const fingerprint = canonicalJson({ data, expectedVersion: baseline?.version ?? null });
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
      setBusy(true);
      const record = await api.saveRecord({ id: recordId, kind: 'movie-sequence', data, expectedVersion: baseline?.version ?? null, requestId: attempt.current.requestId });
      await validateRecord(record, project);
      if (record.id !== recordId || record.kind !== 'movie-sequence' || canonicalJson(record.data) !== canonicalJson(data)) throw new Error('Movie save did not match the submitted sequence.');
      if (currentScope.current !== captured) return;
      touched.current = false; setBaseline(record); onSaved(record); setNotice(`Movie sequence saved · v${record.version}`);
    } catch (caught) { if (currentScope.current === captured) setError(`${caught instanceof Error ? caught.message : 'Save was not confirmed.'} Your sequence stays here. An unchanged retry uses the same request.`); }
    finally { if (currentScope.current === captured) setBusy(false); }
  }
  function openClip(id: string, step?: ClipPreparationStep) { setPlaybackPauseRequest(value => value + 1); setEditingClips(ids => ids.includes(id) ? ids : [...ids, id]); setEditor(id); setImageEditor(false);
    if (!movieView) setView('timeline');
    if (step) setStepRequests(requests => ({ ...requests, [id]: { nonce: ++stepNonce.current, step } }));
  }
  function prepareSelected() { if (!selected || busy || timingDirty) return; openClip(selected.id); }
  function retainExtractedFrame(result: FrameExtractionResult) {
    onSaved(result.assetRecord); onSaved(result.provenanceRecord); onSaved(result.cellRecord);
    setNotice('Individual frame saved as a review candidate. Review affected clip inputs before saving preparation.');
  }
  function retainBrief(clip: MovieClip, record: WorkspaceRecord) {
    onSaved(record);
    const brief = record.data as GenerationBrief;
    if (record.kind === 'generation-brief' && brief.sceneId === clip.sceneId && brief.shotIds.includes(clip.shotId)) update(value => ({ ...value, clips: value.clips.map(item => item.id === clip.id ? { ...item, briefRef: { id: record.id, sha256: record.sha256 } } : item) }));
  }
  const visualSummary = useMemo(() => {
    const visuals = draft.clips.map(clip => deriveMovieClipVisual(clip, project, records));
    const withImage = visuals.filter(visual => visual.cell?.imageHash && visual.label !== 'Image provenance needs review').length;
    return { withImage, needingImage: visuals.length - withImage, sceneCount: new Set(draft.clips.map(clip => clip.sceneId)).size };
  }, [draft.clips, project, records]);
  const gaps = plan?.scenes.flatMap(row => [...(row.coverage?.unassignedActionIds ?? []), ...(row.coverage?.unassignedDialogueIds ?? [])]) ?? [];
  const dirtyClips = draft.clips.filter(clip => clipEdits[clip.id]);
  const childDraftCount = dirtyClips.length + [timingDirty, imageDirty, comicDirty, nodeDirty, cellDirty].filter(Boolean).length;
  const canLocateDraft = !busy && !extractionBusy && !timingDirty && !cellEditing;
  const locateExisting = (selector: string) => requestAnimationFrame(() => {
    const area = workspace.current?.querySelector<HTMLElement>(selector);
    area?.scrollIntoView?.({ block: 'nearest' });
    area?.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),button:not(:disabled)')?.focus();
  });
  return <section ref={workspace} className="movie-workspace" data-view={view} data-editing={showingEditor} data-timeline-expanded={timelineExpanded && sequenceView && !showingEditor && !cameraOpen ? 'true' : 'false'} hidden={!open} data-unsaved={dirty || nodeDirty || timingDirty || generationDirty || imageDirty || comicDirty || cellDirty || keyframeDirty || directionDirty ? 'true' : undefined} aria-label="Movie workspace">
    <header className="movie-heading"><div><span className="movie-eyebrow">MOVIE / LOCAL DRAFT</span><h2>{project.title}</h2><p>{project.scenes.length} scenes · {project.scenes.reduce((sum, item) => sum + item.shots.length, 0)} planned shots · {draft.clips.length} timeline clips</p></div><div className="movie-save"><span>{dirty ? 'Unsaved sequence' : baseline ? 'Sequence saved' : 'Start a movie sequence'}</span><button className="primary" disabled={busy || timingDirty || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save movie sequence'}</button></div></header>
    {childDraftCount > 0 && <details className="movie-unsaved-drafts"><summary>Unsaved movie drafts · {childDraftCount}</summary><p>These editors keep separate drafts. Open each one to save or finish its edits.</p><ul>
      {dirtyClips.map(clip => { const row = project.scenes.find(item => item.id === clip.sceneId), label = row?.shots.find(item => item.id === clip.shotId)?.label ?? clip.shotId; return <li key={clip.id}><button type="button" disabled={!canLocateDraft} data-draft-clip={clip.id} onClick={() => { select(clip.id, false); openClip(clip.id); }}>Clip {draft.clips.indexOf(clip) + 1} · Scene {row?.index ?? clip.sceneId} · Shot {label} · generation brief</button></li>; })}
      {timingDirty && <li><button type="button" disabled={busy || extractionBusy || Boolean(cellEditing)} onClick={() => { setTimelineExpanded(true); locateExisting('.movie-timeline'); }}>Timeline take or duration edit</button></li>}
      {cellDirty && cellEditing && <li><button type="button" onClick={() => locateExisting('.cell-editor')}>Storyboard frame · {project.scenes.find(row => row.id === cellEditing.sceneId)?.shots.find(shot => shot.id === cellEditing.shotId)?.label ?? cellEditing.shotId}</button></li>}
      {imageDirty && <li><button type="button" disabled={!canLocateDraft} onClick={() => { setImageEditor(true); locateExisting('.movie-image-preparation'); }}>Image preparation{imageOperation?.title ? ` · ${imageOperation.title}` : ''}</button></li>}
      {nodeDirty && <li><button type="button" disabled={!canLocateDraft} onClick={() => { setView('connections'); returnToMovie(); }}>Tool connection drafts</button></li>}
      {comicDirty && <li><button type="button" disabled={!canLocateDraft} onClick={() => { setView('comic'); returnToMovie(); }}>Comic & edition drafts</button></li>}
    </ul>{timingDirty && <p>Apply or discard pending take or duration changes in the timeline before opening another editor.</p>}</details>}
    <nav className="movie-views" aria-label="Movie views">{([['storyboard','Storyboard'],['timeline','Timeline'],['comic','Comic'],['editors','Editors']] as const).map(([id,label]) => <button key={id} disabled={busy || extractionBusy} aria-pressed={view === id} title={MOVIE_WORKSPACE_CONTEXT[id].purpose} onClick={() => changeView(id)}>{label}</button>)}<details className="movie-workflow-tools" open={view === 'movie-nodes' || view === 'connections' || undefined}><summary>Workflow tools{view === 'movie-nodes' ? ' · Movie nodes' : view === 'connections' ? ' · Connections' : ''}</summary><div>{([['movie-nodes','Movie nodes'],['connections','Tool connections']] as const).map(([id,label]) => <button key={id} type="button" aria-label={label} disabled={busy || extractionBusy} aria-pressed={view === id} onClick={() => changeView(id)}>{label}<small>{id === 'movie-nodes' ? 'The same cut, shown as connected clips' : 'Inspect tools and their inputs'}</small></button>)}</div></details></nav>
    {!cameraOpen && !showingEditor && sequenceView && draft.clips.length > 0 && <nav className="movie-scene-jumps" aria-label="Jump to movie scene">{project.scenes.map(row => { const first = draft.clips.find(clip => clip.sceneId === row.id); return <button key={row.id} disabled={!first || extractionBusy} aria-current={selected?.sceneId === row.id ? 'step' : undefined} title={row.heading} onClick={() => { if (first) { select(first.id); } }}>Scene {String(row.index).padStart(2,'0')}<small>{draft.clips.filter(clip => clip.sceneId === row.id).length} clips</small></button>; })}</nav>}
    {error && <p role="alert" className="movie-error">{error}</p>}{notice && <p role="status" className="movie-notice">{notice}</p>}{planError && <p role="alert" className="movie-error">{planError}</p>}
    <div className="movie-main-task" hidden={cameraOpen}>
    <div hidden={imageEditor || !movieView}>
      {!draft.clips.length ? <div className="movie-start"><h3>Plan the sequence before producing it.</h3><p>Plan each clip’s opening image, key action and outgoing cut. A shot can appear in more than one timeline clip.</p><p>Start the whole-film cut from the timeline below.</p><button onClick={() => setView('storyboard')}>Choose planned storyboard shots</button></div> : <>
      <div className={`movie-editing-layout${editor ? ' is-preparing' : ''}`}><main className="movie-canvas">
        {view === 'timeline' ? <div className="movie-sequence-overview"><span className="movie-eyebrow">ONE MOVIE SEQUENCE</span><h3>Shape the cut below.</h3><p>Scrub the bottom timeline to inspect a clip, refine its direction and prepare its inputs here. The storyboard, clip nodes and editor package share this sequence.</p><FilmcraftNote entryId="term:kuleshov" label="Try the neighboring shot: context changes meaning"/><p>{visualSummary.sceneCount} of {project.scenes.length} scenes represented · {visualSummary.withImage} clips with image candidates · {visualSummary.needingImage} need a linked image or provenance review.</p><button type="button" className="movie-editor-next" disabled={busy || extractionBusy || timingDirty} onClick={() => changeView('editors')}>Prepare editor handoff →</button></div> : <div ref={graph} className="movie-node-canvas" aria-label="Movie clip node graph"><p className="movie-graph-hint">Each node is one clip in your movie. Connections follow the exact timeline order.</p><div className="movie-node-row">{draft.clips.map((clip,index) => { const row = project.scenes.find(item => item.id === clip.sceneId)!; const visual = deriveMovieClipVisual(clip, project, records), thumb = visual.cell; return <div className="movie-node-link" key={clip.id}><button data-movie-clip={clip.id} data-storyboard-cell={thumb?.id} data-visual-binding={visual.binding} disabled={extractionBusy} aria-label={`Select movie clip ${index + 1}`} aria-pressed={clip.id === selected?.id} onClick={() => select(clip.id)}><small>CLIP {String(index + 1).padStart(2,'0')} · SCENE {String(row.index).padStart(2,'0')}</small>{thumb?.imageHash ? <span className="movie-node-image"><CellImage key={`${thumb.id}:${thumb.imageHash}`} cell={thumb} thumbnail/></span> : <span className="movie-node-no-frame">{visual.binding === 'AMBIGUOUS' ? 'Choose a storyboard frame' : visual.binding === 'CHANGED' ? 'Storyboard link needs review' : 'Image needed for this beat'}</span>}<strong>Shot {row.shots.find(item => item.id === clip.shotId)?.label}</strong><span>{clip.plannedDurationMs === null ? 'Untimed · duration needed' : `${clip.plannedDurationMs / 1000}s planned`}</span><small title={visual.reason}>{visual.label}<br/>{clip.briefRef ? 'Brief linked · verify in timeline' : 'Preparation needed'}</small></button>{index < draft.clips.length - 1 && <span className="movie-cut-edge" aria-label={`Cut to clip ${index + 2}`}><i/>CUT →</span>}</div>; })}</div></div>}

        <details className="movie-coverage"><summary>Whole-film inputs & source gaps</summary><p>Planned shots describe coverage; a camera setup can serve several shots. Timeline clips define the proposed edit. Production and take selection remain separate.</p>{project.scenes.map(row => { const rowCells = project.cells.filter(cell => cell.sceneId === row.id); return <div key={row.id}><strong>Scene {row.index}</strong><span>{row.shots.length} planned shots · {rowCells.filter(cell => cell.imageHash).length} storyboard images · {draft.clips.filter(clip => clip.sceneId === row.id).length} timeline clips</span></div>; })}<p>{plan ? gaps.length : 'Unknown'} source action/dialogue items without a proposed assignment in the retained audit. Contradictions still require review.</p>{asset && <a href={blobUrl((asset.data as {asset:{sha256:string}}).asset.sha256)} download="whole-film-generation-plan.json">Download full source-bound plan</a>}</details>
      </main><aside ref={inspector} className="movie-clip-inspector" aria-label="Movie clip inspector">
        {selected && scene && shot && <><div className="movie-inspector-title"><span>CLIP {draft.clips.indexOf(selected) + 1} / SCENE {scene.index}</span><h3>Shot {shot.label}</h3><p>{scene.heading}</p></div>{image?.imageHash && <div className="movie-selected-image" hidden={editor === selected.id} data-storyboard-cell={image.id}><CellImage key={`${image.id}:${image.imageHash}`} cell={image}/></div>}{selectedVisual && <p className="movie-proposal-label" title={selectedVisual.reason}>{selectedVisual.label}</p>}{image && editor !== selected.id && <FrameExtractionControl project={project} cell={image} record={records.find(record => record.id === `storyboard-cell:${image.id}`)} disabled={busy || timingDirty || cellDirty} onBusy={setExtractionBusy} onExtracted={retainExtractedFrame}/>}{readiness && <details className="movie-clip-readiness" aria-label="Clip preparation checklist" open={editor !== selected.id}><summary><strong>{editor === selected.id ? "Preparation gaps" : "Prepare this clip"}</strong><span>{readiness.remaining} to review</span></summary><ol>{readiness.items.map(item => <li key={item.id} data-state={item.state}><button type="button" disabled={busy || timingDirty || extractionBusy} aria-label={`Review ${item.label.toLowerCase()}`} onClick={() => openClip(selected.id, item.step)}><span aria-hidden="true">{item.state === 'PRESENT' ? '•' : '○'}</span><span><b>{item.label}</b><small>{item.detail}</small></span></button></li>)}</ol><p>{readiness.basis === 'LIVE_DRAFT' ? readiness.unsaved ? 'Includes this clip’s unsaved draft.' : 'Includes this clip’s open draft.' : 'Based on retained project records.'} Candidate inputs; review before production.</p></details>}<button className={editor === selected.id ? "movie-hide-preparation" : "primary"} disabled={busy || timingDirty || extractionBusy} onClick={() => editor === selected.id ? setEditor(undefined) : prepareSelected()}>{editor === selected.id ? 'Hide preparation' : activeBrief ? 'Open generation brief' : 'Prepare this clip'}</button><nav className="movie-clip-shortcuts" aria-label="Selected clip tools">{onOpenBudget && <button type="button" onClick={() => onOpenBudget(shotBudgetTarget(scene.id, shot.id))}>Shot costs</button>}<button type="button" disabled={extractionBusy} onClick={() => rehearseShot(scene.id, shot.id)}>Camera</button><button type="button" disabled={extractionBusy} onClick={() => onOpenTool('casting', scene.id)}>Casting</button>{onTakes && <button type="button" disabled={extractionBusy} onClick={() => onTakes(scene.id, undefined, { nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: scene.id, shotId: shot.id })}>Takes</button>}</nav><div hidden={editor === selected.id}><div className="movie-inspector-tabs">{(['direction','source','inputs'] as const).map(tab => <button key={tab} aria-pressed={inspectTab === tab} onClick={() => setInspectTab(tab)}>{tab === 'direction' ? 'Moments & cut' : tab === 'source' ? 'Screenplay' : 'Inputs'}</button>)}</div>
          {inspectTab === 'direction' && <><p className="movie-proposal-label">PLANNED DIRECTION · REVIEW BEFORE PRODUCTION</p>{selectedVisual?.binding !== 'EXACT_BEAT' && proposed?.proposedCells?.map((cell,index) => <div className="movie-beat" key={index}><strong>{cell.role === 'START' ? 'Opening' : cell.role === 'END' ? 'Ending' : 'Key action'}</strong><p>{cell.direction}</p></div>)}{selectedVisual?.binding !== 'EXACT_BEAT' && !proposed && <p>{shot.description}</p>}{selectedVisual?.binding !== 'EXACT_BEAT' && proposed?.proposedCut && <div className="movie-beat"><strong>Cut / continuity</strong><p>{proposed.proposedCut.direction}</p></div>}<label>Clip direction<textarea disabled={busy} maxLength={8000} aria-label="Movie clip direction" value={selected.note} onChange={event => update(value => ({ ...value, clips: value.clips.map(clip => clip.id === selected.id ? {...clip,note:event.target.value} : clip) }))}/></label><FilmcraftDisclosure className="movie-direction-guide" label="Filmmaking guide · direction & cuts" context="edit" compact onUsePrompt={busy ? undefined : text => { const note = [selected.note.trimEnd(), text].filter(Boolean).join('\n\n'); if (note.length > 8000) { setError('Shorten the clip direction before adding this planning note.'); return; } update(value => ({ ...value, clips: value.clips.map(clip => clip.id === selected.id ? { ...clip, note } : clip) })); }}/>{proposed?.continuityQuestions?.map((question,index) => <p className="movie-error" key={index}>{typeof question === 'string' ? question : JSON.stringify(question)}</p>)}</>}
          {inspectTab === 'source' && <div className="movie-source">{selected.sourceRefs.length ? selected.sourceRefs.map(id => { const paragraph = scene.paragraphs.find(item => item.id === id); return <div key={id}><small>{paragraph?.type} · {id}</small><p>{paragraph?.text}</p>{paragraph && onReadSource && <button onClick={() => onReadSource(scene.id, id)}>Read {id} in CanIScreenwrite</button>}</div>; }) : <p>No screenplay passage is mapped to this clip yet.</p>}</div>}
          {inspectTab === 'inputs' && <><p>{image?.imageHash ? 'This beat has an image candidate' : selectedVisual?.label ?? 'Linked frame needed'} · {cells.filter(cell => cell.imageHash).length} images across this shot · {activeBrief ? 'Exact saved brief linked' : 'Generation brief needed'}</p>{proposed?.missingInputs?.map((item,index) => <p className="movie-input-gap" key={index}>{typeof item === 'string' ? item.replace(/_/g,' ').toLowerCase() : JSON.stringify(item)}</p>)}<button onClick={() => { setView('storyboard'); selectStoryboard(scene.id, shot.id, selectedVisual?.cell?.id); }}>Edit storyboard frames</button></>}
          <div className="movie-inspector-actions"><button onClick={() => update(value => { const index = value.clips.findIndex(clip => clip.id === selected.id); value.clips.splice(index + 1, 0, { ...structuredClone(selected), id: `clip:${crypto.randomUUID()}`, briefRef: undefined }); const copy = value.clips[index+1]; delete copy.briefRef; delete copy.editSelection; return value; })}>Repeat this setup</button></div>
        </div></>}
        <div className="movie-clip-preparation" hidden={!editor || imageEditor || !movieView}>
          {edits.map(clip => { const target = project.scenes.find(item => item.id === clip.sceneId)!; return <DreaminaPanel onOpenBudget={onOpenBudget} key={`${scope}:${clip.id}`} project={project} scene={target} api={api} records={records} embedded presentation="inspector" stepRequest={stepRequests[clip.id]} onDraftChange={value => setClipDrafts(prior => canonicalJson(prior[clip.id] ?? null) === canonicalJson(value) ? prior : {...prior,[clip.id]:value})} onTakes={onTakes ? request => onTakes(target.id, request, { nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: target.id, shotId: clip.shotId }) : undefined} onDirty={value => setClipEdits(prior => prior[clip.id] === value ? prior : {...prior,[clip.id]:value})} open={open && movieView && !imageEditor && editor === clip.id} sceneDirty={false} onClose={() => setEditor(undefined)} onReturnToStoryboard={() => { setEditor(undefined); setView('storyboard'); selectStoryboard(clip.sceneId, clip.shotId, deriveMovieClipVisual(clip, project, records).cell?.id); }} onSaved={record => retainBrief(clip,record)} shotRequest={clip.briefRef ? undefined : {nonce:`movie:${clip.id}`,projectId:project.id,sourceHash:project.sourceHash,sceneId:clip.sceneId,shotId:clip.shotId,movieClip:{id:clip.id,note:clip.note,sourceRefs:clip.sourceRefs,plannedDurationMs:clip.plannedDurationMs}}} recordRequest={clip.briefRef ? {nonce:`movie:${clip.id}:${clip.briefRef.sha256}`,projectId:project.id,sourceHash:project.sourceHash,sceneId:clip.sceneId,recordRef:{...clip.briefRef,kind:'generation-brief'},intent:'OPEN_RECORD'} : undefined}/>; })}
        </div>
      </aside></div></>}
    </div>
    <div hidden={view !== 'storyboard' || showingEditor}><ShotSequenceCanvas project={project} records={records} clips={draft.clips} coverageDisabled={busy || extractionBusy || timingDirty} onOpenClip={openTakeTrim} onReviewTakes={onTakes ? (targetSceneId, targetShotId) => onTakes(targetSceneId, undefined, { nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: targetSceneId, shotId: targetShotId }) : undefined} sceneId={sceneId} open={open && view === 'storyboard' && !showingEditor} onScene={onScene} selectedShot={shotSelection ?? (selected ? { sceneId: selected.sceneId, shotId: selected.shotId, cellId: selectedVisual?.cell?.id } : undefined)} onOpenShot={editFrame} onPrepareShot={chooseShot} onSelectionChange={selectStoryboard} renderShotKeyframes={row => <ShotKeyframePlanner project={project} records={records} sceneId={row.sceneId} shotId={row.id} api={api} onSaved={onSaved} onDirty={setKeyframeDirty} onEditFrame={cellId => editFrame(row.sceneId, row.id, cellId)} onAddFrame={() => editFrame(row.sceneId, row.id)}/>} shotDrafts={{direction:directionDirty,frames:keyframeDirty || cellDirty}} renderShotWork={(row, step) => <ShotWorkInspector step={step} api={api} onSaved={onSaved} onDirectionDirty={setDirectionDirty} onBudget={onOpenBudget ? () => onOpenBudget(shotBudgetTarget(row.sceneId, row.id)) : undefined} onReadSource={onReadSource} project={project} records={records} sceneId={row.sceneId} shotId={row.id} onAddFrame={seed => editFrame(row.sceneId, row.id, undefined, seed)} onEditFrame={cellId => editFrame(row.sceneId, row.id, cellId)} onCamera={() => rehearseShot(row.sceneId, row.id)} onPrepare={() => chooseShot(row.sceneId, row.id)} onTakes={onTakes ? () => onTakes(row.sceneId, undefined, { nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: row.sceneId, shotId: row.id }) : undefined}/>}  onPrepareCell={(scene, shot, cell, action) => void prepareCell(scene, shot, cell, action)} preparingCellId={preparingCellId}/></div>
    <section className="movie-sequence-dock" aria-label="Unified movie timeline" hidden={!sequenceView || showingEditor}>
      <header className="movie-sequence-dock-heading"><div><strong>Full movie sequence</strong><span>{draft.clips.length} clips · {visualSummary.sceneCount}/{project.scenes.length} scenes · {visualSummary.needingImage} image links to review</span></div><div className="movie-dock-actions">{view !== 'timeline' && <button type="button" onClick={() => changeView('timeline')}>Edit timing & takes →</button>}<button type="button" disabled={timingDirty} aria-expanded={timelineExpanded} aria-controls="movie-sequence-dock-content" onClick={() => { setPlaybackPauseRequest(value => value + 1); setTimelineExpanded(value => !value); }}>{timelineExpanded ? 'Collapse timeline' : 'Expand timeline'}</button></div></header>
      <div id="movie-sequence-dock-content" hidden={!timelineExpanded}>
        {!draft.clips.length ? <div className="movie-sequence-dock-start"><p>Build one ordered movie cut from the retained screenplay proposal. Timing, images and production approval stay available for review.</p>{plan?.initialMovieClips?.length ? <button className="primary" disabled={busy} onClick={useProposal}>Use screenplay cut proposal · {plan.initialMovieClips.length} clips</button> : <p>{loading ? 'Reading the whole-film generation plan…' : 'No source cut proposal is retained yet.'}</p>}</div> : <>
          <MovieTimingProposal project={project} clips={draft.clips} disabled={busy || extractionBusy || timingDirty} onApply={clips => { update(value => ({ ...value, clips })); setEditor(undefined); setNotice('Proposed storyboard timing applied. Refine the cuts, then save the movie sequence.'); }}/>
          <div className="movie-sequence-dock-body">
            <MovieAnimatic compact pauseRequest={playbackPauseRequest} project={project} clips={draft.clips} records={records} selectedId={selected?.id ?? null} onSelect={id => select(id, false)} onPlaybackStart={() => setEditor(undefined)} onPositionChange={ms => timelineHandle.current?.setPlayhead(ms)} active={open && sequenceView && timelineExpanded && !imageEditor && !cameraOpen && !cellEditing} disabled={busy || extractionBusy || timingDirty}/>
            <MovieTimeline active={open && sequenceView && timelineExpanded && !imageEditor && !cameraOpen && !cellEditing} onEditSelection={(id, selection) => update(value => ({ ...value, clips: value.clips.map(clip => { if (clip.id !== id) return clip; if (selection) return { ...clip, editSelection: selection }; const next = { ...clip }; delete next.editSelection; return next; }) }))} onReviewTakes={onTakes ? (sceneId, shotId) => onTakes(sceneId, undefined, { nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId, shotId }) : undefined} ref={timelineHandle} compact showInspector={view === 'timeline'} disabled={busy || extractionBusy} onEditingChange={setTimingDirty} project={project} clips={draft.clips} records={records} selectedId={selected?.id ?? (selectedId === null ? null : '')} onSelect={select} onMove={move} onDuration={(id, ms) => update(value => ({ ...value, clips: value.clips.map(clip => clip.id === id ? { ...clip, plannedDurationMs: ms } : clip) }))}/>
          </div>
        </>}
      </div>
    </section>
    <div className="movie-editor-workspace" hidden={view !== 'editors' || showingEditor}><EditorHandoff openRequest={editorOpenRequest} project={project} sequence={draft} records={records} savedSequence={baseline} dirty={dirty} disabled={busy || extractionBusy || timingDirty} onSelectClip={openTakeTrim}/></div>
    <ComicDeliveryWorkspace key={scope} project={project} records={records} api={api} open={open && view === 'comic' && !showingEditor} onSaved={onSaved} onDirty={setComicDirty} onOpenStoryboard={cellId => {
      const cell = project.cells.find(row => row.id === cellId); if (!cell) return;
      changeView('storyboard'); selectStoryboard(cell.sceneId, cell.shotId, cell.id);
    }} onAddSharedFrame={cellId => {
      const cell = project.cells.find(row => row.id === cellId);
      const targetScene = project.scenes.find(row => row.id === (cell?.sceneId ?? shotSelection?.sceneId ?? sceneId)) ?? project.scenes[0];
      const targetShot = targetScene?.shots.find(row => row.id === (cell?.shotId ?? shotSelection?.shotId)) ?? targetScene?.shots[0];
      if (targetScene && targetShot) editFrame(targetScene.id, targetShot.id);
    }}/>

    <div hidden={view !== 'connections' || showingEditor}><NodeWorkspacePanel project={project} records={records} sceneId={sceneId} open={open && view === 'connections' && !showingEditor} initialView="workflow" onScene={onScene} onSaved={onSaved} onDirty={setNodeDirty} onOpenTool={onOpenTool}/></div>
    <div className="movie-generation-editor" hidden={!imageEditor}><div className="movie-editor-top"><button onClick={returnToMovie}>{view === 'storyboard' ? '← Storyboard' : '← Movie timeline'}</button><span>{imageEditor ? 'Frame preparation keeps its exact storyboard target.' : 'Clip preparation stays with this movie instance.'}</span></div>{imageOperation && <div className="movie-image-preparation" hidden={!imageEditor}><HiggsfieldTools onOpenBudget={onOpenBudget} open={open && imageEditor} project={project} records={records} workspaceApi={api} onSaved={onSaved} onDirty={setImageDirty} operationRequest={imageOperation}/></div>}</div>
    </div>
    {cameraRequest && <DccPanel onReviewTake={onTakes ? (targetSceneId,targetShotId,takeId) => { setCameraOpen(false); onTakes(targetSceneId,{nonce:crypto.randomUUID(),projectId:project.id,sourceHash:project.sourceHash,sceneId:targetSceneId,intent:'OPEN_RECORD',recordRef:{id:takeId,sha256:takeId.slice('measured-media-take:'.length),kind:'measured-media-take'}},{nonce:crypto.randomUUID(),projectId:project.id,sourceHash:project.sourceHash,sceneId:targetSceneId,shotId:targetShotId}); } : undefined} embedded project={project} scene={project.scenes.find(row => row.id === cameraRequest.sceneId)!} api={api} onSaved={onSaved} shotRequest={cameraRequest} open={open && cameraOpen} onClose={() => setCameraOpen(false)} onOpenStoryboard={(targetSceneId,targetShotId,targetCellId)=>{
      if(busy||extractionBusy||timingDirty||cellDirty){setError('Finish the open timeline or frame edit before reviewing the rehearsal in the storyboard.');return;}
      if(!project.cells.some(cell=>cell.id===targetCellId&&cell.sceneId===targetSceneId&&cell.shotId===targetShotId)){setError('The saved rehearsal frame is not available in this shot yet. Refresh the project before opening it.');return;}
      setCameraOpen(false);
      if(onOpenShot)onOpenShot(targetSceneId,targetShotId,targetCellId);
      else{setView('storyboard');editFrame(targetSceneId,targetShotId,targetCellId);}
    }}/>} 
    {cellEditing && <CellEditor key={cellEditing.nonce} project={project} scene={project.scenes.find(row => row.id === cellEditing.sceneId)!} cell={project.cells.find(cell => cell.id === cellEditing.cellId)} initialShotId={cellEditing.shotId} initialContent={cellEditing.seed} record={records.find(record => record.id === `storyboard-cell:${cellEditing.cellId}`)} api={api} disabled={busy} onDirty={setCellDirty} onClose={() => { setCellEditing(undefined); setCellDirty(false); }} onExtracted={result => { retainExtractedFrame(result); setCellEditing(undefined); setCellDirty(false); }} onSaved={record => { onSaved(record); setCellEditing(undefined); setCellDirty(false); setNotice('Storyboard frame saved as a review candidate.'); }} onReload={async () => { const refreshed = await api.bootstrap(); if (refreshed.project.id !== project.id || refreshed.project.sourceHash !== project.sourceHash) throw new Error('Project source changed. Reopen the frame.'); const latest = refreshed.records.find(record => record.id === `storyboard-cell:${cellEditing.cellId}`); if (latest) onSaved(latest); }}/>} 
  </section>;
}
