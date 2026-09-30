import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

import {
  assertSha256,
  canonicalJson,
  cloneCanonical,
  hashCanonical,
  timingSafeHashEqual,
} from "./canonical-json.mjs";
import { DECISIONS, GENESIS_HASH, SCHEMA } from "./constants.mjs";
import {
  validateAggregateState,
  validateEvidenceEnvelope,
  validateTitleGenesis,
} from "./contracts.mjs";
import { KernelError, invariant } from "./errors.mjs";
import {
  validateSourceAdmissionCandidate,
  validateSourceObservation,
  validateSourceVerificationReport,
} from "./source-intake.mjs";
import { sourceRevisionProjection, validateSourceAdmissionRecord } from "./source-admission.mjs";

function eventHashPayload(event) {
  const payload = cloneCanonical(event);
  delete payload.event_hash;
  return payload;
}

function parseJson(text) {
  return JSON.parse(text);
}

function aggregateFromRow(row) {
  const envelope = parseJson(row.envelope_json);
  invariant(
    row.aggregate_id === envelope.aggregate_id
      && row.version === envelope.version
      && row.state_hash === envelope.state_hash,
    "STORAGE_PROJECTION_MISMATCH",
    "Aggregate index columns do not match the stored canonical envelope.",
    { aggregate_id: row.aggregate_id },
  );
  return cloneCanonical(envelope);
}

function eventFromRow(row) {
  const event = parseJson(row.event_json);
  invariant(
    row.sequence === event.sequence
      && row.event_id === event.event_id
      && row.event_hash === event.event_hash
      && row.previous_event_hash === event.previous_event_hash
      && row.aggregate_id === event.aggregate_id
      && row.event_type === event.event_type
      && row.occurred_at_ms === event.occurred_at_ms,
    "STORAGE_PROJECTION_MISMATCH",
    "Event index columns do not match the stored canonical event.",
    { sequence: row.sequence },
  );
  return cloneCanonical(event);
}

function sourceObservationFromRow(row) {
  const observation = parseJson(row.observation_json);
  validateSourceObservation(observation);
  invariant(
    row.observation_id === observation.observation_id
      && row.observation_hash === observation.observation_hash
      && row.blob_sha256 === observation.blob_sha256
      && row.byte_length === observation.byte_length
      && row.intake_case_id === observation.intake_case_id
      && row.observation_json === canonicalJson(observation),
    "STORAGE_PROJECTION_MISMATCH",
    "Source-observation index columns do not match the stored canonical record.",
    { observation_id: row.observation_id },
  );
  return cloneCanonical(observation);
}

function sourceVerificationReportFromRow(row) {
  const report = parseJson(row.report_json);
  validateSourceVerificationReport(report);
  invariant(
    row.verification_report_id === report.verification_report_id
      && row.verification_report_hash === report.verification_report_hash
      && row.observation_id === report.observation_id
      && row.observation_hash === report.observation_hash
      && row.blob_sha256 === report.blob_sha256
      && row.byte_length === report.byte_length
      && row.report_json === canonicalJson(report),
    "STORAGE_PROJECTION_MISMATCH",
    "Source-verification index columns do not match the stored canonical record.",
    { verification_report_id: row.verification_report_id },
  );
  return cloneCanonical(report);
}

function sourceAdmissionCandidateFromRow(row) {
  const candidate = parseJson(row.candidate_json);
  validateSourceAdmissionCandidate(candidate);
  invariant(
    row.admission_candidate_id === candidate.admission_candidate_id
      && row.admission_candidate_hash === candidate.admission_candidate_hash
      && row.observation_id === candidate.observation_id
      && row.observation_hash === candidate.observation_hash
      && row.verification_report_id === candidate.verification_report_id
      && row.verification_report_hash === candidate.verification_report_hash
      && row.blob_sha256 === candidate.blob_sha256
      && row.byte_length === candidate.byte_length
      && row.intake_case_id === candidate.intake_case_id
      && row.title_id === candidate.title_id
      && row.candidate_json === canonicalJson(candidate),
    "STORAGE_PROJECTION_MISMATCH",
    "Source-admission-candidate index columns do not match the stored canonical record.",
    { admission_candidate_id: row.admission_candidate_id },
  );
  return cloneCanonical(candidate);
}

function sourceAdmissionRecordFromRow(row) {
  const record = parseJson(row.admission_json);
  validateSourceAdmissionRecord(record);
  invariant(
    row.admission_record_id === record.admission_record_id
      && row.admission_record_hash === record.admission_record_hash
      && row.admission_candidate_id === record.admission_candidate_id
      && row.admission_candidate_hash === record.admission_candidate_hash
      && row.observation_id === record.observation_id
      && row.verification_report_id === record.verification_report_id
      && row.blob_sha256 === record.blob_sha256
      && row.byte_length === record.byte_length
      && row.title_id === record.title_id
      && row.evidence_id === record.admitted_evidence.evidence_id
      && row.evidence_hash === record.admitted_evidence.evidence_hash
      && row.admission_json === canonicalJson(record),
    "STORAGE_PROJECTION_MISMATCH",
    "Source-admission-record index columns do not match the stored canonical record.",
    { admission_record_id: row.admission_record_id },
  );
  return cloneCanonical(record);
}

export class RuntimeDatabase {
  #database;
  #kernelToken;
  #evidenceToken;
  #sourceIntakeToken;
  #clockToken;

  constructor({ filename, kernelToken, evidenceToken, sourceIntakeToken, clockToken }) {
    invariant(typeof sourceIntakeToken === "symbol", "SOURCE_INTAKE_TOKEN_REQUIRED", "A private source-intake token is required.");
    this.#database = new DatabaseSync(filename);
    this.#kernelToken = kernelToken;
    this.#evidenceToken = evidenceToken;
    this.#sourceIntakeToken = sourceIntakeToken;
    this.#clockToken = clockToken;
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    if (filename !== ":memory:") {
      this.#database.exec("PRAGMA journal_mode = WAL");
      this.#database.exec("PRAGMA synchronous = FULL");
    }
    this.#migrate();
  }

