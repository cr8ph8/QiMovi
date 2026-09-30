import { useEffect, useMemo, useRef, useState } from 'react';
import { computeDiff } from '@/lib/diff';
import { prepareSceneRestore, sceneRestoreChoices, type WritingSceneRestoreProposal } from './writingSceneRestore';
import { validateRecord } from './validation';
import type { WorkspaceApi, WorkspaceRecord } from './types';
import './writing-draft-history.css';

type Props = {
  api: WorkspaceApi;
  saved: WorkspaceRecord | null;
  disabled?: boolean;
  onFork: (record: WorkspaceRecord) => void;
  onRestoreScene?: (proposal: WritingSceneRestoreProposal) => void;
  canRestoreScene?: boolean;
  /** Include the project identity when the parent can change workspaces in place. */
  scopeKey?: string;
};

function recordScope(record: WorkspaceRecord | null) {
  const data = record?.data as { projectId?: string; sourceHash?: string | null } | null;
  return JSON.stringify([data?.projectId ?? null, data?.sourceHash ?? null]);
}

/** A new saved revision or workspace starts a fresh, explicitly loaded history. */
export default function WritingDraftHistory(props: Props) {
  const { saved, scopeKey } = props;
  const identity = JSON.stringify([scopeKey ?? null, saved?.id, saved?.kind, saved?.version, saved?.sha256, recordScope(saved)]);
  return <HistorySession key={identity} {...props}/>;
}

