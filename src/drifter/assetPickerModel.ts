import type { Project } from './types';
import { projectFileEntries, retainedRecordMatchesProject, type ProjectFileEntry, type ProjectLibraryCatalog } from './projectLibraryModel';

export interface AssetSelection {
  sourceHash: string;
  assetRef: { id: string; sha256: string };
  imageHash: string;
  mimeType: string;
  title: string;
  filename: string;
}

export function selectableImages(catalog: ProjectLibraryCatalog | undefined, project: Project): ProjectFileEntry[] {
  if (!catalog || catalog.sourceHash !== project.sourceHash) return [];
  return projectFileEntries(catalog, [], project.sourceHash, project.id, project).filter(entry => entry.asset && entry.family === 'IMAGE' && /^image\/(png|jpeg|webp|gif)$/.test(entry.mimeType));
}

export function imageSelection(entry: ProjectFileEntry, project: Project): AssetSelection | undefined {
  if (!entry.asset || !retainedRecordMatchesProject(entry.asset, project) || entry.family !== 'IMAGE' || !/^image\/(png|jpeg|webp|gif)$/.test(entry.mimeType)) return;
  return { sourceHash: project.sourceHash, assetRef: { id: entry.asset.id, sha256: entry.asset.sha256 }, imageHash: entry.sha256, mimeType: entry.mimeType, title: entry.title, filename: entry.filename };
}

export function filterPickerImages(entries: ProjectFileEntry[], query: string, collection: string, shortlistOnly: boolean) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(entry => (!collection || entry.collection === collection) && (!shortlistOnly || entry.curation?.data.organizationStatus === 'SHORTLIST') && terms.every(term => `${entry.title} ${entry.filename} ${entry.collection} ${entry.category} ${entry.curation?.data.tags.join(' ') ?? ''}`.toLocaleLowerCase().includes(term)));
}
