import ProjectReadinessPanel from './ProjectReadinessPanel';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Clapperboard, Film, ImageOff, PencilLine, Sparkles, Workflow } from 'lucide-react';
import { blobUrl } from './api';
import { projectOverview } from './projectOverviewModel';
import { movieDeskNeeds, type MovieDeskNeed } from './movieDeskNeeds';
import type { Project, Scene, StoryCell, WorkspaceRecord } from './types';
import type { WorkbenchMode } from './workbenchModel';
import type { MovieWorkspaceView } from './movieWorkspaceRouting';
import './project-overview.css';
import './movie-desk-needs.css';

type Props = {
  active?: boolean; direction?: ReactNode; onUniverse?: () => void;
  onDocuments?: () => void; onBudget?: () => void; onConnections?: () => void; directionDirty?: boolean;
  onMovieView?: (view: MovieWorkspaceView, sceneId?: string) => void;
  project: Project; records: WorkspaceRecord[]; sceneId: string; sourceStatus?: string; activeDraftId?: string;
  onMode: (mode: WorkbenchMode) => void; onScene: (sceneId: string) => void;
  onStoryboard: (sceneId: string) => void; onGeneration: (sceneId: string) => void;
  onOpenDraft: (record: WorkspaceRecord) => void; onTakes?: (sceneId: string) => void;
};

