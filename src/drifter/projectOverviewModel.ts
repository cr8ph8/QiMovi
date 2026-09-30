import type { Project, WorkspaceRecord } from './types';

export function projectOverview(project: Project, records: WorkspaceRecord[]) {
  const current = records.filter(record => (record.data as { sourceHash?: string }).sourceHash === project.sourceHash);
  const referenceHashes = new Set(current.flatMap(record => {
    const data = record.data as { original?: { sha256: string }; asset?: { sha256: string } };
    return record.kind === 'lore-source' && data.original ? [data.original.sha256] : record.kind === 'project-asset' && data.asset ? [data.asset.sha256] : [];
  }));
  return {
    fileCount: referenceHashes.size,
    assetCount: current.filter(record => record.kind === 'project-asset').length,
    loreCount: current.filter(record => record.kind === 'lore-source').length,
    draftCount: current.filter(record => record.kind === 'screenplay-draft').length,
    scenes: project.scenes.map(scene => {
      const sceneRecords = current.filter(record => (record.data as { sceneId?: string }).sceneId === scene.id);
      return {
        scene,
        referenceCount: project.cells.filter(cell => cell.sceneId === scene.id && cell.imageHash).length,
        takeCount: sceneRecords.filter(record => record.kind === 'measured-media-take').length,
        contextCount: sceneRecords.filter(record => record.kind === 'context-bundle').length,
        hasGraph: sceneRecords.some(record => record.kind === 'node-workflow'),
      };
    }),
  };
}
