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
  const [baseline, setBaseline] = useState(() => canonicalJson(fieldsOf(captured.record)));
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const attempt = useRef<SaveAttempt | null>(null), pending = useRef(false), alive = useRef(true), invalidated = useRef(false), competingRef = useRef(false);
  const onDirtyRef = useRef(onDirty); onDirtyRef.current = onDirty;
  const prefix = useId(), panel = useRef<HTMLElement>(null);
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
    <div className="universe-profile-progress"><strong>{filled} of {fields.length} fields filled</strong><span>{saved ? `Saved profile v${saved.version}` : 'New profile draft'}</span></div>
    <p className="universe-profile-scope">These are author intentions and research. Canon decisions and the character’s own knowledge remain separate.</p>
    {captured.entity.summary && <section className="universe-profile-source" aria-label="Entry context"><h4>Entry context</h4><p>{captured.entity.summary}</p><small>{captured.entity.origin.replace(/_/g, ' ').toLowerCase()} · {captured.entity.review.replace(/_/g, ' ').toLowerCase()}. Keep this source description in view while developing the profile.</small></section>}
    <nav className="universe-profile-sections" aria-label="Profile sections">{sections.map(section => <a key={section.id} href={`#${prefix}-section-${section.id}`}>{section.label}</a>)}<a href={`#${prefix}-sources`}>Supporting sources</a></nav>
    {stale && <p role="alert" className="universe-profile-alert">The project or universe entry changed. Your edits are retained here; close and reopen the current entry before saving.</p>}
    {!stale && competing && <p role="alert" className="universe-profile-alert">A different profile revision is available. Your edits are retained here; close and reopen to review that version before saving.</p>}
    <form aria-label="Universe development profile" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={locked} className="universe-profile-fields"><legend className="universe-profile-visually-hidden">Profile details</legend>
        {sections.map(section => <section className="universe-profile-section" key={section.id} id={`${prefix}-section-${section.id}`}>
          <header><h4>{section.label}</h4><small>{section.fields.filter(field => form.fields[field.id]?.trim()).length} / {section.fields.length} fields</small></header>
          <div className="universe-profile-grid">{section.fields.map(field => <label key={field.id} htmlFor={`${prefix}-${field.id}`}><span>{field.label}</span><textarea id={`${prefix}-${field.id}`} aria-label={field.label} aria-describedby={`${prefix}-${field.id}-hint`} rows={3} maxLength={UNIVERSE_PROFILE_LIMITS.fieldText} value={form.fields[field.id] ?? ''} onChange={event => editField(field.id, event.target.value)}/><small id={`${prefix}-${field.id}-hint`}>{field.hint}</small></label>)}</div>
        </section>)}
        <section className="universe-profile-section universe-profile-citations" id={`${prefix}-sources`}><header><h4>Supporting source material</h4><small>{form.citations.length} selected</small></header><p>Choose only the retained passages that support this profile. Sources are never attached automatically.</p>
          {citationOptions.length ? citationOptions.map(([key, citation]) => <label className="universe-profile-citation" key={key}><input type="checkbox" checked={selectedCitations.has(key)} disabled={locked || !selectedCitations.has(key) && form.citations.length >= UNIVERSE_LIMITS.citations} onChange={event => chooseCitation(key, citation, event.target.checked)}/><span><strong>{citation.label}</strong><small>{citation.paragraphId ?? (citation.pageNumber !== null ? `Page ${citation.pageNumber}` : citation.kind.replace(/_/g, ' '))}</small>{citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}<code>{citation.sourceId} · {citation.sourceSha256.slice(0, 12)}</code></span></label>) : <p>No retained citations are available for this entry. You can still save an uncited draft.</p>}
        </section>
        <label className="universe-profile-review" htmlFor={`${prefix}-review`}><span>Review status</span><select id={`${prefix}-review`} aria-label="Review status" value={form.review} onChange={event => { if (!locked) { setForm(current => ({ ...current, review: event.target.value as Form['review'] })); setNotice(''); } }}><option value="PROPOSED">Proposed</option><option value="QUESTIONED">Needs an answer</option><option value="SET_ASIDE">Set aside</option></select></label>
      </fieldset>
      {textLength > UNIVERSE_PROFILE_LIMITS.totalText && <p role="alert" className="universe-profile-alert">The profile exceeds {UNIVERSE_PROFILE_LIMITS.totalText.toLocaleString()} characters. Shorten a field before saving.</p>}
      {error && <p role="alert" className="universe-profile-alert">{error} Retry keeps this exact profile and save identity.</p>}
      {notice && <p role="status" className="universe-profile-notice">{notice}</p>}
      <footer className="universe-profile-footer"><small>{textLength.toLocaleString()} / {UNIVERSE_PROFILE_LIMITS.totalText.toLocaleString()} characters · Fill what is useful; a filled field is not an approval.</small><div><button type="button" disabled={!changed || saving || Boolean(attempt.current)} onClick={discard}>Discard changes</button><button type="submit" className="universe-profile-save" disabled={saving || stale || competing || !valid || !changed && !attempt.current}>{saving ? 'Saving profile…' : attempt.current ? 'Retry same profile save' : 'Save profile draft'}</button></div></footer>
    </form>
  </section>;
}
