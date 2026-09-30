import { useCallback, useEffect, useState } from 'react';
import { listWritingSceneIdentities, type WritingSceneData, type WritingSceneIdentity } from '../../local/contracts/writing-scene-map.mjs';
import { validateRecord } from './validation';
import type { StudioWritingRef } from './studioOperationApi';
import type { WorkspaceApi, WorkspaceProject, WorkspaceRecord } from './types';

export interface WritingOrigin {
  record: WorkspaceRecord | null;
  scene: WritingSceneIdentity | null;
  latestVersion: number | null;
  status: 'NONE' | 'CHECKING' | 'CURRENT' | 'CHANGED' | 'UNAVAILABLE';
  blockedReason: string;
  refresh: () => void;
}
type OriginValue = Omit<WritingOrigin, 'refresh'>;
const empty: OriginValue = { record: null, scene: null, latestVersion: null, status: 'NONE', blockedReason: '' };
const checking = 'Checking the saved writing revision before generation.';
const unavailable = 'The original writing scene could not be verified. Return to Write and prepare the scene again.';
const invalid = () => new Error(unavailable);

/** A preparation retains its original text; only a fresh history read establishes
 * whether that revision is still the saved writing head. No draft is changed. */
export function useWritingOrigin({ reference, project, records, api, open }: {
  reference: StudioWritingRef | undefined;
  project: WorkspaceProject | undefined;
  records: WorkspaceRecord[];
  api: WorkspaceApi;
  open: boolean;
}): WritingOrigin {
  const history = api.history;
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const originKey = JSON.stringify([reference?.id, reference?.version, reference?.sha256, reference?.sceneId, project?.id, project?.sourceHash]);
  // Record array identity changes frequently as unrelated tasks are saved. Only
  // changes to this writing record should cause another history request.
  const relevant = records.filter(row => row.id === reference?.id);
  const headKey = JSON.stringify(relevant.map(row => [row.kind, row.version, row.sha256]).sort((a, b) => String(a).localeCompare(String(b))));
  const requestKey = JSON.stringify([originKey, headKey, open, revision]);
  const [state, setState] = useState<OriginValue & { originKey: string; requestKey: string; history: WorkspaceApi['history'] }>({ ...empty, originKey: '', requestKey: '', history: undefined });

  useEffect(() => {
    let cancelled = false;
    const finish = (value: OriginValue) => {
      if (!cancelled) setState({ ...value, originKey, requestKey, history });
    };
    if (!reference) { finish(empty); return () => { cancelled = true; }; }
    if (!project || !history) {
      finish({ ...empty, status: 'UNAVAILABLE', blockedReason: !history ? 'Saved writing history is unavailable in this client. Reopen the local workspace before generation.' : unavailable });
      return () => { cancelled = true; };
    }
    if (!open) return () => { cancelled = true; };
    setState(previous => ({ ...(previous.originKey === originKey ? previous : empty), originKey, requestKey, history, status: 'CHECKING', blockedReason: checking }));
    async function read() {
      try {
        if (!/^screenplay-draft:[A-Za-z0-9._:-]+$/.test(reference!.id) || reference!.id.length > 160 || !Number.isSafeInteger(reference!.version) || reference!.version < 1 || !/^[a-f0-9]{64}$/.test(reference!.sha256) || typeof reference!.sceneId !== 'string' || !reference!.sceneId) throw invalid();
        const values = await history!(reference!.id, project);
        if (cancelled) return;
        if (!Array.isArray(values) || values.length === 0 || values.length > 10000) throw invalid();
        const verified: WorkspaceRecord[] = [];
        for (let index = 0; index < values.length; index++) {
          const row = await validateRecord(values[index], project);
          if (cancelled) return;
          if (row.id !== reference!.id || row.kind !== 'screenplay-draft' || row.version !== index + 1 || row.replayed === true || row.reviewState !== undefined) throw invalid();
          verified.push(row);
        }
        const original = verified.find(row => row.version === reference!.version && row.sha256 === reference!.sha256);
        const latest = verified[verified.length - 1];
        if (!original || relevant.some(row => row.kind !== 'screenplay-draft' || row.version > latest.version || row.version === latest.version && row.sha256 !== latest.sha256)) throw invalid();
        const scene = listWritingSceneIdentities(original.data as WritingSceneData, original.sha256).find(item => item.id === reference!.sceneId);
        if (!scene) throw invalid();
        const changed = latest.version !== reference!.version || latest.sha256 !== reference!.sha256;
        finish({ record: original, scene, latestVersion: latest.version, status: changed ? 'CHANGED' : 'CURRENT', blockedReason: changed ? `Writing has changed to v${latest.version}. Return to Write and prepare the updated scene before generation.` : '' });
      } catch {
        finish({ ...empty, status: 'UNAVAILABLE', blockedReason: unavailable });
      }
    }
    void read();
    return () => { cancelled = true; };
    // The keys capture exact identities; unstable project/records objects must
    // not start an unbounded history-read loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, headKey, requestKey, history, open]);

  if (!reference) return { ...empty, refresh };
  if (state.requestKey === requestKey && state.history === history) return { record: state.record, scene: state.scene, latestVersion: state.latestVersion, status: state.status, blockedReason: state.blockedReason, refresh };
  const retained = state.originKey === originKey ? state : empty;
  return { record: retained.record, scene: retained.scene, latestVersion: retained.latestVersion, status: 'CHECKING', blockedReason: checking, refresh };
}
