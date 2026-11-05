import { DISCOVERY_SCOPE, validDiscoveryVideo } from '../contracts/discovery.mjs';
import { hashCanonical } from '../kernel/src/canonical-json.mjs';

const POLICY = Object.freeze({
  version: 'qimovi-discovery-admission/v1',
  scope: DISCOVERY_SCOPE,
  trustedLicense: 'SYNTHETIC_REFERENCE_ONLY',
  duplicateRule: 'CANONICAL_RECORD_PER_SOURCE',
});
export const policyHash = hashCanonical(POLICY);
const outcome = (check, status, reason) => ({ check, status, reason });
export const discoveryStateHash = state => hashCanonical([...state].sort());

function validate(record, catalog) {
  if (!validDiscoveryVideo(record)) return [outcome('shape', 'FAIL', 'INVALID_RECORD')];
  const source = catalog.get(record.sourceId);
  const shape = outcome('shape', 'PASS', 'VALID_RECORD');
  if (!source) return [shape, outcome('provenance', 'SKIPPED', 'SOURCE_UNAVAILABLE')];

  const provenanceMatches = hashCanonical(record.provenance) === hashCanonical(source.provenance)
    && record.durationSeconds === source.durationSeconds;
  const allEvidenceMatches = record.evidence.every(claim => source.evidence.some(item => hashCanonical(item) === hashCanonical(claim)));
  const licenseMatches = record.license === source.license;
  const evidence = source.evidence.length === 0 ? outcome('evidence', 'SKIPPED', 'NO_INDEPENDENT_EXCERPTS')
    : allEvidenceMatches ? outcome('evidence', 'PASS', 'EXCERPTS_AND_TIMESTAMPS_MATCH')
    : outcome('evidence', 'FAIL', 'EXCERPT_OR_TIMESTAMP_MISMATCH');
  const license = !licenseMatches || source.license === 'RESTRICTED' ? outcome('license', 'FAIL', 'LICENSE_RESTRICTED_OR_CONFLICTING')
    : source.license === POLICY.trustedLicense ? outcome('license', 'PASS', 'SYNTHETIC_REFERENCE_SCOPE')
    : outcome('license', 'SKIPPED', 'LICENSE_UNVERIFIED');
  return [shape,
    outcome('provenance', provenanceMatches ? 'PASS' : 'FAIL', provenanceMatches ? 'SOURCE_MATCH' : 'SOURCE_CONFLICT'),
    evidence, license,
    outcome('identity', source.canonicalVideoId === record.id ? 'PASS' : 'FAIL',
      source.canonicalVideoId === record.id ? 'CANONICAL_SOURCE' : 'DUPLICATE_SOURCE'),
  ];
}

export function governDiscovery(proposals, recordsById, catalog, { datasetHash, queryId }) {
  const admittedSources = new Set();
  const ledger = [];
  let previousEventHash = null;
  for (const proposal of proposals) {
    const record = recordsById.get(proposal.videoId);
    let checks, recordHash = null;
    try {
      checks = validate(record, catalog);
      if (record) recordHash = hashCanonical(record);
    }
    catch { checks = [outcome('validator', 'ERROR', 'VALIDATOR_ERROR')]; }

    const blockers = checks.filter(item => item.check !== 'identity');
    let decision = 'COMMIT';
    if (blockers.some(item => item.status === 'FAIL')) decision = 'REJECT';
    else if (blockers.some(item => item.status !== 'PASS')) decision = 'ESCALATE';
    else if (checks.some(item => item.reason === 'DUPLICATE_SOURCE') || admittedSources.has(record.sourceId)) decision = 'DAMP';

    const preStateHash = discoveryStateHash(admittedSources);
    if (decision === 'COMMIT') admittedSources.add(record.sourceId);
    const event = {
      schema: 'qimovi-discovery-decision/v1', scope: DISCOVERY_SCOPE, seq: ledger.length + 1,
      datasetHash, queryId, policyHash, previousEventHash, preStateHash,
      postStateHash: discoveryStateHash(admittedSources),
      proposal, recordHash, checks, decision,
    };
    previousEventHash = hashCanonical(event);
    ledger.push({ ...event, eventHash: previousEventHash });
  }
  return ledger;
}
