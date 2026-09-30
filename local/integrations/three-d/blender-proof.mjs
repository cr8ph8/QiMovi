import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { inflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashCanonical } from '../../kernel/src/canonical-json.mjs';
import { validateRecord } from '../../contracts/drifter.mjs';
import { HANDOFF_AUTHORING_KINDS, validateProductionHandoff, validateWorkflowRef } from '../../contracts/production-handoff.mjs';

const check = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const same = isDeepStrictEqual;
const close = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= 0.00001;
const vectorClose = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => close(n, b[i]));
const privateScope = { classification: 'INTERNAL_BLOCKING_PROOF', ownerReview: 'REQUIRED', productionApproved: false, finalMedia: false, sourceAdmissionEvaluated: false, castOrReferenceUseApproved: false };

const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
function verifyRgbPng(bytes, width, height) {
  check(bytes.length >= 57 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'BLENDER_IMAGE_MISMATCH');
  let offset = 8, header = false, ended = false;
  const data = [];
  while (offset < bytes.length) {
    check(offset + 12 <= bytes.length, 'BLENDER_IMAGE_MISMATCH');
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    check(end <= bytes.length, 'BLENDER_IMAGE_MISMATCH');
    const type = bytes.toString('ascii', offset + 4, offset + 8), chunk = bytes.subarray(offset + 8, end - 4);
    check(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'BLENDER_IMAGE_MISMATCH');
    if (!header) check(type === 'IHDR', 'BLENDER_IMAGE_MISMATCH');
    if (type === 'IHDR') { check(!header && length === 13 && chunk.readUInt32BE(0) === width && chunk.readUInt32BE(4) === height && chunk[8] === 8 && chunk[9] === 2 && chunk[10] === 0 && chunk[11] === 0 && chunk[12] === 0, 'BLENDER_IMAGE_MISMATCH'); header = true; }
    if (type === 'IDAT') data.push(chunk);
    if (type === 'IEND') { check(length === 0 && end === bytes.length, 'BLENDER_IMAGE_MISMATCH'); ended = true; }
    offset = end;
  }
  check(header && ended && data.length > 0, 'BLENDER_IMAGE_MISMATCH');
  const expected = (width * 3 + 1) * height;
  let decoded;
  try { decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 }); } catch { check(false, 'BLENDER_IMAGE_MISMATCH'); }
  check(decoded.length === expected, 'BLENDER_IMAGE_MISMATCH');
  for (let row = 0; row < height; row++) check(decoded[row * (width * 3 + 1)] <= 4, 'BLENDER_IMAGE_MISMATCH');
}

