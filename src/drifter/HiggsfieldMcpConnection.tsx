import { useEffect,useRef,useState } from 'react';
import { higgsfieldMcpApi,type HiggsfieldMcpApi,type HiggsfieldMcpStatus,type McpReadResult } from './higgsfieldMcpApi';
const labels:Record<HiggsfieldMcpStatus['phase'],string>={NOT_CONNECTED:'Connect this app to Higgsfield',AWAITING_SIGN_IN:'Finish sign-in in your browser',COMPLETING_SIGN_IN:'Completing sign-in…',SIGNED_IN:'Signed in · ready to discover tools',CONNECTED:'Direct MCP connection verified',SIGN_IN_EXPIRED:'Sign in again to continue',SIGN_IN_CANCELLED:'Sign-in cancelled',SIGN_IN_FAILED:'Sign-in was not completed'};
export default function HiggsfieldMcpConnection({open,api=higgsfieldMcpApi}:{open:boolean;api?:HiggsfieldMcpApi}){
  const [value,setValue]=useState<HiggsfieldMcpStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[action,setAction]=useState(''),[args,setArgs]=useState('{}'),[result,setResult]=useState<McpReadResult|null>(null);
  const alive=useRef(true),serial=useRef(0),inFlight=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const pending=value?.phase==='AWAITING_SIGN_IN'||value?.phase==='COMPLETING_SIGN_IN';
  useEffect(()=>{
    if(!open||busy)return;
    const controller=new AbortController(),attempt=serial.current;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const state=await api.status(controller.signal);if(controller.signal.aborted||attempt!==serial.current)return;setValue(state);if(['AWAITING_SIGN_IN','COMPLETING_SIGN_IN'].includes(state.phase))timer=setTimeout(()=>void poll(),2000);}catch(e){if(!controller.signal.aborted&&attempt===serial.current)setError(e instanceof Error?e.message:'Connection unavailable.');}};
    void poll();return()=>{controller.abort();clearTimeout(timer);};
  },[open,api,busy,pending]);
  async function run(kind:'inspect'|'signIn'|'disconnect'|'tools'|'read'){
    if(inFlight.current)return;
    let parsed:Record<string,unknown>={};
    if(kind==='read'){try{const raw=JSON.parse(args);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error();parsed=raw;}catch{setError('Enter parameters as a JSON object.');return;}}
    inFlight.current=true;setBusy(true);setError('');const attempt=++serial.current;
    setResult(null);
    if(kind==='disconnect'||kind==='signIn')setAction('');
    try{
      if(kind==='read'){const read=await api.read(selected?.action??'',parsed);if(alive.current&&attempt===serial.current)setResult(read);}
      else{const state=await api[kind]();if(alive.current&&attempt===serial.current){setValue(state);if(kind==='tools')setAction(previous=>state.readActions.some(row=>row.action===previous)?previous:state.readActions[0]?.action??'');}}
    }catch(e){if(alive.current&&attempt===serial.current)setError(e instanceof Error?e.message:'Connection unavailable.');}
    finally{inFlight.current=false;if(alive.current&&attempt===serial.current)setBusy(false);}
  }
  const selected=value?.readActions.find(row=>row.action===action)??value?.readActions[0];
  return <section className="hf-desktop-connection" aria-label="Direct Higgsfield MCP connection" hidden={!open}>
    <header className="hf-desktop-heading"><div><h3>Connect Higgsfield directly</h3><p>Use the provider’s MCP service from this desktop app.</p><strong role="status">{value?labels[value.phase]:'Reading connection…'}</strong></div><button disabled={busy} onClick={()=>void run('inspect')}>Check service</button></header>
    <div className="hf-desktop-account"><div><p>Higgsfield sign-in stays in this app session. Original media stays local until an upload is explicitly requested.</p>{value?.checkedAt&&<small>Checked {new Date(value.checkedAt).toLocaleString()}</small>}</div><div className="hf-desktop-auth-actions">{pending?<button disabled={busy} onClick={()=>void run('disconnect')}>Cancel sign-in</button>:value?.authenticated?<><button disabled={busy} onClick={()=>void run('tools')}>{busy?'Reading…':'Discover connected tools'}</button><button disabled={busy} onClick={()=>void run('disconnect')}>Disconnect this app</button></>:<button className="hf-desktop-primary" disabled={busy} onClick={()=>void run('signIn')}>{busy?'Preparing sign-in…':'Connect to Higgsfield'}</button>}</div></div>
    {pending&&value?.authorizationUrl&&<div className="hf-mcp-sign-in"><a className="hf-desktop-primary" href={value.authorizationUrl} target="_blank" rel="noreferrer">Continue to Higgsfield sign-in ↗</a><p>Return here after signing in. This request expires at {new Date(value.expiresAt!).toLocaleTimeString()}.</p></div>}
    {value?.phase==='CONNECTED'&&<div className="hf-mcp-discovery"><p>{value.toolCount} tools reported by this connection · {value.readActions.length} read actions available here.</p><div className="hf-desktop-toolbar"><label>What do you need?<select value={selected?.action??''} disabled={busy} onChange={event=>{setAction(event.target.value);setArgs('{}');setResult(null);}}>{value.readActions.map(row=><option key={row.action} value={row.action}>{row.title}</option>)}</select></label><button disabled={busy||!selected} onClick={()=>void run('read')}>{busy?'Reading…':'Read from Higgsfield'}</button></div><details><summary>Filters and selected identifiers</summary><label>Parameters<textarea aria-label="MCP read parameters" rows={5} value={args} disabled={busy} onChange={event=>{setArgs(event.target.value);setResult(null);}}/></label>{selected&&<pre>{JSON.stringify(selected.inputSchema,null,2)}</pre>}</details>{result&&<div className="hf-mcp-result" role="status"><strong>{value.readActions.find(row=>row.action===result.action)?.title??result.action}</strong><p>Received {new Date(result.observedAt).toLocaleTimeString()}</p><pre>{JSON.stringify(result.result,null,2)}</pre></div>}</div>}
    {error&&<p role="alert" className="hf-desktop-error">{error}</p>}
    <details className="hf-desktop-setup"><summary>Connection scope</summary><p>CanIScreenwrite uses its own browser sign-in and the provider’s live tool schemas. Closing or disconnecting clears this session’s credentials. Generation, uploads, workspace changes and other mutations still require their dedicated execution flows; this panel only discovers and reads.</p></details>
  </section>;
}
