import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CREATIVE_PROJECT_PROFILE, validateCreativeProject } from '../contracts/creative-project.mjs';
import { initialize, WorkspaceStore, check, atomicPrivateFile, canonical } from './storage.mjs';
import { openOwnerKernel } from './kernel.mjs';
import { validateRecord } from '../contracts/drifter.mjs';

export const CREATIVE_PROJECT_CREATION_MARKER = 'project-creation.json';
function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function createCreativeProject(directory, title) {
  check(typeof directory === 'string' && directory.trim().length > 0, 'CREATIVE_PROJECT_DIRECTORY_REQUIRED');
  const destination = path.resolve(directory);
  const project = validateCreativeProject({ id: `creative-project:${crypto.randomUUID()}`, title, profile: CREATIVE_PROJECT_PROFILE,
    sourceHash: null, sourceStatus: 'NO_SCREENPLAY', scenes: [], cells: [], characters: [], continuityQuestions: [] });
  // lstat also rejects dangling links. Never initialize/chmod a user's existing folder.
  try { fs.lstatSync(destination); check(false, 'CREATIVE_PROJECT_DESTINATION_EXISTS', 409); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parent = path.dirname(destination);
  check(fs.statSync(parent).isDirectory(), 'CREATIVE_PROJECT_PARENT_REQUIRED');
  const staging = fs.mkdtempSync(path.join(parent, '.caniscreenwrite-create-'));
  fs.chmodSync(staging, 0o700);
  let store, kernel, reserved = false, complete = false;
  try {
    initialize(staging);
    store = new WorkspaceStore(staging, validateRecord);
    store.initializeCreativeProject(project);
    kernel = openOwnerKernel(staging, project, { allowCreate: true });
    kernel.runtime.close(); kernel = null; store.close(); store = null;
    syncDirectory(staging);
    // Node has no portable exclusive-directory rename. Reserve the final name
    // with mkdir (no recursive/overwrite), then publish with a recovery marker.
    // If interrupted, the marker identifies the private staging directory and
    // required files; native/server opening must reject incomplete creation.
    try { fs.mkdirSync(destination, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') check(false, 'CREATIVE_PROJECT_DESTINATION_EXISTS', 409); throw error; }
    reserved = true;
    const entries = fs.readdirSync(staging).sort();
    atomicPrivateFile(path.join(destination, CREATIVE_PROJECT_CREATION_MARKER), canonical({
      schemaVersion: 1, status: 'CREATING', projectId: project.id, stagingDirectory: staging, requiredEntries: entries,
      recovery: 'Keep both directories. Complete verified file moves before removing this marker. Never initialize or seed over this project.',
    }));
    syncDirectory(destination);
    for (const name of entries) {
      // The exclusive private destination belongs to this creation. A file
      // unexpectedly present is an error, never something to replace.
      check(!fs.existsSync(path.join(destination, name)), 'CREATIVE_PROJECT_PUBLICATION_CONFLICT', 409);
      fs.renameSync(path.join(staging, name), path.join(destination, name));
    }
    syncDirectory(destination);
    fs.unlinkSync(path.join(destination, CREATIVE_PROJECT_CREATION_MARKER));
    syncDirectory(destination); syncDirectory(parent);
    complete = true;
    return { status: 'CREATIVE_PROJECT_CREATED', directory: destination, projectId: project.id, title: project.title,
      profile: project.profile, sourceHash: null, sourceStatus: 'NO_SCREENPLAY', sourceRequired: false };
  } finally {
    kernel?.runtime.close(); store?.close();
    // Before reservation, staging is wholly ours and unused. After reservation,
    // leave any failure intact for inspection/recovery instead of deleting data.
    if (!reserved || complete) fs.rmSync(staging, { recursive: true, force: true });
  }
}
