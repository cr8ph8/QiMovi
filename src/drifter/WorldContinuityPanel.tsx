import { useEffect, useMemo, useRef, useState } from 'react';
import { validateUniverseRecord } from '../../local/contracts/universe.mjs';
import { canonicalJson, hashCanonical } from './canonical';
import { aliasConflicts, continuityId, continuityOrder, continuityRecord, narrativeEvents, type ContinuityRecord } from './worldContinuityModel';
import type { UniverseCatalog, UniverseContinuityAlias, UniverseContinuityDraft, UniverseContinuityEvent, UniverseEntity } from './universeApi';
import { universeDraftScope } from './universeApi';
import type { WorkspaceProject, WorkspaceRecord } from './types';
import { storyBibleEntryGroups } from './StoryBibleEntryOptions';
import './world-continuity.css';

export type WorldContinuityPanelProps = {
  project: WorkspaceProject; model: UniverseCatalog; initialEntityId?: string; initialMode?: 'events' | 'aliases';
  onSave(data: UniverseContinuityDraft, version: number | null, requestId: string): Promise<WorkspaceRecord>;
  onDirty?(dirty: boolean): void; onClose(): void; onEntity?(id: string): void;
};
const clone = <T,>(value: T): T => JSON.parse(canonicalJson(value));
const reviewOptions = [['PROPOSED', 'Proposed'], ['QUESTIONED', 'Needs an answer'], ['SET_ASIDE', 'Set aside']] as const;
const decisionOptions = [['POSSIBLE_SAME', 'Possible alias'], ['SAME_CHARACTER', 'Author identifies same character'], ['DISTINCT_CHARACTERS', 'Author identifies different characters']] as const;
const entityLabel = (entity: UniverseEntity) => `${entity.name} · ${entity.origin === 'DRAFT' || entity.origin === 'USER_AUTHORED' ? 'Working draft' : entity.origin === 'SCREENPLAY' ? 'Screenplay observation' : 'Lore observation'} · ${entity.citations[0]?.label ?? 'No citation'} · ${entity.id.slice(-8)}`;
const identity = (model: UniverseCatalog) => canonicalJson(model.entities.map(entity => [entity.id, entity.type, entity.name, entity.origin, entity.review, entity.recordRef, entity.sceneIds, entity.citations.map(citation => [citation.sourceId, citation.sourceSha256, citation.textSha256, citation.paragraphId, citation.pageNumber])]));

