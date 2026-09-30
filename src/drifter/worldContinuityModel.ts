import { universeRecordInProject } from './universeApi';
import type { UniverseCatalog, UniverseContinuityDraft, UniverseContinuityEvent } from './universeApi';
import type { Project, WorkspaceRecord } from './types';

export type ContinuityRecord = WorkspaceRecord & { kind: 'universe-continuity-plan'; data: UniverseContinuityDraft };
export const continuityId = (sourceHash: string | null, projectId?: string) => `universe-continuity-plan:${sourceHash ?? projectId}`;
export function continuityRecord(model: UniverseCatalog): ContinuityRecord | null {
  return model.drafts.filter((row): row is ContinuityRecord => row.kind === 'universe-continuity-plan'
    && row.id === continuityId(row.data.sourceHash, (row.data as UniverseContinuityDraft).projectId) && universeRecordInProject(row.data, model))
    .sort((a, b) => Number(b.data.sourceHash === null) - Number(a.data.sourceHash === null) || b.version - a.version)[0] ?? null;
}

/** A partial order, never a guessed calendar. Same-level events have no order established. */
export function continuityOrder(data: UniverseContinuityDraft) {
  const active = data.review === 'SET_ASIDE' ? [] : data.events.filter(event => event.review !== 'SET_ASIDE');
  const byId = new Map(active.map(event => [event.id, event]));
  const missing: { from: string; to: string }[] = [];
  const edges = new Map(active.map(event => [event.id, event.beforeEventIds.filter(id => {
    if (!byId.has(id)) { missing.push({ from: event.id, to: id }); return false; } return true;
  })]));
  const indegree = new Map(active.map(event => [event.id, 0]));
  for (const next of edges.values()) for (const id of next) indegree.set(id, indegree.get(id)! + 1);
  const levels: UniverseContinuityEvent[][] = [], remaining = new Set(byId.keys());
  while (remaining.size) {
    const ready = active.filter(event => remaining.has(event.id) && indegree.get(event.id) === 0);
    if (!ready.length) break;
    levels.push(ready);
    for (const event of ready) {
      remaining.delete(event.id);
      for (const id of edges.get(event.id)!) indegree.set(id, indegree.get(id)! - 1);
    }
  }
  const reaches = (start: string, id: string, seen: Set<string>): boolean => {
    for (const next of edges.get(id) ?? []) {
      if (next === start) return true;
      if (!seen.has(next)) { seen.add(next); if (reaches(start, next, seen)) return true; }
    } return false;
  };
  const cycleIds = [...remaining].filter(id => reaches(id, id, new Set([id])));
  return { levels, missing, cycleIds, blockedIds: [...remaining].filter(id => !cycleIds.includes(id)) };
}

/** This read-only consistency check never unifies stored entities or actor knowledge. */
export function aliasConflicts(data: UniverseContinuityDraft): string[] {
  const aliases = data.review === 'SET_ASIDE' ? [] : data.aliases.filter(alias => alias.review !== 'SET_ASIDE');
  const edges = new Map<string, Set<string>>();
  for (const alias of aliases.filter(alias => alias.decision === 'SAME_CHARACTER')) {
    for (const [a, b] of [[alias.fromEntityId, alias.toEntityId], [alias.toEntityId, alias.fromEntityId]]) {
      if (!edges.has(a)) edges.set(a, new Set()); edges.get(a)!.add(b);
    }
  }
  const linked = (a: string, b: string) => {
    const todo = [a], seen = new Set(todo);
    while (todo.length) for (const next of edges.get(todo.pop()!) ?? []) {
      if (next === b) return true;
      if (!seen.has(next)) { seen.add(next); todo.push(next); }
    }
    return false;
  };
  return aliases.filter(alias => alias.decision === 'DISTINCT_CHARACTERS' && linked(alias.fromEntityId, alias.toEntityId)).map(alias => alias.id);
}
export function narrativeEvents(data: UniverseContinuityDraft, scenes: Project['scenes']) {
  const active = data.review === 'SET_ASIDE' ? [] : data.events.filter(event => event.review !== 'SET_ASIDE');
  return {
    scenes: [...scenes].sort((a, b) => a.index - b.index).map(scene => ({ scene, events: active.filter(event => event.sceneIds.includes(scene.id)) })),
    unassigned: active.filter(event => !event.sceneIds.length),
  };
}