function HistorySession({ api, saved, disabled = false, onFork, onRestoreScene, canRestoreScene = false }: Props) {
  const [history, setHistory] = useState<WorkspaceRecord[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number>();
  const [sceneId, setSceneId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    ++request.current;
    setHistory([]); setSelectedVersion(undefined); setLoaded(false); setLoading(false); setError('');
    return () => { alive.current = false; };
  }, [api.history]);

  const selected = history.find(record => record.version === selectedVersion);
  const selectedBody = selected ? (selected.data as { body: string }).body : '';
  const savedBody = saved?.kind === 'screenplay-draft' ? (saved.data as { body: string }).body : '';
  const comparison = useMemo(() => {
    if (!selected || !saved || selected.version === saved.version) return null;
    if (selectedBody.split('\n').length * savedBody.split('\n').length > 250000) return null;
    return computeDiff(selectedBody, savedBody);
  }, [selected, saved, selectedBody, savedBody]);

  const restoration = useMemo(() => {
    try { return { scenes: selected && saved ? sceneRestoreChoices(history, selected, saved) : [], error: '' }; }
    catch { return { scenes: [], error: 'Scene identity history could not be verified. Restore is unavailable for this comparison.' }; }
  }, [history, selected, saved]);
  const chosenScene = restoration.scenes.find(scene => scene.id === sceneId) ?? restoration.scenes[0];

  async function loadHistory() {
    if (disabled || loading || !saved || saved.kind !== 'screenplay-draft' || !api.history) return;
    const serial = ++request.current;
    const current = () => alive.current && serial === request.current;
    setLoading(true); setError(''); setHistory([]); setSelectedVersion(undefined); setLoaded(false);
    try {
      const values = await api.history(saved.id);
      if (!current()) return;
      if (!Array.isArray(values) || values.length > 10000) throw new Error('The local workspace returned invalid draft history.');
      await validateRecord(saved);
      const rows = await Promise.all(values.map(value => validateRecord(value)));
      if (!current()) return;
      if (rows.some((record, index) => record.id !== saved.id || record.kind !== saved.kind || record.version !== index + 1 || recordScope(record) !== recordScope(saved) || record.reviewState !== undefined || record.replayed === true)
        || (rows.length > 0 && !rows.some(record => record.version === saved.version && record.sha256 === saved.sha256))) {
        throw new Error('The returned history does not match this saved writing draft. Refresh drafts before trying again.');
      }
      setHistory(rows); setSelectedVersion(saved.version); setLoaded(true);
    } catch (caught) {
      if (current()) setError(caught instanceof Error ? caught.message : 'Draft history could not be loaded. Try again.');
    } finally {
      if (current()) setLoading(false);
    }
  }

  if (!saved) return <p className="writer-history-unavailable">Save or open a writing draft to view its version history.</p>;
  if (saved.kind !== 'screenplay-draft') return <p className="writer-history-unavailable">Version history is available for saved writing drafts.</p>;
  if (!api.history) return <p className="writer-history-unavailable">Draft history is unavailable in this client.</p>;

  const changedVersion = selected && selected.version !== saved.version;
  const comparisonLabel = selected ? `Changes from v${selected.version} to saved v${saved.version}` : '';
  return <div className="writer-draft-history" aria-label="Writing draft history">
    <button type="button" disabled={disabled || loading} onClick={() => void loadHistory()}>{loading ? 'Loading draft history…' : loaded ? 'Refresh draft history' : 'Load draft history'}</button>
    {error && <p role="alert">{error}</p>}
    {loaded && !history.length && <p role="status">No retained versions were returned for this draft.</p>}
    {selected && <>
      <label>Saved version<select aria-label="Writing draft history version" value={selected.version} disabled={disabled || loading} onChange={event => setSelectedVersion(Number(event.target.value))}>
        {history.map(record => <option key={record.version} value={record.version}>v{record.version}{record.version === saved.version ? ' · current saved draft' : ''}</option>)}
      </select></label>
      <p>Comparisons use saved v{saved.version}. Unsaved writing is excluded.</p>
      <details className="writer-history-text" key={`text-${selected.version}`}>
        <summary>Read version v{selected.version}</summary>
        <p>{(selected.data as { title: string }).title}</p>
        <pre aria-label={`Retained writing version v${selected.version}`}>{selectedBody}</pre>
        <details><summary>Version fingerprint</summary><code>{selected.sha256}</code></details>
      </details>
      {changedVersion && <details className="writer-history-comparison" key={`diff-${selected.version}`} open>
        <summary>{comparisonLabel}</summary>
        {comparison ? <div className="writer-history-diff" role="region" aria-label={comparisonLabel}>{comparison.map((line, index) => <p key={index} data-change={line.type}>{line.type === 'add' ? '+ ' : line.type === 'remove' ? '− ' : '  '}{line.text}</p>)}</div>
          : <p>This version is too large for an inline comparison. Open “Read version v{selected.version}” to inspect its exact text.</p>}
      </details>}
      {changedVersion && onRestoreScene && <section className="writer-scene-restore" aria-label="Restore one scene">
        <h4>Restore one scene</h4>
        <p>Bring earlier scene text into this working draft. Other scenes stay as written. Review the result, then Save to create the next revision.</p>
        {restoration.error && <p role="alert">{restoration.error}</p>}
        {chosenScene ? <>
          <label>Changed scene<select aria-label="Scene to restore" value={chosenScene.id} disabled={disabled || loading} onChange={event => setSceneId(event.target.value)}>
            {restoration.scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.index} · {scene.heading}</option>)}
          </select></label>
          <div className="writer-scene-restore-preview"><div><h5>Earlier · v{selected.version}</h5><pre>{chosenScene.previousText}</pre></div><div><h5>Current · v{saved.version}</h5><pre>{chosenScene.currentText}</pre></div></div>
          {!canRestoreScene && <p>Save or discard current edits and close any active writing operation before restoring.</p>}
          <button type="button" disabled={disabled || loading || !canRestoreScene} onClick={() => {
            try { onRestoreScene(prepareSceneRestore(history, selected, saved, chosenScene.id)); }
            catch (caught) { setError(caught instanceof Error ? caught.message : 'Scene restore could not be prepared.'); }
          }}>Restore scene to working draft</button>
        </> : <p>No changed scenes have a confirmed identity across these versions. Resolve scene identity in the writer or fork the earlier draft.</p>}
        <small>The attached production screenplay and its shots keep their current revision.</small>
      </section>}
      <button type="button" className="secondary" disabled={disabled || loading} onClick={() => onFork(selected)}>Fork this version into a new writing draft</button>
    </>}
  </div>;
}
