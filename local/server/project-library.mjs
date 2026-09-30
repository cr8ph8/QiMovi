import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROJECT_ASSET_LIMITS, PROJECT_LIBRARY_SEARCH_LIMITS, validateProjectAsset, validateAssetCuration, validateProjectCollectionPath } from '../contracts/project-library.mjs';
import { canonical, check, sha256 } from './storage.mjs';
import { verifyStoredLore } from './lore.mjs';
import { parseMarketDetails } from '../contracts/asset-market-profile.mjs';
import { storyboardCellSignature } from '../contracts/storyboard-planning.mjs';
import { listProjectDccStageReturns } from './dcc-stage-returns.mjs';
import { isCreativeProject, validateCreativeProject, projectOwnedContext } from '../contracts/creative-project.mjs';

const recordId = hash => `project-asset:${hash}`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shape = (value, fields) => check(object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','), 'PROJECT_IMPORT_FIELDS_INVALID');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const verifiedBlobs = new WeakMap();
const verifiedLore = new WeakMap();
const officeZip = { '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet', '.odp': 'application/vnd.oasis.opendocument.presentation' };

function validateLibraryScope(project, { sourceHash, projectId }, code) {
  if (sourceHash === null) {
    project = projectOwnedContext(project, 'project-asset', { projectId, sourceHash });
    check(isCreativeProject(project), code, 409);
    validateCreativeProject(project);
    check(projectId === project.id, code, 409);
    return { projectId };
  }
  check(digest(sourceHash) && sourceHash === project?.sourceHash && (projectId === undefined || projectId === project.id), code, 409);
  return {};
}

