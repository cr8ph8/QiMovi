import { validateProductionBudget, type BudgetCategory, type BudgetLine, type ProductionBudget } from '../../local/contracts/production-budget.mjs';

export type PreservationCostPeriod = 'initial' | 'annual' | 'migration';
export interface PreservationCostStarter {
  id: string;
  label: string;
  period: PreservationCostPeriod;
  category: BudgetCategory;
  locator: string;
  note: string;
}
export interface PreservationBudgetOptions {
  starterIds: readonly string[];
  currency: string;
  targetId: string;
}

const sourceFilename = 'Digital_preservation_budget_template (1) (3).xlsx';
const sourceHash = 'ebda7995aa1c647e0011341d1f01e8ff01d9733671b55d9b9275c611bd07b007';

export const PRESERVATION_COST_PERIODS: readonly Readonly<{ id: PreservationCostPeriod; label: string; description: string }>[] = Object.freeze([
  Object.freeze({ id: 'initial' as const, label: 'Initial setup', description: 'One selected setup allowance. Choose the work and media needed for this project.' }),
  Object.freeze({ id: 'annual' as const, label: 'Annual care (one year)', description: 'One selected annual planning period. No future years or automatic recurrence are added.' }),
  Object.freeze({ id: 'migration' as const, label: 'Migration (one event)', description: 'One selected migration event. Choose its timing separately; no future calendar is created.' }),
]);

/** Source categories only: workbook example quantities, costs, regions and timing are never imported. */
export const PRESERVATION_COST_STARTERS: readonly Readonly<PreservationCostStarter>[] = Object.freeze(([
  { id: 'media-capacity', label: 'Storage media and copy capacity', period: 'initial', category: 'storage', locator: 'A13:C14; A18:G20', note: 'Choose the media mix and number of copies. HDD and LTO are options within this allowance, not separate compulsory purchases. Confirm any LTO drive/software needs. Convert GiB/TiB and vendor decimal TB explicitly before sizing; do not use workbook example volumes.' },
  { id: 'organize', label: 'Organize preservation files', period: 'initial', category: 'post', locator: 'A44:D44', note: 'Estimate the actual organizing work. Preserve editing-system filename and folder dependencies.' },
  { id: 'checksums', label: 'Create and verify checksums', period: 'initial', category: 'post', locator: 'A45:D45', note: 'Estimate checksum creation and verification work for the selected files and copies.' },
  { id: 'inventory', label: 'Create preservation inventory', period: 'initial', category: 'post', locator: 'A46:D46', note: 'Estimate inventory work and any required tools using the actual holdings.' },
  { id: 'catalog', label: 'Catalog preservation metadata', period: 'initial', category: 'post', locator: 'A47:D47', note: 'Estimate cataloging and technical metadata work for the selected materials.' },
  { id: 'transfer', label: 'Initial transfer and copy work', period: 'initial', category: 'post', locator: 'A19:G20; A44:D47', note: 'Derived planning allowance for transferring the selected copies; the workbook has no separate transfer row. Include only work not already covered by organizing, checksum work, or a provider estimate.' },
  { id: 'cloud-storage', label: 'Cloud storage', period: 'annual', category: 'storage', locator: 'A24:F26', note: 'Price one selected year using the chosen provider, tier, region and actual volume. Convert GiB/TiB and decimal TB explicitly where needed. Storage charges do not establish preservation processing or retrieval coverage.' },
  { id: 'physical-storage', label: 'Physical media storage', period: 'annual', category: 'storage', locator: 'A31:C34', note: 'Price one selected year for the actual storage locations and copy plan; do not assume the two example locations or their rates.' },
  { id: 'fixity', label: 'Fixity checks on stored copies', period: 'annual', category: 'post', locator: 'A50:D51', note: 'Estimate the checks and labor planned for one selected year. The number of checks and files must be supplied for this project.' },
  { id: 'cloud-retrieval', label: 'Cloud retrieval and download', period: 'annual', category: 'storage', locator: 'A27:F27', note: 'Estimate retrieval, requests and egress for one selected year from the actual provider and retrieval plan. The workbook leaves these costs TBD; a blank estimate is not zero.' },
  { id: 'migration-labor', label: 'Media migration labor', period: 'migration', category: 'post', locator: 'A52:D52', note: 'Estimate one selected migration event, including checksum verification and inventory work. Choose timing from the actual media and format plan; the workbook example interval is not a schedule.' },
  { id: 'replacement-media', label: 'Replacement media for migration', period: 'migration', category: 'storage', locator: 'A53:D53', note: 'Estimate new media for one selected migration event. Select the media/copy plan and convert GiB/TiB versus decimal TB explicitly; no placeholder price is imported.' },
] satisfies PreservationCostStarter[]).map(starter => Object.freeze(starter)));

