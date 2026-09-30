import { useEffect, useState } from 'react';
import { canonicalJson } from './canonical';
import { shotMediaTakes } from './mediaTakeModel';
import { parseEditSeconds, resolveClipEditSelection } from './movieEditSelectionModel';
import type { ClipEditSelection, MovieClip } from './movieSequenceModel';
import type { Project, WorkspaceRecord } from './types';
import MovieTakePreview from './MovieTakePreview';
import './movie-take-selection.css';

type Draft = { basis: string; takeKey: string; inText: string; outText: string };
export default function MovieTakeSelection({ clip, clips, project, records, onApply, onSelect, onDuration, onEditingChange, onReviewTakes, disabled = false, active = true }: {
  clip: MovieClip; clips: MovieClip[]; project: Project; records: WorkspaceRecord[];
  onApply(id: string, selection: ClipEditSelection | null): void; onSelect(id: string): void;
  onReviewTakes?(sceneId: string, shotId: string): void;
  onDuration(id: string, ms: number | null): void; onEditingChange(value: boolean): void; disabled?: boolean; active?: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notice, setNotice] = useState('');
  const scope = `${project.id}:${project.sourceHash}:`, key = `${scope}${clip.id}`, basis = canonicalJson(clip.editSelection ?? null);
  const choices = shotMediaTakes(project, records, clip.sceneId, clip.shotId).filter(take => take.review?.data.decision === 'KEEP_CANDIDATE');
  const takeKey = (id: string, hash: string) => `${id}@${hash}`;
  const retained = clip.editSelection;
  const draft = drafts[key] ?? { basis, takeKey: retained ? takeKey(retained.takeRef.id, retained.reviewRef.sha256) : '', inText: String((retained?.inMs ?? 0) / 1000), outText: retained ? String(retained.outMs / 1000) : '' };
  const chosen = choices.find(take => takeKey(take.record.id, take.review!.sha256) === draft.takeKey);
  const inMs = parseEditSeconds(draft.inText), outMs = parseEditSeconds(draft.outText);
  const selection: ClipEditSelection | null = chosen && inMs !== null && outMs !== null ? {
    takeRef: { id: chosen.record.id, sha256: chosen.record.sha256 }, reviewRef: { id: chosen.review!.id, sha256: chosen.review!.sha256 },
    assetHash: chosen.record.data.blob.sha256, inMs, outMs,
  } : null;
  const resolution = resolveClipEditSelection(selection ? { ...clip, editSelection: selection } : clip, project, records);
  const conflict = Boolean(drafts[key] && drafts[key].basis !== basis);
  const error = conflict ? 'This saved cut changed while you were editing. Discard this range draft and review the current selection.'
    : !draft.takeKey ? '' : !chosen ? 'This candidate changed or is no longer kept. Review and select a current take.'
    : !selection ? 'Enter in and out points in seconds, with up to three decimal places.' : resolution.state !== 'READY' ? resolution.reason : '';
  const pending = clips.filter(row => drafts[`${scope}${row.id}`]);
  useEffect(() => { onEditingChange(pending.length > 0); }, [pending.length, onEditingChange]);
  function change(values: Partial<Draft>) { setNotice(''); setDrafts(prior => ({ ...prior, [key]: { ...draft, ...values } })); }
  function discard() { setDrafts(prior => { const next = { ...prior }; delete next[key]; return next; }); setNotice(''); }
  function apply() {
    if (disabled || error || !selection || resolution.state !== 'READY') return;
    onApply(clip.id, selection); discard(); setNotice('Take range applied to this movie draft. Save movie sequence to retain it.');
  }
  return <section className="movie-take-selection" aria-label="Take and trim for selected clip">
    <header><div><strong>Take & trim</strong><p>{clip.editSelection ? 'Cut applied to movie draft' : 'Choose the footage for this clip'}</p></div><span>{choices.length} kept {choices.length === 1 ? 'candidate' : 'candidates'} · {clip.editSelection ? `${(clip.editSelection.outMs - clip.editSelection.inMs) / 1000} s cut` : 'No take chosen'}</span></header>
    {onReviewTakes && <button type="button" disabled={disabled || Boolean(drafts[key])} onClick={() => onReviewTakes(clip.sceneId, clip.shotId)}>Review shot takes</button>}
    <label>Reviewed take<select aria-label="Movie clip take" disabled={disabled} value={draft.takeKey} onChange={event => {
      const entry = choices.find(take => takeKey(take.record.id, take.review!.sha256) === event.target.value);
      change({ takeKey: event.target.value, inText: '0', outText: entry ? String(Math.min(entry.record.data.measurement.durationMs, 180000) / 1000) : '' });
    }}><option value="">Choose a kept candidate</option>{draft.takeKey && !chosen && <option value={draft.takeKey}>Previous selection · review needed</option>}{choices.map(take => <option key={take.record.id} value={takeKey(take.record.id, take.review!.sha256)}>{take.record.data.originalFilename} · {take.record.data.measurement.durationMs / 1000} s measured</option>)}</select></label>
    {!choices.length && <p>Keep a measured take for this shot in “Review shot takes”, then choose it here. Scene-wide reference footage stays separate.</p>}
    <div className="movie-take-range"><label>In (seconds)<input aria-label="Take in seconds" type="text" inputMode="decimal" disabled={disabled || !chosen} value={draft.inText} onChange={event => change({ inText: event.target.value })}/></label><label>Out (seconds)<input aria-label="Take out seconds" type="text" inputMode="decimal" disabled={disabled || !chosen} value={draft.outText} onChange={event => change({ outText: event.target.value })}/></label><span>{selection && !error ? `${(selection.outMs - selection.inMs) / 1000} s range` : 'Up to 180 s per cut'}</span></div>
    {error && <p role="alert">{error}</p>}
    <div className="movie-take-actions"><button type="button" className="primary" disabled={disabled || !drafts[key] || Boolean(error) || !selection} onClick={apply}>Apply take & range</button>{drafts[key] && <button type="button" disabled={disabled} onClick={discard}>Discard range changes</button>}{retained && <button type="button" disabled={disabled || Boolean(drafts[key])} onClick={() => { onApply(clip.id, null); setNotice('Take removed from this movie draft. The media remains in the Library.'); }}>Clear cut selection</button>}{retained && !drafts[key] && resolution.state === 'READY' && clip.plannedDurationMs !== retained.outMs - retained.inMs && <button type="button" disabled={disabled} onClick={() => onDuration(clip.id, retained.outMs - retained.inMs)}>Use cut length as planned duration</button>}</div>
    {notice && <p role="status">{notice}</p>}
    {pending.some(row => row.id !== clip.id) && <nav aria-label="Unapplied take ranges">{pending.filter(row => row.id !== clip.id).map(row => <button type="button" key={row.id} onClick={() => onSelect(row.id)}>Finish range · clip {clips.indexOf(row) + 1}</button>)}</nav>}
    {selection && !error && resolution.entry && <MovieTakePreview key={clip.id} entry={resolution.entry} selection={selection} active={active && !disabled}/>}
    <small>Range choices are reversible editorial drafts. Planned timing changes only when you choose it above. Final picture and sound approval stay separate.</small>
  </section>;
}
