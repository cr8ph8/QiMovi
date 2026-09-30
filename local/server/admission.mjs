import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sealProposal, sealVerifierReceipt } from '../kernel/src/index.mjs';
import { check, sha256, canonical, privateDirectory, atomicPrivateFile } from './storage.mjs';
import { openOwnerKernel } from './kernel.mjs';

const controls = [
  ['sourceAuthority', 'SOURCE_AUTHORITY', 'I am authorized to identify this exact file as the project source.'],
  ['intentionalExport', 'INTENTIONAL_EXPORT', 'I intentionally selected this exact export, rather than an autosave or cache file.'],
  ['creativeApproval', 'CREATIVE_APPROVAL', 'I approve this exact source for the bounded local eight-scene film workflow.'],
  ['titleRevisionIdentity', 'TITLE_REVISION_IDENTITY', 'I reviewed the title and revision identity against this exact file.'],
  ['rightsBasis', 'RIGHTS_BASIS', 'I reviewed and describe my asserted basis for using this exact source in the local film.'],
];
export function prepareControls({ project, sourceFile, output }) {
  const bytes = fs.readFileSync(sourceFile);
  check(sha256(bytes) === project.sourceHash, 'SOURCE_DOES_NOT_MATCH_PROJECT');
  check(!fs.existsSync(output), 'CONTROLS_DESTINATION_EXISTS', 409);
  privateDirectory(output);
  const manifest = { schema_version: 'filmstack-local-source-admission/v1', projectId: project.id, sourceSha256: project.sourceHash,
    revisionId: 'owner-selected-revision-1', title: project.title, controls: {} };
  for (const [key, kind, prompt] of controls) {
    const name = `${key}.json`;
    manifest.controls[key] = name;
    atomicPrivateFile(path.join(output, name), JSON.stringify({ schema_version: 'filmstack-local-owner-control/v1', kind,
      recordId: `owner-control-${key}-${crypto.randomUUID()}`, projectId: project.id, sourceSha256: project.sourceHash,
      actorId: 'local-owner', approved: false, reviewedAt: null, statement: '', prompt,
      ...(key === 'rightsBasis' ? { rightsBasisKind: 'AUTHORSHIP_ASSERTION' } : {}),
    }, null, 2) + '\n');
  }
  atomicPrivateFile(path.join(output, 'admission.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest: path.join(output, 'admission.json'), state: 'PENDING_OWNER_REVIEW', forms: 5 };
}
export async function admitSource({ directory, project, sourceFile, controlsFile }) {
  const manifestBytes = fs.readFileSync(controlsFile);
  check(manifestBytes.length <= 64 * 1024, 'ADMISSION_MANIFEST_TOO_LARGE');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const sourceBytes = fs.readFileSync(sourceFile);
  const sourceHash = sha256(sourceBytes);
  check(manifest.schema_version === 'filmstack-local-source-admission/v1' && manifest.projectId === project.id && manifest.sourceSha256 === project.sourceHash && sourceHash === project.sourceHash, 'SOURCE_BINDING_MISMATCH');
  check(typeof manifest.revisionId === 'string' && /^[a-zA-Z0-9][\w.:-]{0,159}$/.test(manifest.revisionId) && manifest.title === project.title, 'TITLE_REVISION_BINDING_MISMATCH');
  check(manifest.controls && Object.keys(manifest.controls).sort().join(',') === controls.map(c => c[0]).sort().join(','), 'ALL_FIVE_CONTROLS_REQUIRED');
  const root = fs.realpathSync(path.dirname(controlsFile));
  const reviewed = {};
  const recordIds = new Set();
  for (const [key, kind] of controls) {
    const name = manifest.controls[key];
    check(typeof name === 'string' && /^[A-Za-z0-9._-]+\.json$/.test(name), 'CONTROL_PATH_REJECTED');
    const filename = fs.realpathSync(path.join(root, name));
    check(filename.startsWith(root + path.sep), 'CONTROL_PATH_ESCAPES_ROOT');
    const bytes = fs.readFileSync(filename);
    check(bytes.length <= 64 * 1024, 'CONTROL_TOO_LARGE');
    const body = JSON.parse(bytes.toString('utf8'));
    check(body.schema_version === 'filmstack-local-owner-control/v1' && body.kind === kind && body.projectId === project.id && body.sourceSha256 === sourceHash && body.actorId === 'local-owner', 'CONTROL_BINDING_MISMATCH');
    check(body.approved === true && typeof body.statement === 'string' && body.statement.trim().length >= 20 && !/TODO|PLACEHOLDER|fill\s+in/i.test(body.statement), 'OWNER_CONTROL_NOT_APPROVED');
    check(typeof body.recordId === 'string' && /^[A-Za-z0-9][\w.:-]{0,159}$/.test(body.recordId), 'CONTROL_ID_INVALID');
    check(!recordIds.has(body.recordId), 'DUPLICATE_CONTROL_ID'); recordIds.add(body.recordId);
    check(typeof body.reviewedAt === 'string' && Number.isFinite(Date.parse(body.reviewedAt)) && Date.parse(body.reviewedAt) <= Date.now(), 'CONTROL_REVIEW_TIME_INVALID');
    reviewed[key] = { body, bytes, sha256: sha256(bytes) };
  }
  const { runtime, policy } = openOwnerKernel(directory, project);
  try {
    check(!runtime.readModel.getAggregate(project.id).state.facts['source.revision'], 'SOURCE_ALREADY_ADMITTED_SUPERSESSION_NOT_IMPLEMENTED', 409);
    const id = crypto.randomUUID();
    const observation = await runtime.sourceIntake.observeFile({ filePath: sourceFile, observationId: `observation-${id}`, intakeCaseId: `intake-${id}`, sourceKindClaim: 'INTENTIONAL_EXPORT', claimedCustodianId: 'local-owner', declaredFormat: 'FDX' });
    check(observation.blob_sha256 === sourceHash, 'SOURCE_CHANGED_DURING_ADMISSION');
    const report = runtime.sourceIntake.verifyObservation({ observationId: observation.observation_id, verificationReportId: `verification-${id}`, expectedBlobSha256: sourceHash });
    const candidate = runtime.sourceIntake.createAdmissionCandidate({ observationId: observation.observation_id, verificationReportId: report.verification_report_id,
      admissionCandidateId: `candidate-${id}`, titleId: project.id, proposedRevisionId: manifest.revisionId, sourceTitleClaim: project.title });
    const preview = runtime.sourceAdmissionEvaluator.preview({ admissionCandidateId: candidate.admission_candidate_id, admissionRecordId: `admission-${id}`, admittedByActorId: 'local-owner',
      sourceAuthorityActorId: 'local-owner', sourceAuthorityRecordId: reviewed.sourceAuthority.body.recordId, sourceAuthorityRecordHash: reviewed.sourceAuthority.sha256,
      intentionalExportAttestorId: 'local-owner', intentionalExportAttestationId: reviewed.intentionalExport.body.recordId, intentionalExportAttestationHash: reviewed.intentionalExport.sha256,
      creativeApproverId: 'local-owner', creativeApprovalId: reviewed.creativeApproval.body.recordId, creativeApprovalHash: reviewed.creativeApproval.sha256,
      titleRevisionIdentityReviewerId: 'local-owner', titleRevisionIdentityRecordId: reviewed.titleRevisionIdentity.body.recordId, titleRevisionIdentityRecordHash: reviewed.titleRevisionIdentity.sha256,
      rightsControllerId: 'local-owner', rightsBasisKind: reviewed.rightsBasis.body.rightsBasisKind, rightsRecordId: reviewed.rightsBasis.body.recordId, rightsRecordHash: reviewed.rightsBasis.sha256,
      evidenceId: `source-evidence-${id}`, decisionReasonCodes: ['OWNER_REVIEWED_EXACT_LOCAL_SOURCE_CONTROLS'] });
    const proposal = sealProposal({ proposal_id: `proposal-${id}`, actor_id: 'local-owner', target_aggregate_id: project.id,
      intent: 'Admit the owner-reviewed first local source revision; production and spend authority remain unchanged.',
      base_state_version: preview.title_state.version, base_state_hash: preview.title_state.state_hash, delta: [preview.operation], evidence_refs: [], declared_risk: 'R3',
      idempotency_key: `admit-${id}`, created_at_ms: preview.evaluated_at_ms, expires_at_ms: preview.evaluated_at_ms + 60_000 });
    const receipts = ['local-source-bindings', 'owner-reviewed-source-controls'].map(verifier => sealVerifierReceipt({ receipt_id: `${verifier}-${id}`, verifier_id: verifier,
      verifier_version: '1.0.0', proposal_hash: proposal.proposal_hash, base_state_version: preview.title_state.version, base_state_hash: preview.title_state.state_hash,
      policy_version: policy.version, verdict: 'PASS', reason_codes: ['EXACT_BYTES_AND_OWNER_ATTESTATIONS_CHECKED_NOT_EXTERNAL_RIGHTS_VERIFICATION'],
      issued_at_ms: preview.evaluated_at_ms, expires_at_ms: preview.evaluated_at_ms + 60_000 }));
    const archive = privateDirectory(path.join(directory, 'admissions', id));
    atomicPrivateFile(path.join(archive, 'admission-input.json'), manifestBytes);
    for (const [key] of controls) atomicPrivateFile(path.join(archive, `${key}.json`), reviewed[key].bytes);
    atomicPrivateFile(path.join(archive, 'proposal.json'), canonical(proposal));
    atomicPrivateFile(path.join(archive, 'receipts.json'), canonical(receipts));
    const result = runtime.kernel.decide({ authenticated_actor_id: 'local-owner', proposal, receipts });
    atomicPrivateFile(path.join(archive, 'result.json'), canonical(result));
    check(result.decision === 'COMMIT', `KERNEL_${result.decision}`, 409);
    return { decision: result.decision, admissionId: preview.admission_record.admission_record_id, state: runtime.readModel.getAggregate(project.id), archive };
  } finally { runtime.close(); }
}
