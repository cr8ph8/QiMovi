import type { UniverseEntity } from './universeApi';
import { universeTypeLabel } from './universeLibraryModel';

type EntryGroup = { label: string; entries: UniverseEntity[] };

/** Presentation only: retain every identity and its order within each origin group. */
export function storyBibleEntryGroups(entities: readonly UniverseEntity[]): EntryGroup[] {
  const saved: UniverseEntity[] = [], drafts: UniverseEntity[] = [];
  const screenplay: UniverseEntity[] = [], lore: UniverseEntity[] = [];
  for (const entity of entities) {
    if (entity.origin === 'DRAFT' || entity.origin === 'USER_AUTHORED') {
      (entity.recordRef ? saved : drafts).push(entity);
    } else if (entity.origin === 'SCREENPLAY') screenplay.push(entity);
    else lore.push(entity);
  }
  return [
    { label: 'Saved draft entries', entries: saved },
    { label: 'Other draft entries', entries: drafts },
    { label: 'Source observations · screenplay', entries: screenplay },
    { label: 'Source observations & candidates · lore', entries: lore },
  ].filter(group => group.entries.length > 0);
}

function originLabel(entity: UniverseEntity): string {
  if (entity.origin === 'DRAFT' || entity.origin === 'USER_AUTHORED') return entity.recordRef ? 'Saved draft' : 'Draft';
  if (entity.origin === 'SCREENPLAY') return 'Screenplay observation';
  return entity.review === 'OBSERVED' ? 'Lore observation' : 'Lore candidate';
}

export default function StoryBibleEntryOptions({ entities }: { entities: readonly UniverseEntity[] }) {
  return <>{storyBibleEntryGroups(entities).map(group => <optgroup key={group.label} label={group.label}>
    {group.entries.map(entity => <option key={entity.id} value={entity.id}>
      {entity.name} · {universeTypeLabel(entity.type)} · {originLabel(entity)}
    </option>)}
  </optgroup>)}</>;
}
