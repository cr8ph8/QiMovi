#!/usr/bin/env node
import { importLoreManifest } from './lore.mjs';
import { importProjectLibraryManifest } from './project-library.mjs';
import path from 'node:path';
import { initialize, privateDirectory, acquireLock, WorkspaceStore, check } from './storage.mjs';
import { startServer } from './http.mjs';
import { openOwnerKernel } from './kernel.mjs';
import { createBackup, restoreBackup } from './recovery.mjs';
import { prepareControls, admitSource } from './admission.mjs';
import { createCreativeProject } from './creative-project.mjs';

const args = process.argv.slice(2);
const command = args.shift();
const options = {};
for (let index = 0; index < args.length; index += 2) {
  check(/^--[a-z][a-z0-9-]*$/.test(args[index]) && args[index + 1] && (args[index] === '--title' || !args[index + 1].startsWith('--')), 'EXPECTED_NAMED_ARGUMENT');
  check(!Object.hasOwn(options, args[index]), 'DUPLICATE_ARGUMENT'); options[args[index]] = args[index + 1];
}
const allowed = new Set(['--data', '--seed', '--dist', '--port', '--output', '--backup', '--source', '--controls', '--file', '--mime', '--manifest', '--manifest-sha256', '--source-hash', '--project-id', '--title']);
for (const key of Object.keys(options)) check(allowed.has(key), 'UNKNOWN_ARGUMENT');
const directory = path.resolve(options['--data'] ?? '.local-pilot');
async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  check(major > 24 || (major === 24 && minor >= 10), 'NODE_24_10_OR_NEWER_REQUIRED');
  if (command === 'create-project') {
    check(options['--data'] && options['--title'], 'CREATIVE_PROJECT_DATA_AND_TITLE_REQUIRED');
    check(Object.keys(options).every(key => ['--data', '--title'].includes(key)), 'CREATIVE_PROJECT_UNEXPECTED_ARGUMENT');
    return createCreativeProject(directory, options['--title']);
  }
  check(!Object.hasOwn(options, '--title'), 'TITLE_ONLY_FOR_CREATE_PROJECT');
  check(!Object.hasOwn(options, '--project-id') || command === 'import-project-library', 'PROJECT_ID_ONLY_FOR_PROJECT_LIBRARY');
  if (command === 'init') { initialize(directory); return { initialized: true, config: path.join(directory, 'config.json'), instruction: 'Read ownerToken privately from this file and enter it in the local app. Do not paste it into a URL.' }; }
  const { validateRecord } = await import('../contracts/drifter.mjs');
  if (command === 'restore') {
    check(options['--backup'], 'BACKUP_PATH_REQUIRED');
    const result = restoreBackup(path.resolve(options['--backup']), directory, validateRecord);
    initialize(directory); return { ...result, ownerCredential: 'NEW_PRIVATE_CONFIG_CREATED', config: path.join(directory, 'config.json') };
  }
  if (command === 'backup') { check(options['--output'], 'OUTPUT_REQUIRED'); return createBackup(directory, path.resolve(options['--output'])); }
  if (command === 'serve') {
    const port = Number(options['--port'] ?? 4317); check(Number.isInteger(port) && port >= 1 && port <= 65535, 'INVALID_PORT');
    const server = await startServer({ directory, port, dist: path.resolve(options['--dist'] ?? 'dist-local'), validateRecord });
    console.log(JSON.stringify({ origin: server.origin, mode: 'LOCAL_OWNER', hostedRelease: 'DEFERRED', config: path.join(directory, 'config.json') }));
    let closing = false;
    const stop = async () => { if (closing) return; closing = true; await server.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop); return;
  }
  privateDirectory(directory); const unlock = acquireLock(directory); let store;
  try {
    store = new WorkspaceStore(directory, validateRecord);
    if (command === 'seed') {
      check(options['--seed'], 'SEED_PATH_REQUIRED');
      const result = store.importSeed(path.resolve(options['--seed']));
      const kernel = openOwnerKernel(directory, store.project(), { allowCreate: !result.replayed }); kernel.runtime.close(); return result;
    }
    check(store.project(), 'PROJECT_NOT_SEEDED');
    if (command === 'import-lore') { check(options['--manifest']&&options['--source-hash'],'MANIFEST_AND_SOURCE_HASH_REQUIRED'); return importLoreManifest(store,{manifestPath:path.resolve(options['--manifest']),sourceHash:options['--source-hash']}); }
    if (command === 'import-project-library') {
      check(options['--manifest'] && options['--manifest-sha256'] && options['--source-hash'], 'MANIFEST_AND_HASHES_REQUIRED');
      const sourceHash = options['--source-hash'] === 'null' ? null : options['--source-hash'];
      check(sourceHash !== null || options['--project-id'], 'CREATIVE_PROJECT_ID_REQUIRED');
      return importProjectLibraryManifest(store, { manifestPath: path.resolve(options['--manifest']), manifestSha256: options['--manifest-sha256'], sourceHash, projectId: options['--project-id'] });
    }
    if (command === 'import-blob') { check(options['--file'], 'FILE_REQUIRED'); return store.putBlob(options['--file'], options['--mime'] ?? 'application/octet-stream'); }
    if (command === 'prepare-admission') {
      check(options['--source'] && options['--output'], 'SOURCE_AND_OUTPUT_REQUIRED');
      return prepareControls({ project: store.project(), sourceFile: options['--source'], output: options['--output'] });
    }
    if (command === 'admit-source') {
      check(options['--source'] && options['--controls'], 'SOURCE_AND_CONTROLS_REQUIRED');
      return await admitSource({ directory, project: store.project(), sourceFile: options['--source'], controlsFile: options['--controls'] });
    }
    throw new Error('Usage: cli.mjs create-project|init|seed|serve|backup|restore|prepare-admission|admit-source|import-lore|import-project-library [--data path] [command options]');
  } finally { store?.close(); unlock(); }
}
try { const result = await main(); if (result) console.log(JSON.stringify(result)); }
catch (error) { console.error(JSON.stringify({ error: error.code ?? error.message })); process.exitCode = 1; }
