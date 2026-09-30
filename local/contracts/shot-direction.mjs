import craft from '../content/filmcraft/craft-v1.json' with { type: 'json' };
import terminology from '../content/filmcraft/terminology-v1.json' with { type: 'json' };
import science from '../content/filmcraft/science-foundations.v1.json' with { type: 'json' };

// These versioned catalogs are frozen. Direction retains artistic choices;
// citations do not turn those choices into camera settings or execution.
const superseded = new Set(terminology.entries.flatMap(entry => entry.supersedesCraftIds ?? []));
const references = new Map([...terminology.entries, ...science.principles, ...craft.cards.filter(entry => !superseded.has(entry.id))].map(entry => [entry.id, entry]));
const labels = Object.freeze({ purpose: 'Purpose', shotSize: 'Shot size', composition: 'Composition', viewpoint: 'Viewpoint', focus: 'Attention / focus', movement: 'Movement intention', editConnection: 'Incoming / outgoing cut' });
const fields = ['schemaVersion', 'projectId', 'sourceHash', 'sceneId', 'shotId', 'status', ...Object.keys(labels), 'referenceIds'];
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code, status: 422 }); };

export function shotDirectionId(sceneId, shotId) {
  need(idValid(sceneId) && idValid(shotId), 'SHOT_DIRECTION_SCOPE_INVALID');
  const id = `shot-direction:${sceneId}:${shotId}`;
  need(id.length <= 160, 'SHOT_DIRECTION_ID_TOO_LONG');
  return id;
}

export function blankShotDirection(project, sceneId, shotId) {
  return validateShotDirection({ schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash, sceneId, shotId,
    status: 'DRAFT', ...Object.fromEntries(Object.keys(labels).map(key => [key, ''])), referenceIds: [] }, project);
}

export function validateShotDirection(data, project) {
  need(object(data) && Object.keys(data).sort().join(',') === [...fields].sort().join(','), 'SHOT_DIRECTION_FIELDS_INVALID');
  need(data.schemaVersion === 1 && data.status === 'DRAFT', 'SHOT_DIRECTION_STATUS_INVALID');
  need(idValid(data.projectId) && typeof data.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(data.sourceHash), 'SHOT_DIRECTION_SOURCE_INVALID');
  shotDirectionId(data.sceneId, data.shotId);
  for (const key of Object.keys(labels)) need(typeof data[key] === 'string' && data[key].length <= (key === 'purpose' ? 4000 : 2000)
    && data[key].isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(data[key]), 'SHOT_DIRECTION_TEXT_INVALID');
  need(Array.isArray(data.referenceIds) && data.referenceIds.length <= 8 && new Set(data.referenceIds).size === data.referenceIds.length
    && data.referenceIds.every(id => typeof id === 'string' && references.has(id)), 'SHOT_DIRECTION_REFERENCES_INVALID');
  if (project) {
    need(project.id === data.projectId && project.sourceHash === data.sourceHash, 'SHOT_DIRECTION_PROJECT_OR_SOURCE_MISMATCH');
    need(project.scenes?.some(scene => scene.id === data.sceneId && scene.shots?.some(shot => shot.id === data.shotId)), 'SHOT_DIRECTION_SHOT_MISSING');
    // The requested readable ID uses colons. Reject an ambiguous project scope
    // rather than allowing two scene/shot pairs to overwrite one record.
    const id = shotDirectionId(data.sceneId, data.shotId);
    need(project.scenes.flatMap(scene => (scene.shots ?? []).map(shot => `shot-direction:${scene.id}:${shot.id}`)).filter(value => value === id).length === 1, 'SHOT_DIRECTION_SCOPE_AMBIGUOUS');
  }
  return data;
}

export function validateShotDirectionIdentity(id, kind, data) {
  if (kind !== 'shot-direction' && !String(id).startsWith('shot-direction:')) return;
  need(kind === 'shot-direction' && object(data) && id === shotDirectionId(data.sceneId, data.shotId), 'SHOT_DIRECTION_IDENTITY_INVALID');
}

export function formatShotDirection(data) {
  validateShotDirection(data);
  return [...Object.entries(labels).filter(([key]) => data[key].trim()).map(([key, label]) => `${label}: ${data[key]}`),
    ...data.referenceIds.map(id => {
      const entry = references.get(id);
      return `Reference ${id}: ${entry.title}\n${entry.sources.map(source => `${source.locator ?? `Slide ${source.slideNumber}`}: ${source.url}`).join('\n')}`;
    })].join('\n\n');
}
