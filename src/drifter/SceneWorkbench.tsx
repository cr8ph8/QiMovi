import { useEffect, useMemo, useRef, useState } from 'react';
import { blobUrl } from './api';
import { canonicalJson } from './canonical';
import ScreenplayConnections from './ScreenplayConnections';
import type { ScreenplayConnectionAction } from './screenplayConnectionsModel';
import { buildScenePacket, coverageFor, coverageLabel, coverageSummary, hasCoverageGap, sceneRecords, sourceRefs } from './sceneWorkbenchModel';
import type { CoverageDraft, GenerationBrief, Project, SourceSelectionRequest, WorkspaceApi, WorkspaceRecord } from './types';
import './scene-workbench.css';
import ProductionElementsEditor from './ProductionElementsEditor';
import SceneRequirementsReview from './SceneRequirementsReview';
import { suggestProductionRequirements, type ProductionRequirementSuggestion } from './productionRequirementSuggestions';
import { validateProductionElements } from '../../local/contracts/script-breakdown.mjs';

type Edit = { data: CoverageDraft; baseline?: WorkspaceRecord };
const message = (error: unknown) => error instanceof Error ? error.message : 'The local operation was not confirmed.';
export default function SceneWorkbench({ project, records, api, open, sceneId, onScene, onSaved, onPrepare, onDirty, onElementAction, passageRequest, onOpenStoryboardFlow, onOpenStoryboard, onBudget, onDocuments }: {
  project: Project; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; sceneId: string;
  onScene: (id: string) => void; onSaved: (record: WorkspaceRecord) => void;
  onPrepare?: (request: SourceSelectionRequest) => void; onDirty?: (dirty: boolean) => void;
  onElementAction?: (action: ScreenplayConnectionAction, sceneId: string, paragraphId: string) => void;
  onBudget?: (targetId: string) => void; onDocuments?: () => void;
  onOpenStoryboardFlow?: () => void;
  onOpenStoryboard?: (sceneId: string, shotId?: string, cellId?: string) => void;
  passageRequest?: { sceneId: string; paragraphId: string; nonce: number; work?: 'breakdown' };
}) {
  const [activeIds, setActiveIds] = useState<Record<string, string>>({});
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [inspectorTab, setInspectorTab] = useState<'mapping' | 'breakdown' | 'tools'>('mapping');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pendingSave = useRef(false);
  const alive = useRef(true), attempts = useRef<Record<string, { fingerprint: string; requestId: string }>>({});
  const appliedPassageRequest = useRef<typeof passageRequest>();
  const currentProject = useRef(project); currentProject.current = project;
  const scene = project.scenes.find(item => item.id === sceneId) ?? project.scenes[0];
  const paragraphs = useMemo(() => sceneId === '__prologue__' ? project.prologue ?? [] : scene.paragraphs, [sceneId, project.prologue, scene.paragraphs]);
  const isPrologue = sceneId === '__prologue__';
  const active = paragraphs.find(item => item.id === activeIds[sceneId]) ?? paragraphs[0];
  const selected = selections[sceneId] ?? [];
  const summary = coverageSummary(paragraphs, records);
  const filmSummary = coverageSummary([...(project.prologue ?? []), ...project.scenes.flatMap(item => item.paragraphs)], records);
  const current = active && coverageFor(records, active.id);
  const base = current?.data as CoverageDraft | undefined;
  const edit = active && edits[active.id];
  const data = edit?.data ?? base;
  const dirty = Object.keys(edits).length > 0;
  const visible = paragraphs.filter(item => {
    const value = coverageFor(records, item.id)?.data as CoverageDraft | undefined;
    return (filter !== 'gaps' || hasCoverageGap(value)) && (filter !== 'dialogue' || item.type === 'Dialogue') && (filter !== 'selected' || selected.includes(item.id)) && `${item.id} ${item.text}`.toLowerCase().includes(query.toLowerCase());
  });
  const selectedShots = scene.shots.filter(shot => selected.some(id => (coverageFor(records, id)?.data as CoverageDraft | undefined)?.shotIds.includes(shot.id))).map(shot => shot.id);
  const selectedWithoutShot = selected.filter(id => !(coverageFor(records, id)?.data as CoverageDraft | undefined)?.shotIds.some(shot => selectedShots.includes(shot)));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!passageRequest || passageRequest === appliedPassageRequest.current || passageRequest.sceneId !== sceneId || !paragraphs.some(item => item.id === passageRequest.paragraphId)) return;
    appliedPassageRequest.current = passageRequest;
    setActiveIds(previous => ({ ...previous, [sceneId]: passageRequest.paragraphId }));
    setSelections(previous => ({ ...previous, [sceneId]: [passageRequest.paragraphId] }));
    setFilter('selected'); setQuery(''); setInspectorTab(passageRequest.work ?? 'mapping');
    setNotice('Passage selected for clip planning. Review its saved shot associations, then prepare the selected passage.');
  }, [passageRequest, sceneId, paragraphs]);
  function chooseScene(id: string) {
    onScene(id); setFilter('all'); setQuery(''); setInspectorTab('mapping'); setNotice(''); setError('');
  }
  function openStoryboard(targetSceneId: string, shotId?: string, cellId?: string) {
    if (busy || !onOpenStoryboard) return;
    const targetScene = project.scenes.find(item => item.id === targetSceneId);
    if (!targetScene || shotId && !targetScene.shots.some(shot => shot.id === shotId)
      || cellId && (!shotId || !project.cells.some(cell => cell.id === cellId && cell.sceneId === targetSceneId && cell.shotId === shotId))) {
      setError('That storyboard target is unavailable. Refresh its source link before continuing.'); return;
    }
    onOpenStoryboard(targetSceneId, shotId, cellId);
  }
  function openConnection(action: ScreenplayConnectionAction) {
    if (!active || busy) return;
    if (action === 'generation' && !isPrologue) {
      setSelections(previous => ({ ...previous, [sceneId]: [active.id] }));
      setFilter('selected'); setQuery(''); setInspectorTab('mapping');
      setNotice('Passage selected for clip planning. Save any mapping edits, then use Prepare selected passages below.');
    } else onElementAction?.(action, sceneId, active.id);
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function update(patch: Partial<CoverageDraft>) {
    if (!active || busy) return;
    setEdits(previous => {
      const prior = previous[active.id];
      return { ...previous, [active.id]: { baseline: prior?.baseline ?? current, data: { ...(prior?.data ?? base ?? { sourceHash: project.sourceHash, paragraphId: active.id, shotIds: [], takeIds: [], note: '' }), ...patch } } };
    }); setNotice(''); setError('');
  }
  function addRequirements(suggestions: ProductionRequirementSuggestion[]) {
    if (busy || !suggestions.length) return;
    const available = new Set(requirementSuggestions.map(item => item.id));
    const chosen = suggestions.filter(item => available.has(item.id));
    setEdits(previous => {
      const next = { ...previous };
      for (const item of chosen) {
        const saved = coverageFor(records, item.paragraphId);
        const prior = next[item.paragraphId];
        const data = prior?.data ?? saved?.data as CoverageDraft | undefined;
        const elements = data?.productionElements ?? [];
        if (elements.length >= 100 || elements.some(element => element.id === item.element.id)) continue;
        next[item.paragraphId] = { baseline: prior?.baseline ?? saved, data: {
          ...(data ?? { sourceHash: project.sourceHash, paragraphId: item.paragraphId, shotIds: [], takeIds: [], note: '' }),
          productionElements: [...elements, structuredClone(item.element)],
        } };
      }
      return next;
    });
    setInspectorTab('breakdown');
    setNotice('Selected requirements added to this scene’s draft. Review each passage, then save the scene breakdown.'); setError('');
  }
  async function savePassages(ids: string[], sceneBatch = false) {
    if (busy || pendingSave.current) return;
    const capturedProject = { id: project.id, sourceHash: project.sourceHash };
    const captured = ids.flatMap(paragraphId => edits[paragraphId] ? [{ paragraphId, edit: structuredClone(edits[paragraphId]) }] : []);
    if (!captured.length) return;
    try {
      for (const { edit: entry } of captured) {
        validateProductionElements(entry.data.productionElements ?? []);
        if (entry.data.sourceHash !== capturedProject.sourceHash) throw new Error('The screenplay source changed. Reopen the project before saving.');
        if (entry.data.disposition === 'MAPPED' && !entry.data.shotIds.length
          || ['NEEDS_SHOT', 'NOT_APPLICABLE'].includes(entry.data.disposition ?? '') && entry.data.shotIds.length
          || entry.data.disposition === 'NOT_APPLICABLE' && !entry.data.rationale?.trim()) throw new Error('Resolve the shot mapping in each edited passage before saving this scene.');
      }
    } catch (caught) { setError(message(caught)); return; }
    pendingSave.current = true; setBusy(true); setError(''); setNotice('');
    let savedCount = 0;
    try {
      for (const { paragraphId, edit: entry } of captured) {
        if (!alive.current || currentProject.current.id !== capturedProject.id || currentProject.current.sourceHash !== capturedProject.sourceHash) return;
        const id = `coverage-draft:${paragraphId}`, expectedVersion = entry.baseline?.version ?? null;
        const fingerprint = canonicalJson({ id, expectedVersion, data: entry.data });
        if (attempts.current[id]?.fingerprint !== fingerprint) attempts.current[id] = { fingerprint, requestId: crypto.randomUUID() };
        const saved = await api.saveRecord({ id, kind: 'coverage-draft', expectedVersion, data: entry.data, requestId: attempts.current[id].requestId });
        if (saved.id !== id || saved.kind !== 'coverage-draft' || saved.version !== (expectedVersion ?? 0) + 1 || canonicalJson(saved.data) !== canonicalJson(entry.data)) throw new Error('The save response did not match this mapping. Your edits are retained.');
        if (!alive.current || currentProject.current.id !== capturedProject.id || currentProject.current.sourceHash !== capturedProject.sourceHash) return;
        onSaved(saved); savedCount++;
        setEdits(previous => { const next = { ...previous }; delete next[paragraphId]; return next; });
        setNotice(sceneBatch ? `Scene breakdown saved · ${savedCount} of ${captured.length} passages. Requirements are available in Budget.` : `${paragraphId} mapping saved · v${saved.version}. Breakdown and shot associations share this revision.`);
      }
    } catch (caught) { if (alive.current) setError(`${sceneBatch ? `${savedCount} of ${captured.length} passages saved. ` : ''}${message(caught)} Remaining edits are retained. Refresh saved records to inspect a conflict before discarding or retrying.`); }
    finally { pendingSave.current = false; if (alive.current) setBusy(false); }
  }
  async function save() { if (active) await savePassages([active.id]); }
  async function prepare() {
    if (!onPrepare || isPrologue || busy || !selected.length || selectedWithoutShot.length || selected.some(id => edits[id])) return;
    setBusy(true); setError('');
    try {
      const passages = await sourceRefs(scene, selected);
      if (alive.current) onPrepare({ sourceHash: project.sourceHash, sceneId: scene.id, shotIds: selectedShots, passages, nonce: Date.now() });
    } catch (caught) { if (alive.current) setError(message(caught)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function exportPacket() {
    if (isPrologue || busy) return;
    setBusy(true); setError('');
    try {
      const before = await api.bootstrap();
      if (before.project.id !== project.id || before.project.sourceHash !== project.sourceHash) throw new Error('The workspace source changed. Reopen the project.');
      const snapshot = before.project.scenes.find(item => item.id === scene.id);
      if (!snapshot || canonicalJson(snapshot.paragraphs) !== canonicalJson(scene.paragraphs)) throw new Error('The scene source changed. Refresh before exporting.');
      const packet = await buildScenePacket(before.project, snapshot, before.records);
      const after = await api.bootstrap();
      if (after.project.sourceHash !== project.sourceHash || canonicalJson(sceneRecords(snapshot, before.records)) !== canonicalJson(sceneRecords(snapshot, after.records)) || canonicalJson(before.project.cells.filter(item => item.sceneId === scene.id)) !== canonicalJson(after.project.cells.filter(item => item.sceneId === scene.id))) throw new Error('Saved scene inputs changed during export. Export again after reviewing the current records.');
      if (!alive.current || currentProject.current.sourceHash !== project.sourceHash) return;
      const blob = new Blob([new Uint8Array(packet.bytes)], { type: 'application/zip' }), url = URL.createObjectURL(blob);
      const release = () => { URL.revokeObjectURL(url); window.removeEventListener('pagehide', release); };
      window.addEventListener('pagehide', release, { once: true });
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `caniscreenwrite-scene-${scene.index}-planning.zip`;
      try { anchor.click(); } catch (caught) { release(); throw caught; }
      setNotice('Scene packet prepared from saved records. Finish the Save dialog to keep the ZIP. Unsaved passage edits are excluded.');
    } catch (caught) { if (alive.current) setError(message(caught)); }
    finally { if (alive.current) setBusy(false); }
  }
  const badDisposition = data?.disposition === 'MAPPED' && !data.shotIds.length || ['NEEDS_SHOT', 'NOT_APPLICABLE'].includes(data?.disposition ?? '') && Boolean(data?.shotIds.length) || data?.disposition === 'NOT_APPLICABLE' && !data.rationale?.trim();
  let invalidElements = false;
  try { validateProductionElements(data?.productionElements ?? []); } catch { invalidElements = true; }
  const requirementSuggestions = suggestProductionRequirements({ id: isPrologue ? '__prologue__' : scene.id, paragraphs }, Object.fromEntries(paragraphs.map(paragraph => [paragraph.id, (edits[paragraph.id]?.data ?? coverageFor(records, paragraph.id)?.data as CoverageDraft | undefined)?.productionElements ?? []])));
  const sceneEditIds = paragraphs.filter(paragraph => edits[paragraph.id]).map(paragraph => paragraph.id);
  const savedElementCount = paragraphs.reduce((total, paragraph) => total + ((coverageFor(records, paragraph.id)?.data as CoverageDraft | undefined)?.productionElements?.length ?? 0), 0);
  const discard = () => { if (active) setEdits(previous => { const next = { ...previous }; delete next[active.id]; return next; }); };
  return <section className="scene-workbench" hidden={!open} data-unsaved={dirty ? 'true' : 'false'} aria-label="Scene Workbench">
    <div className="sw-project-bar"><span>Script → breakdown → shot plan → clip preparation</span><button className="secondary" disabled={busy} onClick={() => setInspectorTab('breakdown')}>Script breakdown · {savedElementCount} saved elements</button>{onDocuments && <button className="secondary" disabled={busy} onClick={onDocuments}>Build documents</button>}{(onOpenStoryboard || onOpenStoryboardFlow) && <button className="secondary" disabled={busy || isPrologue} onClick={() => onOpenStoryboard ? openStoryboard(scene.id) : onOpenStoryboardFlow?.()}>Storyboard flow →</button>}<details><summary>Coverage summary</summary><p className="scope-note">{filmSummary.total} retained paragraphs · {filmSummary.proposed} proposed mappings · {filmSummary.gaps} unresolved · {filmSummary.mapped} mapped for planning. Filmed coverage is unverified.</p></details><button className="secondary" disabled={busy || isPrologue} onClick={() => void exportPacket()}>Export scene packet</button></div>
    <div className="sw-layout">
      <nav className="sw-scenes" aria-label="Source scene index"><span className="sw-rail-label">Scenes</span>{Boolean(project.prologue?.length) && <button disabled={busy} aria-current={isPrologue ? 'page' : undefined} onClick={() => chooseScene('__prologue__')}><b>—</b><span>Opening text</span><small>{project.prologue?.length} paragraph</small></button>}{project.scenes.map(item => {
        const count = coverageSummary(item.paragraphs, records);
        return <button key={item.id} disabled={busy} aria-current={sceneId === item.id ? 'page' : undefined} onClick={() => chooseScene(item.id)}><b>{String(item.index).padStart(2, '0')}</b><span>{item.heading}</span><small>{count.gaps} unresolved · {item.shots.length} shots</small></button>;
      })}</nav>
      <div className="sw-main">
        <header className="sw-title"><div><span className="eyebrow">{isPrologue ? 'RETAINED OPENING TEXT' : `RETAINED SCENE ${scene.index}`}</span><h2>{isPrologue ? 'Opening text' : scene.heading}</h2></div><p>{summary.total} paragraphs · {summary.gaps} unresolved</p></header>
        {notice && <p className="canis-notice" role="status">{notice}</p>}{error && <p className="error-bar" role="alert">{error}</p>}
        {inspectorTab === 'breakdown' && <SceneRequirementsReview key={`${project.id}:${project.sourceHash}:${sceneId}`} suggestions={requirementSuggestions} disabled={busy} editedPassages={sceneEditIds.length} onAdd={addRequirements} onSave={() => void savePassages(sceneEditIds, true)} onInspect={paragraphId => { setActiveIds(previous => ({ ...previous, [sceneId]: paragraphId })); setFilter('all'); setQuery(''); }}/>}
        <div className="sw-tools"><label>Find a passage<input aria-label="Find source passage" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find in this scene…"/></label><label>Show<select aria-label="Source passage filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All passages</option><option value="gaps">Unresolved coverage</option><option value="dialogue">Dialogue</option><option value="selected">Selected for clip</option></select></label><span>{visible.length} shown</span></div>
        <div className="sw-desk"><div className="sw-passages" role="list" aria-label="Exact source passages">{visible.map(paragraph => {
          const saved = coverageFor(records, paragraph.id), value = saved?.data as CoverageDraft | undefined;
          return <article role="listitem" key={paragraph.id} className={active?.id === paragraph.id ? 'sw-active' : ''}><div className="sw-passage-line"><label><input aria-label={`Select ${paragraph.id} for clip`} type="checkbox" checked={selected.includes(paragraph.id)} disabled={busy || isPrologue || !selected.includes(paragraph.id) && selected.length >= 80} onChange={event => setSelections(previous => ({ ...previous, [sceneId]: event.target.checked ? [...selected, paragraph.id] : selected.filter(id => id !== paragraph.id) }))}/><span>{paragraph.type}</span></label><small>{edits[paragraph.id] ? 'Unsaved planning' : `${value?.productionElements?.length ?? 0} elements · ${coverageLabel(value)}`}</small></div><button className="sw-source-text" aria-label={`Inspect ${paragraph.id}`} aria-pressed={active?.id === paragraph.id} onClick={() => setActiveIds(previous => ({ ...previous, [sceneId]: paragraph.id }))}><span className={`sw-paragraph-${paragraph.type.toLowerCase().replace(/\s/g, '-')}`}>{paragraph.text || '〔Empty source paragraph〕'}</span></button><div className="sw-mapping-line"><span>{value?.shotIds.length ? value.shotIds.map(id => { const target = project.scenes.find(item => item.shots.some(shot => shot.id === id)); const label = target?.shots.find(shot => shot.id === id)?.label ?? id; return onOpenStoryboard ? <button className="text-link" key={id} disabled={busy || !target} aria-label={`Open ${paragraph.id} storyboard shot ${label}`} onClick={() => target && openStoryboard(target.id, id)}>{label}</button> : <span key={id}>{label} </span>; }) : 'No shot association'}</span><small>{paragraph.id}</small></div></article>;
        })}{!visible.length && <p className="scope-note">No passages match this filter. Your selection is retained.</p>}</div>
        <aside className="sw-inspector" aria-label="Passage mapping inspector">{active && <><div className="sw-inspector-heading"><strong>{active.type}</strong><small>{active.id}</small></div><div className="sw-inspector-tabs" role="tablist" aria-label="Selected passage work"><button role="tab" aria-selected={inspectorTab === 'mapping'} aria-controls="sw-mapping-panel" id="sw-mapping-tab" onClick={() => setInspectorTab('mapping')}>Shot mapping</button><button role="tab" aria-selected={inspectorTab === 'breakdown'} aria-controls="sw-breakdown-panel" id="sw-breakdown-tab" onClick={() => setInspectorTab('breakdown')}>Breakdown</button><button role="tab" aria-selected={inspectorTab === 'tools'} aria-controls="sw-tools-panel" id="sw-tools-tab" onClick={() => setInspectorTab('tools')}>Related tools</button></div>{inspectorTab === 'mapping' && <div role="tabpanel" id="sw-mapping-panel" aria-labelledby="sw-mapping-tab"><fieldset disabled={busy}><legend>Proposed shots</legend>{(isPrologue ? project.scenes.flatMap(item => item.shots) : scene.shots).map(shot => <label className="sw-shot-choice" key={shot.id}><input aria-label={`Map ${active.id} to ${shot.label}`} type="checkbox" checked={data?.shotIds.includes(shot.id) ?? false} onChange={event => update({ shotIds: (isPrologue ? project.scenes.flatMap(item => item.shots) : scene.shots).filter(item => item.id === shot.id ? event.target.checked : data?.shotIds.includes(item.id)).map(item => item.id), disposition: 'PROPOSED' })}/><span><b>{shot.label}</b>{shot.description}</span></label>)}<label className="field-label">Planning disposition<select aria-label="Coverage planning disposition" value={data?.disposition ?? 'PROPOSED'} onChange={event => update({ disposition: event.target.value as CoverageDraft['disposition'] })}><option value="PROPOSED">Proposed · needs review</option><option value="MAPPED">Mapped for planning</option><option value="NEEDS_SHOT">Needs a shot · clear associations first</option><option value="NOT_APPLICABLE">Not applicable · explain below</option></select></label><label className="field-label">Mapping rationale<textarea aria-label="Coverage mapping rationale" rows={4} maxLength={4000} value={data?.rationale ?? ''} onChange={event => update({ rationale: event.target.value })}/></label></fieldset>{badDisposition && <p className="quiet-warning">A mapped passage needs a shot. Needs-shot and not-applicable dispositions require empty associations; not-applicable also needs a rationale.</p>}{base?.note && <details className="sw-prior" open={/^GAP\b/.test(base.note)}><summary>Retained proposal and continuity notes</summary><pre>{base.note}</pre></details>}<p className="scope-note">Shot mappings and breakdown elements save together for this passage. Discarding passage edits restores both to the saved version.</p><div className="sw-actions"><button className="primary" disabled={!edit || busy || Boolean(badDisposition) || invalidElements} onClick={() => void save()}>Save mapping proposal</button>{edit && <button className="secondary" disabled={busy} onClick={() => setEdits(previous => { const next = { ...previous }; delete next[active.id]; return next; })}>Discard passage edits</button>}</div></div>}{inspectorTab === 'breakdown' && <div role="tabpanel" id="sw-breakdown-panel" aria-labelledby="sw-breakdown-tab"><ProductionElementsEditor elements={data?.productionElements ?? []} paragraphId={active.id} disabled={busy} saved={!edit && Boolean(current)} onChange={productionElements => update({ productionElements })} onBudget={onBudget}/>{invalidElements && <p className="quiet-warning">Enter a name for each element. Quantity must be a whole number from 1 to 10,000 or unknown.</p>}{badDisposition && <p className="quiet-warning">Resolve the current shot mapping before saving this shared passage record.</p>}<div className="sw-actions"><button className="primary" disabled={!edit || busy || Boolean(badDisposition) || invalidElements} onClick={() => void save()}>Save breakdown</button>{edit && <button className="secondary" disabled={busy} onClick={discard}>Discard passage edits</button>}</div></div>}{inspectorTab === 'tools' && <div role="tabpanel" id="sw-tools-panel" aria-labelledby="sw-tools-tab"><ScreenplayConnections element={active} sourceLabel={isPrologue ? 'Retained opening text' : `Retained scene ${scene.index}`} disabled={busy} onAction={onElementAction ? openConnection : undefined}/></div>}</>}</aside></div>
        {!isPrologue && <><footer className="sw-selection"><div><strong>{selected.length} passages selected</strong><p>{selectedShots.length ? `Proposed shots: ${selectedShots.map(id => scene.shots.find(item => item.id === id)?.label).join(', ')}` : 'Select passages with saved shot associations.'}</p>{selectedWithoutShot.length > 0 && <small>{selectedWithoutShot.length} selected passages need a saved shot association before clip preparation.</small>}{selected.some(id => edits[id]) && <small>Save or discard selected mapping edits before preparing.</small>}</div><div><button className="secondary" disabled={busy || !selected.length} onClick={() => setSelections(previous => ({ ...previous, [sceneId]: [] }))}>Clear selection</button><button className="primary" disabled={busy || !onPrepare || !selected.length || selectedWithoutShot.length > 0 || selected.some(id => edits[id])} onClick={() => void prepare()}>Prepare selected passages →</button></div></footer><details className="sw-connections"><summary>Storyboards & prepared clips · {scene.shots.length} shots</summary><section className="sw-shot-assets"><h3>Shot connections</h3><p className="scope-note">Saved associations → storyboard candidates → prepared clips. Takes are not yet verified here.</p>{scene.shots.map(shot => {
      const cells = project.cells.filter(item => item.sceneId === scene.id && item.shotId === shot.id);
      const briefs = records.filter(item => item.kind === 'generation-brief' && (item.data as GenerationBrief).sceneId === scene.id && (item.data as GenerationBrief).shotIds.includes(shot.id));
      return <div key={shot.id}><b>{onOpenStoryboard ? <button className="text-link" disabled={busy} aria-label={`Open storyboard shot ${shot.label}`} onClick={() => openStoryboard(scene.id, shot.id)}>{shot.label}</button> : shot.label}</b><span>{paragraphs.filter(item => (coverageFor(records, item.id)?.data as CoverageDraft | undefined)?.shotIds.includes(shot.id)).length} passages</span><span>{cells.map(cell => <span key={cell.id} className="sw-cell">{onOpenStoryboard ? <button disabled={busy} aria-label={`Open storyboard cell ${cell.id} for shot ${shot.label}`} onClick={() => openStoryboard(scene.id, shot.id, cell.id)}>{cell.imageHash && <img alt={`${shot.label} ${cell.role} candidate`} src={blobUrl(cell.imageHash)}/>}<small>{cell.role}</small></button> : <>{cell.imageHash && <img alt={`${shot.label} ${cell.role} candidate`} src={blobUrl(cell.imageHash)}/>}<small>{cell.role}</small></>}</span>)}</span><span>{briefs.map(item => <small key={item.id}>{(item.data as GenerationBrief).title} · v{item.version}</small>)}{!briefs.length && <small>No saved clip</small>}</span></div>;
    })}</section></details></>}
        {dirty && <p className="scope-note">{Object.keys(edits).length} unsaved passage edits are retained across scenes and workspace modes.</p>}
      </div>
    </div>
  </section>;
}
