import { hashCanonical, canonicalJson } from './canonical';
import { validateRecord } from './validation';
import type { CreativeProject, WorkspaceRecord } from './types';
import { validateWritingProductionPlan } from '../../local/contracts/writing-production.mjs';
import type { SavedDraftRef, WritingProductionPlan, WritingProductionScene, WritingProductionPreview } from '../../local/contracts/writing-production.mjs';
export type { SavedDraftRef, WritingProductionPlan, WritingProductionScene, WritingProductionPreview, WritingProductionShot } from '../../local/contracts/writing-production.mjs';

export type WritingProductionRecord = WorkspaceRecord & { kind: 'writing-production-plan'; data: WritingProductionPlan };
export interface WritingProductionApi {
  preview(project: CreativeProject, draftRef: SavedDraftRef): Promise<WritingProductionPreview>;
  handoff(project: CreativeProject, preview: WritingProductionPreview, requestId: string): Promise<WritingProductionRecord>;
  save(project: CreativeProject, record: WritingProductionRecord, scenes: WritingProductionScene[], requestId: string): Promise<WritingProductionRecord>;
}
const messages: Record<string, string> = {
  WRITING_PRODUCTION_DRAFT_STALE: 'The screenplay has a newer saved revision. Refresh drafts and review that revision before continuing.',
  WRITING_PRODUCTION_PREVIEW_STALE: 'The screenplay or plan changed. Preview the handoff again before continuing.',
  WRITING_PRODUCTION_SHOT_INVALID: 'Give each shot a label. Planned seconds must be blank or a whole number from 1 to 3,600.',
  WRITING_PRODUCTION_SHOT_LIMIT: 'This plan supports up to 1,000 shots. Split the work into another screenplay revision or reduce the open plan.',
  WRITING_PRODUCTION_PLAN_MISSING: 'This saved plan is unavailable. Refresh the project before reopening it.',
  VERSION_CONFLICT: 'This plan changed elsewhere. Your open changes are retained. Reopen the saved plan before trying again.',
  WRITING_PRODUCTION_SCENE_IDENTITY_REVIEW_REQUIRED: 'Resolve the scene identity choices in the writer, then save the screenplay before making its scene plan.',
  WRITING_PRODUCTION_SCENES_REQUIRED: 'Add at least one screenplay scene heading, save the draft, then review the handoff again.',
};
async function post(path: string, data: unknown) {
  const response = await fetch(`/api/writing-production/${path}`, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(messages[value?.error] ?? value?.message ?? value?.error ?? 'The local workspace did not confirm this operation. Your work is retained.');
  return value;
}
const refOf = (record: WorkspaceRecord): SavedDraftRef => ({ id: record.id, version: record.version, sha256: record.sha256 });
export { refOf as writingDraftRef };
export const writingProductionApi: WritingProductionApi = {
  async preview(project, draftRef) {
    const value = await post('preview', { projectId: project.id, draftRef });
    if (value?.schemaVersion !== 1 || value.projectId !== project.id || canonicalJson(value.source?.draftRef) !== canonicalJson(draftRef)
      || !Array.isArray(value.scenes) || !value.scenes.length || value.source.sceneCount !== value.scenes.length || !/^[a-f0-9]{64}$/.test(value.previewSha256)) throw new Error('The scene preview does not match the selected saved screenplay.');
    validateWritingProductionPlan({ schemaVersion: 1, projectId: project.id, sourceHash: null, status: 'PLANNING_ONLY', source: value.source, scenes: value.scenes.map((scene: object) => ({ ...scene, notes: '', shots: [] })) }, project);
    if (value.planId !== `writing-production-plan:${await hashCanonical({ projectId: project.id, draftRef })}` || value.previewSha256 !== await hashCanonical({ projectId: project.id, source: value.source, scenes: value.scenes })) throw new Error('The scene preview failed its revision check. Review it again.');
    return value as WritingProductionPreview;
  },
  async handoff(project, preview, requestId) {
    const record = await validateRecord(await post('handoff', { projectId: project.id, draftRef: preview.source.draftRef, previewSha256: preview.previewSha256, requestId }), project) as WritingProductionRecord;
    if (record.kind !== 'writing-production-plan' || record.id !== preview.planId || canonicalJson(record.data.source) !== canonicalJson(preview.source) || canonicalJson(record.data.scenes.map(({ notes: _notes, shots: _shots, ...scene }) => scene)) !== canonicalJson(preview.scenes)) throw new Error('The saved scene plan does not match the reviewed revision.');
    return record;
  },
  async save(project, record, scenes, requestId) {
    const data = { ...record.data, scenes };
    const result = await validateRecord(await post('save', { projectId: project.id, planId: record.id, expectedVersion: record.version, requestId, scenes: scenes.map(({ sceneId, notes, shots }) => ({ sceneId, notes, shots })) }), project) as WritingProductionRecord;
    if (result.id !== record.id || result.kind !== record.kind || result.version !== record.version + 1 || result.sha256 !== await hashCanonical(data)) throw new Error('The save response did not match this scene plan. Reopen the saved plan to inspect the result.');
    return result;
  },
};
