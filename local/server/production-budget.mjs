import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonical, check, sha256 } from './storage.mjs';
import { BUDGET_CATEGORIES, BUDGET_LIMITS, applyBudgetAssetScope, budgetAssetContext, calculateProductionBudget, emptyProductionBudget, productionBudgetProject, validateProductionBudget } from '../contracts/production-budget.mjs';
import { createUsageAccountingService } from './usage-accounting.mjs';
import { listDccStageReturns } from './dcc-stage-returns.mjs';
import { nodeOutputBindingRefs } from '../contracts/node-workflow.mjs';
import { projectOwnedContext } from '../contracts/creative-project.mjs';
import { productionElementBudgetTarget } from '../contracts/script-breakdown.mjs';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, fields, optional = []) => check(value && typeof value === 'object' && !Array.isArray(value) && fields.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...fields, ...optional].includes(key)), 'BUDGET_REQUEST_FIELDS_INVALID', 422);
const scope = (project, input) => { const owner = productionBudgetProject(project); check(owner && owner.id === input.projectId && owner.sourceHash === input.sourceHash, 'BUDGET_PROJECT_MISMATCH', 409); };
const ref = record => ({ id: record.id, version: record.version, sha256: record.sha256 });
const shotKey = (sceneId, shotId) => `shot:${sceneId}:${shotId}`;
const operationKey = record => `operation:${record.id}:v${record.version}`;
const titleCase = value => value.charAt(0).toUpperCase() + value.slice(1);
// Editable work has its own cost target alongside assets and provider attempts.
// A revision changes the inventory binding, never creates a charge by itself.
const WORK_CATEGORIES = Object.freeze({
  'screenplay-draft': 'development', 'concept-draft': 'development', 'story-plan-draft': 'development',
  'writing-production-plan': 'preproduction', 'pitch-draft': 'development', 'writing-note': 'development', 'document-draft': 'preproduction',
  'movie-sequence': 'post', 'generation-brief': 'preproduction', 'casting-draft': 'cast', 'scene-plan': 'preproduction',
});
const ELEMENT_DEPARTMENTS = Object.freeze({ CAST: 'cast', EXTRAS: 'cast', PROPS: 'art', WARDROBE: 'art', MAKEUP: 'art', SET_DRESSING: 'art', LOCATIONS: 'locations', VEHICLES: 'equipment', ANIMALS: 'cast', STUNTS: 'crew', SPECIAL_EFFECTS: 'art', VFX: 'post', SOUND: 'audio', MUSIC: 'audio', EQUIPMENT: 'equipment', OTHER: 'other' });

// Inventory is a bounded projection of many records, not one saved record.
// Stream the same canonical object bytes so the per-record JSON node/byte limit
// does not reject a valid aggregate or change existing inventory fingerprints.
function inventoryHash(project, targets, observations) {
  check(targets.length <= BUDGET_LIMITS.targets, 'BUDGET_TARGET_LIMIT', 413);
  check(observations.length <= BUDGET_LIMITS.observations, 'BUDGET_OBSERVATION_LIMIT', 413);
  const hash = createHash('sha256');
  const array = rows => {
    hash.update('[');
    rows.forEach((row, index) => { if (index) hash.update(','); hash.update(canonical(row)); });
    hash.update(']');
  };
  // Sorted top-level keys match canonical({ projectId, sourceHash, targets, observations }).
  hash.update('{"observations":'); array(observations);
  hash.update(',"projectId":'); hash.update(canonical(project.id));
  hash.update(',"sourceHash":'); hash.update(canonical(project.sourceHash));
  hash.update(',"targets":'); array(targets);
  hash.update('}');
  return hash.digest('hex');
}

