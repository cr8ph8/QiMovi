const reject = message => { throw Object.assign(new Error(message), { code: 'INVALID_SOURCE_PASSAGES', status: 422 }); };
const assert = (value, message) => { if (!value) reject(message); };
export const MAX_SOURCE_PASSAGES = 80;
export const SELECTED_SOURCE_SCOPE = 'SELECTED_SOURCE_PASSAGES_NOT_VERIFIED_COVERAGE';

/** Hashing is injected so the shape/order contract has no platform dependency. */
export function validateSourcePassages(refs, scene, hashText) {
  assert(scene && Array.isArray(scene.paragraphs) && typeof hashText === 'function', 'Source scene and exact text hashing are required');
  assert(Array.isArray(refs) && refs.length > 0 && refs.length <= MAX_SOURCE_PASSAGES, 'Select between 1 and 80 source passages; omit the field to detach');
  let previous = -1;
  for (const ref of refs) {
    assert(ref && typeof ref === 'object' && !Array.isArray(ref) && Object.keys(ref).sort().join(',') === 'paragraphId,textHash', 'Unknown or missing source passage field');
    assert(typeof ref.paragraphId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(ref.paragraphId) && typeof ref.textHash === 'string' && /^[a-f0-9]{64}$/.test(ref.textHash), 'Invalid source passage reference');
    const index = scene.paragraphs.findIndex(paragraph => paragraph.id === ref.paragraphId);
    assert(index > previous, 'Source passages must be unique, in source order and belong to the selected scene');
    const paragraph = scene.paragraphs[index];
    assert(typeof paragraph.text === 'string' && typeof paragraph.type === 'string' && hashText(paragraph.text) === ref.textHash, 'Source passage text changed');
    previous = index;
  }
  return refs;
}

export function resolveSourcePassages(data, project, hashText) {
  if (!Object.hasOwn(data, 'sourcePassages')) return undefined;
  assert(data.sourceHash === project.sourceHash, 'Source passage frozen source changed');
  const scene = project.scenes.find(value => value.id === data.sceneId);
  validateSourcePassages(data.sourcePassages, scene, hashText);
  return { scope: SELECTED_SOURCE_SCOPE, sourceHash: project.sourceHash, sceneId: scene.id,
    passages: data.sourcePassages.map(ref => {
      const paragraph = scene.paragraphs.find(value => value.id === ref.paragraphId);
      return { paragraphId: ref.paragraphId, textHash: ref.textHash, type: paragraph.type, text: paragraph.text };
    }) };
}
