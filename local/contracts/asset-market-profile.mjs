import { projectOwnedContext } from './creative-project.mjs';
// An editable preparation record only. It grants no rights, issues no tokens,
// transfers no assets and does not establish market value or market readiness.
export const ASSET_MARKET_PROFILE_KIND = 'asset-market-profile';
export const MARKET_DETAILS_MAX_BYTES = 128 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code, status: 422 }); };
const digest = value => typeof value === 'string' && SHA.test(value);
const text = (value, max = 16000) => typeof value === 'string' && value.length <= max && value.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const fields = (value, allowed, required = []) => need(object(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), 'ASSET_MARKET_FIELDS_INVALID');
const integerOrNull = (value, min, max) => value === null || Number.isSafeInteger(value) && value >= min && value <= max;
const stringFields = ['issuer', 'creator', 'copyrightHolder', 'description', 'credits', 'rightsScope', 'territory', 'term'];
const detailFields = [...stringFields, 'transferable', 'derivativesAllowed', 'licenceEvidenceHashes', 'parentAssetHashes', 'edition', 'pricing'];

export function defaultMarketDetails() {
  return {
    issuer: '', creator: '', copyrightHolder: '', description: '', credits: '', rightsScope: '', territory: '', term: '',
    transferable: null, derivativesAllowed: null, licenceEvidenceHashes: [], parentAssetHashes: [],
    edition: { seriesId: '', cap: null, tokenStandard: 'UNDECIDED', royaltyBps: null },
    pricing: { currency: '', askingMinor: null, creationCostMinor: null, optionScenario: null },
  };
}

function validateBoundedJson(value, depth = 0, budget = { left: 4096 }) {
  need(depth <= 12 && --budget.left >= 0, 'ASSET_MARKET_SCENARIO_TOO_COMPLEX');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { need(Number.isFinite(value), 'ASSET_MARKET_SCENARIO_INVALID'); return; }
  if (typeof value === 'string') { need(text(value), 'ASSET_MARKET_SCENARIO_INVALID'); return; }
  need(object(value) || Array.isArray(value), 'ASSET_MARKET_SCENARIO_INVALID');
  for (const [key, child] of Object.entries(value)) {
    need(text(key, 160) && !['__proto__', 'constructor', 'prototype'].includes(key), 'ASSET_MARKET_SCENARIO_INVALID');
    validateBoundedJson(child, depth + 1, budget);
  }
}

export function parseMarketDetails(value) {
  const source = typeof value === 'string' ? value : value?.detailsJson;
  need(typeof source === 'string' && source.isWellFormed() && new TextEncoder().encode(source).byteLength <= MARKET_DETAILS_MAX_BYTES, 'ASSET_MARKET_DETAILS_INVALID');
  let details;
  try { details = JSON.parse(source); } catch { need(false, 'ASSET_MARKET_DETAILS_INVALID'); }
  fields(details, detailFields);
  for (const key of stringFields) if (Object.hasOwn(details, key)) need(text(details[key]), 'ASSET_MARKET_TEXT_INVALID');
  for (const key of ['transferable', 'derivativesAllowed']) if (Object.hasOwn(details, key)) need(details[key] === null || typeof details[key] === 'boolean', 'ASSET_MARKET_RIGHTS_INVALID');
  for (const key of ['licenceEvidenceHashes', 'parentAssetHashes']) if (Object.hasOwn(details, key)) {
    const values = details[key];
    need(Array.isArray(values) && values.length <= 256 && values.every(digest) && new Set(values).size === values.length, 'ASSET_MARKET_HASHES_INVALID');
  }
  if (Object.hasOwn(details, 'edition')) {
    fields(details.edition, ['seriesId', 'cap', 'tokenStandard', 'royaltyBps']);
    const edition = details.edition;
    if (Object.hasOwn(edition, 'seriesId')) need(text(edition.seriesId, 240), 'ASSET_MARKET_EDITION_INVALID');
    if (Object.hasOwn(edition, 'cap')) need(integerOrNull(edition.cap, 1, 1000000), 'ASSET_MARKET_EDITION_INVALID');
    if (Object.hasOwn(edition, 'tokenStandard')) need(['UNDECIDED', 'ERC721', 'ERC1155'].includes(edition.tokenStandard), 'ASSET_MARKET_EDITION_INVALID');
    if (Object.hasOwn(edition, 'royaltyBps')) need(integerOrNull(edition.royaltyBps, 0, 10000), 'ASSET_MARKET_EDITION_INVALID');
  }
  if (Object.hasOwn(details, 'pricing')) {
    fields(details.pricing, ['currency', 'askingMinor', 'creationCostMinor', 'optionScenario']);
    const pricing = details.pricing;
    if (Object.hasOwn(pricing, 'currency')) need(text(pricing.currency, 24) && !/[\r\n\t]/.test(pricing.currency), 'ASSET_MARKET_PRICING_INVALID');
    for (const key of ['askingMinor', 'creationCostMinor']) if (Object.hasOwn(pricing, key)) need(integerOrNull(pricing[key], 0, Number.MAX_SAFE_INTEGER), 'ASSET_MARKET_PRICING_INVALID');
    if (Object.hasOwn(pricing, 'optionScenario') && pricing.optionScenario !== null) {
      need(object(pricing.optionScenario), 'ASSET_MARKET_SCENARIO_INVALID');
      validateBoundedJson(pricing.optionScenario);
    }
  }
  return details;
}

