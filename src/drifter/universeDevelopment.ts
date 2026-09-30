import { BIBLE_AUTHORING_INPUT_KINDS, BIBLE_AUTHORING_INPUT_LIMIT } from '../../local/contracts/authoring.mjs';
import { isCreativeProject, projectOwnedContext, validateCreativeProject } from '../../local/contracts/creative-project.mjs';
import { canonicalJson } from './canonical';
import { validateRecord } from './validation';
import { universeContextText, type UniverseCatalog, type UniverseEntity } from './universeApi';
import type { AuthoringInputRef, CreativeProject, LoreRef, LoreSource, Project, WorkspaceApi, WorkspaceProject, WorkspaceRecord, WritingNote } from './types';

export type CreativeBibleWritingNote = Omit<WritingNote, 'sourceHash'> & { sourceHash: null; projectId: string };
type NoteInputs = [entity: UniverseEntity, catalog: UniverseCatalog, records: WorkspaceRecord[], history: WorkspaceApi['history']];

export function universeDevelopmentNote(project: CreativeProject, ...args: [...NoteInputs, rights?: boolean]): Promise<CreativeBibleWritingNote>;
export function universeDevelopmentNote(project: WorkspaceProject, ...args: [...NoteInputs, rights: boolean | undefined, writingProject: CreativeProject]): Promise<CreativeBibleWritingNote>;
export function universeDevelopmentNote(project: Project, ...args: [...NoteInputs, rights?: boolean]): Promise<WritingNote>;
export function universeDevelopmentNote(project: WorkspaceProject, ...args: [...NoteInputs, rights?: boolean]): Promise<WritingNote | CreativeBibleWritingNote>;

