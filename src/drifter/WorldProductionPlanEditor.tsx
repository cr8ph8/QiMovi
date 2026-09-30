import { useEffect, useRef, useState } from 'react';
import { validateUniverseRecord } from '../../local/contracts/universe.mjs';
import { characterSourceContext, sourceLinkBasisIsCurrent } from '../../local/contracts/character-source-context.mjs';
import { canonicalJson, hashCanonical } from './canonical';
import { activeWorldNeeds, worldProductionPlan, worldBudgetTarget, type WorldPlanRecord } from './worldProductionModel';
import { worldNeedStarter } from './worldNeedSuggestions';
import { universeDraftScope } from './universeApi';
import type { WorkspaceProject, WorkspaceRecord } from './types';
import type { UniverseCatalog, UniverseEntity, UniverseProductionPlanDraft } from './universeApi';
import './world-production.css';

export type WorldProductionPlanEditorProps = {
  project: WorkspaceProject; model: UniverseCatalog; entity: UniverseEntity;
  onSave(data: UniverseProductionPlanDraft, version: number | null, requestId: string): Promise<WorkspaceRecord>;
  onDirty?(dirty: boolean): void; onClose(): void; onOpenBudget?(targetId: string): void;
};
type Need = UniverseProductionPlanDraft['needs'][number];
const departments = [['development', 'Writing & development'], ['cast', 'Cast & performance'], ['locations', 'Locations & sets'], ['art', 'Art, props & costume'], ['assets', 'Digital assets'], ['equipment', 'Camera & equipment'], ['generation', 'AI generation'], ['post', 'Post & visual effects'], ['audio', 'Sound & music'], ['other', 'Other']] as const;
const reviews = [['PROPOSED', 'Planned'], ['QUESTIONED', 'Needs an answer'], ['SET_ASIDE', 'Set aside']] as const;
const clone = <T,>(value: T): T => JSON.parse(canonicalJson(value));

