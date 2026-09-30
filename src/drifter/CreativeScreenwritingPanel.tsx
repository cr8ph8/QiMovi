import AuthoringSourceLinks from './AuthoringSourceLinks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScreenplayWritingSurface, type ScreenplayWritingSurfaceHandle } from '@/components/writer/ScreenplayWritingSurface';
import { parseFountain } from '@/lib/fountain-parser';
import { paginateElements } from '@/lib/fountain-paginator';
import ScreenplaySceneNavigator from './ScreenplaySceneNavigator';
import { applyScreenplayEditorChange, buildScreenplayIndex, screenplayOffsetToTextarea, screenplayTextareaValue, textareaOffsetToScreenplay } from './screenplayIndex';
import { downloadLocalBlob } from './localDownload';
import { assertExportableText, createWritingDocx, createWritingPdf, writingExportFilename, writingExportScope } from './writingExports';
import type { CreativeProject, CreativeScreenplayDraft, WorkspaceApi, WorkspaceRecord } from './types';
import type { StudioOperationRequest } from './studioOperationRequest';
import './creative-screenwriting.css';
import { useWritingDraft, type DraftContent } from './useWritingDraft';
import WritingRecoveryControls from './WritingRecoveryControls';
import WritingDraftHistory from './WritingDraftHistory';
import ScriptAnalysis from './ScriptAnalysis';
import { listWritingSceneIdentities } from '../../local/contracts/writing-scene-map.mjs';

type Props = { project: CreativeProject; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; disabled?: boolean; onSaved: (record: WorkspaceRecord) => void; onPrepare: (request: StudioOperationRequest) => void; onPlanProduction?: (record: WorkspaceRecord) => void; onDirty?: (dirty: boolean) => void; writingRequest?: DraftContent & { nonce: string; projectId: string } };
const message = (error: unknown) => error instanceof Error ? error.message : 'The local workspace did not confirm this operation.';

