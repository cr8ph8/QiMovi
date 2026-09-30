import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { canonical, check, sha256 } from './storage.mjs';
import { matchesStudioMediaContainer } from './studio-media.mjs';
import { COMIC_PACKAGE_MAX_BYTES, COMIC_PACKAGE_FILE_LIMITS, COMIC_PACKAGE_MIMES, validateComicPackage } from '../contracts/comic-package.mjs';
import { validateComicPagePlans } from '../contracts/comic-layouts.mjs';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const equal = (a, b) => canonical(a) === canonical(b);
const text = (value, maximum) => typeof value === 'string' && value.length <= maximum && value.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const roles = ['START', 'MOMENT', 'END'];
const blockers = ['COMIC_DERIVATIVE_RIGHTS_REVIEW_REQUIRED', 'SOURCE_AND_IMAGE_LICENCES_REQUIRED', 'CREATIVE_REVIEW_REQUIRED', 'EDITION_AND_TRANSFER_TERMS_REQUIRED'];
const metadata = file => ({ role: file.role, filename: file.filename, mimeType: file.mimeType, sha256: file.sha256, byteLength: file.byteLength });

function decodeFiles(input) {
  check(exact(input, ['projectId', 'sourceHash', 'files']) && typeof input.projectId === 'string' && digest(input.sourceHash), 'COMIC_PACKAGE_REQUEST_INVALID', 422);
  check(Array.isArray(input.files) && input.files.length === 3 && new Set(input.files.map(file => file?.role)).size === 3, 'COMIC_PACKAGE_FILES_INVALID', 422);
  let total = 0;
  const files = input.files.map(file => {
    check(exact(file, ['role', 'filename', 'mimeType', 'sha256', 'byteLength', 'base64']) && Object.hasOwn(COMIC_PACKAGE_MIMES, file.role), 'COMIC_PACKAGE_FILE_FIELDS_INVALID', 422);
    check(file.mimeType === COMIC_PACKAGE_MIMES[file.role] && digest(file.sha256) && Number.isSafeInteger(file.byteLength) && file.byteLength > 0 && file.byteLength <= COMIC_PACKAGE_FILE_LIMITS[file.role], 'COMIC_PACKAGE_FILE_INVALID', 422);
    total += file.byteLength; check(total <= COMIC_PACKAGE_MAX_BYTES, 'COMIC_PACKAGE_TOO_LARGE', 413);
    check(typeof file.base64 === 'string' && file.base64.length === 4 * Math.ceil(file.byteLength / 3) && !/[^A-Za-z0-9+/=]/.test(file.base64), 'COMIC_PACKAGE_BASE64_INVALID', 422);
    const bytes = Buffer.from(file.base64, 'base64');
    check(bytes.length === file.byteLength && bytes.toString('base64') === file.base64 && sha256(bytes) === file.sha256, 'COMIC_PACKAGE_BYTES_MISMATCH', 422);
    return { ...metadata(file), bytes };
  });
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.find(file => file.role === 'MANIFEST').bytes)); }
  catch { check(false, 'COMIC_PACKAGE_MANIFEST_INVALID', 422); }
  return { files, manifest };
}

function resolvedPanels(store) {
  const project = store.resolvedProject(), records = store.list(), assigned = new Set(), all = [], stale = [];
  check(project && digest(project.sourceHash), 'COMIC_PACKAGE_SCREENPLAY_REQUIRED', 409);
  for (const scene of project.scenes) {
    const record = records.find(row => row.kind === 'scene-plan' && row.id === `scene-plan:${scene.id}`), plan = record?.data;
    const current = plan && plan.sceneId === scene.id && plan.sourceHash === project.sourceHash && digest(project.cellBasisHashes?.[scene.id]) && plan.cellBasisHash === project.cellBasisHashes[scene.id] && record.reviewState?.status !== 'NEEDS_REVIEW' && Array.isArray(plan.cellOverrides) && new Set(plan.cellOverrides.map(item => item?.cellId)).size === plan.cellOverrides.length && plan.cellOverrides.every(item => item && roles.includes(item.role) && project.cells.some(cell => cell.id === item.cellId && cell.sceneId === scene.id && scene.shots.some(shot => shot.id === cell.shotId) && (item.role !== 'START' || cell.shotId === scene.shots[0]?.id)));
    if (record && !current) stale.push(scene.id);
    for (const shot of scene.shots) {
      const cells = project.cells.filter(cell => cell.sceneId === scene.id && cell.shotId === shot.id).map(cell => {
        assigned.add(cell.id); const override = current && plan.cellOverrides.find(item => item.cellId === cell.id);
        return { ...cell, sourceRole: cell.role, role: override?.role ?? cell.role, roleSource: override ? 'SAVED_SCENE_PLAN' : 'SOURCE', hasImage: digest(cell.imageHash) };
      });
      for (const role of roles) for (const cell of cells.filter(value => value.role === role)) all.push({ scene, shot, cell });
    }
  }
  return { project, records, all, stale, unassigned: project.cells.filter(cell => !assigned.has(cell.id)).map(cell => cell.id) };
}

