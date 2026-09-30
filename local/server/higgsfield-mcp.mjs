import crypto from 'node:crypto';
import { createHiggsfieldMcpTransport } from './higgsfield-mcp-transport.mjs';
import { validateReferenceCreateArguments } from './higgsfield-production-references.mjs';

const RESOURCE='https://mcp.higgsfield.ai/mcp', ISSUER='https://clerk.higgsfield.ai';
const METADATA='https://mcp.higgsfield.ai/.well-known/oauth-protected-resource';
const AUTH_METADATA=ISSUER+'/.well-known/oauth-authorization-server';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(value,code,status=422)=>{if(!value)throw Object.assign(new Error(code),{code,status});};
const secret=value=>typeof value==='string'&&value.length>0&&value.length<=16384&&!/[\x00-\x20\x7f]/.test(value);
const tokenHash=value=>crypto.createHash('sha256').update(value).digest();
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&crypto.timingSafeEqual(tokenHash(a),tokenHash(b));
export const HIGGSFIELD_MCP_READ_ACTIONS=Object.freeze({
  balance:'Check production credits',list_workspaces:'Browse production workspaces',models_list:'Browse generation models',
  models_get:'Inspect model requirements',models_search:'Find a model',models_recommend:'Find models for this creative task',
  list_voices:'Browse voices',show_reference_elements:'Browse characters, props and places',get_faceless_channel_presets:'Browse narration styles',
  marketing_list_brand_kits:'Browse brand identities',marketing_get_brand_kit:'Inspect brand identity',
  marketing_list_products:'Browse featured products',marketing_list_webproducts:'Browse website subjects',
  marketing_list_avatars:'Browse presenters',marketing_list_hooks:'Browse opening hooks',
  marketing_list_settings:'Browse filming settings',marketing_list_video_presets:'Browse promotional video formats',
  marketing_list_ad_formats:'Browse campaign artwork formats',scene_builder_3d_list_projects:'Browse remote sets',
  scene_builder_3d_get_project:'Inspect a remote set',scene_builder_3d_search_assets:'Find set dressing',
  scene_builder_3d_get_operation:'Check a remote set operation',video_analysis_jobs:'Browse footage analyses',video_analysis_status:'Read footage analysis',
});
const productionActions=new Set([...Object.keys(HIGGSFIELD_MCP_READ_ACTIONS),
  'workspace_select','media_upload','media_confirm','estimate_image_cost','estimate_video_cost',
  'generate_image','generate_video','generate_audio','jobs_wait']);

// Elements is a mixed read/write provider tool. Every local route exposing its
// lookup capability must exclude create and all creation fields before transport.
function referenceReadArguments(action,args) {
  if(action!=='show_reference_elements')return;
  const keys=Object.keys(args);
  if(args.action==='get') {
    need(keys.sort().join(',')==='action,element_id'&&typeof args.element_id==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(args.element_id),'HIGGSFIELD_MCP_REFERENCE_READ_INPUT',422);
    return;
  }
  need(args.action==='list'&&keys.every(key=>['action','cursor','size'].includes(key))
    &&(args.cursor===undefined||typeof args.cursor==='number'&&Number.isFinite(args.cursor)&&args.cursor>=0&&args.cursor<=Number.MAX_SAFE_INTEGER)
    &&(args.size===undefined||Number.isSafeInteger(args.size)&&args.size>=1&&args.size<=100),'HIGGSFIELD_MCP_REFERENCE_READ_INPUT',422);
}

