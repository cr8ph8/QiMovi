#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { verifyDccStageReturnFiles, readDccStageReturnDirectory, buildUnityStageReturnFiles } from './stage-return.mjs';

async function main() {
  const [command, ...args] = process.argv.slice(2), options = {};
  const keys = command === 'inspect' ? ['--kit', '--snapshot', '--return', '--output'] : command === 'package-unity' ? ['--kit', '--snapshot', '--observation', '--scene', '--output'] : [];
  if (!keys.length || args.length !== keys.length * 2) throw new Error('Usage: stage-return-cli.mjs inspect --kit FILE --snapshot FILE --return DIRECTORY --output NEW_REPORT | package-unity --kit FILE --snapshot FILE --observation FILE --scene FILE --output NEW_DIRECTORY');
  for (let i = 0; i < args.length; i += 2) {
    if (!keys.includes(args[i]) || options[args[i]] || !path.isAbsolute(args[i + 1] ?? '')) throw new Error('DCC_RETURN_CLI_ARGUMENT_INVALID');
    options[args[i]] = args[i + 1];
  }
  const read = (filename, limit) => {
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('DCC_RETURN_CLI_FILE_INVALID');
    return fs.readFileSync(filename);
  };
  const context = { expectedKit: JSON.parse(read(options['--kit'], 1024 * 1024)), snapshot: JSON.parse(read(options['--snapshot'], 16 * 1024 * 1024)) };
  if (command === 'inspect') {
    const verified = verifyDccStageReturnFiles(readDccStageReturnDirectory(options['--return']), context);
    fs.writeFileSync(options['--output'], JSON.stringify(verified, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: verified.status, output: options['--output'], shotId: verified.origin.shotId, frames: verified.frames.length, approvalGranted: false, executionVerified: false }));
  } else {
    const files = buildUnityStageReturnFiles({ ...context, observationBytes: read(options['--observation'], 1024 * 1024), sceneBytes: read(options['--scene'], 192 * 1024 * 1024) });
    fs.mkdirSync(options['--output'], { mode: 0o700 });
    const zip = new JSZip();
    for (const [name, bytes] of Object.entries(files)) { fs.writeFileSync(path.join(options['--output'], name), bytes, { flag: 'wx', mode: 0o600 }); zip.file(name, bytes); }
    fs.writeFileSync(path.join(options['--output'], 'stage-return.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'UNITY_SCENE_RETURN_PACKAGED', output: options['--output'], renderedFrames: 0, approvalGranted: false, executionVerified: false }));
  }
}
main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
