import type { UniverseCatalog, UniverseEntity } from '../../src/drifter/universeApi';

export interface CharacterSourceLinkBasis {
  continuityRef: { id: string; version: number; sha256: string };
  aliases: Array<{ aliasId: string; observationId: string }>;
  observedSceneIds: string[];
}
export interface CharacterSourceContext {
  linked: Array<{ entity: UniverseEntity; aliasIds: string[] }>;
  blocked: Array<{ entity: UniverseEntity; reason: string }>;
  sceneIds: string[];
  basis: CharacterSourceLinkBasis | null;
  fingerprint: string;
}
export function characterSourceContext(model: UniverseCatalog, entity: UniverseEntity): CharacterSourceContext;
export function sourceLinkBasisIsCurrent(model: UniverseCatalog, entity: UniverseEntity, basis: CharacterSourceLinkBasis | null | undefined): boolean;