/** Read receipt chains without creating the recovery-capable DCC runner. */
function dccJobs(store) {
  const root = path.join(store.directory, 'integrations', 'dcc-rehearsals');
  if (!fs.existsSync(root)) return [];
  for (const directory of [path.dirname(root), root]) {
    const stat = fs.lstatSync(directory); check(stat.isDirectory() && !stat.isSymbolicLink(), 'BUDGET_DCC_DIRECTORY_INVALID', 409);
  }
  const names = fs.readdirSync(root).sort(); check(names.length <= 2000, 'BUDGET_DCC_LIMIT', 413);
  const jobs = [];
  for (const name of names) {
    check(/^[a-f0-9-]{36}$/.test(name), 'BUDGET_DCC_DIRECTORY_INVALID', 409);
    const directory = path.join(root, name), stat = fs.lstatSync(directory);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'BUDGET_DCC_DIRECTORY_INVALID', 409);
    const files = fs.readdirSync(directory).filter(file => /^receipt-\d{6}\.json$/.test(file)).sort();
    check(files.length <= 10000, 'BUDGET_DCC_LIMIT', 413);
    let latest;
    for (const file of files) {
      const filename = path.join(directory, file), info = fs.lstatSync(filename);
      check(info.isFile() && !info.isSymbolicLink() && info.size <= 1024 * 1024, 'BUDGET_DCC_RECEIPT_INVALID', 409);
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8')), { sha256: claimed, ...body } = saved;
      check(saved.schemaVersion === 'caniscreenwrite-dcc-rehearsal/v1' && saved.jobId === name && saved.projectId === store.project().id && saved.sourceHash === store.project().sourceHash && saved.version === (latest?.version ?? 0) + 1 && sha256(canonical(body)) === claimed, 'BUDGET_DCC_RECEIPT_INVALID', 409);
      latest = saved;
    }
    if (latest) jobs.push(latest);
  }
  return jobs;
}

