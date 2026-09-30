import { useEffect, useState } from 'react';
import { listWritingSceneIdentities, validateWritingSceneMap, type WritingSceneCandidate, type WritingSceneData } from '../../local/contracts/writing-scene-map.mjs';
import { hashCanonical } from './canonical';
import type { WorkspaceApi, WorkspaceRecord } from './types';

export interface WritingIdentityHistoryCandidate { id: string; heading: string; index: number }
export interface WritingIdentityHistory { candidates: WritingIdentityHistoryCandidate[]; error?: string }
type WritingData = WritingSceneData & { sourceHash: string | null; projectId?: string; schemaVersion?: number };
const refKey = (ref: WritingSceneCandidate) => `${ref.sha256}:${ref.id}`;
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const invalid = () => new Error('The retained scene history does not match this saved writing draft.');

function writingScope(record: WorkspaceRecord, allowReplayed = false): string {
  const data = record?.data as WritingData | undefined;
  if (record?.kind !== 'screenplay-draft' || !data || typeof data.body !== 'string' || !Number.isSafeInteger(record.version) || record.version < 1 || !digest(record.sha256) || record.reviewState !== undefined || record.replayed !== undefined && typeof record.replayed !== 'boolean' || !allowReplayed && record.replayed === true) throw invalid();
  if (data.sourceHash === null) {
    if (data.schemaVersion !== 2 || typeof data.projectId !== 'string' || !data.projectId) throw invalid();
  } else if (!digest(data.sourceHash) || data.projectId !== undefined || data.schemaVersion !== undefined) throw invalid();
  return JSON.stringify([data.sourceHash, data.projectId ?? null, data.schemaVersion ?? null]);
}

/** Read-only labels for unresolved scene identities from earlier saved writing.
 * The exact revision digest supplies the heading; no current heading is guessed
 * from an ordinal, and no history response can change owner identity choices. */
export function useWritingIdentityHistory(api: WorkspaceApi, saved: WorkspaceRecord | null): WritingIdentityHistory {
  const history = api.history;
  const data = saved?.data as WritingData | undefined;
  const key = JSON.stringify([saved?.id, saved?.kind, saved?.version, saved?.sha256, data?.sourceHash, data?.projectId]);
  const [state, setState] = useState<WritingIdentityHistory & { key: string; history: WorkspaceApi['history'] }>({ key: '', history: undefined, candidates: [] });
  useEffect(() => {
    let cancelled = false;
    const finish = (value: WritingIdentityHistory) => { if (!cancelled) setState({ ...value, key, history }); };
    finish({ candidates: [] });
    if (!saved || saved.kind !== 'screenplay-draft') return () => { cancelled = true; };
    async function read() {
      try {
        const body = saved.data as WritingData;
        if (!body?.sceneMap) return;
        validateWritingSceneMap(body.sceneMap, body.body);
        const currentIds = new Set(body.sceneMap.scenes.map(scene => scene.id));
        const requested = new Map(body.sceneMap.scenes.flatMap(scene => scene.candidates).filter(ref => ref.sha256 !== saved.sha256 || !currentIds.has(ref.id)).map(ref => [refKey(ref), ref]));
        if (!requested.size) return;
        // A successful retry may carry replayed:true on the save response; the
        // flag is not part of its exact stored data or a creative approval.
        const scope = writingScope(saved, true);
        if (await hashCanonical(saved.data) !== saved.sha256) throw invalid();
        if (cancelled) return;
        if (!history) { finish({ candidates: [], error: 'Prior scene headings are unresolved because saved draft history is unavailable in this client.' }); return; }
        const values = await history(saved.id);
        if (cancelled) return;
        if (!Array.isArray(values) || values.length > 10000) throw new Error('The returned draft history exceeds the supported history limit.');
        const wantedHashes = new Set([...requested.values()].map(ref => ref.sha256));
        const found = new Set<string>(), labels = new Map<string, WritingIdentityHistoryCandidate & { version: number }>();
        const seenVersions = new Set<number>();
        for (const record of values) {
          // Header checks are cheap even for a long history. Exact content hashes
          // and parsing are restricted to the bounded requested revisions.
          if (record?.id !== saved.id || writingScope(record) !== scope || seenVersions.has(record.version)) throw invalid();
          seenVersions.add(record.version);
          if (!wantedHashes.has(record.sha256)) continue;
          if (record.version > saved.version || await hashCanonical(record.data) !== record.sha256) throw invalid();
          if (cancelled) return;
          for (const scene of listWritingSceneIdentities(record.data as WritingData, record.sha256)) {
            const identity = refKey({ id: scene.id, sha256: record.sha256 });
            if (!requested.has(identity)) continue;
            found.add(identity);
            if (!labels.has(scene.id) || labels.get(scene.id)!.version < record.version) labels.set(scene.id, { id: scene.id, heading: `${scene.heading} · v${record.version}`, index: scene.index, version: record.version });
          }
        }
        finish({ candidates: [...labels.values()].sort((a, b) => a.version - b.version || a.index - b.index).map(({ id, heading, index }) => ({ id, heading, index })), ...(found.size < requested.size ? { error: 'Some prior scene headings remain unresolved because their exact saved revisions were not available.' } : {}) });
      } catch (error) {
        finish({ candidates: [], error: error instanceof Error ? error.message : 'Prior scene headings remain unresolved because draft history could not be verified.' });
      }
    }
    void read();
    return () => { cancelled = true; };
  }, [history, saved, key]);
  return state.key === key && state.history === history ? { candidates: state.candidates, ...(state.error ? { error: state.error } : {}) } : { candidates: [] };
}
