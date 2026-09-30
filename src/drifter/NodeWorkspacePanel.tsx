import { NODE_WORKFLOW_LIMITS, isNodeChoice, nodeOutputBindingRefs } from '../../local/contracts/node-workflow.mjs';
import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, Maximize, Save, RefreshCw, Link2, X, ArrowUpRight, Workflow } from 'lucide-react';
import { canonicalJson } from './canonical';
import { nodeWorkflowApi, type NodeWorkflowApi } from './nodeWorkflowApi';
import { canvasPoint, connectionReason, connectorStatus, edgePath, fitGraph, NODE_WIDTH, nodeHeight, nodePosition, nodeReadinessLabel, removeGraphNode, socketPoint, type NodeDefinition, type NodeEndpoint, type NodeValidation, type NodeViewport, type NodeWorkflowCatalog, type NodeWorkflowData, type NodeWorkflowRecord, type NodeWorkStep, type WorkflowGraph, type WorkflowNode } from './nodeWorkflowModel';
import type { CastingDraft, ContextBundle, GenerationBrief, LoreSource, Project, Scene, WorkspaceRecord } from './types';
import type { NodeBinding, NodeRecordRequest } from './nodeWorkflowModel';
import type { MediaTakeData, TakeReviewData } from './mediaTakeTypes';
import { validateRecord } from './validation';
import { verifyNodeRequestedRecord } from './nodeRecordRequests';
import { downloadDreamina } from './dreaminaApi';
import { downloadLocalBlob } from './localDownload';
import ShotSequenceCanvas from './ShotSequenceCanvas';
import NodeWorkflowSteps from './NodeWorkflowSteps';
import './node-workspace.css';

type Draft = { data: NodeWorkflowData; baseline: NodeWorkflowRecord | null; initial: string };
type Selection = { kind: 'node' | 'edge'; id: string } | null;
const message = (error: unknown) => error instanceof Error ? error.message : 'The local node workspace did not confirm this action.';
const dirtyDraft = (draft?: Draft) => Boolean(draft && canonicalJson(draft.data) !== draft.initial);
const endpointKey = (point: NodeEndpoint) => `${point.nodeId}|${point.portId}`;
const parseEndpoint = (key: string): NodeEndpoint => { const [nodeId, portId] = key.split('|'); return { nodeId, portId }; };
const reviewIdentity = (record: WorkspaceRecord | null | undefined) => record ? `${record.id}:${record.version}:${record.sha256}` : 'new';
const validationFeedback = (value: NodeValidation) => value.valid ? 'Connections checked. This is a planning graph; external execution remains separate.' : `${value.issues.length} planning issues need attention.`;
function comparisonText(record?: WorkspaceRecord) {
  if (!record) return '';
  if (record.kind === 'generation-brief') { const data = record.data as GenerationBrief; return `Prompt\n${data.prompt || '(Blank — starter is prepared separately)'}\n\nModel: ${data.settings.model || 'Unconfirmed'}\nDuration: ${data.settings.durationMs === null ? 'Untimed' : `${data.settings.durationMs / 1000} s`}\nShots: ${data.shotIds.join(', ')}`; }
  if (record.kind === 'casting-draft') { const data = record.data as CastingDraft; return `Performer: ${data.performer || 'Unassigned'}\nUse scope: ${data.useScope}\nReference images: ${data.referenceHashes.length}\n\n${data.notes}`; }
  if (record.kind === 'context-bundle') { const data = record.data as ContextBundle; return [data.guidance, ...data.loreSelections.map(item => item.excerpt), ...data.noteSelections.map(item => item.excerpt)].filter(Boolean).join('\n\n'); }
  if (record.kind === 'lore-source') { const data = record.data as LoreSource; return `${data.originalFilename}\n${data.extraction ? `${data.extraction.pageCount} pages` : 'Image reference'}\nSource SHA: ${data.original.sha256}\nProject research · no canon admission`; }
  return '';
}