export function SceneStill({ cell, alt = '' }: { cell?: StoryCell; alt?: string }) {
  const [size, setSize] = useState({ width: cell?.pixelWidth ?? 0, height: cell?.pixelHeight ?? 0 });
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); setSize({ width: cell?.pixelWidth ?? 0, height: cell?.pixelHeight ?? 0 }); }, [cell?.id, cell?.imageHash, cell?.pixelWidth, cell?.pixelHeight]);
  if (!cell?.imageHash || failed) return <div className="maker-still-empty"><ImageOff size={26} aria-hidden="true"/><span>{failed ? 'Reference unavailable' : 'Add a storyboard reference'}</span></div>;
  const crop = cell.crop;
  return <div className="maker-still" style={crop ? { aspectRatio: `${crop.width} / ${crop.height}`, height: 'auto' } : undefined}>
    <img src={blobUrl(cell.imageHash)} alt={alt} draggable={false} onError={() => setFailed(true)} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      style={crop && size.width && size.height ? { position: 'absolute', maxWidth: 'none', width: `${size.width / crop.width * 100}%`, height: `${size.height / crop.height * 100}%`, left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%` } : undefined}/>
  </div>;
}

function reference(project: Project, scene: Scene) {
  const candidates = project.cells.filter(cell => cell.sceneId === scene.id && cell.imageHash);
  return candidates.find(cell => cell.role === 'START') ?? candidates[0];
}

export default function StudioHome({ active = true, onUniverse, direction, onDocuments, onBudget, onConnections, directionDirty, onMovieView, project, records, sceneId, sourceStatus, activeDraftId, onMode, onScene, onStoryboard, onGeneration, onOpenDraft, onTakes }: Props) {
  const [deskView, setDeskView] = useState<'film' | 'production'>('film');
  const deskId = useId();
  const scene = project.scenes.find(item => item.id === sceneId) ?? project.scenes[0];
  const still = scene ? reference(project, scene) : undefined;
  const drafts = records.filter(record => record.kind === 'screenplay-draft');
  // Never infer the user's working script from database/list ordering.
  const draft = drafts.find(record => record.id === activeDraftId) ?? (drafts.length === 1 ? drafts[0] : undefined);
  const openScript = () => draft ? onOpenDraft(draft) : onMode(drafts.length ? 'drafts' : 'write');
  const briefCount = records.filter(record => record.kind === 'generation-brief').length;
  const paragraphCount = scene?.paragraphs.filter(p => ['Action', 'Dialogue'].includes(p.type)).length ?? 0;
  const overview = projectOverview(project, records);
  const needs = movieDeskNeeds(project, records).filter(need => (need.id !== 'world' || onUniverse) && (need.id !== 'budget' || onBudget));
  function openNeed(need: MovieDeskNeed) {
    if (need.id === 'logline') onMode('pitch');
    else if (need.id === 'world') onUniverse?.();
    else if (need.id === 'budget') onBudget?.();
    else if (need.id === 'screenplay') openScript();
    else if (need.id === 'frames' && need.sceneId) { if (onMovieView) onMovieView('storyboard', need.sceneId); else onStoryboard(need.sceneId); }
    else if (need.sceneId) { onScene(need.sceneId); onMode('scenes'); }
  }
  return <section className="maker-home" aria-label="Project pipeline">
    <div className="maker-project-heading"><div className="maker-title-group">{still && <figure className="maker-project-cover"><SceneStill cell={still} alt={`Selected scene ${scene.index} storyboard reference`}/></figure>}<div><span className="eyebrow">WHOLE PROJECT · SAVED ON THIS MAC</span><h2>{project.title}</h2><p>{project.scenes.length} retained scenes <span>·</span> {project.scenes.reduce((sum, item) => sum + item.shots.length, 0)} planned shots <span>·</span> {project.characters.length} characters</p></div></div><button className="secondary" onClick={openScript}><PencilLine size={15} aria-hidden="true"/>{!draft && drafts.length ? 'Choose script' : 'Open script'}<ArrowRight size={15} aria-hidden="true"/></button></div>
    {direction && <div className="maker-desk-views" role="tablist" aria-label="Movie desk workspace"><button role="tab" id={`${deskId}-film-tab`} aria-controls={`${deskId}-film`} aria-selected={deskView === 'film'} onClick={() => setDeskView('film')}>Film & shots</button><button role="tab" id={`${deskId}-production-tab`} aria-controls={`${deskId}-production`} aria-selected={deskView === 'production'} onClick={() => setDeskView('production')}>Production plan{directionDirty ? ' · Unsaved edits' : ''}</button><span>One film · shared screenplay, assets and production records</span></div>}
    <div id={`${deskId}-film`} role={direction ? 'tabpanel' : undefined} aria-labelledby={direction ? `${deskId}-film-tab` : undefined} hidden={deskView !== 'film'}>
    {needs.length > 0 && <section className="maker-data-needs" aria-label="Details to develop"><div className="maker-next-heading"><h3>Fill in the next details</h3><span>From this film’s saved records. Open a tool to develop the missing information.</span></div><div className="maker-next-list">{needs.slice(0, 4).map(need => <button key={need.id} type="button" onClick={() => openNeed(need)}><PencilLine size={18} aria-hidden="true"/><span><strong>{need.title}</strong><small>{need.detail}</small></span><ArrowRight size={18} aria-hidden="true"/></button>)}</div><p className="maker-data-needs-note">{needs.length > 4 ? `${needs.length - 4} more ${needs.length - 4 === 1 ? 'step follows' : 'steps follow'} as these details are saved. ` : ''}Starter prompts, not an exhaustive checklist. Character arcs, other world details and production review remain in their workspaces.</p></section>}
    <ProjectReadinessPanel active={active && deskView === 'film'} onDocuments={onDocuments} project={project} records={records} onMode={onMode} onScene={onScene} onOpenSceneWork={item => {
      if (!item.initialFramePresent) { if (onMovieView) onMovieView('storyboard', item.sceneId); else onStoryboard(item.sceneId); }
      else if (!item.briefsWithCurrentSceneBasis) onGeneration(item.sceneId);
      else if ((!item.measuredTakes || !item.keptCandidates) && onTakes) onTakes(item.sceneId);
      else if (onMovieView) onMovieView('timeline', item.sceneId);
      else { onScene(item.sceneId); onMode('scenes'); }
    }}/>
    <div className="maker-overview-heading"><div><h3>The whole film</h3><p>Scenes in screenplay order. Choose a scene to continue its shots.</p></div><button className="text-link" onClick={() => onMovieView ? onMovieView('timeline', scene?.id) : onMode('nodes')}>Open movie timeline<ArrowRight size={14} aria-hidden="true"/></button></div>
    <div className="maker-scene-strip maker-film-grid" role="navigation" aria-label="Movie desk scenes">{overview.scenes.map(({ scene: item, referenceCount, takeCount, contextCount, hasGraph }) => <button key={item.id} aria-pressed={scene?.id === item.id} aria-label={`Preview scene ${item.index}: ${item.heading}`} onClick={() => onScene(item.id)}><div className="maker-strip-image"><SceneStill cell={reference(project, item)}/><span>{String(item.index).padStart(2, '0')}</span></div><strong>{item.heading}</strong><small>{item.shots.length} shots · {referenceCount} refs · {takeCount} takes</small><span className="maker-scene-records">{hasGraph ? 'Graph saved' : 'No saved graph'}{contextCount > 0 ? ` · ${contextCount} context selections` : ''}</span></button>)}</div>
    {scene ? <div className="maker-scene-desk maker-selected-scene"><figure className="maker-preview"><div className="maker-preview-image" key={still?.id ?? scene.id}><SceneStill cell={still} alt={`Storyboard reference for scene ${scene.index}`}/><span className="maker-preview-badge"><Film size={13} aria-hidden="true"/>Storyboard reference</span></div><figcaption><span>{still ? `${still.role === 'START' ? 'Starting frame candidate' : 'Moment reference'} · review pending` : 'No reference image yet'}</span><span>Scene {String(scene.index).padStart(2, '0')}</span></figcaption></figure><div className="maker-scene-detail"><span className="eyebrow">SELECTED SCENE · {String(scene.index).padStart(2, '0')}</span><h3>{scene.heading}</h3><p>{scene.shots.length} planned shots · {paragraphCount} action and dialogue paragraphs</p><div className="maker-primary-actions"><button className="secondary" onClick={() => onMovieView ? onMovieView('storyboard', scene.id) : onStoryboard(scene.id)}><Clapperboard size={17} aria-hidden="true"/>Open storyboard<ArrowRight size={16} aria-hidden="true"/></button><button className="secondary" onClick={() => { if (onMovieView) onMovieView('connections', scene.id); else { onScene(scene.id); onMode('nodes'); } }}><Workflow size={17} aria-hidden="true"/>Open scene nodes<ArrowRight size={16} aria-hidden="true"/></button><button className="secondary" onClick={() => onGeneration(scene.id)}><Sparkles size={16} aria-hidden="true"/>Prepare AI clip<ArrowRight size={16} aria-hidden="true"/></button></div><button className="text-link" onClick={() => { onScene(scene.id); onMode('scenes'); }}>Read source & map shots <ArrowRight size={14} aria-hidden="true"/></button></div></div> : <p className="canis-empty">No retained scenes. Start in the script editor to develop a separate draft.</p>}
    <section className="maker-project-library-entry" aria-label="Whole project library"><BookOpen size={23} aria-hidden="true"/><div><h3>Project files & assets</h3><small>{overview.assetCount} project files · {overview.loreCount} lore sources · {overview.draftCount} saved writing drafts</small></div><div className="maker-library-actions">{onUniverse && <button className="text-link" onClick={onUniverse}>Universe & slate<ArrowRight size={16} aria-hidden="true"/></button>}<button className="text-link" onClick={() => onMode('library')}>Browse project library<ArrowRight size={16} aria-hidden="true"/></button></div></section>
    <nav className="maker-project-resources" aria-label="Project production resources">{onDocuments && <button onClick={onDocuments}>Production documents <span>Build, review & export</span></button>}{onBudget && <button onClick={onBudget}>Film budget <span>Estimates, commitments & actuals</span></button>}<button onClick={() => onMode('pitch')}>Project pitch <span>Story, audience & package</span></button>{onConnections && <button onClick={onConnections}>Tools & connections <span>Local software & providers</span></button>}</nav>
    </div>
    {direction && <div id={`${deskId}-production`} role="tabpanel" aria-labelledby={`${deskId}-production-tab`} hidden={deskView !== 'production'}>{direction}</div>}
    <footer className="maker-home-footer"><span>{(sourceStatus ?? project.sourceStatus) === 'ADMITTED' ? 'Source admitted' : 'Source awaiting owner admission'}</span><span>{briefCount} saved clip drafts · generation execution separate</span></footer>
  </section>;
}