// Container signatures and text encoding identify retained originals only.
// They do not validate an office document, decode footage, or execute an asset.
function identify(header, originalFilename) {
  const starts = value => header.subarray(0, value.length).equals(Buffer.from(value));
  const ext = path.extname(originalFilename).toLowerCase();
  const result = (family, mimeType, encodingCheck = false) => ({ family, mimeType, encodingCheck });
  if (starts('%PDF-')) return result('DOCUMENT', 'application/pdf');
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return result('IMAGE', 'image/png');
  if (starts([255, 216, 255])) return result('IMAGE', 'image/jpeg');
  if (starts('GIF87a') || starts('GIF89a')) return result('IMAGE', 'image/gif');
  if (starts('RIFF') && header.subarray(8, 12).toString() === 'WEBP') return result('IMAGE', 'image/webp');
  if (starts('RIFF') && header.subarray(8, 12).toString() === 'WAVE') return result('AUDIO', 'audio/wav');
  if (starts([73, 73, 42, 0]) || starts([77, 77, 0, 42])) return result('IMAGE', 'image/tiff');
  if (starts('8BPS')) return result('IMAGE', 'image/vnd.adobe.photoshop');
  if (starts('fLaC')) return result('AUDIO', 'audio/flac');
  if (starts('OggS')) return result('AUDIO', 'audio/ogg');
  if (starts('ID3') || header[0] === 255 && (header[1] & 224) === 224) return result('AUDIO', 'audio/mpeg');
  if (header.subarray(4, 8).toString() === 'ftyp') {
    const brand = header.subarray(8, 12).toString();
    return brand === 'qt  ' ? result('VIDEO', 'video/quicktime') : brand === 'M4A ' || brand === 'M4B ' ? result('AUDIO', 'audio/mp4') : result('VIDEO', 'video/mp4');
  }
  if (starts([26, 69, 223, 163])) return result('VIDEO', 'video/webm');
  if (starts('glTF')) return result('THREE_D', 'model/gltf-binary');
  if (starts('BLENDER')) return result('THREE_D', 'application/x-blender');
  if (starts('Kaydara FBX Binary  ')) return result('THREE_D', 'application/x-fbx');
  if (starts('PXR-USDC')) return result('THREE_D', 'model/vnd.usd');
  if (starts([80, 75, 3, 4]) || starts([80, 75, 5, 6]) || starts([80, 75, 7, 8])) return officeZip[ext] ? result('DOCUMENT', officeZip[ext]) : result('ARCHIVE', 'application/zip');
  if (starts([31, 139])) return result('ARCHIVE', 'application/gzip');
  if (starts([55, 122, 188, 175, 39, 28])) return result('ARCHIVE', 'application/x-7z-compressed');
  if (starts('Rar!')) return result('ARCHIVE', 'application/vnd.rar');
  if (header.subarray(257, 262).toString() === 'ustar') return result('ARCHIVE', 'application/x-tar');
  if (starts([208, 207, 17, 224, 161, 177, 26, 225])) {
    const mimeType = { '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint' }[ext];
    return mimeType ? result('DOCUMENT', mimeType) : result('OPAQUE', 'application/octet-stream');
  }
  if (header.subarray(0, 32).toString().trimStart().startsWith('{\\rtf')) return result('DOCUMENT', 'application/rtf');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(header, { stream: true });
    if (text.includes('\0') || /[\x01-\x08\x0b\x0e-\x1f]/.test(text)) return result('OPAQUE', 'application/octet-stream');
    if (/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/.test(text)) return result('IMAGE', 'image/svg+xml', true);
    if (/^\s*(?:<\?xml\b|<FinalDraft\b)/.test(text)) return result('TEXT', 'application/xml', true);
    if (ext === '.gltf' && /^\s*\{/.test(text)) return result('THREE_D', 'model/gltf+json', true);
    if (ext === '.obj' && /^\s*(?:#|v\s|o\s|mtllib\s)/.test(text)) return result('THREE_D', 'model/obj', true);
    if (/^\s*#usda\s/.test(text)) return result('THREE_D', 'model/vnd.usd', true);
    if (ext === '.fbx' && /^\s*;.*FBX/.test(text)) return result('THREE_D', 'application/x-fbx', true);
    if (ext === '.json' && /^\s*[\[{]/.test(text)) return result('TEXT', 'application/json', true);
    return result('TEXT', 'text/plain', true);
  } catch { return result('OPAQUE', 'application/octet-stream'); }
}

export function inspectProjectAssetFile(filename, originalFilename = path.basename(filename)) {
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= PROJECT_ASSET_LIMITS.bytes, 'PROJECT_ASSET_FILE_INVALID', 413);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
  let length = 0, identified, decoder;
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      const chunk = buffer.subarray(0, count); length += count;
      check(length <= PROJECT_ASSET_LIMITS.bytes, 'PROJECT_ASSET_FILE_TOO_LARGE', 413);
      if (!identified) { identified = identify(chunk, originalFilename); if (identified.encodingCheck) decoder = new TextDecoder('utf-8', { fatal: true }); }
      hash.update(chunk);
      if (decoder) {
        try {
          const text = decoder.decode(chunk, { stream: true });
          if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text)) throw new Error('Not plain text');
        } catch { identified = { family: 'OPAQUE', mimeType: 'application/octet-stream' }; decoder = null; }
      }
    }
    if (decoder) { try { decoder.decode(); } catch { identified = { family: 'OPAQUE', mimeType: 'application/octet-stream' }; } }
    const after = fs.fstatSync(fd);
    check(length === stat.size && after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ino === stat.ino, 'PROJECT_ASSET_CHANGED_DURING_INSPECTION', 409);
    return { sha256: hash.digest('hex'), byteLength: length, mimeType: identified.mimeType, family: identified.family };
  } finally { fs.closeSync(fd); }
}