const startersById = new Map(PRESERVATION_COST_STARTERS.map(starter => [starter.id, starter]));

/** Stable per source and starter, intentionally independent of currency, year, or import count. */
export function preservationBudgetLineId(starterId: string): string {
  if (!startersById.has(starterId)) throw new Error('Choose a known preservation cost starter.');
  return `preservation:${sourceHash}:${starterId}`;
}

/** Appends editable, unpriced allowances; repeats preserve all prior edits and recorded actuals. */
export function appendPreservationBudgetLines(budget: ProductionBudget, options: PreservationBudgetOptions): { budget: ProductionBudget; added: BudgetLine[] } {
  validateProductionBudget(budget);
  if (!options || typeof options.currency !== 'string' || options.currency.length !== 3 || !/^[A-Z]{3}$/.test(options.currency)) {
    throw new Error('Choose a currency using three uppercase letters. The workbook does not supply a currency.');
  }
  if (typeof options.targetId !== 'string' || options.targetId !== `project:${budget.projectId}`) {
    throw new Error('Choose this project’s root budget allocation for preservation costs.');
  }
  if (!Array.isArray(options.starterIds) || options.starterIds.length === 0 || options.starterIds.length > PRESERVATION_COST_STARTERS.length ||
    new Set(options.starterIds).size !== options.starterIds.length || Array.from(options.starterIds).some(id => !startersById.has(id))) {
    throw new Error('Choose at least one known preservation cost starter, without duplicates.');
  }

  const selected = new Set(options.starterIds);
  const existing = new Set(budget.lines.map(line => line.id));
  const added: BudgetLine[] = [];
  for (const starter of PRESERVATION_COST_STARTERS) {
    const id = preservationBudgetLineId(starter.id);
    if (!selected.has(starter.id) || existing.has(id)) continue;
    const period = PRESERVATION_COST_PERIODS.find(period => period.id === starter.period)!;
    added.push({
      id, label: `Preservation - ${period.label}: ${starter.label}`, targetId: options.targetId,
      category: starter.category, currency: options.currency, unit: 'allowance', quantity: '1', runs: '1', attempts: '1',
      rateLow: null, rate: null, rateHigh: null, remainingQuantity: null, committed: '0', rateDate: null,
      basis: [
        `Unpriced allowance for ${period.label.toLowerCase()}. Quantity, runs and attempts of 1 represent one allowance, not measured hours, files, copies or storage capacity.`,
        period.description,
        `Source: ${sourceFilename}, Sheet1!${starter.locator}; SHA-256 ${sourceHash}. Workbook example prices, volumes, currency and dates are not imported.`,
        starter.note,
        'Provider work may replace, rather than add to, the corresponding labor allowance (Sheet1!A61). Review overlapping scope before pricing.',
        'Budget totals sum only the selected lines. No automatic recurrence or future calendar is created; describe the chosen period/event and project quantities before pricing.',
      ].join(' '),
    });
  }
  const next = structuredClone(budget);
  next.lines.push(...added);
  validateProductionBudget(next);
  return { budget: next, added };
}
