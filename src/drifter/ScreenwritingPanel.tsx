import AuthoringSourceLinks from './AuthoringSourceLinks';
import { FilmcraftDisclosure } from './FilmcraftGuide';
import { forwardRef, useEffect, useImperativeHandle, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScreenplayWritingSurface, type ScreenplayWritingSurfaceHandle } from '@/components/writer/ScreenplayWritingSurface';
import { parseFountain } from '@/lib/fountain-parser';
import { paginateElements } from '@/lib/fountain-paginator';
import { computeCompletionPct, countWords, targetPagesFor } from '@/lib/writingProgress';
import ScreenplaySceneNavigator from './ScreenplaySceneNavigator';
import { applyScreenplayEditorChange, buildScreenplayIndex, screenplayOffsetToTextarea, screenplayTextareaValue, textareaOffsetToScreenplay } from './screenplayIndex';
import type { Project, ScreenplayDraft, WorkspaceApi, WorkspaceRecord, WritingSession } from './types';
import { downloadLocalBlob } from './localDownload';
import { assertExportableText, createWritingDocx, createWritingPdf, writingExportFilename, writingExportScope } from './writingExports';
import { useWritingSession } from './useWritingSession';
import { formatWritingTime } from './writingSession';
import ScreenplayConnections from './ScreenplayConnections';
import type { ScreenplayConnectionAction } from './screenplayConnectionsModel';
import './writerProductivity.css';
import './writer-tools-visible.css';
import { useWritingDraft } from './useWritingDraft';
import WritingRecoveryControls from './WritingRecoveryControls';
import WritingDraftHistory from './WritingDraftHistory';
import WritingProductionImpactView from './WritingProductionImpactView';
import { writingProductionImpact } from './writingProductionImpact';
import { retainedSourceDraft } from './retainedSourceDraft';
import LegacyProductionRevisionPanel from './LegacyProductionRevisionPanel';
import './legacy-production-revision.css';

export interface WritingContext { id: string; title: string; body: string; saved: WorkspaceRecord | null; dirty: boolean; sessionDirty?: boolean }
export interface ScreenwritingHandle { openDraft(id: string): void; prepareDraft(data: Pick<ScreenplayDraft, 'title' | 'body' | 'inputRefs'>): void; focusScene(sceneIndex: number): void; focusSourcePassage(sceneId: string, paragraphId: string): void }
type Props = { project: Project; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; sceneId: string; onClose: () => void; onSaved: (record: WorkspaceRecord) => void; embedded?: boolean; workflowActions?: ReactNode; onOpenSource?: (record: WorkspaceRecord) => void; onContextChange?: (context: WritingContext) => void; onElementAction?: (action: ScreenplayConnectionAction, sceneId: string, paragraphId: string) => void };
type Switch = { kind: 'new' } | { kind: 'open'; id: string } | { kind: 'prepared'; data: Pick<ScreenplayDraft, 'title' | 'body' | 'inputRefs' | 'sceneId'>; notice?: string };
const referenceViews = [['outline', 'Outline'], ['source', 'Retained source'], ['connections', 'Connections'], ['preview', 'Draft preview']] as const;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The local draft operation was not confirmed.';

