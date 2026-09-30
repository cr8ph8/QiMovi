import { useEffect, useRef, useState } from 'react';
import { modelAssistanceApi, type ModelStatus } from './modelAssistanceApi';
import { nodeWorkflowApi } from './nodeWorkflowApi';
import type { ConnectorDescriptor } from './nodeWorkflowModel';
import type { Project, WorkspaceApi, WorkspaceRecord } from './types';
import HiggsfieldTools from './HiggsfieldTools';
import HiggsfieldDesktopConnection from './HiggsfieldDesktopConnection';
import UsageAccountingPanel from './UsageAccountingPanel';
import './assistant.css';

export default function ModelConnectionsPanel({ open, project, sceneId, onClose, onAssistant, onGeneration, onNodes, onOpenDcc, records, workspaceApi, onSaved }: {
  open: boolean; project: Project; sceneId: string; onClose: () => void; onAssistant: () => void; onGeneration: () => void; onNodes: () => void; onOpenDcc?: () => void; records?: WorkspaceRecord[]; workspaceApi?: WorkspaceApi; onSaved?: (record: WorkspaceRecord) => void;
}) {
  const [text, setText] = useState<ModelStatus | null>(null), [connectors, setConnectors] = useState<ConnectorDescriptor[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [area, setArea] = useState<'connections' | 'higgsfield' | 'usage'>('connections');
  const higgsfieldOpen = area === 'higgsfield';
  const scope = `${project.id}:${project.sourceHash}:${sceneId}`, current = useRef(scope), serial = useRef(0); current.current = scope;
  useEffect(() => {
    if (!open) return;
    const index = ++serial.current, controller = new AbortController(); setBusy(true); setError('');
    const scene = project.scenes.find(row => row.id === sceneId);
    if (!scene) { setError('Choose a scene to prepare generation.'); setBusy(false); return; }
    void Promise.all([modelAssistanceApi.status(), nodeWorkflowApi.load(project, scene, controller.signal)]).then(([models, nodes]) => {
      if (controller.signal.aborted || current.current !== scope || index !== serial.current) return; setText(models); setConnectors(nodes.connectors);
    }).catch(e => { if (current.current === scope && index === serial.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : 'Model connections could not be read.'); }).finally(() => { if (index === serial.current) setBusy(false); });
    return () => controller.abort();
  }, [open, project, sceneId, scope]);
  async function checkLocalVideo() {
    const captured = scope, index = ++serial.current; setBusy(true); setError('');
    try { const updated = await nodeWorkflowApi.checkConnector('comfyui'); if (current.current === captured && index === serial.current) setConnectors(prior => [...prior.filter(row => row.id !== updated.id), updated]); }
    catch (e) { if (current.current === captured && index === serial.current) setError(e instanceof Error ? e.message : 'The local video runtime could not be checked.'); }
    finally { if (index === serial.current) setBusy(false); }
  }
  const comfy = connectors.find(row => row.id === 'comfyui');
  const localModels = (comfy as (ConnectorDescriptor & { observation?: { models?: { kind: string; name: string }[] } }) | undefined)?.observation?.models ?? [];
  return <section className={`assistant-panel model-connections${higgsfieldOpen ? ' models-higgsfield-open' : ''}`} aria-label="Models and connections" hidden={!open}>
    <header><div><span className="eyebrow">QIMOVI</span><h2>Models & connections</h2></div><button aria-label="Close model connections" onClick={onClose}>×</button></header>
    <div className="model-area-switch" aria-label="Model connection areas"><div><button aria-pressed={higgsfieldOpen} onClick={() => setArea('higgsfield')}>Higgsfield tools</button><button aria-pressed={area === 'connections'} onClick={() => setArea('connections')}>Other connections</button><button aria-pressed={area === 'usage'} onClick={() => setArea('usage')}>Usage & cost</button></div>{higgsfieldOpen && <button className="model-open-clip" onClick={onGeneration}>Open saved clip</button>}</div>
    <HiggsfieldTools open={open && higgsfieldOpen} project={project} records={records} workspaceApi={workspaceApi} onSaved={onSaved} onOpenDcc={onOpenDcc}/>
    <UsageAccountingPanel key={`${project.id}:${project.sourceHash}`} open={open && area === 'usage'} project={project} onSaved={onSaved}/>
    <div className="model-other-connections" hidden={area !== 'connections'}>
      <HiggsfieldDesktopConnection open={open && area === 'connections'}/>
      <div className="connection-row"><div><h3>Qwen · local assistance</h3><p>Story, continuity, casting and prompt refinement.</p><small>{text?.status === 'AVAILABLE' ? `${text.models.length} installed models available` : text?.status === 'UNCONFIGURED' ? 'Ollama connection needed' : text?.status === 'UNAVAILABLE' ? 'Local runtime unavailable' : 'Checking…'}</small>{Boolean(text?.models.length) && <details><summary>Installed text models</summary>{text?.models.map(row => <span className="connection-model" key={row.digest}>{row.name}</span>)}</details>}</div><button onClick={onAssistant}>Open assistant</button></div>
      <div className="connection-row"><div><h3>Dreamina · Seedance</h3><p>Export the saved prompt, opening frame and references; return the generated footage.</p><small>Manual generation handoff</small></div><button onClick={onGeneration}>Prepare video</button></div>
      <div className="connection-row"><div><h3>ComfyUI · local image & video</h3><p>Check the installed runtime, node catalog and queue.</p><small>{comfy?.status === 'AVAILABLE' ? 'Runtime discovered · workflow execution not qualified' : comfy?.status === 'UNAVAILABLE' ? 'No usable local runtime found' : 'Runtime not checked'}</small>{comfy?.origin && <span className="connection-model">{comfy.origin}</span>}</div><button disabled={busy} onClick={() => void checkLocalVideo()}>{busy ? 'Checking…' : 'Check local runtime'}</button></div>
      {comfy?.status === 'UNAVAILABLE' && <p className="connection-next">Start ComfyUI on the displayed local address, then check again. Model downloads and installation are separate setup tasks.</p>}
      {localModels.length > 0 && <details><summary>Local model files reported by ComfyUI ({localModels.length})</summary>{localModels.map(row => <p key={`${row.kind}:${row.name}`}><strong>{row.kind}</strong> · {row.name}</p>)}<p>File names establish availability, not a tested generation workflow.</p></details>}
      <section className="connection-row" aria-label="Camera and node integrations"><div><h3>Camera & node integrations</h3><p>Inspect Blender, Unity and Houdini planning connections and their exact saved inputs.</p><small>Codex connector access is separate from desktop credentials. Adapters require validated inputs, job recovery and media intake.</small></div><button onClick={onNodes}>Open scene nodes</button></section>
    </div>
    {error && <p role="alert" className="error-text">{error}</p>}
  </section>;
}
