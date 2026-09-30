import { modelAssistanceApi, type AssistanceInput } from './modelAssistanceApi';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ZodError } from 'zod';
import { canonicalJson } from './canonical';
import { downloadLocalBlob } from './localDownload';
import { applyScreenplayEditorChange, screenplayTextareaValue, textareaOffsetToScreenplay } from './screenplayIndex';
import { CREATIVE_OPERATIONS, creativeEditableProposal, creativeSaveInput, creativeSourceRecords, creativeSourceText, freshCreativeWorkspace, isCreativeRecord, prepareCreativeRequest, prepareCreativeResult, saveCreativeNote, verifyCreativeRequest, verifyCreativeResult, type CreativeOperation, type CreativePreparedText, type CreativeRequest, type CreativeResult, type CreativeToolCallbacks } from './creativeToolModel';
import type { Project, RecordInput, StoryPlanDraft, WorkspaceApi, WorkspaceRecord, WritingNote } from './types';
import './creative-tools.css';

export interface CreativeToolsProps extends CreativeToolCallbacks {
  open: boolean; project: Project; records: WorkspaceRecord[]; api: WorkspaceApi;
  activeWriting?: { title: string; dirty: boolean; saved: WorkspaceRecord | null } | null;
  onSaved: (record: WorkspaceRecord) => void; onClose?: () => void; onDirty?: (dirty: boolean) => void;
}
const titleOf = (record: WorkspaceRecord) => String((record.data as { title?: string }).title ?? record.id);
const cloneRecord = (record: WorkspaceRecord | undefined) => record ? JSON.parse(canonicalJson(record)) as WorkspaceRecord : null;
const message = (error: unknown) => error instanceof ZodError
  ? `Check these fields: ${error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || 'result'} — ${issue.message}`).join('; ')}${error.issues.length > 3 ? '. Additional fields also need correction.' : ''}`
  : error instanceof Error ? error.message : 'The operation could not be confirmed.';

/** Kept mounted by the shell. Closing this panel never discards its editable inputs. */
export default function CreativeTools({ open, project, records, api, activeWriting, onSaved, onClose, onDirty, onPrepareDraft, onPreparePlan, onPrepareNote }: CreativeToolsProps) {
  const [localRecords, setLocalRecords] = useState<WorkspaceRecord[]>([]);
  const allRecords = useMemo(() => {
    const map = new Map<string, WorkspaceRecord>();
    for (const record of [...records, ...localRecords]) if (!map.has(record.id) || map.get(record.id)!.version < record.version) map.set(record.id, record);
    return [...map.values()];
  }, [records, localRecords]);
  const inputs = creativeSourceRecords(allRecords);
  const [selected, setSelected] = useState<WorkspaceRecord | null>(() => cloneRecord(creativeSourceRecords(records)[0]));
  const [operation, setOperation] = useState<CreativeOperation>('scene-draft');
  const [instructions, setInstructions] = useState('');
  const [destination, setDestination] = useState('');
  const [localModels, setLocalModels] = useState<string[]>([]), [localModel, setLocalModel] = useState('');
  const [localRequest, setLocalRequest] = useState<AssistanceInput | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [requestRecord, setRequestRecord] = useState<WorkspaceRecord | null>(null);
  const [request, setRequest] = useState<CreativeRequest | null>(null);
  const [resultRecord, setResultRecord] = useState<WorkspaceRecord | null>(null);
  const [result, setResult] = useState<CreativeResult | null>(null);
  const [returnedText, setReturnedText] = useState('');
  const [origin, setOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sourceArea = useRef<HTMLTextAreaElement>(null);
  const attempts = useRef(new Map<string, RecordInput<WritingNote>>());
  const busyRef = useRef(false), alive = useRef(true), scope = `${project.id}:${project.sourceHash}`;
  const current = useRef({ scope, open }); current.current = { scope, open };
  const scopeVersion = useRef({ scope, generation: 0 });
  if (scopeVersion.current.scope !== scope) scopeVersion.current = { scope, generation: scopeVersion.current.generation + 1 };
  const initialScope = useRef(scope);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (initialScope.current === scope) return;
    initialScope.current = scope; attempts.current.clear();
    setSelected(cloneRecord(creativeSourceRecords(records)[0])); setLocalRecords([]); setRange(null);
    setRequestRecord(null); setRequest(null); setResultRecord(null); setResult(null); setReturnedText(''); setOrigin(''); setInstructions(''); setDestination(''); setNotice(''); setError('');
  }, [scope, records]);
  const sourceText = selected ? creativeSourceText(selected) : '';
  const chosenRange = operation === 'beat-outline' ? { start: 0, end: sourceText.length } : range;
  const selectionText = chosenRange ? sourceText.slice(chosenRange.start, chosenRange.end) : '';
  const returnDirty = Boolean(returnedText || origin) && (!result || result.returnedText !== returnedText || result.origin !== origin);
  const requestDirty = Boolean(instructions || destination || range) && (!request || request.instructions !== instructions || request.destination !== destination || request.input.id !== selected?.id || request.operation !== operation || request.selection.start !== chosenRange?.start || request.selection.end !== chosenRange?.end);
  const dirty = requestDirty || returnDirty;
  const onDirtyRef = useRef(onDirty); onDirtyRef.current = onDirty;
  useEffect(() => { onDirtyRef.current?.(dirty); }, [dirty]);
  useEffect(() => () => { onDirtyRef.current?.(false); }, []);
  function clearPrepared() {
    setRequest(null); setRequestRecord(null); setResult(null); setResultRecord(null); setNotice('');
    // Request controls are locked while an unsaved return exists. A saved return
    // stays in history; it must never silently become the next request's input.
    if (!returnDirty) { setReturnedText(''); setOrigin(''); }
  }
  function chooseInput(record: WorkspaceRecord | undefined) { setSelected(cloneRecord(record)); setRange(null); clearPrepared(); }
  const run = async (work: (active: () => boolean) => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const captured = scope, generation = scopeVersion.current.generation;
    const active = () => alive.current && current.current.scope === captured && scopeVersion.current.generation === generation && current.current.open;
    try { await work(active); } catch (caught) { if (active()) setError(message(caught)); }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); setLocalRequest(null); } }
  };
  async function save(note: WritingNote, active: () => boolean) {
    const fingerprint = canonicalJson(note);
    const attempt = attempts.current.get(fingerprint) ?? creativeSaveInput(note);
    attempts.current.set(fingerprint, attempt);
    const saved = await saveCreativeNote(api, attempt);
    if (active()) {
      setLocalRecords(prior => [...prior.filter(row => row.id !== saved.id), saved]); onSaved(saved);
    }
    return saved;
  }
  async function prepare(active: () => boolean) {
    if (!selected || !chosenRange) throw new Error('Choose a saved input and explicitly select its text.');
    const next = await freshCreativeWorkspace(api, project);
    const note = await prepareCreativeRequest(project, next.records, selected, operation, chosenRange.start, chosenRange.end, instructions, destination);
    if (!active()) return;
    const saved = await save(note, active);
    const reopened = await freshCreativeWorkspace(api, project);
    const verified = await verifyCreativeRequest(project, reopened.records, saved);
    if (!active()) return;
    setRequestRecord(saved); setRequest(verified.request); setResultRecord(null); setResult(null);
    setNotice('Request saved. Review it, then run locally or copy or export it for your chosen tool.');
  }
  async function handoff(active: () => boolean, kind: 'copy' | 'export') {
    if (!requestRecord) throw new Error('Prepare and save a request first.');
    const next = await freshCreativeWorkspace(api, project), verified = await verifyCreativeRequest(project, next.records, requestRecord);
    if (!active()) return;
    if (kind === 'copy') {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Export the request instead.');
      await navigator.clipboard.writeText(verified.request.prompt);
      if (active()) setNotice('Exact request copied. Paste it into the tool you choose.');
    } else {
      downloadLocalBlob(new Blob([verified.request.prompt], { type: 'text/plain;charset=utf-8' }), `caniscreenwrite-${verified.request.operation}-request.txt`);
      setNotice('Request download opened. Confirm the destination to finish saving it.');
    }
  }
  async function findLocalModels(active: () => boolean) {
    const value = await modelAssistanceApi.status();
    if (!active()) return;
    if (value.status !== 'AVAILABLE') throw new Error('Open Assistant and connect Ollama, then check again.');
    setLocalModels(value.models.map(row => row.name));
    setLocalModel(previous => value.models.some(row => row.name === previous) ? previous : value.models.find(row => row.name === 'qwen3.5:9b')?.name ?? value.models[0]?.name ?? '');
    setNotice('Installed local models loaded. Review the selected model and run the saved request.');
  }
  async function runLocalRequest(active: () => boolean) {
    if (!requestRecord || !localModel || returnDirty) throw new Error('Save a request and preserve the current returned proposal first.');
    const snapshot = await freshCreativeWorkspace(api, project);
    await verifyCreativeRequest(project, snapshot.records, requestRecord);
    if (!active()) return;
    const input: AssistanceInput = { schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash, sceneId: null, requestId: crypto.randomUUID(), model: localModel, instructions: '', contextRefs: [], unsavedText: null, creativeRequestRef: { id: requestRecord.id, sha256: requestRecord.sha256 }, maxOutputTokens: 2048 };
    setLocalRequest(input);
    const generated = await modelAssistanceApi.run(input, project);
    if (!active()) return;
    onSaved(generated);
    if (!generated.data.output) throw new Error(generated.data.error?.message ?? 'The local model did not return a completed proposal. Check Assistant history.');
    const text = generated.data.output.text;
    const provenance = `Local ${generated.data.provider.model}; result ${generated.id} @ ${generated.sha256}`;
    setReturnedText(text); setOrigin(provenance);
    const fresh = await freshCreativeWorkspace(api, project);
    const note = await prepareCreativeResult(project, fresh.records, requestRecord, text, provenance);
    if (!active()) return;
    const saved = await save(note, active), reopened = await freshCreativeWorkspace(api, project);
    const verified = await verifyCreativeResult(project, reopened.records, saved);
    if (!active()) return;
    setResultRecord(saved); setResult(verified.result);
    setNotice('Local proposal saved. Review it, then open a separate editable copy.');
  }
  async function importResult(active: () => boolean) {
    if (!requestRecord) throw new Error('Open a saved request before importing its result.');
    const next = await freshCreativeWorkspace(api, project);
    const note = await prepareCreativeResult(project, next.records, requestRecord, returnedText, origin);
    if (!active()) return;
    const saved = await save(note, active), reopened = await freshCreativeWorkspace(api, project);
    const verified = await verifyCreativeResult(project, reopened.records, saved);
    if (!active()) return;
    setResultRecord(saved); setResult(verified.result);
    setNotice('Returned proposal saved as unverified. Review it before opening a separate editable copy.');
  }
  async function reopen(record: WorkspaceRecord, active: () => boolean) {
    const next = await freshCreativeWorkspace(api, project);
    if (isCreativeRecord(record, 'result')) {
      const verified = await verifyCreativeResult(project, next.records, record);
      if (!active()) return;
      setResultRecord(cloneRecord(record)); setResult(verified.result); setReturnedText(verified.result.returnedText); setOrigin(verified.result.origin);
      setRequestRecord(cloneRecord(next.records.find(row => row.id === verified.result.requestRef.id))); setRequest(verified.request);
      setSelected(verified.source); setOperation(verified.request.operation); setRange({ start: verified.request.selection.start, end: verified.request.selection.end }); setInstructions(verified.request.instructions); setDestination(verified.request.destination);
    } else {
      const verified = await verifyCreativeRequest(project, next.records, record);
      if (!active()) return;
      setRequestRecord(cloneRecord(record)); setRequest(verified.request); setResultRecord(null); setResult(null); setReturnedText(''); setOrigin('');
      setSelected(verified.source); setOperation(verified.request.operation); setRange({ start: verified.request.selection.start, end: verified.request.selection.end }); setInstructions(verified.request.instructions); setDestination(verified.request.destination);
    }
    setNotice('Saved creative record reopened and its current source links verified.');
  }
  async function prepareEditable(active: () => boolean) {
    if (!resultRecord || !result || result.returnedText !== returnedText || result.origin !== origin) throw new Error('Import and save the current result before preparing a draft.');
    const next = await freshCreativeWorkspace(api, project), proposal = await creativeEditableProposal(project, next.records, resultRecord);
    if (!active()) return;
    if (proposal.kind === 'plan') onPreparePlan?.(proposal.value as StoryPlanDraft);
    else if (proposal.kind === 'note') onPrepareNote?.(proposal.value as CreativePreparedText);
    else onPrepareDraft?.(proposal.value as CreativePreparedText);
  }
  const ready = resultRecord && result && result.returnedText === returnedText && result.origin === origin;
  const canUse = operation === 'beat-outline' ? onPreparePlan : operation === 'shot-plan' ? onPrepareNote : onPrepareDraft;
  return <section className="creative-tools" hidden={!open} style={!open ? { display: 'none' } : undefined} aria-label="Local creative tools" data-unsaved={dirty}>
    <header className="creative-tools-header"><div><p className="eyebrow">CANISCREENWRITE · CREATIVE TOOLS</p><h2>Explore the next version.</h2><p>Prepare a request, run it with local Qwen or export it, then review the returned proposal.</p></div>{onClose && <button onClick={onClose}>Close creative tools</button>}</header>
    <p className="creative-tools-boundary">Local Qwen or manual handoff · proposals stay separate from the retained screenplay.</p>
    <details className="creative-local-model"><summary>Local Qwen</summary><div className="creative-tools-actions"><button disabled={busy} onClick={() => void run(findLocalModels)}>Find installed models</button><label>Creative model<select aria-label="Creative local model" value={localModel} disabled={busy} onChange={event => setLocalModel(event.target.value)}><option value="">Choose a local model</option>{localModels.map(name => <option key={name} value={name}>{name}</option>)}</select></label><button disabled={busy || !requestRecord || !localModel || returnDirty || requestDirty} onClick={() => void run(runLocalRequest)}>Run saved request locally</button>{busy && localRequest && <button onClick={() => { const { projectId, sourceHash, requestId } = localRequest!; void modelAssistanceApi.cancel({ projectId, sourceHash, requestId }).catch(caught => setError(message(caught))); }}>Cancel local request</button>}</div><p>Uses the exact saved request. A lost response can be recovered in Assistant history; generation is never retried automatically.</p></details>
    <nav aria-label="Creative operation" className="creative-tools-operations">{CREATIVE_OPERATIONS.map(item => <button key={item.id} disabled={busy || returnDirty} aria-pressed={operation === item.id} onClick={() => { setOperation(item.id); clearPrepared(); }}><strong>{item.label}</strong><span>{item.description}</span></button>)}</nav>
    <div className="creative-tools-grid"><section className="creative-tools-input"><h3>1 · Choose the material</h3>
      {activeWriting && <div className="creative-current-script"><strong>Open in the writer: {activeWriting.title}</strong><button disabled={busy || dirty || activeWriting.dirty || !activeWriting.saved} onClick={() => { chooseInput(activeWriting.saved ?? undefined); setError(''); setNotice('Open script selected. Highlight the passage you want to develop.'); }}>Use open script</button><small>{activeWriting.dirty || !activeWriting.saved ? 'Save this writing draft before using it in an AI request.' : dirty ? 'Save or clear the current AI request before switching its source.' : `Saved revision ${activeWriting.saved.version} · select a passage below.`}</small></div>}
      <label>Saved input<select aria-label="Creative source record" disabled={busy || returnDirty} value={selected?.id ?? ''} onChange={event => chooseInput(inputs.find(row => row.id === event.target.value))}><option value="">Choose a saved plan, screenplay or note</option>{inputs.map(row => <option key={row.id} value={row.id}>{titleOf(row)} · v{row.version} · {row.kind}</option>)}</select></label>
      {selected && <><p>Selected revision v{selected.version} · <code>{selected.sha256.slice(0, 12)}</code></p><label>Source material<textarea ref={sourceArea} aria-label="Creative source material" rows={10} readOnly value={screenplayTextareaValue(sourceText)}/></label>
        {operation === 'beat-outline' ? <p>The entire displayed plan supplies the outline’s known beats and character names.</p> : <div className="creative-tools-actions"><button disabled={busy || returnDirty} onClick={() => { const area = sourceArea.current; if (!area) return; const start = textareaOffsetToScreenplay(sourceText, area.selectionStart), end = textareaOffsetToScreenplay(sourceText, area.selectionEnd); if (end <= start) { setError('Highlight a nonempty passage in the source material first.'); return; } setRange({ start, end }); clearPrepared(); setError(''); }}>Use highlighted passage</button><button disabled={busy || returnDirty || !sourceText} onClick={() => { setRange({ start: 0, end: sourceText.length }); clearPrepared(); }}>Use all displayed text</button></div>}
        {chosenRange && <div className="creative-tools-selection"><p>{selectionText.length.toLocaleString()} selected characters · exact saved text</p><pre aria-label="Selected creative excerpt">{selectionText}</pre></div>}</>}
      {!inputs.length && <p>Save a note, story plan or screenplay in the writing workspace first.</p>}
      <label>Instructions<textarea aria-label="Creative instructions" rows={3} maxLength={5000} disabled={busy || returnDirty} value={instructions} onChange={event => { setInstructions(applyScreenplayEditorChange(instructions, event.target.value)); clearPrepared(); }} placeholder="What should this proposed version explore?"/></label>
      <label>Chosen external tool (optional)<input aria-label="Creative tool destination" maxLength={120} disabled={busy || returnDirty} value={destination} onChange={event => { setDestination(event.target.value); clearPrepared(); }} placeholder="Record your chosen tool; no connection is made"/></label>
      <button className="primary" disabled={busy || !selected || !selectionText || !instructions.trim() || Boolean(requestRecord)} onClick={() => void run(prepare)}>Prepare request</button>
      {requestDirty && <button disabled={busy || returnDirty} onClick={() => { setInstructions(''); setDestination(''); setRange(null); clearPrepared(); }}>Clear request draft</button>}
    </section><section className="creative-tools-return"><h3>2 · Review and hand off</h3>
      {request ? <><p>{CREATIVE_OPERATIONS.find(item => item.id === request.operation)?.result} requested · saved v1</p><details><summary>Review the exact request</summary><pre aria-label="Prepared creative prompt">{request.prompt}</pre></details><div className="creative-tools-actions"><button disabled={busy} onClick={() => void run(active => handoff(active, 'copy'))}>Copy request</button><button disabled={busy} onClick={() => void run(active => handoff(active, 'export'))}>Export request</button></div></> : <p>Prepare a request to review its exact text before sharing it.</p>}
      <h3>3 · Bring back the proposal</h3><p>Paste returned text or load a UTF-8 .txt, .fountain or .json file. Importing records a proposal, not verified provider provenance.</p>
      <label>Load result file<input aria-label="Creative result file" type="file" accept=".txt,.fountain,.json,text/plain,application/json" disabled={busy || returnDirty || !requestRecord} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void run(async active => { if (file.size > 200000) throw new Error('Choose a result file smaller than 200 KB.'); const bytes = await file.arrayBuffer(); const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); if (text.length > 50000) throw new Error('The result exceeds 50,000 characters.'); if (active()) { setReturnedText(text); setOrigin(`User-loaded file: ${file.name}`.slice(0, 500)); setResult(null); setResultRecord(null); setNotice('File loaded. Review the text and explicitly import the result.'); } }); }}/></label>
      <label>Returned text<textarea aria-label="Creative returned text" rows={10} maxLength={50000} disabled={busy || !requestRecord} value={screenplayTextareaValue(returnedText)} onChange={event => setReturnedText(applyScreenplayEditorChange(returnedText, event.target.value))}/></label>
      <label>Origin note (unverified)<input aria-label="Creative result origin" maxLength={500} disabled={busy || !requestRecord} value={origin} onChange={event => setOrigin(event.target.value)} placeholder="Tool, model or manual test; your observation"/></label>
      <div className="creative-tools-actions"><button disabled={busy || !requestRecord || !returnedText.trim() || Boolean(ready)} onClick={() => void run(importResult)}>Import result</button><button disabled={busy || !ready || !canUse} onClick={() => void run(prepareEditable)}>{operation === 'beat-outline' ? 'Open separate plan proposal' : operation === 'shot-plan' ? 'Open separate shot note' : 'Open separate writing proposal'}</button></div>
      {returnDirty && <p>Save this returned proposal or explicitly clear it before changing requests.</p>}
      {(returnedText || origin) && <button disabled={busy} onClick={() => { setReturnedText(''); setOrigin(''); setResult(null); setResultRecord(null); setNotice('Return field cleared. Saved proposals remain in history.'); }}>Clear returned draft</button>}
      {ready && <p className="creative-tools-proposal">UNVERIFIED RETURNED PROPOSAL · The editable copy contains only the returned proposal, with a link to this saved result. Review it before saving or using it for production.</p>}
    </section></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <details className="creative-tools-history"><summary>Saved requests and returned proposals ({allRecords.filter(row => isCreativeRecord(row)).length})</summary>{dirty && <p>Save or explicitly clear the current draft before reopening another creative record.</p>}<div>{allRecords.filter(row => isCreativeRecord(row)).map(row => <button key={row.id} disabled={busy || dirty} onClick={() => void run(active => reopen(row, active))}>{titleOf(row)} · v{row.version} · {row.id.slice(-8)}</button>)}</div></details>
  </section>;
}
