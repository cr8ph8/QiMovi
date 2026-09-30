import { Clapperboard, PanelRight, RefreshCw } from 'lucide-react';
import StudioNavigation from './StudioNavigation';
import QiMoviBrand from './QiMoviBrand';
import type { WorkbenchMode } from './workbenchModel';
import type { MovieWorkspaceContext } from './movieWorkspaceRouting';
import './studio-header.css';

export interface StudioHeaderProps {
  projectTitle: string; mode: WorkbenchMode; busy: boolean; dirty: boolean;
  writingDirty?: boolean; production?: boolean; hidden?: boolean;
  movieContext?: MovieWorkspaceContext;
  onMode: (mode: WorkbenchMode) => void;
  onProduction: () => void; onDcc: () => void; onGeneration?: () => void;
  onAssistant?: () => void; onModels?: () => void; onBudget?: () => void; onRefresh?: () => void;
  onCasting?: () => void; onTakes?: () => void; onDocuments?: () => void; onChooseContext?: () => void; onEditors?: () => void;
  onProjectDetails?: () => void; projectDetailsOpen?: boolean; onStoryboard?: () => void; onClose?: () => void;
  unsavedAreas?: { id: string; label: string; onOpen: () => void }[];
}

/** Shared navigation only. Editors keep their own mounted state and save rules. */
export default function StudioHeader({ projectTitle, mode, movieContext, busy, dirty, writingDirty = dirty, production = false, hidden = false, onMode, onProduction, onDcc, onGeneration, onAssistant, onModels, onBudget, onRefresh, onProjectDetails, projectDetailsOpen, onStoryboard, onClose, onCasting, onTakes, onDocuments, onChooseContext, onEditors, unsavedAreas = [] }: StudioHeaderProps) {
  return <header className={`canis-shell-header studio-shared-header${production ? ' studio-header studio-production-header' : ''}`} hidden={hidden} data-unsaved={dirty ? 'true' : 'false'}>
    <StudioNavigation onBudget={onBudget} mode={mode} movieContext={movieContext} busy={busy} dirty={writingDirty} onMode={onMode} onProduction={onProduction} onDcc={onDcc} onGeneration={onGeneration} onCasting={onCasting} onTakes={onTakes} onDocuments={onDocuments} onChooseContext={onChooseContext} onEditors={onEditors} onAssistant={onAssistant}/>
    <div className="canis-brand-bar">
      <QiMoviBrand/>
      <button className="canis-project" title="Open the movie desk" onClick={() => onMode('pipeline')} disabled={busy}>{projectTitle}</button>
      <div className="canis-shell-utilities">
        <span className="canis-local-status"><i/>{dirty ? 'Unsaved edits on this Mac' : 'Local workspace'}</span>
        {onBudget && <button className="maker-film-button" onClick={onBudget}>Budget</button>}
        {onModels && <button className="maker-film-button" onClick={onModels}>Models</button>}
        {onRefresh && <button className="maker-icon-button" aria-label="Refresh saved records" title="Refresh saved records" disabled={busy} onClick={onRefresh}><RefreshCw size={16}/>Refresh</button>}
        {onProjectDetails && <button className="maker-icon-button" aria-label="Project details" title="Project details" aria-expanded={projectDetailsOpen} aria-controls="maker-project-details" onClick={onProjectDetails}><PanelRight size={17}/>Project details</button>}
        {(onStoryboard || onClose) && <button className="maker-film-button" aria-label={onStoryboard ? "Open movie storyboard" : "Close screenwriting"} disabled={busy} onClick={onStoryboard ?? onClose}><Clapperboard size={15} aria-hidden="true"/>Storyboard</button>}
      </div>
    </div>
    {dirty && unsavedAreas.length > 0 && <div className="studio-unsaved-links" aria-label="Open unsaved drafts"><span>Continue editing:</span>{unsavedAreas.map(area => <button key={area.id} type="button" disabled={busy} onClick={area.onOpen}>{area.label}</button>)}</div>}
  </header>;
}
