import type { AuthoringInputRef, ProductionHandoff, Scene, WorkspaceProject, WorkspaceRecord } from './types';

export interface WritingImpactDependent {
  record: WorkspaceRecord;
  relation: 'DIRECT' | 'TRANSITIVE';
  draftRevision: 'CURRENT' | 'DIFFERENT' | 'MIXED';
  draftRefs: AuthoringInputRef[];
  needsReview: boolean;
}
export interface WritingImpactUnresolved {
  record: WorkspaceRecord;
  ref: AuthoringInputRef;
  reason: 'REVISION_NOT_LOADED' | 'SOURCE_MISMATCH' | 'CYCLE' | 'TRAVERSAL_LIMIT';
}
export interface WritingImpactScene {
  sceneId: string;
  index: number;
  heading: string;
  shotIds: string[];
  handoffIds: string[];
  needsReview: boolean;
  /** These share an explicitly linked retained scene/shot. They are not proven dependencies. */
  relatedRecords: WorkspaceRecord[];
}
export interface WritingProductionImpact {
  draftRef: AuthoringInputRef | null;
  hasUnsavedChanges: boolean;
  dependents: WritingImpactDependent[];
  linkedScenes: WritingImpactScene[];
  /** Incomplete chains are not counted as dependents unless a separate exact path establishes the link. */
  unresolved: WritingImpactUnresolved[];
  authority: 'REVIEW_PREVIEW_ONLY';
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isRef = (value: unknown): value is AuthoringInputRef => {
  const item = object(value);
  return typeof item.id === 'string' && item.id.length > 0 && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256);
};
const refOf = (record: WorkspaceRecord): AuthoringInputRef => ({ id: record.id, sha256: record.sha256 });
const keyOf = (ref: AuthoringInputRef) => `${ref.id}\0${ref.sha256}`;
const authoringKinds = new Set(['screenplay-draft', 'story-plan-draft', 'concept-draft', 'pitch-draft', 'writing-note']);

/** Only contract-defined references count. Text, draft ordinals and matching headings never create links. */
function references(record: WorkspaceRecord): AuthoringInputRef[] {
  const data = object(record.data), candidates: unknown[] = [];
  if (authoringKinds.has(record.kind) && Array.isArray(data.inputRefs)) candidates.push(...data.inputRefs);
  if (record.kind === 'production-handoff') candidates.push(data.authoringRef);
  if (record.kind === 'generation-brief') candidates.push(data.handoffRef, data.contextBundleRef);
  if (record.kind === 'camera-observation') candidates.push(data.handoffRef);
  if (record.kind === 'studio-operation' || record.kind === 'measured-media-take') candidates.push(data.briefRef);
  if (record.kind === 'studio-generation' || record.kind === 'studio-reference') candidates.push(data.operationRef);
  if (record.kind === 'take-review') candidates.push(data.takeRef);
  if (record.kind === 'movie-sequence' && Array.isArray(data.clips)) candidates.push(...data.clips.map(clip => object(clip).briefRef));
  if (record.kind === 'context-bundle') {
    for (const field of ['noteSelections', 'characterSelections']) {
      if (Array.isArray(data[field])) candidates.push(...data[field].map(selection => object(selection).ref));
    }
  }
  return [...new Map(candidates.filter(isRef).map(ref => [keyOf(ref), { id: ref.id, sha256: ref.sha256 }])).values()];
}

function sameScope(record: WorkspaceRecord, project: WorkspaceProject) {
  const data = object(record.data);
  return data.sourceHash === project.sourceHash && (project.sourceHash !== null || data.projectId === project.id);
}

function relatedToShots(record: WorkspaceRecord, sceneId: string, shotIds: Set<string>, paragraphIds: Set<string>) {
  const data = object(record.data);
  if (record.kind === 'scene-plan') return data.sceneId === sceneId;
  if (record.kind === 'storyboard-cell') return data.sceneId === sceneId && shotIds.has(String(data.shotId));
  if (record.kind === 'coverage-draft') return paragraphIds.has(String(data.paragraphId)) && Array.isArray(data.shotIds) && data.shotIds.some(id => shotIds.has(String(id)));
  if (record.kind === 'generation-brief') return data.sceneId === sceneId && Array.isArray(data.shotIds) && data.shotIds.some(id => shotIds.has(String(id)));
  if (record.kind === 'measured-media-take') return data.sceneId === sceneId && (data.shotId === null || shotIds.has(String(data.shotId)));
  if (record.kind === 'studio-operation') {
    const target = object(data.target);
    return target.sceneId === sceneId && (target.kind === 'SCENE' || shotIds.has(String(target.shotId)));
  }
  if (record.kind === 'movie-sequence' && Array.isArray(data.clips)) return data.clips.some(clip => object(clip).sceneId === sceneId && shotIds.has(String(object(clip).shotId)));
  return false;
}

/**
 * Read-only explanation over API-validated records, not a replacement for server
 * lineage/readiness validation. `records` contains current heads; optional history
 * only resolves exact past references and never makes an old output current.
 */
