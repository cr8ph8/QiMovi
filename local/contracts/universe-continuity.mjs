// Explicit author interpretation. These draft event constraints and name
// comparisons never merge entities, rewrite source text or grant actor knowledge.
export const UNIVERSE_CONTINUITY_DECISIONS = Object.freeze(['POSSIBLE_SAME', 'SAME_CHARACTER', 'DISTINCT_CHARACTERS']);
export const UNIVERSE_CONTINUITY_LIMITS = Object.freeze({ events: 128, aliases: 128, title: 240, description: 2000, timeLabel: 240, note: 2000, entities: 100, scenes: 100, beforeEvents: 128, totalText: 128000 });
const reviews = ['PROPOSED', 'QUESTIONED', 'SET_ASIDE'];
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,139}$/.test(value);
const text = (value, max, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= max && value.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const dense = value => Array.isArray(value) && Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);
const ids = (value, max) => dense(value) && value.length <= max && value.every(identity) && new Set(value).size === value.length;
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); };
const shape = (value, fields, code) => need(object(value) && Object.keys(value).sort().join(',') === fields, code);

export function validateUniverseContinuityFields(data, project) {
  need(dense(data.citations) && data.citations.length === 0, 'UNIVERSE_CONTINUITY_CITATIONS_INVALID');
  need(dense(data.events) && data.events.length <= UNIVERSE_CONTINUITY_LIMITS.events, 'UNIVERSE_CONTINUITY_EVENTS_INVALID');
  need(dense(data.aliases) && data.aliases.length <= UNIVERSE_CONTINUITY_LIMITS.aliases, 'UNIVERSE_CONTINUITY_ALIASES_INVALID');
  const eventIds = new Set(), aliasIds = new Set(); let totalText = 0;
  for (const event of data.events) {
    shape(event, 'beforeEventIds,description,entityIds,id,review,sceneIds,timeLabel,title', 'UNIVERSE_CONTINUITY_EVENT_FIELDS_INVALID');
    need(identity(event.id) && !eventIds.has(event.id), 'UNIVERSE_CONTINUITY_EVENT_ID_INVALID'); eventIds.add(event.id);
    need(text(event.title, 240) && text(event.description, 2000, true) && text(event.timeLabel, 240, true), 'UNIVERSE_CONTINUITY_EVENT_TEXT_INVALID');
    need(reviews.includes(event.review), 'UNIVERSE_CONTINUITY_REVIEW_INVALID');
    need(ids(event.entityIds, 100), 'UNIVERSE_CONTINUITY_ENTITIES_INVALID');
    need(ids(event.sceneIds, 100) && (!project || event.sceneIds.every(id => project.scenes.some(scene => scene.id === id))), 'UNIVERSE_CONTINUITY_SCENE_INVALID');
    need(ids(event.beforeEventIds, 128) && !event.beforeEventIds.includes(event.id), 'UNIVERSE_CONTINUITY_ORDER_INVALID');
    totalText += event.title.length + event.description.length + event.timeLabel.length;
  }
  // A beforeEventIds edge means THIS event precedes the referenced event.
  // Multi-event cycles and contradictory alias decisions remain reviewable
  // author drafts; the UI must expose them without inferring a valid chronology.
  for (const event of data.events) need(event.beforeEventIds.every(id => eventIds.has(id)), 'UNIVERSE_CONTINUITY_EVENT_ORPHAN');
  for (const alias of data.aliases) {
    shape(alias, 'decision,fromEntityId,id,note,review,toEntityId', 'UNIVERSE_CONTINUITY_ALIAS_FIELDS_INVALID');
    need(identity(alias.id) && !aliasIds.has(alias.id), 'UNIVERSE_CONTINUITY_ALIAS_ID_INVALID'); aliasIds.add(alias.id);
    need(identity(alias.fromEntityId) && identity(alias.toEntityId) && alias.fromEntityId !== alias.toEntityId, 'UNIVERSE_CONTINUITY_ALIAS_IDENTITY_INVALID');
    need(text(alias.note, 2000, true), 'UNIVERSE_CONTINUITY_ALIAS_TEXT_INVALID');
    need(reviews.includes(alias.review) && UNIVERSE_CONTINUITY_DECISIONS.includes(alias.decision), 'UNIVERSE_CONTINUITY_ALIAS_CLASSIFICATION_INVALID');
    totalText += alias.note.length;
  }
  need(totalText <= UNIVERSE_CONTINUITY_LIMITS.totalText, 'UNIVERSE_CONTINUITY_TEXT_LIMIT');
  return data;
}

export function validateUniverseContinuityTargets(data, entities) {
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  need(data.events.every(event => event.entityIds.every(id => byId.has(id))), 'UNIVERSE_CONTINUITY_ENTITY_ORPHAN');
  need(data.aliases.every(alias => byId.get(alias.fromEntityId)?.type === 'character' && byId.get(alias.toEntityId)?.type === 'character'), 'UNIVERSE_CONTINUITY_ALIAS_TARGET_INVALID');
  return data;
}