export default function NodeWorkspacePanel({ project, records, sceneId, open, onScene, onSaved, onDirty, onOpenTool, onOpenShot, onPrepareShot, initialView = 'workflow', graphApi = nodeWorkflowApi }: {
  project: Project; records: WorkspaceRecord[]; sceneId: string; open: boolean; onScene(id: string): void; onSaved(record: WorkspaceRecord): void; onDirty?(value: boolean): void;
  onOpenTool(tool: string, sceneId: string, request?: NodeRecordRequest): void; graphApi?: NodeWorkflowApi; initialView?: 'storyboard' | 'workflow'; onPrepareShot?:(sceneId: string, shotId: string) => void; onOpenShot?:(sceneId: string, shotId: string, cellId?: string) => void;
}) {
  const [nodeView, setNodeView] = useState<'storyboard' | 'workflow'>(initialView);
  const scene = project.scenes.find(item => item.id === sceneId) ?? project.scenes[0];
  const scope = `${project.id}:${project.sourceHash}:${scene?.id}`;
  const [catalogs, setCatalogs] = useState<Record<string, NodeWorkflowCatalog>>({}), [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selection, setSelection] = useState<Selection>(null), [libraryOpen, setLibraryOpen] = useState(false), [libraryQuery, setLibraryQuery] = useState('');
  const [viewport, setViewport] = useState<NodeViewport>({ x: 35, y: 35, zoom: .7 });
  const [output, setOutput] = useState(''), [input, setInput] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | 'validate' | 'check' | 'export' | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [actionChoices, setActionChoices] = useState<Record<string, string>>({});
  const [takeReviews, setTakeReviews] = useState<Record<string, { status: string; note: string; measurement: string }>>({});
  const [comparisonRecords, setComparisonRecords] = useState<Record<string, WorkspaceRecord>>({});
  const [validation, setValidation] = useState<{ scope: string; fingerprint: string; recordsFingerprint: string; value: NodeValidation } | null>(null);
  const svg = useRef<SVGSVGElement>(null), alive = useRef(true), currentScope = useRef(scope), loadController = useRef<AbortController>(), loadSerial = useRef(0);
  const attempts = useRef<Record<string, { fingerprint: string; requestId: string }>>({});
  const drag = useRef<{ kind: 'node' | 'pan'; nodeId?: string; start: { x: number; y: number }; position: { x: number; y: number }; zoom: number }>();
  currentScope.current = scope;
  const latestRecordsRef = useRef(records); latestRecordsRef.current = records;
  const currentOpen = useRef(open); currentOpen.current = open;
  const catalog = catalogs[scope], draft = drafts[scope], graph = draft?.data.graph;
  const dirty = dirtyDraft(draft), anyDirty = Object.values(drafts).some(dirtyDraft), conflict = Boolean(draft && catalog && reviewIdentity(draft.baseline) !== reviewIdentity(catalog.record));
  const unsavedScenes = project.scenes.filter(item => dirtyDraft(drafts[`${project.id}:${project.sourceHash}:${item.id}`]));
  const unsavedSceneIds = new Set(unsavedScenes.map(item => item.id));
  const definitions = catalog?.library ?? [], node = selection?.kind === 'node' ? graph?.nodes.find(item => item.id === selection.id) : undefined;
  const definition = definitions.find(item => item.type === node?.type), selectedEdge = selection?.kind === 'edge' ? graph?.edges.find(item => item.id === selection.id) : undefined;
  const connector = catalog?.connectors.find(item => item.id === node?.connectorId);
  const latestRecords = records.map(record => `${record.id}:${record.version}:${record.sha256}`).join('|');
  const validationCurrent = Boolean(graph && validation?.scope === scope && validation.fingerprint === canonicalJson(graph) && validation.recordsFingerprint === latestRecords && validation.value.sourceHash === project.sourceHash && validation.value.sceneId === scene?.id);
  const current = (captured: string) => alive.current && currentScope.current === captured;

  useEffect(() => {
    if (!open || nodeView !== 'workflow') return;
    let active = true;
    setComparisonRecords({});
    void Promise.all(records.filter(item => ['casting-draft', 'context-bundle', 'generation-brief', 'lore-source'].includes(item.kind)).map(async record => {
      try {
        if ((record.data as { sourceHash?: string }).sourceHash !== project.sourceHash) return null;
        await validateRecord(record);
        return [`${record.id}:${record.sha256}`, record] as readonly [string, WorkspaceRecord];
      } catch { return null; }
    })).then(entries => { if (active) setComparisonRecords(Object.fromEntries(entries.filter((item): item is readonly [string, WorkspaceRecord] => Boolean(item)))); });
    void Promise.all(records.filter(item => item.kind === 'measured-media-take').map(async take => {
      const key = `${take.id}:${take.sha256}`;
      try {
        await validateRecord(take, project);
        const data = take.data as MediaTakeData;
        const matching = records.filter(item => item.kind === 'take-review' && (item.data as TakeReviewData).takeRef?.id === take.id && (item.data as TakeReviewData).takeRef?.sha256 === take.sha256);
        if (matching.length > 1) throw new Error('Ambiguous review');
        const review = matching[0]; if (review) await validateRecord(review, project);
        const decision = (review?.data as TakeReviewData | undefined)?.decision;
        return [key, { status: review ? `${decision === 'KEEP_CANDIDATE' ? 'Selected candidate' : decision === 'REJECT' ? 'Set aside' : 'Awaiting review'} · owner review v${review.version}` : 'No owner review saved', note: (review?.data as TakeReviewData | undefined)?.note ?? '', measurement: `${data.measurement.durationMs / 1000} s · ${data.measurement.width} × ${data.measurement.height}` }] as const;
      } catch { return [key, { status: 'Saved take or review could not be verified', note: '', measurement: '' }] as const; }
    })).then(entries => { if (active) setTakeReviews(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [records, project, open, nodeView]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; loadController.current?.abort(); }; }, []);
  useEffect(() => { onDirty?.(anyDirty); }, [anyDirty, onDirty]);
  useEffect(() => { if (!anyDirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [anyDirty]);
  useEffect(() => {
    setSelection(null); setOutput(''); setInput(''); setValidation(null); setNotice('');
  }, [open, scope, graphApi]);
  useEffect(() => {
    if (open && nodeView === 'workflow' && scene) void load();
    else { loadController.current?.abort(); loadSerial.current++; setBusy(previous => previous === 'load' ? null : previous); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeView, scope, latestRecords, graphApi]);
  async function load() {
    if (!scene) return;
    loadController.current?.abort(); const controller = new AbortController(); loadController.current = controller;
    const serial = ++loadSerial.current, captured = scope; setBusy('load'); setError(''); setValidation(null);
    setNotice(previous => validation && previous === validationFeedback(validation.value) ? '' : previous);
    try {
      const saved = await graphApi.load(project, scene, controller.signal);
      if (!current(captured) || controller.signal.aborted || loadSerial.current !== serial) return;
      setCatalogs(previous => ({ ...previous, [captured]: saved }));
      setDrafts(previous => {
        if (dirtyDraft(previous[captured])) return previous;
        const data: NodeWorkflowData = saved.record?.data ?? { schemaVersion: 1, sourceHash: project.sourceHash, sceneId: scene.id, title: `Scene ${scene.index} workflow`, status: 'DRAFT', graph: saved.graph };
        return { ...previous, [captured]: { data: structuredClone(data), baseline: saved.record, initial: canonicalJson(data) } };
      });
      if (!drafts[captured]) setViewport(fitGraph(saved.graph, saved.library, svg.current?.clientWidth || 850, svg.current?.clientHeight || 530));
    } catch (caught) { if (current(captured) && !controller.signal.aborted) setError(`${message(caught)} Your open graph edits are retained.`); }
    finally { if (current(captured) && loadSerial.current === serial) setBusy(null); }
  }
  function editGraph(update: (graph: WorkflowGraph) => WorkflowGraph) {
    if (!draft || busy) return;
    setDrafts(previous => ({ ...previous, [scope]: { ...previous[scope], data: { ...previous[scope].data, graph: update(previous[scope].data.graph) } } })); setNotice(''); setError('');
  }
  function updateNode(id: string, patch: Partial<WorkflowNode>) { editGraph(value => ({ ...value, nodes: value.nodes.map(item => item.id === id ? { ...item, ...patch } : item) })); }
  function addNode(item: NodeDefinition, connectorId: string | null = null) {
    if (!graph || busy || graph.nodes.length >= NODE_WORKFLOW_LIMITS.nodes) return;
    const id = `n-${crypto.randomUUID()}`, center = canvasPoint({ x: (svg.current?.clientWidth || 850) / 2 - 90, y: (svg.current?.clientHeight || 530) / 2 - 50 }, viewport);
    const title = connectorId ? catalog?.connectors.find(value => value.id === connectorId)?.label ?? item.label : item.label;
    editGraph(value => ({ ...value, nodes: [...value.nodes, { id, type: item.type, label: title, position: nodePosition(center), bindingRefs: [], connectorId, selectedNodeId: null }] }));
    setSelection({ kind: 'node', id }); setLibraryOpen(false);
  }
  function connect(fromKey = output, toKey = input) {
    if (!graph || !fromKey || !toKey || busy) return;
    const from = parseEndpoint(fromKey), to = parseEndpoint(toKey), reason = connectionReason(graph, definitions, from, to);
    if (reason) { setError(reason); return; }
    const id = `e-${crypto.randomUUID()}`;
    editGraph(value => ({ ...value, edges: [...value.edges, { id, from, to }] })); setSelection({ kind: 'edge', id }); setOutput(''); setInput(''); setNotice('Connection added to the plan. Validate the graph to check its saved inputs.');
  }
  async function save() {
    if (!draft || !scene || busy || conflict || !draft.data.title.trim()) return;
    const captured = scope, data = structuredClone(draft.data), expected = draft.baseline?.version ?? null;
    const fingerprint = canonicalJson({ data, expected });
    if (attempts.current[captured]?.fingerprint !== fingerprint) attempts.current[captured] = { fingerprint, requestId: crypto.randomUUID() };
    setBusy('save'); setError(''); setNotice('');
    try {
      const record = await graphApi.save(project, scene, data, expected, attempts.current[captured].requestId);
      if (!current(captured)) return;
      setDrafts(previous => ({ ...previous, [captured]: { data: structuredClone(record.data), baseline: record, initial: canonicalJson(record.data) } }));
      setCatalogs(previous => ({ ...previous, [captured]: { ...previous[captured], record, graph: record.data.graph } }));
      onSaved(record); setNotice(`Workflow saved · v${record.version}. Source records remain separate.`);
    } catch (caught) { if (current(captured)) setError(`${message(caught)} Graph edits are retained. Retry the same save or refresh to inspect a newer version.`); }
    finally { if (current(captured)) setBusy(null); }
  }
  async function validate() {
    if (!graph || !scene || busy) return;
    const captured = scope, capturedGraph = structuredClone(graph), fingerprint = canonicalJson(capturedGraph), recordsSerial = loadSerial.current; setBusy('validate'); setError(''); setNotice('');
    try { const value = await graphApi.validate(project, scene, capturedGraph); if (current(captured) && recordsSerial === loadSerial.current) { setValidation({ scope: captured, fingerprint, recordsFingerprint: latestRecords, value }); setNotice(validationFeedback(value)); } }
    catch (caught) { if (current(captured)) setError(message(caught)); }
    finally { if (current(captured)) setBusy(null); }
  }
  async function checkConnections() {
    if (!catalog || busy) return;
    const captured = scope, ids = node?.connectorId ? [node.connectorId] : [...new Set(graph?.nodes.flatMap(item => item.connectorId ? [item.connectorId] : []) ?? [])];
    if (!ids.length) { setNotice('Choose a software node to check its real connector.'); return; }
    setBusy('check'); setError(''); setNotice(''); setValidation(null);
    try {
      const checked = await Promise.all(ids.map(id => graphApi.checkConnector(id)));
      if (current(captured)) { setCatalogs(previous => ({ ...previous, [captured]: { ...previous[captured], connectors: previous[captured].connectors.map(item => checked.find(value => value.id === item.id) ?? item) } })); setNotice('Connector observations refreshed. No software run was submitted.'); }
    } catch (caught) { if (current(captured)) setError(message(caught)); }
    finally { if (current(captured)) setBusy(null); }
  }
  function beginDrag(event: React.PointerEvent<SVGElement>, target?: WorkflowNode) {
    if (busy || event.button !== 0 || (event.target as Element).closest('[data-port]')) return;
    event.preventDefault(); event.stopPropagation();
    if (target) setSelection({ kind: 'node', id: target.id });
    drag.current = { kind: target ? 'node' : 'pan', nodeId: target?.id, start: { x: event.clientX, y: event.clientY }, position: target?.position ?? { x: viewport.x, y: viewport.y }, zoom: viewport.zoom };
    svg.current?.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event: React.PointerEvent<SVGSVGElement>) {
    const moving = drag.current; if (!moving || busy) return;
    const dx = event.clientX - moving.start.x, dy = event.clientY - moving.start.y;
    if (moving.kind === 'pan') setViewport(previous => ({ ...previous, x: moving.position.x + dx, y: moving.position.y + dy }));
    else updateNode(moving.nodeId!, { position: nodePosition({ x: moving.position.x + dx / moving.zoom, y: moving.position.y + dy / moving.zoom }) });
  }
  function zoom(amount: number) { setViewport(previous => { const zoom = Math.max(.3, Math.min(1.6, Math.round((previous.zoom + amount) * 100) / 100)); const center = { x: (svg.current?.clientWidth || 850) / 2, y: (svg.current?.clientHeight || 530) / 2 }; const point = canvasPoint(center, previous); return { x: center.x - point.x * zoom, y: center.y - point.y * zoom, zoom }; }); }
  const options = graph?.nodes.flatMap(item => { const type = definitions.find(value => value.type === item.type); return [{ node: item, inputs: type?.inputs ?? [], outputs: type?.outputs ?? [] }]; }) ?? [];
  const bindingCandidates = catalog?.bindings.filter(binding => definition?.bindingKinds.includes(binding.kind)) ?? [];
  const selectedPlan = validationCurrent ? validation?.value.plan.find(item => item.nodeId === node?.id) : undefined;
  const actionRefs = graph && node ? nodeOutputBindingRefs(graph, node.id) : [];
  const actionCandidates = actionRefs.map(ref => catalog?.bindings.find(binding => binding.id === ref.id && binding.sha256 === ref.sha256)).filter((item): item is NodeBinding => Boolean(item));
  const choiceKey = node ? `${scope}:${node.id}` : '';
  const actionBinding = actionRefs.length === 1 && actionCandidates.length === 1 ? actionCandidates[0] : actionCandidates.find(item => `${item.id}:${item.sha256}` === actionChoices[choiceKey]);
  const makeRequest = (binding: NodeBinding, intent: NodeRecordRequest['intent'] = 'OPEN_RECORD'): NodeRecordRequest => ({ nonce: crypto.randomUUID(), projectId: project.id, sourceHash: project.sourceHash, sceneId: scene.id, recordRef: { id: binding.id, sha256: binding.sha256, kind: binding.kind }, intent });
  const toolFor = (binding: NodeBinding) => ({ 'generation-brief': 'generation', 'measured-media-take': 'takes', 'casting-draft': 'casting', 'seed-character': 'casting', 'context-bundle': 'context', 'lore-source': 'lore' })[binding.kind] ?? definition?.openTool;
  function openExactBinding(binding: NodeBinding) {
    const tool = toolFor(binding);
    if (busy || binding.status !== 'CURRENT' || !tool) return;
    onOpenTool(tool, scene.id, makeRequest(binding));
  }
  async function exportBrief(binding: NodeBinding) {
    if (busy || binding.kind !== 'generation-brief' || binding.status !== 'CURRENT') return;
    const captured = scope, request = makeRequest(binding);
    setBusy('export'); setError(''); setNotice('');
    try {
      const selected = latestRecordsRef.current.find(item => item.id === binding.id && item.sha256 === binding.sha256);
      await verifyNodeRequestedRecord(request, project, scene, selected, 'OPEN_RECORD', 'generation-brief');
      const blob = await downloadDreamina(selected!);
      if (!current(captured) || !currentOpen.current) return;
      await verifyNodeRequestedRecord(request, project, scene, latestRecordsRef.current.find(item => item.id === binding.id && item.sha256 === binding.sha256), 'OPEN_RECORD', 'generation-brief');
      downloadLocalBlob(blob, `drifter-dreamina-scene-${scene.index}-v${selected!.version}.zip`);
      setNotice('Save requested for the exact saved brief. Complete the Save dialog; no generation was submitted.');
    } catch (caught) { if (current(captured)) setError(message(caught)); }
    finally { if (current(captured)) setBusy(null); }
  }
  function continueStep(step: NodeWorkStep) {
    if (busy || conflict || !validationCurrent || !graph || !catalog) return;
    setSelection({ kind: 'node', id: step.nodeId });
    const selected = graph.nodes.find(item => item.id === step.nodeId);
    if (!selected) return;
    const refs = nodeOutputBindingRefs(graph, step.nodeId);
    const bindings = refs.map(ref => catalog.bindings.find(item => item.id === ref.id && item.sha256 === ref.sha256 && item.status === 'CURRENT'));
    // Inspect a missing/stale binding or branch in place; never substitute a newer
    // record, choose among several records, or turn upstream trouble into a run.
    if (step.nextAction.tool === null || step.readiness === 'WAITING_ON_UPSTREAM' || step.readiness === 'CONNECTOR_UNAVAILABLE' || refs.length !== bindings.filter(Boolean).length || refs.length > 1 || isNodeChoice(selected.type)) {
      setNotice(`${step.label}: ${step.nextAction.reason} Review the selected node's inputs and choices.`); return;
    }
    const binding = bindings[0];
    const exactTools: Record<string, string> = { 'generation-brief': 'generation', 'measured-media-take': 'takes', 'casting-draft': 'casting', 'context-bundle': 'context', 'lore-source': 'lore', 'screenplay-draft': 'writing' };
    const exactTool = binding && exactTools[binding.kind];
    if (binding && exactTool) {
      if (binding.kind === 'screenplay-draft' && project.creativeOrigin) {
        setNotice('This project’s writer opens separately. Review this exact draft in writing history before handing it to production; the workflow has kept its saved reference.'); return;
      }
      if (!latestRecordsRef.current.some(record => record.id === binding.id && record.sha256 === binding.sha256 && record.kind === binding.kind)) {
        setNotice('That saved input changed. Refresh the workflow and choose its exact revision.'); return;
      }
      onOpenTool(exactTool, scene.id, makeRequest(binding)); return;
    }
    // Frozen source and seed objects are project inputs, not workspace records.
    // Their existing editor receives scene context without a fictitious record ID.
    const tool = step.nextAction.tool;
    if (tool) onOpenTool(tool, scene.id);
    else setNotice(`${step.label}: ${step.nextAction.reason}`);
  }
  function exportCheckedPlan() {
    if (busy || !validationCurrent || !validation || !draft?.baseline || dirty || conflict) return;
    const snapshot = { schemaVersion: 'qimovi-checked-workflow/v1', projectId: project.id, sourceHash: project.sourceHash, sceneId: scene.id,
      graphRef: { id: draft.baseline.id, version: draft.baseline.version, sha256: draft.baseline.sha256 },
      capturedAt: new Date().toISOString(), graph: draft.data.graph, check: validation.value, executionAuthorized: false };
    downloadLocalBlob(new Blob([JSON.stringify(snapshot, null, 2) + '\n'], { type: 'application/json' }), `qimovi-workflow-scene-${scene.index}-v${draft.baseline.version}.json`);
    setNotice('Save requested for the checked plan. It records this version and its inputs; future changes require a new check.');
  }
  const comparisonBranches = graph && node && isNodeChoice(node.type) ? graph.edges.filter(edge => edge.to.nodeId === node.id).map(edge => graph.nodes.find(item => item.id === edge.from.nodeId)!).filter(Boolean) : [];
  const incomingReturnRefs = graph && node?.type === 'takes' ? graph.edges.filter(edge => edge.to.nodeId === node.id && edge.to.portId === 'proposed').flatMap(edge => nodeOutputBindingRefs(graph, edge.from.nodeId)).filter(ref => ref.id.startsWith('generation-brief:')) : [];
  const uniqueReturnRefs = [...new Map(incomingReturnRefs.map(ref => [`${ref.id}:${ref.sha256}`, ref])).values()];
  const returnCandidates = uniqueReturnRefs.map(ref => catalog?.bindings.find(item => item.id === ref.id && item.sha256 === ref.sha256)).filter((item): item is NodeBinding => Boolean(item));
  const returnBinding = uniqueReturnRefs.length === 1 && returnCandidates.length === 1 ? returnCandidates[0] : returnCandidates.find(item => `${item.id}:${item.sha256}` === actionChoices[`${choiceKey}:return`]);
  if (!scene) return null;
  return <section className="node-workspace" hidden={!open} data-unsaved={anyDirty ? 'true' : 'false'} aria-label="Node workspace">
    <div className="nw-view-switch" role="tablist" aria-label="Node workflow view"><button role="tab" aria-selected={nodeView === 'storyboard'} disabled={Boolean(busy && busy !== 'load')} onClick={() => setNodeView('storyboard')}>Storyboard order</button><button role="tab" aria-selected={nodeView === 'workflow'} disabled={Boolean(busy && busy !== 'load')} onClick={() => setNodeView('workflow')}>Production connections{anyDirty ? ' · unsaved' : ''}</button></div>
    {unsavedScenes.length > 0 && <p className="nw-notice" aria-label="Scenes with unsaved workflows">Unsaved scene workflows: {unsavedScenes.map((item, index) => <span key={item.id}>{index > 0 ? ', ' : ''}<button className="text-link" disabled={Boolean(busy)} title={item.heading} aria-label={`Open unsaved workflow for scene ${item.index}`} onClick={() => { onScene(item.id); setNodeView('workflow'); }}>Scene {String(item.index).padStart(2, '0')}</button></span>)}. Open each scene to review and save its graph.</p>}
    <div hidden={nodeView !== 'storyboard'}><ShotSequenceCanvas project={project} records={records} sceneId={scene.id} open={open && nodeView === 'storyboard'} onScene={onScene} onOpenShot={onOpenShot} onPrepareShot={onPrepareShot} onOpenSceneWorkflow={id => { onScene(id); setNodeView('workflow'); }}/></div>
    <div hidden={nodeView !== 'workflow'}>
    <div className="nw-toolbar"><label>Scene<select aria-label="Node workflow scene" value={scene.id} disabled={Boolean(busy)} onChange={event => onScene(event.target.value)}>{project.scenes.map(item => <option key={item.id} value={item.id}>{String(item.index).padStart(2, '0')} · {item.heading}{unsavedSceneIds.has(item.id) ? ' · unsaved' : ''}</option>)}</select></label><div className="nw-toolbar-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => void checkConnections()}><RefreshCw size={14}/>Check connections</button><button className="secondary" disabled={Boolean(busy) || !graph} onClick={() => void validate()}>Validate plan</button><button className="primary" disabled={Boolean(busy) || !draft || conflict || !draft.data.title.trim() || !dirty && Boolean(draft.baseline)} onClick={() => void save()}><Save size={14}/>{busy === 'save' ? 'Saving…' : 'Save graph'}</button></div></div>
    {error && <p className="error-bar" role="alert">{error}</p>}{notice && <p className="nw-notice" role="status">{notice}</p>}
    {conflict && <div className="nw-conflict" role="alert"><p>A newer workflow is saved. Your open graph is retained.</p><button className="secondary" disabled={Boolean(busy)} onClick={() => setDrafts(previous => ({ ...previous, [scope]: { ...previous[scope], baseline: catalog?.record ?? null } }))}>Keep my graph against saved v{catalog?.record?.version}</button><button className="secondary" disabled={Boolean(busy)} onClick={() => { if (!catalog) return; const data = catalog.record?.data ?? { ...draft!.data, graph: catalog.graph }; setDrafts(previous => ({ ...previous, [scope]: { data: structuredClone(data), baseline: catalog.record, initial: canonicalJson(data) } })); }}>Discard edits and use saved graph</button></div>}
    <NodeWorkflowSteps check={validation?.value ?? null} current={validationCurrent && !conflict} saved={Boolean(draft?.baseline) && !dirty && !conflict} busy={Boolean(busy)} selectedId={selection?.kind === 'node' ? selection.id : undefined} onInspect={id => setSelection({ kind: 'node', id })} onContinue={continueStep} onExport={exportCheckedPlan}/>
    <div className="nw-desk"><div className="nw-canvas-wrap"><div className="nw-canvas-top"><div><span className="eyebrow">SCENE {String(scene.index).padStart(2, '0')} / WORKFLOW</span><strong>{draft?.data.title ?? 'Opening workflow…'}</strong><small>{dirty ? 'Unsaved graph' : draft?.baseline ? `Saved v${draft.baseline.version}` : 'Suggested graph · not saved'}</small></div><button className="nw-add" disabled={!graph || Boolean(busy)} onClick={() => setLibraryOpen(value => !value)} aria-expanded={libraryOpen}><Plus size={16}/>Add node</button></div>
      <svg ref={svg} className="nw-canvas" aria-label="Scene node canvas" onPointerMove={moveDrag} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} onWheel={event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoom(event.deltaY < 0 ? .1 : -.1); } }}>
        <defs><pattern id="nw-dot-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#34362f"/></pattern></defs><rect width="100%" height="100%" fill="url(#nw-dot-grid)" onPointerDown={event => beginDrag(event)}/>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {graph?.edges.map(edge => { const source = graph.nodes.find(item => item.id === edge.from.nodeId), target = graph.nodes.find(item => item.id === edge.to.nodeId); if (!source || !target) return null; const from = socketPoint(source, definitions.find(item => item.type === source.type), 'output', edge.from.portId), to = socketPoint(target, definitions.find(item => item.type === target.type), 'input', edge.to.portId); return <g key={edge.id} className={`nw-edge ${selection?.id === edge.id ? 'selected' : ''}`}><path d={edgePath(from, to)} className="nw-edge-line"/><path d={edgePath(from, to)} className="nw-edge-hit" role="button" tabIndex={0} aria-label={`Inspect connection ${source.label} ${edge.from.portId} to ${target.label} ${edge.to.portId}`} onClick={() => setSelection({ kind: 'edge', id: edge.id })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection({ kind: 'edge', id: edge.id }); } }}/></g>; })}
          {graph?.nodes.map(item => { const type = definitions.find(value => value.type === item.type), integration = catalog?.connectors.find(value => value.id === item.connectorId); const stale = item.bindingRefs.some(ref => !catalog?.bindings.some(binding => binding.id === ref.id && binding.sha256 === ref.sha256 && binding.status === 'CURRENT')); const status = stale ? 'Linked revision changed' : item.bindingRefs.length ? `${item.bindingRefs.length} saved inputs` : item.connectorId ? connectorStatus(integration) : 'No saved input selected'; return <g key={item.id} transform={`translate(${item.position.x} ${item.position.y})`} className={`nw-node ${selection?.id === item.id ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`Inspect node ${item.label}`} onPointerDown={event => beginDrag(event, item)} onClick={() => setSelection({ kind: 'node', id: item.id })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection({ kind: 'node', id: item.id }); } const move = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key]; if (move) { event.preventDefault(); updateNode(item.id, { position: nodePosition({ x: item.position.x + move[0], y: item.position.y + move[1] }) }); } }}><rect width={NODE_WIDTH} height={nodeHeight(type)} rx="7"/><rect className="nw-node-cap" width={NODE_WIDTH} height="43" rx="7"/><text x="14" y="25" className="nw-node-title">{item.label.length > 28 ? `${item.label.slice(0, 27)}…` : item.label}</text><text x="14" y={nodeHeight(type) - 12} className={`nw-node-status ${stale ? 'stale' : ''}`}>{status.length > 36 ? `${status.slice(0, 35)}…` : status}</text>{(['input', 'output'] as const).map(direction => (direction === 'input' ? type?.inputs : type?.outputs)?.map((port, index) => <g data-port="true" key={`${direction}:${port.id}`} transform={`translate(${direction === 'output' ? NODE_WIDTH : 0} ${69 + index * 27})`} className={`nw-port ${output === endpointKey({ nodeId: item.id, portId: port.id }) && direction === 'output' ? 'armed' : ''}`} role="button" tabIndex={0} aria-label={`${direction === 'output' ? 'Connect from' : 'Connect to'} ${item.label}: ${port.label}`} onClick={event => { event.stopPropagation(); setSelection({ kind: 'node', id: item.id }); const key = endpointKey({ nodeId: item.id, portId: port.id }); if (direction === 'output') { setOutput(key); setNotice(`Output selected: ${port.label}. Choose a compatible input socket.`); } else { setInput(key); if (output) connect(output, key); } }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); (event.currentTarget as unknown as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); } }}><circle r="5"/><text x={direction === 'output' ? -12 : 12} y="4" textAnchor={direction === 'output' ? 'end' : 'start'}>{port.label}</text></g>))}</g>; })}
        </g>
      </svg>
      {!graph && <div className="nw-loading"><Workflow size={32}/><p>{busy === 'load' ? 'Opening the saved scene workflow…' : 'The scene workflow is unavailable.'}</p><button className="secondary" disabled={Boolean(busy)} onClick={() => void load()}>Retry workflow</button></div>}
      {libraryOpen && <aside className="nw-library" aria-label="Node library"><div><h3>Add a node</h3><button aria-label="Close node library" onClick={() => setLibraryOpen(false)}><X size={17}/></button></div><input aria-label="Find a node" placeholder="Source, Blender, ComfyUI…" value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)}/>{definitions.map(item => { const presets = item.connectorIds.length ? item.connectorIds.map(id => ({ id, label: catalog?.connectors.find(value => value.id === id)?.label ?? id })) : [{ id: null, label: item.label }]; return presets.filter(preset => `${preset.label} ${item.label} ${item.description}`.toLowerCase().includes(libraryQuery.toLowerCase())).map(preset => <button key={`${item.type}:${preset.id}`} className="nw-library-item" disabled={Boolean(busy)} onClick={() => addNode(item, preset.id)}><strong>{preset.label}</strong><span>{item.description}</span></button>); })}</aside>}
      <div className="nw-canvas-bottom"><span>Drag nodes or empty canvas · select output, then input</span><div><button aria-label="Zoom out" onClick={() => zoom(-.1)}><Minus size={14}/></button><span>{Math.round(viewport.zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => zoom(.1)}><Plus size={14}/></button><button aria-label="Fit workflow" onClick={() => graph && setViewport(fitGraph(graph, definitions, svg.current?.clientWidth || 850, svg.current?.clientHeight || 530))}><Maximize size={14}/></button></div></div>
    </div><aside className="nw-inspector" aria-label="Node and connector inspector">
      <span className="eyebrow">{selectedEdge ? 'CONNECTION' : node ? 'NODE DETAILS' : 'WORKFLOW DETAILS'}</span>
      {node && definition ? <><h3>{node.label}</h3><p className="nw-description">{definition.description}</p><label>Node name<input aria-label="Node name" maxLength={120} value={node.label} disabled={Boolean(busy)} onChange={event => updateNode(node.id, { label: event.target.value })}/></label>
        {definition.connectorIds.length > 0 && <label>Software<select aria-label="Node software connector" value={node.connectorId ?? ''} disabled={Boolean(busy)} onChange={event => updateNode(node.id, { connectorId: event.target.value || null })}><option value="">Choose connector</option>{definition.connectorIds.map(id => <option key={id} value={id}>{catalog?.connectors.find(item => item.id === id)?.label ?? id}</option>)}</select></label>}
        {connector && <section className="nw-connector"><h4>{connector.label}</h4><strong>{connectorStatus(connector)}</strong><p>{connector.reason}</p>{connector.origin && <small>{connector.origin}</small>}<small>{connector.checkedAt ? `Checked ${new Date(connector.checkedAt).toLocaleString()}` : 'No live service observation retained'}</small><button className="secondary" disabled={Boolean(busy)} onClick={() => void checkConnections()}>Check this connector</button><ul>{connector.capabilities.map(capability => <li key={capability.id}><b>{capability.label}</b><small>{capability.effect === 'READ_ONLY' ? 'Read-only observation' : 'Local preparation only'}</small></li>)}</ul><p className="nw-scope">External execution is not authorized by this graph.</p></section>}
        {(definition.inputs.length > 0 || definition.outputs.length > 0) && <section className="nw-port-explanation"><h4>What flows through</h4>{definition.inputs.map(port => <p key={`in:${port.id}`}><span>IN · {port.label}</span><small>{port.dataType} · {port.required ? 'required' : 'optional'}{port.multiple ? ' · multiple links' : ''}</small></p>)}{definition.outputs.map(port => <p key={`out:${port.id}`}><span>OUT · {port.label}</span><small>{port.dataType}</small></p>)}</section>}
        {definition.bindingKinds.length > 0 && <fieldset className="nw-bindings" disabled={Boolean(busy)}><legend>Exact saved inputs</legend>{bindingCandidates.map(binding => <label key={`${binding.id}:${binding.sha256}`}><input type="checkbox" aria-label={`Bind ${binding.label}`} checked={node.bindingRefs.some(ref => ref.id === binding.id && ref.sha256 === binding.sha256)} onChange={event => updateNode(node.id, { bindingRefs: event.target.checked ? [...node.bindingRefs.filter(ref => ref.id !== binding.id), { id: binding.id, sha256: binding.sha256 }] : node.bindingRefs.filter(ref => ref.id !== binding.id || ref.sha256 !== binding.sha256) })}/><span>{binding.label}<small>{binding.status === 'CURRENT' ? 'Current saved revision' : 'Earlier revision'} · {binding.summary}</small></span></label>)}{!bindingCandidates.length && <p>No matching saved inputs in this scene.</p>}{node.bindingRefs.filter(ref => !bindingCandidates.some(binding => binding.id === ref.id && binding.sha256 === ref.sha256)).map(ref => <div className="nw-stale-binding" key={`${ref.id}:${ref.sha256}`}><p>Linked version changed or missing: {ref.id}</p><button className="secondary" onClick={() => updateNode(node.id, { bindingRefs: node.bindingRefs.filter(item => item.id !== ref.id || item.sha256 !== ref.sha256) })}>Remove earlier link</button></div>)}</fieldset>}
        {isNodeChoice(node.type) && <>
          <label>Planned preferred branch<select aria-label="Planned preferred branch" value={node.selectedNodeId ?? ''} disabled={Boolean(busy)} onChange={event => updateNode(node.id, { selectedNodeId: event.target.value || null })}><option value="">No preference</option>{comparisonBranches.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>Planning preference only. Casting, source, prompt text and owner reviews are unchanged.</small></label>
          <section className="nw-branch-comparison" aria-label="Compare saved branches">{comparisonBranches.map(branch => <div key={branch.id}>
            <h4>{branch.label}{node.selectedNodeId === branch.id ? ' · Planned preference' : ''}</h4>
            {nodeOutputBindingRefs(graph!, branch.id).map(ref => {
              const key = `${ref.id}:${ref.sha256}`, binding = catalog?.bindings.find(item => item.id === ref.id && item.sha256 === ref.sha256), review = takeReviews[key], retained = comparisonRecords[key], text = comparisonText(retained);
              return <div key={key}>
                <p>{binding?.label ?? ref.id}<small>{binding?.status === 'CURRENT' ? 'Current saved revision' : 'Linked revision needs review'} · {ref.sha256.slice(0, 12)}</small></p>
                {text && <details open><summary>Saved content · v{retained.version}</summary><pre className="nw-comparison-text">{text}</pre></details>}
                {binding?.kind === 'measured-media-take' && <p className="nw-review-fact">{review?.status ?? 'Checking saved review…'}<small>{review?.measurement}</small>{review?.note && <small>{review.note}</small>}</p>}
                {binding && toolFor(binding) && <button className="secondary" disabled={Boolean(busy) || binding.status !== 'CURRENT'} onClick={() => openExactBinding(binding)}>Open {binding.label}</button>}
              </div>;
            })}
            {!nodeOutputBindingRefs(graph!, branch.id).length && <p>No exact saved input selected in this branch.</p>}
          </div>)}</section>
        </>}
        {actionRefs.length > 0 && <section className="nw-record-actions" aria-label="Saved record actions">{actionRefs.length > 1 && <label>Saved record to open<select aria-label="Saved record to open" value={actionChoices[choiceKey] ?? ''} disabled={Boolean(busy)} onChange={event => setActionChoices(previous => ({ ...previous, [choiceKey]: event.target.value }))}><option value="">Choose an exact saved record…</option>{actionCandidates.map(item => <option key={`${item.id}:${item.sha256}`} value={`${item.id}:${item.sha256}`}>{item.label} · {item.sha256.slice(0, 12)}{item.status === 'STALE' ? ' · Needs review' : ''}</option>)}</select></label>}{actionRefs.length !== actionCandidates.length && <p className="nw-scope">A linked record is unavailable. Refresh the graph before using it.</p>}{actionBinding && <p>{actionBinding.label}<small>{actionBinding.sha256.slice(0, 12)} · {actionBinding.status === 'CURRENT' ? 'Current saved revision' : 'Needs review'}</small></p>}{actionBinding?.kind === 'measured-media-take' && <p className="nw-review-fact">{takeReviews[`${actionBinding.id}:${actionBinding.sha256}`]?.status ?? 'Checking saved review…'}<small>{takeReviews[`${actionBinding.id}:${actionBinding.sha256}`]?.note}</small></p>}{actionBinding?.kind === 'generation-brief' && <div className="nw-action-buttons"><button className="secondary" disabled={Boolean(busy) || actionBinding.status !== 'CURRENT'} onClick={() => void exportBrief(actionBinding)}>Export saved Dreamina ZIP</button><button className="secondary" disabled={Boolean(busy) || actionBinding.status !== 'CURRENT'} onClick={() => onOpenTool('takes', scene.id, makeRequest(actionBinding, 'IMPORT_RETURN'))}>Import returned clip for this brief</button></div>}</section>}
        {returnCandidates.length > 0 && <section className="nw-record-actions" aria-label="Returned clip handoff">{uniqueReturnRefs.length > 1 && <label>Return brief<select aria-label="Return brief" value={actionChoices[`${choiceKey}:return`] ?? ''} disabled={Boolean(busy)} onChange={event => setActionChoices(previous => ({ ...previous, [`${choiceKey}:return`]: event.target.value }))}><option value="">Choose the returned clip's exact brief…</option>{returnCandidates.map(item => <option key={`${item.id}:${item.sha256}`} value={`${item.id}:${item.sha256}`}>{item.label} · {item.sha256.slice(0, 12)}</option>)}</select></label>}<button className="secondary" disabled={Boolean(busy) || !returnBinding || returnBinding.status !== 'CURRENT'} onClick={() => returnBinding && onOpenTool('takes', scene.id, makeRequest(returnBinding, 'IMPORT_RETURN'))}>Import return for {returnBinding?.label ?? 'selected brief'}</button></section>}
        {selectedPlan && <section className="nw-plan-observation"><h4>Next action</h4><p>{nodeReadinessLabel[selectedPlan.readiness]}</p><p>{selectedPlan.nextAction.reason}</p><button className="secondary" disabled={Boolean(busy) || conflict} onClick={() => continueStep(selectedPlan)}>{selectedPlan.nextAction.label}<ArrowUpRight size={13}/></button><details><summary>Prepared request details</summary><pre>{JSON.stringify(selectedPlan.request, null, 2)}</pre></details></section>}
        <div className="nw-inspector-actions">{definition.openTool && <button className="secondary" disabled={Boolean(busy) || actionRefs.length > 0 && (!actionBinding || actionBinding.status !== 'CURRENT')} onClick={() => actionBinding ? openExactBinding(actionBinding) : onOpenTool(definition.openTool!, scene.id)}>Open {definition.openTool === 'dcc' ? '3D & cameras' : definition.openTool === 'generation' ? 'generation preparation' : definition.openTool === 'scene' ? 'Scenes & shots' : definition.openTool}<ArrowUpRight size={13}/></button>}<button className="nw-remove" disabled={Boolean(busy)} onClick={() => { editGraph(value => removeGraphNode(value, node.id)); setSelection(null); }}>Remove node and its links</button></div>
      </> : selectedEdge && graph ? <><h3>A named connection</h3><div className="nw-edge-detail"><strong>{graph.nodes.find(item => item.id === selectedEdge.from.nodeId)?.label}</strong><span>{selectedEdge.from.portId} · OUTPUT</span><Link2 size={20}/><strong>{graph.nodes.find(item => item.id === selectedEdge.to.nodeId)?.label}</strong><span>{selectedEdge.to.portId} · INPUT</span></div><p className="nw-description">This link passes a typed reference into the next preparation step. It does not copy or replace the source record.</p><button className="nw-remove" disabled={Boolean(busy)} onClick={() => { editGraph(value => ({ ...value, edges: value.edges.filter(edge => edge.id !== selectedEdge.id), nodes: value.nodes.map(item => item.id === selectedEdge.to.nodeId && item.selectedNodeId === selectedEdge.from.nodeId ? { ...item, selectedNodeId: null } : item) })); setSelection(null); }}>Remove connection</button></> : <><h3>Connect the scene.</h3><p className="nw-description">Choose a node to inspect its saved inputs, named sockets and software connection.</p><label>Workflow title<input aria-label="Workflow title" maxLength={200} value={draft?.data.title ?? ''} disabled={!draft || Boolean(busy)} onChange={event => setDrafts(previous => ({ ...previous, [scope]: { ...previous[scope], data: { ...previous[scope].data, title: event.target.value } } }))}/></label><p className="nw-scope">Source, casting, storyboard and take records remain authoritative. This graph arranges their references into a plan.</p></>}
      <section className="nw-connect-form" aria-label="Connect named sockets"><h4>Connect sockets</h4><label>From output<select aria-label="Connection output" value={output} disabled={Boolean(busy)} onChange={event => setOutput(event.target.value)}><option value="">Choose output</option>{options.flatMap(item => item.outputs.map(port => <option key={`${item.node.id}:${port.id}`} value={endpointKey({ nodeId: item.node.id, portId: port.id })}>{item.node.label} · {port.label}</option>))}</select></label><label>To input<select aria-label="Connection input" value={input} disabled={Boolean(busy)} onChange={event => setInput(event.target.value)}><option value="">Choose input</option>{options.flatMap(item => item.inputs.map(port => <option key={`${item.node.id}:${port.id}`} value={endpointKey({ nodeId: item.node.id, portId: port.id })}>{item.node.label} · {port.label}</option>))}</select></label>{graph && output && input && <p className="nw-compatibility">{connectionReason(graph, definitions, parseEndpoint(output), parseEndpoint(input)) ?? 'Matching data types. This input can accept the selected output.'}</p>}<button className="secondary" disabled={Boolean(busy) || !graph || !output || !input || Boolean(graph && output && input && connectionReason(graph, definitions, parseEndpoint(output), parseEndpoint(input)))} onClick={() => connect()}><Link2 size={14}/>Add connection</button></section>
      <button className="nw-refresh" disabled={Boolean(busy)} onClick={() => void load()}>Refresh saved graph</button>
    </aside></div>
    {validation && <section className="nw-validation" aria-label="Workflow validation"><div><h3>{validationCurrent ? validation.value.valid ? 'Planning connections valid' : 'Plan needs attention' : 'Graph changed since validation'}</h3><span>{validation.value.scope === 'PLANNING_ONLY' ? 'Planning only · no external execution' : ''}</span></div>{validation.value.issues.map((issue, index) => <button key={`${issue.code}:${index}`} disabled={!validationCurrent} onClick={() => issue.nodeId ? setSelection({ kind: 'node', id: issue.nodeId }) : issue.edgeId ? setSelection({ kind: 'edge', id: issue.edgeId }) : undefined}>{issue.message}</button>)}</section>}
    </div>
  </section>;
}
