import { check, canonical, sha256 } from './storage.mjs';
import { validateCreativeProject } from '../contracts/creative-project.mjs';
import { buildProductionAttachment, validateProductionAttachmentRequest } from '../contracts/production-attachment.mjs';
import { buildProductionRevisionPreview, validateProductionRevisionRequest } from '../contracts/production-revision.mjs';
import { validateWritingProductionRecord } from '../contracts/writing-production.mjs';

export function createProductionAttachmentService(store) {
  function candidate(input, review = false) {
    const base = store.baseProject(); validateCreativeProject(base);
    check(base.id === input.projectId, 'PRODUCTION_ATTACHMENT_PROJECT_MISMATCH', 409);
    const plans = store.history(input.planRef.id), plan = plans.find(row => row.version === input.planRef.version && row.sha256 === input.planRef.sha256);
    check(plan && plans.at(-1)?.sha256 === input.planRef.sha256 && plans.at(-1)?.version === input.planRef.version, 'PRODUCTION_ATTACHMENT_PLAN_STALE', 409);
    const drafts = store.history(plan.data.source.draftRef.id), draft = drafts.find(row => row.version === plan.data.source.draftRef.version && row.sha256 === plan.data.source.draftRef.sha256);
    check(draft && drafts.at(-1)?.sha256 === draft.sha256 && drafts.at(-1)?.version === draft.version, 'PRODUCTION_ATTACHMENT_DRAFT_STALE', 409);
    if (review) {
      validateWritingProductionRecord(plan, base, ref => draft.id === ref.id && draft.version === ref.version && draft.sha256 === ref.sha256 ? draft : null, sha256);
      return { base, draft, plan, drafts };
    }
    const data = buildProductionAttachment(base, draft, plan, sha256);
    return { data, body: draft.data.body };
  }
  return {
    review(input) {
      validateProductionRevisionRequest(input);
      const { base, draft, plan, drafts } = candidate(input, true), attachment = store.productionAttachment();
      check(attachment, 'PRODUCTION_REVISION_ATTACHMENT_REQUIRED', 409);
      const baselinePlan = store.history(attachment.data.planRef.id).find(row => row.version === attachment.data.planRef.version && row.sha256 === attachment.data.planRef.sha256);
      check(baselinePlan, 'PRODUCTION_REVISION_BASELINE_PLAN_MISSING', 409);
      return buildProductionRevisionPreview(base, attachment, baselinePlan, draft, plan, store.rawList(), sha256, drafts);
    },
    prepare(input) {
      validateProductionAttachmentRequest('prepare', input);
      const { data } = candidate(input), existing = store.productionAttachment();
      check(!existing || canonical(existing.data) === canonical(data), 'PRODUCTION_ATTACHMENT_ALREADY_EXISTS', 409);
      return { schemaVersion: 1, projectId: data.projectId, planRef: data.planRef, draftRef: data.draftRef, sourceHash: data.sourceHash,
        sceneCount: data.projection.scenes.length, shotCount: data.projection.scenes.reduce((sum, scene) => sum + scene.shots.length, 0), unplannedSceneIds: data.projection.scenes.filter(scene => !scene.shots.length).map(scene => scene.id),
        previewSha256: sha256(canonical(data)), attachmentRef: existing ? { id: existing.id, version: existing.version, sha256: existing.sha256 } : null };
    },
    attach(input) {
      validateProductionAttachmentRequest('attach', input);
      return store.commitProductionAttachment(input, () => {
        const result = candidate(input);
        check(sha256(canonical(result.data)) === input.previewSha256, 'PRODUCTION_ATTACHMENT_PREVIEW_STALE', 409);
        return result;
      });
    },
  };
}
