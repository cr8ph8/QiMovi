import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, ImageOff, Minus, Plus } from 'lucide-react';
import CellImage from './CellImage';
import { deriveStoryboardSequence } from './storyboardSequenceModel';
import { deriveMovieClipVisual, type MovieClip, type ClipEditSelection } from './movieSequenceModel';
import MovieTakeSelection from './MovieTakeSelection';
import type { GenerationBrief, Project, WorkspaceRecord } from './types';
import { shotMediaTakes } from './mediaTakeModel';
import './movie-timeline.css';

export type { MovieClip } from './movieSequenceModel';
export interface MovieTimelineHandle { setPlayhead: (ms: number | null) => void }
export interface MovieTimelineProps {
  project: Project; clips: MovieClip[]; records: WorkspaceRecord[]; selectedId: string | null;
  onSelect: (id: string) => void; onMove: (id: string, delta: -1 | 1) => void;
  onDuration: (id: string, ms: number | null) => void;
  onEditSelection?: (id: string, selection: ClipEditSelection | null) => void;
  active?: boolean;
  onPrepareClip?: (id: string) => void; onReviewTakes?: (sceneId: string, shotId: string) => void; onEditingChange?: (editing: boolean) => void; disabled?: boolean; compact?: boolean; showInspector?: boolean;
}
const seconds = (ms: number) => String(ms / 1000);
const MIN_ZOOM = .01, MAX_ZOOM = 4;
const clipWidth = (ms: number | null, zoom: number) => ms === null ? 144 * zoom : Math.max(1, ms / 1000 * 22 * zoom);
function timeLabel(ms: number) {
  const minutes = Math.floor(ms / 60000), wholeSeconds = Math.floor(ms % 60000 / 1000), remainder = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}${remainder ? `.${String(remainder).padStart(3, '0').replace(/0+$/, '')}` : ''}`;
}
const duration = (clip: MovieClip) => Number.isSafeInteger(clip.plannedDurationMs) && Number(clip.plannedDurationMs) > 0 ? clip.plannedDurationMs : null;
function savedBrief(clip: MovieClip, project: Project, records: WorkspaceRecord[]) {
  if (!clip.briefRef) return { label: 'Brief needed', state: 'missing' };
  const latest = records.filter(record => record.kind === 'generation-brief' && record.id === clip.briefRef?.id).sort((a, b) => b.version - a.version)[0];
  if (!latest || latest.sha256 !== clip.briefRef.sha256) return { label: 'Brief changed or unavailable', state: 'changed' };
  const data = latest.data as Partial<GenerationBrief> | null;
  if (!data || data.sourceHash !== project.sourceHash || data.sceneId !== clip.sceneId || !Array.isArray(data.shotIds) || !data.shotIds.includes(clip.shotId)) return { label: 'Brief association needs review', state: 'changed' };
  return latest.reviewState?.status === 'NEEDS_REVIEW' ? { label: 'Saved brief needs review', state: 'changed' } : { label: `Saved brief · v${latest.version}`, state: 'saved' };
}
function parseDuration(text: string): { ms: number | null; error?: never } | { ms?: never; error: string } {
  if (text.trim() === '') return { ms: null };
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) return { error: 'Use seconds with at most three decimal places.' };
  const [whole, fraction = ''] = text.split('.'), ms = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 180000) return { error: 'Plan more than 0 and at most 180 seconds per clip.' };
  return { ms };
}

const MovieTimeline = forwardRef<MovieTimelineHandle, MovieTimelineProps>(function MovieTimeline({ project, clips, records, selectedId, onSelect, onMove, onDuration, onEditSelection, active = true, onPrepareClip, onReviewTakes, onEditingChange, disabled = false, compact = false, showInspector = true }, ref) {
  const sequence = useMemo(() => deriveStoryboardSequence(project, records), [project, records]);
  const [zoom, setZoom] = useState(1);
  const [durationDrafts, setDurationDrafts] = useState<Record<string, { basis: number | null; text: string }>>({});
  const [takeEditing, setTakeEditing] = useState(false);
  const elements = useRef(new Map<string, HTMLButtonElement>()), strip = useRef<HTMLDivElement>(null);
  const scope = `${project.id}:${project.sourceHash}`;
  const fittedScope = useRef<string | null>(null), manualZoomScope = useRef<string | null>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const model = useMemo(() => {
    let offset = 0, knownMs = 0, positionMs: number | null = 0;
    const rows = clips.map((clip, index) => {
      const ms = duration(clip), width = clipWidth(ms, zoom);
      const shot = sequence.shots.find(row => row.sceneId === clip.sceneId && row.id === clip.shotId);
      const row = { clip, index, ms, width, left: offset, positionMs, shot,
        visual: deriveMovieClipVisual(clip, project, records), brief: savedBrief(clip, project, records), takes: shotMediaTakes(project, records, clip.sceneId, clip.shotId),
        sceneStart: index === 0 || clip.sceneId !== clips[index - 1].sceneId };
      offset += width; knownMs += ms ?? 0; positionMs = positionMs === null || ms === null ? null : positionMs + ms;
      return row;
    });
    return { rows, width: offset, naturalWidth: clips.reduce((sum, clip) => sum + clipWidth(duration(clip), 1), 0), knownMs, untimed: rows.filter(row => row.ms === null).length };
  }, [clips, project, records, sequence, zoom]);
  function fitMovie() {
    const element = strip.current;
    if (!element || !clips.length || !model.naturalWidth) return false;
    const style = getComputedStyle(element);
    const available = element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    if (available <= 0) return false;
    let next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, available / model.naturalWidth));
    // Keep even very short clips visible at one pixel without pushing longer cuts past the viewport.
    if (clips.reduce((sum, clip) => sum + clipWidth(duration(clip), next), 0) > available) {
      let lower = MIN_ZOOM, upper = next;
      for (let step = 0; step < 20; step++) {
        const middle = (lower + upper) / 2;
        if (clips.reduce((sum, clip) => sum + clipWidth(duration(clip), middle), 0) > available) upper = middle;
        else lower = middle;
      }
      next = lower;
    }
    setZoom(next); element.scrollLeft = 0; return true;
  }
  useEffect(() => {
    const element = strip.current;
    if (!compact || !element || !clips.length || fittedScope.current === scope || manualZoomScope.current === scope) return;
    const initialFit = () => { if (fittedScope.current !== scope && manualZoomScope.current !== scope && fitMovie()) fittedScope.current = scope; };
    initialFit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(initialFit);
    observer?.observe(element); window.addEventListener('resize', initialFit);
    return () => { observer?.disconnect(); window.removeEventListener('resize', initialFit); };
    // Fit on first measurable display only. User zoom and later clip edits keep their chosen viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, scope, clips, model.naturalWidth]);
  useImperativeHandle(ref, () => ({ setPlayhead(ms) {
    const marker = playhead.current;
    if (!marker) return;
    if (ms === null || model.untimed || !Number.isFinite(ms) || ms < 0 || ms > model.knownMs) { marker.hidden = true; return; }
    const row = model.rows.find(item => item.positionMs !== null && item.ms !== null && ms >= item.positionMs && ms < item.positionMs + item.ms) ?? (ms === model.knownMs ? model.rows[model.rows.length - 1] : undefined);
    if (!row || row.ms === null || row.positionMs === null) { marker.hidden = true; return; }
    marker.hidden = false; marker.style.left = `${row.left + (ms - row.positionMs) / row.ms * row.width}px`;
    marker.setAttribute('aria-label', `Storyboard playhead ${timeLabel(Math.round(ms))}`);
  } }), [model]);
  useEffect(() => { if (playhead.current) playhead.current.hidden = true; }, [clips, zoom, scope]);
  const selected = selectedId === null ? undefined : model.rows.find(row => row.clip.id === selectedId) ?? model.rows[0];
  const draftKey = (clip: MovieClip) => `${scope}:${clip.id}`;
  const draftFor = (clip: MovieClip) => durationDrafts[draftKey(clip)]?.basis === clip.plannedDurationMs ? durationDrafts[draftKey(clip)].text : clip.plannedDurationMs === null ? '' : seconds(clip.plannedDurationMs);
  const pending = clips.some(clip => draftFor(clip) !== (clip.plannedDurationMs === null ? '' : seconds(clip.plannedDurationMs)));
  const durationText = selected ? draftFor(selected.clip) : '', parsed = parseDuration(durationText);
  const changed = selected && durationText !== (selected.clip.plannedDurationMs === null ? '' : seconds(selected.clip.plannedDurationMs));
  const sourceParagraphs = [...(project.prologue ?? []), ...project.scenes.flatMap(scene => scene.paragraphs)];
  useEffect(() => { onEditingChange?.(pending || takeEditing); }, [pending, takeEditing, onEditingChange]);
  useEffect(() => { if (selectedId) elements.current.get(selectedId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [selectedId]);
  function move(delta: -1 | 1) { if (selected && !disabled && model.rows[selected.index + delta]) onMove(selected.clip.id, delta); }
  function navigate(event: KeyboardEvent) {
    if ((event.target as HTMLElement).closest('input,select,textarea') || event.metaKey || event.ctrlKey || !selected) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); const delta = event.key === 'ArrowLeft' ? -1 : 1;
      if (event.altKey) move(delta); else { const next = model.rows[selected.index + delta]; if (next) onSelect(next.clip.id); }
    } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); const row = event.key === 'Home' ? model.rows[0] : model.rows[model.rows.length - 1]; if (row) onSelect(row.clip.id); }
  }
  return <section className={`movie-timeline${compact ? ' movie-timeline-compact' : ''}`} aria-label="Planned movie timeline" data-unsaved={pending ? 'true' : undefined}>
    <header className="movie-timeline-toolbar"><div><h2>Movie timeline</h2><p>{clips.length} timeline clips · {clips.length > 0 && model.untimed === clips.length ? 'All untimed · film duration not established' : `${timeLabel(model.knownMs)} planned${model.untimed > 0 ? ` + ${model.untimed} untimed` : ''}`}<span>Planning only</span></p></div><div className="movie-timeline-zoom"><button type="button" aria-label="Zoom out movie timeline" disabled={zoom <= MIN_ZOOM} onClick={() => { manualZoomScope.current = scope; setZoom(value => Math.max(MIN_ZOOM, value / 1.4)); }}><Minus size={15}/></button><output aria-label="Movie timeline zoom">{Math.round(zoom * 100)}%</output><button type="button" aria-label="Zoom in movie timeline" disabled={zoom >= MAX_ZOOM} onClick={() => { manualZoomScope.current = scope; setZoom(value => Math.min(MAX_ZOOM, value * 1.4)); }}><Plus size={15}/></button><button type="button" disabled={!clips.length} onClick={() => { manualZoomScope.current = scope; fitMovie(); }}>Fit movie</button><button type="button" disabled={!selected} onClick={() => { if (selected) elements.current.get(selected.clip.id)?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }}>Focus clip</button></div></header>
    <div className="movie-timeline-strip" ref={strip} role="region" aria-label="Planned clip sequence" tabIndex={0} onKeyDown={navigate}>
      <div className="movie-timeline-plane" style={{ width: Math.max(model.width, 1) }}>
        <div className="movie-timeline-ruler" aria-label="Planned time ruler">{model.rows.map(row => <span key={row.clip.id} style={{ left: row.left, width: row.width }} title={row.positionMs === null ? 'Position depends on earlier untimed clips' : `${timeLabel(row.positionMs)} planned start`} data-start-ms={row.positionMs ?? 'unknown'}>{row.width >= 60 ? row.positionMs === null ? 'Position TBD' : timeLabel(row.positionMs) : ''}</span>)}</div>
        <div className="movie-timeline-scenes" aria-label="Timeline scene boundaries">{model.rows.filter(row => row.sceneStart).map(row => {
          const next = model.rows.slice(row.index + 1).find(candidate => candidate.sceneStart), width = (next?.left ?? model.width) - row.left;
          const scene = project.scenes.find(item => item.id === row.clip.sceneId);
          return <span key={row.clip.id} style={{ left: row.left, width }} title={scene?.heading ?? row.clip.sceneId}><b>{scene ? `Scene ${String(scene.index).padStart(2, '0')}` : 'Unresolved scene'}</b>{scene?.heading}</span>;
        })}</div>
        <div className="movie-timeline-clips" aria-label="Ordered timeline clips">{model.rows.map(row => <button type="button" key={row.clip.id} ref={element => { if (element) elements.current.set(row.clip.id, element); else elements.current.delete(row.clip.id); }} className={`movie-timeline-clip${row.ms === null ? ' is-untimed' : ''}${row.sceneStart ? ' starts-scene' : ''}`} style={{ left: row.left, width: row.width }} aria-label={`Select clip ${row.index + 1}, shot ${row.shot?.shot.label ?? row.clip.shotId}, ${row.ms === null ? 'untimed' : `${seconds(row.ms)} seconds planned`}`} aria-pressed={selected?.clip.id === row.clip.id} tabIndex={selected?.clip.id === row.clip.id ? 0 : -1} onClick={() => onSelect(row.clip.id)} data-clip-id={row.clip.id} data-storyboard-cell={row.visual.cell?.id} data-visual-binding={row.visual.binding}>
          <span className="movie-clip-number">{row.index + 1}<strong>{row.shot?.shot.label ?? row.clip.shotId}</strong></span><span className="movie-clip-thumbnail">{row.visual.cell?.imageHash ? <CellImage key={`${row.visual.cell.id}:${row.visual.cell.imageHash}`} cell={row.visual.cell} thumbnail/> : <span className="movie-clip-missing"><ImageOff size={20}/><span>{row.visual.binding === 'AMBIGUOUS' ? 'Choose frame' : row.visual.binding === 'CHANGED' ? 'Review link' : 'Frame needed'}</span></span>}</span><span className="movie-clip-duration">{row.ms === null ? 'Untimed' : `${seconds(row.ms)} s`}</span><span className={`movie-clip-brief ${row.brief.state}`}>{row.brief.state === 'saved' ? 'Brief saved' : row.brief.state === 'changed' ? 'Brief needs review' : 'Brief needed'}</span><span className="movie-clip-visual-state" title={row.visual.reason}>{row.visual.label}</span>
        </button>)}</div>
        <div ref={playhead} hidden className="movie-timeline-playhead" role="img" aria-label="Storyboard playhead"/>
        {!clips.length && <p className="movie-timeline-empty">Add planned shots to begin the movie sequence.</p>}
      </div>
    </div>
    <div className="movie-timeline-legend"><span>Timed widths follow planned seconds. Hatched slots have no duration.</span><span>← → select · Alt + ← → move · Shift + scroll to pan</span></div>
    {selected && <div className="movie-timeline-inspector" hidden={!showInspector} aria-label="Selected timeline clip">
      <div className="movie-clip-preview" hidden={compact}>{selected.visual.cell?.imageHash ? <CellImage key={`${selected.visual.cell.id}:${selected.visual.cell.imageHash}`} cell={selected.visual.cell}/> : <div className="movie-clip-no-preview"><ImageOff size={24}/><span>Storyboard frame needed</span></div>}<small>{selected.visual.label}</small></div>
      <div className="movie-clip-description" hidden={compact}><span className="movie-clip-kicker">Clip {selected.index + 1} of {clips.length} · {selected.shot ? `Scene ${selected.shot.sceneIndex}` : selected.clip.sceneId}</span><h3>{selected.shot?.shot.label ?? selected.clip.shotId}</h3><p>{selected.clip.note || selected.shot?.shot.description || 'No planning note retained.'}</p><div className="movie-clip-state"><span>{selected.brief.label}</span><span>{selected.visual.label}</span><span>{selected.ms === null ? 'Untimed · duration needed' : `${seconds(selected.ms)} seconds planned`}</span></div><p className="movie-clip-caution">{selected.visual.reason}</p><details><summary>Source & saved brief · {selected.clip.sourceRefs.length} source refs</summary>{selected.clip.sourceRefs.map(ref => <div className="movie-clip-source" key={ref}><code>{ref}</code><p>{sourceParagraphs.find(paragraph => paragraph.id === ref)?.text ?? 'Source paragraph is unavailable in this retained revision.'}</p></div>)}{selected.clip.briefRef && <p><code>{selected.clip.briefRef.id}<br/>{selected.clip.briefRef.sha256}</code></p>}<p>Clip order and timing are draft editorial choices. The screenplay and retained shot order remain unchanged.</p>{selected.visual.cell && <p>Storyboard frame: <code>{selected.visual.cell.id}</code> · {selected.visual.cell.role}</p>}{selected.visual.provenance && <><p>Generated with {selected.visual.provenance.generator}. Retained prompt:</p><p className="movie-clip-provenance-prompt">{selected.visual.provenance.prompt}</p><code>{selected.visual.provenance.recordId}</code></>}</details></div>
      <div className="movie-clip-controls">{compact && <p className="movie-clip-compact-visual" title={selected.visual.reason}>{selected.visual.label}</p>}<label>Planned duration (seconds)<input aria-label="Planned clip duration seconds" type="number" min="0.001" max="180" step="0.001" placeholder="Untimed" disabled={disabled} value={durationText} onChange={event => setDurationDrafts(prior => ({ ...prior, [draftKey(selected.clip)]: { basis: selected.clip.plannedDurationMs, text: event.target.value } }))}/></label>{parsed.error && <p role="alert">{parsed.error}</p>}<div className="movie-duration-actions"><button type="button" disabled={disabled || !changed || Boolean(parsed.error)} onClick={() => { if (!disabled && !('error' in parsed)) onDuration(selected.clip.id, parsed.ms); }}>Set duration</button>{changed && <button type="button" onClick={() => setDurationDrafts(prior => ({ ...prior, [draftKey(selected.clip)]: { basis: selected.clip.plannedDurationMs, text: selected.clip.plannedDurationMs === null ? '' : seconds(selected.clip.plannedDurationMs) } }))}>Discard</button>}</div><div className="movie-clip-move"><button type="button" disabled={disabled || selected.index === 0} onClick={() => move(-1)}><ArrowLeft size={14}/>Move earlier</button><button type="button" disabled={disabled || selected.index === clips.length - 1} onClick={() => move(1)}>Move later<ArrowRight size={14}/></button></div>{onPrepareClip && <button className="movie-clip-prepare" type="button" disabled={disabled || pending || !selected.shot} onClick={() => onPrepareClip(selected.clip.id)}>Prepare this clip →</button>}{!onEditSelection && <div className="movie-clip-takes" aria-label="Selected shot media"><strong>{selected.takes.length} measured {selected.takes.length === 1 ? 'take' : 'takes'} · {selected.takes.filter(take => take.review?.data.decision === 'KEEP_CANDIDATE').length} selected {selected.takes.filter(take => take.review?.data.decision === 'KEEP_CANDIDATE').length === 1 ? 'candidate' : 'candidates'}</strong>{selected.takes.length > 0 && <small>{selected.takes.map(take => `${take.record.data.originalFilename}: ${(take.record.data.measurement.durationMs / 1000).toFixed(3)} s measured`).join(' · ')}</small>}{onReviewTakes && <button type="button" disabled={disabled || pending} onClick={() => onReviewTakes(selected.clip.sceneId, selected.clip.shotId)}>Review shot takes</button>}<small>Candidate takes are available to editor preparation. Choose a take and source in/out points for the edit.</small></div>}<small>Blank duration keeps the clip untimed. No rendered playback is implied.</small></div>
    </div>}
    {onEditSelection && clips.length > 0 && <div hidden={!selected || !showInspector}><MovieTakeSelection key={scope} clip={selected?.clip ?? clips[0]} clips={clips} project={project} records={records} onApply={onEditSelection} onReviewTakes={onReviewTakes} onSelect={onSelect} onDuration={onDuration} onEditingChange={setTakeEditing} disabled={disabled || pending} active={active && Boolean(selected) && showInspector}/></div>}
  </section>;
});
export default MovieTimeline;