export function verifyProjectAssetRecord(store, record) {
  validateProjectAsset(record.data, store.project());
  check(record.kind === 'project-asset' && record.id === recordId(record.data.asset.sha256) && record.version === 1 && sha256(canonical(record.data)) === record.sha256, 'PROJECT_ASSET_RECORD_INVALID', 409);
  const history = store.history(record.id);
  check(history.length <= 1 && (!history.length || history[0].sha256 === record.sha256), 'PROJECT_ASSET_HISTORY_INVALID', 409);
  const asset = record.data.asset, registered = store.db.prepare('SELECT * FROM blobs WHERE sha256=?').get(asset.sha256);
  check(registered && registered.byte_length === asset.byteLength && registered.mime_type === asset.mimeType, 'PROJECT_ASSET_BLOB_MISMATCH', 409);
  const filename = path.join(store.directory, 'blobs', asset.sha256);
  const fingerprint = () => {
    const stat = fs.lstatSync(filename, { bigint: true });
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size === BigInt(asset.byteLength), 'PROJECT_ASSET_BLOB_MISMATCH', 409);
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  };
  let before = fingerprint();
  const cache = verifiedBlobs.get(store) ?? new Map(), key = `${asset.sha256}:${record.data.originalFilename}`;
  let actual = cache.get(key)?.fingerprint === before ? cache.get(key).actual : null;
  if (!actual) {
    for (let attempt = 0; attempt < 2; attempt++) {
      actual = inspectProjectAssetFile(filename, record.data.originalFilename);
      check(actual.sha256 === asset.sha256 && actual.byteLength === asset.byteLength, 'PROJECT_ASSET_BLOB_CORRUPT', 409);
      const after = fingerprint();
      if (after === before) break;
      // Filesystem/cloud bookkeeping can update ctime just after a copy. A
      // correct hash may be checked once more; changing bytes never retry.
      check(attempt === 0, 'PROJECT_ASSET_CHANGED_DURING_VERIFICATION', 409);
      before = after;
    }
    if (cache.size >= PROJECT_ASSET_LIMITS.manifestEntries) cache.delete(cache.keys().next().value);
    cache.set(key, { fingerprint: before, actual }); verifiedBlobs.set(store, cache);
  }
  check(asset.mimeType === 'application/octet-stream' && record.data.family === 'OPAQUE' || actual.mimeType === asset.mimeType && actual.family === record.data.family, 'PROJECT_ASSET_SIGNATURE_MISMATCH', 409);
  return { record, blob: { filename, byteLength: asset.byteLength, mimeType: asset.mimeType } };
}

export function validateAssetCurationReferences(store, kind, data, { id } = {}) {
  if (kind !== 'asset-curation') {
    check(!id?.startsWith('asset-curation:'), 'ASSET_CURATION_IDENTITY_INVALID', 409);
    return;
  }
  validateAssetCuration(data, store.project());
  check(id === `asset-curation:${data.assetRef.id.slice('project-asset:'.length)}`, 'ASSET_CURATION_IDENTITY_INVALID', 409);
  const history = store.history(data.assetRef.id), target = history[0];
  check(history.length === 1 && target.kind === 'project-asset' && target.sha256 === data.assetRef.sha256 && target.data.sourceHash === data.sourceHash && (data.sourceHash !== null || target.data.projectId === data.projectId), 'ASSET_CURATION_REFERENCE_MISSING_OR_CHANGED', 409);
  verifyProjectAssetRecord(store, target);
}

function retainedLore(store) {
  const records = store.rawList('lore-source').sort((a, b) => a.id.localeCompare(b.id));
  const limits = PROJECT_LIBRARY_SEARCH_LIMITS;
  check(records.length <= limits.sources && records.reduce((sum, r) => sum + (r.data.extraction?.pageCount ?? 0), 0) <= limits.pages && records.reduce((sum, r) => sum + (r.data.extraction?.bytes ?? 0), 0) <= limits.extractionBytes && records.reduce((sum, r) => sum + (r.data.original?.bytes ?? 0), 0) <= limits.originalBytes, 'PROJECT_LIBRARY_EXTRACTION_LIMIT', 413);
  const cache = verifiedLore.get(store) ?? new Map();
  const entries = records.map(record => {
    const history = store.history(record.id);
    check(history.length === 1 && history[0].sha256 === record.sha256, 'LORE_RECORD_MISMATCH', 409);
    const artifacts = [record.data.original, record.data.intakeManifest, record.data.extraction].filter(Boolean);
    const fingerprint = () => artifacts.map(asset => {
      check(digest(asset.sha256), 'LORE_ARTIFACT_MISMATCH', 409);
      const registered = store.db.prepare('SELECT * FROM blobs WHERE sha256=?').get(asset.sha256);
      const stat = fs.lstatSync(path.join(store.directory, 'blobs', asset.sha256), { bigint: true });
      check(registered && registered.byte_length === asset.bytes && stat.isFile() && !stat.isSymbolicLink() && stat.size === BigInt(asset.bytes), 'LORE_ARTIFACT_MISMATCH', 409);
      return [asset.sha256, registered.mime_type, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    }).join('|');
    const before = fingerprint(), key = `${store.project().sourceHash}:${record.sha256}`;
    let cached = cache.get(key);
    if (!cached || cached.fingerprint !== before) {
      verifyStoredLore(store, record);
      const pages = record.data.extraction ? JSON.parse(store.blob(record.data.extraction.sha256).bytes.toString('utf8')) : [];
      check(fingerprint() === before, 'LORE_CHANGED_DURING_VERIFICATION', 409);
      cached = { fingerprint: before, pages };
      if (cache.size >= limits.sources) cache.delete(cache.keys().next().value);
      cache.set(key, cached);
    }
    return { record, pages: cached.pages };
  });
  verifiedLore.set(store, cache);
  return entries;
}

function matchingReferences(data, targetRefs) {
  const found = []; let count = 0;
  function visit(value, field, depth) {
    check(++count <= 30000 && depth <= 20, 'PROJECT_LIBRARY_REFERENCE_SCAN_LIMIT', 413);
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && typeof value.id === 'string' && targetRefs.get(value.id) === value.sha256) found.push(field);
    for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') visit(child, `${field}.${key}`, depth + 1);
  }
  visit(data, 'data', 0); return found;
}

