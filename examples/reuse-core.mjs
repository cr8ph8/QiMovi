// Synthetic MIT example. No files, accounts, database, or provider calls.
// Run from the repository root: node examples/reuse-core.mjs
import assert from 'node:assert/strict';
import { buildScreenplayIndex, reconstructScreenplay } from '../local/contracts/screenplay-index.mjs';
import { profileFieldsForType } from '../local/contracts/universe-profile.mjs';
import { validateCreativeProject } from '../local/contracts/creative-project.mjs';
import { emptyProductionBudget, validateProductionBudget, calculateProductionBudget } from '../local/contracts/production-budget.mjs';

// Index exact source text; these positional scene IDs are not persistent identity.
const screenplay = 'Title: Example Short\n\nEXT. HARBOR - DAY\n\nA keeper lights a lamp.\n\nKEEPER\nCome home.\n';
const index = buildScreenplayIndex(screenplay);
assert.equal(index.scenes.length, 1);
assert.equal(reconstructScreenplay(index), screenplay);

// A destination UI can display these questions without copying the React editor.
const characterQuestions = profileFieldsForType('character');
assert.ok(characterQuestions.some(field => field.id === 'desire'));

// This is an empty development project. Indexing text above does not attach it.
const project = validateCreativeProject({
  id: 'example-film', title: 'Example Short', profile: 'caniscreenwrite-creative/v1',
  sourceHash: null, sourceStatus: 'NO_SCREENPLAY', scenes: [], cells: [],
  characters: [], continuityQuestions: [],
});
const budget = emptyProductionBudget(project);
budget.lines.push({
  id: 'line:lighting', targetId: 'work:lighting', label: 'Lighting rental',
  category: 'equipment', currency: 'USD', unit: 'day',
  quantity: '2', runs: '1', attempts: '1',
  rateLow: null, rate: '125', rateHigh: null, remainingQuantity: null,
  committed: '0', basis: 'Synthetic planning assumption, not a vendor quote.', rateDate: null,
});
const targets = [{ id: 'work:lighting', kind: 'work', label: 'Lighting', parentIds: [], costRequired: true }];
validateProductionBudget(budget, project); // Validate before calculation or persistence.
const priced = calculateProductionBudget(budget, targets);
assert.equal(priced.lines[0].estimate, '250');

// Preserve the difference between unknown and explicitly stated zero.
const unpriced = structuredClone(budget);
unpriced.lines[0].rate = null;
unpriced.lines[0].basis = '';
validateProductionBudget(unpriced, project);
const unknown = calculateProductionBudget(unpriced, targets);
assert.equal(unknown.lines[0].estimate, null);
assert.ok(unknown.gaps.some(gap => gap.code === 'UNPRICED_LINE'));
const free = structuredClone(budget);
free.lines[0].rate = '0';
free.lines[0].basis = 'Synthetic example: equipment provided at no charge.';
validateProductionBudget(free, project);
assert.equal(calculateProductionBudget(free, targets).lines[0].estimate, '0');

console.log(JSON.stringify({
  sceneHeadings: index.scenes.map(scene => scene.heading),
  firstCharacterQuestion: characterQuestions[0].label,
  plannedCostUSD: priced.lines[0].estimate,
  unknownCostUSD: unknown.lines[0].estimate,
  gap: unknown.gaps.find(gap => gap.code === 'UNPRICED_LINE').code,
  persisted: false,
}, null, 2));
