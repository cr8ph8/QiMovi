#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildCameraExchange } from './exchange.mjs';

const args = process.argv.slice(2), options = {};
try {
  if (args.length !== 8) throw new Error('EXPECTED_SNAPSHOT_SCENE_SOURCE_OUTPUT');
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--snapshot', '--scene', '--source-hash', '--output'].includes(key) || Object.hasOwn(options, key) || !value) throw new Error('INVALID_EXPORT_ARGUMENTS');
    options[key] = value;
  }
  const input = path.resolve(options['--snapshot']), output = path.resolve(options['--output']);
  const stat = fs.lstatSync(input);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('INVALID_SNAPSHOT_FILE');
  const snapshot = JSON.parse(fs.readFileSync(input, 'utf8'));
  const exchange = buildCameraExchange(snapshot, { sceneId: options['--scene'], expectedSourceHash: options['--source-hash'] });
  const bytes = JSON.stringify(exchange, null, 2) + '\n';
  // A new explicit output only; no workspace, source, application or credentials are opened.
  fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ output, sha256: exchange.sha256, shots: exchange.scene.shots.length, readiness: exchange.readiness, canExecute: false }));
} catch (error) {
  console.error(JSON.stringify({ error: /^[A-Z][A-Z0-9_]+$/.test(error?.code ?? error?.message ?? '') ? error.code ?? error.message : 'DCC_EXPORT_FAILED' }));
  process.exitCode = 1;
}
