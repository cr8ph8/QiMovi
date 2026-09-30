// Browser-safe guidance adapted from the supplied workshop PDFs. Page locators
// refer to one-based PDF pages, not printed slide numbers. No file is inspected
// and no preservation, rights, deposit or verification state is asserted here.
export const FILM_PRESERVATION_CONTEXT = 'Adapted from supplied 2025 preservation workshop PDFs; reviewed 27 September 2026. Page references use PDF pages. Phase placement and evidence prompts are QiMovi planning adaptations.';
export const FILM_PRESERVATION_SOURCES = Object.freeze({
  DIY: Object.freeze({ title: 'DIY Digital Preservation Tips for Independent Producers', filename: 'DIY Digital Preservation Tips for Independent Producers .pdf', pages: 45 }),
  CHECK: Object.freeze({ title: 'SaveIndieFilm / IndieCollect Checklist 2025', filename: 'SaveIndieFilm_IndieCollect_Checklist_2025.pdf', pages: 2 }),
  RES: Object.freeze({ title: 'SaveIndieFilm / IndieCollect Resource List 2025', filename: 'ResourceList_SaveIndieFilm_IndieCollect_2025.pdf', pages: 3 }),
  FUTURE: Object.freeze({ title: "IndieCollect's Future-Proofing Presentation", filename: "IndieCollect's Future-Proofing Presentation.pdf", pages: 26 }),
});
const source = (sourceId, locator) => Object.freeze({ sourceId, locator });
const guidance = (summary, evidencePrompts, sources) => Object.freeze({ summary, evidencePrompts: Object.freeze(evidencePrompts), sources: Object.freeze(sources) });
export const PRESERVATION_REQUIREMENT_IDS = Object.freeze([
  'dev-preservation-plan', 'prepro-preservation-inventory', 'wrap-preservation-handoff', 'post-preservation-package', 'release-preservation-care',
]);
export const PRESERVATION_GUIDANCE = Object.freeze({
  'dev-preservation-plan': guidance(
    'Decide what should survive, its future uses and who will care for it. Include initial and recurring preservation work in the budget; data size, labor, prices and funding remain unknown until supplied.',
    ['Scope, required elements, future uses and exclusions with reasons', 'Named custodian, budget reference, data-size assumptions and recurring work'],
    [source('DIY', 'pp. 14–19, 42'), source('RES', 'p. 3')]),
  'prepro-preservation-inventory': guidance(
    'Define an inventory, naming and version scheme before moving material. Retain original names and paths, technical metadata, rights-document references and system dependencies. Renaming files used by an editor or Pro Tools can break links.',
    ['Inventory / README location, original paths, media IDs and naming or version scheme', 'Required elements, provenance, technical metadata and software dependencies'],
    [source('DIY', 'pp. 18, 21, 24–35')]),
  'prepro-media-post': guidance(
    'Plan separate copies and how each transfer will be checked. The workshop recommends three copies, ideally across different media or platforms and geographic locations; select a suitable arrangement and record actual holdings.',
    ['Planned copy roles, locations, media, custodians and transfer-check method', 'Linked-system rename constraints and recording / post dependencies'],
    [source('DIY', 'pp. 21–25, 37–39'), source('CHECK', 'p. 1')]),
  'prod-offload': guidance(
    'Compare transfers with their expected source manifests and record failures. A newly generated digest alone cannot establish that the original or copy is complete. A checksum is a fixity check, not authorship or rights evidence.',
    ['Source / destination copy IDs, expected manifest, algorithm and comparison result', 'Operator, tool, check time, missing-file or sequence findings and recovery evidence'],
    [source('DIY', 'pp. 10–12, 21–23')]),
  'wrap-preservation-handoff': guidance(
    'Reconcile required elements with actual holdings and unresolved gaps. Freeze the inventory, checksum manifests and original-to-final path map. Record custody and copy locations; preserve verification and handoff evidence separately from a planned transfer.',
    ['Inventory revision, element roles, present / missing / excluded items and reasons', 'Copy IDs, locations, custodian, manifest and fixity / recovery check records', 'Rename / move history, unresolved issues, recipient and handoff receipt'],
    [source('DIY', 'pp. 15–19, 21–25, 30, 35, 37'), source('CHECK', 'pp. 1–2')]),
  'post-preservation-package': guidance(
    'Identify picture masters, originals, sound mixes and stems, project files and documentation separately from access copies. Adapt the element list to the work. Retain reference copies and restoration decisions when applicable; agree deposit specifications and record an actual receipt.',
    ['Master / source / access roles, exact versions, formats and completeness findings', 'Sound stems, project dependencies, technical README and rights-document references', 'Reference copies, restoration / filmmaker review notes if applicable, recipient specification and deposit receipt'],
    [source('DIY', 'pp. 15–19, 23, 43'), source('FUTURE', 'pp. 7–14, 19')]),
  'release-preservation-care': guidance(
    'Assign ongoing custody, a review cadence and migration triggers. Record integrity checks, failures and recovery, and validate migrated copies. The workshop sets no universal interval or preferred current provider. Distribution availability and archive possession are separate facts.',
    ['Custodian / successor, actual copy locations, last check and next review date', 'Format, medium, reader / software risks, migration trigger and validation record', 'Access-copy location, restrictions, distribution terms and custody handoff notes'],
    [source('DIY', 'pp. 18, 37–43'), source('CHECK', 'pp. 1–2'), source('FUTURE', 'pp. 20–24')]),
});

export function preservationGuidanceFor(requirementId) {
  return Object.hasOwn(PRESERVATION_GUIDANCE, requirementId) ? PRESERVATION_GUIDANCE[requirementId] : null;
}
export function preservationSourceLabel(reference) {
  const entry = FILM_PRESERVATION_SOURCES[reference.sourceId];
  return `${entry.title}, ${reference.locator} (supplied PDF)`;
}
export function preservationGuidanceLines(requirementId) {
  const entry = preservationGuidanceFor(requirementId);
  if (!entry) return [];
  return [entry.summary, '', 'Evidence worksheet — fill in or reference retained records; entries are not independently verified:', '',
    ...entry.evidencePrompts.map(prompt => `- ${prompt}: ____________________`),
    '', 'Workshop sources:', '', ...entry.sources.map(reference => `- ${preservationSourceLabel(reference)}`)];
}
