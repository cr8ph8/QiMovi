import { BUDGET_CATEGORIES, calculateProductionBudget, validateProductionBudget, type BudgetCategory, type BudgetLine, type BudgetTarget, type ProductionBudget } from '../../local/contracts/production-budget.mjs';

export const BUDGET_REFERENCE_LIMITS = Object.freeze({ fileBytes: 2 * 1024 * 1024, categories: 128, rows: 2000, depth: 10, nodes: 100000 });
export interface BudgetReferenceCategory { account: string; label: string; labelStatus: string; sourcePage: number }
export interface BudgetReferenceSource { sourceId: string; page: number; extractedTable: number; extractedRow: number; label: string; rawTablePath: string }
export interface BudgetReferenceRow {
  id: string; account: string | null; categoryAccount: string; description: string;
  quantity: null; unit: string | null; runs: null; attempts: null; rate: null; currency: null;
  estimatedTotal: null; actualTotal: null; status: 'uncosted_reference'; historicalReferenceId: string;
  source: BudgetReferenceSource;
}
export interface BudgetReferenceTemplate {
  schema: 'qimovi-reference-budget-template/v1'; name: string;
  status: 'reference_template_requires_project_scope_and_recost'; sourceProject: string;
  currentProject: null; approved: false; currencyCode: null; sourceExtraction: string; sourceSha256: string;
  observedOn: string; rules: string[]; categories: BudgetReferenceCategory[]; lineItems: BudgetReferenceRow[]; assumptionsToResolve: string[];
}
export interface ApplyBudgetReferenceOptions {
  currency: string; targets: readonly BudgetTarget[];
  /** Explicitly map every selected source account to an existing project or department target. */
  targetByCategory: Record<string, string>; categoryAccounts?: readonly string[];
}
export interface AppliedBudgetReference { budget: ProductionBudget; addedLineIds: string[]; skippedLineIds: string[] }

const need: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

