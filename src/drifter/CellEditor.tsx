import { STORYBOARD_FRAME_ROLE } from './filmmakingLanguage';
import { useEffect, useRef, useState } from 'react';
import AssetPicker from './AssetPicker';
import CellImage from './CellImage';
import { FilmcraftDisclosure } from './FilmcraftGuide';
import FrameExtractionControl from './FrameExtractionControl';
import type { FrameExtractionResult } from './storyboardFrameApi';
import type { ProjectLibraryApi } from './projectLibraryApi';
import type { CellRole, Project, Scene, StoryboardCellDraft, StoryCell, WorkspaceApi, WorkspaceRecord } from './types';

export type StoryboardCellSeed = Pick<StoryboardCellDraft, 'description' | 'role' | 'actionRefs'>;

function cellDraft(project: Project, scene: Scene, cell?: StoryCell, initialShotId?: string): StoryboardCellDraft {
  return {
    sourceHash: project.sourceHash, cellId: cell?.id ?? `cell-${crypto.randomUUID()}`, sceneId: scene.id,
    shotId: cell?.shotId ?? scene.shots.find(item => item.id === initialShotId)?.id ?? scene.shots[0].id, role: cell?.role ?? 'MOMENT', imageHash: cell?.imageHash ?? null,
    crop: cell?.crop ?? null, ...(cell?.pixelWidth && cell?.pixelHeight && cell.imageHash ? { pixelWidth: cell.pixelWidth, pixelHeight: cell.pixelHeight } : {}),
    description: cell?.description ?? '', actionRefs: cell?.actionRefs ?? [], plannedTimestampMs: cell?.plannedTimestampMs ?? null, review: 'PENDING',
    ...(cell?.originCameraRef ? { originCameraRef: structuredClone(cell.originCameraRef) } : {}),
    ...(cell?.originDccReturnRef ? { originDccReturnRef: structuredClone(cell.originDccReturnRef) } : {}),
  };
}

