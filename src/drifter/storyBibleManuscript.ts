import { universeRecordInProject } from './universeApi';
import { UNIVERSE_PROFILE_SECTIONS } from '../../local/contracts/universe-profile.mjs';
import { canonicalJson } from './canonical';
import { universeTypeLabel } from './universeLibraryModel';
import { aliasConflicts, continuityOrder, continuityRecord } from './worldContinuityModel';
import { worldProductionPlan } from './worldProductionModel';
import type { Project } from './types';
import type { UniverseAgentDraft, UniverseCatalog, UniverseCitation, UniverseClaimDraft, UniverseDraftRecord, UniverseEntityType, UniverseProfileDraft, UniverseReview } from './universeApi';

export const bibleReviewLabel = (review: UniverseReview) => ({ OBSERVED: 'Seen in source', PROPOSED: 'Proposed', QUESTIONED: 'Needs an answer', SET_ASIDE: 'Set aside' })[review];
export const BIBLE_CHAPTERS: { type: UniverseEntityType; title: string }[] = [
  { type: 'story', title: 'Stories & narrative design' }, { type: 'character', title: 'Characters' },
  { type: 'location', title: 'Places & environments' }, { type: 'group', title: 'Groups & societies' },
  { type: 'world_rule', title: 'World rules' }, { type: 'thematic_note', title: 'Themes' }, { type: 'reference', title: 'References' },
];
export type BibleScenes = Pick<Project['scenes'][number], 'id' | 'index' | 'heading'>[];

/** Rebuild from the current saved catalog. No second bible document or implicit
 * promotion: all authoring remains in the existing versioned universe records. */
export function storyBibleManuscript(model: UniverseCatalog) {
  const current = new Map<string, UniverseDraftRecord>();
  for (const record of model.drafts) {
    if (!universeRecordInProject(record.data, model)) continue;
    const key = `${record.kind}:${record.id}`, prior = current.get(key);
    if (!prior || record.version > prior.version) current.set(key, record);
  }
  const records = [...current.values()];
  const catalog = { ...model, drafts: records };
  const entries = model.entities.map(entity => {
    const own = records.filter(record => 'entityId' in record.data && record.data.entityId === entity.id);
    const profile = own.find((record): record is UniverseDraftRecord & { data: UniverseProfileDraft } => record.kind === 'universe-profile' && 'entityType' in record.data && record.data.entityType === entity.type) ?? null;
    const agent = own.find((record): record is UniverseDraftRecord & { data: UniverseAgentDraft } => record.kind === 'universe-agent') ?? null;
    const claims = own.filter((record): record is UniverseDraftRecord & { data: UniverseClaimDraft } => record.kind === 'universe-claim');
    const sections = UNIVERSE_PROFILE_SECTIONS.filter(section => section.types.includes(entity.type)).map(section => ({ ...section, fields: section.fields.filter(field => profile?.data.fields[field.id]?.trim()).map(field => ({ ...field, text: profile!.data.fields[field.id] })) })).filter(section => section.fields.length);
    return { entity, profile, agent, claims, sections, production: worldProductionPlan(catalog, entity.id) };
  });
  const continuity = continuityRecord(catalog);
  const order = continuity ? continuityOrder(continuity.data) : null;
  const conflicts = continuity ? aliasConflicts(continuity.data) : [];
  const citations = [...new Map([...model.entities, ...model.links, ...model.questions, ...records.map(record => record.data)].flatMap(item => item.citations).map(citation => [canonicalJson(citation), citation])).values()];
  return { entries, continuity, order, conflicts, citations, records,
    profiles: entries.filter(entry => entry.profile).length,
    claims: entries.reduce((count, entry) => count + entry.claims.length, 0),
    needs: entries.reduce((count, entry) => count + (entry.production?.data.needs.length ?? 0), 0),
  };
}
export type BibleManuscript = ReturnType<typeof storyBibleManuscript>;
const line = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}[\]<>#|]/g, '\\$&');
const literal = (value: string) => value.split('\n').map(part => `    ${part}`).join('\n');
const recordIdentity = (record: UniverseDraftRecord) => `Saved ${record.id} · v${record.version} · SHA-256 ${record.sha256}`;
export function bibleSceneLabel(id: string, scenes: BibleScenes) { const scene = scenes.find(item => item.id === id); return scene ? `Scene ${scene.index} · ${scene.heading}` : id; }

