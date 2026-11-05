import { performance } from 'node:perf_hooks';
import { DISCOVERY_DATASET, DISCOVERY_SCOPE } from '../contracts/discovery.mjs';
import { datasetHash, queries, sourceCatalog, videoRecords } from './fixtures.mjs';
import { governDiscovery, policyHash } from './admission.mjs';
import { rankDiscovery } from './rank.mjs';
import { labels, scoreDiscovery, TOP_K } from './evaluate.mjs';

const recordsById = new Map(videoRecords.map(row => [row.id, row]));
const queryById = new Map(queries.map(query => [query.id, query]));
const corpusQuery = { id: 'all', label: 'Full corpus audit', terms: [] };
export const discoveryQueries = [corpusQuery, ...queries];
export const isDiscoveryQuery = id => id === 'all' || queryById.has(id);

export const localUsage = Object.freeze({
  provider: 'none', providerRequests: 0, inputTokens: 0, outputTokens: 0,
  estimatedProviderCostUsd: '0.00', basis: 'NO_PROVIDER_CALLS', hardwareEnergy: 'UNMETERED',
});

function runPath(query, governed) {
  const start = performance.now();
  const proposals = rankDiscovery(videoRecords, query);
  const events = governed ? governDiscovery(proposals, recordsById, sourceCatalog, { datasetHash, queryId: query.id }) : [];
  const admittedIds = governed ? events.filter(event => event.decision === 'COMMIT').map(event => event.proposal.videoId)
    : proposals.map(proposal => proposal.videoId);
  return { proposals, events, admittedIds, elapsedMs: performance.now() - start };
}

export function runDiscovery(queryId, { governedFirst = false } = {}) {
  const query = queryId === 'all' ? corpusQuery : queryById.get(queryId);
  if (!query) throw new Error('Unknown discovery query');
  let baseline, governed;
  if (governedFirst) {
    governed = runPath(query, true);
    baseline = runPath(query, false);
  } else {
    baseline = runPath(query, false);
    governed = runPath(query, true);
  }
  const metrics = run => ({ ...scoreDiscovery(run.admittedIds, queryId), elapsedMs: run.elapsedMs, usage: localUsage });
  return {
    dataset: DISCOVERY_DATASET, datasetHash, policyHash, scope: DISCOVERY_SCOPE, recordCount: videoRecords.length,
    query, topK: TOP_K,
    baseline: { topIds: baseline.admittedIds.slice(0, TOP_K), metrics: metrics(baseline) },
    governed: { topIds: governed.admittedIds.slice(0, TOP_K), metrics: metrics(governed) },
    ledgerHead: governed.events.at(-1)?.eventHash ?? null,
    candidates: governed.events.map(event => {
      const record = recordsById.get(event.proposal.videoId);
      return { record, sourceEvidence: sourceCatalog.get(record.sourceId) ?? null, event };
    }),
  };
}

const round = value => Math.round(value * 1e6) / 1e6;
function summarizeTiming(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { medianMs: round(sorted[Math.ceil(sorted.length / 2) - 1]), p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]) };
}

export function benchmarkDiscovery({ repetitions = 30, includeLedger = false } = {}) {
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 1000) throw new Error('Repetitions must be an integer from 1 to 1000');
  const corpus = runDiscovery('all');
  const decisions = { COMMIT: 0, DAMP: 0, ESCALATE: 0, REJECT: 0 };
  let decisionMismatches = 0;
  for (const { record, event } of corpus.candidates) {
    decisions[event.decision]++;
    if (labels.get(record.id).expected !== event.decision) decisionMismatches++;
  }
  const runs = queries.map(query => runDiscovery(query.id));
  const timings = { baseline: [], governed: [] };
  for (let i = 0; i < repetitions; i++) {
    const run = runDiscovery('all', { governedFirst: i % 2 === 1 });
    for (const path of Object.keys(timings)) timings[path].push(run[path].metrics.elapsedMs);
  }
  const quality = ['precisionAt5', 'ndcgAt5', 'uniqueRelevantRecallAt5'];
  const metrics = path => {
    const { elapsedMs, ...fullCorpus } = corpus[path].metrics;
    return {
      fullCorpus,
      queryMacroAverage: Object.fromEntries(quality.map(key => [key, round(runs.reduce((sum, run) => sum + run[path].metrics[key], 0) / runs.length)])),
      fullCorpusTiming: summarizeTiming(timings[path]),
    };
  };
  return {
    dataset: corpus.dataset, datasetHash, policyHash, recordCount: corpus.recordCount,
    queryCount: queries.length, topK: TOP_K, repetitions, decisions, decisionMismatches,
    ledgerHead: corpus.ledgerHead, baseline: metrics('baseline'), governed: metrics('governed'),
    ...(includeLedger ? { ledger: corpus.candidates.map(row => row.event) } : {}),
  };
}
