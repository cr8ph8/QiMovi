import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, Clapperboard, FileText, FolderOpen, Grid2X2, MapPin, Maximize2, Minus, Network, Plus, Search, Sparkles, Users, Workflow, X } from 'lucide-react';
import type { CastingDraft, Project, WorkspaceProject, WorkspaceRecord } from './types';
import type { UniverseCatalog, UniverseCitation, UniverseEntity, UniverseEntityDraft, UniverseEntityType, UniverseClaimDraft, UniverseLinkDraft, UniverseAgentDraft, UniverseProfileDraft, UniverseProductionPlanDraft, UniverseContinuityDraft } from './universeApi';
import { filterUniverse, universeGraphPage, universeMapLayout, universeMapName, universeContentGuides, universeGuideSummary, universeMonogram, universeReviewLabel, universeTypeLabel, type UniverseFilter } from './universeLibraryModel';
import { universeDraftScope } from './universeApi';
import StoryBiblePanel, { type StoryBiblePrompt } from './StoryBiblePanel';
import UniverseRelationshipEditor from './UniverseRelationshipEditor';
import CharacterAgentPanel from './CharacterAgentPanel';
import UniverseProfileEditor from './UniverseProfileEditor';
import WorldProductionPlanEditor from './WorldProductionPlanEditor';
import WorldSceneUse from './WorldSceneUse';
import WorldContinuityPanel from './WorldContinuityPanel';
import { worldEntryMatches } from './worldProductionModel';
import WorldRehearsalPanel from './WorldRehearsalPanel';
import UniverseSlate, { type UniverseOperation } from './UniverseSlate';
import type { WorldRehearsalDraft, WorldRehearsalRecord } from './worldRehearsal';
import { validateRecord } from './validation';
import { SceneStill } from './StudioHome';
import { blobUrl, getRecordHistory } from './api';
import './universe-library.css';

export type UniverseLibraryProps = {
  entityRequest?: { id: string; nonce: number };
  initialView?: 'map' | 'slate' | 'bible'; onOperation?: (operation: UniverseOperation) => void;
  project: WorkspaceProject; records?: WorkspaceRecord[]; model?: UniverseCatalog; loading?: boolean; error?: string;
  onRetry?: () => void; onOpenSources: () => void;
  onReadSource?: (citation: UniverseCitation) => void;
  onSceneSelect?: (sceneId: string) => void;
  onCasting?: (entity: UniverseEntity) => void;
  onChooseContext?: (entity: UniverseEntity) => void;
  onNodes?: (sceneId: string) => void; onGenerate?: (sceneId: string) => void;
  onAssistant?: (entity: UniverseEntity | null) => void;
  onCreateEntity?: (data: UniverseEntityDraft) => Promise<WorkspaceRecord>;
  onSaveLink?: (data: UniverseLinkDraft) => Promise<WorkspaceRecord>;
  onOpenBudget?: (targetId?: string) => void;
  onSaveContinuity?: (data: UniverseContinuityDraft, expectedVersion: number | null, requestId: string) => Promise<WorkspaceRecord>;
  onSaveProductionPlan?: (data: UniverseProductionPlanDraft, expectedVersion: number | null, requestId: string) => Promise<WorkspaceRecord>;
  onSaveProfile?: (data: UniverseProfileDraft, expectedVersion: number | null, requestId: string) => Promise<WorkspaceRecord>;
  onSaveAgent?: (data: UniverseAgentDraft, expectedVersion: number | null, requestId: string) => Promise<WorkspaceRecord>;
  onSaveRehearsal?: (id: string, data: WorldRehearsalDraft, expectedVersion: number | null, requestId: string) => Promise<WorkspaceRecord>;
  onAgentResult?: (record: WorkspaceRecord) => void;
  onDevelopRights?: (entity: UniverseEntity) => void; onSaveClaim?: (data: UniverseClaimDraft) => Promise<WorkspaceRecord>; onDirty?: (dirty: boolean) => void;
};
const rightsTemplate = 'Authorship / claimant:\n\nPermitted use:\n\nRestrictions / attribution:\n\nEvidence references:\n';
const filters: { id: UniverseFilter; label: string }[] = [{ id: 'all', label: 'Everything' }, { id: 'character', label: 'Characters' }, { id: 'location', label: 'Places' }, { id: 'story', label: 'Stories' }, { id: 'world', label: 'World notes' }];

