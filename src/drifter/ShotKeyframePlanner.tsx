import { useEffect, useRef, useState } from 'react';
import CellImage from './CellImage';
import { canonicalJson } from './canonical';
import { bindShotKeyframes, createShotKeyframePlan, keyframePlanCurrentness, keyframePlanId, readShotKeyframeRecord } from './storyboardPlanningModel';
import type { Project, ShotKeyframePlan, WorkspaceApi, WorkspaceRecord } from './types';
import './shot-keyframes.css';

type Form = { draft: ShotKeyframePlan; baseline: ShotKeyframePlan; version: number | null };
type Props = { project: Project; records: WorkspaceRecord[]; sceneId: string; shotId: string; api: WorkspaceApi;
  onSaved(record: WorkspaceRecord): void; onDirty?(dirty: boolean): void; onEditFrame?(cellId: string): void; onAddFrame?(): void };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const positionName = (at: number) => at === 0 ? 'Opening' : at === 1000 ? 'Ending' : `Keyframe at ${at / 10}%`;

/** Visual anchors for a planned shot. These do not rewrite the board or claim
 * that a provider/DCC will interpolate between the selected stills. */
export default function ShotKeyframePlanner({ project, records, sceneId, shotId, api, onSaved, onDirty, onEditFrame, onAddFrame }: Props) {
  const scope = `${project.id}:${project.sourceHash}`, id = keyframePlanId(sceneId, shotId), key = `${scope}:${id}`;
  const saved = readShotKeyframeRecord(project, records, sceneId, shotId);
  const [forms, setForms] = useState<Record<string, Form>>({});
  const empty = createShotKeyframePlan(project, sceneId, shotId);
  const form = forms[key] ?? { draft: structuredClone(saved?.data as ShotKeyframePlan ?? empty), baseline: structuredClone(saved?.data as ShotKeyframePlan ?? empty), version: saved?.version ?? null };
  const { draft } = form;
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [cursor, setCursor] = useState(0), [choice, setChoice] = useState('');
  const attempt = useRef<{ fingerprint: string; requestId: string }>();
  const alive = useRef(true), scopeRef = useRef(scope); scopeRef.current = scope;
  const cells = project.cells.filter(cell => cell.sceneId === sceneId && cell.shotId === shotId);
  const available = cells.filter(cell => !draft.frames.some(frame => frame.cellId === cell.id));
  const chosen = available.find(cell => cell.id === choice) ?? available[0];
  const dirty = !same(draft, form.baseline);
  const anyDirty = Object.entries(forms).some(([entry, value]) => entry.startsWith(`${scope}:`) && !same(value.draft, value.baseline));
  const newer = (saved?.version ?? 0) > (form.version ?? 0);
  const currentness = keyframePlanCurrentness(draft, project);
  const changedFrames = currentness.status !== 'CURRENT';
  const ordered = [...draft.frames].sort((a, b) => a.atPermille - b.atPermille);
  const active = ordered.filter(frame => frame.atPermille <= cursor).at(-1);
  const preview = cells.find(cell => cell.id === active?.cellId);
  const validTime = draft.durationMs === null || Number.isSafeInteger(draft.durationMs) && draft.durationMs > 0 && draft.durationMs <= 180000;
  const validPositions = draft.frames.every((frame, index) => Number.isSafeInteger(frame.atPermille) && frame.atPermille >= 0 && frame.atPermille <= 1000 && (!index || frame.atPermille > draft.frames[index - 1].atPermille));
  useEffect(() => { onDirty?.(anyDirty || busy); }, [anyDirty, busy, onDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setChoice(''); setCursor(0); setError(''); setNotice(''); }, [key]);
  useEffect(() => {
    if (saved && newer && !dirty && !busy) setForms(old => ({ ...old, [key]: { draft: structuredClone(saved.data as ShotKeyframePlan), baseline: structuredClone(saved.data as ShotKeyframePlan), version: saved.version } }));
  }, [saved, newer, dirty, busy, key]);
  function edit(change: (value: ShotKeyframePlan) => void) {
    if (busy) return;
    const next = structuredClone(form.draft); change(next);
    setForms(old => ({ ...old, [key]: { ...form, draft: next } })); setError(''); setNotice('');
  }
  function add() {
    if (!chosen || draft.frames.length >= 24) return;
    const used = new Set(draft.frames.map(frame => frame.atPermille));
    // Prefer the two endpoints, then bisect the largest remaining gap.
    const positions = [0, ...used, 1000].sort((a, b) => a - b);
    const gaps = positions.slice(1).map((at, index) => ({ width: at - positions[index], at: Math.floor((at + positions[index]) / 2) })).sort((a, b) => b.width - a.width);
    const at = !used.has(0) ? 0 : !used.has(1000) ? 1000 : gaps[0].at;
    edit(value => {
      value.frames.push({ cellId: chosen.id, atPermille: at, note: '' }); value.frames.sort((a, b) => a.atPermille - b.atPermille);
      const bound = bindShotKeyframes(value, project);
      value.cellBindings = bound.cellBindings.map(binding => value.cellBindings.find(old => old.cellId === binding.cellId) ?? binding);
    }); setCursor(at);
  }
  async function save() {
    if (busy || !dirty || newer || !validPositions || !validTime || changedFrames) return;
    const captured = { scope, key, id, data: structuredClone(draft), version: form.version };
    const fingerprint = canonicalJson({ id, data: captured.data, expectedVersion: captured.version });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const record = await api.saveRecord({ id, kind: 'shot-keyframes', data: captured.data, expectedVersion: captured.version, requestId: attempt.current.requestId });
      if (record.id !== id || record.kind !== 'shot-keyframes' || canonicalJson(record.data) !== canonicalJson(captured.data)) throw new Error('The saved keyframe plan did not match this draft.');
      if (!alive.current || scopeRef.current !== captured.scope) return;
      setForms(old => ({ ...old, [captured.key]: { draft: captured.data, baseline: captured.data, version: record.version } }));
      onSaved(record); setNotice(`Keyframes saved · v${record.version}`);
    } catch (caught) { if (alive.current && scopeRef.current === captured.scope) setError(`${caught instanceof Error ? caught.message : 'Save not confirmed.'} Your draft is still here.`); }
    finally { if (alive.current) setBusy(false); }
  }
  function reloadSaved() {
    // Only this explicit action discards local keyframe edits.
    const value = structuredClone(saved?.data as ShotKeyframePlan ?? empty);
    setForms(old => ({ ...old, [key]: { draft: value, baseline: structuredClone(value), version: saved?.version ?? null } })); setError(''); setNotice('Loaded the saved keyframe plan.');
  }
  return <section className="shot-keyframes" aria-label="Shot keyframe plan">
    <header><div><h4>Keyframes</h4><p>Visual anchors within this shot</p></div><span>{dirty ? 'Unsaved' : form.version ? 'Saved' : 'Not planned'}</span></header>
    <p className="kf-context">Use shared storyboard frames to define the opening, key action and ending. Positions guide planning; motion and provider support are set during clip preparation.</p>
    <fieldset disabled={busy}>
      {draft.frames.length > 0 && <><div className="kf-preview">{preview?.imageHash ? <CellImage key={`${preview.id}:${preview.imageHash}:${JSON.stringify(preview.crop)}`} cell={preview}/> : <p>{active ? 'This keyframe needs an image.' : 'No keyframe at this position.'}</p>}<span>{active ? positionName(active.atPermille) : 'Before the first keyframe'}</span></div>
        <label className="kf-scrub">Hold preview · {cursor / 10}%{draft.durationMs && validTime ? ` · ${Number((draft.durationMs * cursor / 1000000).toFixed(2))} s planned` : ''}<input aria-label="Scrub shot keyframes" type="range" min="0" max="1000" value={cursor} onChange={event => setCursor(Number(event.target.value))}/></label>
        <p className="kf-note">Stills hold until the next anchor. No motion is generated.</p>
        <ol className="kf-anchors">{draft.frames.map((frame, index) => { const cell = cells.find(value => value.id === frame.cellId); return <li key={frame.cellId} data-active={active?.cellId === frame.cellId}><button className="kf-thumb" type="button" aria-label={`Preview keyframe ${index + 1}`} onClick={() => setCursor(frame.atPermille)}>{cell?.imageHash ? <CellImage cell={cell} thumbnail/> : <span>Image needed</span>}<b>{positionName(frame.atPermille)}</b></button><div><p>{cell?.description || 'Storyboard frame unavailable'}</p><label>Position (%)<input aria-label={`Keyframe ${index + 1} position`} type="number" min="0" max="100" step="0.1" value={Number.isFinite(frame.atPermille) ? frame.atPermille / 10 : ''} onChange={event => edit(value => { value.frames[index].atPermille = Math.round(event.target.valueAsNumber * 10); })}/></label><label>Action / change<textarea aria-label={`Keyframe ${index + 1} action`} maxLength={2000} rows={2} value={frame.note} onChange={event => edit(value => { value.frames[index].note = event.target.value; })}/></label><div className="kf-row-actions">{cell && onEditFrame && <button type="button" onClick={() => onEditFrame(cell.id)}>Edit shared frame</button>}<button type="button" aria-label={`Remove keyframe ${index + 1}`} onClick={() => edit(value => { value.frames = value.frames.filter(row => row.cellId !== frame.cellId); value.cellBindings = value.cellBindings.filter(row => row.cellId !== frame.cellId); })}>Remove anchor</button></div></div></li>; })}</ol>
      </>}
      <div className="kf-add"><label>Storyboard frame<select aria-label="Frame for keyframe" value={chosen?.id ?? ''} disabled={!available.length || draft.frames.length >= 24} onChange={event => setChoice(event.target.value)}>{!available.length && <option value="">No unused frames</option>}{available.map(cell => <option key={cell.id} value={cell.id}>{cell.description.slice(0, 90) || cell.id}{!cell.imageHash ? ' · image needed' : ''}</option>)}</select></label><button type="button" onClick={add} disabled={!chosen || draft.frames.length >= 24}>Add keyframe</button></div>
      {onAddFrame && <button type="button" className="kf-new-frame" onClick={onAddFrame}>Add shared storyboard frame</button>}
      <label>Planned shot length (seconds)<input aria-label="Keyframe shot duration" type="number" min="0.001" max="180" step="0.1" value={draft.durationMs === null ? '' : Number.isFinite(draft.durationMs) ? draft.durationMs / 1000 : ''} placeholder="Unset" onChange={event => edit(value => { value.durationMs = event.target.value === '' ? null : Math.round(event.target.valueAsNumber * 1000); })}/></label>
      <label>Continuity / movement notes<textarea aria-label="Keyframe continuity notes" rows={2} maxLength={4000} value={draft.notes} onChange={event => edit(value => { value.notes = event.target.value; })}/></label>
      {!validPositions && <p role="alert">Use unique positions from 0–100%, in increasing order.</p>}
      {!validTime && <p role="alert">Set a duration above 0 and at most 180 seconds, or leave it unset.</p>}
      {changedFrames && <div className="kf-warning" role="status"><p>Shared frames changed since this plan was saved. Review their current images and notes.</p><button type="button" disabled={draft.frames.some(frame => !cells.some(cell => cell.id === frame.cellId))} onClick={() => edit(value => { value.cellBindings = bindShotKeyframes(value, project).cellBindings; })}>Use reviewed frame revisions</button></div>}
      {newer && dirty && <p role="alert">A newer keyframe plan was saved elsewhere. Your edits are preserved; reload the saved version before saving again.</p>}
      <footer><button className="primary" type="button" disabled={!dirty || newer || changedFrames || !validTime || !validPositions} onClick={() => void save()}>{busy ? 'Saving…' : 'Save keyframes'}</button>{dirty && <button type="button" onClick={reloadSaved}>Discard keyframe edits</button>}</footer>
    </fieldset>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