export default function CellEditor({ project, scene, cell, record, api, disabled, initialShotId, initialContent, onDirty, onSaved, onReload, onClose, libraryApi, onExtracted }: {
  project: Project; scene: Scene; cell?: StoryCell; record?: WorkspaceRecord; api: WorkspaceApi; disabled: boolean;
  onSaved: (record: WorkspaceRecord) => void; onReload: () => Promise<void>; onClose: () => void;
  libraryApi?: ProjectLibraryApi; initialShotId?: string; initialContent?: StoryboardCellSeed; onDirty?: (value: boolean) => void;
  onExtracted?: (result: FrameExtractionResult) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(() => {
    const value = cellDraft(project, scene, cell, initialShotId);
    if (!cell && initialContent) {
      const allowed = new Set([...(project.prologue ?? []), ...scene.paragraphs].map(paragraph => paragraph.id));
      value.description = initialContent.description;
      value.role = initialContent.role === 'START' && value.shotId !== scene.shots[0].id ? 'MOMENT' : initialContent.role;
      value.actionRefs = [...new Set(initialContent.actionRefs.filter(id => allowed.has(id)))];
    }
    return value;
  });
  const baseline = useRef(JSON.stringify(draft));
  const [closing, setClosing] = useState(false);
  const [timestamp, setTimestamp] = useState(draft.plannedTimestampMs === null ? '' : String(draft.plannedTimestampMs / 1000));
  const [busy, setBusy] = useState(false);
  const [extractionBusy, setExtractionBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const scope = useRef(''); scope.current = `${project.id}:${project.sourceHash}:${scene.id}`;
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const stale = draft.sourceHash !== project.sourceHash || draft.sceneId !== scene.id;
  const dccOrigin = Boolean(draft.originDccReturnRef);
  const imageValid = draft.imageHash === null || /^[a-f0-9]{64}$/.test(draft.imageHash);
  const timeMs = timestamp === '' ? null : Math.round(Number(timestamp) * 1000);
  const timeValid = timeMs === null || (Number.isSafeInteger(timeMs) && timeMs >= 0 && timeMs <= 180000);
  const dirty = !timeValid || JSON.stringify({ ...draft, plannedTimestampMs: timeMs }) !== baseline.current || Boolean(!cell && initialContent);
  useEffect(() => { onDirty?.(dirty || extractionBusy); }, [dirty, extractionBusy, onDirty]);
  const paragraphs = [...(project.prologue ?? []), ...scene.paragraphs];
  const edit = (patch: Partial<StoryboardCellDraft>) => {
    if (dccOrigin && Object.keys(patch).some(key => key !== 'description' && key !== 'plannedTimestampMs')) return;
    setDraft(previous => ({ ...previous, ...patch })); setError('');
  };
  const replaceImage = (value: string) => {
    if (dccOrigin) return;
    const imageHash = value.trim() || null;
    setDraft(previous => {
      if (previous.imageHash === imageHash) return previous;
      const next = { ...previous, imageHash, crop: null }; delete next.pixelWidth; delete next.pixelHeight; return next;
    }); setError('');
  };
  const save = async () => {
    if (disabled || busy || extractionBusy || stale || !imageValid || !timeValid || !draft.description.trim()) return;
    const captured = scope.current;
    const payload = { ...structuredClone(draft), plannedTimestampMs: timeMs };
    const expectedVersion = record?.version ?? null;
    const fingerprint = JSON.stringify({ payload, expectedVersion });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const result = await api.saveRecord({ id: `storyboard-cell:${draft.cellId}`, kind: 'storyboard-cell', expectedVersion, requestId: attempt.current.id, data: payload });
      if (alive.current && scope.current === captured) onSaved(result);
    } catch (failure) {
      if (alive.current && scope.current === captured) setError(failure instanceof Error ? failure.message : 'The local workspace did not confirm the save.');
    } finally { if (alive.current && scope.current === captured) setBusy(false); }
  };
  return <div className="drawer-scrim"><section className="drawer cell-editor" data-unsaved={dirty || extractionBusy ? 'true' : undefined} role="dialog" aria-modal="true" aria-label={cell ? 'Edit storyboard frame' : 'Add storyboard frame'}>
    <div className="drawer-heading"><div><span className="eyebrow">SCENE {scene.index} / STORYBOARD FRAME</span><h2>{cell ? 'Edit storyboard frame' : 'Add a storyboard frame'}</h2></div><button aria-label="Close frame editor" disabled={busy || extractionBusy} onClick={() => { if (dirty) setClosing(true); else onClose(); }}>×</button></div>
    {closing && <div className="scope-note" role="alert"><p>This frame has unsaved edits.</p><button onClick={() => setClosing(false)}>Keep editing frame</button><button onClick={() => { onDirty?.(false); onClose(); }}>Discard frame edits</button></div>}
    <p className="drawer-intro">Attach an imported local image and link the source moments it should show. Saved frames remain pending review.</p>
    {dccOrigin && <p className="scope-note">This frame came from a Blender/Unity return. Its image, crop, role and source links stay attached to that return; you can edit the description and planned time.</p>}
    <fieldset disabled={disabled || busy || extractionBusy || stale} className="cell-edit-fields">
      <label>Source shot<select value={draft.shotId} disabled={Boolean(cell)} onChange={event => edit({ shotId: event.target.value, role: draft.role === 'START' && event.target.value !== scene.shots[0].id ? 'MOMENT' : draft.role })}>{scene.shots.map(shot => <option key={shot.id} value={shot.id}>{shot.label} · {shot.description}</option>)}</select></label>
      <label>Frame role<select value={draft.role} disabled={dccOrigin} onChange={event => edit({ role: event.target.value as CellRole })}><option value="START" disabled={draft.shotId !== scene.shots[0].id}>{STORYBOARD_FRAME_ROLE.START}</option><option value="MOMENT">{STORYBOARD_FRAME_ROLE.MOMENT}</option><option value="END">{STORYBOARD_FRAME_ROLE.END}</option></select></label>
      <p className="scope-note">Scene opening is reserved for the scene’s first planned shot. Other shots can begin with an Action moment frame. These are storyboard roles, not video keyframes.</p>
      <AssetPicker project={project} libraryApi={libraryApi} disabled={disabled || busy || stale || dccOrigin} selectedHashes={draft.imageHash ? [draft.imageHash] : []} label={draft.imageHash ? 'Change candidate image' : 'Choose candidate image'} onSelect={selection => { if (selection.sourceHash === draft.sourceHash) replaceImage(selection.imageHash); }}/>
      {draft.imageHash && imageValid && <figure className="cell-image-choice"><CellImage key={`${draft.imageHash}:${JSON.stringify(draft.crop)}`} cell={{ ...draft, id: draft.cellId }}/><figcaption>{draft.crop ? 'Selected panel from the original sheet.' : 'Full image candidate.'}<button type="button" disabled={dccOrigin} onClick={() => replaceImage('')}>Remove candidate image</button></figcaption></figure>}
      {cell?.crop && cell.imageHash && <FrameExtractionControl project={project} cell={cell} record={record} disabled={disabled || busy || stale || dirty} onBusy={setExtractionBusy} onExtracted={async result => { if (onExtracted) await onExtracted(result); else { await onReload(); onSaved(result.cellRecord); } }}/>}
      {cell?.crop && dirty && <p className="scope-note">Save your frame edits before extracting the saved panel.</p>}
      <details className="cell-image-details"><summary>Image details / advanced attachment</summary><label>Candidate image SHA-256<input value={draft.imageHash ?? ''} disabled={dccOrigin} maxLength={64} spellCheck={false} onChange={event => replaceImage(event.target.value)} placeholder="Retained image hash"/></label></details>
      {!imageValid && <p role="alert" className="error-text">Use a lowercase 64-character SHA-256 from an imported image.</p>}
      {draft.imageHash !== (cell?.imageHash ?? null) && <p className="scope-note">The replacement uses the full image. The previous image crop is not carried over.</p>}
      {draft.crop && <p className="scope-note">This frame retains its existing image crop. <button type="button" disabled={dccOrigin} onClick={() => edit({ crop: null })}>Use full image</button></p>}
      <label>Frame description<textarea rows={4} value={draft.description} maxLength={8000} onChange={event => edit({ description: event.target.value })}/></label>
      <FilmcraftDisclosure className="cell-direction-guide" label="Filmmaking guide · framing, movement & continuity" context="shot" compact onUsePrompt={text => {
        const description = [draft.description.trimEnd(), text].filter(Boolean).join('\n\n');
        if (description.length > 8000) { setError('This planning note would exceed the frame description limit. Shorten the description first.'); return; }
        edit({ description });
      }}/>
      <label>Planned time within the intended clip (seconds)<input type="number" min="0" max="180" step="0.1" value={timestamp} onChange={event => { setTimestamp(event.target.value); setError(''); }} placeholder="Unset"/></label>
      {!timeValid && <p role="alert" className="error-text">Use a planning time from 0 to 180 seconds, or leave it unset.</p>}
      <p className="scope-note">Optional position within the intended clip. This is a planning offset, not source-media timecode or a measured scene duration.</p>
      <details className="cell-source-links"><summary>Link exact source paragraphs · {draft.actionRefs.length} selected</summary><div>{paragraphs.map(paragraph => <label key={paragraph.id}><input type="checkbox" disabled={dccOrigin} checked={draft.actionRefs.includes(paragraph.id)} onChange={event => edit({ actionRefs: event.target.checked ? [...draft.actionRefs, paragraph.id] : draft.actionRefs.filter(id => id !== paragraph.id) })}/><span><small>{paragraph.id} · {paragraph.type}</small>{paragraph.text || '(Empty source paragraph)'}</span></label>)}</div></details>
    </fieldset>
    {stale && <p role="alert" className="error-text">This frame draft belongs to an earlier source. Saving is blocked.</p>}
    {error && <p role="alert" className="error-text">Save not confirmed: {error}<button disabled={busy || disabled} onClick={() => { void onReload().catch(failure => setError(failure instanceof Error ? failure.message : 'The saved frame could not be refreshed. Your edits are still here.')); }}>Reload saved frame</button></p>}
    <div className="cell-save-footer"><small>{record ? `Current saved frame · v${record.version}` : 'New candidate revision'}</small><button className="primary" disabled={disabled || busy || extractionBusy || stale || !imageValid || !timeValid || !draft.description.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save frame candidate'}</button></div>
  </section></div>;
}
