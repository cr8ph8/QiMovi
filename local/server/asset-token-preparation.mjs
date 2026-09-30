import { randomBytes } from 'node:crypto';
import { canonicalJson, hashCanonical } from '../kernel/src/canonical-json.mjs';
import { parseMarketDetails, validateAssetMarketProfile, validateAssetMarketProfileIdentity, validateAssetMarketProfileReferences } from '../contracts/asset-market-profile.mjs';
import { validateParticipation, validateParticipationIdentity } from '../contracts/project-participation.mjs';
import { TOKEN_PREPARATION_KIND, validateTokenPreparationRequest, validateTokenPreparation, validateTokenPreparationIdentity, tokenPublicMetadata } from '../contracts/asset-token-preparation.mjs';

const need = (ok, code, message = code, status = 409) => { if (!ok) throw Object.assign(new Error(message), { code, status }); };
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const refOf = record => ({ id: record.id, version: record.version, sha256: record.sha256 });
const requestOf = data => ({ projectId: data.projectId, requestId: data.requestId, passportRef: data.passportRef, participationRef: data.participationRef, publicFields: data.publicFields });
const historyDigest = history => hashCanonical({ domain: 'qimovi-token-source-history/v1', id: history.id, kind: history.kind, entries: history.entries });
function commitment(data) {
  return hashCanonical({ domain: 'qimovi-token-private-commitment/v1', nonce: data.privateProof.nonce,
    schemaVersion: data.schemaVersion, status: data.status, projectId: data.projectId, sourceHash: data.sourceHash,
    requestId: data.requestId, preparedAt: data.preparedAt, assetHash: data.assetHash,
    passportRef: data.passportRef, participationRef: data.participationRef, histories: data.privateProof.histories,
    edition: data.edition, publicFields: data.publicFields, warnings: data.warnings });
}

/** Cryptographic self-consistency only. Does not attest custody, rights or public-chain state. */
export function verifyTokenPreparationIntegrity(data) {
  validateTokenPreparation(data);
  for (const history of data.privateProof.histories) need(historyDigest(history) === history.chainHash, 'TOKEN_HISTORY_HASH_MISMATCH');
  need(commitment(data) === data.privateProof.commitment, 'TOKEN_COMMITMENT_MISMATCH');
  need(hashCanonical(data.publicMetadata) === data.metadataSha256, 'TOKEN_METADATA_HASH_MISMATCH');
  return true;
}

function sourceHistory(store, ref, kind, project, requireCurrent) {
  const history = store.history(ref.id);
  need(history.length > 0 && (!requireCurrent || history.length <= 256), 'TOKEN_SOURCE_HISTORY_LIMIT', 'A new preparation source must have between one and 256 saved versions.');
  for (const [index, record] of history.entries()) {
    need(record.id === ref.id && record.kind === kind && record.version === index + 1 && hashCanonical(record.data) === record.sha256, 'TOKEN_SOURCE_HISTORY_INVALID');
    if (kind === 'asset-market-profile') {
      validateAssetMarketProfile(record.data, project);
      validateAssetMarketProfileIdentity(record.id, record.kind, record.data, index ? history[index - 1].data : null);
      validateAssetMarketProfileReferences(record.data, hash => store.blobInfo(hash));
    } else {
      validateParticipation(record.data, project);
      validateParticipationIdentity(record.id, record.kind, record.data, index ? history[index - 1].data : null);
      store.validateParticipationReferences(record.data, false);
    }
  }
  const record = history[ref.version - 1];
  need(record && same(refOf(record), ref), 'TOKEN_SOURCE_MISSING_OR_CHANGED', 'A saved preparation source is missing or changed.');
  // history() has already validated the whole retained chain. Validate the
  // selected record once; doing this for every row would re-read that chain.
  store.validateSavedRecord(record);
  if (requireCurrent) need(same(refOf(history.at(-1)), ref), 'TOKEN_SOURCE_NOT_CURRENT', 'Save and select the latest passport and participation versions before preparing.');
  return { record, history };
}

function sources(store, data, requireCurrent) {
  const project = store.project();
  need(project?.id === data.projectId, 'TOKEN_PREPARATION_PROJECT_MISMATCH');
  const passport = sourceHistory(store, data.passportRef, 'asset-market-profile', project, requireCurrent);
  const participation = sourceHistory(store, data.participationRef, 'project-participation', project, requireCurrent);
  // Independently validated project ownership permits the preserved null-source
  // creative ledger alongside a passport saved after screenplay attachment.
  need(passport.record.data.projectId === data.projectId && participation.record.data.projectId === data.projectId, 'TOKEN_SOURCE_PROJECT_MISMATCH');
  if (requireCurrent) store.validateParticipationReferences(participation.record.data, true);
  return { project, passport, participation };
}

const editionOf = passport => {
  const edition = parseMarketDetails(passport.data).edition ?? {};
  return { standard: edition.tokenStandard ?? 'UNDECIDED', seriesId: edition.seriesId ?? '', cap: edition.cap ?? null, royaltyBps: edition.royaltyBps ?? null };
};
function warningsFor(passport, participation, fields) {
  const edition = editionOf(passport), details = parseMarketDetails(passport.data);
  const warnings = [
    'Prepared locally only. No token is minted, no supply is issued and no blockchain transaction is signed or submitted.',
    'Token ownership does not establish copyright, a licence, company equity, participation, consent or payment rights.',
    'Edition cap is an intended collection limit, not issued supply. Royalty basis points are a request; collection is not assured.',
  ];
  if (edition.standard === 'UNDECIDED') warnings.push('Token standard is undecided.');
  if (edition.cap === null) warnings.push('Edition cap is unknown.');
  if (edition.royaltyBps === null) warnings.push('Requested royalty is unknown.');
  if (!fields.name.trim()) warnings.push('Public name is missing.');
  if (!fields.imageUri) warnings.push('Public image URI is missing.');
  if (!fields.licenceUri || !fields.licenceSummary.trim()) warnings.push('Public licence information is incomplete.');
  if (!(details.licenceEvidenceHashes?.length)) warnings.push('The passport has no retained licence evidence.');
  if (!participation.data.rights.length || participation.data.rights.some(right => right.status !== 'DOCUMENTED')) warnings.push('Rights information is incomplete, claimed or disputed. Retained evidence does not establish legal effect.');
  return warnings;
}

