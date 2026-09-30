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

// Adapted from the existing FranchiseCharacterNetwork: deterministic placement,
// visible-endpoint links and focus/hover selection, without a hosted container.
// Rows preserve StoryWorldPanel's character/place/story-world categories.
export function universeMapLayout(entities: UniverseEntity[], links: UniverseLink[]) {
  const width = 900, height = 450;
  type MapNode = { entity: UniverseEntity; x: number; y: number; width: number; height: number; featured: boolean; band: 'character' | 'world' | 'story' };
  const nodes: MapNode[] = [];
  const characters = entities.filter(entity => entity.type === 'character').slice(0, 7);
  const focal = characters.find(entity => /^(the )?drifter$/i.test(entity.name)) ?? characters[0];
  const otherCharacters = characters.filter(entity => entity !== focal);
  const characterSlots = [18, 137, 256, 550, 669, 788];
  otherCharacters.forEach((entity, index) => nodes.push({ entity, x: characterSlots[index], y: 48, width: 96, height: 130, featured: false, band: 'character' }));
  if (focal) nodes.push({ entity: focal, x: 371, y: 24, width: 158, height: 163, featured: true, band: 'character' });
  const film = entities.find(entity => entity.type === 'story' && entity.origin === 'SCREENPLAY');
  const worldEntries = entities.filter(entity => ['location', 'group', 'reference', 'thematic_note', 'world_rule'].includes(entity.type));
  const worlds = [...worldEntries.slice(0, film ? 2 : 3), ...(film ? [film] : [])];
  worlds.forEach((entity, index) => nodes.push({ entity, x: 82 + index * 258, y: 226, width: 220, height: 88, featured: false, band: 'world' }));
  const stories = entities.filter(entity => entity.type === 'story' && entity !== film).slice(0, 7);
  const storyStep = stories.length > 6 ? 126 : 146;
  stories.forEach((entity, index) => nodes.push({ entity, x: 18 + index * storyStep, y: 355, width: storyStep - 12, height: 86, featured: false, band: 'story' }));
  const nodeMap = new Map(nodes.map(node => [node.entity.id, node]));
  const bands = [
    ...(characters.length ? [{ title: 'Characters', y: 14 }] : []),
    ...(worlds.length ? [{ title: 'Places & source anchors', y: 210 }] : []),
    ...(stories.length ? [{ title: 'Stories', y: 340 }] : []),
  ];
  return { width, height, bands, nodes, links: links.filter(link => nodeMap.has(link.fromEntityId) && nodeMap.has(link.toEntityId)).map(link => ({ ...link, from: nodeMap.get(link.fromEntityId)!, to: nodeMap.get(link.toEntityId)! })) };
}
