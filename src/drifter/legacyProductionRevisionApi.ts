import { canonicalJson, hashCanonical } from './canonical';
import { validateRecord } from './validation';
import { validateLegacyProductionRevisionPreview, buildLegacyProductionHandoff, type LegacyProductionMapping, type LegacyProductionRevisionPreview, type LegacyProductionApplyRequest } from '../../local/contracts/legacy-production-revision.mjs';
import type { Project, WorkspaceRecord, ScreenplayDraft } from './types';
import { writingDraftRef } from './writingProductionApi';
export type { LegacyProductionMapping, LegacyProductionRevisionPreview } from '../../local/contracts/legacy-production-revision.mjs';
export type LegacyPlanningSelection = Pick<LegacyProductionApplyRequest, 'sourceSceneId' | 'shotIds' | 'expectedVersion' | 'requestId' | 'notes'>;
export interface LegacyProductionRevisionApi {
  review(project: Project, draft: WorkspaceRecord, mappings: LegacyProductionMapping[], signal?: AbortSignal): Promise<LegacyProductionRevisionPreview>;
  apply(project: Project, draft: WorkspaceRecord, preview: LegacyProductionRevisionPreview, selection: LegacyPlanningSelection): Promise<WorkspaceRecord>;
}
const messages: Record<string, string> = {
  VERSION_CONFLICT: 'This scene’s planning link changed. Refresh the comparison before saving again.',
  REQUEST_ID_CONFLICT: 'This retry differs from the original save. Refresh the comparison before continuing.',
  LEGACY_REVISION_DRAFT_STALE: 'A newer writing draft is saved. Reopen it before reviewing production.',
  LEGACY_REVISION_PREVIEW_STALE: 'The reviewed production inputs changed. Compare again before updating planning.',
  LEGACY_REVISION_MAPPING_INVALID: 'Choose a distinct saved draft scene for each retained film scene.',
  HANDOFF_AUTHORING_INPUTS_NOT_CURRENT: 'An input to this draft changed. Review its writing connections before updating planning.',
};
async function post(action: string, input: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/legacy-production-revision/${action}`, { method: 'POST', credentials: 'same-origin', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(messages[value?.error] ?? 'The local service could not confirm this revision. Your existing production work is retained. Refresh the comparison and try again.');
  return value;
}
const requestFor = (project: Project, draft: WorkspaceRecord, mappings: LegacyProductionMapping[]) => ({ projectId: project.id, sourceHash: project.sourceHash, draftRef: writingDraftRef(draft), mappings });
export const legacyProductionRevisionApi: LegacyProductionRevisionApi = {
  async review(project, draft, mappings, signal) {
    const value = validateLegacyProductionRevisionPreview(await post('review', requestFor(project, draft, mappings), signal));
    const { previewSha256, ...data } = value;
    if (value.sourceSnapshotSha256 !== await hashCanonical({ projectId: project.id, sourceHash: project.sourceHash, scenes: project.scenes, prologue: project.prologue ?? [] })
      || value.projectId !== project.id || value.sourceHash !== project.sourceHash || canonicalJson(value.draftRef) !== canonicalJson(writingDraftRef(draft))
      || canonicalJson(value.mappings) !== canonicalJson(mappings) || previewSha256 !== await hashCanonical(data)) throw new Error('The revision review does not match this saved draft and production copy. Refresh before continuing.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((draft.data as ScreenplayDraft).body));
    const bodyHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (value.draftBodySha256 !== bodyHash) throw new Error('The review returned a different screenplay text. Reopen the saved draft.');
    return value;
  },
  async apply(project, draft, preview, selection) {
    const input = { ...requestFor(project, draft, preview.mappings), previewSha256: preview.previewSha256, ...selection };
    const result = await post('apply', input), record = await validateRecord(result?.record, project);
    const inputText = canonicalJson(input), inputHash = await hashCanonical(input);
    const expected = buildLegacyProductionHandoff(input, text => { if (text !== inputText) throw new Error('Planning request binding changed.'); return inputHash; });
    if (result.reviewSha256 !== preview.previewSha256 || result.appliedSceneId !== selection.sourceSceneId || record.id !== `production-handoff:${selection.sourceSceneId}` || record.kind !== 'production-handoff'
      || record.version !== (selection.expectedVersion ?? 0) + 1 || canonicalJson(record.data) !== canonicalJson(expected)) throw new Error('The saved planning link did not match the reviewed scene. Refresh saved records before continuing.');
    return record;
  },
};