/** A supplied CURRENT snapshot is a bounded planning claim, rechecked against the store on import. */
export function validateBlenderWorkflowContext(context, exchange) {
  check(context?.schema === 'filmstack-unified-workflow/v1' && context.authority === 'PLANNING_CONTEXT_ONLY' && context.productionAuthorized === false && context.sourceReplacement === false && context.status === 'CURRENT' && context.readiness === 'READY_FOR_PLANNING', 'BLENDER_WORKFLOW_NOT_CURRENT_PLANNING');
  check(Object.keys(context).sort().join(',') === 'authoring,authority,handoff,lineage,linkedHandoffs,productionAuthorized,readiness,schema,selection,sourceBasis,sourceReplacement,status', 'BLENDER_WORKFLOW_FIELDS_INVALID');
  const contextSha256 = hashCanonical(context), source = context.sourceBasis;
  check(source?.projectId === exchange.source.projectId && source.sourceHash === exchange.source.sourceHash && source.sceneId === exchange.scene.id && SHA.test(source.sceneHash) && same(source.shotIds, exchange.scene.shots.map(shot => shot.id)), 'BLENDER_WORKFLOW_SOURCE_MISMATCH');
  validateWorkflowRef(context.selection?.authoringRef); validateWorkflowRef(context.selection?.handoffRef);
  const project = { id: exchange.source.projectId, sourceHash: exchange.source.sourceHash, scenes: [exchange.scene], cells: [] };
  const recordValid = record => {
    check(record && typeof record.id === 'string' && record.id.startsWith(record.kind + ':') && Number.isSafeInteger(record.version) && record.version > 0 && record.sha256 === hashCanonical(record.data) && record.data.sourceHash === project.sourceHash, 'BLENDER_WORKFLOW_RECORD_MISMATCH');
  };
  const matchesRef = (record, ref) => record?.id === ref?.id && record?.sha256 === ref?.sha256;
  const matchesHead = (record, head) => matchesRef(record, head) && head.kind === record.kind && head.version === record.version;
  const handoff = context.handoff?.record;
  recordValid(handoff); validateProductionHandoff(handoff.data, project);
  check(handoff.kind === 'production-handoff' && handoff.id === 'production-handoff:' + exchange.scene.id && matchesRef(handoff, context.selection.handoffRef) && same(handoff.data.authoringRef, context.selection.authoringRef) && context.handoff.status === 'CURRENT' && matchesHead(handoff, context.handoff.head), 'BLENDER_WORKFLOW_HANDOFF_MISMATCH');
  check(handoff.data.shotIds.length > 0 && handoff.data.shotIds.every(id => exchange.scene.shots.some(shot => shot.id === id)), 'BLENDER_WORKFLOW_SHOTS_MISSING');
  const lineage = context.lineage;
  check(lineage?.status === 'CURRENT' && Array.isArray(lineage.nodes) && lineage.nodes.length > 0 && lineage.nodes.length <= 100 && Array.isArray(lineage.edges) && lineage.edges.length <= 10000 && Array.isArray(lineage.reasons) && lineage.reasons.length === 0, 'BLENDER_WORKFLOW_LINEAGE_INVALID');
  const nodes = new Map();
  for (const node of lineage.nodes) {
    validateWorkflowRef(node.ref); recordValid(node.record);
    check(HANDOFF_AUTHORING_KINDS.includes(node.record.kind) && matchesRef(node.record, node.ref) && node.status === 'CURRENT' && node.reason === '' && matchesHead(node.record, node.head), 'BLENDER_WORKFLOW_NODE_MISMATCH');
    // The exchange contains one production scene; a transitive writing draft may name another.
    // Validate that optional identifier structurally here; the owner import compares the full live context.
    const structuralData = { ...node.record.data };
    if (node.record.kind === 'screenplay-draft' && Object.hasOwn(structuralData, 'sceneId')) {
      check(typeof structuralData.sceneId === 'string' && structuralData.sceneId.length > 0 && structuralData.sceneId.length <= 160, 'BLENDER_WORKFLOW_DRAFT_SCENE_INVALID');
      delete structuralData.sceneId;
    }
    validateRecord(node.record.kind, structuralData, project);
    const key = node.ref.id + ':' + node.ref.sha256; check(!nodes.has(key), 'BLENDER_WORKFLOW_DUPLICATE_NODE'); nodes.set(key, node);
  }
  const seen = new Set(), active = new Set(), edges = [];
  const visit = (ref, depth) => {
    const key = ref.id + ':' + ref.sha256; check(depth <= 24 && !active.has(key), 'BLENDER_WORKFLOW_CYCLE_OR_DEPTH'); if (seen.has(key)) return;
    const node = nodes.get(key); check(node, 'BLENDER_WORKFLOW_INPUT_MISSING'); seen.add(key); active.add(key);
    for (const input of node.record.data.inputRefs ?? []) { validateWorkflowRef(input); edges.push({ from: ref, to: input }); visit(input, depth + 1); }
    active.delete(key);
  };
  visit(context.selection.authoringRef, 0);
  check(seen.size === nodes.size && same(edges.map(hashCanonical).sort(), lineage.edges.map(hashCanonical).sort()), 'BLENDER_WORKFLOW_GRAPH_MISMATCH');
  const first = nodes.get(context.selection.authoringRef.id + ':' + context.selection.authoringRef.sha256);
  check(context.authoring?.status === 'CURRENT' && same(context.authoring.record, first.record) && same(context.authoring.head, first.head), 'BLENDER_WORKFLOW_SELECTION_MISMATCH');
  check(Array.isArray(context.linkedHandoffs) && context.linkedHandoffs.length <= 100 && context.linkedHandoffs.some(item => same(item.record, handoff) && item.status === 'CURRENT' && item.authoringStatus === 'CURRENT'), 'BLENDER_WORKFLOW_LINK_MISSING');
  for (const linked of context.linkedHandoffs) { recordValid(linked.record); validateProductionHandoff(linked.record.data, project); }
  return contextSha256;
}

