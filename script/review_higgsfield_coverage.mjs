// Compare a retained live MCP observation with the desktop's actual preparation
// catalog. This is an inventory check, never a provider execution qualification.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getHiggsfieldTools } from '../local/providers/higgsfield-tools.mjs';

const [observationPath, outputDirectory] = process.argv.slice(2);
if (!observationPath || !outputDirectory) throw new Error('Usage: node script/review_higgsfield_coverage.mjs LIVE_CAPABILITIES.json NEW_OUTPUT_DIRECTORY');
const bytes = fs.readFileSync(observationPath);
const observed = JSON.parse(bytes);
if (!Array.isArray(observed.tools) || !Array.isArray(observed.models?.items) || observed.models.has_more !== false) throw new Error('A complete tool inventory and fully paginated model observation are required.');
const unique = (rows, key) => new Set(rows.map(row => row[key])).size === rows.length;
if (!unique(observed.tools, 'name') || !unique(observed.models.items, 'id')) throw new Error('Duplicate tool or model identities in observation.');
const local = getHiggsfieldTools();
const names = new Set(observed.tools.map(tool => tool.name));
const localModels = new Map(local.models.map(model => [model.id, model]));
const composer = new Set(local.composerModelIds);
const byTool = new Map(local.actions.map(action => [action.tool, action]));
const csv = rows => rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\n') + '\n';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const tools = observed.tools.map(tool => {
  const action = byTool.get(tool.name);
  return { tool: tool.name, title: action?.title ?? '', group: action?.group ?? '', mappedInApp: Boolean(action), appStatus: action?.executionStatus ?? 'UNMAPPED', appExecutable: action?.executable === true, inputs: action?.inputs ?? [], output: action?.output ?? '', effect: action?.effect ?? '' };
});
const models = observed.models.items.map(model => {
  const retained = localModels.get(model.id);
  const contractFields = ['id', 'output_type', 'parameters', 'medias', 'aspect_ratios', 'durations', 'duration_range'];
  const contract = value => Object.fromEntries(contractFields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  const contractMatches = Boolean(retained && canonical(contract(retained)) === canonical(contract(model)));
  return { id: model.id, name: model.name, outputType: model.output_type, retainedInApp: Boolean(retained), contractMatches, requestComposer: composer.has(model.id), appExecutable: false,
    boundary: model.output_type === '3d' ? '3D model discovery is separate from Scene Builder; no generic generate_3d tool is exposed.' : ['sonilo_music', 'mirelo_text_to_audio', 'inworld_text_to_speech'].includes(model.id) ? 'Catalog says game pipeline only; the exposed audio submission tool is speech-only.' : !composer.has(model.id) ? 'Catalog discovery only; no qualified local request composer.' : !contractMatches ? 'Retained request contract differs from this live observation; review before use.' : 'Local preparation only; upload, cost, submission and return still need desktop qualification.' };
});
const counts = rows => rows.reduce((result, row) => { result[row.outputType] = (result[row.outputType] ?? 0) + 1; return result; }, {});
const report = {
  schemaVersion: 'caniscreenwrite-higgsfield-product-review/v1',
  observedAt: observed.observedAt,
  checkedAt: new Date().toISOString(),
  scope: 'CANISCREENWRITE_WHOLE_PRODUCT',
  sourceObservationSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  localCatalogSha256: local.snapshot.catalogSha256,
  localActionsSha256: local.actionCatalogSha256,
  localReadiness: local.readiness,
  executionQualified: false,
  counts: { tools: tools.length, mappedTools: tools.filter(row => row.mappedInApp).length, executableActions: tools.filter(row => row.appExecutable).length, models: models.length, byOutput: counts(models), requestComposers: models.filter(row => row.requestComposer).length, composerByOutput: counts(models.filter(row => row.requestComposer)), recipes: local.modelPresets.length, marketingFormats: local.marketingFormats.length, marketingStyles: local.marketingStyles.length },
  unmappedTools: tools.filter(row => !row.mappedInApp).map(row => row.tool),
  noLongerExposedActions: local.actions.filter(action => !names.has(action.tool)).map(action => action.tool),
  changedModelContracts: models.filter(row => row.retainedInApp && !row.contractMatches).map(row => row.id),
  missingModels: models.filter(row => !row.retainedInApp).map(row => row.id),
  tools, models,
};
// Keep earlier observations intact; each run creates a new result directory.
fs.mkdirSync(path.resolve(outputDirectory), { recursive: false });
fs.writeFileSync(path.join(outputDirectory, 'coverage.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(outputDirectory, 'tools.csv'), csv([['Tool', 'Filmmaking action', 'Group', 'App status', 'App executable', 'Inputs', 'Output', 'Effect'], ...tools.map(row => [row.tool, row.title, row.group, row.appStatus, row.appExecutable, row.inputs.join(' | '), row.output, row.effect])]), { flag: 'wx' });
fs.writeFileSync(path.join(outputDirectory, 'models.csv'), csv([['Model ID', 'Name', 'Output', 'Retained', 'Contract matches', 'Request composer', 'App executable', 'Boundary'], ...models.map(row => [row.id, row.name, row.outputType, row.retainedInApp, row.contractMatches, row.requestComposer, row.appExecutable, row.boundary])]), { flag: 'wx' });
console.log(JSON.stringify({ counts: report.counts, unmappedTools: report.unmappedTools, noLongerExposedActions: report.noLongerExposedActions, changedModelContracts: report.changedModelContracts, missingModels: report.missingModels, executionQualified: false, outputDirectory: path.resolve(outputDirectory) }, null, 2));
if (report.unmappedTools.length || report.noLongerExposedActions.length || report.changedModelContracts.length || report.missingModels.length) process.exitCode = 1;
