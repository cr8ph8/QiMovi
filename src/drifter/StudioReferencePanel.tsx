import { useEffect, useRef, useState } from 'react';
import { referenceDetails, referenceMessage, studioReferenceApi, type ReferenceElementChoice, type ReferencePrepare, type ReferenceWorkspace, type StudioReferenceApi, type StudioReferenceRecord } from './studioReferenceApi';
import type { StudioOperationRecord } from './studioOperationApi';
import type { StudioReferencePhase } from './types';
import './studio-reference.css';

type Props = { open: boolean; projectId: string; operation: StudioOperationRecord | null; dirty: boolean; disabled?: boolean; preparationBlockedReason?: string; onUseElement?: (element: ReferenceElementChoice) => void; api?: StudioReferenceApi };
type Form = { workspaceId: string; confirmed: boolean; selectedId: string; newAttempt: boolean; attempt: ReferencePrepare | null; uncertainCreate: string | null };
const emptyForm = (): Form => ({ workspaceId: '', confirmed: false, selectedId: '', newAttempt: false, attempt: null, uncertainCreate: null });
const phaseLabels: Record<StudioReferencePhase, string> = { PREPARING: 'Preparing reference inputs', PREPARED: 'Ready for creation review', CREATING: 'Creation in progress', CREATED: 'Provider reference created', CREATION_UNKNOWN: 'Creation outcome unknown', PREPARATION_FAILED: 'Reference preparation failed', FAILED: 'Reference attempt failed' };
const categoryName = (value: unknown) => ({ auto: 'Automatic classification', character: 'Character', character_ip_verified: 'Character', environment: 'Place', environment_ip_verified: 'Place', prop: 'Prop' })[String(value)] ?? String(value ?? 'Automatic classification').replace(/_/g, ' ');
function isCreation(operation: StudioOperationRecord | null) { try { return operation?.data.taskId === 'show_reference_elements' && JSON.parse(operation.data.settingsJson).action === 'create'; } catch { return false; } }
const message = (error: unknown) => error instanceof Error ? error.message : 'The app did not confirm this step. Refresh local status before continuing.';

