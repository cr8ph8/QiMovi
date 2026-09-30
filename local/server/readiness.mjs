import fs from 'node:fs';
import { canonical, sha256, check } from './storage.mjs';
import { documentDependencies, supportedDraftTypes } from '../tools/documents.mjs';
import { dreaminaBasis } from '../contracts/dreamina.mjs';
import { validateAggregateState, validateSourceAdmissionRecord, sourceRevisionProjection } from '../kernel/src/index.mjs';

const modulesContract = JSON.parse(fs.readFileSync(new URL('../completion/modules.json', import.meta.url)));
const artifactsContract = JSON.parse(fs.readFileSync(new URL('../completion/artifacts.json', import.meta.url)));
const registry = JSON.parse(fs.readFileSync(new URL('../kernel/registry/artifact-registry.v1.json', import.meta.url)));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ref = record => ({ id: record.id, kind: record.kind, version: record.version, sha256: record.sha256 });
const sum = values => values.reduce((a, b) => a + b, 0);
const byId = (a, b) => a.id.localeCompare(b.id, 'en');

function implementationBinding(value) {
  if (value == null) return { revision: null, treeHash: null, status: 'NOT_BOUND' };
  check(typeof value.revision === 'string' && /^[a-f0-9]{40,64}$/.test(value.revision) && digest(value.treeHash), 'READINESS_IMPLEMENTATION_BINDING_INVALID', 409);
  return { revision: value.revision, treeHash: value.treeHash, status: 'BOUND' };
}

function canonicalSource(project, value) {
  if (!value) return { status: 'NOT_OBSERVED', canonicalVersion: null, canonicalStateHash: null, admissionRef: null };
  const aggregate = validateAggregateState(value.aggregate);
  check(aggregate.aggregate_id === project.id && aggregate.state.title_id === project.id, 'READINESS_CANONICAL_PROJECT_MISMATCH', 409);
  check(Array.isArray(value.admissions), 'READINESS_ADMISSIONS_REQUIRED', 409);
  const revision = aggregate.state.facts['source.revision'];
  const source = { status: 'PENDING_OWNER_ADMISSION', canonicalVersion: aggregate.version, canonicalStateHash: aggregate.state_hash, admissionRef: null };
  if (!revision) {
    check(value.admissions.length === 0, 'READINESS_ADMISSION_PROJECTION_MISMATCH', 409);
    return source;
  }
  check(value.admissions.length === 1, 'READINESS_ADMISSION_COUNT_MISMATCH', 409);
  const admission = validateSourceAdmissionRecord(value.admissions[0]);
  check(admission.title_id === project.id && admission.blob_sha256 === project.sourceHash && canonical(sourceRevisionProjection(admission)) === canonical(revision), 'READINESS_ADMITTED_SOURCE_MISMATCH', 409);
  return { ...source, status: 'ADMITTED_CANONICAL', admissionRef: { id: admission.admission_record_id, sha256: admission.admission_record_hash } };
}

/** Records-derived preparation view. No caller-supplied status/approval is consumed.
 * Canonical values are supplied by the local service's read model, never a POST body.
 * This projection is not an independent admission, creative or finished-film audit. */