export function validateLinkedBlenderPlan(plan, exchange) {
  check(plan?.schema === 'filmstack-linked-camera-plan/v1' && plan.authority === 'PLANNING_CONTEXT_ONLY' && plan.productionAuthorized === false && plan.sourceReplacement === false && same(plan.exchange, exchange), 'BLENDER_LINKED_PLAN_INVALID');
  const {sha256: claimed, ...payload} = plan;
  check(Object.keys(payload).sort().join(',') === 'authority,exchange,productionAuthorized,schema,sourceReplacement,workflowContext' && hashCanonical(payload) === claimed, 'BLENDER_LINKED_PLAN_HASH_MISMATCH');
  validateBlenderWorkflowContext(plan.workflowContext, exchange); return claimed;
}

/** The historical proof constructor depended on a private film fixture.
 * Generic DCC scene kits, camera exchange and observation validation remain available.
 * Do not substitute arbitrary input for the missing fixture or admit it as a verified proof.
 */
export function buildBlenderBlockingProposal(_exchange, _exchangeFileSha256, _workflowContext, _linkedPlanSha256) {
  throw Object.assign(new Error('NO_PRIVATE_PROOF_FIXTURE: Use a project-authored DCC stage kit.'), { code: 'NO_PRIVATE_PROOF_FIXTURE' });
}

export function verifyBlenderObservation(observation, proposal, { proposalSha256, blendSha256, imageFiles }) {
  check(observation?.schemaVersion === 'filmstack-blender-observation/v1' && observation.classification === privateScope.classification && observation.finalMedia === false && observation.productionApproved === false && observation.ownerReview === 'REQUIRED', 'BLENDER_OBSERVATION_SCOPE_INVALID');
  check(observation.reopenedFromDisk === true && observation.application?.version === proposal.application.requiredVersion, 'BLENDER_REOPEN_REQUIRED');
  check(observation.proposalSha256 === proposalSha256 && observation.blendFile?.sha256 === blendSha256 && same(observation.source, proposal.source) && same(observation.exchange, proposal.exchange), 'BLENDER_OBSERVATION_BINDING_MISMATCH');
  check(same(observation.workflowContext, proposal.workflowContext) && observation.workflowContextSha256 === proposal.workflowContextSha256 && observation.linkedPlanSha256 === proposal.linkedPlanSha256, 'BLENDER_WORKFLOW_READBACK_MISMATCH');
  check(same(observation.coordinates, proposal.coordinates) && observation.sceneId === proposal.sceneId, 'BLENDER_COORDINATE_MISMATCH');
  check(Array.isArray(observation.frames) && observation.frames.length === proposal.frames.length, 'BLENDER_FRAMES_INVALID');
  for (const [index, wanted] of proposal.frames.entries()) {
    const actual = observation.frames[index], camera = actual?.camera;
    check(actual?.id === wanted.id && actual.frame === wanted.frame && actual.shotId === wanted.shotId && actual.cellId === wanted.cellId && actual.cellRole === wanted.cellRole && same(actual.cellActionRefs, wanted.cellActionRefs) && same(actual.sourceActionRefsProposed, wanted.sourceActionRefsProposed), 'BLENDER_FRAME_BINDING_MISMATCH');
    check(camera?.name === proposal.cameraObject && vectorClose(camera.positionMeters, wanted.camera.positionMeters) && vectorClose(camera.scale, [1, 1, 1]), 'BLENDER_CAMERA_TRANSFORM_MISMATCH');
    check(Array.isArray(camera.rotationQuaternionXYZW) && camera.rotationQuaternionXYZW.length === 4 && camera.rotationQuaternionXYZW.every(Number.isFinite) && close(camera.rotationQuaternionXYZW.reduce((s, n) => s + n*n, 0), 1), 'BLENDER_CAMERA_ROTATION_INVALID');
    const [qx, qy, qz, qw] = camera.rotationQuaternionXYZW;
    const rotatedForward = [-2 * (qx*qz + qw*qy), -2 * (qy*qz - qw*qx), -(1 - 2 * (qx*qx + qy*qy))];
    check(vectorClose(camera.forwardWorld, rotatedForward), 'BLENDER_CAMERA_ROTATION_MISMATCH');
    const matrix = camera.matrixWorldRows;
    const expectedMatrix = [
      [1-2*(qy*qy+qz*qz), 2*(qx*qy-qz*qw), 2*(qx*qz+qy*qw), camera.positionMeters[0]],
      [2*(qx*qy+qz*qw), 1-2*(qx*qx+qz*qz), 2*(qy*qz-qx*qw), camera.positionMeters[1]],
      [2*(qx*qz-qy*qw), 2*(qy*qz+qx*qw), 1-2*(qx*qx+qy*qy), camera.positionMeters[2]],
      [0,0,0,1],
    ];
    check(Array.isArray(matrix) && matrix.length === 4 && matrix.every((row, i) => vectorClose(row, expectedMatrix[i])), 'BLENDER_CAMERA_MATRIX_MISMATCH');
    const direction = wanted.camera.lookAtMeters.map((n, i) => n - wanted.camera.positionMeters[i]), length = Math.hypot(...direction);
    check(vectorClose(camera.forwardWorld, direction.map(n => n / length)), 'BLENDER_CAMERA_TARGET_MISMATCH');
    check(close(camera.focalLengthMm, wanted.camera.focalLengthMm) && camera.projection === proposal.lens.projection && camera.gateFit === proposal.lens.gateFit && close(camera.sensorWidthMm, proposal.lens.sensorWidthMm) && close(camera.sensorHeightMm, proposal.lens.sensorHeightMm) && close(camera.shiftX, 0) && close(camera.shiftY, 0), 'BLENDER_LENS_MISMATCH');
    check(same(actual.render, proposal.render), 'BLENDER_RENDER_MISMATCH');
    check(close(actual.proofSampleTimeSeconds, (wanted.frame - 1) / proposal.render.frameRate), 'BLENDER_PROOF_TIMING_MISMATCH');
    check(Array.isArray(actual.objects) && new Set(actual.objects.map(o => o.name)).size === actual.objects.length && actual.objects.length > 5, 'BLENDER_OBJECTS_INVALID');
    for (const [name, standIn] of Object.entries(wanted.standIns)) {
      const obj = actual.objects.find(o => o.name === 'QI_' + name);
      check(obj?.role === 'PROPOSED_STAND_IN' && vectorClose(obj.positionMeters, standIn.positionMeters) && obj.visibleInRender === standIn.visible, 'BLENDER_STAND_IN_MISMATCH');
    }
    const image = imageFiles[wanted.image];
    check(Buffer.isBuffer(image) && image.length >= 32, 'BLENDER_IMAGE_MISMATCH');
    verifyRgbPng(image, proposal.render.widthPixels, proposal.render.heightPixels);
    check(image && actual.image?.widthPixels === proposal.render.widthPixels && actual.image.heightPixels === proposal.render.heightPixels && actual.image?.relativePath === wanted.image && actual.image.sha256 === sha256(image) && actual.image.bytes === image.length && image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && image.readUInt32BE(16) === proposal.render.widthPixels && image.readUInt32BE(20) === proposal.render.heightPixels, 'BLENDER_IMAGE_MISMATCH');
  }
  return { status: 'VERIFIED_LOCAL_BLENDER_BLOCKING_ROUND_TRIP', classification: privateScope.classification, finalMedia: false, ownerReview: 'REQUIRED', frames: observation.frames.length };
}

