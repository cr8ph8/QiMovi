import { useEffect, useRef, useState } from 'react';
import { mediaTakeApi } from './mediaTakeApi';
import { canonicalJson } from './canonical';
import { fileReviewLabel, fileReviewStates, type AssetUsage, type ProjectFileEntry } from './projectLibraryModel';
import type { MediaTakeApi, RetainedMediaIntake } from './mediaTakeTypes';
import type { GenerationBrief, Project, WorkspaceRecord } from './types';

const briefKey = (record: WorkspaceRecord) => `${record.id}@${record.sha256}`;
function compatibleBriefs(records: readonly WorkspaceRecord[], project: Project, sceneId: string, shotId: string) {
  const heads = new Map<string, WorkspaceRecord>(), conflicts = new Set<string>();
  for (const record of records) {
    const previous = heads.get(record.id);
    if (previous?.version === record.version && previous.sha256 !== record.sha256) conflicts.add(record.id);
    if (!previous || previous.version < record.version) heads.set(record.id, record);
  }
  return [...heads.values()].filter((record): record is WorkspaceRecord & { data: GenerationBrief } => {
    if (record.kind !== 'generation-brief' || conflicts.has(record.id) || !record.data || typeof record.data !== 'object') return false;
    const data = record.data as Partial<GenerationBrief>;
    return data.sourceHash === project.sourceHash && data.sceneId === sceneId && typeof data.title === 'string'
      && Array.isArray(data.shotIds) && (!shotId || data.shotIds.includes(shotId));
  }).sort((left, right) => left.data.title.localeCompare(right.data.title) || left.id.localeCompare(right.id));
}

