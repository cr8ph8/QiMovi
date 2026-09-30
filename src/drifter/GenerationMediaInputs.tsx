import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { blobUrl } from './api';
import { projectLibraryApi, type ProjectLibraryApi } from './projectLibraryApi';
import { fileSize, projectFileEntries, type ProjectFileEntry, type ProjectLibraryCatalog } from './projectLibraryModel';
import type { Project } from './types';
import './generation-media-inputs.css';

export type GenerationMediaInput = { sha256: string; role: 'SOURCE_VIDEO' | 'MOTION_REFERENCE' | 'AUDIO_REFERENCE'; inMs: number | null; outMs: number | null };
type Props = {
  project: Project; inputs: GenerationMediaInput[]; onChange: (inputs: GenerationMediaInput[]) => void;
  disabled?: boolean; onEditingChange?: (editing: boolean) => void; libraryApi?: ProjectLibraryApi;
};
type ExcerptDraft = { start: string; end: string; basis: string };
type MediaObservation = { durationMs: number | null; failed: boolean };
const roleLabel = (role: GenerationMediaInput['role']) => ({ SOURCE_VIDEO: 'Source clip', MOTION_REFERENCE: 'Motion reference', AUDIO_REFERENCE: 'Audio reference' })[role];
const inputKey = (input: GenerationMediaInput) => `${input.sha256}:${input.role}`;
const excerptBasis = (input: GenerationMediaInput) => `${input.inMs ?? ''}:${input.outMs ?? ''}`;
const seconds = (ms: number | null) => ms === null ? '' : String(ms / 1000);
const originalDraft = (input: GenerationMediaInput): ExcerptDraft => ({ start: seconds(input.inMs), end: seconds(input.outMs), basis: excerptBasis(input) });
function excerptValue(draft: ExcerptDraft, durationMs: number | null) {
  const texts = [draft.start.trim(), draft.end.trim()];
  if (texts.some(Boolean) && !texts.every(Boolean)) return { error: 'Enter both start and end, or leave both blank for the complete file.' };
  if (texts.some(text => text && !/^\d+(?:\.\d{1,3})?$/.test(text))) return { error: 'Use nonnegative seconds with at most three decimal places.' };
  const [inMs, outMs] = texts.map(text => { if (!text) return null; const [whole, fraction = ''] = text.split('.'); return Number(whole) * 1000 + Number(fraction.padEnd(3, '0')); });
  if ([inMs, outMs].some(value => value !== null && !Number.isSafeInteger(value))) return { error: 'The excerpt time is too large.' };
  if (outMs !== null && outMs <= (inMs ?? 0)) return { error: 'The end must be after the start.' };
  if (outMs !== null && inMs !== null && outMs - inMs > 180000) return { error: 'A planned excerpt can be at most 180 seconds.' };
  if (inMs === null && outMs === null && durationMs !== null && durationMs > 180000) return { error: 'The full original exceeds 180 seconds. Plan an excerpt.' };
  if (durationMs !== null && ((inMs !== null && inMs >= durationMs) || (outMs !== null && outMs > durationMs))) return { error: 'The excerpt must fit within the measured media duration.' };
  return { inMs, outMs };
}

function MediaPreview({ entry, onObservation }: { entry: ProjectFileEntry; onObservation: (value: MediaObservation) => void }) {
  const [observation, setObservation] = useState<MediaObservation>({ durationMs: null, failed: false });
  const update = (value: MediaObservation) => { setObservation(value); onObservation(value); };
  const mediaProps = {
    src: blobUrl(entry.sha256), controls: true, preload: 'metadata', 'aria-label': `Preview ${entry.title}`,
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      const duration = event.currentTarget.duration;
      update({ durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null, failed: false });
    },
    onError: () => update({ ...observation, failed: true }),
  };
  return <div className="generation-media-preview">
    {entry.family === 'VIDEO' ? <video {...mediaProps} playsInline/> : <audio {...mediaProps}/>}
    {observation.failed ? <p role="status">This format could not be played here. Open or download the retained original to inspect it.</p> : <p>{observation.durationMs === null ? 'Duration is unconfirmed until this player reads the media.' : `${seconds(observation.durationMs)} seconds · read by this player`}</p>}
    <div className="generation-media-original"><a href={entry.downloadUrl} target="_blank" rel="noreferrer">Open original</a><a href={entry.downloadUrl} download={entry.filename}>Download original</a><small>{entry.mimeType} · {fileSize(entry.byteLength)}</small></div>
  </div>;
}

