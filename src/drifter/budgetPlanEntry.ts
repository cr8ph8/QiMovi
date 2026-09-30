import { BUDGET_CATEGORIES, BUDGET_LIMITS, validateProductionBudget, type BudgetLine, type ProductionBudget } from '../../local/contracts/production-budget.mjs';

export interface BudgetRowsInput {
  text: string;
  category: BudgetLine['category'];
  currency: string;
  basis: string;
  targetId: string;
}

/** Tab-separated spreadsheet rows. Only supplied rates become prices. */
export function appendBudgetRows(budget: ProductionBudget, input: BudgetRowsInput, makeId: () => string): { budget: ProductionBudget; added: BudgetLine[] } {
  if (!BUDGET_CATEGORIES.includes(input.category)) throw new Error('Choose a department for these rows.');
  if (!input.targetId) throw new Error('Choose a valid budget allocation.');
  const currency = input.currency.trim().toUpperCase();
  const rows = input.text.split(/\r?\n/).filter(row => row.trim());
  if (!rows.length) throw new Error('Enter at least one cost row.');
  if (rows.length > 500 || budget.lines.length + rows.length > BUDGET_LIMITS.lines) throw new Error('Paste at most 500 rows, within the 10,000-line project limit.');
  const added = rows.map((row, index): BudgetLine => {
    const cells = row.split('\t').map(cell => cell.trim());
    if (cells.length > 4) throw new Error(`Row ${index + 1}: use Description, Quantity, Unit, Rate in four tab-separated columns.`);
    const [label, quantity = '', unit = '', enteredRate = ''] = cells;
    const line: BudgetLine = {
      id: makeId(), label, targetId: input.targetId, category: input.category, currency,
      quantity: quantity || '1', unit: unit || 'item', runs: '1', attempts: '1',
      rate: enteredRate || null, rateLow: null, rateHigh: null, remainingQuantity: null,
      committed: '0', basis: input.basis.trim(), rateDate: null,
    };
    try { validateProductionBudget({ ...budget, lines: [line], actuals: [] }); }
    catch (reason) { throw new Error(`Row ${index + 1}: ${reason instanceof Error ? reason.message : 'Check the values.'}`); }
    return line;
  });
  const next = { ...budget, lines: [...budget.lines, ...added] };
  validateProductionBudget(next);
  return { budget: next, added };
}