function validateManifest(store, input, files, manifest, sourceStatus) {
  const { project, records, all, stale, unassigned } = resolvedPanels(store);
  check(project.id === input.projectId && project.sourceHash === input.sourceHash, 'COMIC_PACKAGE_PROJECT_MISMATCH', 409);
  const fields = ['schema', 'projectId', 'sourceHash', 'sourceStatus', 'title', 'credits', 'status', 'purpose', 'panelsPerPage', 'pageWidth', 'pageHeight', 'panels', 'omittedCellIds', 'unassignedCellIds', 'stalePlanSceneIds', 'marketReadiness', 'pages'];
  const paged = manifest?.schema === 'caniscreenwrite-storyboard-comic/v2';
  check(exact(manifest, paged ? [...fields, 'pagePlans'] : fields) && (paged || manifest.schema === 'caniscreenwrite-storyboard-comic/v1') && manifest.projectId === project.id && manifest.sourceHash === project.sourceHash, 'COMIC_PACKAGE_MANIFEST_BINDING_INVALID', 422);
  check(manifest.sourceStatus === sourceStatus() && manifest.status === 'PRIVATE_DRAFT' && manifest.purpose === 'STORYBOARD_DERIVATIVE_REVIEW' && equal(manifest.marketReadiness, { status: 'BLOCKED', blockers }), 'COMIC_PACKAGE_AUTHORITY_INVALID', 422);
  check(text(manifest.title, 240) && manifest.title.trim() && !/[\r\n\t]/.test(manifest.title) && text(manifest.credits, 2000) && [1, 2, 4].includes(manifest.panelsPerPage) && manifest.pageWidth === 1200 && manifest.pageHeight === 1800, 'COMIC_PACKAGE_LAYOUT_INVALID', 422);
  check(Array.isArray(manifest.panels) && manifest.panels.length >= 1 && manifest.panels.length <= 200, 'COMIC_PACKAGE_PANELS_INVALID', 422);
  const selected = [], refs = new Map(), parents = new Set();
  for (const [position, panel] of manifest.panels.entries()) {
    check(exact(panel, ['position', 'sceneId', 'sceneIndex', 'shotId', 'shotLabel', 'cell', 'caption', 'sourceParagraphs', 'displayedParagraphIds', 'recordRefs']) && panel.position === position && text(panel.caption, 10000), 'COMIC_PACKAGE_PANEL_INVALID', 422);
    const matches = all.filter(row => row.cell.id === panel.cell?.id);
    check(matches.length === 1 && !selected.includes(panel.cell.id), 'COMIC_PACKAGE_CELL_INVALID', 422);
    const { scene, shot, cell } = matches[0]; selected.push(cell.id);
    check(panel.sceneId === scene.id && panel.sceneIndex === scene.index && panel.shotId === shot.id && panel.shotLabel === shot.label && equal(panel.cell, cell) && digest(cell.imageHash), 'COMIC_PACKAGE_CELL_CHANGED', 409);
    const image = store.blob(cell.imageHash);
    check(image.bytes.length <= 25 * 1024 * 1024 && ['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) && matchesStudioMediaContainer(image.bytes, image.mimeType), 'COMIC_PACKAGE_PARENT_IMAGE_INVALID', 422); parents.add(cell.imageHash);
    const actionRefs = cell.actionRefs ?? [], sourceParagraphs = [...(project.prologue ?? []), ...scene.paragraphs];
    check(new Set(actionRefs).size === actionRefs.length && actionRefs.every(id => sourceParagraphs.filter(row => row.id === id).length === 1), 'COMIC_PACKAGE_SOURCE_LINKS_INVALID', 422);
    const paragraphs = sourceParagraphs.filter(row => actionRefs.includes(row.id)).map(row => ({ ...row, textSha256: sha256(Buffer.from(row.text, 'utf8')) }));
    check(equal(panel.sourceParagraphs, paragraphs) && Array.isArray(panel.displayedParagraphIds) && new Set(panel.displayedParagraphIds).size === panel.displayedParagraphIds.length && equal(panel.displayedParagraphIds, paragraphs.filter(row => panel.displayedParagraphIds.includes(row.id)).map(row => row.id)), 'COMIC_PACKAGE_SOURCE_TEXT_CHANGED', 409);
    const relevant = records.filter(row => row.kind === 'storyboard-cell' && row.data.cellId === cell.id || cell.roleSource === 'SAVED_SCENE_PLAN' && row.kind === 'scene-plan' && row.id === `scene-plan:${scene.id}`);
    for (const row of relevant) store.validateSavedRecord(row);
    const expectedRefs = relevant.map(row => ({ id: row.id, version: row.version, sha256: row.sha256 }));
    check(equal(panel.recordRefs, expectedRefs), 'COMIC_PACKAGE_RECORD_CHANGED', 409);
    for (const ref of expectedRefs) refs.set(ref.id, ref);
  }
  check(equal(manifest.omittedCellIds, all.filter(row => !selected.includes(row.cell.id)).map(row => row.cell.id)) && equal(manifest.unassignedCellIds, unassigned) && equal(manifest.stalePlanSceneIds, stale), 'COMIC_PACKAGE_COVERAGE_CHANGED', 409);
  if (paged) validateComicPagePlans(manifest.pagePlans, selected);
  const pageIds = paged ? manifest.pagePlans.map(page => page.panelIds) : Array.from({ length: Math.ceil(selected.length / manifest.panelsPerPage) }, (_, index) => selected.slice(index * manifest.panelsPerPage, (index + 1) * manifest.panelsPerPage));
  check(Array.isArray(manifest.pages) && manifest.pages.length === pageIds.length, 'COMIC_PACKAGE_PAGES_INVALID', 422);
  for (const [index, page] of manifest.pages.entries()) check(exact(page, ['path', 'sha256', 'bytes', 'panelIds']) && page.path === `${String(index + 1).padStart(4, '0')}.png` && digest(page.sha256) && Number.isSafeInteger(page.bytes) && page.bytes > 32 && page.bytes <= 25 * 1024 * 1024 && equal(page.panelIds, pageIds[index]), 'COMIC_PACKAGE_PAGE_BINDING_INVALID', 422);
  const data = { schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash, title: manifest.title, status: 'PRIVATE_DRAFT', manifestSha256: files.find(file => file.role === 'MANIFEST').sha256, files: files.map(metadata), parentAssetHashes: [...parents], panelCount: selected.length, pageCount: manifest.pages.length, recordRefs: [...refs.values()], verification: 'SOURCE_BINDINGS_AND_CONTAINERS_ONLY' };
  validateComicPackage(data, project); return data;
}

// A generated CBZ uses STORE. Reject compression, encryption, duplicate paths,
// hidden entries, ZIP64 and trailing data before JSZip can allocate output.
function inspectStoredZip(bytes, expectedNames) {
  check(bytes.length >= 22 && bytes.readUInt32LE(0) === 0x04034b50, 'COMIC_PACKAGE_CBZ_INVALID', 422);
  const end = bytes.length - 22;
  check(bytes.readUInt32LE(end) === 0x06054b50 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 20) === 0, 'COMIC_PACKAGE_CBZ_LAYOUT_INVALID', 422);
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  check(count === expectedNames.length && bytes.readUInt16LE(end + 8) === count && start + size === end, 'COMIC_PACKAGE_CBZ_ENTRIES_INVALID', 422);
  let cursor = start, localEnd = 0; const names = [];
  for (let i = 0; i < count; i++) {
    check(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'COMIC_PACKAGE_CBZ_DIRECTORY_INVALID', 422);
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), compressed = bytes.readUInt32LE(cursor + 20), uncompressed = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
    check((flags & ~0x0800) === 0 && method === 0 && compressed === uncompressed && uncompressed <= 25 * 1024 * 1024 && cursor + 46 + nameLength + extra + comment <= end && bytes.readUInt16LE(cursor + 34) === 0, 'COMIC_PACKAGE_CBZ_ENTRY_INVALID', 422);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength), name = nameBytes.toString('utf8');
    check(expectedNames.includes(name) && !names.includes(name) && local === localEnd && local + 30 <= start && bytes.readUInt32LE(local) === 0x04034b50, 'COMIC_PACKAGE_CBZ_PATH_INVALID', 422);
    const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), dataStart = local + 30 + localName + localExtra;
    check(bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method && bytes.readUInt32LE(local + 18) === compressed && bytes.readUInt32LE(local + 22) === uncompressed && bytes.readUInt32LE(local + 14) === bytes.readUInt32LE(cursor + 16) && bytes.subarray(local + 30, local + 30 + localName).equals(nameBytes) && dataStart + compressed <= start, 'COMIC_PACKAGE_CBZ_HEADER_MISMATCH', 422);
    names.push(name); localEnd = dataStart + compressed; cursor += 46 + nameLength + extra + comment;
  }
  check(cursor === end && localEnd === start, 'COMIC_PACKAGE_CBZ_LAYOUT_INVALID', 422);
}

