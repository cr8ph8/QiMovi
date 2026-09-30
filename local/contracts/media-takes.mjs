export const MAX_MEDIA_UPLOAD_BYTES = 256 * 1024 * 1024;
export const MEDIA_RECORD_KINDS = ['measured-media-take', 'take-review'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code, status: 422 }); };
const shape = (value, keys) => need(object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'INVALID_MEDIA_FIELDS');
const positive = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function validateMediaTarget(data, project) {
  need(digest(data.sourceHash) && (!project || data.sourceHash === project.sourceHash), 'MEDIA_SOURCE_MISMATCH');
  const scene = project?.scenes.find(value => value.id === data.sceneId);
  need(id(data.sceneId) && (!project || scene), 'MEDIA_SCENE_MISMATCH');
  need(data.shotId === null || (id(data.shotId) && (!project || scene.shots.some(value => value.id === data.shotId))), 'MEDIA_SHOT_MISMATCH');
  if (data.briefRef !== null) {
    shape(data.briefRef, ['id', 'sha256']);
    need(id(data.briefRef.id) && data.briefRef.id.startsWith('generation-brief:') && digest(data.briefRef.sha256), 'INVALID_MEDIA_BRIEF_REFERENCE');
  }
  return data;
}
export function validateMediaImportInput(data, project) {
  shape(data, ['requestId', 'sourceHash', 'sceneId', 'shotId', 'briefRef', 'originalFilename']);
  need(id(data.requestId), 'INVALID_MEDIA_REQUEST_ID');
  need(typeof data.originalFilename === 'string' && data.originalFilename.length > 0 && data.originalFilename.length <= 255 && !/[\x00-\x1f\x7f/\\]/.test(data.originalFilename), 'INVALID_MEDIA_FILENAME');
  return validateMediaTarget(data, project);
}
export function validateRetainedMediaInput(data, project) {
  shape(data, ['requestId', 'sourceHash', 'sceneId', 'shotId', 'briefRef', 'retainedSource', 'assetHash']);
  need(id(data.requestId) && digest(data.assetHash), 'INVALID_RETAINED_MEDIA_INPUT');
  shape(data.retainedSource, ['id', 'sha256']);
  need(id(data.retainedSource.id) && /^(studio-generation|project-asset|dcc-motion):/.test(data.retainedSource.id) && digest(data.retainedSource.sha256), 'INVALID_RETAINED_MEDIA_SOURCE');
  return validateMediaTarget(data, project);
}
export function validateMeasurement(data) {
  shape(data, ['durationMs', 'videoFrameCount', 'width', 'height', 'frameRate', 'videoCodec', 'audio']);
  need(positive(data.durationMs, 86400000) && positive(data.videoFrameCount, 100000000) && positive(data.width, 32768) && positive(data.height, 32768), 'INVALID_MEDIA_MEASUREMENT');
  const rate = typeof data.frameRate === 'string' && /^(\d{1,9})\/(\d{1,9})$/.exec(data.frameRate);
  need(rate && Number(rate[1]) > 0 && Number(rate[2]) > 0 && Number(rate[1]) / Number(rate[2]) <= 1000, 'INVALID_MEDIA_FRAME_RATE');
  need(typeof data.videoCodec === 'string' && data.videoCodec.length > 0 && data.videoCodec.length <= 120 && Array.isArray(data.audio) && data.audio.length <= 32, 'INVALID_MEDIA_STREAMS');
  for (const stream of data.audio) {
    shape(stream, ['codec', 'channels', 'sampleRate']);
    need(typeof stream.codec === 'string' && stream.codec.length > 0 && stream.codec.length <= 120 && positive(stream.channels, 64) && positive(Number(stream.sampleRate), 768000) && typeof stream.sampleRate === 'string', 'INVALID_MEDIA_AUDIO');
  }
  return data;
}
export function measurementFromProbe(output, toolIdentity) {
  let measurement;
  if (toolIdentity === 'AVFOUNDATION') {
    shape(output, ['schema', 'durationMs', 'videoFrameCount', 'width', 'height', 'frameRate', 'videoCodec', 'audio']);
    need(output.schema === 'caniscreenwrite-native-media-probe/v1', 'INVALID_MEDIA_PROBE_SCHEMA');
    const { schema, ...value } = output; measurement = value;
  } else {
    need(toolIdentity === 'FFPROBE' && Array.isArray(output.streams) && object(output.format), 'INVALID_MEDIA_PROBE_SCHEMA');
    const video = output.streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    need(video, 'MEDIA_VIDEO_STREAM_REQUIRED');
    measurement = { durationMs: Math.round(Number(output.format.duration) * 1000), videoFrameCount: Number(video.nb_read_frames), width: video.width, height: video.height,
      frameRate: video.avg_frame_rate, videoCodec: video.codec_name,
      audio: output.streams.filter(stream => stream.codec_type === 'audio').map(stream => ({ codec: stream.codec_name, channels: stream.channels, sampleRate: stream.sample_rate })) };
  }
  return validateMeasurement(measurement);
}
export function validateMediaRecord(kind, data, project) {
  if (kind === 'measured-media-take') {
    shape(data, ['schemaVersion', 'sourceHash', 'sceneId', 'shotId', 'briefRef', 'originalFilename', 'origin', 'providerProvenance', 'blob', 'measurement', 'measuredAt', 'probe', ...(Object.hasOwn(data ?? {}, 'retainedSource') ? ['retainedSource'] : [])]);
    validateMediaImportInput({ requestId: 'structural-check', sourceHash: data.sourceHash, sceneId: data.sceneId, shotId: data.shotId, briefRef: data.briefRef, originalFilename: data.originalFilename }, project);
    const imported = data.origin === 'IMPORTED_USER_MEDIA' && data.providerProvenance === 'UNVERIFIED' && !Object.hasOwn(data, 'retainedSource');
    const retained = ['RETAINED_PROVIDER_OUTPUT', 'RETAINED_PROJECT_ASSET', 'RETAINED_DCC_MOTION'].includes(data.origin);
    if (retained) {
      shape(data.retainedSource, ['id', 'sha256']);
      const provenance = data.origin === 'RETAINED_PROVIDER_OUTPUT' ? data.retainedSource.id.startsWith('studio-generation:') && data.providerProvenance === 'HIGGSFIELD_MCP_RECORD'
        : data.origin === 'RETAINED_DCC_MOTION' ? /^dcc-motion:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.retainedSource.id) && data.providerProvenance === 'LOCAL_BLENDER_RENDER'
          : data.retainedSource.id.startsWith('project-asset:') && data.providerProvenance === 'UNVERIFIED';
      need(id(data.retainedSource.id) && digest(data.retainedSource.sha256) && provenance, 'INVALID_RETAINED_MEDIA_SOURCE');
    }
    need(data.schemaVersion === 1 && (imported || retained) && timestamp(data.measuredAt), 'INVALID_MEDIA_AUTHORITY');
    shape(data.blob, ['sha256', 'byteLength', 'mimeType']);
    need(digest(data.blob.sha256) && positive(data.blob.byteLength, MAX_MEDIA_UPLOAD_BYTES) && ['video/mp4', 'video/quicktime', 'video/webm'].includes(data.blob.mimeType), 'INVALID_MEDIA_BLOB');
    shape(data.probe, ['toolIdentity', 'outputSha256']);
    need(['AVFOUNDATION', 'FFPROBE'].includes(data.probe.toolIdentity) && digest(data.probe.outputSha256), 'INVALID_MEDIA_PROBE');
    validateMeasurement(data.measurement);
  } else {
    need(kind === 'take-review', 'INVALID_MEDIA_KIND');
    shape(data, ['schemaVersion', 'sourceHash', 'sceneId', 'takeRef', 'decision', 'note', 'actor', 'scope', 'reviewedAt']);
    shape(data.takeRef, ['id', 'sha256']);
    need(digest(data.sourceHash) && id(data.sceneId) && (!project || (data.sourceHash === project.sourceHash && project.scenes.some(scene => scene.id === data.sceneId))) && /^measured-media-take:[a-f0-9]{64}$/.test(data.takeRef.id) && digest(data.takeRef.sha256), 'INVALID_TAKE_REVIEW_TARGET');
    need(data.schemaVersion === 1 && ['PENDING', 'KEEP_CANDIDATE', 'REJECT'].includes(data.decision) && typeof data.note === 'string' && data.note.length <= 10000 && data.actor === 'local-owner' && data.scope === 'CANDIDATE_PREFERENCE_ONLY' && timestamp(data.reviewedAt), 'INVALID_TAKE_REVIEW');
  }
  return data;
}
