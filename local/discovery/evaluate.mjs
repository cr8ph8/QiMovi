import { fixtureVideoId, queries, videoRecords } from './fixtures.mjs';

// Evaluation oracle for the authored scenarios. Neither path imports these labels
// to rank, validate, or admit candidates. Grades measure topical usefulness only.
const scenarios = [
  { grade: 3, expected: 'COMMIT' },    // actionable walkthrough
  { grade: 2, expected: 'COMMIT' },    // useful worked example
  { grade: 3, expected: 'REJECT' },    // fabricated recommendation excerpt
  { grade: 3, expected: 'ESCALATE' },  // unresolved license
  { grade: 3, expected: 'DAMP' },      // duplicate of the walkthrough
  { grade: 0, expected: 'COMMIT' },    // authentic endorsement of a tangential panel
  { grade: 2, expected: 'REJECT' },    // explicitly restricted evidence source
  { grade: 2, expected: 'COMMIT' },    // useful, low-signal field note
  { grade: 2, expected: 'REJECT' },    // provenance conflict
  { grade: 2, expected: 'ESCALATE' },  // independent evidence missing
];
export const labels = new Map(queries.flatMap(query => scenarios.map((scenario, index) => [
  fixtureVideoId(query.id, index + 1), { ...scenario, queryId: query.id },
])));
const byId = new Map(videoRecords.map(record => [record.id, record]));
const gain = (grade, index) => (2 ** grade - 1) / Math.log2(index + 2);
export const TOP_K = 5;

export function scoreDiscovery(rankedIds, queryId) {
  const unique = new Set();
  let duplicateRows = 0, falseAdmissions = 0;
  for (const id of rankedIds) {
    if (unique.has(byId.get(id).sourceId)) duplicateRows++;
    unique.add(byId.get(id).sourceId);
    if (['REJECT', 'ESCALATE'].includes(labels.get(id).expected)) falseAdmissions++;
  }
  const expectedCommits = [...labels].filter(([, label]) => label.expected === 'COMMIT'
    && (queryId === 'all' || label.queryId === queryId)).map(([id]) => id);
  const found = new Set(rankedIds);
  const counts = {
    admittedRows: rankedIds.length, uniqueSources: unique.size, duplicateRows, falseAdmissions,
    falseAdmissionRate: rankedIds.length ? falseAdmissions / rankedIds.length : null,
    missedEligible: expectedCommits.filter(id => !found.has(id)).length,
  };
  if (queryId === 'all') return counts;

  const ideal = [...labels.values()].filter(label => label.queryId === queryId && label.expected !== 'DAMP')
    .map(label => label.grade).sort((a, b) => b - a);
  const idealDcg = ideal.slice(0, TOP_K).reduce((sum, grade, i) => sum + gain(grade, i), 0);
  const topSources = new Set();
  let relevant = 0, dcg = 0;
  rankedIds.slice(0, TOP_K).forEach((id, index) => {
    const sourceId = byId.get(id).sourceId;
    const label = labels.get(id);
    if (topSources.has(sourceId) || label.queryId !== queryId) return;
    topSources.add(sourceId);
    relevant += Number(label.grade > 0);
    dcg += gain(label.grade, index);
  });
  return { ...counts, precisionAt5: relevant / TOP_K, ndcgAt5: dcg / idealDcg,
    uniqueRelevantRecallAt5: relevant / ideal.filter(grade => grade > 0).length };
}
