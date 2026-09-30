import { canonicalJson, hashCanonical } from './canonical';
import { validateProductionRevisionPreview, type ProductionRevisionPreview } from '../../local/contracts/production-revision.mjs';
import type { Project } from './types';
import { writingDraftRef, type WritingProductionRecord } from './writingProductionApi';

export type { ProductionRevisionPreview } from '../../local/contracts/production-revision.mjs';
export interface ProductionRevisionApi { review(project: Project, plan: WritingProductionRecord, signal?: AbortSignal): Promise<ProductionRevisionPreview> }
const messages: Record<string, string> = {
  PRODUCTION_ATTACHMENT_PLAN_STALE: 'This scene plan changed. Reopen its latest saved version before comparing.',
  PRODUCTION_ATTACHMENT_DRAFT_STALE: 'This screenplay has a newer revision. Create its scene plan in Write before comparing.',
  PRODUCTION_REVISION_DRAFT_LINEAGE_REQUIRED: 'Choose a later saved revision of the attached screenplay. A separate draft does not establish matching production scenes.',
  PRODUCTION_REVISION_ATTACHMENT_REQUIRED: 'Attach a production copy before comparing later revisions.',
};
export const productionRevisionApi: ProductionRevisionApi = {
  async review(project, plan, signal) {
    const response = await fetch('/api/production-attachment/review', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, planRef: writingDraftRef(plan) }) });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(messages[value?.error] ?? 'The local service could not compare these revisions. Refresh the saved plan and try again.');
    const preview = validateProductionRevisionPreview(value);
    const { previewSha256, ...body } = preview;
    if (preview.projectId !== project.id || preview.baselineSourceHash !== project.sourceHash
      || canonicalJson(preview.attachmentRef) !== canonicalJson(project.productionAttachmentRef)
      || canonicalJson(preview.baselinePlanRef) !== canonicalJson(project.productionPlanRef)
      || canonicalJson(preview.baselineDraftRef) !== canonicalJson(project.productionDraftRef)
      || canonicalJson(preview.candidatePlanRef) !== canonicalJson(writingDraftRef(plan))
      || canonicalJson(preview.candidateDraftRef) !== canonicalJson(plan.data.source.draftRef)
      || preview.candidateSourceHash !== plan.data.source.bodySha256 || previewSha256 !== await hashCanonical(body)) throw new Error('The comparison does not match the selected production copy and saved plan. Refresh before continuing.');
    return preview;
  },
};