export default function StudioReferencePanel({ open, projectId, operation, dirty, disabled = false, preparationBlockedReason = '', onUseElement, api = studioReferenceApi }: Props) {
  const sourceHash = operation?.data.sourceHash ?? null, scopeKey = JSON.stringify([projectId, sourceHash]), key = JSON.stringify([scopeKey, operation?.id, operation?.version, operation?.sha256]);
  const [forms, setForms] = useState<Record<string, Form>>({}), [records, setRecords] = useState<Record<string, StudioReferenceRecord[]>>({}), [workspaceLists, setWorkspaceLists] = useState<Record<string, ReferenceWorkspace[]>>({});
  const [loadedKey, setLoadedKey] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const serial = useRef(0), pending = useRef(false), alive = useRef(false), loadController = useRef<AbortController | null>(null), latest = useRef({ key, open, disabled }); latest.current = { key, open, disabled };
  const form = forms[key] ?? emptyForm(), scope = { projectId, sourceHash }, workspaces = workspaceLists[scopeKey] ?? [];
  const matches = (records[scopeKey] ?? []).filter(row => row.data.operationRef.id === operation?.id).sort((a, b) => b.data.createdAtMs - a.data.createdAtMs);
  const selected = form.newAttempt ? null : matches.find(row => row.id === form.selectedId) ?? matches.find(row => row.data.operationRef.version === operation?.version && row.data.operationRef.sha256 === operation?.sha256) ?? matches[0] ?? null;
  const selectedCurrent = Boolean(selected && selected.data.operationRef.version === operation?.version && selected.data.operationRef.sha256 === operation?.sha256), details = selected ? referenceDetails(selected) : null;
  const bound = Boolean(operation && (operation.data.schemaVersion !== 2 || operation.data.projectId === projectId)), canPrepare = bound && isCreation(operation);
  const unresolved = matches.some(row => ['CREATING', 'CREATION_UNKNOWN'].includes(row.data.phase)) || Boolean(form.uncertainCreate && !matches.some(row => row.id === form.uncertainCreate && ['CREATED', 'PREPARATION_FAILED', 'FAILED'].includes(row.data.phase)));
  const locked = disabled || dirty || Boolean(preparationBlockedReason) || !canPrepare || loadedKey !== key || Boolean(busy), element = details?.element, knownElementId = element?.id ?? details?.providerElementId;
  const canUse = Boolean(selectedCurrent && selected?.data.phase === 'CREATED' && element?.status === 'completed' && !locked && onUseElement);
  function edit(change: Partial<Form>) { setForms(old => ({ ...old, [key]: { ...(old[key] ?? emptyForm()), ...change } })); }
  useEffect(() => {
    alive.current = true; serial.current++; pending.current = false; loadController.current?.abort(); setBusy(''); setError(''); setLoadedKey('');
    if (!open || !bound || disabled) return () => { alive.current = false; loadController.current?.abort(); };
    const controller = new AbortController(); loadController.current = controller; const attempt = serial.current, capturedKey = key;
    api.list({ projectId, sourceHash }, controller.signal).then(rows => { if (!controller.signal.aborted && attempt === serial.current && latest.current.key === capturedKey) { setRecords(old => ({ ...old, [scopeKey]: rows })); setLoadedKey(capturedKey); } }).catch(e => { if (!controller.signal.aborted && attempt === serial.current) setError(message(e)); });
    return () => { alive.current = false; controller.abort(); };
  }, [open, key, scopeKey, bound, projectId, sourceHash, disabled, api]);
  async function run(action: 'list' | 'workspaces' | 'prepare' | 'create' | 'refresh') {
    if (!open || disabled || pending.current || !bound || !operation) return;
    if (['prepare', 'create'].includes(action) && (dirty || Boolean(preparationBlockedReason) || !canPrepare || unresolved)) return;
    if (action === 'prepare' && !form.attempt && (!form.workspaceId || !form.confirmed)) return;
    if (action === 'create' && (!selectedCurrent || selected?.data.phase !== 'PREPARED')) return;
    if (action === 'refresh' && !knownElementId) return;
    const attempt = ++serial.current, capturedKey = key, capturedScope = { ...scope }, capturedScopeKey = scopeKey;
    const active = () => alive.current && attempt === serial.current && latest.current.key === capturedKey && latest.current.open && !latest.current.disabled;
    loadController.current?.abort(); pending.current = true; setBusy(action); setError('');
    try {
      if (action === 'list') { const rows = await api.list(capturedScope); if (active()) { setRecords(old => ({ ...old, [capturedScopeKey]: rows })); setLoadedKey(capturedKey); } return; }
      if (action === 'workspaces') { const rows = await api.workspaces(capturedScope); if (active()) setWorkspaceLists(old => ({ ...old, [capturedScopeKey]: rows })); return; }
      let result: StudioReferenceRecord;
      if (action === 'prepare') {
        const input: ReferencePrepare = form.attempt ?? { jobId: `studio-reference:${crypto.randomUUID()}`, operationRef: { id: operation.id, version: operation.version, sha256: operation.sha256 }, workspaceId: form.workspaceId, referenceUseConfirmed: true };
        edit({ attempt: input }); result = await api.prepare(capturedScope, input);
      } else {
        if (!selected) return;
        if (action === 'create') edit({ uncertainCreate: selected.id });
        result = await api[action](capturedScope, selected);
      }
      if (active()) { setRecords(old => ({ ...old, [capturedScopeKey]: [...(old[capturedScopeKey] ?? []).filter(row => row.id !== result.id), result] })); edit({ selectedId: result.id, newAttempt: false, ...(action === 'create' ? { uncertainCreate: null } : {}) }); }
    } catch (e) { if (active()) setError(message(e)); }
    finally { if (active()) { pending.current = false; setBusy(''); } }
  }
  return <section className="studio-reference" hidden={!open} aria-label="Create saved reference task">
    <header><div><strong>Create a reusable reference</strong><small>{operation ? `${operation.data.title} · saved version ${operation.version}` : 'Save your reference creation task to continue.'}</small></div>{operation && <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void run('list')}>Refresh local reference status</button>}</header>
    {preparationBlockedReason && <p role="alert" className="studio-reference-note">{preparationBlockedReason}</p>}
    {dirty && <p className="studio-reference-note">Save your task changes before preparing, creating or using this reference. Existing provider status remains readable.</p>}
    {operation && !canPrepare && <p className="studio-reference-note">Choose reference creation in the task editor and save it before continuing.</p>}
    {error && <p role="alert" className="studio-reference-error">{error}</p>}{busy && <p role="status">{busy === 'prepare' ? 'Preparing owned images for Higgsfield…' : busy === 'create' ? 'Sending this creation once…' : busy === 'workspaces' ? 'Reading Higgsfield workspaces…' : 'Checking reference status…'}</p>}
    {matches.length > 1 && <label className="studio-reference-history">Saved attempts<select aria-label="Saved reference attempts" value={selected?.id ?? ''} disabled={Boolean(busy) || disabled} onChange={event => edit({ selectedId: event.target.value, newAttempt: false })}>{form.newAttempt && <option value="">New preparation</option>}{matches.map(row => <option key={row.id} value={row.id}>Task v{row.data.operationRef.version} · {new Date(row.data.createdAtMs).toLocaleString()} · {phaseLabels[row.data.phase]}</option>)}</select></label>}
    {canPrepare && !selected && !unresolved && <div className="studio-reference-preparation"><div className="studio-reference-workspaces"><button type="button" disabled={locked || Boolean(form.attempt)} onClick={() => void run('workspaces')}>{workspaces.length ? 'Refresh Higgsfield workspaces' : 'Load Higgsfield workspaces'}</button><small>This reads your provider account. Choose its workspace explicitly.</small></div><label>Higgsfield workspace<select aria-label="Reference Higgsfield workspace" disabled={locked || Boolean(form.attempt)} value={form.workspaceId} onChange={event => edit({ workspaceId: event.target.value })}><option value="">Choose a workspace</option>{workspaces.map(row => <option key={row.id} value={row.id}>{row.name || row.id}{row.plan_type ? ` · ${row.plan_type}` : ''}</option>)}</select></label><label className="studio-reference-confirm"><input type="checkbox" checked={form.confirmed} disabled={locked || Boolean(form.attempt)} onChange={event => edit({ confirmed: event.target.checked })}/>I have permission to send these images to Higgsfield and create this reusable reference.</label><button type="button" className="studio-reference-primary" disabled={locked || !form.attempt && (!form.workspaceId || !form.confirmed)} onClick={() => void run('prepare')}>{form.attempt ? 'Recover reference preparation' : 'Prepare reference'}</button><p className="studio-reference-note">Preparation may upload the saved task’s images. It does not create the provider reference.</p></div>}
    {selected && details && <div className="studio-reference-attempt"><div className="studio-reference-phase"><strong>{phaseLabels[selected.data.phase]}</strong><small>{details.workspaceName || details.workspaceId}</small></div>{details.error && <p role="alert" className="studio-reference-error">{referenceMessage(details.error)}</p>}
      {!selectedCurrent && <p className="studio-reference-note">This attempt uses saved task version {selected.data.operationRef.version}; the current task is version {operation?.version}. You can inspect its status, but cannot create or use it from the revised task.</p>}
      <dl className="studio-reference-inputs"><div><dt>Requested name</dt><dd>{typeof details.params.name === 'string' && details.params.name ? details.params.name : 'Provider derives the name'}</dd></div><div><dt>Category</dt><dd>{categoryName(details.params.category)}</dd></div><div><dt>Prepared images</dt><dd>{Array.isArray(details.params.medias) ? details.params.medias.length : 0}</dd></div></dl>
      <p className="studio-reference-note">Higgsfield does not provide a creation price through this tool.</p>
      {selectedCurrent && selected.data.phase === 'PREPARED' && !unresolved && <div className="studio-reference-actions"><button type="button" className="studio-reference-primary" disabled={locked} onClick={() => void run('create')}>Create reference</button><p className="studio-reference-note">This authorizes one provider creation in the workspace shown above.</p></div>}
      {element && <div className="studio-reference-element"><strong>{element.name}</strong><p>{categoryName(element.category)} · provider status: {element.status.replace(/_/g, ' ')}</p>{onUseElement && <button type="button" className="studio-reference-primary" disabled={!canUse} onClick={() => { if (canUse) onUseElement({ id: element.id, name: element.name, category: element.category }); }}>Use reference</button>}{element.status !== 'completed' && <p className="studio-reference-note">Only completed references can be chosen as generation inputs.</p>}<button type="button" disabled={Boolean(busy) || disabled} onClick={() => void run('refresh')}>Check reference status</button><small>Using a reference does not generate media or approve its likeness, rights or creative use.</small></div>}
      {!element && knownElementId && <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void run('refresh')}>Check reference status</button>}
      {selected.data.phase === 'PREPARING' && <p className="studio-reference-note">Preparation is already recorded. Refresh local status to recover its outcome.</p>}
      {!unresolved && (['PREPARATION_FAILED', 'FAILED'].includes(selected.data.phase) || !selectedCurrent) && <button type="button" disabled={locked} onClick={() => edit({ newAttempt: true, attempt: null, confirmed: false, uncertainCreate: null })}>{selectedCurrent ? 'Prepare another reference attempt' : 'Prepare current saved task'}</button>}
      <details className="studio-reference-receipt"><summary>Saved reference details</summary><p>{selected.id} · local version {selected.version}</p><p>Task {selected.data.operationRef.id} · version {selected.data.operationRef.version}</p>{knownElementId && <p>Element <code>{knownElementId}</code></p>}<code>{selected.sha256}</code>{details.error && <p>{details.error}</p>}</details>
    </div>}
    {unresolved && <p className="studio-reference-note">Creation may already have reached Higgsfield. This attempt will not be created again. Refresh local status; provider status can be checked only when its exact reference ID is known.</p>}
  </section>;
}
