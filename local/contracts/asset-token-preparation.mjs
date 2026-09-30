import { projectOwnedContext } from './creative-project.mjs';
import { canonicalJson } from '../kernel/src/canonical-json-core.mjs';

// A local, immutable preparation packet. Nothing in this format mints a token,
// grants rights, moves funds, establishes value or promises royalty collection.
export const TOKEN_PREPARATION_KIND = 'asset-token-preparation';
const MAX_BYTES = 192 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const need = (ok, code, message = code, status = 422) => { if (!ok) throw Object.assign(new Error(message), { code, status }); };
const shape = (value, keys) => need(object(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'TOKEN_PREPARATION_FIELDS_INVALID', 'The preparation contains missing or unsupported fields.');
const text = (value, max, multiline = false) => typeof value === 'string' && value.isWellFormed() && new TextEncoder().encode(value).byteLength <= max && !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/ : /[\x00-\x1f\x7f<>]/).test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const dense = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);

function reference(ref, kind) {
  shape(ref, ['id', 'version', 'sha256']);
  need(id(ref.id) && integer(ref.version, 1, 256) && hash(ref.sha256), 'TOKEN_SOURCE_REFERENCE_INVALID', 'Select an exact saved source version within the 256-version preparation limit.');
  if (kind === 'passport') need(/^asset-market:[a-f0-9]{64}$/.test(ref.id), 'TOKEN_SOURCE_REFERENCE_INVALID');
  if (kind === 'participation') need(ref.id.startsWith('participation:'), 'TOKEN_SOURCE_REFERENCE_INVALID');
}

function publicUri(value) {
  if (value === '') return;
  need(text(value, 2048) && !/[\s\\]/u.test(value), 'TOKEN_PUBLIC_URI_INVALID', 'Use an empty URI, a public HTTPS URI, or an IPFS URI.');
  let url;
  try { url = new URL(value); } catch { need(false, 'TOKEN_PUBLIC_URI_INVALID'); }
  need(!url.username && !url.password && !url.search && !url.hash && !value.includes('?') && !value.includes('#'), 'TOKEN_PUBLIC_URI_INVALID', 'Public URIs cannot contain credentials, query strings or fragments.');
  if (url.protocol === 'ipfs:') {
    need(!url.port && /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})$/.test(url.hostname), 'TOKEN_PUBLIC_URI_INVALID');
  } else {
    const host = url.hostname.toLowerCase();
    need(url.protocol === 'https:' && (!url.port || url.port === '443') && host.length <= 253
      && !/(^|\.)(localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host)
      && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)
      && !/^\d+(?:\.\d+){3}$/.test(host), 'TOKEN_PUBLIC_URI_INVALID', 'Use a public HTTPS domain; local names, IP addresses and custom ports are not supported.');
  }
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); } catch { need(false, 'TOKEN_PUBLIC_URI_INVALID'); }
  need(!/[\x00-\x1f\x7f<>\\]/.test(decoded), 'TOKEN_PUBLIC_URI_INVALID');
}

function publicFields(value) {
  shape(value, ['name', 'description', 'imageUri', 'licenceUri', 'licenceSummary']);
  need(text(value.name, 240) && text(value.description, 8000, true) && text(value.licenceSummary, 4000, true), 'TOKEN_PUBLIC_TEXT_INVALID', 'Use bounded plain text for public metadata.');
  publicUri(value.imageUri); publicUri(value.licenceUri);
}

export function validateTokenPreparationRequest(value) {
  shape(value, ['projectId', 'requestId', 'passportRef', 'participationRef', 'publicFields']);
  need(id(value.projectId) && uuid(value.requestId), 'TOKEN_REQUEST_IDENTITY_INVALID', 'Select a project and use a new UUID v4 preparation request id.');
  reference(value.passportRef, 'passport'); reference(value.participationRef, 'participation');
  need(value.participationRef.id === `participation:${value.projectId}`, 'TOKEN_SOURCE_PROJECT_MISMATCH');
  publicFields(value.publicFields);
  return value;
}

export function tokenPublicMetadata(value) {
  const { publicFields: fields, edition, privateProof } = value;
  return {
    name: fields.name, description: fields.description,
    ...(fields.imageUri ? { image: fields.imageUri } : {}),
    properties: { qimovi: {
      format: 'qimovi-nft-metadata/v1', standard: edition.standard, editionCap: edition.cap,
      royaltyRequestBps: edition.royaltyBps, licenceSummary: fields.licenceSummary,
      licenceUri: fields.licenceUri, commitment: privateProof.commitment,
    } },
  };
}

