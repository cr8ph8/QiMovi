import fs from 'node:fs';
import { canonical, sha256 } from '../../server/storage.mjs';

export const BLENDER_OPERATION_ID = 'qimovi.blender.rehearsal';
export const BLENDER_OPERATION_VERSION = '1.1.0';
// An explicit, bounded source receipt. This is not a claim to hash the whole
// application, loaded JavaScript modules, Blender binary or machine environment.
export const BLENDER_OPERATION_FILES = Object.freeze([
  'integrations/three-d/blender-operation.mjs',
  'integrations/three-d/blender-stage.py',
  'integrations/three-d/blender-stage-return.py',
  'integrations/three-d/blender-stage-reopen.py',
  'integrations/three-d/exchange.mjs',
  'integrations/three-d/stage-kit.mjs',
  'integrations/three-d/stage-return.mjs',
  'integrations/three-d/previz-brief.mjs',
  'server/blender-mcp.mjs',
  'server/dcc-rehearsals.mjs',
  'server/dcc-stage-returns.mjs',
  'server/storage.mjs',
  'contracts/dcc-return-origin.mjs',
  'contracts/drifter.mjs',
  'kernel/src/canonical-json.mjs',
].sort());
const sourceRoot = new URL('../../', import.meta.url);
const sourceBytes = name => fs.readFileSync(new URL(name, sourceRoot));

/** Read only. readSource is a module-level test seam, never an API input. */
export function describeBlenderOperation({ readSource = sourceBytes } = {}) {
  const files = BLENDER_OPERATION_FILES.map(path => ({ path: `local/${path}`, sha256: sha256(readSource(path)) }));
  return {
    schema: 'qimovi-local-operation/v1', id: BLENDER_OPERATION_ID, version: BLENDER_OPERATION_VERSION,
    implementation: { sha256: sha256(canonical({ id: BLENDER_OPERATION_ID, version: BLENDER_OPERATION_VERSION, files })), files,
      basis: 'CURRENT_SOURCE_FILES_ON_DISK', runtimeBinaryIncluded: false, loadedModulesAttested: false },
    outputs: [
      { role: 'OPENING', format: 'PNG' }, { role: 'MOMENT', format: 'PNG' }, { role: 'ENDING', format: 'PNG' },
      { role: 'EDITABLE_SCENE', format: 'BLEND' }, { role: 'REOPEN_EVIDENCE', format: 'JSON' },
    ],
    limits: [
      'One owned local background Blender rehearsal at a time.',
      'Opening, midpoint and ending are three 1920 × 1080 stills; no continuous video or measured movie duration.',
      'Planned duration is 1–180 seconds at 24 fps; camera motion is STATIC, DOLLY_IN or DOLLY_OUT.',
      'Generic blocking uses the exact retained source, shot and selected options; no active editor or phone-camera connection.',
      'Recorded reopen evidence describes a historical execution. Preparation checks executable availability without rehashing the installed binary.',
      'Returned previews remain pending review. No provider call, production approval, reference rights or final-film acceptance.',
    ],
    approvalGranted: false, finalMedia: false,
  };
}

/** A projection of existing job receipts, not a new approval or evidence store. */
export function qualifyBlenderOperation({ kit, options, operation, jobs, runtime, verifyRetained }) {
  const scoped = jobs.filter(job => job.projectId === kit.projectId && job.sourceHash === kit.sourceHash && job.sceneId === kit.sceneId && job.shotId === kit.shotId)
    .sort((a, b) => b.createdAt - a.createdAt || b.version - a.version);
  const optionsSha256 = sha256(canonical(options));
  const exact = scoped.filter(job => job.kitSha256 === kit.sha256 && job.optionsSha256 === optionsSha256);
  const candidate = exact[0] ?? scoped[0] ?? null;
  const base = { status: 'NOT_RUN', reason: 'NO_RECORDED_JOB_FOR_THIS_SHOT', jobId: candidate?.jobId ?? null,
    recordedAt: candidate?.updatedAt ?? null, receiptSha256: candidate?.sha256 ?? null,
    reopenEvidenceSha256: candidate?.reopenEvidenceSha256 ?? null, implementationSha256: operation.implementation.sha256,
    runtime: { status: runtime?.available ? 'EXECUTABLE_AVAILABLE' : 'UNAVAILABLE', currentBinaryRehashed: false,
      recordedSha256: candidate?.runtimeSha256 ?? null }, approvalGranted: false, finalMedia: false };
  if (!candidate) return base;
  const pending = reason => ({ ...base, status: 'NEEDS_REQUALIFICATION', reason });
  if (!candidate.implementationSha256 || !candidate.optionsSha256) return pending('LEGACY_JOB_WITHOUT_IMPLEMENTATION_BINDING');
  if (candidate.kitSha256 !== kit.sha256 || candidate.optionsSha256 !== optionsSha256) return pending('PREPARED_INPUTS_CHANGED');
  if (candidate.operationId !== operation.id || candidate.operationVersion !== operation.version || candidate.implementationSha256 !== operation.implementation.sha256) return pending('IMPLEMENTATION_CHANGED');
  if (candidate.phase !== 'RETAINED' || candidate.executionVerified !== true || candidate.reopenedVerified !== true
    || candidate.approvalGranted !== false || candidate.finalMedia !== false) return pending('NO_SUCCESSFUL_RETAINED_REOPEN');
  try { verifyRetained(candidate); } catch { return pending('RETAINED_EVIDENCE_UNAVAILABLE'); }
  return { ...base, status: 'RECORDED_REOPEN', reason: 'MATCHING_RECORDED_REOPEN_EVIDENCE_RECHECKED' };
}
