import { useEffect, useRef, useState } from 'react';
import { evaluateInvariants, type ContinuityEvent, type EventKind, type GateVerdict } from '@/lib/narrative-invariants';
import { canonicalJson } from './canonical';
import type { Project, WorkspaceApi, WorkspaceRecord, WritingNote } from './types';

import { eventsAvailable, requiresObject, verifyAuthoredEvents } from './workbenchValidation';
const tag = 'continuity-events-v1';
type Props = { project: Project; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; onSaved: (record: WorkspaceRecord) => void };
export default function LocalContinuity(props: Props) { return <ContinuityScope key={`${props.project.id}:${props.project.sourceHash}`} {...props}/>; }
function ContinuityScope({ project, records, api, open, onSaved }: Props) {
  const [events, setEvents] = useState<ContinuityEvent[]>([]);
  const [title, setTitle] = useState('Continuity sketch');
  const [scene, setScene] = useState(project.scenes[0]?.id ?? '');
  const [eventKind, setEventKind] = useState<EventKind>('introduce_char');
  const [actor, setActor] = useState('');
  const [object, setObject] = useState('');
  const [saved, setSaved] = useState<WorkspaceRecord | null>(null);
  const [recordId, setRecordId] = useState(() => `writing-note:continuity-${crypto.randomUUID()}`);
  const [result, setResult] = useState<GateVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const alive = useRef(true);
  const body = canonicalJson({ schema: 'authored-continuity-events/v1', events });
  const currentBody = useRef(body); currentBody.current = body;
  const dirty = body !== ((saved?.data as WritingNote | undefined)?.body ?? canonicalJson({ schema: 'authored-continuity-events/v1', events: [] })) || title !== ((saved?.data as WritingNote | undefined)?.title ?? 'Continuity sketch');
  const sketches = records.filter(record => record.kind === 'writing-note' && (record.data as WritingNote).tags.includes(tag));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function openSketch(record: WorkspaceRecord) {
    if (dirty) { setError('Save the open continuity sketch before opening another.'); return; }
    try {
      const data = record.data as WritingNote;
      const parsed = JSON.parse(data.body);
      if (parsed.schema !== 'authored-continuity-events/v1') throw new Error('This record is not a supported authored continuity sketch.');
      verifyAuthoredEvents(parsed.events, project);
      setEvents(parsed.events); setTitle(data.title); setSaved(record); setRecordId(record.id); setResult(null); setError(''); setNotice('Saved continuity sketch opened.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read the continuity sketch.'); }
  }
  function add() {
    const actors = actor.split(',').map(value => value.trim()).filter(Boolean);
    if ((!actors.length && eventKind !== 'introduce_prop') || new Set(actors).size !== actors.length || actors.length > 20 || actors.some(value => value.length > 200)) { setError('Enter distinct character names for this event.'); return; }
    if (object.trim().length > 1000) { setError('Keep the prop or information within 1,000 characters.'); return; }
    if (requiresObject(eventKind) && !object.trim()) { setError('Enter the prop or information required by this event.'); return; }
    if (events.length >= 200) { setError('This sketch supports up to 200 ordered events.'); return; }
    const previousScene = project.scenes.find(item => item.id === events.at(-1)?.scene_ref);
    const nextScene = project.scenes.find(item => item.id === scene);
    if (!nextScene || (previousScene && nextScene.index < previousScene.index)) { setError('Keep events in source scene order.'); return; }
    setEvents(previous => [...previous, { id: crypto.randomUUID(), scene_ref: scene, scene_order: previous.length + 1, event_kind: eventKind, actors, object: object.trim() || null, source: 'authored' }]); setActor(''); setObject(''); setResult(null); setError(''); setNotice('');
  }
  async function check() {
    if (!events.length || busy) return;
    const basis = body; setBusy(true); setError('');
    try { verifyAuthoredEvents(events, project); const verdict = await evaluateInvariants(events); if (alive.current && currentBody.current === basis) setResult(verdict); }
    catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Continuity check failed.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function save() {
    if (!title.trim() || !events.length || busy) return;
    const data: WritingNote = { sourceHash: project.sourceHash, title, body, category: 'REVISION', tags: [tag] };
    const expectedVersion = saved?.version ?? null;
    const fingerprint = canonicalJson({ data, expectedVersion, recordId });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      verifyAuthoredEvents(events, project);
      const record = await api.saveRecord({ id: recordId, kind: 'writing-note', data, expectedVersion, requestId: attempt.current.requestId });
      if (record.id !== recordId || record.kind !== 'writing-note' || record.version !== (expectedVersion ?? 0) + 1 || canonicalJson(record.data) !== canonicalJson(data)) throw new Error('The saved continuity sketch did not match the submitted text.');
      if (alive.current) { setSaved(record); onSaved(record); setNotice(`Continuity sketch saved · v${record.version}`); }
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Continuity save not confirmed.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section hidden={!open} className="canis-continuity" data-unsaved={dirty || actor.trim() || object.trim() ? 'true' : 'false'}><p className="canis-lead">Check an authored sequence of character, prop and knowledge events.</p><p className="scope-note">This checks the events you enter with CanIScreenwrite’s deterministic rules. It does not extract or certify the screenplay’s complete continuity.</p><div className="canis-record-list">{sketches.map(record => <button key={record.id} disabled={busy} onClick={() => openSketch(record)}><strong>{(record.data as WritingNote).title}</strong><small>v{record.version}</small></button>)}</div>{error && <p role="alert" className="error-bar">{error}</p>}{notice && <p role="status" className="canis-notice">{notice}</p>}<fieldset className="canis-form" disabled={busy}><label>Sketch title<input aria-label="Continuity sketch title" value={title} maxLength={200} onChange={event => setTitle(event.target.value)}/></label><div className="canis-form-columns"><label>Source scene<select aria-label="Continuity source scene" value={scene} onChange={event => setScene(event.target.value)}>{project.scenes.map(item => <option key={item.id} value={item.id}>{item.index} · {item.heading}</option>)}</select></label><label>Event<select aria-label="Continuity event" value={eventKind} onChange={event => setEventKind(event.target.value as EventKind)}>{eventsAvailable.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="canis-form-columns"><label>Characters<input aria-label="Continuity characters" value={actor} onChange={event => setActor(event.target.value)} placeholder="Character names, separated by commas"/></label><label>Prop, place or information<input aria-label="Continuity object" value={object} onChange={event => setObject(event.target.value)}/></label></div><button type="button" className="secondary" onClick={add}>Add ordered event</button></fieldset><ol className="canis-event-list">{events.map((event, index) => <li key={event.id}><span>{index + 1}</span><div><strong>{eventsAvailable.find(([kind]) => kind === event.event_kind)?.[1]} · {event.actors.join(', ') || event.object}</strong><small>{project.scenes.find(item => item.id === event.scene_ref)?.heading}{event.object ? ` / ${event.object}` : ''}</small></div><button aria-label={`Remove continuity event ${index + 1}`} disabled={busy} onClick={() => { setEvents(previous => previous.filter((_, row) => row !== index).map((item, row) => ({ ...item, scene_order: row + 1 }))); setResult(null); }}>×</button></li>)}</ol><div className="canis-next"><button className="secondary" disabled={!events.length || busy} onClick={() => void check()}>Check authored events</button><button className="primary" disabled={!events.length || !title.trim() || !dirty || busy} onClick={() => void save()}>Save continuity sketch</button></div>{result && <div className="canis-continuity-result"><h2>{result.verdict === 'PASS' ? 'Entered events passed these checks' : `${result.violations.length} continuity finding${result.violations.length === 1 ? '' : 's'}`}</h2><p className="scope-note">{result.event_count} authored events · invariant rules {result.invariants_version}</p>{result.violations.map((violation, index) => <p key={index}>{violation.message}</p>)}</div>}<details className="canis-source-questions"><summary>Retained screenplay questions</summary>{project.continuityQuestions.map((question, index) => <p key={index}>{typeof question === 'string' ? question : question.question ?? question.text}</p>)}</details></section>;
}
