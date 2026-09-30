import { check, canonical, sha256 } from './storage.mjs';
import { validateCreativeProject } from '../contracts/creative-project.mjs';
import { WRITING_PRODUCTION_KIND, validateWritingProductionRequest, validateWritingProductionPlan, buildWritingProductionBasis, writingProductionPlanId } from '../contracts/writing-production.mjs';

export function createWritingProductionService(store) {
  function projectFor(id) {
    const project = store.baseProject(); validateCreativeProject(project);
    check(project.id === id, 'WRITING_PRODUCTION_PROJECT_MISMATCH', 409);
    return project;
  }
  function draftFor(ref, project) {
    const history = store.history(ref.id), draft = history.find(row => row.version === ref.version && row.sha256 === ref.sha256);
    check(draft && draft.data.projectId === project.id, 'WRITING_PRODUCTION_SAVED_DRAFT_REQUIRED', 409);
    check(history.at(-1)?.sha256 === ref.sha256 && history.at(-1)?.version === ref.version, 'WRITING_PRODUCTION_DRAFT_STALE', 409);
    return draft;
  }
  function preview(input) {
    validateWritingProductionRequest('preview', input);
    const project = projectFor(input.projectId), basis = buildWritingProductionBasis(project, draftFor(input.draftRef, project), sha256);
    validateWritingProductionPlan({ schemaVersion: 1, projectId: project.id, sourceHash: null, status: 'PLANNING_ONLY', ...basis, scenes: basis.scenes.map(scene => ({ ...scene, notes: '', shots: [] })) }, project);
    const planId = writingProductionPlanId(project.id, input.draftRef, sha256), existing = store.history(planId).at(-1);
    return { schemaVersion: 1, projectId: project.id, planId, previewSha256: sha256(canonical({ projectId: project.id, ...basis })), ...basis,
      existingPlanRef: existing ? { id: existing.id, version: existing.version, sha256: existing.sha256 } : null };
  }
  return {
    preview,
    handoff(input) {
      validateWritingProductionRequest('handoff', input);
      return store.commitWritingProduction('handoff', input, () => {
        const current = preview({ projectId: input.projectId, draftRef: input.draftRef });
        check(current.previewSha256 === input.previewSha256, 'WRITING_PRODUCTION_PREVIEW_STALE', 409);
        if (current.existingPlanRef) return { existing: store.history(current.planId).at(-1) };
        return { id: current.planId, expectedVersion: null, data: { schemaVersion: 1, projectId: input.projectId, sourceHash: null, status: 'PLANNING_ONLY', source: current.source, scenes: current.scenes.map(scene => ({ ...scene, notes: '', shots: [] })) } };
      });
    },
    save(input) {
      validateWritingProductionRequest('save', input);
      return store.commitWritingProduction('save', input, () => {
        const project = projectFor(input.projectId), history = store.history(input.planId), current = history.at(-1);
        check(current?.kind === WRITING_PRODUCTION_KIND && current.data.projectId === project.id, 'WRITING_PRODUCTION_PLAN_MISSING', 409);
        draftFor(current.data.source.draftRef, project);
        check(current.version === input.expectedVersion, 'VERSION_CONFLICT', 409);
        check(input.scenes.length === current.data.scenes.length && input.scenes.every((scene, index) => scene.sceneId === current.data.scenes[index].sceneId), 'WRITING_PRODUCTION_SCENE_MISMATCH', 409);
        const oldShotScenes = new Map(history.flatMap(record => record.data.scenes.flatMap(scene => scene.shots.map(shot => [shot.id, scene.sceneId]))));
        check(input.scenes.every(scene => scene.shots.every(shot => !oldShotScenes.has(shot.id) || oldShotScenes.get(shot.id) === scene.sceneId)), 'WRITING_PRODUCTION_SHOT_SCENE_MISMATCH', 409);
        return { id: current.id, expectedVersion: input.expectedVersion, data: { ...current.data, scenes: current.data.scenes.map((scene, index) => ({ ...scene, notes: input.scenes[index].notes, shots: input.scenes[index].shots })) } };
      });
    },
  };
}
