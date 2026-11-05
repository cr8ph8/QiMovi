export const DISCOVERY_DATASET = 'qimovi-discovery-synthetic/v1';
export const DISCOVERY_SCOPE = 'RESEARCH_REFERENCE_ONLY';
export const LICENSES = Object.freeze(['SYNTHETIC_REFERENCE_ONLY', 'UNKNOWN', 'RESTRICTED']);
export const RETENTION_LIMIT = 100;

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0
  && value.length <= max && value.isWellFormed();
const text = (value, max) => boundedText(value, max) && !/[\x00-\x1f\x7f]/.test(value);
// Review prose may contain tabs and line endings.
const reviewNote = value => boundedText(value, 500) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
export const discoveryHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const videoId = value => typeof value === 'string' && /^vid-[a-z]+-(?:0[1-9]|10)$/.test(value);
const sourceId = value => typeof value === 'string' && /^urn:qimovi:synthetic:[a-z]+:(?:0[1-9]|10)$/.test(value);

export function validDiscoveryVideo(row) {
  return exact(row, ['id', 'sourceId', 'title', 'description', 'tags', 'durationSeconds', 'license', 'provenance', 'evidence'])
    && videoId(row.id) && sourceId(row.sourceId)
    && text(row.title, 150) && text(row.description, 500)
    && Array.isArray(row.tags) && row.tags.length <= 8 && row.tags.every(tag => text(tag, 32))
    && Number.isSafeInteger(row.durationSeconds) && row.durationSeconds > 0 && row.durationSeconds <= 7200
    && LICENSES.includes(row.license)
    && exact(row.provenance, ['dataset', 'sourceDigest']) && row.provenance.dataset === DISCOVERY_DATASET
    && discoveryHash(row.provenance.sourceDigest)
    && Array.isArray(row.evidence) && row.evidence.length > 0 && row.evidence.length <= 8
    && row.evidence.every(item => exact(item, ['id', 'author', 'atSeconds', 'excerpt'])
      && text(item.id, 100) && text(item.author, 80) && text(item.excerpt, 400)
      && Number.isSafeInteger(item.atSeconds) && item.atSeconds >= 0 && item.atSeconds < row.durationSeconds);
}

export function validRetentionRequest(input) {
  return exact(input, ['projectId', 'queryId', 'videoId', 'receiptHash', 'note', 'confirmed'])
    && text(input.projectId, 160) && text(input.queryId, 40) && videoId(input.videoId)
    && discoveryHash(input.receiptHash) && reviewNote(input.note) && input.confirmed === true;
}
