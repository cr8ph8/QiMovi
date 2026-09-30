import { useEffect, useRef, useState } from 'react';
import { modelAssistanceApi, type AssistanceInput, type AssistanceRecord, type ModelAssistanceApi, type ModelStatus } from './modelAssistanceApi';
import { canonicalJson } from './canonical';
import type { Project, WorkspaceRecord } from './types';
import type { UniverseAgentDraft, UniverseCatalog, UniverseEntity } from './universeApi';
import type { WorldRehearsalRecord } from './worldRehearsal';
import { characterRehearsalContext } from '../../local/contracts/world-rehearsal.mjs';
import './character-agent.css';

type Props = {
  project: Project; model: UniverseCatalog; entity: UniverseEntity;
  onSave: (data: UniverseAgentDraft, expectedVersion: number | null, requestId: string) => Promise<WorkspaceRecord>;
  onSaved?: (record: WorkspaceRecord) => void; onDirty?: (dirty: boolean) => void; onClose: () => void;
  api?: ModelAssistanceApi;
  rehearsalRecord?: WorldRehearsalRecord;
  profileRecord?: WorkspaceRecord & { data: UniverseAgentDraft };
};
type ProfileRecord = WorkspaceRecord & { data: UniverseAgentDraft };
type Fields = { name: string; goals: string; boundaries: string; observations: string; beliefs: string; memories: string; voice: string };
const listFields = ['goals', 'boundaries', 'observations', 'beliefs', 'memories'] as const;
const labels: Record<typeof listFields[number], string> = { goals: 'Goals, in priority order', boundaries: 'Boundaries and limits', observations: 'Observed knowledge', beliefs: 'Beliefs and assumptions', memories: 'Reviewed memories' };
const hints: Record<typeof listFields[number], string> = {
  goals: 'What this character chooses to pursue. First line has highest priority.',
  boundaries: 'What they cannot do, will not do, or must preserve.',
  observations: 'Only information this character has personally learned.',
  beliefs: 'What they think is true, including uncertainty and mistakes.',
  memories: 'Record a reviewed experience or outcome explicitly. Rehearsal choices are never added automatically.',
};
const lines = (value: string) => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
const message = (error: unknown) => error instanceof Error ? error.message : 'The local request could not be confirmed.';
function profile(model: UniverseCatalog, entityId: string, sourceHash: string): ProfileRecord | null {
  return model.drafts.filter((row): row is typeof row & ProfileRecord => row.kind === 'universe-agent' && 'entityId' in row.data && row.data.entityId === entityId && row.data.sourceHash === sourceHash).sort((a, b) => b.version - a.version)[0] ?? null;
}
function fields(data: UniverseAgentDraft | null, name: string): Fields {
  return { name, goals: data?.goals.join('\n') ?? '', boundaries: data?.boundaries.join('\n') ?? '', observations: data?.observations.join('\n') ?? '', beliefs: data?.beliefs.join('\n') ?? '', memories: data?.memories.join('\n') ?? '', voice: data?.voice ?? '' };
}