/** Reject accessors, exotic objects, sparse arrays and oversized/cyclic trees before reading fields. */
function safeJson(value: unknown): void {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number) {
    need(depth <= BUDGET_REFERENCE_LIMITS.depth && ++nodes <= BUDGET_REFERENCE_LIMITS.nodes, 'The reference template exceeds its structure limits.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { need(item.length <= 8000, 'A reference template text field is too long.'); return; }
    if (typeof item === 'number') { need(Number.isSafeInteger(item) && !Object.is(item, -0), 'Reference numbers must be safe integers.'); return; }
    need(Array.isArray(item) || object(item), 'The reference template contains a non-JSON object.');
    need(!ancestors.has(item), 'The reference template contains a cycle.');
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (Array.isArray(item)) {
      need(Object.getPrototypeOf(item) === Array.prototype, 'Reference arrays must be plain JSON arrays.');
      need(item.length <= BUDGET_REFERENCE_LIMITS.rows && keys.length === item.length + 1, 'Reference arrays must be bounded and dense.');
      for (let i = 0; i < item.length; i++) need(own(descriptors, String(i)), 'Reference arrays must be dense.');
    }
    for (const key of keys) {
      if (Array.isArray(item) && key === 'length') continue;
      need(typeof key === 'string' && !forbiddenKeys.has(key), 'The reference template contains a forbidden field.');
      const descriptor = descriptors[key];
      need(own(descriptor, 'value') && descriptor.enumerable, 'Reference fields must be plain JSON values, without accessors.');
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
  need(new TextEncoder().encode(JSON.stringify(value)).byteLength <= BUDGET_REFERENCE_LIMITS.fileBytes, 'Reference templates must be no larger than 2 MB.');
}
function shape(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  need(object(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => own(value, key)), `${label} contains missing or unsupported fields.`);
}
function text(value: unknown, max: number, multiline = false): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return false;
  return Array.from(value).every(c => {
    const n = c.codePointAt(0)!;
    if (n < 32 && !(multiline && [9, 10, 13].includes(n))) return false;
    return !(n >= 0x7f && n <= 0x9f || n >= 0x202a && n <= 0x202e || n >= 0x2066 && n <= 0x2069 || n >= 0xd800 && n <= 0xdfff);
  });
}
const token = (value: unknown, max = 96): value is string => text(value, max) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const account = (value: unknown): value is string => token(value, 64);
const integer = (value: unknown, max: number) => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= max;
const localReference = (value: unknown) => text(value, 240) && !value.startsWith('/') && !/[\\:]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
function day(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function textList(value: unknown, maxItems: number, label: string) {
  need(Array.isArray(value) && value.length <= maxItems && value.every(item => text(item, 4000, true)), `${label} must contain bounded readable text.`);
}

/** This format accepts only an uncosted historical scaffold, never imported prices or approvals. */
export function validateBudgetReferenceTemplate(value: unknown): BudgetReferenceTemplate {
  safeJson(value);
  shape(value, ['schema', 'name', 'status', 'sourceProject', 'currentProject', 'approved', 'currencyCode', 'sourceExtraction', 'sourceSha256', 'observedOn', 'rules', 'categories', 'lineItems', 'assumptionsToResolve'], 'The reference template');
  need(value.schema === 'qimovi-reference-budget-template/v1', 'Choose a QiMovi reference budget template (v1).');
  need(value.status === 'reference_template_requires_project_scope_and_recost' && value.currentProject === null && value.approved === false && value.currencyCode === null, 'A historical template must remain unapproved, without a current project or assumed currency.');
  need(text(value.name, 240) && text(value.sourceProject, 160) && localReference(value.sourceExtraction), 'The reference template identity is invalid.');
  need(typeof value.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sourceSha256) && day(value.observedOn), 'Supply the historical source SHA-256 and a valid observation date.');
  textList(value.rules, 32, 'Reference rules'); textList(value.assumptionsToResolve, 64, 'Reference assumptions');
  need(Array.isArray(value.categories) && value.categories.length > 0 && value.categories.length <= BUDGET_REFERENCE_LIMITS.categories, 'Use between 1 and 128 reference account groups.');
  const accounts = new Set<string>();
  for (const category of value.categories) {
    shape(category, ['account', 'label', 'labelStatus', 'sourcePage'], 'A reference account group');
    need(account(category.account) && !accounts.has(category.account), 'Reference account identifiers must be valid and unique.');
    need(text(category.label, 240) && text(category.labelStatus, 500) && integer(category.sourcePage, 10000), 'A reference account label or source page is invalid.');
    accounts.add(category.account);
  }
  need(Array.isArray(value.lineItems) && value.lineItems.length > 0 && value.lineItems.length <= BUDGET_REFERENCE_LIMITS.rows, 'Use between 1 and 2000 reference rows.');
  const ids = new Set<string>(), historicalIds = new Set<string>(), locations = new Set<string>();
  for (const row of value.lineItems) {
    shape(row, ['id', 'account', 'categoryAccount', 'description', 'quantity', 'unit', 'runs', 'attempts', 'rate', 'currency', 'estimatedTotal', 'actualTotal', 'status', 'historicalReferenceId', 'source'], 'A reference row');
    need(token(row.id) && !ids.has(row.id) && token(row.historicalReferenceId) && !historicalIds.has(row.historicalReferenceId), 'Reference row identifiers must be valid and unique.');
    need((row.account === null || account(row.account)) && account(row.categoryAccount) && accounts.has(row.categoryAccount), 'Every reference row must name an existing account group.');
    need(text(row.description, 420) && (row.unit === null || text(row.unit, 80)), 'A reference row description or historical unit is invalid.');
    need(row.status === 'uncosted_reference' && ['quantity', 'runs', 'attempts', 'rate', 'currency', 'estimatedTotal', 'actualTotal'].every(key => row[key] === null), 'Reference rows must be uncosted: current quantities, prices, currency and actuals must be null.');
    shape(row.source, ['sourceId', 'page', 'extractedTable', 'extractedRow', 'label', 'rawTablePath'], 'A reference source locator');
    const source = row.source;
    need(token(source.sourceId, 128) && integer(source.page, 10000) && integer(source.extractedTable, 1000) && integer(source.extractedRow, 1000000) && text(source.label, 500) && localReference(source.rawTablePath), 'A reference source locator is invalid.');
    const location = `${source.page}:${source.extractedTable}:${source.extractedRow}`;
    need(!locations.has(location), 'Reference source locations must be unique; importing the same historical row twice would duplicate an allowance.');
    locations.add(location); ids.add(row.id); historicalIds.add(row.historicalReferenceId);
  }
  return JSON.parse(JSON.stringify(value)) as BudgetReferenceTemplate;
}

export function parseBudgetReferenceTemplate(input: string): BudgetReferenceTemplate {
  need(typeof input === 'string' && input.length <= BUDGET_REFERENCE_LIMITS.fileBytes && new TextEncoder().encode(input).byteLength <= BUDGET_REFERENCE_LIMITS.fileBytes, 'Reference templates must be no larger than 2 MB.');
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error('This file is not valid JSON. Choose a QiMovi reference budget template.'); }
  return validateBudgetReferenceTemplate(value);
}

