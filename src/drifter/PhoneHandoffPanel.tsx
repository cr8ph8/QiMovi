import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronRight, RefreshCw, Smartphone, X } from 'lucide-react';
import { downloadLocalBlob } from './localDownload';
import { canonicalJson } from './canonical';
import { PHONE_REVIEW_MAX_BYTES, phoneHandoffApi, type PhoneChange, type PhoneHandoffApi, type PhoneReviewPreview } from './phoneHandoffApi';
import type { WorkspaceProject, WorkspaceRecord } from './types';
import './phone-handoff.css';

type Props = {
  project: WorkspaceProject;
  open: boolean; dirty?: boolean; onClose: () => void; onSaved: (record: WorkspaceRecord) => void;
  api?: PhoneHandoffApi;
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The phone handoff could not be confirmed.';
const fieldLabels: Record<string, string> = {
  shotSize: 'Framing', movement: 'Camera movement', purpose: 'Shot purpose', stage: 'Production phase',
  nextActions: 'Next actions', title: 'Title', label: 'Shot label', durationSeconds: 'Planned duration', status: 'Status',
  description: 'Description', captured: 'Captured on phone', notes: 'Notes',
};
const statusLabels = { READY: 'Ready to apply', CONFLICT: 'Desktop changed', REVIEW_ONLY: 'Review only', UNCHANGED: 'Already current' };
const valueLabels: Record<string, string> = { PREDEVELOPMENT: 'Pre-development', DEVELOPMENT: 'Development', PREPRODUCTION: 'Pre-production', PRODUCTION: 'Production', WRAP: 'Wrap', FINISHING: 'Post-production', MARKETING: 'Marketing', DISTRIBUTION: 'Distribution', TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };
function words(value: string) { return valueLabels[value] ?? value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function displayValue(value: unknown, field?: string): string {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(item => {
    if (field === 'nextActions' && item && typeof item === 'object' && 'title' in item) {
      const task = item as { title: string; stage?: string; status?: string };
      return `${task.title}${task.stage ? ` · ${words(task.stage)}` : ''}${task.status ? ` · ${words(task.status)}` : ''}`;
    }
    return typeof item === 'string' ? item : JSON.stringify(item, null, 2);
  }).join('\n') : 'None';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : valueLabels[String(value)] ?? String(value);
}

export default function PhoneHandoffPanel({ project, open, dirty = false, onClose, onSaved, api = phoneHandoffApi }: Props) {
  const [reviewPackage, setReviewPackage] = useState<unknown>();
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<PhoneReviewPreview>();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsReviewRefresh, setNeedsReviewRefresh] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const operation = useRef(0);
  const controller = useRef<AbortController>();
  const requestIds = useRef(new Map<string, string>());
  const scope = `${project.id}:${project.sourceHash ?? 'creative'}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const currentOpen = useRef(open);
  currentOpen.current = open;
  const applying = Boolean(pending?.startsWith('apply:'));

  useEffect(() => {
    if (!open) {
      ++operation.current; controller.current?.abort(); setPending(null);
      setNeedsReviewRefresh(true);
    }
  }, [open]);
  useEffect(() => {
    ++operation.current; controller.current?.abort();
    setReviewPackage(undefined); setFilename(''); setPreview(undefined); setPending(null); setError(''); setNotice(''); setNeedsReviewRefresh(false);
    requestIds.current.clear();
  }, [scope]);
  useEffect(() => () => { ++operation.current; controller.current?.abort(); }, []);

  function begin(kind: string) {
    controller.current?.abort();
    const activeController = new AbortController(); controller.current = activeController;
    const serial = ++operation.current;
    setPending(kind); setError(''); setNotice('');
    return { signal: activeController.signal, current: () => serial === operation.current && currentScope.current === scope && currentOpen.current };
  }
  function checkScope(next: PhoneReviewPreview) {
    if (next.projectId !== project.id || next.sourceHash !== project.sourceHash) throw new Error('This review belongs to a different film or screenplay revision. Export a new phone slate from this film.');
    return next;
  }
  async function exportSlate() {
    const task = begin('export');
    try {
      const slate = await api.export(task.signal);
      if (!task.current()) return;
      if (slate.projects.length !== 1 || slate.projects[0].id !== project.id || slate.projects[0].sourceHash !== project.sourceHash) throw new Error('The current film changed. Refresh the workspace before exporting.');
      const name = project.title.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'film';
      downloadLocalBlob(new Blob([JSON.stringify(slate, null, 2)], { type: 'application/json' }), `${name}.qimovi`);
      setNotice('Phone slate prepared. Save the .qimovi file, then open it in QiMovi on your iPhone.');
    } catch (caught) { if (task.current()) setError(errorMessage(caught)); }
    finally { if (task.current()) setPending(null); }
  }
  async function importReview(file: File) {
    const task = begin('preview');
    setPreview(undefined); setReviewPackage(undefined); setFilename(file.name); setNeedsReviewRefresh(false);
    try {
      if (file.size > PHONE_REVIEW_MAX_BYTES) throw new Error('Choose a phone review JSON file smaller than 2 MB.');
      if (!file.size) throw new Error('This file is empty. Export a review from QiMovi on your iPhone.');
      let value: unknown;
      try { value = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON. Choose the review exported from QiMovi on your iPhone.'); }
      if (!task.current()) return;
      setReviewPackage(value);
      const next = checkScope(await api.preview(value, task.signal));
      if (task.current()) { setPreview(next); setNotice('Review loaded. Choose Apply for each change you want to keep.'); }
    } catch (caught) { if (task.current()) setError(errorMessage(caught)); }
    finally { if (task.current()) setPending(null); }
  }
  async function refreshReview() {
    if (reviewPackage === undefined) return;
    const task = begin('preview');
    setNeedsReviewRefresh(true);
    try {
      const next = checkScope(await api.preview(reviewPackage, task.signal));
      if (task.current()) { setPreview(next); setNeedsReviewRefresh(false); setNotice('Review checked against the current saved film.'); }
    } catch (caught) { if (task.current()) setError(errorMessage(caught)); }
    finally { if (task.current()) setPending(null); }
  }
  async function applyChange(change: PhoneChange) {
    if (!preview || pending || needsReviewRefresh || change.status !== 'READY' || reviewPackage === undefined) return;
    const task = begin(`apply:${change.id}`);
    const retryKey = `${preview.previewSha256}:${change.id}`;
    if (!requestIds.current.has(retryKey)) requestIds.current.set(retryKey, crypto.randomUUID());
    try {
      const result = await api.apply({ reviewPackage, changeId: change.id, previewSha256: preview.previewSha256, expectedVersion: change.expectedVersion, requestId: requestIds.current.get(retryKey)! }, task.signal, project);
      if (!task.current()) return;
      const savedData = result.record.data as Record<string, unknown>;
      if (!savedData || Object.entries(change.after).some(([field, value]) => savedData[field] === undefined || canonicalJson(savedData[field]) !== canonicalJson(value))) throw new Error('The save response does not match the change you reviewed.');
      onSaved(result.record);
      setNeedsReviewRefresh(true);
      setNotice(`${change.label} saved. Your open editor drafts are still kept.`);
      try {
        const next = checkScope(await api.preview(reviewPackage, task.signal));
        if (task.current()) { setPreview(next); setNeedsReviewRefresh(false); }
      } catch (caught) { if (task.current()) setError(`The change was saved. Refresh the review to continue. ${errorMessage(caught)}`); }
    } catch (caught) { if (task.current()) { setError(`${errorMessage(caught)} Refresh the review before applying another change.`); setNeedsReviewRefresh(true); } }
    finally { if (task.current()) setPending(null); }
  }

  const counts = preview?.changes.reduce((totals, change) => ({ ...totals, [change.status]: totals[change.status] + 1 }), { READY: 0, CONFLICT: 0, REVIEW_ONLY: 0, UNCHANGED: 0 });
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !applying) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="phone-handoff-overlay"/>
      <Dialog.Content className="phone-handoff-panel" onOpenAutoFocus={() => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onEscapeKeyDown={event => { if (applying) event.preventDefault(); }} onPointerDownOutside={event => { if (applying) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <header className="phone-handoff-heading">
          <div><span className="phone-handoff-eyebrow"><Smartphone size={14} aria-hidden="true"/>QIMOVI · PHONE</span><Dialog.Title>Phone handoff</Dialog.Title><Dialog.Description>{project.title} <span aria-hidden="true">/</span> Export your saved film. Review changes from your phone.</Dialog.Description></div>
          <Dialog.Close className="phone-handoff-close" aria-label="Close phone handoff" disabled={applying}><X size={20}/></Dialog.Close>
        </header>
        <div className="phone-handoff-body">
          <section className="phone-handoff-transfer" aria-label="Transfer film with iPhone">
            <div><span className="phone-handoff-step">01 <ChevronRight size={13} aria-hidden="true"/> MAC TO IPHONE</span><h3>Export a phone slate</h3><p>Bring the saved film, shot directions and next actions into QiMovi on your iPhone.</p><button className="phone-handoff-primary" disabled={Boolean(pending)} onClick={() => void exportSlate()}><ArrowDownToLine size={16} aria-hidden="true"/>{pending === 'export' ? 'Preparing slate…' : 'Export .qimovi'}</button><small>Open the file from Files or AirDrop on your iPhone.</small></div>
            <div><span className="phone-handoff-step">02 <ChevronRight size={13} aria-hidden="true"/> IPHONE TO MAC</span><h3>Review phone changes</h3><p>Choose the review JSON exported on your phone. Inspect every change before applying it.</p><input ref={input} type="file" accept=".json,application/json" aria-label="Phone review JSON file" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importReview(file); }}/><button className="phone-handoff-secondary" disabled={Boolean(pending)} onClick={() => input.current?.click()}><ArrowUpFromLine size={16} aria-hidden="true"/>{pending === 'preview' ? 'Checking review…' : 'Choose phone review'}</button><small>JSON · up to 2 MB · importing does not apply changes</small></div>
          </section>
          {dirty && <p className="phone-handoff-draft-note">Your open drafts stay on this Mac. Export uses saved work; save any edits you want to take with you.</p>}
          <p className="phone-handoff-capabilities"><Check size={15} aria-hidden="true"/><span>Shot direction, phase and next actions can be applied. Shot labels, duration, new shots and capture flags remain available for review.</span></p>
          {error && <div className="phone-handoff-error" role="alert">{error}</div>}
          {notice && <p className="phone-handoff-notice" role="status">{notice}</p>}
          {reviewPackage !== undefined && <section className="phone-handoff-review" aria-label="Phone review preview" aria-busy={Boolean(pending)}>
            <div className="phone-handoff-review-heading"><div><span className="phone-handoff-eyebrow">REVIEW BEFORE APPLYING</span><h3>Changes from your phone</h3><p>{filename}</p></div><button className="phone-handoff-refresh" disabled={Boolean(pending)} onClick={() => void refreshReview()}><RefreshCw size={14} aria-hidden="true"/>Refresh review</button></div>
            {needsReviewRefresh && <p className="phone-handoff-draft-note">Refresh this review to compare it with the latest saved film before applying changes.</p>}
            {counts && <p className="phone-handoff-counts">{counts.READY} ready <span>·</span> {counts.CONFLICT} conflicts <span>·</span> {counts.REVIEW_ONLY} review only <span>·</span> {counts.UNCHANGED} current</p>}
            {preview?.warnings.length ? <details className="phone-handoff-warnings"><summary>Review notes ({preview.warnings.length})</summary><ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
            {preview && !preview.changes.length && <p className="phone-handoff-empty">There are no changes in this phone review.</p>}
            {preview?.changes.map(change => <ChangePreview key={change.id} change={change} disabled={Boolean(pending) || needsReviewRefresh} applying={pending === `apply:${change.id}`} onApply={() => void applyChange(change)}/>)}
          </section>}
        </div>
        <footer className="phone-handoff-footer"><span>Files move by your choice. Each applied change is saved to this film.</span><button onClick={onClose} disabled={applying}>Back to film</button></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function ChangePreview({ change, disabled, applying, onApply }: { change: PhoneChange; disabled: boolean; applying: boolean; onApply: () => void }) {
  const fields = Array.from(new Set([...Object.keys(change.before), ...Object.keys(change.after)]));
  return <article className="phone-handoff-change" data-status={change.status}>
    <div className="phone-handoff-change-heading"><div><span className="phone-handoff-change-status">{statusLabels[change.status]}</span><h4>{change.label}</h4></div>{change.status === 'READY' && <button className="phone-handoff-apply" disabled={disabled} onClick={onApply} aria-label={`Apply ${change.label}`}>{applying ? 'Applying…' : 'Apply change'}<Check size={14} aria-hidden="true"/></button>}</div>
    <p className="phone-handoff-reason">{change.reason}</p>
    <div className="phone-handoff-diff" role="table" aria-label={`${change.label} comparison`}><div className="phone-handoff-diff-head" role="row"><span role="columnheader">Field</span><span role="columnheader">Saved on Mac</span><span role="columnheader">From your phone</span></div>{fields.map(field => <div className="phone-handoff-diff-row" role="row" key={field} data-changed={JSON.stringify(change.before[field]) !== JSON.stringify(change.after[field])}><strong role="rowheader">{fieldLabels[field] ?? words(field)}</strong><div role="cell"><span className="phone-handoff-mobile-label">Saved on Mac</span>{displayValue(change.before[field], field)}</div><div role="cell"><span className="phone-handoff-mobile-label">From your phone</span>{displayValue(change.after[field], field)}</div></div>)}</div>
  </article>;
}
