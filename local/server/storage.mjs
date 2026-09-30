import { validateUsageRecordReferences } from './usage-accounting.mjs';
import { validateBudgetIdentity, validateBudgetCommitmentTransition, validateProductionBudget } from '../contracts/production-budget.mjs';
import { validateUsageIdentity } from '../contracts/usage-accounting.mjs';
import { validateProjectDirection, validateProjectDirectionId } from '../contracts/project-direction.mjs';
import { validateShotDirection, validateShotDirectionIdentity } from '../contracts/shot-direction.mjs';
import { validateModelAssistanceRecordReferences } from './model-assistance.mjs';
import { validateUniverseRecordReferences } from './universe.mjs';
import { validateContextRecordReferences } from './context-bundles.mjs';
import { validateContextBundleId } from '../contracts/context-bundle.mjs';
import { validateCoverageDraft } from '../contracts/source-coverage.mjs';
import { verifyStoredLore, validateLoreReferences, loreId } from './lore.mjs';
import { validateCameraRecordReferences } from './camera-proofs.mjs';
import { validateDccReturnCellReferences } from './dcc-stage-returns.mjs';
import { validateMediaRecordReferences } from './media-takes.mjs';
import { MEDIA_RECORD_KINDS } from '../contracts/media-takes.mjs';
import { validateNodeWorkflowReferences } from './node-workflow.mjs';
import { verifyProjectAssetRecord, validateAssetCurationReferences } from './project-library.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../kernel/src/canonical-json.mjs';
import { AUTHORING_KINDS, BIBLE_AUTHORING_INPUT_KINDS, BIBLE_AUTHORING_INPUT_LIMIT } from '../contracts/authoring.mjs';
import { readAuthoringLineage, validateBibleAuthoringRecord, bibleAuthoringScopeMatches } from './authoring-lineage.mjs';
import { validateMovieSequenceIdentity, validateMovieSequenceReferences } from '../contracts/movie-sequence.mjs';
import { validateStudioOperationIdentity, validateStudioOperationReferences } from '../contracts/studio-operation.mjs';
import { isCreativeProject, validateCreativeProject, CREATIVE_PROJECT_RECORD_KINDS, projectOwnedContext } from '../contracts/creative-project.mjs';
import { validateCreativeScreenplayDraft } from '../contracts/creative-screenplay.mjs';
import { validateWritingSceneTransition } from '../contracts/writing-scene-map.mjs';
import { PRODUCTION_ATTACHMENT_KIND, productionAttachmentId, buildProductionAttachment, attachedProductionProject, validateProductionAttachmentRequest } from '../contracts/production-attachment.mjs';
import { WRITING_PRODUCTION_KIND, validateWritingProductionRequest, validateWritingProductionRecord } from '../contracts/writing-production.mjs';
import { validateStudioMediaIdentity, validateStudioMediaReferences } from '../contracts/studio-media.mjs';
import { validateStudioGeneration, validateStudioGenerationIdentity, validateStudioGenerationReferences, validateStudioGenerationTransition } from '../contracts/studio-generation.mjs';
import { validateStudioReference, validateStudioReferenceIdentity, validateStudioReferenceReferences, validateStudioReferenceTransition } from '../contracts/studio-reference.mjs';
import { validateAssetMarketProfile, validateAssetMarketProfileIdentity, validateAssetMarketProfileReferences } from '../contracts/asset-market-profile.mjs';
import { validateTokenPreparationIdentity } from '../contracts/asset-token-preparation.mjs';
import { validateStoredTokenPreparation } from './asset-token-preparation.mjs';
import { validateParticipation, validateParticipationIdentity, validateParticipationReferences } from '../contracts/project-participation.mjs';
import { validateComicPackage, validateComicPackageIdentity, validateComicPackageReferences } from '../contracts/comic-package.mjs';
import { validateFrameExtractionRequest } from '../contracts/storyboard-frame.mjs';
import { validateFrameExtractionReferences } from './storyboard-frames.mjs';
import { STORYBOARD_PLANNING_KINDS, validateStoryboardPlanning, validateStoryboardPlanningIdentity, keyframePlanCurrentness } from '../contracts/storyboard-planning.mjs';
import { validateWorldRehearsalTransition } from '../contracts/world-rehearsal.mjs';

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const canonical = canonicalJson;
export function hashFile(filename) {
  const fd = fs.openSync(filename, 'r'); const hash = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536);
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
export class PilotError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function check(condition, code, status = 400) { if (!condition) throw new PilotError(code, status); }
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const SHA = /^[a-f0-9]{64}$/;
const MEDIA_SERVICE = Symbol('media-service');
const PHONE_HANDOFF_SERVICE = Symbol('phone-handoff-service');
const MODEL_SERVICE = Symbol('model-assistance-service');
const USAGE_SERVICE = Symbol('usage-accounting-service');
const BUDGET_SERVICE = Symbol('production-budget-service');
const WRITING_PRODUCTION_SERVICE = Symbol('writing-production-service');
const PRODUCTION_ATTACHMENT_SERVICE = Symbol('production-attachment-service');
function budgetTransition(previous, next) {
  if (previous) check(next.actuals.length >= previous.actuals.length && previous.actuals.every((actual, index) => canonical(actual) === canonical(next.actuals[index])), 'BUDGET_ACTUALS_APPEND_ONLY', 409);
  validateBudgetCommitmentTransition(previous, next);
}
const PROJECT_ASSET_SERVICE = Symbol('project-asset-service');
const DCC_RETURN_SERVICE = Symbol('dcc-return-service');
const STUDIO_GENERATION_SERVICE = Symbol('studio-generation-service');
const STUDIO_REFERENCE_SERVICE = Symbol('studio-reference-service');
const TOKEN_PREPARATION_SERVICE = Symbol('asset-token-preparation-service');
const COMIC_PACKAGE_SERVICE = Symbol('comic-package-service');
const FRAME_EXTRACTION_SERVICE = Symbol('storyboard-frame-extraction-service');
const authoringKind = kind => kind==='screenplay-draft'||AUTHORING_KINDS.includes(kind);
function authoringIdentity(id,kind) { if(authoringKind(kind)||kind==='production-handoff')check(typeof id==='string'&&id.startsWith(`${kind}:`)&&id.length>kind.length+1,'RECORD_IDENTITY_MISMATCH'); }
export function privateDirectory(directory) {
  const absolute = path.resolve(directory);
  fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  check(!fs.lstatSync(absolute).isSymbolicLink(), 'DATA_DIRECTORY_SYMLINK');
  fs.chmodSync(absolute, 0o700);
  return absolute;
}
// SQLite follows paths and may create, recover, or remove its sidecars during
// open. Validate every leaf before SQLite or chmod can affect an imported path.
// lstat intentionally detects dangling links, unlike existsSync/stat.
export function assertSqliteDatabasePath(filename) {
  const directory = fs.lstatSync(path.dirname(filename));
  check(directory.isDirectory() && !directory.isSymbolicLink(), 'SQLITE_DIRECTORY_PATH_UNSAFE', 409);
  function regularOrMissing(candidate, code) {
    let stat;
    try { stat = fs.lstatSync(candidate); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    // Hard links also let a database write alter a file outside this project.
    check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, code, 409);
    return true;
  }
  const exists = regularOrMissing(filename, 'SQLITE_DATABASE_PATH_UNSAFE');
  for (const suffix of ['-journal', '-wal', '-shm']) regularOrMissing(`${filename}${suffix}`, 'SQLITE_SIDECAR_PATH_UNSAFE');
  return exists;
}
export function atomicPrivateFile(filename, bytes) {
  const temp = `${filename}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' });
  const fd = fs.openSync(temp, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, filename);
}
export function acquireLock(directory) {
  const filename = path.join(directory, 'process.lock');
  const nonce = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(filename, JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 });
      return () => {
        try { if (JSON.parse(fs.readFileSync(filename, 'utf8')).nonce === nonce) fs.unlinkSync(filename); } catch {}
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let alive = true;
      try {
        const lock = JSON.parse(fs.readFileSync(filename, 'utf8'));
        check(Number.isInteger(lock.pid) && lock.pid > 0, 'INVALID_PROCESS_LOCK');
        try { process.kill(lock.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; else throw e; }
      } catch { throw new PilotError('PROCESS_LOCK_REQUIRES_INSPECTION', 409); }
      check(!alive, 'LOCAL_PILOT_ALREADY_RUNNING', 409);
      fs.unlinkSync(filename);
    }
  }
  throw new PilotError('PROCESS_LOCK_CONFLICT', 409);
}
export function loadConfig(directory) {
  const filename = path.join(directory, 'config.json');
  check(fs.existsSync(filename), 'RUN_INIT_FIRST');
  check(!fs.lstatSync(filename).isSymbolicLink(), 'CONFIG_SYMLINK');
  check((fs.statSync(filename).mode & 0o077) === 0, 'CONFIG_PERMISSIONS_TOO_OPEN');
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  check(config.schema_version === 'filmstack-local-config/v1' && config.ownerActorId === 'local-owner' && /^[a-f0-9]{64}$/.test(config.ownerToken), 'INVALID_CONFIG');
  return config;
}
export function initialize(directory) {
  privateDirectory(directory);
  const filename = path.join(directory, 'config.json');
  if (!fs.existsSync(filename)) atomicPrivateFile(filename, JSON.stringify({
    schema_version: 'filmstack-local-config/v1', ownerActorId: 'local-owner', ownerToken: crypto.randomBytes(32).toString('hex'),
  }, null, 2) + '\n');
  privateDirectory(path.join(directory, 'blobs'));
  return loadConfig(directory);
}

export class WorkspaceStore {
  constructor(directory, validateRecord) {
    this.directory = directory;
    this.validateRecord = validateRecord;
    const filename = path.join(directory, 'workspace.sqlite');
    assertSqliteDatabasePath(filename);
    this.db = new DatabaseSync(filename);
    fs.chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, sha256 TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id,version));
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, request_sha256 TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blobs (sha256 TEXT PRIMARY KEY, byte_length INTEGER NOT NULL, mime_type TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS record_cell_bases (record_id TEXT NOT NULL, record_version INTEGER NOT NULL, cell_id TEXT NOT NULL, cell_sha256 TEXT NOT NULL, PRIMARY KEY(record_id,record_version,cell_id), FOREIGN KEY(record_id,record_version) REFERENCES records(id,version));
      CREATE TRIGGER IF NOT EXISTS immutable_cell_bases_update BEFORE UPDATE ON record_cell_bases BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CELL_BASIS'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_cell_bases_delete BEFORE DELETE ON record_cell_bases BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CELL_BASIS'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_records_update BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECORD'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_records_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECORD'); END;`);
  }
  close() { this.db.close(); }
  baseProject() {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='project'").get();
    const project = row ? JSON.parse(row.value) : null;
    if (isCreativeProject(project)) validateCreativeProject(project);
    return project;
  }
  // Resolve from immutable inputs with raw row reads: history() itself asks for
  // project context, so projection verification must never recurse through it.
  productionAttachment() {
    const pointer = this.db.prepare("SELECT value FROM metadata WHERE key='production_attachment'").get();
    const rows = this.rawList(PRODUCTION_ATTACHMENT_KIND);
    check(Boolean(pointer) === Boolean(rows.length) && rows.length <= 1, 'PRODUCTION_ATTACHMENT_POINTER_INVALID', 409);
    if (!pointer) return null;
    const ref = JSON.parse(pointer.value), base = this.baseProject(); validateCreativeProject(base);
    check(ref && Object.keys(ref).sort().join(',') === 'id,sha256,version' && ref.id === productionAttachmentId(base.id) && ref.version === 1 && SHA.test(ref.sha256), 'PRODUCTION_ATTACHMENT_POINTER_INVALID', 409);
    const record = rows[0];
    check(record.id === ref.id && record.version === 1 && record.sha256 === ref.sha256 && sha256(canonical(record.data)) === ref.sha256, 'PRODUCTION_ATTACHMENT_RECORD_INVALID', 409);
    check(this.db.prepare('SELECT COUNT(*) AS count FROM records WHERE id=?').get(ref.id).count === 1, 'PRODUCTION_ATTACHMENT_IMMUTABLE', 409);
    const exactRecord = (ref, kind) => {
      const row = this.db.prepare('SELECT * FROM records WHERE id=? AND version=? AND sha256=?').get(ref?.id, ref?.version, ref?.sha256);
      check(row && row.kind === kind, 'PRODUCTION_ATTACHMENT_INPUT_MISSING', 409);
      const value = this.row(row); check(sha256(canonical(value.data)) === value.sha256, 'PRODUCTION_ATTACHMENT_INPUT_CHANGED', 409); return value;
    };
    const draft = exactRecord(record.data.draftRef, 'screenplay-draft'), plan = exactRecord(record.data.planRef, 'writing-production-plan');
    check(canonical(buildProductionAttachment(base, draft, plan, sha256)) === canonical(record.data), 'PRODUCTION_ATTACHMENT_PROJECTION_CHANGED', 409);
    const blob = this.blobInfo(record.data.sourceHash);
    check(blob.mimeType === 'text/plain' && fs.readFileSync(blob.filename).equals(Buffer.from(draft.data.body, 'utf8')), 'PRODUCTION_ATTACHMENT_SOURCE_CHANGED', 409);
    return record;
  }
  project() {
    const base = this.baseProject();
    if (!base || !isCreativeProject(base)) return base;
    const attachment = this.productionAttachment();
    return attachment ? attachedProductionProject(base, attachment) : base;
  }
  recordProject(kind, data, project = this.project()) {
    return ['asset-curation', 'universe-continuity-plan', 'universe-production-plan'].includes(kind) && project?.creativeOrigin ? project : projectOwnedContext(project, kind, data);
  }
  commitProductionAttachment(input, build) {
    validateProductionAttachmentRequest('attach', input);
    const requestId = `production-attachment:${sha256(input.requestId)}`, requestHash = sha256(canonical(input));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if (prior) {
        check(prior.request_sha256 === requestHash, 'REQUEST_ID_CONFLICT', 409);
        const record = this.productionAttachment();
        check(record && canonical({ ...record, replayed: false }) === canonical({ ...JSON.parse(prior.result), replayed: false }), 'PRODUCTION_ATTACHMENT_REPLAY_INVALID', 409);
        this.db.exec('COMMIT'); return { ...record, replayed: true };
      }
      const { data, body } = build(), existing = this.productionAttachment();
      if (existing) {
        check(canonical(existing.data) === canonical(data), 'PRODUCTION_ATTACHMENT_ALREADY_EXISTS', 409);
        this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId, requestHash, canonical(existing));
        this.db.exec('COMMIT'); return existing;
      }
      const bytes = Buffer.from(body, 'utf8'), hash = sha256(bytes), filename = path.join(this.directory, 'blobs', hash);
      check(hash === data.sourceHash && bytes.length > 0 && bytes.length <= 800000, 'PRODUCTION_ATTACHMENT_SOURCE_INVALID', 409);
      const blob = this.db.prepare('SELECT * FROM blobs WHERE sha256=?').get(hash);
      check(!blob || blob.byte_length === bytes.length && blob.mime_type === 'text/plain', 'PRODUCTION_ATTACHMENT_BLOB_CONFLICT', 409);
      if (fs.existsSync(filename)) check(!fs.lstatSync(filename).isSymbolicLink() && fs.readFileSync(filename).equals(bytes), 'PRODUCTION_ATTACHMENT_BLOB_CONFLICT', 409);
      else atomicPrivateFile(filename, bytes);
      this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(hash, bytes.length, 'text/plain');
      const id = productionAttachmentId(data.projectId), record = { id, kind: PRODUCTION_ATTACHMENT_KIND, version: 1, sha256: sha256(canonical(data)), data, replayed: false };
      check(ID.test(id), 'PRODUCTION_ATTACHMENT_IDENTITY_INVALID', 422);
      this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(id, record.kind, 1, record.sha256, canonical(data));
      this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('production_attachment', canonical({ id, version: 1, sha256: record.sha256 }));
      this.productionAttachment();
      const planRow = this.db.prepare('SELECT * FROM records WHERE id=? AND version=? AND sha256=?').get(data.planRef.id, data.planRef.version, data.planRef.sha256);
      for (const scene of this.row(planRow).data.scenes.filter(item => item.notes.length)) {
        this.save(`scene-plan:${scene.sceneId}`, { kind: 'scene-plan', expectedVersion: null, requestId: `attachment-scene:${sha256(canonical({ input, sceneId: scene.sceneId }))}`,
          data: { sceneId: scene.sceneId, sourceHash: data.sourceHash, notes: scene.notes, cellOverrides: [], timingObservations: [], segments: [] } }, PRODUCTION_ATTACHMENT_SERVICE, { transaction: PRODUCTION_ATTACHMENT_SERVICE });
      }
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId, requestHash, canonical(record));
      this.db.exec('COMMIT'); return record;
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  initializeCreativeProject(project) {
    validateCreativeProject(project);
    check(!Object.hasOwn(project, 'cellBasisHashes') && !Object.hasOwn(project, 'cellRevisionSceneIds'), 'CREATIVE_PROJECT_PROJECTION_NOT_SOURCE');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of ['metadata', 'records', 'requests', 'blobs']) check(this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count === 0, 'WORKSPACE_NOT_EMPTY', 409);
      this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('project', canonical(project));
      this.db.exec('COMMIT');
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
    return project;
  }
  validateCreativeRecord(kind, data, project = this.project()) {
    project = projectOwnedContext(project, kind, data);
    if (!isCreativeProject(project)) return;
    validateCreativeProject(project);
    check(CREATIVE_PROJECT_RECORD_KINDS.includes(kind), 'CREATIVE_PROJECT_RECORD_REQUIRES_SCREENPLAY', 422);
    // Direction retains the shared v1/v2 shape. Save, history and recovery bind
    // its enclosing project-direction:<project.id> identity separately.
    if (kind === 'project-direction') return validateProjectDirection(data, project);
    check(data?.projectId === project.id && data.sourceHash === null, 'CREATIVE_PROJECT_RECORD_PROJECT_MISMATCH', 422);
    if (kind === 'screenplay-draft') validateCreativeScreenplayDraft(data, project);
  }
  rawList(kind) {
    if (kind !== undefined) check(ID.test(kind), 'INVALID_KIND');
    const query = `SELECT r.* FROM records r WHERE r.version=(SELECT MAX(version) FROM records WHERE id=r.id)${kind === undefined ? '' : ' AND r.kind=?'} ORDER BY r.id`;
    return this.db.prepare(query).all(...(kind === undefined ? [] : [kind])).map(row => this.row(row));
  }
  history(id) {
    check(typeof id==='string'&&ID.test(id),'INVALID_RECORD_ID');
    const rows=this.db.prepare('SELECT * FROM records WHERE id=? ORDER BY version ASC LIMIT 10001').all(id);
    check(rows.length<=10000,'RECORD_HISTORY_TOO_LARGE',413);
    const records=rows.map(row=>this.row(row));
    for(const [index,record] of records.entries()) {
      check(record.id===id&&record.version===index+1&&record.kind===records[0].kind,'RECORD_HISTORY_INVALID',409);
      check(sha256(canonical(record.data))===record.sha256,'SAVED_RECORD_HASH_MISMATCH',409);
      if (record.kind === 'universe-rehearsal' || record.id.startsWith('universe-rehearsal:')) {
        check(record.kind === 'universe-rehearsal' && record.id.startsWith('universe-rehearsal:'), 'UNIVERSE_RECORD_IDENTITY_MISMATCH', 409);
        validateWorldRehearsalTransition(index ? records[index - 1] : null, record.data, record.version);
      }
      validateUsageIdentity(record.id, record.kind, record.data, record.version);
      validateBudgetIdentity(record.id, record.kind, record.data);
      if (record.kind === 'production-budget') {
        validateProductionBudget(record.data, this.recordProject(record.kind, record.data));
        budgetTransition(index ? records[index - 1].data : null, record.data);
      }
      validateUsageRecordReferences(this, record);
      this.validateWritingProductionRecord(record);
      if (record.kind === PRODUCTION_ATTACHMENT_KIND || record.id.startsWith(`${PRODUCTION_ATTACHMENT_KIND}:`)) this.validateProductionAttachmentRecord(record);
      authoringIdentity(record.id,record.kind);
      validateStudioGenerationIdentity(record.id, record.kind);
      validateStudioReferenceIdentity(record.id, record.kind);
      validateAssetMarketProfileIdentity(record.id, record.kind, record.data, index ? records[index - 1].data : null);
      validateParticipationIdentity(record.id, record.kind, record.data, index ? records[index - 1].data : null);
      validateTokenPreparationIdentity(record.id, record.kind, record.data, record.version);
      if (record.kind === 'asset-token-preparation') {
        check(records.length === 1, 'TOKEN_PREPARATION_IMMUTABLE', 409);
        validateStoredTokenPreparation(this, record, { requireCurrent: false });
      }
      if (record.kind === 'project-participation') {
        validateParticipation(record.data, this.recordProject(record.kind, record.data));
        this.validateParticipationReferences(record.data, false);
      }
      validateComicPackageIdentity(record.id, record.kind, record.data);
      validateStoryboardPlanningIdentity(record.id, record.kind, record.data);
      validateShotDirectionIdentity(record.id, record.kind, record.data);
      if (STORYBOARD_PLANNING_KINDS.includes(record.kind)) validateStoryboardPlanning(record.kind, record.data, this.project(), { references: false });
      if (record.kind === 'shot-direction') validateShotDirection(record.data, this.project());
      validateFrameExtractionReferences(this, record);
      if (record.kind === 'comic-package') {
        check(record.version === 1 && records.length === 1, 'COMIC_PACKAGE_IMMUTABLE', 409);
        validateComicPackage(record.data, this.project());
        this.validateComicPackageReferences(record.data);
      }
      if (record.kind === 'asset-market-profile') {
        validateAssetMarketProfile(record.data, this.recordProject(record.kind, record.data));
        validateAssetMarketProfileReferences(record.data, hash => this.blobInfo(hash));
      }
      if (record.kind === 'studio-reference') {
        validateStudioReference(record.data, this.recordProject(record.kind, record.data));
        validateStudioReferenceTransition(index ? records[index - 1].data : null, record.data);
        this.validateStudioReferenceReferences(record.data);
      }
      if (record.kind === 'studio-generation') {
        validateStudioGeneration(record.data, this.recordProject(record.kind, record.data));
        validateStudioGenerationTransition(index ? records[index - 1].data : null, record.data);
        this.validateStudioGenerationReferences(record.data);
      }
      this.validateCreativeRecord(record.kind, record.data);
      validateStudioMediaIdentity(record.id, record.kind, record.data);
      if (record.kind === 'studio-media') {
        check(record.version === 1 && records.length === 1, 'STUDIO_MEDIA_IMMUTABLE', 409);
        this.validateRecord(record.kind, record.data, this.recordProject(record.kind, record.data));
        validateStudioMediaReferences(record.data, hash => this.blobInfo(hash));
      }
      if (record.kind === 'studio-operation' && isCreativeProject(this.recordProject(record.kind, record.data))) this.validateRecord(record.kind, record.data, this.recordProject(record.kind, record.data));
      validateDccReturnCellReferences(this, record.kind, record.data, { previous: index ? records[index - 1] : null });
    if (record.kind === 'project-direction' || record.id.startsWith('project-direction:')) { check(record.kind === 'project-direction', 'PROJECT_DIRECTION_IDENTITY_INVALID'); validateProjectDirectionId(record.id, this.resolvedProject()); }
      if(record.kind==='lore-source')check(record.version===1&&record.id===loreId(record.data),'LORE_RECORD_MISMATCH',409);
      if(record.kind==='measured-media-take')check(record.version===1&&record.id===`measured-media-take:${record.sha256}`,'MEDIA_RECORD_IDENTITY_MISMATCH',409);
      if(record.kind==='project-asset')check(record.version===1&&record.id===`project-asset:${record.data.asset?.sha256}`,'PROJECT_ASSET_HISTORY_INVALID',409);
      if(record.kind==='asset-curation'||record.id.startsWith('asset-curation:'))check(record.kind==='asset-curation'&&record.id===`asset-curation:${record.data.assetRef?.id?.slice('project-asset:'.length)}`,'ASSET_CURATION_IDENTITY_INVALID',409);
    }
    // Historical originals have no newly inferred review or current-basis state.
    return records;
  }
  resolvedProject() {
    const project = this.project(); if (!project) return null;
    if (isCreativeProject(project)) {
      check(this.rawList().every(record => CREATIVE_PROJECT_RECORD_KINDS.includes(record.kind)), 'CREATIVE_PROJECT_RECORD_REQUIRES_SCREENPLAY', 422);
      return validateCreativeProject({ ...project, cellRevisionSceneIds: [], cellBasisHashes: {} });
    }
    const cells = new Map((project.cells ?? []).map(cell => [cell.id, cell]));
    const revisedScenes = new Set();
    for (const record of this.rawList('storyboard-cell')) {
      const { cellId, sourceHash, ...data } = record.data;
      check(sourceHash === project.sourceHash && record.id === `storyboard-cell:${cellId}`, 'STORYBOARD_PROJECTION_BINDING_MISMATCH');
      check(sha256(canonical(record.data)) === record.sha256, 'STORYBOARD_PROJECTION_HASH_MISMATCH');
      revisedScenes.add(data.sceneId);
      cells.set(cellId, { id: cellId, ...data, review: 'PENDING', scope: 'INTERNAL_PREVISUALIZATION_ONLY',
        candidateRecordId: record.id, candidateVersion: record.version, candidateSha256: record.sha256 });
    }
    check(cells.size <= 400, 'STORYBOARD_CELL_LIMIT_EXCEEDED');
    const shots = (project.scenes ?? []).flatMap(scene => scene.shots.map(shot => shot.id));
    project.cells = [...cells.values()].sort((a,b) => shots.indexOf(a.shotId)-shots.indexOf(b.shotId) || ['START','MOMENT','END'].indexOf(a.role)-['START','MOMENT','END'].indexOf(b.role) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    project.cellRevisionSceneIds = [...revisedScenes].sort();
    project.cellBasisHashes = Object.fromEntries((project.scenes ?? []).map(scene => [scene.id, sha256(canonical(project.cells.filter(cell => cell.sceneId === scene.id)))]));
    return project;
  }
  cellReferences(data) { return [...new Set([...(data.cellOverrides ?? []).map(c => c.cellId), ...(data.segments ?? []).flatMap(s => s.cellIds), ...(data.cellIds ?? [])])].sort(); }
  recordReview(record, project) {
    const basis = this.db.prepare('SELECT cell_id,cell_sha256 FROM record_cell_bases WHERE record_id=? AND record_version=?').all(record.id, record.version);
    const ids = [...new Set([...this.cellReferences(record.data), ...basis.map(b => b.cell_id), ...(project.cells ?? []).filter(c => c.sceneId === record.data.sceneId).map(c => c.id)])].sort();
    const missing = ids.filter(id => !basis.some(b => b.cell_id === id));
    const changed = ids.filter(id => {
      const cell = (project.cells ?? []).find(c => c.id === id); const prior = basis.find(b => b.cell_id === id);
      return !cell || !prior || sha256(canonical(cell)) !== prior.cell_sha256;
    });
    return { status: changed.length ? 'NEEDS_REVIEW' : 'CURRENT_CELL_BASIS', changedCellIds: changed,
      reason: missing.length ? 'BASIS_UNRECORDED' : changed.length ? 'STORYBOARD_CELLS_CHANGED' : 'EXACT_SAVED_CELL_BASIS' };
  }
  list(kind) {
    const records = this.rawList(kind);
    if (!records.some(r => ['scene-plan', 'shot-keyframes'].includes(r.kind))) return records;
    const project = this.resolvedProject();
    return records.map(record => {
      if (record.kind === 'scene-plan') return { ...record, reviewState: this.recordReview(record, project) };
      if (record.kind === 'shot-keyframes') {
        const currentness = keyframePlanCurrentness(record.data, project);
        return { ...record, reviewState: { ...currentness, status: currentness.status === 'CURRENT' ? 'CURRENT_CELL_BASIS' : 'NEEDS_REVIEW' } };
      }
      return record;
    });
  }
  row(row, replayed = false) { return { id: row.id, kind: row.kind, version: row.version, sha256: row.sha256, data: JSON.parse(row.data), replayed }; }
  putBlob(filename, mimeType = 'application/octet-stream', expected) {
    check(typeof mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(mimeType), 'INVALID_BLOB_MIME');
    const stat = fs.statSync(filename); check(stat.isFile() && stat.size <= 10 * 1024 ** 3, 'INVALID_BLOB_FILE');
    if (expected) check(SHA.test(expected.sha256) && Number.isSafeInteger(expected.byteLength) && stat.size === expected.byteLength && stat.size <= expected.maxBytes, 'EXPECTED_BLOB_MISMATCH', 409);
    const temp = path.join(this.directory, 'blobs', `import-${crypto.randomUUID()}.tmp`);
    try {
      fs.copyFileSync(filename, temp, fs.constants.COPYFILE_EXCL); fs.chmodSync(temp, 0o600);
      const bytes = fs.statSync(temp).size; const hash = hashFile(temp);
      check(bytes === stat.size, 'BLOB_CHANGED_DURING_IMPORT');
      if (expected) check(bytes === expected.byteLength && bytes <= expected.maxBytes && hash === expected.sha256, 'EXPECTED_BLOB_MISMATCH', 409);
      const fd = fs.openSync(temp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, path.join(this.directory, 'blobs', hash));
      this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(hash, bytes, mimeType);
      return { sha256: hash, bytes, mimeType, authority: 'UNVERIFIED_MEDIA_BLOB', qc: 'NOT_PERFORMED' };
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  replayMediaRequest(requestId, requestHash) {
    const prior = this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    if (!prior) return null;
    check(prior.request_sha256 === requestHash, 'REQUEST_ID_CONFLICT', 409);
    return { ...JSON.parse(prior.result), replayed: true };
  }
  // This method is used by the two authenticated service routes. Ordinary
  // record writes and seed imports cannot claim measurement or owner review.
  saveUsageObservation(id, input, blobs) {
    check(input?.kind === 'usage-observation', 'USAGE_TRUSTED_IMPORT_REQUIRED', 409);
    return this.save(id, input, USAGE_SERVICE, { blobs });
  }
  saveMediaRecord(id, input, requestHash, blobs = []) {
    check(MEDIA_RECORD_KINDS.includes(input?.kind) && SHA.test(requestHash), 'INVALID_MEDIA_SERVICE_WRITE');
    return this.save(id, input, MEDIA_SERVICE, { requestHash, blobs });
  }
  saveModelAssistanceRecord(id, input) {
    check(input?.kind === 'model-assistance', 'MODEL_SERVICE_KIND_REQUIRED');
    return this.save(id, input, MODEL_SERVICE);
  }
  saveStudioGenerationRecord(id, input) {
    check(input?.kind === 'studio-generation', 'STUDIO_GENERATION_SERVICE_KIND_REQUIRED', 409);
    return this.save(id, input, STUDIO_GENERATION_SERVICE);
  }
  validateWritingProductionRecord(record) {
    validateWritingProductionRecord(record, this.baseProject(), ref => this.history(ref.id).find(row => row.version === ref.version && row.sha256 === ref.sha256), sha256);
  }
  validateProductionAttachmentRecord(record) {
    if (record.kind !== PRODUCTION_ATTACHMENT_KIND && !record.id.startsWith(`${PRODUCTION_ATTACHMENT_KIND}:`)) return;
    const attachment = this.productionAttachment();
    check(attachment && canonical(attachment) === canonical({ ...record, replayed: false }), 'PRODUCTION_ATTACHMENT_RECORD_INVALID', 409);
  }
  commitWritingProduction(operation, input, build) {
    validateWritingProductionRequest(operation, input);
    check(operation !== 'preview', 'WRITING_PRODUCTION_WRITE_REQUIRED');
    const requestId = `writing-production:${sha256(input.requestId)}`;
    const requestHash = sha256(canonical({ operation, input }));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if (prior) {
        check(prior.request_sha256 === requestHash, 'REQUEST_ID_CONFLICT', 409);
        const result = JSON.parse(prior.result); this.validateSavedRecord(result);
        this.db.exec('COMMIT'); return { ...result, replayed: true };
      }
      const write = build();
      const result = write.existing ?? this.save(write.id, { kind: WRITING_PRODUCTION_KIND, data: write.data, expectedVersion: write.expectedVersion, requestId: `writing-production-write:${sha256(canonical({ operation, input }))}` }, WRITING_PRODUCTION_SERVICE, { transaction: WRITING_PRODUCTION_SERVICE });
      this.validateSavedRecord(result);
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId, requestHash, canonical(result));
      this.db.exec('COMMIT'); return result;
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  saveStudioReferenceRecord(id, input) {
    check(input?.kind === 'studio-reference', 'STUDIO_REFERENCE_SERVICE_KIND_REQUIRED', 409);
    return this.save(id, input, STUDIO_REFERENCE_SERVICE);
  }
  saveTokenPreparation(id, input) {
    check(input?.kind === 'asset-token-preparation', 'TOKEN_PREPARATION_SERVICE_KIND_REQUIRED', 409);
    return this.save(id, input, TOKEN_PREPARATION_SERVICE);
  }
  saveComicPackageRecord(id, input) {
    check(input?.kind === 'comic-package', 'COMIC_PACKAGE_SERVICE_KIND_REQUIRED', 409);
    return this.save(id, input, COMIC_PACKAGE_SERVICE);
  }
  saveProjectAssetRecord(id, input) {
    check(input?.kind === 'project-asset', 'INVALID_PROJECT_ASSET_SERVICE_WRITE');
    return this.save(id, input, PROJECT_ASSET_SERVICE);
  }
  saveDccReturnStoryboardCell(id, input) {
    check(input?.kind === 'storyboard-cell' && input.data?.originDccReturnRef, 'DCC_RETURN_SERVICE_KIND_REQUIRED', 409);
    return this.save(id, input, DCC_RETURN_SERVICE);
  }
  replayStoryboardFrameExtraction(input) {
    validateFrameExtractionRequest(input);
    const prior = this.db.prepare('SELECT * FROM requests WHERE id=?').get(`frame-extract:${sha256(input.requestId)}`);
    if (!prior) return null;
    check(prior.request_sha256 === sha256(canonical({ operation: 'LOCAL_FRAME_EXTRACTION', input })), 'REQUEST_ID_CONFLICT', 409);
    const result = JSON.parse(prior.result);
    check(result.schemaVersion === 1 && result.cellRecord?.kind === 'storyboard-cell' && result.assetRecord?.kind === 'project-asset' && result.provenanceRecord?.kind === 'storyboard-frame-extraction', 'FRAME_REPLAY_INVALID', 409);
    for (const record of [result.cellRecord, result.assetRecord, result.provenanceRecord]) this.validateSavedRecord(record);
    return { ...result, replayed: true };
  }
  commitStoryboardFrameExtraction(input, build) {
    validateFrameExtractionRequest(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.replayStoryboardFrameExtraction(input);
      if (replay) { this.db.exec('COMMIT'); return replay; }
      const { image, bytes, asset, provenance, cellData } = build();
      check(Buffer.isBuffer(bytes) && sha256(bytes) === image.sha256 && bytes.length === image.byteLength && image.mimeType === 'image/png', 'FRAME_OUTPUT_INVALID', 422);
      const blobFile = path.join(this.directory, 'blobs', image.sha256), existingBlob = this.db.prepare('SELECT * FROM blobs WHERE sha256=?').get(image.sha256);
      check(!existingBlob || existingBlob.byte_length === image.byteLength && existingBlob.mime_type === image.mimeType, 'FRAME_BLOB_METADATA_CONFLICT', 409);
      if (fs.existsSync(blobFile)) check(!fs.lstatSync(blobFile).isSymbolicLink() && hashFile(blobFile) === image.sha256, 'FRAME_BLOB_CONFLICT', 409);
      else atomicPrivateFile(blobFile, bytes);
      // An interrupted transaction may retain an unreferenced content blob, but
      // never adopts a cell without its asset, provenance and replay receipt.
      this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(image.sha256, image.byteLength, image.mimeType);
      const write = (id, kind, data, expectedVersion, service) => this.save(id, { kind, data, expectedVersion, requestId: `frame-write:${sha256(canonical({ input, id }))}` }, service, { transaction: FRAME_EXTRACTION_SERVICE });
      const assetId = `project-asset:${image.sha256}`, existing = this.rawList('project-asset').find(row => row.id === assetId);
      if (existing) this.validateSavedRecord(existing);
      const assetRecord = existing ?? write(assetId, 'project-asset', asset, null, PROJECT_ASSET_SERVICE);
      const provenanceRecord = write(`storyboard-frame-extraction:${sha256(canonical(provenance))}`, 'storyboard-frame-extraction', provenance, null, FRAME_EXTRACTION_SERVICE);
      const cellRecord = write(`storyboard-cell:${input.cellId}`, 'storyboard-cell', cellData, input.expectedRecordRef?.version ?? null);
      const result = { schemaVersion: 1, cellRecord, assetRecord, provenanceRecord, image, replayed: false };
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(`frame-extract:${sha256(input.requestId)}`, sha256(canonical({ operation: 'LOCAL_FRAME_EXTRACTION', input })), canonical(result));
      this.db.exec('COMMIT'); return result;
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  saveProductionBudget(id, input) {
    check(input?.kind === 'production-budget', 'BUDGET_TRUSTED_SAVE_REQUIRED', 409);
    return this.save(id, input, BUDGET_SERVICE);
  }
  savePhoneHandoff(id, input, requestHash, verify) {
    check(['shot-direction', 'project-direction'].includes(input?.kind) && input?.requestId?.startsWith('phone-apply:') && SHA.test(requestHash) && typeof verify === 'function', 'PHONE_HANDOFF_WRITE_INVALID', 422);
    return this.save(id, input, PHONE_HANDOFF_SERVICE, { requestHash, verify });
  }
  save(id, input, service, options) {
    check(input && Object.keys(input).sort().join(',') === 'data,expectedVersion,kind,requestId', 'INVALID_RECORD_REQUEST');
    check(input.kind !== PRODUCTION_ATTACHMENT_KIND && !id?.startsWith(`${PRODUCTION_ATTACHMENT_KIND}:`) && !input.requestId?.startsWith('production-attachment:'), 'PRODUCTION_ATTACHMENT_TRUSTED_SERVICE_REQUIRED', 409);
    const { kind, requestId, expectedVersion } = input;
    check(!requestId?.startsWith('phone-apply:') || service === PHONE_HANDOFF_SERVICE, 'PHONE_HANDOFF_TRUSTED_SAVE_REQUIRED', 409);
    check((kind !== WRITING_PRODUCTION_KIND && !id?.startsWith(`${WRITING_PRODUCTION_KIND}:`) && !requestId?.startsWith('writing-production')) || service === WRITING_PRODUCTION_SERVICE, 'WRITING_PRODUCTION_TRUSTED_SERVICE_REQUIRED', 409);
    check((kind !== 'production-budget' && !id?.startsWith('production-budget:')) || service === BUDGET_SERVICE, 'BUDGET_TRUSTED_SAVE_REQUIRED', 409);
    validateBudgetIdentity(id, kind, input.data);
    check((kind !== 'storyboard-frame-extraction' && !id?.startsWith('storyboard-frame-extraction:')) || service === FRAME_EXTRACTION_SERVICE, 'FRAME_REQUIRES_TRUSTED_EXTRACTION', 409);
    check(!requestId?.startsWith('frame-extract:'), 'FRAME_REQUEST_NAMESPACE_RESERVED', 409);
    check((kind !== 'studio-generation' && !id?.startsWith('studio-generation:')) || service === STUDIO_GENERATION_SERVICE, 'STUDIO_GENERATION_REQUIRES_TRUSTED_SERVICE', 409);
    check((kind !== 'studio-reference' && !id?.startsWith('studio-reference:')) || service === STUDIO_REFERENCE_SERVICE, 'STUDIO_REFERENCE_REQUIRES_TRUSTED_SERVICE', 409);
    check((kind !== 'asset-token-preparation' && !id?.startsWith('asset-token:') && !requestId?.startsWith('asset-token:')) || service === TOKEN_PREPARATION_SERVICE, 'TOKEN_PREPARATION_REQUIRES_TRUSTED_SERVICE', 409);
    check((kind !== 'comic-package' && !id?.startsWith('comic-package:')) || service === COMIC_PACKAGE_SERVICE, 'COMIC_PACKAGE_REQUIRES_TRUSTED_SERVICE', 409);
    check((kind !== 'usage-observation' && !id?.startsWith('usage-observation:')) || service === USAGE_SERVICE, 'USAGE_TRUSTED_IMPORT_REQUIRED', 409);
    check((kind !== 'model-assistance' && !id?.startsWith('model-assistance:')) || service === MODEL_SERVICE, 'MODEL_REQUIRES_TRUSTED_SERVICE', 409);
    check(!MEDIA_RECORD_KINDS.includes(kind) || service === MEDIA_SERVICE, 'MEDIA_REQUIRES_TRUSTED_SERVICE', 409);
    check(kind !== 'project-asset' || service === PROJECT_ASSET_SERVICE, 'PROJECT_ASSET_REQUIRES_TRUSTED_IMPORT', 409);
    check(ID.test(id) && ID.test(kind) && ID.test(requestId), 'INVALID_RECORD_ID');
    if (kind === 'generation-brief') check(id.startsWith('generation-brief:') && id.length > 'generation-brief:'.length, 'RECORD_IDENTITY_MISMATCH');
    validateMovieSequenceIdentity(id,kind);
    validateStudioOperationIdentity(id,kind);
    validateStudioMediaIdentity(id,kind,input.data);
    validateStudioGenerationIdentity(id, kind);
    validateStudioReferenceIdentity(id, kind);
    validateAssetMarketProfileIdentity(id, kind, input.data);
    validateParticipationIdentity(id, kind, input.data);
    validateTokenPreparationIdentity(id, kind, input.data);
    validateComicPackageIdentity(id, kind, input.data);
    validateStoryboardPlanningIdentity(id, kind, input.data);
    validateShotDirectionIdentity(id, kind, input.data);
    validateUsageIdentity(id, kind, input.data);
    authoringIdentity(id,kind);
    if(kind==='context-bundle')validateContextBundleId(id);
    check(expectedVersion === null || (Number.isInteger(expectedVersion) && expectedVersion >= 1 && expectedVersion < 2147483647), 'INVALID_EXPECTED_VERSION');
    const dataText = canonical(input.data);
    check(Buffer.byteLength(dataText) <= 2 * 1024 * 1024, 'RECORD_TOO_LARGE', 413);
    const snapshot = JSON.parse(dataText);
    const identityField = { 'node-workflow':'sceneId', 'scene-plan': 'sceneId', 'production-handoff':'sceneId', 'storyboard-cell': 'cellId', 'casting-draft': 'characterId', 'coverage-draft': 'paragraphId', 'review-observation': 'commentId', 'review-resolution': 'commentId' }[kind];
    if (identityField) check(id === `${kind}:${snapshot[identityField]}`, 'RECORD_IDENTITY_MISMATCH');
    const requestHash = [MEDIA_SERVICE, PHONE_HANDOFF_SERVICE].includes(service) ? options.requestHash : sha256(canonical({ id, kind, requestId, expectedVersion, data: JSON.parse(dataText) }));
    const ownsTransaction = ![FRAME_EXTRACTION_SERVICE, WRITING_PRODUCTION_SERVICE, PRODUCTION_ATTACHMENT_SERVICE].includes(options?.transaction);
    if (ownsTransaction) this.db.exec('BEGIN IMMEDIATE');
    else check(this.db.isTransaction, 'FRAME_TRANSACTION_REQUIRED', 409);
    try {
      const prior = this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if (prior) {
        check(prior.request_sha256 === requestHash, 'REQUEST_ID_CONFLICT', 409);
        if (ownsTransaction) this.db.exec('COMMIT');
        return { ...JSON.parse(prior.result), replayed: true };
      }
      if (service === PHONE_HANDOFF_SERVICE) options.verify();
      for (const blob of options?.blobs ?? []) {
        check(SHA.test(blob.sha256) && Number.isSafeInteger(blob.byteLength) && blob.byteLength > 0 && typeof blob.mimeType === 'string', 'INVALID_MEDIA_SERVICE_BLOB');
        const filename = path.join(this.directory, 'blobs', blob.sha256);
        check(fs.lstatSync(filename).isFile() && fs.statSync(filename).size === blob.byteLength, 'MEDIA_SERVICE_BLOB_MISSING');
        this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(blob.sha256, blob.byteLength, blob.mimeType);
      }
      const project = this.recordProject(kind, snapshot, this.resolvedProject());
      check(project, 'PROJECT_NOT_SEEDED', 409);
      this.validateCreativeRecord(kind, snapshot, project);
      if (kind === 'scene-plan' && ((project.cellRevisionSceneIds ?? []).includes(snapshot.sceneId) || Object.hasOwn(snapshot, 'cellBasisHash'))) {
        check(snapshot.cellBasisHash === project.cellBasisHashes?.[snapshot.sceneId] && SHA.test(snapshot.cellBasisHash), 'STORYBOARD_CELL_BASIS_CONFLICT', 409);
      }
      // Exact retries are resolved first; a new write must use the current scene
      // cell basis, resolved inside the same transaction as its CAS and append.
      this.validateRecord(kind, snapshot, project);
      this.validateWritingProductionRecord({ id, kind, data: snapshot });
      if (kind === 'project-direction' || id.startsWith('project-direction:')) { check(kind === 'project-direction', 'PROJECT_DIRECTION_IDENTITY_INVALID'); validateProjectDirectionId(id, project); }
      if (kind === 'coverage-draft') validateCoverageDraft(snapshot, project, { newWrite: true });
      this.validateAuthoringReferences(kind,snapshot);
      this.validateMovieSequenceReferences(kind,snapshot,undefined,{newWrite:true});
      this.validateStudioOperationReferences(kind,snapshot);
      if (kind === 'studio-media') validateStudioMediaReferences(snapshot, hash => this.blobInfo(hash));
      validateLoreReferences(this,kind,snapshot);
      validateContextRecordReferences(this,kind,snapshot);
      if(kind==='lore-source')verifyStoredLore(this,{id,kind,version:1,sha256:sha256(dataText),data:snapshot});
      validateCameraRecordReferences(this,kind,snapshot,{newWrite:true});
      validateMediaRecordReferences(this,kind,snapshot,{id,current:kind==='measured-media-take'});
      validateNodeWorkflowReferences(this,kind,snapshot);
      if (kind === 'project-asset') verifyProjectAssetRecord(this, { id, kind, version: 1, sha256: sha256(dataText), data: snapshot });
      validateAssetCurationReferences(this, kind, snapshot, { id });
      if(kind==='production-handoff')check(readAuthoringLineage(this,snapshot.authoringRef,project.sourceHash).status==='CURRENT','HANDOFF_AUTHORING_INPUTS_NOT_CURRENT',409);
      const current = this.db.prepare('SELECT * FROM records WHERE id=? ORDER BY version DESC LIMIT 1').get(id);
      if (kind === 'production-budget') budgetTransition(current ? this.row(current).data : null, snapshot);
      if (kind === 'universe-rehearsal') check((current?.version ?? null) === expectedVersion, 'VERSION_CONFLICT', 409);
      validateUniverseRecordReferences(this, kind, snapshot, { id, version: (current?.version ?? 0) + 1, previous: current ? this.row(current) : null, newWrite: true });
      if (kind === 'storyboard-frame-extraction') {
        check(!current, 'FRAME_PROVENANCE_IMMUTABLE', 409);
        validateFrameExtractionReferences(this, { id, kind, version: 1, sha256: sha256(dataText), data: snapshot });
      }
      if (kind === 'comic-package') this.validateComicPackageReferences(snapshot);
      if (kind === 'asset-market-profile') {
        validateAssetMarketProfileIdentity(id, kind, snapshot, current ? this.row(current).data : null);
        validateAssetMarketProfileReferences(snapshot, hash => this.blobInfo(hash));
      }
      if (kind === 'asset-token-preparation') {
        check(!current, 'TOKEN_PREPARATION_IMMUTABLE', 409);
        validateStoredTokenPreparation(this, { id, kind, version: 1, sha256: sha256(dataText), data: snapshot }, { requireCurrent: true });
      }
      if (kind === 'project-participation') {
        validateParticipationIdentity(id, kind, snapshot, current ? this.row(current).data : null);
        this.validateParticipationReferences(snapshot, true);
      }
      if (kind === 'studio-reference') {
        validateStudioReferenceTransition(current ? this.row(current).data : null, snapshot);
        this.validateStudioReferenceReferences(snapshot);
      }
      if (kind === 'studio-generation') {
        validateStudioGenerationTransition(current ? this.row(current).data : null, snapshot);
        this.validateStudioGenerationReferences(snapshot);
      }
      if (kind === 'storyboard-cell') {
        const previous = current ? this.row(current) : null;
        check(!snapshot.originDccReturnRef || previous?.data.originDccReturnRef || service === DCC_RETURN_SERVICE, 'DCC_RETURN_REQUIRES_TRUSTED_ADOPTION', 409);
        validateDccReturnCellReferences(this, kind, snapshot, { newWrite: true, previous });
      }
      if (kind === 'usage-observation') {
        check(!current, 'USAGE_OBSERVATION_IMMUTABLE', 409);
        validateUsageRecordReferences(this, { id, kind, version: 1, sha256: sha256(dataText), data: snapshot }, { compare: true });
      }
      check(kind !== 'lore-source' || !current, 'LORE_SOURCE_IMMUTABLE', 409);
      check(kind !== 'camera-observation' || !current, 'CAMERA_OBSERVATION_IMMUTABLE', 409);
      check(kind !== 'measured-media-take' || !current, 'MEASURED_MEDIA_IMMUTABLE', 409);
      check(kind !== 'project-asset' || !current, 'PROJECT_ASSET_IMMUTABLE', 409);
      check(kind !== 'studio-media' || !current, 'STUDIO_MEDIA_IMMUTABLE', 409);
      check(kind !== 'comic-package' || !current, 'COMIC_PACKAGE_IMMUTABLE', 409);
      if(kind==='camera-observation')check(id===`camera-observation:${sha256(dataText)}`,'RECORD_IDENTITY_MISMATCH');
      check(kind !== 'review-observation' || !current, 'REVIEW_OBSERVATION_IMMUTABLE', 409);
      check(kind !== 'writing-session' || !current, 'WRITING_SESSION_IMMUTABLE', 409);
      check((current?.version ?? null) === expectedVersion, 'VERSION_CONFLICT', 409);
      check(!current || current.kind === kind, 'RECORD_KIND_CONFLICT', 409);
      if (kind === 'screenplay-draft') validateWritingSceneTransition(snapshot, current ? this.row(current) : null);
      validateModelAssistanceRecordReferences(this, kind, snapshot, { id, version: (current?.version ?? 0) + 1, previous: current ? this.row(current) : undefined });
      if (kind === 'storyboard-cell' && snapshot.imageHash !== null) {
        const blob = this.blobInfo(snapshot.imageHash);
        check(/^image\/(png|jpeg|webp|gif)$/.test(blob.mimeType), 'STORYBOARD_IMAGE_BLOB_REQUIRED');
      }
      const result = { id, kind, version: (current?.version ?? 0) + 1, sha256: sha256(dataText), data: JSON.parse(dataText), replayed: false };
      this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(id, kind, result.version, result.sha256, dataText);
      if (kind === 'scene-plan' || kind === 'generation-brief') {
        const dependentIds = [...new Set([...this.cellReferences(result.data), ...(project.cells ?? []).filter(c => c.sceneId === result.data.sceneId).map(c => c.id)])];
        for (const cellId of dependentIds) {
          const cell = project.cells.find(c => c.id === cellId); check(cell, 'SCENE_PLAN_CELL_MISSING');
          this.db.prepare('INSERT INTO record_cell_bases VALUES(?,?,?,?)').run(id, result.version, cellId, sha256(canonical(cell)));
        }
      }
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId, requestHash, canonical(result));
      if (ownsTransaction) this.db.exec('COMMIT');
      return result;
    } catch (error) { if (ownsTransaction && this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  validateAuthoringReferences(kind,data,seedRecords,seedBlobs) {
    if(!authoringKind(kind))return;
    if (kind === 'pitch-draft') for (const slide of data.presentation?.slides ?? []) {
      if (!slide.imageHash) continue;
      const blob = seedBlobs ? seedBlobs.find(item => item.sha256 === slide.imageHash) : this.blobInfo(slide.imageHash);
      check(blob && ['image/png', 'image/jpeg'].includes(blob.mimeType), 'PITCH_IMAGE_BLOB_REQUIRED', 409);
    }
    const refs=[...(data.inputRefs??[]),...(kind==='writing-session'?[{id:data.draftId,sha256:data.draftSha256}]:[])];
    let bibleRefs=0;
    for(const ref of refs) {
      const target=seedRecords
        ? seedRecords.find(record=>record.id===ref.id&&sha256(canonical(record.data))===ref.sha256)
        : (()=>{const row=this.db.prepare('SELECT * FROM records WHERE id=? AND sha256=? ORDER BY version DESC LIMIT 1').get(ref.id,ref.sha256);return row?this.row(row):null;})();
      const bible=target&&BIBLE_AUTHORING_INPUT_KINDS.includes(target.kind);
      const matchesScope=bible ? bibleAuthoringScopeMatches(this.project(),target,data.sourceHash)&&(data.sourceHash!==null||target.data.projectId===data.projectId) : target?.data.sourceHash===data.sourceHash&&(data.sourceHash!==null||target?.data.projectId===data.projectId);
      check(target&&(authoringKind(target.kind)&&target.kind!=='writing-session'||bible&&kind==='writing-note')&&matchesScope&&sha256(canonical(target.data))===ref.sha256,'AUTHORING_INPUT_REFERENCE_MISSING_OR_CHANGED',409);
      if(bible){check(++bibleRefs<=BIBLE_AUTHORING_INPUT_LIMIT,'AUTHORING_BIBLE_REFERENCE_LIMIT',409);validateBibleAuthoringRecord(this,target,data.sourceHash,{seedRecords});}
      if(kind==='writing-session')check(target.kind==='screenplay-draft','WRITING_SESSION_REQUIRES_SCREENPLAY_DRAFT',409);
    }
  }
  validateMovieSequenceReferences(kind,data,seedRecords,{newWrite=false}={}) {
    if(kind !== 'movie-sequence')return;
    validateMovieSequenceReferences(data, ref => seedRecords
      ? seedRecords.map(record=>({...record,sha256:sha256(canonical(record.data))})).find(record=>record.id===ref.id&&record.sha256===ref.sha256)
      : this.history(ref.id).find(record=>record.sha256===ref.sha256),
      newWrite ? {resolveCurrent:id=>this.history(id).at(-1)} : {});
    const verifiedTakes = new Set();
    if (!seedRecords) for (const clip of data.clips) if (clip.editSelection && !verifiedTakes.has(clip.editSelection.takeRef.sha256)) {
      const take = this.history(clip.editSelection.takeRef.id).find(record=>record.sha256===clip.editSelection.takeRef.sha256);
      validateMediaRecordReferences(this, take.kind, take.data, {id:take.id,version:take.version,verifyMediaBytes:true});
      verifiedTakes.add(take.sha256);
    }
  }
  validateStudioOperationReferences(kind,data,seedRecords,seedBlobs) {
    if(kind !== 'studio-operation') return;
    validateStudioOperationReferences(data, ref => seedRecords
      ? seedRecords.map(record=>({...record,version:1,sha256:sha256(canonical(record.data))})).find(record=>record.id===ref.id&&record.sha256===ref.sha256&&(ref.version===undefined||record.version===ref.version))
      : this.history(ref.id).find(record=>record.sha256===ref.sha256&&(ref.version===undefined||record.version===ref.version)),
    hash => seedBlobs ? seedBlobs.find(blob=>blob.sha256===hash) : this.blobInfo(hash));
  }
  validateStudioGenerationReferences(data) {
    validateStudioGenerationReferences(data, ref => this.history(ref.id).find(record => record.version === ref.version && record.sha256 === ref.sha256), hash => this.blobInfo(hash));
  }
  validateStudioReferenceReferences(data) {
    validateStudioReferenceReferences(data, ref => this.history(ref.id).find(record => record.version === ref.version && record.sha256 === ref.sha256), hash => this.blobInfo(hash));
  }
  validateComicPackageReferences(data) {
    validateComicPackageReferences(data, hash => this.blobInfo(hash), ref => this.history(ref.id).find(record => record.version === ref.version && record.sha256 === ref.sha256));
  }
  validateParticipationReferences(data, requireCurrent) {
    // History binds retained versions, while new writes must select current
    // versions. Advancing a screenplay never erases its earlier rights notes.
    try {
      validateParticipationReferences(data, {
        project: this.project(), requireCurrent,
        lookupRecord: (id, version) => {
          const row = version === undefined
            ? this.db.prepare('SELECT * FROM records WHERE id=? ORDER BY version DESC LIMIT 1').get(id)
            : this.db.prepare('SELECT * FROM records WHERE id=? AND version=?').get(id, version);
          if (!row) return null;
          const record = this.row(row);
          check(sha256(canonical(record.data)) === record.sha256, 'SAVED_RECORD_HASH_MISMATCH', 409);
          return record;
        },
        lookupBlob: hash => this.blobInfo(hash),
      });
    } catch (error) {
      if (error instanceof PilotError) throw error;
      throw new PilotError(error.code ?? 'PARTICIPATION_REFERENCE_INVALID', error.status ?? 422);
    }
  }
  validateSavedRecord(record) {
    if (record.kind === PRODUCTION_ATTACHMENT_KIND || record.id.startsWith(`${PRODUCTION_ATTACHMENT_KIND}:`)) return this.validateProductionAttachmentRecord(record);
    this.validateWritingProductionRecord(record);
    validateUsageIdentity(record.id, record.kind, record.data, record.version);
    validateUsageRecordReferences(this, record, { compare: true });
    check(sha256(canonical(record.data)) === record.sha256, 'SAVED_RECORD_HASH_MISMATCH');
    validateFrameExtractionReferences(this, record);
    validateMovieSequenceIdentity(record.id,record.kind);
    validateStudioOperationIdentity(record.id,record.kind);
    validateStudioMediaIdentity(record.id,record.kind,record.data);
    validateStudioGenerationIdentity(record.id, record.kind);
    validateStudioReferenceIdentity(record.id, record.kind);
    validateAssetMarketProfileIdentity(record.id, record.kind, record.data);
    validateParticipationIdentity(record.id, record.kind, record.data);
    validateTokenPreparationIdentity(record.id, record.kind, record.data, record.version);
    validateComicPackageIdentity(record.id, record.kind, record.data);
    validateStoryboardPlanningIdentity(record.id, record.kind, record.data);
    validateShotDirectionIdentity(record.id, record.kind, record.data);
    if (STORYBOARD_PLANNING_KINDS.includes(record.kind)) {
      this.history(record.id);
      return validateStoryboardPlanning(record.kind, record.data, this.project(), { references: false });
    }
    if (record.kind === 'comic-package') this.history(record.id);
    if (record.kind === 'asset-market-profile') this.history(record.id);
    if (record.kind === 'project-participation' || record.kind === 'asset-token-preparation') this.history(record.id);
    if (record.kind === 'studio-reference') this.history(record.id);
    if (record.kind === 'studio-generation') this.history(record.id);
    this.validateCreativeRecord(record.kind, record.data);
    if (record.kind === 'studio-media') {
      check(record.version === 1, 'STUDIO_MEDIA_IMMUTABLE', 409);
      validateStudioMediaReferences(record.data, hash => this.blobInfo(hash));
    }
    this.validateStudioOperationReferences(record.kind,record.data);
    if (record.kind === 'studio-operation') for (const historical of this.history(record.id)) this.validateStudioOperationReferences(historical.kind, historical.data);
    if(record.kind==='movie-sequence')for(const historical of this.history(record.id)) {
      check(sha256(canonical(historical.data))===historical.sha256,'SAVED_RECORD_HASH_MISMATCH');
      this.validateRecord(historical.kind,historical.data,this.resolvedProject());
      this.validateMovieSequenceReferences(historical.kind,historical.data);
    }
    authoringIdentity(record.id,record.kind);
    if (record.kind === 'project-direction' || record.id.startsWith('project-direction:')) { check(record.kind === 'project-direction', 'PROJECT_DIRECTION_IDENTITY_INVALID'); validateProjectDirectionId(record.id, this.resolvedProject()); }
    if(record.kind==='context-bundle')validateContextBundleId(record.id);
    validateContextRecordReferences(this,record.kind,record.data,{requireCurrent:false});
    this.validateAuthoringReferences(record.kind,record.data);
    validateLoreReferences(this,record.kind,record.data);
    if(record.kind==='lore-source')verifyStoredLore(this,record);
    validateCameraRecordReferences(this,record.kind,record.data);
    validateDccReturnCellReferences(this,record.kind,record.data);
    if (record.kind === 'storyboard-cell' && record.data.originDccReturnRef) this.history(record.id);
    validateMediaRecordReferences(this,record.kind,record.data,{id:record.id,version:record.version,verifyMediaBytes:true});
    if (record.kind === 'project-asset') verifyProjectAssetRecord(this, record);
    validateAssetCurationReferences(this, record.kind, record.data, { id: record.id });
    if (record.kind === 'universe-rehearsal') {
      const history = this.history(record.id);
      for (const [index, historical] of history.entries()) validateUniverseRecordReferences(this, historical.kind, historical.data, { id: historical.id, version: historical.version, previous: index ? history[index - 1] : null });
    } else validateUniverseRecordReferences(this, record.kind, record.data, { id: record.id });
    if (record.kind === 'universe-artwork' || record.kind === 'universe-profile' || record.kind === 'universe-production-plan' || record.kind === 'universe-continuity-plan') for (const historical of this.history(record.id)) validateUniverseRecordReferences(this, historical.kind, historical.data, { id: historical.id });
    if (record.kind === 'asset-curation') for (const historical of this.history(record.id)) validateAssetCurationReferences(this, historical.kind, historical.data, { id: historical.id });
    if (record.kind === 'node-workflow') {
      check(record.id === `node-workflow:${record.data.sceneId}`, 'RECORD_IDENTITY_MISMATCH', 409);
      validateNodeWorkflowReferences(this, record.kind, record.data, { requireCurrent: false });
      for (const historical of this.history(record.id)) validateNodeWorkflowReferences(this, historical.kind, historical.data, { requireCurrent: false });
    }
    if (record.kind === 'model-assistance') {
      const history = this.history(record.id);
      check(history.length <= 2, 'MODEL_RECORD_HISTORY_INVALID', 409);
      for (const historical of history) validateModelAssistanceRecordReferences(this, historical.kind, historical.data, { id: historical.id, version: historical.version, previous: historical.version === 2 ? history.find(row => row.version === 1) : undefined });
    }
    if (record.kind === 'take-review') {
      for (const historical of this.history(record.id)) validateMediaRecordReferences(this, historical.kind, historical.data, {id:historical.id});
    }
    if(record.kind==='production-handoff') {
      check(record.id==='production-handoff:'+record.data.sceneId,'RECORD_IDENTITY_MISMATCH');
      check(readAuthoringLineage(this,record.data.authoringRef,record.data.sourceHash).status!=='ABSENT','HANDOFF_AUTHORING_HISTORY_MISSING',409);
    }
    if (!['scene-plan','generation-brief'].includes(record.kind)) return this.validateRecord(record.kind, record.data, this.recordProject(record.kind, record.data, this.resolvedProject()));
    const project = this.project();
    const bases = this.db.prepare('SELECT cell_id,cell_sha256 FROM record_cell_bases WHERE record_id=? AND record_version=?').all(record.id, record.version);
    if (bases.length) {
      const possible = [...(project.cells ?? [])];
      for (const row of this.db.prepare("SELECT * FROM records WHERE kind='storyboard-cell'").all()) {
        const data = JSON.parse(row.data); const { cellId, sourceHash, ...value } = data;
        check(sha256(canonical(data)) === row.sha256, 'STORYBOARD_HISTORY_HASH_MISMATCH');
        possible.push({ id: cellId, ...value, review: 'PENDING', scope: 'INTERNAL_PREVISUALIZATION_ONLY', candidateRecordId: row.id, candidateVersion: row.version, candidateSha256: row.sha256 });
      }
      const captured = bases.map(basis => {
        const cell = possible.find(c => c.id === basis.cell_id && sha256(canonical(c)) === basis.cell_sha256);
        check(cell, 'SAVED_CELL_BASIS_BODY_MISSING'); return cell;
      });
      project.cells = [...(project.cells ?? []).filter(c => c.sceneId !== record.data.sceneId), ...captured];
    }
    const shots = (project.scenes ?? []).flatMap(scene => scene.shots.map(shot => shot.id));
    const sceneCells = (project.cells ?? []).filter(c => c.sceneId === record.data.sceneId).sort((a,b) => shots.indexOf(a.shotId)-shots.indexOf(b.shotId) || ['START','MOMENT','END'].indexOf(a.role)-['START','MOMENT','END'].indexOf(b.role) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    project.cellBasisHashes = { [record.data.sceneId]: sha256(canonical(sceneCells)) };
    project.cellRevisionSceneIds = Object.hasOwn(record.data, 'cellBasisHash') ? [record.data.sceneId] : [];
    return this.validateRecord(record.kind, record.data, project);
  }
  importSeed(seedFile) {
    const raw = fs.readFileSync(seedFile);
    check(raw.length <= 10 * 1024 * 1024, 'SEED_TOO_LARGE');
    const seed = JSON.parse(raw.toString('utf8'));
    check(seed && seed.project && Array.isArray(seed.records) && Array.isArray(seed.blobs), 'INVALID_SEED');
    check(!(seed.project.cells??[]).some(cell=>cell.originCameraRef),'CAMERA_PROOFS_REQUIRE_VERIFIED_IMPORT');
    check(!(seed.project.cells??[]).some(cell=>cell.originDccReturnRef),'DCC_RETURNS_REQUIRE_VERIFIED_ADOPTION');
    const seedHash = sha256(canonical(seed));
    const prior = this.db.prepare("SELECT value FROM metadata WHERE key='seed_sha256'").get();
    if (prior) { check(prior.value === seedHash, 'SEED_ALREADY_INITIALIZED_DIFFERENTLY', 409); return { replayed: true, sha256: seedHash }; }
    check(!this.project() && this.list().length === 0, 'WORKSPACE_NOT_EMPTY', 409);
    const ids = new Set();
    for (const record of seed.records) {
      check(record && ID.test(record.id) && ID.test(record.kind) && !ids.has(record.id), 'INVALID_SEED_RECORD');
      check(record.kind !== PRODUCTION_ATTACHMENT_KIND && !record.id.startsWith(`${PRODUCTION_ATTACHMENT_KIND}:`), 'PRODUCTION_ATTACHMENT_TRUSTED_SERVICE_REQUIRED', 409);
      check(record.kind!=='context-bundle'&&!record.data?.contextBundleRef,'CONTEXT_REQUIRES_SAVED_WORKSPACE_REFERENCES');
      check(record.kind!=='lore-source'&&!record.data?.loreRefs?.length,'LORE_REQUIRES_TRUSTED_IMPORT');
      check(record.kind!=='camera-observation'&&!record.data?.originCameraRef,'CAMERA_PROOFS_REQUIRE_VERIFIED_IMPORT');
      check(!record.data?.originDccReturnRef,'DCC_RETURNS_REQUIRE_VERIFIED_ADOPTION');
      check(!MEDIA_RECORD_KINDS.includes(record.kind),'MEDIA_REQUIRES_TRUSTED_SERVICE');
      check(record.kind !== 'usage-observation' && !record.id.startsWith('usage-observation:'), 'USAGE_TRUSTED_IMPORT_REQUIRED', 409);
      check(record.kind !== WRITING_PRODUCTION_KIND && !record.id.startsWith(`${WRITING_PRODUCTION_KIND}:`), 'WRITING_PRODUCTION_TRUSTED_SERVICE_REQUIRED', 409);
      check(record.kind !== 'production-budget' && !record.id.startsWith('production-budget:'), 'BUDGET_TRUSTED_SAVE_REQUIRED', 409);
      check(record.kind !== 'model-assistance' && !record.id.startsWith('model-assistance:'), 'MODEL_REQUIRES_TRUSTED_SERVICE');
      check(record.kind !== 'universe-rehearsal' && !record.id.startsWith('universe-rehearsal:'), 'REHEARSAL_REQUIRES_SAVED_WORKSPACE_REFERENCES');
      check(record.kind !== 'universe-profile' && !record.id.startsWith('universe-profile:'), 'UNIVERSE_PROFILE_REQUIRES_SAVED_WORKSPACE_REFERENCES');
      check(record.kind !== 'universe-continuity-plan' && !record.id.startsWith('universe-continuity-plan:'), 'UNIVERSE_CONTINUITY_REQUIRES_SAVED_WORKSPACE_REFERENCES');
      check(record.kind !== 'universe-production-plan' && !record.id.startsWith('universe-production-plan:'), 'UNIVERSE_PRODUCTION_PLAN_REQUIRES_SAVED_WORKSPACE_REFERENCES');
      check(record.kind !== 'studio-generation' && !record.id.startsWith('studio-generation:'), 'STUDIO_GENERATION_REQUIRES_TRUSTED_SERVICE', 409);
      check(record.kind !== 'studio-reference' && !record.id.startsWith('studio-reference:'), 'STUDIO_REFERENCE_REQUIRES_TRUSTED_SERVICE', 409);
      check(record.kind !== 'node-workflow', 'NODE_GRAPH_REQUIRES_SAVED_WORKSPACE_REFERENCES');
      check(record.kind !== 'project-asset', 'PROJECT_ASSET_REQUIRES_TRUSTED_IMPORT');
      check(record.kind !== 'studio-media' && !record.id.startsWith('studio-media:'), 'STUDIO_MEDIA_REQUIRES_OWNED_IMPORT');
      check(record.kind !== 'asset-curation' && !record.id.startsWith('asset-curation:'), 'ASSET_CURATION_REQUIRES_SAVED_ASSET');
      check(record.kind !== 'asset-token-preparation' && !record.id.startsWith('asset-token:'), 'TOKEN_PREPARATION_REQUIRES_TRUSTED_SERVICE', 409);
      check(record.kind !== 'asset-market-profile' && !record.id.startsWith('asset-market:'), 'ASSET_MARKET_REQUIRES_OWNED_ASSET');
      check(record.kind !== 'comic-package' && !record.id.startsWith('comic-package:'), 'COMIC_PACKAGE_REQUIRES_TRUSTED_SERVICE', 409);
      check(record.kind !== 'storyboard-frame-extraction' && !record.id.startsWith('storyboard-frame-extraction:'), 'FRAME_REQUIRES_TRUSTED_EXTRACTION', 409);
      authoringIdentity(record.id,record.kind);
      validateMovieSequenceIdentity(record.id,record.kind);
      validateStudioOperationIdentity(record.id,record.kind);
      validateStoryboardPlanningIdentity(record.id, record.kind, record.data);
      validateShotDirectionIdentity(record.id, record.kind, record.data);
      if (record.kind === 'project-direction' || record.id.startsWith('project-direction:')) { check(record.kind === 'project-direction', 'PROJECT_DIRECTION_IDENTITY_INVALID'); validateProjectDirectionId(record.id, seed.project); }
      if(record.kind==='production-handoff')check(record.id==='production-handoff:'+record.data.sceneId,'RECORD_IDENTITY_MISMATCH');
      ids.add(record.id); this.validateRecord(record.kind, record.data, seed.project);
    }
    for(const record of seed.records) this.validateAuthoringReferences(record.kind,record.data,seed.records,seed.blobs);
    for(const record of seed.records) this.validateMovieSequenceReferences(record.kind,record.data,seed.records);
    for(const record of seed.records) this.validateStudioOperationReferences(record.kind,record.data,seed.records,seed.blobs);
    for(const record of seed.records.filter(record=>record.kind==='production-handoff'))check(readAuthoringLineage(this,record.data.authoringRef,seed.project.sourceHash,{seedRecords:seed.records}).status==='CURRENT','HANDOFF_AUTHORING_INPUTS_NOT_CURRENT',409);
    const root = fs.realpathSync(path.dirname(seedFile));
    const blobs = seed.blobs.map(blob => {
      check(SHA.test(blob.sha256) && typeof blob.path === 'string', 'INVALID_SEED_BLOB');
      const source = fs.realpathSync(path.resolve(root, blob.path));
      check(path.isAbsolute(blob.path) || source.startsWith(root + path.sep), 'SEED_BLOB_ESCAPES_ROOT');
      const bytes = fs.readFileSync(source);
      check(sha256(bytes) === blob.sha256, 'SEED_BLOB_HASH_MISMATCH');
      return { sha256: blob.sha256, bytes, mimeType: typeof blob.mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(blob.mimeType) ? blob.mimeType : 'application/octet-stream' };
    });
    check(typeof seed.project.id === 'string' && ID.test(seed.project.id), 'INVALID_PROJECT_ID');
    check(SHA.test(seed.project.sourceHash) && blobs.some(blob => blob.sha256 === seed.project.sourceHash), 'PROJECT_SOURCE_BLOB_MISSING');
    const seedCells = new Set((seed.project.cells ?? []).map(c => c.id));
    for (const record of seed.records.filter(r => r.kind === 'storyboard-cell')) {
      check(record.id === `storyboard-cell:${record.data.cellId}`, 'RECORD_IDENTITY_MISMATCH'); seedCells.add(record.data.cellId);
      if (record.data.imageHash !== null) check(blobs.some(b => b.sha256 === record.data.imageHash && /^image\/(png|jpeg|webp|gif)$/.test(b.mimeType)), 'STORYBOARD_IMAGE_BLOB_REQUIRED');
    }
    check(seedCells.size <= 400, 'STORYBOARD_CELL_LIMIT_EXCEEDED');
    for (const blob of blobs) atomicPrivateFile(path.join(this.directory, 'blobs', blob.sha256), blob.bytes);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('project', canonical(seed.project));
      this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('seed_sha256', seedHash);
      for (const record of seed.records) { const data = canonical(record.data); this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(record.id, record.kind, 1, sha256(data), data); }
      for (const blob of blobs) this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(blob.sha256, blob.bytes.length, blob.mimeType);
      this.db.exec('COMMIT');
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
    return { replayed: false, sha256: seedHash, records: seed.records.length, blobs: blobs.length };
  }
  blobInfo(hash) {
    check(SHA.test(hash), 'INVALID_BLOB_HASH');
    const row = this.db.prepare('SELECT * FROM blobs WHERE sha256=?').get(hash);
    check(row, 'BLOB_NOT_FOUND', 404);
    const filename = path.join(this.directory, 'blobs', hash);
    check(!fs.lstatSync(filename).isSymbolicLink(), 'BLOB_SYMLINK');
    check(fs.statSync(filename).size === row.byte_length && hashFile(filename) === hash, 'BLOB_CORRUPT', 500);
    return { filename, byteLength: row.byte_length, mimeType: row.mime_type };
  }
  blob(hash) {
    const info = this.blobInfo(hash);
    return { bytes: fs.readFileSync(info.filename), mimeType: info.mimeType };
  }
}
