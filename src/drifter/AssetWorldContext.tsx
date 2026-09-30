import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, MapPin, Users } from 'lucide-react';
import type { Project } from './types';
import type { ProjectFileEntry } from './projectLibraryModel';
import type { UniverseCatalog } from './universeApi';
import { universeReviewLabel, universeTypeLabel } from './universeLibraryModel';
import { assetWorldEntries } from './assetWorldModel';
import './asset-world-context.css';

export default function AssetWorldContext({ project, entry, universe, loading, error, onOpenWorld, onReadLore }: {
  project: Project; entry?: ProjectFileEntry; universe?: UniverseCatalog; loading?: boolean; error?: string;
  onOpenWorld?(entityId: string): void;
  onReadLore(id: string, pageNumber?: number, citation?: { sha256: string; textSha256?: string }): void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [entry?.sha256, project.id, project.sourceHash]);
  const matches = useMemo(() => assetWorldEntries(project, entry, universe), [project, entry, universe]);
  if (!entry) return null;
  const valid = universe?.projectId === project.id && universe.sourceHash === project.sourceHash;
  return <section className="asset-world-context" aria-label="Asset world context">
    <header><BookOpen size={17}/><h4>In this world</h4>{valid && !loading && !error && <span>{matches.length} {matches.length === 1 ? 'entry' : 'entries'}</span>}</header>
    {loading ? <p role="status">Reading story-bible connections…</p> : error ? <p role="status">World connections could not be refreshed. Reopen Library to try again.</p> : !valid ? <p>World connections are unavailable for this project.</p> : !matches.length ? <p>No sourced world entry is linked to this file yet. Use Worlds & canon to develop its role.</p> : <>
      <p className="asset-world-scope">Source observations and working ideas. Review them in the Story Bible.</p>
      {(expanded ? matches : matches.slice(0, 6)).map(({ entity, basis, citations, statements, relationships }) => <article key={entity.id}>
        <div className="asset-world-title"><span aria-hidden="true">{entity.type === 'character' ? <Users size={15}/> : entity.type === 'location' ? <MapPin size={15}/> : <BookOpen size={15}/>}</span><button disabled={!onOpenWorld} onClick={() => onOpenWorld?.(entity.id)}>{entity.name}<ArrowUpRight size={13}/></button></div>
        <small>{/source-specific parsing candidate/i.test(entity.summary) ? `Parsing candidate · possible ${universeTypeLabel(entity.type).toLowerCase()}` : `${universeTypeLabel(entity.type)} · ${universeReviewLabel(entity.review)}`}{basis === 'CONCEPT' ? ' · AI concept only' : basis === 'REFERENCE' ? ' · linked visual reference' : ''}</small>
        <p className="asset-world-summary">{entity.summary || 'Open this entry to develop its world-building profile.'}</p>
        {statements.length > 0 && <section className="asset-world-notes"><h5>{statements.length} sourced {statements.length === 1 ? 'note' : 'notes'}</h5>{statements.map((statement, index) => <div key={index}><strong>{statement.title}</strong><small>{universeReviewLabel(statement.review as typeof entity.review)}</small><p>{statement.body}</p></div>)}</section>}
        {citations.some(citation => citation.kind.startsWith('LORE_')) && <div className="asset-world-pages" aria-label={`Sources for ${entity.name}`}>{citations.filter(citation => citation.kind.startsWith('LORE_')).slice(0, 5).map(citation => <button key={`${citation.sourceId}:${citation.pageNumber}`} onClick={() => onReadLore(citation.sourceId, citation.pageNumber ?? undefined, { sha256: citation.sourceSha256, ...(citation.textSha256 ? { textSha256: citation.textSha256 } : {}) })}>{citation.pageNumber ? `Read page ${citation.pageNumber}` : 'Read source'}</button>)}</div>}
        {relationships.length > 0 && <section className="asset-world-connections"><h5>{relationships.length} recorded {relationships.length === 1 ? 'connection' : 'connections'}</h5>{relationships.map((relationship, index) => <button className="asset-world-relation" key={`${relationship.id}:${index}`} disabled={!onOpenWorld} onClick={() => onOpenWorld?.(relationship.id)}><span>{relationship.label} → {relationship.name}</span><small>{universeReviewLabel(relationship.review as typeof entity.review)}</small></button>)}</section>}
      </article>)}
      {matches.length > 6 && <button className="asset-world-expand" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer entries' : `Show all ${matches.length} entries`}</button>}
    </>}
  </section>;
}
