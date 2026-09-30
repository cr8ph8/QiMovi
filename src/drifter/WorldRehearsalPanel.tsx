import { useEffect, useRef, useState } from 'react';
import { characterRehearsalContext, rehearsalState, resolveRehearsalRound, validateWorldRehearsal } from '../../local/contracts/world-rehearsal.mjs';
import { canonicalJson } from './canonical';
import type { AssistanceRecord } from './modelAssistanceApi';
import type { Project, WorkspaceRecord } from './types';
import type { UniverseAgentDraft, UniverseCatalog } from './universeApi';
import type { RehearsalCondition, RehearsalIntent, RehearsalRound, RehearsalRule, WorldRehearsalDraft, WorldRehearsalRecord } from './worldRehearsal';
import './world-rehearsal.css';

type Props = {
  project: Project; model: UniverseCatalog; records?: WorkspaceRecord[];
  onSave: (id: string, data: WorldRehearsalDraft, expectedVersion: number | null, requestId: string) => Promise<WorkspaceRecord>;
  onRehearse: (record: WorldRehearsalRecord, entityId: string) => void;
  onSetupCharacter?: (entityId: string) => void;
  onClose: () => void; onDirty?: (dirty: boolean) => void;
};
type Profile = WorkspaceRecord & { data: UniverseAgentDraft };
const clone = <T,>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;
const displayError = (error: unknown) => error instanceof Error ? error.message : 'The local save could not be confirmed.';
function empty(sourceHash: string): WorldRehearsalDraft {
  return { schemaVersion: 1, sourceHash, citations: [], status: 'DRAFT', review: 'PROPOSED', title: '', sceneId: null, participants: [], initialFacts: [], rules: [], rounds: [] };
}
function branches(model: UniverseCatalog, sourceHash: string): WorldRehearsalRecord[] {
  return model.drafts.filter((record): record is WorldRehearsalRecord => record.kind === 'universe-rehearsal' && record.data.sourceHash === sourceHash);
}
function profiles(model: UniverseCatalog, sourceHash: string): Profile[] {
  const latest = new Map<string, Profile>();
  for (const row of model.drafts) {
    if (row.kind !== 'universe-agent' || row.data.sourceHash !== sourceHash || !('entityId' in row.data)) continue;
    const profile = row as Profile;
    if (!latest.has(profile.data.entityId) || latest.get(profile.data.entityId)!.version < profile.version) latest.set(profile.data.entityId, profile);
  }
  return [...latest.values()].filter(row => row.data.review === 'PROPOSED' && model.entities.some(entity => entity.id === row.data.entityId && entity.type === 'character'));
}
const outcomeReason = (reason: string) => ({ ACTOR_NOT_ALLOWED: 'This character cannot use that action.', PRECONDITION_NOT_MET: 'A required fact was not satisfied.', CONFLICTING_EARLIER_ACTION: 'An earlier action in this round changed the same fact differently.' }[reason] ?? reason);

