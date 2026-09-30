import { useEffect, useRef, useState } from 'react';
import { UNIVERSE_RELATIONS, validateUniverseRecord } from '../../local/contracts/universe.mjs';
import type { WorkspaceProject, WorkspaceRecord } from './types';
import type { UniverseCatalog, UniverseEntity, UniverseLinkDraft } from './universeApi';
import { universeDraftScope } from './universeApi';
import './universe-relationship-editor.css';

type Props = {
  project: WorkspaceProject;
  model: UniverseCatalog;
  entity: UniverseEntity;
  onSave: (data: UniverseLinkDraft) => Promise<WorkspaceRecord>;
  onDirty?: (dirty: boolean) => void;
  onClose: () => void;
};

const relationLabels: Record<string, string> = {
  appears_in: 'Appears in', set_in: 'Set in', source_for: 'Source for', related_to: 'Related to',
  possible_alias: 'Possible alias of', member_of: 'Member of', located_in: 'Located in',
  before: 'Before', conflicts_with: 'Conflicts with',
};

export default function UniverseRelationshipEditor({ project, model, entity, onSave, onDirty, onClose }: Props) {
  const [captured] = useState(() => ({ projectId: project.id, sourceHash: project.sourceHash,
    entityId: entity.id, entityName: entity.name,
    targets: model.entities.filter(item => item.id !== entity.id).map(item => ({ id: item.id, name: item.name, type: item.type })) }));
  const [targetId, setTargetId] = useState(''), [relation, setRelation] = useState('related_to');
  const [label, setLabel] = useState(''), [review, setReview] = useState<'PROPOSED' | 'QUESTIONED'>('PROPOSED');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const attempt = useRef<{ data: UniverseLinkDraft; save: Props['onSave'] } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const active = useRef(true), pending = useRef(false), invalidated = useRef(false);
  const callbacks = useRef({ onDirty, onClose }); callbacks.current = { onDirty, onClose };
  invalidated.current ||= project.id !== captured.projectId || project.sourceHash !== captured.sourceHash
    || entity.id !== captured.entityId || model.projectId !== captured.projectId || model.sourceHash !== captured.sourceHash
    || !model.entities.some(item => item.id === captured.entityId);
  const stale = invalidated.current;
  const target = captured.targets.find(item => item.id === targetId);
  const targetPresent = Boolean(target && model.entities.some(item => item.id === target.id));
  const currentTargetPresent = useRef(targetPresent); currentTargetPresent.current = targetPresent;
  const dirty = !saved && (saving || Boolean(attempt.current || targetId || label || relation !== 'related_to' || review !== 'PROPOSED'));
  const locked = saving || Boolean(attempt.current) || stale || saved;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => { active.current = true; return () => { active.current = false; callbacks.current.onDirty?.(false); }; }, []);
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    formRef.current?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true });
  }, []);

  async function save() {
    if (pending.current || invalidated.current || saved || !targetPresent || !label.trim()) return;
    if (!attempt.current) {
      const data: UniverseLinkDraft = { schemaVersion: 1, ...universeDraftScope(project), fromEntityId: captured.entityId,
        toEntityId: targetId, relation, label: label.trim(), review, citations: [], status: 'DRAFT' };
      try { validateUniverseRecord('universe-link', data, project); }
      catch { setError('Choose two different entries, a supported relationship and a short description.'); return; }
      Object.freeze(data.citations); Object.freeze(data);
      attempt.current = { data, save: onSave };
    }
    const retained = attempt.current;
    pending.current = true; setSaving(true); setError('');
    try {
      await retained.save(retained.data);
      if (!active.current || invalidated.current || !currentTargetPresent.current) return;
      setSaved(true); setSaving(false); callbacks.current.onDirty?.(false); callbacks.current.onClose();
    } catch (caught) {
      if (!active.current || invalidated.current || !currentTargetPresent.current) return;
      setError(caught instanceof Error ? caught.message : 'The relationship save was not confirmed.');
      setSaving(false);
    } finally { pending.current = false; }
  }

  return <form ref={formRef} className="uni-relationship-editor" aria-label="New universe relationship" onSubmit={event => { event.preventDefault(); void save(); }}>
    <header><h3>Connect {captured.entityName}</h3><p>Describe a directed relationship in this project's universe.</p></header>
    <p className="uni-relationship-direction"><strong>{captured.entityName}</strong><span aria-hidden="true">→</span><span>{target?.name ?? 'Choose an entry'}</span></p>
    <fieldset disabled={locked}>
      <label>Connect to<select value={targetId} onChange={event => setTargetId(event.target.value)} required>
        <option value="">Choose an entry…</option>{captured.targets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.type.replace(/_/g, ' ')}</option>)}
      </select></label>
      <label>Relationship<select value={relation} onChange={event => setRelation(event.target.value)}>
        {UNIVERSE_RELATIONS.map(value => <option key={value} value={value}>{relationLabels[value] ?? value.replace(/_/g, ' ')}</option>)}
      </select></label>
      <label>Description<input value={label} onChange={event => setLabel(event.target.value)} maxLength={240} placeholder="Describe the connection in your own words" required/></label>
      <label>Review state<select value={review} onChange={event => setReview(event.target.value as 'PROPOSED' | 'QUESTIONED')}>
        <option value="PROPOSED">Proposed</option><option value="QUESTIONED">Questioned</option>
      </select></label>
    </fieldset>
    {relation === 'possible_alias' && <p className="uni-relationship-note">A possible alias keeps both identities separate.</p>}
    <p className="uni-relationship-note">No supporting citations attached. This saves your interpretation as a draft; it does not establish canon or change the screenplay.</p>
    {!captured.targets.length && <p role="status">Create another universe entry before adding a relationship.</p>}
    {stale ? <p role="alert">The project or selected entry changed. Close this form and reopen it from the current universe.</p>
      : targetId && !targetPresent ? <p role="alert">The selected destination is no longer in this universe. Close and reopen the form.</p>
      : error && <p role="alert">{error}{attempt.current && ' Your choices are locked. Retry sends the same relationship to confirm its save.'}</p>}
    <footer><button type="button" disabled={saving && !stale && targetPresent} onClick={onClose}>Close</button>
      <button type="submit" className="primary" disabled={saving || stale || saved || !targetPresent || !label.trim()}>{saving ? 'Saving relationship…' : attempt.current ? 'Retry same relationship' : 'Save relationship draft'}</button></footer>
  </form>;
}