/** Mixed departments and unfamiliar labels remain other; account numbers alone imply no cost type. */
export function inferReferenceBudgetCategory(category: BudgetReferenceCategory): BudgetCategory {
  const label = category.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const known: Record<string, BudgetCategory> = {
    'development story rights': 'development', development: 'development', script: 'development',
    'production unit': 'crew', 'production staff': 'crew', directing: 'crew', cast: 'cast', 'extra talent': 'cast',
    'production design': 'art', 'set construction': 'art', 'set dressing': 'art', 'property props': 'art', wardrobe: 'art', 'make up and hairdressing': 'art',
    sound: 'audio', transportation: 'travel', locations: 'locations',
    'accomidations crew': 'travel', 'accomidations cast': 'travel', 'crew accomidations': 'travel',
    'accommodations crew': 'travel', 'accommodations cast': 'travel', 'crew accommodations': 'travel',
    'post vfx': 'post', 'post sound': 'post', 'post editing': 'post', 'post colour': 'post', 'post color': 'post',
    marketing: 'marketing', contingency: 'contingency', contigency: 'contingency', lawyers: 'legal',
  };
  return own(known, label) ? known[label] : 'other';
}

/** Pure draft adaptation. Saving, pricing and approving remain separate owner actions. */
export function applyBudgetReferenceTemplate(budget: ProductionBudget, input: unknown, options: ApplyBudgetReferenceOptions): AppliedBudgetReference {
  const template = validateBudgetReferenceTemplate(input);
  validateProductionBudget(budget);
  need(options && typeof options.currency === 'string' && (/^[A-Z]{3}$/.test(options.currency) || options.currency === 'HIGGSFIELD_CREDITS'), 'Select an explicit current currency. The historical source currency remains unknown.');
  need(Array.isArray(options.targets), 'Supply the current project budget targets.');
  // Reuse the budget contract to validate inventory identifiers, parents and bounds.
  calculateProductionBudget(budget, [...options.targets]);
  safeJson(options.targetByCategory);
  need(object(options.targetByCategory), 'Explicitly map the selected account groups to current project or department targets.');
  const categories = new Map(template.categories.map(category => [category.account, category]));
  const selected = options.categoryAccounts === undefined ? [...categories.keys()] : options.categoryAccounts;
  need(Array.isArray(selected) && selected.length > 0 && selected.length <= BUDGET_REFERENCE_LIMITS.categories && selected.every(key => account(key) && categories.has(key)) && new Set(selected).size === selected.length, 'Choose unique existing reference account groups.');
  need(Object.keys(options.targetByCategory).every(key => categories.has(key)), 'A target mapping names an unknown reference account group.');
  const rootId = `project:${budget.projectId}`, targets = new Map(options.targets.map(target => [target.id, target]));
  const root = targets.get(rootId);
  need(root?.kind === 'project' && root.parentIds.length === 0, 'The target inventory must contain this budget’s project root.');
  for (const key of selected) {
    const targetId = options.targetByCategory[key], target = targets.get(targetId);
    const department = target?.kind === 'overhead' && target.id.startsWith('department:') && BUDGET_CATEGORIES.includes(target.id.slice('department:'.length) as BudgetCategory) && target.parentIds.length === 1 && target.parentIds[0] === rootId;
    need(target && (target.id === rootId || department), `Map account ${key} to an existing project or department target in this project.`);
  }
  const next = structuredClone(budget), present = new Set(next.lines.map(line => line.id));
  const addedLineIds: string[] = [], skippedLineIds: string[] = [], selectedSet = new Set(selected);
  for (const row of template.lineItems) {
    if (!selectedSet.has(row.categoryAccount)) continue;
    const source = row.source;
    // A stable source locator also deduplicates a renamed template row. Currency/target are
    // deliberately excluded: re-import must preserve owner edits and linked actuals.
    const id = `reference:${template.sourceSha256}:p${source.page}:t${source.extractedTable}:r${source.extractedRow}`;
    if (present.has(id)) { skippedLineIds.push(id); continue; }
    const line: BudgetLine = {
      id, label: `${row.description} — allowance awaiting quantity/rate`, targetId: options.targetByCategory[row.categoryAccount],
      category: inferReferenceBudgetCategory(categories.get(row.categoryAccount)!), currency: options.currency, unit: 'allowance',
      quantity: '1', runs: '1', attempts: '1', rateLow: null, rate: null, rateHigh: null, remainingQuantity: null, committed: '0', rateDate: null,
      basis: `Unpriced allowance awaiting current quantity and rate. Quantity 1 × run 1 × attempt 1 is an allowance placeholder, not measured work. Historical reference only: ${template.sourceProject}; source SHA-256 ${template.sourceSha256}; page ${source.page}, table ${source.extractedTable}, row ${source.extractedRow}; account ${row.account ?? '(unassigned)'}, group ${row.categoryAccount}; reference ${row.historicalReferenceId}. Historical source currency: unknown. Current currency ${options.currency} was explicitly selected for this draft. Historical quantities, rates and actuals were not imported.`,
    };
    next.lines.push(line); present.add(id); addedLineIds.push(id);
  }
  validateProductionBudget(next, { id: budget.projectId, sourceHash: budget.sourceHash });
  return { budget: next, addedLineIds, skippedLineIds };
}
