import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { BookOpen, BookText, Boxes, ChevronDown, Clapperboard, ClipboardList, FileClock, FileOutput, FileText, Film, Home, Lightbulb, ListTree, MessageSquare, NotebookPen, PanelLeftClose, Search, Sparkles, Users, Workflow, X } from 'lucide-react';
import { WORKBENCH_MODES, type WorkbenchMode } from './workbenchModel';
import { MOVIE_WORKSPACE_CONTEXT, type MovieWorkspaceContext } from './movieWorkspaceRouting';
import './studio-navigation.css';

const icons = { pipeline: Home, library: Boxes, lore: BookOpen, braindump: Lightbulb, knowledge: NotebookPen, plan: ListTree, write: FileText, scenes: Clapperboard, nodes: Workflow, drafts: FileClock, templates: BookText, insights: Users, continuity: ClipboardList, creative: Sparkles, pitch: FileText, collaborate: MessageSquare, bundle: Boxes, submit: FileOutput };
const aliases: Partial<Record<WorkbenchMode, string>> = { pipeline: 'overview project lifecycle progress', library: 'after-life drifter universe slate characters places worlds', lore: 'library assets documents original files references rights licences', write: 'screenplay fountain editor script story', insights: 'characters actors dialogue relationships analysis', creative: 'ai writing rewrite alternate outline qwen assistant', scenes: 'shots script breakdown scene cast props wardrobe locations effects sound departments', nodes: 'nodes node graph workflow work order production connections tool connections connectors comfyui houdini blender unity storyboard shot order sequence full film timeline cuts generation dreamina movie', bundle: 'references context export saved writing snapshot bundle', collaborate: 'comments review deliver', braindump: 'ideas notes concept research', plan: 'beats outline arcs', submit: 'handoff delivery export', pitch: 'pitch deck presentation marketing release materials' };

type PhaseId = 'pre-development' | 'development' | 'pre-production' | 'production' | 'wrap' | 'post-production' | 'marketing';
type ToolId = WorkbenchMode | 'storyboard' | 'dcc' | 'generation' | 'casting' | 'takes' | 'documents' | 'context' | 'editors' | 'assistant' | 'budget';
const PRODUCTION_PHASES: { id: PhaseId; label: string; tools: ToolId[] }[] = [
  { id: 'pre-development', label: 'Pre-development', tools: ['braindump', 'knowledge', 'templates'] },
  { id: 'development', label: 'Development', tools: ['write', 'plan', 'library', 'pitch', 'budget', 'drafts', 'insights', 'creative', 'continuity', 'collaborate'] },
  { id: 'pre-production', label: 'Pre-production', tools: ['scenes', 'storyboard', 'casting', 'dcc', 'context', 'budget', 'documents'] },
  { id: 'production', label: 'Production', tools: ['nodes', 'generation', 'takes', 'documents', 'dcc'] },
  { id: 'wrap', label: 'Wrap', tools: ['documents', 'takes', 'bundle'] },
  { id: 'post-production', label: 'Post-production', tools: ['editors', 'takes', 'collaborate', 'submit'] },
  { id: 'marketing', label: 'Marketing & release', tools: ['pitch', 'submit', 'bundle'] },
];
const defaultPhase = (mode: WorkbenchMode): PhaseId => PRODUCTION_PHASES.find(phase => phase.tools.includes(mode))?.id ?? 'pre-development';
const toolDescriptions: Partial<Record<ToolId, string>> = {
  write: 'Drafts, project screenplay, formatting and exports', plan: 'Beats, character arcs and scene outline',
  library: 'World, characters, canon and story use', pitch: 'Project pitch and presentation documents',
  scenes: 'Script breakdown, production elements and shot mapping', budget: 'Linked estimates, commitments and recorded costs',
  documents: 'Build breakdowns and shot lists; schedules are outlines', casting: 'Performer and visual reference candidates',
  dcc: 'Blender and Unity shot / camera exchanges', storyboard: 'Frames, pivotal moments and ordered shots',
  editors: 'Prepare the movie cut for an editing application',
  nodes: 'Storyboard and timeline; Workflow tools contains Movie nodes and Tool connections',
};
type NavigationProps = { mode: WorkbenchMode; movieContext?: MovieWorkspaceContext; busy: boolean; dirty: boolean; onMode: (mode: WorkbenchMode) => void; onProduction: () => void; onDcc: () => void; onGeneration?: () => void; onCasting?: () => void; onTakes?: () => void; onDocuments?: () => void; onChooseContext?: () => void; onEditors?: () => void; onAssistant?: () => void; onBudget?: () => void };
type Tool = { id: ToolId; label: string; words: string; Icon: typeof Home; action: () => void; mode?: WorkbenchMode };