export function validateAssetMarketProfile(data, project) {
  project = projectOwnedContext(project, 'asset-market-profile', data);
  const required = ['schemaVersion', 'projectId', 'sourceHash', 'assetHash', 'mimeType', 'title', 'detailsJson', 'status'];
  fields(data, required, required);
  need(data.schemaVersion === 1 && data.status === 'DRAFT', 'ASSET_MARKET_AUTHORITY_INVALID');
  need(typeof data.projectId === 'string' && ID.test(data.projectId) && (data.sourceHash === null || digest(data.sourceHash)), 'ASSET_MARKET_PROJECT_INVALID');
  if (project) need(project.id === data.projectId && project.sourceHash === data.sourceHash, 'ASSET_MARKET_PROJECT_MISMATCH');
  need(digest(data.assetHash) && typeof data.mimeType === 'string' && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(data.mimeType) && data.mimeType.length <= 160, 'ASSET_MARKET_ASSET_INVALID');
  need(text(data.title, 240) && !/[\r\n\t]/.test(data.title), 'ASSET_MARKET_TITLE_INVALID');
  const details = parseMarketDetails(data);
  need(!(details.parentAssetHashes ?? []).includes(data.assetHash), 'ASSET_MARKET_SELF_PARENT');
  return data;
}

export function validateAssetMarketProfileIdentity(recordId, kind, data, previous = null) {
  if (kind !== ASSET_MARKET_PROFILE_KIND && !recordId?.startsWith('asset-market:')) return;
  need(kind === ASSET_MARKET_PROFILE_KIND && typeof recordId === 'string' && /^asset-market:[a-f0-9]{64}$/.test(recordId), 'ASSET_MARKET_IDENTITY_INVALID');
  if (data) need(recordId === `asset-market:${data.assetHash}`, 'ASSET_MARKET_IDENTITY_INVALID');
  if (previous && data) for (const key of ['projectId', 'sourceHash', 'assetHash', 'mimeType']) need(previous[key] === data[key], 'ASSET_MARKET_IDENTITY_CHANGED');
}

export function validateAssetMarketProfileReferences(data, lookupBlob) {
  const original = lookupBlob(data.assetHash);
  need(original && original.byteLength > 0 && original.mimeType === data.mimeType, 'ASSET_MARKET_ORIGINAL_MISSING_OR_CHANGED');
  const details = parseMarketDetails(data);
  for (const hash of [...(details.licenceEvidenceHashes ?? []), ...(details.parentAssetHashes ?? [])]) {
    const blob = lookupBlob(hash);
    need(blob && blob.byteLength > 0, 'ASSET_MARKET_REFERENCE_MISSING_OR_CHANGED');
  }
}