function matchingBlobReferences(record, hash) {
  const data = record.data;
  // Only established typed media fields count. Matching arbitrary prose,
  // dependency hashes, or filenames never creates a use claim.
  if (record.kind === 'storyboard-cell' && data.imageHash === hash) return ['data.imageHash'];
  if (record.kind === 'pitch-draft') return (data.presentation?.slides ?? []).flatMap((slide, index) => slide.imageHash === hash ? [`data.presentation.slides.${index}.imageHash`] : []);
  if (record.kind === 'casting-draft') return (data.referenceHashes ?? []).flatMap((value, index) => value === hash ? [`data.referenceHashes.${index}`] : []);
  if (record.kind === 'measured-media-take' && data.blob?.sha256 === hash) return ['data.blob.sha256'];
  if (record.kind === 'asset-market-profile') {
    const details = parseMarketDetails(data), matches = data.assetHash === hash ? ['data.assetHash'] : [];
    for (const key of ['licenceEvidenceHashes', 'parentAssetHashes']) {
      (details[key] ?? []).forEach((value, index) => { if (value === hash) matches.push(`data.detailsJson.${key}.${index}`); });
    }
    return matches;
  }
  if (record.kind === 'asset-token-preparation' && data.assetHash === hash) return ['data.assetHash'];
  if (record.kind === 'project-participation') {
    const matches = [];
    for (const field of ['contributions', 'rights', 'pools']) (data[field] ?? []).forEach((item, index) => {
      const prefix = `data.${field}.${index}`;
      if (item.subject?.assetHash === hash) matches.push(`${prefix}.subject.assetHash`);
      (item.evidenceHashes ?? []).forEach((value, i) => { if (value === hash) matches.push(`${prefix}.evidenceHashes.${i}`); });
      (item.allocations ?? []).forEach((allocation, i) => (allocation.evidenceHashes ?? []).forEach((value, j) => {
        if (value === hash) matches.push(`${prefix}.allocations.${i}.evidenceHashes.${j}`);
      }));
    });
    return matches;
  }
  return [];
}