export default function CharacterAgentPanel({ project, model, entity, onSave, onSaved, onDirty, onClose, api = modelAssistanceApi, rehearsalRecord, profileRecord }: Props) {
  const [captured] = useState(() => ({ project: structuredClone(project), entityId: entity.id, entityName: entity.name, name: profileRecord?.data.name ?? entity.name, profile: profileRecord ?? profile(model, entity.id, project.sourceHash), rehearsal: rehearsalRecord ? structuredClone(rehearsalRecord) : null }));
  const profileId = `universe-agent:${captured.entityId}`;
  const [saved, setSaved] = useState<ProfileRecord | null>(captured.profile);
  const [form, setForm] = useState<Fields>(() => fields(captured.profile?.data ?? null, captured.name));
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState('');
  const [catalog, setCatalog] = useState<ModelStatus | null>(null), [chosenModel, setChosenModel] = useState('');
  const [checking, setChecking] = useState(false), [running, setRunning] = useState(false), [canceling, setCanceling] = useState(false);
  const initialDirection = captured.rehearsal ? 'Choose one next action from your allowed actions, using only your saved perspective and delivered observations. Explain any hesitation or competing goal. Do not assume an attempted action succeeds.' : '';
  const [event, setEvent] = useState(initialDirection), [retainedEvent, setRetainedEvent] = useState(initialDirection);
  const [history, setHistory] = useState<AssistanceRecord[]>([]), [result, setResult] = useState<AssistanceRecord | null>(null);
  const [runError, setRunError] = useState(''), [notice, setNotice] = useState('');
  const saveAttempt = useRef<{ data: UniverseAgentDraft; expectedVersion: number | null; requestId: string; save: Props['onSave']; fields: string } | null>(null);
  const runAttempt = useRef<{ input: AssistanceInput; api: ModelAssistanceApi } | null>(null);
  const alive = useRef(true), invalidated = useRef(false), savePending = useRef(false), runPending = useRef(false), checkSerial = useRef(0);
  const callbacks = useRef({ onDirty, onSaved }); callbacks.current = { onDirty, onSaved };
  const panel = useRef<HTMLElement>(null);
  invalidated.current ||= project.id !== captured.project.id || project.sourceHash !== captured.project.sourceHash || entity.id !== captured.entityId
    || model.projectId !== captured.project.id || model.sourceHash !== captured.project.sourceHash || !model.entities.some(item => item.id === captured.entityId && item.type === 'character' && item.name === captured.entityName);
  const worldHead = captured.rehearsal ? model.drafts.find(row => row.id === captured.rehearsal?.id) : undefined;
  const pinnedParticipant = captured.rehearsal?.data.participants.find(item => item.entityId === captured.entityId);
  invalidated.current ||= Boolean(captured.rehearsal && (!pinnedParticipant || pinnedParticipant.profileRef.id !== captured.profile?.id
    || pinnedParticipant.profileRef.sha256 !== captured.profile?.sha256 || captured.rehearsal.data.sourceHash !== captured.project.sourceHash
    || worldHead && worldHead.version >= captured.rehearsal.version && worldHead.sha256 !== captured.rehearsal.sha256));
  const worldContext = captured.rehearsal && !invalidated.current ? characterRehearsalContext(captured.rehearsal.data, captured.entityId) : null;
  const stale = invalidated.current;
  const latest = profile(model, captured.entityId, captured.project.sourceHash);
  const competingProfile = Boolean(!captured.rehearsal && latest && (!saved || latest.version >= saved.version && latest.sha256 !== saved.sha256)
    && !(saveAttempt.current && canonicalJson(latest.data) === canonicalJson(saveAttempt.current.data)));
  const profileDirty = JSON.stringify(form) !== baseline;
  const unresolvedRun = Boolean(runAttempt.current);
  const dirty = profileDirty || Boolean(event.trim() && event !== retainedEvent) || saving || running || Boolean(saveAttempt.current) || unresolvedRun;
  const locked = stale || competingProfile || saving || Boolean(saveAttempt.current) || running || unresolvedRun;
  const availableModels = catalog?.status === 'AVAILABLE' ? catalog.models.filter(item => /(?:^|\/)qwen/i.test(item.name)) : [];
  const validProfile = form.name.trim().length > 0 && form.name.trim().length <= 240 && lines(form.goals).length > 0 && form.voice.length <= 1000
    && listFields.every(key => lines(form[key]).length <= 8 && lines(form[key]).every(item => item.length <= 400));
  const profileNeedsReview = Boolean(saved && saved.data.review !== 'PROPOSED');
  const selectedProfileRef = saved ? { id: saved.id, sha256: saved.sha256 } : null;
  const historyMatches = (row: AssistanceRecord) => row.data.projectId === captured.project.id && row.data.sourceHash === captured.project.sourceHash && row.data.input.characterAgentRef?.id === profileId && (captured.rehearsal ? row.data.input.rehearsalRef?.id === captured.rehearsal.id : !row.data.input.rehearsalRef);
  const canRun = !stale && !competingProfile && !profileDirty && !profileNeedsReview && Boolean(saved) && !saving && !saveAttempt.current && !running && !checking && !unresolvedRun && Boolean(event.trim()) && availableModels.some(item => item.name === chosenModel);

  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; callbacks.current.onDirty?.(false); }; }, []);
  useEffect(() => { panel.current?.scrollIntoView?.({ block: 'start' }); panel.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }); }, []);

  function accept(record: AssistanceRecord) {
    if (!alive.current || invalidated.current || !historyMatches(record)) return;
    setResult(record); setHistory(rows => [record, ...rows.filter(row => row.id !== record.id)]);
    callbacks.current.onSaved?.(record);
    if (record.data.status !== 'STARTED') { setRetainedEvent(record.data.input.instructions); runAttempt.current = null; }
    setNotice(record.data.status === 'COMPLETED' ? (captured.rehearsal ? 'Choice retained as a draft. Return to World rehearsal to preview an allowed action.' : 'Choice retained as a draft. Review any outcome before editing memories.') : `Rehearsal ${record.data.status.toLowerCase()}.`);
  }
  async function refresh() {
    if (invalidated.current) return;
    const serial = ++checkSerial.current; setChecking(true); setRunError('');
    try {
      const status = await api.status();
      if (!alive.current || invalidated.current || serial !== checkSerial.current) return;
      setCatalog(status); const qwen = status.models.filter(item => /(?:^|\/)qwen/i.test(item.name));
      setChosenModel(old => qwen.some(item => item.name === old) ? old : qwen.find(item => item.name === 'qwen3.5:9b')?.name ?? qwen[0]?.name ?? '');
      const rows = await api.history(captured.project);
      if (!alive.current || invalidated.current || serial !== checkSerial.current) return;
      setHistory(rows.filter(historyMatches));
      const retained = rows.find(row => row.data.requestId === runAttempt.current?.input.requestId && historyMatches(row));
      if (retained) accept(retained);
      else if (runAttempt.current) setNotice('No retained result found yet. Retry same rehearsal preserves its request identity.');
    } catch (error) { if (alive.current && !invalidated.current && serial === checkSerial.current) setRunError(message(error)); }
    finally { if (alive.current && serial === checkSerial.current) setChecking(false); }
  }
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveProfile() {
    if (captured.rehearsal || savePending.current || stale || competingProfile || unresolvedRun || !validProfile || !profileDirty && saved && !profileNeedsReview) return;
    if (!saveAttempt.current) {
      const data: UniverseAgentDraft = { schemaVersion: 1, sourceHash: captured.project.sourceHash, entityId: captured.entityId, name: form.name.trim(),
        goals: lines(form.goals), boundaries: lines(form.boundaries), observations: lines(form.observations), beliefs: lines(form.beliefs), memories: lines(form.memories), voice: form.voice,
        citations: structuredClone(saved?.data.citations ?? []), status: 'DRAFT', review: 'PROPOSED' };
      saveAttempt.current = { data: structuredClone(data), expectedVersion: saved?.version ?? null, requestId: crypto.randomUUID(), save: onSave, fields: JSON.stringify(form) };
    }
    const attempt = saveAttempt.current; savePending.current = true; setSaving(true); setSaveError('');
    try {
      const record = await attempt.save(attempt.data, attempt.expectedVersion, attempt.requestId);
      if (!alive.current || invalidated.current) return;
      if (record.id !== profileId || record.kind !== 'universe-agent' || record.version !== (attempt.expectedVersion ?? 0) + 1 || canonicalJson(record.data) !== canonicalJson(attempt.data)) throw new Error('The returned profile did not match this save. Retry to confirm the same revision.');
      setSaved(record as ProfileRecord); setBaseline(attempt.fields); saveAttempt.current = null;
      callbacks.current.onSaved?.(record); setNotice('Profile saved. It can now rehearse a choice from its own information.');
    } catch (error) { if (alive.current && !invalidated.current) setSaveError(message(error)); }
    finally { savePending.current = false; if (alive.current) setSaving(false); }
  }
  async function rehearse() {
    if (runPending.current || stale || competingProfile || (!runAttempt.current && !canRun)) return;
    if (!runAttempt.current && selectedProfileRef) {
      runAttempt.current = { api, input: { schemaVersion: 1, projectId: captured.project.id, sourceHash: captured.project.sourceHash, sceneId: null,
        requestId: crypto.randomUUID(), model: chosenModel, instructions: event, contextRefs: [], unsavedText: null, creativeRequestRef: null,
        characterAgentRef: selectedProfileRef, ...(captured.rehearsal ? { rehearsalRef: { id: captured.rehearsal.id, sha256: captured.rehearsal.sha256 } } : {}), maxOutputTokens: 1024 } };
    }
    const attempt = runAttempt.current; if (!attempt) return;
    runPending.current = true; setRunning(true); setRunError(''); setNotice(''); setResult(null);
    try {
      const record = await attempt.api.run(attempt.input, captured.project);
      if (record.data.requestId !== attempt.input.requestId || record.data.input.characterAgentRef?.sha256 !== attempt.input.characterAgentRef?.sha256) throw new Error('The returned rehearsal did not match this request. Check its retained result.');
      accept(record);
    } catch (error) { if (alive.current && !invalidated.current) setRunError(`${message(error)} The original request is retained for recovery.`); }
    finally { runPending.current = false; if (alive.current) setRunning(false); }
  }
  async function cancel() {
    const attempt = runAttempt.current; if (!attempt || canceling) return;
    setCanceling(true); setRunError('');
    try {
      const { projectId, sourceHash, requestId } = attempt.input; await attempt.api.cancel({ projectId, sourceHash, requestId });
      if (!alive.current) return;
      if (invalidated.current) { runAttempt.current = null; return; }
      setNotice('Cancellation requested. Check the retained result to confirm it stopped.'); await refresh();
    } catch (error) { if (alive.current && !invalidated.current) setRunError(message(error)); }
    finally { if (alive.current) setCanceling(false); }
  }

  return <section ref={panel} className="character-agent-panel" aria-label={`Character rehearsal: ${captured.name}`}>
    <header><div><span className="character-agent-eyebrow">STORY BIBLE · CHARACTER AGENCY</span><h3>{captured.name}</h3><p>Persistent profile · bounded local Qwen rehearsal</p></div>
      <button type="button" disabled={saving || running || canceling} onClick={onClose}>{unresolvedRun && !running ? 'Close · request status unknown' : dirty ? 'Discard changes / Close' : 'Close'}</button></header>
    <ol className="character-agent-flow" aria-label="Character rehearsal connections"><li>Own profile</li><li>Perceived event</li><li>Local Qwen</li><li>Choice draft</li><li>Reviewed outcome</li></ol>
    <p className="character-agent-scope">Each character uses its own saved goals, knowledge and memories. Choices stay in rehearsal; canon and the screenplay remain under your review. Shared outcomes are applied explicitly in World rehearsal.</p>
    {stale && <p role="alert">The project, character or rehearsal branch changed. Close and reopen from its current version.</p>}
    {!stale && competingProfile && <p role="alert">A newer character profile is available. Close and reopen it before making another change.</p>}
    {captured.rehearsal && <section className="character-agent-result" aria-label="Shared rehearsal perspective"><h4>{captured.rehearsal.data.title} · round {captured.rehearsal.data.rounds.length}</h4><p className="character-agent-caption">This branch uses a frozen character profile. Shared facts and other characters’ private events are excluded.</p>
      {worldContext && <><strong>Delivered observations</strong>{worldContext.perceivedEvents.length ? <ul>{worldContext.perceivedEvents.map((item: { roundId: string; text: string }, index: number) => <li key={`${item.roundId}:${index}`}>{item.text}</li>)}</ul> : <p>No outcomes have been delivered to this character.</p>}
      {worldContext.earlierPerceivedCount > 0 && <p>{worldContext.earlierPerceivedCount} earlier observations remain in the branch; the latest 24 enter this turn.</p>}
      <strong>Allowed actions</strong><ul>{worldContext.allowedActions.map((item: { id: string; label: string }) => <li key={item.id}>{item.label}</li>)}</ul></>}
    </section>}
    <form onSubmit={submit => { submit.preventDefault(); void saveProfile(); }} aria-label="Character agency profile">
      <fieldset disabled={locked || Boolean(captured.rehearsal)}><label>Profile name<input value={form.name} readOnly/></label>
        <div className="character-agent-fields">{listFields.map(key => <label key={key}>{labels[key]}<textarea aria-label={labels[key]} aria-describedby={`agent-${captured.entityId}-${key}`} rows={key === 'goals' ? 3 : 2} value={form[key]} onChange={change => setForm(old => ({ ...old, [key]: change.target.value }))}/><small id={`agent-${captured.entityId}-${key}`}>{hints[key]}</small></label>)}</div>
        <label>Voice and manner<textarea rows={2} maxLength={1000} value={form.voice} onChange={change => setForm(old => ({ ...old, voice: change.target.value }))}/></label>
      </fieldset>
      <div className="character-agent-save" hidden={Boolean(captured.rehearsal)}><small>One item per line, up to 8 per list · 400 characters per item. At least one goal is required.</small><button type="submit" className="primary" disabled={Boolean(captured.rehearsal) || saving || stale || competingProfile || unresolvedRun || !validProfile || !profileDirty && Boolean(saved) && !profileNeedsReview}>{saving ? 'Saving profile…' : saveAttempt.current ? 'Retry same profile save' : profileNeedsReview ? 'Save profile as proposed' : 'Save character profile'}</button></div>
      {saved && <p className="character-agent-caption">Saved profile v{saved.version} · {saved.sha256.slice(0, 12)}{profileDirty ? ' · Unsaved changes' : ''}</p>}
      {profileNeedsReview && <p className="character-agent-caption">This profile is {saved?.data.review.toLowerCase().replace('_', ' ')}. Review its contents, then save it as proposed before rehearsal.</p>}
      {saveError && <p role="alert">{saveError} Fields are locked until the same save is confirmed.</p>}
    </form>
    {saved && saved.data.citations.length > 0 && <details className="character-agent-sources"><summary>Profile source evidence ({saved.data.citations.length})</summary><p className="character-agent-caption">For the author’s review. These source excerpts are excluded from the character’s model input. Goals and voice may be draft interpretations.</p>{saved.data.citations.map((citation, index) => <article key={`${citation.paragraphId ?? citation.sourceId}:${index}`}><strong>{citation.label}</strong><blockquote>{citation.excerpt || 'Source identity retained; no excerpt.'}</blockquote><small>{citation.paragraphId ?? citation.sourceId}</small></article>)}</details>}
    <section className="character-agent-rehearsal" aria-label="Rehearse a choice"><div className="character-agent-section-heading"><h4>Rehearse a choice</h4><button type="button" disabled={checking || stale} onClick={() => void refresh()}>{checking ? 'Checking…' : 'Check models & results'}</button></div>
      <p className="character-agent-caption">Give only the event this character perceives. Other characters’ profiles and the full screenplay are excluded.</p>
      <fieldset disabled={locked}><label>Installed Qwen model<select value={chosenModel} onChange={change => setChosenModel(change.target.value)}><option value="">Choose a local model</option>{availableModels.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
        <label>Perceived event<textarea value={event} rows={3} maxLength={5000} onChange={change => setEvent(change.target.value)} placeholder="What does this character see or hear right now?"/></label></fieldset>
      {catalog && !availableModels.length && <p role="status">No available local Qwen model. Connect an installed model in Models & connections, then check again.</p>}
      {!saved || profileDirty ? <p className="character-agent-caption">Save the profile before rehearsal so every choice refers to an exact revision.</p> : null}
      <div className="character-agent-actions"><button type="button" className="primary" disabled={running || stale || competingProfile || (unresolvedRun ? checking : !canRun)} onClick={() => void rehearse()}>{running ? 'Rehearsing locally…' : unresolvedRun ? 'Retry same rehearsal' : 'Rehearse choice'}</button>
        {unresolvedRun && <button type="button" disabled={canceling} onClick={() => void cancel()}>{canceling ? 'Requesting stop…' : 'Cancel rehearsal'}</button>}</div>
      {runError && <p role="alert">{runError}</p>}{unresolvedRun && !running && <p className="character-agent-caption">Request {runAttempt.current?.input.requestId}. Closing does not confirm cancellation. Check retained character rehearsals when you return.</p>}{notice && <p role="status">{notice}</p>}
      {result && <article className="character-agent-result" aria-label="Character choice draft"><div className="character-agent-section-heading"><h4>Choice draft</h4><span>{result.data.status.toLowerCase()}</span></div>
        {captured.rehearsal && result.data.input.rehearsalRef?.sha256 !== captured.rehearsal.sha256 && <p className="character-agent-caption">Historical world revision. This choice cannot be applied to the current round.</p>}
        {result.data.input.characterAgentRef?.sha256 !== saved?.sha256 && <p className="character-agent-caption">Historical profile revision. This choice keeps its original context.</p>}
        <pre>{result.data.output?.text ?? result.data.error?.message ?? 'Request retained; check the result to follow its progress.'}</pre>
        <details><summary>Rehearsal context</summary><p>{result.data.input.instructions}</p><p>{result.data.provider.model} · {result.data.startedAt}</p><code>{result.data.input.characterAgentRef?.sha256}</code></details>
        <p className="character-agent-caption">The model may invent details; compare its choice with the profile. {captured.rehearsal ? 'Return to World rehearsal to map this proposal to an allowed action and preview its outcome.' : 'Review the outcome, then edit Reviewed memories explicitly.'} This draft has changed no character memory.</p>
      </article>}
      <details className="character-agent-history"><summary>Previous character rehearsals ({history.length})</summary><p className="character-agent-caption">Matching results from the latest 200 project requests.</p>{history.map(row => <button type="button" key={row.id} disabled={running || stale} onClick={() => setResult(row)}>{row.data.input.instructions.slice(0, 100)}<small>{row.data.status.toLowerCase()} · {row.data.input.characterAgentRef?.sha256 === saved?.sha256 ? 'Current profile' : 'Historical profile revision'}</small></button>)}</details>
    </section>
  </section>;
}
