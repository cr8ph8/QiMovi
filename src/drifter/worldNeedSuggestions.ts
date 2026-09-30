import type { Project } from './types';
import type { UniverseEntity, UniverseProductionNeed } from './universeApi';

export type WorldNeedStarter = {
  need: UniverseProductionNeed;
  alreadyPresent: boolean;
  sceneLimitReached: boolean;
  sourceLinkLimitReached: boolean;
};
export type WorldNeedSourceContext = { sceneIds: string[]; basis: NonNullable<UniverseProductionNeed['sourceLinkBasis']> | null };

const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** A planning prompt from an entry's identity and scene links, never an inference from lore. */
export function worldNeedStarter(project: Pick<Project, 'scenes'>, entity: UniverseEntity, needs: UniverseProductionNeed[], sourceContext?: WorldNeedSourceContext): WorldNeedStarter | null {
  if (entity.type !== 'character' && entity.type !== 'location') return null;
  const character = entity.type === 'character';
  const id = character ? 'need-entry-performance' : 'need-entry-location';
  const name = entity.name.trim();
  const titled = `${name} · ${character ? 'performance' : 'location / set'}`;
  const label = titled.length <= 240 ? titled : name;
  const department = character ? 'cast' : 'locations';
  const appearances = new Set(character && sourceContext ? sourceContext.sceneIds : entity.sceneIds);
  const sceneIds = [...new Set(project.scenes.filter(scene => appearances.has(scene.id)).map(scene => scene.id))];
  const description = character
    ? 'Plan this character’s performance. Casting, performance method, rehearsal and continuity remain to be specified.'
    : 'Plan this location or set. Confirm the practical, built or digital approach, access and continuity requirements.';
  return {
    need: { id, label, department, sceneIds, description, review: 'PROPOSED',
      ...(character && sourceContext?.basis ? { sourceLinkBasis: {
        continuityRef: { ...sourceContext.basis.continuityRef }, aliases: sourceContext.basis.aliases.map(alias => ({ ...alias })),
        observedSceneIds: [...sourceContext.basis.observedSceneIds],
      } } : {}),
    },
    // A renamed or set-aside starter must not be recreated by another click.
    alreadyPresent: needs.some(need => need.id === id || need.department === department && normalized(need.label) === normalized(label)),
    sceneLimitReached: sceneIds.length > 100,
    sourceLinkLimitReached: character && Boolean(sourceContext?.basis && (sourceContext.basis.aliases.length > 128 || sourceContext.basis.observedSceneIds.length > 100)),
  };
}
