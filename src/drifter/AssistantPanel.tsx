import { useEffect, useRef, useState } from 'react';
import { canonicalJson } from './canonical';
import { modelAssistanceApi, ModelPreparationError, type AssistanceInput, type AssistanceRecord, type ModelAssistanceApi, type ModelStatus } from './modelAssistanceApi';
import type { WritingContext } from './ScreenwritingPanel';
import type { AuthoringInputRef, Project, RecordInput, WorkspaceApi, WorkspaceRecord, WritingNote } from './types';
import { assistantTasks, assistantContextKinds, assistantRecordLabel, retainedAssistantNote, type AssistantTask } from './assistantWorkflow';
import './assistant.css';

export interface UniverseAssistantContext { projectId: string; sourceHash: string; title: string; text: string; nonce: string; profileRef?: AuthoringInputRef }
export interface AssistantPanelProps {
  universeContext?: UniverseAssistantContext | null;
  open: boolean; project: Project; records: WorkspaceRecord[]; sceneId: string; writing?: WritingContext | null;
  api: WorkspaceApi; models?: ModelAssistanceApi; onSaved: (record: WorkspaceRecord) => void; onClose: () => void;
  onGeneration: () => void; onConnections?: () => void;
}
const message = (e: unknown) => e instanceof Error ? e.message : 'The local request could not be confirmed.';
function validProfileReference(value: unknown): value is AuthoringInputRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return Object.keys(ref).sort().join(',') === 'id,sha256'
    && typeof ref.id === 'string' && /^universe-profile:[A-Za-z0-9][A-Za-z0-9._:-]{0,139}$/.test(ref.id)
    && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256);
}
/** Shared inspector, kept mounted across every filmmaking workspace. */
export default function AssistantPanel({ universeContext, open, project, records, sceneId, writing, api, models = modelAssistanceApi, onSaved, onClose, onGeneration, onConnections }: AssistantPanelProps) {
  const [catalog, setCatalog] = useState<ModelStatus | null>(null), [model, setModel] = useState('');
  const [origin, setOrigin] = useState('http://127.0.0.1:11434');
  const [instructions, setInstructions] = useState(''), [useScene, setUseScene] = useState(true);
  const [includeUniverse, setIncludeUniverse] = useState(false);
  const [includeDraft, setIncludeDraft] = useState(false), [refIds, setRefIds] = useState<string[]>([]);
  const [history, setHistory] = useState<AssistanceRecord[]>([]), [result, setResult] = useState<AssistanceRecord | null>(null);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [task, setTask] = useState<AssistantTask | null>(null), [contextSearch, setContextSearch] = useState('');
  const [inspected, setInspected] = useState<string | null>(null), [unconfirmed, setUnconfirmed] = useState(false);
  const [savedNotes, setSavedNotes] = useState<WorkspaceRecord[]>([]);
  const [pitchScope, setPitchScope] = useState<'FULL' | NonNullable<AssistanceInput['pitchScope']>>('NARRATIVE_AND_BUSINESS');
  const pending = useRef<AssistanceInput | null>(null), saveAttempts = useRef(new Map<string, RecordInput<WritingNote>>());
  const requestHeads = useRef(new Map<string, AssistanceRecord>());
  const scope = `${project.id}:${project.sourceHash}`, currentScope = useRef(scope), alive = useRef(true);
  currentScope.current = scope;
  const requestSerial = useRef(0), statusSerial = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { requestSerial.current++; setBusy(false); setSaving(false); setResult(null); setHistory([]); setRefIds([]); setIncludeDraft(false); setTask(null); setContextSearch(''); setError(''); setNotice(''); setInspected(null); setUnconfirmed(false); setSavedNotes([]); pending.current = null; saveAttempts.current.clear(); requestHeads.current.clear(); }, [scope]);
  const selectedUniverse = universeContext?.projectId === project.id && universeContext.sourceHash === project.sourceHash ? universeContext : null;
  useEffect(() => { if (selectedUniverse) setIncludeUniverse(true); else setIncludeUniverse(false); }, [selectedUniverse?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  function rememberRequest(row: AssistanceRecord) {
    const prior = requestHeads.current.get(row.id);
    if (prior && prior.version > row.version) return prior;
    if (prior && prior.version === row.version && prior.sha256 !== row.sha256) throw new Error('Conflicting assistant history. Refresh the local workspace before continuing.');
    requestHeads.current.set(row.id, row); return row;
  }
  function rememberHistory(rows: AssistanceRecord[]) {
    rows.forEach(rememberRequest);
    setHistory([...requestHeads.current.values()].sort((a,b) => b.data.startedAt.localeCompare(a.data.startedAt)));
  }
  async function refresh() {
    const serial = ++statusSerial.current, captured = scope; setChecking(true); setError('');
    try {
      const status = await models.status();
      if (!alive.current || captured !== currentScope.current || serial !== statusSerial.current) return;
      setCatalog(status); if (status.origin) setOrigin(status.origin);
      setModel(old => status.models.some(row => row.name === old) ? old : status.models.find(row => row.name === 'qwen3.5:9b')?.name ?? status.models[0]?.name ?? '');
      const saved = await models.history(project);
      if (alive.current && captured === currentScope.current && serial === statusSerial.current) rememberHistory(saved);
    } catch (e) { if (alive.current && captured === currentScope.current && serial === statusSerial.current) setError(message(e)); }
    finally { if (alive.current && serial === statusSerial.current) setChecking(false); }
  }
  useEffect(() => { if (open) void refresh(); }, [open, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const available = records.filter(row => assistantContextKinds.includes(row.kind) && row.data && typeof row.data === 'object' && 'sourceHash' in row.data && row.data.sourceHash === project.sourceHash);
  const visibleReferences = available.filter(row => `${assistantRecordLabel(row)} ${row.kind}`.toLowerCase().includes(contextSearch.toLowerCase()));
  const scene = project.scenes.find(item => item.id === sceneId);
  const selectedRefs = available.filter(row => refIds.includes(row.id)).map(row => ({ id: row.id, sha256: row.sha256 }));
  const savedDraft = includeDraft && writing?.saved && !writing.dirty ? writing.saved : null;
  if (savedDraft && !selectedRefs.some(ref => ref.id === savedDraft.id)) selectedRefs.push({ id: savedDraft.id, sha256: savedDraft.sha256 });
  const hasUniverseProfile = includeUniverse && selectedUniverse?.profileRef !== undefined;
  const universeProfileRef = hasUniverseProfile && validProfileReference(selectedUniverse?.profileRef) ? selectedUniverse.profileRef : null;
  const profileRecords = universeProfileRef ? records.filter(row => row.id === universeProfileRef.id) : [];
  const universeProfileRecord = profileRecords.length === 1 ? profileRecords[0] : null;
  const universeProfileStale = hasUniverseProfile && (!universeProfileRef || !universeProfileRecord
    || universeProfileRecord.kind !== 'universe-profile' || universeProfileRecord.sha256 !== universeProfileRef.sha256
    || !universeProfileRecord.data || typeof universeProfileRecord.data !== 'object' || !('sourceHash' in universeProfileRecord.data)
    || universeProfileRecord.data.sourceHash !== project.sourceHash
    || !Number.isSafeInteger(universeProfileRecord.version) || universeProfileRecord.version < 1
    || selectedRefs.some(ref => ref.id === universeProfileRef.id && ref.sha256 !== universeProfileRef.sha256));
  // Keep the captured revision. Never substitute a new profile hash under an
  // older universe text snapshot or drop the binding when it becomes stale.
  if (universeProfileRef && !selectedRefs.some(ref => ref.id === universeProfileRef.id)) selectedRefs.push({ ...universeProfileRef });
  const contextFull = selectedRefs.length >= 8, contextOverflow = selectedRefs.length > 8;
  const selectedPitch = available.some(row => row.kind === 'pitch-draft' && selectedRefs.some(ref => ref.id === row.id));
  const requestPitchScope = selectedPitch && pitchScope !== 'FULL' ? pitchScope : undefined;
  const retainedQuestion = result?.data.input.instructions === instructions || history.some(row => row.data.input.instructions === instructions);
  const explicitParts = [includeUniverse && selectedUniverse ? { label: `Universe: ${selectedUniverse.title}`, text: selectedUniverse.text } : null, includeDraft && writing && (writing.dirty || !writing.saved) ? { label: writing.title, text: writing.body } : null].filter((item): item is { label: string; text: string } => Boolean(item));
  const explicitText = explicitParts.length ? { label: explicitParts.map(item => item.label).join(' + ').slice(0, 120), text: explicitParts.length === 1 ? explicitParts[0].text : explicitParts.map(item => `${item.label}\n\n${item.text}`).join('\n\n---\n\n'), explicit: true as const } : null;
  const textOverflow = Boolean(explicitText && explicitText.text.length > 18000);
  const resultStale = result && (result.data.input.instructions !== instructions || result.data.provider.model !== model || result.data.input.pitchScope !== requestPitchScope || canonicalJson(result.data.input.unsavedText) !== canonicalJson(explicitText) ||result.data.sceneId !== (useScene ? sceneId : null) || canonicalJson([...result.data.input.contextRefs].sort((a,b) => a.id.localeCompare(b.id))) !== canonicalJson([...selectedRefs].sort((a,b) => a.id.localeCompare(b.id))) || result.data.input.contextRefs.some(ref => !records.some(row => row.id === ref.id && row.sha256 === ref.sha256)));
  const keptNote = retainedAssistantNote([...records, ...savedNotes], result);
  const canRun = catalog?.status === 'AVAILABLE' && model && instructions.trim() && !busy && !saving && !checking && !unconfirmed && !contextOverflow && !textOverflow && !universeProfileStale && (!useScene || Boolean(scene));
  function chooseTask(next: AssistantTask) { setTask(next); setInstructions(next.prompt); setUseScene(next.scope === 'SCENE'); }
  function useProjectInputs() {
    if (!task) return;
    const kinds: readonly string[] = task.kinds;
    const matches = available.filter(row => kinds.includes(row.kind)).sort((a,b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.id.localeCompare(b.id));
    const reserved = new Set([savedDraft?.id, universeProfileRef?.id].filter(Boolean));
    const chosen = matches.filter(row => !reserved.has(row.id)).slice(0, 8 - reserved.size);
    setRefIds(chosen.map(row => row.id)); setContextSearch('');
    setNotice(`${chosen.length} saved inputs selected. Review the checked records before asking.${matches.length > chosen.length + reserved.size ? ' More records are available; choose the most relevant eight.' : ''}`);
  }
  async function connect() { setChecking(true); setError(''); try { await models.configure(origin); await refresh(); } catch (e) { setError(message(e)); } finally { setChecking(false); } }
  async function ask() {
    if (!canRun) return;
    const input: AssistanceInput = { schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash, sceneId: useScene ? sceneId : null, requestId: crypto.randomUUID(), model, instructions,
      contextRefs: selectedRefs, unsavedText: explicitText, creativeRequestRef: null, maxOutputTokens: 1024, contextFormat: 'PROJECT_CONTEXT_V1', ...(requestPitchScope ? { pitchScope: requestPitchScope } : {}) };
    const serial = ++requestSerial.current, captured = scope; pending.current = input; setBusy(true); setError(''); setNotice(''); setResult(null);
    try {
      const saved = await models.run(input, project);
      if (!alive.current || captured !== currentScope.current || serial !== requestSerial.current) return;
      const current = rememberRequest(saved); setResult(current); rememberHistory([current]); setUnconfirmed(current.data.status === 'STARTED'); onSaved(current);
      setNotice(saved.data.status === 'COMPLETED' ? 'Suggestion saved. Choose what to keep.' : 'Request retained. Review its status before trying again.');
    } catch (e) { if (alive.current && captured === currentScope.current && serial === requestSerial.current) {
      if (e instanceof ModelPreparationError) { pending.current = null; setUnconfirmed(false); setError(message(e)); }
      else { setUnconfirmed(true); setError(`${message(e)} Use Check result to recover this request; it will not generate again.`); }
    } }
    finally { if (alive.current && serial === requestSerial.current) setBusy(false); }
  }
  async function recover() {
    const captured = scope, serial = requestSerial.current, requestId = pending.current?.requestId; setError('');
    try {
      const rows = await models.history(project);
      if (!alive.current || captured !== currentScope.current || serial !== requestSerial.current || requestId !== pending.current?.requestId) return;
      rememberHistory(rows); const saved = rows.find(row => row.data.requestId === requestId);
      if (saved) { const current = rememberRequest(saved); setResult(current); setUnconfirmed(current.data.status === 'STARTED'); onSaved(current); }
      else setNotice('No saved request found. No generation was retried.');
    } catch (e) { if (alive.current && captured === currentScope.current && serial === requestSerial.current) setError(message(e)); }
  }
  async function cancel() {
    if (!pending.current) return;
    const { projectId, sourceHash, requestId } = pending.current, captured = scope, serial = requestSerial.current;
    const isCurrent = () => alive.current && captured === currentScope.current && serial === requestSerial.current && requestId === pending.current?.requestId;
    try {
      await models.cancel({ projectId, sourceHash, requestId });
      if (!isCurrent()) return;
      setNotice('Cancellation requested for this assistant request.'); await recover();
    } catch (e) { if (isCurrent()) setError(message(e)); }
  }
  async function keepNote() {
    if (!result?.data.output || saving || keptNote) return;
    const captured = scope;
    const data: WritingNote = { sourceHash: project.sourceHash, title: `AI note · ${result.data.input.instructions.slice(0, 70).replace(/[\r\n]+/g, ' ') || 'Creative assistance'}`, body: result.data.output.text, category: 'REVISION', tags: ['ai-assistance', 'local-model', 'proposal'], inputRefs: [] };
    // Provider history records own the complete prompt/model/provenance. The
    // editable note quotes that exact result explicitly, never claims authority.
    data.body += `\n\nAssistant result: ${result.id} @ ${result.sha256}\nModel: ${result.data.provider.model}\nStatus: unreviewed suggestion`;
    const fingerprint = canonicalJson(data); let attempt = saveAttempts.current.get(fingerprint);
    if (!attempt) { const id = `writing-note:${crypto.randomUUID()}`; attempt = { id, kind: 'writing-note', expectedVersion: null, requestId: crypto.randomUUID(), data }; saveAttempts.current.set(fingerprint, attempt); }
    setSaving(true); setError('');
    try {
      const saved = await api.saveRecord(attempt, project);
      if (!alive.current || captured !== currentScope.current) return;
      if (!api.history) throw new Error('The save returned, but history verification is unavailable. Retry to confirm the same note.');
      const history = await api.history(saved.id, project);
      if (!alive.current || captured !== currentScope.current) return;
      if (!history.some(row => row.id === saved.id && row.kind === 'writing-note' && row.version === saved.version && row.sha256 === saved.sha256 && canonicalJson(row.data) === canonicalJson(attempt.data))) throw new Error('The note could not be read back from saved history. Retry to confirm the same note.');
      setSavedNotes(prior => [...prior.filter(row => row.id !== saved.id), saved]); onSaved(saved); setNotice('Saved to Library notes as a separate editable suggestion.');
    } catch (e) { if (alive.current && captured === currentScope.current) setError(message(e)); } finally { if (alive.current && captured === currentScope.current) setSaving(false); }
  }
  return <aside className="assistant-panel" aria-label="Project AI assistant" hidden={!open} data-unsaved={instructions.trim() !== '' && !retainedQuestion || busy || saving || unconfirmed}>
    <header><div><span className="eyebrow">QIMOVI · LOCAL ASSISTANCE</span><h2>Assistant</h2></div><button aria-label="Close assistant" onClick={onClose}>×</button></header>
    <p className="assistant-context">{project.title}<br/><span>{useScene ? scene?.heading ?? 'Choose a scene' : 'Project overview'}</span></p>
    <div className="assistant-suggestions" aria-label="Assistant tasks">{assistantTasks.map(next => <button key={next.label} aria-pressed={task?.label === next.label} disabled={busy || saving} onClick={() => chooseTask(next)}>{next.label}</button>)}</div>
    <section className="assistant-progress" aria-label="Assistant workflow">
      <div><small>01 · INPUTS</small><strong>{useScene ? 'Selected scene' : 'Whole project'}</strong><span>{selectedRefs.length} saved references{explicitText ? ' · selected draft text' : ''}</span></div>
      <div><small>02 · RESULT</small><strong>{busy ? 'Working locally' : unconfirmed ? 'Check request' : !result ? 'Not requested' : result.data.status === 'COMPLETED' ? resultStale ? 'Earlier context' : 'Ready for review' : result.data.status === 'STARTED' ? 'In progress' : 'Stopped'}</strong><span>{result?.data.output ? 'Retained in request history' : 'Suggestions remain separate'}</span></div>
      <div><small>03 · NOTE</small><strong>{saving ? 'Verifying save' : keptNote ? `Saved · v${keptNote.version}` : 'Not kept yet'}</strong><span>{keptNote ? 'Separate editable suggestion' : 'Review, then keep what helps'}</span></div>
    </section>
    <div className="assistant-status"><span>{catalog?.status === 'AVAILABLE' ? '● Local Qwen available' : catalog?.status === 'UNCONFIGURED' ? 'Connect a local model' : catalog?.status === 'UNAVAILABLE' ? 'Local model unavailable' : 'Checking local models…'}</span><button disabled={checking} onClick={() => void refresh()}>Refresh</button></div>
    {catalog?.status !== 'AVAILABLE' && <div className="assistant-connection"><label>Ollama address<input value={origin} disabled={checking} onChange={e => setOrigin(e.target.value)} /></label><button disabled={checking} onClick={() => void connect()}>Connect Ollama on this Mac</button><p>Start Ollama with an installed Qwen model. Connecting does not download models.</p></div>}
    <label>Model<select value={model} disabled={busy} onChange={e => setModel(e.target.value)}><option value="">Choose an installed model</option>{catalog?.models.map(row => <option key={row.name} value={row.name}>{row.name}</option>)}</select></label>
    <label className="assistant-check"><input type="checkbox" checked={useScene} disabled={busy} onChange={e => setUseScene(e.target.checked)} />Include selected scene text</label>
    {writing && <label className="assistant-check"><input type="checkbox" checked={includeDraft} disabled={busy} onChange={e => setIncludeDraft(e.target.checked)} />Include open draft: {writing.title}{writing.dirty ? ' (unsaved text)' : ''}</label>}
    {selectedUniverse && <div><label className="assistant-check"><input type="checkbox" checked={includeUniverse} disabled={busy} onChange={e => setIncludeUniverse(e.target.checked)}/>Include universe selection: {selectedUniverse.title}</label>{hasUniverseProfile && !universeProfileStale && <small>Saved world profile v{universeProfileRecord?.version} included for author review.</small>}<details><summary>Selected universe sources</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>{selectedUniverse.text}</pre></details></div>}
    {universeProfileStale && <p role="alert">The selected world profile is missing, changed or invalid. Reopen the entry to use its current profile, or deselect the universe selection.</p>}
    {textOverflow && <p role="alert">The selected universe and draft text exceed 18,000 characters. Deselect one or shorten the draft before sending.</p>}
    <section className="assistant-context-picker" aria-label="Saved project context"><div className="assistant-section-heading"><h3>Saved context ({selectedRefs.length}/8)</h3>{task && <button disabled={busy || saving} onClick={useProjectInputs}>Use {task.scope === 'PROJECT' ? 'project' : 'saved'} inputs</button>}</div>
      {task?.scope === 'PROJECT' && <p>{task.label === 'Budget' ? 'Select a saved budget to inspect its rates and assumptions. Unsaved budget edits are not included.' : task.label === 'Rights' ? 'Select saved documents, casting records and project direction. These are review inputs; signatures and permissions are not inferred.' : 'Select the saved project pitch and direction. Scene text is optional.'}</p>}
      {task?.label === 'Budget' && !available.some(row => row.kind === 'production-budget') && <p className="assistant-missing">No budget is saved for this project yet. Save a budget before asking for a cost review.</p>}
      {available.length > 0 ? <><label>Find saved context<input type="search" value={contextSearch} onChange={e => setContextSearch(e.target.value)} placeholder="Pitch, budget, casting, documents…"/></label><div className="assistant-references">{visibleReferences.map(row => <div key={row.id} className="assistant-reference-row"><label><input type="checkbox" checked={refIds.includes(row.id)} disabled={busy || !refIds.includes(row.id) && contextFull && row.id !== savedDraft?.id} onChange={e => setRefIds(prior => e.target.checked ? [...prior, row.id] : prior.filter(id => id !== row.id))}/>{assistantRecordLabel(row)} <small>v{row.version}</small></label><button aria-label={`Inspect ${assistantRecordLabel(row)}`} onClick={() => setInspected(inspected === row.id ? null : row.id)}>Inspect</button>{inspected === row.id && <div className="assistant-source-preview"><small>{row.kind} · {row.id} · v{row.version}</small><code>{row.sha256}</code><pre>{JSON.stringify(row.data, null, 2)}</pre></div>}</div>)}{!visibleReferences.length && <p>No saved records match this search.</p>}</div></> : <p>No saved project inputs yet. Save your pitch, budget or writing to include it here.</p>}
    </section>
    {selectedPitch && <div className="assistant-pitch-scope"><label>Pitch content<select value={pitchScope} disabled={busy} onChange={e => setPitchScope(e.target.value as typeof pitchScope)}><option value="NARRATIVE_AND_BUSINESS">Story & business fields</option><option value="PRESENTATION">Presentation pages</option><option value="FULL">Complete saved record</option></select></label><p>{pitchScope === 'NARRATIVE_AND_BUSINESS' ? 'Includes saved story and business fields. Presentation pages and layout are excluded from this request.' : pitchScope === 'PRESENTATION' ? 'Includes presentation pages plus title and source references. Other story and business fields are excluded from this request.' : 'Includes all saved fields. Large pitches may exceed the local context limit.'} The full saved pitch stays unchanged.</p></div>}
    {contextOverflow && <p role="alert">Choose at most eight saved references, including the open draft and world profile. Remove one reference to continue.</p>}
    <label>What would you like help with?<textarea rows={5} maxLength={5000} value={instructions} disabled={busy} onChange={e => setInstructions(e.target.value)} placeholder="Develop a scene, compare choices, refine a prompt…" /></label>
    <div className="assistant-actions"><button className="assistant-primary" disabled={!canRun} onClick={() => void ask()}>{busy ? 'Thinking locally…' : 'Ask assistant'}</button>{busy && <button onClick={() => void cancel()}>Cancel request</button>}{pending.current && <button onClick={() => void recover()}>Check result</button>}<button disabled={busy || !instructions} onClick={() => { setInstructions(''); setError(''); setNotice('Question cleared. Saved results remain in previous requests.'); }}>Clear question</button></div>
    {unconfirmed && <p className="assistant-recovery">The previous request has not been confirmed. Check its history before running again. <button disabled={busy} onClick={() => { pending.current = null; setUnconfirmed(false); setError(''); setNotice('Ready for a new request. The previous request may still exist in history.'); }}>Prepare another request</button></p>}
    {error && <p role="alert" className="error-text">{error}</p>}{notice && <p role="status">{notice}</p>}
    {result && <section className="assistant-result" aria-label="Assistant result"><div><strong>{result.data.provider.model}</strong><span>{result.data.status.toLowerCase()}</span></div>{resultStale && <p>Earlier context. This result retains its original question, model, scene and references.</p>}{result.data.output ? <><pre>{result.data.output.text}</pre><p className="assistant-usage">Input {result.data.output.promptTokens ?? 'unknown'} · Output {result.data.output.outputTokens ?? 'unknown'} tokens · Local cost unmeasured</p><button disabled={saving || Boolean(keptNote)} onClick={() => void keepNote()}>{keptNote ? 'Kept in Library notes' : 'Keep as editable note'}</button>{keptNote && <p>Saved note v{keptNote.version} · {assistantRecordLabel(keptNote)}</p>}</> : <p>{result.data.error?.message ?? 'This request is still in progress.'}</p>}
      {result.data.context && <section className="assistant-evidence" aria-label="Sources used for this result"><h3>Sources used</h3><details><summary>Project summary</summary><pre>{result.data.context.projectSummary}</pre></details>{result.data.context.sceneText && <details><summary>Selected scene text</summary><pre>{result.data.context.sceneText}</pre></details>}{result.data.input.unsavedText && <details><summary>{result.data.input.unsavedText.label} · explicitly included text</summary><pre>{result.data.input.unsavedText.text}</pre></details>}{result.data.context.records.map(entry => <details key={entry.ref.id}><summary>{entry.kind} · v{entry.version}</summary><small>{entry.ref.id}</small><code>{entry.ref.sha256}</code><pre>{entry.text}</pre></details>)}</section>}
      <details><summary>Request details</summary><p>{result.data.input.instructions}</p><p>{result.data.sceneId ?? 'Project overview'} · {result.data.startedAt}</p><code>{result.sha256}</code></details></section>}
    <details><summary>Previous requests ({history.length})</summary>{history.map(row => <button className="assistant-history" key={row.id} disabled={busy || saving} onClick={() => { setResult(row); setNotice('Earlier result opened with its original context.'); }}>{row.data.input.instructions.slice(0, 75) || 'Creative request'}<small>{row.data.provider.model} · {row.data.status.toLowerCase()}</small></button>)}</details>
    <footer><p>Suggestions are saved separately for review.</p><button onClick={onGeneration}>Prepare a video</button>{onConnections && <button onClick={onConnections}>Models & connections</button>}</footer>
  </aside>;
}
