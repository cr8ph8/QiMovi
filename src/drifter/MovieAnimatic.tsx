import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import CellImage from './CellImage';
import { buildAnimaticSequence, clipAtAnimaticTime } from './movieAnimaticModel';
import { deriveMovieClipVisual, type MovieClip } from './movieSequenceModel';
import type { Project, WorkspaceRecord } from './types';
import './movie-animatic.css';

export interface MovieAnimaticProps {
  project: Project; clips: MovieClip[]; records: WorkspaceRecord[]; selectedId: string | null;
  onSelect: (id: string) => void; active?: boolean; disabled?: boolean;
  onPositionChange?: (ms: number | null) => void; onPlaybackStart?: () => void;
  pauseRequest?: number;
  compact?: boolean;
}

function elapsedTime(ms: number) {
  const value = Math.max(0, Math.floor(ms));
  return `${String(Math.floor(value / 60000)).padStart(2, '0')}:${String(Math.floor(value % 60000 / 1000)).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}

/** A view of existing storyboard cells, never a rendered take or a timing writer. */
export default function MovieAnimatic({ project, clips, records, selectedId, onSelect, active = true, disabled = false, onPositionChange, onPlaybackStart, pauseRequest = 0, compact = false }: MovieAnimaticProps) {
  const model = useMemo(() => buildAnimaticSequence(clips), [clips]);
  const sequenceKey = useMemo(() => JSON.stringify([project.id, project.sourceHash, clips]), [project.id, project.sourceHash, clips]);
  const initialPosition = model.spans.find(span => span.clip.id === selectedId)?.startMs ?? 0;
  const [position, setPosition] = useState(initialPosition), [playing, setPlaying] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const positionRef = useRef(initialPosition), clock = useRef<{ at: number; position: number } | null>(null);
  const callbacks = useRef({ onSelect, onPositionChange, onPlaybackStart });
  callbacks.current = { onSelect, onPositionChange, onPlaybackStart };
  const requestedSelection = useRef<string | null>(null), announcedSelection = useRef<string | null>(selectedId);
  const priorSequence = useRef(sequenceKey);
  const allowed = active && !disabled && model.playable;
  const hasSelection = clips.some(value => value.id === selectedId);
  const currentSpan = model.playable && (playing || hasSelection) ? clipAtAnimaticTime(model, position) : null;
  const clip = currentSpan?.clip ?? clips.find(value => value.id === selectedId) ?? null;
  const index = clip ? clips.findIndex(value => value.id === clip.id) : -1;
  const scene = project.scenes.find(value => value.id === clip?.sceneId);
  const shot = scene?.shots.find(value => value.id === clip?.shotId);
  const visual = useMemo(() => clip ? deriveMovieClipVisual(clip, project, records) : null, [clip, project, records]);
  const imageKey = visual?.cell ? JSON.stringify([project.sourceHash, visual.cell.id, visual.cell.imageHash, visual.cell.crop]) : '';
  const showImage = Boolean(visual?.cell?.imageHash && visual.label !== 'Image provenance needs review' && imageKey !== failedImage);
  const ratio = visual?.cell?.crop ? visual.cell.crop.width / visual.cell.crop.height
    : visual?.cell?.pixelWidth && visual.cell.pixelHeight ? visual.cell.pixelWidth / visual.cell.pixelHeight : 16 / 9;

  function publishPosition(ms: number) {
    positionRef.current = ms; setPosition(ms);
    callbacks.current.onPositionChange?.(model.playable ? ms : null);
  }
  function selectAt(ms: number) {
    const span = clipAtAnimaticTime(model, ms);
    if (span && announcedSelection.current !== span.clip.id) {
      requestedSelection.current = span.clip.id; announcedSelection.current = span.clip.id;
      callbacks.current.onSelect(span.clip.id);
    }
  }
  function pause() { clock.current = null; setPlaying(false); }
  function seek(ms: number) {
    pause(); const bounded = Math.max(0, Math.min(model.totalMs, ms));
    publishPosition(bounded); selectAt(bounded);
  }
  function step(delta: -1 | 1) {
    if (!active || disabled) return;
    const next = clips[index + delta];
    if (!next) return;
    pause(); const span = model.spans.find(value => value.clip.id === next.id);
    if (model.playable && span) publishPosition(span.startMs);
    requestedSelection.current = next.id; announcedSelection.current = next.id;
    callbacks.current.onSelect(next.id);
  }
  function toggle() {
    if (playing) { pause(); return; }
    if (!allowed || document.hidden) return;
    const ms = positionRef.current >= model.totalMs ? 0 : positionRef.current;
    publishPosition(ms); selectAt(ms);
    clock.current = { at: performance.now(), position: ms };
    callbacks.current.onPlaybackStart?.(); setPlaying(true);
  }

  useEffect(() => {
    const changed = priorSequence.current !== sequenceKey;
    priorSequence.current = sequenceKey;
    if (!changed && requestedSelection.current !== null && requestedSelection.current === selectedId) {
      requestedSelection.current = null; return;
    }
    requestedSelection.current = null; announcedSelection.current = selectedId;
    clock.current = null; setPlaying(false);
    const next = model.spans.find(span => span.clip.id === selectedId)?.startMs ?? 0;
    positionRef.current = next; setPosition(next);
    callbacks.current.onPositionChange?.(model.playable && clips.some(value => value.id === selectedId) ? next : null);
    // The content key pauses on real sequence edits, not parent object recreation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceKey, selectedId]);

  useEffect(() => { if (!allowed) { clock.current = null; setPlaying(false); } }, [allowed]);
  useEffect(() => { clock.current = null; setPlaying(false); }, [pauseRequest]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) { clock.current = null; setPlaying(false); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); callbacks.current.onPositionChange?.(null); };
  }, []);
  useEffect(() => {
    if (!playing || !allowed) return;
    let frame = 0, cancelled = false;
    const tick = (now: number) => {
      if (cancelled || !clock.current || document.hidden) return;
      const ms = Math.min(model.totalMs, clock.current.position + Math.max(0, now - clock.current.at));
      positionRef.current = ms; setPosition(ms); callbacks.current.onPositionChange?.(ms);
      const span = clipAtAnimaticTime(model, ms);
      if (span && announcedSelection.current !== span.clip.id) {
        requestedSelection.current = span.clip.id; announcedSelection.current = span.clip.id;
        callbacks.current.onSelect(span.clip.id);
      }
      if (ms >= model.totalMs) { clock.current = null; setPlaying(false); }
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [playing, allowed, model]);

  const placeholder = !clip ? 'Select a clip to preview its storyboard.' : imageKey === failedImage ? 'Frame unavailable in local storage'
    : visual?.label === 'Image provenance needs review' ? 'Image provenance needs review' : visual?.label ?? 'Storyboard frame needed';
  return <section className={`movie-animatic${compact ? ' movie-animatic-compact' : ''}`} aria-label="Storyboard animatic" data-playing={playing ? 'true' : 'false'} data-clip-id={clip?.id}>
    <header className="movie-animatic-heading"><span>Storyboard animatic <small>· timed storyboard frames · no audio</small></span><span>{playing ? 'Playing' : 'Paused'}</span></header>
    <div className="movie-animatic-stage" onErrorCapture={event => { if (event.target instanceof HTMLImageElement) setFailedImage(imageKey); }}>
      {showImage && visual?.cell ? <div className="movie-animatic-picture" style={{ aspectRatio: String(ratio) }}><CellImage key={imageKey} cell={visual.cell}/></div>
        : <div className="movie-animatic-placeholder"><ImageOff size={23}/><p>{placeholder}</p></div>}
    </div>
    <div className="movie-animatic-caption"><span>{clip ? `Clip ${index + 1}/${clips.length} · ${scene ? `Scene ${scene.index}` : clip.sceneId} · ${shot?.label ?? clip.shotId}` : 'No clip selected'}</span>
      <p title={clip?.note || visual?.cell?.description || shot?.description}>{clip?.note || visual?.cell?.description || shot?.description || 'Storyboard preview'}</p></div>
    <div className="movie-animatic-transport">
      <button type="button" aria-label="Previous animatic clip" disabled={!active || disabled || index <= 0} onClick={() => step(-1)}><SkipBack size={16}/></button>
      <button type="button" className="movie-animatic-play" aria-label={playing ? 'Pause storyboard animatic' : 'Play storyboard animatic'} disabled={!allowed} onClick={toggle}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button>
      <button type="button" aria-label="Next animatic clip" disabled={!active || disabled || index < 0 || index >= clips.length - 1} onClick={() => step(1)}><SkipForward size={16}/></button>
      <output aria-label="Animatic elapsed time">{model.playable ? `${elapsedTime(position)} / ${elapsedTime(model.totalMs)}` : 'Timing needed'}</output>
      <input aria-label="Scrub storyboard animatic" type="range" min="0" max={model.playable ? model.totalMs : 1} step="1" value={model.playable ? Math.min(position, model.totalMs) : 0} disabled={!allowed} onChange={event => seek(Number(event.target.value))}/>
    </div>
    {!model.playable && <p className="movie-animatic-status">{model.untimedCount > 0 ? `${model.untimedCount} ${model.untimedCount === 1 ? 'clip needs' : 'clips need'} planned timing before playback. Preview each clip with the arrow controls.` : clips.length ? 'Review the clip sequence before playback.' : 'Add clips to begin.'}</p>}
  </section>;
}
