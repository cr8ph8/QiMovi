import { STORYBOARD_FRAME_ROLE } from './filmmakingLanguage';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Grid2X2, ImageOff, Maximize, Minus, Plus, Search, Workflow } from 'lucide-react';
import CellImage from './CellImage';
import SceneCoverageReview from './SceneCoverageReview';
import type { MovieClip } from './movieSequenceModel';
import { deriveStoryboardSequence, type StoryboardSequenceShot } from './storyboardSequenceModel';
import type { Project, WorkspaceRecord } from './types';
import type { StoryboardCellAction } from './storyboardOperationRequest';
import './shot-sequence.css';

export type ShotWorkflowStep = 'direction' | 'frames' | 'prepare';
export type ShotSequenceCanvasProps = {
  project: Project; records: WorkspaceRecord[]; sceneId: string; open?: boolean;
  onScene: (sceneId: string) => void;
  onPrepareShot?: (sceneId: string, shotId: string) => void;
  onPrepareCell?: (sceneId: string, shotId: string, cellId: string, action: StoryboardCellAction) => void;
  preparingCellId?: string;
  onSelectionChange?: (sceneId: string, shotId: string, cellId?: string) => void;
  selectedShot?: { sceneId: string; shotId: string; cellId?: string };
  renderShotKeyframes?: (shot: StoryboardSequenceShot) => ReactNode;
  renderShotWork?: (shot: StoryboardSequenceShot, step: ShotWorkflowStep) => ReactNode;
  shotDrafts?: { direction: boolean; frames: boolean };
  onOpenShot?: (sceneId: string, shotId: string, cellId?: string) => void;
  onOpenSceneWorkflow?: (sceneId: string) => void;
  clips?: MovieClip[];
  onReviewTakes?: (sceneId: string, shotId: string) => void;
  onOpenClip?: (clipId: string) => void;
  coverageDisabled?: boolean;
};
type Viewport = { x: number; y: number; zoom: number };
const NODE_WIDTH = 204, NODE_HEIGHT = 178, SHOT_GAP = 44, ROW_HEIGHT = 248, LEFT = 64, TOP = 30;
const clampZoom = (value: number) => Math.min(2, Math.max(.12, value));
const seconds = (ms: number) => `${Number((ms / 1000).toFixed(2))} s`;
const nodeKey = (sceneId: string, shotId: string) => `${sceneId}\u0000${shotId}`;