async function validateContainers(files, manifest) {
  const pdf = files.find(file => file.role === 'PDF').bytes, pdfText = pdf.toString('latin1');
  check(/^%PDF-1\.[3-7](?:\r?\n)/.test(pdfText) && /%%EOF\s*$/.test(pdfText), 'COMIC_PACKAGE_PDF_INVALID', 422);
  const xref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(pdfText), xrefOffset = xref ? Number(xref[1]) : -1;
  check(Number.isSafeInteger(xrefOffset) && xrefOffset > 0 && xrefOffset < pdf.length, 'COMIC_PACKAGE_PDF_STRUCTURE_INVALID', 422);
  const table = pdfText.slice(xrefOffset).split(/\r?\n/), objectCount = /^0 ([1-9][0-9]*)$/.exec(table[1] ?? '');
  check(table[0] === 'xref' && objectCount && Number(objectCount[1]) <= 10000 && table.length > Number(objectCount[1]) + 2, 'COMIC_PACKAGE_PDF_STRUCTURE_INVALID', 422);
  const dictionaries = [];
  for (let index = 1; index < Number(objectCount[1]); index++) {
    const entry = /^([0-9]{10}) ([0-9]{5}) n ?$/.exec(table[index + 2] ?? ''), offset = entry ? Number(entry[1]) : -1;
    check(entry && offset > 0 && offset < xrefOffset && pdfText.startsWith(`${index} ${Number(entry[2])} obj`, offset), 'COMIC_PACKAGE_PDF_STRUCTURE_INVALID', 422);
    const endObject = pdfText.indexOf('endobj', offset), stream = pdfText.indexOf('\nstream', offset);
    check(endObject > offset && endObject < xrefOffset, 'COMIC_PACKAGE_PDF_STRUCTURE_INVALID', 422);
    dictionaries.push(pdfText.slice(offset, stream > offset && stream < endObject ? stream : endObject));
  }
  // Do not search compressed image bytes for PDF tokens: legitimate pixels can
  // contain the same byte sequences. This checks jsPDF's ordinary xref format.
  const structure = dictionaries.join('\n'), pages = [...structure.matchAll(/\/Type\s*\/Page\b/g)];
  check(pages.length === manifest.pages.length && !/\/(JavaScript|JS|AA|Launch|EmbeddedFile)\b/.test(structure), 'COMIC_PACKAGE_PDF_STRUCTURE_INVALID', 422);
  const cbz = files.find(file => file.role === 'CBZ').bytes;
  inspectStoredZip(cbz, [...manifest.pages.map(page => page.path), 'ComicInfo.xml', 'comic-manifest.json']);
  let archive;
  try { archive = await JSZip.loadAsync(cbz, { checkCRC32: true }); } catch { check(false, 'COMIC_PACKAGE_CBZ_CRC_INVALID', 422); }
  const embedded = await archive.file('comic-manifest.json').async('nodebuffer');
  check(embedded.equals(files.find(file => file.role === 'MANIFEST').bytes), 'COMIC_PACKAGE_EMBEDDED_MANIFEST_CHANGED', 422);
  for (const page of manifest.pages) {
    const bytes = await archive.file(page.path).async('nodebuffer');
    check(bytes.length === page.bytes && sha256(bytes) === page.sha256 && matchesStudioMediaContainer(bytes, 'image/png') && bytes.length >= 33 && bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString('ascii') === 'IHDR' && bytes.readUInt32BE(16) === manifest.pageWidth && bytes.readUInt32BE(20) === manifest.pageHeight && bytes.subarray(-8, -4).toString('ascii') === 'IEND', 'COMIC_PACKAGE_PAGE_BYTES_INVALID', 422);
  }
  const info = await archive.file('ComicInfo.xml').async('string');
  check(info.length <= 16000 && /^<\?xml[^>]+\?><ComicInfo>/.test(info) && !/<!DOCTYPE|<!ENTITY/.test(info) && info.includes(`<PageCount>${manifest.pages.length}</PageCount>`) && info.includes(manifest.sourceHash) && info.includes(files.find(file => file.role === 'MANIFEST').sha256), 'COMIC_PACKAGE_INFO_INVALID', 422);
}