// One local project session owns its own public OAuth client and tokens. Nothing
// reads Codex/CLI credentials; bearer and refresh tokens never enter project files,
// HTTP responses, logs or backups. Closing the app requires a fresh sign-in.
export function createHiggsfieldMcpBridge({fetchImpl=fetch,transportFactory=createHiggsfieldMcpTransport,now=Date.now}={}) {
  let origin=null,metadata=null,registration=null,flow=null,tokens=null,tools=[],busy=false,closed=false;
  let phase='NOT_CONNECTED',lastError=null,checkedAt=null,refreshing=null,epoch=0,connectionId=null;
  const controllers=new Set();
  const transport=transportFactory({fetchImpl,getAccessToken:accessToken});
  const currentFlow=attempt=>!closed&&flow===attempt&&now()<attempt.expiresAt;
  const available=()=>Object.entries(HIGGSFIELD_MCP_READ_ACTIONS).flatMap(([action,title])=>{
    const matches=tools.filter(tool=>tool.name===action||tool.name===`higgsfield_${action}`);
    return matches.length===1?[{action,title,toolName:matches[0].name,inputSchema:matches[0].inputSchema}]:[];
  });
  function observation(){
    if(flow&&now()>=flow.expiresAt){flow=null;phase='SIGN_IN_EXPIRED';}
    return {schemaVersion:'caniscreenwrite-higgsfield-mcp/v1',phase,endpoint:RESOURCE,checkedAt,
      authenticated:Boolean(tokens&&tokens.expiresAt>now()),toolCount:tools.length,readActions:available(),executionEnabled:false,
      ...(flow?{authorizationUrl:flow.authorizationUrl,expiresAt:new Date(flow.expiresAt).toISOString()}:{}),
      ...(lastError?{error:lastError}:{}),credentialPersistence:'SESSION_ONLY'};
  }
  async function jsonRequest(url,init={}) {
    need(!closed,'HIGGSFIELD_MCP_CLOSED',409);
    const controller=new AbortController();controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetchImpl(url,{...init,redirect:'error',signal:controller.signal});
      need(response.ok,'HIGGSFIELD_MCP_AUTH_REQUEST_FAILED',502);
      need(response.headers.get('content-type')?.split(';')[0]==='application/json','HIGGSFIELD_MCP_AUTH_FORMAT',502);
      let bytes=0;const chunks=[];
      for await(const chunk of response.body){bytes+=chunk.length;need(bytes<=256*1024,'HIGGSFIELD_MCP_AUTH_RESPONSE_LIMIT',502);chunks.push(chunk);}
      const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));need(object(value),'HIGGSFIELD_MCP_AUTH_FORMAT',502);return value;
    }catch(error){throw Object.assign(new Error('HIGGSFIELD_MCP_AUTH_REQUEST_FAILED'),{code:error.code?.startsWith('HIGGSFIELD_MCP_')?error.code:'HIGGSFIELD_MCP_AUTH_REQUEST_FAILED',status:502});}
    finally{clearTimeout(timer);controllers.delete(controller);}
  }
  async function discover(){
    const resource=await jsonRequest(METADATA);
    need(resource.resource===RESOURCE&&Array.isArray(resource.authorization_servers)&&resource.authorization_servers.includes(ISSUER),'HIGGSFIELD_MCP_AUTHORITY_CHANGED',409);
    const value=await jsonRequest(AUTH_METADATA);
    need(value.issuer===ISSUER&&value.authorization_endpoint===ISSUER+'/oauth/authorize'&&value.token_endpoint===ISSUER+'/oauth/token'&&value.registration_endpoint===ISSUER+'/oauth/register'
      &&value.code_challenge_methods_supported?.includes('S256')&&value.token_endpoint_auth_methods_supported?.includes('none')
      &&value.grant_types_supported?.includes('authorization_code'),'HIGGSFIELD_MCP_AUTHORITY_CHANGED',409);
    metadata=value;checkedAt=new Date(now()).toISOString();return value;
  }
  function acceptTokens(value){
    need(secret(value.access_token)&&typeof value.token_type==='string'&&value.token_type.toLowerCase()==='bearer'
      &&Number.isSafeInteger(value.expires_in)&&value.expires_in>0&&value.expires_in<=2592000
      &&(value.refresh_token===undefined||secret(value.refresh_token)),'HIGGSFIELD_MCP_TOKEN_FORMAT',502);
    tokens={access:value.access_token,refresh:value.refresh_token??tokens?.refresh??null,expiresAt:now()+value.expires_in*1000};
  }
  async function accessToken(){
    need(!closed&&tokens,'HIGGSFIELD_MCP_SIGN_IN_REQUIRED',401);
    if(tokens.expiresAt>now()+30000)return tokens.access;
    if(!tokens.refresh){tokens=null;tools=[];phase='SIGN_IN_EXPIRED';throw Object.assign(new Error('HIGGSFIELD_MCP_SIGN_IN_REQUIRED'),{code:'HIGGSFIELD_MCP_SIGN_IN_REQUIRED',status:401});}
    if(!refreshing){
      const captured=tokens;
      refreshing=(async()=>{
        try{
          const value=await jsonRequest(metadata.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:registration.clientId,refresh_token:captured.refresh,resource:RESOURCE}).toString()});
          need(tokens===captured&&!closed,'HIGGSFIELD_MCP_SIGN_IN_REQUIRED',401);acceptTokens(value);return tokens.access;
        }catch{if(tokens===captured){tokens=null;tools=[];phase='SIGN_IN_EXPIRED';}throw Object.assign(new Error('HIGGSFIELD_MCP_SIGN_IN_REQUIRED'),{code:'HIGGSFIELD_MCP_SIGN_IN_REQUIRED',status:401});}
        finally{refreshing=null;}
      })();
    }
    return refreshing;
  }
  async function exclusive(work){
    if(closed||busy)throw Object.assign(new Error('HIGGSFIELD_MCP_BUSY'),{code:'HIGGSFIELD_MCP_BUSY',status:409,requestMayHaveBeenSent:false});
    busy=true;lastError=null;const capturedEpoch=epoch;
    try{return await work();}catch(error){
      const code=error.code?.startsWith('HIGGSFIELD_MCP_')?error.code:'HIGGSFIELD_MCP_UNAVAILABLE';
      if(!closed&&capturedEpoch===epoch){
        lastError=code;
        if(code==='HIGGSFIELD_MCP_SIGN_IN_REQUIRED'){
          flow=null;tokens=null;tools=[];connectionId=null;phase='SIGN_IN_EXPIRED';transport.clearSession();
        }else if(code==='HIGGSFIELD_MCP_SESSION_EXPIRED'){
          tools=[];phase=tokens?'SIGNED_IN':'NOT_CONNECTED';transport.clearSession();
        }
      }
      throw Object.assign(new Error(code),{code,status:code==='HIGGSFIELD_MCP_SIGN_IN_REQUIRED'?401:[401,409,422,502].includes(error.status)?error.status:502,
        ...(typeof error.requestMayHaveBeenSent==='boolean'?{requestMayHaveBeenSent:error.requestMayHaveBeenSent}:{})});
    }
    finally{busy=false;}
  }
  return {
    setOrigin(value){const url=new URL(value);need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.origin===value,'HIGGSFIELD_MCP_CALLBACK_ORIGIN');origin=value;},
    status:observation,
    inspect:()=>exclusive(async()=>{await discover();return observation();}),
    startSignIn:()=>exclusive(async()=>{
      const capturedEpoch=epoch;
      need(origin,'HIGGSFIELD_MCP_CALLBACK_ORIGIN');need(!flow,'HIGGSFIELD_MCP_SIGN_IN_PENDING',409);
      await discover();const redirectUri=origin+'/api/higgsfield/mcp/callback';
      if(!registration){
        const value=await jsonRequest(metadata.registration_endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'CanIScreenwrite',redirect_uris:[redirectUri],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})});
        need(secret(value.client_id)&&value.token_endpoint_auth_method==='none'&&Array.isArray(value.redirect_uris)&&value.redirect_uris.includes(redirectUri)&&!value.client_secret,'HIGGSFIELD_MCP_REGISTRATION_FORMAT',502);
        registration={clientId:value.client_id,redirectUri};
      }
      need(!closed&&epoch===capturedEpoch,'HIGGSFIELD_MCP_SIGN_IN_CANCELLED',409);
      tokens=null;tools=[];connectionId=null;transport.clearSession();
      const verifier=crypto.randomBytes(48).toString('base64url'),state=crypto.randomBytes(32).toString('base64url');
      const url=new URL(metadata.authorization_endpoint);url.search=new URLSearchParams({client_id:registration.clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email offline_access',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:RESOURCE}).toString();
      flow={state,verifier,authorizationUrl:url.href,expiresAt:now()+10*60000};phase='AWAITING_SIGN_IN';return observation();
    }),
    async callback(params){
      const attempt=flow;
      need(attempt&&currentFlow(attempt)&&params.getAll('state').length===1&&equal(params.get('state'),attempt.state),'HIGGSFIELD_MCP_CALLBACK_REJECTED',409);
      need(params.getAll('code').length<=1&&params.getAll('error').length<=1&&(!params.has('iss')||params.get('iss')===ISSUER),'HIGGSFIELD_MCP_CALLBACK_REJECTED',409);
      need(phase==='AWAITING_SIGN_IN','HIGGSFIELD_MCP_CALLBACK_REJECTED',409);
      phase='COMPLETING_SIGN_IN';
      if(params.has('error')){flow=null;phase='SIGN_IN_CANCELLED';return observation();}
      try{
        need(secret(params.get('code')),'HIGGSFIELD_MCP_CALLBACK_REJECTED',409);
        const value=await jsonRequest(metadata.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.clientId,redirect_uri:registration.redirectUri,code:params.get('code'),code_verifier:attempt.verifier,resource:RESOURCE}).toString()});
        need(currentFlow(attempt),'HIGGSFIELD_MCP_CALLBACK_REJECTED',409);acceptTokens(value);connectionId=crypto.randomUUID();flow=null;phase='SIGNED_IN';return observation();
      }catch(error){if(flow===attempt){flow=null;phase='SIGN_IN_FAILED';tokens=null;}throw Object.assign(new Error('HIGGSFIELD_MCP_SIGN_IN_FAILED'),{code:'HIGGSFIELD_MCP_SIGN_IN_FAILED',status:502});}
    },
    async disconnect(){epoch++;flow=null;tokens=null;tools=[];connectionId=null;phase='NOT_CONNECTED';lastError=null;for(const controller of controllers)controller.abort();transport.clearSession();return observation();},
    tools:()=>exclusive(async()=>{
      const capturedEpoch=epoch;need(tokens,'HIGGSFIELD_MCP_SIGN_IN_REQUIRED',401);await transport.initialize();
      const all=[],cursors=new Set();let cursor;
      do{const page=await transport.listTools(cursor?{cursor}:{});all.push(...page.tools);need(all.length<=500,'HIGGSFIELD_MCP_TOOL_LIMIT',502);cursor=page.nextCursor;if(cursor){need(!cursors.has(cursor)&&cursors.size<20,'HIGGSFIELD_MCP_CURSOR_LOOP',502);cursors.add(cursor);}}while(cursor);
      need(!closed&&epoch===capturedEpoch&&tokens,'HIGGSFIELD_MCP_SIGN_IN_REQUIRED',401);
      need(new Set(all.map(tool=>tool.name)).size===all.length,'HIGGSFIELD_MCP_TOOL_DUPLICATE',502);tools=all;phase='CONNECTED';checkedAt=new Date(now()).toISOString();return observation();
    }),
    read:input=>exclusive(async()=>{
      need(object(input)&&Object.keys(input).sort().join(',')==='action,arguments'&&object(input.arguments),'HIGGSFIELD_MCP_READ_INPUT',422);
      const action=available().find(row=>row.action===input.action);need(action,'HIGGSFIELD_MCP_ACTION_NOT_AVAILABLE',409);
      need(Buffer.byteLength(JSON.stringify(input.arguments))<=32768,'HIGGSFIELD_MCP_READ_INPUT',422);
      referenceReadArguments(input.action,input.arguments);
      const result=await transport.callTool(action.toolName,input.arguments);
      return{schemaVersion:'caniscreenwrite-higgsfield-mcp-read/v1',action:action.action,toolName:action.toolName,observedAt:new Date(now()).toISOString(),result};
    }),
    // Private server capability. HTTP never accepts an arbitrary production tool
    // name or provider arguments; only the saved-task runner can call this method.
    productionSession(){
      need(!closed&&connectionId&&tokens&&phase==='CONNECTED','HIGGSFIELD_MCP_SIGN_IN_REQUIRED',401);
      return {connectionId,tools:structuredClone(tools)};
    },
    productionCall(action,args,expectedConnectionId){return exclusive(async()=>{
      try {
      need(!closed&&connectionId&&tokens&&phase==='CONNECTED'&&expectedConnectionId===connectionId,'HIGGSFIELD_MCP_SIGN_IN_REQUIRED',401);
      need(productionActions.has(action)&&object(args),'HIGGSFIELD_MCP_ACTION_NOT_AVAILABLE',409);
      referenceReadArguments(action,args);
      } catch(error) { throw Object.assign(error,{requestMayHaveBeenSent:false}); }
      const matches=tools.filter(tool=>tool.name===action||tool.name===`higgsfield_${action}`);
      if(matches.length!==1)throw Object.assign(new Error('HIGGSFIELD_MCP_ACTION_NOT_AVAILABLE'),{code:'HIGGSFIELD_MCP_ACTION_NOT_AVAILABLE',status:409,requestMayHaveBeenSent:false});
      const result=await transport.callTool(matches[0].name,args);
      if(closed||connectionId!==expectedConnectionId)throw Object.assign(new Error('HIGGSFIELD_MCP_ABORTED'),{code:'HIGGSFIELD_MCP_ABORTED',requestMayHaveBeenSent:true});
      return result;
    });},
    // Separate capability for the durable reference runner. Neither read nor
    // productionCall can reach the write action on this mixed provider tool.
    referenceCreateCall(args,expectedConnectionId){return exclusive(async()=>{
      let matches;
      try {
        need(!closed&&connectionId&&tokens&&phase==='CONNECTED'&&expectedConnectionId===connectionId,'HIGGSFIELD_MCP_SIGN_IN_REQUIRED',401);
        validateReferenceCreateArguments(args);
        matches=tools.filter(tool=>tool.name==='show_reference_elements'||tool.name==='higgsfield_show_reference_elements');
        need(matches.length===1,'HIGGSFIELD_MCP_ACTION_NOT_AVAILABLE',409);
      } catch(error) { throw Object.assign(error,{requestMayHaveBeenSent:false}); }
      const result=await transport.callTool(matches[0].name,args);
      if(closed||connectionId!==expectedConnectionId)throw Object.assign(new Error('HIGGSFIELD_MCP_ABORTED'),{code:'HIGGSFIELD_MCP_ABORTED',requestMayHaveBeenSent:true});
      return result;
    });},
    async close(){closed=true;flow=null;tokens=null;tools=[];connectionId=null;for(const controller of controllers)controller.abort();await transport.close();},
  };
}