export function writingProductionImpact({ project, draft, records, hasUnsavedChanges = false, historyRecords = [] }: {
  project: WorkspaceProject;
  draft: WorkspaceRecord | null;
  records: readonly WorkspaceRecord[];
  hasUnsavedChanges?: boolean;
  historyRecords?: readonly WorkspaceRecord[];
}): WritingProductionImpact {
  const result: WritingProductionImpact = { draftRef: null, hasUnsavedChanges, dependents: [], linkedScenes: [], unresolved: [], authority: 'REVIEW_PREVIEW_ONLY' };
  if (!draft || draft.kind !== 'screenplay-draft' || !sameScope(draft, project)) return result;
  result.draftRef = refOf(draft);
  const heads = new Map<string, WorkspaceRecord>();
  for (const record of records) if (!heads.has(record.id) || heads.get(record.id)!.version < record.version) heads.set(record.id, record);
  const exact = new Map([...historyRecords, ...records, draft].map(record => [keyOf(refOf(record)), record]));
  const orderedHeads = [...heads.values()].filter(record => record.id !== draft.id && sameScope(record, project)).sort((a, b) => a.id.localeCompare(b.id));
  const unresolvedKeys = new Set<string>();
  for (const record of orderedHeads) {
    const directRefs = references(record), found = new Map<string, AuthoringInputRef>(), visited = new Set<string>(), active = new Set<string>();
    let inputsNeedReview = false;
    const issue = (ref: AuthoringInputRef, reason: WritingImpactUnresolved['reason']) => {
      inputsNeedReview = true;
      const key = `${record.id}\0${keyOf(ref)}\0${reason}`;
      if (!unresolvedKeys.has(key)) { unresolvedKeys.add(key); result.unresolved.push({ record, ref, reason }); }
    };
    const visit = (ref: AuthoringInputRef, depth: number) => {
      // A direct reference proves which draft ID/revision was used even when its
      // historical body is not in the current bootstrap response.
      if (ref.id === draft.id) { found.set(keyOf(ref), ref); return; }
      const key = keyOf(ref);
      if (active.has(key)) { issue(ref, 'CYCLE'); return; }
      if (visited.has(key)) return;
      if (depth > 24 || visited.size >= 200) { issue(ref, 'TRAVERSAL_LIMIT'); return; }
      visited.add(key);
      const input = exact.get(key);
      if (!input) { issue(ref, 'REVISION_NOT_LOADED'); return; }
      if (!sameScope(input, project)) { issue(ref, 'SOURCE_MISMATCH'); return; }
      if (heads.has(ref.id) && heads.get(ref.id)!.sha256 !== ref.sha256) inputsNeedReview = true;
      active.add(key);
      for (const child of references(input)) visit(child, depth + 1);
      active.delete(key);
    };
    directRefs.forEach(ref => visit(ref, 0));
    if (found.size) {
      const draftRefs = [...found.values()], hasCurrent = draftRefs.some(ref => ref.sha256 === draft.sha256), hasDifferent = draftRefs.some(ref => ref.sha256 !== draft.sha256);
      result.dependents.push({ record, relation: directRefs.some(ref => ref.id === draft.id) ? 'DIRECT' : 'TRANSITIVE', draftRevision: hasDifferent ? hasCurrent ? 'MIXED' : 'DIFFERENT' : 'CURRENT', draftRefs, needsReview: hasUnsavedChanges || hasDifferent || inputsNeedReview });
    }
  }
  const sourceScenes: readonly Scene[] = project.scenes;
  for (const dependent of result.dependents.filter(item => item.record.kind === 'production-handoff')) {
    const data = dependent.record.data as ProductionHandoff;
    const sourceScene = sourceScenes.find(scene => scene.id === data.sceneId);
    if (!sourceScene || data.purpose !== 'PLANNING_CONTEXT' || dependent.record.id !== `production-handoff:${sourceScene.id}` || !Array.isArray(data.shotIds) || !data.shotIds.length || data.shotIds.some(id => !sourceScene.shots.some(shot => shot.id === id))) continue;
    let scene = result.linkedScenes.find(item => item.sceneId === sourceScene.id);
    if (!scene) { scene = { sceneId: sourceScene.id, index: sourceScene.index, heading: sourceScene.heading, shotIds: [], handoffIds: [], needsReview: false, relatedRecords: [] }; result.linkedScenes.push(scene); }
    scene.handoffIds.push(dependent.record.id);
    const selected = new Set([...scene.shotIds, ...data.shotIds]);
    scene.shotIds = sourceScene.shots.filter(shot => selected.has(shot.id)).map(shot => shot.id);
    scene.needsReview ||= dependent.needsReview;
    const paragraphs = new Set(sourceScene.paragraphs.map(paragraph => paragraph.id));
    scene.relatedRecords = orderedHeads.filter(record => relatedToShots(record, scene!.sceneId, selected, paragraphs));
  }
  result.linkedScenes.sort((a, b) => a.index - b.index || a.sceneId.localeCompare(b.sceneId));
  return result;
}