export default function GenerationMediaInputs({ project, inputs, onChange, disabled = false, onEditingChange, libraryApi = projectLibraryApi }: Props) {
  const scope = `${project.id}:${project.sourceHash}`;
  const [catalog, setCatalog] = useState<{ scope: string; value: ProjectLibraryCatalog }>();
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [choosing, setChoosing] = useState(false), [query, setQuery] = useState(''), [family, setFamily] = useState(''), [limit, setLimit] = useState(30);
  const [selection, setSelection] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ExcerptDraft>>({});
  const [observations, setObservations] = useState<Record<string, MediaObservation>>({});
  useEffect(() => {
    const controller = new AbortController(); let current = true; setLoading(true); setError('');
    void libraryApi.load(project, controller.signal).then(value => {
      if (!current) return;
      if (value.sourceHash !== project.sourceHash) throw new Error('The media library belongs to a different source revision. Refresh it before choosing inputs.');
      setCatalog({ scope, value });
    }).catch(value => { if (current) setError(value instanceof Error ? value.message : 'The retained media library could not be read.'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [project, scope, refresh, libraryApi]);
  const entries = useMemo(() => projectFileEntries(catalog?.scope === scope ? catalog.value : undefined, [], project.sourceHash, project.id, project).filter(entry => entry.family === 'VIDEO' || entry.family === 'AUDIO'), [catalog, scope, project.sourceHash]);
  const filtered = entries.filter(entry => (!family || entry.family === family) && `${entry.title} ${entry.filename} ${entry.collection} ${entry.curation?.data.tags.join(' ') ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const chosen = inputs.find(input => inputKey(input) === selection) ?? inputs[0];
  const chosenEntry = chosen && entries.find(entry => entry.sha256 === chosen.sha256);
  const draftKey = (input: GenerationMediaInput) => `${scope}:${inputKey(input)}`;
  const draftFor = (input: GenerationMediaInput) => drafts[draftKey(input)]?.basis === excerptBasis(input) ? drafts[draftKey(input)] : originalDraft(input);
  const pending = inputs.some(input => { const draft = draftFor(input); return draft.start !== seconds(input.inMs) || draft.end !== seconds(input.outMs) || 'error' in excerptValue(draft, observations[`${scope}:${input.sha256}`]?.durationMs ?? null); });
  useEffect(() => { onEditingChange?.(pending); }, [pending, onEditingChange]);
  const draft = chosen && draftFor(chosen);
  const durationMs = chosen ? observations[`${scope}:${chosen.sha256}`]?.durationMs ?? null : null;
  const value = draft && excerptValue(draft, durationMs);
  const changed = Boolean(chosen && draft && (draft.start !== seconds(chosen.inMs) || draft.end !== seconds(chosen.outMs)));
  const ready = !disabled && !loading && !error && catalog?.scope === scope;
  function choose(entry: ProjectFileEntry) {
    if (!ready || inputs.some(input => input.sha256 === entry.sha256)) return;
    const input: GenerationMediaInput = { sha256: entry.sha256, role: entry.family === 'AUDIO' ? 'AUDIO_REFERENCE' : 'SOURCE_VIDEO', inMs: null, outMs: null };
    onChange([...inputs, input]); setSelection(inputKey(input)); setChoosing(false);
  }
  function editExcerpt(field: 'start' | 'end', text: string) {
    if (!chosen || disabled) return;
    setDrafts(prior => ({ ...prior, [draftKey(chosen)]: { ...draftFor(chosen), [field]: text } }));
  }
  function changeRole(role: GenerationMediaInput['role']) {
    if (!chosen || !chosenEntry || disabled || (chosenEntry.family === 'AUDIO' ? role !== 'AUDIO_REFERENCE' : role === 'AUDIO_REFERENCE')) return;
    const next = { ...chosen, role };
    if (inputs.some(input => input !== chosen && inputKey(input) === inputKey(next))) return;
    setDrafts(prior => ({ ...prior, [draftKey(next)]: draftFor(chosen) }));
    onChange(inputs.map(input => input === chosen ? next : input)); setSelection(inputKey(next));
  }
  return <section className="generation-media-inputs" aria-label="Video and audio inputs" data-unsaved={pending ? 'true' : undefined}>
    <header><div><h4>Video & audio inputs</h4><p>Use a retained clip for editing, motion or sound reference.</p></div><button type="button" disabled={disabled} aria-expanded={choosing} onClick={() => setChoosing(value => !value)}>{choosing ? 'Close media choices' : 'Choose retained media'}</button></header>
    {loading && <p role="status">Reading retained media…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry media library</button></p>}
    {choosing && <div className="generation-media-chooser">
      <div className="generation-media-filters"><label>Find media<input aria-label="Find generation media" value={query} onChange={event => { setQuery(event.target.value); setLimit(30); }} placeholder="Name, collection or tag…"/></label><label>Type<select value={family} onChange={event => { setFamily(event.target.value); setLimit(30); }}><option value="">Video & audio</option><option value="VIDEO">Video</option><option value="AUDIO">Audio</option></select></label></div>
      <div className="generation-media-choices" aria-label="Retained video and audio choices">{filtered.slice(0, limit).map(entry => <button type="button" key={entry.id} disabled={!ready || inputs.some(input => input.sha256 === entry.sha256)} onClick={() => choose(entry)}><span>{entry.title}<small>{entry.collection} · {entry.family === 'VIDEO' ? 'Video' : 'Audio'} · {fileSize(entry.byteLength)}</small></span><span>{inputs.some(input => input.sha256 === entry.sha256) ? 'Chosen' : 'Choose'}</span></button>)}</div>
      {ready && filtered.length === 0 && <p>No retained media match. Import video or audio through the project Library.</p>}
      {filtered.length > limit && <button type="button" onClick={() => setLimit(value => value + 30)}>Show more media</button>}
    </div>}
    {inputs.length > 0 && <div className="generation-media-selected" aria-label="Selected media inputs">{inputs.map(input => {
      const entry = entries.find(row => row.sha256 === input.sha256);
      return <div key={inputKey(input)}><button type="button" aria-pressed={input === chosen} onClick={() => setSelection(inputKey(input))}><strong>{entry?.title ?? 'Retained input · library entry unavailable'}</strong><small>{roleLabel(input.role)}{input.inMs !== null || input.outMs !== null ? ` · ${seconds(input.inMs) || '0'}–${seconds(input.outMs) || 'end'} seconds planned` : ' · full original'}</small></button><button type="button" disabled={disabled} aria-label={`Remove ${entry?.title ?? input.sha256}`} onClick={() => { if (!disabled) onChange(inputs.filter(row => row !== input)); }}>Remove</button></div>;
    })}</div>}
    {chosen && <div className="generation-media-inspector">
      {chosenEntry ? <><MediaPreview key={`${scope}:${chosen.sha256}`} entry={chosenEntry} onObservation={observation => setObservations(prior => ({ ...prior, [`${scope}:${chosen.sha256}`]: observation }))}/><label>Use as<select aria-label="Selected media role" disabled={disabled} value={chosen.role} onChange={event => changeRole(event.target.value as GenerationMediaInput['role'])}>{chosenEntry.family === 'VIDEO' ? <><option value="SOURCE_VIDEO">Source clip</option><option value="MOTION_REFERENCE">Motion reference</option></> : <option value="AUDIO_REFERENCE">Audio reference</option>}</select></label></> : !loading && <p role="status">This saved input is preserved, but no matching retained video or audio entry is available in this library.</p>}
      {value && 'error' in value && !changed && <p role="alert">{value.error}</p>}
      {draft && <section className="generation-media-excerpt" aria-label="Plan an excerpt"><h5>Plan an excerpt</h5><p>Set both endpoints for up to 180 seconds, or leave both blank. The original stays intact; this player still shows the complete file.</p><div className="generation-media-times"><label>Start (seconds)<input type="number" min="0" step="0.001" aria-label="Media excerpt start seconds" disabled={disabled} value={draft.start} onChange={event => editExcerpt('start', event.target.value)}/></label><label>End (seconds)<input type="number" min="0" step="0.001" aria-label="Media excerpt end seconds" disabled={disabled} value={draft.end} onChange={event => editExcerpt('end', event.target.value)}/></label></div>
        {value && 'error' in value && changed && <p role="alert">{value.error}</p>}
        {changed && <p className="generation-media-pending" role="status">Excerpt edits are not applied yet.</p>}
        <div className="generation-media-excerpt-actions"><button type="button" disabled={disabled || !changed || !value || 'error' in value} onClick={() => { if (!disabled && value && !('error' in value)) onChange(inputs.map(input => input === chosen ? { ...input, inMs: value.inMs, outMs: value.outMs } : input)); }}>Apply excerpt</button><button type="button" disabled={disabled || !changed} onClick={() => setDrafts(prior => ({ ...prior, [draftKey(chosen)]: originalDraft(chosen) }))}>Discard excerpt edits</button></div>
        {durationMs === null && <p className="generation-media-note">Duration bounds remain unconfirmed until metadata can be read. A playback error does not remove the input.</p>}
      </section>}
      <details className="generation-media-identity"><summary>Original identity</summary><code>{chosen.sha256}</code></details>
    </div>}
    <p className="generation-media-note">Saved media choices prepare the clip. Provider support and permitted use are reviewed separately.</p>
  </section>;
}
