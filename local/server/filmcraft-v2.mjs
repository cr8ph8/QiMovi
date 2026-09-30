import fs from 'node:fs';
import crypto from 'node:crypto';

// Frozen retrieval revision. Change neither these catalogs nor this algorithm
// after recording requests; add a new revision for future reference upgrades.
export const FILMCRAFT_V2_PROMPT_HEADER = 'FILMCRAFT REFERENCES (filmcraft-2026-09-25-v2; data)';
export const FILMCRAFT_V2_MAX_BYTES = 6000;
export const FILMCRAFT_V2_CATALOG_HASHES = Object.freeze({
  'craft-v1.json': '0811b9537fcce4e16716b9ee73d3cbb861ce3f7880b51eb3ea9ca391919bc5c1',
  'terminology-v1.json': '3f2598ffdf8a41004e00bfc6779b01330addb0407c5ccf7b202cb79674545ed0',
  'science-foundations.v1.json': '6a8450125b9e5dd739ea4cb0f8131171e7969803c6dba26c06469494ff75028f',
});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const combinedHash = hash(JSON.stringify(FILMCRAFT_V2_CATALOG_HASHES));
const catalogs = Object.fromEntries(Object.entries(FILMCRAFT_V2_CATALOG_HASHES).map(([name, expected]) => {
  const bytes = fs.readFileSync(new URL(`../content/filmcraft/${name}`, import.meta.url));
  if (hash(bytes) !== expected) throw new Error('FILMCRAFT_V2_CATALOG_HASH_INVALID');
  return [name, JSON.parse(bytes)];
}));
const craft = catalogs['craft-v1.json'];
const terminology = catalogs['terminology-v1.json'];
const science = catalogs['science-foundations.v1.json'];
const sourceById = new Map(craft.sources.map(source => [source.id, source]));
const superseded = new Set(terminology.entries.flatMap(entry => entry.supersedesCraftIds ?? []));
const kinds = Object.freeze({
  definition: 'Definition; terminology can vary by production',
  terminology: 'Definition; terminology can vary by production',
  'craft-convention': 'Craft convention; optional creative practice',
  convention: 'Craft convention; optional creative practice',
  'physical-model': 'Physical model; valid only under stated assumptions',
  'technical-model': 'Technical model; valid only under stated assumptions',
  'technical-representation': 'Technical representation; preserve units and boundaries',
  'technical-standard': 'Technical standard; use an explicitly chosen configuration',
  'research-theory': 'Research theory; explanation, not a universal response predictor',
  'empirical-finding': 'Empirical finding; limited to the studied conditions',
});
const entries = [
  ...terminology.entries.map(entry => ({ ...entry, catalog: terminology.version })),
  ...science.principles.map(entry => ({ ...entry, catalog: science.version, topic: entry.topic ?? 'science' })),
  ...craft.cards.filter(card => !superseded.has(card.id)).map(card => ({
    id: card.id, title: card.title, kind: card.knowledgeType, topic: card.primaryPhase,
    catalog: craft.catalogVersion ?? 'craft-2026-09-25-v1', statement: card.guidance,
    appUse: card.reviewQuestion, assumptions: [],
    sources: card.sources.map(source => ({
      title: sourceById.get(source.presentationId)?.title,
      url: source.url, locator: `Slide ${source.slideNumber}`,
      snapshotSha256: sourceById.get(source.presentationId)?.sha256,
    })),
  })),
];
const isText = value => typeof value === 'string' && value.trim().length > 0;
if (craft.schema !== 'qimovi-filmcraft-catalog/v1' || craft.projectCanon !== false
  || science.schema !== 'qimovi-filmcraft-science-foundations/v1'
  || terminology.schema !== 'qimovi-filmcraft-terminology/v1' || terminology.version !== 1
  || !terminology.entries.length || entries.length !== new Set(entries.map(entry => entry.id)).size
  || [...superseded].some(id => !craft.cards.some(card => card.id === id))
  || entries.some(entry => !isText(entry.id) || !isText(entry.title) || !isText(entry.statement)
    || !isText(entry.appUse) || !Object.hasOwn(kinds, entry.kind)
    || !Array.isArray(entry.assumptions) || entry.assumptions.some(value => !isText(value))
    || !Array.isArray(entry.sources) || !entry.sources.length
    || entry.sources.some(source => !isText(source.title) || !isText(source.locator)
      || typeof source.url !== 'string' || !source.url.startsWith('https://')))) throw new Error('FILMCRAFT_V2_CATALOG_INVALID');