/** A development note snapshots the displayed selection and retains its saved dependencies. */
export async function universeDevelopmentNote(project: WorkspaceProject, entity: UniverseEntity, catalog: UniverseCatalog, records: WorkspaceRecord[], history: WorkspaceApi['history'], rights = false, writingProject?: CreativeProject): Promise<WritingNote | CreativeBibleWritingNote> {
  if (catalog.projectId !== project.id || catalog.sourceHash !== project.sourceHash) throw new Error('Refresh the Story Bible for this project before developing this entry.');
  const target = writingProject ?? project;
  if (target.sourceHash === null) {
    validateCreativeProject(target);
    const retained = projectOwnedContext(project, 'writing-note', { sourceHash: null, projectId: target.id });
    if (!isCreativeProject(retained) || canonicalJson(retained) !== canonicalJson(target)) throw new Error('This development draft belongs to another project.');
  }
  const productionContextRequired = () => new Error('Open this entry from the production Story Bible to develop its screenplay-linked context.');
  const context = universeContextText(entity, catalog);
  const links = catalog.links.filter(link => link.fromEntityId === entity.id || link.toEntityId === entity.id);
  const selected = catalog.drafts.filter(record => (record.kind === 'universe-profile' || record.kind === 'universe-claim') && 'entityId' in record.data && record.data.entityId === entity.id);
  const relatedIds = new Set(links.flatMap(link => [link.fromEntityId, link.toEntityId]));
  const namedEntities = catalog.entities.filter(item => item.id === entity.id || relatedIds.has(item.id));
  const inputs = new Map<string, AuthoringInputRef>();
  for (const ref of [...namedEntities.map(item => item.recordRef), ...links.map(link => link.recordRef), ...selected.map(record => ({ id: record.id, sha256: record.sha256 }))]) {
    if (!ref) continue;
    const record = catalog.drafts.find(row => row.id === ref.id && row.sha256 === ref.sha256);
    if (!record || !BIBLE_AUTHORING_INPUT_KINDS.includes(record.kind)) throw new Error('A saved Story Bible dependency is unavailable. Refresh the Bible before continuing.');
    const owner = projectOwnedContext(project, record.kind, record.data);
    if (record.data.sourceHash === null ? !isCreativeProject(owner) || !('projectId' in record.data) || record.data.projectId !== owner.id : record.data.sourceHash !== project.sourceHash) throw new Error('A saved Story Bible dependency belongs to another project. Refresh the Bible before continuing.');
    await validateRecord(record, project);
    if (target.sourceHash === null && record.data.sourceHash !== null) throw productionContextRequired();
    if (inputs.has(ref.id) && inputs.get(ref.id)!.sha256 !== ref.sha256) throw new Error('This selection contains conflicting source revisions. Refresh the Story Bible.');
    inputs.set(ref.id, { ...ref });
  }
  if (inputs.size > BIBLE_AUTHORING_INPUT_LIMIT) throw new Error(`This entry uses more than ${BIBLE_AUTHORING_INPUT_LIMIT} saved Bible dependencies. Develop a smaller selection; no source links have been discarded.`);
  const questions = catalog.questions.filter(question => question.entityIds.includes(entity.id) && !selected.some(record => record.id === question.id));
  const citations = [...entity.citations, ...selected.flatMap(record => record.data.citations), ...links.flatMap(link => link.citations), ...questions.flatMap(question => question.citations)];
  if (target.sourceHash === null && (citations.length > 0 || entity.sceneIds.length > 0 || !entity.recordRef || links.some(link => !link.recordRef || link.sceneIds.length > 0))) throw productionContextRequired();
  const loreByPage = new Map<string, typeof citations[number]>();
  for (const citation of citations.filter(row => row.kind === 'LORE_SOURCE' || row.kind === 'LORE_PAGE')) {
    const key = `${citation.sourceId}:${citation.pageNumber ?? 0}`, previous = loreByPage.get(key);
    if (previous && (previous.sourceSha256 !== citation.sourceSha256 || previous.textSha256 !== citation.textSha256)) throw new Error('This selection cites conflicting versions of one source page. Review the Bible citations before continuing.');
    loreByPage.set(key, citation);
  }
  const loreCitations = [...loreByPage.values()];
  if (loreCitations.length > 32) throw new Error('This selection cites more than 32 source pages. Develop a smaller selection; no citations have been discarded.');
  const sources = new Map<string, WorkspaceRecord[]>();
  const loreRefs: LoreRef[] = [];
  for (const citation of loreCitations) {
    let record = records.find(row => row.id === citation.sourceId && row.sha256 === citation.sourceSha256);
    if (!record && history) {
      if (!sources.has(citation.sourceId)) sources.set(citation.sourceId, await history(citation.sourceId, project));
      record = sources.get(citation.sourceId)!.find(row => row.id === citation.sourceId && row.sha256 === citation.sourceSha256);
    }
    if (!record || record.kind !== 'lore-source') throw new Error('A cited source revision is unavailable. Refresh the Library before developing this entry.');
    await validateRecord(record, project);
    const source = record.data as LoreSource;
    const page = citation.pageNumber === null ? null : source.extraction?.pages.find(row => row.pageNumber === citation.pageNumber);
    if (source.sourceHash !== project.sourceHash || (citation.kind === 'LORE_PAGE' && (!page || page.textSha256 !== citation.textSha256))) throw new Error('A cited page no longer matches this selection. Refresh the Story Bible.');
    loreRefs.push({ id: record.id, sha256: record.sha256, originalSha256: source.original.sha256, extractionSha256: page ? source.extraction!.sha256 : null, pageNumber: page?.pageNumber ?? 0, textSha256: page?.textSha256 ?? null });
  }
  const introduction = rights ? 'RIGHTS REVIEW DRAFT\nOwner / rights holder: Unknown\nPermitted uses: Not established\nLicence terms / evidence: Not supplied\nRestrictions / expiry: Needs review\n\n' : 'DEVELOPMENT DRAFT\nAdd your new ideas here. Retained source observations follow below.\n\n';
  return JSON.parse(canonicalJson({ sourceHash: target.sourceHash, ...(target.sourceHash === null ? { projectId: target.id } : {}), title: `${rights ? 'Rights review' : 'Develop'} · ${entity.name}`.slice(0, 200), category: 'RESEARCH', tags: ['universe', rights ? 'rights-review' : 'development', 'draft'], body: introduction + context, inputRefs: [...inputs.values()], ...(loreRefs.length ? { loreRefs } : {}) })) as WritingNote | CreativeBibleWritingNote;
}