function EntityPortrait({ entity, compact = false }: { entity: UniverseEntity; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const imageHash = entity.imageHash ?? entity.artwork?.imageHash;
  const isPlaceholder = !entity.imageHash && Boolean(entity.artwork);
  useEffect(() => setFailed(false), [imageHash]);
  // Presentation window in the verified 1536 × 1024 contact sheet. The retained
  // blob and all source-reader/download paths remain the full original image.
  const drifterPortrait = !isPlaceholder && imageHash === 'af43737942c3a6d379520306a6348c02b3da39d8c4884d833449052e7b6d75d9';
  return <div className={`uni-portrait ${compact ? 'uni-portrait-compact' : ''}`}>
    {imageHash && !failed ? drifterPortrait ? <svg className="uni-portrait-window" viewBox="0 100 403 540" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${entity.name} retained reference, portrait crop`}><image href={blobUrl(imageHash)} x="0" y="0" width="1536" height="1024" onError={() => setFailed(true)}/></svg> : <img src={blobUrl(imageHash)} alt={`${entity.name} ${isPlaceholder ? 'AI concept placeholder' : 'retained reference'}`} onError={() => setFailed(true)} loading="lazy"/> : <><span className="uni-monogram" aria-hidden="true">{entity.type === 'location' ? <MapPin size={compact ? 28 : 42}/> : universeMonogram(entity.name)}</span>{!compact && <small>{failed ? 'Reference unavailable' : 'No linked portrait'}</small>}</>}
    {isPlaceholder && !failed && <span className="uni-artwork-label">AI concept · placeholder</span>}
  </div>;
}

export default function UniverseLibrary({ entityRequest, initialView = 'map', onOperation, project, records = [], model, loading = false, error, onRetry, onOpenSources, onReadSource, onSceneSelect, onCasting, onChooseContext, onNodes, onGenerate, onAssistant, onCreateEntity, onDevelopRights, onSaveClaim, onSaveLink, onSaveAgent, onSaveProfile, onSaveContinuity, onSaveProductionPlan, onOpenBudget, onSaveRehearsal, onAgentResult, onDirty }: UniverseLibraryProps) {
  const productionProject = project.sourceHash !== null ? project as Project : undefined;
  const scenes: Project['scenes'] = project.scenes, cells: Project['cells'] = project.cells;
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<UniverseFilter>('all');
  const [guidesOnly, setGuidesOnly] = useState(false);
  const [storylineId, setStorylineId] = useState(''), [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState<'slate' | 'map' | 'cards' | 'bible' | 'use' | 'continuity'>(initialView), [tab, setTab] = useState<'overview' | 'connections' | 'sources' | 'rights'>('overview');
  const [filmExpanded, setFilmExpanded] = useState<boolean | null>(null);
  const filmOpen = filmExpanded ?? !['bible', 'use', 'continuity'].includes(view);
  const [zoom, setZoom] = useState(1), [hoveredId, setHoveredId] = useState('');
  const [graphMode, setGraphMode] = useState<'all' | 'connections'>('all'), [graphPage, setGraphPage] = useState(0);
  const graphArrowId = useId().replace(/:/g, '');
  const [sceneId, setSceneId] = useState(scenes[0]?.id ?? '');
  const [creating, setCreating] = useState(false), [newType, setNewType] = useState<UniverseEntityType>('character');
  const [newName, setNewName] = useState(''), [newSummary, setNewSummary] = useState(''), [createError, setCreateError] = useState('');
  const [saving, setSaving] = useState(false), [createdNotice, setCreatedNotice] = useState('');
  const [rightsForm, setRightsForm] = useState<{ entity: UniverseEntity; title: string; body: string; purpose?: 'bible'; review?: UniverseClaimDraft['review']; templateBody?: string; initial: Pick<UniverseClaimDraft, 'title' | 'body' | 'review'> } | null>(null);
  const [relationshipEntity, setRelationshipEntity] = useState<UniverseEntity | null>(null);
  const [relationshipDirty, setRelationshipDirty] = useState(false);
  const [agentEntity, setAgentEntity] = useState<UniverseEntity | null>(null);
  const [agentDirty, setAgentDirty] = useState(false);
  const [profileEntity, setProfileEntity] = useState<UniverseEntity | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const [continuityMode, setContinuityMode] = useState<'events' | 'aliases'>('events');
  const [continuityOpen, setContinuityOpen] = useState(false), [continuityDirty, setContinuityDirty] = useState(false), [continuityEntry, setContinuityEntry] = useState<string>();
  const [planEntity, setPlanEntity] = useState<UniverseEntity | null>(null), [planDirty, setPlanDirty] = useState(false);
  const [worldOpen, setWorldOpen] = useState(false), [worldDirty, setWorldDirty] = useState(false);
  const [worldActor, setWorldActor] = useState<{ record: WorldRehearsalRecord; profile: WorkspaceRecord & { data: UniverseAgentDraft } } | null>(null);
  const worldLoad = useRef(0);
  useEffect(() => () => { worldLoad.current++; }, []);
  const [claimSaving, setClaimSaving] = useState(false), [claimError, setClaimError] = useState('');
  const claimAttempt = useRef<UniverseClaimDraft | null>(null);
  const attempt = useRef<UniverseEntityDraft | null>(null), currentScope = useRef('');
  const scope = `${project.id}:${project.sourceHash}`; currentScope.current = scope;
  const claimDirty = Boolean(rightsForm && (rightsForm.title !== rightsForm.initial.title || rightsForm.body !== rightsForm.initial.body || (rightsForm.review ?? 'PROPOSED') !== rightsForm.initial.review));
  useEffect(() => { onDirty?.(continuityDirty || planDirty || profileDirty || agentDirty || worldDirty || relationshipDirty || saving || claimSaving || claimDirty || Boolean(newName.trim() || newSummary.trim())); }, [newName, newSummary, saving, claimSaving, claimDirty, relationshipDirty, agentDirty, worldDirty, profileDirty, planDirty, continuityDirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  useEffect(() => { worldLoad.current++; setContinuityOpen(false); setContinuityDirty(false); setContinuityEntry(undefined); setPlanEntity(null); setPlanDirty(false); setProfileEntity(null); setProfileDirty(false); setFilmExpanded(null); setWorldOpen(false); setWorldDirty(false); setWorldActor(null); setAgentEntity(null); setAgentDirty(false); setRelationshipEntity(null); setRelationshipDirty(false); setQuery(''); setFilter('all'); setGuidesOnly(false); setStorylineId(''); setSelectedId(''); setTab('overview'); setSceneId(scenes[0]?.id ?? ''); setZoom(1); setCreating(false); setNewName(''); setNewSummary(''); setCreateError(''); setCreatedNotice(''); setSaving(false); setRightsForm(null); setClaimError(''); setClaimSaving(false); claimAttempt.current = null; attempt.current = null; }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const handledEntryRequest = useRef<typeof entityRequest>();
  useEffect(() => {
    if (!entityRequest || handledEntryRequest.current === entityRequest || model?.projectId !== project.id || model.sourceHash !== project.sourceHash || !model.entities.some(entity => entity.id === entityRequest.id)) return;
    if (continuityOpen || planEntity || profileEntity || agentEntity || worldOpen || relationshipEntity || rightsForm || creating) {
      setView('bible');
      setCreatedNotice('Your current world editor is still open. Finish or close it to open the linked Library entry.');
      return;
    }
    handledEntryRequest.current = entityRequest;
    setQuery(''); setFilter('all'); setGuidesOnly(false); setStorylineId('');
    setSelectedId(entityRequest.id); setTab('overview'); setView('bible'); setCreatedNotice('');
  }, [entityRequest, model, project.id, project.sourceHash, continuityOpen, planEntity, profileEntity, agentEntity, worldOpen, relationshipEntity, rightsForm, creating]);
  const catalog = model?.projectId === project.id && model.sourceHash === project.sourceHash ? model : undefined;
  const entities = useMemo(() => catalog?.entities ?? [], [catalog]), links = useMemo(() => catalog?.links ?? [], [catalog]);
  const contentGuides = useMemo(() => universeContentGuides(catalog), [catalog]);
  const filtered = useMemo(() => filterUniverse(entities, '', filter, storylineId).filter(entity => (!guidesOnly || contentGuides.has(entity.id)) && (!catalog || worldEntryMatches(catalog, entity, query))), [entities, query, filter, storylineId, guidesOnly, contentGuides, catalog]);
  const initial = filtered.find(entity => entity.type === 'character' && /^(the )?drifter$/i.test(entity.name)) ?? filtered[0];
  const selected = entities.find(entity => entity.id === selectedId) ?? initial;
  useEffect(() => { setGraphPage(0); }, [query, filter, storylineId, guidesOnly, scope, graphMode, graphMode === 'connections' ? selected?.id : null]);
  useEffect(() => { setGraphMode('all'); }, [scope]);
  const graph = useMemo(() => universeGraphPage(filtered, links, graphMode === 'connections' ? selected?.id ?? null : null, graphPage), [filtered, links, graphMode, selected?.id, graphPage]);
  const map = useMemo(() => universeMapLayout(graph.entities, links), [graph.entities, links]);
  const connected = selected ? links.filter(link => link.fromEntityId === selected.id || link.toEntityId === selected.id) : [];
  const selectionSceneIds = selected?.sceneIds.filter(id => scenes.some(scene => scene.id === id)) ?? [];
  const activeScene = scenes.find(scene => scene.id === sceneId) ?? scenes[0];
  const spotlight = hoveredId || selected?.id;
  const activeStoryline = catalog?.storylines.find(storyline => storyline.id === storylineId);
  const select = (entity: UniverseEntity) => { setSelectedId(entity.id); setTab('overview'); if (entity.sceneIds.some(id => scenes.some(scene => scene.id === id))) setSceneId(entity.sceneIds.find(id => scenes.some(scene => scene.id === id))!); };
  const resetFilters = () => { setQuery(''); setFilter('all'); setGuidesOnly(false); setStorylineId(''); setSelectedId(''); };
  function openContinuity(entity?: UniverseEntity, mode: 'events' | 'aliases' = 'events') {
    if (planEntity || profileEntity || agentEntity || worldOpen || relationshipEntity || rightsForm || creating) {
      setView('bible'); setCreatedNotice('Finish or close the current world editor before opening Continuity.'); return;
    }
    if (!continuityOpen) { setContinuityEntry(entity?.id); setContinuityMode(mode); }
    setContinuityOpen(true); setView('continuity'); setCreatedNotice('');
  }
  function openProductionPlan(entity: UniverseEntity) {
    setView('bible');
    if (continuityOpen || planEntity || profileEntity || agentEntity || worldOpen || relationshipEntity || rightsForm || creating) {
      setCreatedNotice('Finish or close the current world editor before opening production needs.'); return;
    }
    setSelectedId(entity.id); setPlanEntity(entity); setCreatedNotice('');
  }
  function openProfile(entity: UniverseEntity) {
    setView('bible');
    if (continuityOpen || planEntity || profileEntity || agentEntity || worldOpen || relationshipEntity || rightsForm || creating) {
      setCreatedNotice('Finish or close the current Story Bible editor before opening a world-building profile.'); return;
    }
    setProfileEntity(entity);
  }
  function openCharacterAgency(entity: UniverseEntity) {
    if (relationshipEntity || rightsForm || creating) { setView('bible'); setCreatedNotice('Finish or close the current world editor before opening character rehearsal.'); return; }
    if (continuityOpen) { setView('continuity'); setCreatedNotice('Finish or close Continuity before opening rehearsal.'); return; }
    if (planEntity) { setView('bible'); setCreatedNotice('Close production needs before opening character rehearsal.'); return; }
    if (profileEntity) { setView('bible'); setCreatedNotice(`Close the profile for ${profileEntity.name} before opening character rehearsal.`); return; }
    setView('bible');
    if (!agentEntity) { worldLoad.current++; setWorldActor(null); setAgentEntity(entity); }
    else setCreatedNotice(`Close the rehearsal for ${agentEntity.name} before opening another character.`);
  }
  function openWorld() {
    if (relationshipEntity || rightsForm || creating) { setView('bible'); setCreatedNotice('Finish or close the current world editor before opening World rehearsal.'); return; }
    if (continuityOpen) { setView('continuity'); setCreatedNotice('Finish or close Continuity before opening rehearsal.'); return; }
    if (planEntity) { setView('bible'); setCreatedNotice('Close production needs before opening World rehearsal.'); return; }
    if (profileEntity) { setView('bible'); setCreatedNotice(`Close the profile for ${profileEntity.name} before opening World rehearsal.`); return; }
    if (agentEntity) { setView('bible'); setCreatedNotice(`Close the rehearsal for ${agentEntity.name} to open World rehearsal.`); return; }
    setWorldOpen(true); setView('bible');
  }
  async function rehearseInWorld(record: WorldRehearsalRecord, entityId: string) {
    const serial = ++worldLoad.current, requestedScope = scope;
    const participant = record.data.participants.find(item => item.entityId === entityId);
    const entity = catalog?.entities.find(item => item.id === entityId && item.type === 'character');
    if (!participant || !entity || agentEntity) return;
    setCreatedNotice('Opening the character’s saved rehearsal perspective…');
    try {
      const latest = catalog?.drafts.find(row => row.id === participant.profileRef.id && row.sha256 === participant.profileRef.sha256);
      const retained = latest ?? (await getRecordHistory(participant.profileRef.id)).find(row => row.sha256 === participant.profileRef.sha256);
      if (serial !== worldLoad.current || requestedScope !== currentScope.current) return;
      if (!retained) throw new Error('The character profile revision is unavailable.');
      await validateRecord(retained, project);
      if (serial !== worldLoad.current || requestedScope !== currentScope.current) return;
      const data = retained.data as UniverseAgentDraft;
      if (retained.kind !== 'universe-agent' || data.entityId !== entityId || data.sourceHash !== project.sourceHash || data.review !== 'PROPOSED') throw new Error('The retained profile does not match this character.');
      setWorldActor({ record, profile: retained as WorkspaceRecord & { data: UniverseAgentDraft } });
      setAgentEntity(entity); setView('bible'); setCreatedNotice('');
    } catch (caught) { if (serial === worldLoad.current && requestedScope === currentScope.current) setCreatedNotice(caught instanceof Error ? caught.message : 'The rehearsal perspective could not be loaded.'); }
  }
  function openRelationship(entity: UniverseEntity) {
    setView('bible');
    if (continuityOpen || planEntity || profileEntity || agentEntity || worldOpen || relationshipEntity || rightsForm || creating) {
      setCreatedNotice('Finish or close the current world editor before adding a relationship.'); return;
    }
    setRelationshipEntity(entity); setCreatedNotice('');
  }
  function openConnected(id: string) { const entity = entities.find(item => item.id === id); if (entity) { setQuery(''); setFilter('all'); setGuidesOnly(false); setStorylineId(''); select(entity); } }

  const characterIds = selected?.citations.filter(citation => citation.kind === 'SOURCE_CHARACTER').map(citation => citation.sourceId) ?? [];
  const referenceUses = selected ? records.filter(record => record.kind === 'casting-draft' && (record.data as CastingDraft).sourceHash === project.sourceHash).map(record => ({ record, data: record.data as CastingDraft })).filter(({ data }) => characterIds.includes(data.characterId) || Boolean(selected.imageHash && data.referenceHashes.includes(selected.imageHash))) : [];
  const rightsClaims = catalog?.drafts.filter(record => record.kind === 'universe-claim' && 'entityId' in record.data && record.data.entityId === selected?.id && 'title' in record.data && !/^Content guide\s*·/i.test(record.data.title) && /rights?|licen[cs]e|permission|ownership|copyright/i.test(`${record.data.title} ${record.data.body}`)) ?? [];
  async function createEntry() {
    if (!onCreateEntity || saving || !newName.trim()) return;
    const sourceScope = scope;
    const data = attempt.current ?? { schemaVersion: 1, ...universeDraftScope(project), entityId: `draft-${crypto.randomUUID()}`, type: newType, name: newName.trim(), summary: newSummary.trim(), imageHash: null, sceneIds: [], citations: [], status: 'DRAFT', review: 'PROPOSED' } satisfies UniverseEntityDraft;
    attempt.current = data; setSaving(true); setCreateError('');
    try { await onCreateEntity(data); if (currentScope.current !== sourceScope) return; setSelectedId(data.entityId); if (!productionProject) setView('bible'); setQuery(''); setFilter('all'); setGuidesOnly(false); setStorylineId(''); setNewName(''); setNewSummary(''); setCreating(false); attempt.current = null; setCreatedNotice(`${data.name} saved as an editable universe draft.`); }
    catch (caught) { if (currentScope.current === sourceScope) setCreateError(caught instanceof Error ? caught.message : 'Save was not confirmed. Retry the same draft.'); }
    finally { if (currentScope.current === sourceScope) setSaving(false); }
  }

  async function saveRightsClaim() {
    if (!rightsForm || !onSaveClaim || claimSaving || !rightsForm.title.trim() || !rightsForm.body.trim() || rightsForm.body === rightsTemplate || rightsForm.body.trim() === rightsForm.templateBody?.trim()) return;
    const sourceScope = scope;
    const data = claimAttempt.current ?? { schemaVersion: 1, ...universeDraftScope(project), entityId: rightsForm.entity.id, title: rightsForm.title.trim(), body: rightsForm.body.trim(), citations: rightsForm.purpose === 'bible' ? [] : rightsForm.entity.citations.slice(0, 32), status: 'DRAFT', review: rightsForm.review ?? 'PROPOSED' } satisfies UniverseClaimDraft;
    claimAttempt.current = data; setClaimSaving(true); setClaimError('');
    try { await onSaveClaim(data); if (currentScope.current !== sourceScope) return; setRightsForm(null); claimAttempt.current = null; setCreatedNotice(rightsForm.purpose === 'bible' ? 'Story bible note saved for review in this project.' : 'Licence note saved as a draft claim. Permission is not verified.'); }
    catch (caught) { if (currentScope.current === sourceScope) setClaimError(caught instanceof Error ? caught.message : 'The licence note save was not confirmed.'); }
    finally { if (currentScope.current === sourceScope) setClaimSaving(false); }
  }

  const activeEditor = continuityOpen ? 'Continuity' : profileEntity ? `${profileEntity.name} profile` : planEntity ? `${planEntity.name} production needs` : relationshipEntity ? `${relationshipEntity.name} relationship` : agentEntity ? `${agentEntity.name} rehearsal` : worldOpen ? 'World rehearsal' : rightsForm ? rightsForm.title : null;
  const editorView = continuityOpen ? 'continuity' : 'bible';

  function proposeBible(entity: UniverseEntity, prompt?: StoryBiblePrompt) {
    if (!onSaveClaim) { setCreatedNotice('Draft note saving is unavailable in this view.'); return; }
    if (rightsForm) { setCreatedNotice(`Finish or discard the open note for ${rightsForm.entity.name} before starting another.`); return; }
    const initial = { title: prompt?.title ?? `Story Bible · ${entity.name}`, body: prompt?.body ?? '', review: 'PROPOSED' as const };
    setRightsForm({ entity, ...initial, initial, templateBody: prompt?.body, purpose: 'bible' }); setClaimError(''); claimAttempt.current = null;
  }

  return <section data-view={view} data-bible-editing={Boolean(rightsForm)} className="universe-library" aria-label={`${project.title} story world`}>
    {activeEditor && view !== editorView && <div className="uni-editing-notice" role="status"><span>Open editor: {activeEditor}</span><button onClick={() => setView(editorView)}>Return to editor</button></div>}
    <div className="uni-layout">
      <aside className="uni-storylines" aria-label="Universe storylines">
        <span className="uni-eyebrow">STORY BIBLE</span><h2>Storylines</h2>
        <button className="uni-all-stories" aria-pressed={!storylineId} onClick={resetFilters}><Network size={17}/>All storylines<span>{catalog?.storylines.length ?? '—'}</span></button>
        <nav aria-label="Storyline filter">{catalog?.storylines.map((storyline, index) => <button key={storyline.id} aria-pressed={storylineId === storyline.id} onClick={() => { setStorylineId(storyline.id); setSelectedId(''); setQuery(''); }}><span className="uni-story-index">{String(index + 1).padStart(2, '0')}</span><span>{storyline.title}<small>{storyline.status === 'NO_SOURCE_MATCH' ? 'No matched source' : `${storyline.sourceIds.length} source${storyline.sourceIds.length === 1 ? '' : 's'}`}</small></span><ChevronRight size={13}/></button>)}</nav>
        <p className="uni-rail-note">Source groups · interpretations stay reviewable.</p>
        <button className="uni-source-entry" onClick={onOpenSources}><FolderOpen size={23}/><span><strong>Source library</strong><small>Originals · pages · assets</small></span><ChevronRight size={16}/></button>
      </aside>
      <main className="uni-workspace">
        <header className="uni-heading"><div><h2>{activeStoryline?.title ?? project.title}</h2><p>{productionProject ? 'Story, characters and places connected to your retained sources.' : 'Build characters, places and world rules as you develop the story.'}</p></div><div className="uni-view-switch" aria-label="Universe display"><button aria-pressed={view === 'slate'} onClick={() => { resetFilters(); setView('slate'); }}><Clapperboard size={16}/>Slate</button>{onCreateEntity && <button className="uni-create-trigger" disabled={Boolean(activeEditor)} title={activeEditor ? `Close ${activeEditor} before creating an entry` : undefined} aria-expanded={creating} onClick={() => setCreating(value => !value)}><Plus size={16}/>Create</button>}<button aria-pressed={view === 'map'} onClick={() => setView('map')}><Network size={16}/>Map</button><button aria-pressed={view === 'cards'} onClick={() => setView('cards')}><Grid2X2 size={16}/>Cards</button><button aria-pressed={view === 'bible'} onClick={() => setView('bible')}><BookOpen size={16}/>Story Bible</button><button aria-pressed={view === 'use'} onClick={() => setView('use')}><Clapperboard size={16}/>Story use</button>{onSaveContinuity && <button aria-pressed={view === 'continuity'} onClick={() => openContinuity()}><Workflow size={16}/>Continuity</button>}{onSaveRehearsal && <button aria-pressed={productionProject && worldOpen && view === 'bible'} onClick={openWorld}><Users size={16}/>World rehearsal</button>}</div></header>
        <div className="uni-tools" hidden={view === 'slate'}><label className="uni-search"><Search size={16}/><input type="search" aria-label="Search the universe" placeholder="Find entries, profile details or production needs…" value={query} onChange={event => { setQuery(event.target.value); setSelectedId(''); }}/>{query && <button aria-label="Clear universe search" onClick={() => setQuery('')}><X size={14}/></button>}</label><div className="uni-type-filters" aria-label="Entity type">{filters.map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setSelectedId(''); }}>{item.label}</button>)}<button className="uni-guides-filter" aria-label="Content guides" aria-pressed={guidesOnly} onClick={() => { setGuidesOnly(value => !value); setView('cards'); setQuery(''); setFilter('all'); setStorylineId(''); setSelectedId(''); }}>Content guides<span>{contentGuides.size}</span></button></div></div>
        {creating && <form className="uni-create" aria-label="Create universe entry" onSubmit={event => { event.preventDefault(); void createEntry(); }}><header><h3>Create in your universe</h3><span>Separate editable draft</span></header><div><label>Type<select aria-label="New universe entry type" value={newType} disabled={saving || Boolean(attempt.current)} onChange={event => setNewType(event.target.value as UniverseEntityType)}>{(['character','location','story','reference','group','world_rule','thematic_note'] as const).map(type => <option key={type} value={type}>{universeTypeLabel(type)}</option>)}</select></label><label>Name<input aria-label="New universe entry name" maxLength={240} value={newName} disabled={saving || Boolean(attempt.current)} onChange={event => setNewName(event.target.value)} required/></label></div><label>Description<textarea aria-label="New universe entry description" maxLength={8000} rows={3} value={newSummary} disabled={saving || Boolean(attempt.current)} onChange={event => setNewSummary(event.target.value)}/></label><p>Develop your own idea here. Sources and licence evidence can be recorded separately.</p>{createError && <p role="alert" className="uni-create-error">{createError} Retry keeps the same draft identity.</p>}<footer><button type="button" disabled={saving} onClick={() => { setCreating(false); setNewName(''); setNewSummary(''); setCreateError(''); attempt.current = null; }}>Discard draft input</button><button type="submit" disabled={saving || !newName.trim()}>{saving ? 'Saving…' : createError ? 'Retry save' : 'Save new entry'}</button></footer></form>}
        {createdNotice && <p className="uni-created" role="status">{createdNotice}<button onClick={() => setCreatedNotice('')} aria-label="Dismiss creation notice"><X size={12}/></button></p>}
        {continuityOpen && onSaveContinuity && catalog && <div className="uni-editor-host" hidden={view !== 'continuity'}><WorldContinuityPanel key={scope} project={project} model={catalog} initialEntityId={continuityEntry} initialMode={continuityMode} onSave={onSaveContinuity} onDirty={setContinuityDirty} onEntity={id => { openConnected(id); setView('bible'); }} onClose={() => { setContinuityOpen(false); setContinuityDirty(false); setView('bible'); }}/></div>}
        {planEntity && onSaveProductionPlan && catalog && <div className="uni-editor-host" hidden={view !== 'bible'}><WorldProductionPlanEditor key={`${scope}:${planEntity.id}`} project={project} model={catalog} entity={planEntity} onSave={onSaveProductionPlan} onOpenBudget={onOpenBudget} onDirty={setPlanDirty} onClose={() => { setPlanEntity(null); setPlanDirty(false); }}/></div>}
        {profileEntity && onSaveProfile && catalog && <div className="uni-editor-host" hidden={view !== 'bible'}><UniverseProfileEditor key={`${scope}:${profileEntity.id}`} project={project} model={catalog} entity={profileEntity} onSave={onSaveProfile} onDirty={setProfileDirty} onClose={() => { setProfileEntity(null); setProfileDirty(false); }}/></div>}
        {productionProject && agentEntity && onSaveAgent && catalog && <div className="uni-agent-editor uni-editor-host" hidden={view !== 'bible'}><CharacterAgentPanel key={`${scope}:${agentEntity.id}:${worldActor?.record.sha256 ?? 'individual'}`} project={productionProject} model={catalog} entity={agentEntity} rehearsalRecord={worldActor?.record} profileRecord={worldActor?.profile} onSave={onSaveAgent} onSaved={onAgentResult} onDirty={setAgentDirty} onClose={() => { setAgentEntity(null); setAgentDirty(false); setWorldActor(null); }}/></div>}
        {productionProject && worldOpen && onSaveRehearsal && catalog && <div className="uni-agent-editor uni-editor-host" hidden={view !== 'bible' || Boolean(agentEntity)}><WorldRehearsalPanel key={scope} project={productionProject} model={catalog} records={records} onSave={onSaveRehearsal} onRehearse={(record, entityId) => void rehearseInWorld(record, entityId)} onSetupCharacter={onSaveAgent ? entityId => { const entity = catalog.entities.find(item => item.id === entityId && item.type === 'character'); if (entity) openCharacterAgency(entity); } : undefined} onDirty={setWorldDirty} onClose={() => { worldLoad.current++; setWorldOpen(false); setWorldDirty(false); }}/></div>}
        {relationshipEntity && onSaveLink && catalog && <div className="uni-editor-host" hidden={view !== 'bible'}><UniverseRelationshipEditor key={`${scope}:${relationshipEntity.id}`} project={project} model={catalog} entity={relationshipEntity} onSave={onSaveLink} onDirty={setRelationshipDirty} onClose={() => { setRelationshipEntity(null); setRelationshipDirty(false); }}/></div>}
        {error && <div className="uni-message" role="alert"><p>{error}</p>{onRetry && <button onClick={onRetry}>Try again</button>}</div>}
        {loading && !catalog ? <div className="uni-empty" role="status"><Network size={34}/><h3>Reading your universe</h3><p>Connecting retained sources and screenplay observations.</p></div> : view === 'slate' && catalog ? <UniverseSlate project={project} records={records} catalog={catalog} storylineId={storylineId} onExplore={id => { resetFilters(); setStorylineId(id); setView('map'); }} onReadSource={onReadSource} onDevelop={onChooseContext} onOperation={onOperation}/> : view === 'continuity' ? null : !filtered.length ? <div className="uni-empty"><BookOpen size={34}/><h3>{entities.length ? 'No matching entries' : productionProject ? 'Your sources will appear here' : 'Start your Story Bible'}</h3><p>{entities.length ? 'Try another storyline, type or search.' : productionProject ? 'Open the source library to inspect the material retained for this project.' : 'Create a character, place or world rule. Add details and connections as your idea takes shape.'}</p><button onClick={entities.length ? resetFilters : !productionProject && onCreateEntity ? () => setCreating(true) : onOpenSources}>{entities.length ? 'Show all entries' : !productionProject && onCreateEntity ? 'Create first entry' : 'Open source library'}</button></div> : view === 'use' && catalog ? <WorldSceneUse model={catalog} entities={filtered} scenes={scenes} onEntity={id => { openConnected(id); setView('bible'); }} onPlan={onSaveProductionPlan ? openProductionPlan : undefined} onScene={onSceneSelect}/> : view === 'bible' && catalog ? <>{!agentEntity && !worldOpen && !profileEntity && !planEntity && !relationshipEntity && <StoryBiblePanel projectTitle={project.title} onContinuity={onSaveContinuity ? openContinuity : undefined} onPlanProduction={onSaveProductionPlan ? openProductionPlan : undefined} onOpenBudget={onOpenBudget} onAssistant={onAssistant ? entity => onAssistant(entity) : undefined} onEditProfile={onSaveProfile ? openProfile : undefined} onCharacterAgency={onSaveAgent ? openCharacterAgency : undefined} onDevelop={onChooseContext} model={catalog} selectedEntity={selected ?? null} scenes={scenes} onEntity={openConnected} onReadSource={citation => onReadSource?.(citation)} onScene={id => onSceneSelect?.(id)} onProposeClaim={proposeBible} onProposeRelationship={onSaveLink ? openRelationship : undefined}/>}</> : view === 'map' ? <>
          <div className="uni-map-tools" aria-label="World map navigation">
            <div role="group" aria-label="Map scope"><button aria-pressed={graphMode === 'all'} onClick={() => setGraphMode('all')}>All matching entries</button><button disabled={!selected || !filtered.some(entry => entry.id === selected.id)} aria-pressed={graphMode === 'connections'} onClick={() => { setGraphMode('connections'); setTab('connections'); }}>Selected & connections</button></div>
            <label>Find on map<select aria-label="Find entry on map" value={selected?.id ?? ''} onChange={event => { const entity = entities.find(item => item.id === event.target.value); if (entity) { select(entity); setGraphPage(0); setGraphMode('connections'); setTab('connections'); } }}><option value="" disabled>Choose an entry</option>{filtered.map(entity => <option key={entity.id} value={entity.id}>{entity.name} · {universeTypeLabel(entity.type)}</option>)}</select></label>
          </div>
          <p className="uni-map-context">{graphMode === 'connections' && graph.focus ? `Relationships recorded for ${graph.focus.name}.` : 'Characters, places and story rules from the same Story Bible.'} Select an entry to inspect its sources or develop it.</p>
          <div className="uni-map-scroll" aria-label="Universe map"><div className="uni-map-canvas" role="group" aria-label="Source-connected universe entries" style={{ width: `${100 * zoom}%`, aspectRatio: `${map.width} / ${map.height}`, minWidth: 560 * zoom }}>
            <svg viewBox={`0 0 ${map.width} ${map.height}`} width={map.width} height={map.height} preserveAspectRatio="none" aria-hidden="true">
              <defs><marker id={graphArrowId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#d6b780"/></marker><pattern id="uni-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="currentColor"/></pattern></defs><rect width={map.width} height={map.height} fill="url(#uni-dots)" className="uni-map-dots"/>
              {map.bands.map(band => <g key={band.title}><text x="24" y={band.y} className="uni-band-label">{band.title.toUpperCase()}</text><line x1="250" x2="882" y1={band.y - 4} y2={band.y - 4} className="uni-band-line"/></g>)}
              {map.links.map(link => { const active = link.fromEntityId === spotlight || link.toEntityId === spotlight; const sameRow = link.from.y === link.to.y; const x1 = link.from.x + link.from.width / 2, x2 = link.to.x + link.to.width / 2, y1 = link.from.y + link.from.height, y2 = sameRow ? y1 : link.to.y; const bend = sameRow ? y1 + 25 : (y1 + y2) / 2; return <path key={link.id} d={`M ${x1} ${y1} C ${x1} ${bend}, ${x2} ${bend}, ${x2} ${y2}`} markerEnd={`url(#${graphArrowId})`} className={`uni-map-edge ${active ? 'is-active' : ''} ${link.review !== 'OBSERVED' ? 'is-proposed' : ''}`}><title>{link.from.entity.name} → {link.to.entity.name}: {link.label} · {universeReviewLabel(link.review)}</title></path>; })}

            </svg>
            <div className="uni-map-nodes">
              {map.nodes.map(({ entity, x, y, width, height, featured, band }) => <button key={entity.id} style={{ left: `${x / map.width * 100}%`, top: `${y / map.height * 100}%`, width: `${width / map.width * 100}%`, height: `${height / map.height * 100}%` }} className={`uni-map-node uni-map-node-${band} ${featured ? 'is-focal' : ''} ${entity.id === selected?.id ? 'is-selected' : ''}`} aria-label={`Inspect ${entity.name}, ${universeTypeLabel(entity.type)}`} aria-pressed={entity.id === selected?.id} onClick={() => select(entity)} onMouseEnter={() => setHoveredId(entity.id)} onMouseLeave={() => setHoveredId('')} onFocus={() => setHoveredId(entity.id)} onBlur={() => setHoveredId('')}><EntityPortrait entity={entity} compact/><span className="uni-node-name" title={entity.name}>{universeMapName(entity, catalog?.storylines)}</span><span className="uni-node-meta"><FileText size={11}/>{entity.citations.length} citation{entity.citations.length === 1 ? '' : 's'}{entity.review !== 'OBSERVED' && <span> · {universeReviewLabel(entity.review)}</span>}</span></button>)}
            </div>
          </div></div>
          <div className="uni-map-footer"><div className="uni-legend"><span><i/>Source observation</span><span><i className="proposed"/>Proposed / review</span></div><div className="uni-zoom"><button aria-label="Zoom out universe map" disabled={zoom <= .75} onClick={() => setZoom(value => Math.max(.75, value - .25))}><Minus size={15}/></button><button aria-label="Fit universe map" onClick={() => setZoom(1)}><Maximize2 size={15}/><span>{Math.round(zoom * 100)}%</span></button><button aria-label="Zoom in universe map" disabled={zoom >= 1.75} onClick={() => setZoom(value => Math.min(1.75, value + .25))}><Plus size={15}/></button></div><div className="uni-map-pagination" aria-label="World map pages"><span>{map.nodes.length} of {graph.total} entries · {map.links.length} visible connections</span><button aria-label="Previous world map page" disabled={graph.page === 0} onClick={() => setGraphPage(graph.page - 1)}>Previous</button><span>{graph.page + 1} / {graph.pages}</span><button aria-label="Next world map page" disabled={graph.page + 1 >= graph.pages} onClick={() => setGraphPage(graph.page + 1)}>Next</button></div></div>
        </> : <div className="uni-cards" aria-label="Universe cards">{filtered.map(entity => <button key={entity.id} className="uni-card" aria-label={`Inspect ${entity.name}, ${universeTypeLabel(entity.type)}`} aria-pressed={entity.id === selected?.id} onClick={() => select(entity)}><EntityPortrait entity={entity}/><span className="uni-card-body"><small>{universeTypeLabel(entity.type)}</small><strong>{entity.name}</strong>{universeGuideSummary(contentGuides.get(entity.id)) ? <span className="uni-card-guide"><small>Draft content guide</small>{universeGuideSummary(contentGuides.get(entity.id))}</span> : <span>{entity.summary}</span>}<em><FileText size={12}/>{entity.citations.length} citation{entity.citations.length === 1 ? '' : 's'} · {universeReviewLabel(entity.review)}</em></span></button>)}</div>}
      </main>
      <aside hidden={view === 'slate' || view === 'use' || view === 'continuity' || (view === 'bible' && !rightsForm)} className="uni-inspector" aria-label="Universe inspector">
        {selected ? <><header><span className="uni-eyebrow">{universeTypeLabel(selected.type)}</span><h2>{selected.name}</h2></header>{view !== 'bible' && <div className="uni-entry-actions" aria-label="Develop selected world entry"><button onClick={() => setView('bible')}><BookOpen size={14}/>Open Story Bible</button>{onSaveProfile && <button onClick={() => openProfile(selected)}>Edit profile</button>}{onSaveLink && <button onClick={() => openRelationship(selected)}><Plus size={14}/>Add relationship</button>}{onSaveProductionPlan && <button onClick={() => openProductionPlan(selected)}>Production needs</button>}</div>}{view !== 'bible' && selected.type === 'character' && onSaveAgent && <button type="button" className="bible-propose" onClick={() => openCharacterAgency(selected)}>Character agency<ChevronRight size={14}/></button>}<div hidden={view === 'bible'}><EntityPortrait entity={selected}/></div><div hidden={view === 'bible'} className="uni-inspector-tabs" aria-label="Inspector section">{(['overview', 'connections', 'sources', 'rights'] as const).map(item => <button key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
          <div hidden={view === 'bible'} className="uni-inspector-body" key={`${selected.id}:${tab}`}>
            {tab === 'overview' && <><span className={`uni-review uni-review-${selected.review.toLowerCase()}`}>{selected.review === 'OBSERVED' ? <FileText size={12}/> : <Search size={12}/>} {universeReviewLabel(selected.review)}</span><p className="uni-summary">{selected.summary || 'Explore the linked sources for this entry.'}</p>{selected.imageHash && <p className="uni-quiet">Reference use requires review.</p>}{contentGuides.get(selected.id)?.map(guide => <section className="uni-content-guide" key={guide.id}><span className="uni-eyebrow">DRAFT CONTENT GUIDE</span><h3>{guide.data.title.replace(/^Content guide\s*·\s*/i, '') || selected.name}</h3><p>{guide.data.body}</p><details><summary>{guide.data.citations.length} source citation{guide.data.citations.length === 1 ? '' : 's'}</summary>{guide.data.citations.map((sourceCitation, index) => <CitationButton key={index} citation={sourceCitation} onReadSource={onReadSource}/>)}</details></section>)}{selected.artwork && <section className="uni-artwork-provenance"><h3>Concept artwork</h3><p>AI concept · placeholder. Appearance and production use remain unapproved.</p><details><summary>Prompt & provenance</summary><p className="uni-artwork-prompt">{selected.artwork.prompt}</p><dl><div><dt>Recorded generator</dt><dd>{selected.artwork.generator.tool}{selected.artwork.generator.model ? ` · ${selected.artwork.generator.model}` : ''}</dd></div><div><dt>Attribution</dt><dd>Recorded, not verified</dd></div><div><dt>Use scope</dt><dd>Concept only</dd></div></dl><small>Artwork record</small><code>{selected.artwork.recordRef.id}</code><small>Artwork bytes</small><code>{selected.artwork.imageHash}</code></details></section>}{selectionSceneIds.length > 0 && <section><h3>Appears in the screenplay</h3>{selectionSceneIds.map(id => { const scene = scenes.find(item => item.id === id)!; return <button className="uni-detail-link" key={id} onClick={() => { setSceneId(id); onSceneSelect?.(id); }}><span className="uni-scene-index">{String(scene.index).padStart(2, '0')}</span><span>{scene.heading}</span><ChevronRight size={13}/></button>; })}</section>}<section><h3>Source evidence</h3>{selected.citations.slice(0, 2).map((citation, index) => <CitationButton key={index} citation={citation} onReadSource={onReadSource}/>)}{selected.citations.length > 2 && <button className="uni-text-button" onClick={() => setTab('sources')}>View all {selected.citations.length} citations <ArrowRight size={12}/></button>}{!selected.citations.length && <p className="uni-quiet">No source citation retained for this proposal.</p>}</section>{catalog?.questions.filter(question => question.entityIds.includes(selected.id) && !catalog.drafts.some(draft => draft.id === question.id)).map(question => <p className="uni-question" key={question.id}><Search size={14}/>{question.text}</p>)}</>}
            {tab === 'connections' && <><h3>{connected.length} recorded connection{connected.length === 1 ? '' : 's'}</h3>{connected.map(link => { const otherId = link.fromEntityId === selected.id ? link.toEntityId : link.fromEntityId, other = entities.find(entity => entity.id === otherId); return <div className="uni-connection" key={link.id}><button onClick={() => openConnected(otherId)} disabled={!other}><Network size={15}/><span><strong>{other?.name ?? otherId}</strong><small>{link.fromEntityId === selected.id ? 'Outgoing' : 'Incoming'} · {link.label}</small></span><ChevronRight size={14}/></button><span>{universeReviewLabel(link.review)} · {link.citations.length} citations</span>{link.citations[0] && <CitationButton citation={link.citations[0]} onReadSource={onReadSource}/>}</div>; })}{!connected.length && <p className="uni-quiet">No evidence-bound connection is recorded yet.</p>}</>}
            {tab === 'sources' && <><h3>{selected.citations.length} source citation{selected.citations.length === 1 ? '' : 's'}</h3>{selected.citations.map((citation, index) => <div className="uni-citation-detail" key={index}><CitationButton citation={citation} onReadSource={onReadSource}/>{citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}<small>{citation.paragraphId ?? (citation.pageNumber ? `Page ${citation.pageNumber}` : citation.kind.replace(/_/g, ' ').toLowerCase())}</small></div>)}{!selected.citations.length && <p className="uni-quiet">This entry currently has no retained source citation.</p>}</>}
            {tab === 'rights' && <><h3>Reference use & licence notes</h3><p className="uni-quiet">These are recorded scopes and claims. A source file or a saved draft does not establish ownership or permission.</p>{referenceUses.map(({ record, data }) => <div key={record.id} className="uni-rights-record"><strong>{data.performer || 'Character reference candidate'}</strong><span>{data.useScope === 'INTERNAL_STORYBOARD_REFERENCE_ONLY' ? 'Internal storyboard reference only' : 'Film use requested · not confirmed'}</span><small>{data.evidenceHashes.length} evidence reference{data.evidenceHashes.length === 1 ? '' : 's'} recorded</small><code>{record.id}</code></div>)}{!referenceUses.length && <p className="uni-question">No matching reference-use record. Licence and ownership status are unconfirmed.</p>}{rightsClaims.map(record => 'title' in record.data && 'body' in record.data && <div key={record.id} className="uni-rights-record"><strong>{record.data.title}</strong><span>Draft claim · {universeReviewLabel(record.data.review)}</span><p>{record.data.body}</p>{record.data.citations.map((citation, index) => <CitationButton key={index} citation={citation} onReadSource={onReadSource}/>)}</div>)}{onSaveClaim && <button className="uni-action-secondary uni-rights-action" onClick={() => { if (!rightsForm) { setRightsForm({ entity: selected, title: 'Licence and permitted use (draft)', body: rightsTemplate, initial: { title: 'Licence and permitted use (draft)', body: rightsTemplate, review: 'PROPOSED' } }); claimAttempt.current = null; setClaimError(''); } }}>Write a licence note</button>}{onDevelopRights && <button className="uni-action-secondary uni-rights-action" onClick={() => onDevelopRights(selected)}>Develop rights research</button>}</>}
          </div>
          {rightsForm && <form className="uni-rights-editor" aria-label={rightsForm.purpose === 'bible' ? "Write story bible note" : "Write licence note"} onSubmit={event => { event.preventDefault(); void saveRightsClaim(); }}><h3>{rightsForm.purpose === 'bible' ? 'Story bible note' : 'Licence note'} · {rightsForm.entity.name}</h3><label>Title<input aria-label={rightsForm.purpose === 'bible' ? "Story bible note title" : "Licence note title"} value={rightsForm.title} maxLength={240} disabled={claimSaving || Boolean(claimAttempt.current)} onChange={event => setRightsForm({ ...rightsForm, title: event.target.value })}/></label><label>{rightsForm.purpose === 'bible' ? 'Character, world rule or continuity note' : 'Ownership, permitted use and evidence'}<textarea aria-label={rightsForm.purpose === 'bible' ? "Story bible note details" : "Licence note details"} placeholder={rightsForm.purpose === 'bible' ? rightsForm.entity.type === 'character' ? 'Goals and fears; what they know in this scene; relationships; limits; how they change; unanswered continuity questions.' : 'Rule or condition; where and when it applies; causes and consequences; costs and exceptions; what characters know; open questions.' : undefined} value={rightsForm.body} maxLength={8000} rows={7} disabled={claimSaving || Boolean(claimAttempt.current)} onChange={event => setRightsForm({ ...rightsForm, body: event.target.value })}/></label><p>{rightsForm.purpose === 'bible' ? 'Answer the prompts in your own words. Saved as a draft interpretation; supporting citations are not inferred.' : `Retained as a draft claim with ${rightsForm.entity.citations.length} source citations. This does not clear production use.`}</p>{rightsForm.purpose === 'bible' && <label>Review status<select aria-label="Story bible note review" value={rightsForm.review ?? 'PROPOSED'} disabled={claimSaving || Boolean(claimAttempt.current)} onChange={event => setRightsForm({ ...rightsForm, review: event.target.value as UniverseClaimDraft['review'] })}><option value="PROPOSED">Proposed</option><option value="QUESTIONED">Needs an answer</option><option value="SET_ASIDE">Set aside</option></select></label>}{claimError && <p role="alert">{claimError} Retry keeps the same claim.</p>}<footer><button type="button" disabled={claimSaving} onClick={() => { setRightsForm(null); setClaimError(''); claimAttempt.current = null; }}>Discard note input</button><button type="submit" disabled={claimSaving || !rightsForm.title.trim() || !rightsForm.body.trim() || rightsForm.body === rightsTemplate || rightsForm.body.trim() === rightsForm.templateBody?.trim()}>{claimSaving ? 'Saving…' : claimError ? (rightsForm.purpose === 'bible' ? 'Retry story bible note' : 'Retry licence note') : (rightsForm.purpose === 'bible' ? 'Save story bible note' : 'Save licence note')}</button></footer></form>}
          <div hidden={view === 'bible'} className="uni-inspector-actions">{onChooseContext && <button className="uni-action-secondary" onClick={() => onChooseContext(selected)}><Check size={15}/>Develop this entry</button>}{onCasting && selected.type === 'character' && <button className="uni-action-secondary" onClick={() => onCasting(selected)}><Users size={15}/>Open casting references</button>}{onAssistant && <button className="uni-action-assistant" onClick={() => onAssistant(selected)}><Sparkles size={15}/>Ask assistant about {selected.type === 'character' ? 'this character' : 'this entry'}</button>}</div>
        </> : <div className="uni-empty"><BookOpen size={32}/><h3>Select an entry</h3><p>Its connections and source evidence will appear here.</p></div>}
      </aside>
    </div>
    {productionProject && <section className="uni-film" aria-label="Universe screenplay scenes"><header><h3>{project.title} <span>· whole-film preparation</span></h3><button type="button" className="uni-film-toggle" aria-expanded={filmOpen} onClick={() => setFilmExpanded(!filmOpen)}>{filmOpen ? 'Hide scene strip' : 'Show scene strip'} · {scenes.length} scenes</button></header><div className="uni-filmstrip" hidden={!filmOpen}>{scenes.map(scene => { const candidates = cells.filter(cell => cell.sceneId === scene.id && cell.imageHash), cell = candidates.find(item => item.role === 'START') ?? candidates[0]; return <button key={scene.id} aria-label={`Select universe scene ${scene.index}: ${scene.heading}`} aria-pressed={activeScene?.id === scene.id} onClick={() => setSceneId(scene.id)}><div className="uni-film-still"><SceneStill cell={cell}/><span>{String(scene.index).padStart(2, '0')}</span></div><strong>{scene.heading}</strong><small>{cell ? `${cell.role === 'START' ? 'Start' : 'Moment'} reference · pending review` : 'Reference needed'}</small></button>; })}</div>{activeScene && <footer><span className="uni-selected-scene"><Clapperboard size={15}/>Scene {String(activeScene.index).padStart(2, '0')}<strong>{activeScene.heading}</strong></span><div>{onSceneSelect && <button onClick={() => onSceneSelect(activeScene.id)}><BookOpen size={15}/>Read scene</button>}{onNodes && <button onClick={() => onNodes(activeScene.id)}><Workflow size={15}/>Plan shots</button>}{onGenerate && <button className="uni-prepare" onClick={() => onGenerate(activeScene.id)}>Prepare selected scene<ArrowRight size={16}/></button>}</div></footer>}</section>}
    <footer className="uni-status"><span>{catalog ? `${catalog.coverage.retainedSources} retained sources · ${catalog.coverage.pagesWithText} pages with extracted text` : 'Local source library'}</span><span>Observations & drafts · {!productionProject ? 'project development' : project.sourceStatus === 'ADMITTED' ? 'screenplay admitted' : 'screenplay admission pending'}</span></footer>
  </section>;
}

function CitationButton({ citation, onReadSource }: { citation: UniverseCitation; onReadSource?: (citation: UniverseCitation) => void }) {
  return <button className="uni-citation" onClick={() => onReadSource?.(citation)} disabled={!onReadSource}><FileText size={14}/><span>{citation.label}<small>{citation.paragraphId ?? (citation.pageNumber ? `Page ${citation.pageNumber}` : citation.kind.startsWith('LORE') ? 'Retained research source' : 'Retained screenplay')}</small></span><ChevronRight size={13}/></button>;
}
