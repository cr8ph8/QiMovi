import ProjectLibraryPanel from './ProjectLibraryPanel';
import ProjectStoryBiblePanel from './ProjectStoryBiblePanel';
import OpenCreatorFinishing from './OpenCreatorFinishing';
import CreativeDevelopmentPanel from './CreativeDevelopmentPanel';
import type { DraftContent } from './useWritingDraft';
import ProductionBudgetPanel from './ProductionBudgetPanel';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import HiggsfieldTools from './HiggsfieldTools';
import HiggsfieldDesktopConnection from './HiggsfieldDesktopConnection';
import UsageAccountingPanel from './UsageAccountingPanel';
import AssetMarketPanel from './AssetMarketPanel';
import QiMoviBrand from './QiMoviBrand';
import StandaloneMediaPicker from './StandaloneMediaPicker';
import CreativeScreenwritingPanel from './CreativeScreenwritingPanel';
import WritingProductionPanel, { type WritingPlanRequest } from './WritingProductionPanel';
import { writingDraftRef } from './writingProductionApi';
import ProjectDirectionPanel from './ProjectDirectionPanel';
import FilmcraftGuide from './FilmcraftGuide';
import type { HiggsfieldToolsApi } from './higgsfieldToolsApi';
import type { StudioMediaApi } from './studioMediaApi';
import type { StudioOperationRequest } from './studioOperationRequest';
import type { CreativeAuthoringDraft, CreativeProject, Project, WorkspaceApi, WorkspaceRecord } from './types';
import type { ProductionDestination } from './ProductionAttachmentPanel';
import './studio-navigation.css';
import './creative-project-workspace.css';