export const BLENDER_PROOF_FILES = Object.freeze(['camera-exchange.json', 'blocking-proposal.json', 'scene-04-blocking.blend', 'observation.json', 'opening.png', 'later-moment.png', 'create.log', 'inspect.log', 'proof-receipt.json']);

/** Integrity and bounded semantic checks only; caller must bind expected current source/basis and owner import. */
export function verifyBlenderProofFiles(files) {
  check(files && same(Object.keys(files).sort(), [...BLENDER_PROOF_FILES].sort()) && Object.values(files).every(Buffer.isBuffer), 'BLENDER_PROOF_FILES_INVALID');
  check(Object.values(files).reduce((n, b) => n + b.length, 0) <= 32 * 1024 * 1024, 'BLENDER_PROOF_TOO_LARGE');
  const parse = name => { check(files[name].length <= 2 * 1024 * 1024, 'BLENDER_JSON_TOO_LARGE'); return JSON.parse(files[name].toString('utf8')); };
  const exchange = parse('camera-exchange.json'), proposal = parse('blocking-proposal.json'), observation = parse('observation.json'), receipt = parse('proof-receipt.json');
  const expected = buildBlenderBlockingProposal(exchange, sha256(files['camera-exchange.json']), proposal.workflowContext, proposal.linkedPlanSha256);
  check(same(proposal, expected), 'BLENDER_PROPOSAL_CHANGED');
  check(receipt?.schemaVersion === 'filmstack-blender-proof-receipt/v1' && receipt.status === 'VERIFIED_LOCAL_BLENDER_BLOCKING_ROUND_TRIP' && receipt.classification === privateScope.classification && receipt.finalMedia === false && receipt.ownerReview === 'REQUIRED' && same(receipt.source, proposal.source) && same(receipt.exchange, proposal.exchange), 'BLENDER_RECEIPT_BINDING_MISMATCH');
  check(receipt.workflowContextSha256 === proposal.workflowContextSha256 && receipt.linkedPlanSha256 === proposal.linkedPlanSha256, 'BLENDER_RECEIPT_WORKFLOW_MISMATCH');
  check(Array.isArray(receipt.artifacts) && receipt.artifacts.length === BLENDER_PROOF_FILES.length - 1 && same(receipt.artifacts.map(f => f.relativePath).sort(), BLENDER_PROOF_FILES.filter(n => n !== 'proof-receipt.json').sort()), 'BLENDER_RECEIPT_FILES_INVALID');
  for (const f of receipt.artifacts) check(f.sha256 === sha256(files[f.relativePath]) && f.bytes === files[f.relativePath].length, 'BLENDER_ARTIFACT_HASH_MISMATCH');
  check(files['scene-04-blocking.blend'].subarray(0, 7).toString() === 'BLENDER', 'BLENDER_SCENE_SIGNATURE_INVALID');
  check(observation.blendFile?.relativePath === 'scene-04-blocking.blend' && observation.blendFile.bytes === files['scene-04-blocking.blend'].length, 'BLENDER_SCENE_METADATA_MISMATCH');
  verifyBlenderObservation(observation, proposal, { proposalSha256: sha256(files['blocking-proposal.json']), blendSha256: sha256(files['scene-04-blocking.blend']), imageFiles: files });
  return { receipt, observation, exchange, proposal, artifacts: BLENDER_PROOF_FILES.map(relativePath => ({ relativePath, sha256: sha256(files[relativePath]), bytes: files[relativePath].length })) };
}

