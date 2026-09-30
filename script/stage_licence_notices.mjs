import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`NOTICE_STAGING: ${message}`); };
const noticeName = /^(?:licen[sc]e|copying|copyright|notice)(?:[._-].*)?$/i;
const dependencyName = /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/;
function plainFile(filename, root, maxBytes = 4 * 1024 ** 2) {
  const real = fs.realpathSync(filename), base = fs.realpathSync(root), stat = fs.statSync(real);
  if (!real.startsWith(base + path.sep) || !stat.isFile() || stat.size > maxBytes) fail(`Unsupported notice source: ${filename}`);
  return fs.readFileSync(real);
}
function noticeFiles(directory) {
  const files = [];
  function visit(current, depth) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isFile() && noticeName.test(entry.name)) files.push(path.join(current, entry.name));
      else if (entry.isDirectory() && depth < 2 && /^(?:licen[sc]es?|notices?|legal)$/i.test(entry.name)) visit(path.join(current, entry.name), depth + 1);
    }
  }
  visit(directory, 0);
  // Some packages retain their complete licence only in README (e.g. isarray).
  if (!files.length) for (const name of fs.readdirSync(directory).filter(name => /^readme(?:\.[a-z]+)?$/i.test(name))) {
    const filename = path.join(directory, name), stat = fs.lstatSync(filename);
    if (stat.isFile() && stat.size <= 1024 ** 2 && /(?:^|\n)#{0,6}\s*licen[sc]e\b/i.test(fs.readFileSync(filename, 'utf8'))) files.push(filename);
  }
  return files.sort();
}
function packageFile(name, from) {
  if (!dependencyName.test(name)) return null;
  for (const base of createRequire(from).resolve.paths(name) ?? []) {
    const candidate = path.join(base, name, 'package.json');
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  return null;
}
// Bun's text lockfile uses trailing commas. Remove only commas outside quoted
// strings when followed by ] or }; never evaluate lockfile JavaScript.
function readLockfile(root) {
  const filename = path.join(root, 'bun.lock');
  if (!fs.existsSync(filename)) return { evidence: { status: 'NOT_FOUND', sourcePath: filename }, packages: [] };
  const bytes = fs.readFileSync(filename); if (bytes.length > 8 * 1024 ** 2) fail('Lockfile exceeds bound');
  const text = bytes.toString('utf8'); let out = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { out += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') { quoted = true; out += c; }
    else if (c === ',' && /^[\s]*[}\]]/.test(text.slice(i + 1))) continue;
    else out += c;
  }
  const data = JSON.parse(out);
  return { evidence: { status: 'READ', sourcePath: filename, sha256: sha(bytes), lockfileVersion: data.lockfileVersion ?? null }, packages: Object.entries(data.packages ?? {}) };
}

/** Copy available upstream texts verbatim into a fresh staged resource folder.
 * Declared production closure includes optional/peer packages only when installed;
 * it never traverses devDependencies or installs/downloads anything. */
