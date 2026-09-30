import { useEffect, useId, useRef, useState } from 'react';
import { UNIVERSE_PROFILE_LIMITS, UNIVERSE_PROFILE_SECTIONS, profileFieldsForType } from '../../local/contracts/universe-profile.mjs';
import { UNIVERSE_LIMITS, validateUniverseRecord } from '../../local/contracts/universe.mjs';
import { canonicalJson, hashCanonical } from './canonical';
import { universeTypeLabel } from './universeLibraryModel';
import type { WorkspaceProject, WorkspaceRecord } from './types';
import { universeDraftScope, universeRecordInProject } from './universeApi';
import type { UniverseCatalog, UniverseCitation, UniverseEntity, UniverseProfileDraft } from './universeApi';
import './universe-profile-editor.css';

export type UniverseProfileEditorProps = {
  project: WorkspaceProject; model: UniverseCatalog; entity: UniverseEntity;
  onSave(data: UniverseProfileDraft, expectedVersion: number | null, requestId: string): Promise<WorkspaceRecord>;
  onDirty?(dirty: boolean): void; onClose(): void;
};
type ProfileRecord = WorkspaceRecord & { data: UniverseProfileDraft };
type Form = Pick<UniverseProfileDraft, 'fields' | 'citations' | 'review'>;
type SaveAttempt = { data: UniverseProfileDraft; expectedVersion: number | null; requestId: string; fingerprint: string; save: UniverseProfileEditorProps['onSave'] };
const clone = <T,>(value: T): T => JSON.parse(canonicalJson(value));
function latestProfile(model: UniverseCatalog, entity: UniverseEntity): ProfileRecord | null {
  return model.drafts.filter((record): record is typeof record & ProfileRecord => record.kind === 'universe-profile'
    && record.id === `universe-profile:${entity.id}` && 'entityId' in record.data && record.data.entityId === entity.id
    && 'entityType' in record.data && record.data.entityType === entity.type && universeRecordInProject(record.data, model))
    .sort((a, b) => b.version - a.version)[0] ?? null;
}
const fieldsOf = (record: ProfileRecord | null): Form => clone(record ? { fields: record.data.fields, citations: record.data.citations, review: record.data.review } : { fields: {}, citations: [], review: 'PROPOSED' });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'This profile save was not confirmed.';

/** One structured author profile on an existing universe identity. Frozen edits
 * and retry identities prevent a catalog refresh from silently replacing work. */
