import type { ProjectFileEntry } from './projectLibraryModel';
import type { Project } from './types';
import type { UniverseCatalog, UniverseCitation, UniverseEntity } from './universeApi';

export interface AssetWorldEntry {
  entity: UniverseEntity;
  basis: 'SOURCE' | 'REFERENCE' | 'CONCEPT';
  citations: UniverseCitation[];
  statements: { title: string; body: string; review: string }[];
  relationships: { id: string; label: string; name: string; review: string }[];
}

/** Project verified observations by exact record/file identity, never name similarity. */
export function assetWorldEntries(project: Project, entry: ProjectFileEntry | undefined, universe: UniverseCatalog | undefined): AssetWorldEntry[] {
  if (!entry || !universe || universe.projectId !== project.id || universe.sourceHash !== project.sourceHash) return [];
  const references = new Map(entry.lore.map(record => [record.id, record.sha256]));
  if (entry.asset) references.set(entry.asset.id, entry.asset.sha256);
  const matches = (citation: UniverseCitation) => citation.sourceHash === project.sourceHash
    && ['ASSET_IMAGE', 'LORE_SOURCE', 'LORE_PAGE'].includes(citation.kind)
    && references.get(citation.sourceId) === citation.sourceSha256;
  const results: AssetWorldEntry[] = [];
  for (const entity of universe.entities) {
    const statements = universe.drafts.filter(record => record.kind === 'universe-claim'
      && record.data.sourceHash === project.sourceHash && 'entityId' in record.data && record.data.entityId === entity.id
      && record.data.citations.some(matches));
    const citations = [...entity.citations.filter(matches), ...statements.flatMap(record => record.data.citations.filter(matches))];
    const reference = entity.imageHash === entry.sha256;
    const concept = entity.artwork?.imageHash === entry.sha256 && entry.asset?.id === entity.artwork.assetRef.id && entry.asset.sha256 === entity.artwork.assetRef.sha256;
    if (!citations.length && !reference && !concept) continue;
    const unique = [...new Map(citations.map(citation => [`${citation.kind}:${citation.sourceId}:${citation.sourceSha256}:${citation.pageNumber}`, citation])).values()];
    const relationships = universe.links.filter(link => link.fromEntityId === entity.id || link.toEntityId === entity.id).flatMap(link => {
      const related = universe.entities.find(item => item.id === (link.fromEntityId === entity.id ? link.toEntityId : link.fromEntityId));
      return related ? [{ id: related.id, label: link.label, name: related.name, review: link.review }] : [];
    });
    results.push({ entity, basis: reference ? 'REFERENCE' : concept ? 'CONCEPT' : 'SOURCE', citations: unique,
      statements: statements.flatMap(record => 'title' in record.data && 'body' in record.data ? [{ title: record.data.title, body: record.data.body, review: record.data.review }] : []), relationships });
  }
  const rank = (item: AssetWorldEntry) => item.entity.type === 'story' ? 0
    : item.entity.origin === 'USER_AUTHORED' || item.entity.id.startsWith('guide-') ? 1
    : /source-specific parsing candidate/i.test(item.entity.summary) ? 4
    : item.entity.type === 'character' ? 2 : 3;
  return results.sort((a, b) => rank(a) - rank(b) || a.entity.type.localeCompare(b.entity.type) || a.entity.name.localeCompare(b.entity.name));
}