export function createComicPackageService(store, options = {}) {
  const sourceStatus = options.sourceStatus ?? (() => store.project()?.sourceStatus ?? 'PENDING_OWNER_ADMISSION');
  let closing = false, active = null;
  const response = (record, replayed) => ({ schemaVersion: 1, projectId: record.data.projectId, sourceHash: record.data.sourceHash, record, files: record.data.files, replayed });
  async function perform(input) {
    const { files, manifest } = decodeFiles(input);
    const id = `comic-package:${files.find(file => file.role === 'MANIFEST').sha256}`;
    // A lost-response retry returns the same immutable package, even if planning
    // changed later. Different files cannot silently replace an existing package.
    const prior = store.rawList('comic-package').find(record => record.id === id);
    if (prior) {
      store.validateSavedRecord(prior);
      check(prior.data.projectId === input.projectId && prior.data.sourceHash === input.sourceHash && equal(prior.data.files, files.map(metadata)), 'COMIC_PACKAGE_EXISTING_CONFLICT', 409);
      return response(prior, true);
    }
    const data = validateManifest(store, input, files, manifest, sourceStatus);
    await validateContainers(files, manifest);
    check(!closing, 'COMIC_PACKAGE_RETENTION_INTERRUPTED', 409);
    check(equal(data, validateManifest(store, input, files, manifest, sourceStatus)), 'COMIC_PACKAGE_INPUTS_CHANGED', 409);
    // Validation is complete before original blob storage is touched. Temporary
    // buffers are service-owned; no source-file path or generic import is accepted.
    for (const file of files) {
      const existing = store.db.prepare('SELECT * FROM blobs WHERE sha256=?').get(file.sha256);
      check(!existing || existing.mime_type === file.mimeType && existing.byte_length === file.byteLength, 'COMIC_PACKAGE_BLOB_METADATA_CONFLICT', 409);
    }
    for (const file of files) {
      const temporary = path.join(store.directory, 'blobs', `comic-retain-${crypto.randomUUID()}.tmp`);
      try {
        fs.writeFileSync(temporary, file.bytes, { flag: 'wx', mode: 0o600 });
        store.putBlob(temporary, file.mimeType, { sha256: file.sha256, byteLength: file.byteLength, maxBytes: COMIC_PACKAGE_FILE_LIMITS[file.role] });
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    const saved = store.saveComicPackageRecord(id, { kind: 'comic-package', expectedVersion: null, requestId: `retain-comic:${sha256(canonical(data))}`, data });
    return response(saved, false);
  }
  return {
    list() { const project = store.project(); const records = store.rawList('comic-package'); for (const record of records) store.validateSavedRecord(record); return { schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash, records, maxPackageBytes: COMIC_PACKAGE_MAX_BYTES }; },
    async retain(input) {
      check(!closing, 'COMIC_PACKAGE_SERVICE_CLOSING', 503); check(!active, 'COMIC_PACKAGE_RETENTION_BUSY', 409);
      active = perform(input); try { return await active; } finally { active = null; }
    },
    async close() { closing = true; if (active) await active.catch(() => undefined); },
  };
}
