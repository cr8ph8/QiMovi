import { useEffect, useMemo, useRef, useState } from 'react';
import { canonicalJson, hashCanonical } from './canonical';
import { validateCreativeScreenplayDraft } from '../../local/contracts/creative-screenplay.mjs';
import { validateWorkspaceBootstrap } from './validation';
import { useWritingRecovery } from './useWritingRecovery';
import { useWritingSceneIdentity } from './useWritingSceneIdentity';
import { useWritingIdentityHistory } from './useWritingIdentityHistory';
import { validateWritingSceneTransition } from '../../local/contracts/writing-scene-map.mjs';
import type { WritingSceneRestoreProposal } from './writingSceneRestore';
import type { WritingRecovery } from './writingRecoveryApi';
import type { CreativeProject, CreativeScreenplayDraft, Project, ScreenplayDraft, WorkspaceApi, WorkspaceRecord } from './types';

export type DraftMetadata = Pick<ScreenplayDraft, 'genre' | 'projectFormat' | 'targetPages' | 'inputRefs' | 'sceneId'>;
export type DraftContent = { title: string; body: string } & DraftMetadata;
const initialTitle = 'Untitled screenplay';
const newId = () => `screenplay-draft:${crypto.randomUUID()}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The local draft operation was not confirmed.';
const metadataOf = (data: DraftContent | undefined, creative: boolean): DraftMetadata => data ? Object.fromEntries(Object.entries(data).filter(([key]) => (creative ? ['genre', 'projectFormat', 'targetPages', 'inputRefs'] : ['genre', 'projectFormat', 'targetPages', 'inputRefs', 'sceneId']).includes(key))) : {};

/** One editing lifecycle, with distinct creative and frozen-source record envelopes. */
export function useWritingDraft({ project, records, api, onSaved, disabled = false }: {
  project: Project | CreativeProject; records: WorkspaceRecord[]; api: WorkspaceApi; onSaved: (record: WorkspaceRecord) => void; disabled?: boolean;
}) {
  const creative = project.sourceHash === null;
  const scope = `${project.id}:${project.sourceHash}`;
  const [id, setId] = useState(newId), [title, setTitle] = useState(initialTitle), [body, setBody] = useState('');
  const [metadata, setMetadata] = useState<DraftMetadata>({});
  const [saved, setSaved] = useState<WorkspaceRecord | null>(null), [refreshed, setRefreshed] = useState<WorkspaceRecord[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const operation = useRef(0), alive = useRef(true), currentScope = useRef(scope); currentScope.current = scope;
  const baseline = saved?.data as ScreenplayDraft | CreativeScreenplayDraft | undefined;
  const sceneIdentity = useWritingSceneIdentity(id, body, baseline, saved?.sha256 ?? null);
  const identityHistory = useWritingIdentityHistory(api, saved);
  const dirty = title !== (baseline?.title ?? initialTitle) || body !== (baseline?.body ?? '') || canonicalJson(metadata) !== canonicalJson(metadataOf(baseline, creative)) || sceneIdentity.hasChoices;
  const data: ScreenplayDraft | CreativeScreenplayDraft = creative
    ? { schemaVersion: 2, projectId: project.id, sourceHash: null, title, format: 'FOUNTAIN', body, status: 'DRAFT', ...metadataOf({ title, body, ...metadata }, true), ...(sceneIdentity.map ? { sceneMap: sceneIdentity.map } : {}) }
    : { sourceHash: project.sourceHash!, title, format: 'FOUNTAIN', body, ...metadata, ...(sceneIdentity.map ? { sceneMap: sceneIdentity.map } : {}) };
  const expectedVersion = saved?.version ?? null;
  const fingerprint = canonicalJson({ id, data, expectedVersion });
  const recovery = useWritingRecovery(api.draftRecovery, scope, { draftId: id, data, baseVersion: expectedVersion, baseSha256: saved?.sha256 ?? null, saveRequestId: attempt.current?.fingerprint === fingerprint ? attempt.current.requestId : null }, dirty);
  const matches = (record: WorkspaceRecord) => record.kind === 'screenplay-draft' && (creative
    ? (record.data as CreativeScreenplayDraft).schemaVersion === 2 && (record.data as CreativeScreenplayDraft).projectId === project.id && (record.data as CreativeScreenplayDraft).sourceHash === null
    : (record.data as ScreenplayDraft).sourceHash === project.sourceHash);
  const library = useMemo(() => {
    const latest = new Map<string, WorkspaceRecord>();
    for (const record of [...records, ...refreshed, ...(saved ? [saved] : [])]) {
      if (matches(record) && (!latest.has(record.id) || latest.get(record.id)!.version < record.version)) latest.set(record.id, record);
    }
    return [...latest.values()];
    // Source profile determines which saved records belong to this library.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, refreshed, saved, scope]);
  const latestLibrary = useRef(library); latestLibrary.current = library;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    ++operation.current; setId(newId()); setTitle(initialTitle); setBody(''); setMetadata({}); setSaved(null); setRefreshed([]); setBusy(false); setError(''); setNotice(''); attempt.current = null;
  }, [scope]);

  function replaceDraft(record: WorkspaceRecord | null, prepared?: DraftContent) {
    recovery.leave();
    sceneIdentity.reset();
    const next = prepared ?? record?.data as DraftContent | undefined;
    setId(record?.id ?? newId()); setSaved(record); setTitle(next?.title ?? initialTitle); setBody(next?.body ?? ''); setMetadata(metadataOf(next, creative));
    attempt.current = null; setError(''); setNotice('');
  }
  function loadDraft(record: WorkspaceRecord | null, prepared?: DraftContent) {
    if (busy || disabled) return;
    ++operation.current;
    replaceDraft(record, prepared);
  }
  async function refresh() {
    if (busy || disabled) return;
    const serial = ++operation.current; setBusy(true); setError('');
    const current = () => alive.current && operation.current === serial && currentScope.current === scope;
    try {
      const boot = creative ? await validateWorkspaceBootstrap(await api.openWorkspace!()) : await api.bootstrap();
      if (boot.project.id !== project.id || boot.project.sourceHash !== project.sourceHash) throw new Error('The workspace source changed. Reopen the studio before continuing.');
      if (current()) { setRefreshed(boot.records); setNotice(creative ? 'Drafts refreshed. Your open text is retained; reopen a draft to load its saved version.' : 'Draft list refreshed. Your open text is retained; reopen a saved draft to load its latest version.'); }
      await recovery.refresh();
    } catch (caught) { if (current()) setError(errorText(caught)); }
    finally { if (current()) setBusy(false); }
  }
  async function save(): Promise<WorkspaceRecord | false> {
    if (busy || disabled || !dirty || !title.trim() || title.length > 200 || /[\r\n\0]/.test(title) || body.length > 200000) return false;
    if (sceneIdentity.proposal.error && baseline?.sceneMap) { setError(sceneIdentity.proposal.error); return false; }
    if (creative) { try { validateCreativeScreenplayDraft(data, project); } catch (caught) { setError(errorText(caught)); return false; } }
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    const requestId = attempt.current.requestId;
    const serial = ++operation.current; setBusy(true); setError(''); setNotice('');
    const current = () => alive.current && operation.current === serial && currentScope.current === scope;
    try {
      // Persist the exact save identity before sending it, so recovery can replay a lost reply.
      if (api.draftRecovery) await recovery.checkpoint({ draftId: id, data, baseVersion: expectedVersion, baseSha256: saved?.sha256 ?? null, saveRequestId: requestId });
      if (!current()) return false;
      const record = await api.saveRecord({ id, kind: 'screenplay-draft', data, expectedVersion, requestId });
      if (record.id !== id || record.kind !== 'screenplay-draft' || record.version !== (expectedVersion ?? 0) + 1 || canonicalJson(record.data) !== canonicalJson(data) || record.sha256 !== await hashCanonical(data)) throw new Error('The save response did not match this draft. Your text is retained; refresh before continuing.');
      if (current()) {
        const newer = latestLibrary.current.find(item => item.id === record.id && item.version > record.version);
        setSaved(record); setRefreshed(previous => [...previous.filter(item => item.id !== record.id), newer ?? record]); onSaved(newer ?? record);
        sceneIdentity.reset();
        setNotice(`${creative ? 'Screenplay' : 'Draft'} saved locally · v${record.version}${newer ? ` · A newer v${newer.version} is available in Drafts.` : ''}`);
        try { await recovery.saved(); } catch (caught) { if (current()) setError(`Draft saved. Its recovery copy is still retained: ${errorText(caught)}`); }
      }
      return current() ? record : false;
    } catch (caught) { if (current()) setError(`${errorText(caught)} Your text is retained. Refresh the list to inspect the latest saved version.`); return false; }
    finally { if (current()) setBusy(false); }
  }
  function restoreScene(proposal: WritingSceneRestoreProposal) {
    if (busy || disabled || dirty || currentScope.current !== scope || !saved) return;
    if (proposal.baseRef.id !== saved.id || proposal.baseRef.version !== saved.version || proposal.baseRef.sha256 !== saved.sha256) {
      setError('The saved draft changed. Reload history before restoring a scene.'); return;
    }
    try {
      validateWritingSceneTransition({ body: proposal.body, sceneMap: proposal.sceneMap }, { data: baseline!, sha256: saved.sha256 });
      setBody(proposal.body);
      sceneIdentity.restore({ id, body: proposal.body, baseSha256: saved.sha256 }, proposal.sceneMap);
      attempt.current = null; setError('');
      setNotice(`Scene restored from v${proposal.fromRef.version} into your working draft. Review it and Save to retain a new revision.`);
    } catch (caught) { setError(errorText(caught)); }
  }
  async function importDraft(file: File) {
    if (busy || disabled || dirty) return false;
    const serial = ++operation.current; setBusy(true); setError('');
    const current = () => alive.current && operation.current === serial && currentScope.current === scope;
    try {
      if (!/\.(fountain|txt)$/i.test(file.name) || file.size > 800000) throw new Error('Choose a Fountain or UTF-8 text file up to 800 KB.');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      if (text.length > 200000 || text.includes('\u0000')) throw new Error('The draft must be valid UTF-8 text, at most 200,000 characters.');
      if (current()) {
        replaceDraft(null, { title: file.name.replace(/\.(fountain|txt)$/i, '').replace(/[\r\n\0]/g, '').slice(0, 200) || initialTitle, body: text });
        setNotice(creative ? 'Fountain opened with its exact text. Save to retain this separate writing draft.' : 'File opened as a separate draft. Save to retain it in this workspace.');
      }
      return current();
    } catch (caught) { if (current()) setError(errorText(caught)); return false; }
    finally { if (current()) setBusy(false); }
  }
  async function restore(copy: WritingRecovery) {
    if (busy || disabled || dirty) return;
    const serial = ++operation.current; setBusy(true); setError('');
    const current = () => alive.current && operation.current === serial && currentScope.current === scope;
    try {
      if (!matches({ ...copy, id: copy.draftId, kind: 'screenplay-draft' })) throw new Error('This recovery copy belongs to another project or source revision.');
      let base: WorkspaceRecord | null = null;
      if (copy.baseVersion !== null) {
        base = library.find(row => row.id === copy.draftId && row.version === copy.baseVersion && row.sha256 === copy.baseSha256) ?? null;
        if (!base && api.history) base = (await api.history(copy.draftId)).find(row => row.version === copy.baseVersion && row.sha256 === copy.baseSha256) ?? null;
        if (!base || !matches(base) || base.sha256 !== await hashCanonical(base.data)) throw new Error('The saved revision for this recovery copy could not be verified. Refresh and try again.');
      }
      if (!current()) return;
      recovery.adopt(copy); setId(copy.draftId); setSaved(base); setTitle(copy.data.title); setBody(copy.data.body); setMetadata(metadataOf(copy.data, creative));
      sceneIdentity.restore({ id: copy.draftId, body: copy.data.body, baseSha256: copy.baseSha256 }, copy.data.sceneMap);
      const restoredFingerprint = canonicalJson({ id: copy.draftId, data: copy.data, expectedVersion: copy.baseVersion });
      attempt.current = copy.saveRequestId ? { fingerprint: restoredFingerprint, requestId: copy.saveRequestId } : null;
      setNotice('Recovered exact writing. Review it, then save a revision. Any newer saved version remains protected by conflict checks.');
    } catch (caught) { if (current()) setError(errorText(caught)); }
    finally { if (current()) setBusy(false); }
  }
  return { id, title, setTitle, body, setBody, metadata, setMetadata, saved, baseline, refreshed, setRefreshed, dirty, library, busy, setBusy, error, setError, notice, setNotice, operation, alive, scope, currentScope, loadDraft, save, refresh, importDraft, restore, restoreScene, recovery, sceneIdentity: { ...sceneIdentity, proposal: { ...sceneIdentity.proposal, error: sceneIdentity.proposal.error ?? identityHistory.error }, identityCandidates: [...sceneIdentity.identityCandidates, ...identityHistory.candidates] } };
}
