// Author-planned production use of an existing Bible entry. These needs are
// unpriced drafts, not source observations, actor knowledge or authorization.
export const UNIVERSE_PRODUCTION_DEPARTMENTS = Object.freeze(['cast', 'locations', 'art', 'assets', 'equipment', 'generation', 'post', 'audio', 'development', 'other']);
export const UNIVERSE_PRODUCTION_PLAN_LIMITS = Object.freeze({ needs: 64, label: 240, description: 2000, totalText: 64000, scenes: 100 });
const types = ['character', 'location', 'story', 'reference', 'group', 'world_rule', 'thematic_note'];
const reviews = ['PROPOSED', 'QUESTIONED', 'SET_ASIDE'];
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,139}$/.test(value);
const text = (value, max, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= max && value.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const dense = value => Array.isArray(value) && Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); };
const shape = (value, fields) => object(value) && Object.keys(value).sort().join(',') === fields;

export function validateProductionNeedSourceLinkBasis(value, project) {
  need(shape(value, 'aliases,continuityRef,observedSceneIds'), 'UNIVERSE_PRODUCTION_SOURCE_LINK_BASIS_INVALID');
  const reference = value.continuityRef;
  need(shape(reference, 'id,sha256,version') && identity(reference.id) && reference.id.startsWith('universe-continuity-plan:')
    && Number.isSafeInteger(reference.version) && reference.version > 0 && typeof reference.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(reference.sha256), 'UNIVERSE_PRODUCTION_SOURCE_LINK_REFERENCE_INVALID');
  need(dense(value.aliases) && value.aliases.length > 0 && value.aliases.length <= 128, 'UNIVERSE_PRODUCTION_SOURCE_LINK_ALIASES_INVALID');
  const aliases = new Set();
  for (const alias of value.aliases) {
    need(shape(alias, 'aliasId,observationId') && identity(alias.aliasId) && identity(alias.observationId) && !aliases.has(alias.aliasId), 'UNIVERSE_PRODUCTION_SOURCE_LINK_ALIASES_INVALID');
    aliases.add(alias.aliasId);
  }
  need(dense(value.observedSceneIds) && value.observedSceneIds.length <= 100 && value.observedSceneIds.every(identity)
    && new Set(value.observedSceneIds).size === value.observedSceneIds.length
    && (!project || value.observedSceneIds.every(id => project.scenes.some(scene => scene.id === id))), 'UNIVERSE_PRODUCTION_SOURCE_LINK_SCENES_INVALID');
  return value;
}

export function validateUniverseProductionPlanFields(data, project) {
  need(identity(data.entityId) && types.includes(data.entityType) && text(data.entityName, 240), 'UNIVERSE_PRODUCTION_PLAN_IDENTITY_INVALID');
  need(Array.isArray(data.citations) && data.citations.length === 0, 'UNIVERSE_PRODUCTION_PLAN_CITATIONS_INVALID');
  need(dense(data.needs) && data.needs.length <= UNIVERSE_PRODUCTION_PLAN_LIMITS.needs, 'UNIVERSE_PRODUCTION_PLAN_NEEDS_INVALID');
  const ids = new Set(); let totalText = data.entityName.length;
  for (const item of data.needs) {
    need(object(item) && Object.keys(item).sort().join(',') === `department,description,id,label,review,sceneIds${Object.hasOwn(item, 'sourceLinkBasis') ? ',sourceLinkBasis' : ''}`, 'UNIVERSE_PRODUCTION_NEED_FIELDS_INVALID');
    need(identity(item.id) && !ids.has(item.id), 'UNIVERSE_PRODUCTION_NEED_ID_INVALID'); ids.add(item.id);
    need(text(item.label, UNIVERSE_PRODUCTION_PLAN_LIMITS.label) && text(item.description, UNIVERSE_PRODUCTION_PLAN_LIMITS.description, true), 'UNIVERSE_PRODUCTION_NEED_TEXT_INVALID');
    need(UNIVERSE_PRODUCTION_DEPARTMENTS.includes(item.department) && reviews.includes(item.review), 'UNIVERSE_PRODUCTION_NEED_CLASSIFICATION_INVALID');
    need(dense(item.sceneIds) && item.sceneIds.length <= UNIVERSE_PRODUCTION_PLAN_LIMITS.scenes && item.sceneIds.every(identity) && new Set(item.sceneIds).size === item.sceneIds.length
      && (!project || item.sceneIds.every(id => project.scenes.some(scene => scene.id === id))), 'UNIVERSE_PRODUCTION_NEED_SCENE_INVALID');
    if (Object.hasOwn(item, 'sourceLinkBasis')) {
      need(data.entityType === 'character', 'UNIVERSE_PRODUCTION_SOURCE_LINK_CHARACTER_REQUIRED');
      validateProductionNeedSourceLinkBasis(item.sourceLinkBasis, project);
    }
    totalText += item.label.length + item.description.length;
  }
  need(totalText <= UNIVERSE_PRODUCTION_PLAN_LIMITS.totalText, 'UNIVERSE_PRODUCTION_PLAN_TEXT_LIMIT');
  return data;
}
