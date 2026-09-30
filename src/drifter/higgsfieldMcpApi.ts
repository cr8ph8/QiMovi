export const MCP_PHASES=['NOT_CONNECTED','AWAITING_SIGN_IN','COMPLETING_SIGN_IN','SIGNED_IN','CONNECTED','SIGN_IN_EXPIRED','SIGN_IN_CANCELLED','SIGN_IN_FAILED'] as const;
export interface McpReadAction {action:string;title:string;toolName:string;inputSchema:Record<string,unknown>}
export interface HiggsfieldMcpStatus {
  schemaVersion:'caniscreenwrite-higgsfield-mcp/v1';phase:typeof MCP_PHASES[number];endpoint:'https://mcp.higgsfield.ai/mcp';
  checkedAt:string|null;authenticated:boolean;toolCount:number;readActions:McpReadAction[];executionEnabled:false;
  authorizationUrl?:string;expiresAt?:string;error?:string;credentialPersistence:'SESSION_ONLY';
}
export interface McpReadResult {schemaVersion:'caniscreenwrite-higgsfield-mcp-read/v1';action:string;toolName:string;observedAt:string;result:Record<string,unknown>}
export interface HiggsfieldMcpApi {
  status(signal?:AbortSignal):Promise<HiggsfieldMcpStatus>;inspect():Promise<HiggsfieldMcpStatus>;
  signIn():Promise<HiggsfieldMcpStatus>;disconnect():Promise<HiggsfieldMcpStatus>;tools():Promise<HiggsfieldMcpStatus>;
  read(action:string,args:Record<string,unknown>):Promise<McpReadResult>;
}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
function need(value:unknown):asserts value {if(!value)throw Error('The direct Higgsfield connection returned an unexpected response.');}
function status(value:unknown):HiggsfieldMcpStatus {
  need(object(value)&&value.schemaVersion==='caniscreenwrite-higgsfield-mcp/v1'&&MCP_PHASES.includes(value.phase as HiggsfieldMcpStatus['phase'])&&value.endpoint==='https://mcp.higgsfield.ai/mcp'&&value.executionEnabled===false&&value.credentialPersistence==='SESSION_ONLY');
  need(typeof value.authenticated==='boolean'&&Number.isSafeInteger(value.toolCount)&&Number(value.toolCount)>=0&&Number(value.toolCount)<=500);
  need(value.checkedAt===null||typeof value.checkedAt==='string'&&Number.isFinite(Date.parse(value.checkedAt)));
  need(Array.isArray(value.readActions)&&value.readActions.length<=100&&value.readActions.every(action=>object(action)&&typeof action.action==='string'&&/^[a-z0-9_]+$/.test(action.action)&&typeof action.title==='string'&&action.title.length<=200&&typeof action.toolName==='string'&&/^[a-zA-Z0-9_.-]+$/.test(action.toolName)&&object(action.inputSchema)));
  need(new Set(value.readActions.map(action=>action.action)).size===value.readActions.length);
  if(value.authorizationUrl!==undefined){need(typeof value.authorizationUrl==='string');const url=new URL(value.authorizationUrl);need(url.origin==='https://clerk.higgsfield.ai'&&url.pathname==='/oauth/authorize'&&!url.username&&!url.password&&typeof value.expiresAt==='string'&&Number.isFinite(Date.parse(value.expiresAt)));}
  need(value.error===undefined||typeof value.error==='string'&&/^HIGGSFIELD_MCP_[A-Z_]+$/.test(value.error));
  return value as unknown as HiggsfieldMcpStatus;
}
async function call(route:string,input?:object,signal?:AbortSignal){
  const response=await fetch(`/api/higgsfield/mcp${route}`,{credentials:'same-origin',redirect:'error',signal,...(input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});
  const value:unknown=await response.json().catch(()=>null);
  if(!response.ok)throw Error(response.status===401?'Sign in to the local workspace and connect Higgsfield again.':response.status===409?'The connection or selected tool changed. Refresh before retrying.':'Higgsfield did not confirm this connection request. Retry explicitly when ready.');
  return value;
}
export const higgsfieldMcpApi:HiggsfieldMcpApi={status:async signal=>status(await call('',undefined,signal)),inspect:async()=>status(await call('/inspect',{})),signIn:async()=>status(await call('/sign-in',{})),disconnect:async()=>status(await call('/disconnect',{})),tools:async()=>status(await call('/tools',{})),
  async read(action,args){const value=await call('/read',{action,arguments:args});need(object(value)&&value.schemaVersion==='caniscreenwrite-higgsfield-mcp-read/v1'&&value.action===action&&typeof value.toolName==='string'&&typeof value.observedAt==='string'&&Number.isFinite(Date.parse(value.observedAt))&&object(value.result));return value as unknown as McpReadResult;},
};
