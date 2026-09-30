import { useCallback, useEffect, useRef, useState } from 'react';
import { hashCanonical } from './canonical';
import { downloadLocalBlob } from './localDownload';
import { validateRecord } from './validation';
import ProductionDocumentBody from './ProductionDocumentBody';
import './production-documents.css';
import type { DocumentDraft, Project, WorkspaceApi, WorkspaceRecord } from './types';

type Entry = { id: string; typeId: string; name: string; materializationMode: string; supportedDraft: boolean };
type Saved = WorkspaceRecord & { documentState: { status: 'CURRENT_DEPENDENCIES' | 'NEEDS_REBUILD'; reason: string; currentDependencyHashes: string[]; bodyHash: string } };
type ReferenceDocument = WorkspaceRecord & { documentState: { status: 'AUTHORED_REFERENCE'; reason: string; sourceMatches: boolean; bodyHash: string } };
type Catalog = { sourceHash: string; contextBasisHash: string; registry: Entry[]; knownFactKeys: string[]; savedDocuments: Saved[]; referenceDocuments?: ReferenceDocument[] };
type Candidate = DocumentDraft & { hash: string; bodyHash: string; supersedesHash: string | null; review: 'NEEDS_REVIEW' };
type Preview = { sourceHash: string; contextBasisHash: string; existingDocuments: WorkspaceRecord[]; candidates: Candidate[]; requirements: { typeId: string; status: string }[]; impact: { impacts: { artifact_key: string }[] } | null; rebuiltTypes: string[] };
const documentName = (type: string) => ({ SCRIPT_BREAKDOWN: 'Script breakdown', SHOT_LIST: 'Shot list', ONE_LINER: 'One-liner', PRODUCTION_SCHEDULE: 'Production schedule', POST_PRODUCTION_SCHEDULE: 'Post-production schedule' }[type] ?? type.replace(/_/g, ' '));
const draftDescription = (type: string) => type === 'SCRIPT_BREAKDOWN' ? 'Saved production elements by scene, with source passages and cast observations' : type === 'ONE_LINER' ? 'Scene-order strips with cast observations and spaces for shoot order, day and location' : type === 'PRODUCTION_SCHEDULE' ? 'Scene requirements and department handoffs · assign dates and resources before use' : type === 'POST_PRODUCTION_SCHEDULE' ? 'Editorial, sound, VFX, colour and delivery handoffs from retained media and planning records' : type === 'STORYBOARDS' ? 'Frame and source references · not a rendered storyboard PDF' : 'Draft view from saved project records';
function exportDocument(data: DocumentDraft) { downloadLocalBlob(new Blob([data.body], { type: 'text/markdown;charset=utf-8' }), `${data.typeId.toLowerCase()}-draft.md`); }
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The document operation was not confirmed.';
async function rawHash(body: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))), byte => byte.toString(16).padStart(2, '0')).join(''); }
async function request(url: string, body?: unknown) {
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'The local document request failed.');
  return value;
}
function requireValue(value: unknown): asserts value { if (!value) throw new Error('Document evidence did not match this workspace. Reload before continuing.'); }
const dataOf = (candidate: Candidate): DocumentDraft => ({ typeId: candidate.typeId, sourceHash: candidate.sourceHash, dependencyHashes: candidate.dependencyHashes, body: candidate.body, status: candidate.status });

