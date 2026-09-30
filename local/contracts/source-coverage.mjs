import { validateProductionElements } from './script-breakdown.mjs';

const reject = message => { throw Object.assign(new Error(message), { code: 'INVALID_SOURCE_COVERAGE', status: 422 }); };
const assert = (value, message) => { if (!value) reject(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const unique = values => new Set(values).size === values.length;
export const COVERAGE_DISPOSITIONS = Object.freeze(['PROPOSED', 'NEEDS_SHOT', 'MAPPED', 'NOT_APPLICABLE']);

/** Read validation preserves legacy proposals; new writes must meet current planning rules. */
export function validateCoverageDraft(data, project, { newWrite = false } = {}) {
  const required = ['sourceHash', 'paragraphId', 'shotIds', 'takeIds', 'note'];
  assert(object(data) && required.every(key => Object.hasOwn(data, key)) && Object.keys(data).every(key => [...required, 'disposition', 'rationale', 'productionElements'].includes(key)), 'Unknown or missing coverage field; authority assertions are not accepted');
  assert(data.sourceHash === project.sourceHash, 'Wrong or stale frozen source');
  const scene = project.scenes.find(value => value.paragraphs.some(paragraph => paragraph.id === data.paragraphId));
  const prologue = (project.prologue ?? []).some(paragraph => paragraph.id === data.paragraphId);
  assert(scene || prologue, 'Unknown paragraph');
  assert(Array.isArray(data.shotIds) && unique(data.shotIds) && data.shotIds.every(id => project.scenes.some(value => value.shots.some(shot => shot.id === id))), 'Unknown coverage shot');
  assert(Array.isArray(data.takeIds) && data.takeIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 120) && typeof data.note === 'string', 'Invalid coverage candidate');
  if (Object.hasOwn(data, 'disposition')) assert(COVERAGE_DISPOSITIONS.includes(data.disposition), 'Invalid planning disposition');
  if (Object.hasOwn(data, 'rationale')) assert(typeof data.rationale === 'string' && data.rationale.length <= 4000, 'Invalid coverage rationale');
  if (Object.hasOwn(data, 'productionElements')) validateProductionElements(data.productionElements);
  if (data.disposition === 'MAPPED') assert(data.shotIds.length > 0, 'MAPPED requires a proposed shot association');
  if (['NEEDS_SHOT', 'NOT_APPLICABLE'].includes(data.disposition)) assert(data.shotIds.length === 0, 'This planning disposition requires no shot associations');
  if (data.disposition === 'NOT_APPLICABLE') assert(data.rationale?.trim().length > 0, 'NOT_APPLICABLE requires an explicit rationale');
  if (newWrite) {
    assert(data.note.length <= 20000 && data.shotIds.length <= (scene ? 10 : 80), 'Coverage planning text or shot limit exceeded');
    if (scene) assert(data.shotIds.every(id => scene.shots.some(shot => shot.id === id)), 'Coverage shots must belong to the source paragraph scene');
    if (prologue && data.shotIds.length && Object.hasOwn(data, 'disposition')) assert(data.rationale?.trim().length > 0, 'A prologue shot association requires an explicit rationale');
    // All currently supported media-take records await measurement and owner
    // selection. None can establish observed coverage, even if its ID exists.
    assert(data.takeIds.length === 0, 'Verified media coverage is not available; takeIds must remain empty');
  }
  return data;
}