export function verifyBlenderProof(directory) {
  check(typeof directory === 'string' && path.isAbsolute(directory), 'BLENDER_ABSOLUTE_PATH_REQUIRED');
  const files = {};
  for (const name of BLENDER_PROOF_FILES) { const target = path.join(directory, name); const stat = fs.lstatSync(target); check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024, 'BLENDER_PROOF_FILE_INVALID'); files[name] = fs.readFileSync(target); }
  return verifyBlenderProofFiles(files);
}

async function runOwnedBlender(blender, script, output, mode) {
  const log = fs.openSync(path.join(output, mode + '.log'), 'wx');
  const args = ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '17', '--python', script, '--', '--output', output, '--mode', mode];
  const startedAt = new Date().toISOString();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(blender, args, { stdio: ['ignore', log, log], env: { ...process.env, BLENDER_USER_CONFIG: path.join(output, '.blender-config'), BLENDER_USER_SCRIPTS: path.join(output, '.blender-scripts'), PYTHONNOUSERSITE: '1' } });
      let timedOut = false, interrupted = false, escalation;
      const stop = () => { interrupted = true; child.kill('SIGTERM'); escalation ??= setTimeout(() => child.kill('SIGKILL'), 3000); };
      const timeout = setTimeout(() => { timedOut = true; stop(); }, 180000);
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
      const clean = () => { clearTimeout(timeout); clearTimeout(escalation); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); };
      child.once('error', error => { clean(); reject(error); });
      child.once('exit', (code, signal) => { clean(); if (code !== 0 || interrupted) reject(Object.assign(new Error(timedOut ? 'BLENDER_TIMEOUT' : interrupted ? 'BLENDER_INTERRUPTED' : 'BLENDER_PROCESS_FAILED'), { code: code ?? signal })); else resolve({ mode, pid: child.pid, startedAt, completedAt: new Date().toISOString(), exitCode: code, args }); });
    });
  } finally { fs.closeSync(log); }
}