export default function DocumentsPanel({ project, api, onClose, onSaved }: { project: Project; api: WorkspaceApi; onClose: () => void; onSaved: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState(['SCRIPT_BREAKDOWN', 'SHOT_LIST']);
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [documentQuery, setDocumentQuery] = useState('');
  const [fact, setFact] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<Record<string, WorkspaceRecord>>({});
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [activeType, setActiveType] = useState('');
  const [editing, setEditing] = useState(false);
  const [closeWarning, setCloseWarning] = useState(false);
  const reviewSurface = useRef<HTMLDivElement>(null);
  const dirty = Boolean(preview?.candidates.some(candidate => bodies[candidate.typeId] !== undefined && bodies[candidate.typeId] !== ((saved[candidate.typeId]?.data as DocumentDraft | undefined)?.body ?? candidate.body)));
  const activeCandidate = preview?.candidates.find(candidate => candidate.typeId === activeType) ?? preview?.candidates[0];
  const attempts = useRef<Record<string, { fingerprint: string; id: string }>>({});
  const alive = useRef(true);
  const operationSerial = useRef(0);
  const scope = useRef(`${project.id}:${project.sourceHash}`);
  scope.current = `${project.id}:${project.sourceHash}`;
  const load = useCallback(async () => {
    const serial = ++operationSerial.current;
    const capturedScope = `${project.id}:${project.sourceHash}`;
    const current = () => alive.current && serial === operationSerial.current && scope.current === capturedScope;
    setBusy(true); setError('');
    try {
      const value: Catalog = await request('/api/documents');
      requireValue(value?.sourceHash === project.sourceHash && digest(value.contextBasisHash) && Array.isArray(value.registry) && value.registry.every(item => typeof item.typeId === 'string' && typeof item.name === 'string' && typeof item.supportedDraft === 'boolean') && Array.isArray(value.knownFactKeys) && value.knownFactKeys.every(key => typeof key === 'string') && Array.isArray(value.savedDocuments));
      for (const item of value.savedDocuments) {
        const { documentState, ...record } = item;
        await validateRecord(record, project);
        requireValue(record.kind === 'document-draft' && documentState && ['CURRENT_DEPENDENCIES', 'NEEDS_REBUILD'].includes(documentState.status) && documentState.bodyHash === await rawHash((record.data as DocumentDraft).body));
      }
      requireValue(value.referenceDocuments === undefined || Array.isArray(value.referenceDocuments));
      for (const item of value.referenceDocuments ?? []) {
        const { documentState, ...record } = item;
        await validateRecord(record);
        const data = record.data as DocumentDraft;
        requireValue(record.kind === 'document-draft' && documentState?.status === 'AUTHORED_REFERENCE' && documentState.sourceMatches === (data.sourceHash === project.sourceHash) && documentState.bodyHash === await rawHash(data.body) && !value.registry.some(entry => entry.typeId === data.typeId));
      }
      if (current()) setCatalog(value);
    } catch (caught) { if (current()) setError(errorText(caught)); }
    finally { if (current()) setBusy(false); }
  }, [project]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => { if (preview) reviewSurface.current?.scrollIntoView?.({ block: 'start' }); }, [preview]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function generatePreview() {
    const serial = ++operationSerial.current;
    const capturedScope = `${project.id}:${project.sourceHash}`;
    const current = () => alive.current && serial === operationSerial.current && scope.current === capturedScope;
    if (dirty) return;
    setBusy(true); setError(''); setPreview(null); setNotice(''); setSaved({}); setBodies({}); setEditing(false);
    try {
      const value: Preview = await request('/api/documents/preview', { sourceHash: project.sourceHash, selectedTypes: selected, changedFacts: fact ? [fact] : [] });
      requireValue(value?.sourceHash === project.sourceHash && digest(value.contextBasisHash) && Array.isArray(value.candidates) && Array.isArray(value.existingDocuments) && Array.isArray(value.requirements) && Array.isArray(value.rebuiltTypes));
      const seen = new Set<string>();
      for (const candidate of value.candidates) {
        requireValue(selected.includes(candidate.typeId) && !seen.has(candidate.typeId) && candidate.sourceHash === project.sourceHash && candidate.status === 'DRAFT' && candidate.review === 'NEEDS_REVIEW' && Array.isArray(candidate.dependencyHashes) && candidate.dependencyHashes.every(digest) && typeof candidate.body === 'string' && candidate.hash === await hashCanonical(dataOf(candidate)) && candidate.bodyHash === await rawHash(candidate.body));
        seen.add(candidate.typeId);
      }
      for (const record of value.existingDocuments) { await validateRecord(record, project); requireValue(record.kind === 'document-draft'); }
      requireValue(value.rebuiltTypes.length === seen.size && value.rebuiltTypes.every(type => seen.has(type)) && value.requirements.every(item => selected.includes(item.typeId) && typeof item.status === 'string') && (value.impact === null || (Array.isArray(value.impact?.impacts) && value.impact.impacts.every(item => typeof item.artifact_key === 'string'))));
      if (current()) { setPreview(value); setActiveType(value.candidates[0]?.typeId ?? ''); }
    } catch (caught) { if (current()) setError(errorText(caught)); }
    finally { if (current()) setBusy(false); }
  }
  function continueSaved(record: Saved) {
    if (!catalog || dirty || busy || record.documentState.status !== 'CURRENT_DEPENDENCIES') return;
    const data = record.data as DocumentDraft;
    setBodies({}); setSaved({ [data.typeId]: record }); setEditing(true); setActiveType(data.typeId); setNotice('');
    setPreview({ sourceHash: catalog.sourceHash, contextBasisHash: catalog.contextBasisHash,
      existingDocuments: catalog.savedDocuments, candidates: [{ ...data, hash: record.sha256,
        bodyHash: record.documentState.bodyHash, supersedesHash: record.sha256, review: 'NEEDS_REVIEW' }],
      rebuiltTypes: [], requirements: [], impact: null });
  }
  async function save(candidate: Candidate) {
    const serial = ++operationSerial.current;
    const capturedScope = `${project.id}:${project.sourceHash}`;
    const current = () => alive.current && serial === operationSerial.current && scope.current === capturedScope;
    if (!preview) return;
    const id = `document-draft:${candidate.typeId}`;
    const previous = saved[candidate.typeId] ?? preview.existingDocuments.find(record => record.id === id);
    const data = { ...dataOf(candidate), body: bodies[candidate.typeId] ?? candidate.body };
    const fingerprint = JSON.stringify({ data, version: previous?.version ?? null });
    if (attempts.current[id]?.fingerprint !== fingerprint) attempts.current[id] = { fingerprint, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const record = await api.saveRecord({ id, kind: 'document-draft', expectedVersion: previous?.version ?? null, requestId: attempts.current[id].id, data });
      await validateRecord(record, project);
      requireValue(record.id === id && record.kind === 'document-draft' && record.version === (previous?.version ?? 0) + 1 && record.sha256 === await hashCanonical(data));
      if (current()) { setSaved(current => ({ ...current, [candidate.typeId]: record })); setCloseWarning(false); setNotice(`${candidate.typeId} draft saved · v${record.version}`); onSaved(); }
    } catch (caught) { if (current()) setError(errorText(caught)); }
    finally { if (current()) setBusy(false); }
  }
  return <div className="drawer-scrim"><section className="drawer document-drawer" data-unsaved={dirty ? 'true' : 'false'} role="dialog" aria-modal="true" aria-label="Production documents"><div className="drawer-heading"><div><span className="eyebrow">{project.title}</span><h2>Production documents</h2></div><button aria-label="Close documents" disabled={busy} onClick={() => dirty ? setCloseWarning(true) : onClose()}>×</button></div>
    <p className="drawer-intro">Choose a document, review the draft, then add your planning details and save. Saved revisions stay in this film’s history.</p>
    {closeWarning && <div className="document-close-warning" role="alert"><p>Your document edits have not been saved.</p><button onClick={() => setCloseWarning(false)}>Keep editing</button><button onClick={onClose}>Close without saving document edits</button></div>}
    {error && <p role="alert" className="error-bar">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button className="secondary" disabled={busy || dirty} onClick={() => { setPreview(null); setSaved({}); setBodies({}); void load(); }}>Refresh document status</button>
    {catalog && <><div className="document-status">{catalog.savedDocuments.length ? catalog.savedDocuments.map(record => <details key={record.id}><summary>{(record.data as DocumentDraft).typeId} · v{record.version} · {record.documentState.status === 'NEEDS_REBUILD' ? 'Needs rebuild' : 'Current dependencies — draft'}</summary><p>{record.documentState.reason}</p><pre>{(record.data as DocumentDraft).body}</pre><button className="secondary" onClick={() => exportDocument(record.data as DocumentDraft)}>Export saved document</button><button className="secondary" disabled={busy || dirty || record.documentState.status !== 'CURRENT_DEPENDENCIES'} onClick={() => continueSaved(record)}>Edit saved {documentName((record.data as DocumentDraft).typeId)}</button></details>) : <p>No saved document drafts yet.</p>}</div>
      <div className="document-build-controls"><h3>Build from this film</h3><p>Select documents for a reviewable draft using saved screenplay, shots and production records.</p><label className="field-label">Find a document<input type="search" value={documentQuery} onChange={event => setDocumentQuery(event.target.value)} placeholder="Breakdown, shot list, schedule…"/></label><label className="cell-checkbox"><input type="checkbox" checked={showAllTypes} onChange={event => setShowAllTypes(event.target.checked)}/>Show all production requirements, including documents needing outside inputs</label><button className="secondary" disabled={busy || dirty} onClick={() => { setSelected(catalog.registry.filter(entry => entry.supportedDraft).map(entry => entry.typeId)); setPreview(null); }}>Select all buildable documents</button><p className="scope-note">{selected.length} selected · {catalog.registry.filter(entry => entry.supportedDraft).length} can be drafted here · {catalog.registry.length} total requirements</p></div>
      <fieldset disabled={busy || dirty}><legend>Documents to preview</legend>{catalog.registry.filter(item => (showAllTypes || item.supportedDraft || selected.includes(item.typeId) || documentQuery.trim()) && `${item.name} ${item.typeId}`.toLowerCase().includes(documentQuery.trim().toLowerCase())).map(item => <label className="cell-checkbox" key={item.typeId}><input type="checkbox" checked={selected.includes(item.typeId)} onChange={event => { setPreview(null); setSelected(previous => event.target.checked ? [...previous, item.typeId] : previous.filter(type => type !== item.typeId)); }}/><span>{item.name}<small>{item.supportedDraft ? draftDescription(item.typeId) : 'Actual inputs or a dedicated builder needed'}</small></span></label>)}</fieldset>
      <label className="field-label">Impact preview<select aria-label="Changed production fact" value={fact} disabled={busy || dirty} onChange={event => { setFact(event.target.value); setPreview(null); }}><option value="">Rebuild selected drafts from current records</option>{catalog.knownFactKeys.map(key => <option key={key} value={key}>{key}</option>)}</select></label><p className="scope-note">Choosing a fact previews its dependency impact; it does not change or approve that fact.</p>
      <button className="primary" disabled={busy || dirty || selected.length === 0} onClick={() => void generatePreview()}>Preview selected documents</button>
    </>}
    {preview && <div className="document-preview" ref={reviewSurface}><h3>Review & customize</h3>{preview.impact && <p>Potentially affected: {preview.impact.impacts.map(item => documentName(item.artifact_key)).join(', ') || 'None'}.</p>}{preview.requirements.map(item => <p className="quiet-warning" key={item.typeId}>{documentName(item.typeId)}: {item.status === 'OUTPUT_EXCEEDS_LOCAL_DOCUMENT_LIMIT' ? 'This draft exceeds the local document size limit. Export individual scene packets for the full saved breakdown.' : 'Actual owner inputs or a dedicated builder are still required.'} Existing saved documents are retained.</p>)}
      <nav className="document-review-tabs" aria-label="Drafts to review">{preview.candidates.map(candidate => <button key={candidate.typeId} aria-pressed={activeCandidate?.typeId === candidate.typeId} onClick={() => setActiveType(candidate.typeId)}>{documentName(candidate.typeId)}{saved[candidate.typeId] ? ` · v${saved[candidate.typeId].version}` : ''}</button>)}</nav>
      {activeCandidate && <article className="document-review-workspace"><h3>{documentName(activeCandidate.typeId)}</h3><p className="scope-note">{draftDescription(activeCandidate.typeId)}</p>
        <div className="document-review-toolbar"><button className="secondary" aria-pressed={!editing} onClick={() => setEditing(false)}>Read draft</button><button className="secondary" aria-pressed={editing} onClick={() => setEditing(true)}>Edit draft</button><button className="secondary" onClick={() => exportDocument({ ...activeCandidate, body: bodies[activeCandidate.typeId] ?? activeCandidate.body })}>Export draft Markdown</button><span className="scope-note">{dirty ? 'Unsaved document edits' : saved[activeCandidate.typeId] ? 'Saved draft' : 'Preview · not saved'}</span></div>
        {editing ? <label className="field-label">Edit {documentName(activeCandidate.typeId)}<textarea aria-label={`Edit ${documentName(activeCandidate.typeId)}`} className="document-draft-editor" maxLength={100000} disabled={busy} spellCheck value={bodies[activeCandidate.typeId] ?? activeCandidate.body} onChange={event => setBodies(current => ({ ...current, [activeCandidate.typeId]: event.target.value }))}/><small>Edit the Markdown text and table cells. Dates and assignments stay unconfirmed until you supply them. Saving a draft does not book resources.</small></label> : <ProductionDocumentBody body={bodies[activeCandidate.typeId] ?? activeCandidate.body}/>}
        <div className="document-review-toolbar"><button className="primary" disabled={busy || Boolean(saved[activeCandidate.typeId] && (saved[activeCandidate.typeId].data as DocumentDraft).body === (bodies[activeCandidate.typeId] ?? activeCandidate.body))} onClick={() => void save(activeCandidate)}>{saved[activeCandidate.typeId] && (saved[activeCandidate.typeId].data as DocumentDraft).body === (bodies[activeCandidate.typeId] ?? activeCandidate.body) ? `Saved ${activeCandidate.typeId}` : `Save ${activeCandidate.typeId} draft`}</button><small>New revisions preserve the previous saved document.</small></div>
      </article>}
      {dirty && <p className="scope-note">Save your document edits before rebuilding or refreshing.</p>}
    </div>}
      {Boolean(catalog?.referenceDocuments?.length) && <section className="document-status" aria-label="Project reference documents"><h3>Project reference documents ({catalog?.referenceDocuments!.length})</h3><p>Retained notes and source reports. Their original text stays separate from generated production drafts.</p>{catalog?.referenceDocuments!.map(record => <details key={record.id}><summary>{(record.data as DocumentDraft).typeId.replace(/[-_]/g, ' ')} · v{record.version}</summary><p>{record.documentState.sourceMatches ? 'Linked to this screenplay' : 'Retained from another screenplay revision'}</p><pre>{(record.data as DocumentDraft).body}</pre><button className="secondary" onClick={() => exportDocument(record.data as DocumentDraft)}>Export reference document</button></details>)}</section>}
  </section></div>;
}
