#!/usr/bin/env node
// Independently inspect a downloaded preparation package against owned storage.
// This verifies bytes and draft identity, never production or creative approval.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';

const [packageFile, dataDirectory, reportFile] = process.argv.slice(2);
assert(packageFile && dataDirectory && reportFile && process.argv.length === 5,
  'Usage: node scripts/verify-dreamina-package.mjs package.zip workspace-directory new-report.json');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safePath = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') &&
  !value.includes('\\') && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..');
const packageBytes = fs.readFileSync(packageFile);
assert(packageBytes.length <= 270 * 1024 * 1024, 'Package exceeds preparation size bound');
const zip = await JSZip.loadAsync(packageBytes, { checkCRC32: true });
const manifestEntry = zip.file('manifest.json');
assert(manifestEntry, 'Missing manifest');
const manifestBytes = await manifestEntry.async('nodebuffer');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.format, 'dreamina-preparation/v1');
assert.equal(manifest.status, 'DRAFT_NEEDS_INPUTS');
assert.equal(manifest.accountStatus, 'UNVERIFIED');
assert.equal(manifest.sourceScope, 'ENTIRE_SCENE_CONTEXT_NOT_CLIP_COVERAGE');
assert(sha(manifest.sourceHash) && sha(manifest.record?.sha256) && Array.isArray(manifest.files));
const expected = new Set(['manifest.json']);
const contents = new Map();
let totalBytes = 0;
for (const item of manifest.files) {
  assert(safePath(item.path) && !expected.has(item.path), 'Unsafe or repeated manifest path');
  assert(sha(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes >= 0, 'Invalid file evidence');
  totalBytes += item.bytes;
  assert(totalBytes <= 256 * 1024 * 1024, 'Uncompressed files exceed size bound');
  const entry = zip.file(item.path);
  assert(entry && !entry.dir, `Missing archive file: ${item.path}`);
  const bytes = await entry.async('nodebuffer');
  assert.equal(bytes.length, item.bytes, `${item.path}: wrong length`);
  assert.equal(digest(bytes), item.sha256, `${item.path}: wrong hash`);
  expected.add(item.path);
  contents.set(item.path, bytes);
}
assert.deepEqual(Object.keys(zip.files).sort(), [...expected].sort(), 'Unlisted archive contents');
const json = name => JSON.parse(contents.get(name).toString('utf8'));
const brief = json('brief.json');
assert.equal(digest(contents.get('brief.json')), manifest.record.sha256, 'Brief is not the exact recorded body');
assert.equal(digest(contents.get('prompt.txt')), manifest.promptHash);
assert.equal(brief.sourceHash, manifest.sourceHash);
assert.equal(brief.status, 'DRAFT');
assert.equal(brief.basisHash, manifest.basisHash);
if (brief.prompt) assert.equal(contents.get('prompt.txt').toString('utf8'), brief.prompt, 'Edited prompt changed during export');
const db = new DatabaseSync(path.join(dataDirectory, 'workspace.sqlite'), { readOnly: true });
try {
  const project = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='project'").get().value);
  const record = db.prepare('SELECT * FROM records WHERE id=? ORDER BY version DESC LIMIT 1').get(manifest.record.id);
  assert(record && record.kind === 'generation-brief', 'Missing saved generation brief');
  assert.equal(record.version, manifest.record.version, 'A later brief revision exists');
  assert.equal(record.sha256, manifest.record.sha256, 'Different saved revision');
  assert.equal(digest(record.data), manifest.record.sha256, 'Saved body hash mismatch');
  assert.equal(record.data, contents.get('brief.json').toString('utf8'));
  assert.equal(project.sourceHash, manifest.sourceHash);
  const originalSource = fs.readFileSync(path.join(dataDirectory, 'blobs', project.sourceHash));
  assert.equal(digest(originalSource), project.sourceHash, 'Owned source hash mismatch');
  assert.deepEqual(contents.get('source/original.fdx'), originalSource, 'Original screenplay bytes changed');
  const scene = project.scenes.find(item => item.id === brief.sceneId);
  assert(scene, 'Unknown source scene');
  assert.deepEqual(json('source/scene-paragraphs.json'), scene.paragraphs, 'Source paragraphs changed');
  assert.equal(contents.get('source/scene.txt').toString('utf8'), scene.paragraphs.map(p => p.text).join('\n\n'));
  const uploadSheet = json('upload-sheet.json');
  assert(Array.isArray(uploadSheet));
  const assets = new Set();
  for (const entry of uploadSheet) {
    if (!entry.path) { assert(['MISSING', 'MISSING_BLOB'].includes(entry.status)); continue; }
    assert(entry.path.startsWith('assets/') && safePath(entry.path) && sha(entry.sha256));
    const bytes = contents.get(entry.path);
    assert(bytes, 'Reference file not in manifest');
    assert.equal(digest(bytes), entry.sha256, 'Reference hash does not match upload sheet');
    assert.equal(bytes.length, entry.byteLength, 'Reference length does not match upload sheet');
    const owned = fs.readFileSync(path.join(dataDirectory, 'blobs', entry.sha256));
    assert.deepEqual(bytes, owned, 'Exported reference differs from owned original');
    if (entry.crop) assert.equal(entry.status, 'CROP_REQUIRED', 'Unrendered crop was mislabeled');
    assets.add(entry.path);
  }
  assert.deepEqual([...contents.keys()].filter(name => name.startsWith('assets/')).sort(), [...assets].sort());
  const requirements = json('requirements.json');
  assert(Array.isArray(requirements) && requirements.some(item => item.code === 'ACCOUNT_SETTINGS_UNVERIFIED') &&
    requirements.some(item => item.code === 'OWNER_EXECUTION_APPROVAL_REQUIRED'));
  const report = {
    schemaVersion: 1, result: 'DRAFT_PACKAGE_BYTES_VERIFIED',
    verifier: 'scripts/verify-dreamina-package.mjs',
    package: { path: path.resolve(packageFile), sha256: digest(packageBytes), bytes: packageBytes.length },
    manifestHash: digest(manifestBytes), record: manifest.record, sourceHash: project.sourceHash,
    sceneId: scene.id, paragraphCount: scene.paragraphs.length, verifiedFileCount: contents.size + 1,
    ownedReferenceFiles: assets.size, preparationStatus: manifest.status,
    checks: ['manifest membership and hashes', 'exact saved brief revision', 'unchanged FDX bytes',
      'unchanged scene paragraphs', 'owned reference bytes', 'crop instructions labeled', 'approval requirements retained'],
    limits: ['Does not approve source, references, spending or generation.',
      'Current dependency eligibility is enforced separately by the live exporter.',
      'Does not verify a generated take or a finished film.'],
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ result: report.result, files: report.verifiedFileCount,
    sourceHash: report.sourceHash, report: path.resolve(reportFile) }));
} finally { db.close(); }
