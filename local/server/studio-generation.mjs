import { projectOwnedContext } from '../contracts/creative-project.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { check, sha256 } from './storage.mjs';
import { composeHiggsfieldRequest, higgsfieldRequestJson } from '../providers/higgsfield-tools.mjs';
import { studioSettings } from '../contracts/studio-operation.mjs';
import { studioGenerationDetails } from '../contracts/studio-generation.mjs';
import { mcpToolData, uploadOwnedMedia, downloadGeneratedMedia } from './higgsfield-mcp-media.mjs';
import { productionReferenceRequirements, resolveProductionReferences } from './higgsfield-production-references.mjs';
import { marketingRequirements, resolveMarketingReferences } from './higgsfield-marketing-references.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const jobId = value => typeof value === 'string' && value.startsWith('studio-generation:') && uuid(value.slice(18));
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const hash = value => sha256(higgsfieldRequestJson(value));
const modelBinding = model => hash(Object.fromEntries(['id','output_type','parameters','medias','aspect_ratios','durations','duration_range'].filter(key=>Object.hasOwn(model,key)).map(key=>[key,model[key]])));
const errorCode = error => /^HIGGSFIELD_|^STUDIO_|^SOURCE_|^STALE_/.test(error?.code ?? '') ? error.code : 'STUDIO_GENERATION_UNAVAILABLE';
const roleMap = { image:'image',image_references:'image',start_image:'start_image',end_image:'end_image',video:'video',input_video:'video',video_references:'video',audio:'audio',input_audio:'audio',audio_references:'audio' };
const extensions = { 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','audio/wav':'wav','audio/mpeg':'mp3' };
const terminal = new Set(['completed','canceled','failed','nsfw','ip_detected']);
const statuses = new Set(['pending','waiting','queued','dna','script','visuals','vision','flow','in_progress','ip_detect',...terminal]);
const decimal = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(value);
const units = value => { const [a,b='']=value.split('.');return BigInt(a)*1000000000n+BigInt(b.padEnd(9,'0')); };
function credits(value) {
  check(typeof value==='number'&&Number.isFinite(value)&&value>=0,'HIGGSFIELD_QUOTE_INVALID',502);
  const text=String(value);check(decimal(text),'HIGGSFIELD_QUOTE_INVALID',502);return text;
}

export function validateStoryboardAnimationInput(data, project) {
  if (data.taskId !== 'generate_video' || data.target?.kind !== 'CELL') return;
  const cell = project.cells.find(row => row.id === data.target.cellId
    && row.sceneId === data.target.sceneId && row.shotId === data.target.shotId);
  check(cell, 'STUDIO_GENERATION_CELL_CHANGED', 409);
  check(!cell.crop || !data.medias.some(media => media.sha256 === cell.imageHash), 'STUDIO_GENERATION_CELL_CROP_REQUIRED', 409);
}

/** Validate the exact compiled request against a newly observed model. Defaults
 * are already explicit in the local composer; never silently adopt a new value. */
export function validateLiveGenerationRequest(model, params, media) {
  check(object(model)&&model.id===params.model&&['image','video','audio'].includes(model.output_type)&&Array.isArray(model.parameters)&&Array.isArray(model.medias),'HIGGSFIELD_LIVE_MODEL_INVALID',502);
  const definitions=new Map(model.parameters.map(p=>[p.name,p]));
  for(const [key,value] of Object.entries(params)) {
    if(['model','prompt','medias','use_unlim'].includes(key))continue;
    if(key==='count'){check(Number.isSafeInteger(value)&&value>=1&&value<=4&&(model.output_type!=='audio'||value===1),'HIGGSFIELD_COUNT_INVALID',422);continue;}
    if(key==='aspect_ratio'){check(model.aspect_ratios?.includes(value),'HIGGSFIELD_LIVE_ASPECT_CHANGED',409);continue;}
    if(key==='duration') {
      check(Number.isSafeInteger(value)&&value>0&&value<=180,'HIGGSFIELD_DURATION_LIMIT',422);
      if(model.durations?.length)check(model.durations.includes(value),'HIGGSFIELD_LIVE_DURATION_CHANGED',409);
      if(model.duration_range)check(value>=model.duration_range.min&&value<=model.duration_range.max,'HIGGSFIELD_LIVE_DURATION_CHANGED',409);
      if(model.durations?.length||model.duration_range)continue;
    }
    const p=definitions.get(key);check(p,'HIGGSFIELD_LIVE_PARAMETER_CHANGED',409);
    if(value===null){check(p.nullable===true,'HIGGSFIELD_LIVE_PARAMETER_CHANGED',409);continue;}
    check(p.type==='string'?typeof value==='string':p.type==='number'?typeof value==='number'&&Number.isFinite(value):p.type==='bool'?typeof value==='boolean':p.type==='string_array'?Array.isArray(value)&&value.every(x=>typeof x==='string'):false,'HIGGSFIELD_LIVE_PARAMETER_CHANGED',409);
    if(p.options)check(p.options.includes(value),'HIGGSFIELD_LIVE_PARAMETER_CHANGED',409);
    if(typeof value==='number'||Array.isArray(value)){const measure=Array.isArray(value)?value.length:value;check((p.min===undefined||measure>=p.min)&&(p.max===undefined||measure<=p.max),'HIGGSFIELD_LIVE_PARAMETER_CHANGED',409);}
  }
  for(const p of model.parameters)if(p.required==='required')check(Object.hasOwn(params,p.name),'HIGGSFIELD_LIVE_PARAMETER_REQUIRED',409);
  for(const group of model.medias){
    const roles=(group.roles??[]).map(role=>roleMap[role]).filter(Boolean),count=media.filter(row=>roles.includes(row.role)).length;
    check(!group.required||count>0,'HIGGSFIELD_LIVE_REFERENCE_REQUIRED',409);
    check(group.max===undefined||Number.isSafeInteger(group.max)&&count<=group.max,'HIGGSFIELD_LIVE_REFERENCE_LIMIT',409);
  }
  const allowed=new Set(model.medias.flatMap(group=>(group.roles??[]).map(role=>roleMap[role]).filter(Boolean)));
  check(media.every(row=>allowed.has(row.role)),'HIGGSFIELD_LIVE_REFERENCE_ROLE_CHANGED',409);
  check(!params.use_unlim||(params.count??1)===1,'HIGGSFIELD_UNLIMITED_SINGLE_TAKE_REQUIRED',409);
}

/** One runner per local project. Durable records claim a submission before the
 * provider is invoked. Process restart, lost response and cancel never resubmit. */
export function createStudioGenerationService(store, bridge, { now=Date.now, sourceStatus=()=> 'PENDING_OWNER_ADMISSION', uploadImpl=uploadOwnedMedia, downloadImpl=downloadGeneratedMedia }={}) {
  let busy=false,closing=false,active=null;
  const project=()=>store.resolvedProject();
  const scoped=value=>({projectId:project().id,sourceHash:project().sourceHash,...value});
  function get(id){check(jobId(id),'STUDIO_GENERATION_ID_INVALID',422);const record=store.rawList('studio-generation').find(row=>row.id===id);check(record,'STUDIO_GENERATION_NOT_FOUND',404);store.validateSavedRecord(record);return record;}
  function save(record,phase,details){details.evidenceHashes=[...new Set(details.evidenceHashes)];return store.saveStudioGenerationRecord(record.id,{kind:'studio-generation',expectedVersion:record.version,requestId:crypto.randomUUID(),data:{...record.data,phase,updatedAtMs:now(),detailsJson:JSON.stringify(details)}});}
  function evidence(value){
    const bytes=Buffer.from(JSON.stringify(value));check(bytes.length<=4*1024*1024,'HIGGSFIELD_RESPONSE_LIMIT',502);
    const file=path.join(store.directory,'blobs',`generation-evidence-${crypto.randomUUID()}.tmp`);
    try{fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});return store.putBlob(file,'application/json').sha256;}finally{if(fs.existsSync(file))fs.unlinkSync(file);}
  }
  function operation(ref){
    check(exact(ref,['id','version','sha256'])&&Number.isSafeInteger(ref.version)&&digest(ref.sha256),'STUDIO_GENERATION_OPERATION_INVALID',422);
    const row=store.rawList('studio-operation').find(item=>item.id===ref.id);check(row&&row.version===ref.version&&row.sha256===ref.sha256,'STUDIO_GENERATION_OPERATION_CHANGED',409);
    store.validateSavedRecord(row);return row;
  }
  function currentCreativeInputs(data){
    if(data.castingRef){
      const ref=data.castingRef,head=store.rawList('casting-draft').find(row=>row.id===ref.id);
      check(head&&head.version===ref.version&&head.sha256===ref.sha256,'STUDIO_GENERATION_CASTING_CHANGED',409);
      store.validateSavedRecord(head);
    }
    if(!data.writingRef)return;
    const ref=data.writingRef,head=store.rawList('screenplay-draft').find(row=>row.id===ref.id);
    check(head&&head.version===ref.version&&head.sha256===ref.sha256,'STUDIO_GENERATION_WRITING_CHANGED',409);
    store.validateSavedRecord(head);
  }
  function context(record){
    const d=record.data,p=projectOwnedContext(project(),'studio-operation',d),t=d.target;
    const scene=t.sceneId?p.scenes.find(row=>row.id===t.sceneId):null;
    return hash({projectId:p.id,sourceHash:p.sourceHash,target:t,scene:t.kind==='SCENE'?scene:null,shot:t.shotId?scene?.shots.find(row=>row.id===t.shotId)??null:null,
      cells:t.kind==='CELL'?p.cells.filter(row=>row.id===t.cellId):t.kind==='SHOT'?p.cells.filter(row=>row.sceneId===t.sceneId&&row.shotId===t.shotId):t.kind==='SCENE'?p.cells.filter(row=>row.sceneId===t.sceneId):[]});
  }
  function compose(record){
    const data=record.data,p=projectOwnedContext(project(),'studio-operation',data);
    currentCreativeInputs(data);
    check(data.taskId===`generate_${data.taskId.slice(9)}`&&['generate_image','generate_video','generate_audio'].includes(data.taskId),'STUDIO_GENERATION_TASK_UNSUPPORTED',422);
    validateStoryboardAnimationInput(data,p);
    if(data.sourceHash!==null)check(sourceStatus()==='ADMITTED','SOURCE_ADMISSION_REQUIRED',409);
    const plan=composeHiggsfieldRequest(store,{taskId:data.taskId,catalogSha256:data.catalogSha256,modelId:data.modelId,prompt:data.prompt,settings:studioSettings(data.settingsJson),medias:data.briefRef?[]:data.medias,...(data.briefRef?{brief:data.briefRef}:{})},sourceStatus());
    // Structural model/marker checks remain mandatory. The runner satisfies only
    // the identity lookup gates, using fresh provider observations below.
    const references=productionReferenceRequirements(plan.params);
    const marketing=marketingRequirements(plan.params);
    if(plan.model.output_type==='audio'){
      check(plan.params.format===undefined||['wav','mp3'].includes(plan.params.format),'HIGGSFIELD_AUDIO_FORMAT_NOT_RETAINABLE',422);
      check((plan.params.batch_size??1)===1,'HIGGSFIELD_AUDIO_SINGLE_SAMPLE_REQUIRED',422);
    }
    const executionChecks=new Set(['PROVIDER_UPLOAD_BINDINGS','REFERENCE_USE','WORKSPACE_BINDING','OWNER_EXECUTION_APPROVAL','DURABLE_EXECUTION',...(references.voice?['VOICE_BINDING']:[]),...(references.elementIds.length?['REFERENCE_ELEMENTS']:[]),...(marketing.active?['MARKETING_SELECTIONS']:[])]);
    const remaining=plan.checks.filter(row=>row.status==='BLOCKED'&&!executionChecks.has(row.code));
    check(remaining.length===0,'STUDIO_GENERATION_INPUTS_NEED_REVIEW',409);
    check(plan.mediaRequirements.every(row=>digest(row.sha256)&&row.crop===null&&row.status==='UPLOAD_BINDING_REQUIRED'&&extensions[row.mimeType]&&!Object.hasOwn(row,'inMs')),'STUDIO_GENERATION_ORIGINAL_INPUTS_REQUIRED',409);
    check(p.id&&(data.schemaVersion!==2||data.projectId===p.id),'STUDIO_GENERATION_PROJECT_MISMATCH',409);
    return plan;
  }
  function session(){return bridge.productionSession();}
  function requireCapabilities(connected,details){
    const actions={list_workspaces:{},models_get:{model_id:'string'},[`generate_${details.outputType}`]:{params:'object'},jobs_wait:{jobs:'array'}};
    const references=productionReferenceRequirements(details.params);
    if(references.voice)actions.list_voices={size:'number',cursor:'string'};
    if(references.elementIds.length)actions.show_reference_elements={action:'string',element_id:'string'};
    const marketing=marketingRequirements(details.params);
    const marketingActions={brand:['marketing_get_brand_kit',{brand_kit_id:'string'}],product:['marketing_list_products',{limit:'number',offset:'number'}],presenter:['marketing_list_avatars',{size:'number',user_cursor:'number',preset_cursor:'number'}],hook:['marketing_list_hooks',{size:'number',cursor:'number'}],setting:['marketing_list_settings',{size:'number',cursor:'number'}],style:['marketing_list_ad_formats',{}],format:['marketing_list_video_presets',{}]};
    for(const selection of marketing.selections){const [action,fields]=marketingActions[selection.kind];actions[action]=fields;}
    if(details.outputType!=='audio')actions[`estimate_${details.outputType}_cost`]={params:'object'};
    if(details.media.length){actions.media_upload={filename:'string',content_type:'string',method:'string'};actions.media_confirm={media_id:'string',type:'string'};}
    for(const [action,fields] of Object.entries(actions)){
      const matches=connected.tools.filter(tool=>tool.name===action||tool.name===`higgsfield_${action}`),schema=matches[0]?.inputSchema;
      check(matches.length===1&&schema?.type==='object'&&(schema.required??[]).every(key=>Object.hasOwn(fields,key))&&Object.entries(fields).every(([key,type])=>schema.properties?.[key]?.type===type),'HIGGSFIELD_LIFECYCLE_CAPABILITY_UNAVAILABLE',409);
    }
  }
  async function call(action,args,id){check(!closing,'STUDIO_GENERATION_CLOSING',409);active?.beforeProviderCall?.();return bridge.productionCall(action,args,id);}
  async function workspaces(id){
    const data=mcpToolData(await call('list_workspaces',{},id));
    check(Array.isArray(data.workspaces)&&data.workspaces.length<=200&&data.workspaces.every(row=>uuid(row.id)&&typeof row.is_selected==='boolean'&&(row.name===null||typeof row.name==='string'))&&new Set(data.workspaces.map(row=>row.id)).size===data.workspaces.length,'HIGGSFIELD_WORKSPACES_INVALID',502);
    return data.workspaces;
  }
  async function requireWorkspace(workspaceId,connectionId){const selected=(await workspaces(connectionId)).filter(row=>row.is_selected);check(selected.length===1&&selected[0].id===workspaceId,'HIGGSFIELD_WORKSPACE_CHANGED',409);return selected[0];}
  async function refreshReferences(details,initial=false){
    const options={params:details.params,
      callTool:async(action,args)=>{await requireWorkspace(details.workspaceId,details.connectionId);return call(action,args,details.connectionId);},
      evidence:raw=>{const receipt=evidence(raw);details.evidenceHashes.push(receipt);return receipt;}};
    const references=await resolveProductionReferences(options),marketing=marketingRequirements(details.params);
    const selections=marketing.active?(await resolveMarketingReferences(options)).selections:[];
    const identity={voice:references.voice,elements:references.elements,...(marketing.active?{marketing:selections}:{})},identitySha256=hash(identity);
    if(references.voice||references.elements.length||marketing.active)await requireWorkspace(details.workspaceId,details.connectionId);
    check(initial||details.providerReferencesSha256===identitySha256||!details.providerReferencesSha256&&!references.voice&&!references.elements.length&&!marketing.active,'HIGGSFIELD_REFERENCE_IDENTITY_CHANGED',409);
    details.providerReferences=identity;details.providerReferencesSha256=identitySha256;details.referencesObservedAtMs=now();
  }
  async function exclusive(work){
    check(!busy&&!closing,'STUDIO_GENERATION_BUSY',409);busy=true;const controller=new AbortController();let done;
    active={controller,done:new Promise(resolve=>{done=resolve;})};
    try{return await work(controller.signal);}finally{busy=false;active=null;done();}
  }
  async function quote(details){
    await requireWorkspace(details.workspaceId,details.connectionId);
    const action=details.outputType==='audio'?'generate_audio':`estimate_${details.outputType}_cost`;
    const raw=await call(action,{params:{...details.params,...(details.outputType==='audio'?{get_cost:true}:{})}},details.connectionId);
    const data=mcpToolData(raw);check(!data.unlim_choice,'HIGGSFIELD_PAYMENT_CHOICE_REQUIRED',409);
    check(!data.adjustments||Object.keys(data.adjustments).length===0,'HIGGSFIELD_ADJUSTMENTS_REQUIRE_REVIEW',409);
    check(object(data.cost),'HIGGSFIELD_QUOTE_INVALID',502);
    const exactCredits=credits(data.cost.credits_exact),wholeCredits=credits(data.cost.credits);
    return {credits:units(exactCredits)>=units(wholeCredits)?exactCredits:wholeCredits,observedAtMs:now(),responseSha256:evidence(raw),requestSha256:hash(details.params),providerReferencesSha256:details.providerReferencesSha256};
  }
  function current(record,details){const op=operation(record.data.operationRef);check(context(op)===details.contextSha256,'STUDIO_GENERATION_CONTEXT_CHANGED',409);check(hash(compose(op))===details.planSha256,'STUDIO_GENERATION_PLAN_CHANGED',409);check(session().connectionId===details.connectionId,'HIGGSFIELD_CONNECTION_CHANGED',409);return op;}
  function normalizeJob(row){
    check(object(row)&&uuid(row.id)&&statuses.has(row.status)&&['image','video','audio'].includes(row.type),'HIGGSFIELD_GENERATION_RESULT_INVALID',502);
    const url=row.results?.rawUrl;
    check(url===undefined||typeof url==='string'&&url.startsWith('https://')&&url.length<=16384,'HIGGSFIELD_GENERATION_RESULT_INVALID',502);
    return {id:row.id,status:row.status,type:row.type,...(url?{resultUrl:url}:{})};
  }
  function phaseFor(jobs,expectedCount){return jobs.every(row=>row.status==='completed')&&jobs.length===expectedCount?'COMPLETED':jobs.every(row=>terminal.has(row.status))?jobs.every(row=>row.status==='canceled')?'CANCELLED':'FAILED':jobs.some(row=>row.status==='in_progress')?'PROCESSING':'SUBMITTED';}
  // Recovery changes only the local account of an interrupted call. It performs
  // no provider work and cannot convert an uncertain attempt into a new attempt.
  for(const record of store.rawList('studio-generation')){
    if(record.data.phase==='SUBMITTING')save(record,'SUBMISSION_UNKNOWN',{...studioGenerationDetails(record.data.detailsJson),error:'STUDIO_GENERATION_RESTART_DURING_SUBMISSION'});
    if(record.data.phase==='PREPARING')save(record,'PREPARATION_FAILED',{...studioGenerationDetails(record.data.detailsJson),error:'STUDIO_GENERATION_PREPARATION_INTERRUPTED'});
  }
  return {
    list:()=>scoped({records:store.rawList('studio-generation').map(row=>{store.validateSavedRecord(row);return row;})}),
    workspaces:()=>exclusive(async()=>scoped({workspaces:await workspaces(session().connectionId)})),
    prepare:input=>exclusive(async signal=>{
      check(exact(input,['jobId','operationRef','workspaceId','paymentChoice','referenceUseConfirmed'])&&jobId(input.jobId)&&uuid(input.workspaceId)&&['CREDITS','UNLIMITED'].includes(input.paymentChoice)&&input.referenceUseConfirmed===true,'STUDIO_GENERATION_PREPARE_INVALID',422);
      const inputSha256=hash(input),prior=store.rawList('studio-generation').find(row=>row.id===input.jobId);
      if(prior){store.validateSavedRecord(prior);check(studioGenerationDetails(prior.data.detailsJson).prepareInputSha256===inputSha256,'STUDIO_GENERATION_RETRY_CHANGED',409);return prior;}
      const op=operation(input.operationRef),plan=compose(op),connected=session(),p=projectOwnedContext(project(),'studio-operation',op.data);
      // Each awaited provider observation may allow another owner edit. Check
      // again immediately before subsequent calls, especially submission.
      active.beforeProviderCall=()=>currentCreativeInputs(op.data);
      let details={prepareInputSha256:inputSha256,title:op.data.title,modelId:plan.model.id,outputType:plan.model.output_type,workspaceId:input.workspaceId,workspaceName:null,connectionId:connected.connectionId,paymentChoice:input.paymentChoice,referenceUseConfirmed:true,contextSha256:context(op),planSha256:hash(plan),params:{...plan.params,use_unlim:input.paymentChoice==='UNLIMITED'},media:plan.mediaRequirements,uploads:[],quote:null,jobs:[],outputs:[],evidenceHashes:[],error:null};
      requireCapabilities(connected,details);const createdAtMs=now();
      let record=store.saveStudioGenerationRecord(input.jobId,{kind:'studio-generation',expectedVersion:null,requestId:crypto.randomUUID(),data:{schemaVersion:1,projectId:p.id,sourceHash:p.sourceHash,operationRef:input.operationRef,provider:'HIGGSFIELD_MCP',phase:'PREPARING',createdAtMs,updatedAtMs:createdAtMs,detailsJson:JSON.stringify(details)}});
      try{
        const spaces=await workspaces(details.connectionId),chosen=spaces.find(row=>row.id===details.workspaceId);check(chosen,'HIGGSFIELD_WORKSPACE_NOT_AVAILABLE',409);
        if(!chosen.is_selected)mcpToolData(await call('workspace_select',{workspace_id:chosen.id},details.connectionId));
        const selected=await requireWorkspace(chosen.id,details.connectionId);details.workspaceName=selected.name;
        const modelRaw=await call('models_get',{model_id:details.modelId},details.connectionId),model=mcpToolData(modelRaw);
        validateLiveGenerationRequest(model,details.params,details.media);check(model.output_type===details.outputType,'HIGGSFIELD_LIVE_OUTPUT_CHANGED',409);
        details.modelRequirementsSha256=modelBinding(model);details.evidenceHashes.push(evidence(modelRaw));record=save(record,'PREPARING',details);
        await refreshReferences(details,true);record=save(record,'PREPARING',details);
        const byHash=new Map();
        for(const media of details.media){
          if(byHash.has(media.sha256))continue;
          await requireWorkspace(details.workspaceId,details.connectionId);current(record,details);
          const blob=store.blob(media.sha256);
          const uploaded=await uploadImpl({callTool:(action,args)=>call(action,args,details.connectionId),blob:{bytes:blob.bytes,sha256:media.sha256,mimeType:media.mimeType},filename:`reference-${media.sha256.slice(0,16)}.${extensions[media.mimeType]}`,signal,onAllocated:async allocation=>{details.uploads.push(allocation);record=save(record,'PREPARING',details);}});
          check(uploaded.sha256===media.sha256&&uploaded.mimeType===media.mimeType&&uploaded.status==='uploaded'&&uuid(uploaded.mediaId),'HIGGSFIELD_UPLOAD_RECEIPT_INVALID',502);
          details.uploads=details.uploads.map(row=>row.mediaId===uploaded.mediaId?uploaded:row);byHash.set(media.sha256,uploaded.mediaId);record=save(record,'PREPARING',details);
        }
        if(details.media.length)details.params.medias=details.media.map(row=>({role:row.role,value:byHash.get(row.sha256)}));
        if(details.media.length)await refreshReferences(details);
        details.quote=await quote(details);details.evidenceHashes.push(details.quote.responseSha256);current(record,details);
        return save(record,'PREPARED',details);
      }catch(error){details.error=errorCode(error);return save(record,'PREPARATION_FAILED',details);}
    }),
    submit:input=>exclusive(async()=>{
      check(exact(input,['jobId','expectedVersion','maximumCredits'])&&Number.isSafeInteger(input.expectedVersion)&&decimal(input.maximumCredits),'STUDIO_GENERATION_APPROVAL_INVALID',422);
      let record=get(input.jobId),details=studioGenerationDetails(record.data.detailsJson);
      // A retry reads the claimed outcome; it never invokes generate twice.
      if(['SUBMITTING','SUBMISSION_UNKNOWN','SUBMITTED','PROCESSING','COMPLETED','FAILED','CANCELLED','RETAINED'].includes(record.data.phase))return record;
      check(record.data.phase==='PREPARED','STUDIO_GENERATION_QUOTE_CHANGED',409);
      if(record.version!==input.expectedVersion)return record;
      try {
      const op=current(record,details);active.beforeProviderCall=()=>currentCreativeInputs(op.data);requireCapabilities(session(),details);check(details.quote&&now()-details.quote.observedAtMs<=10*60000,'HIGGSFIELD_QUOTE_EXPIRED',409);
      check(units(input.maximumCredits)>=units(details.quote.credits),'HIGGSFIELD_QUOTE_EXCEEDS_CEILING',409);
      await refreshReferences(details);
      const refreshed=await quote(details);details.evidenceHashes.push(refreshed.responseSha256);details.quote=refreshed;
      if(units(refreshed.credits)>units(input.maximumCredits)){details.error='HIGGSFIELD_QUOTE_EXCEEDS_CEILING';return save(record,'PREPARED',details);}
      const liveModel=await call('models_get',{model_id:details.modelId},details.connectionId),liveModelData=mcpToolData(liveModel);
      check(liveModelData.output_type===details.outputType&&modelBinding(liveModelData)===details.modelRequirementsSha256,'HIGGSFIELD_LIVE_MODEL_CHANGED',409);
      validateLiveGenerationRequest(liveModelData,details.params,details.media);
      details.evidenceHashes.push(evidence(liveModel));current(record,details);await requireWorkspace(details.workspaceId,details.connectionId);current(record,details);
      details.approval={maximumCredits:input.maximumCredits,quotedCredits:refreshed.credits,requestSha256:hash(details.params),providerReferencesSha256:details.providerReferencesSha256,approvedAtMs:now(),maximumAttempts:1};details.error=null;
      }catch(error){details.error=errorCode(error);details.submissionDisposition='NOT_SENT';return save(record,'PREPARATION_FAILED',details);}
      record=save(record,'SUBMITTING',details);
      try{
        const raw=await call(`generate_${details.outputType}`,{params:details.params},details.connectionId);details.evidenceHashes.push(evidence(raw));
        const data=mcpToolData(raw);
        if(data.unlim_choice){details.error='HIGGSFIELD_PAYMENT_CHOICE_REQUIRED';return save(record,'FAILED',details);}
        check(Array.isArray(data.results)&&data.results.length>=1&&data.results.length<=4,'HIGGSFIELD_GENERATION_RESULT_INVALID',502);
        details.jobs=[];for(const result of data.results)details.jobs.push(normalizeJob(result));
        check(new Set(details.jobs.map(row=>row.id)).size===details.jobs.length&&details.jobs.every(row=>row.type===details.outputType)&&data.results.every(row=>row.model===details.modelId),'HIGGSFIELD_GENERATION_RESULT_INVALID',502);
        if(data.adjustments&&Object.keys(data.adjustments).length)details.providerAdjustments=data.adjustments;
        if(details.jobs.length!==(details.params.count??1))details.error='HIGGSFIELD_RESULT_COUNT_CHANGED';
        return save(record,phaseFor(details.jobs,details.params.count??1),details);
      }catch(error){details.error=errorCode(error);if(error.requestMayHaveBeenSent===false)details.submissionDisposition='NOT_SENT';return save(record,error.requestMayHaveBeenSent===false?'FAILED':'SUBMISSION_UNKNOWN',details);}
    }),
    poll:input=>exclusive(async()=>{
      check(exact(input,['jobId']),'STUDIO_GENERATION_POLL_INVALID',422);let record=get(input.jobId),details=studioGenerationDetails(record.data.detailsJson);
      if(record.data.phase==='RETAINED')return record;
      check(details.jobs.length>0&&['SUBMITTED','PROCESSING','SUBMISSION_UNKNOWN','COMPLETED','FAILED'].includes(record.data.phase),'STUDIO_GENERATION_NO_JOB_TO_LOOK_UP',409);
      const connected=session();await requireWorkspace(details.workspaceId,connected.connectionId);
      const raw=await call('jobs_wait',{jobs:details.jobs.map((row,index)=>({index,job_id:row.id})),timeout_seconds:0},connected.connectionId),data=mcpToolData(raw);
      check(Array.isArray(data.jobs)&&data.jobs.length===details.jobs.length,'HIGGSFIELD_JOB_LOOKUP_INVALID',502);
      details.jobs=details.jobs.map((previous,index)=>{
        const row=data.jobs.find(job=>job.index===index);check(row?.job_id===previous.id,'HIGGSFIELD_JOB_LOOKUP_INVALID',502);
        if(row.status==='lookup_failed'){details.error='HIGGSFIELD_JOB_LOOKUP_UNRESOLVED';return previous;}
        check(statuses.has(row.status)&&(!row.type||row.type===previous.type)&&(!row.model||row.model===details.modelId),'HIGGSFIELD_JOB_LOOKUP_INVALID',502);
        check(!terminal.has(previous.status)||row.status===previous.status,'HIGGSFIELD_JOB_TERMINAL_STATUS_CHANGED',502);
        check(row.result_url===undefined||typeof row.result_url==='string'&&row.result_url.startsWith('https://')&&row.result_url.length<=16384,'HIGGSFIELD_JOB_LOOKUP_INVALID',502);
        return {...previous,status:row.status,...(typeof row.result_url==='string'?{resultUrl:row.result_url}:{})};
      });
      details.evidenceHashes.push(evidence(raw));const phase=phaseFor(details.jobs,details.params.count??1);
      return save(record,record.data.phase==='FAILED'?'FAILED':record.data.phase==='PROCESSING'&&phase==='SUBMITTED'?'PROCESSING':phase,details);
    }),
    retain:input=>exclusive(async signal=>{
      check(exact(input,['jobId']),'STUDIO_GENERATION_RETAIN_INVALID',422);let record=get(input.jobId),details=studioGenerationDetails(record.data.detailsJson);
      if(record.data.phase==='RETAINED')return record;check(['COMPLETED','FAILED'].includes(record.data.phase)&&details.jobs.some(row=>row.status==='completed'),'STUDIO_GENERATION_NOT_COMPLETED',409);
      const partial=record.data.phase==='FAILED';
      for(const job of details.jobs.filter(row=>row.status==='completed')){
        if(details.outputs.some(row=>row.jobId===job.id))continue;
        if(typeof job.resultUrl!=='string'){details.error='HIGGSFIELD_RESULT_URL_MISSING';continue;}
        const file=path.join(store.directory,'blobs',`generation-result-${crypto.randomUUID()}.tmp`);
        try{const media=await downloadImpl({url:job.resultUrl,outputType:job.type,signal});fs.writeFileSync(file,media.bytes,{flag:'wx',mode:0o600});const blob=store.putBlob(file,media.mimeType,{sha256:media.sha256,byteLength:media.bytes.length,maxBytes:256*1024*1024});details.outputs.push({jobId:job.id,sha256:blob.sha256,mimeType:media.mimeType,byteLength:media.bytes.length,filename:media.filename,status:'UNREVIEWED'});}
        catch(error){details.error=errorCode(error);}
        finally{if(fs.existsSync(file))fs.unlinkSync(file);}
        record=save(record,partial?'FAILED':'COMPLETED',details);
      }
      const complete=!partial&&details.jobs.every(job=>details.outputs.some(row=>row.jobId===job.id));
      if(complete)details.error=null;
      return save(record,complete?'RETAINED':partial?'FAILED':'COMPLETED',details);
    }),
    async close(){closing=true;if(active){const pending=active;pending.controller.abort();await pending.done;}}
  };
}