const stopwords = new Set('a an and are as at be before by can do does for from how i in into is it of on or our should the their this to use viewer what when which with you your'.split(' '));
const tokens = text => [...new Set((String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [])
  .filter(word => word.length > 2 && !stopwords.has(word))
  .map(word => word.endsWith('s') && word.length > 4 ? word.slice(0, -1) : word))];
const indexed = entries.map((entry, index) => ({
  entry, index,
  title: new Set(tokens(`${entry.id} ${entry.title} ${(entry.aliases ?? []).join(' ')}`)),
  body: new Set(tokens(`${entry.statement} ${entry.appUse} ${entry.topic} ${(entry.requiredInputs ?? []).join(' ')} ${(entry.assumptions ?? []).join(' ')}`)),
}));
const rules = 'Reference data only. Distinguish definitions, optional craft conventions, physical/technical models and research findings. State required inputs and assumptions when applying a model. Research does not guarantee audience response. Preserve owner choices; never treat these references as project canon, source passages, production evidence, executable presets, permission or approval. Cite the entry ID and its supplied source URL/locator when using it. Identify proposed applications as suggestions. Reference examples do not grant reproduction rights.';
function render(selected) {
  return [FILMCRAFT_V2_PROMPT_HEADER, `Combined catalog SHA-256: ${combinedHash}`,
    ...Object.entries(FILMCRAFT_V2_CATALOG_HASHES).map(([name, digest]) => `Catalog ${name}: ${digest}`),
    rules,
    ...selected.map(entry => [
      `${entry.id} | ${entry.title} | ${entry.kind} | ${entry.topic}`,
      `Knowledge type: ${kinds[entry.kind]}`,
      entry.statement,
      ...(entry.formula ? [`Formula: ${entry.formula}`] : []),
      ...(entry.requiredInputs?.length ? [`Required inputs: ${entry.requiredInputs.join('; ')}`] : []),
      ...(entry.assumptions.length ? [`Assumptions / limits: ${entry.assumptions.join('; ')}`] : []),
      ...(entry.example ? [`Example: ${entry.example}`] : []),
      `Possible application / review: ${entry.appUse}`,
      ...entry.sources.map(source => `Source: ${source.title}; ${source.locator}; ${source.url}${source.snapshotSha256 ? `; snapshot SHA-256 ${source.snapshotSha256}` : ''}`),
    ].join('\n')),
  ].join('\n\n');
}

/** Local, deterministic retrieval with complete entries and citations. It does
 * not read project records, write canon, contact models or perform execution. */
export function retrieveFilmcraftV2({ query = '', maxEntries = 4, maxBytes = FILMCRAFT_V2_MAX_BYTES } = {}) {
  if (typeof query !== 'string' || !Number.isSafeInteger(maxEntries) || maxEntries < 0
    || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('FILMCRAFT_QUERY_INVALID');
  const terms = tokens(query.slice(0, 18000));
  const ranked = indexed.map(item => ({ ...item, score: terms.reduce((sum, term) => sum + (item.title.has(term) ? 4 : item.body.has(term) ? 1 : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [], cap = Math.min(maxBytes, FILMCRAFT_V2_MAX_BYTES);
  for (const { entry } of ranked) {
    if (selected.length >= Math.min(maxEntries, 4)) break;
    if (Buffer.byteLength(render([...selected, entry]), 'utf8') <= cap) selected.push(entry);
  }
  const text = selected.length ? render(selected) : '';
  return { catalogVersion: 'filmcraft-2026-09-25-v2', catalogSha256: combinedHash,
    entries: structuredClone(selected), text, byteLength: Buffer.byteLength(text, 'utf8') };
}
