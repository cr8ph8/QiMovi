import { projectOwnedContext } from './creative-project.mjs';
// Planning and attributed costs only. This contract never grants execution,
// payment, funding, publication or production authority. All money uses decimal
// strings; BigInt calculations round once, half up, to a billionth of a unit.
export const BUDGET_CATEGORIES = Object.freeze([
  'development', 'preproduction', 'cast', 'crew', 'locations', 'art', 'assets',
  'equipment', 'generation', 'post', 'audio', 'delivery', 'marketing', 'legal',
  'insurance', 'travel', 'storage', 'compute', 'subscriptions', 'overhead',
  'tax', 'contingency', 'other',
]);
// Ledger size is also bounded by the store's persisted-record byte limit.
// Inventory headroom includes usage receipts, project overhead and shared assets.
export const BUDGET_LIMITS = Object.freeze({ lines: 10000, actuals: 20000, targets: 60000,
  observations: 60000, parents: 2000, coveredTargets: 2000, rollupReferences: 2000000, decimalPlaces: 9,
  inputIntegerDigits: 12, outputIntegerDigits: 18 });
const SCALE = 1000000000n;
const MAX_OUTPUT = 10n ** 27n - 1n;
const decimalPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/;
const budgetKeys = ['schemaVersion', 'projectId', 'sourceHash', 'status', 'title', 'lines', 'actuals'];
const lineKeys = ['id', 'label', 'targetId', 'category', 'currency', 'unit', 'quantity', 'runs', 'attempts', 'rateLow', 'rate', 'rateHigh', 'remainingQuantity', 'committed', 'basis', 'rateDate'];
const actualKeys = ['id', 'lineId', 'targetId', 'currency', 'amount', 'kind', 'status', 'evidence', 'externalId', 'recordedAt', 'observationId'];
const observationKeys = ['id', 'targetId', 'currency', 'amount', 'kind', 'label'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const need = (value, code, message = code, status = 422) => { if (!value) throw Object.assign(new Error(message), { code, status }); };
const shape = (value, keys, code) => need(object(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), code, 'The budget record contains missing or unsupported fields.');
const optionalShape = (value, required, optional, code) => need(object(value) && required.every(key => Object.hasOwn(value, key)) && Reflect.ownKeys(value).every(key => required.includes(key) || optional.includes(key)), code, 'The budget record contains missing or unsupported fields.');
const wellFormed = value => { for (const character of value) { const point = character.codePointAt(0); if (point >= 0xd800 && point <= 0xdfff) return false; } return true; };
const text = (value, max, empty = false, multiline = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && wellFormed(value) && !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value);
const id = value => text(value, 512) && value === value.trim();
const currency = value => typeof value === 'string' && (/^[A-Z]{3}$/.test(value) || value === 'HIGGSFIELD_CREDITS');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function timestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(?:Z|([+-])(\d\d):(\d\d))$/.exec(value);
  return Boolean(match && date(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60 && (!match[5] || Number(match[6]) < 24 && Number(match[7]) < 60) && Number.isFinite(Date.parse(value)));
}
function nano(value, nullable = false) {
  if (nullable && value === null) return null;
  need(typeof value === 'string' && decimalPattern.test(value), 'BUDGET_DECIMAL_INVALID', 'Use a nonnegative decimal string with at most 12 whole digits and 9 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, '0'));
}
function bounded(value) {
  need(value >= -MAX_OUTPUT && value <= MAX_OUTPUT, 'BUDGET_MATH_OVERFLOW', 'The calculated budget exceeds the supported amount limit.', 413);
  return value;
}
const sum = values => values.reduce((total, value) => bounded(total + value), 0n);
function multiply(...values) {
  if (values.some(value => value === null)) return null;
  const product = values.reduce((result, value) => result * value, 1n);
  const divisor = SCALE ** BigInt(values.length - 1);
  return bounded((product + divisor / 2n) / divisor);
}
function decimal(value) {
  if (value === null) return null;
  bounded(value);
  const sign = value < 0n ? '-' : '', absolute = value < 0n ? -value : value;
  const remainder = String(absolute % SCALE).padStart(9, '0').replace(/0+$/, '');
  return `${sign}${absolute / SCALE}${remainder ? `.${remainder}` : ''}`;
}
const nullableSum = values => values.some(value => value === null) ? null : sum(values);
const amountFor = actual => nano(actual.amount) * (actual.kind === 'refund' ? -1n : 1n);
const sameCoveredTargets = (before, after) => {
  const left = before?.coveredTargetIds ?? [], right = after?.coveredTargetIds ?? [];
  return left.length === right.length && left.every(targetId => right.includes(targetId));
};
function lineAmounts(line) {
  const quantity = nano(line.quantity), runs = nano(line.runs), attempts = nano(line.attempts), rate = nano(line.rate, true);
  const rateLow = nano(line.rateLow, true) ?? rate, rateHigh = nano(line.rateHigh, true) ?? rate;
  return { estimateLow: multiply(quantity, runs, attempts, rateLow), estimate: multiply(quantity, runs, attempts, rate),
    estimateHigh: multiply(quantity, runs, attempts, rateHigh), perRunEstimate: multiply(quantity, attempts, rate),
    explicitRemaining: line.remainingQuantity === null ? null : multiply(nano(line.remainingQuantity), rate), committed: nano(line.committed) };
}

export function validateProductionBudget(data, project) {
  project = productionBudgetProject(project);
  optionalShape(data, budgetKeys, ['assetScopeDecisions'], 'BUDGET_FIELDS_INVALID');
  need(data.schemaVersion === 1 && text(data.projectId, 160) && (data.sourceHash === null || digest(data.sourceHash)) && data.status === 'DRAFT', 'BUDGET_SCOPE_INVALID', 'A budget must be a source-bound draft for one project.');
  if (project) need(data.projectId === project.id && data.sourceHash === project.sourceHash, 'BUDGET_PROJECT_MISMATCH', 'The budget belongs to another project or source revision.', 409);
  need(text(data.title, 240), 'BUDGET_TITLE_INVALID', 'Enter a budget title of at most 240 characters.');
  need(Array.isArray(data.lines) && data.lines.length <= BUDGET_LIMITS.lines && Array.isArray(data.actuals) && data.actuals.length <= BUDGET_LIMITS.actuals, 'BUDGET_RECORD_LIMIT', 'The budget has too many lines or actual entries.', 413);
  if (Object.hasOwn(data, 'assetScopeDecisions')) {
    need(Array.isArray(data.assetScopeDecisions), 'BUDGET_ASSET_SCOPE_INVALID', 'Asset budget scope decisions must be a list.');
    need(data.assetScopeDecisions.length <= BUDGET_LIMITS.targets, 'BUDGET_ASSET_SCOPE_LIMIT', 'The asset budget scope list exceeds the supported size.', 413);
    const targetIds = new Set();
    for (const decision of data.assetScopeDecisions) {
      shape(decision, ['targetId', 'usage', 'basis', 'contextKey'], 'BUDGET_ASSET_SCOPE_FIELDS_INVALID');
      need(id(decision.targetId) && !targetIds.has(decision.targetId), 'BUDGET_ASSET_SCOPE_TARGET_INVALID', 'Each asset budget scope decision needs one unique target id.');
      need(['production', 'reference-only'].includes(decision.usage) && text(decision.basis, 2000, false, true) && text(decision.contextKey, 512000),
        'BUDGET_ASSET_SCOPE_INVALID', 'Choose production or reference-only use and describe its basis for the current asset context.');
      targetIds.add(decision.targetId);
    }
  }
  const lines = new Map(), actualIds = new Set(), externalIds = new Set(), observationIds = new Set();
  for (const line of data.lines) {
    optionalShape(line, lineKeys, ['paymentPlan', 'coveredTargetIds', 'productionPlan'], 'BUDGET_LINE_FIELDS_INVALID');
    if (Object.hasOwn(line, 'coveredTargetIds')) {
      need(Array.isArray(line.coveredTargetIds), 'BUDGET_COVERED_TARGETS_INVALID', 'Shared work targets must be a list of additional work ids.');
      need(line.coveredTargetIds.length <= BUDGET_LIMITS.coveredTargets,
        'BUDGET_COVERED_TARGETS_LIMIT', 'Shared costs support a bounded list of additional work targets.', 413);
      need(line.coveredTargetIds.every(targetId => id(targetId) && targetId !== line.targetId) && new Set(line.coveredTargetIds).size === line.coveredTargetIds.length,
        'BUDGET_COVERED_TARGETS_INVALID', 'Shared work targets must be unique valid ids and exclude the primary target.');
    }
    if (Object.hasOwn(line, 'paymentPlan')) {
      shape(line.paymentPlan, ['vendor', 'expectedDate', 'basis'], 'BUDGET_PAYMENT_PLAN_INVALID');
      need(text(line.paymentPlan.vendor, 240, true) && text(line.paymentPlan.basis, 2000, true, true) && (line.paymentPlan.expectedDate === null || date(line.paymentPlan.expectedDate)), 'BUDGET_PAYMENT_PLAN_INVALID', 'Use a vendor, optional expected payment date and payment planning basis.');
      need(line.paymentPlan.expectedDate === null || line.paymentPlan.basis.trim().length > 0, 'BUDGET_PAYMENT_BASIS_REQUIRED', 'Describe the source or assumption for the expected payment date.');
    }
    if (Object.hasOwn(line, 'productionPlan')) {
      const plan = line.productionPlan;
      shape(plan, ['method', 'departmentOwner', 'startDate', 'endDate', 'quantityBasis', 'notes'], 'BUDGET_PRODUCTION_PLAN_INVALID');
      need(['undecided', 'live-action', 'virtual', 'generated', 'hybrid'].includes(plan.method) &&
        text(plan.departmentOwner, 240, true) && text(plan.quantityBasis, 2000, true, true) && text(plan.notes, 4000, true, true),
      'BUDGET_PRODUCTION_PLAN_INVALID', 'Use a production method, department or owner, quantity basis and planning notes within their limits.');
      need((plan.startDate === null || date(plan.startDate)) && (plan.endDate === null || date(plan.endDate)) &&
        (plan.startDate === null || plan.endDate === null || plan.endDate >= plan.startDate),
      'BUDGET_PRODUCTION_PLAN_DATES_INVALID', 'Use optional calendar dates in YYYY-MM-DD format; the end cannot precede the start.');
    }
    need(id(line.id) && id(line.targetId) && !lines.has(line.id), 'BUDGET_LINE_ID_INVALID', 'Each budget line needs a unique id and a target.');
    need(text(line.label, 500) && text(line.unit, 80) && BUDGET_CATEGORIES.includes(line.category) && currency(line.currency), 'BUDGET_LINE_METADATA_INVALID', 'Check the line label, unit, category and currency.');
    for (const field of ['quantity', 'runs', 'attempts', 'committed']) nano(line[field]);
    for (const field of ['rateLow', 'rate', 'rateHigh', 'remainingQuantity']) nano(line[field], true);
    need(text(line.basis, 8000, true, true) && (line.rateDate === null || date(line.rateDate)), 'BUDGET_LINE_BASIS_INVALID', 'Use a valid rate basis and a calendar date in YYYY-MM-DD format.');
    need([line.rateLow, line.rate, line.rateHigh].every(value => value === null) || line.basis.trim().length > 0, 'BUDGET_RATE_BASIS_REQUIRED', 'Describe the source or assumption for every entered rate, including zero.');
    const low = nano(line.rateLow, true), base = nano(line.rate, true), high = nano(line.rateHigh, true);
    need((low === null || base === null || low <= base) && (high === null || base === null || base <= high) && (low === null || high === null || low <= high), 'BUDGET_RATE_RANGE_INVALID', 'Low rate must not exceed the base rate, and high rate must not be below it.');
    lineAmounts(line);
    lines.set(line.id, line);
  }
  for (const actual of data.actuals) {
    optionalShape(actual, actualKeys, ['costDate', 'commitmentApplied'], 'BUDGET_ACTUAL_FIELDS_INVALID');
    need(id(actual.id) && !actualIds.has(actual.id) && id(actual.targetId) && (actual.lineId === null || id(actual.lineId)) && currency(actual.currency), 'BUDGET_ACTUAL_ID_INVALID', 'Each actual entry needs a unique id, target and currency.');
    nano(actual.amount);
    if (Object.hasOwn(actual, 'costDate')) need(actual.costDate === null || date(actual.costDate), 'BUDGET_COST_DATE_INVALID', 'Use the evidenced cost date in YYYY-MM-DD format or leave it unknown.');
    if (Object.hasOwn(actual, 'commitmentApplied')) need(nano(actual.commitmentApplied) <= nano(actual.amount) && actual.kind === 'charge' && actual.lineId !== null, 'BUDGET_COMMITMENT_APPLICATION_INVALID', 'Only a linked charge can replace an outstanding commitment, up to the charge amount.');
    need(['charge', 'refund'].includes(actual.kind) && ['reported', 'reconciled'].includes(actual.status), 'BUDGET_ACTUAL_KIND_INVALID', 'Actual entries must be a reported or reconciled charge or refund.');
    need(text(actual.evidence, 8000, false, true) && id(actual.externalId) && timestamp(actual.recordedAt) && (actual.observationId === null || id(actual.observationId)), 'BUDGET_ACTUAL_EVIDENCE_INVALID', 'Provide cost evidence, a unique external reference and a valid recorded timestamp.');
    const externalKey = JSON.stringify([actual.currency, actual.externalId]);
    need(!externalIds.has(externalKey), 'BUDGET_ACTUAL_EXTERNAL_ID_DUPLICATE', 'That external cost reference is already recorded in this currency.');
    if (actual.lineId !== null) {
      const line = lines.get(actual.lineId);
      need(line && line.currency === actual.currency && line.targetId === actual.targetId, 'BUDGET_ACTUAL_LINE_MISMATCH', 'The actual must use the linked line’s target and currency.');
    }
    if (actual.observationId !== null) {
      need(actual.kind === 'charge', 'BUDGET_REFUND_OBSERVATION_INVALID', 'Record refunds as separate entries without replacing the original cost observation.');
      need(!observationIds.has(actual.observationId), 'BUDGET_ACTUAL_OBSERVATION_DUPLICATE', 'An imported observation can be replaced by only one actual entry.');
      observationIds.add(actual.observationId);
    }
    actualIds.add(actual.id); externalIds.add(externalKey);
  }
  // Catch aggregate overflow before persistence as well as during reporting.
  const currencySums = new Map();
  for (const line of data.lines) {
    const totals = currencySums.get(line.currency) ?? [0n, 0n, 0n, 0n];
    const amounts = lineAmounts(line);
    [amounts.estimateLow, amounts.estimate, amounts.estimateHigh, amounts.committed].forEach((value, index) => { totals[index] = bounded(totals[index] + (value ?? 0n)); });
    currencySums.set(line.currency, totals);
  }
  return data;
}

export function validateBudgetIdentity(recordId, kind, data) {
  if (kind !== 'production-budget' && !(typeof recordId === 'string' && recordId.startsWith('production-budget:'))) return;
  need(kind === 'production-budget' && id(data?.projectId) && recordId === `production-budget:${data.projectId}`, 'BUDGET_IDENTITY_INVALID', 'The budget record id must match its project.', 409);
}

// The ledger remains project-owned when a production screenplay is attached.
export function productionBudgetProject(project) {
  return projectOwnedContext(project, 'production-budget', { projectId: project?.id, sourceHash: null });
}

export function emptyProductionBudget(project) {
  project = productionBudgetProject(project);
  const data = { schemaVersion: 1, projectId: project?.id, sourceHash: project?.sourceHash, status: 'DRAFT', title: 'Production budget', lines: [], actuals: [] };
  return validateProductionBudget(data, project);
}

function validateTargets(targets) {
  need(Array.isArray(targets) && targets.length <= BUDGET_LIMITS.targets, 'BUDGET_TARGET_LIMIT', 'The target list exceeds the supported size.', 413);
  const result = new Map();
  for (const target of targets) {
    need(object(target) && id(target.id) && !result.has(target.id) && text(target.kind, 80) && text(target.label, 500), 'BUDGET_TARGET_INVALID', 'Each budget target needs a unique id, kind and label.');
    need(target.costRequired === undefined || typeof target.costRequired === 'boolean', 'BUDGET_TARGET_INVALID', 'A target cost requirement must be a boolean.');
    need(Array.isArray(target.parentIds) && target.parentIds.length <= BUDGET_LIMITS.parents && target.parentIds.every(id) && new Set(target.parentIds).size === target.parentIds.length, 'BUDGET_TARGET_PARENTS_INVALID', 'Target parents must be unique valid ids.');
    result.set(target.id, target);
  }
  return result;
}

/** Stable authored context only; effective cost requirements are deliberately excluded. */
export function budgetAssetContext(target) {
  const sourceRefs = (Array.isArray(target.sourceRefs) ? target.sourceRefs : []).map(source => ({
    id: source.id ?? null, sha256: source.sha256 ?? null, version: source.version ?? null,
  })).map(source => JSON.stringify(source)).sort().map(source => JSON.parse(source));
  return JSON.stringify({ id: target.id, kind: target.kind, parentIds: [...target.parentIds].sort(), sourceRefs });
}

/** Scope affects only the asset's own missing allocation, never stored money or descendants. */
export function applyBudgetAssetScope(data, targets) {
  validateProductionBudget(data);
  const targetMap = validateTargets(targets), decisions = new Map(), gaps = [];
  for (const decision of data.assetScopeDecisions ?? []) {
    const target = targetMap.get(decision.targetId);
    if (!target) {
      gaps.push({ code: 'BUDGET_ASSET_SCOPE_MISSING', targetId: decision.targetId, message: 'The asset for this budget scope decision is unavailable. The decision and any recorded costs are retained.' });
      continue;
    }
    const current = target.kind === 'asset' && decision.contextKey === budgetAssetContext(target);
    if (!current) gaps.push({ code: 'BUDGET_ASSET_SCOPE_STALE', targetId: target.id, message: 'The asset context changed. Review its budget use again; its current cost requirements remain in effect.' });
    decisions.set(target.id, { decision, current });
  }
  return { targets: targets.map(target => {
    const entry = decisions.get(target.id);
    if (!entry) return target;
    return { ...target, budgetUsage: entry.current ? entry.decision.usage : 'needs-review', budgetScopeBasis: entry.decision.basis,
      ...(entry.current ? { costRequired: entry.decision.usage === 'production' } : {}) };
  }), gaps };
}

function normalizeTargets(targets, gaps) {
  const result = new Map([...validateTargets(targets).values()].map(target => [target.id, {
    id: target.id, kind: target.kind, label: target.label, parentIds: [...target.parentIds], costRequired: target.costRequired !== false,
    ...(target.kind === 'asset' || target.budgetUsage === 'needs-review' ? { budgetUsage: target.budgetUsage ?? 'unreviewed', ...(target.budgetScopeBasis === undefined ? {} : { budgetScopeBasis: target.budgetScopeBasis }) } : {}),
    lineIds: new Set(), eventIds: new Set(), missing: new Set(), children: 0,
  }]));
  for (const target of result.values()) for (const parentId of target.parentIds) {
    if (result.has(parentId)) result.get(parentId).children++;
    else gaps.push({ code: 'DANGLING_PARENT', targetId: target.id, message: `Parent target ${parentId} is missing; its rollup cannot be completed.` });
  }
  return result;
}
function normalizeObservations(observations) {
  need(Array.isArray(observations) && observations.length <= BUDGET_LIMITS.observations, 'BUDGET_OBSERVATION_LIMIT', 'The imported observation list exceeds the supported size.', 413);
  const ids = new Set();
  for (const observation of observations) {
    shape(observation, observationKeys, 'BUDGET_OBSERVATION_FIELDS_INVALID');
    need(id(observation.id) && !ids.has(observation.id) && id(observation.targetId) && currency(observation.currency) && text(observation.label, 500), 'BUDGET_OBSERVATION_INVALID', 'Imported observations need unique ids, valid targets, currencies and labels.');
    nano(observation.amount, true);
    need(['reported', 'estimated', 'quote', 'unknown'].includes(observation.kind) && (observation.kind !== 'unknown' || observation.amount === null), 'BUDGET_OBSERVATION_KIND_INVALID', 'Unknown observations cannot assert a cost.');
    ids.add(observation.id);
  }
  return observations;
}
function eventAmounts(events) {
  const reported = events.filter(event => event.status === 'reported'), reconciled = events.filter(event => event.status === 'reconciled');
  return { reportedActual: nullableSum(reported.map(event => event.amount)), reconciledActual: sum(reconciled.map(event => event.amount)),
    actual: nullableSum(events.map(event => event.amount)), knownActual: sum(events.map(event => event.amount ?? 0n)), unknownActualCount: events.filter(event => event.amount === null).length };
}

export function calculateProductionBudget(data, targets, observations = []) {
  const scoped = applyBudgetAssetScope(data, targets); normalizeObservations(observations);
  const gaps = [...scoped.gaps], targetMap = normalizeTargets(scoped.targets, gaps), lineMap = new Map(data.lines.map(line => [line.id, line]));
  const observationMap = new Map(observations.map(observation => [observation.id, observation]));
  const replacements = new Set(), events = new Map(), lineEvents = new Map(), targetCurrencyLines = new Map();
  const addEvent = event => {
    events.set(event.id, event);
    if (event.lineId !== null) {
      const entries = lineEvents.get(event.lineId) ?? []; entries.push(event); lineEvents.set(event.lineId, entries);
    }
    if (targetMap.has(event.targetId)) targetMap.get(event.targetId).eventIds.add(event.id);
    else gaps.push({ code: 'DANGLING_ACTUAL_TARGET', targetId: event.targetId, message: 'A cost observation points to a missing target; it remains in the project total.' });
    // Shared views reference the same incurred event. The event's attribution
    // and the stored actual remain on the primary target.
    for (const targetId of lineMap.get(event.lineId)?.coveredTargetIds ?? []) targetMap.get(targetId)?.eventIds.add(event.id);
  };
  for (const line of data.lines) {
    const key = JSON.stringify([line.targetId, line.currency]), ids = targetCurrencyLines.get(key) ?? [];
    ids.push(line.id); targetCurrencyLines.set(key, ids);
    if (targetMap.has(line.targetId)) targetMap.get(line.targetId).lineIds.add(line.id);
    else gaps.push({ code: 'DANGLING_LINE_TARGET', targetId: line.targetId, lineId: line.id, message: 'This line points to a missing target; its cost remains in the project total.' });
    for (const targetId of line.coveredTargetIds ?? []) {
      if (targetMap.has(targetId)) targetMap.get(targetId).lineIds.add(line.id);
      else gaps.push({ code: 'DANGLING_COVERED_TARGET', targetId, lineId: line.id, message: 'Shared work is no longer in the inventory; the cost remains attributed to its primary target.' });
    }
    if (line.rate === null) gaps.push({ code: 'UNPRICED_LINE', targetId: line.targetId, lineId: line.id, message: 'The base rate is unknown. Enter a rate and its source or assumption.' });
  }
  for (const actual of data.actuals) {
    if (actual.observationId !== null) {
      const observation = observationMap.get(actual.observationId);
      if (observation) {
        need(observation.currency === actual.currency, 'BUDGET_OBSERVATION_CURRENCY_MISMATCH', 'The actual and its replaced observation must use the same currency.');
        need(observation.kind !== 'quote', 'BUDGET_QUOTE_REPLACEMENT_INVALID', 'A quote is not an incurred cost observation. Record the evidenced charge as a separate actual.');
      }
      else gaps.push({ code: 'DANGLING_OBSERVATION', targetId: actual.targetId, message: 'The replaced observation is unavailable; the recorded actual is retained.' });
      replacements.add(actual.observationId);
    }
    addEvent({ id: `actual:${actual.id}`, targetId: actual.targetId, lineId: actual.lineId, currency: actual.currency, amount: amountFor(actual), status: actual.status });
    if (actual.lineId === null) gaps.push({ code: 'UNALLOCATED_ACTUAL', targetId: actual.targetId, message: 'An actual has no budget line; its cost is included in addition to line forecasts.' });
  }
  for (const observation of observations) {
    if (replacements.has(observation.id) || observation.kind === 'quote') continue;
    const matches = targetCurrencyLines.get(JSON.stringify([observation.targetId, observation.currency])) ?? [];
    const lineId = matches.length === 1 ? matches[0] : null;
    const amount = observation.kind === 'reported' ? nano(observation.amount, true) : null;
    addEvent({ id: `observation:${observation.id}`, targetId: observation.targetId, lineId, currency: observation.currency, amount, status: 'reported' });
    if (lineId === null) gaps.push({ code: 'UNALLOCATED_ACTUAL', targetId: observation.targetId, message: 'An imported cost has no unique budget line. Reconcile it to a line to refine the forecast.' });
    if (amount === null) gaps.push({ code: 'UNKNOWN_ACTUAL', targetId: observation.targetId, ...(lineId ? { lineId } : {}), message: 'An incurred event has no reported or reconciled charge; actual cost remains unknown.' });
  }
  const calculated = new Map();
  for (const line of data.lines) {
    const amounts = lineAmounts(line), actuals = eventAmounts(lineEvents.get(line.id) ?? []);
    let remaining = amounts.explicitRemaining;
    if (line.remainingQuantity === null) {
      remaining = amounts.estimate === null || actuals.actual === null ? null : bounded(amounts.estimate - actuals.actual - amounts.committed);
      if (remaining !== null && remaining < 0n) remaining = 0n;
    }
    const forecast = nullableSum([actuals.actual, amounts.committed, remaining]);
    calculated.set(line.id, { ...amounts, ...actuals, estimateToComplete: remaining, forecast,
      knownForecast: sum([actuals.knownActual, amounts.committed, remaining ?? 0n]),
      variance: forecast === null || amounts.estimate === null ? null : bounded(forecast - amounts.estimate) });
  }
  const rollup = (lineIds, eventIds, isMacro = false, missingEstimateCount = 0) => {
    const groups = new Map();
    const group = name => { if (!groups.has(name)) groups.set(name, { lines: [], events: [] }); return groups.get(name); };
    for (const lineId of lineIds) group(lineMap.get(lineId).currency).lines.push({ id: lineId, ...calculated.get(lineId) });
    for (const eventId of eventIds) { const event = events.get(eventId); group(event.currency).events.push(event); }
    return [...groups.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([currency, entries]) => {
      const missingCount = Math.max(missingEstimateCount, entries.lines.length === 0 ? 1 : 0);
      const amounts = eventAmounts(entries.events), estimate = missingCount ? null : nullableSum(entries.lines.map(line => line.estimate));
      const unattached = entries.events.filter(event => event.lineId === null || !lineIds.has(event.lineId));
      const forecast = missingCount ? null : nullableSum([...entries.lines.map(line => line.forecast), ...unattached.map(event => event.amount)]);
      const totals = { currency, estimateLow: missingCount ? null : nullableSum(entries.lines.map(line => line.estimateLow)), estimate, estimateHigh: missingCount ? null : nullableSum(entries.lines.map(line => line.estimateHigh)),
        reportedActual: amounts.reportedActual, reconciledActual: amounts.reconciledActual, actual: amounts.actual,
        committed: sum(entries.lines.map(line => line.committed)), estimateToComplete: missingCount ? null : nullableSum(entries.lines.map(line => line.estimateToComplete)),
        forecast, variance: forecast === null || estimate === null ? null : bounded(forecast - estimate),
        knownEstimate: sum(entries.lines.map(line => line.estimate ?? 0n)), knownActual: amounts.knownActual,
        knownForecast: sum([...entries.lines.map(line => line.knownForecast), ...unattached.map(event => event.amount ?? 0n)]),
        unknownEstimateCount: missingCount + entries.lines.filter(line => line.estimate === null).length, unknownActualCount: amounts.unknownActualCount,
        ...(isMacro ? { perRunEstimate: missingCount ? null : nullableSum(entries.lines.map(line => line.perRunEstimate)) } : {}) };
      return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, typeof value === 'bigint' ? decimal(value) : value]));
    });
  };
  // Process the DAG from leaves toward parents. Sets keep shared assets and
  // shared descendants once per rollup, including paths through two macros.
  const pendingChildren = new Map([...targetMap.values()].map(target => [target.id, target.children]));
  const queue = [...targetMap.values()].filter(target => target.children === 0);
  const unpricedTargetIds = new Set();
  for (const target of queue) if (target.costRequired && target.lineIds.size === 0) {
    target.missing.add(target.id);
    unpricedTargetIds.add(target.id);
    gaps.push({ code: 'UNPRICED_TARGET', targetId: target.id, message: 'This target has no budget line. Its cost is unknown.' });
  }
  let references = sum([...targetMap.values()].map(target => BigInt(target.lineIds.size + target.eventIds.size + target.missing.size)));
  need(references <= BigInt(BUDGET_LIMITS.rollupReferences), 'BUDGET_ROLLUP_LIMIT', 'The budget hierarchy has too many shared rollup references.', 413);
  const merge = (destination, source) => {
    for (const value of source) if (!destination.has(value)) {
      references++; need(references <= BigInt(BUDGET_LIMITS.rollupReferences), 'BUDGET_ROLLUP_LIMIT', 'The budget hierarchy has too many shared rollup references.', 413); destination.add(value);
    }
  };
  for (let index = 0; index < queue.length; index++) for (const parentId of queue[index].parentIds) {
    const parent = targetMap.get(parentId); if (!parent) continue;
    merge(parent.lineIds, queue[index].lineIds); merge(parent.eventIds, queue[index].eventIds); merge(parent.missing, queue[index].missing);
    pendingChildren.set(parentId, pendingChildren.get(parentId) - 1); if (pendingChildren.get(parentId) === 0) queue.push(parent);
  }
  need(queue.length === targetMap.size, 'BUDGET_TARGET_CYCLE', 'Budget target links must not contain a cycle.');
  const targetReports = [...targetMap.values()].map(target => {
    const priced = [...target.lineIds].filter(lineId => calculated.get(lineId).estimate !== null).length;
    return { id: target.id, kind: target.kind, label: target.label, parentIds: target.parentIds,
      ...(target.budgetUsage === undefined ? {} : { budgetUsage: target.budgetUsage, ...(target.budgetScopeBasis === undefined ? {} : { budgetScopeBasis: target.budgetScopeBasis }) }),
      coverage: priced === 0 ? 'UNPRICED' : priced < target.lineIds.size || target.missing.size > 0 ? 'PARTIAL' : 'PRICED',
      lineIds: [...target.lineIds].sort(), totals: rollup(target.lineIds, target.eventIds, target.kind === 'macro', target.missing.size) };
  });
  const lines = data.lines.map(line => {
    const amounts = calculated.get(line.id);
    const fields = ['estimateLow', 'estimate', 'estimateHigh', 'actual', 'reportedActual', 'reconciledActual', 'estimateToComplete', 'forecast', 'variance'];
    return { ...line, ...Object.fromEntries(fields.map(field => [field, decimal(amounts[field])])) };
  });
  return { schemaVersion: 1, projectId: data.projectId, sourceHash: data.sourceHash,
    totals: rollup(new Set(lineMap.keys()), new Set(events.keys()), false, unpricedTargetIds.size), lines, targets: targetReports, gaps,
    observations: observations.map(observation => ({ ...observation })) };
}