/** All targets are alternative views of the same ledger, never additive subtotals. */
export function collectBudgetInventory(store) {
  const project = store.resolvedProject(), records = store.rawList().filter(record => record.kind !== 'production-budget');
  const targets = new Map(), observations = [], warnings = [], rootId = `project:${project.id}`;
  const evidenceHashes = new Set(), historicalOperations = new Map(), operationsByBrief = new Map();
  const add = (id, kind, label, parentIds = [rootId], extra = {}) => {
    const existing = targets.get(id);
    if (existing) {
      existing.parentIds = [...new Set([...existing.parentIds, ...parentIds])].sort();
      if (extra.sourceRefs) existing.sourceRefs = [...new Map([...(existing.sourceRefs ?? []), ...extra.sourceRefs].map(row => [canonical(row), row])).values()];
      return existing;
    }
    const value = { id, kind, label: String(label).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 400) || 'Untitled target', parentIds: [...new Set(parentIds)].sort(), ...extra };
    targets.set(id, value); return value;
  };
  add(rootId, 'project', project.title, []);
  for (const category of BUDGET_CATEGORIES) add(`department:${category}`, 'overhead', titleCase(category), [rootId], { category, sourceRefs: [] });
  for (const scene of project.scenes) {
    const sceneId = `scene:${scene.id}`;
    add(sceneId, 'scene', scene.heading, [rootId], { sceneId: scene.id });
    for (const shot of scene.shots) add(shotKey(scene.id, shot.id), 'shot', `${shot.label} · ${shot.description || scene.heading}`, [sceneId], { sceneId: scene.id, shotId: shot.id });
  }
  const parentsFor = data => data?.shotId && targets.has(shotKey(data.sceneId, data.shotId)) ? [shotKey(data.sceneId, data.shotId)] : data?.sceneId && targets.has(`scene:${data.sceneId}`) ? [`scene:${data.sceneId}`] : [rootId];
  const asset = (hash, label, parentIds = [rootId], sourceRefs = [], extra = {}) => {
    if (digest(hash)) add(`asset:${hash}`, 'asset', label || `Retained asset ${hash.slice(0, 12)}`, parentIds, { assetHash: hash, sourceRefs, ...extra });
  };
  if (digest(project.sourceHash)) asset(project.sourceHash, 'Production screenplay', [rootId], [{ id: 'project-source', sha256: project.sourceHash }]);
  for (const cell of project.cells ?? []) asset(cell.imageHash, `Storyboard · ${cell.shotId} ${cell.role}`, parentsFor(cell), [{ id: cell.id, sha256: cell.imageHash }]);
  for (const character of project.characters ?? []) asset(character.referenceImageHash, `Character · ${character.name}`, [rootId], [{ id: character.id, sha256: character.referenceImageHash }]);
  const addOperation = record => {
    const id = operationKey(record);
    historicalOperations.set(`${record.id}:${record.sha256}`, id);
    if (record.data.briefRef) {
      const key = `${record.data.briefRef.id}:${record.data.briefRef.sha256}`;
      operationsByBrief.set(key, [...new Set([...(operationsByBrief.get(key) ?? []), id])]);
    }
    return add(id, 'task', record.data.title || `${record.data.taskId} · ${record.data.modelId}`, parentsFor(record.data.target), { category: 'generation', sourceRefs: [ref(record)] });
  };
  for (const record of records) {
    check(sha256(canonical(record.data)) === record.sha256, 'BUDGET_SOURCE_HASH_MISMATCH', 409);
    const data = record.data, sourceRefs = [ref(record)], parents = parentsFor(data);
    if (record.kind === 'coverage-draft' && data.sourceHash === project.sourceHash && data.productionElements?.length) {
      store.validateSavedRecord(record);
      const scene = project.scenes.find(row => row.paragraphs.some(paragraph => paragraph.id === data.paragraphId));
      for (const element of data.productionElements) add(productionElementBudgetTarget(data.paragraphId, element.id), 'breakdown-element', `${element.category.replaceAll('_', ' ')} · ${element.name}`, scene ? [`scene:${scene.id}`] : [rootId], {
        category: ELEMENT_DEPARTMENTS[element.category], ...(scene ? { sceneId: scene.id } : {}), paragraphId: data.paragraphId,
        elementId: element.id, elementCategory: element.category, sourceQuantity: element.quantity, description: element.notes,
        sourceRefs, recordKind: record.kind, plannedOnly: true,
      });
    }
    if (record.kind === 'universe-production-plan' && (data.sourceHash === null ? data.projectId === project.id && projectOwnedContext(project, record.kind, data).sourceHash === null : data.sourceHash === project.sourceHash)) {
      store.validateSavedRecord(record);
      if (data.review !== 'SET_ASIDE') {
        const worldId = `world:${data.entityId}`;
        add(worldId, 'world', data.entityName, [rootId], { entityId: data.entityId, entityType: data.entityType, sourceRefs, recordKind: record.kind, review: data.review, plannedOnly: true, costRequired: false });
        for (const need of data.needs.filter(row => row.review !== 'SET_ASIDE')) {
          // One authored need is one cost target, even when used in several
          // scenes. Scene views overlap; the ledger rolls up each line once.
          add(`world-need:${data.entityId}:${need.id}`, 'world-need', `${data.entityName} · ${need.label}`, [worldId, ...need.sceneIds.map(sceneId => `scene:${sceneId}`)], {
            entityId: data.entityId, entityType: data.entityType, needId: need.id, category: need.department,
            sceneIds: [...need.sceneIds], description: need.description, review: need.review,
            sourceRefs, recordKind: record.kind, plannedOnly: true,
          });
        }
      }
    }
    if (WORK_CATEGORIES[record.kind] && data.sourceHash === projectOwnedContext(project, record.kind, data).sourceHash && (!Object.hasOwn(data, 'projectId') || data.projectId === project.id)) {
      const category = record.kind === 'document-draft' && /pitch|press|marketing|publicity|epk/i.test(data.typeId ?? '') ? 'marketing' : WORK_CATEGORIES[record.kind];
      add(`work:${record.id}`, 'task', data.title || `${titleCase(record.kind.replaceAll('-', ' '))} · ${data.typeId ?? data.characterId ?? data.sceneId ?? record.id}`, parents, { category, sourceRefs, recordKind: record.kind, plannedOnly: true });
    }
    if (record.kind === 'studio-operation') addOperation(record);
    if (record.kind === 'node-workflow') {
      const macro = `macro:${record.id}`;
      add(macro, 'macro', data.title, parents, { sourceRefs, plannedOnly: true });
      for (const node of data.graph.nodes) add(`step:${record.id}:${node.id}`, 'step', node.label, [macro], { category: /generat|provider/.test(node.type) ? 'generation' : 'preproduction', sourceRefs, nodeType: node.type, bindingRefs: nodeOutputBindingRefs(data.graph, node.id) });
      if (data.graph.nodes.some(node => node.type.includes('choice'))) warnings.push({ code: 'MACRO_BRANCH_REVIEW', targetId: macro, message: 'All retained workflow steps are inventoried. Review selected and alternate branches before applying run quantities.' });
    }
    if (record.kind === 'project-asset') asset(data.asset.sha256, data.title, parents, sourceRefs, { family: data.family, byteLength: data.asset.byteLength, mimeType: data.asset.mimeType });
    if (record.kind === 'studio-media') asset(data.assetHash, data.originalFilename, parents, sourceRefs, { byteLength: data.byteLength, mimeType: data.mimeType });
    if (record.kind === 'measured-media-take') asset(data.blob.sha256, data.originalFilename, parents, sourceRefs, { byteLength: data.blob.byteLength, mimeType: data.blob.mimeType });
    if (record.kind === 'storyboard-cell') asset(data.imageHash, `Storyboard · ${data.shotId} ${data.role}`, parents, sourceRefs);
    if (record.kind === 'casting-draft') for (const hash of data.referenceHashes) asset(hash, `Casting · ${data.characterId}`, parents, sourceRefs);
    if (record.kind === 'universe-artwork' || record.kind === 'universe-entity') asset(data.imageHash, data.name || `Universe artwork · ${data.entityId}`, parents, sourceRefs);
    if (record.kind === 'lore-source') {
      asset(data.original.sha256, data.title, parents, sourceRefs);
      asset(data.extraction?.sha256, `${data.title} · text extraction`, [`asset:${data.original.sha256}`], sourceRefs);
      if (data.intakeManifest?.sha256) evidenceHashes.add(data.intakeManifest.sha256);
    }
    if (record.kind === 'comic-package') for (const file of data.files) asset(file.sha256, file.filename, parents, sourceRefs, { mimeType: file.mimeType, byteLength: file.byteLength });
    if (record.kind === 'usage-observation') evidenceHashes.add(data.reportHash);
  }
  for (const record of records.filter(row => ['studio-generation', 'studio-reference'].includes(row.kind))) {
    store.validateSavedRecord(record);
    const data = record.data, operation = store.history(data.operationRef.id).find(row => row.version === data.operationRef.version && row.sha256 === data.operationRef.sha256);
    check(operation, 'BUDGET_GENERATION_OPERATION_MISSING', 409);
    const parent = addOperation(operation), details = JSON.parse(data.detailsJson);
    const target = add(record.id, 'generation', `${details.modelId ?? operation.data.modelId} · ${data.phase}`, [parent.id], { category: 'generation', sourceRefs: [ref(record), ref(operation)], phase: data.phase, providerJobs: (details.jobs ?? []).map(job => ({ id: job.id, status: job.status })) });
    for (const hash of details.evidenceHashes ?? []) evidenceHashes.add(hash);
    for (const file of details.outputs ?? []) asset(file.sha256, file.filename, [target.id], [ref(record)], { mimeType: file.mimeType, byteLength: file.byteLength });
    if (record.kind === 'studio-reference') {
      if (!['PREPARING', 'PREPARED', 'PREPARATION_FAILED'].includes(data.phase)) observations.push({ id: `incurred:${record.id}`, targetId: target.id, currency: 'HIGGSFIELD_CREDITS', amount: null, kind: 'unknown', label: `Reference creation ${data.phase} · billing unknown` });
    }
  }
  // Bind workflows to exact saved operations, not merely similar labels.
  for (const target of targets.values()) if (target.kind === 'step') for (const binding of target.bindingRefs ?? []) {
    const key = `${binding.id}:${binding.sha256}`;
    const operationIds = historicalOperations.has(key) ? [historicalOperations.get(key)] : operationsByBrief.get(key) ?? [];
    for (const operationId of operationIds) add(operationId, 'task', targets.get(operationId).label, [target.id]);
    if (operationIds.length > 1) warnings.push({ code: 'MACRO_RUN_ATTRIBUTION', targetId: target.id, message: 'Several retained operation revisions use this exact brief. The workflow includes their distinct attempts; no execution count is inferred.' });
    // Node bindings identify source records, not blob hashes. Reconcile exact
    // references before rolling their owned assets into this workflow view.
    const linked = [...targets.values()].filter(row => row.kind === 'asset' && row.sourceRefs?.some(source => source.id === binding.id && source.sha256 === binding.sha256));
    for (const item of linked) add(item.id, 'asset', item.label, [target.id]);
    if (binding.id === `frozen-source:${project.sourceHash}` && binding.sha256 === project.sourceHash) asset(project.sourceHash, 'Production screenplay', [target.id], [binding]);
    else if (binding.id.startsWith('seed-cell:')) {
      const cell = store.project().cells.find(row => `seed-cell:${row.id}` === binding.id);
      if (cell && sha256(canonical(cell)) === binding.sha256) asset(cell.imageHash, `Storyboard · ${cell.shotId} ${cell.role}`, [target.id], [binding]);
      else warnings.push({ code: 'MACRO_BINDING_STALE', targetId: target.id, message: `A saved storyboard binding changed: ${binding.id}. Review its cost allocation.` });
    } else if (binding.id.startsWith('seed-character:')) {
      const character = store.project().characters.find(row => `seed-character:${row.id}` === binding.id);
      if (character && sha256(canonical(character)) === binding.sha256) asset(character.referenceImageHash, `Character · ${character.name}`, [target.id], [binding]);
      else warnings.push({ code: 'MACRO_BINDING_STALE', targetId: target.id, message: `A saved character binding changed: ${binding.id}. Review its cost allocation.` });
    } else if (!linked.length && /^(measured-media-take|lore-source|casting-draft|storyboard-cell|project-asset):/.test(binding.id)) {
      const saved = store.history(binding.id).find(row => row.sha256 === binding.sha256);
      if (!saved) warnings.push({ code: 'MACRO_BINDING_MISSING', targetId: target.id, message: `The exact retained asset record is unavailable: ${binding.id}.` });
      else {
        const data = saved.data, hashes = [data.imageHash, data.blob?.sha256, data.asset?.sha256, data.original?.sha256, data.extraction?.sha256, ...(data.referenceHashes ?? [])];
        for (const hash of hashes) asset(hash, data.title || data.originalFilename || target.label, [target.id], [ref(saved)]);
      }
    }
  }
  for (const attempt of createUsageAccountingService(store).budgetAttempts({ projectId: project.id, sourceHash: project.sourceHash })) {
    let targetId;
    if (attempt.origin === 'TOKEN_STEWARD') {
      targetId = `task:${attempt.id}`;
      add(targetId, 'task', `${attempt.provider} · ${attempt.taskId || attempt.model || 'Unassigned imported usage'}`, [rootId], { category: 'generation', sourceRefs: attempt.recordId ? [{ id: attempt.recordId }] : [], externalTaskId: attempt.taskId });
      observations.push({ id: attempt.id, targetId, currency: 'USD', amount: attempt.costUsd, kind: attempt.costKind, label: `${attempt.provider} · ${attempt.model} · ${attempt.status}` });
    } else if (attempt.origin === 'LOCAL_MODEL') {
      targetId = attempt.id;
      add(targetId, 'task', `Local model · ${attempt.model} · ${attempt.status}`, parentsFor(attempt), { category: 'compute', sourceRefs: [{ id: attempt.recordId }], inputTokens: attempt.inputTokens, outputTokens: attempt.outputTokens });
      observations.push({ id: `incurred:${attempt.id}`, targetId, currency: 'USD', amount: null, kind: 'unknown', label: 'Local compute and energy cost unmeasured' });
    } else {
      targetId = attempt.id;
      if (attempt.quotedCredits !== null) observations.push({ id: `quote:${attempt.id}`, targetId, currency: 'HIGGSFIELD_CREDITS', amount: attempt.quotedCredits, kind: 'quote', label: `Request quote · ${attempt.model}` });
      if (!['PREPARING', 'PREPARED', 'PREPARATION_FAILED'].includes(attempt.status)) observations.push({ id: `incurred:${attempt.id}`, targetId, currency: 'HIGGSFIELD_CREDITS', amount: null, kind: 'unknown', label: `${attempt.status} · actual provider charge unrecorded` });
    }
  }
  if (project.sourceHash !== null) {
    for (const scene of project.scenes) for (const returned of listDccStageReturns(store, scene.id).returns) {
      const target = add(returned.id, 'task', `${returned.application} · retained DCC return`, parentsFor(returned.origin), { category: 'compute', sourceRefs: [{ id: returned.id, sha256: returned.receiptSha256 }] });
      for (const file of returned.artifacts) asset(file.sha256, file.name, [target.id], [{ id: returned.id }], { mimeType: file.mimeType, byteLength: file.byteLength });
    }
    for (const job of dccJobs(store)) {
      const target = add(`dcc-job:${job.jobId}`, 'task', `DCC rehearsal · ${job.phase}`, parentsFor(job), { category: 'compute', sourceRefs: [{ id: job.jobId, version: job.version, sha256: job.sha256 }] });
      observations.push({ id: `incurred:${target.id}`, targetId: target.id, currency: 'USD', amount: null, kind: 'unknown', label: 'Local DCC runtime and energy cost unmeasured' });
    }
  }
  // Include historical/orphaned owned files as inventory gaps rather than losing
  // assets that currently lack a library row. Accounting evidence is not a film asset.
  const blobs = store.db.prepare('SELECT sha256, byte_length, mime_type FROM blobs ORDER BY sha256').all();
  check(blobs.length <= 30000, 'BUDGET_ASSET_LIMIT', 413);
  for (const blob of blobs) if (!evidenceHashes.has(blob.sha256)) asset(blob.sha256, `Retained file · ${blob.sha256.slice(0, 12)}`, [rootId], [], { byteLength: blob.byte_length, mimeType: blob.mime_type });
  const allTargets = [...targets.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { targets: allTargets, observations, warnings, inventoryHash: inventoryHash(project, allTargets, observations), coverage: { workspaceOnly: true, retainedAssets: allTargets.filter(row => row.kind === 'asset').length, shots: allTargets.filter(row => row.kind === 'shot').length, macros: allTargets.filter(row => row.kind === 'macro').length, worldPlans: allTargets.filter(row => row.kind === 'world').length, worldNeeds: allTargets.filter(row => row.kind === 'world-need').length, generationAttempts: allTargets.filter(row => row.kind === 'generation').length, usageEvents: observations.filter(row => row.id.startsWith('usage-event:')).length, excludedAccountingEvidenceBlobs: evidenceHashes.size } };
}