export default function WorldRehearsalPanel({ project, model, records = [], onSave, onRehearse, onSetupCharacter, onClose, onDirty }: Props) {
  const [captured] = useState(() => clone(project));
  const [saved, setSaved] = useState<WorldRehearsalRecord | null>(() => clone(branches(model, project.sourceHash)[0] ?? null));
  const [form, setForm] = useState<WorldRehearsalDraft>(() => clone(saved?.data ?? empty(project.sourceHash)));
  const [newId, setNewId] = useState(() => uid('universe-rehearsal'));
  const [actorId, setActorId] = useState(() => saved?.data.participants[0]?.entityId ?? '');
  const [profileTarget, setProfileTarget] = useState('');
  const [ruleId, setRuleId] = useState(''), [proposalId, setProposalId] = useState('');
  const [queue, setQueue] = useState<RehearsalIntent[]>([]), [preview, setPreview] = useState<RehearsalRound | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const attempt = useRef<{ id: string; data: WorldRehearsalDraft; expectedVersion: number | null; requestId: string; save: Props['onSave'] } | null>(null);
  const alive = useRef(true), invalidated = useRef(false), pending = useRef(false), panel = useRef<HTMLElement>(null);
  const dirtyCallback = useRef(onDirty); dirtyCallback.current = onDirty;
  invalidated.current ||= project.id !== captured.id || project.sourceHash !== captured.sourceHash || model.projectId !== captured.id || model.sourceHash !== captured.sourceHash;
  const stale = invalidated.current;
  const availableProfiles = profiles(model, captured.sourceHash);
  const changedSetupProfiles = !saved ? form.participants.filter(party => { const current = availableProfiles.find(profile => profile.data.entityId === party.entityId); return current && current.sha256 !== party.profileRef.sha256; }) : [];
  const unavailableSetupProfiles = !saved ? form.participants.filter(party => !availableProfiles.some(profile => profile.data.entityId === party.entityId)) : [];
  const missingSavedTargets = Boolean(saved && saved.data.participants.some(party => !model.entities.some(entity => entity.id === party.entityId && entity.type === 'character')));
  const invalidSetupRefs = changedSetupProfiles.length > 0 || unavailableSetupProfiles.length > 0;
  const choices = branches(model, captured.sourceHash);
  const characterGroups = [
    { label: 'Retained character records', values: model.entities.filter(entity => entity.type === 'character' && entity.citations.some(citation => citation.kind === 'SOURCE_CHARACTER')) },
    { label: 'Authored character drafts', values: model.entities.filter(entity => entity.type === 'character' && entity.origin === 'DRAFT' && !entity.citations.some(citation => citation.kind === 'SOURCE_CHARACTER')) },
    { label: 'Parsed candidates · verify identity', values: model.entities.filter(entity => entity.type === 'character' && entity.origin !== 'DRAFT' && !entity.citations.some(citation => citation.kind === 'SOURCE_CHARACTER')) },
  ];
  const latest = choices.find(record => record.id === saved?.id);
  const competing = Boolean(saved && latest && latest.version >= saved.version && latest.sha256 !== saved.sha256
    && !(attempt.current && canonicalJson(latest.data) === canonicalJson(attempt.current.data)));
  const uncertain = Boolean(attempt.current);
  const locked = stale || competing || missingSavedTargets || saving || uncertain;
  const data = saved?.data ?? form;
  const dirty = (!saved && canonicalJson(form) !== canonicalJson(empty(captured.sourceHash))) || queue.length > 0 || uncertain || saving;
  const name = (entityId: string) => model.entities.find(entity => entity.id === entityId)?.name ?? entityId;
  const actions = data.rules.filter(rule => rule.actorIds.includes(actorId));
  const selectedProfile = data.participants.find(party => party.entityId === actorId)?.profileRef;
  const usedProposals = new Set([...data.rounds.flatMap(round => round.intents), ...queue].flatMap(intent => intent.proposalRef ? [intent.proposalRef.id] : []));
  const matchingProposals = saved ? records.filter((row): row is AssistanceRecord => {
    if (row.kind !== 'model-assistance') return false;
    const value = row.data as AssistanceRecord['data'];
    return value.projectId === captured.id && value.sourceHash === captured.sourceHash && value.status === 'COMPLETED' && Boolean(value.output)
      && value.input?.characterAgentRef?.id === selectedProfile?.id && value.input?.characterAgentRef?.sha256 === selectedProfile?.sha256
      && value.input?.rehearsalRef?.id === saved.id && value.input?.rehearsalRef?.sha256 === saved.sha256 && !usedProposals.has(row.id);
  }) : [];
  let validSetup = false;
  try { validateWorldRehearsal(form, captured); validSetup = true; } catch { /* Incomplete setup stays editable. */ }
  const currentFacts = saved ? rehearsalState(saved.data) as WorldRehearsalDraft['initialFacts'] : [];
  const perspective = saved && actorId && data.participants.some(party => party.entityId === actorId) ? characterRehearsalContext(data, actorId) as { allowedActions: { id: string; label: string }[]; perceivedEvents: { roundId: string; text: string }[]; earlierPerceivedCount: number } : null;

  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; dirtyCallback.current?.(false); }; }, []);
  useEffect(() => { panel.current?.scrollIntoView?.({ block: 'start' }); panel.current?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true }); }, []);

  function switchBranch(id: string) {
    if (locked || dirty) return;
    const branch = choices.find(item => item.id === id) ?? null;
    setSaved(clone(branch)); setForm(clone(branch?.data ?? empty(captured.sourceHash))); setNewId(uid('universe-rehearsal'));
    setActorId(branch?.data.participants[0]?.entityId ?? ''); setRuleId(''); setProposalId(''); setQueue([]); setPreview(null); setError(''); setNotice('');
  }
  function updateRule(id: string, patch: Partial<RehearsalRule>) {
    setForm(old => ({ ...old, rules: old.rules.map(rule => rule.id === id ? { ...rule, ...patch } : rule) }));
  }
  function setConditions(rule: RehearsalRule, field: 'preconditions' | 'effects', values: RehearsalCondition[]) { updateRule(rule.id, { [field]: values }); }
  function conditions(rule: RehearsalRule, field: 'preconditions' | 'effects', heading: string) {
    return <div className="world-rehearsal-conditions"><h5>{heading}</h5>{rule[field].map((condition, index) => <div className="world-rehearsal-fact-row" key={`${field}-${index}`}>
      <label>Fact<select aria-label={`${heading} fact ${index + 1} for ${rule.label || 'untitled action'}`} value={condition.factId} onChange={event => setConditions(rule, field, rule[field].map((value, at) => at === index ? { ...value, factId: event.target.value } : value))}>{form.initialFacts.map(fact => <option key={fact.id} value={fact.id} disabled={rule[field].some((value, at) => at !== index && value.factId === fact.id)}>{fact.label || 'Untitled fact'}</option>)}</select></label>
      <label>Value<select aria-label={`${heading} value ${index + 1} for ${rule.label || 'untitled action'}`} value={String(condition.value)} onChange={event => setConditions(rule, field, rule[field].map((value, at) => at === index ? { ...value, value: event.target.value === 'true' } : value))}><option value="true">True</option><option value="false">False</option></select></label>
      <button type="button" aria-label={`Remove ${heading.toLowerCase()} ${index + 1} for ${rule.label || 'untitled action'}`} onClick={() => setConditions(rule, field, rule[field].filter((_, at) => at !== index))}>Remove</button>
    </div>)}<button type="button" disabled={!form.initialFacts.some(fact => !rule[field].some(value => value.factId === fact.id))} onClick={() => { const fact = form.initialFacts.find(item => !rule[field].some(value => value.factId === item.id)); if (fact) setConditions(rule, field, [...rule[field], { factId: fact.id, value: true }]); }}>Add {field === 'preconditions' ? 'condition' : 'effect'}</button></div>;
  }
  function enqueue() {
    if (locked || !saved || !actorId || !actions.some(rule => rule.id === ruleId) || queue.some(intent => intent.actorId === actorId) || data.rounds.length >= 16) return;
    const proposal = matchingProposals.find(row => row.id === proposalId);
    if (proposalId && !proposal) return;
    setQueue(old => [...old, { id: uid('intent'), actorId, ruleId, proposalRef: proposal ? { id: proposal.id, sha256: proposal.sha256 } : null }]); setPreview(null); setProposalId(''); setError('');
  }
  function previewRound() {
    if (locked || !saved || !queue.length) return;
    try { setPreview(resolveRehearsalRound(saved.data, clone(queue), uid('round')) as RehearsalRound); setError(''); }
    catch (reason) { setError(displayError(reason)); }
  }
  async function save(next?: WorldRehearsalDraft) {
    if (pending.current || stale || competing || !attempt.current && (missingSavedTargets || !saved && invalidSetupRefs || !next)) return;
    if (!attempt.current && next) {
      try { validateWorldRehearsal(next, captured); } catch (reason) { setError(displayError(reason)); return; }
      attempt.current = { id: saved?.id ?? newId, data: clone(next), expectedVersion: saved?.version ?? null, requestId: crypto.randomUUID(), save: onSave };
    }
    const exact = attempt.current!; pending.current = true; setSaving(true); setError('');
    try {
      const result = await exact.save(exact.id, clone(exact.data), exact.expectedVersion, exact.requestId);
      if (!alive.current || invalidated.current) return;
      if (result.kind !== 'universe-rehearsal' || result.id !== exact.id || result.version !== (exact.expectedVersion ?? 0) + 1 || canonicalJson(result.data) !== canonicalJson(exact.data)) throw new Error('The returned branch did not match this save. Retry to confirm the same revision.');
      setSaved(clone(result as WorldRehearsalRecord)); setForm(clone(exact.data)); setActorId(old => exact.data.participants.some(party => party.entityId === old) ? old : exact.data.participants[0].entityId);
      setQueue([]); setPreview(null); setProposalId(''); attempt.current = null;
      setNotice(exact.expectedVersion === null ? 'Rehearsal saved. Choose character actions to preview their consequences.' : 'Round retained. Only its actor and selected witnesses receive an observation.');
    } catch (reason) { if (alive.current && !invalidated.current) setError(displayError(reason)); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  }
  function outcomes(round: RehearsalRound) {
    return <ol className="world-rehearsal-outcomes">{round.outcomes.map(outcome => <li key={outcome.intentId}>
      <strong>{name(outcome.actorId)} · {data.rules.find(rule => rule.id === outcome.ruleId)?.label}</strong><span className={`world-rehearsal-result ${outcome.status.toLowerCase()}`}>{outcome.status === 'APPLIED' ? 'Applies' : 'Blocked'}</span>
      {outcome.reasons.map(reason => <p key={reason}>{outcomeReason(reason)}</p>)}
      {outcome.changes.length > 0 && <ul>{outcome.changes.map(change => <li key={change.factId}>{data.initialFacts.find(fact => fact.id === change.factId)?.label}: {String(change.before)} → {String(change.after)}</li>)}</ul>}
      <p>Observed by: {outcome.deliveries.map(delivery => name(delivery.entityId)).join(', ') || 'Nobody'}</p>
    </li>)}</ol>;
  }

  return <section ref={panel} className="world-rehearsal-panel" aria-label="Shared world rehearsal">
    <header><div><span className="world-rehearsal-eyebrow">STORY BIBLE · SHARED WORLD</span><h3>Rehearse choices together</h3><p>Character intentions → authored rules → consequences → character observations</p></div><button type="button" disabled={saving} onClick={onClose}>{uncertain ? 'Close · save status unknown' : dirty ? 'Discard unsaved work / Close' : 'Close'}</button></header>
    <p className="world-rehearsal-scope">Explore a fictional branch with rules you define. Rehearsal history stays separate from screenplay and accepted canon. Model suggestions remain choices for your review.</p>
    <label>Rehearsal branch<select value={saved?.id ?? ''} disabled={locked || dirty} onChange={event => switchBranch(event.target.value)}><option value="">New rehearsal</option>{!choices.some(row => row.id === saved?.id) && saved && <option value={saved.id}>{saved.data.title}</option>}{choices.map(row => <option key={row.id} value={row.id}>{row.data.title} · {row.data.rounds.length} rounds</option>)}</select></label>
    {stale && <p role="alert">The project or source changed. Close and reopen the shared world from the current Story Bible.</p>}
    {!stale && competing && <p role="alert">A newer rehearsal revision is available. Close and reopen before continuing.</p>}
    {missingSavedTargets && <p role="alert">A participant is no longer in the current universe. This retained history is available to read; reopen after resolving its source identity before rehearsing further.</p>}
    {error && <p role="alert">{error}{uncertain ? ' Inputs are locked until this same save is confirmed. Closing does not undo a save that may have completed.' : ''}</p>}
    {notice && <p role="status">{notice}</p>}
    {uncertain && <button type="button" className="primary" disabled={saving || stale || competing} onClick={() => void save()}>{saving ? 'Confirming save…' : 'Retry same rehearsal save'}</button>}
    {!saved ? <form aria-label="World rehearsal setup" onSubmit={event => { event.preventDefault(); void save(form); }}>
      <fieldset disabled={locked}>
        <div className="world-rehearsal-columns"><label>Rehearsal title<input value={form.title} maxLength={240} onChange={event => setForm(old => ({ ...old, title: event.target.value }))}/></label><label>Scene reference<select value={form.sceneId ?? ''} onChange={event => setForm(old => ({ ...old, sceneId: event.target.value || null }))}><option value="">Unlinked exploration</option>{captured.scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.index}. {scene.heading}</option>)}</select></label></div>
        <div><h4>1. Choose characters</h4><p className="world-rehearsal-caption">Use 1–8 saved, proposed agency profiles. Each participant keeps this exact profile revision.</p><div className="world-rehearsal-checks">{availableProfiles.map(profile => { const selected = form.participants.some(party => party.entityId === profile.data.entityId); return <label key={profile.id}><input type="checkbox" checked={selected} disabled={!selected && form.participants.length >= 8} onChange={() => setForm(old => ({ ...old, participants: selected ? old.participants.filter(party => party.entityId !== profile.data.entityId) : [...old.participants, { entityId: profile.data.entityId, profileRef: { id: profile.id, sha256: profile.sha256 } }] }))}/>{name(profile.data.entityId)} <small>v{profile.version}</small></label>; })}</div>{!availableProfiles.length && <p className="world-rehearsal-caption">Create and save a character agency profile in Story Bible first.</p>}
          {changedSetupProfiles.length > 0 && <div><p role="alert">A selected character profile changed. Review its new revision before saving this setup.</p><button type="button" onClick={() => setForm(old => ({ ...old, participants: old.participants.map(party => { const current = availableProfiles.find(profile => profile.data.entityId === party.entityId); return current ? { ...party, profileRef: { id: current.id, sha256: current.sha256 } } : party; }) }))}>Use current selected profile revisions</button></div>}
          {unavailableSetupProfiles.map(party => <div key={party.entityId}><p role="alert">{name(party.entityId)} no longer has an available proposed profile in this universe.</p><button type="button" onClick={() => setForm(old => ({ ...old, participants: old.participants.filter(value => value.entityId !== party.entityId) }))}>Remove unavailable participant {name(party.entityId)}</button></div>)}
          {form.rules.some(rule => [...rule.actorIds, ...rule.witnessIds].some(entityId => !form.participants.some(party => party.entityId === entityId))) && <p role="alert">An action still names a removed participant. Reselect that character or remove the affected action before saving.</p>}
          {onSetupCharacter && <div className="world-rehearsal-profile-setup"><label>Set up a character<select value={profileTarget} onChange={event => setProfileTarget(event.target.value)}><option value="">Choose a universe character</option>{characterGroups.filter(group => group.values.length > 0).map(group => <optgroup label={group.label} key={group.label}>{group.values.map(entity => <option key={entity.id} value={entity.id}>{entity.name}{group.label.startsWith('Parsed') ? ` · ${entity.id.slice(-8)}` : ''}</option>)}</optgroup>)}</select></label><button type="button" disabled={!model.entities.some(entity => entity.id === profileTarget && entity.type === 'character')} onClick={() => { if (!locked && model.entities.some(entity => entity.id === profileTarget && entity.type === 'character')) onSetupCharacter(profileTarget); }}>Open character profile</button><p className="world-rehearsal-caption">Your unfinished setup stays here while you prepare the character’s own goals and knowledge. Parsed candidates can include duplicate cues and extraction errors; verify their source identity.</p></div>}
        </div>
        <div><h4>2. Set starting facts</h4><p className="world-rehearsal-caption">State a specific fact and whether it starts true or false. These are author-defined rehearsal conditions.</p>{form.initialFacts.map((fact, index) => <div key={fact.id} className="world-rehearsal-fact-row"><label>Fact {index + 1}<input aria-label={`Starting fact ${index + 1}`} value={fact.label} maxLength={240} onChange={event => setForm(old => ({ ...old, initialFacts: old.initialFacts.map(value => value.id === fact.id ? { ...value, label: event.target.value } : value) }))}/></label><label>Starts<select aria-label={`Starting value ${index + 1}`} value={String(fact.value)} onChange={event => setForm(old => ({ ...old, initialFacts: old.initialFacts.map(value => value.id === fact.id ? { ...value, value: event.target.value === 'true' } : value) }))}><option value="true">True</option><option value="false">False</option></select></label><button type="button" aria-label={`Remove starting fact ${index + 1}`} disabled={form.rules.some(rule => [...rule.preconditions, ...rule.effects].some(condition => condition.factId === fact.id))} onClick={() => setForm(old => ({ ...old, initialFacts: old.initialFacts.filter(value => value.id !== fact.id) }))}>Remove</button></div>)}<button type="button" disabled={form.initialFacts.length >= 32} onClick={() => setForm(old => ({ ...old, initialFacts: [...old.initialFacts, { id: uid('fact'), label: '', value: false }] }))}>Add starting fact</button></div>
        <div><h4>3. Define possible actions</h4><p className="world-rehearsal-caption">Choose who can act, what must be true, and which facts change. The actor always receives the observation; choose additional witnesses explicitly.</p>{form.rules.map((rule, index) => <section key={rule.id} className="world-rehearsal-rule" aria-label={`Action rule ${index + 1}`}>
          <div className="world-rehearsal-heading"><label>Action {index + 1}<input aria-label={`Action name ${index + 1}`} value={rule.label} maxLength={240} onChange={event => updateRule(rule.id, { label: event.target.value })}/></label><button type="button" aria-label={`Remove action ${index + 1}`} onClick={() => setForm(old => ({ ...old, rules: old.rules.filter(value => value.id !== rule.id) }))}>Remove action</button></div>
          <div className="world-rehearsal-columns">{(['actorIds', 'witnessIds'] as const).map(field => <div key={field}><h5>{field === 'actorIds' ? 'May take this action' : 'Additional witnesses'}</h5><div className="world-rehearsal-checks">{form.participants.map(party => <label key={party.entityId}><input type="checkbox" aria-label={`${field === 'actorIds' ? 'Actor' : 'Witness'} ${name(party.entityId)} for action ${index + 1}`} checked={rule[field].includes(party.entityId)} onChange={() => updateRule(rule.id, { [field]: rule[field].includes(party.entityId) ? rule[field].filter(id => id !== party.entityId) : [...rule[field], party.entityId] })}/>{name(party.entityId)}</label>)}</div></div>)}</div>
          <div className="world-rehearsal-columns">{conditions(rule, 'preconditions', 'Required conditions')}{conditions(rule, 'effects', 'Effects')}</div>
          <label>Observation when applied<textarea aria-label={`Observation for action ${index + 1}`} rows={2} maxLength={400} value={rule.observation} onChange={event => updateRule(rule.id, { observation: event.target.value })}/></label>
        </section>)}<button type="button" disabled={form.rules.length >= 32 || !form.participants.length} onClick={() => setForm(old => ({ ...old, rules: [...old.rules, { id: uid('rule'), label: '', actorIds: [], preconditions: [], effects: [], witnessIds: [], observation: '' }] }))}>Add action rule</button></div>
      </fieldset>
      <p className="world-rehearsal-caption">Saving fixes the setup for reproducible rounds. Start another rehearsal to explore different rules or profiles.</p><button className="primary" type="submit" disabled={locked || !validSetup || invalidSetupRefs}>{saving ? 'Saving rehearsal…' : 'Save rehearsal setup'}</button>
    </form> : <>
      <div className="world-rehearsal-heading"><div><h4>{data.title}</h4><p className="world-rehearsal-caption">Draft branch · version {saved.version} · {data.rounds.length}/16 rounds{data.sceneId ? ` · ${captured.scenes.find(scene => scene.id === data.sceneId)?.heading ?? data.sceneId}` : ''}</p></div></div>
      <details><summary>Fixed setup · {data.participants.length} characters · {data.rules.length} action rules</summary><ul>{data.participants.map(party => <li key={party.entityId}>{name(party.entityId)} · profile {party.profileRef.sha256.slice(0, 12)}</li>)}</ul>{data.rules.map(rule => <div className="world-rehearsal-rule-summary" key={rule.id}><strong>{rule.label}</strong><p>Actors: {rule.actorIds.map(name).join(', ')} · Other witnesses: {rule.witnessIds.map(name).join(', ') || 'None'}</p><p>Requires: {rule.preconditions.map(condition => `${data.initialFacts.find(fact => fact.id === condition.factId)?.label} = ${condition.value}`).join('; ') || 'No condition'}</p><p>Changes: {rule.effects.map(effect => `${data.initialFacts.find(fact => fact.id === effect.factId)?.label} = ${effect.value}`).join('; ') || 'Observation only'}</p><p>Observation: {rule.observation}</p></div>)}</details>
      <div className="world-rehearsal-columns"><section aria-label="Author view of current facts"><h4>Current facts · author view</h4><dl className="world-rehearsal-facts">{currentFacts.map(fact => <div key={fact.id}><dt>{fact.label}</dt><dd>{fact.value ? 'True' : 'False'}</dd></div>)}</dl><p className="world-rehearsal-caption">The complete state helps you direct. It is excluded from a character’s model context.</p></section>
        <section className="world-rehearsal-perspective" aria-label="Selected character perspective"><label>Character perspective<select value={actorId} disabled={locked} onChange={event => { setActorId(event.target.value); setRuleId(''); setProposalId(''); }}>{data.participants.map(party => <option key={party.entityId} value={party.entityId}>{name(party.entityId)}</option>)}</select></label><h4>What {name(actorId)} has perceived here</h4>{perspective?.perceivedEvents.length ? <ol>{perspective.perceivedEvents.map((event, index) => <li key={`${event.roundId}:${index}`}>{event.text}</li>)}</ol> : <p>No observations delivered in this branch yet.</p>}{Boolean(perspective?.earlierPerceivedCount) && <p className="world-rehearsal-caption">Latest 24 observations shown; {perspective!.earlierPerceivedCount} earlier observations remain in the retained history.</p>}<p className="world-rehearsal-caption">Their frozen agency profile supplies prior knowledge. Other characters’ observations are excluded.</p><button type="button" disabled={locked || queue.length > 0 || !selectedProfile} onClick={() => onRehearse(clone(saved), actorId)}>Rehearse as {name(actorId)}</button></section></div>
      <section className="world-rehearsal-round" aria-label="Next rehearsal round"><h4>Next round · choose intentions</h4><p className="world-rehearsal-caption">One action per character. Order matters: earlier actions change the conditions that later actions encounter. Conflicting writes are blocked. Review the order before applying.</p>
        <fieldset disabled={locked || data.rounds.length >= 16}><label>Action for {name(actorId)}<select value={ruleId} onChange={event => setRuleId(event.target.value)}><option value="">Choose an available action</option>{actions.map(rule => <option key={rule.id} value={rule.id}>{rule.label}</option>)}</select></label>
          <label>Attach a character choice draft<select value={proposalId} onChange={event => setProposalId(event.target.value)}><option value="">Manual choice · no model attachment</option>{matchingProposals.map(row => <option key={row.id} value={row.id}>{row.data.output!.text.slice(0, 90)} · {row.data.finishedAt}</option>)}</select></label>{proposalId && matchingProposals.some(row => row.id === proposalId) && <pre className="world-rehearsal-choice" aria-label="Selected choice draft">{matchingProposals.find(row => row.id === proposalId)!.data.output!.text}</pre>}<p className="world-rehearsal-caption">Only completed choices from this exact branch and character profile are listed. You select an action; model text never determines the outcome.</p><button type="button" disabled={!actions.some(rule => rule.id === ruleId) || queue.some(intent => intent.actorId === actorId)} onClick={enqueue}>Queue action</button>
          <ol className="world-rehearsal-queue" aria-label="Ordered character intentions">{queue.map((intent, index) => <li key={intent.id}><div><strong>{name(intent.actorId)}</strong> · {data.rules.find(rule => rule.id === intent.ruleId)?.label}<small>{intent.proposalRef ? 'Attached character choice draft' : 'Manual choice'}</small></div><div className="world-rehearsal-buttons"><button type="button" aria-label={`Move ${name(intent.actorId)} earlier`} disabled={index === 0} onClick={() => { setQueue(old => { const next = [...old]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }); setPreview(null); }}>↑</button><button type="button" aria-label={`Move ${name(intent.actorId)} later`} disabled={index === queue.length - 1} onClick={() => { setQueue(old => { const next = [...old]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; }); setPreview(null); }}>↓</button><button type="button" aria-label={`Remove ${name(intent.actorId)} intention`} onClick={() => { setQueue(old => old.filter(row => row.id !== intent.id)); setPreview(null); }}>Remove</button></div></li>)}</ol><button type="button" disabled={!queue.length} onClick={previewRound}>Preview consequences</button>
        </fieldset>
        {data.rounds.length >= 16 && <p className="world-rehearsal-caption">This rehearsal reached its 16-round limit. Start a new branch for further exploration.</p>}
        {preview && <section className="world-rehearsal-preview" aria-label="Round preview"><h4>Round {preview.basisRound + 1} preview · author view</h4>{outcomes(preview)}<p className="world-rehearsal-caption">Preview has changed no saved state. Apply retains this exact round and its individual observations.</p><button type="button" className="primary" disabled={locked} onClick={() => void save({ ...clone(saved.data), rounds: [...clone(saved.data.rounds), clone(preview)] })}>Apply round to rehearsal</button></section>}
      </section>
      <details><summary>Retained round history ({data.rounds.length}) · author view</summary>{data.rounds.map((round, index) => <section key={round.id}><h4>Round {index + 1}</h4>{outcomes(round)}<details><summary>Delivered observations</summary><ul>{round.outcomes.flatMap(outcome => outcome.deliveries.map(delivery => <li key={`${outcome.intentId}:${delivery.entityId}`}>{name(delivery.entityId)}: {delivery.text}</li>))}</ul></details></section>)}</details>
    </>}
  </section>;
}