export function validateTokenPreparation(value, project) {
  shape(value, ['schemaVersion', 'projectId', 'sourceHash', 'status', 'requestId', 'preparedAt', 'assetHash', 'passportRef', 'participationRef', 'edition', 'publicFields', 'privateProof', 'publicMetadata', 'metadataSha256', 'warnings']);
  validateTokenPreparationRequest({ projectId: value.projectId, requestId: value.requestId, passportRef: value.passportRef, participationRef: value.participationRef, publicFields: value.publicFields });
  need(value.schemaVersion === 1 && value.status === 'PREPARED_LOCALLY', 'TOKEN_PREPARATION_AUTHORITY_INVALID', 'This packet can only record local preparation.');
  need((value.sourceHash === null || hash(value.sourceHash)) && hash(value.assetHash) && value.passportRef.id === `asset-market:${value.assetHash}`, 'TOKEN_PREPARATION_SOURCE_INVALID');
  need(typeof value.preparedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.preparedAt) && Number.isFinite(Date.parse(value.preparedAt)) && new Date(value.preparedAt).toISOString() === value.preparedAt, 'TOKEN_PREPARATION_TIME_INVALID');
  const owner = projectOwnedContext(project, TOKEN_PREPARATION_KIND, value);
  if (owner) need(owner.id === value.projectId && owner.sourceHash === value.sourceHash, 'TOKEN_PREPARATION_PROJECT_MISMATCH', 'The preparation belongs to another project or source.', 409);
  shape(value.edition, ['standard', 'seriesId', 'cap', 'royaltyBps']);
  need(['UNDECIDED', 'ERC721', 'ERC1155'].includes(value.edition.standard) && text(value.edition.seriesId, 960, true)
    && (value.edition.cap === null || integer(value.edition.cap, 1, 1000000))
    && (value.edition.royaltyBps === null || integer(value.edition.royaltyBps, 0, 10000)), 'TOKEN_EDITION_INVALID');
  shape(value.privateProof, ['nonce', 'histories', 'commitment']);
  need(hash(value.privateProof.nonce) && hash(value.privateProof.commitment), 'TOKEN_PROOF_INVALID');
  need(dense(value.privateProof.histories, 2) && value.privateProof.histories.length === 2, 'TOKEN_HISTORY_INVALID');
  for (const [index, history] of value.privateProof.histories.entries()) {
    shape(history, ['id', 'kind', 'entries', 'chainHash']);
    const ref = index === 0 ? value.passportRef : value.participationRef;
    need(history.id === ref.id && history.kind === (index === 0 ? 'asset-market-profile' : 'project-participation') && hash(history.chainHash) && dense(history.entries, 256) && history.entries.length === ref.version, 'TOKEN_HISTORY_INVALID');
    for (const [entryIndex, entry] of history.entries.entries()) {
      shape(entry, ['version', 'sha256']);
      need(entry.version === entryIndex + 1 && hash(entry.sha256), 'TOKEN_HISTORY_INVALID');
    }
    need(history.entries.at(-1).sha256 === ref.sha256, 'TOKEN_HISTORY_INVALID');
  }
  need(hash(value.metadataSha256) && dense(value.warnings, 20) && value.warnings.length > 0 && value.warnings.every(warning => text(warning, 800)), 'TOKEN_PREPARATION_WARNINGS_INVALID');
  shape(value.publicMetadata, value.publicFields.imageUri ? ['name', 'description', 'image', 'properties'] : ['name', 'description', 'properties']);
  shape(value.publicMetadata.properties, ['qimovi']);
  shape(value.publicMetadata.properties.qimovi, ['format', 'standard', 'editionCap', 'royaltyRequestBps', 'licenceSummary', 'licenceUri', 'commitment']);
  need(canonicalJson(value.publicMetadata) === canonicalJson(tokenPublicMetadata(value)), 'TOKEN_PUBLIC_METADATA_INVALID', 'Public metadata must contain only the explicit public fields and the preparation commitment.');
  need(new TextEncoder().encode(canonicalJson(value)).byteLength <= MAX_BYTES, 'TOKEN_PREPARATION_SIZE_LIMIT', 'The preparation packet exceeds the supported size.', 413);
  return value;
}

export function validateTokenPreparationIdentity(recordId, kind, value, version) {
  if (kind !== TOKEN_PREPARATION_KIND && !(typeof recordId === 'string' && recordId.startsWith('asset-token:'))) return;
  need(kind === TOKEN_PREPARATION_KIND && uuid(value?.requestId) && recordId === `asset-token:${value.requestId}`, 'TOKEN_PREPARATION_IDENTITY_INVALID', 'The preparation identity must match its original request.', 409);
  if (version !== undefined) need(version === 1, 'TOKEN_PREPARATION_IMMUTABLE', 'A preparation packet is immutable; prepare a new packet for revised sources.', 409);
}