export default function StudioNavigation({ mode, movieContext, busy, dirty, onMode, onProduction, onDcc, onGeneration, onCasting, onTakes, onDocuments, onChooseContext, onEditors, onAssistant, onBudget }: NavigationProps) {
  const [query, setQuery] = useState('');
  const [activePhase, setActivePhase] = useState<PhaseId>(() => defaultPhase(mode));
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), phaseButtons = useRef<Partial<Record<PhaseId, HTMLButtonElement | null>>>({});
  const requestedDestination = useRef<{ mode: WorkbenchMode; phase: PhaseId } | null>(null);
  const focusPending = useRef<'first' | 'last' | null>(null);
  const id = useId(), panelId = `${id}-phase-tools`;
  const search = query.toLowerCase().trim();
  const tools: Tool[] = [
    ...(onBudget ? [{ id: 'budget' as const, label: 'Production budget', words: 'budget costing cost estimate breakdown finance', Icon: ClipboardList, action: onBudget }] : []),
    ...WORKBENCH_MODES.map(([key, label]) => ({ id: key, label, words: aliases[key] ?? '', Icon: icons[key], action: () => onMode(key), mode: key })),
    { id: 'storyboard', label: 'Full movie storyboard', words: 'storyboard shot order sequence full film', Icon: Clapperboard, action: onProduction },
    { id: 'dcc', label: '3D & cameras ↗', words: '3d cameras blender unity previs scene camera rehearsal mcp', Icon: PanelLeftClose, action: onDcc },
    { id: 'generation', label: 'Prepare generation', words: 'ai video generate generation dreamina seedance seeddance clips', Icon: Sparkles, action: onGeneration ?? (() => onMode('nodes')) },
    ...(onCasting ? [{ id: 'casting' as const, label: 'Casting & references', words: 'cast actors characters casting reference images', Icon: Users, action: onCasting }] : []),
    ...(onTakes ? [{ id: 'takes' as const, label: 'Review takes', words: 'footage imported returned generated clips media selects review', Icon: Film, action: onTakes }] : []),
    ...(onDocuments ? [{ id: 'documents' as const, label: 'Production documents', words: 'packs call sheets schedule budgets departments wrap reports', Icon: ClipboardList, action: onDocuments }] : []),
    ...(onChooseContext ? [{ id: 'context' as const, label: 'Clip context', words: 'lore references characters writing context selection bundle', Icon: Boxes, action: onChooseContext }] : []),
    { id: 'editors', label: 'Editors & DaVinci Resolve', words: 'editors davinci resolve mcp timeline final cut premiere capcut handoff', Icon: Film, action: onEditors ?? (() => onMode('submit')) },
    { id: 'assistant', label: 'Assistant', words: 'qwen help local models ai assistant', Icon: Sparkles, action: onAssistant ?? (() => onMode('creative')) },
  ];
  const phase = PRODUCTION_PHASES.find(phase => phase.id === activePhase)!;
  const phasesFor = (tool: Tool) => PRODUCTION_PHASES.filter(phase => phase.tools.includes(tool.id));
  const matches = (tool: Tool, value = search) => `${tool.label} ${tool.words} ${phasesFor(tool).map(phase => phase.label).join(' ')}`.toLowerCase().includes(value);
  const displayed = search ? tools.filter(tool => matches(tool)) : phase.tools.flatMap(key => tools.find(tool => tool.id === key) ?? []);
  const shortcuts: ToolId[] = ['pipeline', 'library', 'lore', 'assistant'];

  useEffect(() => {
    const destination = requestedDestination.current;
    requestedDestination.current = null;
    setActivePhase(previous => {
      if (mode === 'nodes' && movieContext) return MOVIE_WORKSPACE_CONTEXT[movieContext].phase;
      if (destination?.mode === mode) return destination.phase;
      if (['pipeline', 'library', 'lore'].includes(mode)) return previous;
      return PRODUCTION_PHASES.find(phase => phase.id === previous)?.tools.includes(mode) ? previous : defaultPhase(mode);
    });
  }, [mode, movieContext]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setQuery(''); } };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (!open || !focusPending.current) return;
    const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const target = focusPending.current === 'last' ? buttons?.[buttons.length - 1] : buttons?.[0];
    focusPending.current = null; target?.focus();
  }, [open, activePhase, query]);

  function close(restore = false) { setOpen(false); setQuery(''); if (restore) phaseButtons.current[activePhase]?.focus(); }
  function select(tool: Tool) {
    if (busy) return;
    const candidates = phasesFor(tool);
    const selectedPhase = candidates.length && !candidates.some(phase => phase.id === activePhase) ? candidates[0].id : activePhase;
    // Wait for the workspace to accept the request: a pending timing edit can block it.
    const destinationMode = tool.id === 'storyboard' ? 'nodes' : tool.id === 'editors' ? (onEditors ? 'nodes' : 'submit') : undefined;
    requestedDestination.current = destinationMode ? { mode: destinationMode, phase: selectedPhase } : null;
    const visiblePhase = destinationMode === 'nodes' && mode === 'nodes' && movieContext ? MOVIE_WORKSPACE_CONTEXT[movieContext].phase : selectedPhase;
    setActivePhase(visiblePhase); close(); phaseButtons.current[visiblePhase]?.focus(); tool.action();
  }
  function searchTools(value: string) {
    setQuery(value); setOpen(Boolean(value.trim()));
    const normalized = value.toLowerCase().trim();
    if (!normalized) return;
    const results = tools.filter(tool => matches(tool, normalized));
    if (!results.some(tool => phase.tools.includes(tool.id))) {
      const first = results.flatMap(phasesFor)[0]; if (first) setActivePhase(first.id);
    }
  }
  function focusTool(position: 'first' | 'last') {
    const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (open && buttons?.length) (position === 'first' ? buttons[0] : buttons[buttons.length - 1]).focus();
    else { focusPending.current = position; setOpen(true); }
  }
  function phaseKey(event: KeyboardEvent<HTMLButtonElement>, selected: PhaseId) {
    const index = PRODUCTION_PHASES.findIndex(phase => phase.id === selected);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? PRODUCTION_PHASES.length - 1 : event.key === 'ArrowRight' ? (index + 1) % PRODUCTION_PHASES.length : event.key === 'ArrowLeft' ? (index + PRODUCTION_PHASES.length - 1) % PRODUCTION_PHASES.length : -1;
    if (target >= 0) { event.preventDefault(); const next = PRODUCTION_PHASES[target].id; setActivePhase(next); setQuery(''); setOpen(true); phaseButtons.current[next]?.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusTool(event.key === 'ArrowDown' ? 'first' : 'last'); }
  }
  function toolKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    event.preventDefault(); const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  function renderTool(tool: Tool, inPanel = false) {
    const Icon = tool.Icon;
    return <button key={tool.id} type="button" aria-label={tool.id === 'write' && dirty ? `${tool.label} Unsaved writing` : tool.label} disabled={busy} data-search={search && matches(tool) ? 'match' : undefined} aria-current={tool.mode === mode ? 'page' : undefined} onClick={() => select(tool)}>
      <Icon size={14} aria-hidden="true"/><span>{tool.label}</span>{tool.id === 'write' && dirty && <i aria-label="Unsaved writing"/>}
      {inPanel && (!search || tool.id === 'nodes') && toolDescriptions[tool.id] && <em className="studio-tool-description" aria-hidden="true">{toolDescriptions[tool.id]}</em>}
      {inPanel && search && <small>{phasesFor(tool).find(phase => phase.id === activePhase)?.label ?? phasesFor(tool)[0]?.label ?? 'Global'}</small>}
    </button>;
  }
  return <div ref={root} className="canis-navigation studio-phase-navigation" onKeyDown={event => { if (event.key === 'Escape' && (open || query)) { event.preventDefault(); event.stopPropagation(); close(true); } }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(); }}>
    <nav aria-label="CanIScreenwrite workspace modes" className="maker-tool-nav maker-workspace-nav">
      <div className="studio-phase-tabs" role="tablist" aria-label="Production phases">{PRODUCTION_PHASES.map((item, index) => <button key={item.id} ref={button => { phaseButtons.current[item.id] = button; }} id={`${id}-${item.id}`} type="button" role="tab" disabled={busy} tabIndex={item.id === activePhase ? 0 : -1} aria-selected={item.id === activePhase} aria-expanded={open && item.id === activePhase} aria-controls={panelId} onKeyDown={event => phaseKey(event, item.id)} onClick={() => { setQuery(''); setActivePhase(item.id); setOpen(item.id !== activePhase || !open); }}>
        <small aria-hidden="true">{String(index + 1).padStart(2, '0')}</small><span>{item.label}</span>{item.id === 'development' && dirty && <i aria-label="Unsaved writing"/>}<ChevronDown size={12} aria-hidden="true"/>
      </button>)}</div>
      <div className="studio-phase-utilities"><div className="maker-tool-search"><Search size={14} aria-hidden="true"/><input aria-label="Find a studio tool" placeholder="Find a tool in any phase…" value={query} onChange={event => searchTools(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown' && open) { event.preventDefault(); focusTool('first'); } }}/>{query && <button type="button" aria-label="Clear tool search" onClick={() => close()}><X size={13} aria-hidden="true"/></button>}</div>
        <div className="studio-global-tools" aria-label="Global studio tools">{shortcuts.flatMap(key => tools.find(tool => tool.id === key) ?? []).map(tool => renderTool(tool))}</div>
      </div>
      {open && <div ref={panel} id={panelId} className="studio-phase-dropdown" role="tabpanel" aria-labelledby={`${id}-${activePhase}`} onKeyDown={toolKey}>
        <div className="studio-phase-dropdown-heading"><strong>{search ? 'Find a tool' : phase.label}</strong><span>{search ? `${displayed.length} ${displayed.length === 1 ? 'match' : 'matches'} across the studio` : 'Choose a tool'}</span></div>
        {displayed.length ? <div className="studio-phase-tool-list">{displayed.map(tool => renderTool(tool, true))}</div> : <p role="status">No tools found. Try “script”, “camera” or “editors”.</p>}
        {search && displayed.length > 0 && <span className="studio-nav-sr-only" role="status">{displayed.length} matching {displayed.length === 1 ? 'tool' : 'tools'} across all production phases.</span>}
      </div>}
    </nav>
  </div>;
}