/** Shares the film writer's editor/parser/exports; only the source-free record envelope differs. */
export default function CreativeScreenwritingPanel({ project, records, api, open, disabled = false, onSaved, onPrepare, onPlanProduction, onDirty, writingRequest }: Props) {
  const draft = useWritingDraft({ project, records, api, onSaved, disabled });
  const { id, title, setTitle, body, setBody, saved, baseline, dirty, library, busy, setBusy, error, setError, notice, setNotice, operation, alive, scope: scopeKey, currentScope: scope } = draft;
  const [pending, setPending] = useState<string | null>(null), [reader, setReader] = useState<'outline' | 'preview'>('outline');
  const [fork, setFork] = useState<WorkspaceRecord | null>(null);
  const [activeOffset, setActiveOffset] = useState<number | null>(null);
  const editor = useRef<ScreenplayWritingSurfaceHandle>(null), fileInput = useRef<HTMLInputElement>(null);
  const preparingScene = useRef(false);
  const writingLayout = useRef<HTMLDivElement>(null);
  const blocked = disabled || busy;
  const handledRequest = useRef('');
  const incoming = useRef<DraftContent | null>(null);
  useEffect(() => {
    if (!open || blocked || !writingRequest || writingRequest.projectId !== project.id || handledRequest.current === writingRequest.nonce) return;
    handledRequest.current = writingRequest.nonce;
    const { title, body, inputRefs } = writingRequest;
    incoming.current = { title, body, inputRefs };
    if (dirty) setPending('development');
    else { draft.loadDraft(null, incoming.current); incoming.current = null; setNotice('Story plan opened as a new writing draft. Save to retain it.'); }
  }, [open, blocked, writingRequest, project.id, dirty, draft]);
  useEffect(() => { onDirty?.(dirty || busy); }, [dirty, busy, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const index = useMemo(() => buildScreenplayIndex(body), [body]);
  const savedIndex = useMemo(() => baseline ? buildScreenplayIndex(baseline.body) : null, [baseline]);
  const parsed = useMemo(() => parseFountain(body, { inputMode: 'fountain' }), [body]);
  const pages = useMemo(() => paginateElements(parsed.elements).pages, [parsed]);
  const scene = index.scenes.find(row => activeOffset !== null && activeOffset >= row.start && activeOffset < row.end) ?? index.scenes[0];
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function switchDraft(next: string) {
    if (blocked) return;
    if (next === 'development' && incoming.current) { draft.loadDraft(null, incoming.current); incoming.current = null; setPending(null); setActiveOffset(null); return; }
    if (next === 'fork' && fork) { applyFork(fork); return; }
    const row = next === 'new' ? null : library.find(record => record.id === next);
    if (next !== 'new' && !row) { setError('Refresh the draft list to find this saved screenplay.'); return; }
    draft.loadDraft(row ?? null);
    setPending(null); setActiveOffset(null);
  }

  function applyFork(record: WorkspaceRecord) { const data = record.data as CreativeScreenplayDraft; draft.loadDraft(null, { ...data, title: `${data.title} · from v${record.version}`.slice(0, 200) }); setPending(null); setFork(null); setActiveOffset(null); }
  function choose(next: string) { if (!blocked) { if (dirty) setPending(next); else switchDraft(next); } }
  async function save() { if (await draft.save()) setPending(null); }
  async function planProduction() {
    if (blocked || !onPlanProduction) return;
    const revision = dirty ? await draft.save() : saved;
    if (revision && alive.current && scope.current === scopeKey) onPlanProduction(revision);
  }
  const refresh = draft.refresh;
  async function importFile(file: File) {
    if (await draft.importDraft(file)) setActiveOffset(null);
    if (fileInput.current) fileInput.current.value = '';
  }
  async function exportDraft(format: 'fountain' | 'PDF' | 'DOCX') {
    if (blocked) return;
    const snapshot = { title, body, scope: writingExportScope(dirty, saved?.version) };
    const serial = ++operation.current; setBusy(true); setError('');
    const current = () => alive.current && operation.current === serial && scope.current === scopeKey;
    try {
      assertExportableText(snapshot.body);
      const output = format === 'fountain' ? { blob: new Blob([snapshot.body], { type: 'text/plain;charset=utf-8' }), filename: writingExportFilename(snapshot.title, 'fountain') } : format === 'PDF' ? createWritingPdf(snapshot) : await createWritingDocx(snapshot);
      if (current()) { downloadLocalBlob(output.blob, output.filename); setNotice(`${format === 'fountain' ? 'Exact Fountain' : format} export requested · ${snapshot.scope}. Complete the Save dialog.`); }
    } catch (caught) { if (current()) setError(message(caught)); }
    finally { if (current()) setBusy(false); }
  }
  function jump(offset: number) {
    editor.current?.focusOffset(screenplayOffsetToTextarea(body, offset));
    setActiveOffset(offset);
  }
  async function prepareScene() {
    if (blocked || preparingScene.current || !scene || scene.text.length > 50000) return;
    preparingScene.current = true;
    const captured = { body, start: scene.start, end: scene.end, scope: scopeKey };
    try {
      const revision = dirty ? await draft.save() : saved;
      if (!revision || !alive.current || scope.current !== captured.scope) return;
      const writing = revision.data as CreativeScreenplayDraft;
      const origin = listWritingSceneIdentities(writing, revision.sha256).find(row => row.start === captured.start && row.end === captured.end);
      if (writing.body !== captured.body || !origin) throw new Error('The saved scene could not be matched to this preparation. Your writing is retained; reopen its saved revision and try again.');
      onPrepare({ nonce: crypto.randomUUID(), projectId: project.id, sourceHash: null, taskId: 'generate_image', target: { kind: 'PROJECT' }, medias: [],
        title: `${writing.title} · scene ${origin.index}`.slice(0, 240), prompt: origin.text,
        writingRef: { id: revision.id, version: revision.version, sha256: revision.sha256, sceneId: origin.id } });
      setNotice(`Scene ${origin.index} linked to saved writing v${revision.version}. Refine the separate prompt in Prepare; later writing changes will need review.`);
    } catch (caught) { if (alive.current && scope.current === captured.scope) setError(message(caught)); }
    finally { preparingScene.current = false; }
  }
  if (!open) return <span hidden data-unsaved={dirty ? 'true' : 'false'} data-writing-draft={id}/>;
  return <section className="creative-writer" aria-label="Creative screenplay writer" data-unsaved={dirty ? 'true' : 'false'}>
    <header><label>Screenplay title<input aria-label="Screenplay title" value={title} maxLength={200} disabled={blocked} onChange={event => { setTitle(event.target.value); setNotice(''); }}/></label><div><strong>{dirty ? 'Unsaved writing' : saved ? `Saved locally · v${saved.version}` : 'New screenplay draft'}</strong><button disabled={blocked || !dirty || !title.trim()} onClick={() => void save()}>{busy ? 'Working…' : 'Save screenplay'}</button></div></header>
    <small className="writer-recovery-status" role="status">{draft.recovery.status}</small>
    {draft.recovery.error && <p role="alert">Recovery not confirmed: {draft.recovery.error}. Keep the app open and retry, or export your writing.</p>}
    <div className="creative-writer-tools"><label>Saved screenplays<select aria-label="Saved screenplays" value={saved?.id ?? ''} disabled={blocked} onChange={event => { if (event.target.value) choose(event.target.value); }}><option value="">Choose a saved draft</option>{library.map(row => <option value={row.id} key={row.id}>{(row.data as CreativeScreenplayDraft).title} · v{row.version}</option>)}</select></label><button disabled={blocked} onClick={() => choose('new')}>New draft</button><button disabled={blocked} onClick={() => void refresh()}>Refresh drafts</button><button disabled={blocked || !saved} onClick={() => saved && choose(saved.id)}>Reopen saved draft</button><button disabled={blocked || dirty} onClick={() => fileInput.current?.click()}>Import Fountain</button><input ref={fileInput} hidden type="file" accept=".fountain,.txt,text/plain" aria-label="Import creative Fountain file" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }}/><section className="creative-writer-exports" aria-label="Export screenplay"><h3>Export screenplay</h3><div>{(['fountain', 'PDF', 'DOCX'] as const).map(format => <button key={format} disabled={blocked || !body} onClick={() => void exportDraft(format)}>{format === 'fountain' ? 'Exact Fountain' : format}</button>)}</div><p>Export a chosen draft for review. Use Scenes & shots to make a planning handoff from a saved revision. Source approval and generation remain separate actions.</p></section></div>
    <AuthoringSourceLinks key={`${id}:sources`} project={project} inputRefs={draft.metadata.inputRefs ?? []} records={[...records, ...draft.refreshed]} api={api} disabled={blocked}/>
    <section className="creative-writer-history" aria-label="Draft recovery & history"><h3>Draft recovery & history</h3><WritingRecoveryControls draft={draft} disabled={blocked}/><WritingDraftHistory api={api} canRestoreScene={!(blocked || dirty)} onRestoreScene={proposal => { if (!(blocked || dirty)) draft.restoreScene(proposal); }} saved={saved} disabled={blocked} scopeKey={scopeKey} onFork={record => { if (dirty) { setFork(record); setPending('fork'); } else applyFork(record); }}/></section>
    {pending && <div className="creative-writer-decision" role="alert"><p>Your current writing has unsaved changes.</p><button disabled={blocked} onClick={() => setPending(null)}>Keep writing</button><button disabled={blocked} onClick={() => switchDraft(pending)}>Discard open edits and continue</button></div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {onPlanProduction && <section className="creative-writer-next" aria-label="Continue to production planning"><strong>From screenplay to scenes & shots</strong><p>Review this saved revision and create its scene plan in the same project.</p><button disabled={blocked || !index.scenes.length || !title.trim() || (!dirty && !saved)} onClick={() => void planProduction()}>{dirty ? 'Save & review scene plan' : 'Review scene plan'}</button><small>Scene identities and character cues carry forward. Existing plans, drafts and media remain retained.</small></section>}
    <div ref={writingLayout} className="creative-writer-layout"><div><fieldset disabled={blocked}><ScreenplayWritingSurface key={id} ref={editor} historyValue={body} onRestoreValue={next => { setBody(next); setNotice(''); }} value={screenplayTextareaValue(body)} ariaLabel="Fountain screenplay" disabled={blocked} onSave={() => { if (dirty && title.trim()) void save(); }} onSelectionChange={selection => setActiveOffset(textareaOffsetToScreenplay(body, selection.start))} onChange={next => { setBody(previous => applyScreenplayEditorChange(previous, next)); setNotice(''); }}/></fieldset><p className="creative-writer-scope">{index.scenes.length} draft scenes · {pages.length} approximate pages. Text and draft scene order stay independent of production planning.</p></div><aside><nav aria-label="Screenplay reading view"><button aria-pressed={reader === 'outline'} onClick={() => setReader('outline')}>Scene outline</button><button aria-pressed={reader === 'preview'} onClick={() => setReader('preview')}>Formatted preview</button></nav>{reader === 'outline' ? <ScreenplaySceneNavigator index={index} baseline={savedIndex} activeOffset={activeOffset} disabled={blocked} onJump={jump} sceneIdentity={draft.sceneIdentity.proposal} identityCandidates={draft.sceneIdentity.identityCandidates} onSceneIdentityChoice={draft.sceneIdentity.choose}/> : <div className="creative-writing-preview" aria-label="Formatted screenplay preview">{pages.map((elements, page) => <section key={page}><small>Draft page {page + 1} · approximate</small>{elements.map((element, row) => <p key={row} className={`paragraph ${element.type.replace(/_/g, '-')}`}>{element.text || '\u00a0'}</p>)}</section>)}</div>}<div className="creative-writer-next"><strong>{scene ? `Explore scene ${scene.index}` : 'From writing to visuals'}</strong><p>{scene?.heading ?? 'Write a scene heading to start a visual study.'}</p><button disabled={blocked || !scene || scene.text.length > 50000 || !title.trim()} onClick={() => void prepareScene()}>{dirty ? 'Save & prepare scene image' : 'Prepare a scene image'}</button><small>Links this scene to its saved revision in Prepare. Refine the prompt and add references there; later writing changes are flagged for review.</small>{scene && scene.text.length > 50000 && <p>Choose a scene under 50,000 characters for one preparation.</p>}</div></aside></div>
    <section className="creative-writer-reports" aria-label="Script analysis & reports"><h3>Script analysis & reports</h3><ScriptAnalysis key={id} body={body} title={title} dirty={dirty} savedVersion={saved?.version} onScene={sceneIndex => { const target = index.scenes.find(row => row.index === sceneIndex); if (target) { jump(target.start); writingLayout.current?.scrollIntoView({ block: 'start' }); } }}/></section>
  </section>;
}
