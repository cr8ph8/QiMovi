import { readFileSync } from 'node:fs';
import { compileDocuments, documentDependencies, supportedDraftTypes, hasProductionElements } from '../tools/documents.mjs';
import { canonical, check, sha256 } from './storage.mjs';

const registry = JSON.parse(readFileSync(new URL('../kernel/registry/artifact-registry.v1.json', import.meta.url)));
const graph = JSON.parse(readFileSync(new URL('../kernel/registry/dependency-graph.v1.json', import.meta.url)));
const knownTypes = new Set(registry.records.map(record => record.artifact_key));
const knownFactKeys = [...new Set(graph.rules.filter(rule => rule.from.kind === 'FACT').map(rule => rule.from.key))].sort();
const basisKinds = new Set(['scene-plan', 'storyboard-cell', 'casting-draft', 'document-draft', 'measured-media-take', 'take-review', 'movie-sequence', 'project-direction']);

export function validateDocumentDependencies(data, project, records) {
  check(knownTypes.has(data.typeId), 'UNKNOWN_DOCUMENT_TYPE');
  check(data.sourceHash === project.sourceHash, 'DOCUMENT_SOURCE_CONFLICT', 409);
  check(canonical(data.dependencyHashes) === canonical(documentDependencies(data.typeId, records)), 'DOCUMENT_DEPENDENCY_CONFLICT', 409);
}

function snapshot(store) {
  const project = store.resolvedProject();
  const records = store.rawList();
  const contextBasisHash = sha256(canonical({ sourceHash: project.sourceHash,
    records: records.filter(record => basisKinds.has(record.kind) || hasProductionElements(record)).map(record => ({ id: record.id, kind: record.kind, version: record.version, sha256: record.sha256 })) }));
  const referenceDocuments = [];
  const savedDocuments = records.filter(record => record.kind === 'document-draft').flatMap(record => {
    check(sha256(canonical(record.data)) === record.sha256, 'SAVED_DOCUMENT_HASH_MISMATCH', 409);
    // Retained importer/reference notes are not registered production artifacts.
    // Keep their exact records available without assigning generated dependencies.
    if (!knownTypes.has(record.data.typeId)) {
      referenceDocuments.push({ ...record, documentState: {
        status: 'AUTHORED_REFERENCE', reason: 'UNREGISTERED_DOCUMENT_TYPE',
        sourceMatches: record.data.sourceHash === project.sourceHash, bodyHash: sha256(record.data.body),
      } });
      return [];
    }
    const currentDependencyHashes = documentDependencies(record.data.typeId, records);
    const sourceMatches = record.data.sourceHash === project.sourceHash;
    const dependenciesMatch = canonical(record.data.dependencyHashes) === canonical(currentDependencyHashes);
    return [{ ...record, documentState: {
      status: sourceMatches && dependenciesMatch ? 'CURRENT_DEPENDENCIES' : 'NEEDS_REBUILD',
      reason: !sourceMatches ? 'SOURCE_CHANGED' : !dependenciesMatch ? 'DEPENDENCIES_CHANGED' : 'EXACT_SAVED_DEPENDENCIES',
      currentDependencyHashes, bodyHash: sha256(record.data.body),
    } }];
  });
  return { project, records, contextBasisHash, savedDocuments, referenceDocuments };
}

export function listDocuments(store) {
  const { project, contextBasisHash, savedDocuments, referenceDocuments } = snapshot(store);
  return { sourceHash: project.sourceHash, contextBasisHash,
    registry: registry.records.map(record => ({ id: record.record_id, typeId: record.artifact_key, name: record.artifact_name,
      materializationMode: record.materialization_mode, supportedDraft: supportedDraftTypes.includes(record.artifact_key) &&
        !['HYBRID', 'EXTERNAL_EVIDENCE', 'TRANSACTIONAL_VIEW', 'CURATED_PACKAGE'].includes(record.materialization_mode) })),
    knownFactKeys, savedDocuments, referenceDocuments };
}

export function previewDocuments(store, input) {
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).sort().join(',') === 'changedFacts,selectedTypes,sourceHash', 'INVALID_DOCUMENT_PREVIEW');
  check(Array.isArray(input.selectedTypes) && input.selectedTypes.length > 0 && input.selectedTypes.length <= knownTypes.size &&
    new Set(input.selectedTypes).size === input.selectedTypes.length && input.selectedTypes.every(type => knownTypes.has(type)), 'UNKNOWN_DOCUMENT_TYPE');
  check(Array.isArray(input.changedFacts) && input.changedFacts.length <= knownFactKeys.length &&
    new Set(input.changedFacts).size === input.changedFacts.length && input.changedFacts.every(key => knownFactKeys.includes(key)), 'UNKNOWN_DEPENDENCY_FACT');
  const { project, records, contextBasisHash, savedDocuments, referenceDocuments } = snapshot(store);
  check(input.sourceHash === project.sourceHash, 'DOCUMENT_SOURCE_CONFLICT', 409);
  const existing = savedDocuments.map(record => ({ ...record.data, hash: record.sha256 }));
  const result = compileDocuments({ project, records, existing, selectedTypes: input.selectedTypes, changedFacts: input.changedFacts });
  const candidates = result.documents.filter(document => result.rebuiltTypes.includes(document.typeId)).map(document => ({ ...document, bodyHash: sha256(document.body) }));
  return { sourceHash: project.sourceHash, contextBasisHash, existingDocuments: savedDocuments.map(({ documentState, ...record }) => record), candidates,
    referenceDocuments, requirements: result.requirements, impact: result.impact, rebuiltTypes: result.rebuiltTypes };
}
