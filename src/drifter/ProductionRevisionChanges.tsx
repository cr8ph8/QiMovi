import { useEffect, useState } from 'react';
import type { ProductionRevisionPreview } from './productionRevisionApi';

export type ProductionRevisionChangesData = Pick<ProductionRevisionPreview, 'sceneDeltas' | 'shotDeltas' | 'summary' | 'characterCues' | 'affectedRecords'>;
export type ProductionRevisionChangesProps = {
  changes: ProductionRevisionChangesData;
  originalTextForScene?(sceneId: string): string | undefined;
  workingTextForScene?(sceneId: string): string | undefined;
  onScene?(sceneId: string): void;
  sceneActionLabel?: string;
};

const labels: Record<string, string> = {
  textSha256: 'screenplay text', heading: 'scene heading', notes: 'scene direction', characters: 'character cues', shots: 'planned coverage',
  shotType: 'shot size', cameraMovement: 'camera movement', durationSeconds: 'planned timing',
  BOUND_SOURCE_SCOPE: 'linked to the production screenplay', EXPLICIT_SCENE_ID: 'linked to a changed scene',
  EXPLICIT_SHOT_ID: 'linked to a changed shot', EXACT_PARAGRAPH_BINDING: 'linked to changed screenplay text', EXPLICIT_BUDGET_TARGET: 'linked to a changed cost target',
};
const label = (value: string) => labels[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
const seconds = (value: number | null) => value === null ? 'Timing open' : `${value} s planned`;
const changed = (row: { status: string; reordered: boolean }) => row.status !== 'unchanged' || row.reordered;

/** Presentation only: comparison, reuse and save authority remain with the caller. */
export default function ProductionRevisionChanges({ changes, originalTextForScene, workingTextForScene, onScene, sceneActionLabel = 'Edit this scene’s coverage' }: ProductionRevisionChangesProps) {
  const [sceneId, setSceneId] = useState('');
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showSourceLinks, setShowSourceLinks] = useState(false);
  const [recordPage, setRecordPage] = useState(0);
  useEffect(() => { setSceneId(''); setShowUnchanged(false); setShowSourceLinks(false); setRecordPage(0); }, [changes]);
  const directRecords = changes.affectedRecords.filter(row => row.reasons.some(reason => reason !== 'BOUND_SOURCE_SCOPE'));
  const sourceOnlyCount = changes.affectedRecords.length - directRecords.length;
  const recordRows = showSourceLinks ? changes.affectedRecords : directRecords;
  const recordPages = Math.max(1, Math.ceil(recordRows.length / 25));
  const visibleRecordPage = Math.min(recordPage, recordPages - 1);
  const rows = changes.sceneDeltas.filter(row => showUnchanged || changed(row));
  const selected = rows.find(row => row.sceneId === sceneId) ?? rows[0];
  const shots = changes.shotDeltas.filter(row => row.sceneId === selected?.sceneId && (showUnchanged || changed(row)));
  const originalText = selected ? originalTextForScene?.(selected.sceneId) : undefined;
  const workingText = selected ? workingTextForScene?.(selected.sceneId) : undefined;
  const showSource = selected && (selected.status === 'added' || selected.status === 'removed' || selected.changes.some(change => ['textSha256', 'heading', 'text', 'source_text'].includes(change)));
  const changedSceneCount = changes.sceneDeltas.filter(changed).length;
  const changedShotCount = changes.shotDeltas.filter(changed).length;
  return <div className="production-revision-changes">
    <dl className="production-revision-counts" aria-label="Revision summary">
      {(['scenes', 'shots'] as const).map(kind => <div key={kind}>
        <dt>{kind === 'scenes' ? 'Scenes' : 'Shots'} to review</dt>
        <dd><strong>{kind === 'scenes' ? changedSceneCount : changedShotCount}</strong><span>{changes.summary[kind].added} added · {changes.summary[kind].removed} removed · {changes.summary[kind].changed} changed · {changes.summary[kind].reordered} reordered</span></dd>
      </div>)}
      <div><dt>Direct production links</dt><dd><strong>{directRecords.length}</strong><span>{sourceOnlyCount ? `${sourceOnlyCount} additional records share the screenplay` : directRecords.length ? 'Review scene and shot links below' : 'No direct records flagged'}</span></dd></div>
    </dl>
    <div className="production-revision-section-heading"><h4>Scene comparison</h4><label className="production-revision-filter"><input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)}/>Include unchanged scenes and shots</label></div>
    {rows.length && selected ? <div className="production-revision-layout">
      <nav aria-label="Changed screenplay scenes">{rows.map(row => <button key={row.sceneId} aria-pressed={selected.sceneId === row.sceneId} onClick={() => setSceneId(row.sceneId)}>
        <span className="production-revision-scene-number">{row.after?.ordinal ?? row.before?.ordinal}</span>
        <span><strong>{row.after?.heading ?? row.before?.heading}</strong><small>{label(row.status)}{row.reordered ? ' · reordered' : ''}</small></span>
      </button>)}</nav>
      <section className="production-revision-detail" aria-label="Selected scene changes">
        <header><div><h4>{selected.after?.heading ?? selected.before?.heading}</h4><p>{selected.changes.map(label).join(' · ') || (selected.status === 'added' ? 'New scene in the working copy.' : selected.status === 'removed' ? 'Removed from the working copy.' : selected.reordered ? 'Scene order changed.' : 'No content change.')}</p></div>{selected.after && onScene && <button onClick={() => onScene(selected.sceneId)}>{sceneActionLabel}</button>}</header>
        {showSource && <div className="production-revision-pair production-revision-source"><div><strong>Production screenplay</strong><pre>{originalText ?? (selected.before ? 'Exact saved text unavailable.' : 'Scene not present in this revision.')}</pre></div><div><strong>Working screenplay</strong><pre>{workingText ?? (selected.after ? 'Exact saved text unavailable.' : 'Scene not present in this revision.')}</pre></div></div>}
        {selected.before && selected.after && (selected.before.notes || selected.after.notes) && <div className="production-revision-pair"><div><strong>Production direction</strong><p>{selected.before.notes || 'No scene notes.'}</p></div><div><strong>Working direction</strong><p>{selected.after.notes || 'No scene notes.'}</p></div></div>}
        {shots.length > 0 && <><h5 className="production-revision-subheading">Planned coverage</h5><ul className="production-revision-shots">{shots.map(row => <li key={row.shotId}>
          <header><strong>{row.after?.title ?? row.before?.title}</strong><small>{label(row.status)}{row.reordered ? ' · reordered' : ''}</small></header>
          <div className="production-revision-pair">{([['Production', row.before], ['Working', row.after]] as const).map(([title, value]) => <div key={title}><small>{title}</small>{value ? <><p>{value.description || 'Action open'}</p><small>{[value.shotType, value.cameraMovement, value.plannedDurationMs != null ? `${value.plannedDurationMs / 1000} s planned` : seconds(value.durationSeconds)].filter(Boolean).join(' · ')}</small></> : <p>No shot in this revision.</p>}</div>)}</div>
        </li>)}</ul></>}
        {!shots.length && <p className="production-revision-empty">{showUnchanged ? 'No planned shots in this scene.' : 'No planned shot changes in this scene.'}</p>}
      </section>
    </div> : <p className="production-revision-empty">No scene or shot changes in this comparison.</p>}
    {(changes.characterCues.added.length > 0 || changes.characterCues.removed.length > 0) && <section className="production-revision-cues"><h4>Character cues</h4>{changes.characterCues.added.length > 0 && <p>Added: {changes.characterCues.added.join(', ')}</p>}{changes.characterCues.removed.length > 0 && <p>Removed: {changes.characterCues.removed.join(', ')}</p>}<small>Speaking cues identify dialogue in the screenplay. Casting stays separate.</small></section>}
    {changes.affectedRecords.length > 0 && <section className="production-revision-records"><h4>Production records to review</h4><p>Direct links point to the changed scenes, shots or text. Sharing the screenplay alone does not establish that a record needs changes.</p>
      {sourceOnlyCount > 0 && <label className="production-revision-filter"><input type="checkbox" checked={showSourceLinks} onChange={event => { setShowSourceLinks(event.target.checked); setRecordPage(0); }}/>Include {sourceOnlyCount} records linked only to the screenplay</label>}
      {!recordRows.length && <p>No direct scene or shot links were found.</p>}
      <ul aria-label="Linked production records">{recordRows.slice(visibleRecordPage * 25, (visibleRecordPage + 1) * 25).map(row => <li key={`${row.ref.id}:${row.ref.version}`}><div><strong>{label(row.kind)} · v{row.ref.version}</strong><small>{row.ref.id}</small></div><span>{row.reasons.map(label).join(' · ')}</span></li>)}</ul>
      {recordRows.length > 25 && <nav aria-label="Production record pages"><button disabled={visibleRecordPage === 0} onClick={() => setRecordPage(page => Math.max(0, page - 1))}>Previous records</button><span> Page {visibleRecordPage + 1} of {recordPages} · {recordRows.length} records </span><button disabled={visibleRecordPage + 1 >= recordPages} onClick={() => setRecordPage(page => page + 1)}>Next records</button></nav>}
      <small>Review flags do not change records or costs. The exported review includes every link.</small>
    </section>}
  </div>;
}
