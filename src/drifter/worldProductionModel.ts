import { universeRecordInProject } from './universeApi';
import type { UniverseCatalog, UniverseEntity, UniverseProductionPlanDraft } from './universeApi';
import { continuityRecord } from './worldContinuityModel';
import type { WorkspaceRecord } from './types';

export type WorldPlanRecord = WorkspaceRecord & { kind: 'universe-production-plan'; data: UniverseProductionPlanDraft };
export const worldBudgetTarget = (entityId: string) => `world:${entityId}`;
export const worldNeedBudgetTarget = (entityId: string, needId: string) => `world-need:${entityId}:${needId}`;
export function worldProductionPlan(model: UniverseCatalog, entityId: string): WorldPlanRecord | null {
  const entity = model.entities.find(item => item.id === entityId);
  return model.drafts.filter((record): record is WorldPlanRecord => record.kind === 'universe-production-plan'
    && record.id === `universe-production-plan:${entityId}` && universeRecordInProject(record.data, model)
    && 'entityId' in record.data && record.data.entityId === entityId
    && 'entityType' in record.data && record.data.entityType === entity?.type)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}
export function activeWorldNeeds(record: WorldPlanRecord | null) {
  return record?.data.review === 'SET_ASIDE' ? [] : record?.data.needs.filter(need => need.review !== 'SET_ASIDE') ?? [];
}
/** Search saved authoring as well as labels. Exact identities remain separate. */
export function worldEntryMatches(model: UniverseCatalog, entity: UniverseEntity, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const records = model.drafts.filter(record => universeRecordInProject(record.data, model) && 'entityId' in record.data && record.data.entityId === entity.id);
  const details = records.flatMap(record => {
    const data = record.data;
    if (record.kind === 'universe-profile' && 'fields' in data) return Object.values(data.fields);
    if (record.kind === 'universe-claim' && 'body' in data) return [data.title, data.body];
    if (record.kind === 'universe-production-plan' && 'needs' in data) return data.needs.flatMap(need => [need.label, need.description]);
    return [];
  });
  const continuity = continuityRecord(model);
  const continuityText = continuity ? [
    ...continuity.data.events.filter(item => item.entityIds.includes(entity.id)).flatMap(item => [item.title, item.description, item.timeLabel]),
    ...continuity.data.aliases.filter(item => item.fromEntityId === entity.id || item.toEntityId === entity.id).map(item => item.note),
  ] : [];
  return [entity.name, entity.summary, ...continuityText, ...entity.citations.map(citation => citation.label), ...details].join('\n').toLocaleLowerCase().includes(needle);
}
