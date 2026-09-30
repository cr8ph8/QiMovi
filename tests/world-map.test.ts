import { describe, expect, it } from 'vitest';
import { universeGraphPage, universeMapLayout } from '../src/drifter/universeLibraryModel';
import type { UniverseEntity, UniverseLink } from '../src/drifter/universeApi';
const entry = (n: number, type: UniverseEntity['type'] = 'character'): UniverseEntity => ({ id: `entry-${n}`, name: `Entry ${n}`, type, summary: '', origin: 'DRAFT', review: 'PROPOSED', imageHash: null, sceneIds: [], citations: [], recordRef: null, storylineIds: [] });
const link = (from: number, to: number): UniverseLink => ({ id: `link-${from}-${to}`, fromEntityId: `entry-${from}`, toEntityId: `entry-${to}`, relation: 'related_to', label: 'Story relationship', sceneIds: [], citations: [], origin: 'DRAFT', review: 'PROPOSED', recordRef: null });
describe('World map coverage and relationships', () => {
  it('makes every matching entry reachable and renders every node on its page', () => {
    const entries = Array.from({ length: 83 }, (_, i) => entry(i, ['character', 'location', 'story', 'world_rule'][i % 4] as UniverseEntity['type']));
    const before = JSON.stringify(entries), seen: string[] = [];
    for (let page = 0; page < universeGraphPage(entries, [], null).pages; page++) {
      const result = universeGraphPage(entries, [], null, page), layout = universeMapLayout(result.entities, []);
      expect(layout.nodes.length).toBe(result.entities.length);
      seen.push(...layout.nodes.map(node => node.entity.id));
    }
    expect(seen.sort()).toEqual(entries.map(item => item.id).sort());
    expect(JSON.stringify(entries)).toBe(before);
  });
  it('keeps the selected entry on each relationship page and includes both directions without merging identities', () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry(i));
    const links = entries.slice(1, 38).map((_, i) => i % 2 ? link(i + 1, 0) : link(0, i + 1));
    const shown = new Set<string>();
    for (let page = 0; page < 3; page++) {
      const result = universeGraphPage(entries, links, 'entry-0', page);
      expect(result.entities[0].id).toBe('entry-0'); expect(result.total).toBe(38);
      const layout = universeMapLayout(result.entities, links);
      expect(layout.links.length).toBe(result.entities.length - 1);
      result.entities.forEach(entity => shown.add(entity.id));
    }
    expect(shown.size).toBe(38); expect(shown.has('entry-39')).toBe(false);
  });
  it('does not invent connections for isolated or filtered entries and clamps stale pages', () => {
    const entries = [entry(0), entry(1), entry(2)];
    const result = universeGraphPage(entries, [link(0, 4)], 'entry-0', 999);
    expect(result.entities.map(entity => entity.id)).toEqual(['entry-0']);
    expect(result.pages).toBe(1); expect(result.page).toBe(0);
    expect(universeMapLayout(result.entities, [link(0, 4)]).links).toEqual([]);
    expect(universeGraphPage([], [], null, -10).entities).toEqual([]);
  });
});
