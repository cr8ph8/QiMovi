import { useCallback, useEffect, useState } from 'react';
import { validateRecord } from './validation';
import type { CastingDraft, WorkspaceApi, WorkspaceProject, WorkspaceRecord } from './types';
import type { StudioCastingRef } from './studioOperationApi';

type CastingRecord = WorkspaceRecord & { data: CastingDraft };
type Value = { record: CastingRecord | null; status: 'NONE' | 'CHECKING' | 'CURRENT' | 'CHANGED' | 'UNAVAILABLE'; blockedReason: string };
const empty: Value = { record: null, status: 'NONE', blockedReason: '' };
const checking = 'Checking the linked casting revision before provider preparation.';
const unavailable = 'The linked casting revision could not be verified. Refresh casting or choose a saved candidate again.';

/** Reopening a historical task keeps its candidate; only a fresh history read
 * establishes whether it is still current. No rights are granted by this link. */
export function useCastingOrigin({ reference, project, records, api, open }: {
  reference?: StudioCastingRef; project?: WorkspaceProject; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean;
}): Value & { refresh: () => void } {
  const [revision, setRevision] = useState(0), refresh = useCallback(() => setRevision(value => value + 1), []);
  const history = api.history;
  const relevant = records.filter(row => row.id === reference?.id);
  const key = JSON.stringify([reference, project?.id, project?.sourceHash, relevant.map(row => [row.kind, row.version, row.sha256]), open, revision]);
  const [state, setState] = useState<Value & { key: string; history: WorkspaceApi['history'] }>({ ...empty, key: '', history: undefined });
  useEffect(() => {
    let cancelled = false;
    const finish = (value: Value) => { if (!cancelled) setState({ ...value, key, history }); };
    if (!reference) { finish(empty); return () => { cancelled = true; }; }
    if (!open) return () => { cancelled = true; };
    async function read() {
      try {
        if (!project || project.sourceHash === null || !history) throw new Error(unavailable);
        const rows = await history(reference!.id, project);
        if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw new Error(unavailable);
        const verified: CastingRecord[] = [];
        for (let index = 0; index < rows.length; index++) {
          const row = await validateRecord(rows[index], project);
          if (cancelled) return;
          if (row.id !== reference!.id || row.kind !== 'casting-draft' || row.version !== index + 1 || row.replayed || row.reviewState !== undefined) throw new Error(unavailable);
          verified.push(row as CastingRecord);
        }
        const original = verified.find(row => row.version === reference!.version && row.sha256 === reference!.sha256), latest = verified.at(-1)!;
        if (!original || original.data.characterId !== reference!.characterId || relevant.some(row => row.kind !== 'casting-draft' || row.version > latest.version || row.version === latest.version && row.sha256 !== latest.sha256)) throw new Error(unavailable);
        const changed = latest.version !== reference!.version || latest.sha256 !== reference!.sha256;
        finish({ record: original, status: changed ? 'CHANGED' : 'CURRENT', blockedReason: changed ? `Casting has changed to v${latest.version}. Review and select its current saved candidate before provider preparation.` : '' });
      } catch { finish({ record: null, status: 'UNAVAILABLE', blockedReason: unavailable }); }
    }
    void read();
    return () => { cancelled = true; };
    // Keys bind exact source and record identities without repeated reads when unrelated records change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, history]);
  if (!reference) return { ...empty, refresh };
  return { ...(state.key === key && state.history === history ? state : { record: null, status: 'CHECKING' as const, blockedReason: checking }), refresh };
}