export async function runBlenderProof({ blender, exchangeFile, output, workflowContextFile, linkedPlanFile }) {
  check([blender, exchangeFile, output].every(value => typeof value === 'string' && path.isAbsolute(value)), 'BLENDER_ABSOLUTE_PATHS_REQUIRED');
  check(fs.statSync(blender).isFile() && fs.statSync(exchangeFile).isFile(), 'BLENDER_INPUT_FILE_REQUIRED');
  check(!(workflowContextFile && linkedPlanFile), 'BLENDER_ONE_WORKFLOW_INPUT_REQUIRED');
  const workflowInput = workflowContextFile ?? linkedPlanFile;
  if (workflowInput !== undefined) check(typeof workflowInput === 'string' && path.isAbsolute(workflowInput) && fs.statSync(workflowInput).isFile() && fs.statSync(workflowInput).size <= 1024 * 1024, 'BLENDER_WORKFLOW_FILE_INVALID');
  const workflowBytes = workflowInput ? fs.readFileSync(workflowInput) : null;
  const exchangeBytes = fs.readFileSync(exchangeFile), exchange = JSON.parse(exchangeBytes), inputHash = sha256(exchangeBytes);
  const supplied = workflowBytes ? JSON.parse(workflowBytes) : undefined;
  const linkedPlanSha256 = linkedPlanFile ? validateLinkedBlenderPlan(supplied, exchange) : undefined;
  const workflowContext = linkedPlanFile ? supplied.workflowContext : supplied;
  const proposal = buildBlenderBlockingProposal(exchange, inputHash, workflowContext, linkedPlanSha256);
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.mkdirSync(output);
  const write = (name, value) => fs.writeFileSync(path.join(output, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  write('camera-exchange.json', exchangeBytes); write('blocking-proposal.json', proposal);
  const script = fileURLToPath(new URL('./blender-proof.py', import.meta.url));
  try {
    const processes = [];
    for (const mode of ['create', 'inspect']) processes.push(await runOwnedBlender(blender, script, output, mode));
    const observation = JSON.parse(fs.readFileSync(path.join(output, 'observation.json'))), blendSha256 = sha256(fs.readFileSync(path.join(output, 'scene-04-blocking.blend'))), proposalSha256 = sha256(fs.readFileSync(path.join(output, 'blocking-proposal.json'))), imageFiles = Object.fromEntries(proposal.frames.map(f => [f.image, fs.readFileSync(path.join(output, f.image))]));
    const verification = verifyBlenderObservation(observation, proposal, { proposalSha256, blendSha256, imageFiles });
    check(sha256(fs.readFileSync(exchangeFile)) === inputHash, 'BLENDER_SOURCE_INPUT_CHANGED');
    if (workflowInput) check(sha256(fs.readFileSync(workflowInput)) === sha256(workflowBytes), 'BLENDER_WORKFLOW_INPUT_CHANGED');
    const artifacts = ['camera-exchange.json', 'blocking-proposal.json', 'scene-04-blocking.blend', 'observation.json', 'opening.png', 'later-moment.png', 'create.log', 'inspect.log'].map(relativePath => { const bytes = fs.readFileSync(path.join(output, relativePath)); return { relativePath, sha256: sha256(bytes), bytes: bytes.length }; });
    const receipt = { schemaVersion: 'filmstack-blender-proof-receipt/v1', ...verification, source: proposal.source, exchange: proposal.exchange, immutableInputPath: exchangeFile, immutableInputUnchanged: true, ...(workflowInput ? { workflowInputPath: workflowInput, workflowInputFileSha256: sha256(workflowBytes), workflowContextSha256: proposal.workflowContextSha256, ...(linkedPlanSha256 ? {linkedPlanSha256} : {}) } : {}), adapterSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))), blenderScriptSha256: sha256(fs.readFileSync(script)), processes, artifacts, limitations: proposal.limitations };
    write('proof-receipt.json', receipt); return receipt;
  } catch (error) { write('failed-attempt.json', { result: 'FAILED', message: error.message, code: String(error.code ?? ''), sourceInputUnchanged: sha256(fs.readFileSync(exchangeFile)) === inputHash, partialFilesRetained: true }); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); check((args.length === 6 || (args.length === 8 && ['--workflow-context','--linked-plan'].includes(args[6]))) && args[0] === '--blender' && args[2] === '--exchange' && args[4] === '--output', 'BLENDER_USAGE');
    const receipt = await runBlenderProof({ blender: args[1], exchangeFile: args[3], output: args[5], ...(args[6] === '--workflow-context' ? {workflowContextFile:args[7]} : args[6] === '--linked-plan' ? {linkedPlanFile:args[7]} : {}) });
    process.stdout.write(JSON.stringify({ status: receipt.status, output: args[5], finalMedia: false, ownerReview: 'REQUIRED' }) + '\n');
  } catch (error) { process.stderr.write(JSON.stringify({ error: error.message, code: String(error.code ?? '') }) + '\n'); process.exitCode = 1; }
}
