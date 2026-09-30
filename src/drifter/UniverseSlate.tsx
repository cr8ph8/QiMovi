import { useMemo } from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';
import type { LoreSource, Project, WorkspaceProject, WorkspaceRecord } from './types';
import type { UniverseCatalog, UniverseCitation, UniverseEntity, UniverseStoryline } from './universeApi';
import './universe-slate.css';

export type UniverseOperation = 'overview' | 'writing' | 'planning' | 'casting' | 'storyboard' | 'generation' | 'camera' | 'timeline' | 'comic' | 'documents' | 'marketing' | 'delivery' | 'assets' | 'models' | 'assistant';

export interface UniverseSlateProps {
  project: WorkspaceProject;
  records: WorkspaceRecord[];
  catalog: UniverseCatalog;
  storylineId?: string;
  onExplore: (storylineId: string) => void;
  onReadSource?: (citation: UniverseCitation) => void;
  onDevelop?: (entity: UniverseEntity) => void;
  onOperation?: (operation: UniverseOperation) => void;
}

type SourceRecord = WorkspaceRecord & { data: LoreSource };
const stages: { name: string; operations: { id: UniverseOperation; label: string }[] }[] = [
  { name: 'Develop', operations: [{ id: 'writing', label: 'Write screenplay' }, { id: 'planning', label: 'Plan story' }] },
  { name: 'Prepare', operations: [{ id: 'casting', label: 'Cast & references' }, { id: 'storyboard', label: 'Storyboards' }] },
  { name: 'Produce', operations: [{ id: 'generation', label: 'Generate & import' }, { id: 'camera', label: 'Camera & 3D' }] },
  { name: 'Finish', operations: [{ id: 'timeline', label: 'Timeline & editors' }, { id: 'comic', label: 'Storyboard comics' }, { id: 'documents', label: 'Production documents' }] },
  { name: 'Release', operations: [{ id: 'marketing', label: 'Marketing & pitch' }, { id: 'delivery', label: 'Delivery & review' }] },
];
const studioOperations: { id: UniverseOperation; label: string }[] = [
  { id: 'assets', label: 'Assets & rights' }, { id: 'models', label: 'Models & connectors' }, { id: 'assistant', label: 'AI assistant' },
];
const secondaryDocument = /\[project administration\]|\[derived rtf|writers[’']? guild|registration (?:record|certificate|receipt)|screenplay\s*iq|\banalysis\b|\breport\b|\bcoverage\b/i;

function representativeSource(storyline: UniverseStoryline, entities: UniverseEntity[], sources: Map<string, SourceRecord>, project: WorkspaceProject) {
  const candidates = entities.flatMap(entity => {
    if (entity.type !== 'story' || secondaryDocument.test(entity.name)) return [];
    return entity.citations.flatMap(citation => {
      if (citation.sourceHash !== project.sourceHash) return [];
      if (entity.origin === 'SCREENPLAY' && citation.sourceId === project.id && citation.sourceSha256 === project.sourceHash && ['SOURCE_SCENE', 'SOURCE_PARAGRAPH'].includes(citation.kind) && citation.sceneId && storyline.sceneIds.includes(citation.sceneId) && (project.scenes as Project['scenes']).some(scene => scene.id === citation.sceneId)) {
        return [{ entity, citation, score: 1000, title: project.title }];
      }
      const record = sources.get(citation.sourceId);
      if (!record || !['LORE_SOURCE', 'LORE_PAGE'].includes(citation.kind) || record.sha256 !== citation.sourceSha256 || secondaryDocument.test(`${record.data.title} ${record.data.originalFilename}`)) return [];
      const pages = record.data.extraction?.pageCount ?? 0;
      // A navigation preference, never an admission or choice of canonical draft.
      const score = (record.data.documentType === 'PDF' ? 20 : 0) + (pages >= 50 ? 10 : 0) + (/default branch|\bdraft\b|screenplay|script/i.test(record.data.title) ? 5 : 0) + Math.min(pages, 200) / 1000;
      return [{ entity, citation, score, title: record.data.title }];
    });
  });
  return candidates.sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id))[0];
}

