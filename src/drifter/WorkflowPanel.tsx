import { useEffect, useRef, useState } from 'react';
import { canonicalJson } from './canonical';
import { validateRecord } from './validation';
import { getWorkflowContext, type WorkflowContext } from './workflowApi';
import type { AuthoringInputRef, ProductionHandoff, Project, WorkspaceApi, WorkspaceRecord } from './types';
import './workflow.css';

type Props = { project: Project; sceneId: string; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; requested?: { record: WorkspaceRecord; nonce: number }; onClose(): void; onSaved(record: WorkspaceRecord): void };
type Draft = Omit<ProductionHandoff, 'authoringRef'> & { authoringRef: AuthoringInputRef | null };
const authoringKinds = ['screenplay-draft', 'story-plan-draft', 'concept-draft', 'writing-note', 'pitch-draft'];
const title = (record: WorkspaceRecord) => String((record.data as { title?: string }).title ?? record.id);
const errorText = (value: unknown) => value instanceof Error ? value.message : 'The planning link was not confirmed.';

export default function WorkflowPanel(props: Props) { return <WorkflowScope key={`${props.project.id}:${props.project.sourceHash}`} {...props}/>; }
function WorkflowScope({ project, sceneId, records, api, open, requested, onClose, onSaved }: Props) {
  const latestHandoff = (id: string) => records.filter(record => record.id === `production-handoff:${id}` && record.kind === 'production-handoff').sort((a, b) => b.version - a.version)[0] ?? null;
  const existing = latestHandoff(sceneId);
  const initial = existing?.data as ProductionHandoff | undefined;
  const fresh = (id: string): Draft => ({ sourceHash: project.sourceHash, sceneId: id, authoringRef: null, shotIds: project.scenes.find(scene => scene.id === id)?.shots.slice(0, 1).map(shot => shot.id) ?? [], purpose: 'PLANNING_CONTEXT', notes: '' });
  const [draft, setDraft] = useState<Draft>(() => structuredClone(initial ?? fresh(sceneId)));
  const [baseline, setBaseline] = useState<WorkspaceRecord | null>(existing);
  const [initialText, setInitialText] = useState(() => canonicalJson(initial ?? fresh(sceneId)));
  const [pending, setPending] = useState<WorkspaceRecord | null>(null);
  const [context, setContext] = useState<WorkflowContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true), panel = useRef<HTMLElement>(null), currentFingerprint = useRef('');
  const consumedRequest = useRef<number | null>(null);
  const wasOpen = useRef(false);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const dirty = canonicalJson(draft) !== initialText;
  currentFingerprint.current = canonicalJson(draft);
  const targetScene = project.scenes.find(scene => scene.id === draft.sceneId)!;
  const authors = records.filter(record => authoringKinds.includes(record.kind) && (record.data as { sourceHash?: string }).sourceHash === project.sourceHash);
  const selectedAuthor = context?.authoring.record ?? authors.find(record => record.id === draft.authoringRef?.id && record.sha256 === draft.authoringRef.sha256);
  function selectAuthor(record: WorkspaceRecord) { setDraft(value => ({ ...value, authoringRef: { id: record.id, sha256: record.sha256 } })); setPending(null); setError(''); setNotice(''); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (open && !wasOpen.current && draft.sceneId !== sceneId) {
      if (dirty) setNotice('An unsaved planning link is still open. Its selected scene and edits are retained.');
      else {
        const record = latestHandoff(sceneId), next = structuredClone((record?.data as ProductionHandoff | undefined) ?? fresh(sceneId));
        setDraft(next); setBaseline(record); setInitialText(canonicalJson(next)); setContext(null); setError(''); setNotice('');
      }
    }
    wasOpen.current = open;
    // Only opening from a different scene initializes an unedited form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sceneId]);
  useEffect(() => {
    if (!requested || consumedRequest.current === requested.nonce) return;
    consumedRequest.current = requested.nonce;
    if (dirty) setPending(requested.record); else selectAuthor(requested.record);
    // A request is consumed once; subsequent draft edits must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested?.nonce]);
  useEffect(() => {
    if (!open || !draft.authoringRef) { setContext(null); return; }
    const controller = new AbortController(); let active = true;
    setLoading(true); setContext(null); setError('');
    void getWorkflowContext(project, draft.sceneId, { authoringRef: draft.authoringRef }, controller.signal).then(value => { if (active) setContext(value); }).catch(caught => { if (active) setError(errorText(caught)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [open, project, draft.sceneId, draft.authoringRef, refresh]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary') ?? []).filter(item => !item.closest('[hidden]'));
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    };
    document.addEventListener('keydown', keys); return () => { document.removeEventListener('keydown', keys); previous?.focus(); };
  }, [open, busy, onClose]);
  async function save() {
    if (!draft.authoringRef || !draft.shotIds.length || busy || loading || !context || context.status !== 'CURRENT') return;
    const data = structuredClone(draft) as ProductionHandoff, id = `production-handoff:${data.sceneId}`;
    const expectedVersion = baseline?.version ?? null, fingerprint = canonicalJson({ id, data, expectedVersion });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    const submitted = canonicalJson(draft); setBusy(true); setError(''); setNotice('');
    try {
      const record = await api.saveRecord({ id, kind: 'production-handoff', data, expectedVersion, requestId: attempt.current.requestId });
      await validateRecord(record, project);
      if (record.id !== id || record.kind !== 'production-handoff' || record.version !== (expectedVersion ?? 0) + 1 || canonicalJson(record.data) !== canonicalJson(data)) throw new Error('The saved planning link did not match the submitted scene and revision.');
      if (alive.current && currentFingerprint.current === submitted) { setBaseline(record); setInitialText(submitted); setNotice(`Planning link saved · v${record.version}`); onSaved(record); }
    } catch (caught) { if (alive.current) setError(`${errorText(caught)} Your selection and notes are retained. Refresh lineage before an exact retry.`); }
    finally { if (alive.current) setBusy(false); }
  }
  return <div className="workflow-scrim" hidden={!open} data-unsaved={dirty ? 'true' : 'false'}><section className="workflow-panel" ref={panel} role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined} aria-label="Link writing to production"><header><div><span className="eyebrow">WRITING → FILM PLAN</span><h2>Carry the intent into the shot.</h2></div><button disabled={busy} aria-label="Close production link" onClick={onClose}>×</button></header><p>Link a saved writing revision to existing scene and shot identities. Its text supplies planning context; the retained screenplay and its dialogue stay unchanged.</p>
    {error && <p role="alert" className="error-bar">{error}</p>}{notice && <p role="status">{notice}</p>}{pending && <div className="quiet-warning" role="alert"><p>Use “{title(pending)}” instead of the open link’s writing selection? Your scene, shots and notes will stay.</p><button onClick={() => setPending(null)}>Keep this selection</button><button onClick={() => selectAuthor(pending)}>Use requested writing revision</button></div>}
    <fieldset disabled={busy}><section className="workflow-section"><h3>1. Saved writing revision</h3><div className="workflow-records">{authors.map(record => <button key={record.id} aria-pressed={draft.authoringRef?.id === record.id && draft.authoringRef.sha256 === record.sha256} onClick={() => selectAuthor(record)}><span><small className="workflow-record-kind">{record.kind.replace(/-draft$|-note$/, '').replace(/-/g, ' ')}</small>{title(record)}</span><small>v{record.version} · {record.sha256.slice(0, 8)}</small></button>)}</div>{!authors.length && <p className="workflow-empty">Save a note, concept, plan, screenplay or pitch in CanIScreenwrite first.</p>}</section>
    <section className="workflow-section"><h3>2. Production scene</h3><div className="workflow-records">{project.scenes.map(scene => <button key={scene.id} aria-pressed={draft.sceneId === scene.id} onClick={() => { setDraft(value => ({ ...value, sceneId: scene.id, shotIds: scene.shots.slice(0, 1).map(shot => shot.id) })); setBaseline(latestHandoff(scene.id)); setError(''); setNotice(''); }}><span>{String(scene.index).padStart(2, '0')} · {scene.heading}</span><small>{scene.shots.length} shots</small></button>)}</div></section>
    <section className="workflow-section"><h3>3. Shots this writing helps plan</h3><div className="workflow-shots">{targetScene.shots.map(shot => <label key={shot.id}><input type="checkbox" checked={draft.shotIds.includes(shot.id)} onChange={event => setDraft(value => ({ ...value, shotIds: targetScene.shots.filter(item => item.id === shot.id ? event.target.checked : value.shotIds.includes(item.id)).map(item => item.id) }))}/><span><strong>{shot.label}</strong>{shot.description}</span></label>)}</div></section>
    <section className="workflow-section"><label>Planning intent<textarea aria-label="Production handoff notes" value={draft.notes} maxLength={4000} rows={4} onChange={event => setDraft(value => ({ ...value, notes: event.target.value }))} placeholder="How should this saved writing inform the scene, framing or action?"/></label></section></fieldset>
    <div className="workflow-preview"><p>{loading ? 'Checking the selected revision and its linked inputs…' : context?.status === 'CURRENT' ? 'The selected writing and its linked inputs match their saved heads.' : context?.status === 'STALE' ? 'This writing or a linked input changed. Choose and review a current revision before saving a new link.' : 'Select saved writing to check its lineage.'}</p>{selectedAuthor && <p>{title(selectedAuthor)} · v{selectedAuthor.version}<code>{selectedAuthor.sha256}</code></p>}{context?.lineage.reasons.length ? <ul>{context.lineage.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : null}<button className="text-link" disabled={busy || loading || !draft.authoringRef} onClick={() => setRefresh(value => value + 1)}>Refresh lineage check →</button></div>
    <footer className="workflow-footer"><span>{dirty ? 'Unsaved planning link' : baseline ? `Saved planning link · v${baseline.version}` : 'No planning link saved'}<br/>No source replacement or generation approval</span><button className="secondary" disabled={busy || !dirty} onClick={() => { const next = structuredClone((baseline?.data as ProductionHandoff | undefined) ?? fresh(draft.sceneId)); setDraft(next); setInitialText(canonicalJson(next)); setError(''); setNotice('Unsaved planning-link edits discarded. Saved records remain unchanged.'); }}>Discard link edits</button><button className="primary" disabled={busy || loading || !dirty || !draft.authoringRef || !draft.shotIds.length || context?.status !== 'CURRENT'} onClick={() => void save()}>{busy ? 'Saving…' : 'Save link and open film plan →'}</button></footer>
  </section></div>;
}
