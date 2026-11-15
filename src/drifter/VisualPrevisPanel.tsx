import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Download, Pause, Play, Plus } from 'lucide-react';
import { hashCanonical } from './canonical';
import { downloadLocalBlob } from './localDownload';
import { horizontalFieldOfViewDegrees, STAGE_SENSOR_WIDTH_MM } from './cameraPlanning';
import {
  createPrevisPlan, EASINGS, PREVIS_FPS, PREVIS_MAX_KEYS, PREVIS_MAX_SECONDS, PREVIS_MIN_SECONDS,
  resizePrevis, samplePrevis, STAGE_RADIUS_CM, validatePrevisPlan, type PrevisKey, type PrevisPlan, type PrevisScope,
} from './visualPrevis.mjs';
import { createPrevisStage, drawPrevisMap } from './visualPrevisStage';
import { choosePrevisCodec, exportPrevisGuide, type PrevisCodec } from './visualPrevisRecording';
import './visual-previs.css';

const timeLabel = (frame: number) => `${(frame / PREVIS_FPS).toFixed(2)} s`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The local shot editor is unavailable.';
const easingLabels = { LINEAR: 'Linear', EASE_IN_OUT: 'Ease in and out', CUT: 'Cut to next keyframe' };

function NumberField({ label, value, min, max, step = 1, onValue }: {
  label: string; value: number; min: number; max: number; step?: number; onValue(value: number): void;
}) {
  return <label>{label}
    <input key={value} type="number" defaultValue={value} min={min} max={max} step={step}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      onBlur={event => {
        const field = event.currentTarget;
        const parsed = field.valueAsNumber;
        if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onValue(parsed);
        field.value = String(value);
      }}/>
  </label>;
}

function coordinates(x: number, y: number, map: HTMLCanvasElement) {
  const rect = map.getBoundingClientRect();
  const position = (at: number, start: number, size: number) =>
    Math.max(-STAGE_RADIUS_CM, Math.min(STAGE_RADIUS_CM, Math.round(((at - start) / size * 2 - 1) * STAGE_RADIUS_CM))) || 0;
  return [position(x, rect.left, rect.width), position(y, rect.top, rect.height)];
}