// Follow only typed storyboard references. Comics intentionally use the current
// frame; keyframe plans keep the exact image captured in their saved binding.
// Neither relationship is evidence of ownership or production approval.
function storyboardAssetUses(store, records, project) {
  const uses = new Map(), historicalCells = new Map(); let historyCount = 0;
  const frozen = store.project();
  function snapshots(cellId) {
    if (!historicalCells.has(cellId)) {
      const history = store.history(`storyboard-cell:${cellId}`);
      historyCount += history.length;
      check(historyCount <= 10000, 'PROJECT_LIBRARY_STORYBOARD_HISTORY_LIMIT', 413);
      historicalCells.set(cellId, [...(frozen.cells ?? []).filter(cell => cell.id === cellId), ...history.map(record => {
        const { cellId: id, sourceHash, ...value } = record.data;
        check(sourceHash === project.sourceHash && id === cellId, 'PROJECT_LIBRARY_STORYBOARD_SOURCE_MISMATCH', 409);
        return { id, ...value, review: 'PENDING', scope: 'INTERNAL_PREVISUALIZATION_ONLY', candidateRecordId: record.id, candidateVersion: record.version, candidateSha256: record.sha256 };
      })]);
    }
    return historicalCells.get(cellId);
  }
  function add(record, hash, field, sceneId) {
    if (!digest(hash)) return;
    const byRecord = uses.get(hash) ?? new Map();
    const entry = byRecord.get(record.id) ?? { paths: [], sceneIds: [] };
    entry.paths.push(field);
    if (!entry.sceneIds.includes(sceneId)) entry.sceneIds.push(sceneId);
    byRecord.set(record.id, entry); uses.set(hash, byRecord);
  }
  for (const record of records) {
    if (!['comic-draft', 'shot-keyframes'].includes(record.kind)) continue;
    const data = record.data;
    // A project ID is required even when another project has identical source.
    if (data.projectId !== project.id || data.sourceHash !== project.sourceHash) continue;
    store.validateSavedRecord(record);
    if (record.kind === 'comic-draft') {
      for (const [index, panel] of data.panels.entries()) {
        const cell = project.cells.find(cell => cell.id === panel.cellId);
        if (cell) add(record, cell.imageHash, `data.panels.${index}.cellId -> current storyboard frame imageHash`, cell.sceneId);
      }
    } else {
      for (const [index, binding] of data.cellBindings.entries()) {
        const cell = snapshots(binding.cellId).find(cell => cell.sceneId === data.sceneId && cell.shotId === data.shotId && storyboardCellSignature(cell) === binding.signature);
        // An unresolved historical binding must never fall back to a new image.
        if (cell) add(record, cell.imageHash, `data.cellBindings.${index}.signature -> saved storyboard frame imageHash`, cell.sceneId);
      }
    }
  }
  return uses;
}

export function projectLibrary(store) {
  const records = store.rawList();
  check(records.length <= 10000, 'PROJECT_LIBRARY_RECORD_LIMIT', 413);
  const project = store.project(), resolved = store.resolvedProject();
  const storyboardUses = storyboardAssetUses(store, records, resolved);
  const lore = retainedLore(store), checkedConsumers = new Set();
  const assets = records.filter(record => record.kind === 'project-asset').map(record => {
    verifyProjectAssetRecord(store, record);
    const curation = records.find(row => row.id === `asset-curation:${record.data.asset.sha256}`) ?? null;
    if (curation) { store.history(curation.id); store.validateSavedRecord(curation); }
    const matches = lore.filter(entry => entry.record.data.original.sha256 === record.data.asset.sha256);
    const sources = matches.map(({ record: source }) => ({ ref: { id: source.id, sha256: source.sha256 }, originalSha256: source.data.original.sha256, extractionSha256: source.data.extraction?.sha256 ?? null, pageCount: source.data.extraction?.pageCount ?? 0, pagesWithText: source.data.extraction?.pages.filter(page => page.characters > 0).length ?? 0, textCharacters: source.data.extraction?.pages.reduce((sum, page) => sum + page.characters, 0) ?? 0, ocrPerformed: source.data.extraction?.ocrPerformed ?? false }));
    const targetRefs = new Map([[record.id, record.sha256], ...matches.map(entry => [entry.record.id, entry.record.sha256])]);
    const whereUsed = [];
    for (const consumer of records) {
      if (consumer.id === record.id) continue;
      const original = matches.some(entry => entry.record.id === consumer.id);
      const refs = original ? ['data.original.sha256'] : matchingReferences(consumer.data, targetRefs);
      const derived = storyboardUses.get(record.data.asset.sha256)?.get(consumer.id);
      const blobs = matchingBlobReferences(consumer, record.data.asset.sha256), paths = [...refs, ...blobs, ...(derived?.paths ?? [])];
      if (!paths.length) continue;
      if (!checkedConsumers.has(consumer.id)) { store.history(consumer.id); store.validateSavedRecord(consumer); checkedConsumers.add(consumer.id); }
      const sceneIds = derived?.sceneIds ?? (consumer.kind === 'asset-curation' ? consumer.data.sceneIds : consumer.data.sceneId ? [consumer.data.sceneId] : []);
      whereUsed.push({ record: { id: consumer.id, kind: consumer.kind, version: consumer.version, sha256: consumer.sha256 }, relation: derived ? 'STORYBOARD_REFERENCE' : original ? 'LORE_ORIGINAL' : consumer.kind === 'asset-curation' ? 'CURATION' : refs.length ? 'RECORD_REFERENCE' : 'BLOB_REFERENCE', paths, sceneIds });
    }
    return { record, downloadUrl: `/api/project-library/assets/${encodeURIComponent(record.id)}`, curation, extraction: { status: sources.length ? 'RETAINED_LORE' : 'NO_RETAINED_EXTRACTION', sources }, whereUsed };
  });
  const hasStoryboardUses = assets.some(asset => asset.whereUsed.some(use => use.relation === 'STORYBOARD_REFERENCE'));
  return { schemaVersion: 'filmstack-project-library/v1', ...(isCreativeProject(project) ? { projectId: project.id } : {}), sourceHash: project.sourceHash, whereUsedScope: hasStoryboardUses ? 'CURRENT_RECORD_AND_STORYBOARD_REFERENCES' : 'CURRENT_RECORD_DIRECT_REFERENCES', assets, dccReturns: listProjectDccStageReturns(store) };
}

