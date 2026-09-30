import { useEffect, useRef, useState } from 'react';
import { higgsfieldDesktopApi, type HiggsfieldDesktopApi, type HiggsfieldDesktopObservation as Observation, type HiggsfieldDesktopResource as Resource, type HiggsfieldDesktopStatus, type HiggsfieldAuthStatus } from './higgsfieldDesktopApi';
import './higgsfield-desktop.css';
import HiggsfieldMcpConnection from './HiggsfieldMcpConnection';

const labels: Record<Resource, string> = { models: 'Image, video & sound models', workflows: 'Editing workflows', voices: 'Voice library', 'animation-actions': 'Character movements' };
const states: Record<HiggsfieldDesktopStatus, string> = { NOT_INSTALLED: 'Local adapter needs setup', LOCAL_CLI_FOUND: 'Local adapter found · version not checked', LOCAL_CLI_DETECTED: 'Local adapter version checked', VERSION_UNRECOGNIZED: 'Local version needs review', LOCAL_CLI_UNAVAILABLE: 'Local adapter unavailable', BUNDLED_RUNTIME_INVALID: 'Bundled adapter needs repair', DISCOVERY_AVAILABLE: 'Live catalog received', DISCOVERY_FORMAT_UNRECOGNIZED: 'Catalog format needs an adapter update', DISCOVERY_UNAVAILABLE: 'Catalog unavailable' };
const accounts: Record<HiggsfieldAuthStatus, string> = { NOT_CHECKED: 'Account access not checked', SIGN_IN_REQUIRED: 'Sign in to connect your account', NEEDS_WORKSPACE: 'Choose a Higgsfield workspace', CONNECTED: 'Account access verified', UNAVAILABLE: 'Account check unavailable', SIGNING_IN: 'Waiting for browser sign-in', SIGN_IN_CANCELLED: 'Sign-in cancelled', SIGN_IN_FAILED: 'Sign-in was not completed', SIGN_IN_TIMED_OUT: 'Sign-in timed out' };
type Action = 'check'|'discover'|'account'|'sign-in'|'cancel'|'workspaces'|'select-workspace';
export default function HiggsfieldDesktopConnection({open,desktopApi}:{open:boolean;desktopApi?:HiggsfieldDesktopApi}) {
  const [route,setRoute]=useState<'mcp'|'cli'>('mcp');
  return <div hidden={!open}><nav className="hf-connection-routes" aria-label="Higgsfield connection method"><button aria-pressed={route==='mcp'} onClick={()=>setRoute('mcp')}>Direct MCP</button><button aria-pressed={route==='cli'} onClick={()=>setRoute('cli')}>CLI adapter</button></nav><HiggsfieldMcpConnection open={open&&route==='mcp'}/><HiggsfieldCliConnection open={open&&route==='cli'} desktopApi={desktopApi}/></div>;
}
export function HiggsfieldCliConnection({ open, desktopApi = higgsfieldDesktopApi }: { open: boolean; desktopApi?: HiggsfieldDesktopApi }) {
  const [value, setValue] = useState<Observation | null>(null), [resource, setResource] = useState<Resource>('models');
  const [catalogs, setCatalogs] = useState<Partial<Record<Resource, Observation>>>({});
  const [queries, setQueries] = useState<Partial<Record<Resource, string>>>({}), [selected, setSelected] = useState<Partial<Record<Resource, string>>>({});
  const [workspaces, setWorkspaces] = useState<Observation['workspaces']>(), [workspaceId,setWorkspaceId] = useState('');
  const [busy, setBusy] = useState<Action|null>(null), [error, setError] = useState('');
  const serial = useRef(0), mounted = useRef(true), inFlight = useRef(false);
  const auth = value?.authentication?.status ?? 'NOT_CHECKED', signingIn = auth === 'SIGNING_IN';
  useEffect(() => { mounted.current = true; serial.current++; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open || inFlight.current) return;
    const controller = new AbortController(), attempt = serial.current;
    void desktopApi.status(controller.signal).then(result => { if (attempt === serial.current && !controller.signal.aborted) { setValue(result); setError(''); } }).catch(e => { if (attempt === serial.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : 'The local connection could not be checked.'); });
    return () => controller.abort();
  }, [open, desktopApi]);
  useEffect(() => {
    if (!open || !signingIn || busy) return;
    const controller = new AbortController(), attempt = serial.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await desktopApi.status(controller.signal); if (controller.signal.aborted || attempt !== serial.current) return; setValue(result); if (result.authentication?.status === 'SIGNING_IN') timer = setTimeout(() => void poll(), 2000); }
      catch (e) { if (!controller.signal.aborted && attempt === serial.current) setError(e instanceof Error ? e.message : 'Sign-in status could not be checked. Use Check account to retry.'); }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, signingIn, busy, desktopApi]);
  async function inspect(kind: Action) {
    if (inFlight.current) return;
    if (kind === 'select-workspace' && !workspaces?.some(item => item.id === workspaceId)) return;
    if (kind === 'sign-in') { setWorkspaces(undefined); setWorkspaceId(''); setCatalogs({}); }
    const attempt = ++serial.current, requested = resource; inFlight.current = true; setBusy(kind); setError('');
    try {
      const result = await (kind === 'check' ? desktopApi.check() : kind === 'account' ? desktopApi.checkAccount() : kind === 'sign-in' ? desktopApi.signIn() : kind === 'cancel' ? desktopApi.cancelSignIn() : kind === 'workspaces' ? desktopApi.workspaces() : kind === 'select-workspace' ? desktopApi.selectWorkspace(workspaceId) : desktopApi.discover(requested));
      if (mounted.current && attempt === serial.current) {
        setValue(result);
        if (kind === 'select-workspace' && result.selectedWorkspaceId !== value?.selectedWorkspaceId) setCatalogs({});
        if (result.workspaces) { setWorkspaces(result.workspaces); setWorkspaceId(previous => result.workspaces!.some(item => item.id === previous) ? previous : ''); }
        if (kind === 'discover' && result.status === 'DISCOVERY_AVAILABLE' && result.resource === requested) setCatalogs(previous => ({ ...previous, [requested]: result }));
      }
    } catch (e) { if (mounted.current && attempt === serial.current) setError(e instanceof Error ? e.message : 'The connection could not be checked.'); }
    finally { inFlight.current = false; if (mounted.current && attempt === serial.current) setBusy(null); }
  }
  const catalog = catalogs[resource], query = queries[resource] ?? '', term = query.trim().toLocaleLowerCase();
  const items = catalog?.items?.filter(item => `${item.name} ${item.id} ${item.outputType ?? ''} ${item.description ?? ''}`.toLocaleLowerCase().includes(term)) ?? [];
  const selection = items.find(item => item.id === selected[resource]);
  const adapterAvailable = Boolean(value && !['NOT_INSTALLED','LOCAL_CLI_UNAVAILABLE','BUNDLED_RUNTIME_INVALID'].includes(value.status));
  const canAuthenticate = adapterAvailable && Boolean(value?.cliVersion && value.authentication);
  const canSignIn = canAuthenticate && value?.runtimeQualified === true;
  const canDiscover = adapterAvailable && Boolean(value?.resources.includes(resource));
  return <section className="hf-desktop-connection" aria-label="Higgsfield connection" hidden={!open}>
    <header className="hf-desktop-heading"><div><h3>Higgsfield connection</h3><p>Connect your account on this Mac and browse creative tools.</p><strong role="status">{value ? states[value.status] : 'Local adapter not checked'}{value?.cliVersion ? ` · v${value.cliVersion}` : ''}</strong></div><button disabled={Boolean(busy) || signingIn} onClick={() => void inspect('check')}>{busy === 'check' ? 'Checking…' : 'Check connection'}</button></header>
    <div className="hf-desktop-account"><div><strong role="status">{auth === 'CONNECTED' && !value?.accountVerified ? 'Account access not verified' : accounts[auth]}</strong><p>{signingIn ? 'Complete sign-in in the browser. This panel checks its status while visible.' : 'Browser sign-in connects the local adapter. It does not submit generation.'}</p>{value?.selectedWorkspaceId && <p>Current Higgsfield workspace: {value.workspaces?.find(item => item.id === value.selectedWorkspaceId)?.name ?? value.selectedWorkspaceId}</p>}</div><div className="hf-desktop-auth-actions">{signingIn ? <button disabled={Boolean(busy)} onClick={() => void inspect('cancel')}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel sign-in'}</button> : <>{!value?.accountVerified && <button className="hf-desktop-primary" disabled={Boolean(busy) || !canSignIn} onClick={() => void inspect('sign-in')}>{busy === 'sign-in' ? 'Opening sign-in…' : 'Sign in to Higgsfield'}</button>}<button disabled={Boolean(busy) || !canAuthenticate} onClick={() => void inspect('account')}>{busy === 'account' ? 'Checking account…' : 'Check account'}</button></>}</div></div>
    {value?.cliVersion && value.runtimeQualified === false && <p className="hf-desktop-guidance">Adapter needs update. Use the verified desktop adapter before starting browser sign-in.</p>}
    {(auth === 'NEEDS_WORKSPACE' || workspaces) && <div className="hf-desktop-workspaces"><p>Choose the Higgsfield billing workspace for this desktop connection. It is separate from your local creative project; choosing it does not submit or pay for generation.</p><button disabled={Boolean(busy) || signingIn || !adapterAvailable} onClick={() => void inspect('workspaces')}>{busy === 'workspaces' ? 'Reading workspaces…' : 'Load Higgsfield workspaces'}</button>{workspaces && <div><label>Higgsfield workspace<select disabled={Boolean(busy) || signingIn} value={workspaceId} onChange={event => setWorkspaceId(event.target.value)}><option value="">Choose explicitly…</option>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button disabled={Boolean(busy) || signingIn || !workspaceId} onClick={() => void inspect('select-workspace')}>{busy === 'select-workspace' ? 'Selecting…' : 'Use this Higgsfield workspace'}</button>{!workspaces.length && <p>No workspaces were returned for this account.</p>}</div>}</div>}
    {value?.status === 'NOT_INSTALLED' && <p className="hf-desktop-guidance">Set up the official Higgsfield CLI on this Mac, then check again.</p>}
    {value?.status === 'BUNDLED_RUNTIME_INVALID' && <p className="hf-desktop-guidance">The bundled adapter could not be verified. Repair the desktop installation before connecting.</p>}
    {value?.status === 'DISCOVERY_UNAVAILABLE' && <p className="hf-desktop-guidance">The catalog request did not confirm access. Check your account and availability before retrying. Earlier results stay below.</p>}
    <div className="hf-desktop-toolbar"><label>Browse<select disabled={Boolean(busy) || signingIn} value={resource} onChange={event => setResource(event.target.value as Resource)}>{Object.entries(labels).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label><button disabled={Boolean(busy) || signingIn || !canDiscover} onClick={() => void inspect('discover')}>{busy === 'discover' ? 'Reading catalog…' : catalog ? 'Refresh live catalog' : 'Read live catalog'}</button></div>
    {catalog ? <div className="hf-desktop-results" aria-label={`${labels[resource]} results`}>
      <div className="hf-desktop-results-heading"><span>{catalog.items?.length ?? 0} entries received{catalog.checkedAt ? ` · ${new Date(catalog.checkedAt).toLocaleString()}` : ''}</span><label>Search received catalog<input type="search" value={query} onChange={event => setQueries(previous => ({ ...previous,[resource]:event.target.value }))}/></label></div>
      <div className="hf-desktop-browser"><div className="hf-desktop-list">{items.slice(0,100).map(item => <button key={item.id} aria-pressed={selection?.id === item.id} onClick={() => setSelected(previous => ({ ...previous,[resource]:item.id }))}><strong>{item.name}</strong>{item.outputType && <span>{item.outputType}</span>}</button>)}{!items.length && <p>{catalog.items?.length ? 'No received entries match this search.' : 'The catalog returned no entries.'}</p>}{items.length > 100 && <p>Showing 100 of {items.length} matching entries. Narrow the search to find an item.</p>}</div><div className="hf-desktop-detail">{selection ? <><h4>{selection.name}</h4><p>{selection.description || 'No description was returned for this item.'}</p><dl><dt>Identifier</dt><dd>{selection.id}</dd>{selection.outputType && <><dt>Output</dt><dd>{selection.outputType}</dd></>}</dl></> : <p>Select an entry to read its details.</p>}</div></div>
      <details className="hf-desktop-evidence"><summary>Catalog source & scope</summary><p>This is the page returned by the local Higgsfield adapter. It does not establish complete account coverage, a generation result or production permission.</p>{catalog.observationSha256 && <code>{catalog.observationSha256}</code>}<p>Results stay here while switching views. Refresh explicitly to request current availability.</p></details>
    </div> : <p className="hf-desktop-empty">Choose a catalog to read its available models, voices or workflows.</p>}
    <details className="hf-desktop-setup"><summary>Connection details</summary><p>The desktop uses its own Higgsfield CLI installation and sign-in. Codex connector access is separate. Cancelling stops only the sign-in started here; it does not sign you out. Generation submission is not enabled.</p></details>
    {error && <p role="alert" className="hf-desktop-error">{error}</p>}
  </section>;
}
