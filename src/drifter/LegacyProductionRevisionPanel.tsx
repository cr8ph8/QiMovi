import { useEffect, useMemo, useRef, useState } from 'react';
import { canonicalJson } from './canonical';
import { downloadLocalBlob } from './localDownload';
import ProductionRevisionChanges from './ProductionRevisionChanges';
import { legacyProductionRevisionApi, type LegacyProductionRevisionApi, type LegacyProductionMapping, type LegacyProductionRevisionPreview } from './legacyProductionRevisionApi';
import type { Project, WorkspaceRecord } from './types';
import './writing-production.css';
import './legacy-production-revision.css';
import { legacyProductionPlanningNotes } from '../../local/contracts/legacy-production-revision.mjs';

type SceneIntent = { notes: string; shotIds: string[] };
type Props = { project: Project; draft: WorkspaceRecord | null; records: WorkspaceRecord[]; open?: boolean; disabled: boolean; onSaved(record: WorkspaceRecord): void; onBusy?(busy: boolean): void; onDirty?(dirty: boolean): void; onWrite(): void; onScene?(sceneId: string): void; api?: LegacyProductionRevisionApi };
const message = (error: unknown) => error instanceof Error ? error.message : 'The local revision operation was not confirmed.';
const normalizeHeading = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export default function LegacyProductionRevisionPanel({ project, draft, open = true, disabled, onSaved, onBusy, onDirty, onWrite, onScene, api = legacyProductionRevisionApi }: Props) {
  const [basis, setBasis] = useState<LegacyProductionRevisionPreview | null>(null), [review, setReview] = useState<LegacyProductionRevisionPreview | null>(null);
  const [mappings, setMappings] = useState<LegacyProductionMapping[]>([]), [selected, setSelected] = useState('');
  const [intents, setIntents] = useState<Record<string, SceneIntent>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const controller = useRef<AbortController>();
  const current = useRef(''), alive = useRef(true), attempt = useRef<{ fingerprint: string; requestId: string }>();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scope = `${project.id}:${project.sourceHash}:${draft?.id ?? ''}:${draft?.version ?? ''}:${draft?.sha256 ?? ''}`;
  current.current = scope;
  const defaults = (sceneId: string): SceneIntent => { const scene = basis?.sourceScenes.find(row => row.sceneId === sceneId); return { notes: legacyProductionPlanningNotes(scene?.currentHandoff?.notes ?? ''), shotIds: scene?.currentHandoff?.shotIds ?? scene?.shotIds.slice(0, 10) ?? [] }; };
  const dirty = Object.entries(intents).some(([id, value]) => canonicalJson(value) !== canonicalJson(defaults(id)));
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  useEffect(() => {
    controller.current?.abort(); setBasis(null); setReview(null); setMappings([]); setSelected(''); setIntents({}); setBusy(false); setError(''); setNotice(''); attempt.current = undefined;
    return () => controller.current?.abort();
  }, [scope]);
  async function compare(chosen: LegacyProductionMapping[], initial = false) {
    if (!draft || disabled || busy) return;
    const captured = scope, request = new AbortController(); controller.current?.abort(); controller.current = request;
    setBusy(true); setError(''); setNotice(''); setReview(null);
    try {
      const value = await api.review(project, draft, chosen, request.signal);
      if (current.current !== captured || request.signal.aborted) return;
      setBasis(value); if (!initial) setReview(value);
      setSelected(previous => chosen.some(row => row.sourceSceneId === previous) ? previous : chosen[0]?.sourceSceneId ?? '');
    } catch (caught) { if (current.current === captured && !request.signal.aborted) setError(message(caught)); }
    finally { if (current.current === captured && !request.signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    if (open && draft && !disabled && !basis && !busy && !error) void compare([], true);
    // Opening a saved draft loads its source inventory once; review is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, disabled, basis, busy, error]);
  const mappedIds = useMemo(() => new Set(mappings.map(row => row.draftSceneId)), [mappings]);
  function match(sourceSceneId: string, draftSceneId: string) {
    const chosen = mappings.filter(row => row.sourceSceneId !== sourceSceneId);
    if (draftSceneId) chosen.push({ sourceSceneId, draftSceneId });
    chosen.sort((a, b) => project.scenes.findIndex(row => row.id === a.sourceSceneId) - project.scenes.findIndex(row => row.id === b.sourceSceneId));
    setMappings(chosen); setReview(null); setNotice('Scene matches changed. Compare again before updating planning.');
  }
  function suggest() {
    if (!basis) return;
    const chosen = [...mappings], used = new Set(mappedIds);
    for (const scene of basis.sourceScenes) {
      if (chosen.some(row => row.sourceSceneId === scene.sceneId)) continue;
      const candidates = basis.draftScenes.filter(row => !row.identityNeedsReview && normalizeHeading(row.heading) === normalizeHeading(scene.heading));
      const sourceMatches = basis.sourceScenes.filter(row => normalizeHeading(row.heading) === normalizeHeading(scene.heading));
      if (candidates.length === 1 && sourceMatches.length === 1 && !used.has(candidates[0].sceneId)) { chosen.push({ sourceSceneId: scene.sceneId, draftSceneId: candidates[0].sceneId }); used.add(candidates[0].sceneId); }
    }
    chosen.sort((a, b) => project.scenes.findIndex(row => row.id === a.sourceSceneId) - project.scenes.findIndex(row => row.id === b.sourceSceneId));
    setMappings(chosen); setReview(null); setNotice('Unique matching headings suggested. Check each match, then compare. A heading is a suggestion, not proof of scene identity.');
  }
  const source = basis?.sourceScenes.find(row => row.sceneId === selected);
  const intent = intents[selected] ?? defaults(selected);
  const changedLink = source?.currentHandoff && (source.currentHandoff.authoringRef.id !== draft?.id || source.currentHandoff.authoringRef.sha256 !== draft?.sha256);
  const updateIntent = (patch: Partial<SceneIntent>) => { setIntents(previous => ({ ...previous, [selected]: { ...intent, ...patch } })); setNotice(''); };
  async function apply() {
    if (!draft || !review || !source || disabled || busy || !intent.shotIds.length || intent.shotIds.length > 10) return;
    const captured = scope, selection = { sourceSceneId: source.sceneId, shotIds: intent.shotIds, expectedVersion: source.currentHandoff?.ref.version ?? null, notes: intent.notes };
    const fingerprint = canonicalJson({ previewSha256: review.previewSha256, ...selection });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true); setError(''); setNotice('');
    try {
      const record = await api.apply(project, draft, review, { ...selection, requestId: attempt.current.requestId });
      if (!alive.current || current.current !== captured) return;
      onSaved(record); attempt.current = undefined; setReview(null);
      setIntents(previous => { const next = { ...previous }; delete next[selected]; return next; });
      setNotice(`Planning link saved · v${record.version}. Selected shots can use this saved draft in their existing preparation workflow.`);
      const refreshed = await api.review(project, draft, mappings);
      if (alive.current && current.current === captured) { setBasis(refreshed); setReview(refreshed); }
    } catch (caught) { if (alive.current && current.current === captured) setError(message(caught)); }
    finally { if (alive.current && current.current === captured) setBusy(false); }
  }
  return <section className="legacy-production-review" aria-label="Production revision workspace" data-unsaved={dirty || busy ? 'true' : 'false'}>
    <header className="legacy-review-heading"><div><span className="eyebrow">WRITING → PRODUCTION</span><h2>Review the film’s next revision</h2><p>Match saved draft scenes to the retained film, inspect changes, then update their planning links.</p></div><button onClick={onWrite}>Return to writing</button></header>
    <div className="legacy-review-status"><span><strong>Retained film</strong>{project.title} · {project.scenes.length} scenes</span><span><strong>Working draft</strong>{draft ? `Saved revision ${draft.version}` : 'Save a draft to begin'}</span><span><strong>Next action</strong>{disabled ? 'Save open writing' : review ? 'Review scene planning' : basis ? 'Confirm scene matches' : 'Load the saved revision'}</span></div>
    {!draft || disabled ? <p className="legacy-review-guidance">{!draft ? 'Start from the project screenplay or open a writing draft, then save it to compare.' : 'Save the writing draft and finish or discard any active writing timer before comparing.'}</p> : null}
    {error && <p role="alert" className="error-bar">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!basis && draft && <button disabled={disabled || busy} onClick={() => void compare([], true)}>{busy ? 'Loading saved scenes…' : 'Load saved scenes'}</button>}
    {basis && <>
      <section aria-label="Match screenplay scenes" className="legacy-review-mappings"><header><div><h3>Scene matches</h3><p>Unmatched scenes keep their existing work. Matching never deletes or reassigns media.</p></div><button disabled={disabled || busy} onClick={suggest}>Suggest matching headings</button></header>
        <div className="legacy-mapping-columns" aria-hidden="true"><span>Retained production scene</span><span>Working draft scene</span></div>
        {basis.sourceScenes.map(row => <label key={row.sceneId} className="legacy-mapping-row"><span><strong>{String(row.ordinal).padStart(2, '0')} · {row.heading}</strong><small>{row.shotIds.length} planned shots{row.currentHandoff ? ` · planning link v${row.currentHandoff.ref.version}` : ''}</small></span><select aria-label={`Draft match for scene ${row.ordinal}`} disabled={disabled || busy} value={mappings.find(item => item.sourceSceneId === row.sceneId)?.draftSceneId ?? ''} onChange={event => match(row.sceneId, event.target.value)}><option value="">Unmatched · keep existing work</option>{basis.draftScenes.map(candidate => <option key={candidate.sceneId} value={candidate.sceneId} disabled={candidate.identityNeedsReview || mappedIds.has(candidate.sceneId) && !mappings.some(item => item.sourceSceneId === row.sceneId && item.draftSceneId === candidate.sceneId)}>{candidate.ordinal} · {candidate.heading}{candidate.identityNeedsReview ? ' · resolve identity in Write' : ''}</option>)}</select></label>)}
        <div className="legacy-review-actions"><span>{mappings.length} of {basis.sourceScenes.length} production scenes matched · {basis.draftScenes.length - mappedIds.size} draft scenes unassigned</span><button className="primary" disabled={disabled || busy || !mappings.length} onClick={() => void compare(mappings)}>{busy ? 'Working…' : 'Compare reviewed scene matches'}</button></div>
      </section>
      {review && <>
        <p className="legacy-review-guidance">This compares retained paragraph text with editable Fountain. Formatting markers may appear as text changes; inspect meaning and action before updating a scene.</p>
        <ProductionRevisionChanges sceneActionLabel="Plan this scene" changes={review} originalTextForScene={id => review.sourceScenes.find(row => row.sceneId === id)?.text} workingTextForScene={id => review.draftScenes.find(row => row.sceneId === review.mappings.find(mapping => mapping.sourceSceneId === id)?.draftSceneId)?.text} onScene={id => { setSelected(id); document.getElementById('legacy-scene-planning')?.scrollIntoView?.({ block: 'start' }); }}/>
        <section id="legacy-scene-planning" className="legacy-scene-planning" aria-label="Update selected scene planning"><header><h3>Use this revision for scene planning</h3><button disabled={busy || disabled} onClick={() => downloadLocalBlob(new Blob([JSON.stringify(review, null, 2)], { type: 'application/json' }), `production-scene-review-v${draft?.version}.json`)}>Export revision review</button></header>
          <label>Production scene<select aria-label="Scene to update planning" value={selected} disabled={busy || disabled} onChange={event => setSelected(event.target.value)}>{review.mappings.map(row => <option key={row.sourceSceneId} value={row.sourceSceneId}>{review.sourceScenes.find(scene => scene.sceneId === row.sourceSceneId)?.heading}</option>)}</select></label>
          {source && <><p>{changedLink ? 'This replaces the scene’s planning link to an older draft; its saved history remains.' : source.currentHandoff ? 'This scene already has a planning link. Review its selected shots and notes.' : 'Choose the shots that should use this saved draft as planning context.'}</p>
            <fieldset disabled={busy || disabled}><legend>Shots to connect · choose up to 10</legend><div className="legacy-planning-shots">{source.shotIds.map(id => <label key={id}><input type="checkbox" checked={intent.shotIds.includes(id)} disabled={!intent.shotIds.includes(id) && intent.shotIds.length >= 10} onChange={event => updateIntent({ shotIds: source.shotIds.filter(shot => shot === id ? event.target.checked : intent.shotIds.includes(shot)) })}/><span>{project.scenes.find(scene => scene.id === source.sceneId)?.shots.find(shot => shot.id === id)?.label ?? id}</span></label>)}</div><label>Planning notes<textarea aria-label="Reviewed scene planning notes" maxLength={12000} value={intent.notes} onChange={event => updateIntent({ notes: event.target.value })}/></label></fieldset>
            <div className="legacy-review-actions"><div><button className="primary" disabled={busy || disabled || !intent.shotIds.length} onClick={() => void apply()}>{busy ? 'Saving planning link…' : attempt.current ? 'Retry planning update' : 'Update scene planning link'}</button>{intents[selected] && <button disabled={busy} onClick={() => setIntents(previous => { const next = { ...previous }; delete next[selected]; return next; })}>Discard planning edits</button>}</div>{onScene && <button disabled={busy} onClick={() => onScene(source.sceneId)}>Read retained scene</button>}</div>
          </>}
        </section>
      </>}
    </>}
    <p className="production-revision-boundary">Planning links carry the saved writing into shot preparation, Blender and generation briefs. Replacing the production screenplay and migrating completed work remain separate, unfinished operations.</p>
  </section>;
}