export default function ShotSequenceCanvas({ project, records, sceneId, open = true, onScene, onOpenShot, onPrepareShot, onPrepareCell, preparingCellId, onSelectionChange, selectedShot, renderShotKeyframes, renderShotWork, shotDrafts, onOpenSceneWorkflow, clips = [], onReviewTakes, onOpenClip, coverageDisabled = false }: ShotSequenceCanvasProps) {
  const sequence = useMemo(() => deriveStoryboardSequence(project, records), [project, records]);
  const scope = `${project.id}:${project.sourceHash}`;
  const [view, setView] = useState<'graph' | 'sheet' | 'coverage'>('graph');
  const [sheetMode, setSheetMode] = useState<'frames' | 'shots'>('frames');
  const [workStep, setWorkStep] = useState<ShotWorkflowStep>('frames');
  const [query, setQuery] = useState('');
  const [imageFilter, setImageFilter] = useState<'all' | 'missing' | 'present'>('all');
  const visibleShots = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return sequence.shots.filter(shot => {
      if (imageFilter === 'missing' && shot.hasImage || imageFilter === 'present' && !shot.hasImage) return false;
      const text = [shot.shot.label, shot.shot.description, shot.sceneHeading, `scene ${shot.sceneIndex}`, ...shot.cells.map(cell => cell.description)].join(' ').toLocaleLowerCase();
      return words.every(word => text.includes(word));
    });
  }, [sequence, query, imageFilter]);
  const visibleKeys = useMemo(() => new Set(visibleShots.map(shot => nodeKey(shot.sceneId, shot.id))), [visibleShots]);
  const hasFilters = Boolean(query.trim()) || imageFilter !== 'all';
  const sheet = useRef<HTMLDivElement>(null);
  const [cellSelection, setCellSelection] = useState<{ scope: string; cellId: string } | null>(null);
  const [selection, setSelection] = useState<{ scope: string; key: string } | null>(null);
  const selected = sequence.shots.find(shot => selectedShot?.sceneId === shot.sceneId && selectedShot.shotId === shot.id) ?? sequence.shots.find(shot => selection?.scope === scope && nodeKey(shot.sceneId, shot.id) === selection.key) ?? sequence.shots.find(shot => shot.sceneId === sceneId) ?? sequence.shots[0];
  const positions = useMemo(() => new Map(sequence.scenes.flatMap((row, index) => row.shots.map(shot => [nodeKey(shot.sceneId, shot.id), { x: LEFT + shot.shotPosition * (NODE_WIDTH + SHOT_GAP), y: TOP + index * ROW_HEIGHT + 38 }] as const))), [sequence]);
  const graphWidth = LEFT * 2 + Math.max(1, ...sequence.scenes.map(row => row.shots.length)) * (NODE_WIDTH + SHOT_GAP) - SHOT_GAP;
  const graphHeight = TOP * 2 + Math.max(1, sequence.scenes.length) * ROW_HEIGHT;
  const [viewport, setViewport] = useState<Viewport>({ x: 20, y: 20, zoom: .6 });
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const canvas = useRef<HTMLDivElement>(null), size = useRef({ width: 850, height: 530 });
  const drag = useRef<{ id: number; x: number; y: number; initial: Viewport } | null>(null);
  const fitted = useRef(false);
  const focusedScope = useRef<string>();
  const marker = useId().replace(/:/g, '');

  function fitFilm() {
    const zoom = clampZoom(Math.min((size.current.width - 32) / graphWidth, (size.current.height - 32) / graphHeight));
    setViewport({ zoom, x: (size.current.width - graphWidth * zoom) / 2, y: (size.current.height - graphHeight * zoom) / 2 }); fitted.current = true;
  }
  function reveal(shot: StoryboardSequenceShot, zoom = Math.max(.72, viewportRef.current.zoom), cellId?: string) {
    const point = positions.get(nodeKey(shot.sceneId, shot.id)); if (!point) return;
    const scale = clampZoom(zoom);
    setViewport({ zoom: scale, x: size.current.width / 2 - (point.x + NODE_WIDTH / 2) * scale, y: Math.min(size.current.height / 2, 185) - (point.y + NODE_HEIGHT / 2) * scale }); fitted.current = false;
    const tiles = [...(sheet.current?.querySelectorAll<HTMLButtonElement>('[data-shot-id]') ?? [])].filter(element => element.dataset.sceneId === shot.sceneId && element.dataset.shotId === shot.id);
    const activeCellId = cellId ?? selectedShot?.cellId ?? (cellSelection?.scope === scope ? cellSelection.cellId : undefined);
    const tile = tiles.find(element => element.dataset.cellId === activeCellId) ?? tiles[0];
    tile?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  function clearFilters() { setQuery(''); setImageFilter('all'); }
  function inspect(shot: StoryboardSequenceShot, bringIntoView = false, cellId?: string) {
    onSelectionChange?.(shot.sceneId, shot.id, cellId);
    setCellSelection(cellId ? { scope, cellId } : null);
    setSelection({ scope, key: nodeKey(shot.sceneId, shot.id) });
    if (shot.sceneId !== sceneId) onScene(shot.sceneId);
    if (bringIntoView) reveal(shot, undefined, cellId);
  }
  function move(delta: number) {
    if (!selected) return;
    const next = sequence.shots[selected.position + delta]; if (next) inspect(next, true);
  }
  function zoomAt(factor: number, point = { x: size.current.width / 2, y: size.current.height / 2 }) {
    fitted.current = false;
    setViewport(current => { const zoom = clampZoom(current.zoom * factor), ratio = zoom / current.zoom; return { zoom, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio }; });
  }
  function keys(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
    else if (event.key === 'Home' || event.key === 'End') { const shot = event.key === 'Home' ? sequence.shots[0] : sequence.shots[sequence.shots.length - 1]; if (shot) { event.preventDefault(); inspect(shot, true); } }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(1.2); }
    else if (event.key === '-') { event.preventDefault(); zoomAt(1 / 1.2); }
  }

  useEffect(() => { setQuery(''); setImageFilter('all'); }, [scope]);
  useEffect(() => {
    const candidate = sequence.shots.find(shot => shot.sceneId === sceneId) ?? sequence.shots[0];
    setSelection(previous => previous?.scope === scope && sequence.shots.some(shot => nodeKey(shot.sceneId, shot.id) === previous.key && shot.sceneId === sceneId) ? previous : candidate ? { scope, key: nodeKey(candidate.sceneId, candidate.id) } : null);
  }, [scope, sceneId, sequence]);
  useEffect(() => {
    if (!open || !canvas.current) return;
    const element = canvas.current;
    const measure = () => { const box = element.getBoundingClientRect(); if (!box.width || !box.height) return; size.current = { width: box.width, height: box.height }; if (focusedScope.current !== scope && selected) { focusedScope.current = scope; reveal(selected, .9); } else if (fitted.current) fitFilm(); };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null; observer?.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); fitted.current = false;
      if (event.ctrlKey || event.metaKey) { const box = element.getBoundingClientRect(); zoomAt(Math.exp(-event.deltaY * .006), { x: event.clientX - box.left, y: event.clientY - box.top }); }
      else setViewport(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer?.disconnect(); element.removeEventListener('wheel', wheel); drag.current = null; };
    // Only geometry or visibility changes remeasure; record/cell updates preserve the chosen viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, graphWidth, graphHeight, view]);

  const selectedScene = selected && project.scenes.find(scene => scene.id === selected.sceneId);
  const sourceParagraphs = [...(project.prologue ?? []), ...project.scenes.flatMap(scene => scene.paragraphs)];
  const openingCell = selected?.cells.find(cell => cell.id === selectedShot?.cellId) ?? selected?.cells.find(cell => cellSelection?.scope === scope && cell.id === cellSelection.cellId) ?? selected?.thumbnail ?? selected?.cells[0];
  return <section className="shot-sequence" aria-label="Film storyboard sequence" hidden={!open}>
    <header className="ss-toolbar"><div><h2>Storyboard sequence</h2><p>{sequence.summary.sceneCount} scenes · {sequence.summary.shotCount} shots · {sequence.summary.cellCount} frames<span>Planning order</span></p></div><div className="ss-toolbar-actions"><label>Scene<select aria-label="Jump to storyboard scene" value={selected?.sceneId ?? sceneId} onChange={event => { const row = sequence.scenes.find(item => item.scene.id === event.target.value); if (row?.shots[0]) inspect(row.shots[0], true); else if (row) onScene(row.scene.id); }}>{sequence.scenes.map(row => <option key={row.scene.id} value={row.scene.id}>{String(row.scene.index).padStart(2, '0')} · {row.scene.heading}</option>)}</select></label>{view === 'graph' && <button onClick={fitFilm}><Maximize size={14} aria-hidden="true"/>Fit film</button>}{view !== 'coverage' && <button disabled={!selected || !visibleKeys.has(nodeKey(selected.sceneId, selected.id))} onClick={() => { if (selected) reveal(selected, .9); }}>Focus shot</button>}</div></header>
    <div className="ss-browser-toolbar">
      <div className="ss-view-switch" role="group" aria-label="Storyboard view"><button aria-pressed={view === 'graph'} onClick={() => setView('graph')}><Workflow size={14} aria-hidden="true"/>Shot graph</button><button aria-pressed={view === 'sheet'} onClick={() => setView('sheet')}><Grid2X2 size={14} aria-hidden="true"/>Contact sheet</button><button aria-pressed={view === 'coverage'} onClick={() => setView('coverage')}>Coverage review</button></div>
      {view === 'sheet' && <div className="ss-sheet-mode" role="group" aria-label="Contact sheet layout"><button type="button" aria-pressed={sheetMode === 'frames'} onClick={() => setSheetMode('frames')}>All frames</button><button type="button" aria-pressed={sheetMode === 'shots'} onClick={() => setSheetMode('shots')}>Shot overview</button></div>}
      <div className="ss-image-filters" hidden={view === 'coverage'}><label className="ss-search"><Search size={14} aria-hidden="true"/><input aria-label="Search storyboard" placeholder="Search shots, scenes or frames" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <select aria-label="Storyboard image filter" value={imageFilter} onChange={event => setImageFilter(event.target.value as typeof imageFilter)}><option value="all">All planned shots</option><option value="missing">Needs image · {sequence.summary.shotsWithoutImages}</option><option value="present">Has image · {sequence.summary.shotsWithImages}</option></select>
      {hasFilters && <button className="ss-clear-filters" onClick={clearFilters}>Clear filters</button>}</div>
    </div>
    <div className="ss-results" hidden={view === 'coverage'} role="status" aria-label="Storyboard results">{hasFilters ? `${visibleShots.length} of ${sequence.shots.length} planned shots shown` : `${sequence.summary.shotsWithImages} with images · ${sequence.summary.shotsWithoutImages} need images`}<span>Screenplay order is preserved</span></div>
    <div className="ss-workspace"><div className="ss-map-column">{view === 'coverage' ? <SceneCoverageReview project={project} records={records} clips={clips} sceneId={selected?.sceneId ?? sceneId} selectedShotId={selected?.id} directionDirty={shotDrafts?.direction} disabled={coverageDisabled} onInspect={(row, step) => { inspect(row); setWorkStep(step); }} onReviewTakes={onReviewTakes} onOpenClip={onOpenClip}/> : view === 'graph' ? <><div className="ss-canvas" ref={canvas} role="region" aria-label="Storyboard shot graph" tabIndex={0} onKeyDown={keys}
      onPointerDown={event => { if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return; drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, initial: viewportRef.current }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={event => { const current = drag.current; if (!current || current.id !== event.pointerId) return; fitted.current = false; setViewport({ ...current.initial, x: current.initial.x + event.clientX - current.x, y: current.initial.y + event.clientY - current.y }); }}
      onPointerUp={event => { if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); } }} onPointerCancel={() => { drag.current = null; }}>
      <div className="ss-graph-plane" data-testid="shot-graph-plane" style={{ width: graphWidth, height: graphHeight, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        <svg className="ss-edges" width={graphWidth} height={graphHeight} aria-hidden="true"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6"/></marker></defs>{sequence.edges.filter(edge => visibleKeys.has(nodeKey(edge.fromSceneId, edge.fromShotId)) && visibleKeys.has(nodeKey(edge.toSceneId, edge.toShotId))).map(edge => {
          const from = positions.get(nodeKey(edge.fromSceneId, edge.fromShotId)), to = positions.get(nodeKey(edge.toSceneId, edge.toShotId)); if (!from || !to) return null;
          const start = { x: from.x + NODE_WIDTH, y: from.y + NODE_HEIGHT / 2 }, end = { x: to.x, y: to.y + NODE_HEIGHT / 2 };
          const turnY = from.y + NODE_HEIGHT + 27;
          const path = edge.crossesSceneBoundary ? `M ${start.x} ${start.y} L ${start.x + 22} ${start.y} L ${start.x + 22} ${turnY} L ${end.x - 28} ${turnY} L ${end.x - 28} ${end.y} L ${end.x} ${end.y}` : `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
          return <path key={edge.id} data-from-shot={edge.fromShotId} data-to-shot={edge.toShotId} data-scene-boundary={edge.crossesSceneBoundary ? 'true' : 'false'} d={path} markerEnd={`url(#${marker})`} className={edge.crossesSceneBoundary ? 'ss-scene-edge' : 'ss-shot-edge'}/>;
        })}</svg>
        {sequence.scenes.map((row, index) => (!hasFilters || row.shots.some(shot => visibleKeys.has(nodeKey(shot.sceneId, shot.id)))) && <div key={row.scene.id} className="ss-scene-label" style={{ left: LEFT, top: TOP + index * ROW_HEIGHT }}><button onClick={() => { if (row.shots[0]) inspect(row.shots[0], true); else onScene(row.scene.id); }}><b>{String(row.scene.index).padStart(2, '0')}</b>{row.scene.heading}</button><small>{row.shots.length} shots{row.rolePlanStatus === 'STALE' ? ' · saved roles need review' : ''}</small></div>)}
        {visibleShots.map(shot => { const point = positions.get(nodeKey(shot.sceneId, shot.id))!; return <button key={nodeKey(shot.sceneId, shot.id)} className="ss-shot-node" style={{ left: point.x, top: point.y, width: NODE_WIDTH, height: NODE_HEIGHT }} aria-label={`Inspect shot ${shot.shot.label}, scene ${shot.sceneIndex}`} aria-pressed={selected === shot} tabIndex={selected === shot ? 0 : -1} data-shot-id={shot.id} data-scene-id={shot.sceneId} onClick={() => inspect(shot)}>
          <span className="ss-shot-heading"><strong>{shot.shot.label}</strong><small>{shot.plannedDurationMs === null ? 'Untimed' : `${seconds(shot.plannedDurationMs)} planned`}</small></span><span className="ss-shot-image" style={{ '--ss-cell-aspect': shot.thumbnail?.crop ? shot.thumbnail.crop.width / shot.thumbnail.crop.height : 2.39 } as CSSProperties}>{shot.thumbnail ? <CellImage key={`${shot.thumbnail.id}:${shot.thumbnail.imageHash}`} cell={shot.thumbnail} thumbnail/> : <span className="ss-missing-image"><ImageOff size={22} aria-hidden="true"/>No storyboard image</span>}</span><span className="ss-shot-description">{shot.shot.description || 'No shot description retained.'}</span><span className="ss-shot-state">{shot.thumbnailLabel ?? 'Image needed'} · {shot.cells.length} {shot.cells.length === 1 ? 'frame' : 'frames'}{shot.hasImage && shot.shotPosition === 0 && !shot.hasStartingFrame ? ' · scene opening needed' : ''}</span>
        </button>; })}
        {!sequence.shots.length && <p className="ss-empty-graph">No planned shots in this retained project.</p>}
      </div>
    {hasFilters && !visibleShots.length && <div className="ss-filter-empty"><Search size={24} aria-hidden="true"/><h3>No matching planned shots</h3><p>Try a scene, shot label or frame description, or clear the image filter.</p><button onClick={clearFilters}>Show all planned shots</button></div>}
    </div><footer className="ss-map-tools"><span>Drag space to pan · ← → select shots · Ctrl/⌘ scroll to zoom</span><div><button aria-label="Zoom out storyboard" onClick={() => zoomAt(1 / 1.2)}><Minus size={15}/></button><output aria-label="Storyboard zoom">{Math.round(viewport.zoom * 100)}%</output><button aria-label="Zoom in storyboard" onClick={() => zoomAt(1.2)}><Plus size={15}/></button></div></footer></> : <>
      <div className="ss-contact-sheet" ref={sheet} role="region" aria-label="Storyboard contact sheet" tabIndex={0} onKeyDown={keys}>
        <p className="ss-sheet-context">{sheetMode === 'frames' ? 'Every retained frame in the matching shots, including alternate openings and missing images.' : 'One image candidate per shot. Use All frames to compare openings, action and endings.'} Image filters apply to shots.</p>
        {sequence.scenes.map(row => { const shots = row.shots.filter(shot => visibleKeys.has(nodeKey(shot.sceneId, shot.id))); if (!shots.length) return null; return <section className="ss-sheet-scene" key={row.scene.id} aria-label={`Scene ${row.scene.index}: ${row.scene.heading}`}>
          <header><span>{String(row.scene.index).padStart(2, '0')}</span><h3>{row.scene.heading}</h3><small>{shots.length} of {row.shots.length} planned shots</small></header>
          {row.rolePlanStatus === 'STALE' && <p className="ss-sheet-warning">Saved frame roles need review. Retained roles are shown.</p>}
          <ol className="ss-sheet-shots">{shots.flatMap(shot => {
            const frames = sheetMode === 'frames' ? (shot.cells.length ? shot.cells : [null]) : [shot.thumbnail];
            return frames.map((cell, index) => <li key={`${nodeKey(shot.sceneId, shot.id)}:${cell?.id ?? 'missing'}`}><button className="ss-sheet-shot" aria-label={sheetMode === 'frames' && cell ? `Inspect frame ${cell.id}, shot ${shot.shot.label}, scene ${shot.sceneIndex}` : `Inspect shot ${shot.shot.label}, scene ${shot.sceneIndex}`} aria-pressed={selected === shot && (sheetMode === 'shots' || openingCell?.id === cell?.id)} data-shot-id={shot.id} data-scene-id={shot.sceneId} data-cell-id={cell?.id} onClick={() => inspect(shot, false, cell?.id)}>
              <span className="ss-sheet-image" style={{ '--ss-cell-aspect': cell?.crop ? cell.crop.width / cell.crop.height : 2.39 } as CSSProperties}>{cell?.hasImage ? <CellImage key={`${cell.id}:${cell.imageHash}`} cell={cell} thumbnail/> : <span className="ss-missing-image"><ImageOff size={24} aria-hidden="true"/>{cell ? 'Frame image needed' : shot.cells.length ? 'Image needed' : 'No storyboard frames'}</span>}<span className="ss-sheet-position">{String(shot.position + 1).padStart(2, '0')}{sheetMode === 'frames' && cell ? `.${index + 1}` : ''}</span></span>
              <span className="ss-sheet-heading"><strong>{shot.shot.label}{sheetMode === 'frames' && cell && <small>Frame {index + 1} / {shot.cells.length}</small>}</strong><small>{sheetMode === 'frames' && cell ? cell.plannedTimestampMs == null ? 'Untimed frame' : `${seconds(cell.plannedTimestampMs)} planned` : shot.plannedDurationMs === null ? 'Untimed shot' : `${seconds(shot.plannedDurationMs)} planned shot`}</small></span>
              <span className="ss-sheet-description">{sheetMode === 'frames' && cell ? cell.description || 'No frame description retained.' : shot.shot.description || 'No shot description retained.'}</span>
              <span className="ss-sheet-state">{sheetMode === 'frames' ? cell ? `${STORYBOARD_FRAME_ROLE[cell.role]} · ${cell.review === 'MISSING' ? 'Missing material' : 'Review pending'}` : 'Add a storyboard frame to this shot' : `${shot.cells.length} ${shot.cells.length === 1 ? 'frame' : 'frames'} · ${cell ? STORYBOARD_FRAME_ROLE[cell.role] + ' candidate' : 'No image'}`}</span>
              {cell && <span className="ss-frame-identity" title={cell.id}>{cell.id}</span>}
            </button></li>);
          })}</ol>
        </section>; })}
        {!visibleShots.length && <div className="ss-filter-empty"><ImageOff size={24} aria-hidden="true"/><h3>{hasFilters ? 'No matching planned shots' : 'No planned shots yet'}</h3><p>{hasFilters ? 'Try another scene, shot label or frame description.' : 'Add planned shots to the screenplay to begin this storyboard.'}</p>{hasFilters && <button onClick={clearFilters}>Show all planned shots</button>}</div>}
      </div><footer className="ss-map-tools"><span>Select a frame to inspect its shared record · ← → move between shots</span><span>Still images for planning</span></footer></>}</div>
      <aside className="ss-inspector" aria-label="Selected storyboard shot">{selected ? <><div className="ss-selection-heading"><span>Scene {String(selected.sceneIndex).padStart(2, '0')} · shot {selected.position + 1} of {sequence.shots.length}</span><div><h3>{selected.shot.label}</h3><div className="ss-step-controls"><button aria-label="Previous storyboard shot" disabled={selected.position === 0} onClick={() => move(-1)}><ArrowLeft size={16}/></button><button aria-label="Next storyboard shot" disabled={selected.position === sequence.shots.length - 1} onClick={() => move(1)}><ArrowRight size={16}/></button></div></div></div><p className="ss-scene-heading">{selected.sceneHeading}</p><p className="ss-description">{selected.shot.description || 'No shot description retained.'}</p><div className="ss-shot-actions" hidden={Boolean(renderShotWork) && workStep !== 'frames'}>{!renderShotWork && onPrepareShot && <button className="primary" onClick={() => onPrepareShot(selected.sceneId, selected.id)}>Prepare this shot →</button>}{(!renderShotWork || selected.cells.length > 0) && <button className={onPrepareShot ? "secondary" : "primary"} disabled={!onOpenShot} onClick={() => onOpenShot?.(selected.sceneId, selected.id, openingCell?.id)}>{selected.cells.length ? 'Edit selected frame' : 'Add storyboard frame'}</button>}{onOpenSceneWorkflow && <button onClick={() => onOpenSceneWorkflow(selected.sceneId)}>Open scene workflow ↗</button>}</div>
        <p className="ss-plan-status">{selected.plannedDurationMs === null ? 'Shot duration not planned.' : `${seconds(selected.plannedDurationMs)} planned shot duration.`} This is not measured footage.</p>{selected.rolePlanStatus === 'STALE' && <p className="ss-caution">Saved role choices need review. Retained cell roles are shown.</p>}
        {hasFilters && !visibleKeys.has(nodeKey(selected.sceneId, selected.id)) && <p className="ss-selection-outside">This selected shot is outside the current filters. <button onClick={clearFilters}>Show all shots</button></p>}
        {renderShotWork && <><nav className="ss-workflow-steps" aria-label="Shot workflow">{(['direction', 'frames', 'prepare'] as const).map((step, index) => <button key={step} type="button" aria-pressed={workStep === step} aria-controls="selected-shot-task" onClick={() => setWorkStep(step)}><span>{index + 1}.</span> {step === 'direction' ? 'Direction' : step === 'frames' ? 'Frames' : 'Prepare'}{step !== 'prepare' && shotDrafts?.[step] && <small>Unsaved</small>}</button>)}</nav><p className="ss-workflow-help">{workStep === 'direction' ? 'Decide what this shot communicates, then choose how to show it.' : workStep === 'frames' ? 'Plan the opening, changes in action and ending. Several panels can describe one shot.' : 'Rehearse staging, prepare a generation or review returned media for this shot.'}</p></>}
        <div id="selected-shot-task">{renderShotWork?.(selected, workStep)}<div hidden={Boolean(renderShotWork) && workStep !== 'frames'}>{renderShotKeyframes?.(selected)}<h4>Storyboard frames <span>{selected.cells.length}</span></h4>{!selected.cells.length && <p className="ss-empty">No storyboard frames have been saved for this shot.</p>}<ol className="ss-cells" aria-label="Ordered storyboard frames">{selected.cells.map(cell => <li key={cell.id} data-cell-id={cell.id} data-cell-role={cell.role} data-selected={(selectedShot?.cellId === cell.id || cellSelection?.scope === scope && cellSelection.cellId === cell.id) ? 'true' : undefined}><div className="ss-cell-heading"><strong>{STORYBOARD_FRAME_ROLE[cell.role]}</strong><span>{cell.plannedTimestampMs === null || cell.plannedTimestampMs === undefined ? 'Untimed frame' : `${seconds(cell.plannedTimestampMs)} planned`}</span></div>{cell.hasImage ? <div className="ss-cell-image"><CellImage key={`${cell.id}:${cell.imageHash}`} cell={cell}/></div> : <div className="ss-cell-no-image"><ImageOff size={18} aria-hidden="true"/>Image needed</div>}<p>{cell.description || 'No frame description retained.'}</p><small>{cell.review === 'MISSING' ? 'Missing material' : 'Review pending'} · {cell.roleSource === 'SAVED_SCENE_PLAN' ? 'Saved role choice' : 'Retained role'}</small><button aria-label={`Open ${STORYBOARD_FRAME_ROLE[cell.role]} frame ${cell.id} ↗`} disabled={!onOpenShot} onClick={() => onOpenShot?.(selected.sceneId, selected.id, cell.id)}>Edit {STORYBOARD_FRAME_ROLE[cell.role].toLowerCase()} frame ↗</button>{onPrepareCell && <div className="ss-cell-production"><button disabled={Boolean(preparingCellId)} aria-label={`Create image for ${STORYBOARD_FRAME_ROLE[cell.role]} frame ${cell.id}`} onClick={() => { setCellSelection({ scope, cellId: cell.id }); onSelectionChange?.(selected.sceneId, selected.id, cell.id); onPrepareCell(selected.sceneId, selected.id, cell.id, 'CREATE_IMAGE'); }}>Create image</button><button disabled={!cell.hasImage || Boolean(preparingCellId)} aria-label={`Animate image for ${STORYBOARD_FRAME_ROLE[cell.role]} frame ${cell.id}`} onClick={() => { setCellSelection({ scope, cellId: cell.id }); onSelectionChange?.(selected.sceneId, selected.id, cell.id); onPrepareCell(selected.sceneId, selected.id, cell.id, 'ANIMATE_IMAGE'); }}>Animate image</button>{preparingCellId === cell.id && <small role="status">Reading retained image…</small>}</div>}<details className="ss-source-refs"><summary>Source paragraph refs · {cell.actionRefs?.length ?? 0}</summary>{cell.actionRefs?.length ? cell.actionRefs.map(ref => { const paragraph = sourceParagraphs.find(item => item.id === ref); return <div key={ref}><code>{ref}</code><p>{paragraph?.text ?? 'This reference is not present in the retained screenplay.'}</p></div>; }) : <p>No source paragraphs linked to this frame.</p>}</details></li>)}</ol></div></div>
        {renderShotWork && workStep !== 'prepare' && <button className="ss-next-task" type="button" onClick={() => setWorkStep(workStep === 'direction' ? 'frames' : 'prepare')}>{workStep === 'direction' ? 'Continue to frames →' : 'Continue to preparation →'}</button>}
        {selectedScene && <details className="ss-sequence-notes"><summary>Planning notes & totals</summary><p>Arrows follow retained scene and shot order. Storyboard frames are grouped by role: Scene opening → Action moment → Ending. References and images remain candidates.</p><p>{sequence.summary.shotsWithImages} shots with images · {sequence.summary.shotsWithoutImages} without images · {sequence.summary.shotsWithStartingFrames} with a Scene opening frame.</p><p>{seconds(sequence.summary.plannedDurationMs)} known shot-estimate subtotal · {sequence.summary.unknownDurationShotCount} untimed shots. This is not the film runtime.</p>{sequence.summary.unassignedCellCount > 0 && <p>{sequence.summary.unassignedCellCount} frames do not match a retained scene/shot and need review.</p>}</details>}
      </> : <p className="ss-empty">No shot selected.</p>}</aside>
    </div>
  </section>;
}
