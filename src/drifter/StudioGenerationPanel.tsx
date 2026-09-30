import { useEffect, useRef, useState } from 'react';
import { blobUrl } from './api';
import { studioMediaActions } from './studioOperationRequest';
import { generationMessage, generationDetails, studioGenerationApi, creditCeilingCovers, type GenerationOutput, type GenerationPrepare, type GenerationWorkspace, type StudioGenerationApi, type StudioGenerationRecord } from './studioGenerationApi';
import type { StudioOperationRecord } from './studioOperationApi';
import type { StudioGenerationPhase } from './types';
import './studio-generation.css';

type Props = { open: boolean; projectId: string; operation: StudioOperationRecord | null; dirty: boolean; disabled?: boolean; preparationBlockedReason?: string; api?: StudioGenerationApi; onReuseOutput?: (output: GenerationOutput, action: ReturnType<typeof studioMediaActions>[number], record: StudioGenerationRecord) => void };
type Form = { workspaceId: string; paymentChoice: '' | 'CREDITS' | 'UNLIMITED'; confirmed: boolean; maximumCredits: string; selectedId: string; newTake: boolean; attempt: GenerationPrepare | null; uncertainSubmit: string | null };
const emptyForm = (): Form => ({ workspaceId: '', paymentChoice: '', confirmed: false, maximumCredits: '', selectedId: '', newTake: false, attempt: null, uncertainSubmit: null });
const phaseLabels: Record<StudioGenerationPhase, string> = { PREPARING: 'Preparation in progress', PREPARED: 'Ready for cost review', PREPARATION_FAILED: 'Preparation failed', SUBMITTING: 'Submission in progress', SUBMISSION_UNKNOWN: 'Submission outcome unknown', SUBMITTED: 'Submitted to Higgsfield', PROCESSING: 'Generating', COMPLETED: 'Provider output ready', FAILED: 'Generation failed', CANCELLED: 'Provider reports cancelled', RETAINED: 'Saved locally · unreviewed' };
const terminal = new Set<StudioGenerationPhase>(['PREPARATION_FAILED', 'FAILED', 'CANCELLED', 'RETAINED']);
const pollable = new Set<StudioGenerationPhase>(['SUBMISSION_UNKNOWN', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED']);
const message = (e: unknown) => e instanceof Error ? e.message : 'The app did not confirm this action. Refresh local status before continuing.';
function OutputPreview({ output, disabled, onReuse }: { output: GenerationOutput; disabled: boolean; onReuse?: (action: ReturnType<typeof studioMediaActions>[number]) => void }) {
  const [failed, setFailed] = useState(false), url = blobUrl(output.sha256);
  return <figure className="studio-generation-output">{!failed && (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(output.mimeType) ? <img src={url} alt={output.filename} onError={() => setFailed(true)}/> : ['video/mp4', 'video/webm', 'video/quicktime'].includes(output.mimeType) ? <video src={url} controls preload="metadata" onError={() => setFailed(true)}/> : ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/flac'].includes(output.mimeType) ? <audio src={url} controls preload="metadata" onError={() => setFailed(true)}/> : null)}<figcaption>{output.filename}<small>Unreviewed · {(output.byteLength / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB</small>{failed && <p>This browser could not preview the original format.</p>}<a href={url} download={output.filename}>Download retained original</a>{onReuse && <div className="studio-generation-submit" aria-label={`Next task for ${output.filename}`}>{studioMediaActions(output).map(action => <button type="button" key={action.label} disabled={disabled} aria-label={`${action.label} from ${output.filename}`} onClick={() => { if (!disabled) onReuse(action); }}>{action.label}</button>)}</div>}</figcaption></figure>;
}
export default function StudioGenerationPanel({ open, projectId, operation, dirty, disabled = false, preparationBlockedReason = '', api = studioGenerationApi, onReuseOutput }: Props) {
  const sourceHash = operation?.data.sourceHash ?? null, scopeKey = JSON.stringify([projectId, sourceHash]);
  const key = JSON.stringify([scopeKey, operation?.id, operation?.version, operation?.sha256]);
  const [forms, setForms] = useState<Record<string, Form>>({}), [recordsByScope, setRecords] = useState<Record<string, StudioGenerationRecord[]>>({}), [workspaceLists, setWorkspaces] = useState<Record<string, GenerationWorkspace[]>>({});
  const [loadedKey, setLoadedKey] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const serial = useRef(0), pending = useRef(false), alive = useRef(false), latest = useRef({ key, open }), loadController = useRef<AbortController | null>(null);
  latest.current = { key, open };
  const form = forms[key] ?? emptyForm(), scope = { projectId, sourceHash };
  const matches = (recordsByScope[scopeKey] ?? []).filter(row => row.data.operationRef.id === operation?.id).sort((a, b) => b.data.createdAtMs - a.data.createdAtMs);
  const selected = form.newTake ? null : matches.find(row => row.id === form.selectedId) ?? matches.find(row => row.data.operationRef.version === operation?.version && row.data.operationRef.sha256 === operation?.sha256) ?? matches[0] ?? null;
  const selectedCurrent = Boolean(selected && selected.data.operationRef.version === operation?.version && selected.data.operationRef.sha256 === operation?.sha256);
  const details = selected ? generationDetails(selected) : null;
  const workspaces = workspaceLists[scopeKey] ?? [];
  const unretainedCompleted = details?.jobs.filter(job => job.status.toLowerCase() === 'completed' && !details.outputs.some(output => output.jobId === job.id)) ?? [];
  const canRetain = Boolean(selected && ['COMPLETED', 'FAILED'].includes(selected.data.phase) && (unretainedCompleted.some(job => Boolean(job.resultUrl)) || selected.data.phase === 'COMPLETED' && details?.jobs.length && unretainedCompleted.length === 0));
  const bound = Boolean(operation && (operation.data.schemaVersion !== 2 || operation.data.projectId === projectId));
  const canPrepare = bound && ['generate_image', 'generate_video', 'generate_audio'].includes(operation!.data.taskId);
  const locked = disabled || dirty || Boolean(preparationBlockedReason) || !bound || loadedKey !== key || Boolean(busy);
  function edit(change: Partial<Form>) { setForms(old => ({ ...old, [key]: { ...(old[key] ?? emptyForm()), ...change } })); }
  useEffect(() => {
    alive.current = true; serial.current++; pending.current = false; loadController.current?.abort(); setBusy(''); setError(''); setLoadedKey('');
    if (!open || !bound) return () => { alive.current = false; loadController.current?.abort(); };
    const controller = new AbortController(); loadController.current = controller;
    const attempt = serial.current, capturedKey = key, expectedScope = { projectId, sourceHash };
    api.list(expectedScope, controller.signal).then(rows => { if (!controller.signal.aborted && attempt === serial.current && latest.current.key === capturedKey) { setRecords(old => ({ ...old, [scopeKey]: rows })); setLoadedKey(capturedKey); } }).catch(e => { if (!controller.signal.aborted && attempt === serial.current) setError(message(e)); });
    return () => { alive.current = false; controller.abort(); };
  }, [open, key, bound, scopeKey, projectId, sourceHash, api]);
  async function run(action: 'refresh' | 'workspaces' | 'prepare' | 'submit' | 'poll' | 'retain') {
    if (pending.current || !open || !operation || !bound || disabled) return;
    if (['prepare', 'submit'].includes(action) && (dirty || preparationBlockedReason)) return;
    if (action === 'prepare' && (!canPrepare || !form.attempt && (!form.workspaceId || !form.paymentChoice || !form.confirmed))) return;
    if (action === 'submit' && (!selectedCurrent || !selected || selected.data.phase !== 'PREPARED' || form.uncertainSubmit === selected.id || !details?.quote || !creditCeilingCovers(form.maximumCredits, details.quote.credits))) return;
    const attempt = ++serial.current, capturedKey = key, capturedScope = { ...scope }, capturedScopeKey = scopeKey;
    const current = () => alive.current && attempt === serial.current && latest.current.key === capturedKey && latest.current.open;
    loadController.current?.abort(); pending.current = true; setBusy(action); setError('');
    try {
      if (action === 'refresh') { const rows = await api.list(capturedScope); if (current()) { setRecords(old => ({ ...old, [capturedScopeKey]: rows })); setLoadedKey(capturedKey); } return; }
      if (action === 'workspaces') { const rows = await api.workspaces(capturedScope); if (current()) setWorkspaces(old => ({ ...old, [capturedScopeKey]: rows })); return; }
      let record: StudioGenerationRecord;
      if (action === 'prepare') {
        const input: GenerationPrepare = form.attempt ?? { jobId: `studio-generation:${crypto.randomUUID()}`, operationRef: { id: operation.id, version: operation.version, sha256: operation.sha256 }, workspaceId: form.workspaceId, paymentChoice: form.paymentChoice as 'CREDITS' | 'UNLIMITED', referenceUseConfirmed: true };
        edit({ attempt: input }); record = await api.prepare(capturedScope, input);
      } else {
        if (!selected) return;
        if (action === 'submit') { edit({ uncertainSubmit: selected.id }); record = await api.submit(capturedScope, selected, form.maximumCredits); }
        else record = await api[action](capturedScope, selected);
      }
      if (current()) {
        setRecords(old => ({ ...old, [capturedScopeKey]: [...(old[capturedScopeKey] ?? []).filter(row => row.id !== record.id), record] }));
        edit({ selectedId: record.id, newTake: false, ...(action === 'submit' ? { uncertainSubmit: null } : {}) });
      }
    } catch (e) { if (current()) setError(message(e)); }
    finally { if (current()) { pending.current = false; setBusy(''); } }
  }
  return <section className="studio-generation" hidden={!open} aria-label="Generate saved task">
    <header><div><strong>Generate from this saved task</strong><small>{operation ? `${operation.data.title} · saved version ${operation.version}` : 'Save a generation task to continue.'}</small></div>{operation && <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void run('refresh')}>Refresh local status</button>}</header>
    {dirty && <p className="studio-generation-note">Save your task changes before preparing or submitting. Existing job status and retained outputs remain available.</p>}
    {preparationBlockedReason && <p className="studio-generation-note">{preparationBlockedReason} Existing job status and retained outputs remain available.</p>}
    {operation && !canPrepare && <p className="studio-generation-note">This task has no generation submission route. Use a saved image, video or speech generation task.</p>}
    {error && <p role="alert" className="studio-generation-error">{error}</p>}{busy && <p role="status">{busy === 'submit' ? 'Submitting once to Higgsfield…' : busy === 'retain' ? 'Saving provider output to local storage…' : busy === 'prepare' ? 'Preparing references and checking cost…' : busy === 'workspaces' ? 'Reading Higgsfield workspaces…' : 'Checking job status…'}</p>}
    {matches.length > 1 && <label className="studio-generation-job-choice">Saved attempts<select value={selected?.id ?? ''} disabled={Boolean(busy)} onChange={event => edit({ selectedId: event.target.value, newTake: false, maximumCredits: '' })}>{form.newTake && <option value="">New take</option>}{matches.map(row => <option key={row.id} value={row.id}>Task v{row.data.operationRef.version} · {new Date(row.data.createdAtMs).toLocaleString()} · {phaseLabels[row.data.phase]}</option>)}</select></label>}
    {canPrepare && !selected && <div className="studio-generation-preparation"><div className="studio-generation-workspaces"><button type="button" disabled={locked || Boolean(form.attempt)} onClick={() => void run('workspaces')}>{workspaces.length ? 'Refresh Higgsfield workspaces' : 'Load Higgsfield workspaces'}</button><small>Reads your provider account. Choose a billing workspace explicitly.</small></div><div className="studio-generation-fields"><label>Higgsfield workspace<select aria-label="Generation Higgsfield workspace" disabled={locked || Boolean(form.attempt)} value={form.workspaceId} onChange={event => edit({ workspaceId: event.target.value })}><option value="">Choose a workspace</option>{workspaces.map(row => <option key={row.id} value={row.id}>{row.name || row.id}{row.plan_type ? ` · ${row.plan_type}` : ''}</option>)}</select></label><label>Payment choice<select aria-label="Generation payment choice" disabled={locked || Boolean(form.attempt)} value={form.paymentChoice} onChange={event => edit({ paymentChoice: event.target.value as Form['paymentChoice'] })}><option value="">Choose how to pay</option><option value="CREDITS">Credits</option><option value="UNLIMITED">Unlimited, where eligible</option></select></label></div><label className="studio-generation-confirm"><input type="checkbox" checked={form.confirmed} disabled={locked || Boolean(form.attempt)} onChange={event => edit({ confirmed: event.target.checked })}/>I have permission to use the selected references, voices and reusable characters, props or places for this generation, and to send this task to Higgsfield.</label><button type="button" className="studio-generation-primary" disabled={locked || !form.attempt && (!form.workspaceId || !form.paymentChoice || !form.confirmed)} onClick={() => void run('prepare')}>{form.attempt ? 'Recover preparation attempt' : 'Prepare with Higgsfield'}</button><p className="studio-generation-note">This step may upload the task’s references and obtain a cost estimate. It does not submit generation.</p></div>}
    {selected && details && <div className="studio-generation-job"><div className="studio-generation-phase"><strong>{phaseLabels[selected.data.phase]}</strong><small>{details.modelId} · {details.workspaceName || details.workspaceId} · {details.paymentChoice === 'CREDITS' ? 'Credits' : 'Unlimited requested'}</small></div>{details.error && <p role="alert" className="studio-generation-error">{generationMessage(details.error)}</p>}
      {!selectedCurrent && <p className="studio-generation-note">This job uses saved task version {selected.data.operationRef.version}; the current saved task is version {operation?.version}. You can check or retain this job, but cannot submit it from the revised task.</p>}
      {details.providerReferences && (details.providerReferences.voice || details.providerReferences.elements.length > 0 || Boolean(details.providerReferences.marketing?.length)) && <div className="studio-generation-note" aria-label="Observed provider inputs"><strong>Inputs observed for this attempt</strong>{details.providerReferences.voice && <p>Voice: {details.providerReferences.voice.name} · {details.providerReferences.voice.voice_type === 'preset' ? 'preset' : 'custom voice'}</p>}{details.providerReferences.elements.length > 0 && <p>Characters, props & places: {details.providerReferences.elements.map(row => row.name).join(' · ')}</p>}{details.providerReferences.marketing?.map(row => <p key={`${row.kind}:${row.id}`}>{({brand:'Brand',product:'Featured product',presenter:'Presenter',hook:'Opening hook',setting:'Filming setting',style:'Artwork style',format:'Video format'})[row.kind]}: {row.name}</p>)}<small>Generation checks these identities again before submission. These observations do not supply a licence or creative approval.</small></div>}
      {details.quote && <p className="studio-generation-quote">Estimated cost <strong>{details.quote.credits} credits</strong><small>Observed {new Date(details.quote.observedAtMs).toLocaleString()}. This estimate is not a guaranteed final charge.</small></p>}
      {selectedCurrent && selected.data.phase === 'PREPARED' && form.uncertainSubmit !== selected.id && <div className="studio-generation-submit"><label>Maximum credits I authorize<input aria-label="Maximum generation credits" inputMode="decimal" disabled={locked} value={form.maximumCredits} placeholder="Enter your ceiling" onChange={event => edit({ maximumCredits: event.target.value })}/></label><button type="button" className="studio-generation-primary" disabled={locked || !details.quote || !creditCeilingCovers(form.maximumCredits, details.quote?.credits ?? '')} onClick={() => void run('submit')}>Generate</button><p className="studio-generation-note">The app checks the estimate against this ceiling before submission; this is not a provider-enforced hard charge cap. Generate submits the task using the selected payment choice.</p></div>}
      {(selected.data.phase === 'SUBMISSION_UNKNOWN' || selected.data.phase === 'SUBMITTING' || form.uncertainSubmit === selected.id) && <p className="studio-generation-note">Submission may already have reached Higgsfield. It will not be sent again here. Refresh local status or check the provider status to resolve this attempt.</p>}
      {selected.data.phase === 'PREPARING' && <p className="studio-generation-note">An existing preparation is recorded. Refresh local status; a new provider preparation is not started automatically.</p>}
      {pollable.has(selected.data.phase) && details.jobs.length > 0 && <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void run('poll')}>Check provider status</button>}
      {canRetain && <><button type="button" className="studio-generation-primary" disabled={Boolean(busy) || disabled} onClick={() => void run('retain')}>{selected.data.phase === 'FAILED' ? 'Keep completed results' : 'Save output locally'}</button><p className="studio-generation-note">Downloads the completed provider files. Retention does not select a take or approve its use.</p></>}
      {selected.data.phase === 'FAILED' && details.outputs.length > 0 && <p className="studio-generation-note">Completed members were retained. The overall batch remains failed and needs review.</p>}
      {unretainedCompleted.some(job => !job.resultUrl) && <p className="studio-generation-note">Some completed results have no confirmed download link. Check provider status to refresh their links.</p>}
      {details.outputs.length > 0 && <div className="studio-generation-outputs">{details.outputs.map(output => <OutputPreview key={`${output.jobId}:${output.sha256}`} output={output} disabled={Boolean(busy) || disabled} onReuse={onReuseOutput ? action => onReuseOutput(output, action, selected) : undefined}/>)}</div>}
      {(terminal.has(selected.data.phase) || !selectedCurrent) && <button type="button" disabled={locked} onClick={() => edit({ newTake: true, attempt: null, confirmed: false, maximumCredits: '', uncertainSubmit: null })}>{selectedCurrent ? 'Prepare another take' : 'Prepare current saved task'}</button>}
      <details className="studio-generation-receipt"><summary>Saved job details</summary><p>{selected.id} · local version {selected.version}</p><p>Task {selected.data.operationRef.id} · version {selected.data.operationRef.version}</p>{details.jobs.map(job => <p key={job.id}>{job.id} · {job.status}</p>)}<code>{selected.sha256}</code>{details.error && <p>{details.error}</p>}</details>
    </div>}
  </section>;
}