export function searchProjectLibrary(store, { sourceHash, projectId, query, limit = 20 }) {
  const limits = PROJECT_LIBRARY_SEARCH_LIMITS;
  const identity = validateLibraryScope(store.project(), { sourceHash, projectId }, 'PROJECT_LIBRARY_SEARCH_SOURCE_MISMATCH');
  check(typeof query === 'string' && query.isWellFormed() && query.trim().length > 0 && query.length <= limits.query && !/[\x00-\x1f\x7f]/.test(query) && Number.isSafeInteger(limit) && limit >= 1 && limit <= limits.results, 'PROJECT_LIBRARY_SEARCH_INVALID', 422);
  query = query.trim();
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
  const entries = retainedLore(store), assets = store.rawList('project-asset'), results = [];
  let totalMatches = 0, searchedPages = 0;
  for (const { record, pages } of entries) for (const page of pages) {
    searchedPages++;
    const match = pattern.exec(page.text); if (!match) continue;
    totalMatches++; if (results.length >= limit) continue;
    const snippetStart = Math.max(0, match.index - 100);
    const assetIds = assets.filter(asset => asset.data.asset.sha256 === record.data.original.sha256).map(asset => { verifyProjectAssetRecord(store, asset); return asset.id; });
    results.push({ assetIds, sourceRef: { id: record.id, sha256: record.sha256, originalSha256: record.data.original.sha256, extractionSha256: record.data.extraction.sha256, pageNumber: page.pageNumber, textSha256: page.textSha256 }, title: record.data.title, pageNumber: page.pageNumber, snippet: page.text.slice(snippetStart, snippetStart + limits.snippet), snippetStart, matchStart: match.index, matchLength: match[0].length });
  }
  return { schemaVersion: 'filmstack-project-library-search/v1', ...identity, sourceHash, query, limit, totalMatches, truncated: totalMatches > results.length, searchedSources: entries.length, searchedPages, results };
}

export function projectAssetDownload(store, id) {
  check(typeof id === 'string' && /^project-asset:[a-f0-9]{64}$/.test(id), 'PROJECT_ASSET_ID_INVALID', 404);
  const records = store.history(id);
  check(records.length === 1 && records[0].kind === 'project-asset', 'PROJECT_ASSET_NOT_FOUND', 404);
  return verifyProjectAssetRecord(store, records[0]);
}