/** Dated expectations and incurred costs are separate series, never a paid-cash total. */
export function calculateBudgetCashflow(data, observations = []) {
  validateProductionBudget(data); normalizeObservations(observations);
  const observationMap = new Map(observations.map(entry => [entry.id, entry]));
  for (const actual of data.actuals) if (actual.observationId !== null && observationMap.has(actual.observationId)) {
    const observation = observationMap.get(actual.observationId);
    need(observation.currency === actual.currency, 'BUDGET_OBSERVATION_CURRENCY_MISMATCH', 'The actual and its replaced observation must use the same currency.');
    need(observation.kind !== 'quote', 'BUDGET_QUOTE_REPLACEMENT_INVALID', 'A quote is not an incurred cost observation.');
  }
  const entries = [], replaced = new Set(data.actuals.map(entry => entry.observationId).filter(Boolean));
  for (const line of data.lines) if (nano(line.committed) > 0n) entries.push({
    id: `commitment:${line.id}`, kind: 'commitment', label: line.label, lineId: line.id, targetId: line.targetId,
    date: line.paymentPlan?.expectedDate ?? null, currency: line.currency, amount: line.committed,
    vendor: line.paymentPlan?.vendor ?? '', evidence: line.paymentPlan?.basis ?? '',
  });
  for (const actual of data.actuals) entries.push({
    id: `actual:${actual.id}`, kind: 'actual', label: actual.externalId, lineId: actual.lineId, targetId: actual.targetId,
    date: actual.costDate ?? null, currency: actual.currency, amount: decimal(amountFor(actual)), vendor: '', evidence: actual.evidence,
  });
  for (const observation of observations) if (!replaced.has(observation.id) && observation.kind !== 'quote') entries.push({
    id: `observation:${observation.id}`, kind: 'observation', label: observation.label, lineId: null, targetId: observation.targetId,
    date: null, currency: observation.currency, amount: observation.kind === 'reported' ? observation.amount : null,
    vendor: '', evidence: 'Connected cost observation; incurred date unavailable.',
  });
  const groups = new Map();
  for (const entry of entries) {
    const currency = groups.get(entry.currency) ?? new Map(), key = entry.date?.slice(0, 7) ?? null;
    const month = currency.get(key) ?? { month: key, expected: 0n, incurred: 0n, unknownIncurredCount: 0, commitmentCount: 0, costCount: 0 };
    // Signed refund amounts are generated internally after nonnegative-input validation.
    const amount = entry.amount === null ? null : entry.amount.startsWith('-') ? -nano(entry.amount.slice(1)) : nano(entry.amount);
    if (entry.kind === 'commitment') { month.expected = bounded(month.expected + amount); month.commitmentCount++; }
    else { month.incurred = bounded(month.incurred + (amount ?? 0n)); month.unknownIncurredCount += amount === null ? 1 : 0; month.costCount++; }
    currency.set(key, month); groups.set(entry.currency, currency);
  }
  const currencies = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([currency, months]) => ({ currency,
    months: [...months.values()].sort((a, b) => a.month === null ? 1 : b.month === null ? -1 : a.month.localeCompare(b.month)).map(month => ({
      month: month.month, expectedCommitments: decimal(month.expected), incurredCosts: month.unknownIncurredCount ? null : decimal(month.incurred),
      knownIncurredCosts: decimal(month.incurred), unknownIncurredCount: month.unknownIncurredCount, commitmentCount: month.commitmentCount, costCount: month.costCount,
    })),
  }));
  return { currencies, entries: entries.sort((a, b) => (a.date ?? '9999-99-99').localeCompare(b.date ?? '9999-99-99') || a.id.localeCompare(b.id)) };
}