  #migrate() {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS aggregates (
        aggregate_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL CHECK (version >= 0),
        state_hash TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS evidence_envelopes (
        evidence_id TEXT PRIMARY KEY,
        evidence_hash TEXT NOT NULL UNIQUE,
        scope_aggregate_id TEXT NOT NULL,
        evidence_state TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS source_blobs (
        blob_sha256 TEXT PRIMARY KEY CHECK (length(blob_sha256) = 64),
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        blob_bytes BLOB NOT NULL CHECK (length(blob_bytes) = byte_length),
        recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
        UNIQUE (blob_sha256, byte_length)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS source_observations (
        observation_id TEXT PRIMARY KEY,
        observation_hash TEXT NOT NULL UNIQUE CHECK (length(observation_hash) = 64),
        blob_sha256 TEXT NOT NULL CHECK (length(blob_sha256) = 64),
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        intake_case_id TEXT NOT NULL,
        observation_json TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
        UNIQUE (observation_id, observation_hash, blob_sha256, byte_length),
        UNIQUE (observation_id, observation_hash, blob_sha256, byte_length, intake_case_id),
        FOREIGN KEY (blob_sha256, byte_length)
          REFERENCES source_blobs (blob_sha256, byte_length)
          ON UPDATE RESTRICT ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS source_observations_by_intake_case
      ON source_observations (intake_case_id, observation_id);

      CREATE TABLE IF NOT EXISTS source_verification_reports (
        verification_report_id TEXT PRIMARY KEY,
        verification_report_hash TEXT NOT NULL UNIQUE CHECK (length(verification_report_hash) = 64),
        observation_id TEXT NOT NULL,
        observation_hash TEXT NOT NULL CHECK (length(observation_hash) = 64),
        blob_sha256 TEXT NOT NULL CHECK (length(blob_sha256) = 64),
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        report_json TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
        UNIQUE (
          verification_report_id, verification_report_hash,
          observation_id, observation_hash, blob_sha256, byte_length
        ),
        FOREIGN KEY (observation_id, observation_hash, blob_sha256, byte_length)
          REFERENCES source_observations (
            observation_id, observation_hash, blob_sha256, byte_length
          ) ON UPDATE RESTRICT ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS source_verification_reports_by_observation
      ON source_verification_reports (observation_id, verification_report_id);

      CREATE TABLE IF NOT EXISTS source_admission_candidates (
        admission_candidate_id TEXT PRIMARY KEY,
        admission_candidate_hash TEXT NOT NULL UNIQUE CHECK (length(admission_candidate_hash) = 64),
        observation_id TEXT NOT NULL,
        observation_hash TEXT NOT NULL CHECK (length(observation_hash) = 64),
        verification_report_id TEXT NOT NULL,
        verification_report_hash TEXT NOT NULL CHECK (length(verification_report_hash) = 64),
        blob_sha256 TEXT NOT NULL CHECK (length(blob_sha256) = 64),
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        intake_case_id TEXT NOT NULL,
        title_id TEXT NOT NULL,
        candidate_json TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
        FOREIGN KEY (observation_id, observation_hash, blob_sha256, byte_length, intake_case_id)
          REFERENCES source_observations (
            observation_id, observation_hash, blob_sha256, byte_length, intake_case_id
          ) ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (
          verification_report_id, verification_report_hash,
          observation_id, observation_hash, blob_sha256, byte_length
        ) REFERENCES source_verification_reports (
          verification_report_id, verification_report_hash,
          observation_id, observation_hash, blob_sha256, byte_length
        ) ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (title_id)
          REFERENCES aggregates (aggregate_id)
          ON UPDATE RESTRICT ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS source_admission_candidates_by_intake_case
      ON source_admission_candidates (intake_case_id, admission_candidate_id);

      CREATE INDEX IF NOT EXISTS source_admission_candidates_by_title
      ON source_admission_candidates (title_id, admission_candidate_id)
      WHERE title_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS source_admission_records (
        admission_record_id TEXT PRIMARY KEY,
        admission_record_hash TEXT NOT NULL UNIQUE CHECK (length(admission_record_hash) = 64),
        admission_candidate_id TEXT NOT NULL,
        admission_candidate_hash TEXT NOT NULL CHECK (length(admission_candidate_hash) = 64),
        observation_id TEXT NOT NULL,
        verification_report_id TEXT NOT NULL,
        blob_sha256 TEXT NOT NULL CHECK (length(blob_sha256) = 64),
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        title_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL UNIQUE,
        evidence_hash TEXT NOT NULL UNIQUE CHECK (length(evidence_hash) = 64),
        admission_json TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
        FOREIGN KEY (admission_candidate_id)
          REFERENCES source_admission_candidates (admission_candidate_id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (observation_id)
          REFERENCES source_observations (observation_id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (verification_report_id)
          REFERENCES source_verification_reports (verification_report_id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (blob_sha256, byte_length)
          REFERENCES source_blobs (blob_sha256, byte_length)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (title_id)
          REFERENCES aggregates (aggregate_id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (evidence_id)
          REFERENCES evidence_envelopes (evidence_id)
          ON UPDATE RESTRICT ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS source_admission_records_by_title
      ON source_admission_records (title_id, admission_record_id);

      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        event_hash TEXT NOT NULL UNIQUE,
        previous_event_hash TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_json TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS idempotency_results (
        authenticated_actor_id TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        proposal_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        PRIMARY KEY (authenticated_actor_id, aggregate_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS runtime_metadata (
        key TEXT PRIMARY KEY,
        integer_value INTEGER NOT NULL CHECK (integer_value >= 0)
      ) STRICT;

      INSERT OR IGNORE INTO runtime_metadata (key, integer_value)
      VALUES ('clock_high_water_ms', 0);
    `);
  }

  close() {
    this.#database.close();
  }

  #assertKernel(token) {
    invariant(token === this.#kernelToken, "CANONICAL_WRITE_FORBIDDEN", "Only the transaction kernel may write authoritative state or decision history.");
  }

  #assertEvidenceIntake(token) {
    invariant(token === this.#evidenceToken, "EVIDENCE_WRITE_FORBIDDEN", "Only the evidence intake service may append evidence envelopes.");
  }

  #assertSourceIntake(token) {
    invariant(token === this.#sourceIntakeToken, "SOURCE_INTAKE_WRITE_FORBIDDEN", "Only the source-intake service may append source records.");
  }

  #assertClock(token) {
    invariant(token === this.#clockToken, "CLOCK_WRITE_FORBIDDEN", "Only the trusted clock boundary may advance runtime time.");
  }

  sampleClock(token, observedAtMs) {
    this.#assertClock(token);
    invariant(Number.isSafeInteger(observedAtMs) && observedAtMs >= 0, "INVALID_CLOCK", "Clock samples must be non-negative safe integers.");
    this.#database.prepare(`
      UPDATE runtime_metadata
      SET integer_value = max(integer_value, ?)
      WHERE key = 'clock_high_water_ms'
    `).run(observedAtMs);
    const row = this.#database.prepare(`
      SELECT integer_value FROM runtime_metadata
      WHERE key = 'clock_high_water_ms'
    `).get();
    return row.integer_value;
  }

  #clockHighWater() {
    return this.#database.prepare(`
      SELECT integer_value FROM runtime_metadata
      WHERE key = 'clock_high_water_ms'
    `).get().integer_value;
  }

  #begin() {
    this.#database.exec("BEGIN IMMEDIATE");
  }

  #commit() {
    this.#database.exec("COMMIT");
  }

  #rollback() {
    try {
      this.#database.exec("ROLLBACK");
    } catch {
      // No active transaction.
    }
  }

  #nextEventMetadata() {
    const row = this.#database.prepare(`
      SELECT sequence, event_id, event_hash, previous_event_hash, aggregate_id,
             event_type, event_json, occurred_at_ms
      FROM events ORDER BY sequence DESC LIMIT 1
    `).get();
    const event = row ? eventFromRow(row) : null;
    return {
      sequence: event ? event.sequence + 1 : 1,
      previous_event_hash: event ? event.event_hash : GENESIS_HASH,
    };
  }

  #appendEvent(draft) {
    const metadata = this.#nextEventMetadata();
    const withoutHash = cloneCanonical({
      schema_version: SCHEMA.event,
      sequence: metadata.sequence,
      event_id: `evt-${String(metadata.sequence).padStart(12, "0")}`,
      event_type: draft.event_type,
      aggregate_id: draft.aggregate_id,
      occurred_at_ms: draft.occurred_at_ms,
      proposal_id: draft.proposal_id,
      proposal_hash: draft.proposal_hash,
      decision: draft.decision,
      reason_codes: [...draft.reason_codes].sort(),
      effective_risk: draft.effective_risk,
      receipt_hashes: [...draft.receipt_hashes].sort(),
      delta: draft.delta,
      genesis_state: draft.genesis_state,
      state_before_version: draft.state_before_version,
      state_before_hash: draft.state_before_hash,
      state_after_version: draft.state_after_version,
      state_after_hash: draft.state_after_hash,
      previous_event_hash: metadata.previous_event_hash,
    });
    const event = { ...withoutHash, event_hash: hashCanonical(withoutHash) };
    this.#database.prepare(`
      INSERT INTO events (
        sequence, event_id, event_hash, previous_event_hash, aggregate_id,
        event_type, event_json, occurred_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.sequence,
      event.event_id,
      event.event_hash,
      event.previous_event_hash,
      event.aggregate_id,
      event.event_type,
      canonicalJson(event),
      event.occurred_at_ms,
    );
    return event;
  }

  bootstrapAggregate(token, envelope, occurredAtMs) {
    this.bootstrapAggregates(token, [envelope], occurredAtMs);
    return this.getAggregate(envelope.aggregate_id);
  }

  bootstrapAggregates(token, envelopes, occurredAtMs) {
    this.#assertKernel(token);
    invariant(Array.isArray(envelopes) && envelopes.length > 0, "INVALID_GENESIS", "Genesis batch must contain at least one aggregate.");
    for (const envelope of envelopes) validateTitleGenesis(envelope, { allowLegacy: false });
    const ids = envelopes.map((envelope) => envelope.aggregate_id);
    invariant(new Set(ids).size === ids.length, "DUPLICATE_GENESIS", "Genesis batch contains duplicate aggregate identities.");
    this.#begin();
    try {
      invariant(occurredAtMs >= this.#clockHighWater(), "STALE_CLOCK_SAMPLE", "Genesis clock sample is older than the persisted clock high-water mark.");
      for (const envelope of envelopes) {
        this.#database.prepare(`
          INSERT INTO aggregates (aggregate_id, version, state_hash, envelope_json, updated_at_ms)
          VALUES (?, ?, ?, ?, ?)
        `).run(envelope.aggregate_id, envelope.version, envelope.state_hash, canonicalJson(envelope), occurredAtMs);
        this.#appendEvent({
          event_type: "GENESIS",
          aggregate_id: envelope.aggregate_id,
          occurred_at_ms: occurredAtMs,
          proposal_id: null,
          proposal_hash: null,
          decision: null,
          reason_codes: [],
          effective_risk: null,
          receipt_hashes: [],
          delta: [],
          genesis_state: envelope,
          state_before_version: null,
          state_before_hash: null,
          state_after_version: envelope.version,
          state_after_hash: envelope.state_hash,
        });
      }
      this.#commit();
    } catch (error) {
      this.#rollback();
      if (String(error.message).includes("UNIQUE constraint failed")) {
        throw new KernelError("AGGREGATE_ALREADY_EXISTS", "One or more genesis aggregates already exist.");
      }
      throw error;
    }
    return envelopes.map((envelope) => this.getAggregate(envelope.aggregate_id));
  }

  recordEvidence(token, envelope, recordedAtMs) {
    this.#assertEvidenceIntake(token);
    validateEvidenceEnvelope(envelope);
    this.#begin();
    try {
      invariant(recordedAtMs >= this.#clockHighWater(), "STALE_CLOCK_SAMPLE", "Evidence intake clock sample is older than the persisted clock high-water mark.");
      this.#database.prepare(`
        INSERT INTO evidence_envelopes (
          evidence_id, evidence_hash, scope_aggregate_id, evidence_state,
          envelope_json, recorded_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        envelope.evidence_id,
        envelope.evidence_hash,
        envelope.scope_aggregate_id,
        envelope.state,
        canonicalJson(envelope),
        recordedAtMs,
      );
      this.#commit();
    } catch (error) {
      this.#rollback();
      if (String(error.message).includes("UNIQUE constraint failed")) {
        throw new KernelError("EVIDENCE_ALREADY_EXISTS", `Evidence envelope already exists: ${envelope.evidence_id}.`);
      }
      throw error;
    }
    return this.getEvidence(envelope.evidence_id);
  }

  recordSourceObservation(token, { observation, blob }, recordedAtMs) {
    this.#assertSourceIntake(token);
    observation = cloneCanonical(observation);
    validateSourceObservation(observation);
    invariant(Buffer.isBuffer(blob), "INVALID_SOURCE_BLOB", "Source blob must be supplied as a Buffer.");
    const blobSnapshot = Buffer.from(blob);
    invariant(blobSnapshot.length > 0, "INVALID_SOURCE_BLOB", "Source blob must not be empty.");
    invariant(blobSnapshot.length === observation.byte_length, "SOURCE_BLOB_LENGTH_MISMATCH", "Source blob length does not match the observation.");
    const observedBlobHash = crypto.createHash("sha256").update(blobSnapshot).digest("hex");
    invariant(
      timingSafeHashEqual(observedBlobHash, observation.blob_sha256),
      "SOURCE_BLOB_HASH_MISMATCH",
      "Source blob hash does not match the observation.",
    );
    invariant(Number.isSafeInteger(recordedAtMs) && recordedAtMs >= 0, "INVALID_SOURCE_RECORD_TIME", "Source record time must be a non-negative safe integer.");
    invariant(recordedAtMs >= observation.observed_at_ms, "SOURCE_RECORD_PRECEDES_OBSERVATION", "Source record time cannot precede observation time.");

    this.#begin();
    try {
      invariant(recordedAtMs >= this.#clockHighWater(), "STALE_CLOCK_SAMPLE", "Source-intake clock sample is older than the persisted clock high-water mark.");
      const storedBlob = this.#database.prepare(`
        SELECT blob_sha256, byte_length, blob_bytes, recorded_at_ms
        FROM source_blobs WHERE blob_sha256 = ?
      `).get(observation.blob_sha256);
      if (storedBlob) {
        const trustedStoredBlob = this.#sourceBlobFromRow(storedBlob);
        invariant(
          trustedStoredBlob.byte_length === observation.byte_length
            && trustedStoredBlob.bytes.equals(blobSnapshot),
          "SOURCE_BLOB_COLLISION",
          "An existing content address resolves to different source bytes.",
        );
      } else {
        this.#database.prepare(`
          INSERT INTO source_blobs (
            blob_sha256, byte_length, blob_bytes, recorded_at_ms
          ) VALUES (?, ?, ?, ?)
        `).run(observation.blob_sha256, observation.byte_length, blobSnapshot, recordedAtMs);
      }

      const duplicateId = this.#database.prepare(`
        SELECT observation_id FROM source_observations WHERE observation_id = ?
      `).get(observation.observation_id);
      if (duplicateId) {
        const storedObservation = this.getSourceObservation(observation.observation_id);
        invariant(
          storedObservation.observation_hash === observation.observation_hash
            && canonicalJson(storedObservation) === canonicalJson(observation),
          "SOURCE_OBSERVATION_ID_CONFLICT",
          `Source observation ID was already used with different record bytes: ${observation.observation_id}.`,
        );
        this.#commit();
        return storedObservation;
      }
      const duplicateHash = this.#database.prepare(`
        SELECT observation_id FROM source_observations WHERE observation_hash = ?
      `).get(observation.observation_hash);
      invariant(!duplicateHash, "SOURCE_OBSERVATION_HASH_ALREADY_EXISTS", `Source observation hash already exists: ${observation.observation_hash}.`);

      this.#database.prepare(`
        INSERT INTO source_observations (
          observation_id, observation_hash, blob_sha256, byte_length,
          intake_case_id, observation_json, recorded_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        observation.observation_id,
        observation.observation_hash,
        observation.blob_sha256,
        observation.byte_length,
        observation.intake_case_id,
        canonicalJson(observation),
        recordedAtMs,
      );
      this.#commit();
    } catch (error) {
      this.#rollback();
      throw error;
    }
    return this.getSourceObservation(observation.observation_id);
  }

  recordSourceVerificationReport(token, report, recordedAtMs) {
    this.#assertSourceIntake(token);
    report = cloneCanonical(report);
    validateSourceVerificationReport(report);
    invariant(Number.isSafeInteger(recordedAtMs) && recordedAtMs >= 0, "INVALID_SOURCE_RECORD_TIME", "Source record time must be a non-negative safe integer.");
    invariant(recordedAtMs >= report.verified_at_ms, "SOURCE_RECORD_PRECEDES_VERIFICATION", "Source record time cannot precede verification time.");

    this.#begin();
    try {
      invariant(recordedAtMs >= this.#clockHighWater(), "STALE_CLOCK_SAMPLE", "Source-intake clock sample is older than the persisted clock high-water mark.");
      const observation = this.getSourceObservation(report.observation_id);
      invariant(observation, "SOURCE_OBSERVATION_NOT_FOUND", `Source observation not found: ${report.observation_id}.`);
      invariant(
        observation.observation_hash === report.observation_hash
          && observation.blob_sha256 === report.blob_sha256
          && observation.byte_length === report.byte_length,
        "SOURCE_VERIFICATION_LINK_MISMATCH",
        "Source verification report does not match its observation projection.",
      );
      const duplicateId = this.#database.prepare(`
        SELECT verification_report_id FROM source_verification_reports
        WHERE verification_report_id = ?
      `).get(report.verification_report_id);
      if (duplicateId) {
        const storedReport = this.getSourceVerificationReport(report.verification_report_id);
        invariant(
          storedReport.verification_report_hash === report.verification_report_hash
            && canonicalJson(storedReport) === canonicalJson(report),
          "SOURCE_VERIFICATION_REPORT_ID_CONFLICT",
          `Source verification report ID was already used with different record bytes: ${report.verification_report_id}.`,
        );
        this.#commit();
        return storedReport;
      }
      const duplicateHash = this.#database.prepare(`
        SELECT verification_report_id FROM source_verification_reports
        WHERE verification_report_hash = ?
      `).get(report.verification_report_hash);
      invariant(!duplicateHash, "SOURCE_VERIFICATION_REPORT_HASH_ALREADY_EXISTS", `Source verification report hash already exists: ${report.verification_report_hash}.`);

      this.#database.prepare(`
        INSERT INTO source_verification_reports (
          verification_report_id, verification_report_hash,
          observation_id, observation_hash, blob_sha256, byte_length,
          report_json, recorded_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        report.verification_report_id,
        report.verification_report_hash,
        report.observation_id,
        report.observation_hash,
        report.blob_sha256,
        report.byte_length,
        canonicalJson(report),
        recordedAtMs,
      );
      this.#commit();
    } catch (error) {
      this.#rollback();
      throw error;
    }
    return this.getSourceVerificationReport(report.verification_report_id);
  }

  recordSourceAdmissionCandidate(token, candidate, recordedAtMs) {
    this.#assertSourceIntake(token);
    candidate = cloneCanonical(candidate);
    validateSourceAdmissionCandidate(candidate);
    invariant(Number.isSafeInteger(recordedAtMs) && recordedAtMs >= 0, "INVALID_SOURCE_RECORD_TIME", "Source record time must be a non-negative safe integer.");
    invariant(recordedAtMs >= candidate.created_at_ms, "SOURCE_RECORD_PRECEDES_CANDIDATE", "Source record time cannot precede candidate creation time.");

    this.#begin();
    try {
      invariant(recordedAtMs >= this.#clockHighWater(), "STALE_CLOCK_SAMPLE", "Source-intake clock sample is older than the persisted clock high-water mark.");
      const title = this.getAggregate(candidate.title_id);
      invariant(title, "SOURCE_ADMISSION_TITLE_NOT_FOUND", `Stable title aggregate not found: ${candidate.title_id}.`);
      const observation = this.getSourceObservation(candidate.observation_id);
      invariant(observation, "SOURCE_OBSERVATION_NOT_FOUND", `Source observation not found: ${candidate.observation_id}.`);
      const report = this.getSourceVerificationReport(candidate.verification_report_id);
      invariant(report, "SOURCE_VERIFICATION_REPORT_NOT_FOUND", `Source verification report not found: ${candidate.verification_report_id}.`);
      invariant(
        observation.observation_hash === candidate.observation_hash
          && observation.blob_sha256 === candidate.blob_sha256
          && observation.byte_length === candidate.byte_length
          && observation.intake_case_id === candidate.intake_case_id,
        "SOURCE_ADMISSION_OBSERVATION_LINK_MISMATCH",
        "Source admission candidate does not match its observation projection.",
      );
      invariant(
        report.verification_report_hash === candidate.verification_report_hash
          && report.observation_id === candidate.observation_id
          && report.observation_hash === candidate.observation_hash
          && report.blob_sha256 === candidate.blob_sha256
          && report.byte_length === candidate.byte_length,
        "SOURCE_ADMISSION_VERIFICATION_LINK_MISMATCH",
        "Source admission candidate does not match its verification projection.",
      );
      const duplicateId = this.#database.prepare(`
        SELECT admission_candidate_id FROM source_admission_candidates
        WHERE admission_candidate_id = ?
      `).get(candidate.admission_candidate_id);
      if (duplicateId) {
        const storedCandidate = this.getSourceAdmissionCandidate(candidate.admission_candidate_id);
        invariant(
          storedCandidate.admission_candidate_hash === candidate.admission_candidate_hash
            && canonicalJson(storedCandidate) === canonicalJson(candidate),
          "SOURCE_ADMISSION_CANDIDATE_ID_CONFLICT",
          `Source admission candidate ID was already used with different record bytes: ${candidate.admission_candidate_id}.`,
        );
        this.#commit();
        return storedCandidate;
      }
      const duplicateHash = this.#database.prepare(`
        SELECT admission_candidate_id FROM source_admission_candidates
        WHERE admission_candidate_hash = ?
      `).get(candidate.admission_candidate_hash);
      invariant(!duplicateHash, "SOURCE_ADMISSION_CANDIDATE_HASH_ALREADY_EXISTS", `Source admission candidate hash already exists: ${candidate.admission_candidate_hash}.`);

      this.#database.prepare(`
        INSERT INTO source_admission_candidates (
          admission_candidate_id, admission_candidate_hash,
          observation_id, observation_hash,
          verification_report_id, verification_report_hash,
          blob_sha256, byte_length, intake_case_id, title_id,
          candidate_json, recorded_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candidate.admission_candidate_id,
        candidate.admission_candidate_hash,
        candidate.observation_id,
        candidate.observation_hash,
        candidate.verification_report_id,
        candidate.verification_report_hash,
        candidate.blob_sha256,
        candidate.byte_length,
        candidate.intake_case_id,
        candidate.title_id,
        canonicalJson(candidate),
        recordedAtMs,
      );
      this.#commit();
    } catch (error) {
      this.#rollback();
      throw error;
    }
    return this.getSourceAdmissionCandidate(candidate.admission_candidate_id);
  }

  getAggregate(aggregateId) {
    const row = this.#database.prepare("SELECT aggregate_id, version, state_hash, envelope_json FROM aggregates WHERE aggregate_id = ?").get(aggregateId);
    return row ? aggregateFromRow(row) : null;
  }

  listAggregates() {
    return this.#database.prepare("SELECT aggregate_id, version, state_hash, envelope_json FROM aggregates ORDER BY aggregate_id").all()
      .map((row) => aggregateFromRow(row));
  }

  getEvidence(evidenceId) {
    const row = this.#database.prepare("SELECT envelope_json FROM evidence_envelopes WHERE evidence_id = ?").get(evidenceId);
    return row ? cloneCanonical(parseJson(row.envelope_json)) : null;
  }

  listEvidence(aggregateId) {
    return this.#database.prepare(`
      SELECT envelope_json FROM evidence_envelopes
      WHERE scope_aggregate_id = ? ORDER BY evidence_id
    `).all(aggregateId).map((row) => cloneCanonical(parseJson(row.envelope_json)));
  }

  #sourceBlobFromRow(row) {
    assertSha256(row.blob_sha256, "stored source blob SHA-256");
    invariant(Number.isSafeInteger(row.byte_length) && row.byte_length > 0, "STORAGE_PROJECTION_MISMATCH", "Stored source blob length is invalid.");
    invariant(Number.isSafeInteger(row.recorded_at_ms) && row.recorded_at_ms >= 0, "STORAGE_PROJECTION_MISMATCH", "Stored source blob record time is invalid.");
    invariant(row.blob_bytes instanceof Uint8Array, "STORAGE_PROJECTION_MISMATCH", "Stored source blob is not a BLOB.");
    const bytes = Buffer.from(row.blob_bytes);
    invariant(bytes.length === row.byte_length, "STORAGE_PROJECTION_MISMATCH", "Stored source blob length does not match its projection.");
    const observedHash = crypto.createHash("sha256").update(bytes).digest("hex");
    invariant(timingSafeHashEqual(observedHash, row.blob_sha256), "STORAGE_PROJECTION_MISMATCH", "Stored source blob bytes do not match their content address.");
    return {
      blob_sha256: row.blob_sha256,
      byte_length: row.byte_length,
      bytes,
      recorded_at_ms: row.recorded_at_ms,
    };
  }

  getSourceBlob(blobSha256) {
    const row = this.#database.prepare(`
      SELECT blob_sha256, byte_length, blob_bytes, recorded_at_ms
      FROM source_blobs WHERE blob_sha256 = ?
    `).get(blobSha256);
    return row ? this.#sourceBlobFromRow(row) : null;
  }

  getSourceObservation(observationId) {
    const row = this.#database.prepare(`
      SELECT observation_id, observation_hash, blob_sha256, byte_length,
             intake_case_id, observation_json, recorded_at_ms
      FROM source_observations WHERE observation_id = ?
    `).get(observationId);
    if (!row) return null;
    const observation = sourceObservationFromRow(row);
    const blob = this.getSourceBlob(observation.blob_sha256);
    invariant(blob && blob.byte_length === observation.byte_length, "STORAGE_PROJECTION_MISMATCH", "Source observation does not resolve to its exact stored blob.");
    return observation;
  }

  listSourceObservations(intakeCaseId) {
    return this.#database.prepare(`
      SELECT observation_id FROM source_observations
      WHERE intake_case_id = ? ORDER BY observation_id
    `).all(intakeCaseId).map((row) => this.getSourceObservation(row.observation_id));
  }

  getSourceVerificationReport(verificationReportId) {
    const row = this.#database.prepare(`
      SELECT verification_report_id, verification_report_hash,
             observation_id, observation_hash, blob_sha256, byte_length,
             report_json, recorded_at_ms
      FROM source_verification_reports WHERE verification_report_id = ?
    `).get(verificationReportId);
    if (!row) return null;
    const report = sourceVerificationReportFromRow(row);
    const observation = this.getSourceObservation(report.observation_id);
    invariant(
      observation
        && observation.observation_hash === report.observation_hash
        && observation.blob_sha256 === report.blob_sha256
        && observation.byte_length === report.byte_length,
      "STORAGE_PROJECTION_MISMATCH",
      "Source verification report does not resolve to its exact observation.",
    );
    return report;
  }

  listSourceVerificationReports(observationId) {
    return this.#database.prepare(`
      SELECT verification_report_id FROM source_verification_reports
      WHERE observation_id = ? ORDER BY verification_report_id
    `).all(observationId).map((row) => this.getSourceVerificationReport(row.verification_report_id));
  }

  getSourceAdmissionCandidate(admissionCandidateId) {
    const row = this.#database.prepare(`
      SELECT admission_candidate_id, admission_candidate_hash,
             observation_id, observation_hash,
             verification_report_id, verification_report_hash,
             blob_sha256, byte_length, intake_case_id, title_id,
             candidate_json, recorded_at_ms
      FROM source_admission_candidates WHERE admission_candidate_id = ?
    `).get(admissionCandidateId);
    if (!row) return null;
    const candidate = sourceAdmissionCandidateFromRow(row);
    const observation = this.getSourceObservation(candidate.observation_id);
    const report = this.getSourceVerificationReport(candidate.verification_report_id);
    invariant(
      observation
        && observation.observation_hash === candidate.observation_hash
        && observation.blob_sha256 === candidate.blob_sha256
        && observation.byte_length === candidate.byte_length
        && observation.intake_case_id === candidate.intake_case_id,
      "STORAGE_PROJECTION_MISMATCH",
      "Source admission candidate does not resolve to its exact observation.",
    );
    invariant(
      report
        && report.verification_report_hash === candidate.verification_report_hash
        && report.observation_id === candidate.observation_id
        && report.observation_hash === candidate.observation_hash
        && report.blob_sha256 === candidate.blob_sha256
        && report.byte_length === candidate.byte_length,
      "STORAGE_PROJECTION_MISMATCH",
      "Source admission candidate does not resolve to its exact verification report.",
    );
    return candidate;
  }

  listSourceAdmissionCandidates(intakeCaseId) {
    return this.#database.prepare(`
      SELECT admission_candidate_id FROM source_admission_candidates
      WHERE intake_case_id = ? ORDER BY admission_candidate_id
    `).all(intakeCaseId).map((row) => this.getSourceAdmissionCandidate(row.admission_candidate_id));
  }

  listSourceAdmissionCandidatesForTitle(titleId) {
    return this.#database.prepare(`
      SELECT admission_candidate_id FROM source_admission_candidates
      WHERE title_id = ? ORDER BY admission_candidate_id
    `).all(titleId).map((row) => this.getSourceAdmissionCandidate(row.admission_candidate_id));
  }

  getSourceAdmissionRecord(admissionRecordId) {
    const row = this.#database.prepare(`
      SELECT admission_record_id, admission_record_hash,
             admission_candidate_id, admission_candidate_hash,
             observation_id, verification_report_id,
             blob_sha256, byte_length, title_id,
             evidence_id, evidence_hash, admission_json, recorded_at_ms
      FROM source_admission_records WHERE admission_record_id = ?
    `).get(admissionRecordId);
    if (!row) return null;
    const record = sourceAdmissionRecordFromRow(row);
    const candidate = this.getSourceAdmissionCandidate(record.admission_candidate_id);
    const evidence = this.getEvidence(record.admitted_evidence.evidence_id);
    const title = this.getAggregate(record.title_id);
    invariant(
      candidate
        && candidate.admission_candidate_hash === record.admission_candidate_hash
        && candidate.observation_id === record.observation_id
        && candidate.verification_report_id === record.verification_report_id
        && candidate.blob_sha256 === record.blob_sha256
        && candidate.byte_length === record.byte_length
        && candidate.title_id === record.title_id,
      "STORAGE_PROJECTION_MISMATCH",
      "Source admission record does not resolve to its exact pending candidate.",
    );
    invariant(
      evidence && evidence.evidence_hash === record.admitted_evidence.evidence_hash,
      "STORAGE_PROJECTION_MISMATCH",
      "Source admission record does not resolve to its exact admitted evidence.",
    );
    invariant(
      title
        && Object.hasOwn(title.state.facts, "source.revision")
        && hashCanonical(title.state.facts["source.revision"]) === hashCanonical(sourceRevisionProjection(record)),
      "STORAGE_PROJECTION_MISMATCH",
      "Source admission record does not resolve to the exact canonical source revision.",
    );
    return record;
  }

  listSourceAdmissionRecordsForTitle(titleId) {
    return this.#database.prepare(`
      SELECT admission_record_id FROM source_admission_records
      WHERE title_id = ? ORDER BY admission_record_id
    `).all(titleId).map((row) => this.getSourceAdmissionRecord(row.admission_record_id));
  }

  listEvents() {
    return this.#database.prepare(`
      SELECT sequence, event_id, event_hash, previous_event_hash, aggregate_id,
             event_type, event_json, occurred_at_ms
      FROM events ORDER BY sequence
    `).all().map((row) => eventFromRow(row));
  }

  getIdempotency(authenticatedActorId, aggregateId, idempotencyKey) {
    const row = this.#database.prepare(`
      SELECT proposal_hash, result_json FROM idempotency_results
      WHERE authenticated_actor_id = ? AND aggregate_id = ? AND idempotency_key = ?
    `).get(authenticatedActorId, aggregateId, idempotencyKey);
    return row ? { proposal_hash: row.proposal_hash, result: cloneCanonical(parseJson(row.result_json)) } : null;
  }

  recordDecision(token, {
    authenticatedActorId,
    proposal,
    decision,
    reasonCodes,
    effectiveRisk,
    receiptHashes,
    currentState,
    nextState,
    occurredAtMs,
    storeIdempotency = true,
    eventDelta = proposal.delta,
    sourceAdmissionRecord = null,
  }) {
    this.#assertKernel(token);
    invariant(DECISIONS.includes(decision), "INVALID_DECISION", `Unknown decision: ${decision}.`);
    validateAggregateState(currentState);
    if (decision === "COMMIT") {
      validateAggregateState(nextState);
      invariant(nextState.version === currentState.version + 1, "INVALID_STATE_TRANSITION", "COMMIT must advance exactly one version.");
      invariant(nextState.previous_state_hash === currentState.state_hash, "INVALID_STATE_TRANSITION", "COMMIT must link to the previous state hash.");
    } else {
      invariant(nextState === null, "NON_COMMIT_STATE_WRITE", `${decision} must not include a next authoritative state.`);
      invariant(sourceAdmissionRecord === null, "NON_COMMIT_SOURCE_ADMISSION_WRITE", `${decision} must not include source-admission side effects.`);
    }
    const sourceAdmissionOperations = eventDelta.filter((operation) => operation.kind === "ADMIT_SOURCE_REVISION");
    invariant(
      sourceAdmissionOperations.length === 0 || sourceAdmissionOperations.length === 1,
      "INVALID_SOURCE_ADMISSION_COUNT",
      "A decision may contain at most one source admission.",
    );
    if (decision === "COMMIT" && sourceAdmissionOperations.length === 1) {
      validateSourceAdmissionRecord(sourceAdmissionRecord);
      invariant(
        sourceAdmissionRecord.admission_record_hash === sourceAdmissionOperations[0].payload.admission_record_hash,
        "SOURCE_ADMISSION_RECORD_MISMATCH",
        "Atomic source-admission side effects must match the committed operation.",
      );
      invariant(sourceAdmissionRecord.title_id === proposal.target_aggregate_id, "SOURCE_ADMISSION_TITLE_MISMATCH", "Source admission must match the proposal target.");
      invariant(
        hashCanonical(nextState.state.facts["source.revision"]) === hashCanonical(sourceRevisionProjection(sourceAdmissionRecord)),
        "SOURCE_REVISION_PROJECTION_MISMATCH",
        "Committed title state must contain the exact derived source revision.",
      );
    } else {
      invariant(sourceAdmissionRecord === null, "UNEXPECTED_SOURCE_ADMISSION_WRITE", "Only a committed ADMIT_SOURCE_REVISION operation may create admission side effects.");
    }

    this.#begin();
    try {
      if (storeIdempotency) {
        const prior = this.getIdempotency(authenticatedActorId, proposal.target_aggregate_id, proposal.idempotency_key);
        if (prior) {
          if (prior.proposal_hash === proposal.proposal_hash) {
            this.#rollback();
            return { ...prior.result, idempotent_replay: true };
          }
          throw new KernelError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used with different proposal bytes.");
        }
      }

      const clockHighWater = this.#clockHighWater();
      const clockSampleStale = occurredAtMs < clockHighWater;
      const recordedDecision = clockSampleStale ? "REJECT" : decision;
      const recordedReasonCodes = clockSampleStale ? ["STALE_CLOCK_SAMPLE"] : reasonCodes;
      const recordedNextState = clockSampleStale ? null : nextState;
      const recordedAtMs = clockSampleStale ? clockHighWater : occurredAtMs;

      const stored = this.getAggregate(proposal.target_aggregate_id);
      invariant(stored, "AGGREGATE_NOT_FOUND", `Aggregate not found: ${proposal.target_aggregate_id}.`);
      validateAggregateState(stored);
      invariant(
        stored.version === currentState.version && stored.state_hash === currentState.state_hash,
        "STALE_BASE_AT_COMMIT",
        "Authoritative state changed before the decision could be recorded.",
      );

      const stateAfter = recordedDecision === "COMMIT" ? recordedNextState : currentState;
      if (recordedDecision === "COMMIT") {
        const update = this.#database.prepare(`
          UPDATE aggregates
          SET version = ?, state_hash = ?, envelope_json = ?, updated_at_ms = ?
          WHERE aggregate_id = ? AND version = ? AND state_hash = ?
        `).run(
          recordedNextState.version,
          recordedNextState.state_hash,
          canonicalJson(recordedNextState),
          recordedAtMs,
          proposal.target_aggregate_id,
          currentState.version,
          currentState.state_hash,
        );
        invariant(update.changes === 1, "STALE_BASE_AT_COMMIT", "Compare-and-swap failed during commit.");
      }

      if (recordedDecision === "COMMIT" && sourceAdmissionRecord !== null) {
        const evidence = sourceAdmissionRecord.admitted_evidence;
        this.#database.prepare(`
          INSERT INTO evidence_envelopes (
            evidence_id, evidence_hash, scope_aggregate_id, evidence_state,
            envelope_json, recorded_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          evidence.evidence_id,
          evidence.evidence_hash,
          evidence.scope_aggregate_id,
          evidence.state,
          canonicalJson(evidence),
          recordedAtMs,
        );
        this.#database.prepare(`
          INSERT INTO source_admission_records (
            admission_record_id, admission_record_hash,
            admission_candidate_id, admission_candidate_hash,
            observation_id, verification_report_id,
            blob_sha256, byte_length, title_id,
            evidence_id, evidence_hash, admission_json, recorded_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sourceAdmissionRecord.admission_record_id,
          sourceAdmissionRecord.admission_record_hash,
          sourceAdmissionRecord.admission_candidate_id,
          sourceAdmissionRecord.admission_candidate_hash,
          sourceAdmissionRecord.observation_id,
          sourceAdmissionRecord.verification_report_id,
          sourceAdmissionRecord.blob_sha256,
          sourceAdmissionRecord.byte_length,
          sourceAdmissionRecord.title_id,
          evidence.evidence_id,
          evidence.evidence_hash,
          canonicalJson(sourceAdmissionRecord),
          recordedAtMs,
        );
      }

      const event = this.#appendEvent({
        event_type: "DECISION",
        aggregate_id: proposal.target_aggregate_id,
        occurred_at_ms: recordedAtMs,
        proposal_id: proposal.proposal_id,
        proposal_hash: proposal.proposal_hash,
        decision: recordedDecision,
        reason_codes: recordedReasonCodes,
        effective_risk: effectiveRisk,
        receipt_hashes: receiptHashes,
        delta: eventDelta,
        genesis_state: null,
        state_before_version: currentState.version,
        state_before_hash: currentState.state_hash,
        state_after_version: stateAfter.version,
        state_after_hash: stateAfter.state_hash,
      });

      const result = cloneCanonical({
        schema_version: SCHEMA.decisionResult,
        proposal_id: proposal.proposal_id,
        proposal_hash: proposal.proposal_hash,
        decision: recordedDecision,
        reason_codes: [...recordedReasonCodes].sort(),
        effective_risk: effectiveRisk,
        state_before_version: currentState.version,
        state_before_hash: currentState.state_hash,
        state_after_version: stateAfter.version,
        state_after_hash: stateAfter.state_hash,
        event_id: event.event_id,
        event_hash: event.event_hash,
        idempotent_replay: false,
      });

      if (storeIdempotency) {
        this.#database.prepare(`
          INSERT INTO idempotency_results (
            authenticated_actor_id, aggregate_id, idempotency_key,
            proposal_hash, result_json
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          authenticatedActorId,
          proposal.target_aggregate_id,
          proposal.idempotency_key,
          proposal.proposal_hash,
          canonicalJson(result),
        );
      }
      this.#commit();
      return result;
    } catch (error) {
      this.#rollback();
      throw error;
    }
  }
}