function historyProof(record, history) {
  const proof = { id: record.id, kind: record.kind, entries: history.slice(0, record.version).map(row => ({ version: row.version, sha256: row.sha256 })) };
  return { ...proof, chainHash: historyDigest(proof) };
}

/** Validates source retention without reading the token's own history (safe in storage history hooks). */
export function validateStoredTokenPreparation(store, record, { requireCurrent = false } = {}) {
  validateTokenPreparationIdentity(record.id, record.kind, record.data, record.version);
  need(record.kind === TOKEN_PREPARATION_KIND && hashCanonical(record.data) === record.sha256, 'TOKEN_SAVED_RECORD_HASH_MISMATCH');
  verifyTokenPreparationIntegrity(record.data);
  const loaded = sources(store, record.data, requireCurrent), { passport, participation, project } = loaded;
  validateTokenPreparation(record.data, project);
  need(record.data.sourceHash === passport.record.data.sourceHash && record.data.assetHash === passport.record.data.assetHash, 'TOKEN_SOURCE_IDENTITY_MISMATCH');
  need(same(record.data.edition, editionOf(passport.record)), 'TOKEN_EDITION_SOURCE_MISMATCH');
  need(same(record.data.warnings, warningsFor(passport.record, participation.record, record.data.publicFields)), 'TOKEN_WARNINGS_SOURCE_MISMATCH');
  const expected = [historyProof(passport.record, passport.history), historyProof(participation.record, participation.history)];
  need(same(expected, record.data.privateProof.histories), 'TOKEN_SOURCE_HISTORY_MISMATCH');
  return loaded;
}

function isCurrent(store, loaded) {
  if (![loaded.passport, loaded.participation].every(source => same(refOf(source.record), refOf(source.history.at(-1))))) return false;
  try { store.validateParticipationReferences(loaded.participation.record.data, true); return true; }
  catch (error) {
    // Historical references were already fully verified. These errors express
    // a changed latest subject/budget; missing or damaged retained bytes fail.
    if (['PARTICIPATION_RECORD_MISSING_OR_CHANGED', 'PARTICIPATION_BUDGET_MISSING_OR_CHANGED', 'PARTICIPATION_BUDGET_LINE_MISSING'].includes(error.code)) return false;
    throw error;
  }
}

export function createAssetTokenPreparationService(store) {
  function result(record, replayed) {
    const loaded = validateStoredTokenPreparation(store, record);
    return { record: replayed ? { ...record, replayed: true } : record, current: isCurrent(store, loaded), integrity: 'VERIFIED_LOCALLY' };
  }
  return {
    prepare(input) {
      validateTokenPreparationRequest(input);
      const request = structuredClone(input), id = `asset-token:${request.requestId}`;
      need(store.project()?.id === request.projectId, 'TOKEN_PREPARATION_PROJECT_MISMATCH');
      const prior = store.history(id);
      if (prior.length) {
        need(prior.length === 1 && prior[0].kind === TOKEN_PREPARATION_KIND, 'TOKEN_PREPARATION_IMMUTABLE');
        need(same(requestOf(prior[0].data), request), 'REQUEST_ID_CONFLICT', 'This preparation request id was already used with different input.');
        return result(prior[0], true);
      }
      const { passport, participation } = sources(store, request, true);
      const data = {
        schemaVersion: 1, projectId: request.projectId, sourceHash: passport.record.data.sourceHash, status: 'PREPARED_LOCALLY', requestId: request.requestId, preparedAt: new Date().toISOString(),
        assetHash: passport.record.data.assetHash, passportRef: request.passportRef, participationRef: request.participationRef,
        edition: editionOf(passport.record), publicFields: request.publicFields,
        privateProof: { nonce: randomBytes(32).toString('hex'), histories: [historyProof(passport.record, passport.history), historyProof(participation.record, participation.history)], commitment: '' },
        publicMetadata: null, metadataSha256: '', warnings: warningsFor(passport.record, participation.record, request.publicFields),
      };
      data.privateProof.commitment = commitment(data);
      data.publicMetadata = tokenPublicMetadata(data);
      data.metadataSha256 = hashCanonical(data.publicMetadata);
      validateTokenPreparation(data, store.project()); verifyTokenPreparationIntegrity(data);
      const record = store.saveTokenPreparation(id, { kind: TOKEN_PREPARATION_KIND, data, expectedVersion: null, requestId: request.requestId });
      return result(record, false);
    },
    verify(input) {
      need(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).sort().join(',') === 'projectId,recordId', 'TOKEN_VERIFY_FIELDS_INVALID', 'Select the saved project and preparation packet.', 422);
      need(typeof input.projectId === 'string' && store.project()?.id === input.projectId, 'TOKEN_PREPARATION_PROJECT_MISMATCH');
      need(typeof input.recordId === 'string' && /^asset-token:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.recordId), 'TOKEN_PREPARATION_IDENTITY_INVALID');
      const history = store.history(input.recordId);
      need(history.length === 1 && history[0].data.projectId === input.projectId, 'TOKEN_PREPARATION_NOT_FOUND', 'The saved preparation packet is unavailable.', 404);
      return result(history[0], false);
    },
  };
}
