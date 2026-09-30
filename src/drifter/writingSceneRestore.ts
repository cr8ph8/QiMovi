import { listWritingSceneIdentities, proposeWritingSceneMap, validateWritingSceneTransition, type WritingSceneData, type WritingSceneMap } from '../../local/contracts/writing-scene-map.mjs';
import type { WorkspaceRecord } from './types';

type RevisionRef = { id: string; version: number; sha256: string };
export type WritingSceneRestoreProposal = { baseRef: RevisionRef; fromRef: RevisionRef; sceneId: string; body: string; sceneMap: WritingSceneMap };
export type RestorableScene = { id: string; heading: string; index: number; previousText: string; currentText: string };
const ref = (record: WorkspaceRecord): RevisionRef => ({ id: record.id, version: record.version, sha256: record.sha256 });
const fail = (message: string): never => { throw new Error(message); };

/** Restores exact text only where every retained revision establishes the same
 * scene identity. A matching heading or ordinal alone is never correspondence. */
export function sceneRestoreChoices(history: WorkspaceRecord[], from: WorkspaceRecord, base: WorkspaceRecord): RestorableScene[] {
  if (from.id !== base.id || from.kind !== 'screenplay-draft' || base.kind !== 'screenplay-draft' || from.version >= base.version) return [];
  const chain = history.filter(row => row.version >= from.version && row.version <= base.version).sort((a, b) => a.version - b.version);
  if (chain.length !== base.version - from.version + 1 || chain[0]?.sha256 !== from.sha256 || chain.at(-1)?.sha256 !== base.sha256) return [];
  const scope = (row: WorkspaceRecord) => JSON.stringify([(row.data as { projectId?: string }).projectId ?? null, (row.data as { sourceHash: string | null }).sourceHash]);
  let continuousIds: Set<string> | null = null;
  for (let index = 0; index < chain.length; index++) {
    const row = chain[index];
    if (row.id !== base.id || row.kind !== base.kind || row.version !== from.version + index || scope(row) !== scope(base)) return [];
    const resolvedIds = new Set(listWritingSceneIdentities(row.data as WritingSceneData, row.sha256).filter(scene => !scene.candidates.length).map(scene => scene.id));
    continuousIds = continuousIds === null ? resolvedIds : new Set([...continuousIds].filter(id => resolvedIds.has(id)));
    if (index) validateWritingSceneTransition(row.data as WritingSceneData, chain[index - 1] as WorkspaceRecord & { data: WritingSceneData });
  }
  const old = listWritingSceneIdentities(from.data as WritingSceneData, from.sha256);
  const current = listWritingSceneIdentities(base.data as WritingSceneData, base.sha256);
  // Preserve unresolved identity work rather than replacing it with generated decisions.
  if (current.some(scene => scene.candidates.length)) return [];
  return current.flatMap(scene => {
    const prior = old.find(item => item.id === scene.id);
    if (!prior || prior.text === scene.text || !continuousIds?.has(scene.id)) return [];
    return [{ id: scene.id, index: scene.index, heading: scene.heading, previousText: prior.text, currentText: scene.text }];
  });
}

export function prepareSceneRestore(history: WorkspaceRecord[], from: WorkspaceRecord, base: WorkspaceRecord, sceneId: string): WritingSceneRestoreProposal {
  const choice = sceneRestoreChoices(history, from, base).find(scene => scene.id === sceneId) ?? fail('This scene does not have a confirmed identity across these revisions. Review scene identities before restoring.');
  const baseline = base.data as WritingSceneData;
  const scenes = listWritingSceneIdentities(baseline, base.sha256);
  const target = scenes.find(scene => scene.id === sceneId)!;
  const body = baseline.body.slice(0, target.start) + choice.previousText + baseline.body.slice(target.end);
  if (body.length > 200000) fail('Restoring this scene would exceed the draft size limit.');
  const choices = Object.fromEntries(scenes.map((scene, index) => [index, { kind: 'OWNER' as const, previousId: scene.id }]));
  const next = proposeWritingSceneMap(body, baseline, base.sha256, choices);
  if (!next.map || next.map.scenes.length !== scenes.length) fail(next.error ?? 'The restored scene could not retain the current screenplay structure.');
  return { baseRef: ref(base), fromRef: ref(from), sceneId, body, sceneMap: next.map! };
}