export function appendBudgetActual(data, actual) {
  validateProductionBudget({ ...data, actuals: [...data.actuals, actual] });
  const applied = actual.commitmentApplied === undefined ? 0n : nano(actual.commitmentApplied);
  const line = data.lines.find(row => row.id === actual.lineId);
  need(applied === 0n || line && applied <= nano(line.committed), 'BUDGET_COMMITMENT_APPLICATION_EXCEEDED', 'The amount applied exceeds this line’s outstanding commitment.');
  const result = { ...data, lines: data.lines.map(row => row.id === actual.lineId && applied > 0n ? { ...row, committed: decimal(nano(row.committed) - applied) } : row), actuals: [...data.actuals, actual] };
  return validateProductionBudget(result);
}

/** Attribution must change a saved outstanding commitment by the exact amount.
 * Save ordinary commitment/quote edits first, then append their incurred costs.
 * Called inside the store transaction as well as in the draft UI. */
export function validateBudgetCommitmentTransition(previous, next) {
  validateProductionBudget(next);
  if (previous) validateProductionBudget(previous);
  const previousActuals = new Set((previous?.actuals ?? []).map(actual => actual.id));
  const appliedByLine = new Map();
  for (const actual of next.actuals) if (!previousActuals.has(actual.id) && actual.commitmentApplied !== undefined) {
    const applied = nano(actual.commitmentApplied);
    if (applied > 0n) appliedByLine.set(actual.lineId, (appliedByLine.get(actual.lineId) ?? 0n) + applied);
  }
  const previousLines = new Map((previous?.lines ?? []).map(line => [line.id, line]));
  const nextLines = new Map(next.lines.map(line => [line.id, line]));
  const incurredLines = new Set([...(previous?.actuals ?? []), ...next.actuals].map(actual => actual.lineId).filter(Boolean));
  for (const lineId of incurredLines) {
    const before = previousLines.get(lineId), after = nextLines.get(lineId);
    if (before) need(after && sameCoveredTargets(before, after), 'BUDGET_SHARED_TARGETS_LOCKED', 'Save shared work links before recording costs. Links on a line with recorded costs cannot be changed.', 409);
  }
  for (const [lineId, applied] of appliedByLine) {
    const before = previousLines.get(lineId), after = nextLines.get(lineId);
    const stableBasis = before && after && sameCoveredTargets(before, after) && ['targetId', 'currency', 'basis', 'rateDate', 'rate', 'rateLow', 'rateHigh'].every(key => before[key] === after[key]) &&
      ['vendor', 'expectedDate', 'basis'].every(key => (before.paymentPlan?.[key] ?? null) === (after.paymentPlan?.[key] ?? null));
    need(stableBasis && nano(before.committed) >= applied && nano(after.committed) === nano(before.committed) - applied,
      'BUDGET_COMMITMENT_TRANSITION_INVALID', 'Save changes to outstanding commitments before recording a cost against them.', 409);
  }
}

export function removeDraftBudgetActual(data, actualId) {
  validateProductionBudget(data);
  const actual = data.actuals.find(row => row.id === actualId), applied = actual?.commitmentApplied === undefined ? 0n : nano(actual.commitmentApplied);
  const result = { ...data, lines: data.lines.map(row => row.id === actual?.lineId && applied > 0n ? { ...row, committed: decimal(nano(row.committed) + applied) } : row), actuals: data.actuals.filter(row => row.id !== actualId) };
  return validateProductionBudget(result);
}
