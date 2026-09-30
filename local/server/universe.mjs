import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson } from '../kernel/src/canonical-json.mjs';
import { validateLoreSource } from '../contracts/lore.mjs';
import { validateProjectAsset } from '../contracts/project-library.mjs';
import { verifyProjectAssetRecord } from './project-library.mjs';
import { retainedLoreSourceKind } from './lore.mjs';
import { validateUniverseContinuityTargets } from '../contracts/universe-continuity.mjs';
import { sourceLinkBasisIsCurrent } from '../contracts/character-source-context.mjs';
import { validateWorldRehearsalTransition } from '../contracts/world-rehearsal.mjs';
import { isCreativeProject, projectOwnedContext, validateCreativeProject, CREATIVE_PROJECT_RECORD_KINDS } from '../contracts/creative-project.mjs';
import { UNIVERSE_KINDS, UNIVERSE_LIMITS, universeCatalogCanonical, universeArtworkView, validateUniverseRecord, validateUniverseCatalog, validateUniverseCitation, universeAssert as check } from '../contracts/universe.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const hashValue = value => hash(canonicalJson(value));
const key = (type, value) => `${type}:${hashValue(value).slice(0, 32)}`;
const recordRef = record => ({ id: record.id, sha256: record.sha256 });
const normalize = value => value.trim().replace(/\s+/g, ' ');
const unique = values => [...new Set(values)];
const SHA = /^[a-f0-9]{64}$/;
const chartData = JSON.parse(fs.readFileSync(new URL('../contracts/universe-chart-data.json', import.meta.url), 'utf8'));
// Navigation labels include the full feature slate. Membership is a title-search
// classification only, never a statement about story chronology or canon.
const groups = [
  ['wolf-waters', 'Wolf Waters', /wolf\s+waters/i], ['blood-of-art', 'Blood of Art', /blood\s+of\s+art/i],
  ['the-drifter', 'The Drifter', /drifter/i], ['the-shelter', 'The Shelter', /the\s+shelter/i],
  // Known compact filenames remain separate source versions. Recognize their
  // complete title tokens only; do not normalize every name into an alias.
  ['time-traveler', 'Time Traveler', /time\s+travell?er|(?:^|[\s._()-])thetimetravell?er\d*(?=$|[\s._()-])/i], ['war-games', 'War Games / WWV', /war\s+games|\bwwv\b/i],
  ['end-of-days', 'End of Days', /end\s+of\s+days|(?:^|[\s._()-])(?:afterlife)?endofdays\d*(?=$|[\s._()-])/i],
  ['headwinds', 'Headwinds', /head\s*winds/i],
];
const storylineIds = title => groups.filter(([, , pattern]) => pattern.test(title)).map(([id]) => id);
function citation(project, kind, values) {
  return { kind, sourceHash: project.sourceHash, sourceId: project.id, sourceSha256: project.sourceHash, paragraphId: null, sceneId: null, pageNumber: null, textSha256: null, label: project.title.slice(0, 300), excerpt: '', ...values };
}
function sourceCitation(project, scene, paragraph) {
  return citation(project, 'SOURCE_PARAGRAPH', { sceneId: scene?.id ?? null, paragraphId: paragraph.id, textSha256: hash(paragraph.text), label: `${scene ? `Scene ${scene.index} · ` : ''}${paragraph.id}`.slice(0, 300), excerpt: paragraph.text.slice(0, 4000) });
}
function sceneCitation(project, scene) { return citation(project, 'SOURCE_SCENE', { sceneId: scene.id, textSha256: hash(scene.heading), label: `Scene ${scene.index} · ${scene.heading}`.slice(0, 300), excerpt: scene.heading.slice(0, 4000) }); }
function loreCitation(project, record, page) {
  return citation(project, page ? 'LORE_PAGE' : 'LORE_SOURCE', { sourceId: record.id, sourceSha256: record.sha256, pageNumber: page?.pageNumber ?? null, textSha256: page?.textSha256 ?? null, label: `${record.data.title}${page ? ` · page ${page.pageNumber}` : ''}`.slice(0, 300), excerpt: '' });
}
const headingPattern = /^(?:INT\.?\s*\/\s*EXT\.?|INT\.?|EXT\.?|I\/E)(?:\s|\.)/i;
function placeName(heading) { return normalize(heading.replace(headingPattern, '').replace(/\s+[-–—]\s+(?:DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|CONTINUOUS|LATER|SAME TIME)\b.*$/i, '')).slice(0, 240) || heading.slice(0, 240); }
const notCharacter = /^(?:FADE|CUT|DISSOLVE|THE END|END OF|CONTINUED|CONTINUOUS|TITLE|ACT\b|SCENE\b|CHAPTER\b|INT\b|EXT\b|AFTER[- ]LIFE|THE DRIFTER VR|PAGE\b|COPYRIGHT|WRITTEN BY)/;
function cueCandidate(line, next) {
  return line.length >= 2 && line.length <= 65 && /[A-Z]/.test(line) && line === line.toUpperCase() && /^[A-Z0-9 .,'’()\-/]+$/.test(line) && !notCharacter.test(line) && /[a-z]/.test(next) && !headingPattern.test(next);
}
function checkedRecords(project, records) {
  check(Array.isArray(records) && records.length <= 100000, 'UNIVERSE_RECORD_LIMIT');
  const ids = new Set();
  for (const record of records) {
    const owner = record && projectOwnedContext(project, record.kind, record.data);
    const owned = record?.data?.sourceHash === null && isCreativeProject(owner) && CREATIVE_PROJECT_RECORD_KINDS.includes(record.kind)
      && (record.kind === 'project-direction' ? record.id === `project-direction:${owner.id}` : record.data.projectId === owner.id);
    check(record && typeof record.id === 'string' && !ids.has(record.id) && Number.isSafeInteger(record.version) && record.version > 0 && (owned || SHA.test(project.sourceHash) && record.data?.sourceHash === project.sourceHash) && record.sha256 === hashValue(record.data), 'UNIVERSE_RECORD_HASH_OR_SOURCE_MISMATCH');
    ids.add(record.id);
    if (record.kind === 'lore-source') validateLoreSource(record.data, project);
  }
}

/** Retained metadata plus bounded screenplay-shaped observations. Lore candidates
 * retain per-document identities; equal names never cause an identity merge. */
export function deriveUniverse({ project, records, lorePages = [], sourceKinds = {} }) {
  check(project && (SHA.test(project.sourceHash) || isCreativeProject(project)) && Array.isArray(project.scenes), 'UNIVERSE_PROJECT_REQUIRED');
  if (isCreativeProject(project)) validateCreativeProject(project);
  checkedRecords(project, records);
  const entities = new Map(), links = [], questions = [], lore = records.filter(r => r.kind === 'lore-source');
  const sourceGroups = storylineIds(project.title), filmId = key('story', { sourceHash: project.sourceHash });
  const add = item => { check(entities.size < UNIVERSE_LIMITS.entities || entities.has(item.id), 'UNIVERSE_ENTITY_LIMIT'); entities.set(item.id, { summary: '', origin: 'SCREENPLAY', review: 'OBSERVED', imageHash: null, sceneIds: [], citations: [], recordRef: null, storylineIds: [], ...item }); return entities.get(item.id); };
  const connect = (fromEntityId, toEntityId, relation, label, citations, sceneIds = [], origin = 'SCREENPLAY', review = 'OBSERVED') => links.push({ id: key('connection', [fromEntityId, toEntityId, relation]), fromEntityId, toEntityId, relation, label, citations: citations.slice(0, 32), sceneIds: unique(sceneIds), origin, review, recordRef: null });
  if (!isCreativeProject(project)) add({ id: filmId, type: 'story', name: project.title.slice(0, 240), summary: 'Retained screenplay. Research and working drafts do not replace its text.', sceneIds: project.scenes.map(s => s.id), citations: project.scenes.slice(0, 32).map(s => sceneCitation(project, s)), storylineIds: sourceGroups });
  const people = new Map();
  for (const character of project.characters ?? []) {
    const name = normalize(character.name), id = key('character', { sourceHash: project.sourceHash, name });
    const entity = add({ id, type: 'character', name, summary: character.description?.slice(0, 8000) ?? '', imageHash: SHA.test(character.referenceImageHash ?? '') ? character.referenceImageHash : null, citations: [citation(project, 'SOURCE_CHARACTER', { sourceId: character.id, sourceSha256: hashValue(character), label: `Retained character · ${name}`.slice(0, 300), excerpt: (character.description ?? '').slice(0, 4000) })], storylineIds: sourceGroups });
    people.set(name, entity);
  }
  for (const scene of project.scenes) {
    const place = placeName(scene.heading), placeId = key('location', { sourceHash: project.sourceHash, place });
    const location = entities.get(placeId) ?? add({ id: placeId, type: 'location', name: place, summary: 'Location label observed in the retained screenplay heading.', storylineIds: sourceGroups });
    location.sceneIds = unique([...location.sceneIds, scene.id]); if (location.citations.length < 32) location.citations.push(sceneCitation(project, scene));
    for (const paragraph of scene.paragraphs ?? []) {
      if (paragraph.type?.toLowerCase() !== 'character') continue;
      const name = normalize(paragraph.text); if (!name || name.length > 240) continue;
      const person = people.get(name) ?? add({ id: key('character', { sourceHash: project.sourceHash, name }), type: 'character', name, summary: 'Character cue observed in the retained screenplay; name variants remain separate.', storylineIds: sourceGroups });
      people.set(name, person); person.sceneIds = unique([...person.sceneIds, scene.id]);
      if (person.citations.length < 32) person.citations.push(sourceCitation(project, scene, paragraph));
    }
  }
  for (const entity of entities.values()) if (entity.id !== filmId) connect(entity.id, filmId, entity.type === 'location' ? 'set_in' : 'appears_in', entity.type === 'location' ? 'Setting in retained screenplay' : 'Retained screenplay character', entity.citations, entity.sceneIds);
  const pagesBySource = new Map();
  for (const entry of lorePages) { check(lore.some(r => r.id === entry.sourceId) && Array.isArray(entry.pages), 'UNIVERSE_PAGE_SOURCE_INVALID'); pagesBySource.set(entry.sourceId, entry.pages); }
  let parsedLorePages = 0, candidateCharacters = 0, candidateLocations = 0, candidateLimitReached = false;
  for (const record of lore) {
    const analysis = sourceKinds[record.id] === 'ANALYSIS';
    const groupIds = storylineIds(`${record.data.title} ${record.data.originalFilename}`), storyId = key('source', { id: record.id });
    const source = add({ id: storyId, type: !analysis && groupIds.length ? 'story' : 'reference', name: record.data.title, summary: analysis ? 'Editorial analysis · reported judgments, not screenplay facts. Analyzed draft/version match remains unverified.' : `${record.data.documentType === 'PDF' ? 'Retained document' : 'Retained image'} · source-specific research; no inferred chronology or canon.`, origin: 'LORE_SOURCE', imageHash: record.data.documentType === 'IMAGE' ? record.data.original.sha256 : null, citations: [loreCitation(project, record)], storylineIds: groupIds });
    const candidates = new Map();
    for (const page of pagesBySource.get(record.id) ?? []) {
      const expected = record.data.extraction?.pages[page.pageNumber - 1];
      check(expected && page.textSha256 === expected.textSha256 && hash(page.text) === expected.textSha256, 'UNIVERSE_PAGE_HASH_MISMATCH');
      if (analysis) continue;
      parsedLorePages++;
      const lines = page.text.split(/\r?\n/).map(normalize).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]; let type, name;
        if (headingPattern.test(line)) { type = 'location'; name = placeName(line); }
        else if (cueCandidate(line, lines[i + 1] ?? '')) { type = 'character'; name = line; }
        else continue;
        const candidateKey = `${type}:${name}`;
        if (!candidates.has(candidateKey) && candidates.size >= 50) { candidateLimitReached = true; continue; }
        const item = candidates.get(candidateKey) ?? { type, name, citations: [] };
        if (item.citations.length < 4 && !item.citations.some(c => c.pageNumber === page.pageNumber)) item.citations.push({ ...loreCitation(project, record, page), excerpt: page.text.includes(line) ? line.slice(0, 4000) : '' });
        candidates.set(candidateKey, item);
      }
    }
    for (const item of candidates.values()) {
      if (candidateCharacters + candidateLocations >= 650 || entities.size >= 950) { candidateLimitReached = true; break; }
      const candidate = add({ id: key(item.type, { sourceId: record.id, name: item.name }), type: item.type, name: item.name, summary: `${item.type === 'character' ? 'Possible character cue' : 'Scene-heading location'} in ${record.data.title}. Source-specific parsing candidate; review interpretation and variants.`, origin: 'LORE_SOURCE', review: 'PROPOSED', citations: item.citations, storylineIds: groupIds });
      if (item.type === 'character') candidateCharacters++; else candidateLocations++;
      connect(candidate.id, source.id, item.type === 'character' ? 'appears_in' : 'set_in', item.type === 'character' ? 'Possible character cue in this source' : 'Heading observed in this source', item.citations, [], 'LORE_SOURCE', 'PROPOSED');
    }
  }
  for (const [index, value] of (project.continuityQuestions ?? []).entries()) {
    const text = typeof value === 'string' ? value : value.question ?? value.text;
    if (text?.trim()) questions.push({ id: `source-question:${index + 1}`, text: text.slice(0, 8000), entityIds: [filmId], citations: [] });
  }
  for (const chart of isCreativeProject(project) ? [] : chartData.charts) {
    const asset = records.find(r => r.kind === 'project-asset' && r.data.asset?.sha256 === chart.imageSha256 && r.data.family === 'IMAGE');
    if (!asset) continue;
    const imageCitation = (excerpt = '') => citation(project, 'ASSET_IMAGE', { sourceId: asset.id, sourceSha256: asset.sha256, label: `${chart.title} · assistant transcription, pending review`.slice(0, 300), excerpt });
    const chartEntity = add({ id: key('chart', chart.id), type: 'reference', name: chart.title, summary: `${chart.method}. ${chart.coverage}`, origin: 'LORE_SOURCE', review: 'PROPOSED', imageHash: chart.imageSha256, citations: [imageCitation()] });
    for (const row of chart.rows) {
      const transcript = `Row ${row.row} · Story-Line: ${row.storyline} · Character: ${row.character}${row.attributes ? ` · ${Object.entries(row.attributes).map(([k, v]) => `${k}: ${v}`).join(' · ')}` : ''}`;
      const groupIds = storylineIds(row.storyline), observation = imageCitation(transcript);
      const person = add({ id: key('chart-person', [chart.id, row.row]), type: 'character', name: row.character, summary: `Assistant transcription of ${chart.title}, row ${row.row}. ${transcript}. Meanings and identity require review; no alias merge.`, origin: 'LORE_SOURCE', review: 'PROPOSED', citations: [observation], storylineIds: groupIds });
      const storyKey = key('chart-story', [chart.id, row.storyline]);
      const story = entities.get(storyKey) ?? add({ id: storyKey, type: 'story', name: row.storyline, summary: 'Story label transcribed from the supplied chart; abbreviations stay as written.', origin: 'LORE_SOURCE', review: 'PROPOSED', citations: [observation], storylineIds: groupIds });
      connect(person.id, story.id, 'related_to', 'Chart row pairs these labels', [observation], [], 'LORE_SOURCE', 'PROPOSED');
      connect(person.id, chartEntity.id, 'source_for', 'Attributed chart transcription', [observation], [], 'LORE_SOURCE', 'PROPOSED');
    }
    questions.push({ id: `chart-review:${chart.id}`, text: `${chart.coverage} These selected rows are assistant transcriptions to review against the image. Different columns/charts may describe different schemes; do not merge their attributes or names automatically.`, entityIds: [chartEntity.id], citations: [imageCitation()] });
  }
  if (candidateLimitReached) questions.push({ id: 'parsing-limit', text: 'The bounded candidate index reached its limit. All retained sources remain in the library; these cards are not a complete extraction of the universe.', entityIds: [], citations: [] });
  const drafts = records.filter(r => UNIVERSE_KINDS.includes(r.kind)); check(drafts.length <= UNIVERSE_LIMITS.drafts, 'UNIVERSE_DRAFT_LIMIT');
  for (const record of drafts) { validateUniverseRecord(record.kind, record.data, project); validateRecordCitationTargets(project, records, record.data.citations); }
  for (const record of drafts.filter(r => r.kind === 'universe-entity')) {
    const data = record.data, prior = entities.get(data.entityId);
    check(record.id === `universe-entity:${data.entityId}`, 'UNIVERSE_RECORD_IDENTITY_MISMATCH');
    // New guide entries participate in title-based navigation only. Existing
    // identities retain their groups; summaries and prompts supply no grouping.
    const citedTitles = data.citations.flatMap(c => lore.filter(source => source.id === c.sourceId && source.sha256 === c.sourceSha256 && c.kind.startsWith('LORE_')).map(source => source.data.title));
    add({ id: data.entityId, type: data.type, name: data.name, summary: data.summary, imageHash: data.imageHash, sceneIds: data.sceneIds, citations: uniqueCitations([...(prior?.citations ?? []), ...data.citations]), origin: !prior && !data.citations.length ? 'USER_AUTHORED' : 'DRAFT', review: data.review, recordRef: recordRef(record), storylineIds: prior?.storylineIds ?? storylineIds([data.name, ...citedTitles].join('\n')) });
  }
  for (const record of drafts.filter(r => r.kind !== 'universe-entity')) {
    const data = record.data;
    if (record.kind === 'universe-artwork') {
      check(record.id === `universe-artwork:${data.entityId}`, 'UNIVERSE_RECORD_IDENTITY_MISMATCH');
      check(entities.has(data.entityId), 'UNIVERSE_ARTWORK_ENTITY_ORPHAN');
      artworkAsset(project, records, data);
      entities.get(data.entityId).artwork = universeArtworkView(record);
    } else if (record.kind === 'universe-continuity-plan') {
      check(record.id === `universe-continuity-plan:${data.sourceHash ?? data.projectId}`, 'UNIVERSE_CONTINUITY_PLAN_ID_INVALID');
      validateUniverseContinuityTargets(data, [...entities.values()]);
    } else if (record.kind === 'universe-production-plan') {
      check(record.id === `universe-production-plan:${data.entityId}` && entities.get(data.entityId)?.type === data.entityType, 'UNIVERSE_PRODUCTION_PLAN_TARGET_INVALID');
    } else if (record.kind === 'universe-profile') {
      check(record.id === `universe-profile:${data.entityId}` && entities.get(data.entityId)?.type === data.entityType, 'UNIVERSE_PROFILE_TARGET_INVALID');
    } else if (record.kind === 'universe-agent') {
      const entity = entities.get(data.entityId);
      check(record.id === `universe-agent:${data.entityId}` && entity?.type === 'character' && entity.name === data.name, 'UNIVERSE_AGENT_TARGET_INVALID');
    } else if (record.kind === 'universe-rehearsal') {
      check(record.id.startsWith('universe-rehearsal:') && data.participants.every(party => entities.get(party.entityId)?.type === 'character'), 'REHEARSAL_CHARACTER_NOT_FOUND');
    } else if (record.kind === 'universe-claim') {
      check(entities.has(data.entityId), 'UNIVERSE_ENTITY_ORPHAN');
      questions.push({ id: record.id, text: `${data.title}: ${data.body}`.slice(0, 8000), entityIds: [data.entityId], citations: data.citations });
    } else {
      check(entities.has(data.fromEntityId) && entities.has(data.toEntityId), 'UNIVERSE_LINK_ORPHAN');
      links.push({ id: record.id, fromEntityId: data.fromEntityId, toEntityId: data.toEntityId, relation: data.relation, label: data.label, citations: data.citations, sceneIds: [], origin: 'DRAFT', review: data.review, recordRef: recordRef(record) });
    }
  }
  // The After-Life shelf is project-specific. Keep its missing-source slots
  // when title/source evidence identifies that slate, not in unrelated ideas.
  const afterLifeTitle = title => /(?:^|\W)after[-\s]?life(?:\W|$)/i.test(title) || storylineIds(title).length > 0;
  const hasAfterLifeContext = afterLifeTitle(project.title) || lore.some(row => afterLifeTitle(`${row.data.title} ${row.data.originalFilename}`)) || [...entities.values()].some(entity => entity.storylineIds.length > 0);
  const storylines = (hasAfterLifeContext ? groups : []).map(([id, title]) => { const members = [...entities.values()].filter(e => e.storylineIds.includes(id)); return { id, title, entityIds: members.map(e => e.id), sourceIds: unique(members.flatMap(e => e.citations.filter(c => c.kind.startsWith('LORE_')).map(c => c.sourceId))), sceneIds: unique(members.flatMap(e => e.sceneIds)), status: members.length ? 'SOURCE_MATCHES' : 'NO_SOURCE_MATCH', basis: 'TITLE_CLASSIFICATION_ONLY' }; });
  const allPages = lore.flatMap(r => r.data.extraction?.pages ?? []);
  const coverage = { retainedSources: lore.length, retainedPages: allPages.length, pagesWithText: allPages.filter(p => p.characters > 0).length, pagesWithoutText: allPages.filter(p => !p.characters).length, imageSources: lore.filter(r => r.data.documentType === 'IMAGE').length, projectAssets: records.filter(r => r.kind === 'project-asset').length, sourceScenes: project.scenes.length, sourceCharacters: people.size, sourceParagraphs: (project.prologue?.length ?? 0) + project.scenes.reduce((sum, s) => sum + s.paragraphs.length, 0), parsedLorePages, candidateCharacters, candidateLocations, candidateLimitReached };
  const value = { schema: 'caniscreenwrite-universe/v1', projectId: project.id, sourceHash: project.sourceHash, scope: 'RESEARCH_AND_DRAFTS', entities: [...entities.values()], links, storylines, coverage, questions, drafts };
  const result = { ...value, basisHash: hash(universeCatalogCanonical(value)) }; validateUniverseCatalog(result, project); return result;
}
function uniqueCitations(values) { return [...new Map(values.map(v => [hashValue(v), v])).values()].slice(0, 32); }

