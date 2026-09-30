import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createInitialTitleState,
  createPolicy,
  openRuntime,
} from "./index.mjs";

const now = Date.UTC(2026, 7, 30, 22, 30, 0);
const titleId = "synthetic-source-intake-title";
const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/synthetic-intentional-export.fountain",
);
const fixtureBytes = fs.readFileSync(fixturePath);
const expectedBlobSha256 = crypto.createHash("sha256").update(fixtureBytes).digest("hex");
const title = createInitialTitleState({ titleId });
const policy = createPolicy({
  version: "synthetic-source-intake-policy-v1",
  actors: {
    producer: {
      aggregate_ids: [titleId],
      allowed_operations: ["UPSERT_FACT"],
      max_risk: "R1",
    },
  },
  trusted_verifiers: { "domain-invariants": "1.0.0" },
  base_required_verifiers: ["domain-invariants"],
  risk_required_verifiers: {},
  operation_risk: { UPSERT_FACT: "R1" },
});
const runtime = openRuntime({
  policy,
  clock: () => now,
  initialAggregates: [title],
  sourceIntakeMode: "SYNTHETIC_FIXTURE",
});

const before = runtime.readModel.getAggregate(titleId);
const beforeEvents = runtime.readModel.listEvents().length;
const observation = await runtime.sourceIntake.observeFile({
  filePath: fixturePath,
  observationId: "synthetic-source-observation",
  intakeCaseId: "synthetic-source-intake-case",
  sourceKindClaim: "SYNTHETIC_FIXTURE",
  claimedCustodianId: "hampton-test-harness",
  declaredFormat: "FOUNTAIN",
});
const verification = runtime.sourceIntake.verifyObservation({
  observationId: observation.observation_id,
  verificationReportId: "synthetic-source-verification",
  expectedBlobSha256,
});
const candidate = runtime.sourceIntake.createAdmissionCandidate({
  observationId: observation.observation_id,
  verificationReportId: verification.verification_report_id,
  admissionCandidateId: "synthetic-source-admission-candidate",
  titleId,
  proposedRevisionId: "synthetic-source-revision-v1",
  sourceTitleClaim: "Synthetic Intentional Export Fixture",
});
const after = runtime.readModel.getAggregate(titleId);

process.stdout.write(`${JSON.stringify({
  boundary: "SYNTHETIC_FIXTURE_ONLY",
  observation: {
    observation_id: observation.observation_id,
    observation_hash: observation.observation_hash,
    blob_sha256: observation.blob_sha256,
    byte_length: observation.byte_length,
    quarantine_state: observation.quarantine_state,
    authority_state: observation.authority_state,
    admission_state: observation.admission_state,
  },
  technical_verification: {
    verification_report_id: verification.verification_report_id,
    verification_report_hash: verification.verification_report_hash,
    technical_result: verification.technical_result,
    authority_state: verification.authority_state,
    admission_decision: verification.admission_decision,
  },
  admission_candidate: {
    admission_candidate_id: candidate.admission_candidate_id,
    admission_candidate_hash: candidate.admission_candidate_hash,
    candidate_state: candidate.candidate_state,
    authority_state: candidate.authority_state,
    unresolved_controls: candidate.unresolved_controls,
  },
  authoritative_title_state_unchanged:
    before.version === after.version && before.state_hash === after.state_hash,
  title_version: after.version,
  title_state_hash: after.state_hash,
  evidence_refs: after.state.evidence_refs,
  audit_event_count_unchanged: runtime.readModel.listEvents().length === beforeEvents,
  production_gate_status: after.state.gates.production.status,
  production_gate_effect: candidate.production_gate_effect,
}, null, 2)}\n`);

runtime.close();
