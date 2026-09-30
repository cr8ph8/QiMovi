import { useEffect, useRef, useState } from 'react';
import { resolveApi, type ResolveApi, type ResolveProject, type ResolveStatus, type ResolveTimeline } from './resolveApi';
import './resolve-connection.css';

const stateLabels: Record<ResolveStatus['state'], string> = { NOT_CHECKED: 'Not checked', NOT_INSTALLED: 'Resolve not found', RUNTIME_UNAVAILABLE: 'Python unavailable', CONNECTED: 'Connected for inspection', BLOCKED: 'Resolve access unavailable', ERROR: 'Connection failed' };

export default function ResolveConnectionPanel({ disabled = false, api = resolveApi }: { disabled?: boolean; api?: ResolveApi }) {
  const [connection, setConnection] = useState<ResolveStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [project, setProject] = useState<ResolveProject | null>(null), [selected, setSelected] = useState(''), [timeline, setTimeline] = useState<ResolveTimeline | null>(null), [projectObservedAt, setProjectObservedAt] = useState(''), [timelineObservedAt, setTimelineObservedAt] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const connected = connection?.state === 'CONNECTED';
  async function perform(action: 'check' | 'project' | 'timeline') {
    if (disabled || busy) return;
    setBusy(true); setError('');
    // Previous observations must not look current while a new check is pending or fails.
    setTimeline(null); setTimelineObservedAt('');
    if (action !== 'timeline') { setProject(null); setSelected(''); setProjectObservedAt(''); }
    try {
      if (action === 'check') {
        setConnection(null);
        const result = await api.discover();
        if (alive.current) setConnection(result);
      } else {
        if (!connected || action === 'timeline' && (!project || !selected)) throw new Error('Check Resolve and read its project first.');
        const result = await api.inspect(action === 'project' ? { scope: 'project' } : { scope: 'timeline', expectedProjectId: project!.id, expectedTimelineId: selected });
        if (!alive.current) return;
        if (action === 'project') {
          const observed = result.result.project as ResolveProject;
          setProject(observed); setProjectObservedAt(result.observedAt);
          setSelected(observed.currentTimeline?.id ?? '');
        } else { setTimeline(result.result.timeline ?? null); setTimelineObservedAt(result.observedAt); }
      }
    } catch (caught) { if (alive.current) { setError(caught instanceof Error ? caught.message : 'Resolve could not be inspected.'); setConnection(previous => previous ? { ...previous, state: 'ERROR', resolveAvailable: false } : null); setProject(null); setSelected(''); } }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="resolve-connection" aria-label="DaVinci Resolve MCP">
    <div className="resolve-title"><div><h3>DaVinci Resolve MCP</h3><p>Read the open Resolve project and its timelines through QiMovi’s local connection.</p></div><span className="resolve-state" data-connected={connected}>{busy ? 'Checking…' : connection ? stateLabels[connection.state] : 'Not checked'}</span></div>
    <div className="resolve-actions"><button className="secondary" disabled={disabled || busy} onClick={() => void perform('check')}>Check Resolve connection</button><button className="secondary" disabled={disabled || busy || !connected} onClick={() => void perform('project')}>Read open project</button></div>
    {connection && <div className="resolve-observation" role="status"><p>{connection.installed.found ? `${connection.installed.productName ?? 'DaVinci Resolve'} ${connection.installed.version ?? ''} installed.` : 'Install DaVinci Resolve to use this connection.'} {connection.mcpReady ? 'QiMovi MCP bridge responds.' : 'MCP bridge has not connected.'}</p>{connection.reason && <p>{connection.reason}</p>}{connection.checkedAt && <small>Connection checked {new Date(connection.checkedAt).toLocaleString()}</small>}</div>}
    {!connected && <p className="resolve-setup">Open Resolve and a project, then check the connection. Where supported, enable <strong>Preferences → System → General → External scripting using → Local</strong>. Scripting access depends on your Resolve edition and version.</p>}
    {project && <div className="resolve-project"><h4>Open in Resolve: {project.name}</h4><p>{project.timelineCount} timelines · observed {new Date(projectObservedAt).toLocaleString()}</p><fieldset disabled={disabled || busy}><legend>Project timelines</legend>{project.timelines.length ? project.timelines.map(row => <label key={row.id}><input type="radio" name="resolve-timeline" disabled={row.id !== project.currentTimeline?.id} checked={selected === row.id} onChange={() => { setSelected(row.id); setTimeline(null); }}/>{row.name}{row.id === project.currentTimeline?.id ? ' · current' : ''}</label>) : <p>No timelines in the open project.</p>}</fieldset><small>Inspection reads the current timeline. To inspect another, open it in Resolve and read the project again.</small>{project.timelinesTruncated && <p>Only the first timelines are listed. The project contains more.</p>}<button className="secondary" disabled={disabled || busy || !selected} onClick={() => void perform('timeline')}>Read current timeline</button></div>}
    {timeline && <div className="resolve-timeline"><h4>{timeline.name}</h4><small>Timeline observed {new Date(timelineObservedAt).toLocaleString()}</small><p>{timeline.width} × {timeline.height} · {timeline.frameRate} fps · starts {timeline.startTimecode}</p><table><thead><tr><th>Track</th><th>Clips</th><th>Observed media</th></tr></thead><tbody>{timeline.tracks.map(track => <tr key={`${track.type}:${track.index}`}><th>{track.type} {track.index} · {track.name}</th><td>{track.itemCount}</td><td>{track.items.map(item => item.name).join(' · ') || 'Empty'}{track.itemsTruncated ? ' · more clips not listed' : ''}</td></tr>)}</tbody></table>{timeline.tracksTruncated && <p>Additional tracks are outside this inspection.</p>}</div>}
    {error && <p role="alert">{error}</p>}
    <div className="resolve-scope"><strong>Available: connection check · project inspection · timeline inspection</strong><span>Assembly, grading, rendering and round-trip import are not enabled. Prepare the same sequence as an editor package in this workspace; importing it remains a separate step.</span></div>
  </section>;
}
