// Structured author intentions share the existing universe identity and draft
// store. These descriptions are not actor memories, executable rules, or canon.
const allTypes = ['character', 'location', 'story', 'reference', 'group', 'world_rule', 'thematic_note'];
const field = (id, label, hint) => Object.freeze({ id, label, hint });
const section = (id, label, types, fields) => Object.freeze({ id, label, types: Object.freeze(types), fields: Object.freeze(fields) });
export const UNIVERSE_PROFILE_SECTIONS = Object.freeze([
  section('character', 'Character foundations', ['character'], [
    field('dominantIdentity', 'Dominant identity', 'How does this character define themself? Keep this an author intention.'),
    field('opposingTrait', 'Opposing trait', 'What believable contradiction complicates that identity?'),
    field('pressureMask', 'Under pressure', 'What do they present or conceal when tested?'),
    field('nonNegotiable', 'Non-negotiable', 'What line do you intend this character to resist crossing?'),
    field('desire', 'Desire', 'What does the character pursue in the story?'),
    field('need', 'Need', 'What deeper change might that pursuit require?'),
    field('obstacle', 'Obstacle', 'What internal or external force obstructs the pursuit?'),
    field('change', 'Intended change', 'Describe the planned arc without asserting it already happened.'),
  ]),
  section('world', 'World foundations', ['location', 'group', 'story'], [
    field('setting', 'Setting', 'Describe the place or society and its role in the story.'),
    field('timePeriod', 'Time period', 'State the intended era and any unresolved chronology.'),
    field('geography', 'Geography', 'Describe terrain, boundaries, routes, and spatial constraints.'),
    field('culture', 'Culture', 'Describe customs, institutions, values, and disagreements.'),
    field('technology', 'Technology', 'Describe available technology or magic and its limits.'),
    field('uniqueElements', 'Distinctive elements', 'What makes this setting specific to this story?'),
  ]),
  section('world_rule', 'World rule', ['world_rule'], [
    field('scope', 'Scope', 'Where and when is this proposed rule intended to apply?'),
    field('trigger', 'Trigger', 'What circumstance would activate it? This is descriptive, not executable.'),
    field('effect', 'Effect', 'Describe its intended consequence.'),
    field('cost', 'Cost', 'What is consumed, risked, or given up?'),
    field('exceptions', 'Exceptions', 'Where does it fail, change, or remain uncertain?'),
    field('whoKnows', 'Who knows', 'Describe intended knowledge and uncertainty; actor observations are recorded separately.'),
  ]),
  section('narrative', 'Narrative design', ['story', 'thematic_note'], [
    field('tradition', 'Story tradition', 'Name a chosen storytelling tradition or influence, if useful.'),
    field('structureModel', 'Structure model', 'Describe the chosen structure without forcing the screenplay into it.'),
    field('coreWant', 'Core want', 'What pursuit carries this story?'),
    field('coreNeed', 'Core need', 'What deeper transformation is the story exploring?'),
    field('coreObstacle', 'Core obstacle', 'What resists that pursuit or transformation?'),
    field('centralPattern', 'Central pattern', 'What choice, conflict, or image recurs?'),
    field('intendedTurn', 'Intended turn', 'Describe a proposed turning point; this does not change source scenes.'),
    field('equilibrium', 'Equilibrium', 'Describe the intended starting balance and how it may change.'),
    field('themeClaim', 'Theme claim', 'What idea does the story put forward?'),
    field('themeCounterclaim', 'Theme counterclaim', 'What competing idea meaningfully challenges it?'),
  ]),
  section('visual', 'Visual design', allTypes, [
    field('coreTheme', 'Visual theme', 'What idea should the visual language carry?'),
    field('visualQuestion', 'Visual question', 'What should the audience notice or wonder about?'),
    field('colorArc', 'Color arc', 'Describe intended color changes across the story.'),
    field('perspectiveArc', 'Perspective arc', 'How should viewpoint, framing, or distance evolve?'),
    field('symbolMeaning', 'Symbol meaning', 'What meaning is proposed for a recurring visual element?'),
    field('symbolEvolution', 'Symbol evolution', 'How might that meaning or appearance change?'),
  ]),
]);

export function profileFieldsForType(type) {
  return UNIVERSE_PROFILE_SECTIONS.filter(item => item.types.includes(type)).flatMap(item => item.fields);
}
export const UNIVERSE_PROFILE_LIMITS = Object.freeze({ fieldText: 2000, totalText: 20000 });
function requireValue(condition, code) { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); }
// Shared universe validation owns the enclosing schema, source, citations, and
// review fields. This validator owns only profile identity/type and field data.
export function validateUniverseProfileFields(data) {
  requireValue(typeof data.entityId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,139}$/.test(data.entityId)
    && allTypes.includes(data.entityType), 'UNIVERSE_PROFILE_IDENTITY_INVALID');
  requireValue(data.fields !== null && typeof data.fields === 'object' && !Array.isArray(data.fields)
    && [Object.prototype, null].includes(Object.getPrototypeOf(data.fields)), 'UNIVERSE_PROFILE_FIELDS_INVALID');
  const allowed = new Set(profileFieldsForType(data.entityType).map(item => item.id));
  const entries = Object.entries(data.fields);
  requireValue(entries.length > 0 && entries.every(([key]) => allowed.has(key)), 'UNIVERSE_PROFILE_FIELDS_INVALID');
  requireValue(entries.every(([, value]) => typeof value === 'string' && value.length <= UNIVERSE_PROFILE_LIMITS.fieldText
    && value.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)), 'UNIVERSE_PROFILE_TEXT_INVALID');
  requireValue(entries.reduce((total, [, value]) => total + value.length, 0) <= UNIVERSE_PROFILE_LIMITS.totalText, 'UNIVERSE_PROFILE_TEXT_LIMIT');
  requireValue(entries.some(([, value]) => value.trim().length > 0), 'UNIVERSE_PROFILE_EMPTY');
  return data;
}
