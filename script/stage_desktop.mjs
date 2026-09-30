import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { stageLicenceNotices } from './stage_licence_notices.mjs';
import { stageHiggsfieldRuntime } from './stage_higgsfield_runtime.mjs';
import { stageDesktopIcon } from './stage_desktop_icon.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [binary, nodeBinary, output, higgsfieldRuntime] = process.argv.slice(2);
if (!binary || !nodeBinary || !output || !path.isAbsolute(output)) throw new Error('Usage: stage_desktop.mjs SwiftBinary NodeBinary AbsoluteStagingDirectory');
fs.mkdirSync(output, { recursive: true });
const bundle = path.join(output, 'QiMovi.app');
const staging = path.join(output, `QiMovi.build-${crypto.randomUUID()}.app`);
const contents = path.join(staging, 'Contents');
const resources = path.join(contents, 'Resources');
const runtime = path.join(resources, 'runtime');
fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
fs.mkdirSync(runtime, { recursive: true });
const icon = stageDesktopIcon({ source: path.join(root, 'desktop/Resources/QiMovi.png'), resources });
fs.copyFileSync(binary, path.join(contents, 'MacOS/QiMovieSlate'));
fs.copyFileSync(nodeBinary, path.join(resources, 'node'));
const mediaProbe = path.join(path.dirname(binary), 'CanIScreenwriteMediaProbe');
if (!fs.existsSync(mediaProbe)) throw new Error('Build the CanIScreenwriteMediaProbe desktop product before packaging.');
fs.copyFileSync(mediaProbe, path.join(resources, 'CanIScreenwriteMediaProbe'));
fs.chmodSync(path.join(resources, 'CanIScreenwriteMediaProbe'), 0o755);
fs.chmodSync(path.join(resources, 'node'), 0o755);
fs.chmodSync(path.join(contents, 'MacOS/QiMovieSlate'), 0o755);
// Retain the implementation and integration guides with the installed runtime.
// These source docs contain no workspace configuration or donor application data.
for (const relative of ['dist-local', 'local/desktop', 'local/server', 'local/docs', 'local/content/filmcraft', 'local/providers', 'local/contracts', 'local/integrations/three-d', 'local/integrations/resolve', 'local/integrations/blender-mcp', 'local/kernel/src', 'local/kernel/registry', 'local/tools/documents.mjs', 'local/tools/document-schedules.mjs', 'local/tools/reviews.mjs', 'local/completion/modules.json', 'local/completion/artifacts.json']) {
  fs.cpSync(path.join(root, relative), path.join(runtime, relative), { recursive: true });
}
// Ship the reusable production packs, without development renders or QA outputs.
const templates = path.join(root, 'local/production-template-library');
fs.cpSync(templates, path.join(runtime, 'local/production-template-library'), { recursive: true,
  filter: file => {
    const parts = path.relative(templates, file).split(path.sep);
    if (parts.includes('_qa') || parts.includes('.DS_Store')) return false;
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Production templates must be retained files, not external links.');
    return fs.statSync(file).isDirectory() || /\.(md|json|txt|docx|xlsx|pptx)$/i.test(file);
  },
});
fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
// Bundle only the existing server's JSZip runtime tree, not the hosted app or development dependencies.
const packages = new Map();
function include(name, from) {
  const require = createRequire(from);
  const packageFile = require.resolve(`${name}/package.json`);
  const info = JSON.parse(fs.readFileSync(packageFile));
  if (packages.has(name)) {
    if (packages.get(name) !== info.version) throw new Error(`Conflicting runtime dependency: ${name}`);
    return;
  }
  packages.set(name, info.version);
  const source = path.dirname(packageFile);
  fs.cpSync(source, path.join(runtime, 'node_modules', name), { recursive: true, dereference: true,
    filter: file => !path.relative(source, file).split(path.sep).includes('node_modules') });
  for (const child of Object.keys(info.dependencies ?? {})) include(child, packageFile);
}
include('jszip', path.join(root, 'package.json'));
// Resolve the packaged service's imports before it can replace the installed app.
// Importing defines the service; it does not start it or open a workspace.
execFileSync(nodeBinary, ['--input-type=module', '-e', 'await import(process.argv[1]);', pathToFileURL(path.join(runtime, 'local/server/http.mjs')).href], { timeout: 30000, stdio: 'pipe' });
// Preserve installed dependency notices alongside the native and frontend runtime.
stageLicenceNotices({ root, nodeBinary, resources });
const higgsfield = higgsfieldRuntime ? stageHiggsfieldRuntime({ source: path.resolve(higgsfieldRuntime), runtime, resources }) : null;
// A packaged app must never silently open a checkout's test workspace. Existing
// installations restore their selected workspace through native preferences;
// first launches explicitly choose or create the project they will work on.
fs.writeFileSync(path.join(resources, 'desktop-defaults.json'), '{}\n');
fs.writeFileSync(path.join(resources, 'desktop-build.json'), JSON.stringify({
  product: 'QiMovi', bundleId: 'com.hampton.qimovieslate.local',
  builtAt: new Date().toISOString(),
  icon,
  workspacePolicy: 'User-selected local workspace; no project data bundled',
}, null, 2) + '\n');
fs.writeFileSync(path.join(resources, 'runtime-dependencies.json'), JSON.stringify(Object.fromEntries(packages), null, 2) + '\n');
fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>QiMovieSlate</string>
<key>CFBundleIdentifier</key><string>com.hampton.qimovieslate.local</string>
<key>CFBundleName</key><string>QiMovi</string>
<key>CFBundleDisplayName</key><string>QiMovi</string>
<key>CFBundleIconFile</key><string>QiMovi.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.6.0</string>
<key>CFBundleVersion</key><string>6</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>\n`);
// All destinations here are generated bundles; project databases/media live outside this directory.
if (fs.existsSync(bundle)) fs.rmSync(bundle, { recursive: true });
fs.renameSync(staging, bundle);
console.log(JSON.stringify({ bundle, icon, runtimeDependencies: Object.fromEntries(packages), higgsfieldRuntime: higgsfield, projectDataBundled: false }));
