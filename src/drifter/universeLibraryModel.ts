import type { UniverseCatalog, UniverseClaimDraft, UniverseEntity, UniverseLink, UniverseStoryline } from './universeApi';

export type UniverseFilter = 'all' | 'character' | 'location' | 'story' | 'world';
export const universeTypeLabel = (type: UniverseEntity['type']) => ({ character: 'Character', location: 'Place', story: 'Story', reference: 'Reference', group: 'Group', world_rule: 'World rule', thematic_note: 'Theme' }[type]);
export const universeReviewLabel = (review: UniverseEntity['review']) => ({ OBSERVED: 'Source observation', PROPOSED: 'Proposed', QUESTIONED: 'Needs review', SET_ASIDE: 'Set aside' }[review]);
export function universeMonogram(name: string) {
  const words = name.replace(/^(the|after-life)\s*[:–—-]?\s*/i, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? name).slice(0, 2)).toUpperCase();
}
export function universeMapName(entity: UniverseEntity, storylines: UniverseStoryline[] = []) {
  if (entity.type !== 'story' || entity.origin === 'SCREENPLAY' || /\[project administration\]/i.test(entity.name)) return entity.name;
  const matches = storylines.filter(storyline => entity.storylineIds.includes(storyline.id));
  return matches.length === 1 ? matches[0].title : entity.name;
}
export function universeContentGuides(catalog?: UniverseCatalog) {
  const guides = new Map<string, { id: string; sha256: string; data: UniverseClaimDraft }[]>();
  for (const record of catalog?.drafts ?? []) {
    if (record.kind !== 'universe-claim' || !('title' in record.data) || !('body' in record.data) || !/^Content guide\s*·/i.test(record.data.title)) continue;
    const existing = guides.get(record.data.entityId) ?? [];
    existing.push({ id: record.id, sha256: record.sha256, data: record.data });
    guides.set(record.data.entityId, existing);
  }
  return guides;
}
export function universeGuideSummary(guides?: { data: UniverseClaimDraft }[]) {
  return guides?.[0]?.data.body.split(/\r?\n/).map(line => line.trim()).find(Boolean)?.replace(/^#{1,6}\s+/, '').slice(0, 240) ?? '';
}
export function filterUniverse(entities: UniverseEntity[], query: string, type: UniverseFilter, storylineId: string) {
  const needle = query.trim().toLocaleLowerCase();
  return entities.filter(entity => (!storylineId || entity.storylineIds.includes(storylineId))
    && (type === 'all' || (type === 'world' ? !['character', 'location', 'story'].includes(entity.type) : entity.type === type))
    && (!needle || `${entity.name} ${entity.summary} ${entity.citations.map(citation => citation.label).join(' ')}`.toLocaleLowerCase().includes(needle)));
}

/** A bounded view over every matching record; paging never changes stored identity. */
export function universeGraphPage(entities: UniverseEntity[], links: UniverseLink[], focusId: string | null, page = 0, size = 18) {
  const pageSize = Math.max(2, Math.min(36, Math.floor(size) || 18));
  const unique = [...new Map(entities.map(entity => [entity.id, entity])).values()];
  const focus = focusId ? unique.find(entity => entity.id === focusId) : undefined;
  const neighborIds = new Set(links.flatMap(link => link.fromEntityId === focus?.id ? [link.toEntityId] : link.toEntityId === focus?.id ? [link.fromEntityId] : []));
  const candidates = focus ? unique.filter(entity => entity.id !== focus.id && neighborIds.has(entity.id)) : unique;
  const stride = focus ? pageSize - 1 : pageSize;
  const pages = Math.max(1, Math.ceil(candidates.length / stride));
  const current = Math.max(0, Math.min(pages - 1, Math.floor(page) || 0));
  const visible = [...(focus ? [focus] : []), ...candidates.slice(current * stride, (current + 1) * stride)];
  return { entities: visible, page: current, pages, total: candidates.length + (focus ? 1 : 0), focus };
}

/** Category bands retain every supplied entry; the caller owns bounded paging. */
export function universeMapLayout(entities: UniverseEntity[], links: UniverseLink[]) {
  const width = 900;
  type MapNode = { entity: UniverseEntity; x: number; y: number; width: number; height: number; featured: boolean; band: 'character' | 'world' | 'story' };
  const nodes: MapNode[] = [], bands: { title: string; y: number }[] = [];
  let top = 24;
  const groups = [
    { title: 'Characters', band: 'character' as const, entries: entities.filter(entity => entity.type === 'character') },
    { title: 'Places, groups & world rules', band: 'world' as const, entries: entities.filter(entity => !['character', 'story'].includes(entity.type)) },
    { title: 'Stories', band: 'story' as const, entries: entities.filter(entity => entity.type === 'story') },
  ];
  for (const group of groups) {
    if (!group.entries.length) continue;
    bands.push({ title: group.title, y: top });
    group.entries.forEach((entity, index) => nodes.push({ entity, x: 20 + (index % 4) * 220, y: top + 20 + Math.floor(index / 4) * 140,
      width: 200, height: 105, featured: false, band: group.band }));
    top += Math.ceil(group.entries.length / 4) * 140 + 34;
  }
  const nodeMap = new Map(nodes.map(node => [node.entity.id, node]));
  return { width, height: Math.max(220, top), bands, nodes,
    links: links.filter(link => nodeMap.has(link.fromEntityId) && nodeMap.has(link.toEntityId)).map(link => ({ ...link, from: nodeMap.get(link.fromEntityId)!, to: nodeMap.get(link.toEntityId)! })) };
}