export type CreativeArea = 'pipeline' | 'tasks' | 'write' | 'media' | 'connection' | 'budget' | 'develop' | 'library' | 'finish' | 'scene-plan' | 'bible';
type Area = CreativeArea;
export type CreativeAreaRequest = { area: CreativeArea; nonce: number; developmentKind?: import('./workbenchModel').AuthoringKind };
const PROJECT_TOOLS: { id: Area; label: string }[] = [
  { id: 'pipeline', label: 'Pipeline' }, { id: 'develop', label: 'Develop' }, { id: 'bible', label: 'Story Bible' },
  { id: 'library', label: 'Library' }, { id: 'write', label: 'Write' }, { id: 'scene-plan', label: 'Scenes & shots' },
  { id: 'tasks', label: 'Prepare' }, { id: 'media', label: 'Local media' },
  { id: 'finish', label: 'Finish' },
  { id: 'budget', label: 'Budget' }, { id: 'connection', label: 'Connection' },
];
const PROJECT_UTILITIES: Area[] = ['pipeline', 'library', 'media', 'budget', 'connection'];
const AREA_CONTEXT: Record<Area, { description: string; next: Area; action: string }> = {
  bible: { description: 'Build characters, places and world rules, then use them in development and writing.', next: 'develop', action: 'Develop the story' },
  develop: { description: 'Capture ideas, develop the story and keep presentation drafts.', next: 'write', action: 'Open writing' },
  write: { description: 'Write and revise a screenplay draft for this project.', next: 'scene-plan', action: 'Plan scenes & shots' },
  'scene-plan': { description: 'Review a saved screenplay revision and plan its scene coverage.', next: 'budget', action: 'Plan production costs' },
  tasks: { description: 'Prepare image, video and sound instructions for review.', next: 'media', action: 'Review local media' },
  media: { description: 'Inspect retained files and choose references for the next task.', next: 'finish', action: 'Open local finishing' },
  finish: { description: 'Review retained video, subtitles and local render settings.', next: 'library', action: 'Organize delivery files' },
  budget: { description: 'Plan costs and review the project’s recorded spending.', next: 'pipeline', action: 'Review project plan' },
  library: { description: 'Organize the project’s references, drafts and retained files.', next: 'develop', action: 'Develop the story' },
  pipeline: { description: 'Review the project roadmap and record the next production steps.', next: 'develop', action: 'Develop the story' },
  connection: { description: 'Check the local connection and recorded provider usage.', next: 'tasks', action: 'Open preparation' },
};
const PROJECT_PHASES: { id: string; label: string; tools: Area[]; guidance: string }[] = [
  { id: 'pre-development', label: 'Pre-development', tools: ['develop', 'bible', 'library'], guidance: 'Capture ideas, build the Story Bible, keep your research and shape the concept.' },
  { id: 'development', label: 'Development', tools: ['develop', 'bible', 'write', 'library', 'budget'], guidance: 'Develop the story and its world, write the screenplay and build the project budget. Pitch drafts are in Develop → Pitch.' },
  { id: 'pre-production', label: 'Pre-production', tools: ['scene-plan', 'bible', 'pipeline', 'budget', 'library', 'tasks'], guidance: 'Review a saved screenplay in Scenes & shots, plan coverage and prepare references. The production storyboard and rehearsal runner still need an attached production screenplay.' },
  { id: 'production', label: 'Production', tools: ['tasks', 'media', 'budget'], guidance: 'Prepare generation work and retain media. Selecting a tool does not change the project’s production stage.' },
  { id: 'wrap', label: 'Wrap', tools: ['pipeline', 'media', 'budget'], guidance: 'Plan the handoff, organize retained files and reconcile costs in the project budget.' },
  { id: 'post-production', label: 'Post-production', tools: ['finish', 'media', 'library', 'pipeline'], guidance: 'Render retained videos with reviewed subtitles using local tools, organize references and plan delivery. The movie timeline and editorial handoff need an attached production screenplay.' },
  { id: 'marketing', label: 'Marketing & release', tools: ['develop', 'tasks', 'library', 'pipeline'], guidance: 'Develop → Pitch holds project presentation drafts. Prepare holds image, video and sound briefs.' },
];
export default function CreativeProjectWorkspace({ project, records, api, onSaved, onRefresh, loading = false, error = null, open = true, toolsApi, mediaApi, attachedProject, onAttached, onOpenProduction, areaRequest, onDirtyChange }: {
  project: CreativeProject; records: WorkspaceRecord[]; api: WorkspaceApi; onSaved: (record:WorkspaceRecord) => void; onRefresh: () => void;
  attachedProject?: Project; onAttached?: () => void | Promise<void>; onOpenProduction?: (destination: ProductionDestination) => void; areaRequest?: CreativeAreaRequest; onDirtyChange?: (dirty: boolean) => void;
  loading?: boolean; error?: string | null; open?: boolean; toolsApi?: HiggsfieldToolsApi; mediaApi?: StudioMediaApi;
}) {
  const effectiveProject = attachedProject ?? project;
  const [area,setArea] = useState<Area>('develop');
  const [writingGuideOpen, setWritingGuideOpen] = useState(false);
  const [phaseMenu, setPhaseMenu] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState('development');
  const navigation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!phaseMenu) return;
    const closeOutside = (event: PointerEvent) => { if (!navigation.current?.contains(event.target as Node)) setPhaseMenu(null); };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [phaseMenu]);
  function openArea(next: Area, phaseId?: string) {
    setArea(next); setPhaseMenu(null);
    if (phaseId) setActivePhase(phaseId);
    else if (!['pipeline', 'library', 'connection', 'budget'].includes(next)) {
      setActivePhase(previous => PROJECT_PHASES.find(phase => phase.id === previous)?.tools.includes(next) ? previous : PROJECT_PHASES.find(phase => phase.tools.includes(next))?.id ?? 'development');
    }
  }
  useEffect(() => { if (areaRequest) openArea(areaRequest.area); }, [areaRequest]);
  const [libraryDirty, setLibraryDirty] = useState(false);
  const [developmentDirty, setDevelopmentDirty] = useState(false);
  const [bibleDirty, setBibleDirty] = useState(false);
  const [bibleEntryRequest, setBibleEntryRequest] = useState<{ id: string; nonce: number }>();
  const [developmentRequest, setDevelopmentRequest] = useState<{ token: string; draft: CreativeAuthoringDraft }>();
  function openBibleSource(record: WorkspaceRecord) {
    if (!record.kind.startsWith('universe-')) return;
    const data = record.data as { entityId?: string; fromEntityId?: string };
    const id = data.entityId ?? data.fromEntityId;
    if (id) { setBibleEntryRequest(previous => ({ id, nonce: (previous?.nonce ?? 0) + 1 })); openArea('bible'); }
  }
  const [planRequest, setPlanRequest] = useState<WritingPlanRequest>();
  const [planDirty, setPlanDirty] = useState(false);
  const [writingRequest, setWritingRequest] = useState<(DraftContent & { nonce: string; projectId: string })>();
  const [budgetDirty, setBudgetDirty] = useState(false);
  const [budgetFocusRequest, setBudgetFocusRequest] = useState<{ nonce: number; projectId: string; sourceHash: string | null; targetId?: string }>();
  function openBudget(targetId?: string, phaseId?: string) {
    setBudgetFocusRequest(previous => ({ nonce: (previous?.nonce ?? 0) + 1, projectId: project.id, sourceHash: effectiveProject.sourceHash, ...(targetId ? { targetId } : {}) }));
    openArea('budget', phaseId);
  }
  const [operationRequest, setOperationRequest] = useState<StudioOperationRequest>();
  const [directionDirty, setDirectionDirty] = useState(false), [writingDirty, setWritingDirty] = useState(false);
  const [preparationDirty, setPreparationDirty] = useState(false), [mediaDirty, setMediaDirty] = useState(false);
  const unfinished = [
    ...(bibleDirty ? [{ area: 'bible' as Area, label: 'Story Bible' }] : []),
    ...(libraryDirty ? [{ area: 'library' as Area, label: 'Library organization' }] : []),
    ...(developmentDirty ? [{ area: 'develop' as Area, label: 'Development drafts' }] : []),
    ...(budgetDirty ? [{ area: 'budget' as Area, label: 'Project budget' }] : []),
    ...(directionDirty ? [{ area: 'pipeline' as Area, label: 'Production planning' }] : []),
    ...(writingDirty ? [{ area: 'write' as Area, label: 'Writing draft' }] : []),
    ...(planDirty ? [{ area: 'scene-plan' as Area, label: 'Scene & shot plan' }] : []),
    ...(preparationDirty ? [{ area: 'tasks' as Area, label: 'Generation preparation' }] : []),
    ...(mediaDirty ? [{ area: 'media' as Area, label: 'Asset passport' }] : []),
  ];
  const dirty = unfinished.length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const count = (kind: string) => records.filter(record => record.kind === kind).length;
  const context = AREA_CONTEXT[area];
  const selectedTool = PROJECT_TOOLS.find(tool => tool.id === area)!;
  const menuPhase = PROJECT_PHASES.find(phase => phase.id === phaseMenu);
  return <main className="creative-project-workspace" aria-label="Hampton’s Slate project workspace" data-project-id={project.id} data-unsaved={dirty ? 'true' : 'false'} hidden={!open}>
    <header className="creative-project-header">
      <div className="canis-navigation studio-phase-navigation" ref={navigation} onKeyDown={event => { if (event.key === 'Escape' && phaseMenu) { navigation.current?.querySelector<HTMLButtonElement>(`[data-phase="${phaseMenu}"]`)?.focus(); setPhaseMenu(null); } }}>
        <nav className="maker-workspace-nav" aria-label="Production phases">
          <div className="studio-phase-tabs">{PROJECT_PHASES.map((phase, index) => <button key={phase.id} type="button" data-phase={phase.id} aria-pressed={activePhase === phase.id} aria-expanded={phaseMenu === phase.id} aria-controls={phaseMenu === phase.id ? 'creative-phase-tools' : undefined} onClick={() => setPhaseMenu(previous => previous === phase.id ? null : phase.id)}><small aria-hidden="true">{String(index + 1).padStart(2, '0')}</small><span>{phase.label}</span><ChevronDown size={12} aria-hidden="true"/></button>)}</div>
          {menuPhase && <div className="studio-phase-dropdown" id="creative-phase-tools" role="group" aria-label={`${menuPhase.label} tools`}>
            <div className="studio-phase-dropdown-heading"><strong>{menuPhase.label}</strong><span>Choose a tool</span></div>
            <p>{attachedProject && menuPhase.id === 'pre-production' ? 'Continue from the attached screenplay into storyboards, camera rehearsals and production costs.' : menuPhase.guidance}</p>
            <div className="studio-phase-tool-list">{menuPhase.tools.map(id => <button key={id} type="button" aria-current={area === id ? 'page' : undefined} onClick={() => id === 'budget' ? openBudget(undefined, menuPhase.id) : openArea(id, menuPhase.id)}>{PROJECT_TOOLS.find(tool => tool.id === id)!.label}</button>)}</div>
            {attachedProject && onOpenProduction && <div className="studio-phase-tool-list">{menuPhase.id === 'pre-production' && <><button onClick={() => onOpenProduction('storyboard')}>Storyboard</button><button onClick={() => onOpenProduction('cameras')}>3D & cameras</button></>}{['production', 'post-production'].includes(menuPhase.id) && <button onClick={() => onOpenProduction('timeline')}>Movie timeline</button>}</div>}
          </div>}
        </nav>
      </div>
      <div className="creative-project-brand-bar">
        <QiMoviBrand/>
        <div className="creative-project-identity"><span>Hampton’s Slate <span aria-hidden="true">/</span> Creative project</span><h1>{project.title}</h1></div>
        <div className="creative-project-local-status"><i aria-hidden="true"/>{dirty ? 'Unsaved edits on this Mac' : 'Local workspace'}</div>
        <button className="creative-project-refresh" disabled={loading} onClick={onRefresh}>{loading ? 'Refreshing…' : 'Refresh project'}</button>
      </div>
      <div className="creative-project-utility-bar">
        <nav className="creative-project-tools" aria-label="Creative project tools">{PROJECT_TOOLS.filter(tool => PROJECT_UTILITIES.includes(tool.id)).map(tool => <button key={tool.id} type="button" aria-pressed={area === tool.id} onClick={() => tool.id === 'budget' ? openBudget() : openArea(tool.id)}>{tool.label}</button>)}</nav>
        <span className="creative-project-source-status">{attachedProject ? `Production copy · screenplay v${attachedProject.productionDraftRef?.version}` : 'No production screenplay attached'}</span>{attachedProject && <button onClick={() => onOpenProduction?.('storyboard')}>Continue to storyboard</button>}
      </div>
    </header>
    {dirty && <nav className="creative-project-unsaved" aria-label="Unsaved work"><span>Open work</span>{unfinished.map(item => <button key={item.area} aria-current={area === item.area ? 'page' : undefined} onClick={() => openArea(item.area)}>{item.label} · unsaved</button>)}</nav>}
    {error && <div className="creative-project-error" role="alert"><p>{error}</p><button disabled={loading} onClick={onRefresh}>Reconnect local workspace</button></div>}
    <section className="creative-project-content">
      <div className="creative-project-orientation" aria-label="Current workspace">
        <div><span className="creative-project-area-label">Current tool</span><strong>{selectedTool.label}</strong><p>{context.description}</p></div>
        <button type="button" onClick={() => openArea(context.next)}>{context.action}<ArrowRight size={14} aria-hidden="true"/></button>
      </div>
      {open && (area === 'develop' || area === 'write') && <details className="creative-project-writing-guide" open={writingGuideOpen} onToggle={event => setWritingGuideOpen(event.currentTarget.open)}>
        <summary><span>Filmcraft guide</span><small>Writing reference</small><ChevronDown size={14} aria-hidden="true"/></summary>
        {writingGuideOpen && <FilmcraftGuide context="writing" compact/>}
      </details>}
      {open && area === 'finish' && <OpenCreatorFinishing project={effectiveProject} onLibrary={() => openArea('library')}/>}
      <ProjectLibraryPanel project={effectiveProject} records={records} open={open && area === 'library'} onReadLore={() => openArea('develop')} onSaved={onSaved} onDirty={setLibraryDirty} onOpenBudget={openBudget}/>
      <ProjectStoryBiblePanel key={`bible:${project.id}`} project={effectiveProject} developmentProject={project} records={records} api={api} open={open && area === 'bible'} disabled={Boolean(error)} entityRequest={bibleEntryRequest} onSaved={onSaved} onDirty={setBibleDirty} onOpenSources={() => openArea('library')} onOpenBudget={openBudget} onDevelop={draft => { setDevelopmentRequest({ token: crypto.randomUUID(), draft }); openArea('develop'); }}/>
      <CreativeDevelopmentPanel requestedDraft={developmentRequest} onOpenSource={openBibleSource} requestedKind={areaRequest?.developmentKind} key={`develop:${project.id}`} project={project} records={records} api={api} open={open && area === 'develop'} disabled={Boolean(error)} onSaved={onSaved} onDirty={setDevelopmentDirty} onWrite={content => { setWritingRequest({ ...content, nonce: crypto.randomUUID(), projectId: project.id }); openArea('write'); }}/>
      <ProductionBudgetPanel key={`budget:${project.id}`} project={effectiveProject} records={records} open={open && area === 'budget'} onSaved={onSaved} onDirtyChange={setBudgetDirty} focusRequest={budgetFocusRequest}/>
      <div hidden={area !== 'pipeline'}>
        <div className="creative-project-section-heading"><h2>One project, from idea to delivery</h2><p>Develop the story, prepare generation inputs and review retained media. Your production roadmap stays with the project throughout.</p></div>
        <nav className="creative-project-journey" aria-label="Continue project work">
          <button onClick={() => openArea('develop')}><span>01 · Develop</span><strong>Idea to screenplay</strong><small>{count('concept-draft')} concepts · {count('story-plan-draft')} story plans · {count('screenplay-draft')} screenplay drafts</small></button>
          <button onClick={() => openArea('bible')}><span>02 · World</span><strong>Characters & story world</strong><small>{count('universe-entity')} authored entries · profiles, relationships and world rules</small></button>
          <button onClick={() => openArea('scene-plan')}><span>03 · Plan</span><strong>Scenes & shots</strong><small>{count('writing-production-plan')} retained scene plans · exact screenplay revisions</small></button>
          <button onClick={() => openArea('media')}><span>04 · Review</span><strong>Work with local media</strong><small>{count('studio-media')} imported references · inspect and reuse</small></button>
        </nav>
        <p className="creative-project-source-note">Scenes & shots carries a saved writing revision into a coverage plan. Review its production handoff to use the same scenes and shots in the storyboard, timeline, Blender rehearsals and budget.</p>
        <fieldset className="creative-project-plan" disabled={Boolean(error)} aria-label="Project production planning"><ProjectDirectionPanel project={effectiveProject} records={records} api={api} onSaved={onSaved} onDirty={setDirectionDirty}/></fieldset>
      </div>
      <WritingProductionPanel key={`scene-plan:${project.id}`} project={project} records={records} open={open && area === 'scene-plan'} request={planRequest} onSaved={onSaved} handoffBlocked={unfinished.some(item => item.area !== 'scene-plan')} attachedProject={attachedProject} onAttached={onAttached} onOpenProduction={onOpenProduction} onDirty={setPlanDirty} onWrite={() => openArea('write')} disabled={Boolean(error)}/>
      <CreativeScreenwritingPanel onPlanProduction={record => { setPlanRequest({ nonce: crypto.randomUUID(), draftRef: writingDraftRef(record) }); openArea('scene-plan', 'pre-production'); }} writingRequest={writingRequest} key={project.id} project={project} records={records} api={api} onSaved={onSaved} onDirty={setWritingDirty} open={open && area === 'write'} disabled={Boolean(error)} onPrepare={request => { setOperationRequest(request); openArea('tasks'); }}/>
      <HiggsfieldTools onOpenWriting={() => openArea('write')} onOpenBudget={openBudget} operationRequest={operationRequest} open={open && area === 'tasks'} project={effectiveProject} records={records} workspaceApi={api} onSaved={onSaved} onDirty={setPreparationDirty} toolsApi={toolsApi} disabledReason={error ? 'Reconnect the local workspace before saving or preparing inputs.' : ''}/>
      <div hidden={area !== 'media'}><div className="creative-project-section-heading"><h2>Local media</h2><p>Choose a retained image, video or audio file to start its next preparation task.</p></div><StandaloneMediaPicker project={project} open={open && area === 'media'} disabled={Boolean(error)} mediaApi={mediaApi} renderAssetInspector={(media, assets) => <>{media && <button type="button" onClick={() => openBudget(`asset:${media.sha256}`)}>Asset costs</button>}<AssetMarketPanel project={effectiveProject} asset={media ? {sha256:media.sha256,title:media.originalFilename,mimeType:media.mimeType} : undefined} assets={assets.map(item => ({sha256:item.sha256,title:item.originalFilename,mimeType:item.mimeType}))} records={records} api={api} onSaved={onSaved} onDirty={setMediaDirty} disabled={Boolean(error)}/></>} onOperationRequest={request => { setOperationRequest(request); openArea('tasks'); }}/></div>
      <div className="creative-project-connection" hidden={area !== 'connection'}><HiggsfieldDesktopConnection open={open && area === 'connection'}/><UsageAccountingPanel key={project.id} open={open && area === 'connection'} project={effectiveProject} onSaved={onSaved}/></div>
    </section>
    <footer className="creative-project-footer">Drafts, research, budgets and retained media stay together in this project.</footer>
  </main>;
}
