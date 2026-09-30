import { useEffect, useRef, useState } from 'react';
import { blobUrl } from './api';
import AssetPicker from './AssetPicker';
import type { ProjectLibraryApi } from './projectLibraryApi';
import type { CastingDraft, Character, Project, WorkspaceApi, WorkspaceRecord } from './types';

interface Props {
  project: Project; character: Character; record?: WorkspaceRecord; draft?: CastingDraft;
  api: WorkspaceApi; disabled: boolean;
  onDraft: (value: CastingDraft | undefined) => void;
  onSaved: (record: WorkspaceRecord) => void;
  onReload: () => Promise<void>;
  libraryApi?: ProjectLibraryApi;
}

export default function CastingEditor({ project, character, record, draft, api, disabled, onDraft, onSaved, onReload, libraryApi }: Props) {
  const value = draft ?? (record?.data as CastingDraft | undefined) ?? {
    sourceHash: project.sourceHash, characterId: character.id, performer: '', referenceHashes: character.referenceImageHash ? [character.referenceImageHash] : [],
    useScope: 'INTERNAL_STORYBOARD_REFERENCE_ONLY', evidenceHashes: [], notes: '',
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const scope = useRef(''); scope.current = `${project.id}:${project.sourceHash}:${character.id}`;
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const stale = value.sourceHash !== project.sourceHash;
  const edit = (patch: Partial<CastingDraft>) => { onDraft({ ...value, ...patch }); setError(''); };
  const save = async () => {
    if (busy || disabled || stale || !value.performer.trim()) return;
    const captured = scope.current;
    const payload = structuredClone(value);
    const expectedVersion = record?.version ?? null;
    const fingerprint = JSON.stringify({ payload, expectedVersion });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const saved = await api.saveRecord({ id: `casting-draft:${character.id}`, kind: 'casting-draft', expectedVersion, requestId: attempt.current.id, data: payload });
      if (!alive.current || scope.current !== captured) return;
      onSaved(saved); onDraft(undefined);
    } catch (failure) {
      if (alive.current && scope.current === captured) setError(failure instanceof Error ? failure.message : 'The local workspace did not confirm the save.');
    } finally { if (alive.current && scope.current === captured) setBusy(false); }
  };
  return <section className="casting-editor" aria-label={`${character.name} candidate proposal`}>
    <div className="casting-references" aria-label={`${character.name} candidate references`}>
      <small>{draft ? 'Unsaved candidate references' : record ? `Saved candidate references · v${record.version}` : 'Initial reference candidates'}</small>
      {value.referenceHashes.length ? value.referenceHashes.map((hash, index) => <figure key={hash}>
        <a href={blobUrl(hash)} target="_blank" rel="noreferrer" aria-label={`Open ${character.name} reference ${index + 1} original`}>
          <img src={blobUrl(hash)} alt={`${character.name} candidate reference ${index + 1}`}/>
          <figcaption>Reference {index + 1} <span>Open original ↗</span></figcaption>
        </a>
        <button type="button" className="casting-reference-remove" disabled={busy || disabled || stale} onClick={() => edit({ referenceHashes: value.referenceHashes.filter(value => value !== hash) })} aria-label={`Remove ${character.name} reference ${index + 1}`}>Remove from candidate</button>
      </figure>) : <p className="casting-no-references">No candidate references.</p>}
    </div>
    <AssetPicker project={project} libraryApi={libraryApi} label="Add candidate references" selectedHashes={value.referenceHashes} multiple disabled={busy || disabled || stale || value.referenceHashes.length >= 100} onSelect={selection => { if (selection.sourceHash === value.sourceHash && !value.referenceHashes.includes(selection.imageHash) && value.referenceHashes.length < 100) edit({ referenceHashes: [...value.referenceHashes, selection.imageHash] }); }}/>
    {value.notes && <details className="casting-profile"><summary>Profile notes · {draft ? 'unsaved' : 'saved'}</summary><p>{value.notes}</p></details>}
    <label>Performer candidate<input value={value.performer} maxLength={300} disabled={busy || disabled || stale} onChange={event => edit({ performer: event.target.value })} placeholder="Name or candidate label"/></label>
    <label>Requested use<select value={value.useScope} disabled={busy || disabled || stale} onChange={event => edit({ useScope: event.target.value as CastingDraft['useScope'] })}><option value="INTERNAL_STORYBOARD_REFERENCE_ONLY">Internal storyboard reference</option><option value="FILM_USE_REQUESTED">Request film use</option></select></label>
    <label>Candidate notes<textarea rows={3} maxLength={8000} value={value.notes} disabled={busy || disabled || stale} onChange={event => edit({ notes: event.target.value })}/></label>
    {stale && <p role="alert">This candidate belongs to an earlier source snapshot. Saving is blocked.</p>}
    {error && <p role="alert" className="error-text">Save not confirmed: {error}<button disabled={busy || disabled} onClick={() => void onReload()}>Reload saved version</button></p>}
    <div className="casting-save"><small>{draft ? 'Unsaved candidate' : record ? `Candidate saved · v${record.version}` : 'No candidate saved'}</small><button className="secondary" disabled={busy || disabled || stale || !value.performer.trim() || (!draft && Boolean(record))} onClick={() => void save()}>{busy ? 'Saving…' : 'Save candidate'}</button></div>
    <p className="scope-note">Requested use only. This draft grants no film-use permission.</p>
  </section>;
}