export default function VisualPrevisPanel({ scope, shotLabel, draft, startingLens, disabled, onChange }: {
  scope: PrevisScope; shotLabel: string; draft?: PrevisPlan; startingLens: number; disabled: boolean; onChange(plan: PrevisPlan): void;
}) {
  const [initial] = useState(() => createPrevisPlan(scope, startingLens));
  const plan = draft ?? initial;
  const [selected, setSelected] = useState(0);
  const [frame, setFrame] = useState(0);
  const [activeTool, setActiveTool] = useState<'camera' | 'subject'>('camera');
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [reading, setReading] = useState(false);
  const [renderReady, setRenderReady] = useState(false);
  const [codec, setCodec] = useState<PrevisCodec>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stageError, setStageError] = useState('');
  const cameraView = useRef<HTMLCanvasElement>(null);
  const floorPlan = useRef<HTMLCanvasElement>(null);
  const stage = useRef<ReturnType<typeof createPrevisStage>>();
  const capture = useRef<AbortController>();
  const alive = useRef(false);

  const key = plan.keyframes[selected];
  const sample = samplePrevis(plan, frame);
  const isBusy = disabled || recording || reading;
  const editLocked = isBusy || playing;
  const canAdd = plan.keyframes.length < PREVIS_MAX_KEYS && !plan.keyframes.some(row => row.frame === frame);

  useEffect(() => {
    alive.current = true;
    const canvas = cameraView.current!;
    let renderer: ReturnType<typeof createPrevisStage> | undefined;
    function lost() {
      capture.current?.abort();
      setStageError('The 3D view lost its graphics connection. Reopen the editor to try again.');
      setRenderReady(false);
    }
    canvas.addEventListener('webglcontextlost', lost);
    try {
      renderer = createPrevisStage(canvas);
      stage.current = renderer;
      setRenderReady(true);
      void choosePrevisCodec(canvas).then(value => {
        if (alive.current && stage.current === renderer) setCodec(value);
      }).catch(() => undefined);
    } catch {
      setStageError('The camera view requires WebGL 2. You can still edit the shot plan and use the overhead view.');
    }
    return () => {
      alive.current = false;
      capture.current?.abort();
      canvas.removeEventListener('webglcontextlost', lost);
      renderer?.dispose();
      stage.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!renderReady || capture.current) return;
    stage.current?.draw(sample);
  }, [frame, plan, renderReady]); // The sample is derived from the current frame and plan.

  useEffect(() => {
    if (floorPlan.current) drawPrevisMap(floorPlan.current, plan, sample);
  }, [frame, plan]); // Keep the overhead view in step with the camera.

  useEffect(() => {
    if (disabled) capture.current?.abort();
    if (!playing || disabled) return;
    let animation = 0;
    let start: number | undefined;
    const begin = frame >= plan.frameCount - 1 ? 0 : frame;
    function tick(now: number) {
      start ??= now;
      const next = begin + Math.floor((now - start) * PREVIS_FPS / 1000);
      setFrame(Math.min(next, plan.frameCount - 1));
      if (next < plan.frameCount - 1) animation = requestAnimationFrame(tick);
      else setPlaying(false);
    }
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, disabled, plan]); // The starting frame is captured once for each play action.

  function update(next: PrevisPlan) {
    onChange(validatePrevisPlan(next, scope));
    setError('');
    setNotice('');
  }

  function changeKey(patch: Partial<PrevisKey>) {
    if (editLocked) return;
    const replacement = { ...key, ...patch };
    const keyframes = plan.keyframes.map((row, index) => index === selected ? replacement : row);
    update({ ...plan, keyframes });
    setFrame(replacement.frame);
  }

  function selectKey(index: number) {
    setSelected(index);
    setFrame(plan.keyframes[index].frame);
  }

  function addKey() {
    if (!canAdd || editLocked) return;
    const rounded = Object.fromEntries(Object.entries(sample).map(([field, value]) => [field, typeof value === 'number' ? Math.round(value) || 0 : value])) as PrevisKey;
    const keyframes = [...plan.keyframes, rounded].sort((a, b) => a.frame - b.frame);
    update({ ...plan, keyframes });
    setSelected(keyframes.indexOf(rounded));
  }

  function removeKey() {
    if (editLocked || selected === 0 || selected === plan.keyframes.length - 1) return;
    update({ ...plan, keyframes: plan.keyframes.filter((_, index) => index !== selected) });
    selectKey(selected - 1);
  }

  function place(event: PointerEvent<HTMLCanvasElement>) {
    if (editLocked || event.button !== 0) return;
    const [x, z] = coordinates(event.clientX, event.clientY, event.currentTarget);
    changeKey(activeTool === 'camera' ? { cameraX: x, cameraZ: z } : { subjectX: x, subjectZ: z });
  }

  function setDuration(value: number) {
    if (editLocked) return;
    const next = resizePrevis(plan, Math.round(value * PREVIS_FPS));
    update(next);
    setFrame(next.keyframes[selected].frame);
  }

  const shortShot = scope.shotId.replace(/[^\w-]/g, '-').slice(0, 64);
  const label = `qimovi-${shortShot}`;

  async function savePlan() {
    try {
      const verified = validatePrevisPlan(plan, scope);
      const sha256 = await hashCanonical(verified);
      if (!alive.current) return;
      const file = new Blob([JSON.stringify({ plan: verified, sha256 }, null, 2) + '\n'], { type: 'application/json' });
      downloadLocalBlob(file, `${label}-${sha256.slice(0, 12)}.qipreviz.json`);
      setNotice('Choose a destination to save this shot plan.');
    } catch (caught) { if (alive.current) setError(errorText(caught)); }
  }

  async function openPlan(file: File) {
    setReading(true);
    setError('');
    try {
      if (file.size > 64 * 1024) throw new Error('Choose a QiMovi shot plan under 64 KB.');
      const value = JSON.parse(await file.text()) as { plan?: unknown; sha256?: unknown } | null;
      if (!value || typeof value.sha256 !== 'string' || Object.keys(value).length !== 2) throw new Error('This file has no shot plan checksum.');
      const imported = validatePrevisPlan(value.plan, scope);
      if (await hashCanonical(imported) !== value.sha256) throw new Error('The shot plan checksum did not match.');
      if (!alive.current) return;
      update(imported);
      setFrame(0);
      setSelected(0);
      setNotice('Shot plan opened for editing.');
    } catch (caught) { if (alive.current) setError(errorText(caught)); }
    finally { if (alive.current) setReading(false); }
  }

  async function record() {
    if (!stage.current || !cameraView.current || !renderReady || !codec || editLocked || capture.current) return;
    const controller = new AbortController();
    const renderer = stage.current;
    capture.current = controller;
    setRecording(true);
    setError('');
    setNotice('');
    try {
      const verified = validatePrevisPlan(plan, scope);
      const canvas = cameraView.current;
      const sha256 = await hashCanonical(verified);
      const video = await exportPrevisGuide(canvas, codec, verified.frameCount, position => {
        renderer.draw(samplePrevis(verified, position));
        setFrame(position);
      }, controller.signal);
      if (controller.signal.aborted || !alive.current) return;
      downloadLocalBlob(video, `${label}-guide-${sha256.slice(0, 12)}.${video.type === 'video/mp4' ? 'mp4' : 'webm'}`);
      setNotice('Guide encoded. Save it, then use the Library to attach it as a motion reference.');
    } catch (caught) { if (!controller.signal.aborted && alive.current) setError(errorText(caught)); }
    finally {
      capture.current = undefined;
      if (alive.current) setRecording(false);
    }
  }

  return <section className="visual-previs" aria-label="3D shot editor">
    <header className="visual-previs-header">
      <div><h4>Shot {shotLabel} · 3D rehearsal</h4><p>Set the camera and stand-in at each keyframe. Save the plan file to reopen it later.</p></div>
      <span>{(plan.frameCount / PREVIS_FPS).toFixed(2)} s · {PREVIS_FPS} fps</span>
    </header>
    <div className="visual-previs-views">
      <figure><figcaption>Camera view <span>{sample.lensMm.toFixed(0)} mm · {horizontalFieldOfViewDegrees(sample.lensMm, STAGE_SENSOR_WIDTH_MM)?.toFixed(0)}° horizontal</span></figcaption>
        <canvas ref={cameraView} aria-label="3D camera view" className="visual-previs-camera"/>
        {stageError && <p role="status">{stageError}</p>}
      </figure>
      <figure className="visual-previs-overhead">
        <figcaption>Overhead</figcaption>
        <canvas ref={floorPlan} width="224" height="224" onPointerDown={place} aria-label="Overhead camera and stand-in paths"/>
        <div className="visual-previs-tools" role="group" aria-label="Overhead placement tool">
          <button type="button" aria-pressed={activeTool === 'camera'} disabled={editLocked} onClick={() => setActiveTool('camera')}>Camera</button>
          <button type="button" aria-pressed={activeTool === 'subject'} disabled={editLocked} onClick={() => setActiveTool('subject')}>Stand-in</button>
        </div>
      </figure>
    </div>
    <div className="visual-previs-transport">
      <button type="button" className="secondary" disabled={isBusy} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={14}/> : <Play size={14}/>} {playing ? 'Pause' : 'Play'}</button>
      <label>Playhead <input type="range" min="0" max={plan.frameCount - 1} value={frame} disabled={isBusy}
        onChange={event => { setPlaying(false); setFrame(Number(event.target.value)); }}/></label>
      <output>{timeLabel(frame)}</output>
      <button type="button" className="secondary" disabled={!canAdd || editLocked} onClick={addKey}><Plus size={14}/> Add keyframe</button>
    </div>
    <div className="visual-previs-keyframes" role="group" aria-label="Select camera keyframe">
      {plan.keyframes.map((row, index) => <button key={row.frame} type="button" aria-pressed={selected === index}
        disabled={editLocked} onClick={() => selectKey(index)}>{index === 0 ? 'Opening' : index === plan.keyframes.length - 1 ? 'Ending' : `Keyframe ${index + 1}`} <span>{timeLabel(row.frame)}</span></button>)}
    </div>
    <fieldset className="visual-previs-fields" disabled={editLocked} key={selected}>
      <legend>Keyframe at {timeLabel(key.frame)}</legend>
      <NumberField label="Camera X (m)" value={key.cameraX / 100} min={-12} max={12} step={0.01} onValue={value => changeKey({ cameraX: Math.round(value * 100) || 0 })}/>
      <NumberField label="Camera height (m)" value={key.cameraY / 100} min={0.3} max={8} step={0.01} onValue={value => changeKey({ cameraY: Math.round(value * 100) })}/>
      <NumberField label="Camera Z (m)" value={key.cameraZ / 100} min={-12} max={12} step={0.01} onValue={value => changeKey({ cameraZ: Math.round(value * 100) || 0 })}/>
      <NumberField label="Stand-in X (m)" value={key.subjectX / 100} min={-12} max={12} step={0.01} onValue={value => changeKey({ subjectX: Math.round(value * 100) || 0 })}/>
      <NumberField label="Stand-in Z (m)" value={key.subjectZ / 100} min={-12} max={12} step={0.01} onValue={value => changeKey({ subjectZ: Math.round(value * 100) || 0 })}/>
      <NumberField label="Aim height (m)" value={key.aimHeight / 100} min={0} max={3} step={0.01} onValue={value => changeKey({ aimHeight: Math.round(value * 100) || 0 })}/>
      <NumberField label="Focal length (mm)" value={key.lensMm} min={10} max={200} onValue={value => changeKey({ lensMm: Math.round(value) })}/>
      <label>Next move<select value={key.easing} disabled={selected === plan.keyframes.length - 1} onChange={event => changeKey({ easing: event.target.value as PrevisKey['easing'] })}>
        {EASINGS.map(value => <option value={value} key={value}>{easingLabels[value]}</option>)}</select></label>
      <NumberField label="Shot duration (s)" value={Number((plan.frameCount / PREVIS_FPS).toFixed(3))} min={PREVIS_MIN_SECONDS} max={PREVIS_MAX_SECONDS}
        step={0.25} onValue={setDuration}/>
      {selected > 0 && selected < plan.keyframes.length - 1 && <>
        <NumberField label="Keyframe number" value={key.frame} min={plan.keyframes[selected - 1].frame + 1}
          max={plan.keyframes[selected + 1].frame - 1} onValue={value => changeKey({ frame: Math.round(value) })}/>
        <button type="button" className="secondary" onClick={removeKey}>Remove keyframe</button>
      </>}
    </fieldset>
    <footer className="visual-previs-actions">
      <button type="button" className="secondary" disabled={editLocked} onClick={() => void savePlan()}><Download size={14}/> Save plan</button>
      <label className="visual-previs-file">Open plan <input type="file" accept=".json,application/json" disabled={editLocked} onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void openPlan(file);
      }}/></label>
      <button type="button" className="primary" disabled={editLocked || !renderReady || !codec}
        onClick={() => void record()}>{recording ? 'Encoding guide…' : 'Export guide video'}</button>
      {recording && <button type="button" className="secondary" onClick={() => capture.current?.abort()}>Cancel export</button>}
    </footer>
    {!codec && renderReady && <p>Video export needs a compatible local encoder. The shot plan can still be saved.</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
