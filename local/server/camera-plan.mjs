import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { buildCameraExchange } from '../integrations/three-d/exchange.mjs';
import { validateWorkflowRef } from '../contracts/production-handoff.mjs';
import { check } from './storage.mjs';
import { resolveUnifiedWorkflow } from './unified-workflow.mjs';

/** Snapshot both saved planning inputs synchronously; the original camera
 * exchange stays unchanged so existing Blender proof verification still applies. */
export function exportLinkedCameraPlan(store,input) {
  check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).sort().join(',')==='basisHash,handoffRef,sceneId,sourceHash','INVALID_LINKED_CAMERA_PLAN');
  validateWorkflowRef(input.handoffRef);
  check(/^[a-f0-9]{64}$/.test(input.sourceHash??'')&&/^[a-f0-9]{64}$/.test(input.basisHash??''),'INVALID_LINKED_CAMERA_BASIS');
  const workflowContext=resolveUnifiedWorkflow(store,{sceneId:input.sceneId,handoffRef:input.handoffRef});
  check(workflowContext.sourceBasis.sourceHash===input.sourceHash,'LINKED_CAMERA_SOURCE_CONFLICT',409);
  check(workflowContext.status==='CURRENT'&&workflowContext.readiness==='READY_FOR_PLANNING','LINKED_CAMERA_HANDOFF_STALE',409);
  let exchange;
  try{exchange=buildCameraExchange({project:store.resolvedProject(),records:store.rawList()},{sceneId:input.sceneId,expectedSourceHash:input.sourceHash,expectedBasisHash:input.basisHash});}
  catch(error){check(false,error.code?.startsWith('DCC_')?error.code:'LINKED_CAMERA_EXCHANGE_REJECTED',409);}
  const payload={schema:'filmstack-linked-camera-plan/v1',exchange,workflowContext,authority:'PLANNING_CONTEXT_ONLY',productionAuthorized:false,sourceReplacement:false};
  return{...payload,sha256:hashCanonical(payload)};
}