export default function WorldContinuityPanel({ project, model, initialEntityId, initialMode = 'events', onSave, onDirty, onClose, onEntity }: WorldContinuityPanelProps) {
  const [captured] = useState(() => ({ project: clone(project), entities: structuredClone(model.entities), identity: identity(model), record: clone(continuityRecord(model)) }));
  const [saved, setSaved] = useState<ContinuityRecord | null>(captured.record);
  const [form, setForm] = useState<UniverseContinuityDraft>(() => clone(captured.record?.data ?? { schemaVersion: 1, ...universeDraftScope(project), events: [], aliases: [], citations: [], status: 'DRAFT', review: 'PROPOSED' }));
  const [baseline, setBaseline] = useState(() => canonicalJson(form));
  const [mode, setMode] = useState<'events' | 'aliases'>(initialMode), [lens, setLens] = useState<'world' | 'story'>('world');
  const [selectedEvent, setSelectedEvent] = useState(''), [selectedAlias, setSelectedAlias] = useState('');
  const [entitySearch, setEntitySearch] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const attempt = useRef<{ data: UniverseContinuityDraft; version: number | null; id: string; save: typeof onSave } | null>(null);
  const pending = useRef(false), alive = useRef(true), invalidated = useRef(false), conflict = useRef(false);
  const dirtyCallback = useRef(onDirty); dirtyCallback.current = onDirty;
  invalidated.current ||= project.id !== captured.project.id || project.sourceHash !== captured.project.sourceHash
    || model.projectId !== captured.project.id || model.sourceHash !== captured.project.sourceHash || identity(model) !== captured.identity;
  const latest = continuityRecord(model);
  const sameAttempt = Boolean(attempt.current && latest && latest.version === (attempt.current.version ?? 0) + 1 && canonicalJson(latest.data) === canonicalJson(attempt.current.data));
  conflict.current = !sameAttempt && Boolean(latest ? !saved || latest.version >= saved.version && latest.sha256 !== saved.sha256 : captured.record);
  const changed = canonicalJson(form) !== baseline, dirty = changed || saving || Boolean(attempt.current);
  const locked = saving || invalidated.current || conflict.current || Boolean(attempt.current);
  let valid = true;
  try { validateUniverseRecord('universe-continuity-plan', form, captured.project); } catch { valid = false; }
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; dirtyCallback.current?.(false); }; }, []);
  const order = useMemo(() => continuityOrder(form), [form]), contradictions = useMemo(() => aliasConflicts(form), [form]);
  const narrative = useMemo(() => narrativeEvents(form, captured.project.scenes), [form, captured.project.scenes]);
  const event = form.events.find(item => item.id === selectedEvent), alias = form.aliases.find(item => item.id === selectedAlias);
  const names = new Map(captured.entities.map(entity => [entity.id, entity.name]));
  const characters = storyBibleEntryGroups(captured.entities.filter(entity => entity.type === 'character')).flatMap(group => group.entries);
  const matches = captured.entities.filter(entity => entityLabel(entity).toLocaleLowerCase().includes(entitySearch.trim().toLocaleLowerCase()));
  function characterOptions(selectedId: string) {
    const selected = characters.find(item => item.id === selectedId);
    const others = characters.filter(item => item.id !== selectedId && entityLabel(item).toLocaleLowerCase().includes(entitySearch.trim().toLocaleLowerCase()));
    return [...(selected ? [selected] : []), ...others.slice(0, 200)];
  }
  function change(next: UniverseContinuityDraft) { if (!locked) { setForm(next); setNotice(''); setError(''); } }
  function editEvent(patch: Partial<UniverseContinuityEvent>) { if (event) change({ ...form, events: form.events.map(item => item.id === event.id ? { ...item, ...patch } : item) }); }
  function editAlias(patch: Partial<UniverseContinuityAlias>) { if (alias) change({ ...form, aliases: form.aliases.map(item => item.id === alias.id ? { ...item, ...patch } : item) }); }
  function addEvent() {
    if (locked || form.events.length >= 128) return;
    const id = `event-${crypto.randomUUID()}`;
    change({ ...form, events: [...form.events, { id, title: '', description: '', entityIds: initialEntityId ? [initialEntityId] : [], sceneIds: [], timeLabel: '', beforeEventIds: [], review: 'PROPOSED' }] });
    setSelectedEvent(id); setMode('events');
  }
  function addAlias() {
    if (locked || form.aliases.length >= 128) return;
    const id = `alias-${crypto.randomUUID()}`;
    const first = characters.find(entity => entity.id === initialEntityId) ?? characters[0];
    change({ ...form, aliases: [...form.aliases, { id, fromEntityId: first?.id ?? '', toEntityId: '', decision: 'POSSIBLE_SAME', note: '', review: 'PROPOSED' }] });
    setSelectedAlias(id); setMode('aliases');
  }
  async function save() {
    if (pending.current || invalidated.current || conflict.current || !valid || !changed && !attempt.current) return;
    if (!attempt.current) attempt.current = { data: clone(form), version: saved?.version ?? null, id: crypto.randomUUID(), save: onSave };
    const request = attempt.current; pending.current = true; setSaving(true); setError('');
    try {
      const result = await request.save(clone(request.data), request.version, request.id);
      validateUniverseRecord('universe-continuity-plan', result.data, captured.project);
      if (result.kind !== 'universe-continuity-plan' || result.id !== continuityId(request.data.sourceHash, request.data.projectId)
        || result.version !== (request.version ?? 0) + 1 || canonicalJson(result.data) !== canonicalJson(request.data)
        || result.sha256 !== await hashCanonical(request.data)) throw new Error('The saved receipt does not match this continuity draft. Retry to confirm the same save.');
      if (!alive.current || invalidated.current || conflict.current) return;
      setSaved(clone(result) as ContinuityRecord); setBaseline(canonicalJson(request.data)); attempt.current = null;
      setNotice(`Continuity saved · v${result.version}. Source text and character memories are unchanged.`);
    } catch (caught) { if (alive.current && !invalidated.current) setError(caught instanceof Error ? caught.message : 'Save could not be confirmed.'); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  }
  function eventButton(item: UniverseContinuityEvent) {
    return <button type="button" key={item.id} aria-pressed={selectedEvent === item.id} onClick={() => setSelectedEvent(item.id)}><strong>{item.title || 'Untitled event'}</strong><small>{item.timeLabel || 'Time unspecified'} · {reviewOptions.find(([value]) => value === item.review)?.[1]}</small>{item.beforeEventIds.length > 0 && <small>Before → {item.beforeEventIds.map(id => form.events.find(next => next.id === id)?.title || 'Untitled event').join(' · ')}</small>}</button>;
  }
  return <section className="world-continuity" aria-label="World continuity">
    <header><div><span className="bible-eyebrow">Story Bible · {project.title}</span><h3>Continuity & identities</h3><p>Order the events of your world and review who is who across retained sources.</p></div><button type="button" disabled={saving} onClick={onClose}>{attempt.current ? 'Close · save status unknown' : dirty ? 'Discard & close continuity' : 'Close continuity'}</button></header>
    <nav aria-label="Continuity tools"><button type="button" aria-pressed={mode === 'events'} onClick={() => setMode('events')}>Events · {form.events.length}</button><button type="button" aria-pressed={mode === 'aliases'} onClick={() => setMode('aliases')}>Character aliases · {form.aliases.length}</button><label>Plan status<select aria-label="Continuity plan status" value={form.review} disabled={locked} onChange={e => change({ ...form, review: e.target.value as typeof form.review })}>{reviewOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></nav>
    <p className="continuity-scope">This draft belongs to the current screenplay and its retained World entries. It does not establish a franchise release order or merge character memories.</p>
    {invalidated.current && <p role="alert">The project or World entries changed. Your draft is retained; reopen Continuity before saving.</p>}
    {conflict.current && <p role="alert">A different continuity revision is available. Your draft is retained; reopen to compare before saving.</p>}
    {form.review === 'SET_ASIDE' && <p role="status">This plan is set aside. Its drafts remain editable, but active sequence and alias checks exclude them.</p>}
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      {mode === 'events' ? <>
        <div className="continuity-toolbar"><div><button type="button" aria-pressed={lens === 'world'} onClick={() => setLens('world')}>In-world order</button><button type="button" aria-pressed={lens === 'story'} onClick={() => setLens('story')}>Screenplay appearances</button></div><button type="button" disabled={locked || form.events.length >= 128} onClick={addEvent}>Add event</button></div>
        <div className="continuity-workspace"><div className="continuity-sequence" aria-label="Event sequence">
          {lens === 'world' ? <><p>Only “happens before” links establish sequence. Events in a group have no order established between them.</p>
            {order.levels.map((level, index) => <section className="continuity-level" key={index} aria-label={`Sequence group ${index + 1}`}><small>Group {index + 1}</small>{level.map(eventButton)}</section>)}
            {!!order.cycleIds.length && <section className="continuity-issue" role="alert"><strong>Conflicting order</strong><p>These events form a loop. Revise their “happens before” links.</p>{form.events.filter(item => order.cycleIds.includes(item.id)).map(eventButton)}</section>}
            {!!order.blockedIds.length && <section className="continuity-issue"><strong>Waiting on conflicting order</strong>{form.events.filter(item => order.blockedIds.includes(item.id)).map(eventButton)}</section>}
            {!!order.missing.length && <p role="alert">{order.missing.length} order link(s) point to a set-aside event. Review these links before relying on the sequence.</p>}
          </> : <><p>Screenplay order comes from scene links. An event can appear in several scenes; this view does not reorder the screenplay.</p>{narrative.scenes.map(({ scene, events }) => <section className="continuity-level" key={scene.id}><small>Scene {scene.index} · {scene.heading}</small>{events.length ? events.map(eventButton) : <p>No event linked.</p>}</section>)}{!!narrative.unassigned.length && <section className="continuity-level"><small>No screenplay scene assigned</small>{narrative.unassigned.map(eventButton)}</section>}</>}
          {!!form.events.filter(item => item.review === 'SET_ASIDE' || form.review === 'SET_ASIDE').length && <section className="continuity-level"><small>Set-aside drafts</small>{form.events.filter(item => item.review === 'SET_ASIDE' || form.review === 'SET_ASIDE').map(eventButton)}</section>}
          {!form.events.length && <div className="continuity-empty"><h4>What changes in this world?</h4><p>Add an event, connect the affected characters or places, then identify what must happen after it. Existing continuity notes remain in Story Bible.</p></div>}
        </div>
        {event ? <fieldset disabled={locked} className="continuity-inspector"><legend>Edit event</legend>
          <label>Event title<input aria-label="Event title" maxLength={240} value={event.title} onChange={e => editEvent({ title: e.target.value })}/></label>
          <label>When in the world<input aria-label="World time label" maxLength={240} placeholder="e.g. Before the journey · exact date unknown" value={event.timeLabel} onChange={e => editEvent({ timeLabel: e.target.value })}/></label>
          <label>Change, cause & consequence<textarea aria-label="Event description" rows={4} maxLength={2000} value={event.description} onChange={e => editEvent({ description: e.target.value })}/></label>
          <label>Review<select aria-label="Event review" value={event.review} onChange={e => editEvent({ review: e.target.value as typeof event.review })}>{reviewOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Find a World entry<input aria-label="Find continuity entry" type="search" value={entitySearch} onChange={e => setEntitySearch(e.target.value)}/></label>
          <label>Connect an entry<select aria-label="Connect event entry" value="" onChange={e => { if (e.target.value && !event.entityIds.includes(e.target.value)) editEvent({ entityIds: [...event.entityIds, e.target.value] }); }} disabled={locked || event.entityIds.length >= 100}><option value="">Choose an exact entry…</option>{matches.filter(item => !event.entityIds.includes(item.id)).slice(0,100).map(item => <option key={item.id} value={item.id}>{entityLabel(item)}</option>)}</select><small>{matches.length > 100 ? 'First 100 matches. Search to narrow the choices.' : 'Source labels and IDs keep similar names distinct.'}</small></label>
          <ul className="continuity-entries">{event.entityIds.map(id => <li key={id}><button type="button" disabled={locked} onClick={() => onEntity?.(id)}>{names.get(id) ?? id}</button><button type="button" aria-label={`Unlink ${names.get(id) ?? id}`} onClick={() => editEvent({ entityIds: event.entityIds.filter(item => item !== id) })}>×</button></li>)}</ul>
          <fieldset><legend>Screenplay appearances</legend>{captured.project.scenes.map(scene => <label className="continuity-check" key={scene.id}><input type="checkbox" aria-label={`Event scene ${scene.index}`} checked={event.sceneIds.includes(scene.id)} onChange={e => editEvent({ sceneIds: e.target.checked ? [...event.sceneIds, scene.id] : event.sceneIds.filter(id => id !== scene.id) })}/>{scene.index} · {scene.heading}</label>)}</fieldset>
          <fieldset><legend>Happens before</legend>{form.events.filter(item => item.id !== event.id).map(item => <label className="continuity-check" key={item.id}><input type="checkbox" aria-label={`Before ${item.title || item.id}`} checked={event.beforeEventIds.includes(item.id)} onChange={e => editEvent({ beforeEventIds: e.target.checked ? [...event.beforeEventIds, item.id] : event.beforeEventIds.filter(id => id !== item.id) })}/>{item.title || 'Untitled event'}{item.review === 'SET_ASIDE' ? ' · set aside' : ''}</label>)}{form.events.length < 2 && <small>Add another event to establish order.</small>}</fieldset>
          <button type="button" onClick={() => { change({ ...form, events: form.events.filter(item => item.id !== event.id).map(item => ({ ...item, beforeEventIds: item.beforeEventIds.filter(id => id !== event.id) })) }); setSelectedEvent(''); }}>Remove event from this draft</button>
        </fieldset> : <aside className="continuity-empty"><h4>Select an event</h4><p>Edit its world timing, source entries and scene appearances here.</p></aside>}
        </div>
      </> : <>
        <div className="continuity-toolbar"><p>Link a working character to an exact source observation. A proposed same-character decision makes those source scenes available to production planning. Possible or questioned matches wait for review; no text or memories are merged.</p><button type="button" disabled={locked || characters.length < 2 || form.aliases.length >= 128} onClick={addAlias}>Review an alias</button></div>
        {!!contradictions.length && <p role="alert">{contradictions.length} conflicting identity decision(s). “Different characters” conflicts with an active chain of “same character” assertions. Review before use.</p>}
        <div className="continuity-workspace"><div className="continuity-sequence" aria-label="Alias decisions">{form.aliases.map(item => <button className="continuity-alias-row" type="button" key={item.id} aria-pressed={item.id === selectedAlias} onClick={() => setSelectedAlias(item.id)}><strong>{names.get(item.fromEntityId) ?? 'Choose character'} ↔ {names.get(item.toEntityId) ?? 'Choose character'}</strong><small>{decisionOptions.find(([value]) => value === item.decision)?.[1]} · {reviewOptions.find(([value]) => value === item.review)?.[1]}{contradictions.includes(item.id) ? ' · Conflict' : ''}</small></button>)}{!form.aliases.length && <div className="continuity-empty"><h4>No identity decisions recorded</h4><p>Choose two exact character entries. Record whether they may be the same character, you identify them as the same, or they are distinct. These remain author assertions.</p></div>}</div>
          {alias ? <fieldset disabled={locked} className="continuity-inspector"><legend>Review character identity</legend>
            <label>Find characters<input aria-label="Find alias characters" type="search" value={entitySearch} onChange={e => setEntitySearch(e.target.value)}/></label>
            {(['fromEntityId', 'toEntityId'] as const).map((field, index) => <label key={field}>Character {index + 1}<select aria-label={`Alias character ${index + 1}`} value={alias[field]} onChange={e => editAlias({ [field]: e.target.value })}><option value="">Choose an exact character…</option>{characterOptions(alias[field]).map(item => <option key={item.id} value={item.id}>{entityLabel(item)}</option>)}</select><small>{alias[field] || 'No entry selected'} · Up to 200 matching choices; search to narrow. The current choice stays visible.</small></label>)}
            <div className="continuity-source-comparison" aria-label="Compare character entries">{[alias.fromEntityId, alias.toEntityId].map((id, index) => {
              const entry = captured.entities.find(item => item.id === id);
              return <article key={index}><h4>Character {index + 1}</h4>{entry ? <><strong>{entityLabel(entry)}</strong><p>{entry.summary || 'No description recorded.'}</p><small>{entry.sceneIds.length} recorded scene links · {entry.citations.length} source citations</small><details><summary>Source references</summary>{entry.citations.map((citation, i) => <p key={i}>{citation.label}{citation.paragraphId ? ` · ${citation.paragraphId}` : ''}{citation.pageNumber ? ` · page ${citation.pageNumber}` : ''}</p>)}</details></> : <p>Choose an entry to compare.</p>}</article>;
            })}</div>
            <label>Identity decision<select aria-label="Identity decision" value={alias.decision} onChange={e => editAlias({ decision: e.target.value as typeof alias.decision })}>{decisionOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Reason & source notes<textarea aria-label="Alias reason" rows={5} maxLength={2000} value={alias.note} onChange={e => editAlias({ note: e.target.value })}/></label>
            <label>Review<select aria-label="Alias review" value={alias.review} onChange={e => editAlias({ review: e.target.value as typeof alias.review })}>{reviewOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <p>Source evidence remains attached to each original entry. This decision does not rewrite dialogue cues or grant either character the other’s memories.</p>
            <button type="button" onClick={() => { change({ ...form, aliases: form.aliases.filter(item => item.id !== alias.id) }); setSelectedAlias(''); }}>Remove alias decision from this draft</button>
          </fieldset> : <aside className="continuity-empty"><h4>Select an identity decision</h4><p>Keep uncertainty and contrary source evidence visible.</p></aside>}
        </div>
      </>}
      {error && <p role="alert">{error} Retry retains the exact save identity.</p>}{notice && <p role="status">{notice}</p>}
      <footer><small>{saved ? `Saved v${saved.version}` : 'No saved continuity plan'} · {changed ? 'Unsaved changes' : 'No changes'}{!valid && changed ? ' · Complete titles and choose distinct alias entries before saving.' : ''}</small><div><button type="button" disabled={!changed || locked} onClick={() => { setForm(JSON.parse(baseline)); setSelectedEvent(''); setSelectedAlias(''); setError(''); setNotice('Draft changes discarded.'); }}>Discard continuity changes</button><button type="submit" disabled={saving || invalidated.current || conflict.current || !valid || !changed && !attempt.current}>{saving ? 'Saving…' : attempt.current ? 'Retry same continuity save' : 'Save continuity'}</button></div></footer>
    </form>
  </section>;
}