// The authenticated HTTP caller owns upload staging and scope validation. The
// uploaded original is retained through the same immutable asset/blob service.
export function importProjectLibraryUpload(store, { filename, originalFilename, collection = 'Uploads', category = 'Development references' }) {
  const project = store.project(), sourceHash = project?.sourceHash;
  const identity = validateLibraryScope(project, { sourceHash, projectId: project?.id }, 'PROJECT_IMPORT_SOURCE_OR_MANIFEST_HASH_INVALID');
  check(typeof originalFilename === 'string', 'PROJECT_ASSET_FILENAME_INVALID', 422);
  const asset = inspectProjectAssetFile(filename, originalFilename);
  const data = {
    schemaVersion: sourceHash === null ? 2 : 1, ...identity, sourceHash,
    title: originalFilename.slice(0, 240).toWellFormed(), originalFilename,
    asset: { sha256: asset.sha256, byteLength: asset.byteLength, mimeType: asset.mimeType }, family: asset.family,
    category, collection, collectionPath: `uploads/${originalFilename}`,
    // Browsers do not expose a trustworthy original filesystem path. Record
    // the stable retained original rather than inventing one or keeping a tmp path.
    sourcePaths: [path.join(path.resolve(store.directory), 'blobs', asset.sha256)],
    scope: 'PROJECT_REFERENCE', review: 'PENDING',
  };
  validateProjectAsset(data, project);
  const id = recordId(asset.sha256), history = store.history(id);
  let record;
  if (history.length) {
    verifyProjectAssetRecord(store, history[0]);
    check(canonical(history[0].data.asset) === canonical(data.asset) && history[0].data.family === data.family, 'PROJECT_ASSET_BLOB_MISMATCH', 409);
    record = { ...history[0], replayed: true };
  } else {
    const blob = store.putBlob(filename, asset.mimeType, { sha256: asset.sha256, byteLength: asset.byteLength, maxBytes: PROJECT_ASSET_LIMITS.bytes });
    check(blob.sha256 === asset.sha256 && blob.bytes === asset.byteLength, 'PROJECT_IMPORT_ASSET_CHANGED', 409);
    record = store.saveProjectAssetRecord(id, { kind: 'project-asset', expectedVersion: null, requestId: `project-asset-import:${sha256(canonical(data))}`, data });
  }
  return { schemaVersion: 'filmstack-project-library-upload-result/v1', ...identity, sourceHash, imported: record.replayed ? 0 : 1, replayed: record.replayed ? 1 : 0, records: [record], scope: 'PROJECT_REFERENCE', approvalGranted: false };
}