export default function WorldProductionPlanEditor({ project, model, entity, onSave, onDirty, onClose, onOpenBudget }: WorldProductionPlanEditorProps) {
  const [captured] = useState(() => ({ project: clone(project), entity: clone(entity), record: clone(worldProductionPlan(model, entity.id)), sourceContext: clone(characterSourceContext(model, entity)) }));
  const [saved, setSaved] = useState<WorldPlanRecord | null>(captured.record);
  const [form, setForm] = useState<UniverseProductionPlanDraft>(() => clone(captured.record ? { ...captured.record.data, entityName: captured.entity.name } : {
    schemaVersion: 1, ...universeDraftScope(project), entityId: entity.id, entityType: entity.type, entityName: entity.name,
    needs: [], citations: [], status: 'DRAFT', review: 'PROPOSED',
  }));
  const [baseline, setBaseline] = useState(() => canonicalJson(form));
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const attempt = useRef<{ data: UniverseProductionPlanDraft; version: number | null; id: string; save: typeof onSave } | null>(null);
  const pending = useRef(false), alive = useRef(true), invalidated = useRef(false), sourceContextChanged = useRef(false), conflict = useRef(false), panel = useRef<HTMLElement>(null);
  const dirtyRef = useRef(onDirty); dirtyRef.current = onDirty;
  const current = model.entities.find(item => item.id === captured.entity.id);
  const usesSourceLinks = captured.entity.type === 'character' && ['DRAFT', 'USER_AUTHORED'].includes(captured.entity.origin) && Boolean(captured.entity.recordRef);
  sourceContextChanged.current ||= usesSourceLinks && characterSourceContext(model, current ?? captured.entity).fingerprint !== captured.sourceContext.fingerprint;
  invalidated.current ||= project.id !== captured.project.id || project.sourceHash !== captured.project.sourceHash
    || model.projectId !== captured.project.id || model.sourceHash !== captured.project.sourceHash
    || !current || canonicalJson(current) !== canonicalJson(captured.entity) || entity.id !== captured.entity.id || sourceContextChanged.current;
  const latest = worldProductionPlan(model, captured.entity.id);
  const matchingAttempt = Boolean(attempt.current && latest && latest.version === (attempt.current.version ?? 0) + 1 && canonicalJson(latest.data) === canonicalJson(attempt.current.data));
  conflict.current = !matchingAttempt && Boolean(latest ? !saved || latest.version >= saved.version && latest.sha256 !== saved.sha256 : captured.record);
  const changed = canonicalJson(form) !== baseline, dirty = changed || saving || Boolean(attempt.current);
  const locked = invalidated.current || conflict.current || saving || Boolean(attempt.current);
  const starter = worldNeedStarter(captured.project, captured.entity, form.needs, captured.sourceContext);
  const sourcePlans = captured.sourceContext.linked.map(({ entity: source }) => ({ source, needs: activeWorldNeeds(worldProductionPlan(model, source.id)) })).filter(item => item.needs.length);
  const linkedSceneCount = new Set(captured.sourceContext.basis?.observedSceneIds.filter(id => captured.project.scenes.some((scene: { id: string }) => scene.id === id)) ?? []).size;
  let valid = true;
  try { validateUniverseRecord('universe-production-plan', form, captured.project); } catch { valid = false; }
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => { alive.current = true; panel.current?.scrollIntoView?.({ block: 'nearest' }); return () => { alive.current = false; dirtyRef.current?.(false); }; }, []);
  function change(next: UniverseProductionPlanDraft) { if (!locked) { setForm(next); setError(''); setNotice(''); } }
  function editNeed(id: string, patch: Partial<Need>) { change({ ...form, needs: form.needs.map(need => need.id === id ? { ...need, ...patch } : need) }); }
  function addNeed() {
    change({ ...form, needs: [...form.needs, { id: `need-${crypto.randomUUID()}`, label: '', department: captured.entity.type === 'character' ? 'cast' : captured.entity.type === 'location' ? 'locations' : 'art', sceneIds: [], description: '', review: 'PROPOSED' }] });
  }
  function addStarter() {
    if (!starter || starter.alreadyPresent || starter.sceneLimitReached || starter.sourceLinkLimitReached || form.needs.length >= 64 || locked) return;
    change({ ...form, needs: [...form.needs, clone(starter.need)] });
  }
  async function save() {
    if (pending.current || invalidated.current || conflict.current || !valid || !changed && !attempt.current) return;
    if (!attempt.current) attempt.current = { data: clone(form), version: saved?.version ?? null, id: crypto.randomUUID(), save: onSave };
    const request = attempt.current; pending.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const result = await request.save(clone(request.data), request.version, request.id);
      validateUniverseRecord('universe-production-plan', result.data, captured.project);
      if (result.kind !== 'universe-production-plan' || result.id !== `universe-production-plan:${captured.entity.id}`
        || result.version !== (request.version ?? 0) + 1 || canonicalJson(result.data) !== canonicalJson(request.data)
        || result.sha256 !== await hashCanonical(request.data)) throw new Error('The saved receipt did not match these needs. Retry the same save to confirm it.');
      if (!alive.current || invalidated.current || conflict.current) return;
      setSaved(clone(result) as WorldPlanRecord); setBaseline(canonicalJson(request.data)); attempt.current = null;
      setNotice(`Production needs saved · v${result.version}. Open Budget to review coverage and enter rates.`);
    } catch (caught) { if (alive.current && !invalidated.current) setError(caught instanceof Error ? caught.message : 'Save could not be confirmed.'); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  }
  return <section ref={panel} className="world-production-editor" aria-label={`Production needs: ${captured.entity.name}`}>
    <header><div><span className="bible-eyebrow">Story Bible → Production → Budget</span><h3>{captured.entity.name} · production needs</h3><p>Plan a performance, place, prop, costume, motif or effect and choose the scenes that need it.</p></div><button type="button" disabled={saving} onClick={onClose}>{attempt.current ? 'Close · save status unknown' : dirty ? 'Discard & close' : 'Close needs'}</button></header>
    <p>These are author plans. Source appearances, character memories and approvals remain separate. Costs are entered in the shared Budget.</p>
    {sourceContextChanged.current && <p role="alert">Source links or their scene appearances changed while this plan was open. Your draft is retained here; reopen the entry to review the current links before adding or saving needs.</p>}
    {invalidated.current && !sourceContextChanged.current && <p role="alert">This project or entry changed. Your draft is retained here; reopen the entry before saving.</p>}
    {conflict.current && <p role="alert">A newer production plan is available. Your edits are retained; reopen to review it.</p>}
    {captured.entity.type === 'character' && (captured.sourceContext.linked.length > 0 || captured.sourceContext.blocked.length > 0) && <section aria-label="Linked source appearances">
      <h4>Source appearances for this character</h4>
      <p>{captured.sourceContext.linked.length} linked source {captured.sourceContext.linked.length === 1 ? 'entry' : 'entries'} · {linkedSceneCount} {linkedSceneCount === 1 ? 'scene' : 'scenes'}. Adding a starter copies these appearances for your planning review.</p>
      {captured.sourceContext.linked.length > 0 && <ul>{captured.sourceContext.linked.map(({ entity: source }) => <li key={source.id}>{source.name} · {source.origin === 'SCREENPLAY' ? 'Screenplay observation' : 'Lore observation'} · {source.sceneIds.length} scene {source.sceneIds.length === 1 ? 'link' : 'links'}</li>)}</ul>}
      {captured.sourceContext.blocked.length > 0 && <div role="status"><p>Some source links need review before their scenes can be used:</p><ul>{captured.sourceContext.blocked.map(({ entity: source, reason }) => <li key={source.id}>{source.name}: {reason}</li>)}</ul></div>}
    </section>}
    {sourcePlans.length > 0 && <section aria-label="Existing source production needs">
      <h4>Review existing needs before adding more</h4>
      <p>Linked source entries already have active production needs. Review them in Budget to avoid planning the same work twice. Costs and needs stay attached to their original entry.</p>
      <ul>{sourcePlans.map(({ source, needs }) => <li key={source.id}>{source.name} · {needs.length} active {needs.length === 1 ? 'need' : 'needs'}: {needs.map(need => need.label).join('; ')} {onOpenBudget && <button type="button" disabled={dirty || invalidated.current || conflict.current} onClick={() => onOpenBudget(worldBudgetTarget(source.id))}>Review {source.name} in Budget</button>}</li>)}</ul>
      {dirty && <small>Save or discard this draft before opening Budget.</small>}
    </section>}
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={locked}><legend>Scene requirements</legend>
        <label>Plan status<select aria-label="Production plan status" value={form.review} onChange={event => change({ ...form, review: event.target.value as typeof form.review })}>{reviews.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        {!form.needs.length && <p>No production needs planned. Add only what this film requires.</p>}
        {starter && <div aria-label="Production need starter">
          <p>{starter.alreadyPresent ? 'This entry’s starter is already listed, including any version you set aside. Edit that need to change its plan.'
            : starter.sceneLimitReached ? 'This entry has more than 100 scene links. Add a need manually and choose the scenes for this plan.'
              : starter.sourceLinkLimitReached ? 'These source links exceed the starter’s supported record size. Add a need manually and choose the scenes for this plan.'
              : <>Start with <strong>{starter.need.label}</strong>. {starter.need.sceneIds.length ? `${starter.need.sceneIds.length} existing scene link${starter.need.sceneIds.length === 1 ? '' : 's'} will be copied for your review.` : 'No current scene links; assign scenes below or keep it project-wide.'} Adds an editable, proposed requirement. Scene appearances do not authorize production.</>}</p>
          <button type="button" disabled={locked || starter.alreadyPresent || starter.sceneLimitReached || starter.sourceLinkLimitReached || form.needs.length >= 64} onClick={addStarter}>Add starter from this entry</button>
        </div>}
        {form.needs.map((need, index) => <article className="world-production-need" key={need.id} aria-label={`Requirement ${index + 1}`}>
          <div className="world-need-fields"><label>Need<input aria-label={`Need ${index + 1}`} maxLength={240} placeholder="e.g. Traveler’s weathered coat" value={need.label} onChange={event => editNeed(need.id, { label: event.target.value })}/></label>
            <label>Department<select aria-label={`Department ${index + 1}`} value={need.department} onChange={event => editNeed(need.id, { department: event.target.value as Need['department'] })}>{departments.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Status<select aria-label={`Need status ${index + 1}`} value={need.review} onChange={event => editNeed(need.id, { review: event.target.value as Need['review'] })}>{reviews.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          <label>Direction & continuity<textarea aria-label={`Direction ${index + 1}`} maxLength={2000} rows={3} placeholder="Appearance, behavior, continuity, required references and open decisions…" value={need.description} onChange={event => editNeed(need.id, { description: event.target.value })}/></label>
          {need.sourceLinkBasis && <p>Scene choices started from {new Set(need.sourceLinkBasis.aliases.map(alias => alias.observationId)).size} linked source {new Set(need.sourceLinkBasis.aliases.map(alias => alias.observationId)).size === 1 ? 'entry' : 'entries'}. {sourceLinkBasisIsCurrent(model, current ?? captured.entity, need.sourceLinkBasis) ? 'The source-link record is current.' : 'The source-link record has changed since this need was created; review scene choices. Its original record is preserved.'}</p>}
          <fieldset className="world-need-scenes"><legend>Planned scenes · {need.sceneIds.length} selected</legend>{captured.project.scenes.map(scene => <label key={scene.id}><input type="checkbox" aria-label={`Need ${index + 1} · Scene ${scene.index}`} checked={need.sceneIds.includes(scene.id)} onChange={event => editNeed(need.id, { sceneIds: event.target.checked ? [...need.sceneIds, scene.id] : need.sceneIds.filter(id => id !== scene.id) })}/><span>{scene.index} · {scene.heading}</span></label>)}</fieldset>
          {!need.sceneIds.length && <small>Project-wide need; no scene assignment yet.</small>}
          <button type="button" onClick={() => change({ ...form, needs: form.needs.filter(item => item.id !== need.id) })}>Remove need {index + 1}</button>
        </article>)}
        <button type="button" onClick={addNeed} disabled={locked || form.needs.length >= 64}>Add production need</button>
      </fieldset>
      {error && <p role="alert">{error} Retry retains the exact save identity.</p>}{notice && <p role="status">{notice}</p>}
      <footer><small>{saved ? `Saved v${saved.version}` : 'Unsaved plan'} · Rates remain unset until you enter them. One need is not multiplied by its number of scenes.</small><div>
        <button type="button" disabled={!changed || saving || Boolean(attempt.current)} onClick={() => { setForm(JSON.parse(baseline)); setError(''); setNotice('Changes discarded.'); }}>Discard changes</button>
        <button type="submit" disabled={saving || invalidated.current || conflict.current || !valid || !changed && !attempt.current}>{saving ? 'Saving…' : attempt.current ? 'Retry same needs save' : 'Save production needs'}</button>
        {onOpenBudget && <button type="button" disabled={!saved || dirty || invalidated.current || conflict.current} onClick={() => onOpenBudget(worldBudgetTarget(captured.entity.id))}>Open linked budget</button>}
      </div></footer>
    </form>
  </section>;
}
