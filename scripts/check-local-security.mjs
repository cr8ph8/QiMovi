#!/usr/bin/env node
// Fixture-only checks of the shared QiMovi boundary. No production workspace,
// hosted database, provider account, credential collector or paid call is used.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  console.error('Usage: node scripts/check-local-security.mjs [--output NEW_DIRECTORY]');
  process.exit(2);
}
const output = path.resolve(args[1] ?? path.join(root, 'outputs', 'local-security', new Date().toISOString().replaceAll(':', '-')));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(output, { mode: 0o700 }); // Never overwrite an earlier evidence run.

const groups = [
  { id: 'local-ownership-storage', modules: ['owner sessions', 'workspace files', 'source authority', 'writing recovery', 'review exchange'],
    args: ['--test', '--test-concurrency=2',
      'local/tests/server.test.mjs', 'local/tests/sqlite-paths.test.mjs', 'local/tests/security-audit.test.mjs',
      'local/tests/writing-recovery.test.mjs', 'local/tests/creative-studio-api.test.mjs', 'local/tests/reviews.test.mjs'] },
  { id: 'world-profile-boundaries', modules: ['universe profiles', 'source citations', 'character perspective', 'world rehearsal'],
    args: ['--test', '--test-concurrency=2',
      'local/tests/universe-profile.test.mjs', 'local/tests/universe.test.mjs',
      'local/tests/universe-artwork.test.mjs', 'local/tests/world-rehearsal.test.mjs'] },
  { id: 'generation-and-connectors', modules: ['local models', 'MCP access', 'media transport', 'approved generation', 'node workflow'],
    args: ['--test', '--test-concurrency=2',
      'local/tests/model-assistance.test.mjs', 'local/tests/higgsfield-mcp-http.test.mjs',
      'local/tests/higgsfield-mcp-media.test.mjs', 'local/tests/studio-generation-runner.test.mjs',
      'local/tests/studio-generation-http.test.mjs', 'local/tests/node-workflow.test.mjs'] },
  { id: 'writer-and-shared-policy', modules: ['screenplay rendering', 'safe exports', 'recovery client', 'AI fail closed', 'commerce containment'],
    args: ['node_modules/vitest/vitest.mjs', 'run',
      'src/drifter/writingSecurity.test.tsx',
      'src/drifter/UniverseProfileEditor.test.tsx', 'src/drifter/UniverseLibrary.test.tsx',
      'src/drifter/StoryBiblePanel.test.tsx', 'src/drifter/universeApi.test.ts', 'src/drifter/AssistantPanel.test.tsx',
      'src/drifter/writingRecoveryApi.test.ts', 'src/drifter/scriptAnalysisModel.test.ts',
      'src/lib/__tests__/aiRouterFailClosed.security.test.ts',
      'src/lib/__tests__/commerceContainment.security.test.ts'] },
];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function sources() {
  const result = {};
  const walk = relative => {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Evidence source must not be a link: ${relative}`);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute).sort()) walk(path.join(relative, child));
    } else if (/\.(?:mjs|ts|tsx|swift|css|json|sh|lock)$/.test(relative)) result[relative] = hash(fs.readFileSync(absolute));
  };
  for (const relative of ['local/server', 'local/contracts', 'local/providers', 'local/integrations',
    'local/desktop', 'local/kernel/src', 'local/tools', 'local/tests', 'desktop/Sources', 'desktop/Package.swift',
    'script', 'src', 'scripts/check-local-security.mjs', 'package.json', 'bun.lock']) walk(relative);
  return result;
}

const startedAt = new Date().toISOString();
const before = sources();
const results = [];
for (const group of groups) {
  console.log(`Checking ${group.id}…`);
  const start = Date.now();
  const result = spawnSync(process.execPath, group.args, {
    cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  });
  const log = `${group.id}.log`;
  const bytes = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? '\nCHECK_PROCESS_FAILED\n' : ''}`;
  fs.writeFileSync(path.join(output, log), bytes, { mode: 0o600, flag: 'wx' });
  const passed = result.status === 0 && !result.error;
  results.push({ ...group, executable: process.execPath, result: passed ? 'PASS' : 'FAIL',
    exitCode: result.status, signal: result.signal, durationMs: Date.now() - start, log, logSha256: hash(bytes) });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${group.id} (${log})`);
}
const after = sources();
const stable = JSON.stringify(before) === JSON.stringify(after);
const passed = stable && results.every(result => result.result === 'PASS');
const report = {
  schema: 'qimovi-local-security-check/v1', startedAt, finishedAt: new Date().toISOString(),
  result: passed ? 'LOCAL_SECURITY_CHECKS_PASSED' : stable ? 'CHECKS_FAILED' : 'IMPLEMENTATION_CHANGED_DURING_CHECKS',
  scope: 'Synthetic local checks; not native acceptance, hosted RLS qualification, a penetration test or a release certificate.',
  implementationStable: stable, sources: before, results,
  separateGates: ['dependency audit', 'native application acceptance', 'hosted multi-user access and RLS', 'aggregate payment reservations'],
};
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(`${report.result}: ${path.join(output, 'report.json')}`);
process.exitCode = passed ? 0 : 1;