export function importProjectLibraryManifest(store, { manifestPath, manifestSha256, sourceHash, projectId }) {
  check(digest(manifestSha256), 'PROJECT_IMPORT_SOURCE_OR_MANIFEST_HASH_INVALID', 409);
  const project = store.project(), identity = validateLibraryScope(project, { sourceHash, projectId }, 'PROJECT_IMPORT_SOURCE_OR_MANIFEST_HASH_INVALID');
  const creative = sourceHash === null;
  const stat = fs.lstatSync(manifestPath); check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 * 1024, 'PROJECT_IMPORT_MANIFEST_INVALID');
  const raw = fs.readFileSync(manifestPath); check(sha256(raw) === manifestSha256, 'PROJECT_IMPORT_MANIFEST_CHANGED', 409);
  const manifest = JSON.parse(raw.toString('utf8'));
  shape(manifest, ['schemaVersion', 'sourceHash', 'assets', ...(creative ? ['projectId'] : [])]);
  check(manifest.schemaVersion === (creative ? 'filmstack-project-library-import/v2' : 'filmstack-project-library-import/v1') && manifest.sourceHash === sourceHash && (!creative || manifest.projectId === project.id) && Array.isArray(manifest.assets) && manifest.assets.length > 0 && manifest.assets.length <= PROJECT_ASSET_LIMITS.manifestEntries, 'PROJECT_IMPORT_MANIFEST_INVALID');
  const root = fs.realpathSync(path.dirname(manifestPath)), prepared = [], byHash = new Map();
  let total = 0;
  // Preflight every source and retained metadata conflict before publishing any
  // blob or record. A later I/O failure is resumable with these exact inputs.
  for (const item of manifest.assets) {
    shape(item, ['path', 'sha256', 'byteLength', 'mimeType', 'family', 'title', 'originalFilename', 'category', 'collection', 'sourcePaths', 'collectionPath']);
    validateProjectCollectionPath(item.path);
    let current = root;
    for (const part of item.path.split('/')) { current = path.join(current, part); check(!fs.lstatSync(current).isSymbolicLink(), 'PROJECT_IMPORT_SYMLINK_REJECTED'); }
    const filename = fs.realpathSync(current); check(filename.startsWith(root + path.sep), 'PROJECT_IMPORT_PATH_ESCAPES_ROOT');
    const data = { schemaVersion: creative ? 2 : 1, ...identity, sourceHash, title: item.title, originalFilename: item.originalFilename, asset: { sha256: item.sha256, byteLength: item.byteLength, mimeType: item.mimeType }, family: item.family, category: item.category, collection: item.collection, sourcePaths: [...item.sourcePaths], collectionPath: item.collectionPath, scope: 'PROJECT_REFERENCE', review: 'PENDING' };
    validateProjectAsset(data, store.project());
    total += item.byteLength; check(total <= PROJECT_ASSET_LIMITS.batchBytes, 'PROJECT_IMPORT_BATCH_TOO_LARGE', 413);
    const actual = inspectProjectAssetFile(filename, item.originalFilename);
    check(actual.sha256 === item.sha256 && actual.byteLength === item.byteLength, 'PROJECT_IMPORT_ASSET_CHANGED', 409);
    check(item.mimeType === 'application/octet-stream' && item.family === 'OPAQUE' || actual.mimeType === item.mimeType && actual.family === item.family, 'PROJECT_IMPORT_SIGNATURE_MISMATCH');
    const registered = store.db.prepare('SELECT * FROM blobs WHERE sha256=?').get(item.sha256);
    if (registered) {
      check(registered.byte_length === item.byteLength && registered.mime_type === item.mimeType, 'PROJECT_ASSET_BLOB_MISMATCH', 409);
      store.blobInfo(item.sha256);
    }
    const next = { filename, data }, group = byHash.get(item.sha256) ?? [];
    group.push(next); byHash.set(item.sha256, group);
  }
  for (const [hash, group] of byHash) {
    group.sort((a, b) => a.data.collectionPath < b.data.collectionPath ? -1 : a.data.collectionPath > b.data.collectionPath ? 1 : a.filename.localeCompare(b.filename));
    const value = group[0];
    check(group.every(item => canonical(item.data.asset) === canonical(value.data.asset) && item.data.family === value.data.family), 'PROJECT_IMPORT_ALIAS_TYPE_CONFLICT', 409);
    value.data.sourcePaths = [...new Set(group.flatMap(item => item.data.sourcePaths))].sort();
    validateProjectAsset(value.data, store.project());
    const id = recordId(hash), history = store.history(id);
    if (history.length) {
      verifyProjectAssetRecord(store, history[0]);
      check(history.length === 1 && canonical(history[0].data) === canonical(value.data), 'PROJECT_ASSET_METADATA_CONFLICT', 409);
      value.existing = history[0];
    }
    prepared.push(value);
  }
  const records = [];
  for (const value of prepared) {
    if (value.existing) { records.push({ ...value.existing, replayed: true }); continue; }
    const blob = store.putBlob(value.filename, value.data.asset.mimeType, { sha256: value.data.asset.sha256, byteLength: value.data.asset.byteLength, maxBytes: PROJECT_ASSET_LIMITS.bytes });
    check(blob.sha256 === value.data.asset.sha256 && blob.bytes === value.data.asset.byteLength, 'PROJECT_IMPORT_ASSET_CHANGED', 409);
    records.push(store.saveProjectAssetRecord(recordId(blob.sha256), { kind: 'project-asset', expectedVersion: null, requestId: `project-asset-import:${sha256(canonical(value.data))}`, data: value.data }));
  }
  return { schemaVersion: creative ? 'filmstack-project-library-import-result/v2' : 'filmstack-project-library-import-result/v1', ...identity, sourceHash, manifestSha256, imported: records.filter(record => !record.replayed).length, replayed: records.filter(record => record.replayed).length, records, scope: 'PROJECT_REFERENCE', approvalGranted: false };
}