/** Full, untruncated saved material. Authored text is literal Markdown content,
 * so HTML and headings in a story remain text rather than export instructions. */
export function storyBibleMarkdown(model: UniverseCatalog, title: string, scenes: BibleScenes = []) {
  const book = storyBibleManuscript(model), names = new Map(model.entities.map(entity => [entity.id, entity.name]));
  const citationIds = new Map(book.citations.map((citation, index) => [canonicalJson(citation), index + 1]));
  const refs = (citations: UniverseCitation[]) => citations.length ? `Source references: ${citations.map(citation => `[S${citationIds.get(canonicalJson(citation))}]`).join(', ')}` : 'No source citations attached.';
  const sections = [
    `# ${line(title)} · Story bible`,
    'Working manuscript assembled from the current saved universe catalog. Source observations, author intentions, character perspective and set-aside material keep their recorded status. This export is not canon approval or production clearance. Unsaved editor changes are not included.',
    `Project: ${line(model.projectId)}\n\nSource revision: ${model.sourceHash ?? 'Project development (no screenplay attached)'}\n\nCatalog revision: ${model.basisHash}`,
    `${book.entries.length} entries · ${book.profiles} authored profiles · ${book.claims} statements · ${model.links.length} relationships · ${book.needs} production needs`,
    ...(model.coverage.candidateLimitReached ? ['**Coverage limit:** The source index reached its candidate limit. This manuscript does not represent every passage in the retained files.'] : []),
    '## Story groupings',
    ...model.storylines.map(story => `### ${line(story.title)}\n\n${story.entityIds.length} linked entries. ${story.status === 'NO_SOURCE_MATCH' ? 'No source match recorded.' : 'Source title matches only; shared chronology is not established.'}`),
  ];
  for (const chapter of BIBLE_CHAPTERS) {
    const entries = book.entries.filter(entry => entry.entity.type === chapter.type);
    if (!entries.length) continue;
    sections.push(`## ${chapter.title}`);
    for (const { entity, profile, agent, claims, sections: profileSections } of entries) {
      sections.push(`### ${line(entity.name)}`, `${universeTypeLabel(entity.type)} · ${bibleReviewLabel(entity.review)} · ${entity.origin}\n\nEntry identity: ${line(entity.id)}`, literal(entity.summary || 'No description recorded.'), refs(entity.citations));
      if (entity.recordRef) sections.push(`Entry draft: ${line(entity.recordRef.id)} · SHA-256 ${entity.recordRef.sha256}`);
      sections.push(`Scene use: ${entity.sceneIds.map(id => line(bibleSceneLabel(id, scenes))).join('; ') || 'No scenes linked.'}`);
      if (profile) {
        sections.push(`#### Author profile · ${bibleReviewLabel(profile.data.review)}`, recordIdentity(profile));
        for (const section of profileSections) { sections.push(`##### ${section.label}`); for (const field of section.fields) sections.push(`**${field.label}**`, literal(field.text)); }
        sections.push(refs(profile.data.citations));
      } else sections.push('Author profile not developed yet.');
      for (const claim of claims) sections.push(`#### ${line(claim.data.title)} · ${bibleReviewLabel(claim.data.review)}`, literal(claim.data.body), recordIdentity(claim), refs(claim.data.citations));
      if (agent) {
        sections.push(`#### Character perspective · ${bibleReviewLabel(agent.data.review)}`, 'This is the character’s supplied perspective, not an omniscient statement of world facts.', recordIdentity(agent));
        for (const [label, values] of [['Goals', agent.data.goals], ['Boundaries', agent.data.boundaries], ['Observations', agent.data.observations], ['Beliefs', agent.data.beliefs], ['Memories', agent.data.memories]] as const) if (values.length) sections.push(`**${label}**`, ...values.map(literal));
        if (agent.data.voice) sections.push('**Voice**', literal(agent.data.voice));
        sections.push(refs(agent.data.citations));
      }
    }
  }
  sections.push('## Relationships');
  if (!model.links.length) sections.push('No relationships recorded.');
  for (const link of model.links) {
    sections.push(`### ${line(names.get(link.fromEntityId) ?? link.fromEntityId)} → ${line(names.get(link.toEntityId) ?? link.toEntityId)}`, `${line(link.relation)} · ${bibleReviewLabel(link.review)} · ${link.origin}`, literal(link.label), refs(link.citations));
    if (link.relation === 'possible_alias') sections.push('Possible alias only. These remain separate entries.');
    if (link.recordRef) sections.push(`Saved relationship: ${line(link.recordRef.id)} · SHA-256 ${link.recordRef.sha256}`);
  }
  sections.push('## Continuity & identities');
  if (book.continuity) {
    sections.push(`${recordIdentity(book.continuity)}\n\nPlan status: ${bibleReviewLabel(book.continuity.data.review)}`);
    for (const event of book.continuity.data.events) sections.push(`### ${line(event.title)} · ${bibleReviewLabel(event.review)}`, literal(event.description), `Time: ${line(event.timeLabel || 'Unspecified')}\n\nEntries: ${event.entityIds.map(id => line(names.get(id) ?? id)).join(', ') || 'None assigned'}\n\nScenes: ${event.sceneIds.map(id => line(bibleSceneLabel(id, scenes))).join('; ') || 'None assigned'}\n\nBefore events: ${event.beforeEventIds.map(line).join(', ') || 'No ordering recorded'}`);
    for (const alias of book.continuity.data.aliases) sections.push(`### ${line(names.get(alias.fromEntityId) ?? alias.fromEntityId)} ↔ ${line(names.get(alias.toEntityId) ?? alias.toEntityId)}`, `${alias.decision} · ${bibleReviewLabel(alias.review)}`, literal(alias.note));
    if (book.order?.cycleIds.length || book.order?.missing.length || book.conflicts.length) sections.push(`Unresolved continuity: ${book.order?.cycleIds.length ?? 0} events in cycles; ${book.order?.missing.length ?? 0} missing event links; ${book.conflicts.length} identity conflicts. Open continuity to resolve them.`);
  } else sections.push('No continuity plan saved.');
  sections.push('## Production needs');
  if (!book.needs) sections.push('No production needs saved.');
  for (const { entity, production } of book.entries) if (production) {
    sections.push(`### ${line(entity.name)} · ${bibleReviewLabel(production.data.review)}`, recordIdentity(production));
    for (const need of production.data.needs) sections.push(`#### ${line(need.label)} · ${bibleReviewLabel(need.review)}`, `Department: ${need.department}\n\nScenes: ${need.sceneIds.map(id => line(bibleSceneLabel(id, scenes))).join('; ') || 'Project-wide; scenes not assigned'}`, literal(need.description));
  }
  sections.push('## Open questions', ...(model.questions.length ? model.questions.map(question => `${literal(question.text)}\n\n${refs(question.citations)}`) : ['No explicit questions recorded. This is not a completeness finding.']));
  sections.push('## Source register');
  for (const [index, citation] of book.citations.entries()) sections.push(`### S${index + 1} · ${line(citation.label)}`, `Kind: ${citation.kind}\n\nSource: ${line(citation.sourceId)}\n\nSHA-256: ${citation.sourceSha256}\n\nParagraph: ${line(citation.paragraphId ?? 'Not specified')}\n\nPage: ${citation.pageNumber ?? 'Not specified'}\n\nScene: ${line(citation.sceneId ?? 'Not specified')}\n\nText SHA-256: ${citation.textSha256 ?? 'Not specified'}`, literal(citation.excerpt));
  return sections.join('\n\n') + '\n';
}