export default function UniverseProfileEditor({ project, model, entity, onSave, onDirty, onClose }: UniverseProfileEditorProps) {
  const [captured] = useState(() => ({ project: clone(project), entity: clone(entity), record: clone(latestProfile(model, entity)) }));
  const [saved, setSaved] = useState<ProfileRecord | null>(captured.record);
  const [form, setForm] = useState<Form>(() => fieldsOf(captured.record));
  const [activeFieldId, setActiveFieldId] = useState(() => {
    const available = profileFieldsForType(captured.entity.type);
    return (available.find(field => !captured.record?.data.fields[field.id]?.trim()) ?? available[0])?.id ?? '';
  });
  const [referenceKey, setReferenceKey] = useState(captured.entity.summary ? 'summary' : 'citation:0');
  const [baseline, setBaseline] = useState(() => canonicalJson(fieldsOf(captured.record)));
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const attempt = useRef<SaveAttempt | null>(null), pending = useRef(false), alive = useRef(true), invalidated = useRef(false), competingRef = useRef(false);
  const onDirtyRef = useRef(onDirty); onDirtyRef.current = onDirty;
  const prefix = useId(), panel = useRef<HTMLElement>(null), fieldInputs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const sections = UNIVERSE_PROFILE_SECTIONS.filter(section => section.types.includes(captured.entity.type));
  const fields = profileFieldsForType(captured.entity.type);
  const currentEntity = model.entities.find(item => item.id === captured.entity.id);
  invalidated.current ||= project.id !== captured.project.id || project.sourceHash !== captured.project.sourceHash
    || model.projectId !== captured.project.id || model.sourceHash !== captured.project.sourceHash
    || canonicalJson(entity) !== canonicalJson(captured.entity) || !currentEntity || canonicalJson(currentEntity) !== canonicalJson(captured.entity);
  const latest = latestProfile(model, captured.entity);
  const matchingAttempt = Boolean(attempt.current && latest && latest.version === (attempt.current.expectedVersion ?? 0) + 1
    && canonicalJson(latest.data) === canonicalJson(attempt.current.data));
  const competing = !matchingAttempt && Boolean(latest ? !saved || latest.version >= saved.version && latest.sha256 !== saved.sha256 : captured.record);
  competingRef.current = competing;
  const stale = invalidated.current;
  const fingerprint = canonicalJson(form), changed = fingerprint !== baseline;
  const dirty = changed || saving || Boolean(attempt.current);
  const locked = stale || competing || saving || Boolean(attempt.current);
  const filled = fields.filter(field => form.fields[field.id]?.trim()).length;
  const textLength = Object.values(form.fields).reduce((total, value) => total + value.length, 0);
  const citationOptions = [...new Map([...captured.entity.citations, ...(captured.record?.data.citations ?? [])].map(citation => [canonicalJson(citation), citation])).entries()];
  const selectedCitations = new Set(form.citations.map(canonicalJson));
  const unanswered = fields.filter(field => !form.fields[field.id]?.trim());
  const activeField = fields.find(field => field.id === activeFieldId) ?? fields[0];
  const references: { key: string; label: string; text: string; citation?: UniverseCitation }[] = [
    ...(captured.entity.summary ? [{ key: 'summary', label: 'Saved entry summary', text: captured.entity.summary }] : []),
    ...citationOptions.filter(([, citation]) => citation.excerpt.trim()).map(([, citation], index) => ({ key: `citation:${index}`, label: citation.label, text: citation.excerpt, citation })),
  ];
  const reference = references.find(item => item.key === referenceKey) ?? references[0];
  const hasWorkingText = Boolean(activeField && form.fields[activeField.id]);
  const referenceFits = Boolean(reference && reference.text.length <= UNIVERSE_PROFILE_LIMITS.fieldText && textLength + reference.text.length <= UNIVERSE_PROFILE_LIMITS.totalText);
  const citationFits = !reference?.citation || selectedCitations.has(canonicalJson(reference.citation)) || form.citations.length < UNIVERSE_LIMITS.citations;
  const profileId = `universe-profile:${captured.entity.id}`;
  const data: UniverseProfileDraft = { schemaVersion: 1, ...universeDraftScope(captured.project, captured.record?.data ?? model.drafts.find(row => row.id === captured.entity.recordRef?.id)?.data), entityId: captured.entity.id, entityType: captured.entity.type, ...form, status: 'DRAFT' };
  let valid = true;
  try { canonicalJson(data); validateUniverseRecord('universe-profile', data, captured.project); } catch { valid = false; }

  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onDirtyRef.current?.(false); }; }, []);
  useEffect(() => { panel.current?.scrollIntoView?.({ block: 'nearest' }); }, []);

  function editField(id: string, value: string) {
    if (locked) return;
    setForm(current => { const next = { ...current.fields }; if (value === '') delete next[id]; else next[id] = value; return { ...current, fields: next }; });
    setError(''); setNotice('');
  }
  function focusField(id: string) {
    setActiveFieldId(id);
    fieldInputs.current[id]?.focus({ preventScroll: true });
    fieldInputs.current[id]?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  }
  function useReference() {
    if (locked || !activeField || !reference || hasWorkingText || !referenceFits || !citationFits) return;
    const target = activeField.id, text = reference.text, citation = reference.citation;
    setForm(current => {
      if (current.fields[target] || Object.values(current.fields).reduce((total, value) => total + value.length, 0) + text.length > UNIVERSE_PROFILE_LIMITS.totalText) return current;
      const addCitation = citation && !current.citations.some(item => canonicalJson(item) === canonicalJson(citation));
      if (addCitation && current.citations.length >= UNIVERSE_LIMITS.citations) return current;
      return { ...current, fields: { ...current.fields, [target]: text }, citations: addCitation ? [...current.citations, clone(citation)] : current.citations };
    });
    setError(''); setNotice(`Saved text added unchanged to ${activeField.label}${citation ? ' with its citation' : ''}. Review and adapt it to answer the question before saving.`);
    focusField(target);
  }
  function chooseCitation(key: string, citation: UniverseCitation, selected: boolean) {
    if (locked || selected && form.citations.length >= UNIVERSE_LIMITS.citations) return;
    setForm(current => ({ ...current, citations: selected ? [...current.citations, clone(citation)] : current.citations.filter(item => canonicalJson(item) !== key) }));
    setError(''); setNotice('');
  }
  async function save() {
    if (pending.current || invalidated.current || competingRef.current || !valid || !changed && !attempt.current) return;
    if (!attempt.current) attempt.current = { data: clone(data), expectedVersion: saved?.version ?? null, requestId: crypto.randomUUID(), fingerprint, save: onSave };
    const request = attempt.current; pending.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const record = await request.save(clone(request.data), request.expectedVersion, request.requestId);
      validateUniverseRecord('universe-profile', record.data, captured.project);
      if (record.id !== profileId || record.kind !== 'universe-profile' || record.version !== (request.expectedVersion ?? 0) + 1
        || canonicalJson(record.data) !== canonicalJson(request.data) || record.sha256 !== await hashCanonical(request.data)) {
        throw new Error('The returned profile did not match this save. Retry to confirm the same revision.');
      }
      if (!alive.current || invalidated.current || competingRef.current) return;
      setSaved(clone(record) as ProfileRecord); setBaseline(request.fingerprint); attempt.current = null;
      setNotice(`Profile saved locally · v${record.version}. Your screenplay and character memories are unchanged.`);
    } catch (caught) { if (alive.current && !invalidated.current) setError(errorMessage(caught)); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  }
  function discard() {
    if (saving || attempt.current) return;
    setForm(fieldsOf(saved)); setBaseline(canonicalJson(fieldsOf(saved))); setError(''); setNotice('Local changes discarded.');
  }

  return <section ref={panel} className="universe-profile-editor" aria-label={`Develop profile: ${captured.entity.name}`}>
    <header className="universe-profile-heading"><div><span>{universeTypeLabel(captured.entity.type)} · Story bible</span><h3>Develop {captured.entity.name}</h3><p>Build the details once and keep them with this universe entry.</p></div><button type="button" disabled={saving} onClick={onClose}>{attempt.current ? 'Close · save status unknown' : dirty ? 'Discard & close' : 'Close'}</button></header>
    <div className="universe-profile-progress"><strong>{filled} of {fields.length} fields have notes</strong><span>{saved ? `Saved profile v${saved.version}` : 'New profile draft'}</span></div>
    <p className="universe-profile-scope">These are author intentions and research. Canon decisions and the character’s own knowledge remain separate.</p>
    <section className="universe-profile-guide" aria-label="Profile questions to develop">
      <header><div><h4>{unanswered.length ? 'Develop the next question' : 'Review your profile'}</h4><p>{unanswered.length ? 'Choose a gap, use your saved material, then write what matters to this story. Leave unknowns open.' : 'Every field has notes. Check the story choices and supporting sources before saving; notes are not approval.'}</p></div>{unanswered[0] && <button type="button" disabled={locked} onClick={() => focusField(unanswered[0].id)}>Next: {unanswered[0].label}</button>}</header>
      {sections.map(section => { const missing = section.fields.filter(field => !form.fields[field.id]?.trim()); return <div className="universe-profile-question-group" key={section.id}><strong>{section.label}<small>{missing.length ? `${missing.length} open` : 'Notes in every field'}</small></strong><div>{missing.map(field => <button type="button" key={field.id} disabled={locked} title={field.hint} onClick={() => focusField(field.id)}>{field.label}</button>)}</div></div>; })}
    </section>
    <nav className="universe-profile-sections" aria-label="Profile sections">{sections.map(section => <a key={section.id} href={`#${prefix}-section-${section.id}`}>{section.label}</a>)}<a href={`#${prefix}-sources`}>Supporting sources</a></nav>
    {stale && <p role="alert" className="universe-profile-alert">The project or universe entry changed. Your edits are retained here; close and reopen the current entry before saving.</p>}
    {!stale && competing && <p role="alert" className="universe-profile-alert">A different profile revision is available. Your edits are retained here; close and reopen to review that version before saving.</p>}
    <form aria-label="Universe development profile" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="universe-profile-working-layout">
      <fieldset disabled={locked} className="universe-profile-fields"><legend className="universe-profile-visually-hidden">Profile details</legend>
        {sections.map(section => <section className="universe-profile-section" key={section.id} id={`${prefix}-section-${section.id}`}>
          <header><h4>{section.label}</h4><small>{section.fields.filter(field => form.fields[field.id]?.trim()).length} / {section.fields.length} fields</small></header>
          <div className="universe-profile-grid">{section.fields.map(field => <label className={activeField?.id === field.id ? 'is-working' : ''} key={field.id} htmlFor={`${prefix}-${field.id}`}><span>{field.label}</span><textarea ref={input => { fieldInputs.current[field.id] = input; }} id={`${prefix}-${field.id}`} aria-label={field.label} aria-describedby={`${prefix}-${field.id}-hint`} rows={3} maxLength={UNIVERSE_PROFILE_LIMITS.fieldText} value={form.fields[field.id] ?? ''} onFocus={() => setActiveFieldId(field.id)} onChange={event => editField(field.id, event.target.value)}/><small id={`${prefix}-${field.id}-hint`}>{field.hint}</small></label>)}</div>
        </section>)}
        <section className="universe-profile-section universe-profile-citations" id={`${prefix}-sources`}><header><h4>Supporting source material</h4><small>{form.citations.length} selected</small></header><p>Choose only the retained passages that support this profile. “Use passage and cite it” selects its source here for your review.</p>
          {citationOptions.length ? citationOptions.map(([key, citation]) => <label className="universe-profile-citation" key={key}><input type="checkbox" checked={selectedCitations.has(key)} disabled={locked || !selectedCitations.has(key) && form.citations.length >= UNIVERSE_LIMITS.citations} onChange={event => chooseCitation(key, citation, event.target.checked)}/><span><strong>{citation.label}</strong><small>{citation.paragraphId ?? (citation.pageNumber !== null ? `Page ${citation.pageNumber}` : citation.kind.replace(/_/g, ' '))}</small>{citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}<code>{citation.sourceId} · {citation.sourceSha256.slice(0, 12)}</code></span></label>) : <p>No retained citations are available for this entry. You can still save an uncited draft.</p>}
        </section>
        <label className="universe-profile-review" htmlFor={`${prefix}-review`}><span>Review status</span><select id={`${prefix}-review`} aria-label="Review status" value={form.review} onChange={event => { if (!locked) { setForm(current => ({ ...current, review: event.target.value as Form['review'] })); setNotice(''); } }}><option value="PROPOSED">Proposed</option><option value="QUESTIONED">Needs an answer</option><option value="SET_ASIDE">Set aside</option></select></label>
      </fieldset>
      <aside className="universe-profile-reference" aria-label="Saved material for the working field">
        <span>Working on</span><h4>{activeField?.label}</h4><p>{activeField?.hint}</p>
        {reference ? <><label>Saved material<select aria-label="Saved material to use" value={reference.key} onChange={event => setReferenceKey(event.target.value)}>{references.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><blockquote>{reference.text}</blockquote><small>{reference.citation ? `${reference.citation.label}${reference.citation.pageNumber !== null ? ` · Page ${reference.citation.pageNumber}` : ''}` : `${captured.entity.origin.replace(/_/g, ' ').toLowerCase()} · ${captured.entity.review.replace(/_/g, ' ').toLowerCase()}`}</small><button type="button" disabled={locked || hasWorkingText || !referenceFits || !citationFits} onClick={useReference}>{reference.citation ? 'Use passage and cite it' : 'Use saved summary'}</button><p className="universe-profile-reference-help">{hasWorkingText ? 'This field already has text. Your writing stays intact; read the source while revising it.' : !referenceFits ? 'This saved text is too long for the remaining field space. Write a shorter answer using the passage as reference.' : !citationFits ? 'The profile has reached its source limit. Review the supporting sources before adding another.' : 'Copies the exact saved text into this empty field. Review its relevance and revise it in your own words.'}</p></> : <p>No saved summary or source excerpt is available. Start with your own intentions; unanswered questions can stay open.</p>}
        <button type="button" disabled={locked || !unanswered.length} onClick={() => { const next = unanswered.find(field => field.id !== activeField?.id) ?? unanswered[0]; if (next) focusField(next.id); }}>Go to next empty field</button>
      </aside>
      </div>
      {textLength > UNIVERSE_PROFILE_LIMITS.totalText && <p role="alert" className="universe-profile-alert">The profile exceeds {UNIVERSE_PROFILE_LIMITS.totalText.toLocaleString()} characters. Shorten a field before saving.</p>}
      {error && <p role="alert" className="universe-profile-alert">{error} Retry keeps this exact profile and save identity.</p>}
      {notice && <p role="status" className="universe-profile-notice">{notice}</p>}
      <footer className="universe-profile-footer"><small>{textLength.toLocaleString()} / {UNIVERSE_PROFILE_LIMITS.totalText.toLocaleString()} characters · Fill what is useful; a filled field is not an approval.</small><div><button type="button" disabled={!changed || saving || Boolean(attempt.current)} onClick={discard}>Discard changes</button><button type="submit" className="universe-profile-save" disabled={saving || stale || competing || !valid || !changed && !attempt.current}>{saving ? 'Saving profile…' : attempt.current ? 'Retry same profile save' : 'Save profile draft'}</button></div></footer>
    </form>
  </section>;
}
