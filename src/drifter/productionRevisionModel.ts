import { canonicalJson } from './canonical';
import type { ProductionRevisionPreview } from './productionRevisionApi';
import { writingDraftRef, type WritingProductionRecord } from './writingProductionApi';

/** Copy only server-proven coverage into an empty matching scene in the open plan.
 * This never saves, changes an attached source, or transfers produced media.
 */
export function reusableProductionCoverage(review: ProductionRevisionPreview, plan: WritingProductionRecord) {
  const empty = { scenes: plan.data.scenes, sceneCount: 0, shotCount: 0, blockedReason: '' };
  if (canonicalJson(review.candidatePlanRef) !== canonicalJson(writingDraftRef(plan)) || review.candidateDraftRef.id !== review.baselineDraftRef.id) return empty;
  const eligible = new Set(review.coverageReuseSceneIds), used = new Set(plan.data.scenes.flatMap(scene => scene.shots.map(shot => shot.id)));
  let sceneCount = 0, shotCount = 0;
  const scenes = plan.data.scenes.map(scene => {
    const baseline = review.sceneDeltas.find(row => row.sceneId === scene.sceneId)?.before;
    if (!eligible.has(scene.sceneId) || scene.shots.length || !baseline?.shotIds.length) return scene;
    const shots = baseline.shotIds.map(id => review.shotDeltas.find(row => row.sceneId === scene.sceneId && row.shotId === id)?.before);
    if (shots.some(shot => !shot || used.has(shot.id))) return scene;
    const copied = shots.map(shot => { const { ordinal: _ordinal, ...data } = shot!; used.add(data.id); return structuredClone(data); });
    ++sceneCount; shotCount += copied.length;
    return { ...scene, notes: scene.notes.trim() ? scene.notes : baseline.notes, shots: copied };
  });
  if (scenes.reduce((count, scene) => count + scene.shots.length, 0) > 1000) return { ...empty, blockedReason: 'Reusing this coverage would exceed the 1,000-shot scene-plan limit. Reduce the working shot list before reusing coverage.' };
  return { scenes, sceneCount, shotCount, blockedReason: '' };
}