/** Retained bytes are measured in place. Review and selection use the existing Takes workflow. */
export default function LibraryMediaReview({ project, entry, records = [], onSaved, onOpenUsage, onBusyChange, mediaApi = mediaTakeApi }: {
  project: Project; entry: ProjectFileEntry; records?: readonly WorkspaceRecord[]; onSaved?(record: WorkspaceRecord): void;
  onOpenUsage?(usage: AssetUsage): void; onBusyChange?(busy: boolean): void; mediaApi?: MediaTakeApi;
}) {
  const sources = (entry.provenance ?? []).filter(item => (item.origin === 'GENERATED_MEDIA' || item.origin === 'PROJECT_FILE'));
  const scenes = [...new Set((entry.provenance ?? []).flatMap(item => item.sceneIds))];
  const [sceneId, setSceneId] = useState(scenes.length === 1 ? scenes[0] : '');
  const [shotId, setShotId] = useState(''), [sourceId, setSourceId] = useState(sources.find(item => item.origin === 'GENERATED_MEDIA')?.record.id ?? sources[0]?.record.id ?? '');
  const [selectedBriefKey, setSelectedBriefKey] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const attempt = useRef<{ fingerprint: string; input: RetainedMediaIntake }>();
  const alive = useRef(true);
  const scope = `${project.id}:${project.sourceHash}:${entry.sha256}`, currentScope = useRef({ scope });
  if (currentScope.current.scope !== scope) currentScope.current = { scope };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setSceneId(scenes.length === 1 ? scenes[0] : ''); setShotId(''); setSelectedBriefKey('');
    setSourceId(sources.find(item => item.origin === 'GENERATED_MEDIA')?.record.id ?? sources[0]?.record.id ?? '');
    setBusy(false); setError(''); setNotice(''); attempt.current = undefined;
    // A new project or retained file starts a fresh association, not an inherited draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const scene = project.scenes.find(row => row.id === sceneId), source = sources.find(row => row.record.id === sourceId);
  const briefs = compatibleBriefs(records, project, sceneId, shotId);
  const selectedBrief = briefs.find(record => briefKey(record) === selectedBriefKey);
  const invalidBrief = Boolean(selectedBriefKey && (!selectedBrief || selectedBrief.reviewState?.status === 'NEEDS_REVIEW'));
  async function measure() {
    if (!scene || !source || !mediaApi.measureRetained || busy || invalidBrief) return;
    const captured = currentScope.current;
    const payload = { sourceHash: project.sourceHash, sceneId: scene.id, shotId: shotId || null,
      briefRef: selectedBrief ? { id: selectedBrief.id, sha256: selectedBrief.sha256 } : null,
      retainedSource: { id: source.record.id, sha256: source.record.sha256 }, assetHash: entry.sha256 };
    const fingerprint = canonicalJson(payload);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, input: { requestId: crypto.randomUUID(), ...payload } };
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await mediaApi.measureRetained(project, scene, attempt.current.input);
      if (!alive.current || currentScope.current !== captured) return;
      onSaved?.(saved.record); if (saved.review) onSaved?.(saved.review);
      setNotice('Measured from the retained file. Open its take review below to play, inspect and select a candidate.');
    } catch (caught) { if (alive.current && currentScope.current === captured) setError(`${caught instanceof Error ? caught.message : 'Measurement was not confirmed.'} Retry checks the same saved attempt.`); }
    finally { if (alive.current && currentScope.current === captured) setBusy(false); }
  }
  if (entry.family !== 'VIDEO') return null;
  return <section className="pfl-media-review" aria-label="Video review and production handoff">
    <h4>From asset to edit</h4>
    <div className="pfl-review-chips">{fileReviewStates(entry).map(value => <span key={value} data-review={value}>{fileReviewLabel(value)}</span>)}</div>
    {(entry.takes ?? []).map(take => { const target = project.scenes.find(row => row.id === take.sceneId), shot = target?.shots.find(row => row.id === take.shotId); return <article className="pfl-take-summary" key={take.record.id}>
      <strong>{target ? `Scene ${target.index} · ${target.heading}` : take.sceneId}</strong><small>{shot?.label ?? 'Scene reference'} · {(take.measurement.durationMs / 1000).toFixed(3)} s measured{take.measurement.width && take.measurement.height ? ` · ${take.measurement.width} × ${take.measurement.height}` : ''}</small>
      <p>{take.decision === 'KEEP_CANDIDATE' ? 'Candidate available to the movie sequence and editor preparation package.' : take.decision === 'REJECT' ? 'Set aside. The original remains in this library.' : 'Open this take to review picture, sound and continuity.'}</p>
      {onOpenUsage && <button className="secondary" onClick={() => onOpenUsage({ record: take.record, relation: 'BLOB_REFERENCE', paths: ['data.blob.sha256'], sceneIds: [take.sceneId] })}>Review {shot?.label ?? 'scene take'}</button>}
    </article>; })}
    {sources.length > 0 && mediaApi.measureRetained && project.sourceHash && project.scenes.length > 0 && <section className="pfl-measure-form"><h5>{entry.takes?.length ? 'Add another scene association' : 'Measure and connect to a scene'}</h5>
      <p>Uses the file already on this Mac. Choose its scene and shot, then review it in Takes. No provider request or duplicate upload.</p>
      <fieldset disabled={busy}>
        {sources.length > 1 && <label>Retained source<select aria-label="Retained video source" value={sourceId} onChange={event => setSourceId(event.target.value)}>{sources.map(item => <option key={item.record.id} value={item.record.id}>{item.origin === 'GENERATED_MEDIA' ? 'Provider return' : 'Project original'} · {item.filename} · v{item.record.version}</option>)}</select></label>}
        <label>Scene<select aria-label="Retained video scene" value={sceneId} onChange={event => { setSceneId(event.target.value); setShotId(''); setSelectedBriefKey(''); setError(''); setNotice(''); }}><option value="">Choose a scene</option>{project.scenes.map(row => <option key={row.id} value={row.id}>Scene {row.index} · {row.heading}</option>)}</select></label>
        <label>Shot<select aria-label="Retained video shot" value={shotId} disabled={!scene || busy} onChange={event => { setShotId(event.target.value); setSelectedBriefKey(''); setError(''); setNotice(''); }}><option value="">Scene reference · no shot assigned</option>{scene?.shots.map(row => <option key={row.id} value={row.id}>{row.label} · {row.description}</option>)}</select></label>
        <label>Saved generation brief<select aria-label="Retained video generation brief" value={selectedBriefKey} disabled={!scene || busy} onChange={event => { setSelectedBriefKey(event.target.value); setError(''); setNotice(''); }}><option value="">No brief · supplied footage or scene reference</option>{selectedBriefKey && !selectedBrief && <option value={selectedBriefKey} disabled>Previously selected brief · changed or unavailable</option>}{briefs.map(record => <option key={briefKey(record)} value={briefKey(record)} disabled={record.reviewState?.status === 'NEEDS_REVIEW'}>{record.data.title} · v{record.version}{record.reviewState?.status === 'NEEDS_REVIEW' ? ' · needs review' : ''}</option>)}</select></label>
        {selectedBrief && !invalidBrief && <small>Links this take to the exact saved brief, v{selectedBrief.version}. Its prompt and references stay unchanged.</small>}
        {invalidBrief && <p role="alert">The selected brief changed or needs review. Choose a current compatible brief or explicitly choose no brief before measuring.</p>}
        {scene && !briefs.length && !selectedBriefKey && <small>No saved generation brief matches this scene{shotId ? ' and shot' : ''}. Supplied footage can be measured without a brief.</small>}
        <button className="primary" disabled={!scene || !source || busy || !onSaved || invalidBrief} onClick={() => void measure()}>{busy ? 'Measuring local media…' : error ? 'Retry measurement' : 'Measure retained video'}</button>
      </fieldset>
    </section>}
    {error && <p role="alert" className="error-bar">{error}</p>}{notice && <p className="pfl-saved" role="status">{notice}</p>}
    <p className="pfl-scope">Measurement records technical metadata. Choose cut ranges in the Movie timeline after reviewing a take. Final picture and sound acceptance remain separate.</p>
  </section>;
}
