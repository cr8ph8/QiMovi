import AuthoringSourceLinks from './AuthoringSourceLinks';
import { useEffect, useMemo, useRef, useState } from 'react';
import AuthoringForm from './AuthoringForm';
import ProjectPitchEditor from './ProjectPitchEditor';
import { canonicalJson, hashCanonical } from './canonical';
import { validateAuthoringRecord } from '../../local/contracts/authoring.mjs';
import { emptyAuthoring, storyPlanFountain, type AuthoringKind, type EditableAuthoring } from './workbenchModel';
import { sceneDraftFountain } from './localSceneTools';
import { downloadLocalBlob } from './localDownload';
import { writingExportFilename } from './writingExports';
import type { CreativeAuthoringDraft, CreativeProject, PitchDraft, StoryPlanDraft, WorkspaceApi, WorkspaceRecord } from './types';
import type { DraftContent } from './useWritingDraft';
import './creative-development.css';

const stages: { kind: AuthoringKind; label: string; help: string }[] = [
  { kind: 'writing-note', label: 'Capture', help: 'Keep the idea, research and questions that begin this project.' },
  { kind: 'concept-draft', label: 'Concept', help: 'Develop the premise and the story you want to tell.' },
  { kind: 'story-plan-draft', label: 'Story plan', help: 'Arrange beats, character arcs and scene cards before writing.' },
  { kind: 'pitch-draft', label: 'Pitch', help: 'Shape the project presentation from your saved development work.' },
];
const labelOf = (kind: AuthoringKind) => stages.find(stage => stage.kind === kind)!.label;
type Edit = { id: string; kind: AuthoringKind; data: CreativeAuthoringDraft; baseline: WorkspaceRecord | null; initial: string };
const changed = (edit?: Edit) => Boolean(edit && canonicalJson(edit.data) !== edit.initial);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The workspace did not confirm this save.';
export default function CreativeDevelopmentPanel({ project, records, api, open, disabled = false, onSaved, onDirty, onWrite, requestedKind, requestedDraft, onOpenSource }: {
  requestedKind?: AuthoringKind;
  requestedDraft?: { token: string; draft: CreativeAuthoringDraft };
  onOpenSource?: (record: WorkspaceRecord) => void;
  project: CreativeProject; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; disabled?: boolean;
  onSaved: (record: WorkspaceRecord) => void; onDirty: (dirty: boolean) => void; onWrite: (draft: DraftContent) => void;
}) {
  const [kind, setKind] = useState<AuthoringKind>('writing-note');
  useEffect(() => { if (requestedKind) setKind(requestedKind); }, [requestedKind]);
  const [editors, setEditors] = useState<Partial<Record<AuthoringKind, Edit>>>({});
  const [retained, setRetained] = useState<WorkspaceRecord[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Edit | null>(null);
  const attempts = useRef(new Map<string, { fingerprint: string; requestId: string }>());
  const current = useRef(project.id); current.current = project.id;
  const alive = useRef(true), saving = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const library = useMemo(() => {
    const latest = new Map<string, WorkspaceRecord>();
    for (const row of [...records, ...retained]) {
      const data = row.data as CreativeAuthoringDraft;
      if (!stages.some(stage => stage.kind === row.kind) || data.sourceHash !== null || data.projectId !== project.id) continue;
      if (!latest.has(row.id) || latest.get(row.id)!.version < row.version) latest.set(row.id, row);
    }
    return [...latest.values()];
  }, [records, retained, project.id]);
  const edit = editors[kind], dirty = Object.values(editors).some(changed);
  const isSaved = Boolean(edit?.baseline && !changed(edit));
  const savedDrafts = library.filter(row => row.kind === kind);
  useEffect(() => { onDirty(dirty || busy); }, [dirty, busy, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  function install(next: Edit) { setEditors(previous => ({ ...previous, [next.kind]: next })); setKind(next.kind); setPending(null); setError(''); setNotice(''); }
  function begin(nextKind: AuthoringKind, row?: WorkspaceRecord, prepared?: CreativeAuthoringDraft) {
    if (disabled || busy) return;
    const data = structuredClone((row?.data ?? prepared ?? { ...emptyAuthoring(nextKind, null), sourceHash: null, projectId: project.id, ...(nextKind === 'pitch-draft' ? { title: project.title } : {}) }) as CreativeAuthoringDraft);
    const next: Edit = { id: row?.id ?? `${nextKind}:${crypto.randomUUID()}`, kind: nextKind, data, baseline: row ?? null, initial: canonicalJson(row?.data ?? (prepared ? null : data)) };
    if (changed(editors[nextKind])) { setPending(next); return; }
    install(next);
  }
  const receivedDraft = useRef<string>();
  useEffect(() => {
    if (!requestedDraft || receivedDraft.current === requestedDraft.token || disabled || busy) return;
    receivedDraft.current = requestedDraft.token;
    if (requestedDraft.draft.sourceHash !== null || requestedDraft.draft.projectId !== project.id) { setError('This development draft belongs to another project. Open its own project before continuing.'); return; }
    try { validateAuthoringRecord('writing-note', requestedDraft.draft, project); } catch (caught) { setError(errorText(caught)); return; }
    begin('writing-note', undefined, requestedDraft.draft);
    // Accept a request once; existing capture edits use the same explicit replacement choice as New/Open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDraft, disabled, busy, project.id]);
  function update(value: EditableAuthoring) {
    if (!edit || busy || disabled) return;
    const data = { ...value, sourceHash: null, projectId: project.id } as CreativeAuthoringDraft;
    setEditors(previous => ({ ...previous, [kind]: { ...edit, data } })); setNotice(''); setError('');
  }
  async function save() {
    if (!edit || disabled || saving.current) return;
    const snapshot = structuredClone(edit), projectId = project.id;
    try { validateAuthoringRecord(kind, snapshot.data, project); } catch (caught) { setError(errorText(caught)); return; }
    const fingerprint = canonicalJson({ id: snapshot.id, data: snapshot.data, version: snapshot.baseline?.version ?? null });
    if (attempts.current.get(snapshot.id)?.fingerprint !== fingerprint) attempts.current.set(snapshot.id, { fingerprint, requestId: crypto.randomUUID() });
    const requestId = attempts.current.get(snapshot.id)!.requestId;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const record = await api.saveRecord({ id: snapshot.id, kind: snapshot.kind, data: snapshot.data, expectedVersion: snapshot.baseline?.version ?? null, requestId }, project);
      if (record.id !== snapshot.id || record.kind !== snapshot.kind || record.version !== (snapshot.baseline?.version ?? 0) + 1 || canonicalJson(record.data) !== canonicalJson(snapshot.data) || record.sha256 !== await hashCanonical(snapshot.data)) throw new Error('The saved response did not match this development draft. Keep your draft and retry.');
      if (!alive.current || current.current !== projectId) return;
      setRetained(previous => [...previous.filter(row => row.id !== record.id), record]);
      setEditors(previous => ({ ...previous, [snapshot.kind]: { ...snapshot, baseline: record, initial: canonicalJson(snapshot.data) } }));
      onSaved(record); setNotice(`${labelOf(snapshot.kind)} saved locally · v${record.version}`);
    } catch (caught) { if (alive.current && current.current === projectId) setError(`${errorText(caught)} Your open draft is retained.`); }
    finally { saving.current = false; if (alive.current && current.current === projectId) setBusy(false); }
  }
  function develop(nextKind: AuthoringKind) {
    if (!edit?.baseline || changed(edit)) return;
    const data = edit.data, ref = { id: edit.baseline.id, sha256: edit.baseline.sha256 };
    const base = { ...emptyAuthoring(nextKind, null), sourceHash: null, projectId: project.id, title: data.title, inputRefs: [ref] } as CreativeAuthoringDraft;
    if (nextKind === 'concept-draft') begin(nextKind, undefined, { ...base, body: 'body' in data ? data.body : '', type: 'Story premise', tags: 'tags' in data ? data.tags : [] } as CreativeAuthoringDraft);
    else if (nextKind === 'story-plan-draft') begin(nextKind, undefined, base);
    else {
      const plan = data as StoryPlanDraft;
      begin(nextKind, undefined, { ...base, title: project.title, logline: plan.logline, synopsis: plan.actBeats.map(beat => `${beat.act ? `${beat.act}: ` : ''}${beat.summary}`).join('\n\n'), characterSummaries: plan.characterArcs.map(arc => `${arc.name}: ${arc.arc}`).join('\n\n'), thematicSummary: plan.theme, toneDescription: plan.tone, projectDetails: { genre: plan.genre } } as CreativeAuthoringDraft);
    }
  }
  function write(sceneId?: string) {
    if (!edit?.baseline || changed(edit)) return;
    const plan = edit.data as StoryPlanDraft;
    onWrite({ title: plan.title, body: sceneId ? sceneDraftFountain(plan, sceneId) : storyPlanFountain(plan), inputRefs: [{ id: edit.baseline.id, sha256: edit.baseline.sha256 }] });
  }
  if (!open) return <span hidden data-unsaved={dirty ? 'true' : 'false'}/>;
  return <section className="creative-development" aria-label="Project development" data-unsaved={dirty ? 'true' : 'false'}>
    <header><div><h2>Develop the project</h2><p>{stages.find(stage => stage.kind === kind)!.help}</p></div><button disabled={busy || disabled} onClick={() => begin(kind)}>New {labelOf(kind).toLowerCase()}</button></header>
    <nav aria-label="Development steps">{stages.map(stage => <button key={stage.kind} aria-pressed={kind === stage.kind} onClick={() => { setKind(stage.kind); setPending(null); }}>{stage.label}<small>{library.filter(row => row.kind === stage.kind).length} saved{changed(editors[stage.kind]) ? ' · unsaved' : ''}</small></button>)}</nav>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {pending && <div role="alert"><p>The open {labelOf(pending.kind).toLowerCase()} has unsaved changes. Save it first, or explicitly replace those edits.</p><button onClick={() => { setKind(pending.kind); setPending(null); }}>Keep editing</button><button onClick={() => install(pending)}>Replace unsaved {labelOf(pending.kind).toLowerCase()}</button></div>}
    <div className="creative-development-layout">{savedDrafts.length > 0 && <details className="development-draft-browser" open={!edit || undefined}><summary>Saved {labelOf(kind).toLowerCase()} drafts · {savedDrafts.length}</summary><p>Open an existing draft to continue it. Earlier saved revisions stay in its history.</p><div className="development-draft-choices" aria-label="Saved development drafts">{savedDrafts.map(row => <button disabled={busy || disabled} key={row.id} aria-pressed={row.id === edit?.id} onClick={() => begin(kind, row)}><strong>{(row.data as CreativeAuthoringDraft).title}</strong><small>Saved revision {row.version}</small></button>)}</div></details>}
    <div className="creative-development-editor">{edit ? <>
      <AuthoringSourceLinks key={`${edit.id}:sources`} project={project} inputRefs={edit.data.inputRefs ?? []} records={[...records, ...retained]} api={api} disabled={busy || disabled} onOpenCurrent={record => { if (stages.some(stage => stage.kind === record.kind)) begin(record.kind as AuthoringKind, record); else onOpenSource?.(record); }}/>
      {kind === 'pitch-draft' ? <ProjectPitchEditor project={project} key={edit.id} draft={edit.data as PitchDraft} disabled={busy || disabled} onChange={update} scope={changed(edit) ? 'Unsaved development draft' : `Saved v${edit.baseline?.version ?? 0}`}/> : <AuthoringForm key={edit.id} kind={kind} data={edit.data as EditableAuthoring} disabled={busy || disabled} onChange={update} onOpenScene={isSaved ? write : undefined}/>}
      <footer><span title={edit.baseline ? `Saved revision ${edit.baseline.version}` : undefined}>{changed(edit) ? 'Unsaved changes' : edit.baseline ? 'Saved locally' : 'New draft'}</span><button disabled={busy || disabled || !edit.data.title.trim() || (isSaved && Boolean(edit.baseline))} onClick={() => void save()}>{busy ? 'Saving…' : `Save ${labelOf(kind).toLowerCase()}`}</button></footer>
      {isSaved && <nav aria-label="Continue development">{kind === 'writing-note' && <button onClick={() => develop('concept-draft')}>Develop as concept →</button>}{kind === 'concept-draft' && <button onClick={() => develop('story-plan-draft')}>Build story plan →</button>}{kind === 'story-plan-draft' && <><button disabled={!(edit.data as StoryPlanDraft).sceneIndex.length} onClick={() => write()}>Write from saved scene cards →</button><button onClick={() => develop('pitch-draft')}>Prepare project pitch →</button></>}<button onClick={() => downloadLocalBlob(new Blob([JSON.stringify(edit.baseline, null, 2) + '\n'], { type: 'application/json' }), writingExportFilename(edit.data.title, 'json'))}>Export saved revision</button></nav>}
    </> : <div className="development-empty"><h3>{kind === 'writing-note' ? 'Start with your idea' : `Create a ${labelOf(kind).toLowerCase()}`}</h3><p>{stages.find(stage => stage.kind === kind)!.help} No imported screenplay is required.</p><button onClick={() => begin(kind)} disabled={busy || disabled}>Start {labelOf(kind).toLowerCase()}</button></div>}</div></div>
  </section>;
}
