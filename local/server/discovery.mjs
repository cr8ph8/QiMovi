import { DISCOVERY_SCOPE, RETENTION_LIMIT, validRetentionRequest } from '../contracts/discovery.mjs';
import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { discoveryStateHash } from '../discovery/admission.mjs';
import { discoveryQueries, isDiscoveryQuery, runDiscovery } from '../discovery/experiment.mjs';
import { canonical, check } from './storage.mjs';

export function createDiscoveryService(store, { actorId, now = () => new Date().toISOString() }) {
  const projectId = store.project().id;
  store.db.exec(`CREATE TABLE IF NOT EXISTS discovery_retention_events (
    seq INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL UNIQUE,
    event_hash TEXT NOT NULL,
    event_json TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS immutable_discovery_events_update BEFORE UPDATE ON discovery_retention_events
    BEGIN SELECT RAISE(ABORT, 'DISCOVERY_LEDGER_APPEND_ONLY'); END;
  CREATE TRIGGER IF NOT EXISTS immutable_discovery_events_delete BEFORE DELETE ON discovery_retention_events
    BEGIN SELECT RAISE(ABORT, 'DISCOVERY_LEDGER_APPEND_ONLY'); END;`);
  const read = store.db.prepare('SELECT * FROM discovery_retention_events ORDER BY seq LIMIT ?');
  const append = store.db.prepare('INSERT INTO discovery_retention_events (seq, source_id, request_hash, event_hash, event_json) VALUES (?, ?, ?, ?, ?)');

  function retained() {
    const state = new Set();
    let previousEventHash = null;
    const rows = read.all(RETENTION_LIMIT + 1);
    check(rows.length <= RETENTION_LIMIT, 'DISCOVERY_LEDGER_INVALID', 409);
    const events = rows.map((row, index) => {
      let event;
      try { event = JSON.parse(row.event_json); }
      catch { check(false, 'DISCOVERY_LEDGER_INVALID', 409); }
      check(event?.schema === 'qimovi-discovery-retention/v1' && event.projectId === projectId
        && event.scope === DISCOVERY_SCOPE && event.decision === 'COMMIT' && event.seq === index + 1
        && row.seq === event.seq && row.source_id === event.reference?.record?.sourceId
        && row.request_hash === event.requestHash && event.previousEventHash === previousEventHash
        && event.preStateHash === discoveryStateHash(state) && hashCanonical(event) === row.event_hash,
      'DISCOVERY_LEDGER_INVALID', 409);
      state.add(hashCanonical(event.reference));
      check(event.postStateHash === discoveryStateHash(state), 'DISCOVERY_LEDGER_INVALID', 409);
      previousEventHash = row.event_hash;
      return { ...event, eventHash: row.event_hash };
    });
    return { events, state, previousEventHash };
  }

  return {
    list() {
      const { events, previousEventHash } = retained();
      return { projectId, scope: DISCOVERY_SCOPE, queries: discoveryQueries, retained: events, ledgerHead: previousEventHash };
    },
    run(queryId) {
      check(isDiscoveryQuery(queryId), 'DISCOVERY_QUERY_INVALID', 422);
      return { projectId, ...runDiscovery(queryId) };
    },
    retain(input) {
      check(validRetentionRequest(input), 'DISCOVERY_REVIEW_REQUIRED', 422);
      check(input.projectId === projectId, 'DISCOVERY_PROJECT_MISMATCH', 409);
      check(isDiscoveryQuery(input.queryId), 'DISCOVERY_QUERY_INVALID', 422);
      const requestHash = hashCanonical(input);
      store.db.exec('BEGIN IMMEDIATE');
      try {
        const { events, state, previousEventHash } = retained();
        const prior = events.find(event => event.requestHash === requestHash);
        if (prior) {
          store.db.exec('COMMIT');
          return prior;
        }

        const run = runDiscovery(input.queryId);
        const candidate = run.candidates.find(row => row.record.id === input.videoId);
        check(candidate?.event.decision === 'COMMIT', 'DISCOVERY_CANDIDATE_NOT_ADMITTED', 409);
        check(candidate.event.eventHash === input.receiptHash, 'DISCOVERY_REVIEW_STALE', 409);
        check(!events.some(event => event.reference.record.sourceId === candidate.record.sourceId), 'DISCOVERY_ALREADY_RETAINED', 409);
        check(events.length < RETENTION_LIMIT, 'DISCOVERY_RETENTION_LIMIT', 409);

        const reference = {
          record: candidate.record, sourceEvidence: candidate.sourceEvidence,
          admission: candidate.event, note: input.note,
        };
        const preStateHash = discoveryStateHash(state);
        state.add(hashCanonical(reference));
        const event = {
          schema: 'qimovi-discovery-retention/v1', scope: DISCOVERY_SCOPE,
          projectId, seq: events.length + 1, decision: 'COMMIT', previousEventHash, preStateHash,
          postStateHash: discoveryStateHash(state), requestHash, actorId, at: now(), reference,
        };
        const eventHash = hashCanonical(event);
        append.run(event.seq, reference.record.sourceId, requestHash, eventHash, canonical(event));
        store.db.exec('COMMIT');
        return { ...event, eventHash };
      } catch (error) {
        store.db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
