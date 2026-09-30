export const PHONE_PREVIZ_MAX_BYTES = 2 * 1024 * 1024;
export const PHONE_ROTATION_MAX_SAMPLES = 5401;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code, status: 422 }); };
// Sensor files contain floating-point quaternions and seconds. Keep their
// deterministic serialization separate from integer-only authoritative records.
export function canonicalPhonePreviz(value) {
  let nodes = 0;
  function normalize(item, depth) {
    need(depth <= 12 && ++nodes <= 100000, 'PHONE_PREVIZ_JSON_LIMIT');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number') { need(Number.isFinite(item), 'PHONE_PREVIZ_NUMBER_INVALID'); return Object.is(item, -0) ? 0 : item; }
    if (Array.isArray(item)) {
      need(Object.keys(item).length === item.length && Array.from({ length: item.length }, (_, index) => Object.hasOwn(item, index)).every(Boolean), 'PHONE_PREVIZ_ARRAY_INVALID');
      return item.map(child => normalize(child, depth + 1));
    }
    need(object(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item)), 'PHONE_PREVIZ_JSON_INVALID');
    const output = {};
    for (const key of Object.keys(item).sort()) {
      need(!['__proto__', 'constructor', 'prototype'].includes(key), 'PHONE_PREVIZ_KEY_INVALID');
      output[key] = normalize(item[key], depth + 1);
    }
    return output;
  }
  const result = JSON.stringify(normalize(value, 0));
  need(new TextEncoder().encode(result).length <= PHONE_PREVIZ_MAX_BYTES, 'PHONE_PREVIZ_TOO_LARGE');
  return result;
}
function shape(value, required, optional = []) {
  need(object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'PHONE_PREVIZ_FIELDS_INVALID');
}
function text(value, maximum) {
  need(typeof value === 'string' && value.length <= maximum && value.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'PHONE_PREVIZ_TEXT_INVALID');
}
function date(value) {
  need(typeof value === 'string' && value.length <= 40 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'PHONE_PREVIZ_DATE_INVALID');
}
const finite = (value, minimum, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
function quaternion(value) {
  need(Array.isArray(value) && value.length === 4 && value.every(x => finite(x, -1, 1)) && Math.abs(Math.hypot(...value) - 1) <= 0.001, 'PHONE_PREVIZ_QUATERNION_INVALID');
}
function source(value) {
  need(uuid(value.id) && id(value.projectId) && id(value.shotId), 'PHONE_PREVIZ_ID_INVALID');
  need(value.sceneId == null || value.sceneId === '' || id(value.sceneId), 'PHONE_PREVIZ_SCENE_INVALID');
  for (const key of ['sourceHash', 'shotSourceHash']) need(value[key] == null || hash(value[key]), 'PHONE_PREVIZ_HASH_INVALID');
  for (const key of ['projectTitle', 'shotTitle']) if (value[key] != null) text(value[key], 500);
}
export function validatePhonePrevizArtifact(value) {
  canonicalPhonePreviz(value);
  if (value?.schemaVersion === 'qimovi-phone-rotation/v1') {
    shape(value, ['schemaVersion', 'id', 'projectId', 'shotId', 'recordedAt', 'durationSeconds', 'requestedSampleRateHz', 'measurement', 'referenceFrame', 'deviceAxes', 'relativeAttitudeMethod', 'quaternionOrder', 'screenOrientationAtStart', 'referenceQuaternionXYZW', 'stopReason', 'classification', 'desktopPlaybackReady', 'samples'], ['projectTitle', 'sourceHash', 'sceneId', 'shotTitle', 'shotSourceHash', 'clapperMarks']);
    source(value); date(value.recordedAt);
    need(value.measurement === 'DEVICE_ORIENTATION_ONLY' && value.referenceFrame === 'CORE_MOTION_X_ARBITRARY_Z_VERTICAL' && value.deviceAxes === 'RIGHT_HANDED_X_RIGHT_Y_TOP_Z_OUT_OF_DISPLAY_PORTRAIT' && value.relativeAttitudeMethod === 'CMAttitude.multiply(byInverseOf: startAttitude)' && value.quaternionOrder === 'XYZW' && value.classification === 'ROTATION_REHEARSAL_PENDING_REVIEW' && value.desktopPlaybackReady === false, 'PHONE_PREVIZ_ROTATION_AUTHORITY_INVALID');
    need(finite(value.durationSeconds, 0.000001, 180) && value.requestedSampleRateHz === 30, 'PHONE_PREVIZ_TIMING_INVALID');
    text(value.screenOrientationAtStart, 80); text(value.stopReason, 120); quaternion(value.referenceQuaternionXYZW);
    need(Array.isArray(value.samples) && value.samples.length >= 2 && value.samples.length <= PHONE_ROTATION_MAX_SAMPLES, 'PHONE_PREVIZ_SAMPLE_LIMIT');
    let previous = -1;
    for (const sample of value.samples) {
      shape(sample, ['timeSeconds', 'quaternionXYZW']);
      need(finite(sample.timeSeconds, 0, value.durationSeconds) && sample.timeSeconds > previous, 'PHONE_PREVIZ_SAMPLE_ORDER_INVALID');
      quaternion(sample.quaternionXYZW); previous = sample.timeSeconds;
    }
    need(value.samples[0].timeSeconds === 0 && Math.abs(previous - value.durationSeconds) <= 0.000001 && Math.abs(Math.abs(value.samples[0].quaternionXYZW[3]) - 1) < 0.001, 'PHONE_PREVIZ_SAMPLE_BOUNDS_INVALID');
    if (value.clapperMarks != null) {
      need(Array.isArray(value.clapperMarks) && value.clapperMarks.length <= 100, 'PHONE_PREVIZ_CLAPPER_LIMIT');
      const seen = new Set(); let prior = -1;
      for (const mark of value.clapperMarks) {
        shape(mark, ['clapperId', 'timeSeconds', 'takeNumber']);
        need(uuid(mark.clapperId) && !seen.has(mark.clapperId) && finite(mark.timeSeconds, 0, value.durationSeconds) && mark.timeSeconds >= prior && Number.isSafeInteger(mark.takeNumber) && mark.takeNumber >= 1 && mark.takeNumber <= 9999, 'PHONE_PREVIZ_CLAPPER_MARK_INVALID');
        seen.add(mark.clapperId); prior = mark.timeSeconds;
      }
    }
  } else if (value?.schemaVersion === 'qimovi-clapper/v1') {
    shape(value, ['schemaVersion', 'id', 'projectId', 'projectTitle', 'sceneId', 'shotId', 'shotTitle', 'takeNumber', 'roll', 'camera', 'frameRate', 'soundMode', 'slatePosition', 'purpose', 'markedAt', 'clock', 'cue', 'notes', 'classification'], ['sourceHash', 'shotSourceHash', 'recordingId', 'recordingTimeSeconds']);
    source(value); date(value.markedAt);
    need(Number.isSafeInteger(value.takeNumber) && value.takeNumber >= 1 && value.takeNumber <= 9999, 'PHONE_PREVIZ_TAKE_INVALID');
    text(value.roll, 40); text(value.camera, 40); text(value.notes, 2000);
    shape(value.frameRate, ['numerator', 'denominator']);
    need(['24/1', '25/1', '30/1', '48/1', '50/1', '60/1', '24000/1001', '30000/1001', '60000/1001'].includes(`${value.frameRate.numerator}/${value.frameRate.denominator}`) && Number.isSafeInteger(value.frameRate.numerator) && Number.isSafeInteger(value.frameRate.denominator), 'PHONE_PREVIZ_FRAME_RATE_INVALID');
    need(['SYNC', 'MOS'].includes(value.soundMode) && ['HEAD', 'TAIL'].includes(value.slatePosition) && ['PREVIZ', 'PRODUCTION'].includes(value.purpose) && ['VISUAL', 'VISUAL_AND_SOUND_REQUESTED'].includes(value.cue) && value.clock === 'DEVICE_WALL_CLOCK_NOT_TIMECODE' && value.classification === 'SLATE_MARK_ONLY', 'PHONE_PREVIZ_CLAPPER_AUTHORITY_INVALID');
    need((value.recordingId == null) === (value.recordingTimeSeconds == null), 'PHONE_PREVIZ_RECORDING_PAIR_INVALID');
    if (value.recordingId != null) need(uuid(value.recordingId) && finite(value.recordingTimeSeconds, 0, 180), 'PHONE_PREVIZ_RECORDING_PAIR_INVALID');
  } else need(false, 'PHONE_PREVIZ_SCHEMA_UNSUPPORTED');
  return value;
}
