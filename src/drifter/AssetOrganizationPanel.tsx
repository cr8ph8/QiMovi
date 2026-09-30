import { useEffect, useRef, useState } from 'react';
import type { Project, WorkspaceProject, WorkspaceRecord } from './types';
import type { ProjectLibraryApi } from './projectLibraryApi';
import { canonicalJson } from './canonical';
import { freshCuration, ORGANIZATION_STATUSES, organizationLabel, type AssetCuration, type AssetCurationRecord, type AssetUsage, type ProjectFileEntry } from './projectLibraryModel';

type Edit = { data: AssetCuration; initial: string; expectedVersion: number | null };
type Props = { project: WorkspaceProject; entry?: ProjectFileEntry; api: ProjectLibraryApi; records: WorkspaceRecord[]; onSaved(record: AssetCurationRecord): void; onDirty?(value: boolean): void; onOpenUsage?(usage: AssetUsage): void };
export default function AssetOrganizationPanel({ project, entry, api, records, onSaved, onDirty, onOpenUsage }: Props) {
  const scenes: Project['scenes'] = project.scenes;
  const scope = `${project.id}:${project.sourceHash}`, currentScope = useRef(scope), scopeEpoch = useRef(0);
  if (currentScope.current !== scope) { currentScope.current = scope; scopeEpoch.current += 1; }
  const selectedKey = useRef(entry?.sha256); selectedKey.current = entry?.sha256;
  const [edits, setEdits] = useState<Record<string, Edit>>({}), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [discard, setDiscard] = useState(false);
  const attempts = useRef<Record<string, { fingerprint: string; id: string }>>({}), alive = useRef(true);
  const [rawTags, setRawTags] = useState<Record<string, string>>({});
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setEdits({}); setRawTags({}); setError(''); setNotice(''); setBusy(''); attempts.current = {}; }, [scope]);
  useEffect(() => { setError(''); setNotice(''); setDiscard(false); }, [entry?.sha256]);
  const dirty = Object.values(edits).some(edit => canonicalJson(edit.data) !== edit.initial);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  const edit = entry ? edits[entry.sha256] : undefined, draft = edit?.data ?? (entry ? freshCuration(entry, project) : undefined);
  const selectedDirty = Boolean(edit && canonicalJson(edit.data) !== edit.initial);
  function update(change: (value: AssetCuration) => AssetCuration) {
    if (!entry || !draft || busy) return;
    const base = edit ?? { data: draft, initial: canonicalJson(draft), expectedVersion: entry.curation?.version ?? null };
    setEdits(previous => ({ ...previous, [entry.sha256]: { ...base, data: change(base.data) } })); setError(''); setNotice('');
  }
  async function save() {
    if (!entry || !edit || !selectedDirty || !api.saveCuration || busy) return;
    const captured = scope, epoch = scopeEpoch.current, key = entry.sha256, data = JSON.parse(canonicalJson(edit.data)) as AssetCuration;
    data.tags = data.tags.map(tag => tag.trim());
    const fingerprint = canonicalJson({ data, expectedVersion: edit.expectedVersion });
    if (attempts.current[key]?.fingerprint !== fingerprint) attempts.current[key] = { fingerprint, id: crypto.randomUUID() };
    setBusy(key); setError(''); setNotice('');
    try {
      const record = await api.saveCuration(project, data, edit.expectedVersion, attempts.current[key].id);
      if (!alive.current || currentScope.current !== captured || scopeEpoch.current !== epoch) return;
      setEdits(previous => { const next = { ...previous }; delete next[key]; return next; });
      setRawTags(previous => { const next = { ...previous }; delete next[key]; return next; });
      onSaved(record); if (selectedKey.current === key) setNotice(`Organization saved · version ${record.version}. Original file unchanged.`);
    } catch (caught) { if (alive.current && currentScope.current === captured && scopeEpoch.current === epoch && selectedKey.current === key) setError(`${caught instanceof Error ? caught.message : 'Save not confirmed.'} Your edits are retained. Refresh to inspect the saved version before retrying or discarding.`); }
    finally { if (alive.current && currentScope.current === captured && scopeEpoch.current === epoch) setBusy(''); }
  }
  return <div className="pfl-management" hidden={!entry} data-unsaved={dirty ? 'true' : 'false'}>{entry && <>
    {draft && <section className="pfl-organize" aria-label="Organize selected asset"><h4>Organize this asset</h4><p className="pfl-scope">Labels and scene associations do not alter the original or approve production use.</p><fieldset disabled={Boolean(busy) || !api.saveCuration}>
      <label>Display title<input aria-label="Asset display title" maxLength={240} value={draft.displayTitle} onChange={event => update(value => ({ ...value, displayTitle: event.target.value }))}/></label>
      <label>Tags, separated by commas<input aria-label="Asset tags" value={rawTags[entry.sha256] ?? draft.tags.join(', ')} onChange={event => { const text = event.target.value; setRawTags(previous => ({ ...previous, [entry.sha256]: text })); update(value => ({ ...value, tags: text.split(',').map(tag => tag.trim()).filter(Boolean) })); }} placeholder="Character, costume, location…"/></label>
      <label>Organization<select aria-label="Asset organization" value={draft.organizationStatus} onChange={event => update(value => ({ ...value, organizationStatus: event.target.value as AssetCuration['organizationStatus'] }))}>{ORGANIZATION_STATUSES.map(status => <option key={status} value={status}>{organizationLabel(status)}</option>)}</select></label>
      <label>Notes<textarea aria-label="Asset notes" rows={4} maxLength={8000} value={draft.notes} onChange={event => update(value => ({ ...value, notes: event.target.value }))}/></label>
      <section className="pfl-scene-associations" aria-label="Associated scenes"><h5>Associated scenes · {draft.sceneIds.length}</h5><div>{scenes.map(scene => <label key={scene.id}><input type="checkbox" aria-label={`Associate asset with scene ${scene.index}`} checked={draft.sceneIds.includes(scene.id)} onChange={event => update(value => ({ ...value, sceneIds: event.target.checked ? [...value.sceneIds, scene.id] : value.sceneIds.filter(id => id !== scene.id) }))}/><span>{scene.index}. {scene.heading}</span></label>)}</div></section>
    </fieldset>{error && <p role="alert" className="error-bar">{error}</p>}{notice && <p role="status" className="pfl-saved">{notice}</p>}
    <div className="pfl-save-actions"><button className="primary" disabled={!selectedDirty || Boolean(busy) || !draft.displayTitle.trim() || draft.tags.some(tag => !tag.trim()) || !api.saveCuration} onClick={() => void save()}>{busy ? 'Saving…' : 'Save organization'}</button>{selectedDirty && <button className="text-link" disabled={Boolean(busy)} onClick={() => setDiscard(true)}>Discard these edits</button>}</div><small>{selectedDirty ? 'Unsaved organization changes' : entry.curation ? `Saved organization · v${entry.curation.version}` : 'No organization changes saved'}</small>
    {discard && <div role="alert" className="pfl-discard"><p>Discard this asset’s unsaved labels and use its latest loaded version?</p><button onClick={() => { setEdits(previous => { const next = { ...previous }; delete next[entry.sha256]; return next; }); setRawTags(previous => { const next = { ...previous }; delete next[entry.sha256]; return next; }); setDiscard(false); setError(''); }}>Discard and use saved</button><button onClick={() => setDiscard(false)}>Keep editing</button></div>}</section>}
    <section className="pfl-usage"><h4>Used in saved work</h4><p className="pfl-scope">Saved references, linked storyboard frames and scene associations.</p>{entry.whereUsed?.length ? entry.whereUsed.map((usage, index) => <div key={`${usage.record.id}:${usage.relation}:${index}`}><strong>{String((records.find(record => record.id === usage.record.id)?.data as { title?: string } | undefined)?.title ?? usage.record.kind.replace(/-/g, ' '))}</strong><small>{usage.relation.replace(/_/g,' ').toLowerCase()} · v{usage.record.version}{usage.sceneIds.length ? ` · ${usage.sceneIds.map(id => `scene ${scenes.find(scene => scene.id === id)?.index ?? id}`).join(', ')}` : ''}</small>{onOpenUsage && <button className="text-link" onClick={() => onOpenUsage(usage)}>Locate saved record →</button>}<details><summary>Exact reference</summary><code>{usage.record.id}<br/>{usage.record.sha256}</code></details></div>) : <p className="pfl-scope">No saved usage recorded for this asset.</p>}</section>
  </>}</div>;
}
