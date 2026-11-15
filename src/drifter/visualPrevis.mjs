export const PREVIS_FPS = 24;
export const PREVIS_MIN_SECONDS = 2;
export const PREVIS_MAX_SECONDS = 12;
export const PREVIS_MAX_KEYS = 24;
export const STAGE_RADIUS_CM = 1200;
export const EASINGS = ['LINEAR', 'EASE_IN_OUT', 'CUT'];

const keys = (data, fields) => data && typeof data === 'object' && !Array.isArray(data)
  && Object.keys(data).length === fields.length && fields.every(field => Object.hasOwn(data, field));
const integer = (value, min, max) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
const coordinate = value => integer(value, -STAGE_RADIUS_CM, STAGE_RADIUS_CM);
const validScope = scope => keys(scope, ['projectId', 'sourceHash', 'sceneId', 'shotId'])
  && validId(scope.projectId) && validId(scope.sceneId) && validId(scope.shotId)
  && typeof scope.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(scope.sourceHash);

export function createPrevisPlan(scope, lensMm = 35) {
  const keyframes = [
    { frame: 0, cameraX: -450, cameraY: 190, cameraZ: 620, subjectX: -130, subjectZ: 0, lensMm, aimHeight: 110, easing: 'EASE_IN_OUT' },
    { frame: 59, cameraX: 0, cameraY: 185, cameraZ: 510, subjectX: 0, subjectZ: 0, lensMm, aimHeight: 110, easing: 'LINEAR' },
    { frame: 119, cameraX: 330, cameraY: 160, cameraZ: 420, subjectX: 100, subjectZ: -60, lensMm, aimHeight: 110, easing: 'LINEAR' },
  ];
  return validatePrevisPlan({ schema: 'qimovi-visual-previs/v1', status: 'DRAFT', scope, frameCount: 120, keyframes }, scope);
}

export function validatePrevisPlan(plan, scope) {
  if (!keys(plan, ['schema', 'status', 'scope', 'frameCount', 'keyframes'])
    || plan.schema !== 'qimovi-visual-previs/v1' || plan.status !== 'DRAFT' || !validScope(plan.scope)) {
    throw new Error('Choose a valid QiMovi 3D shot plan.');
  }
  if (scope && Object.keys(scope).some(field => scope[field] !== plan.scope[field])) {
    throw new Error('This plan belongs to a different shot or screenplay revision.');
  }
  if (!integer(plan.frameCount, PREVIS_MIN_SECONDS * PREVIS_FPS, PREVIS_MAX_SECONDS * PREVIS_FPS)
    || !Array.isArray(plan.keyframes) || !integer(plan.keyframes.length, 2, PREVIS_MAX_KEYS)
    || plan.keyframes[0]?.frame !== 0 || plan.keyframes.at(-1)?.frame !== plan.frameCount - 1) {
    throw new Error('A shot plan needs an opening and ending keyframe within a 2–12 second duration.');
  }
  let previous = -1;
  for (const key of plan.keyframes) {
    if (!keys(key, ['frame', 'cameraX', 'cameraY', 'cameraZ', 'subjectX', 'subjectZ', 'lensMm', 'aimHeight', 'easing'])
      || !integer(key.frame, previous + 1, plan.frameCount - 1)
      || ![key.cameraX, key.cameraZ, key.subjectX, key.subjectZ].every(coordinate)
      || !integer(key.cameraY, 30, 800) || !integer(key.aimHeight, 0, 300)
      || !integer(key.lensMm, 10, 200) || !EASINGS.includes(key.easing)) {
      throw new Error('The shot plan contains an invalid keyframe or a position outside the stage.');
    }
    previous = key.frame;
  }
  return plan;
}

/** Sample the authored camera and blocking at a timeline frame. Positions are centimeters. */
export function samplePrevis(plan, frame) {
  const index = plan.keyframes.findIndex(key => key.frame > frame);
  if (index === -1) return plan.keyframes.at(-1);
  if (index === 0) return plan.keyframes[0];
  const from = plan.keyframes[index - 1];
  const to = plan.keyframes[index];
  const time = (frame - from.frame) / (to.frame - from.frame);
  const t = from.easing === 'CUT' ? 0 : from.easing === 'EASE_IN_OUT' ? time * time * (3 - 2 * time) : time;
  const mix = field => from[field] + (to[field] - from[field]) * t;
  return {
    frame, cameraX: mix('cameraX'), cameraY: mix('cameraY'), cameraZ: mix('cameraZ'),
    subjectX: mix('subjectX'), subjectZ: mix('subjectZ'), lensMm: mix('lensMm'), aimHeight: mix('aimHeight'),
    easing: from.easing,
  };
}

export function resizePrevis(plan, frameCount) {
  const end = frameCount - 1;
  let previous = -1;
  const keyframes = plan.keyframes.map((key, index) => {
    const target = Math.round(key.frame * end / (plan.frameCount - 1));
    const frame = Math.max(previous + 1, Math.min(target, end - (plan.keyframes.length - 1 - index)));
    previous = frame;
    return { ...key, frame };
  });
  return { ...plan, frameCount, keyframes };
}