/** Authoring is separate from the frozen production source and its admission path. */
const ScreenwritingPanel = forwardRef<ScreenwritingHandle, Props>(function ScreenwritingPanel({ project, records, api, open, sceneId, onClose, onSaved, embedded = false, workflowActions, onOpenSource, onContextChange, onElementAction }, ref) {
  const [revisionBusy, setRevisionBusy] = useState(false), [revisionDirty, setRevisionDirty] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<'write' | 'production'>('write');
  const draft = useWritingDraft({ project, records, api, onSaved });
  const { id, title, setTitle, body, setBody, metadata, setMetadata, saved, baseline, refreshed, setRefreshed, dirty, library, busy: draftBusy, setBusy, error, setError, notice, setNotice, operation, alive, scope, currentScope } = draft;
  const busy = draftBusy || revisionBusy;
  const [reader, setReader] = useState<'outline' | 'source' | 'connections' | 'preview'>('outline');
  const panelId = useId();
  const [sourceScene, setSourceScene] = useState(sceneId);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Record<string, string>>({});
  const [sourceNavigationError, setSourceNavigationError] = useState('');
  const [sourceFocus, setSourceFocus] = useState<{ sceneId: string; paragraphId: string } | null>(null);
  const sourcePages = useRef<HTMLDivElement>(null);
  const [activeSceneOffset, setActiveSceneOffset] = useState<number | null>(null);
  useEffect(() => { setSourceScene(sceneId); }, [sceneId]);
  const [pendingSwitch, setPendingSwitch] = useState<Switch | null>(null);
  const editor = useRef<ScreenplayWritingSurfaceHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const source = project.scenes.find(scene => scene.id === sourceScene) ?? project.scenes[0];
  const sourceParagraphs = source ? [...(source.index === 1 ? project.prologue ?? [] : []), ...source.paragraphs] : [];
  const selectedSource = sourceParagraphs.find(item => item.id === selectedSourceIds[sourceScene]) ?? source?.paragraphs[0];
  const selectedSourceScene = selectedSource && project.prologue?.some(item => item.id === selectedSource.id) ? '__prologue__' : source?.id;
  const parsed = useMemo(() => parseFountain(body, { inputMode: 'fountain' }), [body]);
  const pages = useMemo(() => paginateElements(parsed.elements).pages, [parsed]);
  const words = useMemo(() => countWords(body), [body]);
  const pageTarget = targetPagesFor(metadata.projectFormat, metadata.targetPages);
  const session = useWritingSession({ draftId: id, sourceHash: project.sourceHash, saved, dirty, words, visible: open, api, onSaved: record => { setRefreshed(previous => [...previous.filter(item => item.id !== record.id), record]); onSaved(record); } });
  const unsaved = dirty || session.hasSession || revisionDirty || revisionBusy;
  const savedSessions = useMemo(() => [...new Map([...records, ...refreshed].filter(record => record.kind === 'writing-session' && (record.data as WritingSession).draftId === id && (record.data as WritingSession).sourceHash === project.sourceHash).map(record => [record.id, record])).values()], [records, refreshed, id, project.sourceHash]);
  const savedSessionMs = savedSessions.reduce((sum, record) => sum + (record.data as WritingSession).activeMs, 0);
  useEffect(() => { onContextChange?.({ id, title, body, saved, dirty: dirty || revisionDirty, sessionDirty: session.hasSession }); }, [id, title, body, saved, dirty, revisionDirty, session.hasSession, onContextChange]);
  const editorText = useMemo(() => screenplayTextareaValue(body), [body]);
  const draftIndex = useMemo(() => buildScreenplayIndex(body), [body]);
  const savedIndex = useMemo(() => baseline ? buildScreenplayIndex(baseline.body) : null, [baseline]);
  const productionImpact = useMemo(() => writingProductionImpact({ project, draft: saved, records: [...records, ...refreshed], hasUnsavedChanges: dirty }), [project, saved, records, refreshed, dirty]);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  useEffect(() => {
    if (!open || reader !== 'source' || !sourceFocus) return;
    if (sourceScene !== sourceFocus.sceneId) { setSourceScene(sourceFocus.sceneId); return; }
    const passage = [...(sourcePages.current?.querySelectorAll<HTMLElement>('[data-paragraph-id]') ?? [])]
      .find(item => item.dataset.paragraphId === sourceFocus.paragraphId)?.querySelector<HTMLButtonElement>('button');
    if (!passage) return;
    passage.focus(); passage.scrollIntoView?.({ block: 'center' }); setSourceFocus(null);
  }, [open, reader, sourceFocus, sourceScene]);

  function changeDraft(next: Switch) {
    if (busy) return;
    const record = next.kind === 'open' ? library.find(item => item.id === next.id) : null;
    if (next.kind === 'open' && !record) { setError('The selected draft is unavailable. Refresh the draft list.'); return; }
    setRevisionDirty(false);
    draft.loadDraft(record ?? null, next.kind === 'prepared' ? next.data : undefined);
    if (next.kind === 'prepared' && next.notice) setNotice(next.notice);
    setActiveSceneOffset(null); setPendingSwitch(null);
  }
  function requestSwitch(next: Switch) {
    if (busy) return;
    if (session.hasSession) { setError('Finish and save the writing session, or discard its paused timer before switching drafts. Your writing is retained.'); return; }
    if (dirty || revisionDirty) setPendingSwitch(next); else changeDraft(next);
  }
  function startFromSource(selectedSceneId?: string) {
    if (busy) return;
    try {
      const copy = retainedSourceDraft(project, selectedSceneId);
      requestSwitch({ kind: 'prepared', data: copy.data, notice: `Editable copy prepared from ${selectedSceneId ? `retained scene ${source?.index}` : `${copy.sceneCount} retained scenes`}. Review the conversion and save this new writing draft when ready. Source references are included as nonprinting Fountain notes. Original page layout, styling and revision marks are not copied.${copy.warnings.length ? ` Conversion review: ${copy.warnings.join(' ')}` : ''}` });
    } catch (caught) { setError(errorText(caught)); }
  }
  function focusSourcePassage(targetSceneId: string, paragraphId: string) {
    const scenes = project.scenes.filter(item => targetSceneId === '__prologue__' ? item.index === 1 : item.id === targetSceneId);
    const target = scenes.length === 1 ? scenes[0] : undefined;
    const paragraphs = targetSceneId === '__prologue__' ? project.prologue ?? [] : target?.paragraphs ?? [];
    if (!target || paragraphs.filter(item => item.id === paragraphId).length !== 1) {
      setSourceNavigationError('This source link does not identify a passage in the retained scene. Your writing and source selection are unchanged.');
      return;
    }
    setSourceNavigationError(''); setSourceScene(target.id);
    setSelectedSourceIds(previous => ({ ...previous, [target.id]: paragraphId }));
    setReader('source'); setSourceFocus({ sceneId: target.id, paragraphId });
  }
  useImperativeHandle(ref, () => ({ openDraft: draftId => requestSwitch({ kind: 'open', id: draftId }), prepareDraft: data => requestSwitch({ kind: 'prepared', data }), focusScene: index => { const scene = draftIndex.scenes[index - 1]; if (Number.isInteger(index) && scene) jump(scene.start); }, focusSourcePassage }));
  const refresh = draft.refresh;
  async function save() { if (await draft.save()) setPendingSwitch(null); }
  async function importDraft(file: File) {
    if (session.hasSession) return;
    if (await draft.importDraft(file)) setActiveSceneOffset(null);
    if (fileInput.current) fileInput.current.value = '';
  }
  function exportDraft() {
    try {
      assertExportableText(body);
      downloadLocalBlob(new Blob([body], { type: 'text/plain;charset=utf-8' }), writingExportFilename(title, 'fountain'));
      setError(''); setNotice(`Fountain export requested · ${writingExportScope(dirty, saved?.version)}. Exact visible text; complete the Save dialog.`);
    } catch (caught) { setError(errorText(caught)); }
  }
  async function exportDocument(format: 'PDF' | 'DOCX') {
    if (busy || !body) return;
    const snapshot = { title, body, scope: writingExportScope(dirty, saved?.version) };
    const serial = ++operation.current; setBusy(true); setError('');
    const current = () => alive.current && operation.current === serial && currentScope.current === scope;
    try {
      const output = format === 'PDF' ? createWritingPdf(snapshot) : await createWritingDocx(snapshot);
      if (current()) { downloadLocalBlob(output.blob, output.filename); setNotice(`${format} export requested · ${snapshot.scope}. Complete the Save dialog; your writing is unchanged.${output.warnings?.length ? ` ${output.warnings.join(' ')}` : ''}`); }
    } catch (caught) { if (current()) setError(errorText(caught)); }
    finally { if (current()) setBusy(false); }
  }
  function jump(offset: number) {
    editor.current?.focusOffset(screenplayOffsetToTextarea(body, offset));
    setActiveSceneOffset(offset);
  }

  return <div hidden={!open} data-writing-draft={id} className={embedded ? "screenwriting-embedded" : "drawer-scrim"} data-unsaved={unsaved ? 'true' : 'false'}><section className="drawer screenwriting-drawer screenwriting-workspace" role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label="CanIScreenwrite local authoring">
    <header className="writer-draft-bar">
      <label className="writer-title"><span>Writing draft</span><input aria-label="Writing draft title" disabled={busy} maxLength={200} value={title} onChange={event => { setTitle(event.target.value); setNotice(''); }}/></label>
      <div className="writer-save-controls"><strong>{dirty ? 'Unsaved writing draft' : saved ? `Saved locally · v${saved.version}` : 'New writing draft'}</strong><button className="primary" disabled={busy || !dirty || !title.trim() || body.length > 200000 || /[\r\n\0]/.test(title)} onClick={() => void save()}>{busy ? 'Working…' : 'Save writing draft'}</button>{!embedded && <button aria-label="Close screenwriting" disabled={busy} onClick={onClose}>×</button>}</div>
    </header>
    {!project.creativeOrigin && <div className="writer-workspace-switch" aria-label="Writing and production workspace">
      <button type="button" aria-pressed={workspaceView === 'write'} onClick={() => setWorkspaceView('write')}>Write screenplay</button>
      <button type="button" aria-pressed={workspaceView === 'production'} onClick={() => setWorkspaceView('production')}>Production review</button>
      <span>{workspaceView === 'write' ? 'Editable draft' : 'Compare saved writing with the retained film'}</span>
    </div>}
    <div hidden={workspaceView !== 'write'} className="writer-authoring-tools">
    <FilmcraftDisclosure className="writing-filmcraft-guide" label="Filmmaking guide · story, visual language & sound" context="writing"/>
    <small className="writer-recovery-status" role="status">{draft.recovery.status}</small>
    {draft.recovery.error && <p className="writer-recovery-warning" role="alert">Recovery not confirmed: {draft.recovery.error}. Keep the app open and retry in Drafts, or export your writing.</p>}
    <section className="writer-tool-group" aria-label="Start from retained screenplay"><div className="writer-menu-actions"><button className="primary" disabled={busy || !project.scenes.length} onClick={() => startFromSource()}>Start from project screenplay</button><span>{project.scenes.length} retained scenes{project.prologue?.length ? ' · includes opening text' : ''}</span></div><p>Open an editable Fountain copy, then save it as a new writing draft. Paragraph text and source references carry over; review formatting before sharing. The retained screenplay stays available in the source reader.</p></section>
    <div className="writer-utilities writer-tools-visible" aria-label="Draft tools">
      <AuthoringSourceLinks key={`${id}:sources`} project={project} inputRefs={metadata.inputRefs ?? []} records={[...records, ...refreshed]} api={api} disabled={busy} onOpenCurrent={onOpenSource}/>
      {workflowActions && <div className="writer-workflow-actions">{workflowActions}</div>}
      <section className="writer-tool-group writer-drafts-group" aria-labelledby={`${panelId}-drafts-heading`}><h3 id={`${panelId}-drafts-heading`}>Drafts</h3><div className="writer-menu-content screenwriting-library"><label>Open saved writing draft<select aria-label="Open saved writing draft" value={saved?.id ?? ''} disabled={busy} onChange={event => { if (event.target.value) requestSwitch({ kind: 'open', id: event.target.value }); }}><option value="">New writing draft</option>{library.map(record => <option key={record.id} value={record.id}>{(record.data as ScreenplayDraft).title} · v{record.version}</option>)}</select></label><div className="writer-menu-actions"><button className="secondary" disabled={busy} onClick={() => requestSwitch({ kind: 'new' })}>New draft</button><button className="secondary" disabled={busy} onClick={() => void refresh()}>Refresh drafts</button><button className="secondary" disabled={busy || !saved} onClick={() => { if (saved) requestSwitch({ kind: 'open', id: saved.id }); }}>Reopen saved draft</button><button className="secondary" disabled={busy || dirty || session.hasSession} onClick={() => fileInput.current?.click()}>Import Fountain</button></div><p>Imports open as separate writing drafts. The retained film screenplay stays unchanged.</p><WritingRecoveryControls draft={draft} disabled={busy || session.hasSession}/><WritingDraftHistory api={api} canRestoreScene={!(busy || session.hasSession || dirty || revisionDirty)} onRestoreScene={proposal => { if (!(busy || session.hasSession || dirty || revisionDirty)) draft.restoreScene(proposal); }} saved={saved} disabled={busy || session.hasSession} scopeKey={scope} onFork={record => { const data = record.data as ScreenplayDraft; requestSwitch({ kind: 'prepared', data: { ...data, title: `${data.title} · from v${record.version}`.slice(0, 200), inputRefs: [{ id: record.id, sha256: record.sha256 }] } }); }}/></div></section>
      <input ref={fileInput} type="file" accept=".fountain,.txt,text/plain" aria-label="Import Fountain draft file" className="screenwriting-file" onChange={event => { const file = event.target.files?.[0]; if (file) void importDraft(file); }}/>
      <section className="writer-tool-group writer-details-group" aria-labelledby={`${panelId}-details-heading`}><h3 id={`${panelId}-details-heading`}>Details & goal</h3><div className="writer-menu-content"><fieldset className="screenwriting-metadata" disabled={busy}><label>Genre<input aria-label="Draft genre" maxLength={120} value={metadata.genre ?? ''} onChange={event => setMetadata(previous => ({ ...previous, genre: event.target.value }))}/></label><label>Format<select aria-label="Draft production format" value={metadata.projectFormat ?? ''} onChange={event => setMetadata(previous => { const next = { ...previous }; if (event.target.value) next.projectFormat = event.target.value as ScreenplayDraft['projectFormat']; else delete next.projectFormat; return next; })}><option value="">Unspecified</option><option value="short">Short film</option><option value="micro">Micro short</option><option value="vertical">Vertical</option><option value="pilot_30">30-minute pilot</option><option value="pilot_60">60-minute pilot</option><option value="feature">Feature</option></select></label><label>Target pages<input aria-label="Target draft pages" type="number" min="1" max="1000" step="1" value={metadata.targetPages ?? ''} onChange={event => setMetadata(previous => { const next = { ...previous }; const value = Number(event.target.value); if (event.target.value && Number.isInteger(value) && value > 0) next.targetPages = value; else delete next.targetPages; return next; })}/></label></fieldset><div className="writer-progress-heading"><strong>Page goal</strong><span>{parsed.stats.pageCount} / {pageTarget} · {computeCompletionPct(parsed.stats.pageCount, pageTarget)}%</span><progress aria-label="Draft page goal progress" max={pageTarget} value={Math.min(pageTarget, parsed.stats.pageCount)}/></div><p>Page counts are approximate formatted length, not a finished-script assessment.</p><div className="writer-editor-help"><strong>Formatting & exact text</strong><p>Fountain formats as you type. The outline retains exact text ranges. Edited line breaks follow the nearby line-ending style; untouched text stays exact.</p></div></div></section>
      <section className="writer-tool-group writer-session-group" aria-labelledby={`${panelId}-session-heading`}><h3 id={`${panelId}-session-heading`}>Session{session.hasSession && <output className="writer-clock" aria-label="Active writing session time">{formatWritingTime(session.elapsed)}</output>}</h3><div className="writer-menu-content"><section className="writer-session" aria-label="Writing progress and session"><strong>{session.pending ? 'Awaiting confirmation' : session.clock ? session.clock.activeSince === null ? 'Session paused' : 'Writing session running' : 'Writing session'}</strong><div className="writer-session-actions">
        {!session.hasSession ? <button className="secondary" disabled={busy || dirty || !saved} onClick={session.start}>Start writing session</button> : <>
          {!session.pending && (session.clock?.activeSince === null ? <button className="secondary" disabled={busy || session.busy} onClick={session.resume}>Resume session</button> : <button className="secondary" disabled={session.busy} onClick={session.pause}>Pause session</button>)}
          <button className="secondary" disabled={busy || session.busy || !session.pending && (dirty || !saved)} onClick={() => void session.finish()}>{session.busy ? 'Recording session…' : session.pending ? 'Retry session save' : 'Finish and record session'}</button>
          {!session.pending && session.clock?.activeSince === null && <button className="secondary" disabled={session.busy} onClick={session.discard}>Discard timer</button>}
        </>}
      </div>{dirty && <small className="writer-session-hint">Save the draft before {session.hasSession ? 'finishing' : 'starting'} a session.</small>}<small>{savedSessions.length} saved session{savedSessions.length === 1 ? '' : 's'} · {formatWritingTime(savedSessionMs)} recorded for this draft</small><div className="writer-session-about"><strong>About writing sessions</strong><p>Only an explicitly started timer counts. Leaving the writer pauses it. Save the current text before finishing to bind its word count to a retained revision. Unfinished timers remain in this window until recorded or discarded.</p></div></section></div></section>
      <section className="writer-tool-group writer-export-group" aria-labelledby={`${panelId}-export-heading`}><h3 id={`${panelId}-export-heading`}>Export draft</h3><div className="writer-menu-content"><strong>{writingExportScope(dirty, saved?.version)}</strong><div className="writer-export-actions"><button className="secondary" disabled={busy || !body} onClick={exportDraft}>Export Fountain</button><button className="secondary" disabled={busy || !body} onClick={() => void exportDocument('PDF')}>Export PDF</button><button className="secondary" disabled={busy || !body} onClick={() => void exportDocument('DOCX')}>Export DOCX</button></div><p>Fountain retains the exact text. PDF and editable DOCX format screenplay elements, omitting notes, synopses and boneyard comments. Review pagination before sharing; DOCX fonts depend on the reading app.</p></div></section>
      <span className="writer-draft-stats">{parsed.stats.wordCount} words · {draftIndex.scenes.length} scenes · ~{parsed.stats.pageCount} pages</span>
    </div>
    </div>
    {pendingSwitch && <div className="screenwriting-switch" role="alert"><p>This workspace has unsaved edits. Save them first, or discard the open edits to continue.</p><button className="secondary" disabled={busy} onClick={() => setPendingSwitch(null)}>Keep editing</button><button className="secondary" disabled={busy} onClick={() => changeDraft(pendingSwitch)}>Discard edits and continue</button></div>}
    {error && <p role="alert" className="error-bar">{error}</p>}{session.error && <p role="alert" className="error-text">{session.error}</p>}
    {sourceNavigationError && <p role="alert" className="error-bar">{sourceNavigationError}</p>}
    {notice && <p className="writer-notice" role="status">{notice}</p>}{session.notice && <p className="writer-notice" role="status">{session.notice}</p>}
    <div className="screenwriting-layout" hidden={workspaceView !== 'write'}><section className="screenwriting-author"><fieldset disabled={busy}><ScreenplayWritingSurface key={id} ref={editor} historyValue={body} onRestoreValue={next => { setBody(next); setNotice(''); }} value={editorText} ariaLabel="Fountain screenplay draft" disabled={busy} onSave={() => { if (dirty && title.trim()) void save(); }} onSelectionChange={selection => setActiveSceneOffset(textareaOffsetToScreenplay(body, selection.start))} onChange={next => { setBody(previous => applyScreenplayEditorChange(previous, next)); setNotice(''); }}/></fieldset>{body.length > 200000 && <p role="alert" className="error-text">Draft exceeds the 200,000 character limit. Shorten it before saving.</p>}</section>
      <aside className="screenwriting-source" aria-label="Writing context"><div className="screenwriting-reader-tabs" role="tablist" aria-label="Writing reference view">{referenceViews.map(([value, label]) => <button key={value} id={`${panelId}-${value}`} role="tab" aria-selected={reader === value} aria-controls={`${panelId}-context`} tabIndex={reader === value ? 0 : -1} onKeyDown={event => {
          const position = referenceViews.findIndex(([item]) => item === value);
          const next = event.key === 'ArrowRight' ? (position + 1) % referenceViews.length : event.key === 'ArrowLeft' ? (position + referenceViews.length - 1) % referenceViews.length : event.key === 'Home' ? 0 : event.key === 'End' ? referenceViews.length - 1 : null;
          if (next === null) return; event.preventDefault(); setReader(referenceViews[next][0]); event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
        }} onClick={() => setReader(value)}>{label}</button>)}</div>
        <div className="writer-context-content" id={`${panelId}-context`} role="tabpanel" aria-labelledby={`${panelId}-${reader}`}>
          {reader === 'outline' && <><ScreenplaySceneNavigator index={draftIndex} baseline={savedIndex} disabled={busy} activeOffset={activeSceneOffset} onJump={jump} sceneIdentity={draft.sceneIdentity.proposal} identityCandidates={draft.sceneIdentity.identityCandidates} onSceneIdentityChoice={draft.sceneIdentity.choose}/></>}
          {reader === 'preview' && <div className="writing-preview" aria-label="Formatted writing draft">{pages.length ? pages.map((elements, index) => <section key={index}><small>Draft page {index + 1} · approximate</small>{elements.map((element, row) => <p key={row} className={`paragraph ${element.type.replace(/_/g, '-')}`}>{element.text || '\u00a0'}</p>)}</section>) : <p>Your formatted writing appears here as you type.</p>}</div>}
          {reader === 'source' && <><label className="field-label">Source scene · read only<select aria-label="Retained screenplay scene" value={sourceScene} onChange={event => { setSourceScene(event.target.value); setSourceNavigationError(''); }}>{project.scenes.map(item => <option key={item.id} value={item.id}>{String(item.index).padStart(2, '0')} · {item.heading}</option>)}</select></label><button className="secondary" disabled={busy || !source} onClick={() => source && startFromSource(source.id)}>Use selected source scene</button><p className="writer-context-hint">Copy this scene into a new editable draft, or select a passage to see its production connections.</p><div ref={sourcePages} className="screenwriting-source-pages" aria-label="Read-only retained screenplay">{sourceParagraphs.map(paragraph => <p key={paragraph.id} data-paragraph-id={paragraph.id} className={`paragraph ${paragraph.type.toLowerCase().replace(/\s+/g, '-')}`}><button className="screenwriting-source-passage" aria-label={`Connect source passage ${paragraph.id}`} aria-pressed={selectedSource?.id === paragraph.id} onClick={() => { setSelectedSourceIds(previous => ({ ...previous, [sourceScene]: paragraph.id })); setSourceNavigationError(''); setReader('connections'); document.getElementById(`${panelId}-connections`)?.focus(); }}>{paragraph.text || '〔Empty source paragraph〕'}</button></p>)}</div><p className="writer-context-hint">Writing drafts do not replace this production source.</p></>}
          {reader === 'connections' && (selectedSource ? <><button className="writer-source-back" onClick={() => { setReader('source'); document.getElementById(`${panelId}-source`)?.focus(); }}>← Choose source passage</button><blockquote className="writer-selected-passage" data-paragraph-id={selectedSource.id}>{selectedSource.text || '〔Empty source paragraph〕'}</blockquote><ScreenplayConnections element={selectedSource} sourceLabel={selectedSourceScene === '__prologue__' ? 'Retained opening text' : `Retained scene ${source?.index}`} disabled={busy} onAction={onElementAction && selectedSourceScene ? action => onElementAction(action, selectedSourceScene, selectedSource.id) : undefined}/></> : <p className="writer-context-hint">Choose a retained source passage to explore its production tools.</p>)}
        </div>
      </aside>
    </div>
    {!project.creativeOrigin && <div hidden={workspaceView !== 'production'} className="writer-production-workspace">
      <LegacyProductionRevisionPanel key={`${project.id}:${id}`} project={project} draft={saved} records={[...records, ...refreshed]} open={open && workspaceView === 'production'} disabled={draftBusy || dirty || session.hasSession} onSaved={record => { setRefreshed(previous => [...previous.filter(item => item.id !== record.id), record]); onSaved(record); }} onBusy={setRevisionBusy} onDirty={setRevisionDirty} onWrite={() => setWorkspaceView('write')} onScene={target => { setSourceScene(target); setReader('source'); setWorkspaceView('write'); }}/>
      <WritingProductionImpactView impact={productionImpact} onOpenScene={target => { setSourceScene(target); setReader('source'); setWorkspaceView('write'); }}/>
    </div>}
  </section></div>;
});
export default ScreenwritingPanel;