function artworkAsset(project, records, data) {
  const asset = records.find(r => r.id === data.assetRef.id && r.kind === 'project-asset');
  check(asset && asset.sha256 === data.assetRef.sha256 && asset.version === 1 && asset.data.sourceHash === data.sourceHash && asset.data.asset?.sha256 === data.imageHash, 'UNIVERSE_ARTWORK_ASSET_CHANGED');
  validateProjectAsset(asset.data, project);
  check(asset.data.family === 'IMAGE' && /^image\/(?:png|jpeg|webp|gif)$/.test(asset.data.asset.mimeType) && asset.data.asset.byteLength <= 32 * 1024 ** 2, 'UNIVERSE_ARTWORK_IMAGE_INVALID');
  return asset;
}

function validateRecordCitationTargets(project, records, citations) {
  for (const c of citations) {
    validateUniverseCitation(c, project);
    if (c.kind === 'ASSET_IMAGE') {
      const record = records.find(r => r.id === c.sourceId && r.kind === 'project-asset');
      check(record?.data.family === 'IMAGE' && record.sha256 === c.sourceSha256 && c.paragraphId === null && c.sceneId === null && c.pageNumber === null && c.textSha256 === null, 'UNIVERSE_CITATION_IMAGE_MISMATCH');
    } else if (c.kind.startsWith('LORE_')) {
      const record = records.find(r => r.id === c.sourceId && r.kind === 'lore-source');
      check(record && record.sha256 === c.sourceSha256 && c.sceneId === null && c.paragraphId === null, 'UNIVERSE_CITATION_CHANGED');
      check(c.kind === 'LORE_SOURCE' ? c.pageNumber === null && c.textSha256 === null && c.excerpt === '' : record.data.extraction?.pages[c.pageNumber - 1]?.textSha256 === c.textSha256, 'UNIVERSE_CITATION_PAGE_MISMATCH');
    } else if (c.kind === 'SOURCE_CHARACTER') {
      const character = project.characters.find(item => item.id === c.sourceId);
      check(character && hashValue(character) === c.sourceSha256 && c.paragraphId === null && c.sceneId === null && c.pageNumber === null && c.textSha256 === null && (character.description ?? '').includes(c.excerpt), 'UNIVERSE_CITATION_CHARACTER_MISMATCH');
    } else {
      check(c.sourceId === project.id && c.sourceSha256 === project.sourceHash && c.pageNumber === null, 'UNIVERSE_CITATION_CHANGED');
      const scene = project.scenes.find(s => s.id === c.sceneId);
      if (c.kind === 'SOURCE_SCENE') check(scene && c.paragraphId === null && c.textSha256 === hash(scene.heading) && scene.heading.includes(c.excerpt), 'UNIVERSE_CITATION_SCENE_MISMATCH');
      else { const paragraph = (scene?.paragraphs ?? project.prologue ?? []).find(p => p.id === c.paragraphId); check(paragraph && c.textSha256 === hash(paragraph.text) && paragraph.text.includes(c.excerpt), 'UNIVERSE_CITATION_PARAGRAPH_MISMATCH'); }
    }
  }
}
function retainedPages(store, records) {
  let bytes = 0, count = 0; const result = [];
  for (const record of records.filter(r => r.kind === 'lore-source' && r.data.extraction)) {
    bytes += record.data.extraction.bytes; count += record.data.extraction.pageCount;
    check(bytes <= 64 * 1024 ** 2 && count <= 20000, 'UNIVERSE_EXTRACTION_LIMIT');
    const content = store.blob(record.data.extraction.sha256).bytes;
    check(content.length === record.data.extraction.bytes && hash(content) === record.data.extraction.sha256, 'UNIVERSE_EXTRACTION_HASH_MISMATCH');
    const pages = JSON.parse(content.toString('utf8'));
    check(Array.isArray(pages) && pages.length === record.data.extraction.pageCount && pages.every((p, i) => p.pageNumber === i + 1 && typeof p.text === 'string' && p.textSha256 === record.data.extraction.pages[i].textSha256 && hash(p.text) === p.textSha256), 'UNIVERSE_PAGE_HASH_MISMATCH');
    result.push({ sourceId: record.id, pages });
  }
  return result;
}
export function universeSnapshot(store) {
  const project = store.resolvedProject(), records = store.rawList();
  checkedRecords(project, records);
  for (const record of records.filter(r => r.kind === 'project-asset' && chartData.charts.some(c => c.imageSha256 === r.data.asset?.sha256))) store.blobInfo(record.data.asset.sha256);
  for (const record of records.filter(r => r.kind === 'universe-artwork')) {
    validateUniverseRecord(record.kind, record.data, project);
    verifyProjectAssetRecord(store, artworkAsset(project, records, record.data));
  }
  for (const record of records.filter(r => r.kind === 'universe-rehearsal' || r.kind === 'universe-production-plan' || r.kind === 'universe-continuity-plan')) store.validateSavedRecord(record);
  return deriveUniverse({ project, records, lorePages: retainedPages(store, records), sourceKinds: Object.fromEntries(records.filter(r => r.kind === 'lore-source').map(r => [r.id, retainedLoreSourceKind(store, r)])) });
}
export function validateUniverseRecordReferences(store, kind, data, { id, version, previous, newWrite = false } = {}) {
  if (!UNIVERSE_KINDS.includes(kind)) { check(!id?.startsWith('universe-'), 'UNIVERSE_RECORD_IDENTITY_MISMATCH'); return; }
  const project = store.resolvedProject(), records = store.rawList(); validateUniverseRecord(kind, data, project);
  check(typeof id === 'string' && (kind === 'universe-continuity-plan' ? id === `${kind}:${data.sourceHash ?? data.projectId}` : ['universe-entity', 'universe-artwork', 'universe-agent', 'universe-profile', 'universe-production-plan'].includes(kind) ? id === `${kind}:${data.entityId}` : id.startsWith(`${kind}:`)), 'UNIVERSE_RECORD_IDENTITY_MISMATCH');
  validateRecordCitationTargets(project, records, data.citations);
  // Validate quoted page excerpts against retained exact text at save/read time.
  const pages = retainedPages(store, records);
  for (const c of data.citations.filter(c => c.kind === 'LORE_PAGE')) check(pages.find(p => p.sourceId === c.sourceId)?.pages.find(p => p.pageNumber === c.pageNumber)?.text.includes(c.excerpt), 'UNIVERSE_CITATION_EXCERPT_MISMATCH');
  const current = records.find(r => r.id === id);
  if (newWrite && current) check(current.data.sourceHash === data.sourceHash && current.data.projectId === data.projectId, 'UNIVERSE_RECORD_SCOPE_CHANGED');
  const catalog = deriveUniverse({ project, records: [...records.filter(r => r.id !== id), { id, kind, version: (current?.version ?? 0) + 1, sha256: hashValue(data), data }], lorePages: pages, sourceKinds: Object.fromEntries(records.filter(r => r.kind === 'lore-source').map(r => [r.id, retainedLoreSourceKind(store, r)])) });
  if (kind === 'universe-production-plan' && newWrite) {
    const entity = catalog.entities.find(value => value.id === data.entityId);
    check(entity?.type === data.entityType && entity.name === data.entityName, 'UNIVERSE_PRODUCTION_PLAN_TARGET_CHANGED');
  }
  if (kind === 'universe-production-plan') {
    const entity = catalog.entities.find(value => value.id === data.entityId);
    for (const need of data.needs.filter(value => value.sourceLinkBasis)) {
      const basis = need.sourceLinkBasis, reference = basis.continuityRef;
      const historical = store.history(reference.id).find(record => record.version === reference.version && record.sha256 === reference.sha256);
      check(historical?.kind === 'universe-continuity-plan', 'UNIVERSE_PRODUCTION_SOURCE_LINK_REFERENCE_MISSING');
      validateUniverseRecord(historical.kind, historical.data, project);
      check(historical.data.review === 'PROPOSED', 'UNIVERSE_PRODUCTION_SOURCE_LINK_REFERENCE_INVALID');
      for (const linked of basis.aliases) {
        const alias = historical.data.aliases.find(value => value.id === linked.aliasId);
        check(alias?.decision === 'SAME_CHARACTER' && alias.review === 'PROPOSED'
          && (alias.fromEntityId === data.entityId && alias.toEntityId === linked.observationId
            || alias.toEntityId === data.entityId && alias.fromEntityId === linked.observationId), 'UNIVERSE_PRODUCTION_SOURCE_LINK_ALIAS_MISMATCH');
      }
      const retained = current?.data.needs?.find(value => value.id === need.id)?.sourceLinkBasis;
      // A new or replaced snapshot must match live source membership, scenes
      // and the exact current continuity revision. Existing snapshots remain
      // immutable historical context when later identity decisions change.
      // Manual scene edits do not re-assert that historical basis is current.
      if (newWrite && (!retained || hashValue(retained) !== hashValue(basis))) {
        check(sourceLinkBasisIsCurrent(catalog, entity, basis), 'UNIVERSE_PRODUCTION_SOURCE_LINK_BASIS_STALE');
      }
    }
  }
  if (kind === 'universe-entity' && data.imageHash !== null) {
    const info = store.blobInfo(data.imageHash);
    check(/^image\/(?:png|jpeg|webp|gif)$/.test(info.mime_type ?? info.mimeType ?? ''), 'UNIVERSE_IMAGE_TYPE_INVALID');
  }
  if (kind === 'universe-artwork') verifyProjectAssetRecord(store, artworkAsset(project, records, data));
  if (kind === 'universe-rehearsal') {
    if (version !== undefined) validateWorldRehearsalTransition(previous, data, version);
    const exact = reference => {
      const record = store.history(reference.id).find(row => row.sha256 === reference.sha256);
      check(record && hashValue(record.data) === reference.sha256 && record.data.sourceHash === data.sourceHash, 'REHEARSAL_REFERENCE_CHANGED'); return record;
    };
    for (const party of data.participants) {
      const profile = exact(party.profileRef);
      validateUniverseRecord(profile.kind, profile.data, project);
      check(profile.kind === 'universe-agent' && profile.id === `universe-agent:${party.entityId}` && profile.data.entityId === party.entityId && profile.data.review === 'PROPOSED', 'REHEARSAL_PROFILE_INVALID');
      if (newWrite && !previous) check(store.history(profile.id).at(-1)?.sha256 === profile.sha256, 'REHEARSAL_PROFILE_CHANGED');
    }
    for (const round of data.rounds) for (const intent of round.intents.filter(item => item.proposalRef !== null)) {
      const proposal = exact(intent.proposalRef), party = data.participants.find(item => item.entityId === intent.actorId);
      store.validateRecord(proposal.kind, proposal.data, project);
      const preceding = store.history(id).find(row => row.version === round.basisRound + 1);
      check(proposal.kind === 'model-assistance' && proposal.data.status === 'COMPLETED' && preceding && proposal.data.input.characterAgentRef?.id === party.profileRef.id && proposal.data.input.characterAgentRef?.sha256 === party.profileRef.sha256 && proposal.data.input.rehearsalRef?.id === id && proposal.data.input.rehearsalRef?.sha256 === preceding.sha256, 'REHEARSAL_PROPOSAL_CONTEXT_MISMATCH');
    }
  }
}
