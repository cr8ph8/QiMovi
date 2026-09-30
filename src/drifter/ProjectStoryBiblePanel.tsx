import { useEffect, useMemo, useRef, useState } from 'react';
import UniverseLibrary from './UniverseLibrary';
import { canonicalJson } from './canonical';
import { universeApi, type UniverseCatalog, type UniverseClaimDraft, type UniverseDraft, type UniverseEntity, type UniverseEntityDraft, type UniverseKind, type UniverseLinkDraft, type UniverseProfileDraft } from './universeApi';
import { universeDevelopmentNote } from './universeDevelopment';
import { continuityId } from './worldContinuityModel';
import type { CreativeAuthoringDraft, CreativeProject, WorkspaceApi, WorkspaceProject, WorkspaceRecord } from './types';
import './project-story-bible.css';

type Props = {
  project: WorkspaceProject; developmentProject: CreativeProject; records: WorkspaceRecord[]; api: WorkspaceApi;
  open: boolean; disabled?: boolean; entityRequest?: { id: string; nonce: number };
  onSaved(record: WorkspaceRecord): void; onDirty(dirty: boolean): void; onOpenSources(): void;
  onDevelop(draft: CreativeAuthoringDraft): void; onOpenBudget?(targetId?: string): void;
};
const message = (caught: unknown) => caught instanceof Error ? caught.message : 'The local Story Bible could not complete this action.';

/** A controller for the shared Bible, not a second world store. Keep it mounted
 * while tools change so the Library's profile and relationship editors survive. */
export default function ProjectStoryBiblePanel({ project, developmentProject, records, api, open, disabled = false, entityRequest, onSaved, onDirty, onOpenSources, onDevelop, onOpenBudget }: Props) {
  const [activated, setActivated] = useState(open);
  const [model, setModel] = useState<UniverseCatalog>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [operationError, setOperationError] = useState(''), [working, setWorking] = useState(false), [editorDirty, setEditorDirty] = useState(false);
  const [retained, setRetained] = useState<WorkspaceRecord[]>([]), [refresh, setRefresh] = useState(0);
  const scope = `${project.id}:${project.sourceHash}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const alive = useRef(true), operation = useRef(0);
  const attempts = useRef(new Map<string, { id: string; requestId: string }>());
  const currentRecords = useMemo(() => {
    const latest = new Map<string, WorkspaceRecord>();
    for (const row of [...records, ...retained]) if (!latest.has(row.id) || latest.get(row.id)!.version < row.version) latest.set(row.id, row);
    return [...latest.values()];
  }, [records, retained]);
  const recordBasis = currentRecords.filter(record => record.kind.startsWith('universe-') || record.kind === 'lore-source' || record.kind === 'project-asset').map(record => `${record.id}:${record.version}:${record.sha256}`).sort().join('|');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (open) setActivated(true); }, [open]);
  useEffect(() => { onDirty(editorDirty || working); }, [editorDirty, working, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    universeApi.load(project, controller.signal).then(value => {
      if (!controller.signal.aborted) setModel(value);
    }).catch(caught => {
      if (!controller.signal.aborted) setError(message(caught));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // The immutable project identity and record heads are the load dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, recordBasis, refresh]);

  function assertWritable() {
    if (!alive.current || currentScope.current !== scope || disabled || working || error || !model || model.projectId !== project.id || model.sourceHash !== project.sourceHash) throw new Error('Reconnect and refresh the Story Bible before saving. Your open edits are retained.');
  }
  async function save(id: string, kind: UniverseKind, data: UniverseDraft, expectedVersion: number | null, requestId: string) {
    assertWritable();
    const capturedScope = scope;
    const record = await universeApi.save(project, id, kind, data, expectedVersion, requestId);
    if (alive.current && currentScope.current === capturedScope) {
      setRetained(previous => [...previous.filter(row => row.id !== record.id), record]);
      onSaved(record); setRefresh(value => value + 1);
    }
    return record;
  }
  function create(kind: 'universe-entity' | 'universe-claim' | 'universe-link', data: UniverseEntityDraft | UniverseClaimDraft | UniverseLinkDraft) {
    const fingerprint = `${kind}:${canonicalJson(data)}`;
    let attempt = attempts.current.get(fingerprint);
    if (!attempt) {
      attempt = { id: kind === 'universe-entity' ? `${kind}:${(data as UniverseEntityDraft).entityId}` : `${kind}:${crypto.randomUUID()}`, requestId: crypto.randomUUID() };
      attempts.current.set(fingerprint, attempt);
    }
    return save(attempt.id, kind, data, null, attempt.requestId);
  }
  async function develop(entity: UniverseEntity, rights = false) {
    if (!model || working || disabled) return;
    const capturedScope = scope, serial = ++operation.current;
    setWorking(true); setOperationError('');
    try {
      const draft = await universeDevelopmentNote(project, entity, model, currentRecords, api.history, rights, developmentProject);
      if (alive.current && currentScope.current === capturedScope && operation.current === serial) onDevelop(draft as CreativeAuthoringDraft);
    } catch (caught) {
      if (alive.current && currentScope.current === capturedScope && operation.current === serial) setOperationError(message(caught));
    } finally {
      if (alive.current && currentScope.current === capturedScope && operation.current === serial) setWorking(false);
    }
  }
  return <section className="project-story-bible" aria-label="Project Story Bible" hidden={!open}>
    <div className="project-story-bible-intro"><div><h2>Build the story world</h2><p>Develop characters, places, relationships and world rules. These same entries stay with the project when you attach its screenplay.</p></div><span>{project.sourceHash === null ? 'Start from an idea' : 'Connected to the production screenplay'}</span></div>
    {operationError && <p role="alert">{operationError}</p>}
    {working && <p role="status">Preparing the saved Bible context for development…</p>}
    {activated && <fieldset disabled={disabled || working} className="project-story-bible-surface">
      <UniverseLibrary initialView="bible" project={project} records={currentRecords} model={model} loading={loading} error={error} entityRequest={entityRequest}
        onRetry={() => setRefresh(value => value + 1)} onOpenSources={onOpenSources} onOpenBudget={onOpenBudget}
        onCreateEntity={data => create('universe-entity', data)} onSaveClaim={data => create('universe-claim', data)} onSaveLink={data => create('universe-link', data)}
        onSaveProfile={(data: UniverseProfileDraft, expectedVersion, requestId) => save(`universe-profile:${data.entityId}`, 'universe-profile', data, expectedVersion, requestId)}
        onSaveContinuity={(data, expectedVersion, requestId) => save(continuityId(data.sourceHash, data.projectId), 'universe-continuity-plan', data, expectedVersion, requestId)}
        onSaveProductionPlan={(data, expectedVersion, requestId) => save(`universe-production-plan:${data.entityId}`, 'universe-production-plan', data, expectedVersion, requestId)}
        onChooseContext={entity => void develop(entity)} onDevelopRights={entity => void develop(entity, true)} onDirty={setEditorDirty}/>
    </fieldset>}
  </section>;
}
