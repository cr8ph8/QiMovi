import { check, sha256 } from './storage.mjs';
import { buildLegacyProductionRevisionPreview, buildLegacyProductionHandoff, validateLegacyProductionRevisionRequest } from '../contracts/legacy-production-revision.mjs';
import { validateRecord } from '../contracts/drifter.mjs';
import { readAuthoringLineage } from './authoring-lineage.mjs';

export function createLegacyProductionRevisionService(store) {
  function candidate(input) {
    const project=store.project();
    check(project.id===input.projectId && project.sourceHash===input.sourceHash,'LEGACY_REVISION_SOURCE_STALE',409);
    check(!project.creativeOrigin && !project.productionAttachmentRef,'LEGACY_REVISION_IMPORTED_PROJECT_REQUIRED',409);
    const history=store.history(input.draftRef.id),draft=history.at(-1);
    check(draft && draft.version===input.draftRef.version && draft.sha256===input.draftRef.sha256,'LEGACY_REVISION_DRAFT_STALE',409);
    validateRecord('screenplay-draft',draft.data,project);
    check(readAuthoringLineage(store,{id:draft.id,sha256:draft.sha256},project.sourceHash).status==='CURRENT','LEGACY_REVISION_INPUTS_STALE',409);
    return {project,draft};
  }
  function review(input) {
    validateLegacyProductionRevisionRequest('review',input);
    const {project,draft}=candidate(input);
    return buildLegacyProductionRevisionPreview(project,draft,input.mappings,store.rawList(),sha256);
  }
  return {review,apply(input) {
    validateLegacyProductionRevisionRequest('apply',input);
    const id=`production-handoff:${input.sourceSceneId}`,data=buildLegacyProductionHandoff(input,sha256),save={kind:'production-handoff',data,expectedVersion:input.expectedVersion,requestId:`legacy-production-revision:${input.requestId}`};
    // Exact request retries return their original retained result even if the
    // draft or handoff advanced after a lost reply. store.save checks the entire
    // original payload fingerprint before its replay, never authorizing a new write.
    if (store.db.prepare('SELECT id FROM requests WHERE id=?').get(save.requestId)) return {record:store.save(id,save),reviewSha256:input.previewSha256,appliedSceneId:input.sourceSceneId};
    const preview=review(Object.fromEntries(['projectId','sourceHash','draftRef','mappings'].map(key=>[key,input[key]])));
    check(preview.previewSha256===input.previewSha256,'LEGACY_REVISION_PREVIEW_STALE',409);
    const scene=preview.sourceScenes.find(row=>row.sceneId===input.sourceSceneId);
    check((scene.currentHandoff?.ref.version??null)===input.expectedVersion,'VERSION_CONFLICT',409);
    let last=-1;
    for (const shotId of input.shotIds) {const index=scene.shotIds.indexOf(shotId);check(index>=0&&index>last,'LEGACY_REVISION_SHOT_MAPPING_INVALID',409);last=index;}
    // Existing storage revalidates authoring lineage and expected handoff version
    // inside BEGIN IMMEDIATE. No new source, asset, canon or budget record is written.
    return {record:store.save(id,save),reviewSha256:input.previewSha256,appliedSceneId:input.sourceSceneId};
  }};
}