export function stageLicenceNotices({ root, nodeBinary, resources, runtimePackageNames } = {}) {
  if (![root, nodeBinary, resources].every(v => typeof v === 'string' && path.isAbsolute(v))) fail('Absolute root, nodeBinary and resources are required');
  root = fs.realpathSync(root);
  const target = path.join(resources, 'Notices'); if (fs.existsSync(target)) fail('Notices destination must be fresh');
  fs.mkdirSync(target, { recursive: true });
  const rootPackageFile = path.join(root, 'package.json'), project = JSON.parse(fs.readFileSync(rootPackageFile));
  const lock = readLockfile(root), roots = runtimePackageNames ?? Object.keys(project.dependencies ?? {});
  if (!Array.isArray(roots) || !roots.every(name => dependencyName.test(name))) fail('Invalid dependency roots');
  const components = [], missingDependencies = [], seen = new Set(); let totalBytes = 0;
  function copyNotice(filename, directory, destination) {
    const bytes = plainFile(filename, directory); totalBytes += bytes.length;
    if (totalBytes > 64 * 1024 ** 2) fail('Notice collection exceeds 64 MiB');
    const relative = path.relative(directory, filename), out = path.join(target, destination, relative);
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, bytes, { flag: 'wx' });
    return { sourcePath: filename, destination: path.relative(target, out), byteLength: bytes.length, sha256: sha(bytes) };
  }
  function visit(name, from, optional = false) {
    const filename = packageFile(name, from);
    if (!filename) { missingDependencies.push({ name, requestedBy: from, optional, status: 'NOT_INSTALLED' }); return; }
    if (seen.has(filename)) return; seen.add(filename); if (seen.size > 1500) fail('Dependency closure exceeds bound');
    const directory = path.dirname(filename), bytes = fs.readFileSync(filename), info = JSON.parse(bytes);
    if (typeof info.name !== 'string' || typeof info.version !== 'string') fail('Package identity is missing');
    const identity = `${info.name}@${info.version}`, folder = `${info.name.replace(/[^a-zA-Z0-9._-]/g, '_')}@${info.version.replace(/[^a-zA-Z0-9._+-]/g, '_')}-${sha(filename).slice(0, 8)}`;
    const texts = noticeFiles(directory).map(file => copyNotice(file, directory, path.join('Packages', folder)));
    const entries = lock.packages.filter(([, value]) => Array.isArray(value) && value[0] === identity).map(([key, value]) => ({ key, package: value[0], integrity: typeof value.at(-1) === 'string' && value.at(-1).startsWith('sha') ? value.at(-1) : null }));
    components.push({ name: info.name, version: info.version, sourcePackagePath: filename, sourcePackageSha256: sha(bytes), declaredLicence: info.license ?? info.licenses ?? null, lockEntries: entries, status: texts.length ? 'TEXTS_RETAINED' : 'NOTICE_TEXT_NOT_FOUND', files: texts });
    for (const dep of Object.keys(info.dependencies ?? {})) visit(dep, filename);
    for (const dep of Object.keys(info.optionalDependencies ?? {})) if (!info.dependencies?.[dep]) visit(dep, filename, true);
    for (const dep of Object.keys(info.peerDependencies ?? {})) if (!info.dependencies?.[dep] && !info.optionalDependencies?.[dep]) visit(dep, filename, true);
  }
  for (const name of [...new Set(roots)].sort()) visit(name, rootPackageFile);
  const projectFiles = noticeFiles(root).filter(filename => !/^readme/i.test(path.basename(filename))).map(file => copyNotice(file, root, 'Project'));
  const realNode = fs.realpathSync(nodeBinary), version = execFileSync(realNode, ['--version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 }).trim();
  if (!/^v\d+\.\d+\.\d+$/.test(version)) fail('Node version could not be identified');
  const prefix = path.dirname(path.dirname(realNode)), nodeFiles = [], inspectedPaths = [];
  for (const directory of [path.join(prefix, 'share/doc/node'), path.join(prefix, 'share/doc/nodejs'), path.join(prefix, 'share/licenses/nodejs'), prefix]) {
    for (const name of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'NOTICE', 'NOTICE.txt']) {
      const file = path.join(directory, name); inspectedPaths.push(file);
      if (fs.existsSync(file) && fs.lstatSync(file).isFile() && /Node\.js|Node contributors/i.test(plainFile(file, directory).toString('utf8'))) nodeFiles.push(copyNotice(file, directory, `Node-${version}-${sha(directory).slice(0, 8)}`));
    }
  }
  // Optional exact-version source receipt prepared separately by the owner/agent.
  const receiptPath = path.join(root, 'script', 'licence-sources', `node-${version}.source.json`);
  let sourceReceipt = null;
  if (!nodeFiles.length && fs.existsSync(receiptPath)) {
    sourceReceipt = JSON.parse(fs.readFileSync(receiptPath));
    const directory = path.dirname(receiptPath), filename = path.join(directory, `node-${version}.LICENSE`), bytes = plainFile(filename, directory);
    if (sourceReceipt.version !== version || sourceReceipt.sha256 !== sha(bytes) || sourceReceipt.url !== `https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`) fail('Node source receipt does not match selected binary version');
    nodeFiles.push(copyNotice(filename, directory, `Node-${version}`));
  }
  const manifest = { schema: 'caniscreenwrite-staged-notices/v1', scope: runtimePackageNames ? 'SELECTED_INSTALLED_RUNTIME_CLOSURE' : 'DECLARED_PRODUCTION_DEPENDENCY_CLOSURE', generatedAt: new Date().toISOString(), rootPackages: roots, lockfile: lock.evidence, components: components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)), missingDependencies,
    node: { version, binarySourcePath: realNode, status: nodeFiles.length ? 'TEXTS_RETAINED' : 'NOTICE_TEXT_NOT_FOUND', files: nodeFiles, inspectedPaths, sourceReceipt },
    project: { name: project.name ?? null, declaredLicence: project.license ?? null, status: projectFiles.length ? 'TEXTS_RETAINED' : 'NOT_SUPPLIED', files: projectFiles },
    limitations: ['This preserves available upstream texts, not a legal clearance or new licence grant.', 'Production dependency closure may include packages not emitted in the local frontend; no devDependency traversal is performed.', 'Missing texts and project terms remain explicit.'] };
  fs.writeFileSync(path.join(target, 'index.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(target, 'README.txt'), 'CanIScreenwrite retained software notices\n\nExact upstream files are retained beside index.json, which records component versions, original paths and SHA-256 hashes. Missing notice texts or project terms are explicitly recorded. This index is not a new licence grant, ownership assertion or clearance of film assets.\n', { flag: 'wx' });
  return { directory: target, packages: components.length, copiedFiles: components.reduce((sum, item) => sum + item.files.length, 0) + nodeFiles.length + projectFiles.length, nodeStatus: manifest.node.status, projectStatus: manifest.project.status, manifestSha256: sha(fs.readFileSync(path.join(target, 'index.json'))) };
}
