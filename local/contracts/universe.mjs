// Universe curation is research and draft authoring. No record grants canon,
// screenplay admission, casting clearance or production approval.
import { validateWorldRehearsal } from './world-rehearsal.mjs';
import { validateUniverseProfileFields } from './universe-profile.mjs';
import { validateUniverseProductionPlanFields } from './universe-production-plan.mjs';
import { validateUniverseContinuityFields, validateUniverseContinuityTargets } from './universe-continuity.mjs';
import { isCreativeProject, projectOwnedContext, validateCreativeProject } from './creative-project.mjs';
export const UNIVERSE_KINDS = Object.freeze(['universe-entity', 'universe-claim', 'universe-link', 'universe-artwork', 'universe-agent', 'universe-rehearsal', 'universe-profile', 'universe-production-plan', 'universe-continuity-plan']);
export const PROJECT_OWNED_UNIVERSE_KINDS = Object.freeze(['universe-entity', 'universe-profile', 'universe-claim', 'universe-link', 'universe-continuity-plan', 'universe-production-plan']);
export const UNIVERSE_TYPES = Object.freeze(['character', 'location', 'story', 'reference', 'group', 'world_rule', 'thematic_note']);
export const UNIVERSE_RELATIONS = Object.freeze(['appears_in', 'set_in', 'source_for', 'related_to', 'possible_alias', 'member_of', 'located_in', 'before', 'conflicts_with']);
export const UNIVERSE_REVIEWS = Object.freeze(['PROPOSED', 'QUESTIONED', 'SET_ASIDE']);
export const UNIVERSE_LIMITS = Object.freeze({ entities: 1000, links: 4000, drafts: 2000, citations: 32, scenes: 100, text: 8000 });
const kinds = ['SOURCE_PARAGRAPH', 'SOURCE_SCENE', 'SOURCE_CHARACTER', 'LORE_SOURCE', 'LORE_PAGE', 'ASSET_IMAGE'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const identity = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,139}$/.test(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v, max, empty = false) => typeof v === 'string' && (empty || v.trim().length > 0) && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v) && v.isWellFormed();
export function universeAssert(condition, code) { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); }
const shape = (v, fields) => universeAssert(object(v) && Object.keys(v).sort().join(',') === [...fields].sort().join(','), 'UNIVERSE_FIELDS_INVALID');
const idList = (v, max) => Array.isArray(v) && v.length <= max && v.every(identity) && new Set(v).size === v.length;
// Large read model only: individual saved records still use the existing 1 MiB
// canonical serializer. The browser and server share this exact bounded form.
export function universeCatalogCanonical(value) {
  let nodes = 0;
  function normalize(item, depth) {
    universeAssert(depth <= 32 && ++nodes <= 250000, 'UNIVERSE_SERIALIZATION_LIMIT');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') { universeAssert(Number.isSafeInteger(item) && !Object.is(item, -0), 'UNIVERSE_NUMBER_INVALID'); return item; }
    if (Array.isArray(item)) { universeAssert(Object.keys(item).length === item.length && Array.from({ length: item.length }, (_, i) => Object.hasOwn(item, i)).every(Boolean), 'UNIVERSE_ARRAY_INVALID'); return item.map(v => normalize(v, depth + 1)); }
    universeAssert(object(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item)), 'UNIVERSE_JSON_INVALID');
    const result = {};
    for (const name of Object.keys(item).sort()) { universeAssert(!['__proto__', 'constructor', 'prototype'].includes(name), 'UNIVERSE_JSON_KEY_INVALID'); result[name] = normalize(item[name], depth + 1); }
    return result;
  }
  const serialized = JSON.stringify(normalize(value, 0)); universeAssert(new TextEncoder().encode(serialized).length <= 16 * 1024 ** 2, 'UNIVERSE_SERIALIZATION_LIMIT'); return serialized;
}
export function validateUniverseCitation(v, project) {
  shape(v, ['kind', 'sourceHash', 'sourceId', 'sourceSha256', 'paragraphId', 'sceneId', 'pageNumber', 'textSha256', 'label', 'excerpt']);
  universeAssert(kinds.includes(v.kind) && hash(v.sourceHash) && identity(v.sourceId) && hash(v.sourceSha256) && text(v.label, 300) && text(v.excerpt, 4000, true), 'UNIVERSE_CITATION_INVALID');
  universeAssert(v.paragraphId === null || identity(v.paragraphId), 'UNIVERSE_CITATION_PARAGRAPH_INVALID');
  universeAssert(v.sceneId === null || identity(v.sceneId), 'UNIVERSE_CITATION_SCENE_INVALID');
  universeAssert(v.pageNumber === null || Number.isSafeInteger(v.pageNumber) && v.pageNumber >= 1 && v.pageNumber <= 2000, 'UNIVERSE_CITATION_PAGE_INVALID');
  universeAssert(v.textSha256 === null || hash(v.textSha256), 'UNIVERSE_CITATION_TEXT_INVALID');
  universeAssert(!project || v.sourceHash === project.sourceHash && (v.sceneId === null || project.scenes.some(s => s.id === v.sceneId)), 'UNIVERSE_CITATION_SOURCE_MISMATCH');
  return v;
}
function citations(values, project) {
  universeAssert(Array.isArray(values) && values.length <= UNIVERSE_LIMITS.citations, 'UNIVERSE_CITATION_LIMIT');
  values.forEach(value => validateUniverseCitation(value, project));
}
function sceneIds(values, project) { universeAssert(idList(values, UNIVERSE_LIMITS.scenes) && (!project || values.every(id => project.scenes.some(scene => scene.id === id))), 'UNIVERSE_SCENE_MISMATCH'); }
export function validateUniverseRecord(kind, data, project) {
  universeAssert(UNIVERSE_KINDS.includes(kind), 'UNIVERSE_KIND_INVALID');
  const sceneProject = project;
  project = projectOwnedContext(project, kind, data);
  const projectOwned = data?.sourceHash === null;
  if (projectOwned) {
    universeAssert(PROJECT_OWNED_UNIVERSE_KINDS.includes(kind) && isCreativeProject(project), 'UNIVERSE_PROJECT_REQUIRED');
    validateCreativeProject(project);
    universeAssert(data.projectId === project.id, 'UNIVERSE_PROJECT_MISMATCH');
    // Source-free intentions cannot invent screenplay citations or scene links.
    universeAssert(Array.isArray(data.citations) && data.citations.length === 0 && (kind !== 'universe-entity' || Array.isArray(data.sceneIds) && data.sceneIds.length === 0), 'UNIVERSE_SOURCE_REQUIRED');
  }
  if (kind === 'universe-rehearsal') return validateWorldRehearsal(data, project);
  const common = ['schemaVersion', 'sourceHash', 'citations', 'status', 'review', ...(projectOwned ? ['projectId'] : [])];
  shape(data, [...common, ...(kind === 'universe-entity' ? ['entityId', 'type', 'name', 'summary', 'imageHash', 'sceneIds'] : kind === 'universe-claim' ? ['entityId', 'title', 'body'] : kind === 'universe-artwork' ? ['entityId', 'assetRef', 'imageHash', 'prompt', 'generator', 'provenance', 'kind', 'useScope'] : kind === 'universe-agent' ? ['entityId', 'name', 'goals', 'boundaries', 'observations', 'beliefs', 'memories', 'voice'] : kind === 'universe-profile' ? ['entityId', 'entityType', 'fields'] : kind === 'universe-production-plan' ? ['entityId', 'entityType', 'entityName', 'needs'] : kind === 'universe-continuity-plan' ? ['events', 'aliases'] : ['fromEntityId', 'toEntityId', 'relation', 'label'])]);
  universeAssert(data.schemaVersion === 1 && (projectOwned || hash(data.sourceHash) && (!project || data.sourceHash === project.sourceHash)), 'UNIVERSE_SOURCE_MISMATCH');
  universeAssert(data.status === 'DRAFT' && UNIVERSE_REVIEWS.includes(data.review), 'UNIVERSE_AUTHORITY_INVALID');
  citations(data.citations, project);
  if (kind === 'universe-continuity-plan') {
    validateUniverseContinuityFields(data, sceneProject);
  } else if (kind === 'universe-production-plan') {
    validateUniverseProductionPlanFields(data, sceneProject);
  } else if (kind === 'universe-profile') {
    validateUniverseProfileFields(data);
  } else if (kind === 'universe-agent') {
    universeAssert(identity(data.entityId) && text(data.name, 240) && text(data.voice, 1000, true), 'UNIVERSE_AGENT_IDENTITY_INVALID');
    for (const field of ['goals', 'boundaries', 'observations', 'beliefs', 'memories']) {
      const values = data[field];
      universeAssert(Array.isArray(values) && values.length <= 8 && (field !== 'goals' || values.length > 0) && values.every(value => text(value, 400) && !/[\r\n]/.test(value)), 'UNIVERSE_AGENT_STATE_INVALID');
    }
  } else if (kind === 'universe-artwork') {
    universeAssert(identity(data.entityId) && data.citations.length === 0, 'UNIVERSE_ARTWORK_ENTITY_INVALID');
    validateUniverseArtworkFields(data);
  } else if (kind === 'universe-entity') {
    universeAssert(identity(data.entityId) && UNIVERSE_TYPES.includes(data.type) && text(data.name, 240) && text(data.summary, UNIVERSE_LIMITS.text, true) && (data.imageHash === null || hash(data.imageHash)), 'UNIVERSE_ENTITY_INVALID');
    sceneIds(data.sceneIds, project);
  } else if (kind === 'universe-claim') {
    universeAssert(identity(data.entityId) && text(data.title, 240) && text(data.body, UNIVERSE_LIMITS.text), 'UNIVERSE_CLAIM_INVALID');
  } else {
    universeAssert(identity(data.fromEntityId) && identity(data.toEntityId) && data.fromEntityId !== data.toEntityId && UNIVERSE_RELATIONS.includes(data.relation) && text(data.label, 240), 'UNIVERSE_LINK_INVALID');
  }
  return data;
}
function ref(value) { universeAssert(value === null || object(value) && Object.keys(value).sort().join(',') === 'id,sha256' && identity(value.id) && hash(value.sha256), 'UNIVERSE_RECORD_REF_INVALID'); }
function validateUniverseArtworkFields(value) {
  ref(value.assetRef);
  universeAssert(value.assetRef !== null && hash(value.imageHash) && value.assetRef.id === `project-asset:${value.imageHash}` && text(value.prompt, 8000), 'UNIVERSE_ARTWORK_ASSET_INVALID');
  shape(value.generator, ['tool', 'model', 'requestId']);
  universeAssert(text(value.generator.tool, 120) && (value.generator.model === null || text(value.generator.model, 200)) && (value.generator.requestId === null || text(value.generator.requestId, 240)), 'UNIVERSE_ARTWORK_GENERATOR_INVALID');
  universeAssert(value.kind === 'AI_GENERATED_PLACEHOLDER' && value.useScope === 'CONCEPT_ONLY' && value.provenance === 'RECORDED_NOT_VERIFIED' && value.review === 'PROPOSED', 'UNIVERSE_ARTWORK_AUTHORITY_INVALID');
}
export function universeArtworkView(record) {
  const { assetRef, imageHash, prompt, generator, provenance, kind, useScope, review } = record.data;
  return { recordRef: { id: record.id, sha256: record.sha256 }, assetRef, imageHash, prompt, generator, provenance, kind, useScope, review };
}
export function validateUniverseCatalog(value, project) {
  shape(value, ['schema', 'projectId', 'sourceHash', 'basisHash', 'scope', 'entities', 'links', 'storylines', 'coverage', 'questions', 'drafts']);
  universeAssert(value.schema === 'caniscreenwrite-universe/v1' && value.scope === 'RESEARCH_AND_DRAFTS' && value.projectId === project.id && value.sourceHash === project.sourceHash && hash(value.basisHash), 'UNIVERSE_PROJECT_MISMATCH');
  universeAssert(Array.isArray(value.entities) && value.entities.length <= UNIVERSE_LIMITS.entities && Array.isArray(value.links) && value.links.length <= UNIVERSE_LIMITS.links && Array.isArray(value.drafts) && value.drafts.length <= UNIVERSE_LIMITS.drafts, 'UNIVERSE_CATALOG_LIMIT');
  const entities = new Set(), links = new Set();
  for (const entity of value.entities) {
    shape(entity, ['id', 'type', 'name', 'summary', 'origin', 'review', 'imageHash', 'sceneIds', 'citations', 'recordRef', 'storylineIds', ...(Object.hasOwn(entity, 'artwork') ? ['artwork'] : [])]);
    universeAssert(identity(entity.id) && !entities.has(entity.id) && UNIVERSE_TYPES.includes(entity.type) && text(entity.name, 240) && text(entity.summary, UNIVERSE_LIMITS.text, true) && ['SCREENPLAY', 'LORE_SOURCE', 'DRAFT', 'USER_AUTHORED'].includes(entity.origin) && ['OBSERVED', ...UNIVERSE_REVIEWS].includes(entity.review) && (entity.imageHash === null || hash(entity.imageHash)) && idList(entity.storylineIds, 100), 'UNIVERSE_ENTITY_INVALID');
    entities.add(entity.id); citations(entity.citations, project); sceneIds(entity.sceneIds, project); ref(entity.recordRef);
    if (Object.hasOwn(entity, 'artwork')) {
      shape(entity.artwork, ['recordRef', 'assetRef', 'imageHash', 'prompt', 'generator', 'provenance', 'kind', 'useScope', 'review']);
      ref(entity.artwork.recordRef); universeAssert(entity.artwork.recordRef !== null, 'UNIVERSE_RECORD_REF_INVALID'); validateUniverseArtworkFields(entity.artwork);
    }
  }
  for (const link of value.links) {
    shape(link, ['id', 'fromEntityId', 'toEntityId', 'relation', 'label', 'sceneIds', 'citations', 'origin', 'review', 'recordRef']);
    universeAssert(identity(link.id) && !links.has(link.id) && entities.has(link.fromEntityId) && entities.has(link.toEntityId) && link.fromEntityId !== link.toEntityId && UNIVERSE_RELATIONS.includes(link.relation) && text(link.label, 240) && ['SCREENPLAY', 'LORE_SOURCE', 'DRAFT'].includes(link.origin) && ['OBSERVED', ...UNIVERSE_REVIEWS].includes(link.review), 'UNIVERSE_LINK_ORPHAN_OR_INVALID');
    links.add(link.id); citations(link.citations, project); sceneIds(link.sceneIds, project); ref(link.recordRef);
  }
  universeAssert(Array.isArray(value.storylines) && value.storylines.length <= 100, 'UNIVERSE_STORYLINES_INVALID');
  const groups = new Set();
  for (const group of value.storylines) {
    shape(group, ['id', 'title', 'entityIds', 'sourceIds', 'sceneIds', 'status', 'basis']);
    universeAssert(identity(group.id) && !groups.has(group.id) && text(group.title, 240) && idList(group.entityIds, UNIVERSE_LIMITS.entities) && group.entityIds.every(id => entities.has(id)) && idList(group.sourceIds, UNIVERSE_LIMITS.entities) && ['SOURCE_MATCHES', 'NO_SOURCE_MATCH'].includes(group.status) && group.basis === 'TITLE_CLASSIFICATION_ONLY', 'UNIVERSE_STORYLINES_INVALID');
    groups.add(group.id); sceneIds(group.sceneIds, project);
  }
  universeAssert(value.entities.every(entity => entity.storylineIds.every(id => groups.has(id))), 'UNIVERSE_STORYLINE_ORPHAN');
  const coverageFields = ['retainedSources', 'retainedPages', 'pagesWithText', 'pagesWithoutText', 'imageSources', 'projectAssets', 'sourceScenes', 'sourceCharacters', 'sourceParagraphs', 'parsedLorePages', 'candidateCharacters', 'candidateLocations'];
  shape(value.coverage, [...coverageFields, 'candidateLimitReached']); universeAssert(coverageFields.every(field => Number.isSafeInteger(value.coverage[field]) && value.coverage[field] >= 0) && typeof value.coverage.candidateLimitReached === 'boolean', 'UNIVERSE_COVERAGE_INVALID');
  universeAssert(Array.isArray(value.questions) && value.questions.length <= 3000, 'UNIVERSE_QUESTIONS_INVALID');
  for (const question of value.questions) { shape(question, ['id', 'text', 'entityIds', 'citations']); universeAssert(identity(question.id) && text(question.text, UNIVERSE_LIMITS.text) && idList(question.entityIds, 100) && question.entityIds.every(id => entities.has(id)), 'UNIVERSE_QUESTION_INVALID'); citations(question.citations, project); }
  const ids = new Set();
  for (const draft of value.drafts) { universeAssert(object(draft) && identity(draft.id) && !ids.has(draft.id) && Number.isSafeInteger(draft.version) && draft.version > 0 && hash(draft.sha256), 'UNIVERSE_DRAFT_INVALID'); ids.add(draft.id); validateUniverseRecord(draft.kind, draft.data, project); }
  for (const entity of value.entities.filter(e => e.recordRef)) { const draft = value.drafts.find(d => d.id === entity.recordRef.id && d.sha256 === entity.recordRef.sha256); universeAssert(draft?.kind === 'universe-entity' && draft.data.entityId === entity.id, 'UNIVERSE_RECORD_REF_MISMATCH'); }
  for (const link of value.links.filter(e => e.recordRef)) { const draft = value.drafts.find(d => d.id === link.recordRef.id && d.sha256 === link.recordRef.sha256); universeAssert(draft?.kind === 'universe-link' && draft.data.fromEntityId === link.fromEntityId && draft.data.toEntityId === link.toEntityId, 'UNIVERSE_RECORD_REF_MISMATCH'); }
  for (const entity of value.entities.filter(e => e.artwork)) {
    const draft = value.drafts.find(d => d.id === entity.artwork.recordRef.id && d.sha256 === entity.artwork.recordRef.sha256);
    universeAssert(draft?.kind === 'universe-artwork' && draft.id === `universe-artwork:${entity.id}` && draft.data.entityId === entity.id && universeCatalogCanonical(entity.artwork) === universeCatalogCanonical(universeArtworkView(draft)), 'UNIVERSE_ARTWORK_RECORD_MISMATCH');
  }
  for (const draft of value.drafts.filter(d => d.kind === 'universe-artwork')) universeAssert(value.entities.some(e => e.id === draft.data.entityId && e.artwork?.recordRef.id === draft.id && e.artwork.recordRef.sha256 === draft.sha256), 'UNIVERSE_ARTWORK_ORPHAN');
  for (const draft of value.drafts.filter(d => d.kind === 'universe-agent')) {
    const entity = value.entities.find(e => e.id === draft.data.entityId);
    universeAssert(draft.id === `universe-agent:${draft.data.entityId}` && entity?.type === 'character' && entity.name === draft.data.name, 'UNIVERSE_AGENT_TARGET_INVALID');
  }
  for (const draft of value.drafts.filter(d => d.kind === 'universe-profile')) {
    const entity = value.entities.find(e => e.id === draft.data.entityId);
    universeAssert(draft.id === `universe-profile:${draft.data.entityId}` && entity?.type === draft.data.entityType, 'UNIVERSE_PROFILE_TARGET_INVALID');
  }
  for (const draft of value.drafts.filter(d => d.kind === 'universe-production-plan')) {
    const entity = value.entities.find(e => e.id === draft.data.entityId);
    universeAssert(draft.id === `universe-production-plan:${draft.data.entityId}` && entity?.type === draft.data.entityType, 'UNIVERSE_PRODUCTION_PLAN_TARGET_INVALID');
  }
  for (const draft of value.drafts.filter(d => d.kind === 'universe-continuity-plan')) {
    universeAssert(draft.id === `universe-continuity-plan:${draft.data.sourceHash ?? draft.data.projectId}`, 'UNIVERSE_CONTINUITY_PLAN_ID_INVALID');
    validateUniverseContinuityTargets(draft.data, value.entities);
  }
  return value;
}
