import type { LorePage, LoreSource, Project, WorkspaceRecord, WritingNote } from './types';

export function researchNoteFromSource(project: Project, record: WorkspaceRecord, page?: LorePage): WritingNote {
  const source = record.data as LoreSource;
  if (record.kind !== 'lore-source' || source.sourceHash !== project.sourceHash) throw new Error('This source belongs to another project.');
  if (source.extraction && (!page || !source.extraction.pages.some(item => item.pageNumber === page.pageNumber && item.textSha256 === page.textSha256))) throw new Error('Select a verified page before preparing a research note.');
  if (!source.extraction && page) throw new Error('This source has no extracted page text.');
  const suffix = page ? ` · p${page.pageNumber}` : ' · image reference';
  const passage = page?.text ?? '';
  const excerpt = passage.length > 85000 ? `${passage.slice(0, 85000)}\n[Excerpt shortened; the complete page remains in the library.]` : passage;
  return {
    sourceHash: project.sourceHash, title: `Source note: ${source.title}${suffix}`.slice(0, 200), category: 'RESEARCH', tags: ['source-note'],
    body: `SOURCE REFERENCE\n${source.originalFilename}${page ? `\nPage ${page.pageNumber}` : '\nOriginal image; no text extraction'}\n\n${page ? `EXTRACTED PAGE TEXT\n${excerpt}\n\n` : ''}RESEARCH NOTES\n`,
    loreRefs: [{ id: record.id, sha256: record.sha256, originalSha256: source.original.sha256, extractionSha256: source.extraction?.sha256 ?? null, pageNumber: page?.pageNumber ?? 0, textSha256: page?.textSha256 ?? null }],
  };
}

