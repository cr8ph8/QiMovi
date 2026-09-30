import { canonicalJson, hashCanonical } from './canonical';
import { validateProductionAttachment, productionAttachmentId } from '../../local/contracts/production-attachment.mjs';
import type { ProductionAttachment, ProductionAttachmentPreview } from '../../local/contracts/production-attachment.mjs';
import type { CreativeProject, WorkspaceRecord } from './types';
import { writingDraftRef, type WritingProductionRecord } from './writingProductionApi';
export type { ProductionAttachmentPreview } from '../../local/contracts/production-attachment.mjs';
export interface ProductionAttachmentApi {
  prepare(project: CreativeProject, plan: WritingProductionRecord): Promise<ProductionAttachmentPreview>;
  attach(project: CreativeProject, plan: WritingProductionRecord, preview: ProductionAttachmentPreview, requestId: string): Promise<WorkspaceRecord & { data: ProductionAttachment }>;
}
const messages: Record<string, string> = {
  PRODUCTION_ATTACHMENT_ALREADY_EXISTS: 'This project already has a production copy. Open its storyboard to continue. Your working draft is retained.',
  PRODUCTION_ATTACHMENT_PLAN_STALE: 'The scene plan changed. Reopen its saved version and review the handoff again.',
  PRODUCTION_ATTACHMENT_DRAFT_STALE: 'The screenplay changed. Make a scene plan from its current saved revision before attaching it.',
  PRODUCTION_ATTACHMENT_PREVIEW_STALE: 'The handoff changed. Review the production copy again.',
  PRODUCTION_ATTACHMENT_SHOTS_REQUIRED: 'Add and save at least one shot before attaching a production copy.',
  PRODUCTION_ATTACHMENT_SHOT_INVALID: 'Review shot labels and planned durations before attaching the production copy.',
};
async function post(action: string, input: unknown) {
  const response = await fetch(`/api/production-attachment/${action}`, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(messages[value?.error] ?? value?.message ?? value?.error ?? 'The local service did not confirm the production handoff. Your work is retained.');
  return value;
}
function matchingPreview(value: ProductionAttachmentPreview, project: CreativeProject, plan: WritingProductionRecord) {
  return value?.schemaVersion === 1 && value.projectId === project.id && canonicalJson(value.planRef) === canonicalJson(writingDraftRef(plan))
    && canonicalJson(value.draftRef) === canonicalJson(plan.data.source.draftRef) && value.sourceHash === plan.data.source.bodySha256
    && value.sceneCount === plan.data.scenes.length && value.shotCount === plan.data.scenes.reduce((sum, scene) => sum + scene.shots.length, 0)
    && canonicalJson(value.unplannedSceneIds) === canonicalJson(plan.data.scenes.filter(scene => !scene.shots.length).map(scene => scene.sceneId))
    && /^[a-f0-9]{64}$/.test(value.previewSha256);
}
export const productionAttachmentApi: ProductionAttachmentApi = {
  async prepare(project, plan) {
    const value = await post('prepare', { projectId: project.id, planRef: writingDraftRef(plan) });
    if (!matchingPreview(value, project, plan)) throw new Error('The production preview does not match this saved screenplay and shot plan.');
    return value;
  },
  async attach(project, plan, preview, requestId) {
    if (!matchingPreview(preview, project, plan)) throw new Error('Review the production handoff again before continuing.');
    const record = await post('attach', { projectId: project.id, planRef: writingDraftRef(plan), previewSha256: preview.previewSha256, requestId });
    const data = validateProductionAttachment(record?.data, project);
    if (record.id !== productionAttachmentId(project.id) || record.kind !== 'production-attachment' || record.version !== 1 || record.sha256 !== await hashCanonical(data)
      || canonicalJson(data.planRef) !== canonicalJson(preview.planRef) || canonicalJson(data.draftRef) !== canonicalJson(preview.draftRef) || data.sourceHash !== preview.sourceHash) throw new Error('The attachment receipt did not match the reviewed plan. Refresh the project to inspect its retained state.');
    return record;
  },
};