export function createProductionBudgetService(store, { now = () => new Date().toISOString() } = {}) {
  const current = () => store.rawList('production-budget').find(record => record.id === `production-budget:${store.project().id}`) ?? null;
  function snapshot(input, budgetOverride) {
    scope(store.project(), input);
    const record = current(); if (record) store.validateSavedRecord(record);
    const budget = budgetOverride ?? record?.data ?? { ...emptyProductionBudget(store.project()), title: `${store.project().title} · Production budget`.slice(0, 240) };
    validateProductionBudget(budget, store.project());
    const inventory = collectBudgetInventory(store), report = calculateProductionBudget(budget, inventory.targets, inventory.observations);
    report.gaps.push(...inventory.warnings);
    return { schemaVersion: 'qimovi-production-budget/v1', generatedAt: now(), budget, record, inventoryHash: inventory.inventoryHash, targets: inventory.targets, report, warnings: inventory.warnings, coverage: inventory.coverage, authority: 'PLANNING_AND_COST_OBSERVATIONS', enforcement: 'NOT_CONNECTED' };
  }
  return {
    load(input) { return snapshot(input); },
    generate(input) {
      exact(input, ['projectId', 'sourceHash'], ['budget', 'targetIds']);
      let selectedTargets = null;
      if (Object.hasOwn(input, 'targetIds')) {
        check(Array.isArray(input.targetIds), 'BUDGET_TARGET_IDS_INVALID', 422);
        check(input.targetIds.length <= BUDGET_LIMITS.targets, 'BUDGET_TARGET_IDS_LIMIT', 413);
        selectedTargets = new Set(input.targetIds);
        check(input.targetIds.every(id => typeof id === 'string') && selectedTargets.size === input.targetIds.length, 'BUDGET_TARGET_IDS_INVALID', 422);
      }
      const value = snapshot(input, input.budget), budget = structuredClone(value.budget);
      if (selectedTargets) {
        const knownTargets = new Set(value.targets.map(target => target.id));
        check([...selectedTargets].every(id => knownTargets.has(id)), 'BUDGET_TARGET_MISSING', 409);
      }
      const parentIds = new Set(value.targets.flatMap(target => target.parentIds));
      const lineIds = new Set(budget.lines.map(line => line.id));
      const coveredTargets = new Set(budget.lines.flatMap(line => [line.targetId, ...(line.coveredTargetIds ?? [])]));
      for (const target of applyBudgetAssetScope(budget, value.targets).targets) {
        if (selectedTargets && !selectedTargets.has(target.id)) continue;
        if (target.costRequired === false || ['project', 'scene', 'macro', 'world'].includes(target.kind) || (['task', 'step'].includes(target.kind) && parentIds.has(target.id)) || coveredTargets.has(target.id)) continue;
        const quote = value.report.observations.find(row => row.targetId === target.id && row.kind === 'quote');
        const baseId = `line:${sha256(target.id).slice(0, 32)}`;
        let lineId = baseId, suffix = 2;
        while (lineIds.has(lineId)) lineId = `${baseId}:${suffix++}`;
        lineIds.add(lineId);
        const currency = quote?.currency ?? (target.kind === 'generation' ? 'HIGGSFIELD_CREDITS' : 'USD');
        const sourceBasis = target.kind === 'world-need' ? 'Authored world production need.' : target.kind === 'breakdown-element' ? `Saved passage ${target.paragraphId}; source element quantity: ${target.sourceQuantity ?? 'unknown'}.` : 'Retained project inventory; inclusion does not establish a new expense.';
        const basis = quote ? `Retained request quote ${quote.id}; not a charge` : `${sourceBasis} No quoted rate or incurred charge. ${currency}, unit, quantity, runs and attempts are editable planning defaults; confirm allocation before pricing repeated or shared work.`;
        budget.lines.push({ id: lineId, label: target.label.slice(0, 240), targetId: target.id, category: target.category ?? (target.kind === 'asset' ? 'assets' : target.kind === 'shot' ? 'preproduction' : 'other'), currency, unit: 'unit', quantity: '1', runs: '1', attempts: '1', rateLow: null, rate: quote?.amount ?? null, rateHigh: null, remainingQuantity: null, committed: '0', basis, rateDate: null });
      }
      return snapshot(input, budget);
    },
    save(input) {
      exact(input, ['projectId', 'sourceHash', 'expectedVersion', 'requestId', 'inventoryHash', 'budget']);
      scope(store.project(), input); validateProductionBudget(input.budget, store.project());
      check(digest(input.inventoryHash), 'BUDGET_INVENTORY_HASH_INVALID', 422);
      const saveInput = { kind: 'production-budget', data: input.budget, expectedVersion: input.expectedVersion, requestId: input.requestId };
      // The underlying immutable request receipt verifies exact retries, even
      // when new usage arrives after the original save succeeded.
      const retry = typeof input.requestId === 'string' && store.db.prepare('SELECT id FROM requests WHERE id=?').get(input.requestId);
      if (!retry) {
        const inventory = collectBudgetInventory(store);
        check(inventory.inventoryHash === input.inventoryHash, 'BUDGET_INVENTORY_CHANGED', 409);
        const known = new Set(inventory.targets.map(target => target.id));
        const previous = current()?.data;
        const assetTargets = new Map(inventory.targets.map(target => [target.id, target]));
        const previousDecisions = new Map((previous?.assetScopeDecisions ?? []).map(decision => [decision.targetId, decision]));
        for (const decision of input.budget.assetScopeDecisions ?? []) {
          const retained = previousDecisions.get(decision.targetId);
          if (retained && ['targetId', 'usage', 'basis', 'contextKey'].every(key => retained[key] === decision[key])) continue;
          const target = assetTargets.get(decision.targetId);
          check(target, 'BUDGET_ASSET_SCOPE_MISSING', 409);
          check(target.kind === 'asset' && decision.contextKey === budgetAssetContext(target), 'BUDGET_ASSET_SCOPE_STALE', 409);
        }
        for (const line of input.budget.lines) {
          const retained = previous?.lines.find(row => row.id === line.id && row.targetId === line.targetId);
          check(known.has(line.targetId) || retained, 'BUDGET_TARGET_MISSING', 409);
          for (const targetId of line.coveredTargetIds ?? []) check(known.has(targetId) || retained?.coveredTargetIds?.includes(targetId), 'BUDGET_COVERED_TARGET_MISSING', 409);
        }
        for (const actual of input.budget.actuals) {
          const retained = previous?.actuals.find(row => row.id === actual.id);
          if (retained) continue;
          check(known.has(actual.targetId), 'BUDGET_TARGET_MISSING', 409);
          if (actual.observationId) {
            const observation = inventory.observations.find(row => row.id === actual.observationId);
            check(observation && observation.currency === actual.currency && observation.kind !== 'quote', 'BUDGET_OBSERVATION_MISMATCH', 409);
          }
        }
        calculateProductionBudget(input.budget, inventory.targets, inventory.observations);
      }
      const record = store.saveProductionBudget(`production-budget:${input.projectId}`, saveInput);
      const latest = snapshot(input);
      check(latest.record.version === record.version, 'BUDGET_SAVE_SUPERSEDED', 409);
      return { ...latest, record };
    },
  };
}
