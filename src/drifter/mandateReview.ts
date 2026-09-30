export type MandateBuyer = { id: string; name: string; pages: number[]; summary: string; requirements: string[]; exclusions: string[]; packaging: string[]; productionConstraints: string[]; budgetNotes: string[] };
export type MandateAnalysis = { schema: 'caniscreenwrite-mandate-analysis/v1'; source: { filename: string; sha256: string; reportedDate: string; pageCount: number; status: 'DATED_NOTES_NOT_LIVE_VERIFIED' }; buyers: MandateBuyer[] };
// Reject control characters in imported planning data.
// eslint-disable-next-line no-control-regex
const text = (value: unknown, limit = 4000): value is string => typeof value === 'string' && value.length <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
export function parseMandateAnalysis(raw: string): MandateAnalysis {
  if (new TextEncoder().encode(raw).byteLength > 1024 * 1024) throw new Error('Choose a mandate analysis under 1 MiB.');
  const value = JSON.parse(raw);
  if (value?.schema !== 'caniscreenwrite-mandate-analysis/v1' || !text(value.source?.filename, 240) || !/^[a-f0-9]{64}$/.test(value.source?.sha256) || !text(value.source?.reportedDate, 80) || value.source?.status !== 'DATED_NOTES_NOT_LIVE_VERIFIED' || !Number.isSafeInteger(value.source?.pageCount) || value.source.pageCount < 1 || !Array.isArray(value.buyers) || !value.buyers.length || value.buyers.length > 100) throw new Error('This file is not a supported, source-linked mandate analysis.');
  const ids = new Set<string>();
  for (const buyer of value.buyers) {
    if (!text(buyer?.id, 160) || !buyer.id || ids.has(buyer.id) || !text(buyer.name, 240) || !buyer.name.trim() || !text(buyer.summary) || !Array.isArray(buyer.pages) || !buyer.pages.length || buyer.pages.some((p: unknown) => !Number.isSafeInteger(p) || Number(p) < 1 || Number(p) > value.source.pageCount)) throw new Error('The analysis contains an invalid buyer or page citation.');
    ids.add(buyer.id);
    for (const field of ['requirements', 'exclusions', 'packaging', 'productionConstraints', 'budgetNotes']) if (!Array.isArray(buyer[field]) || buyer[field].length > 40 || buyer[field].some((v: unknown) => !text(v))) throw new Error('The analysis contains unsupported requirement fields.');
  }
  return value as MandateAnalysis;
}
export function mandatePlanningNote(analysis: MandateAnalysis, buyer: MandateBuyer, analysisHash: string): string {
  return [
    `Buyer research to assess: ${buyer.name}. No fit, submission, offer or price established.`,
    `Source: ${analysis.source.filename}, pp. ${buyer.pages.join(', ')}, reported ${analysis.source.reportedDate}. Dated notes; current mandate unverified.`,
    `PDF SHA-256: ${analysis.source.sha256}; analysis SHA-256: ${analysisHash}.`,
    buyer.summary,
    ...(['requirements', 'exclusions', 'packaging', 'productionConstraints', 'budgetNotes'] as const).flatMap(field => buyer[field].map(item => `${({requirements:'Assess fit',exclusions:'Check exclusion',packaging:'Prepare evidence',productionConstraints:'Check production approach',budgetNotes:'Assess budget separately from asset value'})[field]}: ${item}`)),
    'Next: compare the exact screenplay/format, budget, attachments, audience evidence and rights scope; refresh buyer requirements before any submission.',
  ].join('\n');
}