export function deriveReadiness({ project, records, canonical: canonicalValue = null, implementation = null }) {
  check(project && typeof project.id === 'string' && digest(project.sourceHash) && Array.isArray(project.scenes), 'READINESS_PROJECT_REQUIRED', 409);
  check(Array.isArray(records) && records.length <= 100000, 'READINESS_RECORDS_INVALID', 409);
  const ids = new Set();
  for (const record of records) {
    check(record && typeof record.id === 'string' && typeof record.kind === 'string' && Number.isSafeInteger(record.version) && record.version > 0 && !ids.has(record.id), 'READINESS_RECORD_IDENTITY_INVALID', 409);
    ids.add(record.id);
    check(digest(record.sha256) && sha256(canonical(record.data)) === record.sha256 && record.data.sourceHash === project.sourceHash, 'READINESS_RECORD_HASH_OR_SOURCE_MISMATCH', 409);
  }
  records = [...records].sort(byId);
  const code = implementationBinding(implementation);
  const source = canonicalSource(project, canonicalValue);
  const ofKind = kind => records.filter(record => record.kind === kind);
  const count = kind => ofKind(kind).length;
  const cells = project.cells ?? [];
  const takes = ofKind('measured-media-take');
  const reviews = ofKind('take-review');
  const takeById = new Map(takes.map(record => [record.id, record]));
  const currentReviews = reviews.filter(review => {
    const target = takeById.get(review.data.takeRef?.id);
    return target && target.sha256 === review.data.takeRef.sha256 && target.data.sceneId === review.data.sceneId && review.data.scope === 'CANDIDATE_PREFERENCE_ONLY' && review.data.actor === 'local-owner';
  });
  const scenes = project.scenes.map(scene => {
    const selectedCells = cells.filter(cell => cell.sceneId === scene.id);
    const plan = ofKind('scene-plan').find(record => record.data.sceneId === scene.id);
    const coverage = ofKind('coverage-draft').filter(record => scene.paragraphs.some(paragraph => paragraph.id === record.data.paragraphId));
    const mapped = coverage.filter(record => record.data.shotIds?.length && record.data.shotIds.every(id => scene.shots.some(shot => shot.id === id)));
    const sceneTakes = takes.filter(record => record.data.sceneId === scene.id);
    const kept = currentReviews.filter(record => record.data.sceneId === scene.id && record.data.decision === 'KEEP_CANDIDATE');
    const references = records.filter(record => record.data.sceneId === scene.id || (record.kind === 'coverage-draft' && coverage.includes(record)));
    const currentBriefs = ofKind('generation-brief').filter(record => record.data.sceneId === scene.id && record.data.basisHash === dreaminaBasis(project, records, scene.id)).length;
    const technicalOpening = selectedCells.some(cell => cell.role === 'START' && cell.shotId === scene.shots[0]?.id && digest(cell.imageHash));
    return { sceneId: scene.id, index: scene.index, heading: scene.heading,
      paragraphs: scene.paragraphs.length, plannedShots: scene.shots.length, storyCells: selectedCells.length,
      initialFramePresent: technicalOpening, storyboardReview: 'OWNER_REVIEW_NOT_ESTABLISHED',
      coverageDrafts: coverage.length, paragraphsMappedToShots: mapped.length,
      paragraphsWithTakeLinks: coverage.filter(record => record.data.takeIds?.length && record.data.takeIds.every(id => sceneTakes.some(take => take.id === id))).length,
      verifiedCoverage: 0, plannedSegments: plan?.data.segments?.length ?? 0,
      generationBriefs: countForScene('generation-brief', scene.id),
      briefsWithCurrentSceneBasis: currentBriefs,
      measuredTakes: sceneTakes.length,
      keptCandidates: kept.length, finalSelects: 0, records: references.map(ref),
      nextAction: !technicalOpening ? 'Choose an initial frame for this scene.' : !countForScene('generation-brief', scene.id) ? 'Prepare a clip with the exact source and selected references.' : !currentBriefs ? 'Refresh the clip brief against the current saved scene and references.' : !sceneTakes.length ? 'Import returned footage against its saved clip brief.' : !kept.length ? 'Review the measured footage and record a candidate preference.' : 'Review source coverage and prepare an editorial cut; candidate preferences are not final film selects.' };
  });
  function countForScene(kind, sceneId) { return records.filter(record => record.kind === kind && record.data.sceneId === sceneId).length; }

  const documents = artifactsContract.artifacts.map(artifact => {
    const saved = ofKind('document-draft').find(record => record.data.typeId === artifact.typeId);
    const definition = registry.records.find(record => record.artifact_key === artifact.typeId);
    const expected = documentDependencies(artifact.typeId, records);
    const current = saved && canonical(saved.data.dependencyHashes) === canonical(expected);
    return { id: artifact.id, typeId: artifact.typeId, name: artifact.name, classification: artifact.classification, owner: artifact.owner,
      materialization: !saved ? 'NOT_MATERIALIZED' : current ? 'DRAFT_CURRENT' : 'DRAFT_NEEDS_REBUILD',
      acceptance: artifact.classification === 'DEFERRED_FUNDING' ? 'DEFERRED' : 'NOT_ACCEPTED',
      canBuildDraft: supportedDraftTypes.includes(artifact.typeId) && !['HYBRID', 'EXTERNAL_EVIDENCE', 'TRANSACTIONAL_VIEW', 'CURATED_PACKAGE'].includes(definition?.materialization_mode),
      record: saved ? ref(saved) : null, bodyHash: saved ? sha256(saved.data.body) : null,
      dependencyHashes: expected, basisHash: sha256(canonical({ projectId: project.id, sourceHash: project.sourceHash, implementation: code, typeId: artifact.typeId, dependencyHashes: expected, record: saved ? ref(saved) : null })) };
  });

  const inventory = { currentRecords: records.length, assets: count('project-asset'), organizedAssets: count('asset-curation'), loreSources: count('lore-source'),
    screenplayDrafts: count('screenplay-draft'), castingDrafts: count('casting-draft'), storyCells: cells.length,
    generationBriefs: count('generation-brief'), measuredTakes: takes.length, keptCandidates: currentReviews.filter(record => record.data.decision === 'KEEP_CANDIDATE').length,
    finalSelects: 0, savedDocuments: documents.filter(document => document.record).length,
    currentDocuments: documents.filter(document => document.materialization === 'DRAFT_CURRENT').length,
    documentsNeedingRebuild: documents.filter(document => document.materialization === 'DRAFT_NEEDS_REBUILD').length,
    nodeWorkflows: count('node-workflow'), cameraObservations: count('camera-observation'),
    reviewObservations: count('review-observation'), reviewResolutions: count('review-resolution') };
  const gates = [];
  function gate(id, moduleIds, result, scope, reason, nextAction, kinds = [], extraBasis = null) {
    const relevant = records.filter(record => kinds.includes(record.kind)).map(ref);
    gates.push({ id, modules: moduleIds, result, scope, reason, nextAction, records: relevant,
      basisHash: sha256(canonical({ id, projectId: project.id, sourceHash: project.sourceHash, implementation: code, records: relevant, extraBasis })) });
  }
  gate('source', ['M02', 'M04', 'M05'], project.scenes.length ? 'PASS' : 'NEEDS_INPUT', 'RETAINED_SOURCE_STRUCTURE', `${project.scenes.length} scenes, ${sum(scenes.map(scene => scene.paragraphs)) + (project.prologue?.length ?? 0)} source paragraphs and ${sum(scenes.map(scene => scene.plannedShots))} planned shots are retained.`, 'Read the unchanged source and review its production mapping.', [], { scenes: project.scenes, prologue: project.prologue ?? [] });
  gate('admission', ['M01', 'M02', 'M05'], source.status === 'ADMITTED_CANONICAL' ? 'NEEDS_REVIEW' : 'NEEDS_INPUT', 'CANONICAL_SOURCE_OBSERVATION', source.status === 'ADMITTED_CANONICAL' ? 'Canonical admission exists; independent archive and replay verification remains a separate check.' : 'The selected project has no observed canonical source admission.', 'Review the five exact owner controls; use the trusted admission command only after the owner requests admission.', [], source);
  gate('casting', ['M07', 'M08'], 'NEEDS_REVIEW', 'CANDIDATE_INPUTS_ONLY', `${inventory.castingDrafts} casting drafts exist; film-use clearance and owner selection are not established by these records.`, 'Choose performer/reference revisions and record the actual permitted-use evidence.', ['casting-draft', 'context-bundle']);
  gate('segments', ['M04', 'M08', 'M09'], scenes.every(scene => scene.initialFramePresent) && inventory.generationBriefs ? 'NEEDS_REVIEW' : 'NEEDS_INPUT', 'PLANNED_STORYBOARD_AND_SEGMENTS', `${scenes.filter(scene => scene.initialFramePresent).length}/${scenes.length} scenes have an initial-frame candidate; ${inventory.generationBriefs} clip briefs are saved.`, 'Review ordered cells and the correct opening for each chosen clip; provider limits apply independently.', ['storyboard-cell', 'scene-plan', 'generation-brief'], cells);
  gate('documents', ['M03', 'M15', 'M17'], inventory.documentsNeedingRebuild ? 'NEEDS_REVIEW' : inventory.savedDocuments ? 'NEEDS_REVIEW' : 'NEEDS_INPUT', 'DRAFT_DOCUMENT_MATERIALIZATION', `${inventory.currentDocuments} current draft documents; ${inventory.documentsNeedingRebuild} require rebuilding. Required documents are not accepted merely because drafts exist.`, 'Build or rebuild needed documents, supply missing production facts, and review applicable artifacts.', ['document-draft', 'scene-plan', 'storyboard-cell', 'casting-draft']);
  gate('provider', ['M09', 'M18'], 'BLOCKED', 'EXTERNAL_EXECUTION_NOT_VERIFIED', `${inventory.generationBriefs} saved briefs are preparation. Current imported-take records do not verify a provider job, uploads, costs or generated origin.`, 'Qualify an owner-authorized provider request, durable job recovery and owned result ingestion.', ['generation-brief', 'measured-media-take']);
  gate('budget', ['M18'], 'NEEDS_INPUT', 'OWNER_BUDGET_DECISION_REQUIRED', records.some(record => record.kind === 'production-budget') ? 'A project budget draft is retained. Estimates and recorded costs do not establish an owner-approved whole-film ceiling or benchmark acceptance.' : 'No project budget is saved. The Budget workspace can generate estimates and track cost evidence.', 'Open Budget, review missing rates and actuals, then establish the owner-approved production ceiling through the separate trusted decision flow.', ['production-budget']);
  gate('creative-coverage', ['M04', 'M20'], 'NEEDS_REVIEW', 'PROPOSED_COVERAGE_ONLY', `${sum(scenes.map(scene => scene.paragraphsMappedToShots))} scene paragraphs have draft shot mappings; verified film coverage remains 0.`, 'Review every action/dialogue item against the exact selected real takes.', ['coverage-draft', 'measured-media-take', 'take-review']);
  gate('media-qc', ['M06', 'M14', 'M20'], inventory.measuredTakes ? 'NEEDS_REVIEW' : 'NEEDS_INPUT', 'MEASURED_IMPORT_AND_CANDIDATE_PREFERENCE', `${inventory.measuredTakes} measured imports and ${inventory.keptCandidates} keep-candidate preferences; final selects and full sound/picture/caption QC are not established.`, 'Import footage, inspect actual measurements, review it and bind accepted material to an editorial cut.', ['measured-media-take', 'take-review']);
  gate('delivery', ['M20', 'M21'], 'BLOCKED', 'FINAL_EDITORIAL_EVIDENCE_REQUIRED', 'No trusted complete master/editorial import-and-reopen acceptance handler is implemented.', 'Connect the cut, normalize with provenance, package linked media and verify the actual editor roundtrip.', ['measured-media-take', 'take-review']);
  gate('film-acceptance', ['M21'], 'BLOCKED', 'OWNER_FINAL_ACCEPTANCE_REQUIRED', 'No trusted final private-film acceptance record is implemented.', 'Review the full film and record acceptance bound to exact source, cut, master and package hashes.', ['measured-media-take', 'take-review']);
  gate('reviews', ['M11'], inventory.reviewObservations && inventory.reviewResolutions ? 'NEEDS_REVIEW' : 'NEEDS_INPUT', 'ATTRIBUTED_REVIEW_RECORDS', `${inventory.reviewObservations} reviewer observations and ${inventory.reviewResolutions} owner resolution records; package identity and current targets need independent verification.`, 'Export a review package, import returned comments and retain owner resolutions.', ['review-observation', 'review-resolution']);
  gate('recovery', ['M01', 'M10', 'M31'], 'BLOCKED', 'FINISHED_PROJECT_RECOVERY_REQUIRED', 'Current snapshot validation and software restore tests do not establish finished-film restoration and editor reopening.', 'Create a milestone and independently restore the finished project into a fresh directory.');
  gate('trading', ['M24', 'M25', 'M26', 'M27', 'M28', 'M29'], 'NEEDS_REVIEW', 'FICTIONAL_DEMO_SEPARATE_EVIDENCE', 'The simulator has its own store; film workspace records do not establish its current verified run.', 'Run and independently verify the fixed fictional demonstration, exports and recovery.');
  gate('nodes', ['M22'], inventory.nodeWorkflows ? 'PASS' : 'NEEDS_INPUT', 'LOCAL_PLANNING_GRAPH_ONLY', `${inventory.nodeWorkflows} typed scene workflows are saved; hook execution and adaptive crews remain deferred.`, 'Use nodes as another view of the same scene records.', ['node-workflow']);
  gate('cameras', ['M23'], inventory.cameraObservations ? 'NEEDS_REVIEW' : 'NEEDS_INPUT', 'BOUNDED_CAMERA_OBSERVATIONS', `${inventory.cameraObservations} camera observations exist; this is not general Unity/Houdini/VR qualification.`, 'Inspect the exact retained camera proof and broaden only for an actual film scene.', ['camera-observation']);
  const modules = modulesContract.modules.map(module => ({ moduleId: module.moduleId, module: module.module, scope: module.scope,
    capabilities: module.capabilities ?? [], checks: module.checks, gates: gates.filter(value => value.modules.includes(module.moduleId)).map(value => value.id),
    status: module.scope === 'DEFERRED' ? 'DEFERRED' : 'NOT_COMPLETE', acceptanceOwner: module.acceptanceOwner }));
  const outcomes = { LOCAL_WORKFLOW_VERIFIED: 'NOT_ESTABLISHED', FILM_ACCEPTED_PRIVATE: 'NOT_ESTABLISHED', TRADING_DEMO_VERIFIED: 'NOT_ESTABLISHED' };
  const result = { schema: 'caniscreenwrite-project-readiness/v1', scope: 'RECORDS_DERIVED_PREPARATION',
    bindings: { projectId: project.id, sourceHash: project.sourceHash, projectHash: sha256(canonical(project)), recordsHash: sha256(canonical(records.map(ref))), implementation: code },
    source, inventory, scenes, documents, modules, gates, outcomes, LOCAL_PILOT_COMPLETE: 'NOT_ESTABLISHED', HOSTED_RELEASE: 'DEFERRED',
    limitations: ['This preparation projection verifies record metadata hashes; original media bytes are not rehashed on every page request.', 'Candidate preference is not final selection or production approval.', 'Saved document bodies and reviewer comments cannot establish owner authority.', 'Independent completion evidence is assessed by the selected-project audit, not this preparation projection.'] };
  return { ...result, bindings: { ...result.bindings, readinessHash: sha256(canonical(result)) } };
}

export function readinessSnapshot(store, { canonical: canonicalValue = null, implementation = null } = {}) {
  const project = store.resolvedProject();
  const records = store.rawList();
  return deriveReadiness({ project, records, canonical: canonicalValue, implementation });
}
