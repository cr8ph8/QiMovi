import { canonical, check, PilotError, sha256 } from './storage.mjs';
import { validateRecord } from '../contracts/drifter.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const recoveryId = value => typeof value === 'string' && /^writing-recovery:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const version = value => Number.isSafeInteger(value) && value > 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const putFields = ['expectedVersion', 'requestId', 'draftId', 'data', 'baseVersion', 'baseSha256', 'saveRequestId'];
function shape(value, fields) {
  check(object(value) && fields.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => fields.includes(key)), 'WRITING_RECOVERY_FIELDS_INVALID', 422);
}
function scope(data) { return canonical({ sourceHash: data.sourceHash, projectId: data.projectId ?? null, sceneId: data.sceneId ?? null }); }
function wellFormed(value) {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** Private working copies only: these tables never participate in record or kernel state. */
export function createWritingRecoveryService(store) {
  const db = store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS writing_recovery (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL, sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('ACTIVE','RESOLVED')),
      draft_id TEXT NOT NULL, data TEXT NOT NULL, base_version INTEGER,
      base_sha256 TEXT, save_request_id TEXT
    );
    CREATE TABLE IF NOT EXISTS writing_recovery_requests (
      id TEXT PRIMARY KEY, request_sha256 TEXT NOT NULL, status INTEGER NOT NULL, result TEXT NOT NULL
    );
  `);
  const row = value => ({ id: value.id, version: value.version, sha256: value.sha256, updatedAt: value.updated_at,
    state: value.state, draftId: value.draft_id, data: JSON.parse(value.data), baseVersion: value.base_version,
    baseSha256: value.base_sha256, saveRequestId: value.save_request_id });
  function validateData(data) {
    // During typing a title can be empty. Validate all original title constraints
    // before substituting only its required nonblank value for the writer contract.
    check(object(data) && wellFormed(data.title) && data.title.length <= 200 && !/[\r\n\0]/.test(data.title), 'WRITING_RECOVERY_TITLE_INVALID', 422);
    check(wellFormed(data.body), 'WRITING_RECOVERY_BODY_INVALID', 422);
    canonical(data); // JSON-size validation without text normalization.
    validateRecord('screenplay-draft', data.title.trim() ? data : { ...data, title: 'Working copy' }, store.project());
    store.validateAuthoringReferences('screenplay-draft', data);
  }
  function validateBase(value) {
    check((value.baseVersion === null && value.baseSha256 === null) || (version(value.baseVersion) && digest(value.baseSha256)), 'WRITING_RECOVERY_BASE_INVALID', 422);
    if (value.baseVersion === null) return;
    const base = db.prepare('SELECT * FROM records WHERE id=? AND version=?').get(value.draftId, value.baseVersion);
    check(base?.kind === 'screenplay-draft' && base.sha256 === value.baseSha256 && sha256(base.data) === value.baseSha256,
      'WRITING_RECOVERY_BASE_CONFLICT', 409);
    const baseData = JSON.parse(base.data);
    check(scope(baseData) === scope(value.data), 'WRITING_RECOVERY_SCOPE_CONFLICT', 409);
  }
  function checkedRow(value) {
    const result = row(value);
    check(sha256(canonical(result.data)) === result.sha256, 'WRITING_RECOVERY_HASH_MISMATCH', 409);
    validateData(result.data); validateBase(result);
    return result;
  }
  function transaction(id, action, input, mutate) {
    check(recoveryId(id), 'WRITING_RECOVERY_ID_INVALID', 422);
    shape(input, action === 'put' ? putFields : ['expectedVersion', 'requestId']);
    check(identity(input.requestId), 'WRITING_RECOVERY_REQUEST_INVALID', 422);
    const snapshot = JSON.parse(canonical(input));
    const requestHash = sha256(canonical({ id, action, input: snapshot }));
    db.exec('BEGIN IMMEDIATE');
    let receipt;
    try {
      const prior = db.prepare('SELECT * FROM writing_recovery_requests WHERE id=?').get(snapshot.requestId);
      if (prior) {
        check(prior.request_sha256 === requestHash, 'WRITING_RECOVERY_REQUEST_CONFLICT', 409);
        receipt = { status: prior.status, result: JSON.parse(prior.result) };
      } else {
        try { receipt = { status: 200, result: mutate(snapshot) }; }
        catch (error) {
          // Remember stale attempts as well: a delayed identical retry must not
          // become a successful write after the surrounding state has changed.
          if (error.status !== 409) throw error;
          receipt = { status: 409, result: { error: error.code } };
        }
        db.prepare('INSERT INTO writing_recovery_requests VALUES(?,?,?,?)').run(snapshot.requestId, requestHash, receipt.status, canonical(receipt.result));
      }
      db.exec('COMMIT');
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    if (receipt.status !== 200) throw new PilotError(receipt.result.error, receipt.status);
    return receipt.result;
  }
  return {
    list() { return db.prepare("SELECT * FROM writing_recovery WHERE state='ACTIVE' ORDER BY updated_at DESC,id").all().map(checkedRow); },
    put(id, input) {
      return transaction(id, 'put', input, value => {
        check(value.expectedVersion === null || version(value.expectedVersion), 'WRITING_RECOVERY_VERSION_INVALID', 422);
        check(identity(value.draftId) && value.draftId.startsWith('screenplay-draft:') && value.draftId.length > 'screenplay-draft:'.length, 'WRITING_RECOVERY_DRAFT_INVALID', 422);
        check(value.saveRequestId === null || identity(value.saveRequestId), 'WRITING_RECOVERY_SAVE_REQUEST_INVALID', 422);
        validateData(value.data); validateBase(value);
        const previous = db.prepare('SELECT * FROM writing_recovery WHERE id=?').get(id);
        check((previous?.version ?? null) === value.expectedVersion, 'WRITING_RECOVERY_VERSION_CONFLICT', 409);
        if (previous) {
          check(previous.state === 'ACTIVE', 'WRITING_RECOVERY_RESOLVED', 409);
          check(previous.draft_id === value.draftId && scope(JSON.parse(previous.data)) === scope(value.data), 'WRITING_RECOVERY_SCOPE_CONFLICT', 409);
        }
        const result = { id, version: (value.expectedVersion ?? 0) + 1, sha256: sha256(canonical(value.data)), updatedAt: new Date().toISOString(),
          state: 'ACTIVE', draftId: value.draftId, data: value.data, baseVersion: value.baseVersion, baseSha256: value.baseSha256, saveRequestId: value.saveRequestId };
        db.prepare(`INSERT INTO writing_recovery VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          version=excluded.version,sha256=excluded.sha256,updated_at=excluded.updated_at,state=excluded.state,
          draft_id=excluded.draft_id,data=excluded.data,base_version=excluded.base_version,base_sha256=excluded.base_sha256,save_request_id=excluded.save_request_id`)
          .run(id, result.version, result.sha256, result.updatedAt, result.state, result.draftId, canonical(result.data), result.baseVersion, result.baseSha256, result.saveRequestId);
        return result;
      });
    },
    resolve(id, input) {
      return transaction(id, 'resolve', input, value => {
        check(version(value.expectedVersion), 'WRITING_RECOVERY_VERSION_INVALID', 422);
        const previous = db.prepare('SELECT * FROM writing_recovery WHERE id=?').get(id);
        check(previous?.version === value.expectedVersion, 'WRITING_RECOVERY_VERSION_CONFLICT', 409);
        check(previous.state === 'ACTIVE', 'WRITING_RECOVERY_RESOLVED', 409);
        const result = { ...checkedRow(previous), version: previous.version + 1, updatedAt: new Date().toISOString(), state: 'RESOLVED' };
        db.prepare('UPDATE writing_recovery SET version=?,updated_at=?,state=? WHERE id=?').run(result.version, result.updatedAt, result.state, id);
        return result;
      });
    },
  };
}
