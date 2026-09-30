import type { Project, WorkspaceRecord } from './types';

type Data = Record<string, unknown>;
const dataOf = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const decimal = (value: unknown) => typeof value === 'string' && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(value);

/** Saved starter details only; this does not evaluate approval, quality, or production readiness. */
export function currentMovieRecords(project: Project, records: WorkspaceRecord[]): WorkspaceRecord[] {
  const latest = new Map<string, WorkspaceRecord>();
  for (const record of records) if (!latest.has(record.id) || latest.get(record.id)!.version < record.version) latest.set(record.id, record);
  return [...latest.values()].filter(record => {
    const data = dataOf(record.data);
    if (data.projectId !== undefined && data.projectId !== project.id) return false;
    return data.sourceHash === null ? data.projectId === project.id : data.sourceHash === project.sourceHash;
  });
}

export type MovieDeskNeed = {
  id: 'logline' | 'world' | 'screenplay' | 'shots' | 'frames' | 'budget';
  title: string; detail: string; sceneId?: string;
};

export function movieDeskNeeds(project: Project, records: WorkspaceRecord[]): MovieDeskNeed[] {
  const current = currentMovieRecords(project, records);
  const needs: MovieDeskNeed[] = [];
  if (!current.some(record => ['pitch-draft', 'story-plan-draft', 'concept-draft'].includes(record.kind) && hasText(dataOf(record.data).logline))) {
    needs.push({ id: 'logline', title: 'Add project logline', detail: 'In Project pitch, name the protagonist, pursuit and central obstacle in one or two sentences.' });
  }
  const worldProfiles = current.filter(record => record.kind === 'universe-profile').map(record => dataOf(record.data))
    .filter(data => ['story', 'location', 'group'].includes(String(data.entityType)) && data.review !== 'SET_ASIDE');
  if (!worldProfiles.some(data => ['setting', 'timePeriod', 'uniqueElements'].every(key => hasText(dataOf(data.fields)[key])))) {
    needs.push({ id: 'world', title: 'Develop world profile', detail: 'Open a story, location or group in Universe & slate. Add its setting, time period and distinctive elements.' });
  }
  if (!project.scenes.length) {
    needs.push({ id: 'screenplay', title: 'Develop the screenplay', detail: 'Open a writing draft or import Fountain. A saved draft must be attached to production before its scenes appear here.' });
  } else {
    const unplanned = project.scenes.filter(scene => !scene.shots.length);
    if (unplanned.length) needs.push({ id: 'shots', title: 'Review source & shot plan', sceneId: unplanned[0].id,
      detail: `${unplanned.length} ${unplanned.length === 1 ? 'scene has' : 'scenes have'} no planned shots. Review the source and coverage, starting with scene ${unplanned[0].index}.` });
    const missingFrames = project.scenes.flatMap(scene => scene.shots.filter(shot => !project.cells.some(cell => cell.sceneId === scene.id && cell.shotId === shot.id && /^[a-f0-9]{64}$/i.test(cell.imageHash ?? ''))).map(shot => ({ scene, shot })));
    if (missingFrames.length) needs.push({ id: 'frames', title: 'Add a storyboard frame', sceneId: missingFrames[0].scene.id,
      detail: `${missingFrames.length} planned ${missingFrames.length === 1 ? 'shot has' : 'shots have'} no image reference. Start with scene ${missingFrames[0].scene.index}, ${missingFrames[0].shot.label}.` });
  }
  const budget = current.find(record => record.kind === 'production-budget' && record.id === `production-budget:${project.id}`);
  const lines = dataOf(budget?.data).lines;
  if (!Array.isArray(lines) || !lines.length) {
    needs.push({ id: 'budget', title: 'Prepare budget', detail: 'Add named cost lines with quantities, rates and the quote or assumption behind each estimate.' });
  } else {
    const missing = lines.filter(value => { const line = dataOf(value); return !hasText(line.label) || !hasText(line.basis) || !hasText(line.unit) || !hasText(line.currency) || !['quantity', 'runs', 'attempts', 'rate'].every(key => decimal(line[key])); });
    if (missing.length) needs.push({ id: 'budget', title: 'Fill budget estimates', detail: `${missing.length} of ${lines.length} cost ${lines.length === 1 ? 'line needs' : 'lines need'} a name, quantity, rate, unit, currency or estimate basis. An unknown rate is not a zero cost.` });
  }
  return needs;
}