export default function UniverseSlate({ project, records, catalog, storylineId, onExplore, onReadSource, onDevelop, onOperation }: UniverseSlateProps) {
  const rows = useMemo(() => {
    const sources = new Map(records.filter((record): record is SourceRecord => record.kind === 'lore-source' && (record.data as LoreSource).sourceHash === project.sourceHash).map(record => [record.id, record]));
    const entitiesById = new Map(catalog.entities.map(entity => [entity.id, entity]));
    const activeScenes = new Set(project.scenes.map(scene => scene.id));
    return catalog.storylines.map(storyline => {
      const members = [...new Set(storyline.entityIds)].flatMap(id => entitiesById.has(id) ? [entitiesById.get(id)!] : []);
      return {
        storyline,
        sourceCount: new Set(storyline.sourceIds.filter(id => sources.has(id))).size,
        characterCount: members.filter(entity => entity.type === 'character').length,
        placeCount: members.filter(entity => entity.type === 'location').length,
        active: storyline.sceneIds.some(id => activeScenes.has(id)),
        source: representativeSource(storyline, members, sources, project),
      };
    });
  }, [project, records, catalog]);
  const operation = ({ id, label }: { id: UniverseOperation; label: string }) => onOperation
    ? <button key={id} type="button" onClick={() => onOperation(id)}>{label}<ChevronRight size={13} aria-hidden="true"/></button>
    : <span key={id} className="uni-slate-unavailable">{label}</span>;

  return <section className="uni-slate" aria-label="Universe slate">
    <section className="uni-slate-collections" aria-label="Story collections">
      <header className="uni-slate-section-heading">
        <h3>Story collections</h3>
        <p>{rows.length} titles · {catalog.coverage.retainedSources} retained sources</p>
      </header>
      <p className="uni-slate-scope">Explore the full universe. Title groups organize sources; character and place candidates still need review.</p>
      <ol className="uni-slate-stories">
        {rows.map(({ storyline, sourceCount, characterCount, placeCount, active, source }, index) => <li key={storyline.id} className={storylineId === storyline.id ? 'is-selected' : ''}>
          <span className="uni-slate-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <div className="uni-slate-story-body">
            <button className="uni-slate-open" type="button" aria-label={`Open storyline: ${storyline.title}`} onClick={() => onExplore(storyline.id)}><strong>{storyline.title}</strong><ArrowRight size={15} aria-hidden="true"/></button>
            <p className={`uni-slate-story-status ${active ? 'is-active' : ''}`}>{active ? 'Active production · retained screenplay' : 'Source collection'}<span> · {sourceCount} retained {sourceCount === 1 ? 'source' : 'sources'}</span></p>
            <p className="uni-slate-candidates">{characterCount} character {characterCount === 1 ? 'candidate' : 'candidates'} · {placeCount} place {placeCount === 1 ? 'candidate' : 'candidates'}</p>
          </div>
          {source && (onReadSource || onDevelop) && <details className="uni-slate-source">
            <summary aria-label={`Source options for ${storyline.title}`}>Source</summary>
            <div className="uni-slate-source-body">
              <strong>{source.title}</strong>
              <p>Reference for this collection; other versions remain in Sources.</p>
              <small>{source.citation.label}{source.citation.pageNumber !== null ? ` · p. ${source.citation.pageNumber}` : ''}</small>
              {onReadSource && <button type="button" onClick={() => onReadSource(source.citation)}>Read exact source</button>}
              {onDevelop && <button type="button" onClick={() => onDevelop(source.entity)}>Develop from this source</button>}
            </div>
          </details>}
        </li>)}
      </ol>
      {catalog.coverage.candidateLimitReached && <p className="uni-slate-scope uni-slate-index-note">The candidate index reached its limit. Retained sources remain available; this is a partial character and place index.</p>}
      {rows.length === 0 && <p className="uni-slate-scope">No title collections are available in the current catalog.</p>}
    </section>
    <aside className="uni-slate-operations" aria-label={`Operations for ${project.title}`}>
      <header className="uni-slate-section-heading">
        <span className="uni-slate-eyebrow">Working film</span>
        <h3>{project.title}</h3>
        <p>{project.scenes.length} scenes · {(project.scenes as Project['scenes']).reduce((count, scene) => count + scene.shots.length, 0)} planned shots</p>
      </header>
      <p className="uni-slate-scope">These tools open {project.title}. Exploring another collection keeps the working film unchanged.</p>
      <div className="uni-slate-overview">{operation({ id: 'overview', label: 'Film status & next steps' })}</div>
      <ol className="uni-slate-stages">
        {stages.map((stage, index) => <li key={stage.name}>
          <span className="uni-slate-stage-number" aria-hidden="true">{index + 1}</span>
          <div><h4>{stage.name}</h4><div className="uni-slate-operation-links">{stage.operations.map(operation)}</div></div>
        </li>)}
      </ol>
      <footer className="uni-slate-studio"><h4>Across the film</h4><div className="uni-slate-operation-links">{studioOperations.map(operation)}</div></footer>
      {!onOperation && <p className="uni-slate-scope">Operation navigation is unavailable in this view.</p>}
    </aside>
  </section>;
}
